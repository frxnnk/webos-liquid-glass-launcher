#!/usr/bin/env node
'use strict';
// MCP server (stdio) that lets an AI agent on your PC, such as Claude Code or opencode, look at and drive a rooted
// LG webOS TV running Mi pantalla. The agent does NOT run on the TV (ARMv7, 32 bit, ~300 MB free): it runs on
// the PC and this server talks to the TV over SSH, using only the small fixed set of tools below. There is no
// tool that runs arbitrary commands. No dependencies; Node 18+ (22+ for the screenshot tool).
//
//   WEBOS_TV_HOST      TV address (required)
//   WEBOS_TV_SSH_KEY   private key of the TV's root user (required)
//   WEBOS_TV_SSH_PORT  default 22
//   WEBOS_TV_CDP_PORT  web inspector port, default 9998 (only for screenshot)

const cp = require('node:child_process');

const PROTOCOL = '2024-11-05';
const APP_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const LAUNCHER = 'com.frxn.mipantalla';
const SERVICE = 'luna://com.frxn.mipantalla.lights/';

function quote(text) {
  if (typeof text !== 'string' || text.indexOf("'") !== -1 || text.indexOf('\0') !== -1) throw new Error('Valor no permitido.');
  return "'" + text + "'";
}
// Calls a luna method as root, optionally with Mi pantalla's identity (the lights service only answers it).
function luna(uri, payload, asLauncher) {
  const flag = asLauncher ? '-a ' + LAUNCHER + ' ' : '';
  return 'LD_PRELOAD= luna-send -n 1 ' + flag + quote(uri) + ' ' + quote(JSON.stringify(payload || {})) + ' </dev/null';
}
function jsonOf(text) {
  try { return JSON.parse(text); } catch (error) { throw new Error('La TV devolvió una respuesta que no es JSON: ' + String(text).slice(0, 160)); }
}

