const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const dir=path.join(__dirname,'../services/com.frxn.mipantalla.lights');
const {createDaemon,parseSelected,START_DELAY_MS,STOP_DELAY_MS,BACKOFF_MS,STOP_RETRY_MAX}=require(path.join(dir,'auto-sync.js'));
const IDS=['wiz-aabbcc001122','wiz-aabbcc003344'];
const YT='youtube.leanback.v4';
const flush=async()=>{for(let i=0;i<6;i++)await new Promise(r=>setImmediate(r));};

function setup(over={}){
  let time=0,seq=0;const timers=[],calls=[],states=[],subs={};
  const setTimeoutFn=(fn,ms)=>{const t={id:++seq,at:time+ms,fn};timers.push(t);return t.id;};
  const clearTimeoutFn=id=>{const i=timers.findIndex(t=>t.id===id);if(i!==-1)timers.splice(i,1);};
  let config={enabled:true};
  const autoConfig={APPS:[YT],readConfig:()=>config,readState:()=>over.previous||null,
    writeState:value=>{states.push(value);}};
  const responses=Object.assign({
    screenStatus:()=>({active:false,pending:false,captureStartReady:true,ready:true,reason:''}),
    setMode:payload=>({mode:payload.mode})},over.responses||{});
  const luna=async(method,payload)=>{calls.push([method,payload]);return responses[method](payload,calls);};
  let exited=null;
  const daemon=createDaemon({autoConfig,luna,readLights:()=>over.noLights?null:IDS.slice(),pid:4242,
    subscribe:(uri,payload,onMessage)=>{subs[/getForeground/.test(uri)?'fg':'power']=onMessage;return {stop(){subs.stopped=(subs.stopped||0)+1;}};},
    setTimeout:setTimeoutFn,clearTimeout:clearTimeoutFn,exit:code=>{exited=code;},log(){}});
  daemon.start();
  const advance=async ms=>{
    const end=time+ms;
    for(;;){
      timers.sort((a,b)=>a.at-b.at);
      const next=timers[0];
      if(!next||next.at>end)break;
      timers.shift();time=Math.max(time,next.at);next.fn();await flush();
    }
    time=end;await flush();
  };
  return {daemon,calls,states,subs,advance,setConfig:value=>{config=value;},get exited(){return exited;},
    fg:id=>subs.fg({returnValue:true,appId:id}),power:state=>subs.power({returnValue:true,state}),
    modes:()=>calls.filter(c=>c[0]==='setMode').map(c=>c[1].mode),last:()=>states[states.length-1]};
}

test('entering YouTube starts Pantalla completa for the selected lamps after the settle delay',async()=>{
  const t=setup();t.fg(YT);
  await t.advance(START_DELAY_MS-1);assert.deepEqual(t.calls,[]);
  await t.advance(1);
  assert.deepEqual(t.calls.map(c=>c[0]),['screenStatus','setMode']);
  assert.deepEqual(t.calls[1][1],{mode:'screen',source:'screen',ids:IDS});
  assert.equal(t.daemon.snapshot().synced,true);assert.equal(t.last().state,'syncing');assert.equal(t.last().autoStarted,true);
});

test('a quick pass through YouTube never touches the lamps',async()=>{
  const t=setup();t.fg(YT);await t.advance(START_DELAY_MS-500);t.fg('com.frxn.mipantalla');await t.advance(10000);
  assert.deepEqual(t.calls,[]);assert.equal(t.last().state,'idle');
});

test('apps outside the allow-list, such as Netflix, never start capture',async()=>{
  const t=setup();t.fg('netflix');await t.advance(20000);t.fg('com.disney.disneyplus-prod');await t.advance(20000);
  assert.deepEqual(t.calls,[]);
});

test('leaving YouTube returns to Manual after a short delay and restores through the service',async()=>{
  const t=setup();t.fg(YT);await t.advance(START_DELAY_MS);
  t.fg('com.frxn.mipantalla');await t.advance(STOP_DELAY_MS-1);assert.deepEqual(t.modes(),['screen']);
  await t.advance(1);assert.deepEqual(t.modes(),['screen','manual']);
  assert.equal(t.daemon.snapshot().synced,false);assert.equal(t.last().state,'idle');
});

test('returning to YouTube inside the stop delay keeps the same session running',async()=>{
  const t=setup();t.fg(YT);await t.advance(START_DELAY_MS);
  t.fg('com.frxn.mipantalla');await t.advance(500);t.fg(YT);await t.advance(10000);
  assert.deepEqual(t.modes(),['screen']);
});

test('TV standby stops the session immediately and waking up inside YouTube starts it again',async()=>{
  const t=setup();t.fg(YT);await t.advance(START_DELAY_MS);
  t.power('Active Standby');await t.advance(0);assert.deepEqual(t.modes(),['screen','manual']);
  t.power('Active');await t.advance(START_DELAY_MS);assert.deepEqual(t.modes(),['screen','manual','screen']);
});

test('a session the owner started is left alone, also when YouTube closes',async()=>{
  const t=setup({responses:{screenStatus:()=>({active:true,pending:true,captureStartReady:false})}});
  t.fg(YT);await t.advance(START_DELAY_MS);
  assert.deepEqual(t.modes(),[]);assert.equal(t.last().reason,'manual-session');
  t.fg('com.frxn.mipantalla');await t.advance(10000);assert.deepEqual(t.modes(),[]);
});

