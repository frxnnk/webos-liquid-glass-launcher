'use strict';
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const steps=require('./steps.cjs');
const inspect=require('./root-inspect.cjs');

function connection(payload) {
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).some(key=>!['host','identity'].includes(key)))throw Error('INPUT_INVALID');
  const host=payload.host,parts=typeof host==='string'&&host.split('.');
  if(!parts||parts.length!==4||parts.some(p=>! /^(?:0|[1-9]\d{0,2})$/.test(p)||+p>255))throw Error('INPUT_INVALID');
  const [a,b]=parts.map(Number);if(!(a===10||a===172&&b>=16&&b<=31||a===192&&b===168))throw Error('INPUT_INVALID');
  if(typeof payload.identity!=='string'||!path.isAbsolute(payload.identity)||/[\x00-\x1f\x7f]/.test(payload.identity)||payload.identity.length>4096)throw Error('INPUT_INVALID');
  const stat=fs.lstatSync(payload.identity);if(!stat.isFile()||stat.isSymbolicLink())throw Error('INPUT_INVALID');
  return {host,identity:payload.identity};
}
function createProbeTransport(config) {
  // Reuse the bounded, strict-known-host transport; only the fixed Developer
  // Mode endpoint changes its login name from root to prisoner.
  if(!config||![[22,'root'],[2222,'root'],[9922,'prisoner']].some(pair=>pair[0]===config.port&&pair[1]===config.user))throw Error('ROOT_CHANNEL_INVALID');
  const target={host:config.host,identity:config.identity,port:config.port};
  return require('./transport.cjs').createTransport(target,{spawn(command,args,options){
    const fixed=args.slice();fixed[fixed.length-2]=config.user+'@'+config.host;
    return cp.spawn(command,fixed,options);
  }});
}
function evidence(raw,expectedUid) {
  if(!raw||raw.ok!==true||raw.uid!==expectedUid||!raw.devmode||
    ![true,false,null].includes(raw.devmode.signature)||![true,false,null].includes(raw.devmode.stockHash)||
    !['regular','directory','unsafe','absent','unreadable'].includes(raw.devmode.token))throw Error('ROOT_PROBE_UNCONFIRMED');
  if(!steps.supported(raw))throw Error('PROFILE_UNSUPPORTED');
  return raw;
}
function createRootController(deps={}) {
  const makeTransport=deps.createTransport||createProbeTransport;
  let workflow;
  async function probe(config,port,user,uid) {
    const answer=await makeTransport({...config,port,user}).runRemote(inspect.script(),{timeoutMs:15000});
    if(typeof answer.stdout!=='string'||Buffer.byteLength(answer.stdout)>65536)throw Error('ROOT_PROBE_UNCONFIRMED');
    return evidence(JSON.parse(answer.stdout),uid);
  }
  async function assess(payload,context={}) {
    const result={ok:false,action:'root-status',status:'blocked',codes:[],root:{active:null,action:'blocked'},developerMode:{reachable:null,signature:null,stockHash:null,token:null},rootArtifacts:null,automaticRoot:{implemented:true,stockValidated:false}};
    let config;try{config=connection(payload);}catch(ignored){result.codes=['INPUT_INVALID'];return result;}
    let root=null,dev=null;
    try{root=await probe(config,22,'root',0);}catch(error){if(error.message==='PROFILE_UNSUPPORTED'){result.codes=['PROFILE_UNSUPPORTED'];return result;}}
    if(root){result.root={active:true,action:'skip'};result.codes.push('ROOT_ALREADY_PRESENT');
      result.developerMode={reachable:null,signature:root.devmode.signature,stockHash:root.devmode.stockHash,token:root.devmode.token,login:'unconfirmed',metadataSource:'root'};}
    try{dev=await probe(config,9922,'prisoner',6536);}catch(error){
      if(error.message==='PROFILE_UNSUPPORTED'){result.codes.push('PROFILE_UNSUPPORTED');return result;}
      result.developerMode.reachable=null;result.developerMode.login='unconfirmed';result.codes.push('DEVMODE_LOGIN_UNCONFIRMED');
    }
    if(dev){
      result.developerMode={reachable:true,signature:dev.devmode.signature,stockHash:dev.devmode.stockHash,token:dev.devmode.token,login:'verified',metadataSource:'developer-mode'};
      if(dev.devmode.signature!==true||dev.devmode.stockHash!==true)result.codes.push('DEVMODE_SIGNATURE_INVALID');
      if(dev.devmode.token!=='regular')result.codes.push('DEVMODE_TOKEN_INVALID');
      if(dev.rootArtifacts&&['hbcApp','hbcService','startup'].every(key=>['regular','directory','unsafe','absent','unreadable'].includes(dev.rootArtifacts[key])))result.rootArtifacts={...dev.rootArtifacts};
    }
    if(!root)result.codes.push('ROOT_BOOTSTRAP_NOT_VALIDATED');
    if(root){result.status=result.codes.length===1?'complete':'partial';result.ok=result.status==='complete';}
    try {
      const prior=await(deps.recovery||require('./root-runtime.cjs').recovery)(config,{directory:deps.rootJournalDir,ignoreReservation:context.ignoreReservation});
      if(prior){result.rootRecovery={backupId:prior.id,phase:prior.phase,pending:true};result.codes.push('ROOT_RECOVERY_PENDING');result.status='partial';result.ok=false;}
    } catch(ignored){result.codes.push('ROOT_JOURNAL_UNSAFE');result.status='partial';result.ok=false;}
    return result;
  }
  function flow(){if(!workflow)workflow=require('./root-workflow.cjs').createRootWorkflow({...deps,assess});return workflow;}
  return {assess,plan:payload=>flow().plan(payload),apply:payload=>flow().apply(payload)};
}
module.exports={createRootController,createProbeTransport};
