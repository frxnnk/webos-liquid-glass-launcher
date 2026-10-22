'use strict';
// Runtime SlopBro derivatives retain its complete AGPL source and COPYING in
// their private bundle. No upstream autoroot.sh is delivered or executed.
const crypto=require('node:crypto');
const {verifySource,SOURCES,PINS}=require('./root-sources.cjs');
const profile=require('./model-profile.json');
const {STOCK_SHA256}=require('./root-inspect.cjs');
function replaceOnce(text,old,value) {
  if(text.split(old).length!==2)throw Error('SOURCE_TRANSFORM_MISMATCH');return text.replace(old,value);
}
function canonicalPublicKey(value) {
  if(typeof value!=='string'||value.length>32768)throw Error('PUBLIC_KEY_INVALID');
  const match=/^(ssh-ed25519|ssh-rsa) ([A-Za-z0-9+/]+={0,2})(?: [^\r\n]*)?\r?\n?$/.exec(value);
  if(!match)throw Error('PUBLIC_KEY_INVALID');const bytes=Buffer.from(match[2],'base64');
  if(bytes.length<16||bytes.toString('base64')!==match[2])throw Error('PUBLIC_KEY_INVALID');
  const length=bytes.readUInt32BE(0);if(length>64||bytes.subarray(4,4+length).toString()!==match[1])throw Error('PUBLIC_KEY_INVALID');
  return match[1]+' '+match[2]+'\n';
}
async function bootstrapMain(deps,request) {
  var fs=deps.fs,cp=deps.cp,crypto=deps.crypto;
  function fail(code){deps.output({ok:false,code:code});}
  function hash(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
  function directory(name,create) {
    var current='';name.split('/').filter(Boolean).forEach(function(part){current+='/'+part;
      if(create)try{fs.mkdirSync(current,448);}catch(error){if(error.code!=='EEXIST')throw error;}
      var s=fs.lstatSync(current);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&18)!==0)throw Error('ROOT_DIRECTORY_UNSAFE');});
  }
  function read(name,limit) {
    var s=fs.lstatSync(name);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>limit)throw Error('ROOT_SOURCE_UNSAFE');
    var fd=fs.openSync(name,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{var actual=fs.fstatSync(fd);if(actual.ino!==s.ino||actual.dev!==s.dev)throw Error('ROOT_SOURCE_CHANGED');return {bytes:fs.readFileSync(fd),stat:actual};}finally{fs.closeSync(fd);}
  }
  function write(name,bytes,mode){var fd=fs.openSync(name,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,mode);
    try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
  function command(binary,args){return new Promise(function(resolve,reject){var env={};Object.keys(deps.env).forEach(function(key){env[key]=deps.env[key];});env.LD_PRELOAD='';
    cp.execFile(binary,args,{env:env,encoding:'utf8',timeout:3500,maxBuffer:65536,killSignal:'SIGKILL'},function(error,out){if(error)reject(Error('ROOT_COMMAND_FAILED'));else resolve(String(out));});});}
  try {
    if(deps.getuid()!==0){fail('ROOT_REQUIRED');return;}
    var info=JSON.parse(await command('/usr/bin/luna-send',['-n','1','-f','luna://com.webos.service.tv.systemproperty/getSystemInfo','{"keys":["modelName","firmwareVersion","sdkVersion","boardType"]}']));
    var p=request.profile;
    if(info.returnValue!==true||info.modelName!==p.model||info.firmwareVersion!==p.firmware||info.sdkVersion!==p.sdk||info.boardType!==p.board||fs.readFileSync('/etc/starfish-release','utf8').trim()!=='Rockhopper release '+p.release+' ('+p.releaseBuild+')')throw Error('PROFILE_UNSUPPORTED');
    ['/media/developer/apps/usr/palm/applications/org.webosbrew.hbchannel/appinfo.json','/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service','/var/lib/webosbrew/startup.sh'].forEach(function(name){
      try{fs.lstatSync(name);throw Error('EXISTING_ROOT_RECOVERY_REQUIRED');}catch(error){if(error.code!=='ENOENT')throw error;}
    });
    var token=fs.lstatSync('/var/luna/preferences/devmode_enabled');if(!token.isFile()||token.isSymbolicLink()||token.nlink!==1||token.size<1||token.size>32768)throw Error('DEVMODE_TOKEN_INVALID');
    var dev='/media/cryptofs/apps/usr/palm/services/com.palmdts.devmode.service/';
    var stock=read(dev+'start-devmode.sh',65536);if(hash(stock.bytes)!==request.stockHash)throw Error('DEVMODE_SIGNATURE_INVALID');
    if((await command('/usr/bin/openssl',['dgst','-sha512','-verify','/usr/palm/services/com.palm.service.devmode/pub.pem','-signature',dev+'start-devmode.sig',dev+'start-devmode.sh'])).trim()!=='Verified OK')throw Error('DEVMODE_SIGNATURE_INVALID');
    var assets={};Object.keys(request.assets).forEach(function(name){var item=read(request.source+'/'+name,1048576);if(hash(item.bytes)!==request.assets[name])throw Error('SOURCE_HASH_MISMATCH');assets[name]=item.bytes;});
    var base='/var/lib/mipantalla-maintenance/root-bootstrap';directory(base,true);
    var work=base+'/'+request.id;fs.mkdirSync(work,448);
    directory('/home/root',false);directory('/home/root/.ssh',true);
    var authorized='/home/root/.ssh/authorized_keys',before=null;
    try{before=read(authorized,1048576);if(before.stat.uid!==0||(before.stat.mode&18)!==0)throw Error('ROOT_AUTHORIZED_KEYS_UNSAFE');}catch(error){if(error.code!=='ENOENT')throw error;}
    write(work+'/receipt.json',JSON.stringify({version:1,id:request.id,tokenPreserved:true,authorizedKeysExisted:!!before,authorizedKeysHash:before?hash(before.bytes):null,stockHash:request.stockHash}),384);
    if(before)write(work+'/authorized_keys.before',before.bytes,384);
    write(work+'/start-devmode.before',stock.bytes,384);
    var key=assets['root-authorized-key.pub'].toString('utf8').trim(),old=before?before.bytes.toString('utf8'):'';
    if(old.split(/\r?\n/).indexOf(key)===-1){
      var temporary='/home/root/.ssh/.mi-pantalla-key-'+request.id;write(temporary,(old&&old[old.length-1]!=='\n'?old+'\n':old)+key+'\n',384);
      if(before){var current=read(authorized,1048576);if(current.stat.ino!==before.stat.ino||hash(current.bytes)!==hash(before.bytes))throw Error('ROOT_SOURCE_CHANGED');}
      else if(fs.existsSync(authorized))throw Error('ROOT_SOURCE_CHANGED');
      fs.renameSync(temporary,authorized);
    }
    write(work+'/dropbear',assets.dropbear,448);
    await command(work+'/dropbear',['-R','-s','-p','2222','-P',work+'/dropbear.pid']);
    deps.output({ok:true,status:'temporary-root-started',port:2222,tokenPreserved:true,id:request.id});
  } catch(error){fail(/^[A-Z_]+$/.test(error.message)?error.message:'ROOT_BOOTSTRAP_UNCONFIRMED');}
}
function transformClient(text,host,localIp) {
  text=replaceOnce(text,'SHELL_SCRIPT = "autoroot.sh"','SHELL_SCRIPT = "root-stage1.sh"');
  text=replaceOnce(text,'SERVICE_FILES = [\n    "package.json",\n    "main.js",\n]','SERVICE_FILES = ["package.json", "main.js", "dropbear", "root-authorized-key.pub"]');
  text=replaceOnce(text,'    bind_host="0.0.0.0",','    bind_host='+JSON.stringify(localIp)+',');
  text=replaceOnce(text,'        def send_head(self):\n','        def send_head(self):\n            if self.client_address[0] != '+JSON.stringify(host)+':\n                self.send_error(403)\n                return None\n');
  const start=text.indexOf('TARGET_APPS = [\n'),end=text.indexOf('\n\nENTRY_PAGE =',start);if(start<0||end<0)throw Error('SOURCE_TRANSFORM_MISMATCH');
  text=text.slice(0,start)+'TARGET_APPS = [("com.webos.app.voiceweb", "URL", [5])]'+text.slice(end);
  const check=text.indexOf('def verify_app_present(client, candidates):\n'),launch=text.indexOf('\ndef launch_app(',check);if(check<0||launch<0)throw Error('SOURCE_TRANSFORM_MISMATCH');
  text=text.slice(0,check)+'def verify_app_present(client, candidates):\n    resp = client.request("ssap://com.webos.applicationManager/listApps", {}, timeout=8.0)\n    apps = (resp.get("payload") or {}).get("apps")\n    if resp.get("type") == "error" or not isinstance(apps, list):\n        raise SSAPError("application inventory unavailable")\n    if not any(isinstance(a, dict) and a.get("id") == "com.webos.app.voiceweb" for a in apps):\n        raise SSAPError("required model-specific overlay is absent")\n    return ("com.webos.app.voiceweb", "URL")\n\n'+text.slice(launch);
  text=replaceOnce(text,'        tracker.wait_for_all(None)','        if not tracker.wait_for_all(45):\n            raise RuntimeError("payload download timed out")\n        time.sleep(5)');
  return text;
}
function transformPage(text,destination) {
  text=replaceOnce(text,"            var downloadDir = '/media/internal/downloads';","            var downloadDir = '"+destination+"';");
  text=replaceOnce(text,"var args = ['--', '/tmp/run-js-service-no-cgroup', '^_~', downloadDir, shellScriptPath];","var args = ['--', downloadDir + '/runner.pid', '^_~', downloadDir, shellScriptPath];");
  text=replaceOnce(text,'            function requestDownload(file, onComplete) {\n','            function requestDownload(file, onComplete) {\n                var expectedTarget = downloadDir + "/" + file;\n');
  text=replaceOnce(text,'                    if (!subscribed) {\n                        // Initial response to download request\n','                    if ((!subscribed || response.hasOwnProperty("completed")) && response.target !== expectedTarget) {\n                        downloadFailed(file, "unexpected target"); bridge.cancel(); complete = true; return;\n                    }\n                    if (!subscribed) {\n                        // Initial response to download request\n');
  return text;
}
function buildBundle(options,sources) {
  for(const name of Object.keys(SOURCES))verifySource(name,sources[name]);
  if(!options||!/^[a-f0-9]{32}$/.test(options.id||'')||![options.host,options.localIp].every(ip=>typeof ip==='string'&&/^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)\d/.test(ip)&&ip.split('.').length===4&&ip.split('.').every(p=>/^(0|[1-9]\d{0,2})$/.test(p)&&+p<256)))throw Error('ROOT_BUNDLE_INPUT_INVALID');
  const key=Buffer.from(canonicalPublicKey(options.publicKey));
  const destination='/media/internal/mi-pantalla-root-'+options.id;
  const assets={dropbear:SOURCES.dropbear.sha256,'root-authorized-key.pub':crypto.createHash('sha256').update(key).digest('hex')};
  const request={id:options.id,source:destination,profile,stockHash:STOCK_SHA256,assets};
  const main='/* Model-specific Mi pantalla bootstrap. No upstream autoroot. */\nmodule.exports.run=function(){('+bootstrapMain.toString()+')({fs:require("fs"),cp:require("child_process"),crypto:require("crypto"),env:process.env,getuid:process.getuid.bind(process),output:function(v){console.log(JSON.stringify(v));}},'+JSON.stringify(request)+');};\n';
  return {destination,files:{'slopbro.py':Buffer.from(transformClient(sources.client.toString('utf8'),options.host,options.localIp)),COPYING:sources.license,'slopbro.original.py':sources.client,
    'index.original.html':sources.page,'wwwroot/index.html':Buffer.from(transformPage(sources.page.toString('utf8'),destination)),'wwwroot/package.json':sources.package,
    'wwwroot/main.js':Buffer.from(main),'wwwroot/root-stage1.sh':Buffer.from('#!/bin/sh\n# Bootstrap is implemented in main.js; this marker is never executed.\n'),
    'wwwroot/dropbear':sources.dropbear,'wwwroot/root-authorized-key.pub':key,'source-manifest.json':Buffer.from(JSON.stringify({version:1,slopbro:PINS.slopbro,hbc:PINS.hbc,sourceFiles:SOURCES,stockValidated:false}))}};
}
module.exports={buildBundle,canonicalPublicKey,bootstrapMain,replaceOnce,transformClient,transformPage};
