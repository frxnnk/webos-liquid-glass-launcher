'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const EventEmitter=require('node:events');
const crypto=require('node:crypto');
test('configuration module serializes credentials only inside the TV and never enables LED output',()=>{
  const module=require('../installer/screen-configure.cjs');
  const source=module.configureScript({freshHyperhdr:true,hardwareConfirmed:false});
  assert.match(source,/randomBytes\(24\)/);assert.match(source,/credentials\.json/);assert.match(source,/O_EXCL/);
  assert.match(source,/newPasswordRequired/);assert.match(source,/localAdminAuth/);assert.doesNotMatch(source,/localAdminAuth\s*=\s*false/);
  assert.doesNotMatch(source,/component:'LEDDEVICE',state:true/);assert.match(source,/disableLedsStartup\s*=\s*true/);
});
test('hardware attestation defaults false and is only serialized from an explicit boolean',()=>{
  const {configureScript}=require('../installer/screen-configure.cjs');
  assert.match(configureScript({freshHyperhdr:true}),/"hardwareConfirmed":false/);
  assert.match(configureScript({freshHyperhdr:true,hardwareConfirmed:true}),/"hardwareConfirmed":true/);
});
test('configuration script is compatible JavaScript and has a finite deadline',()=>{
  const {configureScript}=require('../installer/screen-configure.cjs');
  const shell=configureScript({freshHyperhdr:true}),source=shell.split("MP_SCREEN_CONFIGURE'\n")[1].split('\nMP_SCREEN_CONFIGURE')[0];
  assert.doesNotThrow(()=>new vm.Script(source));assert.match(source,/setTimeout/);assert.doesNotMatch(source,/execFileSync|spawnSync/);
});
function fixture(options={}){
  const root='/var/lib/mipantalla-maintenance/screen',service='/media/developer/apps/usr/palm/services/com.frxn.mipantalla.lights';
  const entries=new Map(),events=[],rpcOptions=[],ids=Array.from({length:6},(_,i)=>'wiz-'+(i+1).toString(16).padStart(12,'0'));
  let watchdog,sequence=0,password='hyperhdr',userToken='PRIVATE_USER_TOKEN_'+('a'.repeat(64)),friendly=options.historicOwn?'Mi pantalla WiZ Living':'Default',output=options.active===true;
  let config={general:{disableLedsStartup:false},device:{type:options.foreign?'wiz':'file'},network:{apiAuth:true,localAdminAuth:true},flatbufServer:{enable:true,port:19400},smoothing:{enable:true},leds:[]};
  if(options.historicOwn){const order=[1,5,0,3,2,4];config.device={type:'wiz',dimming:71,lamps:order.map((index,i)=>({name:'Original '+i,macAddress:ids[index].slice(4).match(/../g).join(':').toUpperCase(),ipAddress:'192.168.50.'+(index+30)}))};config.leds=order.map((index,i)=>({hmin:i/6,hmax:(i+1)/6,vmin:0.1,vmax:0.9}));config.smoothing={enable:true,time_ms:225,updateFrequency:40};config.network.localAdminAuth=false;}
  if(options.wrongIdentity)config.device.lamps[0].macAddress='FF:FF:FF:FF:FF:FF';
  if(options.badLayout)config.leds[0].hmax=config.leds[0].hmin;
  let settings={address:'',port:19400,fps:30};
  let capture={isRunning:false,uiRunning:false,videoRunning:false,connected:false};
  function put(file,text,mode=384,dir=false){entries.set(file,{text,mode,dir,ino:++sequence});}
  put('/etc/starfish-release','Rockhopper release 5.6.2-21 (jhericurl-jimna)\n');
  put('/media/developer/apps/usr/palm/applications/com.frxn.mipantalla/lights-config.js','window.LAUNCHER_LIGHTS = '+JSON.stringify({selectedIds:ids})+';');
  put('/var/luna-service2-dev/roles.d/com.frxn.mipantalla.lights.service.json',JSON.stringify({appId:'com.frxn.mipantalla.lights',permissions:[{service:'com.frxn.mipantalla.lights',outbound:options.restrictedRole?[]:['*']}]}));
  if(options.existingDB){for(const directory of ['/home/root/.config','/home/root/.config/HyperHDR','/home/root/.config/HyperHDR/db'])put(directory,'',448,true);put('/home/root/.config/HyperHDR/db/hyperhdr.db','existing database');}
  const absent=()=>Object.assign(Error('missing'),{code:'ENOENT'}),stat=e=>({ino:e.ino,dev:1,uid:0,mode:e.mode,nlink:1,size:Buffer.byteLength(e.text),isFile:()=>!e.dir,isDirectory:()=>e.dir,isSymbolicLink:()=>false});
  const filesystem={constants:{O_RDONLY:0,O_WRONLY:1,O_CREAT:64,O_EXCL:128,O_NOFOLLOW:131072},lstatSync(file){if(!entries.has(file))throw absent();return stat(entries.get(file));},
    openSync(file,flags,mode){assert.ok(flags&131072);if(flags&128){if(entries.has(file))throw Error('exists');put(file,'',mode);events.push('create:'+file);}if(!entries.has(file))throw absent();return file;},
    fstatSync(file){return stat(entries.get(file));},readFileSync(file){if(!entries.has(file))throw absent();return entries.get(file).text;},closeSync(){},fsyncSync(){},
    mkdirSync(file,mode){if(entries.has(file))throw Object.assign(Error('exists'),{code:'EEXIST'});put(file,'',mode,true);},
    writeFileSync(file,text){if(options.failWrite&&file.endsWith(options.failWrite)){options.failWrite=null;throw Object.assign(Error('disk full'),{code:'ENOSPC'});}entries.get(file).text=String(text);events.push('write:'+file);},renameSync(from,to){if(options.failScreenPublish&&to===service+'/screen-config.json'){options.failScreenPublish=false;throw Object.assign(Error('disk full'),{code:'ENOSPC'});}entries.set(to,entries.get(from));entries.delete(from);events.push('rename:'+to);},
    unlinkSync(file){entries.delete(file);},chmodSync(file,mode){entries.get(file).mode=mode;},readdirSync(){return[];}};
  function luna(command,args,settingsArg,callback){if(command==='/usr/sbin/ls-control'){assert.deepEqual(args,['scan-services']);events.push('scan-services');callback(null,'');return;}const uri=args.at(-2),payload=JSON.parse(args.at(-1));rpcOptions.push({uri,timeout:settingsArg.timeout,maxBuffer:settingsArg.maxBuffer});let value={returnValue:true};
    if(uri.endsWith('/getSystemInfo'))Object.assign(value,{modelName:'49UN7310PSC',firmwareVersion:'04.64.00',sdkVersion:'5.6.2',boardType:'K6LP_ATSC_BR'});
    else if(uri.endsWith('/getState'))value.devices=ids.map((id,i)=>({id,ip:'192.168.50.'+(i+30),reachable:true,capabilities:{rgb:true},state:{on:true}}));
    else if(uri.endsWith('/getSettings'))Object.assign(value,settings);
    else if(uri.endsWith('/setSettings')){settings=payload;events.push('piccap');capture={isRunning:true,uiRunning:true,videoRunning:true,connected:true};if(options.expireDuringSetter)watchdog();if(options.setterRejected)value.returnValue=false;}
    else if(uri==='luna://org.webosbrew.piccap.service/stop'){events.push('piccap:stop');if(!options.stopUnconfirmed)capture={isRunning:false,uiRunning:false,videoRunning:false,connected:false};else value.returnValue=false;}
    else if(uri==='luna://org.webosbrew.piccap.service/status')Object.assign(value,capture);
    else if(uri.endsWith('/status'))value.running=false;
    else if(uri.endsWith('/start')){events.push('daemon:start');options.offline=false;if(options.rotateToken)userToken='PRIVATE_USER_TOKEN_'+crypto.randomBytes(32).toString('hex');}
    else assert.fail('unexpected service '+uri);
    callback(null,JSON.stringify(value));
  }
  function hyper(request){let info;
    if(request.command==='authorize'){
      if(request.subcommand==='newPasswordRequired')info={newPasswordRequired:password==='hyperhdr'};
      if(request.subcommand==='login'){if(request.token)assert.equal(request.token,userToken);else assert.equal(request.password,password);info={token:userToken};}
      if(request.subcommand==='newPassword'){assert.equal(request.password,password);assert.ok(entries.has(root+'/credentials.json'),'password must have durable recovery first');assert.ok(entries.has(root+'/before.json'),'config backup must precede password change');password=request.newPassword;events.push('password');}
    }else if(request.command==='serverinfo')info={currentInstance:0,instance:[{instance:0,running:true,friendly_name:friendly}],components:[{name:'LEDDEVICE',enabled:output}]};
    else if(request.command==='save-db')info={version:'HyperHDR_export_format_v20',instances:[{instance:0,enabled:1,friendly_name:friendly}],settings:Object.keys(config).map(type=>({type,hyperhdr_instance:0,config:JSON.stringify(config[type])}))};
    else if(request.command==='load-db'){assert.ok(entries.has(root+'/before.json'));if(!options.importNoop){for(const row of request.config.settings)config[row.type]=JSON.parse(row.config);friendly=request.config.instances[0].friendly_name;output=config.general.disableLedsStartup!==true;}events.push('config');return null;}
    else if(request.command==='config'){
      if(request.subcommand==='getconfig')info=JSON.parse(JSON.stringify(config));
      else{assert.equal(output,false,'driver configuration must not own the lamps');if(options.rejectLiveDevice&&request.config.device.type==='wiz')throw Error('unsafe live driver');config=request.config;events.push('config');}
    }else if(request.command==='componentstate'){assert.equal(request.componentstate.state,false,'preparation must never enable lamps');output=false;events.push('output:false');}
    else if(request.command==='instance')friendly=request.name;
    else assert.fail('unexpected HyperHDR command');
    return{success:true,tan:request.tan,info};
  }
  const network={createConnection(endpoint){assert.deepEqual(endpoint,{host:'127.0.0.1',port:19444});const socket=new EventEmitter();socket.write=line=>{const value=hyper(JSON.parse(line));queueMicrotask(()=>value===null?socket.emit('close'):socket.emit('data',Buffer.from(JSON.stringify(value)+'\n')));};socket.destroy=()=>{};queueMicrotask(()=>options.offline?socket.emit('error',Error('offline')):socket.emit('connect'));return socket;}};
  return{entries,events,rpcOptions,root,service,get config(){return config;},get capture(){return capture;},get userToken(){return userToken;},async run(runOptions={}){let result;
    const original=require('../installer/screen-configure.cjs').configureOnTV;
    const configure=options.expireDuringSetter?new Function('setTimeout','clearTimeout','return ('+original.toString()+');')((fn,ms)=>{if(ms===18000){watchdog=fn;return null;}return setTimeout(fn,ms===300?0:ms);},clearTimeout):original;
    await configure(runOptions,{fs:filesystem,net:network,crypto,cp:{execFile:luna},pid:1,getuid:()=>0,kill(){assert.fail('no process matched');},stopOwnService:require('../installer/screen-elevate.cjs').stopOwnService,output:value=>{result=value;}});return result;}};
}

