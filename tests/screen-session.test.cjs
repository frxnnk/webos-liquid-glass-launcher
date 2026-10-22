const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname, '../services/com.frxn.mipantalla.lights/screen-session.js');
const a = 'wiz-aabbcc001122', b = 'wiz-aabbcc001133';
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
function fixture(options = {}) {
  assert.ok(fs.existsSync(file), 'screen session module must exist');
  const events = [], states = [{id:a, reachable:true, state:{on:true, brightness:41, rgb:[2,4,6]}}];
  let record = clone(options.record || null);
  const store = {load:()=>clone(record), save:value=>{
    events.push(['save', clone(value)]);
    if (options.save) options.save(value);
    record = clone(value);
  }, clear:()=>{events.push(['clear']); record=null;}};
  const backend = {
    inspect:ids=>{events.push(['inspect', ids]); return options.inspect ? options.inspect(ids) :
      {ready:true, hardwareVerified:true, framesVerified:true, configVerified:true, active:false};},
    start:ids=>{events.push(['start', ids]); return options.start ? options.start(ids) : {active:true};},
    stop:ids=>{events.push(['stop', ids]); return options.stop ? options.stop(ids) : {active:false};}
  };
  const delays = [];
  const deps = {backend, store, retryDelayMs:1500, delay:ms=>{delays.push(ms);},
    read:ids=>{events.push(['read', ids]); return options.read ? options.read(ids) : {devices:clone(states)};},
    write:(id, patch)=>{events.push(['write', id, clone(patch)]); return options.write ? options.write(id, patch) : {confirmed:true};}};
  const create = require(file).create;
  return {session:create(deps), restart:()=>create(deps), events, delays, record:()=>clone(record), states};
}

test('status inspects only and requires strictly verified hardware, frames and configuration', async()=>{
  for (const flag of ['ready', 'hardwareVerified', 'framesVerified', 'configVerified']) {
    for (const value of [false, undefined, 1, 'true']) {
      const t=fixture({inspect:()=>({ready:true, hardwareVerified:true, framesVerified:true, configVerified:true,
        active:false, [flag]:value})});
      assert.equal((await t.session.status([a])).ready, false);
      assert.deepEqual(t.events.map(e=>e[0]), ['inspect']);
      await assert.rejects(t.session.start([a]));
      assert.equal(t.events.some(e=>['read','save','start','write'].includes(e[0])), false);
    }
  }
  const t=fixture();
  assert.equal((await t.session.status([a])).ready, true);
  assert.equal(t.session.pending(), null);
});

test('start rejects noncanonical, sparse, duplicate and oversized IDs before any effects', async()=>{
  const t=fixture();
  const sparse=new Array(1);
  for (const ids of [[], sparse, [a,a], ['wiz-AABBCC001122'], ['192.168.1.5'], Array(33).fill(a), null]) {
    await assert.rejects(t.session.start(ids));
  }
  assert.deepEqual(t.events, []);
});

test('baseline must be exact, reachable and restorable before persistence or backend mutation', async()=>{
  for (const devices of [[], [{id:a,reachable:false,state:{on:true,brightness:41,rgb:[2,4,6]}}],
    [{id:a,reachable:true,state:{on:1,brightness:41,rgb:[2,4,6]}}],
    [{id:a,reachable:true,state:{on:true,brightness:0,rgb:[2,4,6]}}],
    [{id:a,reachable:true,state:{on:true,brightness:41}}],
    [{id:a,reachable:true,state:{on:true,brightness:41,rgb:[2,4,6],temperature:3000}}],
    [{id:a,reachable:true,state:{on:true,brightness:41,temperature:2199}}],
    [{id:b,reachable:true,state:{on:true,brightness:41,rgb:[2,4,6]}}]]) {
    const t=fixture({read:()=>({devices})});
    await assert.rejects(t.session.start([a]));
    assert.deepEqual(t.events.map(e=>e[0]), ['inspect','read']);
  }
});

