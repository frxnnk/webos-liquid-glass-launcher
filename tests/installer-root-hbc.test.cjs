'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const file=path.join(__dirname,'../installer/root-hbc.cjs');
const api=fs.existsSync(file)?require(file):{};
test('exports real HBC provisioning, separate from temporary root',()=>assert.equal(typeof api.provisionHbc,'function'));
test('wrong HBC package is rejected before SSH or writes',async()=>{
  let calls=0;await assert.rejects(api.provisionHbc({runRemote(){calls++;}},{backupId:'a'.repeat(32),bytes:Buffer.from('not HBC')}),/SOURCE_HASH_MISMATCH/);assert.equal(calls,0);
});
test('provisioner rejects non-root before reading or writing system files',async()=>{
  let touched=0,result;await api.provisionMain({getuid:()=>6536,fs:new Proxy({},{get(){touched++;throw Error('forbidden');}}),output:v=>{result=v;}},{backupId:'a'.repeat(32)});
  assert.equal(touched,0);assert.equal(result.code,'ROOT_REQUIRED');
});
test('startup uses key-only SSH, a private boot guard and existing HBC hook directory',()=>{
  const script=api.startupScript('a'.repeat(32));
  assert.ok(script.includes('-R -s -p 22'));assert.ok(script.includes('/proc/sys/kernel/random/boot_id'));
  assert.ok(script.includes('/var/lib/webosbrew/init.d'));assert.ok(script.includes('elevate-service'));
  for(const dangerous of ['telnetd','/etc/shadow','mount --bind','devmode_enabled','start-devmode.sh','/tmp/root'])assert.equal(script.includes(dangerous),false);
});
test('startup skips its side effects while provisioning is held',()=>{
  const script=api.startupScript('a'.repeat(32));
  assert.ok(script.includes('provisioning.hold'));assert.ok(script.indexOf('provisioning.hold')<script.indexOf('-R -s -p 22'));
});
test('hold release is a separate bounded operation with private-file verification',async()=>{
  const result=await api.releaseProvisioningHold({async runRemote(script,options){
    assert.equal(options.timeoutMs,10000);assert.ok(script.includes('O_NOFOLLOW'));assert.ok(script.includes('0:700')||script.includes('448'));
    assert.ok(script.includes('provisioning.hold'));assert.equal(script.includes('registerActivity'),false);
    return {stdout:'{"ok":true,"released":true}'};
  }},{backupId:'a'.repeat(32)});
  assert.equal(result.released,true);
});
