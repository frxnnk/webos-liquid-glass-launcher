const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const file=path.join(__dirname,'../services/com.frxn.mipantalla.lights/controller.js');
const id='wiz-aabbcc001122';
const ip=[192,168,50,20].join('.');
function setup(query, screen, screenProbe) {
  assert.ok(fs.existsSync(file),'WiZ controller must exist');
  let discoveryCount=0,factoryOptions;
  const calls=[];
  const transport={discover:async()=>{
    discoveryCount++;
    return [{ip,pilot:{mac:id.slice(4),state:true,dimming:40},system:{mac:id.slice(4),roomId:123,moduleName:'ESP01_SHRGB1C_31'}}];
  },query:async(address,method,params)=>{
    calls.push({address,method,params});
    return query?query(address,method,params,calls):{mac:id.slice(4),state:true,dimming:40};
  }};
  return {controller:require(file)(transport,{settle:()=>Promise.resolve(),screenProbe,
    screenFactory:screen && ((lamps,options)=>{factoryOptions=options;return screen;})}),calls,
    discoveryCount:()=>discoveryCount,factoryOptions:()=>factoryOptions};
}

test('WiZ controller discovers actual devices without selecting or changing any lights',async()=>{
  const {controller,calls}=setup();
  const result=await controller.discover();
  assert.equal(result.devices[0].id,id);
  assert.equal(result.devices[0].room,'123');
  assert.deepEqual(calls,[]);
  assert.equal(controller.capabilities().screenSync,false);
});

test('WiZ controller rejects empty selection and invalid writes before network effects',async()=>{
  const t=setup();
  for(const p of [{ids:[],on:true},{ids:[id],rgb:[0,2,999]},{ids:[id],method:'reboot'},{ids:[id],on:'yes'}]) {
    await assert.rejects(t.controller.setState(p),/selección|inválid/i);
  }
  assert.equal(t.discoveryCount(),0);
  assert.equal(t.calls.length,0);
});

test('WiZ writes revalidate identity before setPilot and report a fresh readback',async()=>{
  let on=true;
  const t=setup((address,method,params)=>{
    if(method==='setPilot'){on=params.state;return {success:true};}
    return {mac:id.slice(4),state:on,dimming:40};
  });
  const result=await t.controller.setState({ids:[id],on:false});
  assert.deepEqual(t.calls.map(c=>c.method),['getPilot','setPilot','getPilot']);
  assert.equal(result.devices[0].state.on,false);
  assert.equal(result.devices[0].confirmed,true);
});

test('WiZ identity mismatch and undiscovered IDs cannot send writes',async()=>{
  const t=setup(()=>({mac:'aabbcc445566',state:true}));
  const result=await t.controller.setState({ids:[id,'wiz-aabbcc778899'],on:false});
  assert.equal(t.calls.some(c=>c.method==='setPilot'),false);
  assert.ok(result.devices.every(d=>d.error));
});

test('WiZ uncertain writes return unknown state, with no automatic retry',async()=>{
  const t=setup((address,method)=>{
    if(method==='setPilot')throw Error('No confirmation');
    return {mac:id.slice(4),state:true};
  });
  const result=await t.controller.setState({ids:[id],on:false});
  assert.equal(t.calls.filter(c=>c.method==='setPilot').length,1);
  assert.equal(result.devices[0].state,null);
  assert.equal(result.devices[0].confirmed,false);
  assert.equal(result.devices[0].reachable,false);
});

test('WiZ ACK without matching readback is not a confirmed change',async()=>{
  const t=setup((address,method)=>method==='setPilot'?{success:true}:{mac:id.slice(4),state:true,dimming:40});
  const result=await t.controller.setState({ids:[id],on:false});
  assert.equal(result.devices[0].confirmed,false);
  assert.equal(result.devices[0].reachable,true);
  assert.equal(result.devices[0].state.on,true,'the actual readable state must be preserved');
  assert.match(result.devices[0].error,/coincide|confirm/i);
});

