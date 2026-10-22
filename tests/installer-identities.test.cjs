'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {findIdentities}=require('../installer/identities.cjs');
function fixture(t){const home=fs.mkdtempSync(path.join(os.tmpdir(),'mp-identities-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));fs.mkdirSync(path.join(home,'.ssh'));fs.mkdirSync(path.join(home,'.mi-pantalla-installer'));return home;}
test('finds webOS and previously used identities without reading key contents or unrelated keys',t=>{
  const home=fixture(t),tv=path.join(home,'.ssh','living_webos'),previous=path.join(home,'previous-key');
  for(const file of [tv,previous,path.join(home,'.ssh','id_ed25519'),tv+'.pub'])fs.writeFileSync(file,'PRIVATE FIXTURE NEVER READ');
  const id='a'.repeat(32),journal=path.join(home,'.mi-pantalla-installer',id+'.json');
  fs.writeFileSync(journal,JSON.stringify({version:1,id,config:{identity:previous}}));
  const reads=[],disk=Object.assign({},fs,{readFileSync(file,...args){reads.push(file);assert.equal(file,journal);return fs.readFileSync(file,...args);}});
  const result=findIdentities({home,fs:disk});assert.deepEqual(result.identities.map(x=>x.path),[previous,tv]);assert.deepEqual(reads,[journal]);
});
test('ignores corrupt journals, relative identities, duplicate paths and oversized files',t=>{
  const home=fixture(t),tv=path.join(home,'.ssh','living_webos');fs.writeFileSync(tv,'fixture');
  const records=[{config:{identity:tv}},{config:{identity:'relative/key'}},{config:{identity:tv}}];
  records.forEach((r,i)=>{const id=String(i).repeat(32);fs.writeFileSync(path.join(home,'.mi-pantalla-installer',id+'.json'),JSON.stringify({...r,version:1,id}));});
  fs.writeFileSync(path.join(home,'.mi-pantalla-installer','d'.repeat(32)+'.json'),'{');
  fs.writeFileSync(path.join(home,'.ssh','large_webos'),Buffer.alloc(65537));
  const result=findIdentities({home});assert.equal(result.identities.length,1);assert.equal(result.identities[0].path,tv);
});
test('symlink metadata and absent directories never open candidate keys or follow directories',()=>{
  let reads=0;const disk={lstatSync(){return{isDirectory:()=>true,isSymbolicLink:()=>true};},readFileSync(){reads++;throw Error();},readdirSync(){throw Error('must not follow');}};
  const result=findIdentities({home:path.resolve('fixture-home'),fs:disk});assert.deepEqual(result.identities,[]);assert.equal(reads,0);
});
