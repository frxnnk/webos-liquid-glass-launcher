const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('the service wires fixed capture lifecycle separately from the short frame probe without starting either',async()=>{
  let captureOptions,controllerOptions,wired;const timers=[],calls=[];
  const capture={marker:'native-lifecycle'},probe=()=>Promise.resolve({framesVerified:false});
  const service={call(uri,args,cb){calls.push(uri);cb({payload:{returnValue:true}});}};
  const fakes={
    'webos-service':function(){return service;},
    './piccap-lifecycle':options=>{captureOptions=options;return capture;},
    './piccap-probe':()=>({read:probe}),
    './transport':()=>({}),
    './controller':(transport,options)=>{controllerOptions=options;return {};},
    './screen-control':(lamps,options)=>{wired=options;return {};},
    './api':()=>{},'./auto-config':()=>({}),'./auto-control':()=>({})
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../services/com.frxn.mipantalla.lights/service.js'),'utf8'),
    {require:name=>{assert.ok(name in fakes,name);return fakes[name];},Promise,
      setTimeout:(fn,ms)=>{timers.push(ms);return 1;},clearTimeout:()=>{}});
  assert.deepEqual(calls,[]);
  controllerOptions.screenFactory({}, {probe});assert.equal(wired.capture,capture);assert.equal(wired.probe,probe);
  await captureOptions.call('luna://org.webosbrew.piccap.service/stop',{},12000);
  await captureOptions.call('luna://org.webosbrew.piccap.service/status',{});
  assert.deepEqual(timers,[12000,1500]);
});

test('the private native observer sees a late ACK after the public call already timed out',async()=>{
  let captureOptions,callback;const timers=[],seen=[];
  const fakes={'webos-service':function(){return {call(uri,args,cb){callback=cb;}};},
    './piccap-lifecycle':options=>{captureOptions=options;return {};},'./piccap-probe':()=>({read:()=>{}}),
    './transport':()=>({}),'./controller':()=>({}),'./api':()=>{},'./auto-config':()=>({}),'./auto-control':()=>({})};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../services/com.frxn.mipantalla.lights/service.js'),'utf8'),
    {require:name=>fakes[name],Promise,setTimeout:(fn)=>{timers.push(fn);return 1;},clearTimeout:()=>{}});
  const waiting=captureOptions.call('luna://org.webosbrew.piccap.service/start',{},12000,msg=>seen.push(msg.payload.returnValue));
  timers[0]();await assert.rejects(waiting);
  callback({payload:{returnValue:true}});assert.deepEqual(seen,[true]);
});
