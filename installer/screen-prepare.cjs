'use strict';
const {installMissing}=require('./screen-packages.cjs');
function elevateScript(){
  return "set -eu\n"+
    "test \"$(id -u)\" = 0\n"+
    "'/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/elevate-service' org.webosbrew.piccap.service\n"+
    "'/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/elevate-service' org.webosbrew.hyperhdr.loader.service\n";
}
async function preparePipeline(transport,options,deps={}){
  if(!options||!Array.isArray(options.missing)||options.missing.some(value=>!['piccap','hyperhdr','screen-config'].includes(value)))throw Error('SCREEN_SETUP_INVALID');
  const result=await(deps.installMissing||installMissing)(transport,options.missing,deps);
  await transport.runRemote(elevateScript(),{timeoutMs:20000});
  await(deps.elevateLightsService||require('./screen-elevate.cjs').elevateLightsService)(transport);
  const configure=deps.configurePipeline||require('./screen-configure.cjs').configurePipeline;
  const configured=await configure(transport,{freshHyperhdr:result.installed.includes('org.webosbrew.hyperhdr.loader'),hardwareConfirmed:options.hardwareConfirmed===true},deps);
  return Object.assign({installed:result.installed},configured);
}
module.exports={preparePipeline,elevateScript};
