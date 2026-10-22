const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const file = path.join(__dirname, '../apps-manager.js');

function harness(callbacks = {}) {
  let document;
  function node(tag) {
    let value = '';
    const n = {tagName:tag.toUpperCase(),className:'',children:[],attributes:{},listeners:{},disabled:false,hidden:false,style:{},scrolls:[],
      appendChild(child) { this.children.push(child);child.parentNode = this;return child; },
      setAttribute(key,value) { this.attributes[key] = String(value); },
      getAttribute(key) { return this.attributes[key] === undefined ? null : this.attributes[key]; },
      addEventListener(name,fn) { this.listeners[name] = fn; },
      contains(child) { return this === child || this.children.some(n => n.contains(child)); },
      focus() { document.activeElement = this;if(this.listeners.focus)this.listeners.focus({target:this}); },
      scrollIntoView(options) { this.scrolls.push(options); },
      querySelectorAll(selector) { return flatten(this).slice(1).filter(n => matches(n,selector)); },
      querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    };
    Object.defineProperty(n,'textContent',{get(){return value + this.children.map(n=>n.textContent).join('');},set(v){value=String(v);this.children=[];}});
    return n;
  }
  function flatten(n) { return [n,...n.children.flatMap(flatten)]; }
  function matches(n,selector) {
    if(selector[0] === '.')return n.className.split(' ').includes(selector.slice(1));
    if(selector[0] === '[') {
      const match=selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
      return !!match && n.getAttribute(match[1]) !== null && (match[2] === undefined || n.getAttribute(match[1]) === match[2]);
    }
    return selector === 'button' && n.tagName === 'BUTTON';
  }
  const list=node('div');list.className='manage-list';
  document={activeElement:null,createElement:node};
  const window={};
  vm.runInNewContext(fs.existsSync(file)?fs.readFileSync(file,'utf8'):'',{window,document,Array,Object,String});
  assert.equal(typeof window.LauncherAppsManager?.mount,'function','a dedicated installed-app manager is available');
  const calls=[];
  const manager=window.LauncherAppsManager.mount(Object.assign({list,onToggle:key=>calls.push(['toggle',key]),onMove:(key,direction)=>calls.push(['move',key,direction]),onRefresh:()=>calls.push(['refresh'])},callbacks));
  function control(key,action) { return flatten(list).find(n=>n.getAttribute('data-app-key')===key&&n.getAttribute('data-app-action')===action); }
  function click(n) { if(!n.disabled)n.listeners.click(); }
  return {list,document,manager,calls,control,click,flatten};
}
function items(count=4) { return Array.from({length:count},(_,i)=>({key:'app-'+i,title:'Aplicación '+i,logo:'assets/logos/app.svg',kind:'app',visible:i!==1})); }

test('all catalog apps are listed with visibility, current position and a useful total',()=>{
  const h=harness();const data=items(32);data.push({key:'hdmi',title:'HDMI 1',kind:'input',visible:true});h.manager.render(data);
  assert.equal(h.list.querySelectorAll('[data-app-row]').length,33);
  assert.match(h.list.querySelector('.apps-summary').textContent,/32.*inicio.*33.*disponibles/);
  assert.equal(h.control('app-1','toggle').getAttribute('aria-checked'),'false');
  assert.equal(h.control('app-1','toggle').getAttribute('aria-label'),'Agregar Aplicación 1 al inicio');
  assert.equal(h.control('app-0','toggle').getAttribute('aria-checked'),'true');
  assert.match(h.list.querySelector('[data-app-row="app-2"]').textContent,/Posición 2/);
  assert.match(h.list.querySelector('[data-app-row="app-1"]').textContent,/Fuera del inicio/);
  assert.deepEqual(h.calls,[],'rendering never changes preferences or refreshes the TV');
});

test('only explicit OK changes visibility or moves a visible app within its own section',()=>{
  const h=harness();const data=items();data.push({key:'hdmi',title:'HDMI 1',kind:'input',visible:true});h.manager.render(data);
  assert.equal(h.control('app-0','earlier').disabled,true);
  assert.equal(h.control('app-3','later').disabled,true);
  assert.equal(h.control('app-1','earlier').disabled,true);
  assert.equal(h.control('app-1','later').disabled,true);
  assert.equal(h.control('hdmi','earlier').disabled,true);
  assert.equal(h.control('hdmi','later').disabled,true);
  h.control('app-2','later').focus();assert.deepEqual(h.calls,[]);
  h.click(h.control('app-1','toggle'));h.click(h.control('app-2','earlier'));h.click(h.control('app-2','later'));
  assert.deepEqual(h.calls,[['toggle','app-1'],['move','app-2',-1],['move','app-2',1]]);
});

