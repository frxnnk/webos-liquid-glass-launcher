const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ID='wiz-aabbcc001122';
const FILE=path.join(__dirname,'../services/com.frxn.mipantalla.lights/screen-control.js');
const clone=x=>JSON.parse(JSON.stringify(x));
function fixture(options={}){
  let captureOn=options.captureOn!==false,ledOn=captureOn,record=options.record===null?null:options.record||
    {phase:'active',ids:[ID],devices:[{id:ID,state:{on:true,brightness:35,sceneId:6}}]};
  const events=[],writes=[];
  const report=()=>({configured:true,available:options.offline!==true,configVerified:options.offline!==true,
    hardwareVerified:true,ready:!ledOn&&captureOn,outputEnabled:ledOn,framesVerified:captureOn,
    sourceFreshness:captureOn?'fresh':'unknown',active:false});
  const capture=options.capture||{inspect:async()=>({stopped:!captureOn,settingsVerified:true}),
    start:async()=>{events.push('capture-start');captureOn=true;
      if(options.foreignCapture)throw Object.assign(Error('foreign capture'),{startIssued:false});
      return {framesVerified:true};},
    stop:async()=>{events.push('capture-stop');if(options.stopFails)throw Error('native timeout');
      captureOn=false;return {stopped:true};}};
  const backend={inspect:async()=>report(),start:async()=>{events.push('led-start');
    if(options.startFails)throw Error('LED rejected');ledOn=true;return {active:true};},
    stop:async()=>{events.push('led-stop');assert.equal(captureOn,false,'capture must be stopped before LED stop');ledOn=false;return {active:false};}};
  const store={load:()=>record&&clone(record),save:value=>{events.push('save-'+value.phase);
    if(options.failActiveSave&&value.phase==='active')throw Error('disk failed');record=clone(value);},clear:()=>{events.push('clear');record=null;}};
  const fakes={path,'./screen-settings':()=>({enabled:true}),'./hyperhdr-rpc':()=>({}),
    './screen-backend':()=>backend,'./screen-session':require('../services/com.frxn.mipantalla.lights/screen-session'),
    './screen-store':()=>store};
  const mod={exports:{}};
  vm.runInNewContext(fs.readFileSync(FILE,'utf8'),{module:mod,__dirname:'/synthetic',require:name=>fakes[name]});
  const control=mod.exports({read:async()=>({devices:[{id:ID,reachable:true,state:{on:true,brightness:35,sceneId:6}}]}),
    write:async(id,state)=>{events.push('restore');assert.equal(captureOn,false);assert.equal(ledOn,false);writes.push([id,state]);return {confirmed:true};}},
    {capture,probe:async()=>({framesVerified:captureOn})});
  return {control,events,writes,get record(){return record;},get captureOn(){return captureOn;},get ledOn(){return ledOn;}};
}
test('Manual stops native capture before LED output and restoring the original scene',async()=>{
  const t=fixture();await t.control.stop();
  assert.equal(t.captureOn,false);assert.equal(t.ledOn,false);assert.equal(t.record,null);
  assert.deepEqual(t.events,['capture-stop','led-stop','save-restoring','restore','save-restoring','clear']);
  assert.deepEqual(t.writes.map(x=>JSON.parse(JSON.stringify(x))),[[ID,{on:true,brightness:35,sceneId:6}]]);
});
test('a native stop timeout preserves WAL and never claims Manual or restores lights',async()=>{
  const t=fixture({stopFails:true});await assert.rejects(t.control.stop());
  assert.equal(t.record.phase,'active');assert.equal(t.writes.length,0);assert.equal(t.ledOn,true);
  assert.deepEqual(t.events,['capture-stop']);
});
test('cold OFF can be ready to start without claiming already captured frames',async()=>{
  const t=fixture({captureOn:false,record:null});const s=await t.control.status([ID]);
  assert.equal(s.ready,true);assert.equal(s.captureStartReady,true);assert.equal(s.framesVerified,false);
  await t.control.start([ID]);
  assert.equal(t.captureOn,true);assert.equal(t.ledOn,true);assert.equal(t.record.phase,'active');
  assert.deepEqual(t.events,['save-prepared','capture-start','led-start','save-active']);
});
test('HyperHDR offline cannot start native capture, and rejected LED activation rolls capture back OFF',async()=>{
  const offline=fixture({captureOn:false,record:null,offline:true});await assert.rejects(offline.control.start([ID]));
  assert.equal(offline.captureOn,false);assert.equal(offline.events.length,0);
  const failed=fixture({captureOn:false,record:null,startFails:true});await assert.rejects(failed.control.start([ID]));
  assert.equal(failed.captureOn,false);assert.ok(failed.record);assert.equal(failed.record.phase,'prepared');
  assert.equal(failed.events.filter(x=>x==='capture-start').length,1);
  assert.equal(failed.events.filter(x=>x==='capture-stop').length,1);
  assert.equal(failed.writes.length,0);
});

