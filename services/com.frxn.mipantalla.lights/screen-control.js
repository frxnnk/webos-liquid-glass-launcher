'use strict';
var path = require('path');
var loadSettings = require('./screen-settings');
var createRpc = require('./hyperhdr-rpc');
var createBackend = require('./screen-backend');
var createSession = require('./screen-session').create;
var createStore = require('./screen-store');
module.exports = function createScreenControl(lamps, options) {
  options = options || {};
  var config = loadSettings(path.join(__dirname,'screen-config.json'));
  var capture = options.capture, now = options.now || Date.now;
  function read(ids) { return lamps.read({ids:ids}); }
  var backend = createBackend({config:config,read:read,probe:options.probe,rpc:{
    connect:function () { return createRpc({token:config.token}).connect(); }
  }});
  function unavailable() { return Promise.reject(Error('PICCAP_UNAVAILABLE')); }
  function captureInspect() { return capture ? capture.inspect() : Promise.resolve({stopped:false,settingsVerified:false}); }
  function ownedIdle(status) {
    return status.available === true && status.configVerified === true && status.hardwareVerified === true && status.outputEnabled === false;
  }
  function inspect(ids) {
    return Promise.all([backend.inspect(ids),captureInspect()]).then(function (reports) {
      var report = reports[0], native = reports[1];
      report.captureStartReady = !!(ownedIdle(report) && capture && native.stopped === true && native.settingsVerified === true);
      report.ready = report.captureStartReady;
      if (report.ready) report.reason = '';
      else if (ownedIdle(report) && !report.framesVerified) report.reason = 'capture-not-ready';
      return report;
    });
  }
  var controlled = {
    inspect:inspect,
    start:function (ids) {
      var issued = false, deadline = now() + 20000;
      return backend.inspect(ids).then(function (status) {
        if (!ownedIdle(status) || !capture) throw Error('SCREEN_NOT_READY');
        return capture.inspect();
      }).then(function (native) {
        if (native.stopped !== true || native.settingsVerified !== true || now() >= deadline) throw Error('SCREEN_NOT_READY');
        return capture.start();
      }).then(function (frames) {
        issued = true;
        if (!frames || frames.framesVerified !== true || now() >= deadline) throw Error('SCREEN_NOT_READY');
        return backend.start(ids,{canContinue:function () { return now() < deadline; }});
      }).catch(function (error) {
        if (error && error.startIssued === true) issued = true;
        if (!issued) throw error;
        return capture.stop().then(function () { throw error; },function () { throw error; });
      });
    },
    stop:function (ids) {
      return (capture ? capture.stop() : unavailable()).then(function (native) {
        if (!native || native.stopped !== true) throw Error('PICCAP_STOP_UNCONFIRMED');
        return backend.stop(ids);
      });
    }
  };
  var session = createSession({backend:controlled,read:read,write:lamps.write,store:createStore()});
  // A prepared record from a previous service lifetime cannot prove its native Start ever settled.
  var initial = session.pending();
  if (initial && initial.phase === 'prepared' && capture && typeof capture.markUncertain === 'function') capture.markUncertain();
  return {
    pending:session.pending,start:session.start,stop:session.stop,
    status:function (ids) {
      return inspect(ids).then(function (status) {
        var pending = session.pending();
        status.pending = !!pending;
        status.phase = pending ? pending.phase : null;
        status.active = !!(pending && pending.phase === 'active' && Array.isArray(pending.ids) &&
          pending.ids.length === ids.length && pending.ids.every(function (id) { return ids.indexOf(id) !== -1; }) &&
          status.configured === true && status.available === true && status.configVerified === true &&
          status.hardwareVerified === true && status.framesVerified === true &&
          status.sourceFreshness === 'fresh' && status.outputEnabled === true);
        if (pending) { status.ready = false; status.captureStartReady = false; status.reason = status.active ? '' : 'restore-pending'; }
        return status;
      });
    }
  };
};
