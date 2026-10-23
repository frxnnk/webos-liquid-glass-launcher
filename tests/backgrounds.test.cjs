const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const context = { window: {}, Math, JSON };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'backgrounds.js'), 'utf8'), context);
const B = context.window.LauncherBackgrounds;

test('only local wallpaper paths (or inlined preview images) are accepted', () => {
  const list = B.cleanList([
    { src: 'assets/wallpapers/a.jpg', author: ' Ana ', source: 'https://www.example.org/photo/1' },
    { src: 'assets/wallpapers/a.jpg' },
    { src: 'assets/wallpapers/b.webp' },
    { src: 'https://example.org/c.jpg' },
    { src: '//example.org/c.jpg' },
    { src: 'assets/wallpapers/../secret.jpg' },
    { src: 'assets/wallpapers/sub/d.jpg' },
    { src: 'assets/wallpapers/e.gif' },
    { src: 'data:image/jpeg;base64,AAAA' },
    null, 7, { src: 3 }
  ]);
  assert.deepEqual(Array.from(list, (entry) => entry.src), ['assets/wallpapers/a.jpg', 'assets/wallpapers/b.webp', 'data:image/jpeg;base64,AAAA']);
  assert.equal(list[0].author, 'Ana');
  assert.deepEqual(Array.from(B.cleanList(undefined)), []);
  assert.deepEqual(Array.from(B.cleanList({ src: 'assets/wallpapers/a.jpg' })), []);
});

test('credits show author and source host', () => {
  assert.equal(B.creditText({ author: 'Ana', source: 'https://www.example.org/photo/1' }), 'Foto: Ana · example.org');
  assert.equal(B.creditText({ author: '', source: 'Archivo propio' }), 'Foto: Archivo propio');
  assert.equal(B.creditText({ author: '', source: '' }), '');
});

function harness(list, failing = [], deferLoads = false, initialList) {
  const state = { now: 0, hidden: false, timers: [], frames: [], events: [], frostChecks: 0, painted: [], shown: [], loads: [], loadOptions: [], pending: [] };
  const storage = { value: null, getItem() { return this.value; }, setItem(key, value) { this.value = value; } };
  const element = () => {
    const classes = new Set();
    return { classList: { toggle(name, on) { if (on) classes.add(name); else classes.delete(name); }, contains(name) { return classes.has(name); } } };
  };
  const layer = () => ({ image: element(), frost: element() });
  state.layers = [layer(), layer()];
  const slideshow = B.createSlideshow({
    layers: state.layers,
    list, initialList,
    fallback: 'assets/wallpaper.svg',
    storage,
    now: () => state.now,
    isHidden: () => state.hidden,
    setTimer: (fn, ms) => { const timer = { fn, ms }; state.timers.push(timer); return timer; },
    clearTimer: (timer) => { state.timers = state.timers.filter((candidate) => candidate !== timer); },
    requestFrame: (fn) => { state.frames.push(fn); },
    load: (image, src, done, options) => {
      image.src = src;
      state.loads.push(src);
      state.loadOptions.push(options);
      if (deferLoads) state.pending.push({ src, done });
      else done(failing.indexOf(src) === -1);
    },
    paint: (frost, image) => { state.painted.push(image.src); state.events.push('paint:' + image.src); return true; },
    frostEnabled: () => { state.frostChecks += 1; return true; },
    layout: () => state.events.push('layout'),
    onShow: (entry) => { state.shown.push(entry.src); state.events.push('show:' + entry.src); }
  });
  state.rotation = () => state.timers.filter((timer) => timer.ms === B.ROTATE_MS);
  state.fire = (timer) => { state.timers = state.timers.filter((item) => item !== timer); timer.fn(); };
  state.runAll = () => { const timers = state.timers; state.timers = []; timers.forEach((timer) => timer.fn()); };
  return { slideshow, state, storage };
}

