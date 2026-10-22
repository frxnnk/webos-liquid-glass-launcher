const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function harness(count = 24) {
  const listeners = {}, windowListeners = {};
  let scroll = 0, width = 800, gap = 12, tileWidth = 160, reads = 0, writes = [];
  const grid = {children:[],addEventListener(name,handler){listeners[name]=handler;},
    getBoundingClientRect(){reads++;return {left:100,right:100+width,width};}};
  Object.defineProperties(grid,{
    clientWidth:{get(){reads++;return width;}},
    scrollWidth:{get(){reads++;return count*(tileWidth+gap)-gap;}},
    scrollLeft:{get(){return scroll;},set(value){writes.push(value);scroll=value;}}
  });
  for(let i=0;i<count;i++)grid.children.push({index:i,getBoundingClientRect(){reads++;return {left:100+i*(tileWidth+gap)-scroll,right:100+i*(tileWidth+gap)-scroll+tileWidth,width:tileWidth};}});
  const window = {addEventListener(name,handler){windowListeners[name]=handler;}};
  const file = path.join(__dirname,'..','dock-scroll.js');
  vm.runInNewContext(fs.existsSync(file)?fs.readFileSync(file,'utf8'):'',{window,Math,Array});
  assert.equal(typeof window.LauncherDockScroll?.mount,'function','dock scroll helper must exist');
  const dock = window.LauncherDockScroll.mount(grid);
  return {grid,dock,writes,readCount:()=>reads,position:()=>scroll,
    manualScroll(value){scroll=value;listeners.scroll();},nativeFocusScroll(value){scroll=value;},
    resize(value){width=value;windowListeners.resize();},setWidth(value){width=value;}};
}

test('24-app dock reveals the entire last tile instead of its tiny native-focus sliver',()=>{
  const h=harness();h.dock.refresh();h.nativeFocusScroll(3169);
  h.dock.reveal(h.grid.children[23]);
  assert.equal(h.position(),3316,'last tile ends exactly at the viewport right edge');
  const left=23*172-h.position();assert.ok(left>=0&&left+160<=800);
});

test('repeated arrows use cached geometry and reveal nearest edges in both directions',()=>{
  const h=harness();h.dock.refresh();const reads=h.readCount();
  h.grid.children.forEach(button=>h.dock.reveal(button));
  assert.equal(h.position(),3316);assert.equal(h.readCount(),reads);
  h.grid.children.slice().reverse().forEach(button=>h.dock.reveal(button));
  assert.equal(h.position(),0);assert.equal(h.readCount(),reads);
});

test('even unchanged desired overflow scroll corrects native focus auto-scroll before its scroll event',()=>{
  const h=harness();h.dock.refresh();h.nativeFocusScroll(72);h.dock.reveal(h.grid.children[0]);
  assert.equal(h.position(),0);assert.deepEqual(h.writes,[0]);
});

test('manual scrolling updates the cached position without reading any geometry',()=>{
  const h=harness();h.dock.refresh();const reads=h.readCount();
  h.manualScroll(2500);assert.equal(h.readCount(),reads);
  h.dock.reveal(h.grid.children[17]);assert.equal(h.position(),2500,'already visible target preserves manual position');
  h.dock.reveal(h.grid.children[0]);assert.equal(h.position(),0);
  assert.equal(h.readCount(),reads);
});

test('resize refreshes geometry and keeps the last revealed button fully visible',()=>{
  const h=harness();h.dock.refresh();h.dock.reveal(h.grid.children[7]);
  assert.equal(h.position(),564);const reads=h.readCount();
  h.resize(400);assert.ok(h.readCount()>reads);assert.equal(h.position(),964);
  const after=h.readCount();h.dock.reveal(h.grid.children[7]);assert.equal(h.readCount(),after);
});

test('render refresh picks up changed child offsets and ignores unrelated input buttons',()=>{
  const h=harness();h.dock.refresh();h.dock.reveal(h.grid.children[23]);
  const removed=h.grid.children.pop();h.grid.children.reverse();h.grid.children.forEach((button,index)=>{button.getBoundingClientRect=()=>({left:100+index*172-h.position(),right:260+index*172-h.position(),width:160});});
  h.dock.refresh();const writes=h.writes.length;h.dock.reveal(removed);h.dock.reveal({});
  assert.equal(h.writes.length,writes);h.dock.reveal(h.grid.children[0]);assert.equal(h.position(),0);
});

test('the original eight-app dock performs no scroll writes when all icons fit',()=>{
  const h=harness(8);h.setWidth(1600);assert.equal(h.readCount(),0,'mount does not measure before rendering');
  h.dock.refresh();const reads=h.readCount();h.grid.children.forEach(button=>h.dock.reveal(button));
  assert.deepEqual(h.writes,[]);assert.equal(h.readCount(),reads);
  h.resize(1700);assert.deepEqual(h.writes,[]);
});
