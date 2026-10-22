const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const context = { window: {}, Math, JSON, Promise, Error, String, Array, Object, setTimeout, clearTimeout };
vm.runInNewContext(read('lights-panel.js'), context);
const L = context.window.LauncherLights;
const plain = (value) => JSON.parse(JSON.stringify(value));
const flush = () => new Promise((resolve) => setImmediate(resolve));

function memory(initial) {
  const data = Object.assign({}, initial);
  return { getItem: (key) => (key in data ? data[key] : null), setItem: (key, value) => { data[key] = String(value); }, data };
}
// Cliente falso: registra cada pedido y responde solo cuando el test lo decide.
function fakeClient() {
  const calls = [];
  const client = {};
  for (const method of ['capabilities', 'discover', 'getState', 'setState', 'setMode', 'screenStatus']) {
    client[method] = function (args) {
      return new Promise((resolve, reject) => calls.push({ method, args: args === undefined ? undefined : plain(args), resolve, reject }));
    };
  }
  client.calls = calls;
  client.localStops = 0;
  client.stopAmbient = () => { client.localStops++; };
  client.last = () => calls[calls.length - 1];
  client.names = () => calls.map((call) => call.method);
  return client;
}
function harness(options = {}) {
  const client = options.client === undefined ? fakeClient() : options.client;
  const storage = options.storage || memory();
  const timers = [];
  const controller = L.createController({
    client: options.getter ? () => client : client,
    storage,
    initialIds: options.initialIds,
    now: options.now,
    setTimer: (fn, ms) => { const timer = { fn, ms }; timers.push(timer); return timer; },
    clearTimer: (timer) => { const at = timers.indexOf(timer); if (at !== -1) timers.splice(at, 1); }
  });
  const expire = () => { const pending = timers.splice(0); pending.forEach((timer) => timer.fn()); };
  return { client, storage, controller, view: controller.view, timers, expire };
}

test('explicit initial living selection seeds only a fresh install and preserves saved empty selection', () => {
  const initialIds = ['wiz-aabbcc001122','wiz-aabbcc334455'];
  assert.deepEqual(plain(harness({initialIds}).view.selected),initialIds);
  const storage=memory({[L.STORAGE_KEY]:'[]'});
  assert.deepEqual(plain(harness({initialIds,storage}).view.selected),[]);
});
const LAMPS = [
  { id: 'a8bb50000001', name: 'Living techo', ip: '192.168.1.40', reachable: true, state: { on: true, brightness: 60, rgb: [255, 150, 40] } },
  { id: 'a8bb50000002', name: 'Living pie', ip: '192.168.1.41', reachable: true, state: { on: false, brightness: 30, rgb: null } },
  { id: 'a8bb50000003', name: 'Cocina', ip: '192.168.1.42', reachable: true, state: { on: true, brightness: 80, rgb: null } }
];
async function ready(h, caps = { available: true, screenSync: false, reason: '' }) {
  const opening = h.controller.open();
  h.client.calls[0].resolve(caps);
  await flush();
  return opening;
}
async function discovered(h, devices = LAMPS) {
  const search = h.controller.discover();
  h.client.last().resolve({ devices });
  await search;
}
const SCREEN_READY = { configured: true, available: true, configVerified: true, framesVerified: true,
  hardwareVerified: true, ready: true, active: false, sourceFreshness: 'fresh', reason: '' };
const CAPTURE_OFF_READY = { ready:true,active:false,pending:false,captureStartReady:true,
  framesVerified:false,sourceFreshness:'unknown',reason:'' };
async function reviewed(h, patch = {}) {
  assert.equal(typeof h.controller.screenStatus, 'function', 'explicit capture review action');
  const pending = h.controller.screenStatus();
  h.client.last().resolve(Object.assign({}, SCREEN_READY, patch));
  await pending;
}
async function modeConfirmed(h,pending,mode,patch={}) {
  h.client.last().resolve({mode});await flush();
  assert.equal(h.client.last().method,'screenStatus','a mode change is followed by one read');
  h.client.last().resolve(Object.assign({},SCREEN_READY,{ready:mode!=='screen',active:mode==='screen'},patch));
  return pending;
}

test('a confirmed cold capture can be explicitly started without claiming frames already exist',async()=>{
  const h=harness();await ready(h,{available:true,screenSync:true});await discovered(h);
  h.controller.toggle(LAMPS[0].id);await reviewed(h,CAPTURE_OFF_READY);
  assert.equal(h.view.screen.ready,true);assert.equal(h.view.screen.captureStartReady,true);
  assert.equal(h.view.screen.framesVerified,false);assert.equal(h.view.screen.active,false);
  assert.match(h.view.message,/Lista para iniciar/);assert.doesNotMatch(h.view.message,/captura verificada|Activo/);
  const before=h.client.calls.length;const start=h.controller.setMode('screen');
  assert.equal(h.client.calls.length,before+1);assert.equal(h.client.last().method,'setMode');
  assert.equal(await modeConfirmed(h,start,'screen'),true);assert.equal(h.view.screen.active,true);
});

test('cold start requires strict readiness, safe ownership and no pending session',async()=>{
  for(const patch of [{captureStartReady:false},{captureStartReady:'true'},{captureStartReady:1},
    {captureStartReady:undefined},{ready:false},{configVerified:false},{hardwareVerified:false},
    {available:false},{pending:true},{reason:'auth-required'},{reason:'capture-not-ready'}]){
    const h=harness();await ready(h,{available:true,screenSync:true});await discovered(h);
    h.controller.toggle(LAMPS[0].id);await reviewed(h,Object.assign({},CAPTURE_OFF_READY,patch));
    assert.equal(h.view.screen.ready,false,JSON.stringify(patch));
    const before=h.client.calls.length;assert.equal(await h.controller.setMode('screen'),false);
    assert.equal(h.client.calls.length,before,'a blocked capture never requests Start');
    assert.equal(h.view.screen.framesVerified,false);
  }
});

