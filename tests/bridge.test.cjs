const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function loadBridge(sdk, onTV, timeoutMs = 50) {
  const context = { window: {}, Promise, Error, setTimeout, clearTimeout };
  const file = path.join(__dirname, '..', 'bridge.js');
  vm.runInNewContext(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '', context);
  assert.equal(typeof context.window.createTVBridge, 'function', 'TV bridge must exist');
  return context.window.createTVBridge(sdk, onTV, timeoutMs);
}

test('desktop preview never sends a TV service request', async () => {
  const sdk = { service: { request() { throw Error('must not contact TV'); } } };
  const bridge = loadBridge(sdk, false);
  assert.equal((await bridge.launch('netflix')).preview, true);
  assert.equal(await bridge.isInstalled('netflix'), null);
});

test('launch opens only the supplied app through applicationManager', async () => {
  let sent;
  const sdk = { service: { request(uri, options) {
    sent = { uri, method: options.method, id: options.parameters.id };
    setTimeout(() => options.onSuccess({ returnValue: true }), 1);
    return { cancel() {} };
  } } };
  await loadBridge(sdk, true).launch('space.nuvio.webos');
  assert.deepEqual(sent, { uri: 'luna://com.webos.applicationManager', method: 'launch', id: 'space.nuvio.webos' });
});

test('missing app is false; a denied lookup remains unknown', async () => {
  const sdk = { service: { request(uri, options) {
    if (options.parameters.appId === 'missing') options.onSuccess({ returnValue: true, exist: false });
    else options.onFailure({ errorCode: -1, errorText: 'Denied' });
    return { cancel() {} };
  } } };
  const bridge = loadBridge(sdk, true);
  assert.equal(await bridge.isInstalled('missing'), false);
  assert.equal(await bridge.isInstalled('netflix'), null);
});

test('invalid app IDs cannot create a service request', async () => {
  let count = 0;
  const bridge = loadBridge({ service: { request() { count += 1; } } }, true);
  await assert.rejects(bridge.launch('netflix; rm -rf /'), /identificador/i);
  assert.equal(count, 0);
});

test('failed launches surface the error and do not retry', async () => {
  let count = 0;
  const bridge = loadBridge({ service: { request(uri, options) {
    count += 1;
    options.onFailure({ errorCode: -303, errorText: 'App Signing Error' });
    return {};
  } } }, true);
  await assert.rejects(bridge.launch('netflix'), /App Signing Error/);
  assert.equal(count, 1);
});

test('a timeout cancels the pending request, reports uncertainty, and does not retry', async () => {
  let count = 0;
  let cancelled = false;
  const bridge = loadBridge({ service: { request() {
    count += 1;
    return { cancel() { cancelled = true; } };
  } } }, true, 5);
  await assert.rejects(bridge.launch('netflix'), /confirmar/i);
  assert.equal(count, 1);
  assert.equal(cancelled, true);
});

// contentTarget es el formato que abrió el episodio en la TV real.
test('a YouTube video launch sends the exact contentTarget URL verified on the TV', async () => {
  const sent = [];
  const sdk = { service: { request(uri, options) {
    sent.push({ uri, method: options.method, parameters: JSON.parse(JSON.stringify(options.parameters)) });
    setTimeout(() => options.onSuccess({ returnValue: true }), 1);
    return { cancel() {} };
  } } };
  const bridge = loadBridge(sdk, true);
  await bridge.launchYouTubeVideo('2TcoICioKpM');
  await bridge.launchYouTubeVideo('2TcoICioKpM');
  assert.equal(sent.length, 2);
  for (const request of sent) {
    assert.equal(request.uri, 'luna://com.webos.applicationManager');
    assert.equal(request.method, 'launch');
    assert.deepEqual(Object.keys(request.parameters), ['id', 'params']);
    assert.equal(request.parameters.id, 'youtube.leanback.v4');
    assert.deepEqual(request.parameters.params, { contentTarget: 'https://www.youtube.com/watch?v=2TcoICioKpM' });
  }
});

test('video IDs that are not 11 safe characters never reach the TV', async () => {
  let count = 0;
  const bridge = loadBridge({ service: { request() { count += 1; return {}; } } }, true);
  for (const id of ['', 'short', '2TcoICioKpM&t=99', 'https://www.youtube.com/watch?v=2TcoICioKpM', '2TcoICioKp/', null, 11]) {
    await assert.rejects(bridge.launchYouTubeVideo(id), /video válido/);
  }
  assert.equal(count, 0);
});

test('the desktop preview never sends the YouTube launch', async () => {
  const bridge = loadBridge({ service: { request() { throw Error('must not contact TV'); } } }, false);
  assert.equal((await bridge.launchYouTubeVideo('2TcoICioKpM')).preview, true);
});

test('a YouTube launch that times out is cancelled once and not retried', async () => {
  let count = 0;
  let cancelled = 0;
  const bridge = loadBridge({ service: { request() {
    count += 1;
    return { cancel() { cancelled += 1; } };
  } } }, true, 5);
  await assert.rejects(bridge.launchYouTubeVideo('2TcoICioKpM'), /confirmar/i);
  assert.equal(count, 1);
  assert.equal(cancelled, 1);
});

test('installed app discovery returns only a confirmed array and never contacts the TV in preview', async () => {
  let calls = 0;
  const sdk = {service:{request(uri,options) {
    calls += 1;
    assert.equal(uri,'luna://com.webos.applicationManager');
    assert.equal(options.method,'listApps');
    assert.deepEqual(JSON.parse(JSON.stringify(options.parameters)),{});
    options.onSuccess({returnValue:true,apps:[{id:'netflix',title:'Netflix'}]});
    return {};
  }}};
  assert.deepEqual(JSON.parse(JSON.stringify(await loadBridge(sdk,false).listApps())),[]);
  assert.equal(calls,0);
  assert.equal((await loadBridge(sdk,true).listApps())[0].id,'netflix');
  assert.equal(calls,1);
});

test('empty app inventory is distinct from malformed responses and service denial', async () => {
  const make = response => loadBridge({service:{request(uri,options) {options.onSuccess(response);return {};}}},true);
  assert.deepEqual(JSON.parse(JSON.stringify(await make({returnValue:true,apps:[]}).listApps())),[]);
  for (const response of [null,{}, {returnValue:true}, {returnValue:true,apps:{}}, {returnValue:false,errorText:'Denied'}]) {
    await assert.rejects(make(response).listApps(), /catálogo|Denied|respuesta/i);
  }
});

test('inventory timeout cancels once and a late response cannot replace the failure', async () => {
  let options, cancellations = 0;
  const bridge = loadBridge({service:{request(uri,args) {options=args;return {cancel(){cancellations += 1;}};}}},true,5);
  await assert.rejects(bridge.listApps(),/confirmar/i);
  options.onSuccess({returnValue:true,apps:[]});
  assert.equal(cancellations,1);
});

test('inventory timeout still rejects when the SDK cancellation throws', async () => {
  const bridge = loadBridge({service:{request() {return {cancel(){throw new Error('SDK cancel failed');}};}}},true,5);
  await assert.rejects(bridge.listApps(),/confirmar/i);
});