test('start persists a sanitized prepared baseline before backend start and then marks active', async()=>{
  const t=fixture();
  Object.assign(t.states[0], {ip:'192.168.5.2',token:'secret'});
  t.states[0].state.token='private';
  await t.session.start([a]);
  assert.deepEqual(t.events.map(e=>e[0]), ['inspect','read','save','start','save']);
  assert.equal(t.events[2][1].phase, 'prepared');
  assert.deepEqual(t.record(), {phase:'active',ids:[a],devices:[{id:a,state:{on:true,brightness:41,rgb:[2,4,6]}}]});
  const pending=t.session.pending();
  pending.devices[0].state.rgb[0]=200;
  assert.equal(t.session.pending().devices[0].state.rgb[0],2);
  await assert.rejects(t.session.start([a]));
  assert.equal(t.events.filter(e=>e[0]==='start').length,1);
});

test('screen start and stop preserve two scene lamps and four RGB lamps without inventing colors', async()=>{
  const protocol=require('../services/com.frxn.mipantalla.lights/protocol');
  const devices=Array.from({length:6},(_,i)=>protocol.device([192,168,50,20+i].join('.'),
    {mac:'aabbcc00112'+i,state:true,dimming:i<2?35:40+i,sceneId:i<2?6:0,
      ...(i<2?{}:{r:i,g:i+1,b:i+2})},{}));
  const ids=devices.map(d=>d.id), writes=[];
  const t=fixture({read:()=>({devices}),write:(id,state)=>{
    writes.push([id,protocol.command(state)]);return {confirmed:true};}});
  await t.session.start(ids);
  assert.deepEqual(t.record().devices.slice(0,2),ids.slice(0,2).map(id=>({id,state:{on:true,brightness:35,sceneId:6}})));
  await t.restart().stop();
  assert.deepEqual(writes,ids.map((id,i)=>[id,i<2?{state:true,dimming:35,sceneId:6}:
    {state:true,dimming:40+i,r:i,g:i+1,b:i+2}]));
  assert.equal(t.record(),null);
});

test('ambiguous or out-of-range scenes block before baseline persistence or backend mutation', async()=>{
  for (const state of [
    {on:true,brightness:35,sceneId:6,rgb:[1,2,3]},
    {on:true,brightness:35,sceneId:6,temperature:3000},
    ...[0,256,-1,6.5,'6'].map(sceneId=>({on:true,brightness:35,sceneId}))
  ]) {
    const t=fixture({read:()=>({devices:[{id:a,reachable:true,state}]})});
    await assert.rejects(t.session.start([a]),error=>error.code==='SCREEN_BASELINE_INVALID');
    assert.deepEqual(t.events.map(e=>e[0]),['inspect','read']);
  }
});

test('save failure blocks start, while uncertain backend start retains prepared recovery without retries', async()=>{
  const failed=fixture({save:()=>{throw Error('disk failed');}});
  await assert.rejects(failed.session.start([a]),error=>error.code==='SCREEN_PERSIST_FAILED');
  assert.equal(failed.events.some(e=>e[0]==='start'),false);
  for (const start of [()=>{throw Error('unknown start');}, ()=>({active:'true'}), ()=>({active:false})]) {
    const t=fixture({start});
    await assert.rejects(t.session.start([a]));
    assert.equal(t.record().phase,'prepared');
    assert.equal(t.events.filter(e=>e[0]==='start').length,1);
    assert.equal(t.events.some(e=>e[0]==='write'||e[0]==='stop'),false);
    await assert.rejects(t.session.start([a]));
  }
});

test('external active backend rejects start without reading lamps', async()=>{
  const t=fixture({inspect:()=>({ready:true,hardwareVerified:true,framesVerified:true,configVerified:true,active:true})});
  assert.equal((await t.session.status([a])).ready,false);
  await assert.rejects(t.session.start([a]));
  assert.deepEqual(t.events.map(e=>e[0]),['inspect','inspect']);
});