test('a timed-out cold Start cannot be repeated and Manual recovery remains available',async()=>{
  const h=harness();await ready(h,{available:true,screenSync:true});await discovered(h);
  h.controller.toggle(LAMPS[0].id);await reviewed(h,CAPTURE_OFF_READY);
  const start=h.controller.setMode('screen');const late=h.client.last();h.expire();assert.equal(await start,false);
  assert.equal(h.view.screen.ready,false);assert.equal(h.view.screen.active,false);
  const calls=h.client.calls.length;assert.equal(await h.controller.setMode('screen'),false);assert.equal(h.client.calls.length,calls);
  h.controller.toggle(LAMPS[0].id);assert.deepEqual(plain(h.view.selected),[LAMPS[0].id],'uncertain recipients remain frozen');
  const manual=h.controller.setMode('manual');assert.equal(h.client.last().method,'setMode');
  assert.equal(h.client.last().args.mode,'manual');
  late.resolve({mode:'screen'});await flush();assert.equal(h.client.last().args.mode,'manual');
  assert.equal(await modeConfirmed(h,manual,'manual',CAPTURE_OFF_READY),true);assert.equal(h.view.mode,'manual');
});

test('capture mode readback uses the remainder of the same 25-second panel budget',async()=>{
  let time=0;const h=harness({now:()=>time});await ready(h,{available:true,screenSync:true});await discovered(h);
  h.controller.toggle(LAMPS[0].id);await reviewed(h,CAPTURE_OFF_READY);
  const start=h.controller.setMode('screen');time=22000;h.client.last().resolve({mode:'screen'});await flush();
  assert.equal(h.client.last().method,'screenStatus');assert.equal(h.timers[0].ms,3000);
  h.expire();assert.equal(await start,true,'the mode ACK remains confirmed, not its capture readback');
  assert.equal(h.view.mode,'screen');assert.equal(h.view.screen.active,false);assert.match(h.view.message,/sin confirmar/);
  const manual=h.controller.setMode('manual');assert.equal(h.client.last().args.mode,'manual');
  assert.equal(await modeConfirmed(h,manual,'manual',CAPTURE_OFF_READY),true);
});

test('mode readback is sequential, bounded and preserves the confirmed mode when capture is unknown',async()=>{
  const h=harness();await ready(h,{available:true,screenSync:true});await discovered(h);
  h.controller.toggle(LAMPS[0].id);await reviewed(h);
  const start=h.controller.setMode('screen');const write=h.client.last();
  assert.equal(write.method,'setMode');write.resolve({mode:'screen'});await flush();
  const readback=h.client.last();assert.equal(readback.method,'screenStatus');
  assert.deepEqual(readback.args,{ids:[LAMPS[0].id]});assert.match(h.view.busy,/Revisando/);
  readback.reject(Error('offline'));assert.equal(await start,true);
  assert.equal(h.view.mode,'screen');assert.equal(h.view.screen.active,false);
  assert.match(h.view.message,/sin confirmar/);
  const manual=h.controller.setMode('manual');assert.equal(h.client.last().method,'setMode');
  h.client.last().resolve({mode:'manual'});await flush();const late=h.client.last();
  h.controller.close();late.resolve(Object.assign({},SCREEN_READY,{active:true}));await manual;
  assert.equal(h.view.phase,'closed');assert.equal(h.view.screen.active,false);
  assert.equal(h.client.calls.filter(call=>call.method==='setMode').length,2,'no writes are repeated');
});

test('a selection change invalidates the capture readback after confirmed Manual',async()=>{
  const h=harness();await ready(h,{available:true,screenSync:true,mode:'screen'});
  h.view.devices=plain([LAMPS[0]]);h.view.selected=[LAMPS[0].id];
  const stop=h.controller.setMode('manual');h.client.last().resolve({mode:'manual'});await flush();
  const readback=h.client.last();assert.equal(readback.method,'screenStatus');
  h.controller.toggle(LAMPS[0].id);
  readback.resolve(Object.assign({},SCREEN_READY,{ready:false,active:true}));await stop;
  assert.equal(h.view.mode,'manual');assert.equal(h.view.screen.active,false);
  assert.deepEqual(plain(h.view.selected),[]);
});

test('capture review distinguishes an owned active output from readiness to start', async () => {
  const h=harness();await ready(h,{available:true,screenSync:true});await discovered(h);
  h.controller.toggle(LAMPS[0].id);
  await reviewed(h,{ready:false,active:true,pending:true,phase:'active',outputEnabled:true});
  assert.equal(h.view.screen.active,true);assert.equal(h.view.screen.ready,false);
  assert.equal(h.view.mode,'screen');assert.match(h.view.message,/Activo/);
  assert.equal(await h.controller.setMode('screen'),false,'active capture cannot be started again');
  const manual=h.controller.setMode('manual');
  assert.equal(await modeConfirmed(h,manual,'manual'),true);assert.equal(h.view.screen.active,false);
});

test('capture mode deadlines cover backend settling without extending ordinary light controls', async () => {
  const h=harness();await ready(h,{available:true,screenSync:true});await discovered(h);
  h.controller.toggle(LAMPS[0].id);await reviewed(h);
  const start=h.controller.setMode('screen');assert.equal(h.timers[0].ms,25000);
  assert.equal(await modeConfirmed(h,start,'screen'),true);
  const stop=h.controller.setMode('manual');assert.equal(h.timers[0].ms,25000);
  assert.equal(await modeConfirmed(h,stop,'manual'),true);
  const power=h.controller.power(true);assert.equal(h.timers[0].ms,8000);
  h.client.last().resolve({devices:[LAMPS[0]]});await power;
});

test('capture restoration remains reachable when the owned session is not confirmed active', async () => {
  for(const phase of ['prepared','restoring']){
    const h=harness();await ready(h,{available:true,screenSync:true,mode:'screen'});
    await reviewed(h,{ready:false,active:false,pending:true,phase,outputEnabled:false,reason:'restore-pending'});
    assert.equal(h.view.screen.active,false);assert.equal(h.view.screen.ready,false);
    assert.match(h.view.message,/restauraci/);assert.doesNotMatch(h.view.message,/Activo/);
    const manual=h.controller.setMode('manual');
    assert.equal(h.client.last().method,'setMode');assert.deepEqual(h.client.last().args.ids,[]);
    assert.equal(await modeConfirmed(h,manual,'manual'),true);
  }
});

