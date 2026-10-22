'use strict';
var URI = 'luna://org.webosbrew.piccap.service/';
var VERSION = '00c932f-mipantalla-single-owner1';
function failure(code) { var error = Error(code); error.code = code; return error; }
function settingsOwn(s) {
  return s && (s.address === '127.0.0.1' || s.address === 'localhost') && s.port === 19400 &&
    s.priority === 150 && s['unix-socket'] === false && s.width === 320 && s.height === 180 &&
    s.fps === 30 && s.autostart === false && s.novideo === false && s.quirks === 0 &&
    ['auto','libvtcapture'].indexOf(s.backend) !== -1 && ['auto','libhalgal'].indexOf(s.uibackend) !== -1;
}
function off(s) { return s && s.isRunning === false && s.uiRunning === false && s.videoRunning === false && s.connected === false; }
function fresh(s) {
  return s && s.isRunning === true && s.connected === true && (s.uiRunning === true || s.videoRunning === true) &&
    typeof s.framerate === 'number' && isFinite(s.framerate) && s.framerate > 0;
}
module.exports = function createLifecycle(options) {
  var call = options.call, now = options.now || Date.now;
  var wait = options.wait || function (ms) { return new Promise(function (resolve) { setTimeout(resolve,ms); }); };
  var setTimer = options.setTimer || setTimeout, clearTimer = options.clearTimer || clearTimeout;
  var pendingStart = null, cleanup = null, durableUnknown = false;
  function operation(ms, code, work) {
    return new Promise(function (resolve,reject) {
      var done = false, deadline = now() + ms;
      function finish(error,result) {
        if (done) return; done = true; clearTimer(timer);
        if (error) reject(failure(code)); else resolve(result);
      }
      var timer = setTimer(function () { finish(failure(code)); },ms);
      function check() { if (done || now() >= deadline) throw failure(code); }
      function request(method, mutation, onIssue, onResponse) {
        return Promise.resolve().then(function () {
          check();
          if (onIssue) onIssue();
          return call(URI + method,{},mutation ? 12000 : Math.min(1500,deadline-now()),onResponse);
        }).then(function (message) {
          if (onResponse) onResponse(message);
          check();
          var payload = message && message.payload;
          if (!payload || (payload.returnValue !== true &&
              !((method === 'start' || method === 'stop') && payload.returnValue === false))) throw failure(code);
          return payload;
        });
      }
      function pause() { check(); return wait(Math.min(250,deadline-now())).then(check); }
      Promise.resolve().then(function () { return work(request,pause,check); }).then(function (result) {
        check(); finish(null,result);
      }).catch(function (error) { finish(error); });
    });
  }
  function inspect() {
    return operation(3000,'PICCAP_UNAVAILABLE',function (request) {
      return Promise.all([request('getSettings'),request('status')]).then(function (values) {
        return {stopped:!durableUnknown && !pendingStart && !cleanup && off(values[1]),
          settingsVerified:!!settingsOwn(values[0]) && values[1].version === VERSION};
      });
    }).catch(function () { return {stopped:false,settingsVerified:false}; });
  }
  function start() {
    if (durableUnknown || pendingStart || cleanup) return Promise.reject(failure('PICCAP_START_UNCONFIRMED'));
    var issued = false;
    var attempt = {seen:false,rollback:false};
    pendingStart = attempt;
    function reply(message) {
      var payload = message && message.payload;
      if (attempt.seen || !payload || typeof payload.returnValue !== 'boolean') return;
      attempt.seen = true;
      if (pendingStart === attempt) pendingStart = null;
      if (attempt.rollback && payload.returnValue === true && !cleanup) {
        // Cleanup is allowed after expiry. It never resumes Start, enables LEDs or clears the WAL.
        cleanup = stopNative(true);
        cleanup.then(function () { cleanup = null; },function () { cleanup = null; });
      }
    }
    // Reserve twelve seconds for an explicit stop if this seven-second start is uncertain.
    return operation(7000,'PICCAP_START_UNCONFIRMED',function (request,pause) {
      return Promise.all([request('getSettings'),request('status')]).then(function (values) {
        if (!settingsOwn(values[0]) || !off(values[1]) || values[1].version !== VERSION) throw failure('PICCAP_START_UNCONFIRMED');
        return request('start',true,function () { issued = true; },reply).then(function (ack) {
          if (ack.returnValue !== true) { issued = false; throw failure('PICCAP_START_UNCONFIRMED'); }
        });
      }).then(function () {
        var consecutive = 0;
        function sample() {
          return request('status').then(function (state) {
            consecutive = fresh(state) ? consecutive + 1 : 0;
            if (consecutive === 2) return {framesVerified:true};
            return pause().then(sample);
          });
        }
        return sample();
      });
    }).catch(function (error) {
      if (!issued && pendingStart === attempt) pendingStart = null;
      error.startIssued = issued; throw error;
    });
  }
  function stopNative(force) {
    return operation(12000,'PICCAP_STOP_UNCONFIRMED',function (request,pause) {
      function sample() {
        return request('status').then(function (state) {
          if (off(state)) return {stopped:true};
          return pause().then(sample);
        });
      }
      return request('status').then(function (state) {
        if (!force && off(state)) return {stopped:true};
        return request('stop',true).then(sample);
      });
    });
  }
  function stop() {
    if (durableUnknown) return Promise.reject(failure('PICCAP_RECOVERY_PENDING'));
    if (pendingStart) {
      pendingStart.rollback = true;
      return Promise.reject(failure('PICCAP_STOP_UNCONFIRMED'));
    }
    return cleanup || stopNative(false);
  }
  return {inspect:inspect,start:start,stop:stop,markUncertain:function () { durableUnknown = true; }};
};
