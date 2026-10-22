// Solo vista previa local (http://127.0.0.1:43817/?demo=lights). No va en el IPK: build.cjs copia una lista fija.
// Simula el servicio de luces para dibujar el panel completo, sin enviar nada a lámparas reales.
// Estados de Auto para ver cada variante: &auto=off|idle|waiting|syncing|stopping|error|starting
// Sin lámparas WiZ: &lamps=none
(function () {
  'use strict';
  // La demo parte siempre de la selección de lights-config.js, sin restos de otras pruebas.
  try { localStorage.removeItem('mi-pantalla-lights-living-v1'); } catch (error) { /* sin almacenamiento */ }
  var params = new URLSearchParams(location.search);
  var autoState = params.get('auto') || 'off';
  var fallback = ['aabbcc000001', 'aabbcc000002', 'aabbcc000003', 'aabbcc000004', 'aabbcc000005', 'aabbcc000006'].map(function (mac) { return 'wiz-' + mac; });
  // &lamps=none: lo que ve quien clona el repo y no tiene lámparas WiZ.
  var none = params.get('lamps') === 'none';
  if (none) window.LAUNCHER_LIGHTS = { selectedIds: [] };
  window.LAUNCHER_LIGHTS = window.LAUNCHER_LIGHTS || { selectedIds: fallback };
  var ids = none ? [] : (window.LAUNCHER_LIGHTS.selectedIds || fallback);
  var names = ['Techo', 'Sofá', 'Biblioteca', 'Escritorio', 'Lámpara de pie', 'Ventana'];
  var levels = [80, 60, 45, 70, 55, 35];
  var lamps = ids.map(function (id, i) {
    return { id: id, name: 'Living · ' + names[i % names.length], reachable: true,
      state: { on: true, brightness: levels[i % levels.length], rgb: i % 2 ? null : [255, 170, 70], temperature: i % 2 ? 2700 : null } };
  });
  var mode = autoState === 'syncing' ? 'screen' : 'manual';
  var auto = { available: true, enabled: autoState !== 'off', state: autoState, reason: autoState === 'error' ? 'auth-required' : '', apps: ['youtube.leanback.v4'] };
  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function later(value) { return new Promise(function (resolve) { setTimeout(function () { resolve(copy(value)); }, 60); }); }
  var client = {
    capabilities: function () { return later({ available: true, screenSync: true, wallpaperSync: true, demo: true, mode: mode }); },
    discover: function () { return later({ devices: lamps }); },
    getState: function () { return later({ devices: lamps }); },
    setState: function (payload) {
      lamps.forEach(function (lamp) {
        if (payload.ids.indexOf(lamp.id) === -1) return;
        if (typeof payload.on === 'boolean') lamp.state.on = payload.on;
        if (typeof payload.brightness === 'number') lamp.state.brightness = payload.brightness;
        if (payload.rgb) { lamp.state.rgb = payload.rgb; lamp.state.temperature = null; }
        if (payload.temperature) { lamp.state.temperature = payload.temperature; lamp.state.rgb = null; }
      });
      mode = 'manual';
      return later({ mode: 'manual', devices: lamps.filter(function (l) { return payload.ids.indexOf(l.id) !== -1; }).map(function (l) {
        return { id: l.id, name: l.name, reachable: true, confirmed: true, state: l.state }; }) });
    },
    setMode: function (payload) { mode = payload.mode; return later({ mode: mode }); },
    screenStatus: function () {
      return later({ configured: true, available: true, ready: mode !== 'screen', active: mode === 'screen', pending: false, captureStartReady: mode !== 'screen',
        configVerified: true, hardwareVerified: true, framesVerified: mode === 'screen', sourceFreshness: mode === 'screen' ? 'fresh' : 'unknown', reason: '', outputEnabled: mode === 'screen' });
    },
    autoStatus: function () { return later(auto); },
    setAuto: function (payload) { auto.enabled = payload.enabled; auto.state = payload.enabled ? 'idle' : 'off'; auto.reason = ''; return later(auto); },
    stopAmbient: function () {}, refreshAmbient: function () {}, visibilityChanged: function () {}
  };
  // app.js asigna su propio cliente: aquí se ignora esa asignación para que el panel use el simulado.
  Object.defineProperty(window, 'LAUNCHER_LIGHTS_CLIENT', { get: function () { return client; }, set: function () {} });
}());