test('capture becoming foreign before native start is not stopped by our rollback',async()=>{
  const t=fixture({captureOn:false,record:null,foreignCapture:true});await assert.rejects(t.control.start([ID]));
  assert.equal(t.captureOn,true);assert.equal(t.record.phase,'prepared');
  assert.equal(t.events.includes('capture-stop'),false);assert.equal(t.events.includes('led-start'),false);
});

test('failure to persist active state shuts capture and LED output down while retaining the prepared baseline',async()=>{
  const t=fixture({captureOn:false,record:null,failActiveSave:true});await assert.rejects(t.control.start([ID]));
  assert.equal(t.captureOn,false);assert.equal(t.ledOn,false);assert.equal(t.record.phase,'prepared');
  assert.equal(t.writes.length,0);assert.equal(t.events.includes('clear'),false);
});

test('a late native start cannot clear the real session WAL; cleanup stops it once without enabling LEDs',async()=>{
  let running=false,release,stops=0;
  const settings={address:'localhost',port:19400,priority:150,'unix-socket':false,width:320,height:180,
    fps:30,autostart:false,novideo:false,quirks:0,backend:'libvtcapture',uibackend:'libhalgal'};
  const capture=require('../services/com.frxn.mipantalla.lights/piccap-lifecycle')({
    setTimer:fn=>setTimeout(fn,10),clearTimer:clearTimeout,call:async uri=>{
      const method=uri.split('/').pop();
      if(method==='getSettings')return {payload:{returnValue:true,...settings}};
      if(method==='status')return {payload:{returnValue:true,isRunning:running,uiRunning:running,videoRunning:running,connected:running,framerate:running?30:0,version:'00c932f-mipantalla-single-owner1'}};
      if(method==='start')return new Promise(resolve=>{release=()=>{running=true;resolve({payload:{returnValue:true}});};});
      if(method==='stop'){stops++;running=false;return {payload:{returnValue:true}};}
    }});
  const t=fixture({captureOn:false,record:null,capture});
  await assert.rejects(t.control.start([ID]));
  assert.equal(t.record.phase,'prepared');assert.equal(t.writes.length,0);assert.equal(t.ledOn,false);
  release();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(stops,1);assert.equal(running,false);assert.equal(t.record.phase,'prepared');
  assert.equal(t.events.includes('led-start'),false);
  await t.control.stop();assert.equal(t.record,null);assert.equal(t.writes.length,1);assert.equal(stops,1);
});

test('a prepared WAL found by a fresh controller cannot be cleared from an early OFF sample after a lost native start',async()=>{
  for(const phase of ['prepared','active','restoring']){
    const capture=require('../services/com.frxn.mipantalla.lights/piccap-lifecycle')({call:async()=>({payload:{returnValue:true,
      isRunning:false,uiRunning:false,videoRunning:false,connected:false}})});
    const t=fixture({captureOn:false,capture,record:{phase,ids:[ID],devices:[{id:ID,state:{on:true,brightness:35,sceneId:6}}]}});
    if(phase==='prepared'){
      await assert.rejects(t.control.stop(),e=>e.code==='SCREEN_RECOVERY_PENDING');
      await assert.rejects(t.control.start([ID]));
      assert.equal(t.record.phase,'prepared');assert.equal(t.writes.length,0);assert.equal(t.events.includes('clear'),false);
    }else{await t.control.stop();assert.equal(t.record,null);assert.equal(t.writes.length,1);}
  }
});
