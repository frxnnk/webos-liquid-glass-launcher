const {test} = require('node:test');
const assert = require('node:assert/strict');
const {startApp, settle} = require('./helpers/app-dom.cjs');
const prime = 'app-amazon';
const twitch = 'app-tv.twitch.tv.starshot';
const apps = [
  {id:'amazon', title:'Prime Video', folderPath:'/media/cryptofs/apps/usr/palm/applications/amazon', icon:'icon.png'},
  {id:'tv.twitch.tv.starshot', title:'Twitch', folderPath:'/media/cryptofs/apps/usr/palm/applications/tv.twitch.tv.starshot', icon:'icon.png'},
  {id:'youtube.leanback.v4', title:'YouTube'}
];

async function discover(h) {
  h.click('edit-button');
  assert.equal(h.inventories.length, 1, 'opening Personalizar queries the installed-app catalog once');
  h.inventories[0].resolve(apps);
  await settle();
}

test('Personalizar loads installed apps lazily, leaving existing choices and new apps hidden', async () => {
  const h = startApp({saved:[{key:'spotify', visible:true}, {key:'youtube', visible:false}]});
  assert.equal(h.inventories.length, 0, 'startup does not inventory the TV');
  const before = h.dock();
  await discover(h);
  assert.ok(h.control(prime, 'toggle'), 'Prime Video can be added from the real inventory');
  assert.ok(h.control(twitch, 'toggle'), 'Twitch can be added from the real inventory');
  assert.equal(h.control(prime, 'toggle').getAttribute('aria-checked'), 'false');
  assert.equal(h.control('youtube', 'toggle').getAttribute('aria-checked'), 'false');
  assert.deepEqual(h.dock(), before, 'inventory never adds apps to the dock without OK');
  assert.equal(h.saved().find(item => item.key === 'youtube').visible, false);
});

test('adding an installed app and moving it in either direction persist across a cold reload', async () => {
  const h = startApp();
  await discover(h);
  h.control(prime, 'toggle').click();
  assert.ok(h.dock().includes(prime));
  assert.equal(h.saved().find(item => item.key === prime).appId, 'amazon');
  const initial = h.dock();
  h.control(prime, 'later').focus();
  assert.deepEqual(h.launches, [], 'focusing an installed app or control never launches it');
  h.control(prime, 'earlier').click();
  const earlier = h.dock();
  assert.equal(earlier.indexOf(prime), initial.indexOf(prime) - 1);
  h.control(prime, 'later').click();
  assert.deepEqual(h.dock(), initial);
  h.control(prime, 'earlier').click();
  const reopened = startApp({storage:h.storage});
  assert.equal(reopened.inventories.length, 0);
  assert.deepEqual(reopened.dock(), earlier, 'visible installed app and order are usable before a fresh API reply');
  reopened.document.querySelector(`.tile[data-id="${prime}"]`).click();
  assert.deepEqual(reopened.launches, ['amazon'], 'a restored installed app opens its real application ID');
});

test('a reopened Personalizar accepts its own inventory and rejects the earlier request', async () => {
  const h = startApp();
  h.click('edit-button');
  assert.equal(h.inventories.length, 1);
  h.click('done-button');
  h.click('edit-button');
  assert.equal(h.inventories.length, 2);
  h.inventories[1].resolve(apps);
  await settle();
  h.control(prime, 'toggle').click();
  const before = h.saved();
  const focus = h.document.activeElement;
  const writes = h.writes.length;
  h.inventories[0].resolve([]);
  await settle();
  assert.deepEqual(h.saved(), before);
  assert.equal(h.writes.length, writes, 'an old inventory cannot remove the currently chosen apps');
  assert.equal(h.document.activeElement, focus);
  assert.equal(h.control(prime, 'toggle').getAttribute('aria-checked'), 'true');
});

test('closing Personalizar rejects a stale inventory reply without saving or stealing focus', async () => {
  const h = startApp();
  h.click('edit-button');
  assert.equal(h.inventories.length, 1);
  h.click('done-button');
  const focus = h.document.activeElement;
  const writes = h.writes.length;
  h.inventories[0].resolve(apps);
  await settle();
  assert.equal(h.document.getElementById('manage-panel').hidden, true);
  assert.equal(h.document.activeElement, focus);
  assert.equal(h.writes.length, writes, 'closed-panel responses cannot overwrite saved preferences');
  assert.equal(h.control(prime, 'toggle'), null, 'late inventory does not merge after closing');
});

test('a failed inventory preserves cached installed apps and the chosen visible order', async () => {
  const h = startApp();
  await discover(h);
  h.control(prime, 'toggle').click();
  const saved = h.saved();
  h.click('done-button');
  h.click('edit-button');
  assert.equal(h.inventories.length, 2);
  h.inventories[1].reject(new Error('La TV no respondió.'));
  await settle();
  assert.deepEqual(h.saved(), saved, 'an error is never treated as a confirmed empty inventory');
  assert.ok(h.control(prime, 'toggle'));
  assert.equal(h.control(prime, 'toggle').getAttribute('aria-checked'), 'true');
  assert.match(h.document.getElementById('manage-list').textContent, /no respondió|No se pudo|No pudimos/);
});

test('reset restores built-in order while all discovered installed apps remain selectable and hidden', async () => {
  const h = startApp();
  const initial = h.dock();
  await discover(h);
  h.control(prime, 'toggle').click();
  h.control('youtube', 'toggle').click();
  h.control(prime, 'earlier').click();
  h.click('reset-button');
  assert.deepEqual(h.dock(), initial);
  for (const key of [prime, twitch]) {
    assert.ok(h.control(key, 'toggle'), 'reset keeps an installed app in the available catalog');
    assert.equal(h.control(key, 'toggle').getAttribute('aria-checked'), 'false');
  }
});

test('an added app beyond the dock edge becomes visible through TV arrows without focus-time geometry reads', async () => {
  const h = startApp();
  await discover(h);
  h.control(prime, 'toggle').click();
  h.click('done-button');
  const grid = h.document.getElementById('apps-grid');
  // Narrow enough that the added app starts outside the viewport whatever the built-in count.
  grid.clientWidth = 340;
  h.window.dispatch('resize');
  const last = h.document.querySelector(`.tile[data-id="${prime}"]`);
  grid.geometryReads = 0;
  grid.children.forEach(tile => { tile.geometryReads = 0; });
  for (let i = 0; i < grid.children.length && h.document.activeElement !== last; i++) {
    h.document.dispatch('keydown', {key:'ArrowRight', preventDefault() {}});
  }
  assert.equal(h.document.activeElement, last);
  assert.ok(grid.scrollLeft > 0, 'focus reveals the added app outside the initial viewport');
  assert.equal(grid.geometryReads, 0);
  assert.equal(grid.children.reduce((reads, tile) => reads + tile.geometryReads, 0), 0);
  const rect = last.getBoundingClientRect();
  assert.ok(rect.left >= 0 && rect.left + rect.width <= grid.clientWidth);
  assert.equal(last.scrolls.length, 0, 'the TV fast path does not trigger scrollIntoView');
  grid.clientWidth = 300;
  h.window.dispatch('resize');
  const resized = last.getBoundingClientRect();
  assert.ok(resized.left >= 0 && resized.left + resized.width <= grid.clientWidth, 'resize keeps the focused app in view');
});
