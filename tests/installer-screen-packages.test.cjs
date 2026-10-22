'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {PINS,verify,download,stageScript,installScript,installMissing}=require('../installer/screen-packages.cjs');
test('capture packages are official immutable releases with exact size and digest',()=>{
  assert.equal(PINS[0].version,'0.5.3');assert.equal(PINS[1].version,'22.0.1');assert.equal(PINS[1].bytes,33555434);assert.equal(PINS.every(p=>p.url.startsWith('https://github.com/')),true);
});
test('unrecognized packages and tampered bytes are rejected before SSH',()=>{
  assert.throws(()=>verify(Buffer.from('changed'),PINS[0]),/HASH_MISMATCH/);assert.throws(()=>verify(Buffer.alloc(0),Object.assign({},PINS[0])),/PACKAGE_INVALID/);
});
test('oversized download stops before remote staging',async()=>{
  let calls=0;await assert.rejects(installMissing({runRemote(){calls++;}},['piccap'],{readFile:async()=>{throw Object.assign(Error(),{code:'ENOENT'});},fetch:async()=>({ok:true,body:(async function*(){yield Buffer.alloc(PINS[0].bytes+1);})()})}),/TOO_LARGE/);assert.equal(calls,0);
});
test('local package hash mismatch cannot trigger upload',async()=>{
  let calls=0;await assert.rejects(installMissing({runRemote(){calls++;}},['piccap'],{readFile:async()=>Buffer.from('bad')}),/HASH_MISMATCH/);assert.equal(calls,0);
});
test('chunk staging is bounded, offset checked and private',()=>{
  const id='a'.repeat(32);assert.throws(()=>stageScript(PINS[1],id,Buffer.alloc(1048577),0),/STAGE_INVALID/);
  const source=stageScript(PINS[1],id,Buffer.from('example'),12);assert.match(source,/before\.size!==12/);assert.match(source,/O_NOFOLLOW/);assert.match(source,/s\.uid!==0/);assert.match(source,/!==384/);assert.doesNotMatch(source,/execFile/);
});
test('installation rechecks the staged digest on the TV and suppresses inherited preload',()=>{
  const source=installScript(PINS[1],'b'.repeat(32));assert.match(source,new RegExp(PINS[1].sha256));assert.match(source,/LD_PRELOAD:''/);assert.match(source,/dev\/install/);assert.match(source,/fs\.fstatSync/);
});
test('config-only preparation downloads no packages',async()=>{
  const result=await installMissing({runRemote(){assert.fail('no remote command');}},['screen-config'],{readFile(){assert.fail('no download');}});assert.deepEqual(result.installed,[]);
});
test('a package installed by somebody else during download is preserved',()=>{
  const pin=PINS[0],shell=installScript(pin,'c'.repeat(32)),source=shell.split("MP_SCREEN_PACKAGE'\n")[1].split('\nMP_SCREEN_PACKAGE')[0],calls=[],output=[];
  const stat={uid:0,mode:384,nlink:1,size:pin.bytes,ino:1,dev:1,isFile:()=>true,isSymbolicLink:()=>false};
  const filesystem={constants:{O_RDONLY:0,O_NOFOLLOW:131072},lstatSync:()=>stat,openSync:()=>3,fstatSync:()=>stat,readFileSync:()=>Buffer.alloc(pin.bytes),closeSync(){}};
  vm.runInNewContext(source,{Buffer,process:{getuid:()=>0,env:{},stdout:{write:value=>output.push(value)}},require(name){
    if(name==='fs')return filesystem;if(name==='crypto')return{createHash:()=>({update(){return this;},digest:()=>pin.sha256})};
    if(name==='child_process')return{execFile(command,args,settings,callback){calls.push(args);callback(null,JSON.stringify({returnValue:true,apps:[{id:pin.id,version:pin.version}]}));}};
    assert.fail('unknown module');
  }});
  assert.equal(calls.length,1);assert.ok(calls[0].includes('luna://com.webos.applicationManager/listApps'));assert.equal(JSON.parse(output[0]).alreadyInstalled,true);
});
