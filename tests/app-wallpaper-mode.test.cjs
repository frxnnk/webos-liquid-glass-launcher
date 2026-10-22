const {test} = require('node:test');
const assert = require('node:assert/strict');
const {startApp, settle} = require('./helpers/app-dom.cjs');

test('Personalizar at the left of the topbar remains reachable from the dock with the remote', () => {
  const h = startApp();
  const edit = h.document.getElementById('edit-button');
  assert.equal(h.document.querySelector('.top-start').contains(edit), true);
  assert.equal(h.document.querySelector('.top-actions').contains(edit), false);
  h.press('ArrowUp');
  assert.equal(h.document.activeElement, edit);
  h.press('Enter', 13);
  assert.equal(h.document.getElementById('manage-panel').hidden, false);
  assert.equal(h.inventories.length, 1, 'the relocated button opens the real installed-app manager');
});

test('Sólo fondo hides the shell without changing preferences, launching apps or touching lights', async () => {
  const h = startApp();
  const dock = h.dock();
  const button = h.document.getElementById('wallpaper-button');
  button.focus(); button.click();
  await settle();
  assert.equal(h.document.documentElement.classList.contains('is-wallpaper-only'), true);
  assert.equal(h.document.querySelector('.shell').hidden, true);
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  assert.deepEqual(h.dock(), dock);
  assert.equal(h.inventories.length, 0);
  assert.deepEqual(h.launches, []);
  assert.deepEqual(h.lightCalls, []);
  assert.deepEqual(h.writes, []);
});

for (const [key, code] of [['Escape', 27], ['Unidentified', 461], ['Enter', 13], ['ArrowRight', 39]]) {
  test(`${key}/${code} exits Sólo fondo and consumes that first key before app navigation`, () => {
    const h = startApp();
    const button = h.document.getElementById('wallpaper-button');
    button.focus(); button.click();
    const event = h.press(key, code);
    assert.equal(event.defaultPrevented, true);
    assert.equal(h.document.documentElement.classList.contains('is-wallpaper-only'), false);
    assert.equal(h.document.querySelector('.shell').hidden, false);
    assert.equal(button.getAttribute('aria-pressed'), 'false');
    assert.equal(h.document.activeElement, button, 'the first key restores focus rather than moving it or relaunching the mode');
    assert.deepEqual(h.backs, [], 'Back stays inside Mi pantalla');
    assert.deepEqual(h.launches, []);
    assert.equal(h.inventories.length, 0);
    assert.deepEqual(h.lightCalls, []);
    assert.deepEqual(h.writes, []);
  });
}

test('exiting Sólo fondo after a hidden resize restores the dock geometry before focusing distant apps', async () => {
  const h = startApp();
  h.click('edit-button');
  h.inventories[0].resolve([{id:'amazon', title:'Prime Video'}]);
  await settle();
  h.control('app-amazon', 'toggle').click(); h.click('done-button');
  const button = h.document.getElementById('wallpaper-button');
  const grid = h.document.getElementById('apps-grid');
  const saved = h.saved(), writes = h.writes.length;
  button.focus(); button.click();
  grid.clientWidth = 300;
  assert.equal(grid.clientWidth, 0, 'the hidden shell has no layout box');
  h.window.dispatch('resize');
  h.press('Escape', 27);
  assert.equal(grid.clientWidth, 300);
  const last = h.document.querySelector('.tile[data-id="app-amazon"]');
  last.focus();
  const rect = last.getBoundingClientRect();
  assert.ok(rect.left >= 0 && rect.left + rect.width <= grid.clientWidth, 'the restored dock cache reveals the complete distant app');
  assert.deepEqual(h.saved(), saved);
  assert.equal(h.writes.length, writes);
});

test('holding Enter does not immediately exit and repeated Back cannot leak to webOS after exit', () => {
  const h = startApp();
  const button = h.document.getElementById('wallpaper-button');
  button.focus(); h.press('Enter', 13);
  const heldEnter = h.press('Enter', 13, {repeat:true});
  assert.equal(heldEnter.defaultPrevented, true);
  assert.equal(h.document.documentElement.classList.contains('is-wallpaper-only'), true);
  h.document.dispatch('keyup', {key:'Enter', keyCode:13});
  h.press('Escape', 27);
  assert.equal(h.document.documentElement.classList.contains('is-wallpaper-only'), false);
  const heldBack = h.press('Escape', 27, {repeat:true});
  assert.equal(heldBack.defaultPrevented, true);
  assert.deepEqual(h.backs, []);
  h.document.dispatch('keyup', {key:'Escape', keyCode:27});
  h.press('Escape', 27);
  assert.equal(h.backs.length, 1, 'a distinct Back press works normally after release');
});