function createTools(options) {
  const run = options.run;
  const cdp = options.cdp;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  async function lamps() {
    const text = await run("cat /media/developer/apps/usr/palm/applications/" + LAUNCHER + "/lights-config.js 2>/dev/null");
    const match = /"selectedIds"\s*:\s*\[([^\]]*)\]/.exec(text);
    const ids = match ? (match[1].match(/wiz-[a-f0-9]{12}/g) || []) : [];
    if (!ids.length) throw new Error('No hay lámparas elegidas en lights-config.js de la TV: elegilas en Luces.');
    return ids;
  }
  async function installedApps() {
    const reply = jsonOf(await run(luna('luna://com.webos.applicationManager/listApps', {})));
    if (reply.returnValue !== true || !Array.isArray(reply.apps)) throw new Error('La TV no devolvió el catálogo de apps.');
    return reply.apps;
  }

  return [
    {
      name: 'tv_status',
      description: 'Estado de la TV: firmware, tiempo encendida, memoria, app en primer plano, versión de Mi pantalla y estado de Auto.',
      inputSchema: {type: 'object', properties: {}, additionalProperties: false},
      async handler() {
        const text = await run([
          "echo VERSION=$(grep '\"version\"' /media/developer/apps/usr/palm/applications/" + LAUNCHER + "/appinfo.json | tr -dc '0-9.')",
          "echo FIRMWARE=$(grep core_os_release /var/run/nyx/os_info.json | head -1 | tr -dc '0-9.-')",
          "echo UPTIME=$(cut -d' ' -f1 /proc/uptime)",
          "grep -E 'MemTotal|MemAvailable|SwapTotal|SwapFree' /proc/meminfo | tr -s ' ' | sed 's/^/MEM /'",
          "echo FOREGROUND=$(" + luna('luna://com.webos.service.applicationmanager/getForegroundAppInfo', {}) + " | grep -o '\"appId\":\"[^\"]*' | cut -d'\"' -f4)",
          "echo AUTO=$(cat /var/lib/mipantalla-maintenance/auto-sync/config.json 2>/dev/null)"
        ].join('\n'));
        return text.trim() + '\n(El load average de esta TV es un artefacto de hilos del kernel dormidos; no lo uses para juzgar la carga.)';
      }
    },
    {
      name: 'list_apps',
      description: 'Apps que la TV declara visibles (id y título). Sirve para elegir qué abrir con launch_app.',
      inputSchema: {type: 'object', properties: {}, additionalProperties: false},
      async handler() {
        const apps = (await installedApps()).filter(app => app.visible !== false && app.noWindow !== true && APP_ID.test(String(app.id)));
        return apps.map(app => app.id + ' — ' + String(app.title || '').replace(/<[^>]*>/g, '').slice(0, 80)).join('\n');
      }
    },
    {
      name: 'launch_app',
      description: 'Abre una app de la TV por id (debe estar instalada). Para volver al inicio usá go_home.',
      inputSchema: {type: 'object', properties: {appId: {type: 'string', description: 'Id exacto, p. ej. netflix o youtube.leanback.v4'}}, required: ['appId'], additionalProperties: false},
      async handler(args) {
        if (typeof args.appId !== 'string' || !APP_ID.test(args.appId)) throw new Error('appId inválido.');
        const known = (await installedApps()).some(app => app.id === args.appId);
        if (!known) throw new Error('La TV no tiene instalada ' + args.appId + '. Usá list_apps.');
        return await run(luna('luna://com.webos.applicationManager/launch', {id: args.appId}));
      }
    },
    {
      name: 'go_home',
      description: 'Abre Mi pantalla (el inicio).',
      inputSchema: {type: 'object', properties: {}, additionalProperties: false},
      async handler() { return await run(luna('luna://com.webos.applicationManager/launch', {id: LAUNCHER})); }
    },
    {
      name: 'lights_get',
      description: 'Estado de las lámparas WiZ elegidas en Mi pantalla (encendido, brillo, color o blanco).',
      inputSchema: {type: 'object', properties: {}, additionalProperties: false},
      async handler() {
        const ids = await lamps();
        return await run(luna(SERVICE + 'getState', {ids}, true));
      }
    },
    {
      name: 'lights_set',
      description: 'Cambia todas las lámparas elegidas. Pasá solo lo que querés cambiar. Cancela Pantalla completa/Auto si estaban activos (el servicio restaura primero).',
      inputSchema: {
        type: 'object',
        properties: {
          on: {type: 'boolean'},
          brightness: {type: 'integer', minimum: 1, maximum: 100},
          rgb: {type: 'array', items: {type: 'integer', minimum: 0, maximum: 255}, minItems: 3, maxItems: 3},
          temperature: {type: 'integer', minimum: 2200, maximum: 6500, description: 'Blanco en kelvin'}
        },
        additionalProperties: false
      },
      async handler(args) {
        const patch = {};
        if (args.on !== undefined) { if (typeof args.on !== 'boolean') throw new Error('on debe ser booleano.'); patch.on = args.on; }
        if (args.brightness !== undefined) { if (!Number.isInteger(args.brightness)) throw new Error('brightness debe ser entero.'); patch.brightness = clamp(args.brightness, 1, 100); }
        if (args.rgb !== undefined) {
          if (!Array.isArray(args.rgb) || args.rgb.length !== 3 || !args.rgb.every(Number.isInteger)) throw new Error('rgb debe ser [r,g,b] enteros.');
          patch.rgb = args.rgb.map(v => clamp(v, 0, 255));
        }
        if (args.temperature !== undefined) { if (!Number.isInteger(args.temperature)) throw new Error('temperature debe ser entero.'); patch.temperature = clamp(args.temperature, 2200, 6500); }
        if (patch.rgb && patch.temperature) throw new Error('Elegí color o blanco, no ambos.');
        if (!Object.keys(patch).length) throw new Error('Indicá al menos un cambio.');
        const ids = await lamps();
        return await run(luna(SERVICE + 'setState', Object.assign({ids}, patch), true));
      }
    },
    {
      name: 'auto_status',
      description: 'Estado del modo Auto (Pantalla completa solo con YouTube).',
      inputSchema: {type: 'object', properties: {}, additionalProperties: false},
      async handler() { return await run(luna(SERVICE + 'autoStatus', {}, true)); }
    },
    {
      name: 'auto_set',
      description: 'Activa o desactiva el modo Auto. Al activarlo la captura arranca sola al abrir YouTube.',
      inputSchema: {type: 'object', properties: {enabled: {type: 'boolean'}}, required: ['enabled'], additionalProperties: false},
      async handler(args) {
        if (typeof args.enabled !== 'boolean') throw new Error('enabled debe ser booleano.');
        return await run(luna(SERVICE + 'setAuto', {enabled: args.enabled}, true));
      }
    },
    {
      name: 'screenshot',
      description: 'Captura de la pantalla de Mi pantalla por el inspector web. Solo funciona con Mi pantalla abierta (usá go_home antes). Devuelve una imagen JPEG.',
      inputSchema: {type: 'object', properties: {}, additionalProperties: false},
      async handler() { return {image: await cdp()}; }
    }
  ];
}

