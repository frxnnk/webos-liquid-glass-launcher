'use strict';
var protocol = require('./protocol');

function idsOf(payload) {
  var ids = payload && payload.ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > 32 || ids.some(function (id) {
    return typeof id !== 'string' || !/^wiz-[a-f0-9]{12}$/.test(id);
  }) || ids.some(function (id,index) { return ids.indexOf(id) !== index; })) throw Error('Selección WiZ inválida.');
  return ids.slice();
}
function unknown(id, error, entry) {
  return {id:id,name:entry ? entry.name : 'WiZ no encontrada',ip:entry ? entry.ip : '',
    reachable:false,state:null,confirmed:false,error:error.message || 'No se pudo confirmar el estado.'};
}
function matchesRequested(request, observed) {
  if (!observed) return false;
  if (request.on !== undefined && observed.on !== request.on) return false;
  if (request.brightness !== undefined && (observed.brightness === null || Math.abs(observed.brightness-request.brightness) > 1)) return false;
  if (request.sceneId !== undefined && observed.sceneId !== request.sceneId) return false;
  if (request.temperature !== undefined && (observed.temperature === null || Math.abs(observed.temperature-request.temperature) > 50)) return false;
  if (request.rgb && (!observed.rgb || request.rgb.some(function (v,i) { return Math.abs(v-observed.rgb[i]) > 2; }))) return false;
  return true;
}
function stateOf(payload) {
  var state = {};
  Object.keys(payload).forEach(function (key) { if (key !== 'ids') state[key] = payload[key]; });
  return {state:state,parameters:protocol.command(state)};
}
module.exports = function createController(transport, options) {
  var settle = options && options.settle || function () { return new Promise(function (resolve) { setTimeout(resolve,200); }); };
  var records = {};
  var discovery = null;
  var writing = false;
  var screen = null;
  function discover() {
    if (discovery) return discovery;
    discovery = transport.discover().then(function (found) {
      var next = {};
      found.forEach(function (raw) {
        var entry = protocol.device(raw.ip,raw.pilot,raw.system);
        if (entry && !next[entry.id]) next[entry.id] = entry;
      });
      records = next; discovery = null;
      return {devices:Object.keys(records).map(function (id) { return records[id]; })};
    },function (error) { discovery = null; throw error; });
    return discovery;
  }
  function ensure(ids) {
    return ids.some(function (id) { return !records[id]; }) ? discover() : Promise.resolve();
  }
  function read(id) {
    var entry = records[id];
    if (!entry) return Promise.reject(Error('Lámpara no encontrada en la red local.'));
    return transport.query(entry.ip,'getPilot',{}).then(function (pilot) {
      if (protocol.mac(pilot.mac) !== id.slice(4)) throw Error('La identidad de la lámpara cambió; volvé a buscar.');
      var device = protocol.device(entry.ip,pilot,{mac:id.slice(4)});
      device.name = entry.name; device.room = entry.room; device.capabilities = entry.capabilities;
      records[id] = device;
      return device;
    });
  }
  function getState(payload) {
    return Promise.resolve().then(function () {
      var ids = idsOf(payload);
      return ensure(ids).then(function () {
        return Promise.all(ids.map(function (id) {
          return read(id).catch(function (error) { return unknown(id,error,records[id]); });
        }));
      });
    }).then(function (devices) { return {devices:devices}; });
  }
  function setState(payload) {
    return Promise.resolve().then(function () {
      var ids = idsOf(payload);
      var checked = stateOf(payload);
      var state = checked.state, parameters = checked.parameters;
      if (writing) throw Error('Hay un cambio de luces en curso.');
      writing = true;
      return ensure(ids).then(function () {
        return Promise.all(ids.map(function (id) {
          return read(id).then(function (entry) {
            if (state.rgb && entry.capabilities.rgb === false) throw Error('Esta lámpara no permite color RGB.');
            if (state.temperature && entry.capabilities.temperature === false) throw Error('Esta lámpara no permite cambiar el blanco.');
            return transport.query(entry.ip,'setPilot',parameters).then(function (ack) {
              if (ack.success !== true) throw Error('La lámpara no confirmó el cambio.');
              return settle().then(function () { return read(id); }).then(function (observed) {
                observed.confirmed = matchesRequested(state,observed.state);
                if (!observed.confirmed) observed.error = 'El estado leído no coincide todavía con el cambio solicitado.';
                return observed;
              });
            });
          }).catch(function (error) { return unknown(id,error,records[id]); });
        }));
      }).then(function (devices) {
        writing = false; return {devices:devices};
      },function (error) { writing = false; throw error; });
    });
  }
  if (options && options.screenFactory) screen = options.screenFactory({
    read:getState,
    write:function (id, state) {
      var payload = {ids:[id]};
      Object.keys(state).forEach(function (key) { payload[key] = state[key]; });
      return setState(payload).then(function (result) {
        return {confirmed:result.devices.length === 1 && result.devices[0].id === id && result.devices[0].confirmed === true};
      });
    }
  },{probe:options.screenProbe});
  function stopScreen() { return screen && screen.pending() ? screen.stop() : Promise.resolve({active:false}); }
  function manualState(payload) {
    return Promise.resolve().then(function () {
      idsOf(payload); stateOf(payload); // Validate before stopping any current output.
      return stopScreen();
    }).then(function () { return setState(payload); }).then(function (result) {
      if (screen) result.mode = 'manual'; return result;
    });
  }
  return {
    discover:discover,getState:getState,setState:manualState,
    screenStatus:function (payload) {
      if (screen) return screen.status(payload && payload.ids || []);
      return Promise.resolve({configured:false,available:false,ready:false,active:false,configVerified:false,
        hardwareVerified:false,framesVerified:false,sourceFreshness:'unknown',reason:'setup-pending'});
    },
    capabilities:function () {
      return {available:true,screenSync:!!screen,wallpaperSync:false,mode:screen && screen.pending() ? 'screen' : 'manual',
        reason:screen ? 'La captura debe revisarse en esta TV antes de activarla.' : 'La captura no está disponible en esta TV.'};
    },
    setMode:function (payload) {
      if (payload && payload.mode === 'manual') return Promise.resolve().then(stopScreen).then(function () { return {mode:'manual'}; });
      if (screen && payload && payload.mode === 'screen' && payload.source === 'screen') {
        return Promise.resolve().then(function () { return screen.start(idsOf(payload)); }).then(function (result) {
          if (!result || result.active !== true) throw Error('No se confirmó el modo pantalla.');
          return {mode:'screen'};
        });
      }
      return Promise.reject(Error('La captura para este modo todavía no está disponible.'));
    }
  };
};
