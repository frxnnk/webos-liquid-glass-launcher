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
  function dataKey(name) { return name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }
  function node(tag) {
    let text = '';
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
      addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); },
      dispatch(name, event = {}) { (this.listeners[name] || []).forEach(fn => fn(Object.assign({target:this}, event))); },
      click() { if (!this.disabled) this.dispatch('click'); },
      contains(child) { return this === child || this.children.some(n => n.contains(child)); },
      focus() { document.activeElement = this; this.dispatch('focus'); document.dispatch('focusin', {target:this}); },
      scrollIntoView(options) { this.scrolls.push(options); },
      getClientRects() { return isVisible(this) ? [this.getBoundingClientRect()] : []; },
      getBoundingClientRect() {
        this.geometryReads++;
        const left = this.parentNode?.id === 'apps-grid' ? this.parentNode.children.indexOf(this) * 60 - this.parentNode.scrollLeft : 0;
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
      return this.id === 'apps-grid' ? Math.max(this.clientWidth, this.children.length * 60 - 20) : this.clientWidth;
    }});
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
  document = {documentElement:html, body, activeElement:null, listeners:{}, createElement:node,
    addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); },
    dispatch(name, event) { (this.listeners[name] || []).forEach(fn => fn(event)); },
    querySelectorAll(selector) { return html.querySelectorAll(selector); },
    querySelector(selector) { return html.querySelector(selector); },
    getElementById(id) { return flatten(html).find(n => n.id === id) || null; }
  };
  function add(parent, tag, id, className) {
    const result = parent.appendChild(node(tag)); result.id = id; result.className = className || ''; return result;
  }
  const stage = add(body, 'div', '', 'stage');
  add(stage, 'span', '', 'preview-label');
  const top = add(stage, 'div', '', 'top-actions');
  add(top, 'button', 'lights-button'); add(top, 'button', 'edit-button');
  add(top, 'span', 'clock'); add(top, 'span', 'date');
  const dock = add(stage, 'div', '', 'dock');
  add(dock, 'div', 'apps-grid').clientWidth = 400; add(dock, 'span', 'empty-state');
  add(dock, 'span', '', 'dock-divider');
  const inputs = add(dock, 'div', '', 'dock-inputs'); add(inputs, 'div', 'inputs-grid');
  add(stage, 'p', 'status');
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
  const writes = [], inventories = [], launches = [];
  const bridge = {
    isInstalled() { return Promise.resolve(true); },
    listApps() { const request = deferred(); inventories.push(request); return request.promise; },
    launch(id) { launches.push(id); return Promise.resolve(); }
  };
  const window = {PalmSystem:{}, webOS:{}, listeners:{}, createTVBridge() { return bridge; },
    addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); },
    dispatch(name, event) { (this.listeners[name] || []).forEach(fn => fn(event)); }
  };
  const context = {window, document, Promise, Object, Array, Date, console,
    setTimeout() { return 1; }, clearTimeout() {}, setInterval() { return 1; },
    localStorage:{getItem(key) { return stored.get(key) ?? null; }, setItem(key, value) { writes.push([key, value]); stored.set(key, value); }}
  };
  vm.createContext(context);
  for (const file of ['config.js', 'app-catalog.js', 'apps-manager.js', 'dock-scroll.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, {filename:file});
  }
  const click = id => document.getElementById(id).click();
  const control = (key, action) => document.querySelector(`[data-app-key="${key}"][data-app-action="${action}"]`);
  return {document, window, storage:stored, writes, inventories, launches, click, control,
    dock() { return document.getElementById('apps-grid').children.map(n => n.dataset.id); },
    saved() { return JSON.parse(stored.get(storageKey) || 'null'); }
  };
}

async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
module.exports = {startApp, settle};
