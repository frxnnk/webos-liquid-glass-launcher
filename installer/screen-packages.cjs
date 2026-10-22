'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const PINS=Object.freeze([
  Object.freeze({id:'org.webosbrew.piccap',version:'0.5.3',name:'org.webosbrew.piccap_0.5.3_all.ipk',bytes:1015078,sha256:'ad6b06766cea01dbe8ea0ac9dbbbd9c1a6c030e72df6cd96214199f50d38e486',url:'https://github.com/TBSniller/piccap/releases/download/0.5.3/org.webosbrew.piccap_0.5.3_all.ipk'}),
  Object.freeze({id:'org.webosbrew.hyperhdr.loader',version:'22.0.1',name:'org.webosbrew.hyperhdr.loader_22.0.1_all.ipk',bytes:33555434,sha256:'1341e25c1ebb6eeea172485dc885acb44c93d79bc5ac5ce698ed721664671f08',url:'https://github.com/webosbrew/hyperhdr-webos-loader/releases/download/v22.0.1/org.webosbrew.hyperhdr.loader_22.0.1_all.ipk'})
]);
function checked(pin){if(!PINS.includes(pin))throw Error('SCREEN_PACKAGE_INVALID');return pin;}
function verify(bytes,pin){checked(pin);if(!Buffer.isBuffer(bytes)||bytes.length!==pin.bytes||crypto.createHash('sha256').update(bytes).digest('hex')!==pin.sha256)throw Error('SCREEN_PACKAGE_HASH_MISMATCH');return bytes;}
async function download(pin,deps={}){
  checked(pin);let bytes;
  try{bytes=await(deps.readFile||fs.readFile)(path.join(__dirname,'..','artifacts','capture-preparation',pin.name));}
  catch(e){if(e.code!=='ENOENT')throw e;
    const response=await(deps.fetch||fetch)(pin.url,{signal:AbortSignal.timeout(60000)});
    if(!response.ok||!response.body)throw Error('SCREEN_PACKAGE_DOWNLOAD_FAILED');
    const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>pin.bytes)throw Error('SCREEN_PACKAGE_TOO_LARGE');chunks.push(Buffer.from(chunk));}
    bytes=Buffer.concat(chunks);
  }
  return verify(bytes,pin);
}
function nodeScript(body){return '/usr/bin/node -e "eval(require(\'fs\').readFileSync(3,\'utf8\'))" </dev/null 3<<\'MP_SCREEN_PACKAGE\'\n'+
  "'use strict';var fs=require('fs'),crypto=require('crypto');if(process.getuid()!==0)throw Error('root required');\n"+body+'\nMP_SCREEN_PACKAGE\n';}
