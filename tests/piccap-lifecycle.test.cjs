const {test}=require('node:test');
const assert=require('node:assert/strict');
const create=options=>require('../services/com.frxn.mipantalla.lights/piccap-lifecycle')(options);
const SETTINGS={address:'127.0.0.1',port:19400,priority:150,'unix-socket':false,width:320,height:180,fps:30,
  autostart:false,novideo:false,nogui:false,quirks:0,backend:'libvtcapture',uibackend:'libhalgal'};
const OFF={isRunning:false,uiRunning:false,videoRunning:false,connected:false,framerate:30,version:'00c932f-mipantalla-single-owner1'};
const ON={isRunning:true,uiRunning:true,videoRunning:true,connected:true,framerate:29.8,version:'00c932f-mipantalla-single-owner1'};
function fixture(options={}){
  let state={...OFF},clock=0,starts=0,stops=0;
  const calls=[];
  const lifecycle=create({now:()=>clock,wait:async ms=>{clock+=ms;},
    call:async(uri,args,timeout)=>{
      calls.push({method:uri.split('/').pop(),args,timeout});
      const method=uri.split('/').pop();
      if(method==='getSettings')return {payload:{returnValue:true,...SETTINGS,...options.settings}};
      if(method==='status')return {payload:{returnValue:true,...state}};
      if(method==='start'){starts++;state={...ON};return {payload:{returnValue:true}};}
      if(method==='stop'){stops++;if(!options.stuck)state={...OFF};return {payload:{returnValue:true}};}
      throw Error('unexpected endpoint');
    }});
  return {lifecycle,calls,get starts(){return starts;},get stops(){return stops;},get clock(){return clock;},set state(v){state=v;}};
}
test('capture lifecycle owns only fixed native methods and verifies real frames after one start',async()=>{
  const t=fixture();assert.deepEqual(await t.lifecycle.inspect(),{stopped:true,settingsVerified:true});
  assert.equal((await t.lifecycle.start()).framesVerified,true);assert.equal(t.starts,1);
  assert.deepEqual(await t.lifecycle.stop(),{stopped:true});assert.equal(t.stops,1);
  assert.ok(t.calls.every(c=>Object.keys(c.args).length===0));
});
test('foreign settings block capture mutation rather than being overwritten',async()=>{
  for(const settings of [{autostart:true},{port:19444},{address:'example.org'},{width:1920},{fps:60},{quirks:256}]){
    const t=fixture({settings});assert.equal((await t.lifecycle.inspect()).settingsVerified,false);
    await assert.rejects(t.lifecycle.start());assert.equal(t.starts,0);assert.equal(t.stops,0);
  }
});
test('stop ACK is not stopped proof and a timeout never re-enables capture',async()=>{
  const t=fixture({stuck:true});t.state={...ON};
  await assert.rejects(t.lifecycle.stop(),e=>e.code==='PICCAP_STOP_UNCONFIRMED');
  assert.equal(t.stops,1);assert.equal(t.starts,0);assert.ok(t.clock<=12000);
});

test('already stopped capture is verified without issuing the non-idempotent native stop method',async()=>{
  const t=fixture();assert.deepEqual(await t.lifecycle.stop(),{stopped:true});assert.equal(t.stops,0);
});

test('a timed-out native start exposes uncertainty and its late ACK cannot begin frame polling',async()=>{
  let release;const calls=[];
  const capture=create({setTimer:(fn)=>setTimeout(fn,10),clearTimer:clearTimeout,
    call:async(uri)=>{const method=uri.split('/').pop();calls.push(method);
      if(method==='getSettings')return {payload:{returnValue:true,...SETTINGS}};
      if(method==='status')return {payload:{returnValue:true,...OFF}};
      return new Promise(resolve=>{release=resolve;});}});
  await assert.rejects(capture.start(),e=>e.code==='PICCAP_START_UNCONFIRMED'&&e.startIssued===true);
  assert.ok(release);const before=calls.length;release({payload:{returnValue:true}});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,before);
  assert.equal(calls.filter(x=>x==='start').length,1);
});

test('a rejected native start does not claim capture ownership or issue a stop',async()=>{
  const calls=[];const capture=create({call:async uri=>{
    const method=uri.split('/').pop();calls.push(method);
    return {payload:method==='getSettings'?{returnValue:true,...SETTINGS}:
      method==='status'?{returnValue:true,...OFF}:{returnValue:false}};
  }});
  await assert.rejects(capture.start(),e=>e.startIssued===false);
  assert.deepEqual(calls.sort(),['getSettings','start','status']);
});

test('OFF cannot complete rollback while our timed-out start is pending; its late ACK triggers exactly one stop',async()=>{
  let state={...OFF},release,stops=0;
  const cap=create({setTimer:fn=>setTimeout(fn,10),clearTimer:clearTimeout,call:async uri=>{
    const method=uri.split('/').pop();
    if(method==='getSettings')return {payload:{returnValue:true,...SETTINGS}};
    if(method==='status')return {payload:{returnValue:true,...state}};
    if(method==='start')return new Promise(resolve=>{release=()=>{state={...ON};resolve({payload:{returnValue:true}});};});
    if(method==='stop'){stops++;state={...OFF};return {payload:{returnValue:false}};}
  }});
  await assert.rejects(cap.start(),e=>e.startIssued===true);
  await assert.rejects(cap.stop(),e=>e.code==='PICCAP_STOP_UNCONFIRMED');
  assert.equal((await cap.inspect()).stopped,false);
  release();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(stops,1);assert.equal(state.isRunning,false);
  assert.deepEqual(await cap.stop(),{stopped:true});assert.equal(stops,1);
});

test('the original, missing or unknown native version never grants readiness or Start, while recovery Stop remains allowed',async()=>{
  for(const version of ['heads/main-0-g00c932f',undefined,'other-build']){
    let starts=0;const cap=create({call:async uri=>{
      const method=uri.split('/').pop();if(method==='start')starts++;
      return {payload:method==='getSettings'?{returnValue:true,...SETTINGS}:{returnValue:true,...OFF,version}};
    }});
    assert.equal((await cap.inspect()).settingsVerified,false);await assert.rejects(cap.start());
    assert.equal(starts,0);assert.deepEqual(await cap.stop(),{stopped:true});
  }
});
