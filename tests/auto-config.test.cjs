const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const dir=path.join(__dirname,'../services/com.frxn.mipantalla.lights');
const createConfig=require(path.join(dir,'auto-config.js'));
const createControl=require(path.join(dir,'auto-control.js'));
const subscribe=require(path.join(dir,'luna-subscribe.js'));
const ROOT='/v/auto-sync';

function memoryFs(over={}){
  const files=new Map(),dirs=new Map();
  if(over.dir!==false)dirs.set(ROOT,{mode:over.dirMode||0o40700,uid:over.dirUid===undefined?0:over.dirUid});
  const fds=new Map();let n=10;
  const constants={O_RDONLY:0,O_WRONLY:1,O_CREAT:64,O_EXCL:128,O_NOFOLLOW:0};
  const entry=file=>files.get(file);
  const stat=e=>({isFile:()=>true,isSymbolicLink:()=>false,isDirectory:()=>false,nlink:e.nlink||1,size:e.text.length,uid:e.uid,mode:e.mode,ino:e.ino,dev:1});
  return {constants,files,
    mkdirSync(p){if(dirs.has(p))throw Object.assign(Error('EEXIST'),{code:'EEXIST'});dirs.set(p,{mode:0o40700,uid:0});},
    lstatSync(p){if(dirs.has(p)){const d=dirs.get(p);return {isDirectory:()=>true,isFile:()=>false,isSymbolicLink:()=>false,uid:d.uid,mode:d.mode};}
      const e=entry(p);if(!e)throw Object.assign(Error('ENOENT'),{code:'ENOENT'});return stat(e);},
    openSync(p){const fd=n++;if(!files.has(p))files.set(p,{text:'',mode:0o100600,uid:0,ino:files.size+1});fds.set(fd,p);return fd;},
    fstatSync(fd){return stat(entry(fds.get(fd)));},readFileSync(fd){return entry(fds.get(fd)).text;},
    writeFileSync(fd,t){entry(fds.get(fd)).text=t;},fsyncSync(){},closeSync(fd){fds.delete(fd);},
    renameSync(a,b){const e=files.get(a);files.delete(a);files.set(b,Object.assign(e,{ino:e.ino+100}));},
    unlinkSync(p){files.delete(p);},
    put(p,v,extra={}){files.set(p,Object.assign({text:typeof v==='string'?v:JSON.stringify(v),mode:0o100600,uid:0,ino:files.size+1},extra));}};
}
function make(over={}){let time=1000;const fs=memoryFs(over.fs);
  const cfg=createConfig({fs,root:ROOT,uid:over.uid===undefined?0:over.uid,now:()=>time,random:()=>'t'});
  return {fs,cfg,tick:ms=>{time+=ms;}};}

test('the switch defaults to off, round-trips, and is only written as a private root file',()=>{
  const t=make();
  assert.deepEqual(t.cfg.readConfig(),{enabled:false,invalid:false});
  t.cfg.writeConfig(true);assert.equal(t.cfg.readConfig().enabled,true);
  assert.equal(t.fs.files.get(ROOT+'/config.json').text,'{"enabled":true}');
  assert.equal(t.fs.files.get(ROOT+'/config.json').mode,0o100600);
  t.cfg.writeConfig(false);assert.equal(t.cfg.readConfig().enabled,false);
  assert.throws(()=>t.cfg.writeConfig('yes'));
});
test('a tampered, oversized or foreign-owned switch file reads as off and invalid',()=>{
  for(const extra of [{mode:0o100644},{uid:1000},{nlink:2}]){
    const fs=memoryFs();fs.put(ROOT+'/config.json','{"enabled":true}',extra);
    const cfg=createConfig({fs,root:ROOT,uid:0});assert.deepEqual(cfg.readConfig(),{enabled:false,invalid:true});
  }
  for(const text of ['{"enabled":true,"x":1}','{"enabled":"true"}','nope','[]']){
    const fs=memoryFs();fs.put(ROOT+'/config.json',text);
    assert.deepEqual(createConfig({fs,root:ROOT,uid:0}).readConfig(),{enabled:false,invalid:true});
  }
});
test('only root writes, and only inside a private root-owned directory',()=>{
  assert.throws(()=>make({uid:1000}).cfg.writeConfig(true),/AUTO_FILE_UNSAFE/);
  assert.equal(make({uid:1000}).cfg.available(),false);
  assert.throws(()=>make({fs:{dirMode:0o40755}}).cfg.writeConfig(true),/AUTO_FILE_UNSAFE/);
  assert.throws(()=>make({fs:{dirUid:1000}}).cfg.writeConfig(true),/AUTO_FILE_UNSAFE/);
  const fresh=make({fs:{dir:false}});fresh.cfg.writeConfig(true);assert.equal(fresh.cfg.readConfig().enabled,true);
});
test('status is validated, trimmed and goes stale after ninety seconds',()=>{
  const t=make();
  t.cfg.writeState({state:'syncing',app:'youtube.leanback.v4',reason:'x'.repeat(200),autoStarted:true,pid:77});
  const s=t.cfg.readState();assert.equal(s.state,'syncing');assert.equal(s.reason.length,60);assert.equal(s.pid,77);assert.equal(t.cfg.watching(s),true);
  t.tick(t.cfg.FRESH_MS+1);assert.equal(t.cfg.watching(s),false);
  assert.throws(()=>t.cfg.writeState({state:'bogus'}));
  t.fs.put(ROOT+'/state.json',{state:'syncing',updatedAt:'x',pid:5,autoStarted:true});assert.equal(t.cfg.readState(),null);
  t.cfg.writeState({state:'off',autoStarted:false,pid:null});assert.equal(t.cfg.watching(t.cfg.readState()),false);
});