test('a pending recovery is resumed with Manual before starting again',async()=>{
  let pending=true;
  const t=setup({responses:{
    screenStatus:()=>({active:false,pending,captureStartReady:!pending,reason:'restore-pending'}),
    setMode:payload=>{if(payload.mode==='manual')pending=false;return {mode:payload.mode};}}});
  t.fg(YT);await t.advance(START_DELAY_MS);
  assert.deepEqual(t.modes(),['manual','screen']);
});

test('a start that is not ready retries with backoff, gives up after three tries and resets when leaving',async()=>{
  const t=setup({responses:{screenStatus:()=>({active:false,pending:false,captureStartReady:false,reason:'auth-required'})}});
  t.fg(YT);await t.advance(START_DELAY_MS);
  assert.equal(t.calls.filter(c=>c[0]==='screenStatus').length,1);assert.equal(t.last().state,'error');assert.equal(t.last().reason,'auth-required');
  await t.advance(BACKOFF_MS[0]+START_DELAY_MS);assert.equal(t.calls.filter(c=>c[0]==='screenStatus').length,2);
  await t.advance(BACKOFF_MS[1]+START_DELAY_MS);assert.equal(t.calls.filter(c=>c[0]==='screenStatus').length,3);
  await t.advance(10*60*1000);assert.equal(t.calls.filter(c=>c[0]==='screenStatus').length,3);
  assert.equal(t.daemon.snapshot().gaveUp,true);assert.deepEqual(t.modes(),[]);
  t.fg('com.frxn.mipantalla');await t.advance(100);t.fg(YT);await t.advance(START_DELAY_MS);
  assert.equal(t.calls.filter(c=>c[0]==='screenStatus').length,4);
});

test('a failed Manual keeps ownership and retries every five seconds, at most six times',async()=>{
  let fail=false;
  const t=setup({responses:{setMode:payload=>{if(payload.mode==='manual'&&fail)throw Error('SCREEN_RESTORE_PENDING');return {mode:payload.mode};}}});
  t.fg(YT);await t.advance(START_DELAY_MS);fail=true;
  t.fg('com.frxn.mipantalla');await t.advance(STOP_DELAY_MS);
  await t.advance(5000*(STOP_RETRY_MAX+3));
  assert.equal(t.modes().filter(m=>m==='manual').length,STOP_RETRY_MAX);
  assert.equal(t.daemon.snapshot().synced,true);assert.equal(t.last().state,'error');
  fail=false;t.fg(YT);t.fg('com.frxn.mipantalla');await t.advance(STOP_DELAY_MS);
  assert.equal(t.daemon.snapshot().synced,false);
});

test('turning Auto off restores a session it started, stops its subscriptions and exits',async()=>{
  const t=setup();t.fg(YT);await t.advance(START_DELAY_MS);
  t.setConfig({enabled:false});await t.advance(3000);
  assert.deepEqual(t.modes(),['screen','manual']);assert.equal(t.exited,0);assert.equal(t.subs.stopped,2);assert.equal(t.last().state,'off');assert.equal(t.last().pid,null);
});

test('turning Auto off with nothing running exits without calling the service',async()=>{
  const t=setup();t.setConfig({enabled:false});await t.advance(3000);
  assert.deepEqual(t.calls,[]);assert.equal(t.exited,0);
});

test('a session left over by a previous watcher is restored at boot',async()=>{
  const t=setup({previous:{state:'syncing',autoStarted:true,pid:1,updatedAt:0,app:YT,reason:''}});
  await t.advance(10);assert.deepEqual(t.modes(),['manual']);
});

test('missing lamp selection is a reported error, never a guess',async()=>{
  const t=setup({noLights:true});t.fg(YT);await t.advance(START_DELAY_MS);
  assert.deepEqual(t.calls,[]);assert.equal(t.last().state,'error');
});

test('leaving YouTube while the start is still running ends with a stop right after it',async()=>{
  let release;
  const t=setup({responses:{setMode:payload=>payload.mode==='screen'?new Promise(r=>{release=()=>r({mode:'screen'});}):{mode:'manual'}}});
  t.fg(YT);await t.advance(START_DELAY_MS);t.fg('com.frxn.mipantalla');await t.advance(STOP_DELAY_MS+100);
  assert.deepEqual(t.modes(),['screen']);release();await flush();await t.advance(STOP_DELAY_MS+100);
  assert.deepEqual(t.modes(),['screen','manual']);
});

test('lamp selection is parsed strictly from the app configuration file',()=>{
  const ok='// c\nwindow.LAUNCHER_LIGHTS = {"selectedIds":["wiz-aabbcc001122","wiz-aabbcc003344"]};\n';
  assert.deepEqual(parseSelected(ok),IDS);
  for(const bad of [null,'',"window.LAUNCHER_LIGHTS = {\"selectedIds\":[]};",'window.LAUNCHER_LIGHTS = {"selectedIds":["x"]};',
    'window.LAUNCHER_LIGHTS = {"selectedIds":["wiz-aabbcc001122","wiz-aabbcc001122"]};','window.LAUNCHER_LIGHTS = nope;'])assert.equal(parseSelected(bad),null);
});
