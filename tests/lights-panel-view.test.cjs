const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../lights-panel.js'),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function panel(initialIds){
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
  const fields={};for(const name of ['lights-summary','lights-list','lights-controls','lights-status','lights-close','lights-search']){
    fields[name]=node(name==='lights-close'||name==='lights-search'?'button':'div',name);host.appendChild(fields[name]);
  }
  const button=node('button');body.appendChild(button);button.focus();
  const client={calls:[],stopAmbient(){}};
  for(const method of ['capabilities','discover','getState','setState','setMode','screenStatus'])client[method]=payload=>new Promise((resolve,reject)=>client.calls.push({method,payload,resolve,reject}));
  const window={localStorage:{getItem(){return null;},setItem(){}},addEventListener:(n,f)=>bind('window',n,f),removeEventListener:(n,f)=>unbind('window',n,f)};
  vm.runInNewContext(source,{window,document,Promise,Error,setTimeout,clearTimeout});
  const mounted=window.LauncherLights.mount({host,button,client,initialIds});
  async function open(){mounted.open();client.calls[0].resolve({available:true,mode:'manual',wallpaperSync:true,screenSync:false});await flush();}
  async function discover(devices){const pending=mounted.controller.discover();client.calls[client.calls.length-1].resolve({devices});await pending;}
  function key(key){(events.window.keydown||[]).slice().forEach(fn=>fn({key,preventDefault(){},stopPropagation(){}}));}
  return {mounted,client,host,fields,button,document,flatten,open,discover,key};
}
function lamps(count,state){return Array.from({length:count},(_,index)=>({id:'lamp-'+index,name:'Living '+(index+1),reachable:true,state:Object.assign({on:true,brightness:50,rgb:[255,150,40]},state)}));}

test('the living overview reports the selected group and only confirmed shared power and brightness',async()=>{
  const p=panel();await p.open();await p.discover(lamps(6));
  lamps(6).forEach(d=>p.mounted.controller.toggle(d.id));
  assert.equal(p.host.querySelector('.lights-selection-count').textContent,'6 lámparas seleccionadas');
  assert.equal(p.host.querySelector('.lights-power-state').textContent,'Luces encendidas');
  assert.equal(p.host.querySelector('.lights-level-value').textContent,'50 %');
  assert.deepEqual(p.client.calls.map(c=>c.method),['capabilities','discover']);
  p.mounted.close();
});
test('unknown and mixed group readings are distinct and never presented as off or zero',async()=>{
  const p=panel();await p.open();const devices=lamps(2);devices[1].state={on:null,brightness:null};await p.discover(devices);
  devices.forEach(d=>p.mounted.controller.toggle(d.id));
  assert.equal(p.host.querySelector('.lights-power-state').textContent,'Estado sin confirmar');
  assert.equal(p.host.querySelector('.lights-level-value').textContent,'—');
  p.mounted.controller.view.devices[1].state={on:false,brightness:75};p.mounted.controller.toggle('lamp-1');p.mounted.controller.toggle('lamp-1');
  assert.equal(p.host.querySelector('.lights-power-state').textContent,'Encendido mixto');
  assert.equal(p.host.querySelector('.lights-level-value').textContent,'Mixto');
  p.mounted.close();
});
test('a missing selected lamp keeps the group power and brightness unconfirmed',async()=>{
  const p=panel(['lamp-0','lamp-missing']);await p.open();
  p.client.calls[p.client.calls.length-1].resolve({devices:lamps(1)});await flush();
  assert.equal(p.host.querySelector('.lights-selection-count').textContent,'2 lámparas seleccionadas');
  assert.equal(p.host.querySelector('.lights-power-state').textContent,'Estado sin confirmar');
  assert.equal(p.host.querySelector('.lights-level-value').textContent,'—');
  p.mounted.close();
});
test('mode cards explain their source while screen stays gated and every existing control remains explicit',async()=>{
  const p=panel();await p.open();await p.discover(lamps(1));p.mounted.controller.toggle('lamp-0');
  const modes=p.flatten(p.fields['lights-controls']).filter(n=>n.className==='lights-chip lights-mode');
  assert.match(modes[0].textContent,/Color y brillo a tu gusto/);
  assert.match(modes[1].textContent,/La foto de Mi pantalla/);
  assert.match(modes[2].textContent,/El video de la TV/);
  assert.equal(modes[2].disabled,true);assert.match(modes[2].textContent,/Sin verificar/);
  assert.equal(p.flatten(p.fields['lights-controls']).filter(n=>n.className==='lights-chip lights-color').length,6);
  assert.equal(p.flatten(p.fields['lights-controls']).filter(n=>n.className==='lights-chip lights-white').length,3);
  assert.deepEqual(p.client.calls.map(c=>c.method),['capabilities','discover']);p.mounted.close();
});

test('cold capture enables only explicit Start and labels readiness separately from confirmed frames',async()=>{
  const p=panel();await p.open();await p.discover(lamps(1));p.mounted.controller.toggle('lamp-0');
  p.mounted.controller.view.caps.screenSync=true;
  const screen=p.flatten(p.fields['lights-controls']).find(n=>n.className==='lights-chip lights-mode'&&n.getAttribute('data-value')==='screen');
  const cold={configured:true,available:true,ready:true,active:false,pending:false,captureStartReady:true,
    configVerified:true,hardwareVerified:true,framesVerified:false,sourceFreshness:'unknown',reason:''};
  let review=p.mounted.controller.screenStatus();p.client.calls.at(-1).resolve(cold);await review;
  assert.equal(screen.disabled,false);assert.match(screen.textContent,/Lista para iniciar/);
  assert.doesNotMatch(screen.textContent,/Cuadros confirmados/);
  for(const patch of [{pending:true},{captureStartReady:false},{configVerified:false},{reason:'capture-not-ready'}]){
    review=p.mounted.controller.screenStatus();p.client.calls.at(-1).resolve(Object.assign({},cold,patch));await review;
    assert.equal(screen.disabled,true,JSON.stringify(patch));
  }
  assert.equal(p.client.calls.some(call=>call.method==='setMode'),false,'reviews never start the capture');p.mounted.close();
});
test('a focused lamp survives a ten-device redraw, scrolls locally and Back returns to Luces without requests',async()=>{
  const p=panel();await p.open();await p.discover(lamps(10));
  let devices=p.fields['lights-list'].children;devices[8].focus();devices[8].listeners.click();
  const focused=p.document.activeElement;assert.equal(focused.getAttribute('data-lamp'),'lamp-8');assert.ok(focused.scrolls>0);
  devices=p.fields['lights-list'].children;devices.forEach((n,i)=>{n.rect={left:0,top:i*50,width:250,height:40};});
  const controls=p.flatten(p.fields['lights-controls']).filter(n=>n.tagName==='BUTTON');controls.forEach(n=>{n.rect={left:500,top:0,width:100,height:40};});
  p.key('ArrowDown');assert.equal(p.document.activeElement.getAttribute('data-lamp'),'lamp-9');
  assert.ok(p.document.activeElement.scrolls>0);p.key('Escape');assert.equal(p.document.activeElement,p.button);assert.equal(p.host.hidden,true);
  assert.deepEqual(p.client.calls.map(c=>c.method),['capabilities','discover']);
});
