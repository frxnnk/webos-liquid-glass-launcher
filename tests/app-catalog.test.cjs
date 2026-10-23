const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function load() {
  const context = { window: {} };
  const file = path.join(__dirname, '..', 'app-catalog.js');
  vm.runInNewContext(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '', context);
  assert.ok(context.window.LauncherCatalog, 'catalog module must exist');
  return context.window.LauncherCatalog;
}
function plain(value) { return JSON.parse(JSON.stringify(value)); }
function defaults() { return [
  { key:'youtube', appId:'youtube.leanback.v4', title:'YouTube', logo:'assets/logos/youtube.svg', color:'#ff0000', kind:'app' },
  { key:'transitions', appId:'youtube.leanback.v4', title:'Transitions', action:'transitions', logo:'assets/logos/transitions.svg', kind:'app' },
  { key:'hdmi1', appId:'com.webos.app.hdmi1', title:'HDMI 1', logo:'assets/logos/hdmi.svg', kind:'input' }
]; }
function app(id, title = id, icon = '/usr/palm/applications/' + id + '/icon.png') { return { id, title, icon }; }

test('legacy selection and order survive while special defaults remain', () => {
  const catalog = load();
  const items = catalog.restore(defaults(), [{key:'hdmi1',visible:true},{key:'youtube',visible:false},{key:'youtube',visible:true}]);
  assert.deepEqual(plain(items.map(item => [item.key,item.visible])), [['hdmi1',true],['youtube',false],['transitions',true]]);
  assert.equal(defaults()[0].visible, undefined);
});

test('successful discovery adds every valid installed app hidden and deduplicates default IDs', () => {
  const catalog = load();
  const items = catalog.merge(catalog.restore(defaults(), null), [app('netflix','Netflix'),app('youtube.leanback.v4'),app('netflix'),app('com.webos.app.hdmi1'),app('system.tool','System tool')]);
  assert.deepEqual(plain(items.map(item => item.key)), ['youtube','transitions','hdmi1','app-netflix','app-system.tool']);
  assert.equal(items[3].visible, false);
  assert.equal(items[3].logo, 'file:///usr/palm/applications/netflix/icon.png');
  assert.equal(items[3].catalogApp, true);
  assert.equal(items[1].action,'transitions');
});

test('a refreshed catalog preserves selected order and updates titles without mutating the prior state', () => {
  const catalog = load();
  let items = catalog.merge(catalog.restore(defaults(), null), [app('netflix','Before'),app('spotify','Spotify')]);
  items[3].visible = true;
  items = catalog.move(items,'app-netflix',-1);
  const before = plain(items);
  const refreshed = catalog.merge(items, [app('netflix','After'),app('spotify','Spotify')]);
  assert.deepEqual(plain(refreshed.map(item => item.key)), before.map(item => item.key));
  assert.equal(refreshed.find(item => item.appId === 'netflix').visible,true);
  assert.equal(refreshed.find(item => item.appId === 'netflix').title,'After');
  assert.deepEqual(plain(items),before);
});

test('extra app metadata restores without a live inventory and old defaults stay compact in storage', () => {
  const catalog = load();
  const items = catalog.merge(catalog.restore(defaults(), null), [app('netflix','Netflix')]);
  items[3].visible = true;
  const saved = plain(catalog.serialize(items));
  assert.deepEqual(saved[0],{key:'youtube',visible:true});
  assert.equal(saved[3].appId,'netflix');
  const restored = catalog.restore(defaults(), saved);
  assert.equal(restored[3].title,'Netflix');
  assert.equal(restored[3].visible,true);
  assert.equal(restored[3].catalogApp,true);
});

test('an authoritative empty catalog removes stale extras but never removes defaults', () => {
  const catalog = load();
  const before = catalog.merge(catalog.restore(defaults(), null), [app('netflix')]);
  assert.equal(catalog.merge(before, []).length, 3);
  assert.equal(before.length,4);
});

