'use strict';
const crypto=require('node:crypto');
const PINS=Object.freeze({
  slopbro:Object.freeze({commit:'21023d56ca424607bb03d2939609cc658c655fc7',license:'AGPL-3.0-or-later'}),
  hbc:Object.freeze({commit:'92fcf9fef7ce08dbeae3b0616df8d0c75c11f0b3',version:'0.7.3'}),
  ipk:Object.freeze({sha256:'d10bf3c753551d7c72fb7a92b20fcd2317e502a220ac668ba8e76f6ea78b363c'})
});
const slop='https://raw.githubusercontent.com/throwaway96/slopbro/'+PINS.slopbro.commit+'/';
const hbc='https://raw.githubusercontent.com/webosbrew/webos-homebrew-channel/'+PINS.hbc.commit+'/';
const SOURCES=Object.freeze({
  client:{url:slop+'slopbro.py',sha256:'1a64f7050b3682ab1ac50a3e2998946a93c07abba0dffca0c4b8afc77403d75f'},
  page:{url:slop+'wwwroot/index.html',sha256:'0430d93c45885de73ba5f3e2f32b1e4ef9e713234de818162f0cb8ac20a1ff36'},
  package:{url:slop+'wwwroot/package.json',sha256:'f573657cb5db54fd8b0f724ae69d8f8fd6903ec6ca0f038ce2b47e4f45ef1ef0'},
  license:{url:slop+'COPYING',sha256:'0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0'},
  dropbear:{url:hbc+'services/bin/dropbear',sha256:'8f5b03abd1075b843eba4b204de380cd30f7cb2940090f7c13276b54aab70f20'},
  ipk:{url:'https://github.com/webosbrew/webos-homebrew-channel/releases/download/v0.7.3/org.webosbrew.hbchannel_0.7.3_all.ipk',sha256:PINS.ipk.sha256}
});
function verifySource(name,bytes) {
  const pin=SOURCES[name];if(!pin||!Buffer.isBuffer(bytes)||bytes.length>16*1024*1024||crypto.createHash('sha256').update(bytes).digest('hex')!==pin.sha256)throw Error('SOURCE_HASH_MISMATCH');
  return true;
}
async function loadSources(deps={}) {
  const entries=await Promise.all(Object.entries(SOURCES).map(async([name,pin])=>{
    const response=await(deps.fetch||fetch)(pin.url,{signal:AbortSignal.timeout(20000)});
    if(!response.ok||!response.body)throw Error('ROOT_SOURCE_DOWNLOAD_FAILED');
    const chunks=[];let size=0;for await(const bytes of response.body){size+=bytes.length;if(size>16*1024*1024)throw Error('ROOT_SOURCE_TOO_LARGE');chunks.push(Buffer.from(bytes));}
    const bytes=Buffer.concat(chunks);verifySource(name,bytes);return [name,bytes];
  }));
  return Object.fromEntries(entries);
}
module.exports={PINS,SOURCES,verifySource,loadSources};
