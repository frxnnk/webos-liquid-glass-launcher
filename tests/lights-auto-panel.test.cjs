const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../lights-panel.js'),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function panel(initialIds,extra={}){
  const events={window:{},document:{}};let document;
  function node(tag,className=''){
    let value='';const result={tagName:tag.toUpperCase(),className,children:[],attributes:{},style:{},listeners:{},disabled:false,hidden:false,scrolls:0,
      appendChild(child){this.children.push(child);child.parentNode=this;return child;},
      setAttribute(key,value){this.attributes[key]=String(value);},getAttribute(key){return this.attributes[key]||null;},
      addEventListener(name,fn){this.listeners[name]=fn;},removeEventListener(name){delete this.listeners[name];},
      contains(child){return this===child||this.children.some(n=>n.contains(child));},
      getClientRects(){return this.hidden?[]:[this.getBoundingClientRect()];},
      getBoundingClientRect(){return this.rect||{left:0,top:0,width:100,height:40};},
      scrollIntoView(){this.scrolls++;},
      focus(){document.activeElement=this;(events.document.focusin||[]).slice().forEach(fn=>fn({target:this}));},
      querySelectorAll(selector){return flatten(this).slice(1).filter(n=>matches(n,selector));},
      querySelector(selector){return this.querySelectorAll(selector)[0]||null;}};
    Object.defineProperty(result,'textContent',{get(){return value+this.children.map(n=>n.textContent).join('');},set(v){value=String(v);this.children=[];}});
    return result;
  }
  function flatten(n){return [n,...n.children.flatMap(flatten)];}
  function matches(n,selector){
    if(selector[0]==='.')return n.className.split(' ').includes(selector.slice(1));
    if(!selector.startsWith('button')||n.tagName!=='BUTTON')return false;
    if(selector.includes(':not([disabled])')&&n.disabled)return false;
    if(selector.includes('[aria-checked="true"]')&&n.getAttribute('aria-checked')!=='true')return false;
    return true;
  }
  function bind(target,name,fn){(events[target][name]||(events[target][name]=[])).push(fn);}
  function unbind(target,name,fn){events[target][name]=(events[target][name]||[]).filter(x=>x!==fn);}
  const body=node('body');body.classList={add(){},remove(){}};
  document={activeElement:null,body,createElement:node,addEventListener:(n,f)=>bind('document',n,f),removeEventListener:(n,f)=>unbind('document',n,f)};
  const host=node('section','lights-panel');host.hidden=true;body.appendChild(host);
  const fields={};for(const name of ['lights-title','lights-summary','lights-list','lights-controls','lights-status','lights-close','lights-search']){
    fields[name]=node(name==='lights-close'||name==='lights-search'?'button':'div',name);host.appendChild(fields[name]);
  }
  const button=node('button');body.appendChild(button);button.focus();
  const client={calls:[],stopAmbient(){}};
  for(const method of ['capabilities','discover','getState','setState','setMode','screenStatus','autoStatus','setAuto'])client[method]=payload=>new Promise((resolve,reject)=>client.calls.push({method,payload,resolve,reject}));
  const window={localStorage:{getItem(){return null;},setItem(){}},addEventListener:(n,f)=>bind('window',n,f),removeEventListener:(n,f)=>unbind('window',n,f)};
  vm.runInNewContext(source,{window,document,Promise,Error,setTimeout,clearTimeout});
  const mounted=window.LauncherLights.mount(Object.assign({host,button,client,initialIds},extra));
  async function open(screenSync=true){mounted.open();client.calls[0].resolve({available:true,mode:'manual',wallpaperSync:true,screenSync});await flush();}
  async function discover(devices){const pending=mounted.controller.discover();client.calls[client.calls.length-1].resolve({devices});await pending;}
  function key(key){(events.window.keydown||[]).slice().forEach(fn=>fn({key,preventDefault(){},stopPropagation(){}}));}
  return {mounted,client,host,fields,button,document,flatten,open,discover,key};
}
function lamps(){return [];}

