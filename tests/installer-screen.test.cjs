'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createScreenController,normalize}=require('../installer/screen-controller.cjs');
const {script,remoteScreen}=require('../installer/screen-remote.cjs');
const target={host:'192.168.50.12',identity:'C:\\example\\tv-key'};
function ready(extra={}){return Object.assign({ok:true,verified:true,missing:[],conflicts:[],configured:true,ready:true,active:false,pending:false,framesVerified:true,hardwareVerified:true,configVerified:true,lampCount:6,reason:''},extra);}
function controller(responses,deps={}){const actions=[],timeouts=[];return{actions,timeouts,client:createScreenController(Object.assign({createTransport(){return{async runRemote(text,options){actions.push(/"action":"([^"]+)"/.exec(text)[1]);timeouts.push(options.timeoutMs);const value=responses.shift();if(value instanceof Error)throw value;return{stdout:JSON.stringify(value)};}};}},deps))};}
test('status reports a confirmed missing pipeline without claiming lamps are off',async()=>{
  const {client}=controller([ready({missing:['piccap','hyperhdr','screen-config'],ready:false,active:null,framesVerified:false,configVerified:false,hardwareVerified:false})]);
  const value=await client.status(target);assert.equal(value.capture.verified,true);assert.equal(value.capture.available,false);assert.equal(value.lights.active,null);assert.equal(value.canPrepare,true);assert.equal(value.canStop,false);
});
test('fresh frames alone do not enable start',async()=>{
  const {client,actions}=controller([ready({hardwareVerified:false})]);const value=await client.start(target);
  assert.equal(value.status,'blocked');assert.deepEqual(actions,['status']);
});

test('an owned cold capture enables explicit start without promoting frames to verified',async()=>{
  const cold=ready({framesVerified:false,captureStartReady:true});
  const state=normalize('status',cold);
  assert.equal(state.capture.available,true);assert.equal(state.capture.captureStartReady,true);
  assert.equal(state.capture.framesVerified,false);assert.match(state.summary,/lista para iniciar/);
  const {client,actions}=controller([cold,ready({ready:false,active:true,pending:true})]);
  assert.equal((await client.start(target)).status,'complete');assert.deepEqual(actions,['status','start']);
});

test('cold readiness cannot bypass unknown capture, authorization, hardware or pending recovery',()=>{
  for(const patch of [{captureStartReady:false},{captureStartReady:'true'},{captureStartReady:1},{captureStartReady:undefined},
    {ready:false},{configured:false},{configVerified:false},{hardwareVerified:false},{active:null},{pending:null},
    {pending:true},{reason:'auth-required'},{reason:'capture-not-ready'},{verified:false}]){
    const value=normalize('status',ready(Object.assign({framesVerified:false,captureStartReady:true},patch)));
    assert.equal(value.capture.available,false,JSON.stringify(patch));assert.equal(value.capture.framesVerified,false);
  }
  assert.equal(normalize('start',ready({active:true,pending:true,framesVerified:false,captureStartReady:true})).status,'partial',
    'permission to start cannot substitute for frames after starting');
});
test('start delegates to the existing service and verifies the active session',async()=>{
  const {client,actions}=controller([ready(),ready({ready:false,active:true,pending:true,phase:'active'})]);
  const value=await client.start(target);assert.equal(value.status,'complete');assert.equal(value.canStop,true);assert.deepEqual(actions,['status','start']);
});

test('only start and stop use the explicit 25-second transport budget',async()=>{
  const c=controller([ready(),ready({ready:false,active:true,pending:true}),ready(),ready()]);
  await c.client.start(target);await c.client.stop(target);await c.client.status(target);
  assert.deepEqual(c.actions,['status','start','stop','status']);assert.deepEqual(c.timeouts,[20000,25000,25000,20000]);
});
test('an acknowledgment without active readback remains partial',async()=>{
  const {client}=controller([ready(),ready({active:null,pending:true})]);const value=await client.start(target);assert.equal(value.status,'partial');assert.deepEqual(value.codes,['SCREEN_START_UNCONFIRMED']);
});
test('stop never needs an active precheck and confirms baseline restoration',async()=>{
  const {client,actions}=controller([ready()]);const value=await client.stop(target);assert.equal(value.status,'complete');assert.equal(value.lights.pending,false);assert.deepEqual(actions,['stop']);
});
test('pending restoration permits stopping again without reporting success',()=>{
  const value=normalize('stop',ready({active:null,pending:true}));assert.equal(value.status,'partial');assert.equal(value.canStop,true);assert.equal(value.lights.active,null);
});
test('unknown SSH and malformed responses fail closed',async()=>{
  const {client}=controller([Error('private diagnostic')]);const value=await client.status(target);assert.equal(value.capture.verified,false);assert.equal(value.lights.active,null);assert.equal(JSON.stringify(value).includes('private diagnostic'),false);
});
test('prepare requires an actual missing component and checks the resulting configuration',async()=>{
  let prepared=0;const {client}=controller([ready({missing:['screen-config'],ready:false,active:null}),ready()],{preparePipeline:async(t,options)=>{prepared++;assert.deepEqual(options.missing,['screen-config']);assert.equal(options.hardwareConfirmed,false);return{};}});
  const value=await client.prepare(target);assert.equal(prepared,1);assert.equal(value.status,'complete');assert.equal(value.physicalProofPending,true);
});
test('prepare is blocked while a baseline is pending',async()=>{
  const {client}=controller([ready({missing:['screen-config'],ready:false,active:null,pending:true})],{preparePipeline:async()=>assert.fail('must not run')});
  assert.equal((await client.prepare(target)).status,'blocked');
});
test('remote script uses trusted LS2 app identity and avoids leaking private fields',()=>{
  const source=script('start');assert.match(source,/-a','com\.frxn\.mipantalla/);assert.match(source,/LD_PRELOAD/);assert.match(source,/readFileSync\(3/);assert.doesNotMatch(source,/execFileSync/);assert.match(source,/setMode/);assert.doesNotMatch(source,/componentstate/);
});
test('exact-model validation runs before any lamp operation',async()=>{
  const calls=[],outputs=[];await remoteScreen({action:'start'},{getuid:()=>0,fs:{},execFile(command,args,options,callback){calls.push(args);callback(null,JSON.stringify({returnValue:true,modelName:'other'}));},output:value=>outputs.push(value)});
  assert.equal(calls.length,1);assert.equal(outputs[0].code,'SCREEN_PROFILE_UNSUPPORTED');
});
test('an authenticated configuration with an expired token can be prepared again only with no recovery pending',()=>{
  const state=ready({configured:true,ready:false,active:null,reason:'auth-required',configVerified:false,framesVerified:false});
  assert.equal(normalize('status',state).canPrepare,true);
  assert.equal(normalize('status',Object.assign({},state,{pending:true})).canPrepare,false);
  assert.equal(normalize('status',Object.assign({},state,{pending:null})).canPrepare,false);
  assert.equal(normalize('status',Object.assign({},state,{reason:'protocol-error'})).canPrepare,false);
  assert.equal(normalize('status',Object.assign({},state,{configured:false})).canPrepare,false);
});
