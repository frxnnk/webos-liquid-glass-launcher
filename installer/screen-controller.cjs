'use strict';
const remote=require('./screen-remote.cjs');
function normalize(action, observed){
  const verified=observed&&observed.ok===true&&observed.verified===true;
  const active=verified&&typeof observed.active==='boolean'?observed.active:null;
  const pending=verified&&typeof observed.pending==='boolean'?observed.pending:null;
  const available=verified&&observed.ready===true&&observed.framesVerified===true&&observed.hardwareVerified===true&&observed.configVerified===true&&active===false&&pending===false;
  const missing=verified&&Array.isArray(observed.missing)?observed.missing.filter(id=>['piccap','hyperhdr','screen-config'].includes(id)):[];
  let status=verified?'ready':'blocked',codes=[];
  if(!verified)codes=[observed&&/^SCREEN_[A-Z_]+$/.test(observed.code)?observed.code:'SCREEN_UNCONFIRMED'];
  else if(action==='start'){
    status=active===true&&pending===true&&observed.framesVerified===true?'complete':'partial';
    if(status!=='complete')codes=['SCREEN_START_UNCONFIRMED'];
  }else if(action==='stop'){
    status=active===false&&pending===false?'complete':'partial';if(status!=='complete')codes=['SCREEN_RESTORE_PENDING'];
  }else if(!available&&active!==true){status='partial';codes=[missing.length?'SCREEN_SETUP_REQUIRED':pending?'SCREEN_RESTORE_PENDING':'SCREEN_NOT_READY'];}
  return {ok:['ready','complete'].includes(status),action:'screen'+action[0].toUpperCase()+action.slice(1),status,codes,
    summary:action==='start'&&status==='complete'?'Sincronización con video activada.':action==='stop'&&status==='complete'?'Sincronización desactivada y luces restauradas.':missing.length?'Falta preparar la captura en esta TV.':available?'La captura está lista para activarse.':active===true?'Sincronización con video activada.':'La captura necesita revisión.',
    steps:[],capture:{verified,available,missing,reason:verified?observed.reason:'unconfirmed',framesVerified:verified&&observed.framesVerified===true,hardwareVerified:verified&&observed.hardwareVerified===true,configVerified:verified&&observed.configVerified===true},
    lights:{verified,active,pending,lampCount:verified&&Number.isInteger(observed.lampCount)?observed.lampCount:0},
    canPrepare:verified&&(missing.length>0||observed.configured===true&&observed.reason==='auth-required')&&pending===false&&!(observed.conflicts||[]).length,
    canStop:verified&&(active===true||pending===true)};
}
function createScreenController(deps={}){
  const transportFactory=deps.createTransport||require('./transport.cjs').createTransport;
  let busy=false;
  async function call(action,payload){
    const transport=transportFactory({host:payload.host,identity:payload.identity,port:22});
    const response=await transport.runRemote(remote.script(action),{timeoutMs:20000});
    if(typeof response.stdout!=='string'||Buffer.byteLength(response.stdout)>16384)throw Error('SCREEN_UNCONFIRMED');
    return JSON.parse(response.stdout);
  }
  async function execute(action,payload){
    if(action!=='status'&&busy)return normalize(action,{ok:false,code:'SCREEN_BUSY'});
    if(action!=='status')busy=true;
    try{
      if(action==='prepare'){
        const before=normalize('status',await call('status',payload));
        if(!before.canPrepare)return Object.assign(before,{action:'screenPrepare',status:'blocked',ok:false,codes:['SCREEN_PREPARATION_NOT_ALLOWED']});
        const prepare=deps.preparePipeline||require('./screen-prepare.cjs').preparePipeline;
        const transport=transportFactory({host:payload.host,identity:payload.identity,port:22});
        const result=await prepare(transport,{missing:before.capture.missing,hardwareConfirmed:payload.hardwareConfirmed===true});
        const after=normalize('status',await call('status',payload));
        after.action='screenPrepare';after.physicalProofPending=true;
        if(after.capture.missing.length||!after.capture.configVerified){after.ok=false;after.status='partial';after.codes=['SCREEN_PREPARATION_UNCONFIRMED'];}
        else{after.status='complete';after.ok=true;after.codes=after.capture.hardwareVerified?[]:['SCREEN_HARDWARE_CONFIRMATION_REQUIRED'];}
        if(result&&result.backupId)after.backupId=result.backupId;
        return after;
      }
      if(action==='start'){
        const before=normalize('status',await call('status',payload));if(!before.capture.available)return Object.assign(before,{action:'screenStart',status:'blocked',ok:false,codes:['SCREEN_NOT_READY']});
      }
      return normalize(action,await call(action,payload));
    }catch(error){return normalize(action,{ok:false,code:error&&/^SCREEN_[A-Z_]+$/.test(error.message)?error.message:'SCREEN_UNCONFIRMED'});}
    finally{if(action!=='status')busy=false;}
  }
  return {status:payload=>execute('status',payload),prepare:payload=>execute('prepare',payload),start:payload=>execute('start',payload),stop:payload=>execute('stop',payload)};
}
module.exports={createScreenController,normalize};
