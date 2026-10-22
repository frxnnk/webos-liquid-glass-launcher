'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const file=path.join(__dirname,'../installer/root-workflow.cjs');
const api=fs.existsSync(file)?require(file):{};
const input={host:['10','20','30','40'].join('.'),identity:process.execPath};
function workflow(deps){return api.createRootWorkflow({reserve:async(config,{id})=>({id,host:config.host}),releaseReservation:async()=>{},...deps});}
function stock(){return {root:{active:null,action:'blocked'},developerMode:{reachable:true,signature:true,stockHash:true,token:'regular'},rootArtifacts:{hbcApp:'absent',hbcService:'absent',startup:'absent'},codes:['ROOT_BOOTSTRAP_NOT_VALIDATED']};}
test('existing root never prepares or executes bootstrap, HBC or repairs',async()=>{
  let mutations=0;const flow=workflow({assess:async()=>({root:{active:true,action:'skip'},codes:['ROOT_ALREADY_PRESENT']}),runBootstrap(){mutations++;},provisionHbc(){mutations++;}});
  const plan=await flow.plan(input);assert.equal(plan.status,'skipped');assert.equal(plan.plan,undefined);assert.equal(mutations,0);
});
test('only absent known root artifacts allow an experimental model-specific plan',async()=>{
  const flow=workflow({assess:async()=>({...stock(),rootArtifacts:{hbcApp:'regular',hbcService:'directory',startup:'regular'}})});
  assert.ok((await flow.plan(input)).codes.includes('EXISTING_ROOT_RECOVERY_REQUIRED'));
});
test('real stock stages preserve their order and physical boot is never claimed',async()=>{
  const calls=[];const flow=workflow({assess:async()=>stock(),record:async()=>{},loadSources:async()=>({ipk:Buffer.from('pinned')}),derivePublicKey:async()=> 'public-key',routeIp:async()=> '10.20.30.41',
    runBootstrap:async()=>{calls.push('bootstrap');},createTransport:connection=>({connection}),verifyTemporaryRoot:async()=>{calls.push('verify2222');},
    repairDeveloperMode:async()=>{calls.push('signed-repair');},provisionHbc:async()=>{calls.push('provision');return {physicalBootPending:true};},verifyFinal:async()=>{calls.push('verify22+9922');return true;},releaseProvisioningHold:async()=>{calls.push('release-hold');}});
  const plan=await flow.plan(input);assert.equal(plan.status,'planned');assert.equal(plan.stockValidated,false);
  const applied=await flow.apply({planId:plan.plan.id});assert.equal(applied.status,'partial');assert.equal(applied.root.active,true);
  assert.deepEqual(calls,['bootstrap','verify2222','signed-repair','provision','verify22+9922','release-hold']);assert.ok(applied.codes.includes('PHYSICAL_BOOT_UNVERIFIED'));
  assert.equal((await flow.apply({planId:plan.plan.id})).status,'blocked');
});
test('unconfirmed final SSH checks retain provisioning hold and a recovery journal',async()=>{
  let released=0;const phases=[];
  const flow=workflow({assess:async()=>stock(),record:async value=>{phases.push(value.phase);},loadSources:async()=>({ipk:Buffer.from('pinned')}),derivePublicKey:async()=> 'public-key',routeIp:async()=> '10.20.30.41',
    runBootstrap:async()=>{},createTransport:connection=>({connection}),verifyTemporaryRoot:async()=>{},repairDeveloperMode:async()=>{},provisionHbc:async()=>{},verifyFinal:async()=>false,releaseProvisioningHold:async()=>{released++;}});
  const plan=await flow.plan(input),result=await flow.apply({planId:plan.plan.id});
  assert.equal(result.status,'partial');assert.equal(released,0);assert.equal(phases.at(-1),'unconfirmed');
});
test('profile or root state drift blocks before loading or delivering a payload',async()=>{
  let assessment=stock(),loaded=0;const flow=workflow({assess:async()=>assessment,loadSources:async()=>{loaded++;}});
  const plan=await flow.plan(input);assessment={...stock(),developerMode:{...stock().developerMode,signature:false}};
  const result=await flow.apply({planId:plan.plan.id});assert.equal(result.status,'blocked');assert.equal(loaded,0);
});
test('bootstrap uncertainty is recorded and never retried automatically',async()=>{
  const phases=[];let delivered=0;const flow=workflow({assess:async()=>stock(),record:async record=>{phases.push(record.phase);},loadSources:async()=>({ipk:Buffer.from('pinned')}),derivePublicKey:async()=> 'public-key',routeIp:async()=> '10.20.30.41',
    runBootstrap:async()=>{delivered++;throw Error('raw secret host output');}});
  const plan=await flow.plan(input),result=await flow.apply({planId:plan.plan.id});
  assert.equal(result.status,'partial');assert.equal(result.root.active,null);assert.equal(delivered,1);assert.ok(phases.includes('unconfirmed'));
  assert.equal(JSON.stringify(result).includes('raw secret'),false);
  assert.equal((await flow.plan(input)).codes[0],'ROOT_RECOVERY_PENDING');
});
test('expired plans and malformed requests cannot initiate source downloads',async()=>{
  let clock=0,downloads=0;const flow=workflow({now:()=>clock,assess:async()=>stock(),loadSources:async()=>{downloads++;}});
  const plan=await flow.plan(input);clock=300001;
  assert.ok((await flow.apply({planId:plan.plan.id})).codes.includes('PLAN_EXPIRED'));
  assert.equal((await flow.apply({planId:'../bad'})).status,'blocked');assert.equal(downloads,0);
});
test('changing the local identity path cannot bypass a pending root run on the same TV',async()=>{
  const flow=workflow({assess:async()=>stock(),record:async()=>{},loadSources:async()=>({ipk:Buffer.from('pinned')}),derivePublicKey:async()=> 'public-key',routeIp:async()=> '10.20.30.41',runBootstrap:async()=>{throw Error('interrupted');}});
  const plan=await flow.plan(input);await flow.apply({planId:plan.plan.id});
  const replacement=await flow.plan({...input,identity:__filename});
  assert.equal(replacement.status,'blocked');assert.ok(replacement.codes.includes('ROOT_RECOVERY_PENDING'));
});
