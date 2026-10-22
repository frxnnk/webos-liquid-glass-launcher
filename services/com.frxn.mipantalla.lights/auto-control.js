'use strict';
var path = require('path');

function fail(message) { return Error(message); }

// Exposes the Auto switch to Mi pantalla. The switch is a file; the watcher (auto-sync.js) is a separate
// process that only exists while it is on. This module never starts or stops capture itself.
module.exports = function createAutoControl(options) {
  options = options || {};
  var config = options.config;
  var spawn = options.spawn || require('child_process').spawn;
  var script = options.script || path.join(__dirname, 'auto-autostart.sh');
  var now = options.now || Date.now;

  function snapshot() {
    if (!config.available()) {
      return {available:false, enabled:false, apps:config.APPS.slice(), state:'off', watching:false, reason:'unavailable'};
    }
    var saved = config.readConfig();
    var state = config.readState();
    var watching = config.watching(state);
    var shown = !saved.enabled ? 'off' : watching ? state.state : 'starting';
    return {available:true, enabled:saved.enabled, apps:config.APPS.slice(), state:shown, watching:watching,
      reason:saved.invalid ? 'config-invalid' : (watching ? state.reason : ''), app:watching ? state.app : null,
      autoStarted:watching ? state.autoStarted : false};
  }
  function launch() {
    try {
      var child = spawn('/bin/sh', [script], {detached:true, stdio:'ignore'});
      if (child && typeof child.unref === 'function') child.unref();
    } catch (ignored) { /* The status keeps saying "starting" and the boot hook retries. */ }
  }
  return {
    autoStatus:function () { return Promise.resolve(snapshot()); },
    setAuto:function (payload) {
      return Promise.resolve().then(function () {
        if (!payload || typeof payload.enabled !== 'boolean') throw fail('Valor de Auto inválido.');
        if (!config.available()) throw fail('Auto necesita el servicio con permisos de root en esta TV.');
        try { config.writeConfig(payload.enabled); } catch (error) { throw fail('No se pudo guardar el modo Auto.'); }
        if (payload.enabled && !config.watching(config.readState())) launch();
        return snapshot();
      });
    },
    now:now
  };
};
