'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const runtime=require('../installer/root-runtime.cjs');
const {createRootWorkflow}=require('../installer/root-workflow.cjs');
const config={host:['10','20','30','40'].join('.'),identity:process.execPath};
function storage(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mp-root-reservation-'));t.after(()=>{
  const resolved=path.resolve(directory);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep+'mp-root-reservation-'));fs.rmSync(resolved,{recursive:true,force:true});
});return {directory};}
function stock(){return {root:{active:null,action:'blocked'},developerMode:{reachable:true,signature:true,stockHash:true,token:'regular'},rootArtifacts:{hbcApp:'absent',hbcService:'absent',startup:'absent'},codes:['ROOT_BOOTSTRAP_NOT_VALIDATED']};}
test('two independent workflows sharing a journal can deliver only one bootstrap',async t=>{
  const options=storage(t);let bootstraps=0,applyChecks=0,synchronizing=false,releaseChecks,started,releaseBootstrap;
  const checked=new Promise(resolve=>{releaseChecks=resolve;}),began=new Promise(resolve=>{started=resolve;}),gate=new Promise(resolve=>{releaseBootstrap=resolve;});
  const common={assess:async()=>{if(synchronizing&&++applyChecks<=2){if(applyChecks===2)releaseChecks();await checked;}return stock();},record:async()=>{},recovery:async()=>null,
    reserve:(input,request)=>runtime.reserve(input,{...request,...options}),releaseReservation:lease=>runtime.releaseReservation(lease,options),
    loadSources:async()=>({ipk:Buffer.from('fixture')}),derivePublicKey:async()=> 'public-key',routeIp:async()=> '10.20.30.41',
    runBootstrap:async()=>{bootstraps++;started();await gate;},createTransport:()=>({}),verifyTemporaryRoot:async()=>{},repairDeveloperMode:async()=>{},provisionHbc:async()=>{},verifyFinal:async()=>true,releaseProvisioningHold:async()=>{}};
  const first=createRootWorkflow(common),second=createRootWorkflow(common);
  const [a,b]=await Promise.all([first.plan(config),second.plan(config)]);synchronizing=true;
  const pending=[first.apply({planId:a.plan.id}),second.apply({planId:b.plan.id})];
  await began;releaseBootstrap();const results=await Promise.all(pending);
  assert.equal(bootstraps,1);assert.equal(results.filter(r=>r.codes.includes('PHYSICAL_BOOT_UNVERIFIED')).length,1);
  assert.equal(results.filter(r=>r.codes.includes('ROOT_RECOVERY_PENDING')).length,1);
});
test('host reservation is exclusive and a different identity cannot bypass or release it',async t=>{
  const options=storage(t),id='a'.repeat(32),lease=await runtime.reserve(config,{id,...options});
  await assert.rejects(runtime.reserve({...config,identity:__filename},{id:'b'.repeat(32),...options}),/ROOT_RESERVATION_HELD/);
  const prior=await runtime.recovery({...config,identity:__filename},options);assert.equal(prior.id,id);
  await assert.rejects(runtime.releaseReservation({...lease,id:'b'.repeat(32)},options),/ROOT_RESERVATION_OWNER/);
  assert.equal((await runtime.recovery(config,options)).id,id);
  await runtime.releaseReservation(lease,options);assert.equal(await runtime.recovery(config,options),null);
});
test('truncated crash reservation remains pending and cannot be silently recycled',async t=>{
  const options=storage(t);await runtime.reserve(config,{id:'c'.repeat(32),...options});
  const file=fs.readdirSync(options.directory).find(name=>/^host-[a-f0-9]{64}\.lock$/.test(name));
  assert.ok(file);await fsp.writeFile(path.join(options.directory,file),'{');
  const result=await runtime.recovery(config,options);assert.equal(result.phase,'reservation-unconfirmed');
  await assert.rejects(runtime.reserve(config,{id:'d'.repeat(32),...options}),/ROOT_RESERVATION_HELD/);
});
test('uncertain bootstrap retains the durable reservation for a fresh workflow and replacement identity',async t=>{
  const options=storage(t),common={assess:async()=>stock(),record:async()=>{},recovery:(input,id)=>runtime.recovery(input,{...options,ignoreReservation:id}),
    reserve:(input,request)=>runtime.reserve(input,{...request,...options}),releaseReservation:lease=>runtime.releaseReservation(lease,options),
    loadSources:async()=>({ipk:Buffer.from('fixture')}),derivePublicKey:async()=> 'public-key',routeIp:async()=> '10.20.30.41',runBootstrap:async()=>{throw Error('interrupted');}};
  const flow=createRootWorkflow(common),plan=await flow.plan(config),result=await flow.apply({planId:plan.plan.id});
  assert.equal(result.status,'partial');assert.equal((await runtime.recovery(config,options)).id,result.backupId);
  const fresh=createRootWorkflow(common),again=await fresh.plan({...config,identity:__filename});
  assert.ok(again.codes.includes('ROOT_RECOVERY_PENDING'));assert.equal(again.backupId,result.backupId);
});
test('state and recovery are checked again inside the owned reservation before source loading',async()=>{
  let held=false,checks=0,recoveries=0,downloads=0,releases=0;
  const flow=createRootWorkflow({assess:async(input,context)=>{
    checks++;if(checks===3){assert.equal(held,true);assert.match(context.ignoreReservation,/^[a-f0-9]{32}$/);return {...stock(),developerMode:{...stock().developerMode,signature:false}};}return stock();
  },recovery:async()=>{recoveries++;return null;},record:async()=>{},reserve:async(input,{id})=>{held=true;return {id,host:input.host};},releaseReservation:async()=>{held=false;releases++;},loadSources:async()=>{downloads++;}});
  const plan=await flow.plan(config),result=await flow.apply({planId:plan.plan.id});
  assert.ok(result.codes.includes('DEVMODE_SIGNATURE_INVALID'));assert.equal(downloads,0);assert.equal(recoveries,2);assert.equal(releases,1);
});
