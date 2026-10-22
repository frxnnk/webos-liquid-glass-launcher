'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const base=path.join(__dirname,'../installer');
function modules(){
  assert.ok(fs.existsSync(path.join(base,'steps-remote.cjs')),'TV helper must exist');
  return {remote:require('../installer/steps-remote.cjs'),files:require('../installer/steps-files.cjs'),steps:require('../installer/steps.cjs'),profile:require('../installer/model-profile.json')};
}
const ID='a'.repeat(32), ROOT='/var/lib/mipantalla-maintenance', DIR=ROOT+'/setup/'+ID;
const APP='/media/developer/apps/usr/palm/applications/com.frxn.mipantalla/appinfo.json';
const SERVICE='/media/developer/apps/usr/palm/services/com.frxn.mipantalla.lights';
function fixture(options={}){
  const m=modules(),entries={},events=[],calls=[];let seq=1;
  const missing=()=>Object.assign(Error('private TOKEN'),{code:'ENOENT'});
  function put(p,data,mode=384,dir=false){entries[p]={data,mode,dir,uid:0,ino:seq++};}
  function stat(e){return {uid:e.uid,mode:e.mode,nlink:1,size:Buffer.byteLength(e.data||''),ino:e.ino,dev:1,isFile:()=>!e.dir&&!e.link,isDirectory:()=>!!e.dir&&!e.link,isSymbolicLink:()=>!!e.link};}
  for(const p of [ROOT,'/var/lib/webosbrew','/var/lib/webosbrew/init.d'])put(p,'',448,true);
  put('/etc/starfish-release','Rockhopper release 5.6.2-21 (jhericurl-jimna)\n');put(APP,JSON.stringify({id:'com.frxn.mipantalla',version:'0.7.7'}));
  for(const p of ['home-watch.js','home-input.js','home-power.js','home-autostart.sh'])put(SERVICE+'/'+p,'source');
  const f={constants:{O_RDONLY:0,O_WRONLY:1,O_CREAT:64,O_EXCL:128,O_NOFOLLOW:131072},
    lstatSync(p){if(!entries[p])throw missing();return stat(entries[p]);},
    mkdirSync(p,mode){if(entries[p])throw Object.assign(Error('exists'),{code:'EEXIST'});put(p,'',mode,true);events.push('mkdir:'+p);},
    openSync(p,flags,mode){assert.ok(flags&131072,'all reads/writes use O_NOFOLLOW');if(flags&128){if(entries[p])throw Error('exists');put(p,'',mode);events.push('create:'+p);}if(!entries[p])throw missing();if(entries[p].link)throw Error('link TOKEN');return p;},
    fstatSync(p){return stat(entries[p]);},readSync(p,b,o,n){return Buffer.from(entries[p].data).copy(b,o,0,n);},closeSync(){},fsyncSync(){},
    fchmodSync(p,mode){entries[p].mode=mode;},ftruncateSync(p){entries[p].data='';},
    writeFileSync(p,data){entries[p].data=String(data);events.push('write:'+p);},unlinkSync(p){if(!entries[p])throw missing();delete entries[p];events.push('unlink:'+p);}
  };
  const current={general:{defaultApps:{home:'com.webos.app.fullhome',browser:'PRESERVE'},homePromotion:'on',screenSaverAd:'on',adCookie:'on',customizedAd:'off'},option:{livePlus:'on',livePromotion:'on',webOSPromotionVideo:'on'},rdxd:{analyticsLog:true,crashLog:false},apps:[{id:'webos.day',systemApp:false,removable:true,version:'1'}]};
  function rpc(args){
    const uri=args[3],payload=JSON.parse(args[4]);calls.push({uri,payload});
    if(uri.endsWith('/getSystemInfo'))return {returnValue:true,modelName:'49UN7310PSC',firmwareVersion:'04.64.00',sdkVersion:'5.6.2',boardType:'K6LP_ATSC_BR'};
    if(uri.endsWith('/getSystemSettings'))return {returnValue:true,settings:JSON.parse(JSON.stringify(current[payload.category]))};
    if(uri.endsWith('/setSystemSettings')){events.push('set:'+payload.category);Object.assign(current[payload.category],payload.settings);return {returnValue:true};}
    if(uri.endsWith('/listApps'))return {returnValue:true,apps:current.apps};
    if(uri.endsWith('/remove')){events.push('remove:'+payload.id);if(!options.keepRemoved)current.apps=current.apps.filter(a=>a.id!==payload.id);return {returnValue:true};}
    if(uri.endsWith('/getLogSettings'))return Object.assign({returnValue:true},current.rdxd);
    if(uri.endsWith('/setLogSettings')){events.push('set:rdxd');Object.assign(current.rdxd,payload);return {returnValue:true};}
    throw Error('unknown '+uri);
  }
  const cp={execFileSync(){throw Error('Node 8 TV libuv crash: synchronous child process forbidden');},execFile(command,args,settings,cb){
    assert.equal(command,'/usr/bin/luna-send');assert.ok(settings.timeout<=3000);
    setImmediate(()=>{try{cb(null,JSON.stringify(rpc(args)));}catch(error){cb(error);}});
  }};
  const run=request=>new Promise(resolve=>m.remote.remoteMain(request,{fs:f,cp,getuid:()=>0,setTimer:fn=>setImmediate(fn),fingerprint:m.steps.fingerprint,privacy:require('../scripts/tv/privacy-log-settings.js'),files:m.files.makeFiles(f,request.backupId||ID),output:resolve},m.profile));
  return {m,run,current,entries,events,calls,put,fs:f,cp};
}
test('TV status is read-only and reads release plus exact Luna system fields',async()=>{
  const f=fixture(),r=await f.run({action:'inspect'});assert.equal(r.ok,true);assert.equal(r.snapshot.system.modelName,'49UN7310PSC');assert.equal(r.snapshot.release.version,'5.6.2-21');
  assert.deepEqual(f.events,[]);assert.ok(f.calls.every(c=>!c.uri.includes('/set')&&!c.uri.includes('/remove')));
});
test('TV apply backs up before every mutation, preserves other Home defaults and isolates privacy baseline',async()=>{
  const f=fixture(),before=(await f.run({action:'inspect'})).snapshot;
  const r=await f.run({action:'apply',backupId:ID,expected:f.m.steps.fingerprint(before),options:{home:true,privacy:true,removeApps:[]}});
  assert.equal(r.ok,true);assert.equal(r.homeProof,'pending');assert.equal(f.current.general.defaultApps.home,'com.frxn.mipantalla');assert.equal(f.current.general.defaultApps.browser,'PRESERVE');
  assert.equal(f.current.option.livePlus,'off');assert.deepEqual(f.current.rdxd,{analyticsLog:false,crashLog:false});
  assert.ok(f.events.indexOf('write:'+DIR+'/before.json')<f.events.indexOf('set:general'));
  assert.ok(f.entries[DIR+'/privacy-rdxd/settings-before.json']);assert.equal(f.entries[DIR+'/before.json'].mode,384);
  assert.ok(f.events.filter(e=>e.startsWith('write:')).every(e=>e.startsWith('write:'+DIR+'/')),'hook installation belongs to the separate verified hook module');
});
test('remote revalidation rejects drift and unsafe backups before a settings write',async()=>{
  const f=fixture(),before=(await f.run({action:'inspect'})).snapshot;f.current.option.livePlus='off';
  let r=await f.run({action:'apply',backupId:ID,expected:f.m.steps.fingerprint(before),options:{privacy:true}});assert.equal(r.ok,false);assert.equal(f.events.length,0);
  const fresh=(await f.run({action:'inspect'})).snapshot;f.put(DIR,'',448,true);f.put(ROOT+'/setup','',448,true);f.put(DIR+'/before.json','{}');f.entries[DIR+'/before.json'].link=true;
  r=await f.run({action:'apply',backupId:ID,expected:f.m.steps.fingerprint(fresh),options:{privacy:true}});assert.equal(r.ok,false);assert.equal(f.events.filter(e=>e.startsWith('set:')).length,0);
});
test('restore merges only the old Home target into the current map and restores exact previous privacy flags',async()=>{
  const f=fixture(),before=(await f.run({action:'inspect'})).snapshot;
  await f.run({action:'apply',backupId:ID,expected:f.m.steps.fingerprint(before),options:{home:true,privacy:true,removeApps:[]}});
  f.current.general.defaultApps.browser='NEW-BROWSER';const r=await f.run({action:'restore',backupId:ID});assert.equal(r.ok,true);
  assert.equal(f.current.general.defaultApps.home,'com.webos.app.fullhome');assert.equal(f.current.general.defaultApps.browser,'NEW-BROWSER');assert.deepEqual(f.current.rdxd,{analyticsLog:true,crashLog:false});
});
test('removals enforce fixed IDs and current inventory flags, and never retry an unconfirmed uninstall',async()=>{
  for(const unsafe of [true,false]){const f=fixture({keepRemoved:!unsafe}),before=(await f.run({action:'inspect'})).snapshot;
    if(unsafe)f.current.apps[0].systemApp=true;
    const snapshot=(await f.run({action:'inspect'})).snapshot;
    const r=await f.run({action:'apply',backupId:ID,expected:f.m.steps.fingerprint(snapshot),options:{removeApps:['webos.day']}});assert.equal(r.ok,false);
    assert.equal(f.calls.filter(c=>c.uri.endsWith('/remove')).length,unsafe?0:1);
  }
});
test('TV child wrapper blanks preload without mutating inherited or explicit environments or process options',()=>{
  const wrap=modules().steps.wrapTvExecFile;
  assert.equal(typeof wrap,'function');
  const inherited=Object.freeze({PATH:'/usr/bin',LD_PRELOAD:'parent-preload'}),explicit=Object.freeze({PATH:'/bin',LD_PRELOAD:'custom-preload'});
  const calls=[],handle={},callback=()=>{};
  const exec=wrap({execFile(command,args,settings,cb){calls.push({command,args,settings,cb});return handle;}},inherited);
  for(const env of [undefined,explicit]){
    const options=Object.freeze(Object.assign({timeout:2500,maxBuffer:8192,killSignal:'SIGKILL',encoding:'utf8'},env?{env}:{}));
    assert.equal(exec('/usr/bin/luna-send',['-n','1'],options,callback),handle);
    const received=calls[calls.length-1];assert.notEqual(received.settings,options);assert.notEqual(received.settings.env,env||inherited);
    assert.equal(received.settings.env.LD_PRELOAD,'');assert.equal(received.settings.env.PATH,(env||inherited).PATH);
    for(const key of ['timeout','maxBuffer','killSignal','encoding'])assert.equal(received.settings[key],options[key]);
    assert.equal(received.cb,callback);assert.equal(options.env,env);
  }
  assert.equal(inherited.LD_PRELOAD,'parent-preload');assert.equal(explicit.LD_PRELOAD,'custom-preload');
});
test('the actual serialized status script neutralizes child preload for RPC and privacy without synchronous subprocesses',async()=>{
  const f=fixture(),script=f.m.steps.script({action:'inspect'});
  assert.ok(script.includes('/usr/bin/node -e "eval(require(\'fs\').readFileSync(3,\'utf8\'))" </dev/null 3<<\'MP_SETUP_NODE\'\n'),'code uses FD3 while child stdin remains /dev/null');
  assert.doesNotMatch(script,/execFileSync|execSync|spawnSync|require\(['"]node:/);
  const js=script.slice(script.indexOf("'use strict';"),script.lastIndexOf('\nMP_SETUP_NODE'));
  const inherited=Object.freeze({PATH:'/usr/bin'}),settingsSeen=[];
  const child={execFile(command,args,settings,cb){
    settingsSeen.push(settings);
    if(!settings.env||!Object.hasOwn(settings.env,'LD_PRELOAD')||settings.env.LD_PRELOAD!=='')return setImmediate(()=>cb(Error('simulated TV SIGABRT')));
    return f.cp.execFile(command,args,settings,cb);
  }};
  const result=await new Promise(resolve=>{
    const localRequire=name=>name==='fs'?f.fs:name==='child_process'?child:require(name);
    vm.runInNewContext(js,{require:localRequire,Buffer,Promise,setTimeout,process:{env:inherited,getuid:()=>0,stdout:{write:raw=>resolve(JSON.parse(raw))}}});
  });
  assert.equal(result.ok,true);assert.equal(result.snapshot.release.version,'5.6.2-21');assert.deepEqual(f.events,[]);
  assert.ok(settingsSeen.some(options=>options.maxBuffer===2097152));assert.ok(settingsSeen.some(options=>options.maxBuffer===8192),'privacy helper uses the shared wrapper');
  assert.equal(Object.hasOwn(inherited,'LD_PRELOAD'),false);assert.ok(settingsSeen.every(options=>options.env.PATH==='/usr/bin'&&options.env.LD_PRELOAD===''));
});
