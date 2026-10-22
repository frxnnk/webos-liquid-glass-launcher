const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
test('screen wiring adapts selected id arrays to the existing lamp API payload for probe and baseline',async()=>{
  const ids=['wiz-aabbcc001122'];let backendRead,sessionRead,backendProbe;
  const mod={exports:{}};
  const fakes={
    path,
    './screen-settings':()=>({enabled:false}),
    './hyperhdr-rpc':()=>({}),'./hyperhdr-renew':()=>({renew:()=>Promise.reject(Error('RENEW_UNAVAILABLE'))}),
    './screen-backend':options=>{backendRead=options.read;backendProbe=options.probe;return {inspect:async()=>({ready:false})};},
    './screen-session':{create:options=>{sessionRead=options.read;return {pending:()=>null};}},
    './screen-store':()=>({})
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../services/com.frxn.mipantalla.lights/screen-control.js'),'utf8'),
    {module:mod,__dirname:'/synthetic-app',require:name=>{assert.ok(name in fakes,name);return fakes[name];}});
  let reads=0;
  const probe=async()=>({framesVerified:true});
  mod.exports({read:async payload=>{assert.deepEqual(JSON.parse(JSON.stringify(payload)),{ids});reads++;return {devices:[]};},
    write:()=>{throw Error('unexpected write');}},{probe});
  await backendRead(ids);await sessionRead(ids);
  assert.equal(reads,2);assert.equal(backendProbe,probe);
});

function statusHarness(report,record) {
  const mod={exports:{}};
  const fakes={path,'./screen-settings':()=>({enabled:true}),'./hyperhdr-rpc':()=>({}),'./hyperhdr-renew':()=>({renew:()=>Promise.reject(Error('RENEW_UNAVAILABLE'))}),
    './screen-backend':()=>({inspect:async()=>Object.assign({},report)}),
    './screen-session':{create:()=>({pending:()=>record})},'./screen-store':()=>({})};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../services/com.frxn.mipantalla.lights/screen-control.js'),'utf8'),
    {module:mod,__dirname:'/synthetic-app',require:name=>fakes[name]});
  return mod.exports({read:async()=>({devices:[]}),write:()=>{throw Error('unexpected write');}});
}
const ID='wiz-aabbcc001122';
const LIVE={configured:true,available:true,ready:false,active:false,outputEnabled:true,
  configVerified:true,hardwareVerified:true,framesVerified:true,sourceFreshness:'fresh',reason:'output-in-use'};
test('screen facade recognizes only its live active session without allowing another start',async()=>{
  const control=statusHarness(LIVE,{phase:'active',ids:[ID]});
  const state=await control.status([ID]);
  assert.equal(state.active,true);assert.equal(state.pending,true);assert.equal(state.phase,'active');
  assert.equal(state.ready,false);assert.equal(state.reason,'');
});
test('screen facade preserves recovery for prepared, restoring, stale and mismatched sessions',async()=>{
  const cases=[{phase:'prepared'},{phase:'restoring'},{patch:{outputEnabled:false}},
    {patch:{configVerified:false}},{patch:{hardwareVerified:false}},{patch:{framesVerified:false}},
    {patch:{sourceFreshness:'unknown'}},{patch:{available:false}},{ids:['wiz-aabbcc334455']}];
  for(const item of cases){
    const state=await statusHarness(Object.assign({},LIVE,item.patch),
      {phase:item.phase||'active',ids:item.ids||[ID]}).status([ID]);
    assert.equal(state.active,false,JSON.stringify(item));assert.equal(state.ready,false);
    assert.equal(state.pending,true);assert.equal(state.reason,'restore-pending');
  }
  const foreign=await statusHarness(LIVE,null).status([ID]);
  assert.equal(foreign.active,false);assert.equal(foreign.reason,'output-in-use');
});
