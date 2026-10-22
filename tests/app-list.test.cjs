const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {startApp, settle} = require('./helpers/app-dom.cjs');
const dir = path.join(__dirname, '../services/com.frxn.mipantalla.lights');
const createAppList = require(path.join(dir, 'app-list.js'));
const createController = require(path.join(dir, 'controller.js'));
const plain = value => JSON.parse(JSON.stringify(value));
const reply = payload => async () => ({payload});

// execFile falso: responde con la salida de luna-send que se le indique.
function fakeExec(out, error) {
  const calls = [];
  const execFile = (file, args, options, callback) => { calls.push([file, args, options]); setImmediate(() => callback(error || null, out)); };
  execFile.calls = calls;
  return execFile;
}
const answer = payload => JSON.stringify(payload);

test('the service lists apps with a root luna-send, read-only, with only the fields the launcher reads', async () => {
  const exec = fakeExec(answer({returnValue: true, apps: [
    {id: 'amazon', title: 'Prime Video', icon: 'icon.png', folderPath: '/media/cryptofs/apps/usr/palm/applications/amazon',
      requiredPermissions: ['all'], version: '1.2', visible: true, noWindow: false, vendor: 'x'},
    {id: 'com.webos.app.adoverlay', title: 'Ad', visible: false},
    {id: 'com.webos.app.worker', title: 'W', noWindow: true},
    {id: 42, title: 'bad id'}, null, 'text', {title: 'no id'}, {id: 'x'.repeat(200)}
  ]}));
  const result = plain(await createAppList({execFile: exec, iconRoot: null}).list());
  assert.equal(exec.calls.length, 1);
  assert.equal(exec.calls[0][0], '/usr/bin/luna-send');
  assert.deepEqual(exec.calls[0][1], ['-n', '1', 'luna://com.webos.applicationManager/listApps', '{}']);
  assert.equal(exec.calls[0][2].timeout, 9000);
  assert.equal(exec.calls[0][2].env.LD_PRELOAD, '');
  assert.deepEqual(result.apps, [
    {id: 'amazon', title: 'Prime Video', icon: 'icon.png', folderPath: '/media/cryptofs/apps/usr/palm/applications/amazon'},
    {id: 'com.webos.app.adoverlay', title: 'Ad', icon: '', folderPath: '', visible: false},
    {id: 'com.webos.app.worker', title: 'W', icon: '', folderPath: '', noWindow: true}
  ]);
});

test('the listing is bounded and a rejected, malformed or silent TV gives a plain error', async () => {
  const many = Array.from({length: 2000}, (_, i) => ({id: 'app' + i, title: 'A' + i}));
  assert.equal((await createAppList({iconRoot: null, execFile: fakeExec(answer({returnValue: true, apps: many}))}).list()).apps.length, 512);
  for (const out of [answer({returnValue: false, errorText: 'Denied'}), answer({returnValue: true}), answer({returnValue: true, apps: 'no'}), 'not json', '', answer(null)]) {
    await assert.rejects(createAppList({iconRoot: null, execFile: fakeExec(out)}).list(), /La TV no devolvió el catálogo de apps./);
  }
  await assert.rejects(createAppList({iconRoot: null, execFile: fakeExec('', Error('killed'))}).list(), /La TV no respondió al listar las apps./);
});

test('the controller exposes listApps only when the service wired the lister', async () => {
  const wired = createController({}, {apps: {list: async () => ({apps: [{id: 'a'}]})}});
  assert.deepEqual(plain(await wired.listApps()), {apps: [{id: 'a'}]});
  await assert.rejects(createController({}, {}).listApps(), /no está disponible/);
});

test('listApps is a registered service method guarded by the same launcher-only sender check', async () => {
  const handlers = {};
  require(path.join(dir, 'api.js'))({register(name, fn) { handlers[name] = fn; }}, {listApps: async () => ({apps: []})});
  assert.equal(typeof handlers.listApps, 'function');
  const ask = sender => new Promise(resolve => handlers.listApps({sender, payload: {}, respond: resolve}));
  assert.equal((await ask('another.app')).returnValue, false);
  assert.equal((await ask(undefined)).returnValue, false);
  const ok = await ask('com.frxn.mipantalla');
  assert.equal(ok.returnValue, true);
  assert.deepEqual(plain(ok.apps), []);
});

test('the launcher client forwards listApps and returns an empty list outside the TV', async () => {
  const vm = require('node:vm');
  function load(onTV, sdk) {
    const context = {window: {}, Promise, Error, setTimeout, clearTimeout, Object, Array, JSON, Math, Date};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../lights-client.js'), 'utf8'), context);
    return context.window.createLightsClient(sdk, onTV);
  }
  assert.deepEqual(plain(await load(false, {}).listApps()), {apps: []});
  const sent = [];
  const client = load(true, {service: {request(uri, options) { sent.push([uri, options]); return {cancel() {}}; }}});
  const pending = client.listApps();
  assert.equal(sent[0][1].method, 'listApps');
  sent[0][1].onSuccess({returnValue: true, apps: [{id: 'amazon'}]});
  assert.deepEqual(plain((await pending).apps), [{id: 'amazon'}]);
});

