'use strict';

// Auto mode: starts Pantalla completa while an allow-listed app (YouTube) is in the foreground and
// returns to Manual, restoring the saved lamp state, when you leave it or the TV goes to standby.
// It runs as its own root process and only ever talks to the lights service through luna-send, as
// Mi pantalla, so the service stays the single owner of the capture session and its recovery record.
// It exists only while the switch is on: the switch lives in auto-config.js's config.json.

var LIGHTS = 'luna://com.frxn.mipantalla.lights/';
var FOREGROUND_URI = 'luna://com.webos.service.applicationmanager/getForegroundAppInfo';
var POWER_URI = 'luna://com.webos.service.tvpower/power/getPowerState';
var LIGHTS_CONFIG = '/media/developer/apps/usr/palm/applications/com.frxn.mipantalla/lights-config.js';
var PID_FILE = '/tmp/mipantalla-auto.pid';
var LOG_FILE = '/tmp/mipantalla-auto.log';
var LOG_LIMIT = 32768;
var START_DELAY_MS = 3000;
var STOP_DELAY_MS = 1500;
var BACKOFF_MS = [15000, 30000, 60000];
var STOP_RETRY_MS = 5000;
var STOP_RETRY_MAX = 6;
var CONFIG_POLL_MS = 3000;
var HEARTBEAT_MS = 30000;
var START_TIMEOUT_MS = 45000;
var STOP_TIMEOUT_MS = 40000;

function parseSelected(text) {
  var match = typeof text === 'string' && /window\.LAUNCHER_LIGHTS\s*=\s*(\{[\s\S]*\})\s*;?\s*$/.exec(text);
  if (!match) return null;
  var value;
  try { value = JSON.parse(match[1]); } catch (ignored) { return null; }
  var ids = value && value.selectedIds;
  if (!Array.isArray(ids) || !ids.length || ids.length > 32) return null;
  for (var i = 0; i < ids.length; i++) {
    if (typeof ids[i] !== 'string' || !/^wiz-[a-f0-9]{12}$/.test(ids[i]) || ids.indexOf(ids[i]) !== i) return null;
  }
  return ids.slice();
}

