const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const navigation = source.slice(source.indexOf('  // ---------- Control remoto'), source.indexOf('  function updateClock'));

function harness(onTV, editing = false) {
  const controls = [];
  const events = {};
  const document = {activeElement: null, addEventListener(name, fn) { events[name] = fn; }};
  function query(selector, group) {
    return controls.filter((button) => (!group || button.group === group) && selector.split(',').some((part) => {
      if (button.disabled) return false;
      if (part.includes('.dock') && button.group !== 'dock') return false;
      if (part.includes('.top-actions') && button.group !== 'top') return false;
      return true;
    }));
  }
  document.querySelectorAll = (selector) => query(selector);
  const panel = {querySelectorAll: (selector) => query(selector, 'manager')};
  function button(name, group, x, y, hidden = false) {
    const result = {name, group, hidden, disabled: false, scrolls: 0, visibilityReads: 0,
      classList: {contains: (name) => name === 'tile' && group === 'dock'},
      getClientRects() { this.visibilityReads++; return this.hidden ? [] : [1]; },
      geometryReads: 0,
      getBoundingClientRect() { this.geometryReads++; return {left: x, top: y, width: 40, height: 40}; },
      focus() { document.activeElement = this; }, scrollIntoView() { this.scrolls++; }};
    controls.push(result); return result;
  }
  const one = button('YouTube', 'dock', 0, 100);
  const two = button('Spotify', 'dock', 100, 100);
  const lights = button('Luces', 'top', 0, 0);
  const edit = button('Personalizar', 'top', 100, 0);
  const hidden = button('Control oculto', 'hidden-panel', 50, 100, true);
  const first = button('Visible', 'manager', 0, 0);
  const second = button('Mover', 'manager', 100, 0);
  vm.runInNewContext(navigation, {document, panel, editing, onTV, sourcesOpen:false,
    manager:{handlesNavigation(){return false;}}, window: {}, setEditing() {}});
  function press(key) { events.keydown({key, preventDefault() {}}); }
  return {document, one, two, lights, edit, hidden, first, second, press};
}

test('TV dock arrows focus the next icon without requesting a post-focus scroll', () => {
  const h = harness(true); h.one.focus(); h.press('ArrowRight');
  assert.equal(h.document.activeElement, h.two);
  assert.equal(h.two.scrolls, 0);
});

test('horizontal TV dock navigation never forces layout, skips disabled icons and stops at the edges', () => {
  const h = harness(true); h.one.focus(); h.press('ArrowRight');
  assert.equal(h.document.activeElement, h.two);
  h.press('ArrowRight'); assert.equal(h.document.activeElement, h.two);
  h.press('ArrowLeft'); assert.equal(h.document.activeElement, h.one);
  h.two.disabled = true; h.press('ArrowRight'); assert.equal(h.document.activeElement, h.one);
  assert.equal(h.one.visibilityReads + h.two.visibilityReads + h.one.geometryReads + h.two.geometryReads, 0);
});

test('preview dock and TV manager retain scrolling when moving focus', () => {
  const preview = harness(false); preview.one.focus(); preview.press('ArrowRight');
  assert.equal(preview.document.activeElement, preview.two); assert.equal(preview.two.scrolls, 1);
  const manager = harness(true, true); manager.first.focus(); manager.press('ArrowRight');
  assert.equal(manager.document.activeElement, manager.second); assert.equal(manager.second.scrolls, 1);
});

test('main navigation skips panel controls and keeps Luces and Personalizar reachable', () => {
  const h = harness(true); h.one.focus(); h.press('ArrowUp');
  assert.equal(h.document.activeElement, h.lights);
  h.press('ArrowRight'); assert.equal(h.document.activeElement, h.edit);
  assert.equal(h.hidden.visibilityReads, 0, 'closed panels never enter the main navigation query');
  assert.equal(h.first.visibilityReads, 0, 'manager controls belong only to its own navigation scope');
});

test('focus aura does not write full-screen gradients on TV and stays available in preview', () => {
  const start = source.indexOf('  function setAura(');
  const end = source.indexOf('  // Al enfocar', start);
  function updates(onTV) {
    let changes = 0;
    const auras = Array.from({length: 2}, () => ({style: {set background(value) { changes++; }},
      classList: {toggle() { changes++; }}}));
    const context = {onTV, auras, activeAura: -1};
    vm.runInNewContext(source.slice(start, end), context);
    context.setAura('#ff0000'); return changes;
  }
  assert.equal(updates(true), 0);
  assert.ok(updates(false) > 0);
});
