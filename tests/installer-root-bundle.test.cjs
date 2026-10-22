'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const file=path.join(__dirname,'../installer/root-bundle.cjs');
const api=fs.existsSync(file)?require(file):{};
function string(bytes){const header=Buffer.alloc(4);header.writeUInt32BE(bytes.length);return Buffer.concat([header,bytes]);}
const key='ssh-ed25519 '+Buffer.concat([string(Buffer.from('ssh-ed25519')),string(Buffer.alloc(32,42))]).toString('base64');
test('accepts only one canonical public key and discards its local comment',()=>{
  assert.equal(api.canonicalPublicKey(key+' local comment\n'),key+'\n');
  for(const value of ['-----BEGIN PRIVATE KEY-----',key+'\n'+key,'command="sh" '+key,'ssh-rsa '+key.split(' ')[1]])assert.throws(()=>api.canonicalPublicKey(value));
});
test('changed or missing pinned bootstrap bytes cannot produce a runnable bundle',()=>{
  assert.throws(()=>api.buildBundle({id:'a'.repeat(32),host:'10.20.30.40',localIp:'10.20.30.41',publicKey:key},{}),/SOURCE_HASH_MISMATCH/);
});
test('temporary-root payload skips all mutations before its root/profile precheck',async()=>{
  let writes=0,result;
  await api.bootstrapMain({getuid:()=>6536,fs:new Proxy({},{get(){writes++;throw Error('write forbidden');}}),output:v=>{result=v;}},{id:'a'.repeat(32)});
  assert.equal(writes,0);assert.equal(result.ok,false);assert.equal(result.code,'ROOT_REQUIRED');
});
test('template transformations require unique reviewed anchors',()=>{
  assert.throws(()=>api.replaceOnce('same same','same','new'),/SOURCE_TRANSFORM_MISMATCH/);
  assert.throws(()=>api.replaceOnce('other','same','new'),/SOURCE_TRANSFORM_MISMATCH/);
  assert.equal(api.replaceOnce('before same after','same','new'),'before new after');
});
