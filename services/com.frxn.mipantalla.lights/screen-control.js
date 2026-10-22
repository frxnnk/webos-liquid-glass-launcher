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
  function read(ids) { return lamps.read({ids:ids}); }
  var backend = createBackend({config:config,read:read,probe:options.probe,rpc:{
    connect:function () { return createRpc({token:config.token}).connect(); }
  }});
  var session = createSession({backend:backend,read:read,write:lamps.write,store:createStore()});
  return {
    pending:session.pending,start:session.start,stop:session.stop,
    status:function (ids) {
      return backend.inspect(ids).then(function (status) {
        var pending = session.pending();
        status.pending = !!pending;
        status.phase = pending ? pending.phase : null;
        status.active = !!(pending && pending.phase === 'active' && Array.isArray(pending.ids) &&
          pending.ids.length === ids.length && pending.ids.every(function (id) { return ids.indexOf(id) !== -1; }) &&
          status.configured === true && status.available === true && status.configVerified === true &&
          status.hardwareVerified === true && status.framesVerified === true &&
          status.sourceFreshness === 'fresh' && status.outputEnabled === true);
        if (pending) { status.ready = false; status.reason = status.active ? '' : 'restore-pending'; }
        return status;
      });
    }
  };
};