test('preparation stops the capture that the native settings setter starts despite autostart false',async()=>{
  const f=fixture(),result=await f.run();assert.equal(result.ok,true);assert.equal(result.configured,true);
  assert.deepEqual(f.capture,{isRunning:false,uiRunning:false,videoRunning:false,connected:false});
  assert.equal(f.events.filter(e=>e==='piccap:stop').length,1);
});
test('an unconfirmed capture stop cannot report configured or finalize its credentials',async()=>{
  const f=fixture({stopUnconfirmed:true}),result=await f.run();assert.equal(result.ok,false);
  assert.notEqual(result.configured,true);assert.equal(JSON.parse(f.entries.get(f.root+'/credentials.json').text).phase,'prepared');
  assert.equal(f.entries.has(f.service+'/screen-config.json'),false);
});
test('a rejected settings response still stops capture after the owned setter was dispatched',async()=>{
  const f=fixture({setterRejected:true}),result=await f.run();assert.equal(result.ok,false);
  assert.deepEqual(f.capture,{isRunning:false,uiRunning:false,videoRunning:false,connected:false});
  assert.equal(f.events.filter(e=>e==='piccap:stop').length,1);
  assert.equal(f.entries.has(f.service+'/screen-config.json'),false);
});

for(const stopUnconfirmed of [false,true])test('deadline during native settings still attempts one stop without publishing runtime configuration: '+stopUnconfirmed,async()=>{
  const f=fixture({expireDuringSetter:true,stopUnconfirmed}),result=await f.run();
  assert.deepEqual(result,{ok:false,code:'SCREEN_CONFIGURATION_TIMEOUT'});
  assert.equal(f.events.filter(e=>e==='piccap:stop').length,1);
  assert.equal(f.entries.has(f.service+'/screen-config.json'),false);
  assert.equal(JSON.parse(f.entries.get(f.root+'/credentials.json').text).phase,'prepared');
  assert.deepEqual(f.capture,{isRunning:stopUnconfirmed,uiRunning:stopUnconfirmed,videoRunning:stopUnconfirmed,connected:stopUnconfirmed});
});
test('new configuration persists recovery before password changes and never touches lamp output',async()=>{
  const f=fixture(),result=await f.run({hardwareConfirmed:true});assert.equal(result.ok,true);assert.equal(result.hardwareVerified,true);assert.equal(f.config.network.localAdminAuth,true);assert.equal(f.config.network.apiAuth,true);
  const credentials=JSON.parse(f.entries.get(f.root+'/credentials.json').text);assert.equal(credentials.phase,'configured');assert.ok(credentials.token.length>36);assert.equal(f.entries.get(f.root+'/credentials.json').mode,384);assert.equal(f.config.general.disableLedsStartup,true);
  assert.ok(f.events.indexOf('password')<f.events.indexOf('config'));assert.equal(JSON.stringify(result).includes('PRIVATE_USER_TOKEN'),false);
});
test('rerunning owned configuration preserves its hardware confirmation',async()=>{
  const f=fixture();assert.equal((await f.run({hardwareConfirmed:true})).ok,true);const result=await f.run({hardwareConfirmed:false});assert.equal(result.ok,true);assert.equal(result.hardwareVerified,true);assert.equal(f.events.filter(event=>event==='password').length,1);
});
test('a foreign driver is preserved before any password or device mutation',async()=>{
  const f=fixture({foreign:true}),result=await f.run();assert.equal(result.ok,false);assert.equal(result.code,'SCREEN_EXISTING_CONFIGURATION');assert.equal(f.events.includes('password'),false);assert.equal(f.events.includes('config'),false);
});
test('a missing recovery backup blocks every resumed configuration mutation',async()=>{
  const f=fixture();assert.equal((await f.run()).ok,true);f.entries.delete(f.root+'/before.json');const count=f.events.filter(event=>['password','config','piccap'].includes(event)).length;
  const result=await f.run();assert.equal(result.ok,false);assert.equal(result.code,'SCREEN_BACKUP_REQUIRED');assert.equal(f.events.filter(event=>['password','config','piccap'].includes(event)).length,count);
});
for(const file of ['before.json','credentials.json'])test('ENOSPC while writing '+file+' cannot lead to password/config mutation on retry',async()=>{
  const f=fixture({failWrite:file});assert.equal((await f.run()).ok,false);assert.equal(f.events.some(event=>['password','config','piccap'].includes(event)),false);
  assert.equal((await f.run()).ok,false);assert.equal(f.events.some(event=>['password','config','piccap'].includes(event)),false);
});
test('preparation never relies on live driver changes that auto-enable WiZ output',async()=>{
  const f=fixture({rejectLiveDevice:true}),result=await f.run();assert.equal(result.ok,true);assert.equal(f.config.device.type,'wiz');assert.equal(f.config.general.disableLedsStartup,true);
});
test('a disconnect after load-db is insufficient without exact post-restart readback',async()=>{
  const f=fixture({importNoop:true}),result=await f.run();assert.equal(result.ok,false);assert.equal(result.code,'SCREEN_CONFIG_UNCONFIRMED');assert.equal(f.entries.has(f.service+'/screen-config.json'),false);assert.equal(f.entries.has(f.root+'/before.json'),true);assert.equal(f.entries.has(f.root+'/credentials.json'),true);
});
test('cold six-lamp discovery gets twelve seconds while unrelated Luna calls retain six',async()=>{
  const f=fixture();assert.equal((await f.run()).ok,true);
  assert.equal(f.rpcOptions.find(call=>call.uri.endsWith('/getState')).timeout,12000);
  assert.ok(f.rpcOptions.filter(call=>!call.uri.endsWith('/getState')&&!call.uri.endsWith('piccap.service/stop')).every(call=>call.timeout===6000));
  assert.equal(f.rpcOptions.find(call=>call.uri.endsWith('piccap.service/stop')).timeout,12000);
  assert.ok(f.rpcOptions.every(call=>call.maxBuffer===2097152));
  const source=require('../installer/screen-configure.cjs').configureScript({});assert.match(source,/18000\)/);
});
test('explicit adoption keeps an owned historical lamp order and layout while hardening admin auth',async()=>{
  const f=fixture({historicOwn:true}),device=JSON.parse(JSON.stringify(f.config.device)),leds=JSON.parse(JSON.stringify(f.config.leds)),smoothing=JSON.parse(JSON.stringify(f.config.smoothing));
  const result=await f.run({restoreExisting:true,hardwareConfirmed:true});assert.equal(result.ok,true);assert.deepEqual(f.config.device,device);assert.deepEqual(f.config.leds,leds);assert.deepEqual(f.config.smoothing,smoothing);assert.equal(f.config.network.localAdminAuth,true);
  assert.equal(JSON.parse(f.entries.get(f.root+'/before.json').text).hyperhdr.network.localAdminAuth,false);
});
test('a historical profile cannot be adopted implicitly',async()=>{
  const f=fixture({historicOwn:true}),result=await f.run();assert.equal(result.ok,false);assert.equal(result.code,'SCREEN_EXISTING_CONFIGURATION');assert.equal(f.events.includes('password'),false);
});
test('a previously adopted profile retains its layout on a later ordinary resume',async()=>{
  const f=fixture({historicOwn:true});assert.equal((await f.run({restoreExisting:true})).ok,true);const device=JSON.parse(JSON.stringify(f.config.device)),leds=JSON.parse(JSON.stringify(f.config.leds));assert.equal((await f.run()).ok,true);assert.deepEqual(f.config.device,device);assert.deepEqual(f.config.leds,leds);assert.equal(f.events.filter(event=>event==='password').length,1);
});
for(const option of ['wrongIdentity','badLayout','active'])test('adoption rejects '+option+' before password/device mutation',async()=>{
  const f=fixture({historicOwn:true,[option]:true}),result=await f.run({restoreExisting:true});assert.equal(result.ok,false);assert.equal(f.events.includes('password'),false);assert.equal(f.events.includes('config'),false);
});
test('adoption cannot start a stopped historical daemon before checking its persisted output policy',async()=>{
  const f=fixture({historicOwn:true,offline:true,existingDB:true}),result=await f.run({restoreExisting:true,freshHyperhdr:true});assert.equal(result.ok,false);assert.equal(result.code,'SCREEN_EXISTING_CAPTURE_STOPPED');assert.equal(f.events.includes('daemon:start'),false);assert.equal(f.events.includes('password'),false);
});
test('a newly installed package does not authorize starting a pre-existing database',async()=>{
  const f=fixture({offline:true,existingDB:true}),result=await f.run({freshHyperhdr:true});assert.equal(result.ok,false);assert.equal(f.events.includes('daemon:start'),false);assert.equal(f.events.includes('password'),false);
});
test('a cold first start is allowed only with fresh packages and both known databases absent',async()=>{
  const f=fixture({offline:true}),result=await f.run({freshHyperhdr:true});assert.equal(result.ok,true);assert.equal(f.events.filter(event=>event==='daemon:start').length,2);
});
test('daemon restart rotates the user token and preparation reauthenticates using its durable password',async()=>{
  const f=fixture({rotateToken:true}),result=await f.run();assert.equal(result.ok,true);assert.equal(JSON.parse(f.entries.get(f.root+'/credentials.json').text).token,f.userToken);assert.equal(JSON.parse(f.entries.get(f.service+'/screen-config.json').text).token,f.userToken);
});
test('a later preparation accepts its own previous screen token and replaces it with the new one',async()=>{
  const behavior={},f=fixture(behavior);assert.equal((await f.run()).ok,true);const old=f.userToken;const settings=JSON.parse(f.entries.get(f.service+'/screen-config.json').text);assert.equal(settings.token,old);
  // Each following controlled daemon restart now generates a different token.
  f.entries.get(f.root+'/credentials.json').text=JSON.stringify(Object.assign(JSON.parse(f.entries.get(f.root+'/credentials.json').text),{phase:'prepared'}));
  behavior.rotateToken=true;
  const result=await f.run();assert.equal(result.ok,true);assert.notEqual(f.userToken,old);assert.equal(JSON.parse(f.entries.get(f.service+'/screen-config.json').text).token,f.userToken);
});
test('interrupted publication preserves the exact owned old token for a later verified resume',async()=>{
  const behavior={},f=fixture(behavior);assert.equal((await f.run()).ok,true);const old=JSON.parse(f.entries.get(f.service+'/screen-config.json').text).token;
  behavior.rotateToken=true;behavior.failScreenPublish=true;assert.equal((await f.run()).ok,false);
  const saved=JSON.parse(f.entries.get(f.root+'/credentials.json').text);assert.notEqual(saved.token,old);assert.equal(saved.previousToken,old);
  assert.equal(JSON.parse(f.entries.get(f.service+'/screen-config.json').text).token,old);
  assert.equal((await f.run()).ok,true);assert.equal(JSON.parse(f.entries.get(f.service+'/screen-config.json').text).token,f.userToken);
  assert.equal(JSON.parse(f.entries.get(f.root+'/credentials.json').text).previousToken,null);assert.equal(f.config.general.disableLedsStartup,true);
});
test('a token outside the exact owned current and prior values cannot be adopted on resume',async()=>{
  const behavior={},f=fixture(behavior);assert.equal((await f.run()).ok,true);
  const file=f.service+'/screen-config.json',c=JSON.parse(f.entries.get(file).text);c.token='PRIVATE_FOREIGN_TOKEN_'+('f'.repeat(64));f.entries.get(file).text=JSON.stringify(c);
  const writes=f.events.filter(e=>e==='config'||e==='password').length;behavior.rotateToken=true;
  const result=await f.run();assert.equal(result.ok,false);assert.equal(result.code,'SCREEN_EXISTING_CONFIGURATION');assert.equal(f.events.filter(e=>e==='config'||e==='password').length,writes);
});
test('malformed token recovery metadata is rejected before configuration changes',async()=>{
  const f=fixture();assert.equal((await f.run()).ok,true);const file=f.root+'/credentials.json',c=JSON.parse(f.entries.get(file).text);c.previousToken={foreign:true};f.entries.get(file).text=JSON.stringify(c);
  const count=f.events.length;assert.equal((await f.run()).code,'SCREEN_CREDENTIALS_INVALID');assert.equal(f.events.length,count);
});
test('the narrow PicCap role permission is scanned with the installed ls-control path',async()=>{
  const f=fixture({restrictedRole:true});assert.equal((await f.run()).ok,true);assert.equal(f.events.filter(e=>e==='scan-services').length,1);
  const role=JSON.parse(f.entries.get('/var/luna-service2-dev/roles.d/com.frxn.mipantalla.lights.service.json').text);assert.deepEqual(role.permissions[0].outbound,['org.webosbrew.piccap.service']);
});
