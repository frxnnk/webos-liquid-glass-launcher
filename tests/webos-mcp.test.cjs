const {test} = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const cp = require('node:child_process');
const {createServer, luna, quote} = require('../tools/webos-mcp/server.cjs');

const LAMPS = 'window.LAUNCHER_LIGHTS = {"selectedIds":["wiz-aabbcc001122","wiz-aabbcc003344"]};';
function setup(over = {}) {
  const scripts = [];
  const run = async script => {
    scripts.push(script);
    if (/lights-config\.js/.test(script)) return over.lamps === undefined ? LAMPS : over.lamps;
    if (/listApps/.test(script)) return JSON.stringify({returnValue: true, apps: over.apps || [
      {id: 'netflix', title: 'Netflix'}, {id: 'com.webos.app.adoverlay', title: 'Ad', visible: false}, {id: 'x', title: 'Con <b>marcado</b>', noWindow: true},
      {id: 'youtube.leanback.v4', title: 'YouTube'}]});
    return over.reply === undefined ? '{"returnValue":true}' : over.reply;
  };
  const server = createServer({run, cdp: async () => 'QUJD'});
  const call = (name, args) => server.handle({jsonrpc: '2.0', id: 7, method: 'tools/call', params: {name, arguments: args}});
  return {scripts, server, call};
}
const text = reply => reply.result.content[0].text;

test('the server speaks MCP: initialize, tools/list and ping, and ignores notifications', async () => {
  const {server} = setup();
  const init = await server.handle({jsonrpc: '2.0', id: 1, method: 'initialize', params: {}});
  assert.equal(init.result.protocolVersion, '2024-11-05');
  assert.deepEqual(Object.keys(init.result.capabilities), ['tools']);
  assert.equal(await server.handle({jsonrpc: '2.0', method: 'notifications/initialized'}), null);
  assert.deepEqual((await server.handle({jsonrpc: '2.0', id: 2, method: 'ping'})).result, {});
  const list = (await server.handle({jsonrpc: '2.0', id: 3, method: 'tools/list'})).result.tools;
  assert.deepEqual(list.map(t => t.name), ['tv_status', 'list_apps', 'launch_app', 'go_home', 'lights_get', 'lights_set', 'auto_status', 'auto_set', 'screenshot']);
  assert.ok(list.every(t => t.description && t.inputSchema.type === 'object'));
  assert.equal(list.some(t => /shell|exec|command/i.test(t.name)), false, 'no arbitrary command tool');
  assert.equal((await server.handle({jsonrpc: '2.0', id: 4, method: 'nope'})).error.code, -32601);
  assert.equal((await server.handle({jsonrpc: '1.0', id: 5, method: 'ping'})).error.code, -32600);
});

test('list_apps shows only visible apps with a plain title', async () => {
  const {call} = setup();
  assert.equal(text(await call('list_apps', {})), 'netflix — Netflix\nyoutube.leanback.v4 — YouTube');
});