test('a capture reply after eight seconds still confirms before the bounded mode deadline', async () => {
  const h=harness();await ready(h,{available:true,screenSync:true});await discovered(h);
  h.controller.toggle(LAMPS[0].id);await reviewed(h);
  const pending=h.controller.setMode('screen');const command=h.client.last();
  h.timers.filter(timer=>timer.ms<=9000).forEach(timer=>timer.fn());await flush();
  assert.match(h.view.busy,/Cambiando/);assert.equal(h.client.last(),command,'no request is repeated');
  assert.equal(await modeConfirmed(h,pending,'screen'),true);assert.equal(h.view.mode,'screen');
});

test('capture review is explicit, accepts no lamps, sends only saved ids and preserves no secrets', async () => {
  const h = harness(); await ready(h, { available: true, screenSync: false });
  assert.deepEqual(h.client.names(), ['capabilities']);
  assert.equal(typeof h.controller.screenStatus, 'function', 'capture review action exists');
  const pending = h.controller.screenStatus();
  assert.deepEqual(h.client.last().args, { ids: [] });
  h.client.last().resolve(Object.assign({}, SCREEN_READY, { ready: false, hardwareVerified: false,
    reason: 'frames-unverified', token: 'secret-token', endpoint: 'secret-host' }));
  await pending;
  assert.equal(h.view.screen.reason, 'frames-unverified');
  assert.doesNotMatch(JSON.stringify(h.view), /secret-token|secret-host/);
  assert.deepEqual(h.client.names(), ['capabilities', 'screenStatus'], 'review never writes or discovers');
});

test('screen mode requires capture review plus capability and verified frames and hardware', async () => {
  for (const patch of [null, { ready: false }, { hardwareVerified: false }, { framesVerified: false }, { ready: 'true' }]) {
    const h = harness(); await ready(h, { available: true, screenSync: true }); await discovered(h);
    h.controller.toggle(LAMPS[0].id);
    if (patch) await reviewed(h, patch);
    const before = h.client.names();
    const pending = h.controller.setMode('screen');
    assert.deepEqual(h.client.names(), before, 'unverified screen never sends a mode write');
    assert.equal(await pending, false);
  }
  const h = harness(); await ready(h, { available: true, screenSync: false }); await discovered(h);
  h.controller.toggle(LAMPS[0].id); await reviewed(h);
  assert.equal(await h.controller.setMode('screen'), false, 'review cannot replace the capability gate');
  h.view.caps.screenSync = true;
  const pending = h.controller.setMode('screen');
  assert.deepEqual(h.client.last().args, { mode: 'screen', source: 'screen', ids: [LAMPS[0].id] });
  assert.equal(await modeConfirmed(h,pending,'screen'), true);
});

test('capture diagnostics accept only strict fields and listed reasons, including thrown errors', async () => {
  const h = harness(); await ready(h, { available: true, screenSync: true });
  for (const response of [Object.assign({}, SCREEN_READY, { reason: 'secret-token@secret-host' }),
    Object.assign({}, SCREEN_READY, { reason: ['frames-unverified'] }),
    Object.assign({}, SCREEN_READY, { available: 1 }), Object.assign({}, SCREEN_READY, { sourceFreshness: 'secret-host' })]) {
    assert.equal(typeof h.controller.screenStatus, 'function');
    const pending = h.controller.screenStatus(); h.client.last().resolve(response); await pending;
    assert.equal(h.view.screen.ready, false);
    assert.equal(h.view.screen.reason, 'protocol-error');
    assert.doesNotMatch(JSON.stringify(h.view), /secret-token|secret-host/);
  }
  const pending = h.controller.screenStatus(); h.client.last().reject(Error('secret-token@secret-host')); await pending;
  assert.equal(h.view.screen.reason, 'protocol-error');
  assert.doesNotMatch(JSON.stringify(h.view), /secret-token|secret-host/);
});

test('capture timeout revokes prior readiness and late or closed responses cannot restore it', async () => {
  const h = harness(); await ready(h, { available: true, screenSync: true }); await reviewed(h);
  const pending = h.controller.screenStatus(); const late = h.client.last();
  h.expire(); await pending;
  assert.equal(h.view.screen.ready, false); assert.equal(h.view.screen.reason, 'timeout');
  late.resolve(SCREEN_READY); await flush(); assert.equal(h.view.screen.ready, false);
  const closing = h.controller.screenStatus(); const stale = h.client.last(); h.controller.close();
  stale.resolve(SCREEN_READY); await closing; assert.equal(h.view.screen.ready, false);
  const reopening = h.controller.open(); h.client.last().resolve({ available: true, screenSync: true }); await reopening;
  assert.equal(h.view.screen.ready, false, 'every opening requires a fresh explicit review');
});

test('screen selection and discovery stay frozen until Manual is confirmed', async () => {
  const h = harness(); await ready(h, { available: true, screenSync: true }); await discovered(h);
  h.controller.toggle(LAMPS[0].id); await reviewed(h);
  const active = h.controller.setMode('screen'); await modeConfirmed(h,active,'screen');
  const before = h.client.names(); h.controller.toggle(LAMPS[1].id);
  assert.deepEqual(plain(h.view.selected), [LAMPS[0].id]); assert.match(h.view.message, /Manual/);
  assert.equal(await h.controller.discover(), false); assert.deepEqual(h.client.names(), before);
  assert.equal(h.view.mode, 'screen');
  const stopping = h.controller.setMode('manual'); await modeConfirmed(h,stopping,'manual');
  h.controller.toggle(LAMPS[1].id);
  assert.deepEqual(plain(h.view.selected), [LAMPS[0].id, LAMPS[1].id], 'Manual confirmation unlocks selection');
});

