'use strict';
function blocked(action,code){return{ok:false,action,status:'blocked',summary:'No se pudo confirmar esta operación.',codes:[code],steps:[]};}
function createFeatures(deps={}){
  let screen,root;
  async function runAction(action,payload){
    if(!payload||typeof payload!=='object'||Array.isArray(payload))return blocked(action,'INPUT_INVALID');
    if(action==='identities'){
      if(Object.keys(payload).length)return blocked(action,'INPUT_INVALID');
      return (deps.findIdentities||require('./identities.cjs').findIdentities)();
    }
    if(action.startsWith('screen')){
      const method={screenStatus:'status',screenPrepare:'prepare',screenStart:'start',screenStop:'stop'}[action];
      if(!method)return blocked(action,'ACTION_INVALID');
      screen=screen||deps.screenController||require('./screen-controller.cjs').createScreenController({createTransport:deps.createTransport});
      return screen[method](payload);
    }
    root=root||deps.rootController||require('./root-controller.cjs').createRootController({createTransport:deps.createTransport});
    if(action==='rootStatus'){
      const value=await root.assess(payload),active=value.root&&value.root.active;
      return Object.assign({},value,{action,steps:[],root:Object.assign({},value.root,{verified:active===true}),
        summary:active===true?'Esta TV ya tiene root. No hace falta repetirlo.':'Revisá los requisitos de root para este modelo.'});
    }
    const method=action==='rootPlan'?'plan':action==='rootApply'?'apply':null;
    if(!method||typeof root[method]!=='function')return blocked(action,'ROOT_AUTOMATION_PENDING');
    return root[method](payload);
  }
  return {runAction};
}
module.exports={createFeatures};