const prime = 'app-amazon';
const apps = [
  {id: 'amazon', title: 'Prime Video', folderPath: '/media/cryptofs/apps/usr/palm/applications/amazon', icon: 'icon.png'},
  {id: 'com.palm.app.settings', title: 'Settings', visible: false}
];

test('when the TV denies listApps to the app, Personalizar asks the service and shows the whole catalog', async () => {
  const h = startApp({});
  let asked = 0;
  h.window.LAUNCHER_LIGHTS_CLIENT.listApps = () => { asked++; return Promise.resolve({returnValue: true, apps}); };
  h.click('edit-button');
  h.inventories[0].reject(Error('Denied method call "listApps" for category "/"'));
  await settle();
  assert.equal(asked, 1);
  assert.ok(h.control(prime, 'toggle'), 'an installed app from the service list can be added');
  assert.ok(h.control('app-com.palm.app.settings', 'toggle'), 'the allow-listed LG system app is offered');
  assert.equal(h.control('app-com.palm.app.settings', 'toggle').getAttribute('aria-checked'), 'false');
});

test('a direct answer wins and the service is not asked; two failures keep the selection and report it', async () => {
  const direct = startApp({});
  let asked = 0;
  direct.window.LAUNCHER_LIGHTS_CLIENT.listApps = () => { asked++; return Promise.resolve({apps}); };
  direct.click('edit-button');
  direct.inventories[0].resolve(apps);
  await settle();
  assert.equal(asked, 0);
  assert.ok(direct.control(prime, 'toggle'));

  const failing = startApp({});
  failing.window.LAUNCHER_LIGHTS_CLIENT.listApps = () => Promise.reject(Error('La TV no respondió al listar las apps.'));
  failing.click('edit-button');
  failing.inventories[0].reject(Error('Denied'));
  await settle();
  assert.equal(failing.control(prime, 'toggle'), null);
  assert.match(failing.document.body.textContent || '', /No se pudo actualizar/);

  const none = startApp({});
  delete none.window.LAUNCHER_LIGHTS_CLIENT.listApps;
  none.click('edit-button');
  none.inventories[0].reject(Error('Denied'));
  await settle();
  assert.equal(none.control(prime, 'toggle'), null);
});

// Sistema de archivos mínimo para el copiado de íconos.
function memoryFs(files, extra = {}) {
  const store = new Map(Object.entries(files).map(([name, size]) => [name, {size, text: 'x'.repeat(size), link: false}]));
  const dirs = new Set(extra.dirs || []);
  return {store, dirs,
    existsSync: p => store.has(p) || dirs.has(p),
    mkdirSync: p => { dirs.add(p); },
    lstatSync: p => { const e = store.get(p); if (!e) throw Error('ENOENT'); return {isFile: () => !e.dir, isSymbolicLink: () => e.link, size: e.size}; },
    statSync: p => { const e = store.get(p); if (!e) throw Error('ENOENT'); return {size: e.size}; },
    readFileSync: p => store.get(p).text,
    writeFileSync: (p, data) => { store.set(p, {size: data.length, text: data, link: false}); },
    renameSync: (a, b) => { store.set(b, store.get(a)); store.delete(a); },
    readdirSync: dir => [...store.keys()].filter(k => k.startsWith(dir + '/')).map(k => k.slice(dir.length + 1)),
    unlinkSync: p => { store.delete(p); }};
}
const ROOT = '/app';
const DIR = ROOT + '/assets/app-icons';

test('icons of visible apps are copied into the launcher folder and referenced by a local path', async () => {
  const fs = memoryFs({
    '/media/cryptofs/apps/usr/palm/applications/amazon/aiv_white_80x80.png': 900,
    '/usr/palm/applications/com.webos.app.music/icon.png': 500,
    '/usr/palm/applications/com.webos.app.adoverlay/icon.png': 300,
    [DIR + '/old-app.png']: 10
  }, {dirs: [ROOT]});
  const out = answer({returnValue: true, apps: [
    {id: 'amazon', title: 'Prime Video', icon: 'aiv_white_80x80.png', folderPath: '/media/cryptofs/apps/usr/palm/applications/amazon'},
    {id: 'com.webos.app.music', title: 'Música', icon: '/usr/palm/applications/com.webos.app.music/icon.png'},
    {id: 'com.webos.app.adoverlay', title: 'Ad', icon: 'icon.png', folderPath: '/usr/palm/applications/com.webos.app.adoverlay', visible: false}
  ]});
  const result = plain(await createAppList({execFile: fakeExec(out), fs, iconRoot: ROOT}).list());
  assert.deepEqual(result.apps.map(a => [a.id, a.logo]), [
    ['amazon', 'assets/app-icons/amazon.png'], ['com.webos.app.music', 'assets/app-icons/com.webos.app.music.png'], ['com.webos.app.adoverlay', undefined]]);
  assert.equal(fs.store.get(DIR + '/amazon.png').size, 900);
  assert.equal(fs.store.has(DIR + '/old-app.png'), false, 'icons of apps no longer listed are removed');
  assert.equal(fs.store.has(DIR + '/com.webos.app.adoverlay.png'), false, 'hidden system apps are never copied');
  assert.equal([...fs.store.keys()].some(k => k.endsWith('.tmp')), false);
});

