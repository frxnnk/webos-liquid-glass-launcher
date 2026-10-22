'use strict';
const STOCK_SHA256='18b6b7cce77d640fef78d9d247d6fc672b0850bd728dd2a3c44105a485abc846';

// Serialized for the TV's Node 8. Reads metadata and verifies the LG signature;
// it never reads the session token or starts a root payload.
async function inspectRoot(deps, stockHash) {
  var fs=deps.fs,cp=deps.cp,uid=deps.getuid();
  var service='/media/cryptofs/apps/usr/palm/services/com.palmdts.devmode.service/';
  var executable=uid===0?'/usr/bin/luna-send':'/usr/bin/luna-send-pub';
  function command(binary,args) {
    return new Promise(function(resolve,reject) {
      var env={};Object.keys(deps.env||{}).forEach(function(k){env[k]=deps.env[k];});env.LD_PRELOAD='';
      cp.execFile(binary,args,{env:env,encoding:'utf8',timeout:3000,maxBuffer:65536,killSignal:'SIGKILL'},function(error,stdout){if(error)reject(Error('probe'));else resolve(String(stdout));});
    });
  }
  function metadata(name) {
    try {var s=fs.lstatSync(name);return s.isSymbolicLink()?'unsafe':s.isFile()&&s.nlink===1&&s.size>0&&s.size<=32768?'regular':s.isDirectory()?'directory':'unsafe';}
    catch(error){return error.code==='ENOENT'?'absent':'unreadable';}
  }
  try {
    var info=JSON.parse(await command(executable,['-n','1','-f','luna://com.webos.service.tv.systemproperty/getSystemInfo','{"keys":["modelName","firmwareVersion","sdkVersion","boardType"]}']));
    if(info.returnValue!==true)throw Error('identity');
    var match=/^Rockhopper release (\d+\.\d+\.\d+-\d+) \(([a-z0-9-]+)\)\r?\n?$/.exec(fs.readFileSync('/etc/starfish-release','utf8'));
    if(!match)throw Error('release');
    var signature=null,stock=null;
    if(metadata(service+'start-devmode.sh')==='regular') {
      stock=deps.hash(fs.readFileSync(service+'start-devmode.sh'))===stockHash;
      try {signature=(await command('/usr/bin/openssl',['dgst','-sha512','-verify','/usr/palm/services/com.palm.service.devmode/pub.pem','-signature',service+'start-devmode.sig',service+'start-devmode.sh'])).trim()==='Verified OK';}
      catch(ignored){signature=false;}
    }
    var system={};['modelName','firmwareVersion','sdkVersion','boardType'].forEach(function(key){if(typeof info[key]!=='string'||info[key].length>128)throw Error('identity');system[key]=info[key];});
    deps.output({ok:true,uid:uid,system:system,release:{version:match[1],build:match[2]},devmode:{signature:signature,stockHash:stock,token:metadata('/var/luna/preferences/devmode_enabled')},rootArtifacts:{
      hbcApp:metadata('/media/developer/apps/usr/palm/applications/org.webosbrew.hbchannel/appinfo.json'),
      hbcService:metadata('/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service'),startup:metadata('/var/lib/webosbrew/startup.sh')}});
  } catch(ignored){deps.output({ok:false,code:'ROOT_PROBE_UNCONFIRMED'});}
}
function script() {
  return '/usr/bin/node -e "eval(require(\'fs\').readFileSync(3,\'utf8\'))" </dev/null 3<<\'MP_ROOT_INSPECT\'\n'+
    '('+inspectRoot.toString()+')({fs:require("fs"),cp:require("child_process"),env:process.env,getuid:process.getuid.bind(process),hash:function(bytes){return require("crypto").createHash("sha256").update(bytes).digest("hex");},output:function(value){process.stdout.write(JSON.stringify(value)+"\\n");}},'+JSON.stringify(STOCK_SHA256)+');\nMP_ROOT_INSPECT\n';
}
module.exports={STOCK_SHA256,inspectRoot,script};
