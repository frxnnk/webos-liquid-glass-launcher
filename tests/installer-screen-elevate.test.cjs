'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const name='com.frxn.mipantalla.lights',service='/media/developer/apps/usr/palm/services/'+name,jail='/var/palm/jail/'+name;
function processes(specs){const rows=new Map(specs.map((entry,i)=>[String(i+20),entry]));return{readdirSync:()=>Array.from(rows.keys()),statSync(path){return{uid:rows.get(path.split('/')[2]).uid};},readlinkSync(path){const row=rows.get(path.split('/')[2]);return path.endsWith('/cwd')?row.cwd:row.exe;},readFileSync(path){const row=rows.get(path.split('/')[2]);return path.endsWith('/cmdline')?row.args.join('\0')+'\0':path.split('/')[2]+' (node) '+['S',...Array(18).fill('0'),String(row.start||123)].join(' ');}};}
test('process stop recognizes only the titled own jailed or elevated service',()=>{
  const {stopOwnService}=require('../installer/screen-elevate.cjs'),killed=[];
  const filesystem=processes([{uid:6730,args:[name],cwd:jail+service,exe:jail+'/usr/bin/node'},{uid:0,args:['node',service+'/home-watch.js'],cwd:service,exe:'/usr/bin/node'}]);
  assert.equal(stopOwnService(filesystem,(...args)=>killed.push(args),1),true);assert.deepEqual(killed,[[20,'SIGTERM']]);
});
test('an ambiguous service set is never killed',()=>{
  const {stopOwnService}=require('../installer/screen-elevate.cjs');
  const row={uid:0,args:[name],cwd:service,exe:'/usr/bin/node'};
  assert.throws(()=>stopOwnService(processes([row,row]),()=>assert.fail('no signal'),1),/AMBIGUOUS/);
});
test('matching title alone does not authorize a signal',()=>{
  const {stopOwnService}=require('../installer/screen-elevate.cjs');
  const rows=[{uid:6730,args:[name],cwd:'/tmp',exe:jail+'/usr/bin/node'},{uid:0,args:[name],cwd:service,exe:'/bin/sh'},{uid:0,args:[name,'other'],cwd:service,exe:'/usr/bin/node'}];
  assert.equal(stopOwnService(processes(rows),()=>assert.fail('no signal'),1),false);
});
test('service definition patch changes only its exact stock Exec line',()=>{
  const {patchDefinition}=require('../installer/screen-elevate.cjs');
  const original='[D-BUS Service]\nName='+name+'\nExec=/usr/bin/run-js-service -n '+service+'\nType=dynamic\n';
  const patched=patchDefinition(original);assert.equal(patched,original.replace('Exec=/usr/bin/run-js-service','Exec=/var/lib/mipantalla-maintenance/screen/root-run-js-service'));
  assert.throws(()=>patchDefinition(original.replace('Name='+name,'Name=other')),/DEFINITION/);assert.throws(()=>patchDefinition(original.replace(' -n ',' -n --other ')),/DEFINITION/);
  assert.equal(patchDefinition(patched),patched);
});
test('the wrapper source is pinned and elevation never edits a role',()=>{
  const {script}=require('../installer/screen-elevate.cjs');const source=script();assert.match(source,/8d65bd23269fe9aff78a5ea4e08d37686e01754f157fde25b11eb288b37d732c/);assert.match(source,/service-definition-before\.json/);assert.match(source,/scan-services/);assert.doesNotMatch(source,/elevate-service|roles\.d|allowedNames/);
});
function elevationFixture(privateWrapper){
  const ROOT='/var/lib/mipantalla-maintenance/screen',DEF='/var/luna-service2-dev/services.d/'+name+'.service';
  const source=Buffer.from('IyEvYmluL3NoCgojIDpeKQpldmFsICIkKHNlZCAtZSAnL150aGlyZHBhcnR5X2phaWw9L3MvPS4qLz1vZmYvJyBcCiAgICAgICAgICAgIC1lICdcQC92YXIvbHVuYS9wcmVmZXJlbmNlcy9kZXZtb2RlX2VuYWJsZWRAcy9pZiAvJmZhbHNlIFwmXCYgLycgXAogICAgICAgICAgICAnL3Vzci9iaW4vcnVuLWpzLXNlcnZpY2UnKSIK','base64').toString('utf8');
  const files=new Map(),events=[];let ino=0;
  function put(file,text,mode=384,uid=0,dir=false){files.set(file,{text,mode,uid,dir,ino:++ino});}
  put(DEF,'[D-BUS Service]\nName='+name+'\nExec=/usr/bin/run-js-service -n '+service+'\nType=dynamic\n',420);
  put('/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/run-js-service',source,509,1001);
  if(privateWrapper)put(ROOT+'/root-run-js-service',privateWrapper.text===undefined?source:privateWrapper.text,privateWrapper.mode===undefined?320:privateWrapper.mode,privateWrapper.uid===undefined?0:privateWrapper.uid);
  const missing=()=>Object.assign(Error('missing'),{code:'ENOENT'}),stat=e=>({uid:e.uid,mode:e.mode,nlink:1,size:Buffer.byteLength(e.text),ino:e.ino,dev:1,isFile:()=>!e.dir,isDirectory:()=>e.dir,isSymbolicLink:()=>false});
  const filesystem={constants:{O_RDONLY:0,O_WRONLY:1,O_CREAT:64,O_EXCL:128,O_NOFOLLOW:131072},lstatSync(file){if(!files.has(file))throw missing();return stat(files.get(file));},
    mkdirSync(file,mode){if(files.has(file))throw Object.assign(Error('exists'),{code:'EEXIST'});put(file,'',mode,0,true);},openSync(file,flags,mode){assert.ok(flags&131072);if(flags&128){if(files.has(file))throw Error('exists');put(file,'',mode);events.push('create:'+file);}if(!files.has(file))throw missing();return file;},
    readFileSync:file=>files.get(file).text,fstatSync:file=>stat(files.get(file)),closeSync(){},fsyncSync(){},writeFileSync(file,text){files.get(file).text=String(text);events.push('write:'+file);},renameSync(from,to){files.set(to,files.get(from));files.delete(from);events.push('rename:'+to);},unlinkSync:file=>files.delete(file)};
  const cp={execFile(command,args,options,callback){assert.ok(command==='/usr/bin/luna-send'||command==='/usr/sbin/ls-control');callback(null,command.endsWith('luna-send')?JSON.stringify({returnValue:true,modelName:'49UN7310PSC',firmwareVersion:'04.64.00',sdkVersion:'5.6.2',boardType:'K6LP_ATSC_BR'}):'');}};
  return{files,events,ROOT,DEF,async run(){let result;const m=require('../installer/screen-elevate.cjs');await m.elevateOnTV({fs:filesystem,crypto,cp,getuid:()=>0,pid:1,kill(){assert.fail('no process');},patchDefinition:m.patchDefinition,stopOwnService:()=>false,output:value=>result=value});return result;}};
}
test('vendor-owned writable source is copied by verified bytes and only the root-owned private copy is used',async()=>{
  const f=elevationFixture(),result=await f.run();assert.equal(result.ok,true);
  const privateCopy=f.files.get(f.ROOT+'/root-run-js-service');assert.equal(privateCopy.uid,0);assert.equal(privateCopy.mode,320);assert.equal(crypto.createHash('sha256').update(privateCopy.text).digest('hex'),'8d65bd23269fe9aff78a5ea4e08d37686e01754f157fde25b11eb288b37d732c');
  assert.match(f.files.get(f.DEF).text,/Exec=\/var\/lib\/mipantalla-maintenance\/screen\/root-run-js-service/);
});
for(const invalid of [{uid:1001},{mode:448},{text:'changed'}])test('an unsafe private executable is rejected before rewriting Exec: '+JSON.stringify(invalid),async()=>{
  const f=elevationFixture(invalid),result=await f.run();assert.equal(result.ok,false);assert.equal(f.events.some(event=>event==='rename:'+f.DEF),false);
});
