'use strict';
const {STOCK_SHA256}=require('./root-inspect.cjs');
const profile=require('./model-profile.json');

// Serialized for Node 8. The token is inspected, never read or replaced.
async function repairSignedScript(deps,request,expected,stockHash) {
  var fs=deps.fs,cp=deps.cp,crypto=deps.crypto;
  var directory='/media/cryptofs/apps/usr/palm/services/com.palmdts.devmode.service';
  var original=directory+'/start-devmode.sh',candidate=directory+'/start-devmode.sh.backup';
  var root='/var/lib/mipantalla-maintenance/root-recovery/'+request.backupId;
  function hash(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
  function read(name) {
    var before=fs.lstatSync(name);if(!before.isFile()||before.isSymbolicLink()||before.uid!==0||before.nlink!==1||before.size>65536)throw Error('RECOVERY_SOURCE_UNSAFE');
    var fd=fs.openSync(name,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
    try{var after=fs.fstatSync(fd);if(after.ino!==before.ino||after.dev!==before.dev)throw Error('RECOVERY_SOURCE_CHANGED');return {bytes:fs.readFileSync(fd),stat:after};}finally{fs.closeSync(fd);}
  }
  function command(binary,args) {
    return new Promise(function(resolve,reject){var env={};Object.keys(process.env).forEach(function(k){env[k]=process.env[k];});env.LD_PRELOAD='';
      cp.execFile(binary,args,{env:env,encoding:'utf8',timeout:3500,maxBuffer:65536,killSignal:'SIGKILL'},function(error,out){if(error)reject(Error('RECOVERY_CHECK_FAILED'));else resolve(String(out));});});
  }
  function trustedDirectory(name,create) {
    var current='';name.split('/').filter(Boolean).forEach(function(part){current+='/'+part;
      if(create)try{fs.mkdirSync(current,448);}catch(error){if(error.code!=='EEXIST')throw error;}
      var s=fs.lstatSync(current);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&18)!==0)throw Error('RECOVERY_DIRECTORY_UNSAFE');});
  }
  function write(name,bytes,mode) {
    var fd=fs.openSync(name,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,mode);
    try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  }
  async function verified(name){return (await command('/usr/bin/openssl',['dgst','-sha512','-verify','/usr/palm/services/com.palm.service.devmode/pub.pem','-signature',directory+'/start-devmode.sig',name])).trim()==='Verified OK';}
  try {
    if(deps.getuid()!==0)throw Error('ROOT_REQUIRED');
    var sys=JSON.parse(await command('/usr/bin/luna-send',['-n','1','-f','luna://com.webos.service.tv.systemproperty/getSystemInfo','{"keys":["modelName","firmwareVersion","sdkVersion","boardType"]}']));
    if(sys.returnValue!==true||sys.modelName!==expected.model||sys.firmwareVersion!==expected.firmware||sys.sdkVersion!==expected.sdk||sys.boardType!==expected.board||
      fs.readFileSync('/etc/starfish-release','utf8').trim()!=='Rockhopper release '+expected.release+' ('+expected.releaseBuild+')')throw Error('PROFILE_UNSUPPORTED');
    var token=fs.lstatSync('/var/luna/preferences/devmode_enabled');
    if(!token.isFile()||token.isSymbolicLink()||token.nlink!==1||token.size<1||token.size>32768)throw Error('DEVMODE_TOKEN_INVALID');
    var previous=null;try{previous=read(original);}catch(error){if(error.code!=='ENOENT')throw error;}
    if(previous&&hash(previous.bytes)===stockHash&&await verified(original)){deps.output({ok:true,status:'skipped',scriptRepaired:false,tokenPreserved:true});return;}
    var replacement=read(candidate);if(hash(replacement.bytes)!==stockHash||!await verified(candidate))throw Error('SIGNED_BACKUP_REQUIRED');
    trustedDirectory(directory,false);trustedDirectory('/var/lib/mipantalla-maintenance/root-recovery',true);
    fs.mkdirSync(root,448);if(previous)write(root+'/start-devmode.before',previous.bytes,384);
    write(root+'/receipt.json',JSON.stringify({version:1,backupId:request.backupId,previousExisted:!!previous,previousHash:previous?hash(previous.bytes):null,replacementHash:stockHash,tokenPreserved:true}),384);
    var temporary=directory+'/.mi-pantalla-repair-'+request.backupId;
    write(temporary,replacement.bytes,493);
    if(previous){var current=fs.lstatSync(original);if(current.ino!==previous.stat.ino||current.dev!==previous.stat.dev||hash(read(original).bytes)!==hash(previous.bytes))throw Error('RECOVERY_SOURCE_CHANGED');}
    else try{fs.lstatSync(original);throw Error('RECOVERY_SOURCE_CHANGED');}catch(error){if(error.code!=='ENOENT')throw error;}
    fs.renameSync(temporary,original);
    if(hash(read(original).bytes)!==stockHash||!await verified(original))throw Error('RECOVERY_POSTCHECK_FAILED');
    var after=fs.lstatSync('/var/luna/preferences/devmode_enabled');
    if(after.ino!==token.ino||after.dev!==token.dev||after.size!==token.size||after.mtimeMs!==token.mtimeMs)throw Error('DEVMODE_TOKEN_CHANGED');
    deps.output({ok:true,status:'complete',scriptRepaired:true,tokenPreserved:true});
  } catch(error){deps.output({ok:false,code:/^[A-Z_]+$/.test(error.message)?error.message:'RECOVERY_UNCONFIRMED'});}
}
function repairScript(backupId) {
  return '/usr/bin/node -e "eval(require(\'fs\').readFileSync(3,\'utf8\'))" </dev/null 3<<\'MP_ROOT_REPAIR\'\n'+
    '('+repairSignedScript.toString()+')({fs:require("fs"),cp:require("child_process"),crypto:require("crypto"),getuid:process.getuid.bind(process),output:function(v){process.stdout.write(JSON.stringify(v)+"\\n");}},'+JSON.stringify({backupId})+','+JSON.stringify(profile)+','+JSON.stringify(STOCK_SHA256)+');\nMP_ROOT_REPAIR\n';
}
async function repairDeveloperMode(transport,options) {
  if(!options||!/^[a-f0-9]{32}$/.test(options.backupId||''))throw Error('BACKUP_ID_INVALID');
  const reply=await transport.runRemote(repairScript(options.backupId),{timeoutMs:20000});
  let result;try{result=JSON.parse(reply.stdout);}catch{throw Error('RECOVERY_UNCONFIRMED');}
  if(!result||result.ok!==true||!['complete','skipped'].includes(result.status)||typeof result.scriptRepaired!=='boolean'||result.tokenPreserved!==true)throw Error(result&&/^[A-Z_]+$/.test(result.code)?result.code:'RECOVERY_UNCONFIRMED');
  return {status:result.status,scriptRepaired:result.scriptRepaired,tokenPreserved:true};
}
module.exports={repairDeveloperMode,repairScript,repairSignedScript};
