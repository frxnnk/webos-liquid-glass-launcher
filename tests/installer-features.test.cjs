'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createEngine}=require('../installer/engine.cjs');
test('identity discovery accepts no arbitrary parameters and does not connect to a TV',async()=>{
  let calls=0;const engine=createEngine({findIdentities(){calls++;return{ok:true,identities:[{path:'fixture'}]};},createTransport(){throw Error('No connection');}});
  assert.equal((await engine.runAction('identities',{})).identities.length,1);
  assert.equal((await engine.runAction('identities',{directory:'/other-user'})).status,'blocked');assert.equal(calls,1);
});
test('capture mutations share the engine lock with setup mutations while diagnosis remains available',async()=>{
  let release;const screenController={start(){return new Promise(resolve=>{release=resolve;});},status:async()=>({ok:true,status:'ready'})};
  const engine=createEngine({screenController});const pending=engine.runAction('screenStart',{});
  assert.deepEqual((await engine.runAction('apply',{planId:'a'.repeat(32)})).codes,['BUSY']);
  assert.equal((await engine.runAction('screenStatus',{})).status,'ready');
  release({ok:true,status:'complete'});assert.equal((await pending).status,'complete');
  assert.deepEqual((await engine.runAction('apply',{planId:'a'.repeat(32)})).codes,['PLAN_UNKNOWN']);
});
test('failed capture releases its operation lock without surfacing a private error',async()=>{
  const engine=createEngine({screenController:{prepare:async()=>{throw Error('private internal detail');}}});
  const failed=await engine.runAction('screenPrepare',{});assert.deepEqual(failed.codes,['ACTION_FAILED']);assert.doesNotMatch(JSON.stringify(failed),/private internal/);
  assert.deepEqual((await engine.runAction('apply',{planId:'a'.repeat(32)})).codes,['PLAN_UNKNOWN']);
});
test('root status exposes a verified existing root and never repeats the bootstrap',async()=>{
  const engine=createEngine({rootController:{assess:async()=>({ok:true,status:'complete',root:{active:true,action:'skip'}}),apply(){throw Error('must not run');}}});
  const result=await engine.runAction('rootStatus',{});assert.equal(result.root.verified,true);assert.equal(result.root.action,'skip');
});
test('the root adapter uses the engine injected transport for both fixed endpoints',async()=>{
  const calls=[];const engine=createEngine({createTransport(config){calls.push(config.port);return{async runRemote(){return{stdout:JSON.stringify({ok:true,uid:config.port===22?0:6536,system:{modelName:'49UN7310PSC',firmwareVersion:'04.64.00',sdkVersion:'5.6.2',boardType:'K6LP_ATSC_BR'},release:{version:'5.6.2-21',build:'jhericurl-jimna'},devmode:{signature:true,stockHash:true,token:'regular'}})};}};}});
  const result=await engine.runAction('rootStatus',{host:'10.30.40.50',identity:__filename});
  assert.deepEqual(calls,[22,9922]);assert.equal(result.root.active,true);
});
