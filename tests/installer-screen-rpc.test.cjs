'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {wrapTvExecFile}=require('../installer/steps.cjs');
test('capture compatibility shim keeps commands and payload exclusively in argv',()=>{
  const calls=[],callback=()=>{},handle={pid:123};
  const cp={execFile(command,args,options,done){calls.push({command,args,options,done});return handle;}};
  const original=['-n','1','-f','-a','com.frxn.mipantalla','luna://com.frxn.mipantalla.lights/getState',JSON.stringify({ids:['wiz-000000000001'],literal:'$(touch /tmp/no); " \' `'})];
  const wrapped=wrapTvExecFile(cp,{LD_PRELOAD:'inherited',KEEP:'yes'},true);
  assert.equal(wrapped('/usr/bin/luna-send',original,{encoding:'utf8',timeout:6000,maxBuffer:2097152,killSignal:'SIGKILL'},callback),handle);
  assert.equal(calls.length,1);assert.equal(calls[0].command,'/bin/sh');
  assert.deepEqual(calls[0].args,['-c','exec "$@"','mp-capture','/usr/bin/luna-send',...original]);
  assert.equal(calls[0].args[1],'exec "$@"');assert.equal(calls[0].options.timeout,6000);assert.equal(calls[0].options.maxBuffer,2097152);
  assert.equal(calls[0].options.killSignal,'SIGKILL');assert.equal(calls[0].options.encoding,'utf8');assert.equal(calls[0].options.env.KEEP,'yes');assert.equal(calls[0].options.env.LD_PRELOAD,'');assert.equal(calls[0].done,callback);
});
test('existing installer RPC stays direct unless the shim is explicitly enabled',()=>{
  const calls=[],options={timeout:2500,maxBuffer:1024,env:{LD_PRELOAD:'remove',PRESERVE:'value'}},args=['-n','1','luna://example/status','{}'];
  const cp={execFile(...call){calls.push(call);}};wrapTvExecFile(cp,{IGNORED:'other'})('/usr/bin/luna-send',args,options,()=>{});
  assert.equal(calls[0][0],'/usr/bin/luna-send');assert.equal(calls[0][1],args);assert.equal(calls[0][2].env.PRESERVE,'value');assert.equal(calls[0][2].env.IGNORED,undefined);assert.equal(options.env.LD_PRELOAD,'remove');assert.equal(calls[0][2].env.LD_PRELOAD,'');
});
test('both capture helpers opt into the proven Node 8 spawn compatibility path',()=>{
  const configure=require('../installer/screen-configure.cjs').configureScript({});
  const status=require('../installer/screen-remote.cjs').script('status');
  assert.match(configure,/\)\(cp,process\.env,true\)/);assert.match(status,/\)\(cp,process\.env,true\)/);
});