test('without a list, the SVG fallback is shown once and nothing rotates', () => {
  for (const list of [undefined, [], [{ src: 'https://example.org/x.jpg' }]]) {
    const { slideshow, state } = harness(list);
    slideshow.start();
    assert.deepEqual(state.shown, ['assets/wallpaper.svg']);
    assert.equal(slideshow.isFallback(), true);
    assert.equal(state.timers.length, 0);
  }
});

test('a single photo is shown without a rotation timer', () => {
  const { slideshow, state } = harness([{ src: 'assets/wallpapers/a.jpg' }]);
  slideshow.start();
  assert.deepEqual(state.shown, ['assets/wallpapers/a.jpg']);
  assert.equal(state.timers.length, 0);
});

test('rotates every 2:30 minutes, preloading the next photo after the fade', () => {
  assert.equal(B.ROTATE_MS, 150000);
  const { slideshow, state, storage } = harness([{ src: 'assets/wallpapers/a.jpg' }, { src: 'assets/wallpapers/b.jpg' }, { src: 'assets/wallpapers/c.jpg' }]);
  slideshow.start();
  assert.deepEqual(state.shown, ['assets/wallpapers/a.jpg']);
  assert.equal(state.rotation().length, 1);
  const preload = state.timers.find((timer) => timer.ms < B.ROTATE_MS);
  assert.ok(preload.ms >= B.FADE_MS, 'the outgoing layer is not replaced mid-fade');
  preload.fn();
  assert.deepEqual(state.loads, ['assets/wallpapers/a.jpg', 'assets/wallpapers/b.jpg']);
  state.now += B.ROTATE_MS;
  state.rotation()[0].fn();
  assert.deepEqual(state.shown, ['assets/wallpapers/a.jpg', 'assets/wallpapers/b.jpg']);
  assert.equal(state.loads.length, 2, 'swap used the preloaded layer');
  assert.equal(storage.value, 'assets/wallpapers/b.jpg');
});

test('resumes after the last photo shown in a previous session', () => {
  const { slideshow, state, storage } = harness([{ src: 'assets/wallpapers/a.jpg' }, { src: 'assets/wallpapers/b.jpg' }]);
  storage.value = 'assets/wallpapers/a.jpg';
  slideshow.start();
  assert.deepEqual(state.shown, ['assets/wallpapers/b.jpg']);
});

test('failed photos are skipped; if all fail, the SVG fallback is used', () => {
  const skip = harness([{ src: 'assets/wallpapers/a.jpg' }, { src: 'assets/wallpapers/b.jpg' }], ['assets/wallpapers/a.jpg']);
  skip.slideshow.start();
  assert.deepEqual(skip.state.shown, ['assets/wallpapers/b.jpg']);
  assert.equal(skip.state.timers.length, 0, 'one usable photo left: no rotation');

  const all = harness([{ src: 'assets/wallpapers/a.jpg' }, { src: 'assets/wallpapers/b.jpg' }], ['assets/wallpapers/a.jpg', 'assets/wallpapers/b.jpg']);
  all.slideshow.start();
  assert.deepEqual(all.state.shown, ['assets/wallpaper.svg']);
  assert.equal(all.slideshow.isFallback(), true);
});

test('pauses while hidden and advances on return when the interval elapsed', () => {
  const { slideshow, state } = harness([{ src: 'assets/wallpapers/a.jpg' }, { src: 'assets/wallpapers/b.jpg' }]);
  slideshow.start();
  state.hidden = true;
  slideshow.visibilityChanged();
  assert.equal(state.rotation().length, 0, 'rotation timer cleared while hidden');
  state.now += 60000;
  state.hidden = false;
  slideshow.visibilityChanged();
  assert.equal(state.shown.length, 1, 'not due yet');
  assert.equal(state.rotation().length, 0);
  assert.equal(state.timers.some((timer) => timer.ms === B.ROTATE_MS - 60000), true, 'waits the remaining time');
  state.hidden = true;
  slideshow.visibilityChanged();
  state.now += 10 * 60000;
  state.hidden = false;
  slideshow.visibilityChanged();
  assert.deepEqual(state.shown, ['assets/wallpapers/a.jpg', 'assets/wallpapers/b.jpg']);
});

