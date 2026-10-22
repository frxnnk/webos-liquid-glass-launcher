'use strict';

function failure(code) {
  var error = Error(code);
  error.code = code;
  return error;
}
function idsOf(ids, allowEmpty) {
  if (!Array.isArray(ids) || ids.length > 32 || (!allowEmpty && !ids.length)) throw failure('SCREEN_IDS_INVALID');
  for (var i = 0; i < ids.length; i++) {
    if (typeof ids[i] !== 'string' || !/^wiz-[a-f0-9]{12}$/.test(ids[i]) || ids.indexOf(ids[i]) !== i) {
      throw failure('SCREEN_IDS_INVALID');
    }
  }
  return ids.slice();
}
function integer(value, min, max) {
  return typeof value === 'number' && isFinite(value) && Math.floor(value) === value && value >= min && value <= max;
}
function stateOf(state) {
  if (!state || typeof state.on !== 'boolean' || !integer(state.brightness, 1, 100)) throw failure('SCREEN_BASELINE_INVALID');
  var rgb = state.rgb !== undefined && state.rgb !== null;
  var temp = state.temperature !== undefined && state.temperature !== null;
  var scene = state.sceneId !== undefined && state.sceneId !== null;
  if ((rgb ? 1 : 0) + (temp ? 1 : 0) + (scene ? 1 : 0) > 1 || (state.on && !rgb && !temp && !scene)) {
    throw failure('SCREEN_BASELINE_INVALID');
  }
  var result = {on:state.on, brightness:state.brightness};
  if (rgb) {
    if (!Array.isArray(state.rgb) || state.rgb.length !== 3 || !integer(state.rgb[0], 0, 255) ||
        !integer(state.rgb[1], 0, 255) || !integer(state.rgb[2], 0, 255)) throw failure('SCREEN_BASELINE_INVALID');
    result.rgb = state.rgb.slice();
  }
  if (temp) {
    if (!integer(state.temperature, 2200, 6500)) throw failure('SCREEN_BASELINE_INVALID');
    result.temperature = state.temperature;
  }
  if (scene) {
    if (!integer(state.sceneId, 1, 255)) throw failure('SCREEN_BASELINE_INVALID');
    result.sceneId = state.sceneId;
  }
  return result;
}
function recordOf(record) {
  if (!record || ['prepared','active','restoring'].indexOf(record.phase) === -1 || !Array.isArray(record.devices)) {
    throw failure('SCREEN_RECOVERY_INVALID');
  }
  var ids = idsOf(record.ids);
  var seen = [];
  var devices = record.devices.map(function (entry) {
    if (!entry || ids.indexOf(entry.id) === -1 || seen.indexOf(entry.id) !== -1) throw failure('SCREEN_RECOVERY_INVALID');
    seen.push(entry.id);
    return {id:entry.id, state:stateOf(entry.state)};
  });
  if (devices.length !== record.devices.length || (record.phase !== 'restoring' && devices.length !== ids.length)) {
    throw failure('SCREEN_RECOVERY_INVALID');
  }
  for (var i = 0; i < devices.length; i++) if (!devices[i]) throw failure('SCREEN_RECOVERY_INVALID');
  return {phase:record.phase, ids:ids, devices:devices};
}
function baselineOf(result, ids) {
  if (!result || !Array.isArray(result.devices) || result.devices.length !== ids.length) throw failure('SCREEN_BASELINE_INVALID');
  var entries = result.devices;
  return ids.map(function (id) {
    var matches = entries.filter(function (entry) { return entry && entry.id === id; });
    if (matches.length !== 1 || matches[0].reachable !== true) throw failure('SCREEN_BASELINE_INVALID');
    return {id:id, state:stateOf(matches[0].state)};
  });
}
function verified(report) {
  return report && report.ready === true && report.hardwareVerified === true &&
    (report.framesVerified === true || report.captureStartReady === true) &&
    report.configVerified === true && report.active === false;
}

