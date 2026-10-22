'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {repairSignedScript}=require('../installer/root-repair.cjs');
const profile=require('../installer/model-profile.json');
const directory='/media/cryptofs/apps/usr/palm/services/com.palmdts.devmode.service';
const original=directory+'/start-devmode.sh',candidate=original+'.backup',token='/var/luna/preferences/devmode_enabled';
const stock=Buffer.from('#!/bin/sh\necho signed stock fixture\n');
const stockHash=crypto.createHash('sha256').update(stock).digest('hex');
function environment({missingOriginal=false,invalidBackup=false,directoryToken=false}={}) {
  const entries=new Map(),fds=new Map(),events=[];let inode=1,nextFd=3,result;
  function add(name,type,bytes,mode=448){entries.set(name,{type,bytes:Buffer.from(bytes||''),uid:0,mode,nlink:1,ino:inode++,dev:1,mtimeMs:123});}
  function parents(name){let at='';for(const part of name.split('/').filter(Boolean).slice(0,-1)){at+='/'+part;if(!entries.has(at))add(at,'directory','',493);}}
  function item(name){const entry=entries.get(name);if(!entry)throw Object.assign(Error('absent'),{code:'ENOENT'});return entry;}
  function metadata(name){const value=item(name);return {...value,size:value.bytes.length,isFile:()=>value.type==='file',isDirectory:()=>value.type==='directory',isSymbolicLink:()=>value.type==='symlink'};}
  parents(original);parents(token);parents('/etc/starfish-release');parents('/var/lib/parent');
  add('/etc/starfish-release','file','Rockhopper release 5.6.2-21 (jhericurl-jimna)\n',420);
  if(!missingOriginal)add(original,'file','patched script',493);
  add(candidate,'file',invalidBackup?'bad backup':stock,493);add(token,directoryToken?'directory':'file','SESSION SECRET',384);
  const fs={constants:require('node:fs').constants,lstatSync:metadata,mkdirSync(name,mode){if(entries.has(name))throw Object.assign(Error('exists'),{code:'EEXIST'});parents(name);add(name,'directory','',mode);events.push(['mkdir',name]);},
    openSync(name,flags,mode){if(flags&this.constants.O_CREAT){if(entries.has(name))throw Object.assign(Error('exists'),{code:'EEXIST'});add(name,'file','',mode);events.push(['create',name]);}else item(name);const fd=nextFd++;fds.set(fd,name);return fd;},
    fstatSync(fd){return metadata(fds.get(fd));},readFileSync(name,encoding){const actual=typeof name==='number'?fds.get(name):name;events.push(['read',actual]);const bytes=item(actual).bytes;return encoding?bytes.toString(encoding):Buffer.from(bytes);},
    writeFileSync(fd,bytes){const name=fds.get(fd);item(name).bytes=Buffer.from(bytes);events.push(['write',name]);},fsyncSync(fd){events.push(['sync',fds.get(fd)]);},closeSync(fd){fds.delete(fd);},
    renameSync(from,to){const entry=item(from);entries.set(to,entry);entries.delete(from);events.push(['rename',to]);},existsSync:name=>entries.has(name)};
  const deps={fs,crypto,getuid:()=>0,output:value=>{result=value;},cp:{execFile(command,args,options,callback){
    assert.equal(options.env.LD_PRELOAD,'');
    if(command.endsWith('luna-send'))callback(null,JSON.stringify({returnValue:true,modelName:profile.model,firmwareVersion:profile.firmware,sdkVersion:profile.sdk,boardType:profile.board}));
    else if(command.endsWith('openssl')){const verified=item(args[args.length-1]).bytes.equals(stock);callback(verified?null:Error('signature'),verified?'Verified OK\n':'Verification Failure\n');}
    else throw Error('unexpected process');
  }}};
  return {deps,entries,events,result:()=>result};
}
test('remote repair validates signed backup, saves previous bytes, replaces only script and never reads token',async()=>{
  const env=environment();await repairSignedScript(env.deps,{backupId:'a'.repeat(32)},profile,stockHash);
  assert.equal(env.result().ok,true);assert.ok(env.entries.get(original).bytes.equals(stock));
  assert.equal(env.events.some(([action,name])=>action==='read'&&name===token),false);
  const saved=env.events.findIndex(([action,name])=>action==='sync'&&name.endsWith('/start-devmode.before'));
  const replaced=env.events.findIndex(([action,name])=>action==='rename'&&name===original);
  assert.ok(saved>=0&&saved<replaced);assert.equal(env.entries.get(token).bytes.toString(),'SESSION SECRET');
});
test('missing script can be restored only from the pinned signed stock backup',async()=>{
  const env=environment({missingOriginal:true});await repairSignedScript(env.deps,{backupId:'b'.repeat(32)},profile,stockHash);
  assert.equal(env.result().ok,true);assert.ok(env.entries.get(original).bytes.equals(stock));
});
test('invalid backup and directory-style upstream token block before recovery writes',async()=>{
  for(const options of [{invalidBackup:true},{directoryToken:true}]){
    const env=environment(options);await repairSignedScript(env.deps,{backupId:'c'.repeat(32)},profile,stockHash);
    assert.equal(env.result().ok,false);assert.equal(env.events.some(([action])=>['create','write','rename','mkdir'].includes(action)),false);
  }
});