function createServer(options) {
  const tools = createTools(options);
  const byName = new Map(tools.map(tool => [tool.name, tool]));
  const ok = (id, result) => ({jsonrpc: '2.0', id, result});
  const fail = (id, code, message) => ({jsonrpc: '2.0', id, error: {code, message}});

  async function handle(message) {
    if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return fail(message && message.id !== undefined ? message.id : null, -32600, 'Solicitud inválida');
    const id = message.id;
    const isRequest = id !== undefined;
    switch (message.method) {
      case 'initialize':
        return ok(id, {protocolVersion: PROTOCOL, capabilities: {tools: {}}, serverInfo: {name: 'webos-mi-pantalla', version: '0.1.0'},
          instructions: 'Controla una LG webOS con root que corre Mi pantalla. No hay shell: solo las herramientas listadas.'});
      case 'ping':
        return isRequest ? ok(id, {}) : null;
      case 'tools/list':
        return ok(id, {tools: tools.map(({name, description, inputSchema}) => ({name, description, inputSchema}))});
      case 'tools/call': {
        const params = message.params || {};
        const tool = byName.get(params.name);
        if (!tool) return fail(id, -32602, 'Herramienta desconocida: ' + String(params.name).slice(0, 60));
        const args = params.arguments === undefined ? {} : params.arguments;
        if (args === null || typeof args !== 'object' || Array.isArray(args)) return fail(id, -32602, 'Los argumentos deben ser un objeto.');
        try {
          const out = await tool.handler(args);
          if (out && typeof out === 'object' && out.image) return ok(id, {content: [{type: 'image', data: out.image, mimeType: 'image/jpeg'}]});
          return ok(id, {content: [{type: 'text', text: String(out).trim() || '(sin salida)'}]});
        } catch (error) {
          return ok(id, {isError: true, content: [{type: 'text', text: String(error && error.message || error).slice(0, 600)}]});
        }
      }
      default:
        return isRequest ? fail(id, -32601, 'Método no soportado: ' + message.method.slice(0, 60)) : null;
    }
  }
  return {handle, tools};
}

// ---- Transporte real ----
function sshRunner(env) {
  const host = env.WEBOS_TV_HOST, key = env.WEBOS_TV_SSH_KEY, port = String(env.WEBOS_TV_SSH_PORT || '22');
  if (!host || !/^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(host)) throw new Error('Definí WEBOS_TV_HOST (nombre o IPv4 de la TV).');
  if (!key) throw new Error('Definí WEBOS_TV_SSH_KEY (clave privada del usuario root de la TV).');
  if (!/^\d{1,5}$/.test(port)) throw new Error('WEBOS_TV_SSH_PORT inválido.');
  const args = ['-i', key, '-p', port, '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=8',
    '-o', 'KexAlgorithms=+diffie-hellman-group14-sha1,diffie-hellman-group1-sha1', '-o', 'HostKeyAlgorithms=+ssh-rsa', '-o', 'PubkeyAcceptedAlgorithms=+ssh-rsa',
    'root@' + host, 'sh -s'];
  return script => new Promise((resolve, reject) => {
    const child = cp.spawn('ssh', args, {stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true});
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('La TV no respondió a tiempo.')); }, 25000);
    child.stdout.on('data', chunk => { if (out.length < 1048576) out += chunk; });
    child.stderr.on('data', chunk => { if (err.length < 4096) err += chunk; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error('SSH falló (' + code + '): ' + err.trim().slice(0, 200))); });
    child.stdin.end(script + '\n');
  });
}
function cdpScreenshot(env) {
  const host = env.WEBOS_TV_HOST, port = Number(env.WEBOS_TV_CDP_PORT || 9998);
  return async () => {
    if (typeof WebSocket !== 'function') throw new Error('screenshot necesita Node 22 o posterior (WebSocket).');
    const pages = await (await fetch('http://' + host + ':' + port + '/json/list', {signal: AbortSignal.timeout(4000)})).json();
    const page = pages.find(entry => entry.title === 'Mi pantalla');
    if (!page) throw new Error('Mi pantalla no está abierta: usá go_home y esperá unos segundos.');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('No se pudo abrir el inspector web.')); });
    try {
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('El inspector no respondió.')), 12000);
        ws.onmessage = event => {
          const reply = JSON.parse(event.data);
          if (reply.id !== 1) return;
          clearTimeout(timer);
          reply.error ? reject(new Error(reply.error.message)) : resolve(reply.result.data);
        };
        ws.send(JSON.stringify({id: 1, method: 'Page.captureScreenshot', params: {format: 'jpeg', quality: 82}}));
      });
    } finally { ws.close(); }
  };
}

function main() {
  let server;
  try { server = createServer({run: sshRunner(process.env), cdp: cdpScreenshot(process.env)}); }
  catch (error) { process.stderr.write(String(error.message) + '\n'); process.exit(2); }
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch (ignored) { process.stdout.write(JSON.stringify({jsonrpc: '2.0', id: null, error: {code: -32700, message: 'JSON inválido'}}) + '\n'); continue; }
      server.handle(message).then(reply => { if (reply) process.stdout.write(JSON.stringify(reply) + '\n'); },
        error => process.stderr.write('Error interno: ' + String(error && error.message) + '\n'));
    }
  });
}

module.exports = {createServer, createTools, luna, quote};
if (require.main === module) main();
