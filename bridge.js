(function () {
  'use strict';

  window.createTVBridge = function (sdk, onTV, timeoutMs) {
    var pending = [];
    var service = 'luna://com.webos.applicationManager';
    var YOUTUBE_ID = 'youtube.leanback.v4';

    function request(method, parameters) {
      return new Promise(function (resolve, reject) {
        if (!sdk || !sdk.service || typeof sdk.service.request !== 'function') {
          reject(new Error('Falta la biblioteca oficial webOSTV.js.'));
          return;
        }
        var token = { request: null };
        var done = false;
        pending.push(token);
        function finish(error, result) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          pending.splice(pending.indexOf(token), 1);
          if (error) reject(error);
          else resolve(result);
        }
        var timer = setTimeout(function () {
          try { if (token.request && token.request.cancel) token.request.cancel(); } catch (error) { /* Preserve the timeout result. */ }
          finish(new Error('No se pudo confirmar la respuesta de la TV.'));
        }, timeoutMs || 7000);
        try {
          token.request = sdk.service.request(service, {
            method: method,
            parameters: parameters,
            onSuccess: function (result) {
              if (!result || typeof result !== 'object') {
                finish(new Error('La TV devolvió una respuesta inválida.'));
              } else if (result.returnValue === false) {
                finish(new Error(result.errorText || 'La TV rechazó la solicitud.'));
              } else finish(null, result);
            },
            onFailure: function (result) {
              finish(new Error(result.errorText || 'La TV rechazó la solicitud.'));
            }
          });
        } catch (error) { finish(error); }
      });
    }

    function validId(id) {
      return typeof id === 'string' && /^[a-z0-9][a-z0-9._-]{0,127}$/i.test(id);
    }

    return {
      isTV: !!onTV,
      launch: function (id) {
        if (!validId(id)) return Promise.reject(new Error('Falta un identificador de app válido.'));
        if (!onTV) return Promise.resolve({ preview: true });
        return request('launch', { id: id, params: {} });
      },
      // contentTarget abrió el episodio en la LG de prueba, después del selector de perfiles.
      // Fuente del formato: https://github.com/hobbyquaker/lgtv2/issues/41#issuecomment-5370241499
      // Solo acepta un ID de video de 11 caracteres: nada de URLs ni parámetros libres.
      launchYouTubeVideo: function (videoId) {
        if (typeof videoId !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
          return Promise.reject(new Error('Falta un identificador de video válido.'));
        }
        if (!onTV) return Promise.resolve({ preview: true });
        return request('launch', {
          id: YOUTUBE_ID,
          params: { contentTarget: 'https://www.youtube.com/watch?v=' + videoId }
        });
      },
      listApps: function () {
        if (!onTV) return Promise.resolve([]);
        return request('listApps', {}).then(function (result) {
          if (result.returnValue !== true || !Array.isArray(result.apps)) {
            throw new Error('La TV no devolvió un catálogo de apps válido.');
          }
          return result.apps;
        });
      },
      isInstalled: function (id) {
        if (!onTV || !validId(id)) return Promise.resolve(null);
        return request('getAppLoadStatus', { appId: id }).then(function (result) {
          return typeof result.exist === 'boolean' ? result.exist : null;
        }, function () { return null; });
      }
    };
  };
}());
