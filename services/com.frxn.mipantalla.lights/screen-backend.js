'use strict';
var protocol = require('./protocol');
function failure(reason) { var error = Error('No se pudo confirmar la captura.'); error.reason = reason; return error; }
function base(config) {
  return {configured:config.enabled === true,available:false,ready:false,active:false,
    configVerified:false,hardwareVerified:config.hardwareVerified === true,
    framesVerified:false,sourceFreshness:'unknown',
    outputEnabled:false,lampCount:0,reason:'setup-pending'};
}
function reasonFor(error) {
  if (error && error.reason) return error.reason;
  var codes = {HYPERHDR_AUTH_REQUIRED:'auth-required',HYPERHDR_INSTANCE_UNAVAILABLE:'instance-mismatch',
    HYPERHDR_TIMEOUT:'timeout',HYPERHDR_PROTOCOL:'protocol-error',HYPERHDR_COMMAND_REJECTED:'protocol-error'};
  return codes[error && error.code] || 'offline';
}
function validIds(ids) {
  return Array.isArray(ids) && ids.length <= 32 && ids.every(function (id,i) {
    return typeof id === 'string' && /^wiz-[a-f0-9]{12}$/.test(id) && ids.indexOf(id) === i;
  });
}
function layoutMatches(leds, count) {
  return Array.isArray(leds) && leds.length === count && leds.every(function (led) {
    return led && led.disabled !== true && ['hmin','hmax','vmin','vmax'].every(function (key) {
      return typeof led[key] === 'number' && isFinite(led[key]) && led[key] >= 0 && led[key] <= 1;
    }) && led.hmin < led.hmax && led.vmin < led.vmax;
  });
}
function configurationMatches(device, leds, ids) {
  if (!device || device.type !== 'wiz' || (device.port !== undefined && device.port !== 38899) ||
      !Array.isArray(device.lamps) || device.lamps.length !== ids.length || !layoutMatches(leds,ids.length)) return false;
  var seen = {}, addresses = {};
  return device.lamps.every(function (lamp) {
    var mac = lamp && protocol.mac(lamp.macAddress);
    var id = 'wiz-' + mac;
    if (!mac || seen[id] || ids.indexOf(id) === -1 || !protocol.privateIPv4(lamp.ipAddress) || addresses[lamp.ipAddress]) return false;
    seen[id] = true; addresses[lamp.ipAddress] = true; return true;
  });
}
function liveMatches(device, current) {
  return device.lamps.every(function (lamp) {
    var id = 'wiz-' + protocol.mac(lamp.macAddress);
    var actual = current.filter(function (d) { return d.id === id; })[0];
    return !!actual && actual.reachable === true && actual.ip === lamp.ipAddress;
  });
}
module.exports = function createBackend(options) {
  var config = options.config || {};
  var now = options.now || Date.now;
  var wait = options.wait || function (ms) { return new Promise(function (resolve) { setTimeout(resolve,ms); }); };
  var setTimer = options.setTimer || setTimeout, clearTimer = options.clearTimer || clearTimeout;
  function configured() {
    if (config.invalid) throw failure('config-invalid');
    if (config.enabled !== true) throw failure('setup-pending');
    if (typeof config.token !== 'string' || !config.token || config.token.length > 2048 || /[\x00-\x1f]/.test(config.token) ||
        typeof config.profile !== 'string' || !config.profile || config.profile.length > 80) throw failure('config-invalid');
  }
  function use(action) {
    var session;
    return Promise.resolve().then(function () { configured(); return options.rpc.connect(); }).then(function (connection) {
      session = connection; return action(session);
    }).then(function (result) { if (session) session.close(); return result; },function (error) {
      if (session) session.close(); throw error;
    });
  }
  function outputState(result) {
    var info = result && result.info;
    var instance = info && Array.isArray(info.instance) && info.instance.filter(function (i) {
      return i.instance === 0 && i.running === true;
    })[0];
    if (!info || info.currentInstance !== 0 || !instance) throw failure('instance-mismatch');
    if (instance.friendly_name !== config.profile) throw failure('profile-mismatch');
    var output = Array.isArray(info.components) && info.components.filter(function (c) { return c.name === 'LEDDEVICE'; })[0];
    if (!output || typeof output.enabled !== 'boolean') throw failure('protocol-error');
    return output.enabled;
  }
  function waitForOutput(session, desired) {
    return new Promise(function (resolve,reject) {
      var done = false, deadline = now() + 2500;
      function finish(error) {
        if (done) return;
        done = true; clearTimer(timer);
        if (error) reject(error); else resolve({active:desired});
      }
      function expire() {
        if (done) return;
        // Cancel an in-flight RPC too; its own timeout must not extend this deadline.
        try { session.close(); } catch (ignored) {}
        finish(failure('timeout'));
      }
      var timer = setTimer(expire,2500);
      function poll() {
        if (done) return;
        if (now() >= deadline) { expire(); return; }
        Promise.resolve().then(function () { return session.request({command:'serverinfo'}); }).then(function (result) {
          if (done) return;
          if (now() >= deadline) { expire(); return; }
          if (outputState(result) === desired) { finish(); return; }
          return wait(Math.min(100,deadline - now())).then(poll);
        }).catch(function (error) { finish(error); });
      }
      poll();
    });
  }
  function setOutput(session, desired) {
    return session.request({command:'componentstate',componentstate:{component:'LEDDEVICE',state:desired}}).then(function (result) {
      if (!result || result.success !== true) throw failure('protocol-error');
      return waitForOutput(session,desired);
    });
  }
  function check(session, ids, live) {
    if (!validIds(ids)) return Promise.reject(failure('selection-mismatch'));
    var output;
    return session.request({command:'authorize',subcommand:'adminRequired'}).then(function (result) {
      if (!result.info || result.info.adminRequired !== false) throw failure('admin-required');
      return session.request({command:'serverinfo'});
    }).then(function (result) {
      output = outputState(result);
      return session.request({command:'config',subcommand:'getconfig'});
    }).then(function (result) {
      if (!ids.length) throw failure('selection-required');
      var device = result.info && result.info.device;
      if (!configurationMatches(device,result.info && result.info.leds,ids)) throw failure('selection-mismatch');
      // An owned stop must not depend on lamp replies while that same writer is active.
      if (live === false) return {outputEnabled:output};
      return options.read(ids).then(function (current) {
        if (!current || !Array.isArray(current.devices) || !liveMatches(device,current.devices)) throw failure('selection-mismatch');
        return {outputEnabled:output};
      });
    });
  }
  return {
    inspect:function (ids) {
      var status = base(config);
      var checkStatus = use(function (session) { return check(session,ids); }).then(function (checked) {
        status.available = true; status.configVerified = true; status.outputEnabled = checked.outputEnabled;
        status.lampCount = ids.length;
      },function (error) { status.reason = reasonFor(error); });
      var frames = options.probe ? Promise.resolve().then(options.probe).catch(function () {
        return {framesVerified:false,sourceFreshness:'unknown'};
      }) : Promise.resolve({framesVerified:false,sourceFreshness:'unknown'});
      return Promise.all([checkStatus,frames]).then(function (results) {
        var observed = results[1] || {};
        status.framesVerified = observed.framesVerified === true;
        status.sourceFreshness = status.framesVerified ? 'fresh' : 'unknown';
        if (!status.available || !status.configVerified) return status;
        if (status.outputEnabled) { status.reason = 'output-in-use'; return status; }
        if (!status.hardwareVerified) { status.reason = 'hardware-unverified'; return status; }
        if (!status.framesVerified) { status.reason = 'frames-unverified'; return status; }
        status.ready = true; status.reason = '';
        return status;
      });
    },
    start:function (ids, operation) {
      var issued = false;
      return use(function (session) {
        return check(session,ids).then(function (checked) {
          if (checked.outputEnabled) throw failure('output-in-use');
          if (config.hardwareVerified !== true) throw failure('hardware-unverified');
          if (!options.probe) throw failure('frames-unverified');
          return Promise.resolve().then(options.probe).catch(function () { throw failure('frames-unverified'); });
        }).then(function (frames) {
          if (!frames || frames.framesVerified !== true) throw failure('frames-unverified');
          if (operation && typeof operation.canContinue === 'function' && operation.canContinue() !== true) throw failure('timeout');
          issued = true;
          return setOutput(session,true);
        }).catch(function (error) {
          if (!issued) throw error;
          // A timed-out session may already be closed. Revalidate before the single compensating stop.
          try { session.close(); } catch (ignored) {}
          return use(function (recovery) {
            return check(recovery,ids,false).then(function () { return setOutput(recovery,false); });
          }).then(function () { throw error; },function () { throw error; });
        });
      });
    },
    stop:function (ids) {
      // Called only by the session owner with its persisted original selection.
      return use(function (session) {
        return check(session,ids,false).then(function () {
          return setOutput(session,false);
        });
      }).catch(function () { var error = Error('No se confirmó la parada de la salida de video.'); error.code = 'SCREEN_STOP_UNCONFIRMED'; throw error; });
    }
  };
};
