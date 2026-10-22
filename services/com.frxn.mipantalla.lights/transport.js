'use strict';
var dgram = require('dgram');
var os = require('os');
var protocol = require('./protocol');
var PORT = 38899;

function addressNumber(value) {
  if (typeof value !== 'string' || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return null;
  var parts = value.split('.').map(Number);
  if (parts.some(function (v) { return v < 0 || v > 255; })) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}
function addressText(n) { return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'); }
function networks(all) {
  var result = [];
  Object.keys(all).forEach(function (key) {
    all[key].forEach(function (entry) {
      if (entry.internal || (entry.family !== 'IPv4' && entry.family !== 4) || !protocol.privateIPv4(entry.address)) return;
      var address = addressNumber(entry.address);
      var mask = addressNumber(entry.netmask);
      if (mask === null || mask === 0 || mask === 4294967295) return;
      var broadcast = addressText(((address & mask) | ~mask) >>> 0);
      if (!result.some(function (n) { return n.broadcast === broadcast; })) result.push({address:address,mask:mask,broadcast:broadcast});
    });
  });
  return result;
}
function safeParameters(method, params) {
  params = params || {};
  if (method === 'getPilot' || method === 'getSystemConfig') {
    if (Object.keys(params).length) throw Error('Parámetros de consulta inválidos.');
    return {};
  }
  if (method !== 'setPilot' || Object.keys(params).some(function (key) {
    return ['state','dimming','r','g','b','temp','sceneId'].indexOf(key) === -1;
  })) throw Error('Método WiZ inválido.');
  var state = {};
  if (params.state !== undefined) state.on = params.state;
  if (params.dimming !== undefined) state.brightness = params.dimming;
  if (params.temp !== undefined) state.temperature = params.temp;
  if (params.sceneId !== undefined) state.sceneId = params.sceneId;
  if (params.r !== undefined || params.g !== undefined || params.b !== undefined) state.rgb = [params.r,params.g,params.b];
  return protocol.command(state);
}

module.exports = function createTransport(options) {
  options = options || {};
  var createSocket = options.socketFactory || function () { return dgram.createSocket('udp4'); };
  var interfaces = options.interfaces || os.networkInterfaces;
  var timeout = options.timeoutMs || 900;
  var discoveryTime = options.discoveryMs || 2200;
  function local(ip, nets) {
    var address = addressNumber(ip);
    return protocol.privateIPv4(ip) && nets.some(function (n) { return (address & n.mask) === (n.address & n.mask); });
  }
  function query(ip, method, params) {
    return new Promise(function (resolve, reject) {
      var nets = networks(interfaces());
      if (!local(ip,nets)) { reject(Error('Destino WiZ local inválido.')); return; }
      var payload;
      try { payload = Buffer.from(JSON.stringify({method:method,params:safeParameters(method,params)})); }
      catch (error) { reject(error); return; }
      var socket = createSocket();
      var done = false;
      function finish(error, result) {
        if (done) return;
        done = true; clearTimeout(timer);
        try { socket.close(); } catch (ignored) {}
        if (error) reject(error); else resolve(result);
      }
      var timer = setTimeout(function () { finish(Error('No se pudo confirmar la respuesta WiZ a tiempo.')); },timeout);
      socket.on('error',function (error) { finish(error); });
      socket.on('message',function (bytes, peer) {
        if (done || peer.address !== ip || peer.port !== PORT) return;
        var result = protocol.parse(bytes,method);
        if (result) finish(null,result);
      });
      try {
        socket.bind(0,function () {
          if (done) return;
          try { socket.send(payload,PORT,ip,function (error) { if (error) finish(error); }); }
          catch (error) { finish(error); }
        });
      } catch (error) { finish(error); }
    });
  }
  function discover() {
    return new Promise(function (resolve,reject) {
      var nets = networks(interfaces());
      if (!nets.length) { reject(Error('No hay una interfaz de red local disponible.')); return; }
      var found = {};
      var socket = createSocket();
      var done = false;
      function finish(error) {
        if (done) return;
        done = true; clearTimeout(timer);
        try { socket.close(); } catch (ignored) {}
        if (error) { reject(error); return; }
        resolve(Object.keys(found).map(function (key) { return found[key]; }));
      }
      var timer = setTimeout(function () { finish(); },discoveryTime);
      socket.on('error',function (error) { finish(error); });
      socket.on('message',function (bytes,peer) {
        if (done || peer.port !== PORT || !local(peer.address,nets)) return;
        var pilot = protocol.parse(bytes,'getPilot');
        var identity = pilot && protocol.mac(pilot.mac);
        if (!identity || found[identity] || Object.keys(found).length >= 64) return;
        found[identity] = {ip:peer.address,pilot:pilot};
      });
      try {
        socket.bind(0,function () {
          if (done) return;
          try {
            socket.setBroadcast(true);
            var packet = Buffer.from(JSON.stringify({method:'getPilot',params:{}}));
            nets.forEach(function (net) {
              socket.send(packet,PORT,net.broadcast,function (error) { if (error) finish(error); });
            });
          } catch (error) { finish(error); }
        });
      } catch (error) { finish(error); }
    }).then(function (found) {
      return Promise.all(found.map(function (entry) {
        return query(entry.ip,'getSystemConfig',{}).then(function (system) {
          entry.system = system; return entry;
        },function () { entry.system = {}; return entry; });
      }));
    });
  }
  return {query:query,discover:discover};
};