test('an icon already copied with the same size is not written again', async () => {
  const fs = memoryFs({'/usr/palm/applications/airplay/a.png': 400, [DIR + '/airplay.png']: 400}, {dirs: [ROOT, DIR]});
  let writes = 0;
  const base = fs.writeFileSync; fs.writeFileSync = (...args) => { writes++; return base(...args); };
  const out = answer({returnValue: true, apps: [{id: 'airplay', title: 'AirPlay', icon: 'a.png', folderPath: '/usr/palm/applications/airplay'}]});
  const result = plain(await createAppList({execFile: fakeExec(out), fs, iconRoot: ROOT}).list());
  assert.equal(result.apps[0].logo, 'assets/app-icons/airplay.png');
  assert.equal(writes, 0);
});

test('only plain image files below the application roots are ever read', async () => {
  const files = {
    '/etc/passwd.png': 100, '/usr/palm/applications/x/../../../etc/shadow.png': 100, '/usr/palm/applications/ok/icon.png': 100,
    '/usr/palm/applications/big/icon.png': 999999, '/usr/palm/applications/link/icon.png': 100, '/usr/palm/applications/text/readme.txt': 100,
    '/usr/palm/applications/empty/icon.png': 0, '/home/root/secret.png': 100
  };
  const fs = memoryFs(files, {dirs: [ROOT]});
  fs.store.get('/usr/palm/applications/link/icon.png').link = true;
  const entry = (id, icon, folderPath) => ({id, title: id, icon, folderPath});
  const out = answer({returnValue: true, apps: [
    entry('a', '/etc/passwd.png'), entry('b', '../../../etc/shadow.png', '/usr/palm/applications/x'), entry('ok', 'icon.png', '/usr/palm/applications/ok'),
    entry('big', 'icon.png', '/usr/palm/applications/big'), entry('link', 'icon.png', '/usr/palm/applications/link'),
    entry('text', 'readme.txt', '/usr/palm/applications/text'), entry('empty', 'icon.png', '/usr/palm/applications/empty'),
    entry('home', '/home/root/secret.png'), entry('none', '', '/usr/palm/applications/none')
  ]});
  const result = plain(await createAppList({execFile: fakeExec(out), fs, iconRoot: ROOT}).list());
  assert.deepEqual(result.apps.filter(a => a.logo).map(a => a.id), ['ok']);
  assert.deepEqual(fs.readdirSync(DIR), ['ok.png']);
});

test('if the launcher folder is missing the list still works without copying anything', async () => {
  const out = answer({returnValue: true, apps: [{id: 'a', title: 'A', icon: 'icon.png', folderPath: '/usr/palm/applications/a'}]});
  const result = plain(await createAppList({execFile: fakeExec(out), fs: memoryFs({}), iconRoot: '/nowhere'}).list());
  assert.deepEqual(result.apps.map(a => a.logo), [undefined]);
});

test('the catalog trusts only local copied icons and keeps rejecting other paths', () => {
  const vm = require('node:vm');
  const context = {window: {}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app-catalog.js'), 'utf8'), context);
  const catalog = context.window.LauncherCatalog;
  const merged = plain(catalog.merge([], [
    {id: 'amazon', title: 'Prime', logo: 'assets/app-icons/amazon.png', icon: 'icon.png', folderPath: '/usr/palm/applications/amazon'},
    {id: 'evil', title: 'Evil', logo: 'assets/app-icons/../../x.png'},
    {id: 'web', title: 'Web', logo: 'https://example.com/a.png'},
    {id: 'native', title: 'Native', icon: 'icon.png', folderPath: '/usr/palm/applications/native'}
  ]));
  assert.deepEqual(merged.map(item => [item.appId, item.logo]), [
    ['amazon', 'assets/app-icons/amazon.png'], ['evil', 'assets/logos/app.svg'], ['web', 'assets/logos/app.svg'],
    ['native', 'file:///usr/palm/applications/native/icon.png']]);
  const restored = plain(catalog.restore([], plain(catalog.serialize(catalog.merge([], [{id: 'amazon', title: 'Prime', logo: 'assets/app-icons/amazon.png'}])))));
  assert.equal(restored[0].logo, 'assets/app-icons/amazon.png');
});
