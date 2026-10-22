const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
function load(sdk,onTV,timeoutMs=30,extra={}){
  const file=path.join(__dirname,'../lights-client.js');
  assert.ok(fs.existsSync(file),'WiZ UI client must exist');
  const ctx={window:{LauncherAmbient:extra.ambient},Promise,Error,setTimeout:extra.setTimer||setTimeout,clearTimeout:extra.clearTimer||clearTimeout};
  vm.runInNewContext(fs.readFileSync(file,'utf8'),ctx);
  return ctx.window.createLightsClient(sdk,onTV,Object.assign({timeoutMs},extra.options));
}
test('WiZ preview cannot discover or change actual lights',async()=>{
  let calls=0;
  const client=load({service:{request(){calls++;throw Error('unsafe');}}},false);
  assert.equal((await client.capabilities()).available,false);
  for(const method of ['discover','getState','setState','setMode'])await assert.rejects(client[method]({}),/previa/i);
  assert.equal(calls,0);
});
test('WiZ client calls only its fixed Luna service and forwards explicit actions',async()=>{
  const sent=[];
  const client=load({service:{request(uri,options){
    sent.push({uri,method:options.method,params:options.parameters});
    options.onSuccess({returnValue:true,devices:[]});return {cancel(){}};
  }}},true);
  await client.discover();
  await client.setState({ids:['wiz-aabbcc001122'],rgb:[0,80,255]});
  assert.equal(sent.length,2);
  assert.ok(sent.every(r=>r.uri==='luna://com.frxn.mipantalla.lights'));
  assert.equal(sent[1].method,'setState');
  assert.deepEqual(JSON.parse(JSON.stringify(sent[1].params)),{ids:['wiz-aabbcc001122'],rgb:[0,80,255]});
});
test('WiZ timeout cancels and remains uncertain without a retry',async()=>{
  let calls=0,cancelled=0;
  const client=load({service:{request(){calls++;return {cancel(){cancelled++;}};}}},true,5);
  await assert.rejects(client.setState({ids:['wiz-aabbcc001122'],on:false}),/confirm/i);
  assert.equal(calls,1);assert.equal(cancelled,1);
});