test('screen manual controls preserve screen on failed stop and apply only confirmed result modes', async () => {
  const h = harness(); await ready(h, { available: true, screenSync: true }); await discovered(h);
  h.controller.toggle(LAMPS[0].id); await reviewed(h);
  const active = h.controller.setMode('screen'); await modeConfirmed(h,active,'screen');
  const control = h.controller.power(false); assert.equal(h.view.mode, 'screen');
  h.client.last().reject(Error('stop failed')); await control; assert.equal(h.view.mode, 'screen');
  const manual = h.controller.setMode('manual'); assert.equal(h.view.mode, 'screen');
  h.client.last().reject(Error('restore failed')); assert.equal(await manual, false); assert.equal(h.view.mode, 'screen');
  const timeout = h.controller.setMode('manual'); h.expire(); await timeout;
  assert.ok(h.view.mode === 'screen' || h.view.mode === null, 'timeout never invents Manual');
  h.view.caps.wallpaperSync = true;
  const switching = h.controller.setMode('ambient'); h.expire(); await switching;
  assert.equal(h.view.mode, 'screen', 'an uncertain transition cannot unlock the old screen recipients');
  const confirmed = h.controller.power(false);
  h.client.last().resolve({ mode: 'manual', devices: [LAMPS[0]] }); await confirmed;
  assert.equal(h.view.mode, 'manual');
});

test('a confirmed Manual clears a reviewed active capture and closing screen never sends a stop', async () => {
  const h = harness(); await ready(h, { available: true, screenSync: true }); await discovered(h);
  h.controller.toggle(LAMPS[0].id); await reviewed(h, { active: true });
  assert.equal(h.view.mode, 'screen', 'a verified active backend cannot leave the UI in Manual');
  assert.equal(await h.controller.setMode('screen'), false, 'an active capture is not ready for another start');
  const before = h.client.names(); h.controller.close(); assert.deepEqual(h.client.names(), before);
  const reopening = h.controller.open(); h.client.last().resolve({ available: true, screenSync: true, mode: 'screen' });
  await flush(); h.client.last().resolve({ devices: [LAMPS[0]] }); await reopening;
  await reviewed(h, { active: true }); assert.equal(h.view.screen.active, true);
  const manual = h.controller.setMode('manual'); await modeConfirmed(h,manual,'manual');
  assert.equal(h.view.screen.active, false, 'the screen summary cannot remain Active after confirmed Manual');
});

test('Manual restores backend screen recipients after reopening with no saved selection', async () => {
  const h = harness(); await ready(h, { available: true, mode: 'screen', screenSync: false });
  assert.deepEqual(plain(h.view.selected), []);
  const manual = h.controller.setMode('manual');
  assert.equal(h.client.last().method, 'setMode', 'screen recovery must reach the backend without UI recipients');
  assert.deepEqual(h.client.last().args, { mode: 'manual', source: 'wallpaper', ids: [] });
  assert.equal(h.view.mode, 'screen', 'recovery stays pending until backend restoration is confirmed');
  assert.equal(await modeConfirmed(h,manual,'manual'), true);
  assert.equal(h.view.mode, 'manual'); assert.deepEqual(plain(h.view.selected), []);
  const calls = h.client.names();
  assert.equal(await h.controller.power(true), false);
  assert.equal(await h.controller.setMode('manual'), false, 'ordinary Manual still requires selected lamps');
  assert.deepEqual(h.client.names(), calls);
});

test('rendered Manual stays enabled for pending screen restoration without selected lamps', async () => {
  function node(tag) {
    return { tag, children: [], attributes: {}, style: {}, listeners: {}, disabled: false,
      appendChild(child) { this.children.push(child); child.parentNode = this; },
      setAttribute(key, value) { this.attributes[key] = value; }, getAttribute(key) { return this.attributes[key]; },
      addEventListener(name, fn) { this.listeners[name] = fn; }, removeEventListener() {}, focus() {} };
  }
  const fields = {};
  for (const name of ['lights-list', 'lights-controls', 'lights-close', 'lights-search', 'lights-summary', 'lights-status']) fields[name] = node('div');
  const host = node('section'); host.querySelector = (selector) => fields[selector.slice(1)];
  const sandbox = { window: { localStorage: memory() }, document: { activeElement: null, createElement: node }, Promise, Error, setTimeout, clearTimeout };
  vm.runInNewContext(read('lights-panel.js'), sandbox);
  const client = fakeClient(); const mounted = sandbox.window.LauncherLights.mount({ host, button: node('button'), client });
  const h = { client, controller: mounted.controller, view: mounted.controller.view };
  await ready(h, { available: true, mode: 'screen', screenSync: false });
  const flatten = (n) => [n, ...n.children.flatMap(flatten)];
  const controls = flatten(fields['lights-controls']);
  const modes = controls.filter((n) => n.className === 'lights-chip lights-mode');
  assert.equal(modes[0].disabled, false, 'Manual must remain reachable for backend restoration');
  assert.ok(modes.slice(1).every((n) => n.disabled));
  assert.ok(controls.filter((n) => /^lights-chip lights-(power|level|color|white)$/.test(n.className)).every((n) => n.disabled));
  modes[0].listeners.click(); assert.equal(client.last().method, 'setMode');
  assert.equal(modes[0].disabled, true, 'recovery cannot be submitted again while pending');
  client.last().resolve({ mode: 'manual' }); await flush();
  client.last().resolve(SCREEN_READY); await flush();
  assert.equal(h.view.mode, 'manual'); assert.equal(modes[0].disabled, true);
});

test('creating the controller makes no request; opening asks only for capabilities', async () => {
  const h = harness();
  assert.equal(h.client.calls.length, 0);
  await ready(h);
  assert.deepEqual(h.client.names(), ['capabilities']);
  assert.equal(h.client.calls[0].args, undefined);
  assert.equal(h.view.phase, 'ready');
  assert.deepEqual(plain(h.view.devices), [], 'devices stay empty until discovery');
});

