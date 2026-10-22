'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const LIMIT = 20 * 1024 * 1024;
const DEADLINE = 20000;
const MAX_DEADLINE = 25000;

function validate(config, filesystem) {
  if (!config || typeof config !== 'object' || Array.isArray(config) ||
      Object.keys(config).some(key => !['host', 'identity', 'port'].includes(key))) throw Error('Configuración SSH inválida.');
  const host = config.host;
  const parts = typeof host === 'string' && host.split('.');
  if (!parts || parts.length !== 4 || parts.some(part => !/^(?:0|[1-9][0-9]{0,2})$/.test(part) || Number(part) > 255)) throw Error('Usá una IPv4 privada literal.');
  const [first, second] = parts.map(Number);
  if (!(first === 10 || first === 172 && second >= 16 && second <= 31 || first === 192 && second === 168)) throw Error('Usá una IPv4 privada literal.');
  const identity = config.identity;
  if (typeof identity !== 'string' || identity.length > 4096 || !path.isAbsolute(identity) || /[\x00-\x1f\x7f]/.test(identity)) throw Error('La identidad debe ser una ruta absoluta válida.');
  try {
    const stat = filesystem.lstatSync(identity);
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error('invalid');
  } catch { throw Error('La identidad debe ser un archivo regular existente.'); }
  const port = config.port === undefined ? 22 : config.port;
  if (!/^\d+$/.test(String(port)) || Number(port) < 1 || Number(port) > 65535) throw Error('Puerto SSH inválido.');
  return {host, identity, port: Number(port)};
}

function createTransport(config, deps = {}) {
  const target = validate(config, deps.fs || fs);
  const spawn = deps.spawn || cp.spawn;
  const args = ['-i', target.identity, '-p', String(target.port), '-o', 'BatchMode=yes',
    '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=8',
    '-o', 'KexAlgorithms=+diffie-hellman-group14-sha1,diffie-hellman-group1-sha1',
    '-o', 'HostKeyAlgorithms=+ssh-rsa', '-o', 'PubkeyAcceptedAlgorithms=+ssh-rsa',
    'root@' + target.host, 'sh -s'];
  return {async runRemote(script, options = {}) {
    const timeoutMs = options.timeoutMs === undefined ? DEADLINE : options.timeoutMs;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_DEADLINE) throw Error('Límite de tiempo inválido.');
    if (typeof script !== 'string' || !script.trim() || script.includes('\0') || Buffer.byteLength(script) > LIMIT) throw Error('Script local inválido.');
    const input = script.replace(/\r\n/g, '\n');
    return new Promise((resolve, reject) => {
      let child, done = false, size = 0;
      const chunks = [];
      const timer = setTimeout(() => finish('SSH superó el tiempo permitido.', true), timeoutMs);
      function finish(message, kill) {
        if (done) return;
        done = true; clearTimeout(timer);
        if (kill && child) { try { child.kill('SIGKILL'); } catch {} }
        if (message) reject(Error(message)); else resolve({stdout: Buffer.concat(chunks).toString('utf8')});
      }
      function output(bytes, keep) {
        if (done) return;
        const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
        size += buffer.length;
        if (size > LIMIT) return finish('SSH excedió el límite de salida.', true);
        if (keep) chunks.push(buffer);
      }
      try {
        child = spawn('ssh', args, {stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true});
        child.on('error', () => finish('No se pudo ejecutar SSH.', true));
        child.on('close', code => finish(code === 0 ? null : 'No se pudo completar la operación SSH.'));
        child.stdout.on('data', bytes => output(bytes, true));
        child.stderr.on('data', bytes => output(bytes, false));
        child.stdout.on('error', () => finish('No se pudo leer la respuesta SSH.', true));
        child.stderr.on('error', () => finish('No se pudo leer la respuesta SSH.', true));
        child.stdin.on('error', () => finish('No se pudo enviar la operación SSH.', true));
        child.stdin.end(input);
      } catch { finish('No se pudo ejecutar SSH.', true); }
    });
  }};
}

async function runRemote(config, script, options, deps) {
  return createTransport(config, deps).runRemote(script, options);
}
module.exports = {createTransport, runRemote};
