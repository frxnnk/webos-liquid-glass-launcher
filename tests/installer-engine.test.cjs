'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const file=path.join(__dirname,'../installer/engine.cjs');
const api=fs.existsSync(file)?require(file):{};
function state(extra={}) {
  return Object.assign({uid:0,release:{version:'5.6.2-21',build:'jhericurl-jimna'},
    system:{modelName:'49UN7310PSC',firmwareVersion:'04.64.00',sdkVersion:'5.6.2',boardType:'K6LP_ATSC_BR'},
    general:{defaultApps:{home:'com.webos.app.home',browser:'keep-this'},homePromotion:'on',screenSaverAd:'on',adCookie:'on',customizedAd:'off'},
    option:{livePlus:'on',livePromotion:'on',webOSPromotionVideo:'on'},rdxd:{analyticsLog:true,crashLog:true},
    app:{id:'com.frxn.mipantalla',version:'0.7.11'},apps:[{id:'webos.day',systemApp:false,removable:true,version:'1.0'}]},extra);
}
function fixture(initial=state(),overrides={}) {
  assert.equal(typeof api.createEngine,'function','engine factory must exist');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mp-engine-'));
  const requests=[];let current=initial,now=1000,fail=null,held=null,installer=async()=>({status:'complete'});
  const transport={runRemote:async(script)=>{
    const request=JSON.parse(Buffer.from(/MP_REQUEST:([A-Za-z0-9+/=]+)/.exec(script)[1],'base64').toString());
    requests.push(request);if(fail&&(typeof fail==='string'||fail.action===request.action))throw Error('private TOKEN');
    if(request.action==='inspect'&&held){const wait=held;held=null;await wait;}
    if(request.action==='inspect')return {stdout:JSON.stringify({ok:true,snapshot:current})};
    return {stdout:JSON.stringify({ok:true,status:request.action==='restore'?'restored':'applied',removed:request.options&&request.options.removeApps||[],homeProof:'pending'})};
  }};
  const engine=api.createEngine(Object.assign({createTransport:()=>transport,journalDir:dir,now:()=>now,installPackage:(...args)=>installer(...args),
    ensureHomeHooks:async()=>({status:'complete',physicalProofPending:true,receipt:{version:1}}),restoreHomeHooks:async()=>({status:'complete'}),
    ensurePrivacyHook:async()=>({status:'complete',physicalProofPending:true,receipt:{version:1}}),restorePrivacyHook:async()=>({status:'complete'})},overrides));
  return {engine,requests,dir,setState:value=>{current=value;},setNow:value=>{now=value;},fail:value=>{fail=value;},holdInspect:value=>{held=value;},setInstaller:fn=>{installer=fn;},clean:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
const config={host:'192.168.1.20',identity:path.resolve('identity-fixture')};
test('status reports only a verified exact profile without exposing snapshots or identities',async()=>{
  const f=fixture();try{const result=await f.engine.runAction('status',config);
    assert.equal(result.status,'ready');assert.equal(result.device.supported,true);assert.equal(result.device.privilege,'root');
    assert.doesNotMatch(JSON.stringify(result),/keep-this|identity-fixture|defaultApps|fingerprint/);
    assert.deepEqual(f.requests.map(r=>r.action),['inspect']);
    assert.equal(result.capture.active,null);assert.equal(result.lights.active,null);assert.equal(result.capture.reason,'not-checked');
  }finally{f.clean();}
});
test('unsupported firmware, malformed identity and unconfirmed SSH never report original or root success',async()=>{
  const f=fixture(state({system:{modelName:'49UN7310PSC',firmwareVersion:'99',sdkVersion:'5.6.2',boardType:'K6LP_ATSC_BR'}}));
  try{let r=await f.engine.runAction('plan',Object.assign({},config,{options:{privacy:true}}));assert.equal(r.status,'blocked');assert.ok(r.codes.includes('PROFILE_UNSUPPORTED'));
    f.fail('private key TOKEN');r=await f.engine.runAction('status',config);assert.equal(r.status,'blocked');assert.equal(r.device.privilege,'unknown');assert.doesNotMatch(JSON.stringify(r),/TOKEN|original/);
    const before=f.requests.length;r=await f.engine.runAction('status',{host:'-bad',identity:'x'});assert.equal(r.status,'blocked');assert.equal(f.requests.length,before);
  }finally{f.clean();}
});
test('plans are read-only, expire after five minutes and apply accepts only their identifier',async()=>{
  const f=fixture();try{const p=await f.engine.runAction('plan',Object.assign({},config,{options:{privacy:true,home:true}}));
    assert.equal(p.status,'planned');assert.match(p.plan.id,/^[a-f0-9]{32}$/);assert.equal(p.plan.expiresAt,301000);
    assert.deepEqual(f.requests.map(r=>r.action),['inspect']);assert.deepEqual(fs.readdirSync(f.dir),[]);
    let r=await f.engine.runAction('apply',{host:config.host});assert.equal(r.status,'blocked');
    f.setNow(301001);r=await f.engine.runAction('apply',{planId:p.plan.id});assert.ok(r.codes.includes('PLAN_EXPIRED'));
    assert.equal(f.requests.length,1);
  }finally{f.clean();}
});
test('apply revalidates before any write and drift invalidates the plan',async()=>{
  const f=fixture();try{const p=await f.engine.runAction('plan',Object.assign({},config,{options:{privacy:true}}));
    f.setState(state({general:{defaultApps:{home:'changed'}}}));const r=await f.engine.runAction('apply',{planId:p.plan.id});
    assert.equal(r.status,'blocked');assert.ok(r.codes.includes('STATE_CHANGED'));assert.deepEqual(f.requests.map(r=>r.action),['inspect','inspect']);assert.deepEqual(fs.readdirSync(f.dir),[]);
  }finally{f.clean();}
});
test('privacy and Home write only through a prepared plan, record a backup and expose pending Home proof',async()=>{
  const f=fixture();try{const p=await f.engine.runAction('plan',Object.assign({},config,{options:{privacy:true,home:true}}));
    const r=await f.engine.runAction('apply',{planId:p.plan.id});assert.equal(r.status,'partial');assert.ok(r.codes.includes('HOME_RUNTIME_UNVERIFIED'));assert.match(r.backupId,/^[a-f0-9]{32}$/);
    assert.deepEqual(f.requests.map(x=>x.action),['inspect','inspect','apply']);assert.equal(fs.readdirSync(f.dir).length,1);
    assert.doesNotMatch(JSON.stringify(r),/keep-this|defaultApps|identity-fixture/);
    const restore=await f.engine.runAction('restore',{backupId:r.backupId});assert.equal(restore.status,'complete');assert.equal(f.requests.at(-1).action,'restore');
    const repeat=await f.engine.runAction('apply',{planId:p.plan.id});assert.equal(repeat.status,'blocked');
  }finally{f.clean();}
});
test('only three LG apps are removable, opt-in, and absent apps are skipped',async()=>{
  const f=fixture();try{for(const id of ['netflix','com.frxn.mipantalla','org.webosbrew.hbchannel','com.webos.app.home']){
    const r=await f.engine.runAction('plan',Object.assign({},config,{options:{removeApps:[id]}}));assert.equal(r.status,'blocked');}
    let p=await f.engine.runAction('plan',Object.assign({},config,{options:{removeApps:['webos.day']}}));assert.equal(p.status,'planned');
    let r=await f.engine.runAction('apply',{planId:p.plan.id});assert.equal(r.status,'complete');
    r=await f.engine.runAction('restore',{backupId:r.backupId});assert.equal(r.status,'partial');assert.ok(r.codes.includes('APPS_REINSTALL_MANUAL'));
    f.setState(state({apps:[{id:'webos.day',systemApp:true,removable:true}]}));p=await f.engine.runAction('plan',Object.assign({},config,{options:{removeApps:['webos.day']}}));assert.equal(p.status,'blocked');
  }finally{f.clean();}
});
test('unknown privileges and root opt-in remain manual pending without an exploit attempt',async()=>{
  const f=fixture(state({uid:1000}));try{const p=await f.engine.runAction('plan',Object.assign({},config,{options:{privacy:true,root:true}}));assert.equal(p.status,'blocked');assert.ok(p.codes.includes('ROOT_MANUAL_PENDING'));assert.deepEqual(f.requests.map(x=>x.action),['inspect']);}finally{f.clean();}
});
test('failed mutations return fixed partial states and keep the backup available without retries',async()=>{
  const f=fixture();try{const p=await f.engine.runAction('plan',Object.assign({},config,{options:{privacy:true}}));
    const original=f.engine;
    f.fail('SECRET');const r=await original.runAction('apply',{planId:p.plan.id});assert.equal(r.status,'blocked');assert.doesNotMatch(JSON.stringify(r),/SECRET/);assert.deepEqual(fs.readdirSync(f.dir),[]);
  }finally{f.clean();}
});
test('status recovers only a matching target backup and blocks a new plan while a mutation is unconfirmed',async()=>{
  const f=fixture();try{let p=await f.engine.runAction('plan',Object.assign({},config,{options:{privacy:true}}));f.fail({action:'apply'});
    const applied=await f.engine.runAction('apply',{planId:p.plan.id});assert.equal(applied.status,'partial');f.fail(null);
    let r=await f.engine.runAction('status',config);assert.equal(r.backupId,applied.backupId);assert.equal(r.recovery.pending,true);assert.equal(r.status,'partial');
    p=await f.engine.runAction('plan',Object.assign({},config,{options:{privacy:true}}));assert.equal(p.status,'blocked');assert.ok(p.codes.includes('RECOVERY_PENDING'));
    r=await f.engine.runAction('status',Object.assign({},config,{host:'192.168.1.21'}));assert.equal(r.backupId,undefined);
    r=await f.engine.runAction('restore',{backupId:applied.backupId});assert.equal(r.status,'complete');
    r=await f.engine.runAction('status',config);assert.equal(r.recovery.phase,'restored');assert.equal(r.recovery.pending,false);
  }finally{f.clean();}
});
test('status cannot confirm an older journal while the next apply is still revalidating',async()=>{
  const f=fixture();let release;
  try{let p=await f.engine.runAction('plan',Object.assign({},config,{options:{privacy:true}}));const first=await f.engine.runAction('apply',{planId:p.plan.id});
    f.setNow(2000);p=await f.engine.runAction('plan',Object.assign({},config,{options:{privacy:true}}));
    f.holdInspect(new Promise(resolve=>{release=resolve;}));const running=f.engine.runAction('apply',{planId:p.plan.id});
    const status=await f.engine.runAction('status',config);assert.equal(status.recovery.pending,true);assert.equal(status.recovery.phase,'inflight');assert.notEqual(status.backupId,first.backupId);
    const busy=await f.engine.runAction('restore',{backupId:first.backupId});assert.ok(busy.codes.includes('BUSY'));
    release();await running;
  }finally{if(release)release();f.clean();}
});
test('an installation that finishes after its acknowledgement is lost remains manual on restore',async()=>{
  const f=fixture(state({app:null}));try{
    f.setInstaller(async()=>{f.setState(state());throw Error('private timeout');});
    const p=await f.engine.runAction('plan',Object.assign({},config,{options:{install:true}}));
    const applied=await f.engine.runAction('apply',{planId:p.plan.id});assert.equal(applied.status,'partial');
    const restored=await f.engine.runAction('restore',{backupId:applied.backupId});assert.equal(restored.status,'partial');assert.ok(restored.codes.includes('PACKAGE_RESTORE_MANUAL'));
  }finally{f.clean();}
});
test('a partial app removal with a lost acknowledgement never becomes a complete restore',async()=>{
  const f=fixture();try{
    const p=await f.engine.runAction('plan',Object.assign({},config,{options:{removeApps:['webos.day']}}));
    f.fail({action:'apply'});const applied=await f.engine.runAction('apply',{planId:p.plan.id});assert.equal(applied.status,'partial');
    f.fail(null);f.setState(state({apps:[]}));
    const restored=await f.engine.runAction('restore',{backupId:applied.backupId});
    assert.equal(restored.status,'partial');assert.ok(restored.codes.includes('APPS_REINSTALL_MANUAL'));
  }finally{f.clean();}
});
test('interrupted journal replacements preserve the prepared recovery record and remove their transaction files',async()=>{
  const journalFs=Object.create(fs);let writes=0;
  journalFs.writeFileSync=(fd,body)=>{
    if(++writes>1){fs.writeFileSync(fd,String(body).slice(0,20));throw Error('simulated write interruption');}
    fs.writeFileSync(fd,body);
  };
  const f=fixture(state(),{journalFs});try{
    const p=await f.engine.runAction('plan',Object.assign({},config,{options:{privacy:true}}));
    const applied=await f.engine.runAction('apply',{planId:p.plan.id});assert.equal(applied.status,'partial');
    const names=fs.readdirSync(f.dir);assert.deepEqual(names,[applied.backupId+'.json']);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir,names[0]),'utf8')).phase,'prepared');
    const status=await f.engine.runAction('status',config);assert.equal(status.backupId,applied.backupId);assert.equal(status.recovery.pending,true);
  }finally{f.clean();}
});