test('a saved living selection is read back with getState for exactly those ids', async () => {
  const h = harness({ storage: memory({ [L.STORAGE_KEY]: JSON.stringify(['a8bb50000001', 'a8bb50000002']) }) });
  const opening = h.controller.open();
  h.client.calls[0].resolve({ available: true, screenSync: false });
  await flush();
  assert.deepEqual(h.client.names(), ['capabilities', 'getState']);
  assert.deepEqual(h.client.last().args, { ids: ['a8bb50000001', 'a8bb50000002'] });
  h.client.last().resolve({ devices: [LAMPS[0]] });
  await opening;
  assert.deepEqual(Array.from(h.view.devices, (d) => d.id), ['a8bb50000001']);
  assert.match(h.view.message, /Una lámpara guardada no respondió/);
  assert.deepEqual(plain(h.view.selected), ['a8bb50000001', 'a8bb50000002'], 'getState alone never drops a saved id');
});

test('unavailable, missing or silent services say so and block every action', async () => {
  const cases = [
    [{ client: null, getter: true }, /no está instalado/],
    [{}, /Sin servicio LAN/, { available: false, screenSync: false, reason: 'Sin servicio LAN' }],
    [{}, /no está disponible/, { available: 'yes' }]
  ];
  for (const [options, reason, caps] of cases) {
    const h = harness(options);
    const opening = h.controller.open();
    if (h.client) h.client.calls[0].resolve(caps);
    await opening;
    assert.equal(h.view.phase, 'unavailable');
    assert.match(h.view.reason, reason);
    const before = h.client ? h.client.calls.length : 0;
    assert.equal(await h.controller.discover(), false);
    assert.equal(await h.controller.power(true), false);
    assert.equal(await h.controller.setMode('manual'), false);
    assert.equal(h.client ? h.client.calls.length : 0, before, 'no request after unavailable');
  }
  const silent = harness();
  const opening = silent.controller.open();
  silent.expire();
  await opening;
  assert.equal(silent.view.phase, 'unavailable');
  assert.match(silent.view.reason, /no respondió a tiempo/);
});

test('discovery selects nothing, drops IPs and prunes saved ids that disappeared', async () => {
  const storage = memory({ [L.STORAGE_KEY]: JSON.stringify(['a8bb50000002', 'gone-lamp']) });
  const h = harness({ storage });
  const opening = h.controller.open();
  h.client.calls[0].resolve({ available: true, screenSync: false });
  await flush();
  h.client.last().resolve({ devices: [] });
  await opening;
  await discovered(h);
  assert.equal(h.client.calls.filter((call) => call.method === 'discover').length, 1);
  assert.equal(h.client.calls.find((call) => call.method === 'discover').args, undefined);
  assert.deepEqual(plain(h.view.selected), ['a8bb50000002'], 'only previously chosen lamps that still exist');
  assert.deepEqual(JSON.parse(storage.data[L.STORAGE_KEY]), ['a8bb50000002']);
  assert.match(h.view.message, /Se encontraron 3 lámparas.*Se quitaron 1/);
  const json = JSON.stringify(h.view);
  for (const lamp of LAMPS) assert.equal(json.includes(lamp.ip), false, 'IP never reaches the view');
  for (const device of h.view.devices) assert.equal('ip' in device, false);

  const fresh = harness();
  await ready(fresh);
  await discovered(fresh);
  assert.deepEqual(plain(fresh.view.selected), [], 'nothing is selected automatically');
  assert.equal(await fresh.controller.power(true), false, 'no selection, no request');
  assert.deepEqual(fresh.client.names(), ['capabilities', 'discover']);
});

test('selection is explicit, stored under its own key and tolerant of broken storage', async () => {
  const storage = memory();
  const h = harness({ storage });
  await ready(h);
  await discovered(h);
  h.controller.toggle('a8bb50000001');
  h.controller.toggle('a8bb50000002');
  h.controller.toggle('a8bb50000002');
  h.controller.toggle('unknown-id');
  assert.deepEqual(JSON.parse(storage.data[L.STORAGE_KEY]), ['a8bb50000001']);
  assert.deepEqual(Object.keys(storage.data), [L.STORAGE_KEY]);
  assert.deepEqual(h.client.names(), ['capabilities', 'discover'], 'toggling never sends anything');

  for (const stored of ['{', '"x"', '[1,"ok-id","ok-id","bad id!"]']) {
    const broken = harness({ storage: memory({ [L.STORAGE_KEY]: stored }) });
    assert.deepEqual(plain(broken.view.selected), stored.startsWith('[') ? ['ok-id'] : []);
  }
  const throwing = { getItem() { throw Error('denied'); }, setItem() { throw Error('full'); } };
  const t = harness({ storage: throwing });
  await ready(t);
  await discovered(t);
  t.controller.toggle('a8bb50000003');
  assert.deepEqual(plain(t.view.selected), ['a8bb50000003'], 'kept in memory');
});

test('commands send exact payloads to the selected group and report partial failures per lamp', async () => {
  const h = harness();
  await ready(h);
  await discovered(h);
  ['a8bb50000001', 'a8bb50000002', 'a8bb50000003'].forEach((id) => h.controller.toggle(id));
  const sent = [];
  const actions = [() => h.controller.power(true), () => h.controller.level(50), () => h.controller.color([45, 115, 255]), () => h.controller.white(2700)];
  for (const action of actions) {
    const pending = action();
    sent.push(h.client.last().args);
    h.client.last().resolve({ devices: [{ id: 'a8bb50000001', state: { on: true, brightness: 50, rgb: [45, 115, 255] } }, { id: 'a8bb50000002', error: 'sin respuesta UDP' }] });
    await pending;
  }
  const ids = ['a8bb50000001', 'a8bb50000002', 'a8bb50000003'];
  assert.deepEqual(sent, [{ ids, on: true }, { ids, brightness: 50 }, { ids, rgb: [45, 115, 255] }, { ids, temperature: 2700 }]);
  const [one, two, three] = h.view.devices;
  assert.equal(one.state.brightness, 50);
  assert.equal(one.note, '');
  assert.equal(two.note, 'Error: sin respuesta UDP');
  assert.equal(three.note, 'Sin confirmación');
  assert.equal(three.state.on, null, 'missing from the answer: unknown, not off');
  assert.equal(h.view.message, 'Confirmadas 1 de 3; 1 con error; 1 sin confirmación.');
});

