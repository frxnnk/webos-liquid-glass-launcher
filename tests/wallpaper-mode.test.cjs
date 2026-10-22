const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const file = path.join(__dirname, '../wallpaper-mode.js');

function harness(options = {}) {
  const listeners = [], effects = [];
  const classes = new Set();
  const root = {classList:{add:name=>classes.add(name),remove:name=>classes.delete(name)}};
  const shell = {hidden:false};
  const buttonListeners = [];
  const button = {attributes:{},focuses:0,
    setAttribute(name,value){this.attributes[name]=String(value);},
    getAttribute(name){return this.attributes[name]===undefined?null:this.attributes[name];},
    addEventListener(type,callback){buttonListeners.push({type,callback});},
    focus(){this.focuses++;document.activeElement=this;}
  };
  const document = {hidden:false,visibilityState:'visible',activeElement:button,
    addEventListener(type,callback,capture){listeners.push({type,callback,capture:capture===true});}
  };
  // Register the application's ordinary actions first: capture must still win.
  document.addEventListener('keydown',()=>effects.push('navigate-or-launch'));
  document.addEventListener('click',()=>effects.push('underlying-click'));
  const window = {};
  vm.runInNewContext(fs.existsSync(file)?fs.readFileSync(file,'utf8'):'',{window,document});
  assert.equal(typeof window.LauncherWallpaperMode?.mount,'function','wallpaper mode module is available');
  const mode = window.LauncherWallpaperMode.mount(Object.assign({button,root,shell},options));
  function dispatch(type,values={}) {
    const event = Object.assign({type,target:null,defaultPrevented:false,stopped:false,
      preventDefault(){this.defaultPrevented=true;},stopImmediatePropagation(){this.stopped=true;}},values);
    const handlers = listeners.filter(l=>l.type===type&&l.capture)
      .concat(event.target===button?buttonListeners.filter(l=>l.type===type):[])
      .concat(listeners.filter(l=>l.type===type&&!l.capture));
    for(const handler of handlers){if(event.stopped)break;handler.callback(event);}
    return event;
  }
  return {mode,button,shell,root,classes,document,effects,listeners,dispatch};
}

test('only explicit activation hides the shell and marks the wallpaper button pressed',()=>{
  const h=harness();
  assert.equal(h.mode.isActive(),false);assert.equal(h.shell.hidden,false);
  assert.equal(h.button.getAttribute('aria-pressed'),'false');assert.equal(h.classes.size,0);
  h.dispatch('keydown',{key:'ArrowRight',keyCode:39});assert.equal(h.mode.isActive(),false);
  h.dispatch('click',{target:h.button});
  assert.equal(h.mode.isActive(),true);assert.equal(h.shell.hidden,true);
  assert.equal(h.classes.has('is-wallpaper-only'),true);assert.equal(h.button.getAttribute('aria-pressed'),'true');
  assert.equal(h.button.focuses,0);assert.equal(h.mode.enter(),true,'enter is idempotent');
});

test('one exit key is consumed in capture before app navigation, launch or Back can run',()=>{
  const keys=[['Enter',13],[' ',32],['Spacebar',32],['ArrowLeft',37],['ArrowUp',38],['ArrowRight',39],['ArrowDown',40],['Escape',27],['Backspace',8],['Tab',9],['Unidentified',461]];
  for(const [key,keyCode] of keys){
    const h=harness();h.mode.enter();const event=h.dispatch('keydown',{key,keyCode});
    assert.equal(h.mode.isActive(),false,key);assert.equal(h.shell.hidden,false,key);
    assert.equal(event.defaultPrevented,true,key);assert.equal(event.stopped,true,key);
    assert.deepEqual(h.effects,[],key);assert.equal(h.document.activeElement,h.button,key);
    assert.equal(h.button.focuses,1,key);assert.equal(h.button.getAttribute('aria-pressed'),'false');
    assert.equal(h.classes.has('is-wallpaper-only'),false);
  }
});

test('holding the entry key consumes repeat events without leaving wallpaper mode',()=>{
  for(const keyCode of [13,32,37,38,39,40,27,8,9,461]){
    const h=harness();h.mode.enter();const event=h.dispatch('keydown',{keyCode,repeat:true});
    assert.equal(h.mode.isActive(),true,keyCode);assert.equal(event.defaultPrevented,true,keyCode);
    assert.deepEqual(h.effects,[],keyCode);
  }
});