function createDaemon(deps) {
  var autoConfig = deps.autoConfig, subscribe = deps.subscribe, luna = deps.luna;
  var readLights = deps.readLights, now = deps.now || Date.now, log = deps.log || function () {};
  var setTimeoutFn = deps.setTimeout || setTimeout, clearTimeoutFn = deps.clearTimeout || clearTimeout;
  var exit = deps.exit || function () {}, pid = deps.pid || process.pid;
  var apps = autoConfig.APPS;

  var foreground = null, power = 'Active', enabled = true;
  var synced = false, busy = false, stopped = false, gaveUp = false, attempts = 0, stopAttempts = 0;
  var state = 'idle', reason = '';
  var startTimer = null, stopTimer = null, retryTimer = null, timers = [], subscriptions = [];

  function schedule(fn, delay) {
    var id = setTimeoutFn(function () {
      var index = timers.indexOf(id);
      if (index !== -1) timers.splice(index, 1);
      if (!stopped) fn();
    }, delay);
    timers.push(id);
    return id;
  }
  function cancel(id) {
    if (id === null) return null;
    clearTimeoutFn(id);
    var index = timers.indexOf(id);
    if (index !== -1) timers.splice(index, 1);
    return null;
  }
  function publish(next, why) {
    state = next; reason = why || '';
    try {
      autoConfig.writeState({state:state, app:foreground, reason:reason, autoStarted:synced, pid:state === 'off' ? null : pid});
    } catch (error) { log('state not written: ' + (error && error.code || 'error')); }
  }
  function wanted() {
    return enabled && power === 'Active' && foreground !== null && apps.indexOf(foreground) !== -1;
  }
  function describe(error) {
    var text = error && (error.code || error.message) || 'error';
    return String(text).replace(/[^\w .:-]/g, '').slice(0, 60);
  }

  function evaluate() {
    if (stopped) return;
    if (wanted()) {
      stopTimer = cancel(stopTimer);
      if (!synced && !busy && !gaveUp && startTimer === null && retryTimer === null) {
        publish('waiting', '');
        startTimer = schedule(doStart, START_DELAY_MS);
      }
      return;
    }
    startTimer = cancel(startTimer); retryTimer = cancel(retryTimer);
    gaveUp = false; attempts = 0;
    if (synced) {
      if (stopTimer === null && !busy) stopTimer = schedule(doStop, power === 'Active' ? STOP_DELAY_MS : 0);
    } else if (!busy) {
      publish(enabled ? 'idle' : 'off', '');
    }
  }

  function doStart() {
    startTimer = null;
    if (stopped || busy || synced || !wanted()) return;
    busy = true;
    var ids = readLights();
    if (!ids) { failStart(Error('selection-missing')); return; }
    luna('screenStatus', {ids:ids}, 15000).then(function (status) {
      if (status.active === true) {
        // A session somebody else started stays theirs: Auto never stops it.
        busy = false; publish('syncing', 'manual-session'); return null;
      }
      if (status.pending === true) {
        return luna('setMode', {mode:'manual'}, STOP_TIMEOUT_MS).then(function () {
          return luna('screenStatus', {ids:ids}, 15000);
        });
      }
      return status;
    }).then(function (status) {
      if (status === null) return null;
      if (status.captureStartReady !== true) { var error = Error(status.reason || 'not-ready'); error.code = status.reason || 'not-ready'; throw error; }
      return luna('setMode', {mode:'screen', source:'screen', ids:ids}, START_TIMEOUT_MS).then(function (result) {
        if (!result || result.mode !== 'screen') throw Error('start-unconfirmed');
        synced = true; attempts = 0; busy = false;
        publish('syncing', '');
        evaluate();
      });
    }).catch(failStart);
  }
  function failStart(error) {
    busy = false;
    attempts += 1;
    log('start failed (' + attempts + '): ' + describe(error));
    publish('error', describe(error));
    if (attempts >= BACKOFF_MS.length) { gaveUp = true; return; }
    retryTimer = schedule(function () { retryTimer = null; evaluate(); }, BACKOFF_MS[attempts - 1]);
  }

  function doStop() {
    stopTimer = null;
    if (stopped || busy || !synced) return;
    busy = true;
    publish('stopping', '');
    luna('setMode', {mode:'manual'}, STOP_TIMEOUT_MS).then(function () {
      synced = false; busy = false; stopAttempts = 0;
      publish(enabled ? 'idle' : 'off', '');
      evaluate();
    }).catch(function (error) {
      busy = false; stopAttempts += 1;
      log('stop failed (' + stopAttempts + '): ' + describe(error));
      publish('error', 'stop-' + describe(error));
      if (stopAttempts < STOP_RETRY_MAX) stopTimer = schedule(doStop, STOP_RETRY_MS);
    });
  }

  function finish() {
    stopped = true;
    for (var i = 0; i < timers.length; i++) clearTimeoutFn(timers[i]);
    timers = [];
    subscriptions.forEach(function (sub) { try { sub.stop(); } catch (ignored) {} });
    publish('off', '');
    exit(0);
  }
  function shutdown() {
    if (stopped) return;
    startTimer = cancel(startTimer); retryTimer = cancel(retryTimer); stopTimer = cancel(stopTimer);
    enabled = false;
    var wait = busy ? 2000 : 0;
    function go() {
      if (!synced) { finish(); return; }
      busy = true;
      luna('setMode', {mode:'manual'}, STOP_TIMEOUT_MS).then(function () { synced = false; finish(); },
        function (error) { log('stop at shutdown failed: ' + describe(error)); finish(); });
    }
    if (wait) setTimeoutFn(go, wait); else go();
  }

  function pollConfig() {
    if (stopped) return;
    var current = autoConfig.readConfig();
    if (!current.enabled) { shutdown(); return; }
    schedule(pollConfig, CONFIG_POLL_MS);
  }
  function heartbeat() {
    if (stopped) return;
    publish(state, reason);
    schedule(heartbeat, HEARTBEAT_MS);
  }

  function start() {
    var previous = autoConfig.readState();
    var leftover = !!(previous && previous.autoStarted);
    if (leftover) { synced = true; busy = false; log('previous session may still be active; restoring'); }
    publish('idle', '');
    subscriptions.push(subscribe(FOREGROUND_URI, {subscribe:true}, function (message) {
      var id = typeof message.appId === 'string' && message.appId.length <= 128 ? message.appId : '';
      foreground = id || null;
      evaluate();
    }));
    subscriptions.push(subscribe(POWER_URI, {subscribe:true}, function (message) {
      if (typeof message.state !== 'string' || message.state.length > 64) return;
      power = message.state;
      evaluate();
    }));
    if (leftover) stopTimer = schedule(doStop, 0);
    schedule(pollConfig, CONFIG_POLL_MS);
    schedule(heartbeat, HEARTBEAT_MS);
  }
  return {start:start, shutdown:shutdown, evaluate:evaluate,
    snapshot:function () { return {state:state, reason:reason, synced:synced, foreground:foreground, power:power, busy:busy, attempts:attempts, gaveUp:gaveUp}; }};
}

