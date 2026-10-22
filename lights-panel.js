// Luces WiZ del living: panel que controla solo las lámparas marcadas a mano. Este módulo no habla
// con la red: usa el cliente que entrega el proyecto padre (capabilities, discover, getState, setState,
// setMode, screenStatus). Pedidos: capabilities y getState al abrir; el resto solo al pulsar OK.
// Nada se da por aplicado sin respuesta: sin respuesta a tiempo, el estado queda desconocido.
(function () {
  'use strict';
  var STORAGE_KEY = 'mi-pantalla-lights-living-v1';
  var ID = /^[A-Za-z0-9:._-]{1,64}$/;
  var TIMEOUT_MS = 8000;
  var SCREEN_MODE_MS = 25000;
  var DISCOVER_MS = 15000;
  var LEVELS = [10, 25, 50, 75, 100];
  var COLORS = [['Ámbar', [255, 150, 40]], ['Rojo', [255, 45, 55]], ['Rosa', [255, 85, 170]], ['Violeta', [150, 75, 255]], ['Azul', [45, 115, 255]], ['Verde', [40, 210, 115]]];
  var WHITES = [['Cálido', 2700], ['Neutro', 4000], ['Frío', 6500]];
  var MODES = [['manual', 'Manual'], ['ambient', 'Acompañar fondo'], ['screen', 'Pantalla completa']];
  var SCREEN_REASONS = {
    'setup-pending': 'captura pendiente de verificar en esta TV; falta configurar la captura.',
    'config-invalid': 'revisá la configuración de captura.', 'offline': 'el servicio de captura no está disponible.',
    'auth-required': 'la captura necesita autorización.', 'admin-required': 'la captura necesita permisos de administración.',
    'instance-mismatch': 'la instancia de captura no coincide.', 'profile-mismatch': 'el perfil de captura no coincide.',
    'selection-required': 'marcá las lámparas del living.', 'selection-mismatch': 'las lámparas no coinciden con el perfil de captura.',
    'frames-unverified': 'captura pendiente de verificar en esta TV.',
    'capture-not-ready': 'no se pudo verificar que la captura esté lista para iniciar.',
    'hardware-unverified': 'la salida física de esta TV todavía no está verificada.',
    'output-in-use': 'la salida de luces está en uso.',
    'restore-pending': 'la restauración debe terminar antes de nuevos cambios.', 'busy': 'la captura está ocupada.',
    'protocol-error': 'no se pudo verificar la captura.', 'timeout': 'la captura no respondió a tiempo.'
  };

  function text(value, max) {
    if (typeof value !== 'string') return '';
    var clean = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
    return clean.length > max ? clean.slice(0, max - 1) + '…' : clean;
  }
  function byte(value) { return typeof value === 'number' && value >= 0 && value <= 255 && Math.round(value) === value; }
  // Solo se conserva lo que la UI muestra: la IP y cualquier otro campo se descartan acá.
  function cleanDevice(raw) {
    if (!raw || typeof raw.id !== 'string' || !ID.test(raw.id)) return null;
    var s = raw.state || {};
    var level = typeof s.brightness === 'number' && s.brightness >= 0 && s.brightness <= 100 ? Math.round(s.brightness) : null;
    return {
      id: raw.id, name: text(raw.name, 40), reachable: raw.reachable !== false, note: text(raw.error, 80) ? 'Error: ' + text(raw.error, 80) : '',
      state: {
        on: typeof s.on === 'boolean' ? s.on : null, brightness: level,
        rgb: Array.isArray(s.rgb) && s.rgb.length === 3 && s.rgb.every(byte) ? s.rgb.slice() : null,
        temperature: typeof s.temperature === 'number' && s.temperature >= 1000 && s.temperature <= 10000 ? s.temperature : null
      }
    };
  }
  function cleanList(result) {
    if (!result || !Array.isArray(result.devices)) return null;
    var seen = {};
    return result.devices.map(cleanDevice).filter(function (d) { return d && !seen[d.id] && (seen[d.id] = true); });
  }
  function unknownState() { return { on: null, brightness: null, rgb: null, temperature: null }; }
  function errorText(error) { return text(error && error.message ? error.message : String(error || ''), 120) || 'error del servicio'; }
  function emptyScreen(reason) {
    return { configured: false, available: false, configVerified: false, framesVerified: false, hardwareVerified: false, captureStartReady: false, pending: false,
      ready: false, active: false, sourceFreshness: 'unknown', reason: reason || 'setup-pending' };
  }
  function cleanScreen(raw) {
    var fields = ['configured', 'available', 'configVerified', 'framesVerified', 'hardwareVerified', 'ready', 'active'];
    if (!raw || typeof raw.reason !== 'string' || fields.some(function (key) { return typeof raw[key] !== 'boolean'; }) ||
        (raw.captureStartReady !== undefined && typeof raw.captureStartReady !== 'boolean') ||
        (raw.pending !== undefined && typeof raw.pending !== 'boolean') ||
        ['unknown', 'fresh'].indexOf(raw.sourceFreshness) === -1 ||
        (raw.reason !== '' && !Object.prototype.hasOwnProperty.call(SCREEN_REASONS, raw.reason))) return emptyScreen('protocol-error');
    var result = emptyScreen();
    fields.forEach(function (key) { result[key] = raw[key]; });
    result.sourceFreshness = raw.sourceFreshness;
    result.reason = raw.reason;
    var verified = raw.reason === '' && raw.configured && raw.available && raw.configVerified && raw.hardwareVerified;
    var frames = raw.framesVerified && raw.sourceFreshness === 'fresh';
    result.pending = raw.pending === true;
    result.captureStartReady = raw.captureStartReady === true && verified && raw.pending === false && !raw.active && raw.outputEnabled !== true;
    result.active = raw.active && verified && frames;
    result.ready = raw.ready && verified && (frames || result.captureStartReady) && !result.active && !result.pending;
    return result;
  }
  // Auto: el interruptor vive en el servicio; el panel solo lo muestra y lo cambia.
  var AUTO_STATES = ['off', 'starting', 'idle', 'waiting', 'syncing', 'stopping', 'error'];
  function emptyAuto() { return { available: false, enabled: false, state: 'off', reason: '' }; }
  function cleanAuto(raw) {
    if (!raw || typeof raw.available !== 'boolean' || typeof raw.enabled !== 'boolean' || AUTO_STATES.indexOf(raw.state) === -1) return emptyAuto();
    return { available: raw.available, enabled: raw.enabled, state: raw.state, reason: typeof raw.reason === 'string' ? raw.reason.slice(0, 60) : '' };
  }
  function autoDetail(auto) {
    if (!auto.available) return 'No disponible';
    if (!auto.enabled) return 'Desactivado';
    if (auto.state === 'error') return 'Error: ' + (auto.reason || 'sin detalle');
    if (auto.state === 'syncing') return auto.reason === 'manual-session' ? 'Activado · sesión manual' : 'Activado · sincronizando';
    return 'Activado · ' + ({ starting: 'iniciando', idle: 'esperando YouTube', waiting: 'preparando', stopping: 'restaurando luces' }[auto.state] || 'esperando YouTube');
  }
  function screenAllowed(view) {
    return !!(view.caps && view.caps.screenSync && view.screen.ready && view.screen.configVerified && view.screen.hardwareVerified &&
      (view.screen.framesVerified || view.screen.captureStartReady) && !view.screen.pending);
  }
  function screenNote(screen) {
    if (screen.active) return 'Activo: captura de pantalla confirmada.';
    if (screen.ready && screen.captureStartReady && !screen.framesVerified) return 'Lista para iniciar captura; todavía no hay cuadros de video confirmados.';
    if (screen.ready) return 'Preparado: captura verificada; elegí Pantalla completa para activarla.';
    var reason = screen.reason || 'frames-unverified';
    var label = reason === 'setup-pending' ? 'Preparado' :
      reason === 'frames-unverified' || reason === 'hardware-unverified' || reason === 'selection-required' ? 'No verificado' : 'Error';
    return label + ': ' + SCREEN_REASONS[reason];
  }

  function createController(options) {
    var getClient = typeof options.client === 'function' ? options.client : function () { return options.client; };
    var storage = options.storage || null;
    var setTimer = options.setTimer || setTimeout;
    var clearTimer = options.clearTimer || clearTimeout;
    var now = options.now || Date.now;
    var onChange = options.onChange || function () {};
    var session = 0;
    var modeEpoch = 0;
    var modePending = false;
    var view = { phase: 'closed', reason: '', caps: null, screen: emptyScreen(), auto: emptyAuto(), devices: [], selected: readSaved(), mode: null, busy: '', message: '', searched: false };

    function readSaved() {
      try {
        var raw = storage ? storage.getItem(STORAGE_KEY) : null;
        var stored = raw === null ? options.initialIds || [] : JSON.parse(raw);
        return Array.isArray(stored) ? stored.filter(function (id, at) { return typeof id === 'string' && ID.test(id) && stored.indexOf(id) === at; }).slice(0, 32) : [];
      } catch (error) { return []; }
    }
    function save() { try { if (storage) storage.setItem(STORAGE_KEY, JSON.stringify(view.selected)); } catch (error) { /* queda en memoria */ } }
    function find(id) { return view.devices.filter(function (d) { return d.id === id; })[0] || null; }
    function targets() { return view.selected.filter(find); }
    function changed() { onChange(view); }
    function confirmedMode(mode) {
      if (!MODES.some(function (entry) { return entry[0] === mode; })) return;
      view.mode = mode;
      if (mode !== 'screen') view.screen.active = false;
    }
    // Un pedido por vez; al cerrar o reabrir, las respuestas tardías se ignoran.
    function call(method, args, ms) {
      var epoch = session;
      return new Promise(function (resolve) {
        var done = false;
        var timer = setTimer(function () { finish({ timeout: true }); }, ms);
        function finish(outcome) {
          if (done) return;
          done = true;
          clearTimer(timer);
          resolve(epoch === session ? outcome : null);
        }
        try {
          var client = getClient();
          if (!client || typeof client[method] !== 'function') throw Error('el servicio no ofrece esta acción');
          Promise.resolve(args === undefined ? client[method]() : client[method](args)).then(function (result) { finish({ result: result }); }, function (error) { finish({ error: errorText(error) }); });
        } catch (error) { finish({ error: errorText(error) }); }
      });
    }
    function start(label) { view.busy = label; view.message = ''; changed(); }
    function unavailable(reason) { view.phase = 'unavailable'; view.reason = reason; view.busy = ''; changed(); }
    // Solo detiene ambient local; screen permanece hasta que el backend confirme parada y restauración.
    function stopLocalAmbient() {
      modeEpoch += 1;
      if (modePending) { modePending = false; view.busy = ''; }
      try {
        var client = getClient();
        if (client && typeof client.stopAmbient === 'function') client.stopAmbient();
      } catch (error) {
        if (view.mode !== 'screen') view.mode = null;
        view.message = 'No se pudo detener el seguimiento local: ' + errorText(error) + '.';
        return false;
      }
      if (view.mode !== 'screen') view.mode = 'manual';
      return true;
    }

    // Combina una respuesta de getState/setState: cada lámpara pedida queda confirmada, con error o desconocida.
    function merge(outcome, ids, verb) {
      view.busy = '';
      var list = outcome.result !== undefined ? cleanList(outcome.result) : null;
      if (outcome.error) { view.message = 'No se pudo ' + verb + ': ' + outcome.error + '.'; changed(); return; }
      if (outcome.result) confirmedMode(outcome.result.mode);
      var fresh = {};
      (list || []).forEach(function (d) { fresh[d.id] = d; });
      var count = { ok: 0, failed: 0, unknown: 0 };
      ids.forEach(function (id) {
        var known = find(id);
        var next = fresh[id];
        if (!next) {
          count.unknown += 1;
          if (known) { known.state = unknownState(); known.note = 'Sin confirmación'; }
          return;
        }
        if (!known) { known = { id: id, name: next.name }; view.devices.push(known); }
        known.name = next.name || known.name;
        known.reachable = next.reachable;
        known.note = next.reachable ? next.note : 'Sin conexión';
        if (next.note || !next.reachable) count.failed += 1; else count.ok += 1;
        known.state = next.reachable ? next.state : unknownState();
      });
      if (outcome.timeout) view.message = 'Sin respuesta a tiempo: el estado de ' + ids.length + (ids.length === 1 ? ' lámpara es desconocido.' : ' lámparas es desconocido.');
      else if (!list) view.message = 'Respuesta inválida del servicio: estado desconocido.';
      else if (count.failed || count.unknown) view.message = 'Confirmadas ' + count.ok + ' de ' + ids.length + (count.failed ? '; ' + count.failed + ' con error' : '') + (count.unknown ? '; ' + count.unknown + ' sin confirmación' : '') + '.';
      else view.message = verb === 'leer el estado' ? '' : 'Confirmado en ' + ids.length + (ids.length === 1 ? ' lámpara.' : ' lámparas.');
      changed();
    }

    function setState(patch, verb) {
      var ids = targets();
      if (view.phase !== 'ready' || view.busy || !ids.length) return Promise.resolve(false);
      if (!stopLocalAmbient()) { changed(); return Promise.resolve(false); }
      var payload = { ids: ids.slice() };
      Object.keys(patch).forEach(function (key) { payload[key] = patch[key]; });
      start('Enviando a ' + ids.length + (ids.length === 1 ? ' lámpara…' : ' lámparas…'));
      return call('setState', payload, TIMEOUT_MS).then(function (outcome) { if (outcome) merge(outcome, ids, verb); return !!outcome; });
    }

    function reviewScreen(epoch, afterMode, remainingMs) {
      view.screen = emptyScreen();
      if (remainingMs !== undefined && remainingMs <= 0) {
        view.screen = emptyScreen('timeout'); view.busy = '';
        view.message = 'Modo confirmado; captura sin confirmar. Podés revisar la captura o volver a Manual.';
        changed(); return Promise.resolve(false);
      }
      start('Revisando la captura…');
      return call('screenStatus', { ids: view.selected.slice() }, remainingMs === undefined ? TIMEOUT_MS : Math.min(TIMEOUT_MS, remainingMs)).then(function (outcome) {
        if (!outcome) return false;
        view.busy = '';
        if (epoch !== modeEpoch) { changed(); return false; }
        view.screen = outcome.timeout ? emptyScreen('timeout') : outcome.error ? emptyScreen('protocol-error') : cleanScreen(outcome.result);
        if (view.screen.active) confirmedMode('screen');
        else if (view.mode === 'screen' && view.screen.ready && outcome.result && outcome.result.pending === false) confirmedMode('manual');
        view.message = afterMode && (outcome.timeout || outcome.error || view.screen.reason === 'protocol-error') ?
          'Modo confirmado; captura sin confirmar. Podés revisar la captura o volver a Manual.' : screenNote(view.screen);
        changed();
        return view.screen.ready;
      });
    }

    function refreshAuto() {
      return call('autoStatus', undefined, TIMEOUT_MS).then(function (outcome) {
        if (!outcome) return false;
        view.auto = outcome.result && !outcome.error ? cleanAuto(outcome.result) : emptyAuto();
        changed();
        return view.auto.available;
      });
    }

    return {
      view: view,
      targets: targets,
      open: function () {
        session += 1;
        modeEpoch += 1; modePending = false;
        view.phase = 'checking';
        view.caps = null;
        view.screen = emptyScreen();
        view.auto = emptyAuto();
        view.mode = null;
        view.devices = []; // el estado de otra apertura ya no vale: solo vuelven las confirmadas
        view.searched = false;
        start('Consultando el servicio de luces…');
        return call('capabilities', undefined, TIMEOUT_MS).then(function (outcome) {
          if (!outcome) return;
          var caps = outcome.result;
          if (outcome.timeout) return unavailable('el servicio de luces no respondió a tiempo.');
          if (outcome.error) return unavailable(outcome.error === 'el servicio no ofrece esta acción' ? 'el servicio de luces no está instalado en esta tele.' : outcome.error);
          if (!caps || caps.available !== true) return unavailable(text(caps && caps.reason, 140) || 'el servicio de luces no está disponible.');
          view.caps = { screenSync: caps.screenSync === true, wallpaperSync: caps.wallpaperSync === true, demo: caps.demo === true };
          view.mode = MODES.some(function (entry) { return entry[0] === caps.mode; }) ? caps.mode : null;
          view.phase = 'ready';
          view.busy = '';
          if (view.caps.screenSync) refreshAuto();
          var saved = view.selected.slice();
          if (!saved.length) { changed(); return; }
          start('Leyendo el estado de tus lámparas…');
          return call('getState', { ids: saved }, TIMEOUT_MS).then(function (state) {
            if (!state) return;
            merge(state, saved, 'leer el estado');
            var missing = saved.filter(function (id) { return !find(id); }).length;
            if (missing) { view.message = (missing === 1 ? 'Una lámpara guardada no respondió' : missing + ' lámparas guardadas no respondieron') + '; buscá lámparas para revisarlas.'; changed(); }
          });
        });
      },
      close: function () {
        var pending = !!view.busy;
        session += 1;
        modeEpoch += 1; modePending = false;
        view.phase = 'closed';
        view.busy = '';
        view.message = '';
        return pending;
      },
      // Descubre lámparas; ninguna se marca sola y la selección guardada se revalida contra el resultado.
      discover: function () {
        if (view.mode === 'screen') { view.message = 'Volvé a Manual antes de buscar o cambiar las lámparas del living.'; changed(); return Promise.resolve(false); }
        if (view.phase !== 'ready' || view.busy) return Promise.resolve(false);
        start('Buscando lámparas WiZ en la red…');
        return call('discover', undefined, DISCOVER_MS).then(function (outcome) {
          if (!outcome) return false;
          view.busy = '';
          var list = outcome.result !== undefined ? cleanList(outcome.result) : null;
          if (outcome.timeout || outcome.error || !list) {
            view.message = outcome.timeout ? 'La búsqueda no terminó a tiempo; probá de nuevo.' : 'No se pudo buscar lámparas: ' + (outcome.error || 'respuesta inválida') + '.';
            changed();
            return false;
          }
          var before = view.selected.length;
          view.devices = list;
          view.searched = true;
          view.selected = view.selected.filter(find);
          view.screen = emptyScreen();
          save();
          var dropped = before - view.selected.length;
          var stopFailed = dropped && !stopLocalAmbient();
          view.message = (list.length ? (list.length === 1 ? 'Se encontró 1 lámpara' : 'Se encontraron ' + list.length + ' lámparas') + '. Marcá solo las del living.' : 'No se encontró ninguna lámpara WiZ en la red.') +
            (dropped ? ' Se quitaron ' + dropped + ' guardadas que ya no aparecen.' : '') + (stopFailed ? ' No se pudo detener el seguimiento local.' : '');
          changed();
          return true;
        });
      },
      toggle: function (id) {
        if (!find(id)) return;
        if (view.mode === 'screen') { view.message = 'Volvé a Manual antes de cambiar las lámparas del living.'; changed(); return; }
        stopLocalAmbient();
        view.screen = emptyScreen();
        var at = view.selected.indexOf(id);
        if (at === -1) view.selected.push(id); else view.selected.splice(at, 1);
        save();
        changed();
      },
      power: function (on) { return setState({ on: on }, on ? 'encender' : 'apagar'); },
      level: function (value) { return setState({ brightness: value }, 'cambiar el brillo'); },
      color: function (rgb) { return setState({ rgb: rgb.slice() }, 'cambiar el color'); },
      white: function (kelvin) { return setState({ temperature: kelvin }, 'cambiar el blanco'); },
      setAuto: function (on) {
        if (view.phase !== 'ready' || view.busy || typeof on !== 'boolean' || !view.auto.available || !(view.caps && view.caps.screenSync)) return Promise.resolve(false);
        start(on ? 'Activando Auto…' : 'Desactivando Auto…');
        return call('setAuto', { enabled: on }, TIMEOUT_MS).then(function (outcome) {
          if (!outcome) return false;
          view.busy = '';
          var ok = !outcome.timeout && !outcome.error;
          if (ok) view.auto = cleanAuto(outcome.result);
          ok = ok && view.auto.available && view.auto.enabled === on;
          view.message = ok ? (on ? 'Auto activado: la captura arranca sola al abrir YouTube y las luces vuelven al salir.' : 'Auto desactivado.') :
            outcome.timeout ? 'Sin respuesta a tiempo: Auto sin confirmar.' : 'No se pudo cambiar Auto' + (outcome.error ? ': ' + outcome.error : '') + '.';
          changed();
          return ok;
        });
      },
      screenStatus: function () {
        if (view.phase !== 'ready' || view.busy) return Promise.resolve(false);
        return reviewScreen(modeEpoch, false);
      },
      setMode: function (mode) {
        var ids = targets();
        var caps = view.caps || {};
        var allowed = mode === 'manual' || (mode === 'ambient' && caps.wallpaperSync) || (mode === 'screen' && screenAllowed(view));
        var restoring = mode === 'manual' && view.mode === 'screen';
        if (view.phase !== 'ready' || view.busy || (!ids.length && !restoring) || !allowed) return Promise.resolve(false);
        var previousMode = view.mode;
        var deadline = now() + SCREEN_MODE_MS;
        if (!stopLocalAmbient()) { changed(); return Promise.resolve(false); }
        var epoch = ++modeEpoch;
        modePending = true;
        start('Cambiando el modo…');
        // El backend valida la captura y restaura el estado base antes de confirmar Manual.
        return call('setMode', { mode: mode, source: mode === 'screen' ? 'screen' : 'wallpaper', ids: ids.slice() }, mode === 'screen' || mode === 'manual' ? SCREEN_MODE_MS : TIMEOUT_MS).then(function (outcome) {
          if (epoch !== modeEpoch) return false;
          modePending = false;
          if (!outcome) return false;
          view.busy = '';
          var ok = !!(outcome.result && outcome.result.mode === mode);
          if (!ok && (mode === 'screen' || mode === 'manual')) {
            view.screen = emptyScreen(outcome.timeout ? 'timeout' : 'protocol-error');
            if (mode === 'screen') view.mode = 'screen'; // recuperación posible; no afirma que haya video activo
          }
          if (outcome.timeout && mode === 'ambient' && previousMode !== 'screen') view.mode = null;
          else if (ok) confirmedMode(mode);
          if (ok && (mode === 'screen' || mode === 'manual')) return reviewScreen(epoch, true, deadline - now()).then(function () { return true; });
          view.message = ok ? '' : outcome.timeout ? (mode === 'manual' && view.mode !== 'screen' ? 'El seguimiento local está detenido; el servicio no confirmó el modo a tiempo.' : 'Sin respuesta a tiempo: el modo actual es desconocido.') : 'El servicio no confirmó el cambio de modo' + (outcome.error ? ': ' + outcome.error : '') + '.';
          changed();
          return ok;
        });
      }
    };
  }

  // ---------- Vista: completa el esqueleto de index.html ----------
  function element(tag, className, label) {
    var node = document.createElement(tag);
    node.className = className || '';
    if (label) node.textContent = label;
    return node;
  }
  function common(devices, read) {
    var values = devices.map(read);
    return values.length && values[0] !== null && values.every(function (v) { return String(v) === String(values[0]); }) ? values[0] : null;
  }
  function describe(d) {
    if (!d.reachable) return 'Sin conexión';
    if (d.note) return d.note;
    if (d.state.on === null) return 'Estado desconocido';
    return d.state.on ? 'Encendida' + (d.state.brightness !== null ? ' · ' + d.state.brightness + ' %' : '') : 'Apagada';
  }

  function mount(options) {
    var host = options.host;
    var button = options.button;
    var say = options.say || function () {};
    function q(selector) { return host.querySelector(selector); }
    var list = q('.lights-list');
    var controls = q('.lights-controls');
    var closeButton = q('.lights-close');
    var search = q('.lights-search');
    var open = false;
    var autoFocus = false;
    var lastFocus = null;
    var chips = [];
    var storage = null;
    try { storage = window.localStorage; } catch (error) { storage = null; }
    var controller = createController({ client: options.client, storage: storage, initialIds: options.initialIds, onChange: render });

    function chip(row, label, kind, value, action) {
      var node = element('button', 'lights-chip lights-' + kind, label);
      node.type = 'button';
      node.setAttribute('data-value', String(value));
      node.addEventListener('click', action);
      chips.push({ node: node, kind: kind, value: value });
      row.appendChild(node);
      return node;
    }
    function group(title, kind, parent) {
      var wrap = element('div', 'lights-group lights-group-' + kind);
      wrap.setAttribute('role', 'group');
      wrap.setAttribute('aria-label', title);
      wrap.appendChild(element('p', 'lights-label', title));
      var row = element('div', 'lights-row');
      wrap.appendChild(row);
      (parent || controls).appendChild(wrap);
      return row;
    }
    var mainCard = element('div', 'lights-main-card');
    var overview = element('div', 'lights-overview');
    var room = element('div', 'lights-room');
    room.appendChild(element('p', 'lights-label', 'Estado del living'));
    var powerState = element('p', 'lights-power-state');
    room.appendChild(powerState);
    overview.appendChild(room);
    var selectionCount = element('p', 'lights-selection-count');
    overview.appendChild(selectionCount);
    mainCard.appendChild(overview);
    var quick = element('div', 'lights-quick-controls');
    mainCard.appendChild(quick);
    controls.appendChild(mainCard);
    var row = group('Encendido', 'power', quick);
    chip(row, 'Encender', 'power', true, function () { controller.power(true); });
    chip(row, 'Apagar', 'power', false, function () { controller.power(false); });
    var brightness = element('div', 'lights-brightness');
    var levelValue = element('p', 'lights-level-value');
    var levelCaption = element('p', 'lights-level-caption');
    brightness.appendChild(levelValue);
    brightness.appendChild(levelCaption);
    quick.appendChild(brightness);
    var levelTrack = element('div', 'lights-level-track');
    levelTrack.setAttribute('aria-hidden', 'true');
    var levelFill = element('span', 'lights-level-fill');
    levelTrack.appendChild(levelFill);
    brightness.appendChild(levelTrack);
    row = group('Brillo', 'level', brightness);
    LEVELS.forEach(function (level) { chip(row, level + ' %', 'level', level, function () { controller.level(level); }); });
    row = group('Cómo acompañar tu espacio', 'modes');
    var descriptions = ['Color y brillo a tu gusto', 'La foto de Mi pantalla', 'El video de la TV'];
    MODES.forEach(function (entry, index) {
      var node = chip(row, '', 'mode', entry[0], function () { controller.setMode(entry[0]); });
      node.setAttribute('aria-label', entry[1] + '. ' + descriptions[index]);
      node.appendChild(element('span', 'lights-mode-index', '0' + (index + 1)));
      node.appendChild(element('span', 'lights-mode-title', entry[1]));
      node.appendChild(element('span', 'lights-mode-description', descriptions[index]));
      var detail = element('span', 'lights-mode-state');
      node.appendChild(detail);
      chips[chips.length - 1].detail = detail;
    });
    var autoNode = chip(row, '', 'autoswitch', 'auto', function () { controller.setAuto(!controller.view.auto.enabled); });
    autoNode.className += ' lights-mode lights-auto';
    autoNode.setAttribute('aria-label', 'Auto. Pantalla completa solo con YouTube');
    autoNode.appendChild(element('span', 'lights-auto-switch'));
    autoNode.appendChild(element('span', 'lights-mode-title', 'Auto'));
    autoNode.appendChild(element('span', 'lights-mode-description', 'Solo con YouTube'));
    var autoDetailNode = element('span', 'lights-mode-state');
    autoNode.appendChild(autoDetailNode);
    chips[chips.length - 1].detail = autoDetailNode;
    var palette = element('div', 'lights-palette');
    controls.appendChild(palette);
    row = group('Color del ambiente', 'colors', palette);
    COLORS.forEach(function (entry) {
      var node = chip(row, '', 'color', entry[1].join(','), function () { controller.color(entry[1]); });
      var swatch = element('span', 'lights-swatch');
      swatch.style.backgroundColor = 'rgb(' + entry[1].join(',') + ')';
      node.appendChild(swatch);
      node.appendChild(element('span', 'lights-swatch-name', entry[0]));
      node.setAttribute('aria-label', 'Color ' + entry[0].toLowerCase());
    });
    row = group('Blancos', 'whites', palette);
    WHITES.forEach(function (entry) {
      var node = chip(row, entry[0], 'white', entry[1], function () { controller.white(entry[1]); });
      node.setAttribute('aria-label', 'Blanco ' + entry[0].toLowerCase() + ', ' + entry[1] + ' K');
      node.appendChild(element('span', 'lights-white-temperature', entry[1] + ' K'));
    });
    var diagnostics = element('div', 'lights-diagnostics');
    var note = element('p', 'lights-note');
    diagnostics.appendChild(note);
    var review = element('button', 'lights-chip lights-screen-review', 'Revisar captura');
    review.type = 'button';
    review.addEventListener('click', function () { controller.screenStatus(); });
    diagnostics.appendChild(review);
    controls.appendChild(diagnostics);

    function enabled() {
      return Array.prototype.slice.call(host.querySelectorAll('button:not([disabled])')).filter(function (node) { return node.getClientRects().length > 0; });
    }
    function settle() {
      var preferred = list.querySelector('button[aria-checked="true"]:not([disabled])') || list.querySelector('button:not([disabled])') || (search.disabled ? closeButton : search);
      preferred.focus();
    }

    function renderList(view) {
      var active = document.activeElement;
      var focusId = active && active.parentNode === list ? active.getAttribute('data-lamp') : null;
      list.textContent = '';
      if (!view.devices.length) {
        list.appendChild(element('p', 'lights-empty', view.phase === 'unavailable' ? 'Sin servicio de luces no se pueden ver ni elegir lámparas.' :
          view.phase !== 'ready' ? 'Esperando al servicio de luces…' :
          view.searched ? 'No se encontró ninguna lámpara.' : 'Todavía no hay lámparas: pulsá Buscar lámparas. Ninguna se marca sola.'));
      }
      view.devices.forEach(function (d, index) {
        var name = d.name || 'Lámpara ' + (index + 1);
        var picked = view.selected.indexOf(d.id) !== -1;
        var node = element('button', 'lights-device' + (d.reachable ? '' : ' is-offline'));
        node.type = 'button';
        node.setAttribute('role', 'checkbox');
        node.setAttribute('aria-checked', picked ? 'true' : 'false');
        node.setAttribute('data-lamp', d.id);
        node.setAttribute('aria-label', name + ', ' + describe(d) + (picked ? ', en el living' : ''));
        node.disabled = view.phase !== 'ready' || view.mode === 'screen';
        node.appendChild(element('span', 'lights-check'));
        var label = element('span', 'lights-device-name', name);
        label.appendChild(element('small', '', describe(d)));
        node.appendChild(label);
        if (d.state.on && d.state.rgb) {
          var dot = element('span', 'lights-dot');
          dot.style.backgroundColor = 'rgb(' + d.state.rgb.join(',') + ')';
          node.appendChild(dot);
        }
        node.addEventListener('click', function () { controller.toggle(d.id); });
        list.appendChild(node);
        if (d.id === focusId) node.focus();
      });
    }

    function render(view) {
      var caps = view.caps || {};
      var chosen = view.devices.filter(function (d) { return view.selected.indexOf(d.id) !== -1; });
      var ready = view.phase === 'ready';
      var act = ready && chosen.length > 0;
      var manual = view.mode !== 'ambient' && view.mode !== 'screen';
      var current = {
        power: common(chosen, function (d) { return d.state.on; }),
        level: common(chosen, function (d) { return d.state.brightness; }),
        color: common(chosen, function (d) { return d.state.rgb ? d.state.rgb.join(',') : null; }),
        white: common(chosen, function (d) { return d.state.temperature; }),
        mode: view.mode
      };
      var complete = chosen.length > 0 && chosen.length === view.selected.length;
      var knownPower = complete && chosen.every(function (d) { return d.reachable && !d.note && d.state.on !== null; });
      var knownLevel = complete && chosen.every(function (d) { return d.reachable && !d.note && d.state.brightness !== null; });
      powerState.textContent = view.phase === 'checking' ? 'Consultando luces…' : !chosen.length && !view.selected.length ? 'Elegí tus lámparas' :
        !knownPower ? 'Estado sin confirmar' : current.power === true ? 'Luces encendidas' : current.power === false ? 'Luces apagadas' : 'Encendido mixto';
      selectionCount.textContent = view.selected.length + (view.selected.length === 1 ? ' lámpara seleccionada' : ' lámparas seleccionadas');
      levelValue.textContent = knownLevel ? current.level === null ? 'Mixto' : current.level + ' %' : '—';
      levelCaption.textContent = !knownLevel ? 'Brillo sin confirmar' : current.level === null ? 'Niveles diferentes' : 'Brillo del grupo';
      levelFill.style.width = knownLevel && current.level !== null ? current.level + '%' : '0%';
      levelTrack.setAttribute('data-known', knownLevel && current.level !== null ? 'true' : 'false');
      q('.lights-summary').textContent = view.phase === 'checking' ? 'Consultando el servicio de luces…' :
        view.phase === 'unavailable' ? 'Control de luces no disponible: ' + view.reason :
        (caps.demo ? 'Demo: no se envían cambios a lámparas reales. ' : '') +
        (chosen.length ? chosen.length + ' de ' + view.devices.length + ' marcadas para el living.' :
          view.devices.length ? 'Marcá las lámparas del living para controlarlas.' : 'Buscá lámparas y marcá solo las del living.');
      q('.lights-status').textContent = view.busy || view.message;
      host.setAttribute('aria-busy', view.busy ? 'true' : 'false');
      renderList(view);
      search.disabled = !ready || view.mode === 'screen';
      review.disabled = !ready || !!view.busy;
      chips.forEach(function (item) {
        if (item.kind === 'autoswitch') {
          item.node.disabled = !(ready && !view.busy && view.auto.available && caps.screenSync);
          item.node.setAttribute('aria-pressed', view.auto.enabled ? 'true' : 'false');
          item.detail.textContent = autoDetail(view.auto);
          return;
        }
        var restoring = item.kind === 'mode' && item.value === 'manual' && view.mode === 'screen';
        var allowed = restoring ? ready && !view.busy : act && (item.kind !== 'mode' || item.value === 'manual' || (item.value === 'ambient' ? caps.wallpaperSync : screenAllowed(view)));
        item.node.disabled = !allowed;
        item.node.setAttribute('aria-pressed', current[item.kind] !== null && String(current[item.kind]) === String(item.value) ? 'true' : 'false');
        if (item.detail) item.detail.textContent = current.mode === item.value ? item.value === 'screen' && !view.screen.active ? 'Sin confirmar' : 'Modo actual' : item.value === 'screen' ?
          (screenAllowed(view) ? view.screen.framesVerified ? 'Cuadros confirmados' : 'Lista para iniciar' : 'Sin verificar') : item.value === 'ambient' && !caps.wallpaperSync ? 'No disponible' : 'Disponible';
      });
      var notes = ['Acompañar fondo: solo la foto de Mi pantalla; no otras apps ni HDMI.'];
      if (!caps.wallpaperSync) notes.push('Acompañar fondo: pendiente del servicio de luces.');
      notes.push('Pantalla completa — ' + screenNote(view.screen));
      if (!manual) notes.push(view.mode === 'screen' ? 'Volvé a Manual para cambiar las lámparas; primero se detiene la captura y se restauran las luces.' : 'Un control manual detiene el seguimiento del fondo.');
      note.textContent = notes.join(' ');
      if (!open) return;
      if (autoFocus && view.phase !== 'checking' && !view.busy) { autoFocus = false; settle(); }
      var focused = document.activeElement;
      if (!focused || !host.contains(focused) || focused.disabled) settle();
    }

    // Control remoto: con el panel abierto, flechas, Tab y Atrás no llegan al manejador de app.js.
    function moveFocus(key) {
      var buttons = enabled();
      var active = document.activeElement;
      if (buttons.indexOf(active) === -1) { settle(); return; }
      var origin = active.getBoundingClientRect();
      var x = origin.left + origin.width / 2;
      var y = origin.top + origin.height / 2;
      var best = null;
      var score = Infinity;
      buttons.forEach(function (node) {
        if (node === active) return;
        var rect = node.getBoundingClientRect();
        var dx = rect.left + rect.width / 2 - x;
        var dy = rect.top + rect.height / 2 - y;
        var forward = key === 'ArrowRight' ? dx : key === 'ArrowLeft' ? -dx : key === 'ArrowDown' ? dy : -dy;
        var cross = key === 'ArrowRight' || key === 'ArrowLeft' ? Math.abs(dy) : Math.abs(dx);
        if (forward > 3 && forward + cross * 4 < score) { best = node; score = forward + cross * 4; }
      });
      if (best) best.focus();
    }
    function onKey(event) {
      var key = event.key;
      if (key === 'Escape' || event.keyCode === 461) closePanel();
      else if (/^Arrow(Left|Right|Up|Down)$/.test(key)) moveFocus(key);
      else if (key === 'Tab') {
        var buttons = enabled();
        var at = buttons.indexOf(document.activeElement) + (event.shiftKey ? -1 : 1);
        buttons[(at + buttons.length) % buttons.length].focus();
      } else return;
      event.preventDefault();
      event.stopPropagation();
    }
    // La lista recorta: la fila con foco (flechas, Tab o tras redibujar) se desplaza a la vista.
    function guard(event) {
      if (!open) return;
      if (!host.contains(event.target)) settle();
      else if (event.target.parentNode === list) event.target.scrollIntoView({ block: 'nearest' });
    }

    function openPanel() {
      if (open) return;
      open = true;
      autoFocus = true;
      lastFocus = document.activeElement;
      host.hidden = false;
      document.body.classList.add('is-lights');
      window.addEventListener('keydown', onKey, true);
      document.addEventListener('focusin', guard, true);
      say('');
      closeButton.focus();
      controller.open();
    }
    function closePanel() {
      if (!open) return;
      open = false;
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', guard, true);
      if (controller.close()) say('Luces: el último pedido no llegó a confirmarse.', 6000);
      host.hidden = true;
      document.body.classList.remove('is-lights');
      var target = lastFocus && document.body.contains(lastFocus) && !lastFocus.disabled && lastFocus.getClientRects().length ? lastFocus : button;
      lastFocus = null;
      target.focus();
    }
    function onSearch() { controller.discover(); }
    button.addEventListener('click', openPanel);
    closeButton.addEventListener('click', closePanel);
    search.addEventListener('click', onSearch);
    button.hidden = false;
    render(controller.view);
    return {
      open: openPanel,
      close: closePanel,
      isOpen: function () { return open; },
      controller: controller,
      destroy: function () {
        closePanel();
        button.removeEventListener('click', openPanel);
        closeButton.removeEventListener('click', closePanel);
        search.removeEventListener('click', onSearch);
        button.hidden = true;
        list.textContent = '';
        controls.textContent = '';
        chips = [];
      }
    };
  }

  window.LauncherLights = {
    STORAGE_KEY: STORAGE_KEY,
    cleanDevice: cleanDevice,
    createController: createController,
    mount: mount
  };
}());
