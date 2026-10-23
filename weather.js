// Clima actual con Open-Meteo (HTTPS, sin clave ni backend). Solo pide datos si
// weather-config.js define coordenadas válidas; nunca usa geolocalización del navegador.
// Un valor que no se pudo validar se muestra como desconocido, nunca como 0.
(function () {
  'use strict';
  var ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
  var CURRENT = 'temperature_2m,apparent_temperature,weather_code,is_day';
  var DAILY = 'temperature_2m_max,temperature_2m_min';
  var REFRESH_MS = 15 * 60 * 1000;
  var STALE_MS = 30 * 60 * 1000;     // más viejo: se marca "Último dato HH:MM"
  var MAX_AGE_MS = 3 * 60 * 60 * 1000; // más viejo: no se muestra como clima actual
  var RETRY_MS = 60 * 1000;
  var TIMEOUT_MS = 8000;
  var CACHE_KEY = 'mi-pantalla-weather-v1';

  // Códigos WMO documentados por Open-Meteo → [condición, ícono]. El ícono es el nombre del
  // archivo en assets/weather/; despejado y parcial suman -dia/-noche en describe().
  var CODES = {
    0: ['Despejado', 'despejado'], 1: ['Mayormente despejado', 'parcial'], 2: ['Parcialmente nublado', 'parcial'],
    3: ['Nublado', 'nublado'], 45: ['Niebla', 'niebla'], 48: ['Niebla con escarcha', 'niebla'],
    51: ['Llovizna débil', 'llovizna'], 53: ['Llovizna', 'llovizna'], 55: ['Llovizna intensa', 'llovizna'],
    56: ['Llovizna helada', 'llovizna'], 57: ['Llovizna helada intensa', 'llovizna'],
    61: ['Lluvia débil', 'lluvia'], 63: ['Lluvia', 'lluvia'], 65: ['Lluvia intensa', 'lluvia'],
    66: ['Lluvia helada', 'lluvia'], 67: ['Lluvia helada intensa', 'lluvia'],
    71: ['Nevada débil', 'nieve'], 73: ['Nevada', 'nieve'], 75: ['Nevada intensa', 'nieve'], 77: ['Nieve granulada', 'nieve'],
    80: ['Chaparrones', 'lluvia'], 81: ['Chaparrones fuertes', 'lluvia'], 82: ['Chaparrones violentos', 'lluvia'],
    85: ['Chaparrones de nieve', 'nieve'], 86: ['Chaparrones de nieve intensos', 'nieve'],
    95: ['Tormenta', 'tormenta'], 96: ['Tormenta con granizo', 'tormenta'], 97: ['Tormenta fuerte', 'tormenta'], 99: ['Tormenta con granizo fuerte', 'tormenta']
  };
  var REASONS = {
    'no-config': 'Falta configurar la zona',
    offline: 'Sin conexión',
    network: 'Sin conexión con el servicio',
    timeout: 'El servicio no respondió',
    http: 'Servicio no disponible',
    invalid: 'Respuesta no válida'
  };

  function isNumber(value) { return typeof value === 'number' && isFinite(value); }
  function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : ''; }

  function validConfig(config) {
    if (!config || typeof config !== 'object') return null;
    var lat = config.latitude;
    var lon = config.longitude;
    if (!isNumber(lat) || !isNumber(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    if (!text(config.timezone) || !text(config.name)) return null;
    return { name: text(config.name), region: text(config.region), latitude: lat, longitude: lon, timezone: text(config.timezone) };
  }

  function buildUrl(config) {
    return ENDPOINT +
      '?latitude=' + encodeURIComponent(String(config.latitude)) +
      '&longitude=' + encodeURIComponent(String(config.longitude)) +
      '&current=' + encodeURIComponent(CURRENT).replace(/%2C/g, ',') +
      '&daily=' + encodeURIComponent(DAILY).replace(/%2C/g, ',') + '&forecast_days=1' +
      '&timezone=auto';
  }

  // Devuelve una lectura validada o null. 0 °C es válido; null, NaN o texto no lo son.
  function parseForecast(body) {
    if (!body || typeof body !== 'object' || body.error) return null;
    var current = body.current;
    if (!current || typeof current !== 'object') return null;
    // Open-Meteo entrega hora local sin sufijo: el offset de la respuesta la convierte a UTC.
    var local = typeof current.time === 'string' && /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(:\d{2})?$/.exec(current.time);
    var offset = body.utc_offset_seconds;
    if (!local || !isNumber(offset) || offset % 1 || Math.abs(offset) > 64800) return null;
    var iso = local[1] + (local[2] || ':00');
    var stamp = Date.parse(iso + 'Z');
    if (!isNumber(stamp) || new Date(stamp).toISOString().slice(0, 19) !== iso) return null;
    var units = body.current_units;
    if (units && units.temperature_2m !== undefined && units.temperature_2m !== '°C') return null;
    var temperature = current.temperature_2m;
    var code = current.weather_code;
    if (!isNumber(temperature) || temperature < -90 || temperature > 60) return null;
    if (!isNumber(code) || code % 1 !== 0 || !CODES.hasOwnProperty(code)) return null;
    if (current.is_day !== 0 && current.is_day !== 1) return null;
    var apparent = current.apparent_temperature;
    // Máxima y mínima del día: opcionales; si no son válidas no se muestran, la lectura actual sigue.
    var daily = body.daily && typeof body.daily === 'object' ? body.daily : {};
    var max = Array.isArray(daily.temperature_2m_max) ? daily.temperature_2m_max[0] : null;
    var min = Array.isArray(daily.temperature_2m_min) ? daily.temperature_2m_min[0] : null;
    var range = isNumber(max) && isNumber(min) && max >= min && max <= 60 && min >= -90;
    return {
      temperature: temperature,
      apparent: isNumber(apparent) && apparent >= -100 && apparent <= 70 ? apparent : null,
      max: range ? max : null,
      min: range ? min : null,
      code: code,
      isDay: current.is_day === 1,
      validAt: stamp - offset * 1000
    };
  }

  function describe(reading) {
    var entry = CODES[reading.code];
    var icon = entry[1];
    if (icon === 'despejado') icon += reading.isDay ? '-dia' : '-noche';
    else if (icon === 'parcial' && !reading.isDay) icon = 'parcial-noche';
    return { label: entry[0], icon: icon };
  }
  // Rutas literales: así el empaquetado y la vista previa autocontenida las encuentran en el código.
  var ICONS = {
    'despejado-dia': 'assets/weather/despejado-dia.svg', 'despejado-noche': 'assets/weather/despejado-noche.svg',
    parcial: 'assets/weather/parcial.svg', 'parcial-noche': 'assets/weather/parcial-noche.svg',
    nublado: 'assets/weather/nublado.svg', niebla: 'assets/weather/niebla.svg', llovizna: 'assets/weather/llovizna.svg',
    lluvia: 'assets/weather/lluvia.svg', nieve: 'assets/weather/nieve.svg', tormenta: 'assets/weather/tormenta.svg',
    desconocido: 'assets/weather/desconocido.svg'
  };
  function iconUrl(name) { return ICONS.hasOwnProperty(name) ? ICONS[name] : ICONS.desconocido; }

  function degrees(value) {
    var rounded = Math.round(value);
    return (rounded === 0 ? 0 : rounded) + '°'; // evita "-0°"
  }

  // GET JSON por XHR con timeout. Llama done(error, body) una sola vez; error.kind clasifica la falla.
  function requestJSON(url, timeoutMs, done) {
    var finished = false;
    function finish(error, body) {
      if (finished) return;
      finished = true;
      done(error, body);
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { finish({ kind: 'offline' }); return; }
    var xhr;
    try {
      xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.timeout = timeoutMs;
    } catch (error) { finish({ kind: 'network' }); return; }
    xhr.onload = function () {
      if (xhr.status !== 200) { finish({ kind: 'http', status: xhr.status }); return; }
      var body;
      try { body = JSON.parse(xhr.responseText); } catch (error) { finish({ kind: 'invalid' }); return; }
      finish(null, body);
    };
    xhr.onerror = function () { finish({ kind: 'network' }); };
    xhr.onabort = function () { finish({ kind: 'network' }); };
    xhr.ontimeout = function () { finish({ kind: 'timeout' }); };
    try { xhr.send(); } catch (error) { finish({ kind: 'network' }); }
  }

  // Reintenta solo fallas transitorias (red, timeout, 5xx), con espera creciente hasta la cadencia normal.
  function retryDelay(error, failures) {
    var transient = error.kind !== 'http' || !error.status || error.status >= 500 || error.status === 429;
    if (!transient) return REFRESH_MS;
    return Math.min(REFRESH_MS, RETRY_MS * Math.pow(2, Math.max(0, failures - 1)));
  }

  // Controlador sin DOM: decide cuándo pedir datos y qué estado mostrar.
  // options: config, render(view), request(url, timeout, done), now(), storage, isHidden(), setTimer, clearTimer.
  function createWeather(options) {
    var config = validConfig(options.config);
    var now = options.now || function () { return Date.now(); };
    var request = options.request || requestJSON;
    var storage = options.storage || null;
    var isHidden = options.isHidden || function () { return false; };
    var setTimer = options.setTimer || function (fn, ms) { return setTimeout(fn, ms); };
    var clearTimer = options.clearTimer || function (id) { clearTimeout(id); };
    var cache = null;
    var timer = null;
    var inFlight = false;
    var failures = 0;
    var lastError = null;

    function sameSpot(entry) {
      return entry && entry.latitude === config.latitude && entry.longitude === config.longitude;
    }
    if (config && storage) {
      try {
        var stored = JSON.parse(storage.getItem(CACHE_KEY) || 'null');
        var reading = stored && parseForecast(stored);
        if (reading && sameSpot(stored) && isNumber(stored.fetchedAt) && stored.fetchedAt <= now() &&
            now() - stored.fetchedAt <= MAX_AGE_MS && reading.validAt <= now() + 300000 &&
            now() - reading.validAt <= MAX_AGE_MS) cache = { fetchedAt: stored.fetchedAt, reading: reading };
      } catch (error) { cache = null; }
    }
    function age() {
      if (!cache) return Infinity;
      var fetchedAge = now() - cache.fetchedAt;
      var sourceAge = now() - cache.reading.validAt;
      // Una descarga reciente no rejuvenece un dato viejo; tolera solo 5 min de desfase de reloj.
      return fetchedAge < 0 || sourceAge < -300000 ? Infinity : Math.max(fetchedAge, sourceAge);
    }

    function view() {
      if (!config) return { state: 'unconfigured', reason: REASONS['no-config'] };
      var place = config.name;
      var currentAge = age();
      if (cache && currentAge <= MAX_AGE_MS) {
        return {
          state: currentAge > STALE_MS ? 'stale' : 'ok',
          place: place,
          reading: cache.reading,
          condition: describe(cache.reading),
          fetchedAt: cache.fetchedAt,
          validAt: cache.reading.validAt
        };
      }
      if (lastError) return { state: 'error', place: place, reason: REASONS[lastError] || REASONS.network };
      return { state: 'loading', place: place };
    }
    function publish() { options.render(view()); }

    function schedule(ms) {
      if (timer !== null) clearTimer(timer);
      timer = null;
      if (!config || isHidden()) return;
      timer = setTimer(function () { timer = null; refresh(); }, Math.max(1000, ms));
    }

    function refresh() {
      if (!config || inFlight || isHidden()) return;
      inFlight = true;
      request(buildUrl(config), TIMEOUT_MS, function (error, body) {
        inFlight = false;
        var reading = error ? null : parseForecast(body);
        if (reading && (reading.validAt > now() + 300000 || now() - reading.validAt > MAX_AGE_MS ||
            (cache && reading.validAt < cache.reading.validAt))) reading = null;
        if (reading) {
          cache = { fetchedAt: now(), reading: reading };
          failures = 0;
          lastError = null;
          if (storage) {
            try {
              storage.setItem(CACHE_KEY, JSON.stringify({
                latitude: config.latitude,
                longitude: config.longitude,
                fetchedAt: cache.fetchedAt,
                utc_offset_seconds: body.utc_offset_seconds,
                current: { time: body.current.time, temperature_2m: reading.temperature, apparent_temperature: reading.apparent, weather_code: reading.code, is_day: reading.isDay ? 1 : 0 },
                daily: { temperature_2m_max: [reading.max], temperature_2m_min: [reading.min] }
              }));
            } catch (storageError) { /* sin caché persistente: el widget sigue funcionando */ }
          }
          schedule(REFRESH_MS);
        } else {
          var failure = error || { kind: 'invalid' };
          failures += 1;
          lastError = REASONS[failure.kind] ? failure.kind : 'network';
          schedule(retryDelay(failure, failures));
        }
        publish();
      });
    }

    function resume() {
      if (!config) return;
      if (isHidden()) { schedule(0); return; } // schedule() limpia el timer si está oculto
      publish();
      var currentAge = age();
      if (currentAge >= REFRESH_MS) refresh();
      else if (timer === null && !inFlight) schedule(REFRESH_MS - currentAge);
    }

    return {
      start: function () { publish(); resume(); },
      visibilityChanged: resume,
      tick: publish,
      view: view
    };
  }

  // ---------- Presentación ----------
  function clock(time) {
    return new Date(time).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  // El estado del pie (punto verde o ámbar) acompaña a la tarjeta; es opcional.
  function statusText(view) {
    if (view.state === 'ok') return 'Clima actualizado a las ' + clock(view.fetchedAt);
    if (view.state === 'stale') return 'Último dato del clima: ' + clock(view.validAt);
    if (view.state === 'loading') return 'Consultando el clima…';
    return 'Clima no disponible: ' + view.reason;
  }
  function renderInto(root, view, status) {
    var icon = root.querySelector('.weather-icon');
    var temp = root.querySelector('.weather-temp');
    var condition = root.querySelector('.weather-condition');
    var range = root.querySelector('.weather-range');
    var meta = root.querySelector('.weather-meta');
    root.setAttribute('data-state', view.state);
    var iconName = 'desconocido';
    var rangeText = '';
    if (view.reading) {
      iconName = view.condition.icon;
      temp.textContent = degrees(view.reading.temperature);
      condition.textContent = [view.condition.label, view.reading.apparent === null ? '' : 'ST ' + degrees(view.reading.apparent)].filter(Boolean).join(' · ');
      if (view.reading.max !== null && view.reading.max !== undefined) rangeText = 'Máx ' + degrees(view.reading.max) + ' · Mín ' + degrees(view.reading.min);
      meta.textContent = view.state === 'stale' ? 'Último dato ' + clock(view.validAt) : view.place + ' · ' + clock(view.validAt);
      root.setAttribute('aria-label', 'Clima en ' + view.place + ': ' + view.condition.label + ', ' +
        Math.round(view.reading.temperature) + ' grados' +
        (view.reading.apparent === null ? '' : ', sensación térmica ' + Math.round(view.reading.apparent)) +
        (rangeText ? ', máxima ' + Math.round(view.reading.max) + ', mínima ' + Math.round(view.reading.min) : '') +
        (view.state === 'stale' ? '. Último dato de las ' : '. Dato de las ') + clock(view.validAt));
    } else {
      temp.textContent = '–';
      condition.textContent = view.state === 'loading' ? 'Clima' : 'Clima no disponible';
      meta.textContent = view.state === 'loading' ? 'Consultando…' : view.reason;
      root.setAttribute('aria-label', view.state === 'loading' ? 'Consultando el clima' : 'Clima no disponible: ' + view.reason);
    }
    if (range) { range.textContent = rangeText; range.hidden = !rangeText; }
    // Cambiar src recarga el SVG: solo cuando el ícono es otro.
    if (icon && icon.getAttribute('src') !== iconUrl(iconName)) icon.setAttribute('src', iconUrl(iconName));
    if (status) {
      status.setAttribute('data-state', view.state);
      status.textContent = statusText(view);
    }
  }

  function mount(root, config, status) {
    if (!root) return null;
    var storage = null;
    try { storage = window.localStorage; } catch (error) { storage = null; }
    var weather = createWeather({
      config: config,
      storage: storage,
      isHidden: function () { return document.hidden === true; },
      render: function (view) { renderInto(root, view, status || null); }
    });
    document.addEventListener('visibilitychange', weather.visibilityChanged);
    weather.start();
    return weather;
  }

  window.LauncherWeather = {
    validConfig: validConfig,
    buildUrl: buildUrl,
    parseForecast: parseForecast,
    describe: describe,
    iconUrl: iconUrl,
    statusText: statusText,
    renderInto: renderInto,
    degrees: degrees,
    retryDelay: retryDelay,
    createWeather: createWeather,
    requestJSON: requestJSON,
    mount: mount,
    REFRESH_MS: REFRESH_MS,
    STALE_MS: STALE_MS,
    MAX_AGE_MS: MAX_AGE_MS
  };
}());