test('stop needs strict stopped confirmation before restoring any lamp', async()=>{
  for (const stop of [()=>{throw Error('stop failed');},()=>({active:0}),()=>({active:true}),()=>({})]) {
    const t=fixture({stop});
    await t.session.start([a]);
    await assert.rejects(t.session.stop());
    assert.equal(t.events.some(e=>e[0]==='write'),false);
    assert.ok(t.session.pending());
    assert.deepEqual(t.events.find(e=>e[0]==='stop')[1],[a]);
  }
});

test('partial restore persists each confirmed lamp and a later stop resumes only failed lamps', async()=>{
  let attempt=0;
  const t=fixture({read:()=>({devices:[
    {id:a,reachable:true,state:{on:true,brightness:42,temperature:3200}},
    {id:b,reachable:true,state:{on:false,brightness:23,rgb:null,temperature:null}}]}),
    write:id=>id===a && ++attempt<=2 ? {confirmed:false} : {confirmed:true}});
  await t.session.start([a,b]);
  await assert.rejects(t.session.stop());
  assert.deepEqual(t.record(),{phase:'restoring',ids:[a,b],devices:[{id:a,state:{on:true,brightness:42,temperature:3200}}]});
  assert.deepEqual(t.events.filter(e=>e[0]==='write').map(e=>e.slice(1)),[
    [a,{on:true,brightness:42,temperature:3200}], [b,{on:false,brightness:23}], [a,{on:true,brightness:42,temperature:3200}]]);
  const resumed=t.restart();
  await resumed.stop();
  assert.deepEqual(t.events.filter(e=>e[0]==='write').map(e=>e[1]),[a,b,a,a]);
  assert.deepEqual(t.events.filter(e=>e[0]==='stop').map(e=>e[1]),[[a,b],[a,b]]);
  assert.equal(t.record(),null);
  assert.equal(resumed.pending(),null);
});

test('write errors continue to other lamps, get one bounded retry pass and keep the baseline', async()=>{
  const t=fixture({read:()=>({devices:[{id:a,reachable:true,state:{on:false,brightness:12,rgb:[0,1,2]}},
    {id:b,reachable:true,state:{on:true,brightness:100,rgb:[255,255,255]}}]}),
    write:id=>{if(id===a)throw Error('unknown write'); return {confirmed:true};}});
  await t.session.start([a,b]);
  await assert.rejects(t.session.stop());
  assert.equal(t.events.filter(e=>e[0]==='write').length,3);
  assert.deepEqual(t.events.filter(e=>e[0]==='write').map(e=>e[1]),[a,b,a]);
  assert.deepEqual(t.record().devices,[{id:a,state:{on:false,brightness:12,rgb:[0,1,2]}}]);
});

test('exclusive operation lock rejects concurrent start and stop before extra effects', async()=>{
  let release;
  const t=fixture({start:()=>new Promise(resolve=>{release=resolve;})});
  const started=t.session.start([a]);
  while (!release) await new Promise(resolve=>setImmediate(resolve));
  await assert.rejects(t.session.start([a]));
  await assert.rejects(t.session.stop());
  assert.equal(t.events.filter(e=>e[0]==='start').length,1);
  assert.equal(t.events.some(e=>e[0]==='stop'),false);
  release({active:true});
  await started;
  await t.session.stop();
  assert.equal(t.session.pending(),null);
});

test('restart recovers prepared baseline only on explicit stop, never construction, status or pending', async()=>{
  const record={phase:'prepared',ids:[a],devices:[{id:a,state:{on:false,brightness:17,temperature:2200}}]};
  const t=fixture({record});
  assert.deepEqual(t.events,[]);
  assert.deepEqual(t.session.pending(),record);
  assert.equal((await t.session.status([a])).ready,false);
  assert.deepEqual(t.events.map(e=>e[0]),['inspect']);
  await t.session.stop();
  assert.deepEqual(t.events.filter(e=>e[0]==='write')[0].slice(1),[a,record.devices[0].state]);
  assert.equal(t.record(),null);
  const count=t.events.length;
  await t.session.stop();
  assert.equal(t.events.length,count);
});