test('pauses pending preloads while hidden and starts them again on return', () => {
  const { slideshow, state } = harness([{ src: 'assets/wallpapers/a.jpg' }, { src: 'assets/wallpapers/b.jpg' }]);
  slideshow.start();
  const pendingPreload = state.timers.find((timer) => timer.ms < B.ROTATE_MS);
  state.hidden = true;
  slideshow.visibilityChanged();
  assert.equal(state.timers.length, 0, 'both rotation and deferred preload are cancelled');
  pendingPreload.fn(); // A callback already queued at the visibility boundary must also pause.
  assert.deepEqual(state.loads, ['assets/wallpapers/a.jpg']);
  state.hidden = false;
  state.now = 60000;
  slideshow.visibilityChanged();
  const resumedPreload = state.timers.find((timer) => timer.ms < B.FADE_MS + 1000);
  assert.ok(resumedPreload, 'preloading is restored without waiting a full rotation');
  state.fire(resumedPreload);
  assert.deepEqual(state.loads, ['assets/wallpapers/a.jpg', 'assets/wallpapers/b.jpg']);
});

test('keeps the rotation scheduled when returning during an in-flight preload', () => {
  const { slideshow, state } = harness([{ src: 'assets/wallpapers/a.jpg' }, { src: 'assets/wallpapers/b.jpg' }], [], true);
  slideshow.start();
  state.pending.shift().done(true);
  state.now = B.FADE_MS + 200;
  state.fire(state.timers.find((timer) => timer.ms < B.ROTATE_MS));
  state.hidden = true;
  slideshow.visibilityChanged();
  state.hidden = false;
  state.now = 2000;
  slideshow.visibilityChanged();
  state.pending.shift().done(true);
  const rotation = state.timers.find((timer) => timer.ms === B.ROTATE_MS - state.now);
  assert.ok(rotation, 'returning while busy must not lose the only rotation timer');
  state.now = B.ROTATE_MS;
  state.fire(rotation);
  assert.deepEqual(state.shown, ['assets/wallpapers/a.jpg', 'assets/wallpapers/b.jpg']);
  assert.equal(state.loads.length, 2, 'the completed preload is reused');
});

test('a loaded photo is used even if decode() never settles; a broken one fails', () => {
  const timers = [];
  const fake = { window: {}, Math, JSON, setTimeout: (fn, ms) => { const timer = { fn, ms }; timers.push(timer); return timer; }, clearTimeout: (timer) => { const at = timers.indexOf(timer); if (at !== -1) timers.splice(at, 1); } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'backgrounds.js'), 'utf8'), fake);
  const results = [];
  const hanging = { decode: () => new Promise(() => {}) };
  fake.window.LauncherBackgrounds.loadImage(hanging, 'assets/wallpapers/a.jpg', (ok) => results.push(ok));
  hanging.onload();
  assert.equal(timers.length, 1, 'only the short decode wait remains');
  assert.ok(timers[0].ms <= 3000);
  timers.shift().fn();
  const broken = {};
  fake.window.LauncherBackgrounds.loadImage(broken, 'assets/wallpapers/b.jpg', (ok) => results.push(ok));
  broken.onerror();
  assert.deepEqual(results, [true, false]);
});

// ---------- Galería del día (replace) ----------
const remote = (n, extra) => Object.assign({
  src: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/P' + n + '.jpg/1920px-P' + n + '.jpg',
  author: 'Ana', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
  page: 'https://commons.wikimedia.org/wiki/File:P' + n + '.jpg', title: 'P' + n
}, extra);
const LOCAL = [{ src: 'assets/wallpapers/a.jpg', author: 'A' }, { src: 'assets/wallpapers/b.jpg', author: 'B' }];

