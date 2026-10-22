'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const file=path.join(__dirname,'../installer/root-repair.cjs');
const api=fs.existsSync(file)?require(file):{};
test('exports guarded repair of the signed Developer Mode script',()=>assert.equal(typeof api.repairDeveloperMode,'function'));
test('validates the run id before contacting the TV',async()=>{
  let called=false;await assert.rejects(api.repairDeveloperMode({runRemote(){called=true;}},{backupId:'../bad'}));assert.equal(called,false);
});
test('repair exposes only a verified result and never invokes upstream enable_devmode',async()=>{
  const answer=await api.repairDeveloperMode({async runRemote(script,settings){
    assert.ok(script.includes('start-devmode.sh.backup'));assert.ok(script.includes('-sha512'));assert.ok(script.includes('O_EXCL'));
    assert.ok(script.includes('fsyncSync'));assert.ok(script.includes('DEVMODE_TOKEN_INVALID'));
    assert.equal(script.includes('mkdir /var/luna/preferences/devmode_enabled'),false);
    assert.equal(script.includes('restart'),false);assert.equal(settings.timeoutMs,20000);
    return {stdout:JSON.stringify({ok:true,status:'complete',scriptRepaired:true,tokenPreserved:true})};
  }},{backupId:'a'.repeat(32)});
  assert.deepEqual(answer,{status:'complete',scriptRepaired:true,tokenPreserved:true});
});
test('malformed and partial repair responses remain failures',async()=>{
  for(const stdout of ['x','{}','{"ok":true,"status":"complete"}','{"ok":false,"code":"DEVMODE_TOKEN_INVALID"}']){
    await assert.rejects(api.repairDeveloperMode({async runRemote(){return {stdout};}},{backupId:'b'.repeat(32)}));
  }
});
