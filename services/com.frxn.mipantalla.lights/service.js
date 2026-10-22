'use strict';
var Service = require('webos-service');
var service = new Service('com.frxn.mipantalla.lights',null,{noBuiltinMethods:true});
function call(uri,args,timeoutMs,onResponse) {
  return new Promise(function (resolve,reject) {
    var done = false;
    var timer = setTimeout(function () {
      if (done) return;
      done = true; reject(Error('La captura no respondió a tiempo.'));
    },timeoutMs || 1500);
    function finish(error,message) {
      if (done) return;
      done = true; clearTimeout(timer);
      if (error) reject(error); else resolve(message);
    }
    try {
      service.call(uri,args,function (message) {
        if (onResponse) { try { onResponse(message); } catch (ignored) {} }
        finish(null,message);
      });
    } catch (error) { finish(error); }
  });
}
var capture = require('./piccap-lifecycle')({call:call});
var controller = require('./controller')(require('./transport')(),{
  screenFactory:function (lamps,options) {
    options = options || {}; options.capture = capture;
    return require('./screen-control')(lamps,options);
  },
  screenProbe:require('./piccap-probe')({call:call}).read,
  auto:require('./auto-control')({config:require('./auto-config')()}),
  apps:require('./app-list')()
});
require('./api')(service,controller);