test('cached metadata starts at the stored photo immediately, without loading a local first', () => {
  for (const last of [remote(2).src, 'assets/wallpapers/a.jpg', null]) {
    const { slideshow, state, storage } = harness(LOCAL, [], true, [remote(1), remote(2)]);
    storage.value = last;
    slideshow.start();
    const expected = last === remote(2).src ? last : remote(1).src;
    assert.deepEqual(state.loads, [expected]);
    assert.equal(state.timers.length, 0, 'no startup fade timer delays the cached request');
    state.pending.shift().done(true);
    assert.deepEqual(state.shown, [expected]);
    assert.equal(slideshow.current().author, 'Ana');
    assert.equal(slideshow.current().provider, 'Wikimedia Commons');
    assert.equal(slideshow.current().license, 'CC BY-SA 4.0');
    assert.equal(slideshow.current().page, last === remote(2).src ? remote(2).page : remote(1).page);
  }
});

test('invalid initial metadata retains the local startup order and allowlist', () => {
  for (const initial of [undefined, [], [remote(1, { author: '' })], [remote(1, { src: 'https://evil.example/x.jpg' })]]) {
    const { slideshow, state, storage } = harness(LOCAL, [], false, initial);
    storage.value = LOCAL[0].src;
    slideshow.start();
    assert.deepEqual(state.loads, [LOCAL[1].src]);
    assert.equal(slideshow.isReplaced(), false);
  }
});

test('the first cached failure returns directly to the credited local base, without trying other remotes', () => {
  const { slideshow, state } = harness(LOCAL, [remote(1).src], false, [remote(1), remote(2)]);
  slideshow.start();
  assert.deepEqual(state.loads, [remote(1).src, LOCAL[0].src]);
  assert.deepEqual(state.shown, [LOCAL[0].src]);
  assert.equal(slideshow.current().author, 'A');
  assert.equal(slideshow.isReplaced(), false);
  assert.equal(slideshow.isFallback(), false);
  const empty = harness([], [remote(1).src], false, [remote(1), remote(2)]);
  empty.slideshow.start();
  assert.deepEqual(empty.state.loads, [remote(1).src, 'assets/wallpaper.svg']);
  assert.equal(empty.slideshow.isFallback(), true);
});

test('only the first visible swap is immediate; preloading and later swaps keep the normal fade', () => {
  const { slideshow, state } = harness(LOCAL);
  slideshow.start();
  assert.equal(state.loadOptions[0].immediate, true);
  for (const [index, layer] of state.layers.entries()) {
    assert.equal(layer.image.classList.contains('is-initial'), index === 0);
    assert.equal(layer.frost.classList.contains('is-initial'), index === 0);
  }
  state.fire(state.timers.find((timer) => timer.ms < B.ROTATE_MS));
  assert.equal(state.loadOptions[1].immediate, false);
  state.now = B.ROTATE_MS;
  state.fire(state.rotation()[0]);
  assert.deepEqual(state.shown, [LOCAL[0].src, LOCAL[1].src]);
  for (const layer of state.layers) {
    assert.equal(layer.image.classList.contains('is-initial'), false);
    assert.equal(layer.frost.classList.contains('is-initial'), false);
  }
});

test('the first photo becomes visible before frost, layout or decode, then paints after a frame and a task', () => {
  const { slideshow, state } = harness(LOCAL);
  const image = state.layers[0].image;
  let decoded;
  image.decode = () => { state.events.push('decode'); return { then(resolve) { decoded = resolve; } }; };
  slideshow.start();
  assert.deepEqual(state.events, ['show:' + LOCAL[0].src]);
  assert.equal(image.classList.contains('is-front'), true);
  assert.equal(state.layers[0].frost.classList.contains('is-front'), false);
  assert.equal(state.frames.length, 1);
  assert.equal(state.frostChecks, 0, 'the initial swap must not read computed styles');
  state.frames.shift()();
  assert.deepEqual(state.events, ['show:' + LOCAL[0].src], 'rAF itself must not block the first paint');
  assert.equal(state.frostChecks, 0, 'style reads also wait until the following task');
  state.fire(state.timers.find((timer) => timer.ms === 0));
  assert.deepEqual(state.events, ['show:' + LOCAL[0].src, 'decode']);
  decoded();
  assert.deepEqual(state.events, ['show:' + LOCAL[0].src, 'decode', 'paint:' + LOCAL[0].src, 'layout']);
  assert.equal(state.layers[0].frost.classList.contains('is-front'), true);
});

