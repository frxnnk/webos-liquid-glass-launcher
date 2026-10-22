const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const dir=path.join(__dirname,'../services/com.frxn.mipantalla.lights');
const createRenewer=require(path.join(dir,'hyperhdr-renew.js'));
const login=require(path.join(dir,'hyperhdr-login.js'));
const PASSWORD='a1'.repeat(24);
const OLD='o'.repeat(40),NEW='n'.repeat(40);
const CREDS='/c/credentials.json',CONFIG='/s/screen-config.json';
const IDS=['wiz-aabbcc001122'];

// In-memory file system with the same shape renew() needs; records every write in order.
function memoryFs(files,options={}){
  const store=new Map(Object.entries(files).map(([name,value])=>[name,{text:JSON.stringify(value),mode:options.mode||0o100600,uid:options.uid===undefined?0:options.uid,nlink:1,ino:name.length}]));
  const writes=[],fds=new Map();let next=10;
  const constants={O_RDONLY:0,O_WRONLY:1,O_CREAT:64,O_EXCL:128,O_NOFOLLOW:0};
  const stat=entry=>({isFile:()=>true,isSymbolicLink:()=>false,nlink:entry.nlink,size:entry.text.length,uid:entry.uid,mode:entry.mode,ino:entry.ino,dev:1});
  return {constants,writes,store,
    lstatSync(file){const e=store.get(file);if(!e)throw Object.assign(Error('ENOENT'),{code:'ENOENT'});return stat(e);},
    openSync(file){const fd=next++;if(!store.has(file)&&/\.tmp$/.test(file))store.set(file,{text:'',mode:0o100600,uid:0,nlink:1,ino:99});fds.set(fd,file);return fd;},
    fstatSync(fd){return stat(store.get(fds.get(fd)));},
    readFileSync(fd){return store.get(fds.get(fd)).text;},
    writeFileSync(fd,text){if(options.failWrite&&options.failWrite(fds.get(fd)))throw Error('disk full');store.get(fds.get(fd)).text=text;},
    fsyncSync(){},closeSync(fd){fds.delete(fd);},
    renameSync(from,to){const e=store.get(from);store.delete(from);store.set(to,Object.assign(e,{ino:e.ino+1}));writes.push(to);},
    unlinkSync(file){store.delete(file);},
    json(file){return JSON.parse(store.get(file).text);}};
}
function creds(extra={}){return Object.assign({phase:'configured',password:PASSWORD,token:OLD,previousToken:null,ids:IDS,adopted:true},extra);}
function conf(extra={}){return Object.assign({enabled:true,token:OLD,profile:'Mi pantalla WiZ Living',hardwareVerified:true},extra);}
function setup(over={}){
  const fs=memoryFs({[CREDS]:over.creds||creds(),[CONFIG]:over.config||conf()},over.fs);
  let attempts=0,time=1000;
  const renewer=createRenewer({fs,uid:over.uid===undefined?0:over.uid,credentialsFile:CREDS,configFile:CONFIG,now:()=>time,
    random:()=>'r'+(++attempts),cooldownMs:30000,
    login:Object.assign(async pw=>{attempts+=0;login.calls=(login.calls||[]).concat(pw);if(over.loginError)throw over.loginError;return over.token||NEW;},{validToken:login.validToken})});
  return {fs,renewer,tick:ms=>{time+=ms;}};
}

test('renewal rewrites credentials first, then the config, and keeps every other field',async()=>{
  const t=setup();
  assert.equal(await t.renewer.renew(),NEW);
  assert.equal(t.fs.json(CONFIG).token,NEW);
  assert.deepEqual(Object.keys(t.fs.json(CONFIG)),['enabled','token','profile','hardwareVerified']);
  const saved=t.fs.json(CREDS);
  assert.equal(saved.token,NEW);assert.equal(saved.previousToken,null);
  assert.equal(saved.password,PASSWORD);assert.equal(saved.phase,'configured');assert.deepEqual(saved.ids,IDS);assert.equal(saved.adopted,true);
  assert.deepEqual(t.fs.writes,[CREDS,CONFIG,CREDS]);
  assert.equal(t.fs.store.get(CREDS).mode,0o100600);
});

test('a failure while writing the config leaves previousToken so the PC assistant still accepts the state',async()=>{
  const t=setup({fs:{failWrite:file=>/screen-config\.json\./.test(file)}});
  await assert.rejects(t.renewer.renew());
  const saved=t.fs.json(CREDS);
  assert.equal(saved.token,NEW);assert.equal(saved.previousToken,OLD);
  assert.equal(t.fs.json(CONFIG).token,OLD);
  assert.ok([saved.token,saved.previousToken].includes(t.fs.json(CONFIG).token),'config token must equal credentials token or previousToken');
  assert.equal([...t.fs.store.keys()].some(name=>/\.tmp$/.test(name)),false,'no temporary file stays behind');
});

