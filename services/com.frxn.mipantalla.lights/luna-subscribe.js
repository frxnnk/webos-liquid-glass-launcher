'use strict';

var MAX_BUFFER = 8192;
var RECONNECT_MS = 5000;

// Keeps one `luna-send -i` subscription alive and hands every valid JSON line to onMessage.
// No -f: it pretty-prints the JSON over several lines and the strict line reader would drop every message.
// Same guards as home-power.js: bounded buffer, strict JSON lines, reconnect after any failure.
module.exports = function subscribe(uri, payload, onMessage, rawDeps) {
  var deps = rawDeps || {};
  var spawn = deps.spawn || require('child_process').spawn;
  var setTimeoutFn = deps.setTimeout || setTimeout;
  var clearTimeoutFn = deps.clearTimeout || clearTimeout;
  var env = deps.env || Object.assign({}, process.env, {LD_PRELOAD:''});
  var stopped = false, active = null, reconnect = null;

  function kill(connection) {
    if (!connection || connection.killed) return;
    connection.killed = true;
    if (connection.child) { try { connection.child.kill(); } catch (ignored) {} }
  }
  function failed(connection) {
    if (stopped || active !== connection) return;
    active = null;
    kill(connection);
    if (reconnect === null) reconnect = setTimeoutFn(function () { reconnect = null; start(); }, RECONNECT_MS);
  }
  function receive(connection, chunk) {
    if (stopped || active !== connection) return;
    var bytes = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
    if (!Buffer.isBuffer(bytes) || bytes.length + connection.buffer.length > MAX_BUFFER) { failed(connection); return; }
    connection.buffer = Buffer.concat([connection.buffer, bytes]);
    var index;
    while (!stopped && active === connection && (index = connection.buffer.indexOf(10)) !== -1) {
      var line = connection.buffer.slice(0, index).toString('utf8').trim();
      connection.buffer = connection.buffer.slice(index + 1);
      if (!line) continue;
      var message;
      try { message = JSON.parse(line); } catch (ignored) { failed(connection); return; }
      if (!message || typeof message !== 'object' || Array.isArray(message) || message.returnValue !== true) { failed(connection); return; }
      try { onMessage(message); } catch (ignored) { /* Observation must not terminate the watcher. */ }
    }
  }
  function start() {
    if (stopped || active) return;
    var connection = {child:null, buffer:Buffer.alloc(0), killed:false};
    active = connection;
    try {
      var child = spawn('luna-send', ['-i', uri, JSON.stringify(payload)], {stdio:['ignore', 'pipe', 'ignore'], env:env});
      connection.child = child;
      child.stdout.on('data', function (chunk) { receive(connection, chunk); });
      child.on('error', function () { failed(connection); });
      child.on('exit', function () { failed(connection); });
    } catch (ignored) { failed(connection); }
  }
  start();
  return {
    stop:function () {
      stopped = true;
      if (reconnect !== null) { clearTimeoutFn(reconnect); reconnect = null; }
      kill(active); active = null;
    }
  };
};