test('a hanging or rejecting initial decode never delays the photo or leaves frost waiting forever', () => {
  for (const reject of [false, true]) {
    const { slideshow, state } = harness([LOCAL[0]]);
    let rejected;
    state.layers[0].image.decode = () => ({ then(resolve, failure) { rejected = failure; } });
    slideshow.start();
    assert.deepEqual(state.shown, [LOCAL[0].src]);
    state.frames.shift()();
    state.fire(state.timers.find((timer) => timer.ms === 0));
    const limit = state.timers.find((timer) => timer.ms > 0);
    assert.ok(limit.ms <= 2000);
    if (reject) rejected();
    else state.fire(limit);
    assert.deepEqual(state.painted, [LOCAL[0].src]);
    rejected();
    assert.deepEqual(state.painted, [LOCAL[0].src], 'late decode settlement cannot paint twice');
    assert.equal(state.timers.length, 0);
  }
});

test('initial frost callbacks cannot paint hidden, replaced, rotated or reassigned images', () => {
  for (const boundary of ['frame-hidden', 'task-hidden', 'decode-hidden', 'gallery', 'rotation', 'src', 'image']) {
    const { slideshow, state } = harness(LOCAL);
    let decoded;
    state.layers[0].image.decode = () => ({ then(resolve) { decoded = resolve; } });
    slideshow.start();
    if (boundary === 'frame-hidden') state.hidden = true;
    state.frames.shift()();
    if (boundary === 'frame-hidden') { assert.deepEqual(state.painted, []); continue; }
    if (boundary === 'task-hidden') state.hidden = true;
    state.fire(state.timers.find((timer) => timer.ms === 0));
    if (boundary === 'task-hidden') { assert.deepEqual(state.painted, []); continue; }
    if (boundary === 'decode-hidden') state.hidden = true;
    if (boundary === 'gallery') {
      slideshow.replace([remote(1)]);
      state.fire(state.timers.find((timer) => timer.ms === B.FADE_MS + 200));
    }
    if (boundary === 'rotation') state.fire(state.rotation()[0]);
    if (boundary === 'src') state.layers[0].image.src = LOCAL[1].src;
    if (boundary === 'image') state.layers[0].image = { src: LOCAL[0].src };
    const before = state.events.slice();
    decoded();
    assert.deepEqual(state.events, before, boundary + ' discards the deferred frost work');
  }
});

test('returning from hidden rebuilds initial frost once even with an earlier decode still pending', () => {
  for (const settledHidden of [false, true]) {
    const { slideshow, state } = harness([LOCAL[0]]);
    const callbacks = [];
    state.layers[0].image.decode = () => ({ then(resolve) { callbacks.push(resolve); } });
    slideshow.start(); state.frames.shift()();
    state.fire(state.timers.find(timer => timer.ms === 0));
    state.hidden = true; slideshow.visibilityChanged();
    if (settledHidden) callbacks[0]();
    state.hidden = false; slideshow.visibilityChanged();
    assert.equal(state.frames.length, 1, 'a visible photo must not permanently lose its glass');
    state.frames.shift()(); state.fire(state.timers.find(timer => timer.ms === 0));
    callbacks.forEach(resolve => resolve());
    assert.deepEqual(state.painted, [LOCAL[0].src]);
  }
});

test('normal preloading paints frost before the next photo is swapped', () => {
  const { slideshow, state } = harness(LOCAL);
  slideshow.start();
  assert.deepEqual(state.painted, []);
  state.fire(state.timers.find((timer) => timer.ms === B.FADE_MS + 200));
  assert.deepEqual(state.painted, [LOCAL[1].src]);
  assert.equal(state.layers[1].frostReady, true);
  assert.equal(state.layers[1].frost.classList.contains('is-front'), false);
  state.fire(state.rotation()[0]);
  assert.equal(state.layers[1].frost.classList.contains('is-front'), true);
  assert.equal(state.events.indexOf('paint:' + LOCAL[1].src) < state.events.indexOf('show:' + LOCAL[1].src), true);
});