test('launch_app only opens an id the TV reports and never builds a command from bad input', async () => {
  const t = setup();
  const good = await t.call('launch_app', {appId: 'netflix'});
  assert.equal(good.result.isError, undefined);
  assert.match(t.scripts[t.scripts.length - 1], /applicationManager\/launch' '\{"id":"netflix"\}'/);
  for (const appId of ["x'; reboot; echo '", 'a b', '../x', '', 'e'.repeat(200), 42, null]) {
    const before = t.scripts.length;
    const bad = await t.call('launch_app', {appId});
    assert.equal(bad.result.isError, true);
    assert.equal(t.scripts.length, before, 'invalid ids never reach the TV');
  }
  const missing = await t.call('launch_app', {appId: 'not.installed'});
  assert.equal(missing.result.isError, true);
  assert.match(text(missing), /no tiene instalada/);
});

test('lights_set validates and clamps, uses the selected lamps and the launcher identity', async () => {
  const t = setup();
  const done = await t.call('lights_set', {on: true, brightness: 250, rgb: [300, -5, 20]});
  assert.equal(done.result.isError, undefined);
  const script = t.scripts[t.scripts.length - 1];
  assert.match(script, /-a com\.frxn\.mipantalla /);
  const payload = JSON.parse(/setState' '(.*)' <\/dev\/null/.exec(script)[1]);
  assert.deepEqual(payload, {ids: ['wiz-aabbcc001122', 'wiz-aabbcc003344'], on: true, brightness: 100, rgb: [255, 0, 20]});
  for (const args of [{}, {brightness: 'mucho'}, {rgb: [1, 2]}, {rgb: [1, 2, 3], temperature: 3000}, {on: 'si'}, {temperature: 1.5}, {extra: 1, on: true}]) {
    const bad = await t.call('lights_set', args);
    if (args.extra) assert.equal(bad.result.isError, undefined); else assert.equal(bad.result.isError, true);
  }
  const none = setup({lamps: 'window.LAUNCHER_LIGHTS = {};'});
  assert.match(text(await none.call('lights_set', {on: false})), /No hay lámparas elegidas/);
});

test('auto_set and auto_status go through the lights service as the launcher', async () => {
  const t = setup();
  await t.call('auto_set', {enabled: true});
  assert.match(t.scripts[t.scripts.length - 1], /-a com\.frxn\.mipantalla 'luna:\/\/com\.frxn\.mipantalla\.lights\/setAuto' '\{"enabled":true\}'/);
  assert.equal((await t.call('auto_set', {enabled: 'yes'})).result.isError, true);
  await t.call('auto_status', {});
  assert.match(t.scripts[t.scripts.length - 1], /lights\/autoStatus/);
});

test('screenshot returns an image and every failure is a tool error, not a crash', async () => {
  const shot = await setup().call('screenshot', {});
  assert.deepEqual(shot.result.content[0], {type: 'image', data: 'QUJD', mimeType: 'image/jpeg'});
  const failing = createServer({run: async () => { throw new Error('SSH falló (255)'); }, cdp: async () => { throw new Error('sin página'); }});
  const reply = await failing.handle({jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name: 'tv_status', arguments: {}}});
  assert.equal(reply.result.isError, true);
  assert.match(reply.result.content[0].text, /SSH falló/);
  assert.equal((await failing.handle({jsonrpc: '2.0', id: 2, method: 'tools/call', params: {name: 'bogus'}})).error.code, -32602);
  assert.equal((await failing.handle({jsonrpc: '2.0', id: 3, method: 'tools/call', params: {name: 'tv_status', arguments: []}})).error.code, -32602);
});

test('shell quoting rejects anything that could break out of a single-quoted argument', () => {
  assert.equal(quote('abc'), "'abc'");
  for (const bad of ["a'b", 'a\0b', 5, null]) assert.throws(() => quote(bad));
  assert.match(luna('luna://x/y', {a: 1}, true), /^LD_PRELOAD= luna-send -n 1 -a com\.frxn\.mipantalla 'luna:\/\/x\/y' '\{"a":1\}' <\/dev\/null$/);
});

test('run as a process, it answers JSON lines on stdin and refuses to start without a TV address or key', async () => {
  const file = path.join(__dirname, '../tools/webos-mcp/server.cjs');
  const blank = cp.spawnSync(process.execPath, [file], {env: {PATH: process.env.PATH}, encoding: 'utf8', input: ''});
  assert.equal(blank.status, 2);
  assert.match(blank.stderr, /WEBOS_TV_HOST/);
  const noKey = cp.spawnSync(process.execPath, [file], {env: {PATH: process.env.PATH, WEBOS_TV_HOST: '192.168.1.36'}, encoding: 'utf8', input: ''});
  assert.equal(noKey.status, 2);
  assert.match(noKey.stderr, /WEBOS_TV_SSH_KEY/);
  const alive = cp.spawnSync(process.execPath, [file], {env: {PATH: process.env.PATH, WEBOS_TV_HOST: '192.168.1.36', WEBOS_TV_SSH_KEY: 'unused'}, encoding: 'utf8',
    input: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}\nnot json\n'});
  const lines = alive.stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(lines.find(line => line.id === 1).result.tools.length, 9);
  assert.equal(lines.find(line => line.id === null).error.code, -32700);
});