const AUTO_OFF={available:true,enabled:false,state:'off',watching:false,apps:['youtube.leanback.v4'],reason:''};
const card=p=>p.flatten(p.fields['lights-controls']).find(n=>n.getAttribute('data-value')==='auto');
const last=p=>p.client.calls[p.client.calls.length-1];
const plain=value=>JSON.parse(JSON.stringify(value));

test('opening with capture support asks for the Auto status once and shows the switch card',async()=>{
  const p=panel(['lamp-0']);await p.open();
  assert.deepEqual(p.client.calls.map(c=>c.method),['capabilities','autoStatus','getState']);
  p.client.calls[1].resolve(AUTO_OFF);p.client.calls[2].resolve({devices:[]});await flush();
  assert.equal(card(p).getAttribute('aria-pressed'),'false');assert.equal(card(p).disabled,false);
  assert.match(card(p).textContent,/Auto/);assert.match(card(p).textContent,/Solo con YouTube/);assert.match(card(p).textContent,/Desactivado/);
  p.mounted.close();
});
test('without a chosen lamp the Auto card is disabled and says why',async()=>{
  const p=panel();await p.open();last(p).resolve(AUTO_OFF);await flush();
  assert.equal(card(p).disabled,true);assert.match(card(p).textContent,/Elegí lámparas primero/);p.mounted.close();
});
test('without capture support Auto is never requested and its card stays disabled',async()=>{
  const p=panel();await p.open(false);
  assert.deepEqual(p.client.calls.map(c=>c.method),['capabilities']);
  assert.equal(card(p).disabled,true);assert.match(card(p).textContent,/No disponible/);p.mounted.close();
});
test('an invalid or failing status leaves Auto unavailable instead of guessing',async()=>{
  for(const reply of [{available:'yes',enabled:false,state:'off'},{available:true,enabled:false,state:'bogus'},null]){
    const p=panel();await p.open();last(p).resolve(reply);await flush();
    assert.equal(card(p).disabled,true);assert.match(card(p).textContent,/No disponible/);
    assert.equal(await p.mounted.controller.setAuto(true),false);assert.equal(p.client.calls.some(c=>c.method==='setAuto'),false);p.mounted.close();
  }
  const p=panel();await p.open();last(p).reject(Error('boom'));await flush();assert.equal(card(p).disabled,true);p.mounted.close();
});
test('turning Auto on sends only the boolean, confirms from the reply and explains what will happen',async()=>{
  const p=panel();await p.open();last(p).resolve(AUTO_OFF);await flush();
  const done=p.mounted.controller.setAuto(true);
  assert.deepEqual(last(p).method,'setAuto');assert.deepEqual(plain(last(p).payload),{enabled:true});
  assert.equal(await Promise.race([done,flush().then(()=>'pending')]),'pending');
  last(p).resolve({available:true,enabled:true,state:'idle',reason:''});assert.equal(await done,true);
  assert.equal(card(p).getAttribute('aria-pressed'),'true');assert.match(card(p).textContent,/Activado · esperando YouTube/);
  assert.match(p.mounted.controller.view.message,/Auto activado/);p.mounted.close();
});
test('card states: starting, waiting, syncing, a session of your own, restoring and errors are labelled',async()=>{
  const cases=[[{state:'starting'},/iniciando/],[{state:'idle'},/esperando YouTube/],[{state:'waiting'},/preparando/],
    [{state:'syncing'},/Activado · sincronizando/],[{state:'syncing',reason:'manual-session'},/sesión manual/],
    [{state:'stopping'},/restaurando luces/],[{state:'error',reason:'auth-required'},/Error: auth-required/],[{state:'error',reason:''},/Error: sin detalle/]];
  for(const [state,expected] of cases){
    const p=panel();await p.open();last(p).resolve(Object.assign({},AUTO_OFF,{enabled:true},state));await flush();
    assert.match(card(p).textContent,expected);assert.equal(card(p).getAttribute('aria-pressed'),'true');p.mounted.close();
  }
});
test('a rejected, mismatched or late answer never shows Auto as changed',async()=>{
  let p=panel();await p.open();last(p).resolve(AUTO_OFF);await flush();
  let done=p.mounted.controller.setAuto(true);last(p).reject(Error('No se pudo guardar el modo Auto.'));
  assert.equal(await done,false);assert.equal(card(p).getAttribute('aria-pressed'),'false');assert.match(p.mounted.controller.view.message,/No se pudo cambiar Auto/);
  done=p.mounted.controller.setAuto(true);last(p).resolve({available:true,enabled:false,state:'off',reason:''});
  assert.equal(await done,false);assert.equal(card(p).getAttribute('aria-pressed'),'false');
  done=p.mounted.controller.setAuto(true);p.mounted.close();last(p).resolve({available:true,enabled:true,state:'idle',reason:''});
  assert.equal(await done,false);assert.equal(p.mounted.controller.view.auto.enabled,false);
});
test('Auto cannot be toggled while another request is running or with a non-boolean',async()=>{
  const p=panel();await p.open();last(p).resolve(AUTO_OFF);await flush();
  const first=p.mounted.controller.setAuto(true);
  assert.equal(await p.mounted.controller.setAuto(false),false);assert.equal(await p.mounted.controller.setAuto('yes'),false);
  assert.equal(p.client.calls.filter(c=>c.method==='setAuto').length,1);
  last(p).resolve({available:true,enabled:true,state:'idle',reason:''});await first;p.mounted.close();
});
test('the card toggles Auto from the remote and the existing mode cards keep their count',async()=>{
  const p=panel();await p.open();last(p).resolve(AUTO_OFF);await flush();
  assert.equal(p.flatten(p.fields['lights-controls']).filter(n=>n.className==='lights-chip lights-mode').length,3);
  card(p).listeners.click();assert.deepEqual(plain(last(p).payload),{enabled:true});
  last(p).resolve({available:true,enabled:true,state:'idle',reason:''});await flush();
  card(p).listeners.click();assert.deepEqual(plain(last(p).payload),{enabled:false});p.mounted.close();
});

