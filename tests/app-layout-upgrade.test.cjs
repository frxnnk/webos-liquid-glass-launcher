const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const restore = app.slice(app.indexOf('  try {\n    var stored ='), app.indexOf('  function element('));

function upgrade(saved) {
  const config = {window: {}};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'config.js'), 'utf8'), config);
  vm.runInNewContext(fs.readFileSync(path.join(root, 'app-catalog.js'), 'utf8'), config);
  const context = {items: config.window.LAUNCHER_CONFIG.map(item => Object.assign({}, item, {visible: true})),
    defaults:config.window.LAUNCHER_CONFIG, catalog:config.window.LauncherCatalog,
    storageKey: 'fixture', localStorage: {getItem() { return JSON.stringify(saved); }},
    say(message) { assert.fail(message); }};
  vm.runInNewContext(restore, context);
  return Array.from(context.items, item => ({key: item.key, visible: item.visible}));
}

test('upgrading a saved layout drops removed shortcuts and adds the new ones without changing order or hidden choices', () => {
  const added = ['twitch', 'hbomax', 'flow', 'hdmi2'];
  for (const keys of [
    ['youtube', 'spotify', 'nuvio', 'netflix', 'disney', 'transitions', 'homebrew', 'hdmi1'],
    ['hdmi1', 'transitions', 'nuvio', 'youtube', 'homebrew', 'disney', 'netflix', 'spotify']
  ]) {
    const saved = keys.map(key => ({key, visible: key !== 'netflix'}));
    const updated = upgrade(saved);
    const kept = saved.filter(item => !['nuvio', 'transitions', 'homebrew'].includes(item.key));
    assert.deepEqual(updated.filter(item => keys.includes(item.key)), kept);
    assert.deepEqual(updated.filter(item => !keys.includes(item.key)).map(item => item.key).sort(), added.slice().sort());
    assert.ok(updated.every(item => item.key === 'netflix' || item.visible));
    const hidden = updated.map(item => item.key === 'twitch' ? {key: item.key, visible: false} : item);
    assert.deepEqual(upgrade(hidden), hidden, 'reopening keeps a new shortcut hidden if the user hides it');
  }
});

test('each HDMI shortcut has its own icon with its port number', () => {
  const config = {window: {}};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'config.js'), 'utf8'), config);
  for (const port of ['1', '2']) {
    const item = config.window.LAUNCHER_CONFIG.find(entry => entry.key === 'hdmi' + port);
    assert.equal(item.logo, 'assets/logos/hdmi-' + port + '.svg');
    assert.match(fs.readFileSync(path.join(root, item.logo), 'utf8'), new RegExp('aria-label="HDMI ' + port + '"'));
  }
});