test('state that is not exactly the prepared one is left alone and never logs in',async()=>{
  const cases=[
    {config:conf({token:'x'.repeat(40)})},
    {creds:creds({previousToken:OLD})},
    {creds:creds({phase:'prepared'})},
    {creds:creds({password:'short'})},
    {config:conf({enabled:false})}
  ];
  for(const over of cases){
    login.calls=[];const t=setup(over);
    await assert.rejects(t.renewer.renew(),{code:'RENEW_STATE_UNEXPECTED'});
    assert.deepEqual(login.calls,[]);assert.deepEqual(t.fs.writes,[]);
  }
});

test('only root with private files may renew; others fail as unavailable without touching anything',async()=>{
  for(const over of [{uid:1000},{fs:{mode:0o100644}},{fs:{uid:1000}}]){
    login.calls=[];const t=setup(over);
    await assert.rejects(t.renewer.renew(),/RENEW_(UNAVAILABLE|FILE_UNSAFE)/);
    assert.deepEqual(login.calls,[]);assert.deepEqual(t.fs.writes,[]);
  }
  const missing=createRenewer({fs:memoryFs({}),uid:0,credentialsFile:CREDS,configFile:CONFIG});
  await assert.rejects(missing.renew(),{code:'RENEW_UNAVAILABLE'});
});

test('a rejected login changes nothing and a second try inside the cooldown does not reach HyperHDR',async()=>{
  login.calls=[];
  const t=setup({loginError:Object.assign(Error('rejected'),{code:'HYPERHDR_LOGIN_REJECTED'})});
  await assert.rejects(t.renewer.renew(),{code:'HYPERHDR_LOGIN_REJECTED'});
  await assert.rejects(t.renewer.renew(),{code:'RENEW_COOLDOWN'});
  assert.equal(login.calls.length,1);assert.deepEqual(t.fs.writes,[]);
  t.tick(31000);
  await assert.rejects(t.renewer.renew(),{code:'HYPERHDR_LOGIN_REJECTED'});
  assert.equal(login.calls.length,2);
});

test('concurrent renewals share one login',async()=>{
  login.calls=[];const t=setup();
  const results=await Promise.all([t.renewer.renew(),t.renewer.renew(),t.renewer.renew()]);
  assert.deepEqual(results,[NEW,NEW,NEW]);assert.equal(login.calls.length,1);
});

function fakeSocket(reply){
  const socket=new EventEmitter();socket.sent=[];
  socket.write=text=>{socket.sent.push(text);if(reply)setImmediate(()=>reply(socket));return true;};
  socket.destroy=()=>{socket.destroyed=true;};
  setImmediate(()=>socket.emit('connect'));
  return socket;
}
test('login sends the password only to local HyperHDR and returns the token from a successful reply',async()=>{
  let endpoint,socket;
  const token=await login(PASSWORD,{socketFactory:e=>{endpoint=e;return socket=fakeSocket(s=>s.emit('data',Buffer.from(JSON.stringify({command:'authorize-login',tan:1,success:true,info:{token:NEW}})+'\n')));}});
  assert.equal(token,NEW);assert.deepEqual(endpoint,{host:'127.0.0.1',port:19444});
  assert.deepEqual(JSON.parse(socket.sent[0]),{command:'authorize',subcommand:'login',password:PASSWORD,tan:1});
  assert.equal(socket.destroyed,true);
});
test('login rejects bad passwords, rejected replies, short tokens, garbage and silence',async()=>{
  await assert.rejects(login('nope'),{code:'HYPERHDR_LOGIN_INVALID'});
  const reply=body=>login(PASSWORD,{timeoutMs:50,socketFactory:()=>fakeSocket(s=>s.emit('data',Buffer.from(body+'\n')))});
  await assert.rejects(reply(JSON.stringify({tan:1,success:false})),{code:'HYPERHDR_LOGIN_REJECTED'});
  await assert.rejects(reply(JSON.stringify({tan:1,success:true,info:{token:'short'}})),{code:'HYPERHDR_LOGIN_PROTOCOL'});
  await assert.rejects(reply('not json'),{code:'HYPERHDR_LOGIN_PROTOCOL'});
  await assert.rejects(login(PASSWORD,{timeoutMs:30,socketFactory:()=>fakeSocket(null)}),{code:'HYPERHDR_LOGIN_TIMEOUT'});
});