test('capture mode requests get the bounded settling budget while ordinary actions retain their deadline',async()=>{
  const timers=[],sent=[];
  const client=load({service:{request(uri,o){sent.push(o);return {cancel(){}};}}},true,undefined,{
    options:{timeoutMs:undefined},setTimer:(fn,ms)=>{const timer={fn,ms};timers.push(timer);return timer;},clearTimer:()=>{}});
  for(const mode of ['screen','manual']){
    const result=client.setMode({mode});assert.equal(timers[timers.length-1].ms,25000);
    sent[sent.length-1].onSuccess({returnValue:true,mode});assert.equal((await result).mode,mode);
  }
  const state=client.setState({ids:['wiz-aabbcc001122'],on:true});
  assert.equal(timers[timers.length-1].ms,12000);
  sent[sent.length-1].onSuccess({returnValue:true,devices:[]});await state;
});
test('WiZ unavailable service and explicit refusals are errors, never success',async()=>{
  await assert.rejects(load(null,true).discover(),/biblioteca|servicio/i);
  const client=load({service:{request(uri,o){o.onSuccess({returnValue:false,errorText:'Denied'});return {};}}},true);
  await assert.rejects(client.setMode({mode:'manual'}),/Denied/);
});
test('WiZ timeout still settles if cancellation cleanup throws',async()=>{
  const client=load({service:{request(){return {cancel(){throw Error('cleanup failed');}};}}},true,5);
  await assert.rejects(client.setState({ids:['wiz-aabbcc001122'],on:false}),/confirm/i);
});
test('wallpaper mode is confirmed only after real RGB readback, with no screen claim',async()=>{
  const id='wiz-aabbcc001122';let hooks;let stopped=0;const sent=[];
  const ambient={create(options){hooks=options;return {start(ids){hooks.send([20,80,120],ids).catch(()=>{});},stop(){stopped++;},refresh(){},visibilityChanged(){}};}};
  const sdk={service:{request(uri,o){sent.push(o);return {cancel(){}};}}};
  const client=load(sdk,true,50,{ambient,options:{source:()=> 'assets/wallpapers/moraine-lake.jpg'}});
  const caps=client.capabilities();sent[0].onSuccess({returnValue:true,available:true,screenSync:false});
  assert.equal((await caps).wallpaperSync,true);
  const mode=client.setMode({mode:'ambient',source:'wallpaper',ids:[id]});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(sent[1].method,'setState');
  assert.deepEqual(JSON.parse(JSON.stringify(sent[1].parameters)),{ids:[id],rgb:[20,80,120]});
  sent[1].onSuccess({returnValue:true,devices:[{id,confirmed:true,state:{rgb:[20,80,120]}}]});
  assert.equal((await mode).mode,'ambient');
  client.stopAmbient();assert.ok(stopped>0);
});
test('wallpaper mode failure cannot be reported as enabled',async()=>{
  let hooks;const ambient={create(o){hooks=o;return {start(){o.onError(Error('Canvas blocked'));},stop(){},refresh(){},visibilityChanged(){}};}};
  const client=load({service:{request(){throw Error('not reached');}}},true,30,{ambient,options:{source:()=> 'assets/wallpapers/moraine-lake.jpg'}});
  await assert.rejects(client.setMode({mode:'ambient',source:'wallpaper',ids:['wiz-aabbcc001122']}),/Canvas blocked/);
});
test('a previous color response cannot confirm a new ambient selection',async()=>{
  const first='wiz-aabbcc001122',second='wiz-aabbcc003344';const sent=[];
  const ambient={create(o){return {start(ids){o.send([20,80,120],ids).catch(()=>{});},stop(){},refresh(){},visibilityChanged(){}};}};
  const client=load({service:{request(uri,o){sent.push(o);return {cancel(){}};}}},true,100,{ambient,options:{source:()=> 'assets/wallpapers/moraine-lake.jpg'}});
  const old=client.setMode({mode:'ambient',source:'wallpaper',ids:[first]});
  const cancelled=assert.rejects(old,/cancel/i);
  client.stopAmbient();
  let confirmed=false;
  const next=client.setMode({mode:'ambient',source:'wallpaper',ids:[second]}).then(result=>{confirmed=true;return result;});
  sent[0].onSuccess({returnValue:true,devices:[{id:first,confirmed:true}]});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(confirmed,false,'old readback does not confirm the replacement mode');
  sent[1].onSuccess({returnValue:true,devices:[{id:second,confirmed:true}]});
  assert.equal((await next).mode,'ambient');
  await cancelled;client.stopAmbient();
});
test('client preserves the backend screen mode and screen review never writes lights',async()=>{
  const sent=[];
  const client=load({service:{request(uri,o){sent.push(o);return {cancel(){}};}}},true,100);
  const caps=client.capabilities();sent[0].onSuccess({returnValue:true,available:true,mode:'screen'});
  assert.equal((await caps).mode,'screen');
  const review=client.screenStatus({ids:[]});
  assert.equal(sent[1].method,'screenStatus');sent[1].onSuccess({returnValue:true,ready:false,reason:'setup-pending'});
  assert.equal((await review).ready,false);
  const manual=client.setMode({mode:'manual'});sent[2].onFailure({errorText:'Restoration pending'});
  await assert.rejects(manual,/Restoration pending/);
  const again=client.capabilities();sent[3].onSuccess({returnValue:true,mode:'screen'});
  assert.equal((await again).mode,'screen');
});
test('starting wallpaper after screen waits for confirmed backend restoration',async()=>{
  let starts=0;const sent=[];
  const ambient={create(o){return {start(ids){starts++;o.send([1,2,3],ids).catch(()=>{});},stop(){},refresh(){},visibilityChanged(){}};}};
  const client=load({service:{request(uri,o){sent.push(o);return {cancel(){}};}}},true,100,{ambient,options:{source:()=> 'assets/wallpapers/moraine-lake.jpg'}});
  const caps=client.capabilities();sent[0].onSuccess({returnValue:true,mode:'screen'});await caps;
  const pending=client.setMode({mode:'ambient',source:'wallpaper',ids:['wiz-aabbcc001122']});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(starts,0);assert.equal(sent[1].method,'setMode');assert.equal(sent[1].parameters.mode,'manual');
  sent[1].onFailure({errorText:'Stop not confirmed'});
  await assert.rejects(pending,/Stop not confirmed/);assert.equal(starts,0);
});
test('the whole screen-to-wallpaper transition expires before the panel and cannot resume after a late restore',async()=>{
  const timers=[];const sent=[];let starts=0;
  const ambient={create(){return {start(){starts++;},stop(){},refresh(){},visibilityChanged(){}};}};
  const client=load({service:{request(uri,o){sent.push(o);return {cancel(){}};}}},true,12000,{ambient,
    options:{source:()=> 'assets/wallpapers/moraine-lake.jpg'},
    setTimer:(fn,ms)=>{const t={fn,ms,cleared:false};timers.push(t);return t;},clearTimer:t=>{t.cleared=true;}});
  const caps=client.capabilities();sent[0].onSuccess({returnValue:true,mode:'screen'});await caps;
  const mode=client.setMode({mode:'ambient',source:'wallpaper',ids:['wiz-aabbcc001122']});
  const rejected=assert.rejects(mode,/tiempo/i);
  const deadline=timers.find(t=>!t.cleared&&t.ms===7500);
  assert.ok(deadline,'one deadline covers restoration and first RGB confirmation');
  deadline.fn();await rejected;
  sent[1].onSuccess({returnValue:true,mode:'manual'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(starts,0);assert.equal(sent.length,2);
});