test('IDs, cache keys, labels and icon URLs are validated before data reaches the UI', () => {
  const catalog = load();
  const entries = [app('bad/id'),app('ok', '<b>Nice</b>\u0000 TV'),app('__proto__'),app('a'.repeat(129)),null,app('remote','Remote','https://evil.test/x.svg'),app('traversal','X','file:///usr/palm/applications/../secrets/icon.png'),app('encoded','X','file:///usr/palm/applications/x/%2e%2e/key.png'),app('query','X','/usr/palm/applications/x/icon.png?url=https://evil.test')];
  const items = catalog.merge(catalog.restore([], null), entries);
  assert.deepEqual(plain(items.map(item => item.appId)), ['ok','remote','traversal','encoded','query']);
  assert.equal(items[0].title,'Nice TV');
  items.slice(1).forEach(item => assert.equal(item.logo,'assets/logos/app.svg'));
  const restored = catalog.restore([], [{key:'app-forged',appId:'other',title:'Other',visible:true}, {key:'app-good',appId:'good',title:'x'.repeat(999),logo:'javascript:alert(1)'}]);
  assert.equal(restored.length,1);
  assert.equal(restored[0].title.length,160);
  assert.equal(restored[0].logo,'assets/logos/app.svg');
});

test('only native application icon roots and image extensions are allowed', () => {
  const catalog = load();
  const roots = ['/usr/palm/applications/x/icon.png','/media/developer/apps/usr/palm/applications/x/icon.svg','/media/cryptofs/apps/usr/palm/applications/x/icon.webp'];
  const items = catalog.merge([], roots.map((root,index) => app('test'+index,'Test',root)));
  assert.deepEqual(plain(items.map(item => item.logo)), roots.map(root => 'file://' + root));
  const invalid = catalog.merge([], [app('html','Test','/usr/palm/applications/x/index.html'),app('wrong','Test','file:///etc/passwd')]);
  invalid.forEach(item => assert.equal(item.logo,'assets/logos/app.svg'));
});

test('move earlier and later operates only within a kind and returns a new array', () => {
  const catalog = load();
  const items = catalog.restore(defaults(),null);
  const moved = catalog.move(items,'transitions',-1);
  assert.deepEqual(plain(moved.map(item => item.key)), ['transitions','youtube','hdmi1']);
  assert.deepEqual(plain(catalog.move(moved,'transitions',1).map(item => item.key)), ['youtube','transitions','hdmi1']);
  assert.deepEqual(plain(catalog.move(items,'hdmi1',-1).map(item => item.key)), ['youtube','transitions','hdmi1']);
  assert.deepEqual(plain(items.map(item => item.key)), ['youtube','transitions','hdmi1']);
});

test('malformed cached entries are ignored and discovery/cache are bounded', () => {
  const catalog = load();
  const items = catalog.merge([], Array.from({length:600}, (_,index) => app('extra'+index)));
  assert.equal(items.length,512);
  assert.equal(catalog.serialize(items).length,512);
  assert.equal(catalog.restore([], [null,{},'x',{key:'app-unsafe',appId:'unsafe',title:{}}]).length,0);
});

test('real webOS relative icons resolve below application folders and internal workers stay excluded', () => {
  const catalog = load();
  const items = catalog.merge(catalog.restore(defaults(), null), [
    { id:'amazon', title:'Prime Video', icon:'aiv_white_80x80.png', folderPath:'/media/cryptofs/apps/usr/palm/applications/amazon', visible:true, removable:true, type:'native' },
    { id:'hidden.worker', title:'Worker', icon:'icon.png', folderPath:'/usr/palm/applications/hidden.worker', visible:false },
    { id:'windowless.worker', title:'Worker', visible:true, noWindow:true },
    { id:'legacy.visible', title:'Other supported format' }
  ]);
  assert.deepEqual(plain(items.slice(3).map(item => item.appId)), ['amazon','legacy.visible']);
  assert.equal(items[3].logo,'file:///media/cryptofs/apps/usr/palm/applications/amazon/aiv_white_80x80.png');
  assert.equal(items[2].key,'hdmi1');
});

