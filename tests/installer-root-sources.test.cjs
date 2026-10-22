'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const file=path.join(__dirname,'../installer/root-sources.cjs');
const api=fs.existsSync(file)?require(file):{};
test('fixes reviewed SlopBro, HBC, and HBC package identities',()=>{
  assert.equal(api.PINS.slopbro.commit,'21023d56ca424607bb03d2939609cc658c655fc7');
  assert.equal(api.PINS.hbc.commit,'92fcf9fef7ce08dbeae3b0616df8d0c75c11f0b3');
  assert.equal(api.PINS.ipk.sha256,'d10bf3c753551d7c72fb7a92b20fcd2317e502a220ac668ba8e76f6ea78b363c');
});
test('changed upstream or binary is rejected before staging',()=>{
  for(const name of ['client','page','package','license','dropbear','ipk'])assert.throws(()=>api.verifySource(name,Buffer.from('changed')),/SOURCE_HASH_MISMATCH/);
});
test('a pinned package manifest is accepted without executing it',()=>{
  const bytes=Buffer.from('{\n    "name": "com.webos.service.jsserver",\n    "main": "main.js"\n}\n');
  assert.equal(api.verifySource('package',bytes),true);
});
test('download rejects non-success and never treats a supplied URL as source',async()=>{
  let calls=0;await assert.rejects(api.loadSources({fetch:async url=>{calls++;assert.ok(url.startsWith('https://'));return {ok:false};}}));
  assert.ok(calls>0);assert.ok(calls<=6);
});