test('onExit runs after the shell returns and before focus, only for a real exit',()=>{
  const observations=[];let h;
  h=harness({onExit(){observations.push([h.shell.hidden,h.button.focuses,h.mode.isActive()]);}});
  h.mode.exit();assert.deepEqual(observations,[]);
  h.mode.enter();h.mode.exit();
  assert.deepEqual(observations,[[false,0,false]]);assert.equal(h.button.focuses,1);
  h.mode.exit();assert.equal(observations.length,1);
});

test('an exit key held down cannot immediately reenter or launch, and keyup releases suppression',()=>{
  const h=harness();h.mode.enter();h.dispatch('keydown',{key:'Enter',keyCode:13,repeat:false});
  assert.equal(h.mode.isActive(),false);assert.deepEqual(h.effects,[]);
  const repeated=h.dispatch('keydown',{key:'Enter',keyCode:13,repeat:true});
  assert.equal(repeated.defaultPrevented,true);assert.equal(repeated.stopped,true);
  assert.equal(h.mode.isActive(),false);assert.deepEqual(h.effects,[]);
  const release=h.dispatch('keyup',{key:'Enter',keyCode:13});
  assert.equal(release.defaultPrevented,true,'release cannot trigger a keyup-based button activation');
  const next=h.dispatch('keydown',{key:'Enter',keyCode:13,repeat:false});
  assert.equal(next.defaultPrevented,false);assert.deepEqual(h.effects,['navigate-or-launch']);
  h.dispatch('click',{target:h.button});assert.equal(h.mode.isActive(),true);
});

test('a fresh keydown recovers from a missing keyup without blocking volume or media',()=>{
  const h=harness();h.mode.enter();h.dispatch('keydown',{key:'Enter',repeat:false});
  for(const key of ['AudioVolumeUp','MediaPlayPause']){
    const event=h.dispatch('keydown',{key,repeat:true});assert.equal(event.defaultPrevented,false);
  }
  const next=h.dispatch('keydown',{key:'Enter',repeat:false});
  assert.equal(next.defaultPrevented,false);assert.equal(h.effects.length,3);
  h.dispatch('click',{target:h.button});assert.equal(h.mode.isActive(),true);
});

test('volume and media keys remain available without exiting wallpaper mode',()=>{
  const h=harness();h.mode.enter();
  for(const [key,keyCode] of [['AudioVolumeUp',447],['AudioVolumeDown',448],['AudioVolumeMute',449],['MediaPlayPause',179],['MediaPlay',415],['MediaPause',19]]){
    const event=h.dispatch('keydown',{key,keyCode});
    assert.equal(h.mode.isActive(),true,key);assert.equal(event.defaultPrevented,false,key);assert.equal(event.stopped,false,key);
  }
  assert.equal(h.button.focuses,0);assert.equal(h.effects.length,6);
});

test('the first pointer click exits without activating the control underneath it',()=>{
  const h=harness();h.mode.enter();const event=h.dispatch('click',{target:{id:'youtube-tile'}});
  assert.equal(h.mode.isActive(),false);assert.equal(event.defaultPrevented,true);assert.equal(event.stopped,true);
  assert.equal(h.button.focuses,1);assert.deepEqual(h.effects,[]);
  h.dispatch('click',{target:{id:'youtube-tile'}});assert.deepEqual(h.effects,['underlying-click']);
});

test('app hiding resets the mode without taking focus and returning never enters it automatically',()=>{
  const h=harness();h.mode.enter();const other={id:'outside-app'};h.document.activeElement=other;
  h.document.hidden=true;h.document.visibilityState='hidden';h.dispatch('visibilitychange');
  assert.equal(h.mode.isActive(),false);assert.equal(h.shell.hidden,false);
  assert.equal(h.document.activeElement,other);assert.equal(h.button.focuses,0);
  assert.equal(h.mode.enter(),false,'a hidden app cannot activate wallpaper mode');
  h.document.hidden=false;h.document.visibilityState='visible';h.dispatch('visibilitychange');
  assert.equal(h.mode.isActive(),false);assert.equal(h.button.focuses,0);
});

test('manual exit preserves a previously hidden shell and does not refocus if requested',()=>{
  const h=harness();h.shell.hidden=true;h.mode.enter();
  assert.equal(h.mode.exit(false),true);assert.equal(h.shell.hidden,true);assert.equal(h.button.focuses,0);
  assert.equal(h.mode.exit(),false,'an inactive exit has no focus effects');assert.equal(h.button.focuses,0);
});