test('a request in flight blocks the next one; a timeout leaves state unknown and ignores the late answer', async () => {
  const h = harness();
  await ready(h);
  await discovered(h);
  h.controller.toggle('a8bb50000001');
  const first = h.controller.power(false);
  assert.equal(await h.controller.level(10), false, 'busy: second command dropped');
  assert.equal(h.client.calls.filter((call) => call.method === 'setState').length, 1);
  const late = h.client.last();
  h.expire();
  await first;
  assert.equal(h.view.devices[0].state.on, null);
  assert.match(h.view.message, /estado de 1 lámpara es desconocido/);
  late.resolve({ devices: [{ id: 'a8bb50000001', state: { on: false, brightness: 60 } }] });
  await flush();
  assert.equal(h.view.devices[0].state.on, null, 'late answer does not fake a confirmation');
  const next = h.controller.power(true);
  h.client.last().resolve({ devices: [{ id: 'a8bb50000001', state: { on: true, brightness: 60, rgb: null } }] });
  await next;
  assert.equal(h.view.devices[0].state.on, true);
  assert.equal(h.view.message, 'Confirmado en 1 lámpara.');
});

test('modes: manual payload is exact, wallpaper and screen stay off until declared, mode only when confirmed', async () => {
  const h = harness();
  await ready(h, { available: true, screenSync: false, reason: '' });
  await discovered(h);
  h.controller.toggle('a8bb50000002');
  assert.equal(await h.controller.setMode('ambient'), false, 'wallpaperSync not declared');
  assert.equal(await h.controller.setMode('screen'), false, 'screenSync false');
  let pending = h.controller.setMode('manual');
  assert.deepEqual(h.client.last().args, { mode: 'manual', source: 'wallpaper', ids: ['a8bb50000002'] });
  h.client.last().resolve({ mode: 'ambient' });
  await pending;
  assert.equal(h.view.mode, 'manual', 'a different answer cannot replace the local manual mode');
  assert.match(h.view.message, /no confirmó/);

  const w = harness();
  await ready(w, { available: true, screenSync: false, wallpaperSync: true });
  await discovered(w);
  w.controller.toggle('a8bb50000001');
  pending = w.controller.setMode('ambient');
  assert.deepEqual(w.client.last().args, { mode: 'ambient', source: 'wallpaper', ids: ['a8bb50000001'] });
  w.client.last().resolve({ mode: 'ambient' });
  await pending;
  assert.equal(w.view.mode, 'ambient');
});

test('opening restores only a recognized capabilities mode without restarting ambient', async () => {
  for (const mode of ['manual', 'ambient', 'screen', 'unexpected', null, undefined]) {
    const h = harness();
    await ready(h, { available: true, mode, wallpaperSync: true, screenSync: false });
    assert.equal(h.view.mode, ['manual', 'ambient', 'screen'].includes(mode) ? mode : null);
    assert.deepEqual(h.client.names(), ['capabilities']);
    assert.equal(h.client.localStops, 0, 'reading a mode never stops or starts it');
  }
});

test('selection changes stop only local ambient and preserve the explicit group', async () => {
  const h = harness();
  await ready(h, { available: true, mode: 'ambient', wallpaperSync: true }); await discovered(h);
  const before = h.client.names();
  h.controller.toggle('a8bb50000001'); h.controller.toggle('a8bb50000002'); h.controller.toggle('a8bb50000001');
  assert.equal(h.view.mode, 'manual'); assert.equal(h.client.localStops, 3);
  assert.deepEqual(h.client.names(), before, 'selection sends no RPC or physical change');
  assert.deepEqual(plain(h.view.selected), ['a8bb50000002']);
  assert.deepEqual(JSON.parse(h.storage.data[L.STORAGE_KEY]), ['a8bb50000002']);
  h.controller.toggle('unknown'); assert.equal(h.client.localStops, 3);
});

test('a local selection stop invalidates an old mode confirmation without clearing a newer request', async () => {
  const h = harness(); await ready(h, { available: true, mode: 'manual', wallpaperSync: true }); await discovered(h);
  h.controller.toggle('a8bb50000001');
  const old = h.controller.setMode('ambient'); const oldCall = h.client.last();
  h.controller.toggle('a8bb50000002');
  assert.equal(h.view.mode, 'manual'); assert.equal(h.view.busy, '');
  const next = h.controller.setMode('ambient'); const nextCall = h.client.last();
  assert.notEqual(nextCall, oldCall); assert.ok(h.view.busy);
  oldCall.resolve({ mode: 'ambient' }); assert.equal(await old, false);
  assert.equal(h.view.mode, 'manual'); assert.ok(h.view.busy, 'old result cannot clear the new request');
  nextCall.resolve({ mode: 'ambient' }); assert.equal(await next, true);
  assert.equal(h.view.mode, 'ambient');
  assert.deepEqual(nextCall.args.ids, ['a8bb50000001', 'a8bb50000002']);
});

test('manual controls stop locally and immediately show manual even if their RPC fails', async () => {
  const h = harness(); await ready(h, { available: true, mode: 'manual', wallpaperSync: true }); await discovered(h);
  h.controller.toggle('a8bb50000001');
  for (const action of [() => h.controller.power(false), () => h.controller.level(50), () => h.controller.color([1, 2, 3]), () => h.controller.white(2700)]) {
    const starting = h.controller.setMode('ambient'); h.client.last().resolve({ mode: 'ambient' }); await starting;
    const stops = h.client.localStops; const calls = h.client.calls.length;
    const pending = action();
    assert.equal(h.view.mode, 'manual', 'the local engine stopped before the physical result');
    assert.equal(h.client.localStops, stops + 1); assert.equal(h.client.calls.length, calls + 1);
    assert.equal(h.client.last().method, 'setState'); assert.deepEqual(h.client.last().args.ids, ['a8bb50000001']);
    h.client.last().reject(Error('busy')); await pending;
    assert.equal(h.view.mode, 'manual'); assert.match(h.view.message, /busy/);
    assert.deepEqual(plain(h.view.selected), ['a8bb50000001']);
  }
});

