'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const profile=require('./model-profile.json');
function canonical(value) {
  if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if (value && typeof value==='object') return '{'+Object.keys(value).sort().map(function(key){return JSON.stringify(key)+':'+canonical(value[key]);}).join(',')+'}';
  return JSON.stringify(value);
}
function fingerprint(value){return crypto.createHash('sha256').update(canonical(value)).digest('hex');}
function supported(snapshot) {
  const s=snapshot&&snapshot.system,r=snapshot&&snapshot.release;
  return !!(s&&s.modelName===profile.model&&s.firmwareVersion===profile.firmware&&s.sdkVersion===profile.sdk&&s.boardType===profile.board&&
    r&&r.version===profile.release&&r.build===profile.releaseBuild);
}
function device(snapshot){
  const s=snapshot&&snapshot.system;
  const out={verified:!!s,supported:supported(snapshot),privilege:!snapshot?'unknown':snapshot.uid===0?'root':typeof snapshot.uid==='number'?'non-root':'unknown'};
  if(s)for(const [key,source] of [['model','modelName'],['firmware','firmwareVersion'],['sdk','sdkVersion'],['board','boardType']]){
    if(typeof s[source]==='string'&&/^[A-Za-z0-9._-]{1,64}$/.test(s[source]))out[key]=s[source];
  }
  return out;
}
function parse(stdout) {
  if(typeof stdout!=='string'||Buffer.byteLength(stdout)>2*1024*1024)throw Error('REMOTE_INVALID');
  const value=JSON.parse(stdout);
  if(!value||typeof value.ok!=='boolean')throw Error('REMOTE_INVALID');
  return value;
}
function wrapTvExecFile(cp, environment, viaShell) {
  return function(command, args, options, callback) {
    var settings={},env={},source=options&&options.env||environment||{};
    Object.keys(options||{}).forEach(function(key){settings[key]=options[key];});
    Object.keys(source).forEach(function(key){env[key]=source[key];});
    env.LD_PRELOAD='';settings.env=env;
    // The full capture preflight on this TV's Node 8 aborts a direct LS2 child.
    // A fixed exec shim preserves argv and works in that same measured context.
    // Keep the already verified installer path direct unless explicitly enabled.
    if(viaShell===true)return cp.execFile('/bin/sh',['-c','exec "$@"','mp-capture',command].concat(args),settings,callback);
    return cp.execFile(command,args,settings,callback);
  };
}
function script(request) {
  const encoded=Buffer.from(JSON.stringify(request)).toString('base64');
  const privacy=fs.readFileSync(path.join(__dirname,'../scripts/tv/privacy-log-settings.js'),'utf8');
  return '# MP_REQUEST:'+encoded+'\n/usr/bin/node -e "eval(require(\'fs\').readFileSync(3,\'utf8\'))" </dev/null 3<<\'MP_SETUP_NODE\'\n'+
    "'use strict';\nvar fs=require('fs'),cp=require('child_process');\n"+
    'var child={execFile:('+wrapTvExecFile.toString()+')(cp,process.env)};\n'+
    'var canonical='+canonical.toString()+';\n'+
    'var fingerprint=function(v){return require("crypto").createHash("sha256").update(canonical(v)).digest("hex");};\n'+
    'var privacy=(function(){var module={exports:{}};\n'+privacy+'\nreturn module.exports;}());\n'+
    'var request=JSON.parse(Buffer.from("'+encoded+'","base64").toString("utf8"));\n'+
    'var files=('+require('./steps-files.cjs').makeFiles.toString()+')(fs,request.backupId||"status");\n'+
    '('+require('./steps-remote.cjs').remoteMain.toString()+')(request,{fs:fs,cp:child,files:files,privacy:privacy,'+
    'fingerprint:fingerprint,getuid:process.getuid.bind(process),output:function(value){process.stdout.write(JSON.stringify(value)+"\\n");}},'+JSON.stringify(profile)+');\nMP_SETUP_NODE\n';
}
module.exports={canonical,fingerprint,supported,device,parse,script,profile,wrapTvExecFile};
