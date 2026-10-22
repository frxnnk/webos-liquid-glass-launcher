'use strict';
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');

// Only directory metadata and our journal JSON are read. Private-key bytes are never opened.
function findIdentities(options={}) {
  const disk=options.fs||fs,home=options.home||os.homedir(),found=[],seen=new Set();
  function regular(file,max) {
    try{const s=disk.lstatSync(file);return s.isFile()&&!s.isSymbolicLink()&&s.nlink===1&&s.size>0&&s.size<=max;}catch{return false;}
  }
  function names(directory) {
    try{const s=disk.lstatSync(directory);if(!s.isDirectory()||s.isSymbolicLink())return[];
      const list=disk.readdirSync(directory);return list.length<=2000?list:[];}catch{return[];}
  }
  function add(file,source) {
    if(typeof file!=='string'||file.length>4096||!path.isAbsolute(file)||/[\x00-\x1f\x7f]/.test(file))return;
    const normalized=path.resolve(file),key=process.platform==='win32'?normalized.toLowerCase():normalized;
    if(seen.has(key)||!regular(normalized,65536)||found.length>=20)return;
    seen.add(key);found.push({path:normalized,label:path.basename(normalized),source});
  }
  const journals=path.join(home,'.mi-pantalla-installer');
  for(const name of names(journals).filter(n=>/^[a-f0-9]{32}\.json$/.test(n)).slice(0,100)) {
    const file=path.join(journals,name);if(!regular(file,524288))continue;
    try{const record=JSON.parse(disk.readFileSync(file,'utf8'));
      if(record.version===1&&record.id===name.slice(0,32)&&record.config)add(record.config.identity,'previous');}catch{}
  }
  const ssh=path.join(home,'.ssh');
  for(const name of names(ssh).filter(n=>n==='webos'||/^[A-Za-z0-9._-]{1,128}_webos$/i.test(n)))add(path.join(ssh,name),'webos');
  return {ok:true,action:'identities',status:'ready',summary:found.length?'Elegí una clave para comprobar la conexión.':'No encontré claves webOS. Podés ingresar la ruta manualmente.',identities:found,steps:[],codes:[]};
}
module.exports={findIdentities};
