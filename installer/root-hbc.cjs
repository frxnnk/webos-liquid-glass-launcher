'use strict';
const {verifySource,PINS,SOURCES}=require('./root-sources.cjs');
const {STOCK_SHA256}=require('./root-inspect.cjs');
const profile=require('./model-profile.json');
const ELEVATE_HASH='804cd88e6c6bf62b3ea29b4f696feba69a126455b2193ae42b063096cf5aa970';
function startupScript(id) {
  if(!/^[a-f0-9]{32}$/.test(id))throw Error('BACKUP_ID_INVALID');
  return `#!/bin/sh
# Mi pantalla: signed Developer Mode is preserved; SSH accepts keys only.
set -eu
umask 077
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
SERVICE=/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service
BASE=/var/lib/mipantalla-maintenance/root-provision/${id}
[ "$(id -u)" = 0 ] || exit 1
[ -d "$BASE" ] && [ ! -L "$BASE" ] || exit 1
[ "$(stat -c '%u:%a' "$BASE")" = '0:700' ] || exit 1
[ ! -e "$BASE/provisioning.hold" ] || exit 0
boot=$(cat /proc/sys/kernel/random/boot_id)
case "$boot" in *[!0-9a-f-]*|'') exit 1;; esac
work="$BASE/boot-$boot"
mkdir -m 700 "$work" || exit 0
[ "$(sha256sum "$SERVICE/bin/dropbear" | cut -d ' ' -f 1)" = '${SOURCES.dropbear.sha256}' ] || exit 1
[ "$(sha256sum "$SERVICE/elevate-service" | cut -d ' ' -f 1)" = '${ELEVATE_HASH}' ] || exit 1
"$SERVICE/bin/dropbear" -R -s -p 22 -P "$work/dropbear.pid"
if [ -z "\${SKIP_ELEVATION:-}" ]; then "$SERVICE/elevate-service"; fi
for counter in /var/luna/preferences/dc*; do
  if [ -f "$counter" ] && [ ! -L "$counter" ] && [ "$(stat -c '%u' "$counter")" = 0 ]; then rm -f -- "$counter"; fi
done
if [ -d /var/lib/webosbrew/init.d ] && [ ! -L /var/lib/webosbrew/init.d ]; then
  for hook in /var/lib/webosbrew/init.d/*; do
    if [ -e "$hook" ]; then [ "$(stat -Lc '%u' "$hook")" = 0 ] || exit 1; fi
  done
  run-parts /var/lib/webosbrew/init.d
fi
printf 'complete\\n' > "$work/startup-complete"
sync
`;
}
async function provisionMain(deps,request) {
  var fs=deps.fs,cp=deps.cp,crypto=deps.crypto;
  var service='/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service';
  var root='/var/lib/mipantalla-maintenance/root-provision/'+request.backupId;
  function hash(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
  function command(binary,args,limit){return new Promise(function(resolve,reject){var env={};Object.keys(deps.env).forEach(function(k){env[k]=deps.env[k];});env.LD_PRELOAD='';
    cp.execFile(binary,args,{env:env,encoding:'utf8',timeout:limit||2500,maxBuffer:2097152,killSignal:'SIGKILL'},function(error,out){if(error)reject(Error('HBC_COMMAND_UNCONFIRMED'));else resolve(String(out));});});}
  async function rpc(uri,payload){var body=JSON.parse(await command('/usr/bin/luna-send',['-n','1','-f',uri,JSON.stringify(payload)]));if(!body||body.returnValue!==true)throw Error('HBC_RPC_UNCONFIRMED');return body;}
  function directory(name,create) {var current='';name.split('/').filter(Boolean).forEach(function(part){current+='/'+part;
    if(create)try{fs.mkdirSync(current,448);}catch(error){if(error.code!=='EEXIST')throw error;}
    var s=fs.lstatSync(current);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&18)!==0)throw Error('HBC_DIRECTORY_UNSAFE');});}
  function read(name) {var s=fs.lstatSync(name);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.uid!==0||s.size>1048576)throw Error('HBC_FILE_UNSAFE');
    var fd=fs.openSync(name,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{var a=fs.fstatSync(fd);if(a.ino!==s.ino||a.dev!==s.dev)throw Error('HBC_FILE_CHANGED');return {bytes:fs.readFileSync(fd),stat:a};}finally{fs.closeSync(fd);}}
  function write(name,bytes,mode){var fd=fs.openSync(name,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,mode);
    try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
  function snapshot(name,index){try{var item=read(name);write(root+'/backup-'+index,item.bytes,384);return {path:name,existed:true,hash:hash(item.bytes),mode:item.stat.mode&511,backup:'backup-'+index};}
    catch(error){if(error.code!=='ENOENT')throw error;return {path:name,existed:false};}}
  function inventory(body){if(!body||!Array.isArray(body.apps)||body.apps.length>1000)throw Error('HBC_INVENTORY_INVALID');var seen={};body.apps.forEach(function(app){if(!app||typeof app.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(app.id)||seen[app.id])throw Error('HBC_INVENTORY_INVALID');seen[app.id]=true;});return body.apps;}
  function ls2Paths(){var result=[];['/var/luna-service2-dev','/var/luna-service2'].forEach(function(base){['services.d/org.webosbrew.hbchannel.service.service','client-permissions.d/org.webosbrew.hbchannel.service.root.json','api-permissions.d/org.webosbrew.hbchannel.service.api.public.json','manifests.d/org.webosbrew.hbchannel.json','roles.d/org.webosbrew.hbchannel.service.service.json'].forEach(function(file){result.push(base+'/'+file);});});return result;}
  try {
    if(deps.getuid()!==0)throw Error('ROOT_REQUIRED');
    var device=await rpc('luna://com.webos.service.tv.systemproperty/getSystemInfo',{keys:['modelName','firmwareVersion','sdkVersion','boardType']}),p=request.profile;
    if(device.modelName!==p.model||device.firmwareVersion!==p.firmware||device.sdkVersion!==p.sdk||device.boardType!==p.board||fs.readFileSync('/etc/starfish-release','utf8').trim()!=='Rockhopper release '+p.release+' ('+p.releaseBuild+')')throw Error('PROFILE_UNSUPPORTED');
    var token=fs.lstatSync('/var/luna/preferences/devmode_enabled');if(!token.isFile()||token.isSymbolicLink()||token.nlink!==1||token.size<1||token.size>32768)throw Error('DEVMODE_TOKEN_INVALID');
    var dev='/media/cryptofs/apps/usr/palm/services/com.palmdts.devmode.service/';
    if(hash(read(dev+'start-devmode.sh').bytes)!==request.stockHash||(await command('/usr/bin/openssl',['dgst','-sha512','-verify','/usr/palm/services/com.palm.service.devmode/pub.pem','-signature',dev+'start-devmode.sig',dev+'start-devmode.sh'])).trim()!=='Verified OK')throw Error('DEVMODE_SIGNATURE_INVALID');
    if(hash(Buffer.from(request.ipk,'base64'))!==request.ipkHash)throw Error('SOURCE_HASH_MISMATCH');
    if(inventory(await rpc('luna://com.webos.applicationManager/listApps',{})).some(function(app){return app.id==='org.webosbrew.hbchannel';}))throw Error('HBC_ALREADY_PRESENT_REVIEW');
    directory('/var/lib/mipantalla-maintenance/root-provision',true);fs.mkdirSync(root,448);
    var targets=['/var/lib/webosbrew/startup.sh','/var/luna/preferences/webosbrew_telnet_disabled','/var/luna/preferences/webosbrew_sshd_enabled',dev+'start-devmode.sh',dev+'start-devmode.sig'].concat(ls2Paths());
    var before=targets.map(snapshot);if(before[0].existed)throw Error('HBC_STARTUP_ALREADY_PRESENT');
    write(root+'/baseline.json',JSON.stringify({version:1,backupId:request.backupId,targets:before,tokenPreserved:true}),384);
    write(root+'/provisioning.hold',request.backupId+'\n',384);
    directory('/var/lib/webosbrew',true);write('/var/lib/webosbrew/startup.sh',request.startup,448);
    directory('/var/luna/preferences',false);
    if(!before[1].existed)write('/var/luna/preferences/webosbrew_telnet_disabled','1\n',384);
    if(!before[2].existed)write('/var/luna/preferences/webosbrew_sshd_enabled','1\n',384);
    write(root+'/hbc.ipk',Buffer.from(request.ipk,'base64'),384);
    await rpc('luna://com.webos.appInstallService/dev/install',{id:'com.ares.defaultName',ipkUrl:root+'/hbc.ipk',subscribe:true});
    var installed=false;for(var attempt=0;attempt<8;attempt++){
      var apps=inventory(await rpc('luna://com.webos.applicationManager/listApps',{}));if(apps.some(function(app){return app.id==='org.webosbrew.hbchannel'&&app.version==='0.7.3';})){installed=true;break;}
      await new Promise(function(resolve){setTimeout(resolve,400);});
    }
    if(!installed)throw Error('HBC_INSTALL_UNCONFIRMED');
    var afterInstall=ls2Paths().map(function(name,index){return snapshot(name,'pre-elevation-'+index);});
    write(root+'/before-elevation.json',JSON.stringify({targets:afterInstall}),384);
    if(hash(read(service+'/elevate-service').bytes)!==request.elevateHash||hash(read(service+'/bin/dropbear').bytes)!==request.dropbearHash)throw Error('HBC_INSTALLED_HASH_MISMATCH');
    await command(service+'/elevate-service',[],10000);
    await rpc('luna://org.webosbrew.hbchannel.service/registerActivity',{});
    var activity=await rpc('luna://com.webos.service.activitymanager/getDetails',{activityName:'org.webosbrew.hbchannel.service.autostart'});
    if(!activity.activity||activity.activity.name!=='org.webosbrew.hbchannel.service.autostart'||!activity.activity.type||activity.activity.type.persist!==true||!activity.activity.callback||activity.activity.callback.method!=='luna://org.webosbrew.hbchannel.service/autostart')throw Error('HBC_ACTIVITY_UNCONFIRMED');
    await command(service+'/bin/dropbear',['-R','-s','-p','22','-P',root+'/dropbear.pid']);
    var after=fs.lstatSync('/var/luna/preferences/devmode_enabled');
    if(after.ino!==token.ino||after.dev!==token.dev||after.size!==token.size||after.mtimeMs!==token.mtimeMs||hash(read(dev+'start-devmode.sh').bytes)!==request.stockHash)throw Error('DEVMODE_STATE_CHANGED');
    write(root+'/provisioned.json',JSON.stringify({version:1,backupId:request.backupId,installed:true,elevated:true,activityVerified:true,physicalBootPending:true}),384);
    deps.output({ok:true,status:'partial',installed:true,elevated:true,activityVerified:true,physicalBootPending:true});
  } catch(error){deps.output({ok:false,code:/^[A-Z_]+$/.test(error.message)?error.message:'HBC_PROVISION_UNCONFIRMED'});}
}
function provisionScript(options) {
  const request={backupId:options.backupId,profile,stockHash:STOCK_SHA256,ipkHash:PINS.ipk.sha256,ipk:options.bytes.toString('base64'),
    elevateHash:ELEVATE_HASH,dropbearHash:SOURCES.dropbear.sha256,startup:startupScript(options.backupId)};
  return '/usr/bin/node -e "eval(require(\'fs\').readFileSync(3,\'utf8\'))" </dev/null 3<<\'MP_ROOT_HBC\'\n'+
    '('+provisionMain.toString()+')({fs:require("fs"),cp:require("child_process"),crypto:require("crypto"),env:process.env,getuid:process.getuid.bind(process),output:function(v){process.stdout.write(JSON.stringify(v)+"\\n");}},'+JSON.stringify(request)+');\nMP_ROOT_HBC\n';
}
async function provisionHbc(transport,options) {
  if(!options||!/^[a-f0-9]{32}$/.test(options.backupId||''))throw Error('BACKUP_ID_INVALID');verifySource('ipk',options.bytes);
  const raw=await transport.runRemote(provisionScript(options),{timeoutMs:20000});let result;
  try{result=JSON.parse(raw.stdout);}catch{throw Error('HBC_PROVISION_UNCONFIRMED');}
  if(!result||result.ok!==true||result.status!=='partial'||result.installed!==true||result.elevated!==true||result.activityVerified!==true||result.physicalBootPending!==true)throw Error(result&&/^[A-Z_]+$/.test(result.code)?result.code:'HBC_PROVISION_UNCONFIRMED');
  return {status:'partial',installed:true,elevated:true,activityVerified:true,physicalBootPending:true};
}
async function releaseProvisioningHold(transport,options) {
  if(!options||!/^[a-f0-9]{32}$/.test(options.backupId||''))throw Error('BACKUP_ID_INVALID');
  const script='/usr/bin/node -e "eval(require(\'fs\').readFileSync(3,\'utf8\'))" </dev/null 3<<\'MP_ROOT_RELEASE\'\n'+
    'var fs=require("fs"),root="/var/lib/mipantalla-maintenance/root-provision/'+options.backupId+'",file=root+"/provisioning.hold";\n'+
    'if(process.getuid()!==0)throw Error("ROOT_REQUIRED");var directory=fs.lstatSync(root);if(!directory.isDirectory()||directory.isSymbolicLink()||directory.uid!==0||(directory.mode&511)!==448)throw Error("ROOT_HOLD_UNSAFE");\n'+
    'var fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{var before=fs.fstatSync(fd);if(!before.isFile()||before.uid!==0||before.nlink!==1||(before.mode&511)!==384||before.size!==33||fs.readFileSync(fd,"utf8")!=="'+options.backupId+'\\n")throw Error("ROOT_HOLD_UNSAFE");var current=fs.lstatSync(file);if(current.ino!==before.ino||current.dev!==before.dev||current.isSymbolicLink())throw Error("ROOT_HOLD_CHANGED");fs.unlinkSync(file);}finally{fs.closeSync(fd);}\n'+
    'process.stdout.write("{\\"ok\\":true,\\"released\\":true}\\n");\nMP_ROOT_RELEASE\n';
  let answer;try{answer=JSON.parse((await transport.runRemote(script,{timeoutMs:10000})).stdout);}catch{throw Error('ROOT_HOLD_RELEASE_UNCONFIRMED');}
  if(!answer||answer.ok!==true||answer.released!==true)throw Error('ROOT_HOLD_RELEASE_UNCONFIRMED');return {released:true};
}
module.exports={provisionHbc,provisionScript,provisionMain,startupScript,ELEVATE_HASH,releaseProvisioningHold};
