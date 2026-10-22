'use strict';

// WiZ LAN: consultas getPilot/getSystemConfig y comandos setPilot por UDP 38899.
// Fuente: https://github.com/sbidy/pywizlight y DriverNetWiz de HyperHDR.
function integer(value, min, max) {
  return typeof value === 'number' && isFinite(value) && Math.floor(value) === value && value >= min && value <= max;
}
function privateIPv4(ip) {
  if (typeof ip !== 'string' || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) return false;
  var parts = ip.split('.');
  if (parts.some(function (part) { return String(Number(part)) !== part || !integer(Number(part), 0, 255); })) return false;
  var n = parts.map(Number);
  return n[3] !== 0 && n[3] !== 255 && (n[0] === 10 ||
    (n[0] === 172 && n[1] >= 16 && n[1] <= 31) || (n[0] === 192 && n[1] === 168));
}
function mac(value) {
  if (typeof value !== 'string') return null;
  var clean = value.toLowerCase().replace(/:/g, '');
  return /^[a-f0-9]{12}$/.test(clean) ? clean : null;
}
function command(state) {
  var allowed = ['on', 'brightness', 'rgb', 'temperature', 'sceneId'];
  if (!state || typeof state !== 'object' || Array.isArray(state) || !Object.keys(state).length ||
      Object.keys(state).some(function (key) { return allowed.indexOf(key) === -1; })) throw Error('Estado WiZ inválido.');
  var result = {};
  if (state.on !== undefined) {
    if (typeof state.on !== 'boolean') throw Error('Encendido inválido.');
    result.state = state.on;
  }
  if (state.brightness !== undefined) {
    if (!integer(state.brightness, 1, 100)) throw Error('Brillo inválido.');
    result.dimming = state.brightness;
  }
  if (state.rgb !== undefined) {
    if (!Array.isArray(state.rgb) || state.rgb.length !== 3 ||
        !state.rgb.every(function (v) { return integer(v, 0, 255); })) throw Error('Color RGB inválido.');
    result.r = state.rgb[0]; result.g = state.rgb[1]; result.b = state.rgb[2];
  }
  if (state.temperature !== undefined) {
    if (state.rgb !== undefined || !integer(state.temperature, 2200, 6500)) throw Error('Temperatura inválida o incompatible con RGB.');
    result.temp = state.temperature;
  }
  if (state.sceneId !== undefined) {
    // Restoration supports the bounded built-in scene ID space, not custom scenes.
    if (!integer(state.sceneId, 1, 255) || state.rgb !== undefined || state.temperature !== undefined) {
      throw Error('Escena inválida o incompatible con RGB o temperatura.');
    }
    result.sceneId = state.sceneId;
  }
  if (!Object.keys(result).length) throw Error('Estado WiZ inválido.');
  return result;
}
function parse(bytes, method) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 4096) return null;
  try {
    var packet = JSON.parse(bytes.toString('utf8'));
    if (!packet || packet.method !== method || packet.error || !packet.result ||
        typeof packet.result !== 'object' || Array.isArray(packet.result)) return null;
    return packet.result;
  } catch (error) { return null; }
}
function device(ip, pilot, system) {
  if (!privateIPv4(ip) || !pilot || !mac(pilot.mac)) return null;
  system = system || {};
  var identity = mac(pilot.mac);
  if (system.mac !== undefined && mac(system.mac) !== identity) return null;
  var moduleName = typeof system.moduleName === 'string' ? system.moduleName.slice(0, 80) : '';
  // pywizlight bulblibrary: RGB=color+CCT, TW=CCT, DW=solo dimming. Unknown stays unknown.
  var kind = /^ESP\d+_(?:SH)?(RGB|TW|DW)[A-Z0-9]*_/i.exec(moduleName);
  kind = kind ? kind[1].toUpperCase() : null;
  var rgb = [pilot.r, pilot.g, pilot.b];
  var scene = pilot.sceneId !== undefined && pilot.sceneId !== null && pilot.sceneId !== 0;
  var room = typeof system.roomId === 'number' && integer(system.roomId, 0, 999999999999) ? String(system.roomId) : '';
  return {
    id: 'wiz-' + identity, name: 'WiZ ' + identity.slice(-6).toUpperCase(), ip: ip,
    room: room, reachable: true,
    capabilities: {rgb: kind ? kind === 'RGB' : null, temperature: kind ? kind !== 'DW' : null},
    state: {
      on: typeof pilot.state === 'boolean' ? pilot.state : null,
      brightness: integer(pilot.dimming, 1, 100) ? pilot.dimming : null,
      rgb: !scene && rgb.every(function (v) { return integer(v, 0, 255); }) ? rgb : null,
      temperature: !scene && integer(pilot.temp, 1000, 10000) ? pilot.temp : null,
      sceneId: integer(pilot.sceneId, 1, 255) ? pilot.sceneId : null
    }
  };
}
module.exports = {command: command, parse: parse, device: device, privateIPv4: privateIPv4, mac: mac};
