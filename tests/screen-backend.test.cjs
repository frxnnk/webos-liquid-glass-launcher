const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const file=path.join(__dirname,'../services/com.frxn.mipantalla.lights/screen-backend.js');
const ids=['wiz-aabbcc001122','wiz-aabbcc003344'];
const lamps=ids.map((id,i)=>({id,ip:'192.168.1.'+(40+i),reachable:true}));
function setup(change=()=>{},options={}) {
  assert.ok(fs.existsSync(file),'screen diagnostic backend must exist');
  const data={admin:{adminRequired:false},server:{currentInstance:0,
    instance:[{instance:0,friendly_name:'Mi pantalla WiZ Living',running:true}],
    components:[{name:'LEDDEVICE',enabled:false}],priorities:[]},
    config:{device:{type:'wiz',port:38899,lamps:lamps.map(d=>({ipAddress:d.ip,macAddress:d.id.slice(4)}))},
      leds:ids.map(()=>({hmin:0,hmax:1,vmin:0,vmax:1}))}};
  const calls=[];let closed=0,connections=0;
  const rpc={connect:async()=>{connections++;return {request:async command=>{
    calls.push(command);
    if(options.request){const result=await options.request(command,data);if(result!==undefined)return result;}
    if(command.command==='componentstate') data.server.components[0].enabled=command.componentstate.state;
    return {success:true,info:command.command==='serverinfo'?data.server:
      command.command==='config'?data.config:data.admin};},close(){closed++;}};}};
  const config={enabled:true,token:'synthetic-user-token-not-a-secret',profile:'Mi pantalla WiZ Living',
    hardwareVerified:true};
  change(data,config,rpc);
  const backend=require(file)({...options,config,rpc,read:options.read||(async()=>({devices:lamps})),
    probe:options.probe||(async()=>({framesVerified:false,sourceFreshness:'unknown'}))});
  return {backend,data,calls,get closed(){return closed;},get connections(){return connections;}};
}
test('screen backend defaults to prepared without making any connection',async()=>{
  const t=setup((data,config)=>{config.enabled=false;});
  const status=await t.backend.inspect([]);
  assert.equal(status.reason,'setup-pending');assert.equal(status.ready,false);assert.equal(t.connections,0);
});
test('screen diagnostic verifies exact local instance and selected WiZ config but never invents frame proof',async()=>{
  const t=setup();const result=await t.backend.inspect(ids);
  assert.equal(result.configVerified,true);assert.equal(result.ready,false);
  assert.equal(result.framesVerified,false);assert.equal(result.hardwareVerified,true);
  assert.equal(result.sourceFreshness,'unknown');assert.equal(result.reason,'frames-unverified');
  assert.ok(t.calls.every(c=>['authorize','serverinfo','config'].includes(c.command)));
  assert.equal(t.closed,1);assert.doesNotMatch(JSON.stringify(result),/192\.168|aabbcc|synthetic|token/);
});
test('screen diagnostic works without selection, without lamp reads or mutation',async()=>{
  const t=setup();const result=await t.backend.inspect([]);
  assert.equal(result.reason,'selection-required');assert.equal(result.configVerified,false);
  assert.equal(t.calls.some(c=>c.command==='componentstate'),false);
});
test('screen diagnostic rejects mismatched admin, profile, instance, driver, layout, MAC or current IP',async()=>{
  const cases=[
    [d=>{d.admin.adminRequired=true;},'admin-required'],
    [d=>{d.server.currentInstance=1;},'instance-mismatch'],
    [d=>{d.server.instance[0].friendly_name='Another room';},'profile-mismatch'],
    [d=>{d.config.device.type='other';},'selection-mismatch'],
    [d=>{d.config.device.lamps.push(d.config.device.lamps[0]);},'selection-mismatch'],
    [d=>{d.config.device.lamps[0].macAddress='aabbcc000000';},'selection-mismatch'],
    [d=>{d.config.device.lamps[0].ipAddress='192.168.1.99';},'selection-mismatch'],
    [d=>{d.config.leds=[];},'selection-mismatch'],
    [d=>{d.config.leds[0].disabled=true;},'selection-mismatch']
  ];
  for(const [change,reason] of cases){const t=setup(change);const status=await t.backend.inspect(ids);
    assert.equal(status.ready,false);assert.equal(status.reason,reason);assert.equal(t.closed,1);}
});
test('a foreign enabled output is reported without being stopped',async()=>{
  const t=setup(d=>{d.server.components[0].enabled=true;});
  const status=await t.backend.inspect(ids);
  assert.equal(status.reason,'output-in-use');assert.equal(status.active,false);
  assert.equal(t.calls.some(c=>c.command==='componentstate'),false);
});
test('transport errors cannot expose credentials or raw server messages',async()=>{
  const t=setup((d,c,rpc)=>{rpc.connect=async()=>{throw Error('secret-token at 192.168.1.40');};});
  const status=await t.backend.inspect(ids);
  assert.equal(status.reason,'offline');assert.doesNotMatch(JSON.stringify(status),/secret|192\.168/);
});
test('physical output attestation is required separately from fresh frames',async()=>{
  const t=setup((d,c)=>{c.hardwareVerified=false;},{probe:async()=>({framesVerified:true,sourceFreshness:'fresh'})});
  const status=await t.backend.inspect(ids);
  assert.equal(status.framesVerified,true);assert.equal(status.hardwareVerified,false);
  assert.equal(status.ready,false);assert.equal(status.reason,'hardware-unverified');
});
test('fresh connected PicCap frames plus attestation make the output ready',async()=>{
  const t=setup(()=>{}, {probe:async()=>({framesVerified:true,sourceFreshness:'fresh'})});
  const status=await t.backend.inspect(ids);
  assert.equal(status.ready,true);assert.equal(status.reason,'');assert.equal(status.active,false);
  assert.equal(status.framesVerified,true);assert.equal(status.hardwareVerified,true);
  assert.equal(status.sourceFreshness,'fresh');
});
test('frame probe failure keeps activation blocked without mutating the output',async()=>{
  const t=setup(()=>{}, {probe:async()=>{throw Error('probe failed');}});
  const status=await t.backend.inspect(ids);
  assert.equal(status.ready,false);assert.equal(status.reason,'frames-unverified');
  await assert.rejects(t.backend.start(ids),e=>e.reason==='frames-unverified');
  assert.equal(t.calls.some(c=>c.command==='componentstate'),false);
});
test('start enables the verified output only with fresh frames and confirms LEDDEVICE',async()=>{
  const t=setup(()=>{}, {probe:async()=>({framesVerified:true,sourceFreshness:'fresh'})});
  const result=await t.backend.start(ids);
  assert.deepEqual(result,{active:true});
  assert.equal(t.calls.filter(c=>c.command==='componentstate').length,1);
  assert.deepEqual(t.calls.find(c=>c.command==='componentstate').componentstate,{component:'LEDDEVICE',state:true});
  assert.equal(t.data.server.components[0].enabled,true);
});
test('start refuses a foreign enabled output without stopping it',async()=>{
  const t=setup(d=>{d.server.components[0].enabled=true;},{probe:async()=>({framesVerified:true,sourceFreshness:'fresh'})});
  await assert.rejects(t.backend.start(ids),e=>e.reason==='output-in-use');
  assert.equal(t.calls.some(c=>c.command==='componentstate'),false);
});