test('visible ordering skips hidden apps and cached injected launch metadata cannot become an action', () => {
  const catalog = load();
  const items = catalog.restore(defaults(), [
    {key:'youtube', visible:true},
    {key:'app-hidden',appId:'hidden',title:'Hidden',visible:false},
    {key:'transitions',visible:true},
    {key:'hdmi1',visible:true},
    {key:'app-netflix',appId:'netflix',title:'Netflix',action:'transitions',kind:'input',color:'url(evil)',visible:true}
  ]);
  const moved = catalog.move(items,'transitions',-1);
  assert.deepEqual(plain(moved.filter(item => item.visible && item.kind === 'app').map(item => item.key)), ['transitions','youtube','app-netflix']);
  assert.equal(items[4].action,undefined);
  assert.equal(items[4].kind,'app');
  assert.equal(items[4].color,'#a8b5ce');
  assert.deepEqual(plain(catalog.move(items,'app-hidden',1)),plain(items));
});

test('oversized native paths cannot expand persisted catalog metadata without a bound', () => {
  const catalog = load();
  const items = catalog.merge([], [app('oversized','Large','/usr/palm/applications/oversized/' + 'x'.repeat(2000) + '.png')]);
  assert.equal(items[0].logo,'assets/logos/app.svg');
  assert.ok(JSON.stringify(catalog.serialize(items)).length < 512);
});

test('useful LG system apps hidden by LG are offered, renamed and kept out of the home until added', () => {
  const catalog = load();
  const hidden = id => ({ id, title: id, visible: false, icon: '/usr/palm/applications/' + id + '/icon.png' });
  const items = plain(catalog.merge(catalog.restore(defaults(), null), [
    hidden('com.palm.app.settings'), hidden('com.webos.app.livetv'), hidden('com.webos.app.home'), hidden('com.webos.app.hdmi2'),
    hidden('com.webos.app.hdmi3'), hidden('com.webos.app.adoverlay'), hidden('com.webos.app.factorywin'),
    hidden('com.webos.app.softwareupdate'), hidden('com.webos.app.installation'), hidden('com.webos.app.hdmi4'), hidden('constructor')
  ]));
  const added = items.filter(item => item.catalogApp);
  assert.deepEqual(added.map(item => [item.appId, item.title, item.kind, item.visible, item.tagline]), [
    ['com.palm.app.settings', 'Configuración', 'app', false, 'Sistema de LG'],
    ['com.webos.app.livetv', 'TV en vivo', 'app', false, 'Sistema de LG'],
    ['com.webos.app.home', 'Home de LG', 'app', false, 'Sistema de LG'],
    ['com.webos.app.hdmi2', 'HDMI 2', 'input', false, 'Sistema de LG']
  ]);
});

test('a hidden system app that is not on the list, and any noWindow app, stay excluded; the TV title never overrides ours', () => {
  const catalog = load();
  const items = plain(catalog.merge(catalog.restore(defaults(), null), [
    { id: 'com.webos.app.livetv', title: 'ANUNCIO <b>x</b>', visible: false, noWindow: true },
    { id: 'com.palm.app.settings', title: '<img src=x onerror=alert(1)>', visible: false },
    { id: 'com.webos.app.acroverlay', title: 'LivePlus', visible: false }
  ]));
  assert.deepEqual(items.filter(item => item.catalogApp).map(item => item.title), ['Configuración']);
});

