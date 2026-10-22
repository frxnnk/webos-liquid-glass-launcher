'use strict';
const fs=require('node:fs/promises');
const syncFs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const cp=require('node:child_process');
const net=require('node:net');
const {buildBundle,canonicalPublicKey}=require('./root-bundle.cjs');
const ROOT=path.join(os.homedir(),'.mi-pantalla-installer','root-runs');
function execute(command,args,options={}) {
  return new Promise((resolve,reject)=>{
    const chunks=[];let size=0,done=false,child;
    const timer=setTimeout(()=>finish('ROOT_LOCAL_TIMEOUT'),options.timeoutMs||15000);
    function finish(error){if(done)return;done=true;clearTimeout(timer);if(error){try{child.kill('SIGKILL');}catch{}reject(Error(error));}else resolve(Buffer.concat(chunks).toString('utf8'));}
    try{child=cp.spawn(command,args,{cwd:options.cwd,env:options.env||process.env,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
      child.on('error',()=>finish('ROOT_LOCAL_COMMAND_UNAVAILABLE'));
      child.on('close',code=>finish(code===0?null:'ROOT_LOCAL_COMMAND_FAILED'));
      function output(bytes,keep){size+=bytes.length;if(size>524288)return finish('ROOT_LOCAL_OUTPUT_LIMIT');if(keep)chunks.push(Buffer.from(bytes));}
      child.stdout.on('data',bytes=>output(bytes,true));child.stderr.on('data',bytes=>output(bytes,false));
    }catch{finish('ROOT_LOCAL_COMMAND_UNAVAILABLE');}
  });
}
async function derivePublicKey(config){return canonicalPublicKey(await execute('ssh-keygen',['-y','-f',config.identity]));}
function routeIp(config){return new Promise((resolve,reject)=>{const socket=net.createConnection({host:config.host,port:3001});let done=false;
  function end(error,address){if(done)return;done=true;socket.destroy();if(error)reject(Error('ROOT_LAN_ROUTE_UNCONFIRMED'));else resolve(address);}
  socket.setTimeout(3000,()=>end(true));socket.on('error',()=>end(true));socket.on('connect',()=>end(false,socket.localAddress));});}
async function privateDirectory(directory,create) {
  let cursor=path.parse(directory).root;
  for(const part of directory.slice(cursor.length).split(path.sep).filter(Boolean)){
    cursor=path.join(cursor,part);
    try{const ancestor=await fs.lstat(cursor);if(!ancestor.isDirectory()||ancestor.isSymbolicLink())throw Error('ROOT_JOURNAL_UNSAFE');}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  if(create)await fs.mkdir(directory,{recursive:true,mode:448});
  const stat=await fs.lstat(directory);
  if(!stat.isDirectory()||stat.isSymbolicLink()||process.platform!=='win32'&&((stat.mode&511)!==448||stat.uid!==process.getuid()))throw Error('ROOT_JOURNAL_UNSAFE');
}
function rootDirectory(options={}){const directory=options.directory||ROOT;if(typeof directory!=='string'||!path.isAbsolute(directory)||/[\x00-\x1f\x7f]/.test(directory))throw Error('ROOT_JOURNAL_UNSAFE');return path.resolve(directory);}
function runDirectory(id,options){if(!/^[a-f0-9]{32}$/.test(id||''))throw Error('BACKUP_ID_INVALID');return path.join(rootDirectory(options),id);}
function reservationFile(config,options){
  const host=config&&config.host,parts=typeof host==='string'&&host.split('.');
  if(!parts||parts.length!==4||parts.some(p=>! /^(?:0|[1-9]\d{0,2})$/.test(p)||+p>255))throw Error('ROOT_JOURNAL_UNSAFE');
  const [a,b]=parts.map(Number);if(!(a===10||a===172&&b>=16&&b<=31||a===192&&b===168))throw Error('ROOT_JOURNAL_UNSAFE');
  return path.join(rootDirectory(options),'host-'+require('node:crypto').createHash('sha256').update('webos49:'+host).digest('hex')+'.lock');
}
function privateFile(stat){return stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1&&stat.size<=8192&&(process.platform==='win32'||(stat.mode&511)===384&&stat.uid===process.getuid());}
async function syncDirectory(directory){if(process.platform==='win32')return;const fd=await fs.open(directory,syncFs.constants.O_RDONLY|(syncFs.constants.O_NOFOLLOW||0));try{await fd.sync();}finally{await fd.close();}}
async function reservation(config,options={}){
  const file=reservationFile(config,options);let fd;
  try{fd=await fs.open(file,syncFs.constants.O_RDONLY|(syncFs.constants.O_NOFOLLOW||0));}catch(error){if(error.code==='ENOENT')return null;throw error;}
  try{
    const stat=await fd.stat(),visible=await fs.lstat(file);if(!privateFile(stat)||visible.isSymbolicLink()||visible.ino!==stat.ino||visible.dev!==stat.dev)throw Error('ROOT_JOURNAL_UNSAFE');
    let owner;try{owner=JSON.parse(await fd.readFile('utf8'));}catch{return {id:null,phase:'reservation-unconfirmed',stat};}
    if(!owner||owner.version!==1||owner.host!==config.host||!/^[a-f0-9]{32}$/.test(owner.id||''))return {id:null,phase:'reservation-unconfirmed',stat};
    return {id:owner.id,phase:'reserved',stat};
  }finally{await fd.close();}
}
async function reserve(config,options={}){
  if(!/^[a-f0-9]{32}$/.test(options.id||''))throw Error('BACKUP_ID_INVALID');
  const root=rootDirectory(options);await privateDirectory(root,true);const file=reservationFile(config,options);let fd;
  try{fd=await fs.open(file,syncFs.constants.O_WRONLY|syncFs.constants.O_CREAT|syncFs.constants.O_EXCL|(syncFs.constants.O_NOFOLLOW||0),384);}
  catch(error){if(error.code==='EEXIST')throw Error('ROOT_RESERVATION_HELD');throw error;}
  try{if(!privateFile(await fd.stat()))throw Error('ROOT_JOURNAL_UNSAFE');await fd.writeFile(JSON.stringify({version:1,id:options.id,host:config.host,createdAt:Date.now()}));await fd.sync();}
  finally{await fd.close();}
  await syncDirectory(root);return {id:options.id,host:config.host};
}
async function releaseReservation(lease,options={}){
  const root=rootDirectory(options);await privateDirectory(root,false);const owner=await reservation(lease,options);
  if(!owner||owner.id!==lease.id)throw Error('ROOT_RESERVATION_OWNER');
  const file=reservationFile(lease,options),current=await fs.lstat(file);
  if(current.isSymbolicLink()||current.ino!==owner.stat.ino||current.dev!==owner.stat.dev)throw Error('ROOT_RESERVATION_OWNER');
  await fs.unlink(file);await syncDirectory(root);
}
async function record(value,options={}){
  await privateDirectory(rootDirectory(options),true);const directory=runDirectory(value.id,options);await privateDirectory(directory,true);
  const file=path.join(directory,'run.json'),temporary=path.join(directory,'run-'+require('node:crypto').randomBytes(8).toString('hex')+'.tmp');
  const fd=await fs.open(temporary,'wx',384);try{await fd.writeFile(JSON.stringify(value));await fd.sync();}finally{await fd.close();}
  try{const before=await fs.lstat(file);if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1)throw Error('ROOT_JOURNAL_UNSAFE');}catch(error){if(error.code!=='ENOENT')throw error;}
  await fs.rename(temporary,file);
}
async function recovery(config,options={}){
  const root=rootDirectory(options);try{await privateDirectory(root,false);}catch(error){if(error.code==='ENOENT')return null;throw error;}
  const names=await fs.readdir(root);if(names.length>2000)throw Error('ROOT_JOURNAL_UNSAFE');
  for(const name of names.filter(name=>/^[a-f0-9]{32}$/.test(name))){
    const directory=runDirectory(name,options);await privateDirectory(directory,false);const file=path.join(directory,'run.json'),stat=await fs.lstat(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>65536)throw Error('ROOT_JOURNAL_UNSAFE');
    const item=JSON.parse(await fs.readFile(file,'utf8'));
    if(item.id!==name||item.version!==1||!item.config)throw Error('ROOT_JOURNAL_UNSAFE');
    if(item.config.host===config.host&&!['complete','download-failed'].includes(item.phase))return {id:item.id,phase:item.phase};
  }
  const lease=await reservation(config,options);return lease&&lease.id!==options.ignoreReservation?{id:lease.id,phase:lease.phase}:null;
}
async function runBootstrap(options,sources){
  const bundle=buildBundle(options,sources),directory=runDirectory(options.id,{directory:options.journalDir});
  await privateDirectory(directory,false);await fs.mkdir(path.join(directory,'bundle'),{mode:448});const destination=path.join(directory,'bundle');
  await fs.mkdir(path.join(destination,'wwwroot'),{mode:448});
  for(const [name,bytes] of Object.entries(bundle.files)){
    if(!/^(?:wwwroot\/)?[A-Za-z0-9._-]+$/.test(name))throw Error('ROOT_BUNDLE_PATH_INVALID');
    await fs.writeFile(path.join(destination,...name.split('/')),bytes,{flag:'wx',mode:384});
  }
  const publicManifest={version:1,id:options.id,tvDestination:bundle.destination,files:Object.fromEntries(Object.entries(bundle.files).map(([name,bytes])=>[name,require('node:crypto').createHash('sha256').update(bytes).digest('hex')]))};
  await fs.writeFile(path.join(directory,'bundle-manifest.json'),JSON.stringify(publicManifest),{flag:'wx',mode:384});
  await execute('python',['-c','import sys; assert sys.version_info >= (3, 8)'],{timeoutMs:5000});
  // Completion means only that assets were requested. SSH postchecks, rather
  // than this process exit code, establish whether root became available.
  await execute('python',[path.join(destination,'slopbro.py'),'--asset-source','dir','--local-ip',options.localIp,'--webos-version','5.6.2',options.host],{cwd:destination,timeoutMs:115000,
    env:{...process.env,PYTHONIOENCODING:'utf-8'}});
  return {status:'delivered',rootVerified:false};
}
module.exports={derivePublicKey,routeIp,record,recovery,reserve,releaseReservation,runBootstrap,runDirectory,execute};
