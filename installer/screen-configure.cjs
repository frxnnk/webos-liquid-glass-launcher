'use strict';
async function configureOnTV(options,deps){
  var fs=deps.fs,crypto=deps.crypto,net=deps.net,cp=deps.cp;
  var ROOT='/var/lib/mipantalla-maintenance/screen',PROFILE='Mi pantalla WiZ Living';
  var APP='/media/developer/apps/usr/palm/applications/com.frxn.mipantalla';
  var SERVICE='/media/developer/apps/usr/palm/services/com.frxn.mipantalla.lights';
  var ROLE='/var/luna-service2-dev/roles.d/com.frxn.mipantalla.lights.service.json';
  var socket,timer,tan=0,pending=null,buffer='',completed=false;
  function object(v){return v!==null&&typeof v==='object'&&!Array.isArray(v);}
  function validToken(value){return typeof value==='string'&&value.length>36&&value.length<=2048&&!/[\x00-\x1f\x7f]/.test(value);}
  function alive(){if(completed)throw Error('SCREEN_CONFIGURATION_TIMEOUT');}
  function read(file,limit,privateFile){
    alive();
    try{var s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>limit||privateFile&&(s.uid!==0||(s.mode&511)!==384))throw Error('SCREEN_FILE_UNSAFE');
      var fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
      try{var actual=fs.fstatSync(fd);if(actual.ino!==s.ino||actual.dev!==s.dev)throw Error('SCREEN_FILE_UNSAFE');return fs.readFileSync(fd,'utf8');}finally{fs.closeSync(fd);}
    }catch(e){if(e.code==='ENOENT')return null;throw e;}
  }
  function directory(p){alive();try{fs.mkdirSync(p,448);}catch(e){if(e.code!=='EEXIST')throw e;}var s=fs.lstatSync(p);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&511)!==448)throw Error('SCREEN_DIRECTORY_UNSAFE');}
  function fresh(file,value){alive();var fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,384);try{fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
  function save(file,value){
    var old=read(file,262144,true),temporary=file+'.'+crypto.randomBytes(8).toString('hex')+'.tmp';
    fresh(temporary,value);try{if(old!==null)read(file,262144,true);fs.renameSync(temporary,file);}catch(e){try{fs.unlinkSync(temporary);}catch(ignored){}throw e;}
  }
  function exec(command,args,timeout){alive();return new Promise(function(resolve,reject){cp.execFile(command,args,{encoding:'utf8',timeout:timeout||2500,maxBuffer:2097152},function(error,out){if(error)reject(Error('SCREEN_COMMAND_UNCONFIRMED'));else resolve(String(out));});});}
  async function luna(uri,payload,app){var args=['-n','1','-f'];if(app)args.push('-a','com.frxn.mipantalla');args.push(uri,JSON.stringify(payload));var value=JSON.parse(await exec('/usr/bin/luna-send',args,app?12000:6000));if(!object(value)||value.returnValue!==true)throw Error('SCREEN_SERVICE_UNCONFIRMED');return value;}
  function connect(){return new Promise(function(resolve,reject){
    buffer='';socket=net.createConnection({host:'127.0.0.1',port:19444});var connection=socket,connected=false;
    var deadline=setTimeout(function(){reject(Error('SCREEN_HYPERHDR_TIMEOUT'));socket.destroy();},2000);
    socket.on('connect',function(){connected=true;clearTimeout(deadline);resolve();});
    socket.on('error',function(){clearTimeout(deadline);if(!connected)reject(Error('SCREEN_HYPERHDR_OFFLINE'));if(pending){var p=pending;pending=null;clearTimeout(p.timer);p.reject(Error('SCREEN_HYPERHDR_OFFLINE'));}});
    socket.on('close',function(){if(socket!==connection||!pending)return;var p=pending;pending=null;clearTimeout(p.timer);if(p.acceptClose)p.resolve({closed:true});else p.reject(Error('SCREEN_HYPERHDR_OFFLINE'));});
    socket.on('data',function(bytes){buffer+=bytes.toString('utf8');if(buffer.length>2097152){socket.destroy();return;}var end;
      while((end=buffer.indexOf('\n'))!==-1){var line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!line.trim())continue;var value;try{value=JSON.parse(line);}catch(e){socket.destroy();return;}
        if(pending&&value.tan===pending.tan){var p=pending;pending=null;clearTimeout(p.timer);if(value.success!==true)p.reject(Error('SCREEN_HYPERHDR_REJECTED'));else p.resolve(value);}
      }
    });
  });}
  function rpc(command,acceptClose){alive();return new Promise(function(resolve,reject){if(pending){reject(Error('SCREEN_HYPERHDR_BUSY'));return;}command.tan=++tan;var p={tan:tan,acceptClose:acceptClose===true,resolve:resolve,reject:reject,timer:setTimeout(function(){if(pending===p)pending=null;reject(Error('SCREEN_HYPERHDR_TIMEOUT'));},1800)};pending=p;socket.write(JSON.stringify(command)+'\n');});}
  async function info(){var value=await rpc({command:'serverinfo'});if(!value.info||value.info.currentInstance!==0||!Array.isArray(value.info.instance)||!value.info.instance.some(function(i){return i.instance===0&&i.running===true;}))throw Error('SCREEN_INSTANCE_INVALID');return value.info;}
  function output(info){var value=Array.isArray(info.components)&&info.components.filter(function(c){return c.name==='LEDDEVICE';})[0];if(!value||typeof value.enabled!=='boolean')throw Error('SCREEN_OUTPUT_UNKNOWN');return value.enabled;}
  function selected(){var raw=read(APP+'/lights-config.js',16384,false),match=raw&&/window\.LAUNCHER_LIGHTS\s*=\s*(\{[\s\S]*\})\s*;?\s*$/.exec(raw);if(!match)throw Error('SCREEN_SELECTION_REQUIRED');var value=JSON.parse(match[1]),ids=value&&value.selectedIds;if(!Array.isArray(ids)||ids.length!==6||ids.some(function(id,i){return typeof id!=='string'||!/^wiz-[a-f0-9]{12}$/.test(id)||ids.indexOf(id)!==i;}))throw Error('SCREEN_SELECTION_INVALID');return ids;}
  function lampList(result,ids){
    if(!result||!Array.isArray(result.devices)||result.devices.length!==6)throw Error('SCREEN_LAMPS_UNCONFIRMED');
    return ids.map(function(id,i){var matches=result.devices.filter(function(d){return d&&d.id===id;});var d=matches[0];if(matches.length!==1||d.reachable!==true||!d.capabilities||d.capabilities.rgb!==true||!d.state||typeof d.state.on!=='boolean'||typeof d.ip!=='string')throw Error('SCREEN_LAMPS_UNCONFIRMED');var octets=d.ip.split('.');if(octets.length!==4||octets.some(function(n){return !/^(0|[1-9][0-9]{0,2})$/.test(n)||Number(n)>255;})||!(Number(octets[0])===10||Number(octets[0])===192&&Number(octets[1])===168||Number(octets[0])===172&&Number(octets[1])>=16&&Number(octets[1])<=31))throw Error('SCREEN_LAMPS_UNCONFIRMED');return{name:'Living '+(i+1),ipAddress:d.ip,macAddress:id.slice(4).match(/../g).join(':')};});
  }
  function ownWiz(config,lamps){
    if(!config||!config.device||config.device.type!=='wiz'||config.device.port!==undefined&&config.device.port!==38899||!Array.isArray(config.device.lamps)||config.device.lamps.length!==6||!Array.isArray(config.leds)||config.leds.length!==6)return false;
    var seen={};
    if(!config.device.lamps.every(function(lamp){
      var mac=lamp&&typeof lamp.macAddress==='string'&&lamp.macAddress.toLowerCase().replace(/:/g,'');
      if(!mac||!/^[a-f0-9]{12}$/.test(mac)||seen[mac])return false;seen[mac]=true;
      return lamps.some(function(current){return current.macAddress.replace(/:/g,'')===mac&&current.ipAddress===lamp.ipAddress;});
    }))return false;
    return config.leds.every(function(led){return led&&led.disabled!==true&&['hmin','hmax','vmin','vmax'].every(function(key){return typeof led[key]==='number'&&isFinite(led[key])&&led[key]>=0&&led[key]<=1;})&&led.hmin<led.hmax&&led.vmin<led.vmax;});
  }
  function knownDatabasesAbsent(){
    var roots=['/home/root/.hyperhdr','/home/root/.config/HyperHDR'];
    for(var i=0;i<roots.length;i++){
      var directories=i===0?[roots[i],roots[i]+'/db']:['/home/root/.config',roots[i],roots[i]+'/db'];
      directories.forEach(function(directory){try{var s=fs.lstatSync(directory);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&18)!==0)throw Error('SCREEN_DATABASE_UNSAFE');}catch(e){if(e.code!=='ENOENT')throw e;}});
      try{var file=fs.lstatSync(roots[i]+'/db/hyperhdr.db');if(!file.isFile()||file.isSymbolicLink()||file.uid!==0||file.nlink!==1)throw Error('SCREEN_DATABASE_UNSAFE');return false;}catch(e){if(e.code!=='ENOENT')throw e;}
    }
    return true;
  }
  function finish(value){if(completed)return;completed=true;clearTimeout(timer);if(pending){var p=pending;clearTimeout(p.timer);pending=null;p.reject(Error('SCREEN_CONFIGURATION_TIMEOUT'));}if(socket)socket.destroy();deps.output(value);}
  timer=setTimeout(function(){finish({ok:false,code:'SCREEN_CONFIGURATION_TIMEOUT'});},18000);
  try{
    if(deps.getuid()!==0)throw Error('SCREEN_ROOT_REQUIRED');
    var device=await luna('luna://com.webos.service.tv.systemproperty/getSystemInfo',{keys:['modelName','firmwareVersion','sdkVersion','boardType']});
    if(device.modelName!=='49UN7310PSC'||device.firmwareVersion!=='04.64.00'||device.sdkVersion!=='5.6.2'||device.boardType!=='K6LP_ATSC_BR'||read('/etc/starfish-release',4096,false)!=='Rockhopper release 5.6.2-21 (jhericurl-jimna)\n')throw Error('SCREEN_PROFILE_UNSUPPORTED');
    var ids=selected(),lamps=lampList(await luna('luna://com.frxn.mipantalla.lights/getState',{ids:ids},true),ids);
    var session=read('/media/internal/mi-pantalla-lights/screen-session.json',32768,false);if(session!==null)throw Error('SCREEN_RECOVERY_PENDING');
    directory('/var/lib/mipantalla-maintenance');directory(ROOT);
    var credentialsFile=ROOT+'/credentials.json',oldCredentials=read(credentialsFile,16384,true),credentials=oldCredentials!==null?JSON.parse(oldCredentials):null;
    if(credentials&&(!object(credentials)||typeof credentials.password!=='string'||!/^[a-f0-9]{48}$/.test(credentials.password)||!Array.isArray(credentials.ids)||JSON.stringify(credentials.ids)!==JSON.stringify(ids)||['prepared','configured'].indexOf(credentials.phase)===-1||credentials.adopted!==undefined&&typeof credentials.adopted!=='boolean'))throw Error('SCREEN_CREDENTIALS_INVALID');
    if(oldCredentials!==null&&!object(credentials))throw Error('SCREEN_CREDENTIALS_INVALID');
    if(credentials&&(!(validToken(credentials.token)||credentials.phase==='prepared'&&credentials.token===null)||credentials.previousToken!==undefined&&credentials.previousToken!==null&&!validToken(credentials.previousToken)))throw Error('SCREEN_CREDENTIALS_INVALID');
    var screenText=read(SERVICE+'/screen-config.json',8192,true),screenBefore=screenText!==null?JSON.parse(screenText):null;
    if(screenText!==null&&(!object(screenBefore)||screenBefore.profile!==PROFILE||!validToken(screenBefore.token)||credentials&&screenBefore.token!==credentials.token&&screenBefore.token!==credentials.previousToken))throw Error('SCREEN_EXISTING_CONFIGURATION');
    var beforeText=read(ROOT+'/before.json',262144,true),before=beforeText!==null?JSON.parse(beforeText):null;
    if(credentials&&before===null)throw Error('SCREEN_BACKUP_REQUIRED');
    if(beforeText!==null&&(!object(before)||before.version!==1||JSON.stringify(before.ids)!==JSON.stringify(ids)||!object(before.hyperhdr)||!object(before.hyperhdr.device)||!object(before.database)||!Array.isArray(before.database.settings)||!Array.isArray(before.database.instances)||!object(before.piccap)||!object(before.role)))throw Error('SCREEN_BACKUP_INVALID');
    try{await connect();}catch(error){
      if(options.restoreExisting===true||options.freshHyperhdr!==true||!knownDatabasesAbsent())throw Error('SCREEN_EXISTING_CAPTURE_STOPPED');
      await luna('luna://org.webosbrew.hyperhdr.loader.service/start',{});
      await new Promise(function(resolve){setTimeout(resolve,300);});await connect();
    }
    var required=await rpc({command:'authorize',subcommand:'newPasswordRequired'});
    if(!required.info||typeof required.info.newPasswordRequired!=='boolean')throw Error('SCREEN_AUTH_UNCONFIRMED');
    if(!credentials&&!required.info.newPasswordRequired)throw Error('SCREEN_EXISTING_CONFIGURATION');
    var login=await rpc({command:'authorize',subcommand:'login',password:required.info.newPasswordRequired?'hyperhdr':credentials.password});
    if(!login.info||typeof login.info.token!=='string'||login.info.token.length<=36||login.info.token.length>2048)throw Error('SCREEN_ADMIN_UNCONFIRMED');
    if(!credentials&&screenBefore&&screenBefore.token!==login.info.token)throw Error('SCREEN_EXISTING_CONFIGURATION');
    var original=(await rpc({command:'config',subcommand:'getconfig'})).info,server=await info();
    var exported=(await rpc({command:'save-db'})).info;
    if(!object(exported)||['HyperHDR_export_format_v17','HyperHDR_export_format_v20'].indexOf(exported.version)===-1||!Array.isArray(exported.instances)||exported.instances.length!==1||exported.instances[0].instance!==0||!Array.isArray(exported.settings)||exported.settings.length>200)throw Error('SCREEN_DATABASE_UNCONFIRMED');
    if(!object(original)||!object(original.device)||!object(original.general)||!object(original.network))throw Error('SCREEN_CONFIG_UNCONFIRMED');
    var own=server.instance.filter(function(i){return i.instance===0;})[0].friendly_name===PROFILE;
    var adopting=!credentials&&options.restoreExisting===true&&own&&ownWiz(original,lamps);
    var preserving=adopting||!!(credentials&&credentials.adopted===true&&own&&ownWiz(original,lamps));
    if(!credentials&&original.device.type!=='file'&&!adopting)throw Error('SCREEN_EXISTING_CONFIGURATION');
    if(credentials&&original.device.type!=='file'&&(!own||!ownWiz(original,lamps)))throw Error('SCREEN_EXISTING_CONFIGURATION');
    if(own&&output(server))throw Error('SCREEN_OUTPUT_IN_USE');
    if(original.network.apiAuth!==true||typeof original.network.localAdminAuth!=='boolean'||original.network.localAdminAuth!==true&&!adopting&&!preserving)throw Error('SCREEN_AUTH_CONFIGURATION');
    var settings=await luna('luna://org.webosbrew.piccap.service/getSettings',{});
    var role=JSON.parse(read(ROLE,65536,false));if(!object(role)||role.appId!=='com.frxn.mipantalla.lights'||!Array.isArray(role.permissions))throw Error('SCREEN_ROLE_UNCONFIRMED');
    var permission=role.permissions.filter(function(p){return p.service==='com.frxn.mipantalla.lights';})[0];if(!permission||!Array.isArray(permission.outbound))throw Error('SCREEN_ROLE_UNCONFIRMED');
    if(!credentials){
      if(before===null){fresh(ROOT+'/before.json',{version:1,ids:ids,hyperhdr:original,database:exported,piccap:settings,role:role});before=JSON.parse(read(ROOT+'/before.json',262144,true));}
      if(!before||before.version!==1||JSON.stringify(before.ids)!==JSON.stringify(ids))throw Error('SCREEN_BACKUP_INVALID');
      credentials={phase:'prepared',password:crypto.randomBytes(24).toString('hex'),token:null,previousToken:screenBefore?screenBefore.token:null,ids:ids,adopted:adopting};fresh(credentialsFile,credentials);
    }else{credentials.previousToken=screenBefore?screenBefore.token:null;save(credentialsFile,credentials);}
    if(required.info.newPasswordRequired){await rpc({command:'authorize',subcommand:'newPassword',password:'hyperhdr',newPassword:credentials.password});login=await rpc({command:'authorize',subcommand:'login',password:credentials.password});}
    if(!login.info||typeof login.info.token!=='string'||login.info.token.length<=36)throw Error('SCREEN_ADMIN_UNCONFIRMED');
    credentials.token=login.info.token;save(credentialsFile,credentials);
    await rpc({command:'componentstate',componentstate:{component:'LEDDEVICE',state:false}});
    var config=JSON.parse(JSON.stringify(original));config.general.disableLedsStartup=true;
    if(!preserving){config.device={type:'wiz',colorOrder:'rgb',refreshTime:0,port:38899,dimming:100,lamps:lamps};
      config.leds=ids.map(function(id,i){return{hmin:i/6,hmax:(i+1)/6,vmin:0,vmax:1};});
      config.smoothing=Object.assign({},config.smoothing||{},{enable:true,time_ms:150,updateFrequency:25});}
    config.network.localAdminAuth=true;
    config.flatbufServer=Object.assign({},config.flatbufServer||{},{enable:true,port:19400});
    // The official import transaction writes settings without emitting a live
    // DEVICE update, which would otherwise auto-enable the new WiZ driver.
    var database=JSON.parse(JSON.stringify(exported));database.instances[0].friendly_name=PROFILE;
    ['general','device','leds','flatbufServer','smoothing','network'].forEach(function(type){
      var rows=database.settings.filter(function(row){return row&&row.type===type&&(row.hyperhdr_instance===undefined||row.hyperhdr_instance===0);});
      if(rows.length!==1||typeof rows[0].config!=='string')throw Error('SCREEN_DATABASE_UNCONFIRMED');rows[0].config=JSON.stringify(config[type]);
    });
    await rpc({command:'load-db',config:database},true);
    var stopped=false;for(var attempt=0;attempt<6;attempt++){var status=await luna('luna://org.webosbrew.hyperhdr.loader.service/status',{});if(status.running===false){stopped=true;break;}await new Promise(function(resolve){setTimeout(resolve,200);});}
    if(!stopped)throw Error('SCREEN_RESTART_UNCONFIRMED');
    await luna('luna://org.webosbrew.hyperhdr.loader.service/start',{});
    await new Promise(function(resolve){setTimeout(resolve,300);});await connect();
    var renewed=await rpc({command:'authorize',subcommand:'login',password:credentials.password});
    if(!renewed.info||typeof renewed.info.token!=='string'||renewed.info.token.length<=36||renewed.info.token.length>2048)throw Error('SCREEN_ADMIN_UNCONFIRMED');
    credentials.token=renewed.info.token;save(credentialsFile,credentials);
    var after=(await rpc({command:'config',subcommand:'getconfig'})).info,checked=await info();
    if(output(checked)||!after||!ownWiz(after,lamps)||after.device.lamps.some(function(lamp,i){var expected=config.device.lamps[i];return lamp.name!==expected.name||lamp.ipAddress!==expected.ipAddress||lamp.macAddress!==expected.macAddress;})||after.leds.some(function(led,i){return ['hmin','hmax','vmin','vmax'].some(function(key){return led[key]!==config.leds[i][key];});})||after.general.disableLedsStartup!==true||!after.network||after.network.apiAuth!==true||after.network.localAdminAuth!==true)throw Error('SCREEN_CONFIG_UNCONFIRMED');
    if(permission.outbound.indexOf('*')===-1&&permission.outbound.indexOf('org.webosbrew.piccap.service')===-1){permission.outbound.push('org.webosbrew.piccap.service');var temporary=ROLE+'.mi-pantalla-'+crypto.randomBytes(8).toString('hex');fresh(temporary,role);fs.chmodSync(temporary,420);fs.renameSync(temporary,ROLE);await exec('/usr/sbin/ls-control',['scan-services']);}
    var previous=read(SERVICE+'/screen-config.json',8192,true);if(previous!==screenText||previous!==null&&JSON.parse(previous).token!==credentials.previousToken)throw Error('SCREEN_EXISTING_CONFIGURATION');
    var piccap=Object.assign({},settings,{address:'127.0.0.1',port:19400,'unix-socket':false,priority:150,width:320,height:180,fps:30,autostart:false});delete piccap.returnValue;
    try{
      await luna('luna://org.webosbrew.piccap.service/setSettings',piccap);
    }finally{
      // The native setter restarts capture even with autostart:false. Cleanup this owned mutation,
      // including an uncertain setter response, and require actual OFF rather than only a stop ACK.
      var captureStop=JSON.parse(await new Promise(function(resolve,reject){
        cp.execFile('/usr/bin/luna-send',['-n','1','-f','luna://org.webosbrew.piccap.service/stop','{}'],
          {encoding:'utf8',timeout:12000,maxBuffer:2097152},function(error,out){
            if(error)reject(Error('SCREEN_PICCAP_STOP_UNCONFIRMED'));else resolve(String(out));
          });
      }));
      if(!object(captureStop)||typeof captureStop.returnValue!=='boolean')throw Error('SCREEN_PICCAP_STOP_UNCONFIRMED');
      var captureOff=await luna('luna://org.webosbrew.piccap.service/status',{});
      if(captureOff.isRunning!==false||captureOff.uiRunning!==false||captureOff.videoRunning!==false||captureOff.connected!==false)throw Error('SCREEN_PICCAP_STOP_UNCONFIRMED');
    }
    var selectedSettings=await luna('luna://org.webosbrew.piccap.service/getSettings',{});
    if(selectedSettings.address!=='127.0.0.1'||selectedSettings.port!==19400||selectedSettings.fps!==30)throw Error('SCREEN_PICCAP_UNCONFIRMED');
    if(read(SERVICE+'/screen-config.json',8192,true)!==previous)throw Error('SCREEN_EXISTING_CONFIGURATION');
    save(SERVICE+'/screen-config.json',{enabled:true,token:credentials.token,profile:PROFILE,hardwareVerified:options.hardwareConfirmed===true||previous!==null&&JSON.parse(previous).hardwareVerified===true});
    var stopped=deps.stopOwnService(fs,deps.kill,deps.pid);
    credentials.phase='configured';credentials.previousToken=null;save(credentialsFile,credentials);
    finish({ok:true,configured:true,hardwareVerified:options.hardwareConfirmed===true||previous!==null&&JSON.parse(previous).hardwareVerified===true,physicalProofPending:true,restartedService:stopped});
  }catch(error){finish({ok:false,code:/^SCREEN_[A-Z_]+$/.test(error.message)?error.message:'SCREEN_CONFIGURATION_UNCONFIRMED'});}
}
function configureScript(options={}){
  const wrap=require('./steps.cjs').wrapTvExecFile;
  return '/usr/bin/node -e "eval(require(\'fs\').readFileSync(3,\'utf8\'))" </dev/null 3<<\'MP_SCREEN_CONFIGURE\'\n'+
    'var cp=require("child_process"),child={execFile:('+wrap.toString()+')(cp,process.env,true)};\n'+
    '('+configureOnTV.toString()+')('+JSON.stringify({freshHyperhdr:options.freshHyperhdr===true,hardwareConfirmed:options.hardwareConfirmed===true,restoreExisting:options.restoreExisting===true})+',{fs:require("fs"),crypto:require("crypto"),net:require("net"),cp:child,getuid:process.getuid.bind(process),pid:process.pid,kill:process.kill.bind(process),stopOwnService:'+require('./screen-elevate.cjs').stopOwnService.toString()+',output:function(v){process.stdout.write(JSON.stringify(v)+"\\n");}});\nMP_SCREEN_CONFIGURE\n';
}
async function configurePipeline(transport,options){
  const response=await transport.runRemote(configureScript(options),{timeoutMs:20000});
  let value;try{value=JSON.parse(response.stdout);}catch{throw Error('SCREEN_CONFIGURATION_UNCONFIRMED');}
  if(!value||value.ok!==true)throw Error(value&&/^SCREEN_[A-Z_]+$/.test(value.code)?value.code:'SCREEN_CONFIGURATION_UNCONFIRMED');return value;
}
module.exports={configureOnTV,configureScript,configurePipeline};