test('discovery pruning stops old ambient recipients, while an unchanged group keeps the mode', async () => {
  const h = harness(); await ready(h, { available: true, mode: 'manual', wallpaperSync: true }); await discovered(h);
  h.controller.toggle('a8bb50000001'); h.controller.toggle('a8bb50000002');
  const starting = h.controller.setMode('ambient'); h.client.last().resolve({ mode: 'ambient' }); await starting;
  let stops = h.client.localStops; await discovered(h);
  assert.equal(h.view.mode, 'ambient'); assert.equal(h.client.localStops, stops);
  await discovered(h, [LAMPS[1], LAMPS[2]]);
  assert.equal(h.view.mode, 'manual'); assert.equal(h.client.localStops, stops + 1);
  assert.deepEqual(plain(h.view.selected), ['a8bb50000002']);
});

test('the local stop hook is optional and never required for reading capabilities', async () => {
  const h = harness(); delete h.client.stopAmbient;
  await ready(h, { available: true, mode: 'ambient', wallpaperSync: true }); await discovered(h);
  h.controller.toggle('a8bb50000001'); assert.equal(h.view.mode, 'manual');
  const request = h.controller.power(false); h.client.last().reject(Error('offline')); await request;
  assert.equal(h.view.mode, 'manual'); assert.deepEqual(h.client.names(), ['capabilities', 'discover', 'setState']);
});

test('Manual and failed ambient restarts never retain the old ambient label after local stop', async () => {
  const h = harness(); await ready(h, { available: true, mode: 'manual', wallpaperSync: true }); await discovered(h);
  h.controller.toggle('a8bb50000001');
  for (const mode of ['manual', 'ambient']) {
    const active = h.controller.setMode('ambient'); h.client.last().resolve({ mode: 'ambient' }); await active;
    const stops = h.client.localStops; const pending = h.controller.setMode(mode);
    assert.equal(h.view.mode, 'manual'); assert.equal(h.client.localStops, stops + 1);
    h.client.last().reject(Error('service unavailable')); assert.equal(await pending, false);
    assert.equal(h.view.mode, 'manual'); assert.deepEqual(plain(h.view.selected), ['a8bb50000001']);
  }
  const active = h.controller.setMode('ambient'); h.client.last().resolve({ mode: 'ambient' }); await active;
  const stopping = h.controller.setMode('manual'); h.expire(); assert.equal(await stopping, false);
  assert.equal(h.view.mode, 'manual', 'a backend timeout cannot reactivate the stopped local engine');
  assert.doesNotMatch(h.view.message, /modo actual es desconocido/);
});

test('rendered ambient controls describe only Mi pantalla and a color click returns to manual', async () => {
  function node(tag) {
    return { tag, children: [], attributes: {}, style: {}, listeners: {}, disabled: false,
      appendChild(child) { this.children.push(child); child.parentNode = this; },
      setAttribute(key, value) { this.attributes[key] = value; }, getAttribute(key) { return this.attributes[key]; },
      addEventListener(name, fn) { this.listeners[name] = fn; }, removeEventListener() {}, focus() {} };
  }
  const fields = {};
  for (const name of ['lights-list', 'lights-controls', 'lights-close', 'lights-search', 'lights-summary', 'lights-status']) fields[name] = node('div');
  const host = node('section'); host.querySelector = (selector) => fields[selector.slice(1)];
  const sandbox = { window: { localStorage: memory() }, document: { activeElement: null, createElement: node }, Promise, Error, setTimeout, clearTimeout };
  vm.runInNewContext(read('lights-panel.js'), sandbox);
  const client = fakeClient();
  const mounted = sandbox.window.LauncherLights.mount({ host, button: node('button'), client });
  const h = { client, controller: mounted.controller, view: mounted.controller.view };
  await ready(h, { available: true, mode: 'manual', wallpaperSync: true, screenSync: false });
  const flatten = (n) => [n, ...n.children.flatMap(flatten)];
  const review = flatten(fields['lights-controls']).find((n) => n.className === 'lights-chip lights-screen-review');
  assert.ok(review, 'capture review is rendered'); assert.equal(review.textContent, 'Revisar captura');
  assert.equal(review.disabled, false, 'review does not require lamps');
  assert.equal(review.attributes['aria-pressed'], undefined);
  assert.deepEqual(client.names(), ['capabilities'], 'render and focus do not request capture status');
  review.listeners.click(); assert.equal(client.last().method, 'screenStatus');
  assert.deepEqual(client.last().args, { ids: [] });
  client.last().resolve(Object.assign({}, SCREEN_READY, { configured: false, available: false,
    configVerified: false, framesVerified: false, hardwareVerified: false, ready: false,
    sourceFreshness: 'unknown', reason: 'setup-pending' })); await flush();
  await discovered(h);
  h.controller.toggle('a8bb50000001');
  const pending = h.controller.setMode('ambient'); client.last().resolve({ mode: 'ambient' }); await pending;
  const controls = flatten(fields['lights-controls']);
  const color = controls.find((n) => n.className === 'lights-chip lights-color');
  const whites = controls.filter((n) => n.className === 'lights-chip lights-white');
  const modes = controls.filter((n) => n.className === 'lights-chip lights-mode');
  const note = controls.find((n) => n.className === 'lights-note');
  assert.equal(color.disabled, false); assert.ok(whites.every((n) => !n.disabled));
  assert.equal(modes[2].disabled, true); assert.equal(modes[1].attributes['aria-pressed'], 'true');
  assert.match(note.textContent, /foto de Mi pantalla/); assert.match(note.textContent, /no otras apps ni HDMI/);
  assert.match(note.textContent, /captura pendiente de verificar en esta TV/); assert.doesNotMatch(note.textContent, /esta tele.*no permite/);
  color.listeners.click();
  assert.equal(h.view.mode, 'manual'); assert.equal(modes[0].attributes['aria-pressed'], 'true');
  assert.equal(modes[1].attributes['aria-pressed'], 'false'); assert.equal(client.last().method, 'setState');
  client.last().resolve({ devices: [LAMPS[0]] }); await flush();
});

