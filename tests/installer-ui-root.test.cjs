'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
function fixture(options={}){
  const nodes={};
  function element(){return{value:'',checked:false,disabled:false,children:[],listeners:{},attributes:{},_text:'',appendChild(n){this.children.push(n);},setAttribute(k,v){this.attributes[k]=v;},getAttribute(k){return this.attributes[k];},addEventListener(k,v){this.listeners[k]=v;},get textContent(){return this._text+this.children.map(n=>n.textContent).join('');},set textContent(v){this._text=String(v);this.children=[];}};}
  const ids=['setup-form','host','identity','install','home','privacy','connect','prepare','apply','restore','feedback','result-summary','result-status','device-status','steps','plan-status','capture-status','lights-status','identities','identity-choice','identity-status','identity-results','root-status','root-summary','root-plan','root-apply','root-plan-status','screen-status','screen-prepare','screen-start','screen-stop','screen-summary','screen-badge'];
  ids.forEach(id=>nodes[id]=element());nodes.host.value='192.168.50.20';nodes.identity.value='C:\\Keys\\tv';
  const token=element();token.setAttribute('content','session');
  const document={getElementById:id=>nodes[id],querySelector:()=>token,querySelectorAll:()=>[],createElement:element};
  const calls=[];const fetch=(url,request)=>new Promise((resolve,reject)=>calls.push({request,resolve:result=>resolve({ok:true,json:async()=>({ok:true,result})}),reject}));
  const app=require('../installer/ui/app.js').createApp({document,fetch,...options});app.start();return{app,nodes,calls,change(){nodes['setup-form'].listeners.input();}};
}
const plan=(id='1'.repeat(32))=>({status:'planned',plan:{id,expiresAt:Date.now()+300000},root:{active:null},summary:'Revisá las etapas',steps:[{label:'Root temporal y Developer Mode',status:'planned'}]});
test('root planning is explicit and apply sends only the reviewed plan id',async()=>{
  const f=fixture();assert.equal(f.calls.length,0);assert.equal(f.nodes['root-apply'].disabled,true);
  let pending=f.app.rootPlan();assert.deepEqual(JSON.parse(f.calls[0].request.body),{action:'rootPlan',payload:{host:'192.168.50.20',identity:'C:\\Keys\\tv'}});
  f.calls[0].resolve(plan());await pending;assert.equal(f.nodes['root-apply'].disabled,false);assert.match(f.nodes.steps.textContent,/Developer Mode/);
  pending=f.app.rootApply();assert.deepEqual(JSON.parse(f.calls[1].request.body),{action:'rootApply',payload:{planId:'1'.repeat(32)}});
  f.calls[1].resolve({status:'partial',root:{active:true},physicalBootPending:true,summary:'SSH verificado; falta arranque físico'});await pending;
  assert.equal(f.nodes['root-apply'].disabled,true);assert.equal(f.nodes['root-plan'].disabled,true);assert.match(f.nodes['root-summary'].textContent,/arranque físico/);
  assert.equal(f.nodes.restore.disabled,true);
});
test('existing root skips every bootstrap action and malformed or expired plans cannot apply',async()=>{
  const f=fixture();let pending=f.app.rootStatus();f.calls[0].resolve({status:'ready',root:{verified:true,active:true}});await pending;
  assert.equal(f.nodes['root-plan'].disabled,true);await f.app.rootPlan();assert.equal(f.calls.length,1);
  const g=fixture();pending=g.app.rootPlan();g.calls[0].resolve({...plan(),status:'blocked'});await pending;await g.app.rootApply();assert.equal(g.calls.length,1);
  pending=g.app.rootPlan();g.calls[1].resolve({...plan(),plan:{id:'expired',expiresAt:Date.now()-1}});await pending;await g.app.rootApply();assert.equal(g.calls.length,2);
});
test('root plans are revoked by form edits, direct target edits and another rendered review',async()=>{
  const f=fixture();let pending=f.app.rootPlan();f.calls[0].resolve(plan());await pending;
  f.nodes.privacy.checked=true;f.change();assert.equal(f.nodes['root-apply'].disabled,true);await f.app.rootApply();assert.equal(f.calls.length,1);
  pending=f.app.rootPlan();f.calls[1].resolve(plan('2'.repeat(32)));await pending;f.nodes.identity.value='C:\\Keys\\other';await f.app.rootApply();assert.equal(f.calls.length,2);
  pending=f.app.rootPlan();f.calls[2].resolve(plan('3'.repeat(32)));await pending;pending=f.app.connect();f.calls[3].resolve({status:'ready'});await pending;assert.equal(f.nodes['root-apply'].disabled,true);
});
test('uncertain root application blocks replay and only a matching root review can confirm completion',async()=>{
  const f=fixture({timeoutMs:5});let pending=f.app.rootPlan();f.calls[0].resolve(plan());await pending;await f.app.rootApply();
  assert.equal(f.nodes.prepare.disabled,true);await f.app.rootApply();assert.equal(f.calls.length,2);
  const original=f.nodes.host.value;f.nodes.host.value='192.168.50.22';f.change();pending=f.app.rootStatus();f.calls[2].resolve({root:{verified:true,active:true}});await pending;assert.equal(f.nodes.prepare.disabled,true);
  f.nodes.host.value=original;f.change();pending=f.app.rootStatus();f.calls[3].resolve({root:{verified:true,active:true},rootRecovery:{pending:true,backupId:'root-only'}});await pending;assert.equal(f.nodes.prepare.disabled,true);assert.equal(f.nodes.restore.disabled,true);
  pending=f.app.rootStatus();f.calls[4].resolve({root:{verified:true,active:true}});await pending;assert.equal(f.nodes.prepare.disabled,false);
  assert.deepEqual(f.calls.map(c=>JSON.parse(c.request.body).action),['rootPlan','rootApply','rootStatus','rootStatus','rootStatus']);
});
test('root and capture preparation use the longer finite deadline while explicit test overrides remain effective',async()=>{
  const deadlines=[],f=fixture({setTimeout(fn,ms){deadlines.push(ms);return setTimeout(fn,100);},clearTimeout});
  let pending=f.app.rootPlan();f.calls[0].resolve(plan());await pending;pending=f.app.rootApply();f.calls[1].resolve({status:'blocked'});await pending;
  pending=f.app.screenStatus();f.calls[2].resolve({capture:{verified:true,available:false},lights:{verified:true,active:false},canPrepare:true});await pending;
  pending=f.app.screenPrepare();f.calls[3].resolve({capture:{verified:true,available:true},lights:{verified:true,active:false}});await pending;
  assert.deepEqual(deadlines,[125000,305000,125000,305000]);
});
test('a root plan with no reviewable steps or an unknown step status cannot execute',async()=>{
  const f=fixture();let pending=f.app.rootPlan();f.calls[0].resolve({...plan(),steps:[]});await pending;await f.app.rootApply();assert.equal(f.calls.length,1);
  pending=f.app.rootPlan();f.calls[1].resolve({...plan(),steps:[{label:'Etapa sin confirmar',status:'unknown'}]});await pending;await f.app.rootApply();assert.equal(f.calls.length,2);
});