function create(options) {
  var backend = options.backend, store = options.store, busy = false;
  function pending() {
    var record;
    try { record = store.load(); } catch (error) { throw failure('SCREEN_RECOVERY_UNAVAILABLE'); }
    return record == null ? null : recordOf(record);
  }
  function save(record) {
    try { store.save(recordOf(record)); } catch (error) { throw failure('SCREEN_PERSIST_FAILED'); }
  }
  function exclusive(work) {
    if (busy) return Promise.reject(failure('SCREEN_BUSY'));
    busy = true;
    return Promise.resolve().then(work).then(function (result) {
      busy = false;
      return result;
    }, function (error) { busy = false; throw error; });
  }
  function inspect(ids) {
    return Promise.resolve().then(function () { return backend.inspect(ids.slice()); }).catch(function () {
      throw failure('SCREEN_BACKEND_UNAVAILABLE');
    });
  }
  function status(ids) {
    return Promise.resolve().then(function () {
      var selected = idsOf(ids, true);
      var record = pending();
      return inspect(selected).then(function (report) {
        report = report || {};
        var ready = selected.length > 0 && !!verified(report) && !record && !busy;
        return {ready:ready, hardwareVerified:report.hardwareVerified === true,
          framesVerified:report.framesVerified === true, configVerified:report.configVerified === true,
          active:typeof report.active === 'boolean' ? report.active : null, pending:!!record,
          phase:record ? record.phase : null, busy:busy,
          reason:ready ? null : (record ? 'SCREEN_RECOVERY_PENDING' :
            (busy ? 'SCREEN_BUSY' : (!selected.length ? 'SCREEN_IDS_REQUIRED' : 'SCREEN_NOT_READY')))};
      });
    });
  }
  function start(ids) {
    return exclusive(function () {
      var selected = idsOf(ids);
      if (pending()) throw failure('SCREEN_RECOVERY_PENDING');
      return inspect(selected).then(function (report) {
        if (!verified(report)) throw failure('SCREEN_NOT_READY');
        return Promise.resolve().then(function () { return options.read(selected.slice()); }).catch(function () {
          throw failure('SCREEN_BASELINE_UNAVAILABLE');
        });
      }).then(function (result) {
        var record = {phase:'prepared', ids:selected, devices:baselineOf(result, selected)};
        save(record);
        return Promise.resolve().then(function () { return backend.start(selected.slice()); }).catch(function () {
          throw failure('SCREEN_START_UNCONFIRMED');
        }).then(function (ack) {
          if (!ack || ack.active !== true) throw failure('SCREEN_START_UNCONFIRMED');
          record.phase = 'active';
          try { save(record); } catch (error) {
            // The prepared baseline remains durable; stop output without restoring or clearing it.
            return Promise.resolve().then(function () { return backend.stop(selected.slice()); }).then(function () {
              throw error;
            },function () { throw error; });
          }
          return {active:true, pending:true, phase:'active'};
        });
      });
    });
  }
  // WiZ answers over UDP and can miss the first write right after HyperHDR stops, so lamps that
  // were not confirmed get one more pass after a short wait. Writes repeat the same saved
  // baseline, so they are idempotent. Anything still unconfirmed stays in the recovery record.
  var retryDelay = typeof options.retryDelayMs === 'number' ? options.retryDelayMs : 1500;
  function wait(ms) {
    if (typeof options.delay === 'function') return Promise.resolve().then(function () { return options.delay(ms); });
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }
  function restorePass(record) {
    var chain = Promise.resolve(record);
    record.devices.slice().forEach(function (entry) {
      chain = chain.then(function (current) {
        return Promise.resolve().then(function () { return options.write(entry.id, stateOf(entry.state)); }).then(function (ack) {
          if (!ack || ack.confirmed !== true) return current;
          var next = {phase:'restoring', ids:current.ids, devices:current.devices.filter(function (device) { return device.id !== entry.id; })};
          save(next);
          return next;
        }, function () { return current; });
      });
    });
    return chain;
  }
  function restore(record) {
    record.phase = 'restoring';
    save(record);
    return restorePass(record).then(function (left) {
      if (!left.devices.length) return left;
      return wait(retryDelay).then(function () { return restorePass(left); });
    }).then(function (left) {
      if (left.devices.length) throw failure('SCREEN_RESTORE_PENDING');
      try { store.clear(); } catch (error) { throw failure('SCREEN_PERSIST_FAILED'); }
      return {active:false, pending:false};
    });
  }
  function stop() {
    return exclusive(function () {
      var record = pending();
      if (!record) return {active:false, pending:false};
      return Promise.resolve().then(function () { return backend.stop(record.ids.slice()); }).catch(function (error) {
        if (error && error.code === 'PICCAP_RECOVERY_PENDING') {
          var pendingError = failure('SCREEN_RECOVERY_PENDING');
          pendingError.message = 'La captura conserva un inicio incierto; hace falta la recuperación verificada.';
          throw pendingError;
        }
        throw failure('SCREEN_STOP_UNCONFIRMED');
      }).then(function (ack) {
        if (!ack || ack.active !== false) throw failure('SCREEN_STOP_UNCONFIRMED');
        return restore(record);
      });
    });
  }
  return {status:status, start:start, stop:stop, pending:pending};
}
module.exports = {create:create};