function loaderHarness() {
  const timers = [];
  const fake = { window: {}, Math, JSON, setTimeout: (fn, ms) => { const timer = { fn, ms }; timers.push(timer); return timer; }, clearTimeout: (timer) => { const at = timers.indexOf(timer); if (at !== -1) timers.splice(at, 1); } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'backgrounds.js'), 'utf8'), fake);
  return { B: fake.window.LauncherBackgrounds, fake, timers };
}

test('an immediate first image finishes on load without waiting for decode', () => {
  const { B: loader, timers } = loaderHarness();
  const results = [];
  let decodes = 0;
  const image = { decode() { decodes += 1; return new Promise(() => {}); } };
  loader.loadImage(image, remote(1).src, (ok) => results.push(ok), { immediate: true });
  image.onload();
  assert.deepEqual(results, [true]);
  assert.equal(decodes, 0);
  assert.equal(timers.length, 0);
});

test('only an immediate remote request has a 1500ms maximum wait and finishes once', () => {
  for (const [src, options, timeout] of [[remote(1).src, { immediate: true }, 1500], [LOCAL[0].src, { immediate: true }, 15000], [remote(1).src, { immediate: false }, 15000]]) {
    const { B: loader, timers } = loaderHarness();
    const results = [];
    const image = {};
    loader.loadImage(image, src, (ok) => results.push(ok), options);
    const lateLoad = image.onload;
    assert.equal(timers[0].ms, timeout);
    timers[0].fn();
    lateLoad();
    assert.deepEqual(results, [false]);
  }
});

test('mount forwards cached metadata before its first image request', () => {
  const { B: mounted, fake } = loaderHarness();
  const image = () => ({ classList: { toggle() {} } });
  const images = [image(), image()];
  fake.window.LAUNCHER_WALLPAPERS = LOCAL;
  fake.window.addEventListener = () => {};
  fake.document = { hidden: false, addEventListener() {} };
  const slideshow = mounted.mount({ images, frosts: [image(), image()], fallback: 'assets/wallpaper.svg', initialList: [remote(1)] });
  assert.equal(images[0].src, remote(1).src);
  images[0].onload();
  assert.equal(slideshow.current().src, remote(1).src);
});

test('a cached startup timeout immediately loads the credited local base and ignores the late remote', () => {
  const { B: mounted, fake, timers } = loaderHarness();
  const image = () => ({ classList: { toggle() {} } });
  const images = [image(), image()];
  const shown = [];
  const credit = {};
  fake.window.LAUNCHER_WALLPAPERS = LOCAL;
  fake.window.addEventListener = () => {};
  fake.document = { hidden: false, addEventListener() {} };
  const slideshow = mounted.mount({ images, frosts: [image(), image()], credit, fallback: 'assets/wallpaper.svg', initialList: [remote(1), remote(2)], onShow: (entry) => shown.push(entry.src) });
  const lateRemote = images[0].onload;
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 1500);
  timers[0].fn();
  assert.equal(images[0].src, LOCAL[0].src, 'the next request is local, without a timer or second remote');
  const localLoaded = images[0].onload;
  lateRemote();
  assert.equal(images[0].onload, localLoaded);
  assert.deepEqual(shown, []);
  localLoaded();
  assert.deepEqual(shown, [LOCAL[0].src]);
  assert.equal(credit.textContent, 'Foto: A');
  assert.equal(credit.hidden, false);
  assert.equal(slideshow.current().author, 'A');
  assert.equal(slideshow.isReplaced(), false);
});