test('Auto control reports unavailable without root and never launches anything',async()=>{
  let spawned=0;const t=make({uid:1000});
  const control=createControl({config:t.cfg,spawn:()=>{spawned++;}});
  assert.equal((await control.autoStatus()).available,false);
  await assert.rejects(control.setAuto({enabled:true}),/root/);assert.equal(spawned,0);
});
test('turning Auto on writes the switch and starts the watcher once; turning it off starts nothing',async()=>{
  const spawns=[];const t=make();
  const control=createControl({config:t.cfg,script:'/svc/auto-autostart.sh',spawn:(cmd,args,opts)=>{spawns.push([cmd,args,opts]);return {unref(){}};}});
  assert.deepEqual(await control.autoStatus(),{available:true,enabled:false,apps:['youtube.leanback.v4'],state:'off',watching:false,reason:'',app:null,autoStarted:false});
  const on=await control.setAuto({enabled:true});
  assert.equal(on.enabled,true);assert.equal(on.state,'starting');assert.equal(spawns.length,1);
  assert.deepEqual(spawns[0].slice(0,2),['/bin/sh',['/svc/auto-autostart.sh']]);assert.equal(spawns[0][2].detached,true);
  t.cfg.writeState({state:'idle',app:null,reason:'',autoStarted:false,pid:99});
  assert.equal((await control.setAuto({enabled:true})).state,'idle');assert.equal(spawns.length,1);
  assert.equal((await control.setAuto({enabled:false})).enabled,false);assert.equal(spawns.length,1);
  await assert.rejects(control.setAuto({enabled:'1'}),/inválido/);await assert.rejects(control.setAuto(null),/inválido/);
});
test('the allow-list cannot be changed through the API',async()=>{
  const t=make();const control=createControl({config:t.cfg,spawn:()=>({unref(){}})});
  await control.setAuto({enabled:true,apps:['netflix']});assert.deepEqual((await control.autoStatus()).apps,['youtube.leanback.v4']);
});

function fakeChild(){const child=new EventEmitter();child.stdout=new EventEmitter();child.kill=()=>{child.killed=true;};return child;}
test('subscription passes valid lines on, and reconnects after bad data or an exit',()=>{
  const children=[],seen=[],timers=[];
  const sub=subscribe('luna://x/y',{subscribe:true},m=>seen.push(m),{spawn:(cmd,args)=>{const c=fakeChild();c.args=args;children.push(c);return c;},
    setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){},env:{}});
  assert.deepEqual(children[0].args,['-i','luna://x/y','{"subscribe":true}']);
  children[0].stdout.emit('data',Buffer.from('{"returnValue":true,"appId":"a"}\n{"returnValue":true,'));
  children[0].stdout.emit('data',Buffer.from('"appId":"b"}\n'));
  assert.deepEqual(seen.map(m=>m.appId),['a','b']);
  children[0].stdout.emit('data',Buffer.from('garbage\n'));assert.equal(children[0].killed,true);assert.equal(timers.length,1);
  timers[0]();assert.equal(children.length,2);
  children[1].emit('exit');assert.equal(timers.length,2);
  sub.stop();timers[1]();assert.equal(children.length,2);
});
test('subscription rejects replies without returnValue and oversized buffers',()=>{
  const children=[];subscribe('u',{},()=>{},{spawn:()=>{const c=fakeChild();children.push(c);return c;},setTimeout:()=>1,clearTimeout(){},env:{}});
  children[0].stdout.emit('data',Buffer.from('{"returnValue":false}\n'));assert.equal(children[0].killed,true);
  const again=[];subscribe('u',{},()=>{},{spawn:()=>{const c=fakeChild();again.push(c);return c;},setTimeout:()=>1,clearTimeout(){},env:{}});
  again[0].stdout.emit('data',Buffer.alloc(9000,65));assert.equal(again[0].killed,true);
});
