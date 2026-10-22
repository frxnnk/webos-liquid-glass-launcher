(function () {
  'use strict';
  window.createLightsClient = function (sdk, onTV, options) {
    options = options || {};
    var ambient = null;
    var pendingMode = null;
    var mode = 'manual';
    var generation = 0;
    function finishMode(error) {
      if (!pendingMode) return;
      var pending = pendingMode;
      pendingMode = null; clearTimeout(pending.timer);
      if (error) pending.reject(error);
      else { mode = 'ambient'; pending.resolve({mode:'ambient'}); }
    }
    function stopAmbient() {
      generation++;
      if (ambient) ambient.stop();
      if (mode !== 'screen') mode = 'manual';
      finishMode(new Error('Se canceló el modo de acompañar fondo.'));
    }
    function hasAmbient() {
      return !!(onTV && window.LauncherAmbient && typeof options.source === 'function');
    }
    function getAmbient() {
      if (!ambient) ambient = window.LauncherAmbient.create({
        source:options.source,
        send:function (rgb, ids) {
          var sendingGeneration = generation;
          return request('setState',{ids:ids,rgb:rgb}).then(function (result) {
            var devices = result && result.devices || [];
            var failed = ids.filter(function (id) {
              return !devices.some(function (d) { return d.id === id && d.confirmed === true && !d.error && d.reachable !== false; });
            });
            if (failed.length) throw new Error('No se confirmó el color en ' + failed.length + ' lámparas.');
            if (sendingGeneration === generation) finishMode(null);
            return result;
          });
        },
        onError:function (error) {
          if (pendingMode) { finishMode(error); stopAmbient(); }
          if (options.onAmbientError) options.onAmbientError(error);
        }
      });
      return ambient;
    }
    function wallpaperMode(payload) {
      if (!onTV) return Promise.reject(new Error('Vista previa: no se contactan lámparas reales.'));
      if (!hasAmbient()) return Promise.reject(new Error('El modo de acompañar fondo no está disponible.'));
      var ids = payload.ids;
      if (payload.source !== 'wallpaper' || !Array.isArray(ids) || !ids.length || ids.length > 32 ||
          ids.some(function (id,index) { return typeof id !== 'string' || !/^wiz-[a-f0-9]{12}$/.test(id) || ids.indexOf(id) !== index; })) {
        return Promise.reject(new Error('Selección del living inválida.'));
      }
      stopAmbient();
      var intent = generation;
      return new Promise(function (resolve,reject) {
        pendingMode = {resolve:resolve,reject:reject,timer:setTimeout(function () {
          finishMode(new Error('No se pudo confirmar el color del fondo a tiempo.'));
          stopAmbient();
        },Math.min(options.timeoutMs || 7500,7500))};
        function fail(error) {
          if (intent !== generation) return;
          finishMode(error); stopAmbient();
        }
        function begin() {
          if (intent !== generation || !pendingMode) return;
          try { getAmbient().start(ids.slice()); } catch (error) { fail(error); }
        }
        if (mode === 'screen') {
          request('setMode',{mode:'manual'}).then(function (result) {
            if (intent !== generation || !pendingMode) return;
            if (!result || result.mode !== 'manual') throw new Error('No se confirmó la restauración de las luces.');
            mode = 'manual'; begin();
          }).catch(fail);
        } else begin();
      });
    }
    function request(method, payload) {
      if (!onTV) return Promise.reject(new Error('Vista previa: no se contactan lámparas reales.'));
      return new Promise(function (resolve, reject) {
        if (!sdk || !sdk.service || typeof sdk.service.request !== 'function') {
          reject(new Error('No está disponible la biblioteca del servicio de luces.')); return;
        }
        var done = false;
        var pending = null;
        function finish(error, result) {
          if (done) return;
          done = true; clearTimeout(timer);
          if (error) reject(error); else resolve(result);
        }
        var timer = setTimeout(function () {
          try { if (pending && pending.cancel) pending.cancel(); } catch (ignored) {}
          finish(new Error('No se pudo confirmar la respuesta de las luces.'));
        }, options.timeoutMs || (method === 'setMode' && payload && (payload.mode === 'screen' || payload.mode === 'manual') ? 25000 : 12000));
        try {
          pending = sdk.service.request('luna://com.frxn.mipantalla.lights', {
            method:method,parameters:payload || {},
            onSuccess:function (result) {
              if (!result || result.returnValue === false) {
                finish(new Error(result && result.errorText || 'El servicio de luces rechazó la solicitud.'));
              } else finish(null,result);
            },
            onFailure:function (error) {
              finish(new Error(error && error.errorText || 'El servicio de luces no está disponible.'));
            }
          });
        } catch (error) { finish(error); }
      });
    }
    return {
      capabilities:function () {
        if (!onTV) return Promise.resolve({available:false,screenSync:false,wallpaperSync:false,
          reason:'Vista previa: las luces reales se controlan desde la TV.'});
        return request('capabilities',{}).then(function (result) {
          result.wallpaperSync = hasAmbient();
          if (result.mode === 'screen') { stopAmbient(); mode = 'screen'; }
          else if (result.mode === 'manual' && mode !== 'ambient') mode = 'manual';
          result.mode = mode;
          return result;
        });
      },
      discover:function () { return request('discover',{}); },
      getState:function (payload) { return request('getState',payload); },
      screenStatus:function (payload) { return request('screenStatus',payload); },
      autoStatus:function () {
        if (!onTV) return Promise.resolve({available:false,enabled:false,state:'off',reason:'preview'});
        return request('autoStatus',{});
      },
      setAuto:function (payload) { return request('setAuto',payload); },
      // La TV le niega listApps a la app; el servicio (root) lo hace por ella.
      listApps:function () {
        if (!onTV) return Promise.resolve({apps:[]});
        return request('listApps',{});
      },
      setState:function (payload) {
        stopAmbient(); return request('setState',payload).then(function (result) {
          if (result.mode === 'manual') mode = 'manual'; return result;
        });
      },
      setMode:function (payload) {
        if (payload && payload.mode === 'ambient') return wallpaperMode(payload);
        stopAmbient(); return request('setMode',payload).then(function (result) {
          if (result.mode === 'manual' || result.mode === 'screen') mode = result.mode;
          return result;
        });
      },
      stopAmbient:stopAmbient,
      refreshAmbient:function () { if (ambient) ambient.refresh(); },
      visibilityChanged:function () { if (ambient) ambient.visibilityChanged(); }
    };
  };
  // Crear el cliente no inicia solicitudes; el panel decide cuándo consultar o cambiar luces.
  window.LAUNCHER_LIGHTS_CLIENT = window.createLightsClient(window.webOS, !!window.PalmSystem);
}());
