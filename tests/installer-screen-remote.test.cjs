'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {remoteScreen}=require('../installer/screen-remote.cjs');
const app='/media/developer/apps/usr/palm/applications/com.frxn.mipantalla/';
const service='/media/developer/apps/usr/palm/services/com.frxn.mipantalla.lights/';
const ids=Array.from({length:6},(_,i)=>'wiz-'+(i+1).toString(16).padStart(12,'0'));
function fixture(options={}){
  const entries=new Map(),calls=[],outputs=[];
  function put(file,text,extra={}){entries.set(file,Object.assign({text,uid:0,ino:entries.size+1,mode:384},extra));}
  put('/etc/starfish-release','Rockhopper release 5.6.2-21 (jhericurl-jimna)\n');
  put(app+'lights-config.js','// private selection\nwindow.LAUNCHER_LIGHTS = '+JSON.stringify({selectedIds:ids})+';\n');
  if(options.configured!==false)put(service+'screen-config.json','{"enabled":true,"token":"PRIVATE_NOT_FOR_OUTPUT"}');
  const stat=e=>({uid:e.uid,ino:e.ino,dev:1,size:Buffer.byteLength(e.text),nlink:1,mode:e.mode,isFile:()=>!e.link,isSymbolicLink:()=>!!e.link});
  const fs={constants:{O_RDONLY:0,O_NOFOLLOW:131072},lstatSync(file){if(!entries.has(file))throw Object.assign(Error('missing'),{code:'ENOENT'});return stat(entries.get(file));},
    openSync(file,flags){assert.ok(flags&131072);return file;},fstatSync(file){return stat(entries.get(file));},readFileSync(file){return entries.get(file).text;},closeSync(){}};
  const devices=[{id:'org.webosbrew.piccap',version:'0.5.3'},{id:'org.webosbrew.hyperhdr.loader',version:'22.0.1'}];
  let phase=options.phase||null;
  function execFile(command,args,settings,callback){
    const uri=args[args.length-2],payload=JSON.parse(args[args.length-1]);calls.push({command,uri,payload,args,timeout:settings.timeout});
    let value;
    if(uri.endsWith('/getSystemInfo'))value={returnValue:true,modelName:'49UN7310PSC',firmwareVersion:'04.64.00',sdkVersion:'5.6.2',boardType:'K6LP_ATSC_BR'};
    else if(uri.endsWith('/listApps'))value={returnValue:true,apps:options.apps||devices};
    else if(uri.endsWith('/setMode')){assert.ok(args.includes('-a'));phase=payload.mode==='screen'?'active':null;value={returnValue:true,mode:payload.mode};}
    else if(uri.endsWith('/screenStatus'))value=Object.assign({returnValue:true,configured:true,ready:!phase,pending:!!phase,phase,outputEnabled:phase==='active',configVerified:true,hardwareVerified:true,framesVerified:true,lampCount:6},options.status);
    else throw Error('unexpected method');
    callback(null,JSON.stringify(value));
  }
  return {entries,calls,outputs,put,async run(action){await remoteScreen({action},{fs,execFile,getuid:()=>0,output:value=>outputs.push(value)});return outputs[outputs.length-1];}};
}
test('remote start calls the existing app session and returns only sanitized status',async()=>{
  const f=fixture(),value=await f.run('start');assert.equal(value.active,true);assert.equal(value.pending,true);assert.equal(value.framesVerified,true);
  const call=f.calls.find(call=>call.uri.endsWith('/setMode'));assert.deepEqual(call.payload.ids,ids);assert.equal(call.payload.mode,'screen');
  assert.equal(JSON.stringify(value).includes('PRIVATE_NOT_FOR_OUTPUT'),false);assert.equal(JSON.stringify(value).includes(ids[0]),false);
});

test('remote forwards only a strict cold-start flag and never invents verified frames',async()=>{
  for(const flag of [true,false,1,'true',undefined]){
    const f=fixture({status:{captureStartReady:flag,framesVerified:false}}),value=await f.run('status');
    assert.equal(value.captureStartReady,flag===true);assert.equal(value.framesVerified,false);
    assert.equal(JSON.stringify(value).includes(ids[0]),false);
    assert.equal(f.calls.some(call=>call.uri.endsWith('/setMode')),false);
  }
});

test('remote grants the longer deadline only to explicit screen and Manual mutations',async()=>{
  const f=fixture();await f.run('start');
  const mode=f.calls.find(call=>call.uri.endsWith('/setMode'));
  assert.equal(mode.timeout,25000);
  assert.ok(f.calls.filter(call=>!call.uri.endsWith('/setMode')).every(call=>call.timeout===12000));
});
test('remote stop restores via Manual and reads the selected six lamps afterward',async()=>{
  const f=fixture({phase:'active'}),value=await f.run('stop');assert.equal(value.active,false);assert.equal(value.pending,false);
  const methods=f.calls.filter(call=>call.uri.includes('mipantalla')).map(call=>call.uri.split('/').pop());assert.deepEqual(methods,['setMode','screenStatus']);
  assert.deepEqual(f.calls.at(-1).payload.ids,ids);
});
test('a malformed app inventory is not interpreted as missing packages',async()=>{
  const f=fixture({apps:[{version:'0'}]}),value=await f.run('status');assert.equal(value.ok,false);assert.equal(value.code,'SCREEN_INVENTORY_INVALID');assert.equal(f.calls.some(call=>call.uri.endsWith('/setMode')),false);
});
test('missing config diagnoses an existing recovery record before allowing preparation',async()=>{
  const f=fixture({configured:false});f.put('/media/internal/mi-pantalla-lights/screen-session.json',JSON.stringify({phase:'active',ids,devices:[]}));
  const value=await f.run('status');assert.equal(value.verified,true);assert.equal(value.pending,true);assert.equal(value.active,null);assert.deepEqual(value.missing,['screen-config']);
});
test('symbolic private config is rejected without following or claiming availability',async()=>{
  const f=fixture();f.entries.get(service+'screen-config.json').link=true;const value=await f.run('status');assert.equal(value.ok,false);assert.equal(f.calls.some(call=>call.uri.endsWith('/screenStatus')),false);
});
test('executable selection text cannot run or pass the static JSON parser',async()=>{
  const f=fixture();f.put(app+'lights-config.js','window.LAUNCHER_LIGHTS = (function(){ throw Error("executed"); })();');
  const value=await f.run('start');assert.equal(value.ok,false);assert.equal(value.code,'SCREEN_SELECTION_INVALID');assert.equal(f.calls.some(call=>call.uri.endsWith('/setMode')),false);
});
test('Manual can restore a pending baseline even when the current selection was lost',async()=>{
  const f=fixture({phase:'active'});f.entries.delete(app+'lights-config.js');
  f.put('/media/internal/mi-pantalla-lights/screen-session.json',JSON.stringify({phase:'active',ids,devices:ids.map(id=>({id,state:{on:true,brightness:50,rgb:[1,2,3]}}))}));
  const value=await f.run('stop');assert.equal(value.ok,true);assert.equal(value.active,false);assert.equal(value.pending,false);assert.deepEqual(f.calls.at(-1).payload.ids,ids);
});