test('the title is the configured room name, "Luces" by default, and never raw markup or a long string',()=>{
  assert.equal(panel().fields['lights-title'].textContent,'Luces');
  assert.equal(panel([],{roomName:'Living'}).fields['lights-title'].textContent,'Living');
  assert.equal(panel([],{roomName:42}).fields['lights-title'].textContent,'Luces');
  assert.equal(panel([],{roomName:''}).fields['lights-title'].textContent,'Luces');
  assert.equal(panel([],{roomName:'x'.repeat(80)}).fields['lights-title'].textContent.length,24);
});
test('the Luces button is shown by default and hidden only when the app says there is nothing to control',()=>{
  assert.equal(panel().button.hidden,false);
  assert.equal(panel([],{visible:true}).button.hidden,false);
  assert.equal(panel([],{visible:false}).button.hidden,true);
});
test('without any WiZ lamp the panel explains what it controls and a search with no result says so',async()=>{
  const p=panel([]);await p.open(false);
  assert.match(p.fields['lights-list'].textContent,/lámparas WiZ de tu red local/);
  const search=p.mounted.controller.discover();p.client.calls[p.client.calls.length-1].resolve({devices:[]});await search;
  assert.match(p.mounted.controller.view.message,/No se encontró ninguna lámpara WiZ en la red./);
  assert.match(p.fields['lights-list'].textContent,/No se encontró ninguna lámpara./);
  assert.match(p.host.querySelector?String(p.fields['lights-status'].textContent):'',/No se encontró ninguna lámpara WiZ/);
  assert.equal(/living/i.test(p.fields['lights-list'].textContent+p.fields['lights-status'].textContent),false);
  p.mounted.close();
});