test('status accepts an empty selection and still only inspects', async()=>{
  const t=fixture({inspect:()=>({ready:false,active:false,reason:'selection-required'})});
  assert.equal((await t.session.status([])).ready,false);
  assert.deepEqual(t.events,[['inspect',[]]]);
  assert.equal((await fixture().session.status([])).ready,false,'no selection can never be ready to start');
});

test('corrupt recovery records block every backend mutation and lamp command', async()=>{
  for (const record of [
    {phase:'active',ids:[a],devices:[]},
    {phase:'prepared',ids:[a,a],devices:[{id:a,state:{on:true,brightness:30,temperature:3000}}]},
    {phase:'restoring',ids:[a],devices:[{id:b,state:{on:true,brightness:30,temperature:3000}}]},
    {phase:'restoring',ids:[a],devices:[{id:a,state:{on:true,brightness:30,rgb:[1,2,3],temperature:3000}}]}
  ]) {
    const t=fixture({record});
    await assert.rejects(t.session.start([a]));
    await assert.rejects(t.session.stop());
    assert.deepEqual(t.events,[]);
  }
});

test('a persistence failure after start acknowledgement retains prepared recovery', async()=>{
  const t=fixture({save:value=>{if(value.phase==='active')throw Error('secret error');}});
  await assert.rejects(t.session.start([a]),error=>error.code==='SCREEN_PERSIST_FAILED'&&!error.message.includes('secret'));
  assert.equal(t.record().phase,'prepared');
  assert.equal(t.events.filter(e=>e[0]==='start').length,1);
  assert.equal(t.events.some(e=>e[0]==='write'),false);
  assert.equal(t.events.filter(e=>e[0]==='stop').length,1);
  await t.restart().stop();
  assert.equal(t.record(),null);
});

test('failed persistence of a confirmed restore halts further lamp effects and keeps recovery', async()=>{
  let saves=0;
  const t=fixture({read:()=>({devices:[{id:a,reachable:true,state:{on:true,brightness:33,temperature:3000}},
    {id:b,reachable:true,state:{on:true,brightness:44,temperature:4000}}]}),
    save:()=>{if(++saves===4)throw Error('disk full');}});
  await t.session.start([a,b]);
  await assert.rejects(t.session.stop(),error=>error.code==='SCREEN_PERSIST_FAILED');
  assert.deepEqual(t.events.filter(e=>e[0]==='write').map(e=>e[1]),[a]);
  assert.deepEqual(t.record().devices.map(d=>d.id),[a,b]);
  await t.restart().stop();
  assert.equal(t.record(),null);
});

test('a lamp that misses the first write is confirmed by the single retry pass without needing Manual again', async()=>{
  let attempt=0;
  const t=fixture({read:()=>({devices:[
    {id:a,reachable:true,state:{on:true,brightness:42,temperature:3200}},
    {id:b,reachable:true,state:{on:false,brightness:23,rgb:null,temperature:null}}]}),
    write:id=>id===a && ++attempt===1 ? {confirmed:false} : {confirmed:true}});
  await t.session.start([a,b]);
  await t.session.stop();
  assert.deepEqual(t.events.filter(e=>e[0]==='write').map(e=>e[1]),[a,b,a]);
  assert.deepEqual(t.delays,[1500]);
  assert.equal(t.record(),null);
});

test('no retry wait happens when every lamp is confirmed on the first pass', async()=>{
  const t=fixture();
  await t.session.start([a]);
  await t.session.stop();
  assert.deepEqual(t.delays,[]);
  assert.equal(t.events.filter(e=>e[0]==='write').length,1);
});
