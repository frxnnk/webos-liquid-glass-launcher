'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const PIN=Object.freeze({id:'com.frxn.mipantalla',version:'0.7.7',sha256:'dd107a1cf409d7348cf4efd04eb3de432afd129358701f57470c05485e2f1e17',url:'https://github.com/frxnnk/webos-liquid-glass-launcher/releases/download/v0.7.7/com.frxn.mipantalla_0.7.7_all.ipk'});
function validInventory(value){
  if(!value||value.returnValue!==true||!Array.isArray(value.apps))return false;
  var seen=Object.create(null);
  return value.apps.every(function(app){
    if(!app||typeof app.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(app.id)||seen[app.id])return false;
    seen[app.id]=true;return true;
  });
}
function verifyPackage(bytes){
  if(!Buffer.isBuffer(bytes)||bytes.length>16*1024*1024||crypto.createHash('sha256').update(bytes).digest('hex')!==PIN.sha256)throw Error('PACKAGE_HASH_MISMATCH');
  return true;
}
function uploadScript(bytes,backupId){
  return "set -eu\n/usr/bin/node -e \"eval(require('fs').readFileSync(3,'utf8'))\" </dev/null 3<<'MP_INSTALL_PAYLOAD'\n"+`
'use strict';
var fs=require('fs'),cp=require('child_process'),crypto=require('crypto');
var bytes=Buffer.from(${JSON.stringify(bytes.toString('base64'))},'base64');
${validInventory.toString()}
var base='/var/lib/mipantalla-maintenance/setup-staging';
var root=base+'/${backupId}',file=root+'/launcher.ipk';
function fail(){process.stdout.write('{"returnValue":false}\\n');process.exitCode=1;}
function rpc(uri,args,next){
  cp.execFile('/usr/bin/luna-send',['-n','1','-f',uri,JSON.stringify(args)],{timeout:10000,maxBuffer:1024*1024,encoding:'utf8',env:Object.assign({},process.env,{LD_PRELOAD:''})},function(err,out){
    if(err)return fail();var value;try{value=JSON.parse(out);}catch(e){return fail();}
    if(!value||value.returnValue!==true)return fail();next(value);
  });
}
function directory(p){
  try{fs.mkdirSync(p,448);}catch(e){if(e.code!=='EEXIST')throw e;}
  var s=fs.lstatSync(p);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&18)!==0)throw Error('unsafe directory');
}
if(process.getuid()!==0)throw Error('root required');
if(crypto.createHash('sha256').update(bytes).digest('hex')!==${JSON.stringify(PIN.sha256)})throw Error('package changed');
rpc('luna://com.webos.service.tv.systemproperty/getSystemInfo',{keys:['modelName','firmwareVersion','sdkVersion','boardType']},function(device){
  if(device.modelName!=='49UN7310PSC'||device.firmwareVersion!=='04.64.00'||device.sdkVersion!=='5.6.2'||device.boardType!=='K6LP_ATSC_BR')throw Error('expected model');
  rpc('luna://com.webos.applicationManager/listApps',{},function(inventory){
    if(!validInventory(inventory)||inventory.apps.some(function(a){return a.id==='com.frxn.mipantalla';}))throw Error('app already exists or inventory invalid');
    directory('/var/lib/mipantalla-maintenance');directory(base);
    fs.mkdirSync(root,448);
    var fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,384);
    try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    rpc('luna://com.webos.appInstallService/dev/install',{id:'com.ares.defaultName',ipkUrl:file,subscribe:true},function(result){process.stdout.write(JSON.stringify({returnValue:true})+'\\n');});
  });
});
MP_INSTALL_PAYLOAD\n`;
}
async function installPackage(transport,options,deps={}){
  if(!options||!/^[a-f0-9]{32}$/.test(options.backupId||''))throw Error('BACKUP_ID_INVALID');
  if(options.expectedInstalledVersion===PIN.version)return{status:'skipped',code:'PACKAGE_ALREADY_INSTALLED'};
  if(options.expectedInstalledVersion!==null)throw Error('UPDATE_PRESERVATION_REQUIRED');
  const readFile=deps.readFile||fs.readFile;
  let bytes;
  try{bytes=await readFile(path.join(__dirname,'..','artifacts','public-launcher','com.frxn.mipantalla_0.7.7_all.ipk'));}
  catch(error){
    if(error.code!=='ENOENT')throw error;
    const response=await(deps.fetch||fetch)(PIN.url,{signal:AbortSignal.timeout(20000)});
    if(!response.ok||!response.body)throw Error('PACKAGE_DOWNLOAD_FAILED');
    const chunks=[];let size=0;
    for await(const chunk of response.body){size+=chunk.length;if(size>16*1024*1024)throw Error('PACKAGE_TOO_LARGE');chunks.push(Buffer.from(chunk));}
    bytes=Buffer.concat(chunks);
  }
  (deps.verifyPackage||verifyPackage)(bytes);
  const reply=await transport.runRemote(uploadScript(bytes,options.backupId),{timeoutMs:20000});
  let ack;try{ack=JSON.parse(reply.stdout);}catch{throw Error('INSTALL_ACK_INVALID');}
  if(!ack||ack.returnValue!==true)throw Error('INSTALL_REJECTED');
  const delay=deps.delay||(ms=>new Promise(resolve=>setTimeout(resolve,ms)));
  for(let attempt=0;attempt<8;attempt++){
    const response=await transport.runRemote("luna-send -n 1 luna://com.webos.applicationManager/listApps '{}' </dev/null\n",{timeoutMs:8000});
    let inventory;try{inventory=JSON.parse(response.stdout);}catch{throw Error('INSTALL_INVENTORY_INVALID');}
    if(!validInventory(inventory))throw Error('INSTALL_INVENTORY_INVALID');
    const app=inventory.apps.find(value=>value.id===PIN.id);
    if(app&&app.version===PIN.version)return{status:'complete',code:'PACKAGE_INSTALLED',installedByThisPlan:true};
    if(attempt<7)await delay(400);
  }
  throw Error('INSTALL_UNCONFIRMED');
}
module.exports={PIN,verifyPackage,validInventory,installPackage,uploadScript};