test('closing invalidates pending answers and reports that the last request was unconfirmed', async () => {
  const h = harness();
  await ready(h);
  await discovered(h);
  h.controller.toggle('a8bb50000001');
  h.controller.power(true);
  const pending = h.client.last();
  assert.equal(h.controller.close(), true, 'a request was still in flight');
  pending.resolve({ devices: [{ id: 'a8bb50000001', state: { on: true, brightness: 100 } }] });
  await flush();
  assert.equal(h.view.devices[0].state.brightness, 60, 'answers after closing are ignored');
  assert.equal(h.controller.close(), false);
});

test('reopening never shows lamp states from a previous opening, even if the service is gone', async () => {
  const h = harness();
  await ready(h);
  await discovered(h);
  h.controller.close();
  const opening = h.controller.open();
  assert.deepEqual(plain(h.view.devices), [], 'cleared before any answer');
  h.client.last().resolve({ available: false, screenSync: false, reason: 'servicio detenido' });
  await opening;
  assert.equal(h.view.phase, 'unavailable');
  assert.deepEqual(plain(h.view.devices), []);
});

test('device data is sanitised: no IP, bounded name, invalid ids and states rejected', () => {
  const device = L.cleanDevice({ id: 'a8bb50000001', name: ' Lámpara\n<b>techo</b> ', ip: '10.0.0.2', mac: 'x', state: { on: 'yes', brightness: 140, rgb: [1, 2, 300] } });
  assert.deepEqual(plain(device), { id: 'a8bb50000001', name: 'Lámpara <b>techo</b>', reachable: true, note: '', state: { on: null, brightness: null, rgb: null, temperature: null } });
  for (const bad of [null, {}, { id: '' }, { id: 'has space' }, { id: 7 }]) assert.equal(L.cleanDevice(bad), null);
});

// ---------- Integración estática con la app ----------
test('lights code avoids features missing from Chromium 68 and forbidden APIs', () => {
  const js = read('lights-panel.js');
  assert.doesNotMatch(js, /\?\.|\?\?|=>|\bclass\s+\w|\blet\s|\bconst\s|`|\basync\b|\bawait\b/);
  assert.doesNotMatch(js, /getImageData|toDataURL|<canvas|innerHTML|insertAdjacentHTML|XMLHttpRequest|fetch\(|WebSocket|\.ip\b/);
  const css = read('lights-panel.css').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const pattern of [/(?<![-\w])gap\s*:/, /(?<![-\w])aspect-ratio\s*:/, /color-mix\(/, /oklch\(/, /@container/, /\binset\s*:/, /\b(?:clamp|min|max)\(/, /:focus-visible/, /:is\(/, /100vh/, /(?<!backdrop-)filter:\s*blur/]) {
    assert.equal(pattern.test(css), false, 'lights-panel.css uses ' + pattern);
  }
});

test('requests come only from clicks: no focus or key handler talks to the client', () => {
  const js = read('lights-panel.js');
  const events = Array.from(js.matchAll(/addEventListener\('(\w+)'/g), (match) => match[1]);
  assert.deepEqual(Array.from(new Set(events)).sort(), ['click', 'focusin', 'keydown']);
  assert.equal(js.split("call('discover'").length - 1, 1, 'a single discovery site');
  assert.equal(js.split('controller.discover()').length - 1, 1, 'discovery only from the Buscar button handler');
  assert.match(js, /function onSearch\(\) \{ controller\.discover\(\); \}/);
  assert.match(js, /search\.addEventListener\('click', onSearch\)/);
  const keys = js.slice(js.indexOf('function moveFocus'), js.indexOf('function openPanel'));
  assert.doesNotMatch(keys, /controller\.(?!close)|client/);
});

test('index.html: Luces beside Solo fondo on the right, panel closed, dock untouched', () => {
  const html = read('index.html');
  const actions = html.slice(html.indexOf('<div class="top-actions">'), html.indexOf('id="weather"'));
  assert.match(actions, /<button id="lights-button"[^>]*\bhidden>/);
  assert.ok(actions.indexOf('id="lights-button"') < actions.indexOf('id="wallpaper-button"'));
  assert.equal(actions.includes('id="edit-button"'), false);
  assert.match(html, /<section id="lights-panel"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*hidden>/);
  assert.ok(html.indexOf('lights-panel.js') < html.indexOf('<script src="app.js">'));
  assert.match(html, /<link rel="stylesheet" href="lights-panel.css">/);
  assert.equal(fs.statSync(path.join(root, 'assets/logos/lights.svg')).isFile(), true);
  const dock = html.slice(html.indexOf('<section class="dock'), html.indexOf('</main>'));
  assert.doesNotMatch(dock, /lights/);
  const sandbox = { window: {} };
  vm.runInNewContext(read('config.js'), sandbox);
  assert.equal(sandbox.window.LAUNCHER_CONFIG.some((item) => /light|luz|wiz/i.test(item.key + item.title)), false);
});

test('app.js mounts the panel only when the module exists and resolves the client lazily', () => {
  const app = read('app.js');
  assert.match(app, /if \(window\.LauncherLights\) \{\s*window\.LauncherLights\.mount\(\{/);
  assert.match(app, /client: function \(\) \{ return window\.LAUNCHER_LIGHTS_CLIENT \|\| null; \}/);
  assert.equal(app.split('LauncherLights.mount(').length - 1, 1);
  const focusCode = app.slice(app.indexOf('function showFocus'), app.indexOf('// ---------- Inicio'));
  assert.doesNotMatch(focusCode, /Lights|lights/);
});
