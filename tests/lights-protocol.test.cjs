const {test} = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const file = path.join(__dirname, '../services/com.frxn.mipantalla.lights/protocol.js');
const load = () => { assert.ok(fs.existsSync(file), 'WiZ protocol module must exist'); return require(file); };

test('WiZ commands validate values and never accept arbitrary methods or destinations', () => {
  const p = load();
  assert.deepEqual(p.command({on:true, brightness:42, rgb:[0,128,255]}), {state:true,dimming:42,r:0,g:128,b:255});
  assert.deepEqual(p.command({temperature:2700}), {temp:2700});
  for (const state of [{}, {on:1}, {brightness:0}, {brightness:101}, {rgb:[1,2,256]},
    {rgb:[1,2]}, {rgb:[1,NaN,2]}, {temperature:200}, {rgb:[1,2,3],temperature:2700},
    {method:'reboot'}, {ip:'example.org',on:true}]) assert.throws(()=>p.command(state), /inválid|incompatible/i);
});

test('WiZ scenes are bounded alternatives to RGB and white, preserving the observed scene', () => {
  const p = load();
  assert.deepEqual(p.command({on:true,brightness:35,sceneId:6}),{state:true,dimming:35,sceneId:6});
  for (const sceneId of [1,255]) assert.deepEqual(p.command({sceneId}),{sceneId});
  for (const sceneId of [0,-1,256,6.5,'6',null,NaN,Infinity]) assert.throws(()=>p.command({sceneId}));
  assert.throws(()=>p.command({sceneId:6,rgb:[1,2,3]}));
  assert.throws(()=>p.command({sceneId:6,temperature:3000}));
  const pilot={mac:'aabbcc001122',state:true,dimming:35,sceneId:6,r:10,g:20,b:30,temp:3000};
  const ip=[192,168,50,20].join('.');
  assert.deepEqual(p.device(ip,pilot,{}).state,{on:true,brightness:35,rgb:null,temperature:null,sceneId:6});
  assert.deepEqual(p.device(ip,{...pilot,sceneId:0,temp:undefined},{}).state,
    {on:true,brightness:35,rgb:[10,20,30],temperature:null,sceneId:null});
});

test('WiZ unknown values remain unknown and device identity comes from a validated MAC', () => {
  const p = load();
  const ip = [192,168,50,20].join('.');
  const device = p.device(ip, {mac:'aabbcc001122', state:false, dimming:30, r:0,g:0,b:0},
    {mac:'aabbcc001122',moduleName:'ESP01_SHRGB1C_31',roomId:123});
  assert.equal(device.id, 'wiz-aabbcc001122');
  assert.equal(device.name, 'WiZ 001122');
  assert.equal(device.room, '123');
  assert.equal(device.state.on, false);
  assert.deepEqual(device.state.rgb,[0,0,0]);
  assert.equal(device.capabilities.rgb,true);
  assert.equal(p.device(ip, {mac:'aabbcc001122'}, {}).state.on,null);
  assert.equal(p.device(ip, {mac:'not-a-mac'}, {}),null);
  assert.equal(p.device('8.8.8.8', {mac:'aabbcc001122'}, {}),null);
  assert.equal(p.device(ip, {mac:'aabbcc001122'}, {mac:'aabbcc445566'}),null);
  assert.equal(p.device(ip,{mac:'aabbcc001122'},{moduleName:'ESP21_SHTW_01'}).capabilities.temperature,true);
  assert.equal(p.device(ip,{mac:'aabbcc001122'},{moduleName:'ESP05_SHDW_21'}).capabilities.temperature,false);
  assert.equal(p.device(ip,{mac:'aabbcc001122'},{moduleName:'unexpected_RGB_name'}).capabilities.rgb,null);
});

test('WiZ parsing rejects oversize, wrong method, malformed and error packets', () => {
  const p = load();
  const message = {method:'getPilot',result:{mac:'aabbcc001122',state:true}};
  assert.deepEqual(p.parse(Buffer.from(JSON.stringify(message)),'getPilot'), message.result);
  assert.equal(p.parse(Buffer.from(JSON.stringify(message)),'getSystemConfig'),null);
  assert.equal(p.parse(Buffer.from('{broken'),'getPilot'),null);
  assert.equal(p.parse(Buffer.from(' '.repeat(5000)),'getPilot'),null);
  assert.equal(p.parse(Buffer.from('{"method":"getPilot","error":{"code":1}}'),'getPilot'),null);
});
