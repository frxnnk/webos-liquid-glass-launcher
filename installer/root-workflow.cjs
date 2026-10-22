'use strict';
const crypto=require('node:crypto');
const inspect=require('./root-inspect.cjs');
const {supported}=require('./steps.cjs');
const runtime=require('./root-runtime.cjs');
function createRootWorkflow(deps={}) {
  const controller=deps.assess?null:require('./root-controller.cjs').createRootController();
  const assess=deps.assess||((config,context)=>controller.assess(config,context)),plans=new Map(),pending=new Map(),now=deps.now||Date.now,storage={directory:deps.rootJournalDir};
  const save=deps.record||(value=>runtime.record(value,storage)),makeTransport=deps.createTransport||require('./root-controller.cjs').createProbeTransport;
  const recover=deps.recovery||(deps.record?async()=>null:(config,id)=>runtime.recovery(config,{...storage,ignoreReservation:id}));
  const acquire=deps.reserve||((config,request)=>runtime.reserve(config,{...storage,...request})),release=deps.releaseReservation||(lease=>runtime.releaseReservation(lease,storage));
  let busy=false;
  function result(action,status,codes=[],extra={}){return {ok:['complete','planned','skipped'].includes(status),action,status,codes,steps:[],stockValidated:false,...extra};}
  function target(config){return config.host;}
  function skip(action,checked){return result(action,checked.rootRecovery?'partial':'skipped',checked.rootRecovery?['ROOT_ALREADY_PRESENT','ROOT_RECOVERY_PENDING']:['ROOT_ALREADY_PRESENT'],{
    root:checked.root,developerMode:checked.developerMode,...(checked.rootRecovery?{rootRecovery:checked.rootRecovery}:{}),
    summary:checked.rootRecovery?'La TV tiene root, con una operación pendiente de revisar. No se repite la cadena.':'La TV ya tiene root. Se omite la cadena de root.'});}
  function eligibility(checked){
    if(!checked||!checked.root||checked.root.active!==null||!checked.developerMode||checked.developerMode.reachable!==true)return 'DEVMODE_UNCONFIRMED';
    if(checked.developerMode.signature!==true||checked.developerMode.stockHash!==true)return 'DEVMODE_SIGNATURE_INVALID';
    if(checked.developerMode.token!=='regular')return 'DEVMODE_TOKEN_INVALID';
    if(!checked.rootArtifacts||!['hbcApp','hbcService','startup'].every(key=>checked.rootArtifacts[key]==='absent'))return 'EXISTING_ROOT_RECOVERY_REQUIRED';
    if(!Array.isArray(checked.codes)||checked.codes.some(code=>code!=='ROOT_BOOTSTRAP_NOT_VALIDATED'))return 'ROOT_PRECHECK_UNCONFIRMED';
    return null;
  }
  async function verifyTemporaryRoot(config){
    const output=await makeTransport({...config,port:2222,user:'root'}).runRemote(inspect.script(),{timeoutMs:15000});
    let evidence;try{evidence=JSON.parse(output.stdout);}catch{throw Error('ROOT_TEMPORARY_LOGIN_UNCONFIRMED');}
    if(!evidence||evidence.ok!==true||evidence.uid!==0||!supported(evidence)||evidence.devmode.signature!==true||evidence.devmode.stockHash!==true||evidence.devmode.token!=='regular')throw Error('ROOT_TEMPORARY_LOGIN_UNCONFIRMED');
  }
  async function plan(config){
    if(busy)return result('root-plan','blocked',['BUSY']);
    const checked=await assess(config);if(checked.root&&checked.root.active===true)return skip('root-plan',checked);
    if(checked.rootRecovery)return result('root-plan','blocked',['ROOT_RECOVERY_PENDING'],{rootRecovery:checked.rootRecovery});
    const reason=eligibility(checked);if(reason)return result('root-plan','blocked',[reason],{root:checked.root,developerMode:checked.developerMode});
    let prior;try{prior=pending.get(target(config))||await recover(config);}catch{return result('root-plan','blocked',['ROOT_JOURNAL_UNSAFE']);}
    if(prior)return result('root-plan','blocked',['ROOT_RECOVERY_PENDING'],{backupId:prior.id,recovery:{phase:prior.phase,pending:true}});
    for(const [id,entry]of plans)if(entry.expiresAt<now())plans.delete(id);if(plans.size>=20)return result('root-plan','blocked',['PLAN_LIMIT']);
    const id=crypto.randomBytes(16).toString('hex'),expiresAt=now()+300000;
    plans.set(id,{config:{host:config.host,identity:config.identity},checked:JSON.stringify(checked),expiresAt});
    return result('root-plan','planned',['EXPERIMENTAL_STOCK_FLOW','PHYSICAL_BOOT_UNVERIFIED'],{plan:{id,expiresAt},root:checked.root,developerMode:checked.developerMode,
      summary:'Plan experimental para este modelo. Conserva Developer Mode y verifica cada etapa; el arranque físico sigue pendiente.',steps:[
        {id:'source',label:'Comprobar fuentes fijadas y derivar solo la clave pública',status:'planned'},
        {id:'temporary-root',label:'Bootstrap propio y verificar SSH root temporal',status:'planned'},
        {id:'devmode',label:'Verificar y preservar firma y sesión de Developer Mode',status:'planned'},
        {id:'hbc',label:'Respaldar, instalar HBC 0.7.3 y configurar SSH por clave',status:'planned'},
        {id:'postcheck',label:'Verificar root 22, Developer Mode 9922 y actividad de arranque',status:'planned'}]});
  }
  async function apply(payload){
    if(busy)return result('root-apply','blocked',['BUSY']);
    if(!payload||Object.keys(payload).join(',')!=='planId'||!/^[a-f0-9]{32}$/.test(payload.planId||''))return result('root-apply','blocked',['PLAN_REQUIRED']);
    const plan=plans.get(payload.planId);plans.delete(payload.planId);if(!plan)return result('root-apply','blocked',['PLAN_UNKNOWN']);
    if(now()>plan.expiresAt)return result('root-apply','blocked',['PLAN_EXPIRED']);busy=true;
    const id=crypto.randomBytes(16).toString('hex');let changed=false,lease=null,retain=false,record={version:1,id,config:plan.config,phase:'prepared',createdAt:now()};
    try{
      const checked=await assess(plan.config);if(checked.root&&checked.root.active===true)return skip('root-apply',checked);
      if(checked.rootRecovery)return result('root-apply','blocked',['ROOT_RECOVERY_PENDING'],{rootRecovery:checked.rootRecovery});
      const reason=eligibility(checked);if(reason||JSON.stringify(checked)!==plan.checked)return result('root-apply','blocked',[reason||'STATE_CHANGED']);
      lease=await acquire(plan.config,{id});
      const prior=await recover(plan.config,id);if(prior){retain=true;return result('root-apply','blocked',['ROOT_RECOVERY_PENDING'],{backupId:prior.id,recovery:{phase:prior.phase,pending:true}});}
      const current=await assess(plan.config,{ignoreReservation:id});if(current.root&&current.root.active===true)return skip('root-apply',current);
      const blocked=eligibility(current);if(blocked||JSON.stringify(current)!==plan.checked)return result('root-apply','blocked',[blocked||'STATE_CHANGED']);
      const sources=await(deps.loadSources||require('./root-sources.cjs').loadSources)();
      const publicKey=await(deps.derivePublicKey||runtime.derivePublicKey)(plan.config),localIp=await(deps.routeIp||runtime.routeIp)(plan.config);
      await save(record);pending.set(target(plan.config),record);
      record.phase='bootstrap-started';await save(record);changed=true;
      await(deps.runBootstrap||runtime.runBootstrap)({id,...plan.config,publicKey,localIp,journalDir:deps.rootJournalDir},sources);
      await(deps.verifyTemporaryRoot||verifyTemporaryRoot)(plan.config);
      record.phase='temporary-root-verified';await save(record);
      const transport=makeTransport({...plan.config,port:2222,user:'root'});
      await(deps.repairDeveloperMode||require('./root-repair.cjs').repairDeveloperMode)(transport,{backupId:id});
      record.phase='hbc-started';await save(record);
      await(deps.provisionHbc||require('./root-hbc.cjs').provisionHbc)(transport,{backupId:id,bytes:sources.ipk});
      const verified=deps.verifyFinal?await deps.verifyFinal(plan.config):await assess(plan.config).then(value=>value.root.active===true&&value.developerMode.reachable===true&&value.developerMode.signature===true&&value.developerMode.stockHash===true&&value.developerMode.token==='regular');
      if(!verified)throw Error('ROOT_FINAL_CHECK_UNCONFIRMED');
      await(deps.releaseProvisioningHold||require('./root-hbc.cjs').releaseProvisioningHold)(makeTransport({...plan.config,port:22,user:'root'}),{backupId:id});
      record.phase='complete';record.physicalBootPending=true;await save(record);pending.delete(target(plan.config));
      await release(lease);lease=null;
      return result('root-apply','partial',['PHYSICAL_BOOT_UNVERIFIED','STOCK_FLOW_NOT_HARDWARE_VALIDATED'],{backupId:id,root:{active:true,action:'provisioned'},developerMode:{reachable:true,signature:true,stockHash:true,token:'regular'},physicalBootPending:true,summary:'Root por clave y Developer Mode verificados. Falta comprobar un arranque físico.'});
    }catch(error){
      if(error.message==='ROOT_RESERVATION_HELD')return result('root-apply','blocked',['ROOT_RECOVERY_PENDING']);
      if(changed){record.phase='unconfirmed';try{await save(record);}catch{}pending.set(target(plan.config),record);return result('root-apply','partial',['ROOT_APPLY_UNCONFIRMED'],{backupId:id,root:{active:null,action:'recover'},recovery:{phase:'unconfirmed',pending:true},summary:'La cadena se detuvo. Conservar el respaldo y revisar acceso y huellas SSH antes de continuar.'});}
      return result('root-apply','blocked',['ROOT_PREPARATION_FAILED']);
    }finally{if(lease&&!changed&&!retain)try{await release(lease);}catch{}busy=false;}
  }
  return {plan,apply};
}
module.exports={createRootWorkflow};
