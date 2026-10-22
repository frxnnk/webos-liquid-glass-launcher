'use strict';
const hostFs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const steps=require('./steps.cjs');
const {ACTIONS,READ_ACTIONS,FEATURE_ACTIONS,MUTATING_ACTIONS}=require('./actions.cjs');
const ID=/^[a-f0-9]{32}$/;
function object(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function createEngine(deps={}) {
  const fs=deps.journalFs||hostFs;
  const features=require('./features.cjs').createFeatures(deps);
  const plans=new Map(),now=deps.now||Date.now;
  const journalDir=deps.journalDir||path.join(os.homedir(),'.mi-pantalla-installer');
  let mutating=false,activeTarget=null;
  function id(){return crypto.randomBytes(16).toString('hex');}
  function result(action,status,codes=[],extra={}) {
    return Object.assign({ok:['ready','planned','complete'].includes(status),action,status,
      summary:status==='blocked'?'No se puede continuar con este plan.':status==='partial'?'Hay cambios o verificaciones pendientes.':status==='failed'?'No se pudo confirmar la operación.':status==='planned'?'Plan preparado; todavía no se aplicaron cambios.':'Operación confirmada.',
      codes,steps:[]},extra);
  }
  function config(payload) {
    if(!object(payload)||typeof payload.host!=='string'||typeof payload.identity!=='string'||!path.isAbsolute(payload.identity)||/[\0\r\n]/.test(payload.identity)||payload.identity.length>4096)throw Error('INPUT_INVALID');
    const parts=payload.host.split('.').map(Number);
    if(!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(payload.host)||parts.some(n=>n>255)||!(parts[0]===10||parts[0]===192&&parts[1]===168||parts[0]===172&&parts[1]>=16&&parts[1]<=31))throw Error('INPUT_INVALID');
    return {host:payload.host,identity:payload.identity,port:22};
  }
  function options(raw) {
    if(!object(raw)||Object.keys(raw).some(k=>!['install','home','privacy','removeApps','root'].includes(k)))throw Error('OPTIONS_INVALID');
    for(const k of ['install','home','privacy','root'])if(raw[k]!==undefined&&typeof raw[k]!=='boolean')throw Error('OPTIONS_INVALID');
    const remove=raw.removeApps===undefined?[]:raw.removeApps;
    if(!Array.isArray(remove)||remove.length>3||new Set(remove).size!==remove.length||remove.some(k=>!steps.profile.removeAllowlist.includes(k)||steps.profile.protectedApps.includes(k)))throw Error('REMOVAL_NOT_ALLOWED');
    return {install:raw.install===true,home:raw.home===true,privacy:raw.privacy===true,removeApps:remove.slice(),root:raw.root===true};
  }
  function transport(connection){return (deps.createTransport||require('./transport.cjs').createTransport)(connection);}
  async function remote(t,request){return steps.parse((await t.runRemote(steps.script(request),{timeoutMs:20000})).stdout);}
  async function inspect(t){const out=await remote(t,{action:'inspect'});if(!out.ok||!object(out.snapshot)||!object(out.snapshot.general)||!object(out.snapshot.option)||!Array.isArray(out.snapshot.apps))throw Error('STATE_INVALID');return out.snapshot;}
  function preflight(snapshot,opts) {
    if(!steps.supported(snapshot))return 'PROFILE_UNSUPPORTED';
    if(snapshot.uid!==0)return 'ROOT_MANUAL_PENDING';
    if(opts.install&&snapshot.app&&snapshot.app.version!==steps.profile.app.version)return 'UPDATE_PRESERVATION_REQUIRED';
    if(opts.home&&(!object(snapshot.general.defaultApps)||typeof snapshot.general.defaultApps.home!=='string'))return 'HOME_BASELINE_UNKNOWN';
    if(opts.home&&!opts.install&&(!snapshot.app||snapshot.app.version!==steps.profile.app.version))return 'APP_REQUIRED';
    for(const item of snapshot.apps)if(opts.removeApps.includes(item.id)&&(item.systemApp!==false||item.removable!==true))return 'APP_NOT_REMOVABLE';
    return null;
  }
  function stepList(opts,snapshot,status='planned') {
    const out=[];
    if(opts.install)out.push({id:'install',label:'Instalar Mi pantalla '+steps.profile.app.version,status:snapshot.app&&snapshot.app.version===steps.profile.app.version?'skipped':status});
    if(opts.home)out.push({id:'home',label:'Configurar Home y arranque',status});
    if(opts.privacy)out.push({id:'privacy',label:'Reducir anuncios y reportes',status});
    for(const app of opts.removeApps)out.push({id:'remove:'+app,label:'Retirar '+app,status:snapshot.apps.some(a=>a.id===app)?status:'skipped'});
    return out;
  }
  function journalFile(key){if(!ID.test(key))throw Error('JOURNAL_INVALID');return path.join(journalDir,key+'.json');}
  function journalRoot(create=true) {
    if(create)try{fs.mkdirSync(journalDir,{mode:448});}catch(error){if(error.code!=='EEXIST')throw error;}
    const s=fs.lstatSync(journalDir);
    if(!s.isDirectory()||s.isSymbolicLink()||process.platform!=='win32'&&((s.mode&511)!==448||s.uid!==process.getuid()))throw Error('JOURNAL_UNSAFE');
  }
  function writeJournal(value,fresh) {
    journalRoot();const file=journalFile(value.id),before=fresh?null:fs.lstatSync(file);
    if(before){readJournal(value.id);if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1)throw Error('JOURNAL_UNSAFE');}
    let temporary=fresh?null:file+'.tmp-'+id(),fd,created=false;
    try{
      fd=fs.openSync(temporary||file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|(fs.constants.O_NOFOLLOW||0),384);
      created=true;
      const s=fs.fstatSync(fd);if(!s.isFile()||s.nlink!==1)throw Error('JOURNAL_UNSAFE');
      fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
      if(temporary){const current=fs.lstatSync(file);if(!current.isFile()||current.isSymbolicLink()||current.nlink!==1||current.ino!==before.ino||current.dev!==before.dev)throw Error('JOURNAL_UNSAFE');
        fs.renameSync(temporary,file);temporary=null;}
    }finally{if(fd!==undefined)fs.closeSync(fd);if(temporary&&created)try{fs.unlinkSync(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}}
  }
  function readJournal(key) {
    journalRoot(false);const file=journalFile(key),s=fs.lstatSync(file);
    if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>524288||process.platform!=='win32'&&(s.mode&511)!==384)throw Error('JOURNAL_UNSAFE');
    const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
    try{const actual=fs.fstatSync(fd);if(actual.ino!==s.ino||actual.size!==s.size)throw Error('JOURNAL_UNSAFE');
      const value=JSON.parse(fs.readFileSync(fd,'utf8'));if(value.version!==1||value.id!==key)throw Error('JOURNAL_INVALID');config(value.config);options(value.options);return value;
    }finally{fs.closeSync(fd);}
  }
  function sameTarget(a,b){return a.host===b.host&&a.identity===b.identity&&a.port===b.port;}
  function recovery(connection) {
    try{journalRoot(false);}catch(error){if(error.code==='ENOENT')return null;throw error;}
    const names=fs.readdirSync(journalDir).filter(name=>/^[a-f0-9]{32}\.json$/.test(name));
    if(names.length>2000)throw Error('JOURNAL_UNSAFE');
    const matching=names.map(name=>readJournal(name.slice(0,32))).filter(record=>sameTarget(record.config,connection));
    const pending=matching.filter(record=>['prepared','unconfirmed','restoring'].includes(record.phase));
    if(pending.length>1)throw Error('JOURNAL_UNSAFE');
    if(pending.length)return pending[0];
    matching.sort((a,b)=>b.createdAt-a.createdAt);
    if(matching.length>1&&matching[0].createdAt===matching[1].createdAt)return null;
    return matching[0]||null;
  }
  async function status(payload) {
    let connection;try{connection=config(payload);}catch(ignored){return result('status','blocked',['INPUT_INVALID']);}
    try{const snapshot=await inspect(transport(connection)),device=steps.device(snapshot);
      const extra={device,capture:{verified:false,active:null,reason:'not-checked'},lights:{verified:false,active:null,reason:'not-checked'}};
      if(activeTarget&&sameTarget(activeTarget.connection,connection)){
        extra.recovery={phase:'inflight',pending:true};if(activeTarget.backupId)extra.backupId=activeTarget.backupId;
        return result('status','partial',['RECOVERY_PENDING'],extra);
      }
      const prior=recovery(connection);if(prior){extra.backupId=prior.id;extra.recovery={phase:prior.phase,pending:['prepared','unconfirmed','restoring'].includes(prior.phase)};}
      const terminalCodes=prior&&prior.phase==='restored'?(prior.finalCodes||[]).filter(code=>['APPS_REINSTALL_MANUAL','PACKAGE_RESTORE_MANUAL'].includes(code)):
        prior&&prior.phase==='applied'&&prior.options.home?['HOME_RUNTIME_UNVERIFIED']:[];
      return result('status',extra.recovery&&extra.recovery.pending?'partial':device.supported?'ready':'blocked',
        extra.recovery&&extra.recovery.pending?['RECOVERY_PENDING']:device.supported?terminalCodes:['PROFILE_UNSUPPORTED'],extra);
    }catch(ignored){return result('status','blocked',['CONNECTION_UNCONFIRMED'],{device:steps.device(null)});}
  }
  async function plan(payload) {
    let connection,opts;try{connection=config(payload);opts=options(payload.options);}catch(error){return result('plan','blocked',[['OPTIONS_INVALID','REMOVAL_NOT_ALLOWED'].includes(error.message)?error.message:'INPUT_INVALID']);}
    for(const [key,value] of plans)if(value.expiresAt<now())plans.delete(key);
    if(plans.size>=20)return result('plan','blocked',['PLAN_LIMIT']);
    try{const prior=recovery(connection);if(prior&&['prepared','unconfirmed','restoring'].includes(prior.phase))return result('plan','blocked',['RECOVERY_PENDING'],{backupId:prior.id});
      const snapshot=await inspect(transport(connection)),device=steps.device(snapshot),blocked=preflight(snapshot,opts);
      if(blocked)return result('plan','blocked',[blocked],{device});
      if(!opts.install&&!opts.home&&!opts.privacy&&!opts.removeApps.length)return result('plan','blocked',['OPTIONS_EMPTY'],{device});
      const key=id(),expiresAt=now()+300000;
      plans.set(key,{connection,options:opts,snapshot,fingerprint:steps.fingerprint(snapshot),expiresAt});
      return result('plan','planned',[],{plan:{id:key,expiresAt},device,steps:stepList(opts,snapshot)});
    }catch(ignored){return result('plan','blocked',['CONNECTION_UNCONFIRMED'],{device:steps.device(null)});}
  }
  async function apply(payload) {
    if(!object(payload)||Object.keys(payload).join(',')!=='planId'||!ID.test(payload.planId||''))return result('apply','blocked',['PLAN_REQUIRED']);
    const p=plans.get(payload.planId);if(!p)return result('apply','blocked',['PLAN_UNKNOWN']);plans.delete(payload.planId);
    if(now()>p.expiresAt)return result('apply','blocked',['PLAN_EXPIRED']);
    activeTarget={connection:p.connection};
    const prior=recovery(p.connection);if(prior&&['prepared','unconfirmed','restoring'].includes(prior.phase))return result('apply','blocked',['RECOVERY_PENDING'],{backupId:prior.id});
    const t=transport(p.connection);let current;
    try{current=await inspect(t);}catch(ignored){return result('apply','blocked',['REVALIDATION_FAILED']);}
    if(steps.fingerprint(current)!==p.fingerprint)return result('apply','blocked',['STATE_CHANGED']);
    const blocked=preflight(current,p.options);if(blocked)return result('apply','blocked',[blocked]);
    const backupId=id(),record={version:1,id:backupId,createdAt:now(),config:p.connection,options:p.options,phase:'prepared',removed:[],
      removalCandidates:p.snapshot.apps.filter(app=>p.options.removeApps.includes(app.id)).map(app=>app.id),
      packageInstalled:false,packageInstallAttempted:false,homeHooksAttempted:false,privacyHooksAttempted:false};
    const list=stepList(p.options,p.snapshot,'complete');
    try{writeJournal(record,true);}catch(ignored){return result('apply','blocked',['JOURNAL_UNSAFE']);}
    activeTarget.backupId=backupId;
    try{
      if(p.options.install&&!current.app){
        const prepared=await remote(t,{action:'prepare',backupId,expected:steps.fingerprint(current),options:p.options});if(!prepared.ok)throw Error('prepare');
        record.packageInstallAttempted=true;writeJournal(record,false);
        const install=await (deps.installPackage||require('./install-package.cjs').installPackage)(t,{backupId,expectedInstalledVersion:null});
        if(!['complete','skipped'].includes(install.status))throw Error('install');
        record.packageInstalled=install.installedByThisPlan===true;writeJournal(record,false);current=await inspect(t);
        const original=Object.assign({},p.snapshot,{app:current.app});if(steps.fingerprint(original)!==steps.fingerprint(current))throw Error('drift');
      }
      const applied=await remote(t,{action:'apply',backupId,expected:steps.fingerprint(current),options:p.options});if(!applied.ok)throw Error('apply');
      record.removed=(applied.removed||[]).filter(app=>p.options.removeApps.includes(app));
      if(p.options.privacy){
        record.privacyHooksAttempted=true;writeJournal(record,false);
        const hooks=await (deps.ensurePrivacyHook||require('./privacy-hook.cjs').ensurePrivacyHook)(t,{backupId,previous:p.snapshot.rdxd});
        if(!['complete','skipped'].includes(hooks.status))throw Error('privacy-hook');record.privacyReceipt=hooks.receipt;
      }
      if(p.options.home){
        record.homeHooksAttempted=true;writeJournal(record,false);
        const hooks=await (deps.ensureHomeHooks||require('./home-hooks.cjs').ensureHomeHooks)(t,{backupId,previousHome:p.snapshot.general.defaultApps.home});
        if(!['complete','skipped'].includes(hooks.status))throw Error('hooks');record.homeReceipt=hooks.receipt;
      }
      record.phase='applied';writeJournal(record,false);
      return result('apply',p.options.home?'partial':'complete',p.options.home?['HOME_RUNTIME_UNVERIFIED']:[],{backupId,steps:list});
    }catch(ignored){record.phase='unconfirmed';try{writeJournal(record,false);}catch(unused){}return result('apply','partial',['APPLY_UNCONFIRMED'],{backupId,steps:list.map(item=>Object.assign({},item,{status:item.status==='skipped'?'skipped':'failed'}))});}
  }
  async function restore(payload) {
    if(!object(payload)||Object.keys(payload).join(',')!=='backupId'||!ID.test(payload.backupId||''))return result('restore','blocked',['BACKUP_REQUIRED']);
    let record;try{record=readJournal(payload.backupId);}catch(ignored){return result('restore','blocked',['BACKUP_UNAVAILABLE']);}
    activeTarget={connection:record.config,backupId:record.id};
    try{
      const t=transport(record.config),current=await inspect(t);if(!steps.supported(current)||current.uid!==0)return result('restore','blocked',['RESTORE_IDENTITY_UNCONFIRMED']);
      record.phase='restoring';writeJournal(record,false);
      if(record.privacyHooksAttempted){const hooks=await (deps.restorePrivacyHook||require('./privacy-hook.cjs').restorePrivacyHook)(t,{backupId:record.id,receipt:record.privacyReceipt});if(!['complete','skipped'].includes(hooks.status))throw Error('privacy-hook');}
      const restored=await remote(t,{action:'restore',backupId:record.id});if(!restored.ok)throw Error('restore');
      if(record.homeHooksAttempted){const hooks=await (deps.restoreHomeHooks||require('./home-hooks.cjs').restoreHomeHooks)(t,{backupId:record.id,receipt:record.homeReceipt});if(!['complete','skipped'].includes(hooks.status))throw Error('hooks');}
      const codes=[];if(record.removed.length||(record.removalCandidates||[]).some(id=>!current.apps.some(app=>app.id===id)))codes.push('APPS_REINSTALL_MANUAL');if(record.packageInstalled||record.packageInstallAttempted&&current.app)codes.push('PACKAGE_RESTORE_MANUAL');
      record.phase='restored';record.finalCodes=codes;writeJournal(record,false);return result('restore',codes.length?'partial':'complete',codes,{backupId:record.id});
    }catch(ignored){record.phase='unconfirmed';try{writeJournal(record,false);}catch(unused){}return result('restore','partial',['RESTORE_UNCONFIRMED'],{backupId:record.id});}
  }
  async function runAction(action,payload) {
    if(!ACTIONS.includes(action))return result(String(action).slice(0,16),'blocked',['ACTION_INVALID']);
    if(mutating&&!READ_ACTIONS.includes(action))return result(action,'blocked',['BUSY']);
    if(FEATURE_ACTIONS.includes(action)){
      const mutation=MUTATING_ACTIONS.includes(action);if(mutation)mutating=true;
      try{return await features.runAction(action,payload);}catch(ignored){return result(action,'blocked',['ACTION_FAILED']);}
      finally{if(mutation)mutating=false;}
    }
    if(action==='status')return status(payload);if(action==='plan')return plan(payload);
    mutating=true;try{return await (action==='apply'?apply(payload):restore(payload));}catch(ignored){return result(action,'blocked',['ACTION_FAILED']);}finally{mutating=false;activeTarget=null;}
  }
  return {runAction};
}
const defaultEngine=createEngine();
module.exports={runAction:defaultEngine.runAction,createEngine};
