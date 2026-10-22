'use strict';
// message.sender is native LS2 metadata, not payload.sender. The wrapper strips WAM's PID suffix.
// https://webostv.developer.lge.com/develop/references/webos-service-reference#messagesender
module.exports = function register(service, controller) {
  ['capabilities','discover','getState','setState','setMode','screenStatus','autoStatus','setAuto','listApps'].forEach(function (method) {
    service.register(method,function (message) {
      function reply(payload) { try { message.respond(payload); } catch (ignored) {} }
      if (message.sender !== 'com.frxn.mipantalla') {
        reply({returnValue:false,errorCode:403,errorText:'Abrí el control de luces desde Mi pantalla.'});
        return;
      }
      Promise.resolve().then(function () {
        return controller[method](message.payload || {});
      }).then(function (result) {
        var response = {returnValue:true};
        Object.keys(result).forEach(function (key) { response[key] = result[key]; });
        reply(response);
      },function (error) {
        reply({returnValue:false,errorCode:500,errorText:error.message || 'No se pudo confirmar el control WiZ.'});
      });
    });
  });
};