test('redraw preserves the same row and action, with the row toggle as a disabled-edge fallback',()=>{
  const h=harness();const data=items();h.manager.render(data);h.control('app-2','later').focus();
  const reordered=[data[0],data[1],data[3],data[2]];h.manager.render(reordered);
  assert.equal(h.document.activeElement,h.control('app-2','toggle'),'a new last app cannot keep disabled later focused');
  h.control('app-2','earlier').focus();h.manager.render(reordered);
  assert.equal(h.document.activeElement,h.control('app-2','earlier'));
  assert.ok(h.list.querySelector('[data-app-row="app-2"]').scrolls.length>0);
  h.manager.render(reordered,{focusKey:'app-0',focusAction:'toggle'});
  assert.equal(h.document.activeElement,h.control('app-0','toggle'));
});

test('remote arrows traverse long catalogs without geometry reads and keep the focused row in view',()=>{
  const h=harness();h.manager.render(items(40));h.control('app-28','earlier').focus();
  assert.equal(h.manager.handlesNavigation('ArrowDown',h.document.activeElement),true);
  assert.equal(h.document.activeElement,h.control('app-29','earlier'));
  const row=h.list.querySelector('[data-app-row="app-29"]');assert.equal(row.scrolls.at(-1).block,'nearest');
  h.manager.handlesNavigation('ArrowLeft',h.document.activeElement);assert.equal(h.document.activeElement,h.control('app-29','toggle'));
  h.control('app-0','toggle').focus();h.manager.handlesNavigation('ArrowRight',h.document.activeElement);
  assert.equal(h.document.activeElement,h.control('app-0','later'),'horizontal focus skips disabled earlier');
  h.control('app-0','toggle').focus();h.manager.handlesNavigation('ArrowUp',h.document.activeElement);
  assert.equal(h.document.activeElement,h.list.querySelector('.apps-refresh'));
  h.manager.handlesNavigation('ArrowDown',h.document.activeElement);assert.equal(h.document.activeElement,h.control('app-0','toggle'));
  h.control('app-39','toggle').focus();assert.equal(h.manager.handlesNavigation('ArrowDown',h.document.activeElement),false,'footer navigation stays with the parent');
  assert.equal(h.manager.handlesNavigation('Escape',h.document.activeElement),false);
  assert.deepEqual(h.calls,[]);
});

test('refresh is explicit, disabled while loading and reports a failure without hiding the saved catalog',()=>{
  const h=harness();h.manager.render(items());const refresh=h.list.querySelector('.apps-refresh');h.click(refresh);
  assert.deepEqual(h.calls,[['refresh']]);
  refresh.focus();h.manager.render(items(),{loading:true});assert.equal(refresh.disabled,true);h.click(refresh);assert.equal(h.calls.length,1);
  assert.equal(h.document.activeElement,h.control('app-0','toggle'),'loading never leaves focus on a disabled refresh button');
  assert.match(h.list.querySelector('.apps-feedback').textContent,/Buscando/);
  h.manager.render(items(),{error:'La TV no respondió.'});assert.equal(refresh.disabled,false);
  assert.match(h.list.querySelector('.apps-feedback').textContent,/La TV no respondió/);
  assert.equal(h.list.querySelectorAll('[data-app-row]').length,4);
});

test('remote navigation from refresh tolerates an app removed by the last inventory',()=>{
  const h=harness();h.manager.render(items());h.control('app-3','toggle').focus();
  h.manager.render(items(2));const refresh=h.list.querySelector('.apps-refresh');refresh.focus();
  assert.equal(h.manager.handlesNavigation('ArrowDown',refresh),true);
  assert.equal(h.document.activeElement,h.control('app-0','toggle'));
});

test('catalog labels are rendered as text and missing artwork keeps a readable fallback',()=>{
  const h=harness();const data=items(1);data[0].title='<script>alert(1)</script>';delete data[0].logo;h.manager.render(data);
  assert.match(h.list.textContent,/<script>alert\(1\)<\/script>/);
  assert.equal(h.flatten(h.list).some(n=>n.tagName==='SCRIPT'),false);
  assert.match(h.list.querySelector('.apps-initial').textContent,/<|A/);
  assert.equal(h.control('app-0','toggle').getAttribute('aria-label'),'Ocultar <script>alert(1)</script> del inicio');
});