test('an expired operation after slow preflight cannot issue a late LED enable',async()=>{
  let alive=true;
  const t=setup(()=>{},{probe:async()=>({framesVerified:true}),request:async q=>{
    if(q.command==='config')alive=false;
  }});
  await assert.rejects(t.backend.start(ids,{canContinue:()=>alive}),e=>e.reason==='timeout');
  assert.equal(t.calls.some(q=>q.command==='componentstate'),false);
});

test('start waits for the asynchronous driver state after ACK without repeating enable or compensating early',async()=>{
  let data,waits=0;
  const t=setup(d=>{data=d;},{probe:async()=>({framesVerified:true}),
    request:async q=>q.command==='componentstate'?{success:true}:undefined,
    wait:async ms=>{assert.equal(ms,100);waits++;data.server.components[0].enabled=true;}});
  assert.deepEqual(await t.backend.start(ids),{active:true});
  assert.equal(waits,1);
  assert.deepEqual(t.calls.filter(q=>q.command==='componentstate').map(q=>q.componentstate.state),[true]);
  assert.equal(t.closed,1);
});

test('stop waits for asynchronous off confirmation before allowing baseline restoration',async()=>{
  let data,waits=0;
  const t=setup(d=>{data=d;d.server.components[0].enabled=true;},{
    request:async q=>q.command==='componentstate'?{success:true}:undefined,
    wait:async()=>{waits++;data.server.components[0].enabled=false;}});
  assert.deepEqual(await t.backend.stop(ids),{active:false});
  assert.equal(waits,1);
  assert.deepEqual(t.calls.filter(q=>q.command==='componentstate').map(q=>q.componentstate.state),[false]);
});

