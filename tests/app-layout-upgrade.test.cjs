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

test('upgrading a saved seven-icon layout adds Homebrew without changing order or hidden choices', () => {
  for (const keys of [
    ['youtube', 'spotify', 'nuvio', 'netflix', 'disney', 'transitions', 'hdmi1'],
    ['hdmi1', 'transitions', 'nuvio', 'youtube', 'disney', 'netflix', 'spotify']
  ]) {
    const saved = keys.map(key => ({key, visible: key !== 'netflix' && key !== 'nuvio'}));
    const updated = upgrade(saved);
    assert.deepEqual(updated.filter(item => keys.includes(item.key)), saved);
    assert.deepEqual(updated.filter(item => !keys.includes(item.key)), [{key: 'homebrew', visible: true}]);
    const hidden = updated.map(item => item.key === 'homebrew' ? {key: item.key, visible: false} : item);
    assert.deepEqual(upgrade(hidden), hidden, 'reopening keeps the new shortcut hidden if the user hides it');
  }
});