function stageScript(pin,id,chunk,offset){
  checked(pin);if(!/^[a-f0-9]{32}$/.test(id)||!Number.isInteger(offset)||offset<0||offset>pin.bytes||chunk!==null&&(!Buffer.isBuffer(chunk)||!chunk.length||chunk.length>1048576||offset+chunk.length>pin.bytes))throw Error('SCREEN_STAGE_INVALID');
  const directory='/var/lib/mipantalla-maintenance/screen-staging/'+id,file=directory+'/'+pin.name;
  const common="var root="+JSON.stringify(directory)+",file="+JSON.stringify(file)+";\n"+
    "function dir(p){var s=fs.lstatSync(p);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&511)!==448)throw Error('unsafe directory');}\n";
  if(chunk===null)return nodeScript(common+
    "['/var/lib/mipantalla-maintenance','/var/lib/mipantalla-maintenance/screen-staging'].forEach(function(p){try{fs.mkdirSync(p,448);}catch(e){if(e.code!=='EEXIST')throw e;}dir(p);});fs.mkdirSync(root,448);dir(root);var fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,384);fs.closeSync(fd);process.stdout.write('{\"ok\":true}\\n');");
  return nodeScript(common+"dir(root);var before=fs.lstatSync(file);if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.uid!==0||(before.mode&511)!==384||before.size!=="+offset+")throw Error('stage changed');"+
    "var fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_APPEND|fs.constants.O_NOFOLLOW);try{var s=fs.fstatSync(fd);if(s.ino!==before.ino||s.dev!==before.dev||s.size!==before.size)throw Error('stage changed');fs.writeFileSync(fd,Buffer.from("+JSON.stringify(chunk.toString('base64'))+",'base64'));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}process.stdout.write('{\"ok\":true}\\n');");
}
function installScript(pin,id){
  checked(pin);if(!/^[a-f0-9]{32}$/.test(id))throw Error('SCREEN_STAGE_INVALID');
  const file='/var/lib/mipantalla-maintenance/screen-staging/'+id+'/'+pin.name;
  return nodeScript("var file="+JSON.stringify(file)+";var s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.uid!==0||(s.mode&511)!==384||s.size!=="+pin.bytes+")throw Error('stage invalid');var fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW),bytes;try{var actual=fs.fstatSync(fd);if(actual.ino!==s.ino||actual.dev!==s.dev)throw Error('stage changed');bytes=fs.readFileSync(fd);}finally{fs.closeSync(fd);}if(crypto.createHash('sha256').update(bytes).digest('hex')!=="+JSON.stringify(pin.sha256)+")throw Error('hash changed');"+
    require('./install-package.cjs').validInventory.toString()+"\n"+
    "var cp=require('child_process');function luna(uri,payload,next){cp.execFile('/usr/bin/luna-send',['-n','1','-f',uri,JSON.stringify(payload)],{timeout:15000,maxBuffer:1048576,encoding:'utf8',env:Object.assign({},process.env,{LD_PRELOAD:''})},function(error,out){if(error)throw Error('install rejected');var result=JSON.parse(out);if(result.returnValue!==true)throw Error('install rejected');next(result);});}"+
    "luna('luna://com.webos.applicationManager/listApps',{},function(inventory){if(!validInventory(inventory))throw Error('inventory invalid');var found=inventory.apps.filter(function(app){return app.id==="+JSON.stringify(pin.id)+";})[0];if(found){if(found.version!=="+JSON.stringify(pin.version)+")throw Error('version conflict');process.stdout.write('{\"ok\":true,\"alreadyInstalled\":true}\\n');return;}luna('luna://com.webos.appInstallService/dev/install',{id:'com.ares.defaultName',ipkUrl:file,subscribe:true},function(){process.stdout.write('{\"ok\":true,\"alreadyInstalled\":false}\\n');});});");
}
async function acknowledged(transport,script){const response=await transport.runRemote(script,{timeoutMs:20000});let value;try{value=JSON.parse(response.stdout);}catch{throw Error('SCREEN_PACKAGE_UNCONFIRMED');}if(!value||value.ok!==true)throw Error('SCREEN_PACKAGE_UNCONFIRMED');return value;}
async function installMissing(transport,missing,deps={}){
  if(!Array.isArray(missing)||missing.some(name=>!['piccap','hyperhdr','screen-config'].includes(name)))throw Error('SCREEN_PACKAGE_INVALID');
  const selected=PINS.filter(pin=>missing.includes(pin.id==='org.webosbrew.piccap'?'piccap':'hyperhdr'));
  const packages=[];for(const pin of selected)packages.push({pin,bytes:await download(pin,deps)});
  const installed=[];
  for(const entry of packages){
    const id=crypto.randomBytes(16).toString('hex');await acknowledged(transport,stageScript(entry.pin,id,null,0));
    for(let offset=0;offset<entry.bytes.length;offset+=1048576)await acknowledged(transport,stageScript(entry.pin,id,entry.bytes.subarray(offset,offset+1048576),offset));
    const ack=await acknowledged(transport,installScript(entry.pin,id));
    let confirmed=false;
    for(let attempt=0;attempt<8;attempt++){
      const response=await transport.runRemote("luna-send -n 1 luna://com.webos.applicationManager/listApps '{}' </dev/null\n",{timeoutMs:8000});
      const inventory=JSON.parse(response.stdout);if(!require('./install-package.cjs').validInventory(inventory))throw Error('SCREEN_INVENTORY_INVALID');
      const found=inventory.apps.find(app=>app.id===entry.pin.id);if(found&&found.version===entry.pin.version){confirmed=true;break;}
      if(attempt<7)await(deps.delay||(ms=>new Promise(resolve=>setTimeout(resolve,ms))))(400);
    }
    if(!confirmed)throw Error('SCREEN_INSTALL_UNCONFIRMED');if(ack.alreadyInstalled!==true)installed.push(entry.pin.id);
  }
  return {installed};
}
module.exports={PINS,verify,download,stageScript,installScript,installMissing};