test('owned stop confirms the writer OFF without querying unreachable lamps while it is still flooding them',async()=>{
  let reads=0;
  const t=setup(d=>{d.server.components[0].enabled=true;},{read:async()=>{reads++;throw Error('WiZ timeout while output active');}});
  assert.deepEqual(await t.backend.stop(ids),{active:false});
  assert.equal(reads,0,'live UDP response is not a precondition for stopping the owned writer');
  assert.deepEqual(t.calls.filter(q=>q.command==='componentstate').map(q=>q.componentstate.state),[false]);
  assert.equal(t.data.server.components[0].enabled,false);
});

test('owned stop still rejects foreign profiles, selections and invalid static output configuration without lamp reads or mutation',async()=>{
  const cases=[
    d=>{d.admin.adminRequired=true;},
    d=>{d.server.currentInstance=1;},
    d=>{d.server.instance[0].running=false;},
    d=>{d.server.instance[0].friendly_name='Another room';},
    d=>{d.config.device.type='other';},
    d=>{d.config.device.port=1234;},
    d=>{d.config.device.lamps[0].macAddress=ids[1].slice(4);},
    d=>{d.config.device.lamps[0].macAddress='aabbcc000000';},
    d=>{d.config.device.lamps[0].macAddress='invalid';},
    d=>{d.config.device.lamps[0].ipAddress='8.8.8.8';},
    d=>{d.config.device.lamps[0].ipAddress='not-an-ip';},
    d=>{d.config.device.lamps[0].ipAddress=d.config.device.lamps[1].ipAddress;},
    d=>{d.config.leds=[];},
    d=>{d.config.leds[0].disabled=true;},
    d=>{d.config.leds[0].hmin=1;},
    d=>{d.config.leds[0].vmax=2;}
  ];
  for(const change of cases){
    let reads=0;
    const t=setup(d=>{d.server.components[0].enabled=true;change(d);},{read:async()=>{reads++;throw Error('must not query');}});
    await assert.rejects(t.backend.stop(ids),e=>e.code==='SCREEN_STOP_UNCONFIRMED');
    assert.equal(reads,0);assert.equal(t.calls.some(q=>q.command==='componentstate'),false);
  }
  for(const selected of [[],[ids[0],ids[0]],[ids[0]],['invalid']]){
    const t=setup(d=>{d.server.components[0].enabled=true;});
    await assert.rejects(t.backend.stop(selected),e=>e.code==='SCREEN_STOP_UNCONFIRMED');
    assert.equal(t.calls.some(q=>q.command==='componentstate'),false);
  }
});

test('start and inspect retain strict live WiZ identity and current-IP confirmation',async()=>{
  for(const devices of [lamps.map(lamp=>({...lamp,reachable:false})),lamps.map(lamp=>({...lamp,ip:lamps[0].ip}))]){
    let reads=0;
    const t=setup(()=>{},{read:async()=>{reads++;return {devices};},probe:async()=>({framesVerified:true})});
    const status=await t.backend.inspect(ids);
    assert.equal(status.configVerified,false);assert.equal(status.ready,false);assert.equal(status.reason,'selection-mismatch');
    await assert.rejects(t.backend.start(ids),e=>e.reason==='selection-mismatch');
    assert.equal(reads,2);assert.equal(t.calls.some(q=>q.command==='componentstate'),false);
  }
});

test('an uncertain issued enable compensates OFF even when live lamp reads stop responding after enable',async()=>{
  let clock=0,reads=0,enabledIssued=false;
  const t=setup(()=>{},{probe:async()=>({framesVerified:true}),now:()=>clock,
    read:async()=>{reads++;if(enabledIssued)throw Error('WiZ overloaded');return {devices:lamps};},
    request:async q=>{if(q.command==='componentstate'&&q.componentstate.state){enabledIssued=true;return {success:true};}},
    wait:async ms=>{clock+=ms;}});
  await assert.rejects(t.backend.start(ids),e=>e.reason==='timeout');
  assert.deepEqual(t.calls.filter(q=>q.command==='componentstate').map(q=>q.componentstate.state),[true,false]);
  assert.equal(reads,1,'compensation uses authenticated ownership rather than another failing live query');
});