test('remote photos are accepted only explicitly, from Wikimedia hosts, with credits', () => {
  assert.deepEqual(Array.from(B.cleanList([remote(1)])), [], 'wallpapers.js stays local-only');
  const clean = B.cleanList([
    remote(1),
    remote(2, { src: 'https://upload.wikimedia.org.evil.com/wikipedia/commons/a/ab/x.jpg' }),
    remote(3, { src: 'http://upload.wikimedia.org/wikipedia/commons/a/ab/x.jpg' }),
    remote(4, { src: 'https://user@upload.wikimedia.org/wikipedia/commons/a/ab/x.jpg' }),
    remote(5, { src: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/x.png' }),
    remote(6, { author: '' }),
    remote(7, { license: '' }),
    remote(8, { page: 'https://evil.example/wiki/File:P8.jpg' }),
    remote(9, { licenseUrl: 'javascript:alert(1)', src: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/P9.jpg' })
  ], true);
  assert.deepEqual(Array.from(clean, (entry) => entry.title), ['P1', 'P9']);
  assert.equal(clean[1].licenseUrl, '', 'an unsafe licence link is dropped, not shown');
  assert.equal(B.creditText(clean[0]), 'Foto: Ana · Wikimedia Commons · CC BY-SA 4.0');
  const details = Array.from(B.sourceDetails(clean[0]), (pair) => pair.join(': '));
  assert.deepEqual(details, ['Foto: P1', 'Autor: Ana', 'Licencia: CC BY-SA 4.0 · https://creativecommons.org/licenses/by-sa/4.0', 'Origen: Wikimedia Commons · https://commons.wikimedia.org/wiki/File:P1.jpg']);
});

test('replace waits for the first local photo and its fade, then crossfades to the new gallery', () => {
  const { slideshow, state } = harness(LOCAL, [], true);
  slideshow.start();
  assert.equal(slideshow.replace([remote(1), remote(2)]), true);
  assert.deepEqual(state.loads, ['assets/wallpapers/a.jpg'], 'the local photo is not interrupted');
  state.pending.shift().done(true);
  assert.deepEqual(state.shown, ['assets/wallpapers/a.jpg']);
  const apply = state.timers.find((timer) => timer.ms < B.ROTATE_MS);
  assert.ok(apply.ms >= B.FADE_MS, 'the outgoing layer is not replaced mid-fade');
  state.fire(apply);
  assert.equal(state.loads[1], remote(1).src);
  state.pending.shift().done(true);
  assert.deepEqual(state.shown, ['assets/wallpapers/a.jpg', remote(1).src]);
  assert.equal(slideshow.isReplaced(), true);
  assert.equal(state.rotation().length, 1, 'a single rotation timer');
});

test('callbacks from the previous gallery cannot touch the new one', () => {
  const { slideshow, state } = harness(LOCAL, [], true);
  slideshow.start();
  state.pending.shift().done(true); // a a la vista
  state.fire(state.timers.find((timer) => timer.ms < B.ROTATE_MS)); // precarga b (en curso)
  const stale = state.pending.shift();
  assert.equal(stale.src, 'assets/wallpapers/b.jpg');
  slideshow.replace([remote(1), remote(2)]);
  stale.done(true); // llega tarde: debe ignorarse
  stale.done(false);
  state.fire(state.timers.find((timer) => timer.ms < B.ROTATE_MS));
  assert.equal(state.loads[state.loads.length - 1], remote(1).src, 'the busy flag was not left stuck by the stale load');
  state.pending.shift().done(true);
  assert.deepEqual(state.shown, ['assets/wallpapers/a.jpg', remote(1).src]);
  state.fire(state.timers.find((timer) => timer.ms < B.ROTATE_MS));
  state.pending.shift().done(true); // precarga r2
  state.now += B.ROTATE_MS;
  state.fire(state.rotation()[0]);
  assert.deepEqual(state.shown, ['assets/wallpapers/a.jpg', remote(1).src, remote(2).src], 'rotation continues inside the new gallery');
});

test('if no remote photo loads, the local gallery keeps rotating (no SVG, no flash)', () => {
  const { slideshow, state } = harness(LOCAL, [remote(1).src, remote(2).src]);
  slideshow.start();
  state.fire(state.timers.find((timer) => timer.ms < B.ROTATE_MS)); // precarga b
  state.now = 60000;
  slideshow.replace([remote(1), remote(2)]);
  state.fire(state.timers.find((timer) => timer.ms < B.ROTATE_MS));
  assert.deepEqual(state.shown, ['assets/wallpapers/a.jpg'], 'the visible local photo stayed');
  assert.equal(slideshow.isReplaced(), false);
  assert.equal(slideshow.isFallback(), false);
  const rotation = state.rotation().concat(state.timers.filter((timer) => timer.ms === B.ROTATE_MS - 60000));
  assert.equal(rotation.length, 1, 'rotation resumes with the remaining time');
  state.now = B.ROTATE_MS;
  state.fire(rotation[0]);
  assert.equal(state.shown[state.shown.length - 1], 'assets/wallpapers/b.jpg');
});

test('a gallery received while hidden waits for the return and does not advance twice', () => {
  const { slideshow, state } = harness(LOCAL);
  slideshow.start();
  state.hidden = true;
  slideshow.visibilityChanged();
  slideshow.replace([remote(1), remote(2)]);
  assert.equal(state.timers.length, 0, 'nothing runs while hidden');
  assert.deepEqual(state.loads, ['assets/wallpapers/a.jpg']);
  state.now += 10 * 60000;
  state.hidden = false;
  slideshow.visibilityChanged();
  assert.deepEqual(state.shown, ['assets/wallpapers/a.jpg'], 'no extra local advance before the new gallery');
  state.fire(state.timers.find((timer) => timer.ms < B.ROTATE_MS));
  assert.equal(state.shown[state.shown.length - 1], remote(1).src);
});

test('an empty or invalid gallery is ignored', () => {
  const { slideshow, state } = harness(LOCAL);
  slideshow.start();
  const before = state.timers.length;
  for (const list of [undefined, [], [{ src: 'https://example.org/x.jpg' }], [remote(1, { author: '' })]]) {
    assert.equal(slideshow.replace(list), false);
  }
  assert.equal(state.timers.length, before);
  assert.equal(slideshow.isReplaced(), false);
});

test('restoring the visible base after a failed replacement rebuilds its deferred frost once', async () => {
  const { slideshow, state } = harness([LOCAL[0]], [], true);
  let decode;
  state.layers[0].image.decode = () => new Promise((resolve) => { decode = resolve; });
  slideshow.start(); state.pending.shift().done(true);
  state.frames.shift()(); state.fire(state.timers.find((timer) => timer.ms === 0));
  assert.equal(typeof decode, 'function');
  slideshow.replace([remote(1)]);
  state.now = B.FADE_MS + 200;
  state.fire(state.timers.find((timer) => timer.ms === B.FADE_MS + 200));
  state.pending.shift().done(false);
  decode(); await Promise.resolve();
  assert.deepEqual(state.painted, [], 'the superseded decode stays invalid');
  assert.equal(state.frames.length, 1, 'the restored visible base schedules a fresh frost');
  state.frames.shift()(); state.fire(state.timers.find((timer) => timer.ms === 0));
  decode(); await Promise.resolve();
  assert.deepEqual(state.painted, [LOCAL[0].src]);
  assert.equal(state.layers[0].frostReady, true);
  assert.equal(slideshow.isReplaced(), false);
});

test('a stale load timeout does not clear the handlers of a newer load on the same image', () => {
  const timers = [];
  const fake = { window: {}, Math, JSON, setTimeout: (fn, ms) => { const timer = { fn, ms }; timers.push(timer); return timer; }, clearTimeout: (timer) => { const at = timers.indexOf(timer); if (at !== -1) timers.splice(at, 1); } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'backgrounds.js'), 'utf8'), fake);
  const results = [];
  const image = {};
  fake.window.LauncherBackgrounds.loadImage(image, 'assets/wallpapers/a.jpg', (ok) => results.push('a:' + ok));
  fake.window.LauncherBackgrounds.loadImage(image, 'assets/wallpapers/b.jpg', (ok) => results.push('b:' + ok));
  const newer = image.onload;
  timers.shift().fn(); // vence la guarda de la primera carga
  assert.equal(image.onload, newer, 'the newer handlers survive');
  image.onload();
  assert.deepEqual(results, ['a:false', 'b:true']);
});
