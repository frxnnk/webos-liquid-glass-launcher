'use strict';
function patchDefinition(text){
  var service='/media/developer/apps/usr/palm/services/com.frxn.mipantalla.lights';
  var prefix='[D-BUS Service]\nName=com.frxn.mipantalla.lights\nExec=';
  var stock=prefix+'/usr/bin/run-js-service -n '+service+'\nType=dynamic\n';
  var legacy=prefix+'/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/run-js-service -n '+service+'\nType=dynamic\n';
  var elevated=prefix+'/var/lib/mipantalla-maintenance/screen/root-run-js-service -n '+service+'\nType=dynamic\n';
  var normalized=typeof text==='string'?text.replace(/\n+$/,'')+'\n':'';
  if(normalized!==stock&&normalized!==legacy&&normalized!==elevated)throw Error('SCREEN_SERVICE_DEFINITION_UNEXPECTED');
  return elevated;
}
function stopOwnService(fs,kill,ownPid){
  var name='com.frxn.mipantalla.lights',service='/media/developer/apps/usr/palm/services/'+name,jail='/var/palm/jail/'+name;
  function observe(pid){
    try{
      var root='/proc/'+pid,uid=fs.statSync(root).uid,args=fs.readFileSync(root+'/cmdline','utf8').split('\0').filter(Boolean);
      if(args.length!==1||args[0]!==name)return null;
      var cwd=fs.readlinkSync(root+'/cwd'),exe=fs.readlinkSync(root+'/exe');
      if(!(uid===0&&cwd===service&&exe==='/usr/bin/node')&&!(uid>=5000&&uid<=65535&&cwd===jail+service&&exe===jail+'/usr/bin/node'))return null;
      var text=fs.readFileSync(root+'/stat','utf8'),match=/^\d+\s+\([\s\S]*\)\s+(.+)$/.exec(text),start=match&&match[1].trim().split(/\s+/)[19];
      if(!start||!/^\d+$/.test(start))return null;
      return{pid:Number(pid),uid:uid,cwd:cwd,exe:exe,start:start};
    }catch(ignored){return null;}
  }
  var candidates=fs.readdirSync('/proc').filter(function(pid){return /^[0-9]+$/.test(pid)&&Number(pid)!==ownPid;}).map(observe).filter(Boolean);
  if(candidates.length>1)throw Error('SCREEN_SERVICE_AMBIGUOUS');
  if(!candidates.length)return false;
  var before=candidates[0],after=observe(String(before.pid));
  if(!after||JSON.stringify(after)!==JSON.stringify(before))throw Error('SCREEN_SERVICE_CHANGED');
  kill(before.pid,'SIGTERM');return true;
}
async function elevateOnTV(deps){
  var fs=deps.fs,crypto=deps.crypto,DEF='/var/luna-service2-dev/services.d/com.frxn.mipantalla.lights.service';
  var WRAPPER='/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/run-js-service';
  var ROOT='/var/lib/mipantalla-maintenance/screen';
  function hash(text){return crypto.createHash('sha256').update(text).digest('hex');}
  function read(file,limit,privateFile,sourceOnly){
    try{var s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>limit||!sourceOnly&&(s.uid!==0||(s.mode&18)!==0)||privateFile&&(s.mode&511)!==384)throw Error('SCREEN_SERVICE_FILE_UNSAFE');
      var fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{var a=fs.fstatSync(fd);if(a.ino!==s.ino||a.dev!==s.dev)throw Error('SCREEN_SERVICE_FILE_CHANGED');var bytes=fs.readFileSync(fd,'utf8'),after=fs.fstatSync(fd);if(after.ino!==s.ino||after.dev!==s.dev||after.size!==s.size)throw Error('SCREEN_SERVICE_FILE_CHANGED');return bytes;}finally{fs.closeSync(fd);}
    }catch(error){if(error.code==='ENOENT')return null;throw error;}
  }
  function fresh(file,text,mode){var fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,mode);try{fs.writeFileSync(fd,text);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
  function directory(file){try{fs.mkdirSync(file,448);}catch(error){if(error.code!=='EEXIST')throw error;}var s=fs.lstatSync(file);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&511)!==448)throw Error('SCREEN_SERVICE_DIRECTORY_UNSAFE');}
  function exec(command,args){return new Promise(function(resolve,reject){deps.cp.execFile(command,args,{timeout:4000,maxBuffer:1048576,encoding:'utf8'},function(error,out){if(error)reject(Error('SCREEN_SERVICE_COMMAND_UNCONFIRMED'));else resolve(String(out));});});}
  try{
    if(deps.getuid()!==0)throw Error('SCREEN_ROOT_REQUIRED');
    var system=JSON.parse(await exec('/usr/bin/luna-send',['-n','1','-f','luna://com.webos.service.tv.systemproperty/getSystemInfo','{"keys":["modelName","firmwareVersion","sdkVersion","boardType"]}']));
    if(system.returnValue!==true||system.modelName!=='49UN7310PSC'||system.firmwareVersion!=='04.64.00'||system.sdkVersion!=='5.6.2'||system.boardType!=='K6LP_ATSC_BR')throw Error('SCREEN_PROFILE_UNSUPPORTED');
    // Treat the vendor file as untrusted input; only pinned bytes are copied.
    // The service definition never executes that vendor-owned source path.
    var wrapper=read(WRAPPER,4096,false,true);if(wrapper===null||hash(wrapper)!=='8d65bd23269fe9aff78a5ea4e08d37686e01754f157fde25b11eb288b37d732c')throw Error('SCREEN_SERVICE_WRAPPER_CHANGED');
    var original=read(DEF,16384,false);if(original===null)throw Error('SCREEN_SERVICE_DEFINITION_UNEXPECTED');
    var updated=deps.patchDefinition(original),changed=updated!==original.replace(/\n+$/,'')+'\n';
    directory('/var/lib/mipantalla-maintenance');directory(ROOT);
    var privateFile=ROOT+'/root-run-js-service',copy=read(privateFile,4096,false);
    if(copy===null){fresh(privateFile,wrapper,320);copy=read(privateFile,4096,false);}
    var executable=fs.lstatSync(privateFile);if(executable.uid!==0||(executable.mode&511)!==320||hash(copy)!=='8d65bd23269fe9aff78a5ea4e08d37686e01754f157fde25b11eb288b37d732c')throw Error('SCREEN_SERVICE_WRAPPER_UNSAFE');
    var backupFile=ROOT+'/service-definition-before.json',existing=read(backupFile,32768,true);
    if(existing!==null){var backup=JSON.parse(existing);if(!backup||backup.version!==1||typeof backup.definition!=='string'||hash(backup.definition)!==backup.sha256||deps.patchDefinition(backup.definition)!==updated)throw Error('SCREEN_SERVICE_BACKUP_INVALID');}
    if(changed){
      if(existing===null)fresh(backupFile,JSON.stringify({version:1,definition:original,sha256:hash(original)}),384);
      var temporary=DEF+'.mi-pantalla-'+crypto.randomBytes(8).toString('hex');fresh(temporary,updated,420);
      try{if(read(DEF,16384,false)!==original)throw Error('SCREEN_SERVICE_DEFINITION_CHANGED');fs.renameSync(temporary,DEF);}catch(error){try{fs.unlinkSync(temporary);}catch(ignored){}throw error;}
      if(read(DEF,16384,false)!==updated)throw Error('SCREEN_SERVICE_DEFINITION_CHANGED');
    }
    await exec('/usr/sbin/ls-control',['scan-services']);
    var stopped=deps.stopOwnService(fs,deps.kill,deps.pid);
    deps.output({ok:true,elevated:true,changed:changed,restartedService:stopped,roleChanged:false});
  }catch(error){deps.output({ok:false,code:/^SCREEN_[A-Z_]+$/.test(error.message)?error.message:'SCREEN_SERVICE_ELEVATION_UNCONFIRMED'});}
}
function script(){
  var wrap=require('./steps.cjs').wrapTvExecFile;
  return '/usr/bin/node -e "eval(require(\'fs\').readFileSync(3,\'utf8\'))" </dev/null 3<<\'MP_SCREEN_ELEVATE\'\n'+
    'var cp=require("child_process"),child={execFile:('+wrap.toString()+')(cp,process.env,true)};\n'+
    '('+elevateOnTV.toString()+')({fs:require("fs"),crypto:require("crypto"),cp:child,getuid:process.getuid.bind(process),pid:process.pid,kill:process.kill.bind(process),patchDefinition:'+patchDefinition.toString()+',stopOwnService:'+stopOwnService.toString()+',output:function(v){process.stdout.write(JSON.stringify(v)+"\\n");}});\nMP_SCREEN_ELEVATE\n';
}
async function elevateLightsService(transport){var response=await transport.runRemote(script(),{timeoutMs:20000}),value;try{value=JSON.parse(response.stdout);}catch(error){throw Error('SCREEN_SERVICE_ELEVATION_UNCONFIRMED');}if(!value||value.ok!==true)throw Error(value&&/^SCREEN_[A-Z_]+$/.test(value.code)?value.code:'SCREEN_SERVICE_ELEVATION_UNCONFIRMED');return value;}
module.exports={patchDefinition,stopOwnService,elevateOnTV,script,elevateLightsService};
