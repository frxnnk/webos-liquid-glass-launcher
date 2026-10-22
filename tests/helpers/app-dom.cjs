const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '../..');
const storageKey = 'mi-pantalla-layout-v1';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}

function createDOM() {
  let document;
  function addListener(target, name, fn, options) {
    (target.listeners[name] ||= []).push({fn, capture:options === true || !!options?.capture});
  }
  function dispatch(target, name, supplied = {}) {
    const ancestry = [];
    let parent = target === document ? null : target.parentNode;
    while (parent) { ancestry.push(parent); parent = parent.parentNode; }
    if (target !== document) ancestry.push(document);
    let immediate = false, stopped = false;
    const event = Object.assign({target, defaultPrevented:false, repeat:false}, supplied);
    const suppliedPrevent = event.preventDefault;
    event.preventDefault = function () { this.defaultPrevented = true; if (suppliedPrevent) suppliedPrevent.call(this); };
    event.stopPropagation = function () { stopped = true; };
    event.stopImmediatePropagation = function () { stopped = true; immediate = true; };
    function invoke(current, capture, phase) {
      event.currentTarget = current; event.eventPhase = phase;
      for (const listener of current.listeners[name] || []) {
        if (listener.capture === capture) listener.fn(event);
        if (immediate) break;
      }
    }
    for (const ancestor of ancestry.slice().reverse()) {
      invoke(ancestor, true, 1); if (stopped) return event;
    }
    invoke(target, true, 2);
    if (!immediate) invoke(target, false, 2);
    if (!stopped && name !== 'focus') {
      for (const ancestor of ancestry) { invoke(ancestor, false, 3); if (stopped) break; }
    }
    return event;
  }
  function dataKey(name) { return name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }
  function node(tag) {
    let text = '', fixtureWidth = 40;
    const n = {tagName:tag.toUpperCase(), className:'', children:[], attributes:{}, dataset:{}, listeners:{},
      hidden:false, disabled:false, scrolls:[], scrollLeft:0, clientWidth:40, geometryReads:0,
      style:{setProperty(name, value) { this[name] = value; }},
      appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
      setAttribute(name, value) {
        this.attributes[name] = String(value);
        if (name.startsWith('data-')) this.dataset[dataKey(name)] = String(value);
      },
      getAttribute(name) {
        if (name.startsWith('data-')) return this.dataset[dataKey(name)] ?? null;
        return this.attributes[name] ?? null;
      },
      addEventListener(name, fn, options) { addListener(this, name, fn, options); },
      dispatch(name, event = {}) { return dispatch(this, name, event); },
      click() { if (!this.disabled) this.dispatch('click'); },
      contains(child) { return this === child || this.children.some(n => n.contains(child)); },
      focus() { document.activeElement = this; this.dispatch('focus'); document.dispatch('focusin', {target:this}); },
      scrollIntoView(options) { this.scrolls.push(options); },
      getClientRects() { return isVisible(this) ? [this.getBoundingClientRect()] : []; },
      getBoundingClientRect() {
        this.geometryReads++;
        if (!isVisible(this)) return {left:0, top:0, width:0, height:0};
        let left = this.parentNode?.id === 'apps-grid' ? this.parentNode.children.indexOf(this) * 60 - this.parentNode.scrollLeft : 0;
        if (this.id === 'wallpaper-button') left = 200;
        if (this.id === 'lights-button') left = 300;
        return {left, top:this.classList.contains('tile') ? 100 : 0, width:this.clientWidth, height:40};
      },
      querySelectorAll(selector) { return flatten(this).slice(1).filter(n => matches(n, selector)); },
      querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    };
    n.classList = {
      contains(name) { return n.className.split(/\s+/).includes(name); },
      add(name) { if (!this.contains(name)) n.className = (n.className + ' ' + name).trim(); },
      remove(name) { n.className = n.className.split(/\s+/).filter(c => c !== name).join(' '); },
      toggle(name, force) { const yes = force === undefined ? !this.contains(name) : force; yes ? this.add(name) : this.remove(name); return yes; }
    };
    Object.defineProperty(n, 'textContent', {
      get() { return text + this.children.map(child => child.textContent).join(''); },
      set(value) { text = String(value); this.children.forEach(child => { child.parentNode = null; }); this.children = []; this.scrollLeft = 0; }
    });
    Object.defineProperty(n, 'scrollWidth', {get() {
      if (!isVisible(this)) return 0;
      return this.id === 'apps-grid' ? Math.max(this.clientWidth, this.children.length * 60 - 20) : this.clientWidth;
    }});
    Object.defineProperty(n, 'clientWidth', {get() { return isVisible(this) ? fixtureWidth : 0; }, set(value) { fixtureWidth = value; }});
    return n;
  }
  function flatten(n) { return [n, ...n.children.flatMap(flatten)]; }
  function isVisible(n) { return !n.hidden && (!n.parentNode || isVisible(n.parentNode)); }
  function simple(n, selector) {
    if (selector.includes(':not([disabled])')) {
      if (n.disabled) return false;
      selector = selector.replace(':not([disabled])', '');
    }
    const attrs = [...selector.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)];
    if (!attrs.every(m => n.getAttribute(m[1]) !== null && (m[2] === undefined || n.getAttribute(m[1]) === m[2]))) return false;
    selector = selector.replace(/\[[^\]]+\]/g, '');
    const id = selector.match(/#([\w-]+)/);
    if (id && n.id !== id[1]) return false;
    const classes = [...selector.matchAll(/\.([\w-]+)/g)];
    if (!classes.every(m => n.classList.contains(m[1]))) return false;
    const tag = selector.match(/^[a-z]+/i);
    return !tag || n.tagName.toLowerCase() === tag[0].toLowerCase();
  }
  function matches(n, selector) {
    return selector.split(',').some(part => {
      const chain = part.trim().split(/\s+(?=[.#a-z])/);
      if (!simple(n, chain.pop())) return false;
      let ancestor = n.parentNode;
      while (chain.length) {
        const next = chain.pop();
        while (ancestor && !simple(ancestor, next)) ancestor = ancestor.parentNode;
        if (!ancestor) return false;
        ancestor = ancestor.parentNode;
      }
      return true;
    });
  }
  const html = node('html'), body = html.appendChild(node('body'));
  document = {documentElement:html, body, activeElement:null, hidden:false, listeners:{}, createElement:node,
    addEventListener(name, fn, options) { addListener(this, name, fn, options); },
    dispatch(name, event = {}) { return dispatch(event.target || this.activeElement || this, name, event); },
    querySelectorAll(selector) { return html.querySelectorAll(selector); },
    querySelector(selector) { return html.querySelector(selector); },
    getElementById(id) { return flatten(html).find(n => n.id === id) || null; }
  };
  function add(parent, tag, id, className) {
    const result = parent.appendChild(node(tag)); result.id = id; result.className = className || ''; return result;
  }
  const stage = add(body, 'div', '', 'stage');
  const shell = add(stage, 'div', '', 'shell');
  add(shell, 'span', '', 'preview-label');
  const topbar = add(shell, 'header', '', 'topbar');
  const start = add(topbar, 'div', '', 'top-start');
  add(start, 'button', 'edit-button');
  const top = add(topbar, 'div', '', 'top-actions');
  add(top, 'button', 'wallpaper-button'); add(top, 'button', 'lights-button'); add(top, 'div', 'weather');
  add(top, 'span', 'clock'); add(top, 'span', 'date');
  const dock = add(shell, 'div', '', 'dock');
  add(dock, 'div', 'apps-grid').clientWidth = 400; add(dock, 'span', 'empty-state');
  add(dock, 'span', '', 'dock-divider');
  const inputs = add(dock, 'div', '', 'dock-inputs'); add(inputs, 'div', 'inputs-grid');
  add(shell, 'p', 'status');
  const panel = add(stage, 'section', 'manage-panel'); panel.hidden = true;
  add(panel, 'h2', 'manage-title'); add(panel, 'p', '', 'manage-description');
  add(panel, 'div', 'manage-list', 'manage-list'); add(panel, 'div', 'sources-view');
  add(panel, 'button', 'reset-button'); add(panel, 'button', 'sources-button'); add(panel, 'button', 'done-button');
  return document;
}

function startApp(options = {}) {
  const document = createDOM();
  const stored = options.storage || new Map();
  if (options.saved) stored.set(storageKey, JSON.stringify(options.saved));
  const writes = [], inventories = [], launches = [], backs = [], lightCalls = [];
  const bridge = {
    isInstalled() { return Promise.resolve(true); },
    listApps() { const request = deferred(); inventories.push(request); return request.promise; },
    launch(id) { launches.push(id); return Promise.resolve(); }
  };
  const window = {PalmSystem:{}, webOS:{platformBack() { backs.push(true); }}, listeners:{}, createTVBridge() { return bridge; },
    addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); },
    dispatch(name, event) { (this.listeners[name] || []).forEach(fn => fn(event)); }
  };
  window.LAUNCHER_LIGHTS_CLIENT = {};
  for (const method of ['capabilities', 'getState', 'setMode', 'setColor', 'setPower', 'refreshAmbient']) {
    window.LAUNCHER_LIGHTS_CLIENT[method] = function () { lightCalls.push(method); return Promise.resolve({}); };
  }
  const context = {window, document, Promise, Object, Array, Date, console,
    setTimeout() { return 1; }, clearTimeout() {}, setInterval() { return 1; },
    localStorage:{getItem(key) { return stored.get(key) ?? null; }, setItem(key, value) { writes.push([key, value]); stored.set(key, value); }}
  };
  vm.createContext(context);
  const files = ['config.js', 'app-catalog.js', 'apps-manager.js', 'dock-scroll.js', 'wallpaper-mode.js', 'app.js'];
  for (const file of files) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, {filename:file});
  }
  const click = id => document.getElementById(id).click();
  const control = (key, action) => document.querySelector(`[data-app-key="${key}"][data-app-action="${action}"]`);
  return {document, window, storage:stored, writes, inventories, launches, backs, lightCalls, click, control,
    press(key, keyCode, options = {}) {
      const event = document.dispatch('keydown', Object.assign({key, keyCode}, options));
      if (!event.defaultPrevented && (key === 'Enter' || keyCode === 13) && document.activeElement?.tagName === 'BUTTON') document.activeElement.click();
      return event;
    },
    dock() { return document.getElementById('apps-grid').children.map(n => n.dataset.id); },
    saved() { return JSON.parse(stored.get(storageKey) || 'null'); }
  };
}

async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
module.exports = {startApp, settle};