function createLogger(fs) {
  return function log(line) {
    var fd;
    try {
      var flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND | (fs.constants.O_NOFOLLOW || 0);
      var payload = '[' + new Date().toISOString() + '] ' + String(line).slice(0, 300) + '\n';
      fd = fs.openSync(LOG_FILE, flags, 384);
      if (fs.fstatSync(fd).size + Buffer.byteLength(payload) > LOG_LIMIT) fs.ftruncateSync(fd, 0);
      fs.appendFileSync(fd, payload);
    } catch (ignored) { /* logging never blocks the watcher */ } finally {
      if (fd !== undefined) { try { fs.closeSync(fd); } catch (ignored) {} }
    }
  };
}

function realLuna(method, payload, timeoutMs) {
  return new Promise(function (resolve, reject) {
    require('child_process').execFile('luna-send',
      ['-n', '1', '-f', '-a', 'com.frxn.mipantalla', LIGHTS + method, JSON.stringify(payload)],
      {timeout:timeoutMs, maxBuffer:65536, encoding:'utf8', env:Object.assign({}, process.env, {LD_PRELOAD:''})},
      function (error, out) {
        if (error) { reject(Error(error.killed ? 'timeout' : 'luna-error')); return; }
        var value;
        try { value = JSON.parse(out); } catch (ignored) { reject(Error('bad-reply')); return; }
        if (!value || value.returnValue !== true) {
          var failure = Error(String(value && value.errorText || 'rejected').slice(0, 80));
          failure.code = value && value.errorCode;
          reject(failure); return;
        }
        resolve(value);
      });
  });
}

module.exports = {createDaemon:createDaemon, parseSelected:parseSelected, START_DELAY_MS:START_DELAY_MS, STOP_DELAY_MS:STOP_DELAY_MS,
  BACKOFF_MS:BACKOFF_MS, STOP_RETRY_MAX:STOP_RETRY_MAX};

if (require.main === module) {
  var fs = require('fs');
  var path = require('path');
  if (process.argv.indexOf('--watch') === -1) { process.stdout.write('Usage: node auto-sync.js --watch\n'); process.exit(2); }
  if (typeof process.getuid === 'function' && process.getuid() !== 0) { process.stderr.write('root required\n'); process.exit(1); }
  var autoConfig = require('./auto-config')();
  if (!autoConfig.readConfig().enabled) process.exit(0);
  try { fs.writeFileSync(PID_FILE, String(process.pid), {mode:384}); } catch (ignored) {}
  var daemon = createDaemon({
    autoConfig:autoConfig, subscribe:require('./luna-subscribe'), luna:realLuna, log:createLogger(fs),
    readLights:function () { try { return parseSelected(fs.readFileSync(LIGHTS_CONFIG, 'utf8')); } catch (ignored) { return null; } },
    exit:function (code) { try { fs.unlinkSync(PID_FILE); } catch (ignored) {} process.exit(code); }
  });
  process.on('SIGTERM', function () { daemon.shutdown(); });
  process.on('SIGINT', function () { daemon.shutdown(); });
  daemon.start();
  void path;
}