test('stored system apps keep their kind and name across a restart without a live inventory', () => {
  const catalog = load();
  const merged = catalog.merge(catalog.restore(defaults(), null), [{ id: 'com.webos.app.hdmi2', title: 'HDMI2', visible: false }]);
  merged.find(item => item.appId === 'com.webos.app.hdmi2').visible = true;
  const restored = plain(catalog.restore(defaults(), plain(catalog.serialize(merged))));
  const hdmi2 = restored.find(item => item.appId === 'com.webos.app.hdmi2');
  assert.deepEqual([hdmi2.kind, hdmi2.visible, hdmi2.title], ['input', true, 'HDMI 2']);
});

test('apps marked tvIcon use the icon the TV declares and keep the bundled logo as fallback', () => {
  const catalog = load();
  const base = [
    { key:'disney', appId:'com.disney.disneyplus-prod', title:'Disney+', logo:'assets/logos/disney.svg', kind:'app', tvIcon:true },
    { key:'netflix', appId:'netflix', title:'Netflix', logo:'assets/logos/netflix.svg', kind:'app' }
  ];
  const restored = catalog.restore(base, null);
  assert.equal(restored[0].logo, 'assets/logos/disney.svg', 'without an inventory the bundled logo is shown');
  assert.equal(restored[0].fallbackLogo, 'assets/logos/disney.svg');
  const inventory = [
    { id:'com.disney.disneyplus-prod', title:'Disney+', logo:'assets/app-icons/com.disney.disneyplus-prod.png' },
    { id:'netflix', title:'Netflix', logo:'assets/app-icons/netflix.png' }
  ];
  const updated = catalog.tvIcons(restored, inventory);
  assert.equal(updated[0].logo, 'assets/app-icons/com.disney.disneyplus-prod.png');
  assert.equal(updated[1].logo, 'assets/logos/netflix.svg', 'only tvIcon apps change');
  assert.equal(restored[0].logo, 'assets/logos/disney.svg', 'tvIcons does not mutate its input');
  assert.equal(catalog.merge(restored, inventory)[0].logo, 'assets/app-icons/com.disney.disneyplus-prod.png', 'Personalizar refresh applies it too');
  for (const logo of ['/usr/palm/applications/x/icon.png', 'assets/app-icons/../../x.png', 'file:///etc/passwd', undefined]) {
    assert.equal(catalog.tvIcons(restored, [{ id:'com.disney.disneyplus-prod', title:'Disney+', logo }])[0].logo, 'assets/logos/disney.svg', String(logo));
  }
  const saved = plain(catalog.serialize(updated));
  assert.deepEqual(saved[0], { key:'disney', visible:true, logo:'assets/app-icons/com.disney.disneyplus-prod.png' });
  assert.deepEqual(saved[1], { key:'netflix', visible:true });
  const again = catalog.restore(base, saved);
  assert.equal(again[0].logo, 'assets/app-icons/com.disney.disneyplus-prod.png', 'the TV icon survives a restart');
  assert.equal(again[0].fallbackLogo, 'assets/logos/disney.svg');
  const forged = catalog.restore(base, [{ key:'disney', visible:true, logo:'file:///etc/passwd' }, { key:'netflix', visible:true, logo:'assets/app-icons/x.png' }]);
  assert.equal(forged[0].logo, 'assets/logos/disney.svg');
  assert.equal(forged[1].logo, 'assets/logos/netflix.svg', 'stored logos are ignored for apps without tvIcon');
});

test('config: Disney+ and Flow use the TV icon; the built-in logos come from the redesign', () => {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'config.js'), 'utf8'), sandbox);
  const config = sandbox.window.LAUNCHER_CONFIG;
  assert.deepEqual(plain(config.filter(item => item.tvIcon).map(item => item.key)), ['disney', 'flow']);
  // The redesign logos are full tiles: a 120×120 rounded background (rx 26) under the mark.
  for (const item of config) {
    assert.match(fs.readFileSync(path.join(__dirname, '..', item.logo), 'utf8'), /<rect width="120" height="120" rx="26"/, item.key);
  }
});
