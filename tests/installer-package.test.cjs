'use strict';
const test=require('node:test'); const assert=require('node:assert/strict');
const {installPackage,verifyPackage,validInventory,PIN}=require('../installer/install-package.cjs');
const vm=require('node:vm');
const {uploadScript}=require('../installer/install-package.cjs');

test('TV package RPC clears LD_PRELOAD explicitly without changing its parent environment',()=>{
  const script=uploadScript(Buffer.from('fixture'),'a'.repeat(32));
  assert.match(script,/node -e "eval\(require\('fs'\)\.readFileSync\(3,'utf8'\)\)" <\/dev\/null 3<</);
  const source=script.split("MP_INSTALL_PAYLOAD'\n")[1].split('\nMP_INSTALL_PAYLOAD')[0];
  const env={LD_PRELOAD:'parent-library',PATH:'/bin'};let childOptions;
  const context={Buffer,process:{env,getuid:()=>0},require(id){
    if(id==='fs')return{};
    if(id==='crypto')return{createHash(){return{update(){return this;},digest(){return PIN.sha256;}};}};
    if(id==='child_process')return{execFile(file,args,options){childOptions=options;}};
    throw Error('unexpected module');
  }};
  vm.runInNewContext(source,context);
  assert.equal(childOptions.env.LD_PRELOAD,'');assert.equal(childOptions.env.PATH,'/bin');
  assert.equal(env.LD_PRELOAD,'parent-library');assert.equal(childOptions.timeout,10000);
});
test('absence is never inferred from malformed or duplicate inventory records',()=>{
  for(const value of [{returnValue:true,apps:[{}]},{returnValue:true,apps:[{id:PIN.id},{id:PIN.id}]},{returnValue:true,apps:[{id:'bad id'}]}])assert.equal(validInventory(value),false);
  assert.equal(validInventory({returnValue:true,apps:[{id:'netflix'}]}),true);
});
test('package pin is immutable and rejects modified data',()=>{
  assert.equal(PIN.version,'0.7.7'); assert.equal(PIN.sha256,'dd107a1cf409d7348cf4efd04eb3de432afd129358701f57470c05485e2f1e17');
  assert.throws(()=>verifyPackage(Buffer.from('not the IPK')),/PACKAGE_HASH_MISMATCH/);
});
test('an already installed exact version is skipped without touching disk or TV',async()=>{
  const result=await installPackage({runRemote(){throw Error('must not call');}},{backupId:'a'.repeat(32),expectedInstalledVersion:'0.7.7'});
  assert.equal(result.status,'skipped');
});
test('unknown installed version blocks an update before reading a package',async()=>{
  await assert.rejects(installPackage({}, {backupId:'a'.repeat(32),expectedInstalledVersion:'0.7.4'}),/UPDATE_PRESERVATION_REQUIRED/);
});
test('untrusted backup id never reaches SSH or the filesystem',async()=>{
  await assert.rejects(installPackage({}, {backupId:"';rm -rf /",expectedInstalledVersion:null}),/BACKUP_ID_INVALID/);
});
test('failed package verification prevents SSH',async()=>{
  let calls=0;
  await assert.rejects(installPackage({runRemote(){calls++;}},{backupId:'a'.repeat(32),expectedInstalledVersion:null},{readFile:()=>Buffer.from('changed')}),/PACKAGE_HASH_MISMATCH/);
  assert.equal(calls,0);
});
test('install ACK is followed by bounded inventory verification',async()=>{
  const calls=[];let polls=0;
  const transport={async runRemote(script){calls.push(script);if(script.includes('MP_INSTALL_PAYLOAD'))return{stdout:'{"returnValue":true}'};return{stdout:JSON.stringify({returnValue:true,apps:++polls===2?[{id:PIN.id,version:PIN.version}]:[]})};}};
  const result=await installPackage(transport,{backupId:'a'.repeat(32),expectedInstalledVersion:null},{readFile:()=>Buffer.from('fixture'),verifyPackage:()=>true,delay:async()=>{}});
  assert.equal(result.status,'complete');assert.equal(polls,2);assert.match(calls[0],/expected model/);assert.match(calls[0],/O_EXCL/);
});
test('accepted install without matching inventory is reported unconfirmed',async()=>{
  const transport={async runRemote(script){return{stdout:script.includes('MP_INSTALL_PAYLOAD')?'{"returnValue":true}':'{"returnValue":true,"apps":[]}'}}};
  await assert.rejects(installPackage(transport,{backupId:'a'.repeat(32),expectedInstalledVersion:null},{readFile:()=>Buffer.from('fixture'),verifyPackage:()=>true,delay:async()=>{}}),/INSTALL_UNCONFIRMED/);
});
test('a clean checkout downloads only the pinned public URL and verifies it before SSH',async()=>{
  let url,ssh=0;
  await assert.rejects(installPackage({async runRemote(){ssh++;}},{backupId:'a'.repeat(32),expectedInstalledVersion:null},{readFile:()=>{throw Object.assign(Error(),{code:'ENOENT'});},fetch:async address=>{url=address;return{ok:true,body:[Buffer.from('tampered')]};}}),/PACKAGE_HASH_MISMATCH/);
  assert.equal(url,PIN.url);assert.equal(ssh,0);
});
