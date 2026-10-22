'use strict';
// Serialized for the TV's Node 8. Never returns lamp addresses, IDs or tokens.
async function remoteScreen(request, deps) {
  var fs=deps.fs, path='/media/developer/apps/usr/palm/services/com.frxn.mipantalla.lights';
  function object(v){return v!==null&&typeof v==='object'&&!Array.isArray(v);}
  function read(file,limit){
    try{var s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>limit)throw Error('unsafe');
      var fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
      try{var actual=fs.fstatSync(fd);if(actual.ino!==s.ino||actual.dev!==s.dev)throw Error('changed');return fs.readFileSync(fd,'utf8');}finally{fs.closeSync(fd);}
    }catch(e){if(e.code==='ENOENT')return null;throw e;}
  }
  function rpc(uri,payload,app){return new Promise(function(resolve,reject){
    var args=['-n','1','-f'];if(app)args.push('-a','com.frxn.mipantalla');args.push(uri,JSON.stringify(payload));
    deps.execFile('/usr/bin/luna-send',args,{encoding:'utf8',timeout:12000,maxBuffer:2097152},function(error,out){
      try{if(error)throw error;var v=JSON.parse(String(out));if(!object(v)||v.returnValue!==true)throw Error('rpc');resolve(v);}catch(e){reject(Error('SCREEN_RPC_UNCONFIRMED'));}
    });
  });}
  function selection(){
    var raw=read('/media/developer/apps/usr/palm/applications/com.frxn.mipantalla/lights-config.js',16384);
    if(raw===null)throw Error('SCREEN_SELECTION_REQUIRED');
    var match=/window\.LAUNCHER_LIGHTS\s*=\s*(\{[\s\S]*\})\s*;?\s*$/.exec(raw);
    if(!match)throw Error('SCREEN_SELECTION_INVALID');
    var value=JSON.parse(match[1]),ids=value&&value.selectedIds;
    if(!Array.isArray(ids)||ids.length!==6||ids.some(function(id,i){return typeof id!=='string'||!/^wiz-[a-f0-9]{12}$/.test(id)||ids.indexOf(id)!==i;}))throw Error('SCREEN_SELECTION_INVALID');
    return ids;
  }
  function restoreSelection(){
    var raw=read('/media/internal/mi-pantalla-lights/screen-session.json',32768);
    if(raw!==null){var record=JSON.parse(raw),ids=record&&record.ids;
      if(!object(record)||['prepared','active','restoring'].indexOf(record.phase)===-1||!Array.isArray(ids)||!ids.length||ids.length>32||ids.some(function(id,i){return typeof id!=='string'||!/^wiz-[a-f0-9]{12}$/.test(id)||ids.indexOf(id)!==i;}))throw Error('SCREEN_RECOVERY_INVALID');
      return ids;
    }
    try{return selection();}catch(ignored){return [];}
  }
  try{
    if(deps.getuid()!==0)throw Error('SCREEN_ROOT_REQUIRED');
    var system=await rpc('luna://com.webos.service.tv.systemproperty/getSystemInfo',{keys:['modelName','firmwareVersion','sdkVersion','boardType']});
    if(system.modelName!=='49UN7310PSC'||system.firmwareVersion!=='04.64.00'||system.sdkVersion!=='5.6.2'||system.boardType!=='K6LP_ATSC_BR')throw Error('SCREEN_PROFILE_UNSUPPORTED');
    if(read('/etc/starfish-release',4096)!=='Rockhopper release 5.6.2-21 (jhericurl-jimna)\n')throw Error('SCREEN_PROFILE_UNSUPPORTED');
    var apps=(await rpc('luna://com.webos.applicationManager/listApps',{})).apps;
    if(!Array.isArray(apps)||apps.length>1000)throw Error('SCREEN_INVENTORY_INVALID');
    var seen={};apps.forEach(function(a){if(!object(a)||typeof a.id!=='string'||seen[a.id])throw Error('SCREEN_INVENTORY_INVALID');seen[a.id]=true;});
    var pins=[['org.webosbrew.piccap','0.5.3','piccap'],['org.webosbrew.hyperhdr.loader','22.0.1','hyperhdr']];
    var missing=[],conflicts=[];
    pins.forEach(function(pin){var app=apps.filter(function(a){return a.id===pin[0];})[0];if(!app)missing.push(pin[2]);else if(app.version!==pin[1])conflicts.push(pin[2]);});
    var config=read(path+'/screen-config.json',8192);
    if(config===null)missing.push('screen-config');
    if(request.action==='status'&&(missing.length||conflicts.length)){
      var recovery=read('/media/internal/mi-pantalla-lights/screen-session.json',32768),pending=false;
      if(recovery!==null){var record=JSON.parse(recovery);if(!object(record)||['prepared','active','restoring'].indexOf(record.phase)===-1)throw Error('SCREEN_RECOVERY_INVALID');pending=true;}
      deps.output({ok:true,verified:true,missing:missing,conflicts:conflicts,configured:false,ready:false,active:null,pending:pending,reason:conflicts.length?'version-conflict':'setup-pending'});return;
    }
    if(request.action!=='stop'&&(missing.length||conflicts.length))throw Error('SCREEN_SETUP_REQUIRED');
    var ids=request.action==='stop'?restoreSelection():selection();
    if(request.action==='start')await rpc('luna://com.frxn.mipantalla.lights/setMode',{mode:'screen',source:'screen',ids:ids},true);
    else if(request.action==='stop')await rpc('luna://com.frxn.mipantalla.lights/setMode',{mode:'manual'},true);
    else if(request.action!=='status')throw Error('SCREEN_ACTION_INVALID');
    var status=await rpc('luna://com.frxn.mipantalla.lights/screenStatus',{ids:ids},true);
    var active=status.pending===true&&status.phase==='active'&&status.outputEnabled===true?true:
      status.pending===false&&status.outputEnabled===false&&status.configVerified===true?false:null;
    deps.output({ok:true,verified:true,missing:[],conflicts:[],configured:status.configured===true,ready:status.ready===true,
      active:active,pending:typeof status.pending==='boolean'?status.pending:null,phase:status.phase||null,
      framesVerified:status.framesVerified===true,hardwareVerified:status.hardwareVerified===true,
      configVerified:status.configVerified===true,lampCount:Number(status.lampCount)||0,reason:typeof status.reason==='string'?status.reason:'unknown'});
  }catch(error){deps.output({ok:false,code:/^SCREEN_[A-Z_]+$/.test(error.message)?error.message:'SCREEN_UNCONFIRMED'});}
}
function script(action){
  if(!['status','start','stop'].includes(action))throw Error('SCREEN_ACTION_INVALID');
  const wrap=require('./steps.cjs').wrapTvExecFile;
  return '/usr/bin/node -e "eval(require(\'fs\').readFileSync(3,\'utf8\'))" </dev/null 3<<\'MP_SCREEN_NODE\'\n'+
    'var cp=require("child_process");var execFile=('+wrap.toString()+')(cp,process.env,true);\n'+
    '('+remoteScreen.toString()+')('+JSON.stringify({action})+',{fs:require("fs"),execFile:execFile,getuid:process.getuid.bind(process),output:function(v){process.stdout.write(JSON.stringify(v)+"\\n");}});\nMP_SCREEN_NODE\n';
}
module.exports={remoteScreen,script};