test('WiZ scene restoration requires the exact scene in the fresh readback',async()=>{
  for (const observedScene of [6,7,undefined]) {
    const t=setup((address,method)=>method==='setPilot'?{success:true}:
      {mac:id.slice(4),state:true,dimming:35,sceneId:observedScene});
    const result=await t.controller.setState({ids:[id],on:true,brightness:35,sceneId:6});
    assert.deepEqual(t.calls.find(c=>c.method==='setPilot').params,{state:true,dimming:35,sceneId:6});
    assert.equal(result.devices[0].confirmed,observedScene===6);
    assert.equal(t.calls.filter(c=>c.method==='getPilot').length,2);
  }
});

test('WiZ getState rediscovers selected IDs after service restart and keeps failures unknown',async()=>{
  const t=setup(()=>{throw Error('offline');});
  const result=await t.controller.getState({ids:[id]});
  assert.equal(t.discoveryCount(),1);
  assert.equal(result.devices[0].state,null);
  assert.equal(result.devices[0].reachable,false);
});

test('WiZ does not advertise screen synchronization before capture has been verified',async()=>{
  const {controller}=setup();
  await assert.rejects(controller.setMode({mode:'ambient',source:'screen',ids:[id]}),/captura|disponible/i);
  assert.equal((await controller.setMode({mode:'manual',ids:[id]})).mode,'manual');
});

test('screen probe is handed to the screen backend as its own option',()=>{
  const probe=async()=>({framesVerified:true});
  const t=setup(null,{pending:()=>null,status:async()=>({ready:false})},probe);
  assert.equal(t.factoryOptions().probe,probe);
});

test('screen status is an explicit read and never changes lamps or claims capture readiness',async()=>{
  let inspected=0;
  const screen={pending:()=>null,status:async ids=>{inspected++;return {ready:false,reason:'setup-pending'};}};
  const t=setup(null,screen);
  assert.equal(t.controller.capabilities().screenSync,true);assert.equal(inspected,0);
  assert.equal((await t.controller.screenStatus({ids:[]})).reason,'setup-pending');
  assert.equal(inspected,1);assert.equal(t.calls.length,0);
});
test('manual commands wait for screen restoration and cannot proceed when restoration fails',async()=>{
  const order=[];let pending=true,fail=true,on=true;
  const screen={pending:()=>pending?{phase:'active'}:null,stop:async()=>{
    order.push('stop-and-restore');if(fail)throw Error('SCREEN_RESTORE_PENDING');pending=false;return {active:false};}};
  const t=setup((a,method,params)=>{order.push(method);if(method==='setPilot'){on=params.state;return {success:true};}
    return {mac:id.slice(4),state:on,dimming:40};},screen);
  assert.equal(t.controller.capabilities().mode,'screen');
  await assert.rejects(t.controller.setState({ids:[id],rgb:[999,0,0]}),/inválid/i);
  assert.deepEqual(order,[],'invalid input does not stop the existing mode');
  await assert.rejects(t.controller.setState({ids:[id],on:false}),/SCREEN_RESTORE_PENDING/);
  assert.deepEqual(order,['stop-and-restore']);assert.equal(t.calls.length,0);
  fail=false;order.length=0;
  const result=await t.controller.setState({ids:[id],on:false});
  assert.deepEqual(order,['stop-and-restore','getPilot','setPilot','getPilot']);
  assert.equal(result.mode,'manual');assert.equal(t.controller.capabilities().mode,'manual');
});
test('screen mode validates source and ids before delegating, while Manual restores pending state',async()=>{
  const calls=[];let pending=true;
  const t=setup(null,{pending:()=>pending?{}:null,start:async ids=>{calls.push(ids);return {active:true};},
    stop:async()=>{calls.push('stop');pending=false;return {active:false};}});
  await assert.rejects(t.controller.setMode({mode:'screen',source:'wallpaper',ids:[id]}));
  assert.deepEqual(calls,[]);
  assert.equal((await t.controller.setMode({mode:'screen',source:'screen',ids:[id]})).mode,'screen');
  assert.equal((await t.controller.setMode({mode:'manual'})).mode,'manual');
  assert.deepEqual(calls,[[id],'stop']);
});
