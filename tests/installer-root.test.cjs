'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const location=path.join(__dirname,'../installer/root-controller.cjs');
const api=fs.existsSync(location)?require(location):{};
const config={host:['10','20','30','40'].join('.'),identity:process.execPath};
const profile={modelName:'49UN7310PSC',firmwareVersion:'04.64.00',sdkVersion:'5.6.2',boardType:'K6LP_ATSC_BR'};
function snapshot(uid=0){return {ok:true,uid,system:profile,release:{version:'5.6.2-21',build:'jhericurl-jimna'},devmode:{signature:true,stockHash:true,token:'regular'}};}
function controller(handler){return api.createRootController({createTransport(connection){return {async runRemote(script){assert.equal(typeof script,'string');return {stdout:JSON.stringify(await handler(connection))};}};}});}

test('exports the model-specific read-only automatic root assessment',()=>{
  assert.equal(typeof api.createRootController,'function');
});
test('already rooted TV is skipped without launching an exploit and Developer Mode is checked separately',async()=>{
  const calls=[];const root=controller(connection=>{calls.push(connection);return snapshot(connection.port===22?0:6536);});
  const result=await root.assess(config);
  assert.equal(result.status,'complete');assert.equal(result.root.active,true);assert.equal(result.root.action,'skip');
  assert.equal(result.developerMode.reachable,true);assert.deepEqual(result.codes,['ROOT_ALREADY_PRESENT']);
  assert.deepEqual(calls.map(c=>[c.port,c.user]),[[22,'root'],[9922,'prisoner']]);
});
test('unreachable root is not mistaken for a stock TV or permission to run an exploit',async()=>{
  const root=controller(connection=>{if(connection.port===22)throw Error('network private');return snapshot(6536);});
  const result=await root.assess(config);
  assert.equal(result.status,'blocked');assert.equal(result.root.active,null);assert.equal(result.root.action,'blocked');
  assert.ok(result.codes.includes('ROOT_BOOTSTRAP_NOT_VALIDATED'));assert.equal(JSON.stringify(result).includes('network private'),false);
});
test('wrong firmware fails before requesting a second channel',async()=>{
  let count=0;const root=controller(()=>{count++;const s=snapshot();s.system={...profile,firmwareVersion:'04.99.99'};return s;});
  const result=await root.assess(config);assert.deepEqual(result.codes,['PROFILE_UNSUPPORTED']);assert.equal(count,1);
});
test('root remains detected while failed Developer Mode requires recovery instead of reroot',async()=>{
  const root=controller(connection=>{if(connection.port===9922)throw Error('private token');return snapshot();});
  const result=await root.assess(config);assert.equal(result.status,'partial');assert.equal(result.root.active,true);
  assert.equal(result.root.action,'skip');assert.deepEqual(result.codes,['ROOT_ALREADY_PRESENT','DEVMODE_LOGIN_UNCONFIRMED']);
  assert.equal(result.developerMode.reachable,null);assert.equal(result.developerMode.signature,true);assert.equal(result.developerMode.metadataSource,'root');
});
test('invalid signed script and directory token identify the concrete upstream incompatibility',async()=>{
  const root=controller(connection=>{if(connection.port===22)throw Error('no');const s=snapshot(6536);s.devmode={signature:false,stockHash:false,token:'directory'};return s;});
  const result=await root.assess(config);assert.equal(result.status,'blocked');
  assert.ok(result.codes.includes('DEVMODE_SIGNATURE_INVALID'));assert.ok(result.codes.includes('DEVMODE_TOKEN_INVALID'));
});
test('invalid inputs and malformed evidence never yield active root',async()=>{
  let count=0;const root=controller(()=>{count++;return {ok:true,uid:0,system:profile};});
  assert.equal((await root.assess({...config,host:'8.8.8.8'})).codes[0],'INPUT_INVALID');assert.equal(count,0);
  const result=await root.assess(config);assert.equal(result.root.active,null);assert.equal(result.status,'blocked');
});
test('readonly root assessment does not prepare a plan, disclose key paths or deliver an exploit',async()=>{
  const root=controller(()=>snapshot());assert.equal(typeof root.apply,'function');
  const output=JSON.stringify(await root.assess(config));assert.equal(output.includes(config.identity),false);assert.equal(output.includes(config.host),false);
  assert.equal(output.includes('devmode_enabled'),false);assert.equal(output.includes('COPYING'),false);
});