test('an uncompleted enable has a real elapsed deadline then compensates off exactly once',async()=>{
  let clock=0,waits=0;
  const t=setup(()=>{},{probe:async()=>({framesVerified:true}),now:()=>clock,
    request:async q=>q.command==='componentstate'&&q.componentstate.state?{success:true}:undefined,
    wait:async ms=>{clock+=ms;waits++;}});
  await assert.rejects(t.backend.start(ids),e=>e.reason==='timeout');
  assert.equal(clock,2500);assert.equal(waits,25);
  assert.deepEqual(t.calls.filter(q=>q.command==='componentstate').map(q=>q.componentstate.state),[true,false]);
  assert.equal(t.data.server.components[0].enabled,false);
});

test('stop never reports stopped from ACK when the driver remains enabled at the deadline',async()=>{
  let clock=0;
  const t=setup(d=>{d.server.components[0].enabled=true;},{now:()=>clock,
    request:async q=>q.command==='componentstate'?{success:true}:undefined,
    wait:async ms=>{clock+=ms;}});
  await assert.rejects(t.backend.stop(ids),e=>e.code==='SCREEN_STOP_UNCONFIRMED');
  assert.equal(clock,2500);
  assert.deepEqual(t.calls.filter(q=>q.command==='componentstate').map(q=>q.componentstate.state),[false]);
});

test('a hung state query expires at the hard deadline and a late reply cannot resume activation',{timeout:500},async()=>{
  let requested=false,release,deadlineMs;
  const t=setup(()=>{},{probe:async()=>({framesVerified:true}),
    setTimer:(fn,ms)=>{deadlineMs=ms;return setTimeout(fn,10);},clearTimer:clearTimeout,
    request:async q=>{
      if(q.command==='componentstate'){requested=q.componentstate.state;return undefined;}
      if(q.command==='serverinfo'&&requested&&!release)return new Promise(resolve=>{release=resolve;});
    }});
  await assert.rejects(t.backend.start(ids),e=>e.reason==='timeout');
  assert.equal(deadlineMs,2500);assert.ok(release);
  const before=t.calls.length;
  release({success:true,info:t.data.server});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(t.calls.length,before);
  assert.deepEqual(t.calls.filter(q=>q.command==='componentstate').map(q=>q.componentstate.state),[true,false]);
});

test('an auth-required connect renews once, retries with the new token and reports a normal status',async()=>{
  let tokens=[],renewals=0;
  const t=setup((data,config,rpc)=>{
    const ok=rpc.connect;
    rpc.connect=async()=>{tokens.push(config.token);if(config.token==='stale-token-not-a-secret')throw Object.assign(Error('auth'),{code:'HYPERHDR_AUTH_REQUIRED'});return ok();};
    config.token='stale-token-not-a-secret';
  },{renew:async()=>{renewals++;return 'fresh-token-not-a-secret';}});
  const status=await t.backend.inspect(ids);
  assert.equal(renewals,1);assert.deepEqual(tokens,['stale-token-not-a-secret','fresh-token-not-a-secret']);
  assert.equal(status.configVerified,true);assert.equal(status.outputEnabled,false);
  assert.notEqual(status.reason,'auth-required');
});
test('when renewal fails the original auth-required result is kept and nothing is retried',async()=>{
  let connects=0,renewals=0;
  const t=setup((data,config,rpc)=>{rpc.connect=async()=>{connects++;throw Object.assign(Error('auth'),{code:'HYPERHDR_AUTH_REQUIRED'});};},
    {renew:async()=>{renewals++;throw Object.assign(Error('cooldown'),{code:'RENEW_COOLDOWN'});}});
  const status=await t.backend.inspect(ids);
  assert.equal(status.reason,'auth-required');assert.equal(connects,1);assert.equal(renewals,1);
});
test('other connection errors never trigger a renewal',async()=>{
  let renewals=0;
  const t=setup((data,config,rpc)=>{rpc.connect=async()=>{throw Object.assign(Error('down'),{code:'HYPERHDR_CONNECTION'});};},
    {renew:async()=>{renewals++;return 'x';}});
  await t.backend.inspect(ids);assert.equal(renewals,0);
});
