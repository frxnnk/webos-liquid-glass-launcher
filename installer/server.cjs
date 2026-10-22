'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {ACTIONS,MUTATING_ACTIONS} = require('./actions.cjs');
const FILES = {'/styles.css': ['styles.css', 'text/css; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8']};
const MAX_BODY = 16 * 1024;
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function duration(value, fallback, maximum) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw Error('Timeout local inválido.');
  return value;
}

async function startServer(options = {}) {
  const engine = options.engine;
  if (!engine || typeof engine.runAction !== 'function') throw Error('Falta el motor local del asistente.');
  const uiDir = path.resolve(options.uiDir || path.join(__dirname, 'ui'));
  const bodyTimeoutMs = duration(options.bodyTimeoutMs, 5000, 15000);
  const actionTimeoutMs = duration(options.actionTimeoutMs, 120000, 120000);
  const preparationTimeoutMs = options.actionTimeoutMs === undefined ? 300000 : actionTimeoutMs;
  const token = crypto.randomBytes(16).toString('hex');
  const secret = Buffer.from(token, 'ascii');
  let origin, authority, mutating = false, closing = false;
  function headers(response) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
  }
  function json(response, status, value) {
    if (response.writableEnded || response.destroyed) return;
    let body;
    try { body = JSON.stringify(value); }
    catch { status = 500; body = '{"ok":false,"error":{"code":"ACTION_FAILED","message":"No se pudo completar la acción."}}'; }
    response.writeHead(status, {'Content-Type': 'application/json; charset=utf-8'}); response.end(body);
  }
  function error(response, status, code, message) { json(response, status, {ok: false, error: {code, message}}); }
  function authorized(request) {
    const candidate = request.headers['x-setup-token'];
    if (request.headers.origin !== origin || typeof candidate !== 'string' || !/^[a-f0-9]{32}$/.test(candidate)) return false;
    return crypto.timingSafeEqual(secret, Buffer.from(candidate, 'ascii'));
  }
  function execute(request, response, body) {
    let message;
    try { message = JSON.parse(body); } catch { return error(response, 400, 'BAD_REQUEST', 'JSON inválido.'); }
    if (!object(message) || !ACTIONS.includes(message.action) || !object(message.payload) ||
        Object.keys(message).some(key => !['action', 'payload'].includes(key))) return error(response, 400, 'BAD_REQUEST', 'Acción o parámetros inválidos.');
    const mutation = MUTATING_ACTIONS.includes(message.action);
    if (mutation && mutating) return error(response, 409, 'BUSY', 'Ya hay un cambio en curso.');
    if (mutation) mutating = true;
    const deadline = ['rootApply','screenPrepare'].includes(message.action) ? preparationTimeoutMs : actionTimeoutMs;
    const timer = setTimeout(() => error(response, 504, 'ACTION_TIMEOUT', 'La acción sigue pendiente; revisá su estado antes de repetirla.'), deadline);
    Promise.resolve().then(() => engine.runAction(message.action, message.payload)).then(result => {
      clearTimeout(timer); if (mutation) mutating = false;
      json(response, 200, {ok: true, result});
    }, () => {
      clearTimeout(timer); if (mutation) mutating = false;
      error(response, 500, 'ACTION_FAILED', 'No se pudo completar la acción. Revisá el estado antes de repetirla.');
    });
  }
  function body(request, response) {
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] || '')) return error(response, 415, 'CONTENT_TYPE', 'Se requiere application/json.');
    if (Number(request.headers['content-length']) > MAX_BODY) return error(response, 413, 'TOO_LARGE', 'El pedido supera 16 KB.');
    const chunks = []; let bytes = 0, settled = false;
    const timer = setTimeout(() => fail(408, 'BODY_TIMEOUT', 'Se agotó el tiempo para recibir el pedido.'), bodyTimeoutMs);
    function fail(status, code, message) {
      if (settled) return;
      settled = true; clearTimeout(timer); response.setHeader('Connection', 'close');
      error(response, status, code, message);
    }
    request.on('data', chunk => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > MAX_BODY) return fail(413, 'TOO_LARGE', 'El pedido supera 16 KB.');
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (settled) return;
      settled = true; clearTimeout(timer); execute(request, response, Buffer.concat(chunks).toString('utf8'));
    });
    request.on('aborted', () => { settled = true; clearTimeout(timer); });
    request.on('error', () => fail(400, 'BAD_REQUEST', 'No se pudo recibir el pedido.'));
  }
  const server = http.createServer({maxHeaderSize: 8192}, async (request, response) => {
    headers(response);
    const hostCount = request.rawHeaders.filter((value, index) => index % 2 === 0 && value.toLowerCase() === 'host').length;
    if (closing || hostCount !== 1 || request.headers.host !== authority) return error(response, 403, 'FORBIDDEN', 'Origen local inválido.');
    if (request.url === '/api') {
      if (request.method !== 'POST') return error(response, 405, 'METHOD', 'Usá POST.');
      if (!authorized(request)) return error(response, 403, 'FORBIDDEN', 'Sesión local inválida.');
      return body(request, response);
    }
    if (request.method !== 'GET') return error(response, 405, 'METHOD', 'Método no permitido.');
    if (request.headers.origin && request.headers.origin !== origin) return error(response, 403, 'FORBIDDEN', 'Origen local inválido.');
    if (request.url === '/index.html') { response.writeHead(307, {Location: '/'}); return response.end(); }
    const asset = FILES[request.url];
    if (request.url !== '/' && !asset) return error(response, 404, 'NOT_FOUND', 'Recurso no disponible.');
    try {
      let contents = await fs.readFile(path.join(uiDir, asset ? asset[0] : 'index.html'));
      if (!asset) contents = contents.toString('utf8').replace('</head>', '<meta name="setup-token" content="' + token + '"></head>');
      response.writeHead(200, {'Content-Type': asset ? asset[1] : 'text/html; charset=utf-8'}); response.end(contents);
    } catch { error(response, 500, 'UI_UNAVAILABLE', 'La interfaz local no está disponible.'); }
  });
  server.headersTimeout = 5000;
  server.requestTimeout = bodyTimeoutMs;
  server.setTimeout(Math.max(actionTimeoutMs,preparationTimeoutMs) + 5000, socket => socket.destroy());
  server.keepAliveTimeout = 1000;
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(options.port === undefined ? 0 : options.port, '127.0.0.1', resolve);
  });
  authority = '127.0.0.1:' + server.address().port; origin = 'http://' + authority;
  return {server, url: origin, close() {
    closing = true;
    return new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      if (server.closeIdleConnections) server.closeIdleConnections();
    });
  }};
}

module.exports = {startServer};
if (require.main === module) {
  startServer({engine: require('./engine.cjs')}).then(app => {
    console.log('Asistente local: ' + app.url);
    const stop = () => app.close().then(() => { process.exitCode = 0; });
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  }).catch(() => { console.error('No se pudo iniciar el asistente local.'); process.exitCode = 1; });
}
