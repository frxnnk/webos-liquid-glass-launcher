// Fondos fotográficos que rotan con un fundido entre dos capas <img>.
// La lista base viene de wallpapers.js (window.LAUNCHER_WALLPAPERS): solo rutas de assets/wallpapers/;
// sin lista válida o si ninguna foto carga, se usa assets/wallpaper.svg. daily-photos.js puede
// reemplazarla con replace(): solo miniaturas de Wikimedia Commons con autor y licencia. Si ninguna
// foto remota carga, vuelve a la lista base.
// Vidrio sin backdrop-filter (Chromium 68): cada capa pinta una copia diminuta de su foto en un
// <canvas> detrás del dock; un blur único y el escalado por CSS lo vuelven esmerilado.
// Nunca se leen píxeles del canvas (una foto remota lo deja "tainted" y no importa).
(function () {
  'use strict';
  var ROTATE_MS = 150 * 1000; // 2:30 min
  var FADE_MS = 1200;
  var LOAD_TIMEOUT_MS = 15000;
  var INITIAL_REMOTE_TIMEOUT_MS = 1500;
  var DECODE_WAIT_MS = 2000;
  var FROST_WIDTH = 160;
  var FROST_BLUR = 3; // px de la miniatura ≈ 36 px a 1920
  var STORAGE_KEY = 'mi-pantalla-wallpaper-v1';
  var LOCAL_SRC = /^assets\/wallpapers\/\w[\w.-]*\.(?:jpe?g|webp|png)$/i;
  var INLINE_SRC = /^data:image\/(?:jpeg|webp|png);base64,/; // solo la vista previa autocontenida
  var REMOTE_SRC = /^https:\/\/(?:upload|thumb)\.wikimedia\.org\/wikipedia\/commons\/[\w\/.~%!$*(),;:@'+-]+\.jpe?g$/i;
  var REMOTE_PAGE = /^https:\/\/commons\.wikimedia\.org\/wiki\/File:[\w\/.~%!$*(),;:@'+-]+$/;
  var LICENSE_URL = /^https:\/\/creativecommons\.org\/[\w\/.-]+$/;

  function text(value) { return typeof value === 'string' ? value.trim().slice(0, 120) : ''; }
  function link(value, pattern) { return typeof value === 'string' && value.length <= 400 && pattern.test(value) ? value : ''; }

  // allowRemote habilita metadatos del día: wallpapers.js sigue limitado a archivos empaquetados.
  function cleanList(list, allowRemote) {
    if (!Array.isArray(list)) return [];
    var seen = {};
    var clean = [];
    list.forEach(function (entry) {
      if (!entry || typeof entry.src !== 'string') return;
      var src = entry.src.trim();
      var remote = allowRemote === true && REMOTE_SRC.test(src);
      if (!(remote || LOCAL_SRC.test(src) || INLINE_SRC.test(src)) || seen[src]) return;
      var item = { src: src, author: text(entry.author), source: text(entry.source) };
      if (remote) {
        // Una foto remota sin autor, licencia y página de origen no se muestra.
        item.source = '';
        item.provider = 'Wikimedia Commons';
        item.title = text(entry.title);
        item.license = text(entry.license);
        item.licenseUrl = link(entry.licenseUrl, LICENSE_URL);
        item.page = link(entry.page, REMOTE_PAGE);
        if (!item.author || !item.license || !item.page) return;
      }
      seen[src] = true;
      clean.push(item);
    });
    return clean;
  }

  function creditText(entry) {
    if (!entry) return '';
    if (entry.provider) return 'Foto: ' + [entry.author, entry.provider, entry.license].filter(Boolean).join(' · ');
    var source = entry.source;
    var host = /^https?:\/\/([^\/?#]+)/i.exec(source);
    if (host) source = host[1].replace(/^www\./i, '');
    var parts = [entry.author, source].filter(Boolean);
    return parts.length ? 'Foto: ' + parts.join(' · ') : '';
  }

  // Datos completos de la foto a la vista para el panel Fuentes: pares [etiqueta, texto plano].
  function sourceDetails(entry) {
    if (!entry) return [];
    if (entry.provider) {
      return [
        ['Foto', entry.title || 'Sin título'],
        ['Autor', entry.author],
        ['Licencia', entry.license + (entry.licenseUrl ? ' · ' + entry.licenseUrl : '')],
        ['Origen', entry.provider + ' · ' + entry.page]
      ];
    }
    if (!entry.author && !entry.source) return [['Fondo', 'Ilustración incluida en la app']];
    return [['Foto', 'Incluida en la app'], ['Autor', entry.author || 'Sin dato'], ['Origen', entry.source || 'Sin dato']];
  }

  // Siguiente foto utilizable después de from (o la primera si from es -1); -1 si no queda ninguna.
  function nextIndex(list, from) {
    for (var step = 1; step <= list.length; step += 1) {
      var candidate = (from + step + list.length) % list.length;
      if (!list[candidate].failed) return candidate;
    }
    return -1;
  }

  function startIndex(list, lastSrc) {
    for (var i = 0; i < list.length; i += 1) if (list[i].src === lastSrc) return nextIndex(list, i);
    return nextIndex(list, -1);
  }

  // Pinta directamente a 160 px: evita buffers intermedios grandes que frenaban la TV.
  // La base rellena bordes y el blur pequeño suaviza la miniatura al ampliarla en el dock.
  function paintFrost(canvas, image) {
    var width = image.naturalWidth || 1920;
    var height = image.naturalHeight || 1080;
    var targetHeight = Math.max(1, Math.round(FROST_WIDTH * height / width));
    try {
      canvas.width = FROST_WIDTH;
      canvas.height = targetHeight;
      var context = canvas.getContext('2d');
      context.clearRect(0, 0, FROST_WIDTH, targetHeight);
      context.drawImage(image, 0, 0, FROST_WIDTH, targetHeight);
      if (typeof context.filter === 'string') {
        // La base sin desenfoque rellena los bordes, que el blur dejaría transparentes.
        context.filter = 'blur(' + FROST_BLUR + 'px)';
        context.drawImage(image, 0, 0, FROST_WIDTH, targetHeight);
        context.filter = 'none';
      }
      canvas.setAttribute('data-width', width);
      canvas.setAttribute('data-height', height);
      return true;
    } catch (error) { return false; }
  }

  // Ubica el canvas como si fuera la foto en "cover" sobre el escenario, visto desde el dock.
  function placeFrost(canvas, stage, host) {
    var width = Number(canvas.getAttribute('data-width'));
    var height = Number(canvas.getAttribute('data-height'));
    if (!width || !height) return;
    var area = stage.getBoundingClientRect();
    var box = host.getBoundingClientRect();
    var scale = Math.max(area.width / width, area.height / height);
    var w = width * scale;
    var h = height * scale;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.style.left = (area.left + (area.width - w) / 2 - box.left) + 'px';
    canvas.style.top = (area.top + (area.height - h) / 2 - box.top) + 'px';
  }

  // options: layers [{image, frost}], list, initialList, fallback, onShow(entry), storage,
  // isHidden(), now(), setTimer, clearTimer, requestFrame, load(image, src, done, options), paint(), frostEnabled(), layout().
  // replace(list) cambia la galería sin cortar un fundido: espera a que termine la foto en curso y
  // descarta los resultados de cargas de la galería anterior (generation).
  function createSlideshow(options) {
    var now = options.now || function () { return Date.now(); };
    var setTimer = options.setTimer || function (fn, ms) { return setTimeout(fn, ms); };
    var clearTimer = options.clearTimer || function (id) { clearTimeout(id); };
    var requestFrame = options.requestFrame || function (fn) {
      if (typeof window.requestAnimationFrame === 'function') return window.requestAnimationFrame(fn);
      return setTimer(fn, 16);
    };
    var isHidden = options.isHidden || function () { return false; };
    var layers = options.layers;
    var list = cleanList(options.list);
    var fallback = false;
    var base = null; // galería a la que se vuelve si la nueva no carga
    if (list.length) base = { list: list, fallback: false };
    else useFallback();
    var front = -1;
    var current = -1;
    var preloaded = null; // { index, ok } cargado en la capa oculta
    var busy = false;
    var timer = null;
    var preloadTimer = null;
    var shownAt = 0;
    var shownSrc = null;
    var pending = null; // galería nueva que espera su turno
    var replaced = false;
    var generation = 0;
    var initialList = cleanList(options.initialList, true);
    if (initialList.length) { list = initialList; fallback = false; replaced = true; }

    function useFallback() {
      fallback = true;
      list = [{ src: options.fallback, author: '', source: '' }];
      base = { list: list, fallback: true };
    }
    function back() { return layers[front === 0 ? 1 : 0]; }
    function rotating() {
      return !fallback && list.filter(function (entry) { return !entry.failed; }).length > 1;
    }
    function schedule(ms) {
      if (timer !== null) clearTimer(timer);
      timer = null;
      if (!rotating() || isHidden()) return;
      timer = setTimer(function () { timer = null; advance(); }, Math.max(1000, ms));
    }

    // Después del fundido: precarga la siguiente o, si hay galería nueva, empieza a mostrarla.
    function schedulePreload() {
      if (preloadTimer !== null) clearTimer(preloadTimer);
      preloadTimer = null;
      if (isHidden() || busy) return;
      if (!pending && (preloaded || !rotating())) return;
      preloadTimer = setTimer(function () {
        preloadTimer = null;
        if (pending) applyPending();
        else preloadNext();
      }, FADE_MS + 200);
    }

    // Toda carga va a la capa oculta: abandonarla no cambia lo que se ve.
    function cancelLoad() {
      generation += 1;
      busy = false;
      preloaded = null;
    }

    function applyPending() {
      if (!pending || isHidden()) return;
      cancelLoad();
      if (preloadTimer !== null) clearTimer(preloadTimer);
      preloadTimer = null;
      if (timer !== null) clearTimer(timer);
      timer = null;
      list = pending;
      pending = null;
      fallback = false;
      replaced = true;
      current = -1;
      show(list.length > 1 && list[0].src === shownSrc ? 1 : 0);
    }

    // Ninguna foto de la galería nueva cargó: sigue la base desde la foto que está a la vista.
    function restoreBase() {
      replaced = false;
      list = base.list;
      fallback = base.fallback;
      current = -1;
      for (var i = 0; i < list.length; i += 1) if (list[i].src === shownSrc) current = i;
      if (current === -1) { show(nextIndex(list, -1)); return; }
      if (!layers[front].frostReady) deferInitialFrost(layers[front]);
      schedule(ROTATE_MS - (now() - shownAt));
      schedulePreload();
    }

    function prepare(index, done) {
      var layer = back();
      var token = generation;
      var initial = front === -1;
      options.load(layer.image, list[index].src, function (ok) {
        if (token !== generation) return; // carga de una galería anterior: se ignora
        if (ok && !initial && options.frostEnabled()) layer.frostReady = options.paint(layer.frost, layer.image);
        else layer.frostReady = false;
        done(ok);
      }, { immediate: initial });
    }

    // Primero se presenta la foto. rAF + otra tarea deja un frame libre antes de decode y canvas.
    function deferInitialFrost(layer) {
      var token = generation;
      var entry = list[current];
      var image = layer.image;
      var src = image.src;
      function valid() {
        return token === generation && !isHidden() && !layer.frostReady && layers[front] === layer &&
          list[current] === entry && layer.image === image && image.src === src;
      }
      requestFrame(function () {
        if (!valid()) return;
        setTimer(function () {
          if (!valid() || !options.frostEnabled()) return;
          var finished = false;
          var guard = null;
          function finish() {
            if (finished) return;
            finished = true;
            if (guard !== null) clearTimer(guard);
            if (!valid() || !options.frostEnabled()) return;
            layer.frostReady = options.paint(layer.frost, image);
            if (options.layout) options.layout();
            layer.frost.classList.toggle('is-front', layer.frostReady);
          }
          if (typeof image.decode !== 'function') { finish(); return; }
          guard = setTimer(finish, DECODE_WAIT_MS);
          try { image.decode().then(finish, finish); } catch (error) { finish(); }
        }, 0);
      });
    }

    function swap(index) {
      var incoming = front === 0 ? 1 : 0;
      var initial = front === -1;
      layers.forEach(function (layer, position) {
        var on = position === incoming;
        layer.image.classList.toggle('is-front', on);
        layer.frost.classList.toggle('is-front', on && layer.frostReady);
        layer.image.classList.toggle('is-initial', initial && on);
        layer.frost.classList.toggle('is-initial', initial && on);
      });
      front = incoming;
      current = index;
      shownAt = now();
      shownSrc = list[index].src;
      preloaded = null;
      if (!initial && options.layout) options.layout();
      if (!fallback && options.storage) {
        try { options.storage.setItem(STORAGE_KEY, list[index].src); } catch (error) { /* sin persistencia */ }
      }
      options.onShow(list[index]);
      schedule(ROTATE_MS);
      // Precarga la siguiente cuando termina el fundido, para que la capa saliente no cambie a la vista.
      schedulePreload();
      if (initial) deferInitialFrost(layers[incoming]);
    }

    function preloadNext() {
      if (isHidden() || busy || preloaded || !rotating()) return;
      var index = nextIndex(list, current);
      if (index === -1 || index === current) return;
      busy = true;
      prepare(index, function (ok) {
        busy = false;
        if (ok) preloaded = { index: index };
        else { list[index].failed = true; preloadNext(); }
      });
    }

    function show(index) {
      if (index === -1) {
        if (replaced) { restoreBase(); return; }
        // Ninguna foto cargó: wallpaper SVG local, sin rotación.
        if (!fallback && current === -1) { useFallback(); show(0); }
        else schedule(ROTATE_MS);
        return;
      }
      busy = true;
      prepare(index, function (ok) {
        busy = false;
        if (ok) { swap(index); return; }
        if (fallback) { schedulePreload(); return; } // ni el SVG cargó: queda el color (o llega una galería nueva)
        list[index].failed = true;
        if (front === -1 && replaced) { restoreBase(); return; }
        show(nextIndex(list, index));
      });
    }

    function advance() {
      if (isHidden()) return;
      if (pending) { applyPending(); return; }
      if (busy) { schedule(5000); return; } // una carga sigue en curso: reintentar enseguida
      if (preloaded) { swap(preloaded.index); return; }
      show(nextIndex(list, current));
    }

    return {
      start: function () {
        var last = null;
        if (options.storage) { try { last = options.storage.getItem(STORAGE_KEY); } catch (error) { last = null; } }
        if (initialList.length) {
          var index = 0;
          for (var i = 0; i < list.length; i += 1) if (list[i].src === last) index = i;
          show(index);
          return;
        }
        show(fallback ? 0 : startIndex(list, last));
      },
      visibilityChanged: function () {
        if (isHidden()) { schedule(0); schedulePreload(); return; }
        if (current === -1) return;
        if (!layers[front].frostReady) deferInitialFrost(layers[front]);
        if (pending) {
          if (busy) cancelLoad();
          schedulePreload();
          return;
        }
        var elapsed = now() - shownAt;
        if (elapsed >= ROTATE_MS || elapsed < 0) advance();
        else schedule(ROTATE_MS - elapsed);
        schedulePreload();
      },
      // Galería nueva (fotos del día). Sin foto a la vista todavía o con la app oculta, se aplica
      // tras el primer fundido o al volver; si no, FADE_MS + 200 ms después.
      replace: function (next) {
        var clean = cleanList(next, true);
        if (!clean.length) return false;
        pending = clean;
        if (current === -1 || isHidden()) return true;
        if (busy) cancelLoad();
        schedulePreload();
        return true;
      },
      current: function () { return current === -1 ? null : list[current]; },
      isFallback: function () { return fallback; },
      isReplaced: function () { return replaced; }
    };
  }

  function loadImage(image, src, done, options) {
    var finished = false;
    var immediate = !!options && options.immediate === true;
    var timeout = immediate && REMOTE_SRC.test(src) ? INITIAL_REMOTE_TIMEOUT_MS : LOAD_TIMEOUT_MS;
    var guard = setTimeout(function () { finish(false); }, timeout);
    function finish(ok) {
      if (finished) return;
      finished = true;
      clearTimeout(guard);
      // Si otra carga ya tomó este <img>, sus manejadores no se tocan.
      if (image.onload === onLoad) image.onload = null;
      if (image.onerror === onError) image.onerror = null;
      done(ok);
    }
    function onLoad() {
      // La foto ya cargó: eso decide. decode() solo evita el tirón al empezar el fundido
      // (Chromium 64+), pero puede no resolverse nunca con JPEG grandes: se espera como máximo 2 s.
      clearTimeout(guard);
      if (immediate || typeof image.decode !== 'function') { finish(true); return; }
      guard = setTimeout(function () { finish(true); }, DECODE_WAIT_MS);
      image.decode().then(function () { finish(true); }, function () { finish(true); });
    }
    function onError() { finish(false); }
    image.onload = onLoad;
    image.onerror = onError;
    image.src = src;
  }

  // Un panel de vidrio por canvas: cada capa de fondo tiene un canvas en cada panel. La primera
  // copia se pinta con paintFrost y las demás la copian (sin volver a desenfocar).
  function frostGroup(canvases) {
    return {
      canvases: canvases,
      classList: { toggle: function (name, on) { canvases.forEach(function (canvas) { canvas.classList.toggle(name, on); }); } }
    };
  }
  function paintGroup(group, image) {
    if (!group.canvases) return paintFrost(group, image);
    var first = group.canvases[0];
    if (!first || !paintFrost(first, image)) return false;
    try {
      group.canvases.slice(1).forEach(function (canvas) {
        canvas.width = first.width;
        canvas.height = first.height;
        canvas.getContext('2d').drawImage(first, 0, 0);
        canvas.setAttribute('data-width', first.getAttribute('data-width'));
        canvas.setAttribute('data-height', first.getAttribute('data-height'));
      });
      return true;
    } catch (error) { return false; }
  }

  function mount(options) {
    var stage = options.stage;
    var hosts = options.frostHosts || (options.frostHost ? [options.frostHost] : []);
    var layers = options.images.map(function (image, index) {
      var frost = options.frosts[index];
      return { image: image, frost: Array.isArray(frost) ? frostGroup(frost) : frost };
    });
    var storage = null;
    try { storage = window.localStorage; } catch (error) { storage = null; }
    function frostEnabled() { return hosts.length > 0 && window.getComputedStyle(hosts[0]).display !== 'none'; }
    function layout() {
      if (!frostEnabled()) return;
      layers.forEach(function (layer) {
        (layer.frost.canvases || [layer.frost]).forEach(function (canvas) { placeFrost(canvas, stage, canvas.parentNode); });
      });
    }
    var slideshow = createSlideshow({
      layers: layers,
      list: window.LAUNCHER_WALLPAPERS,
      initialList: options.initialList,
      fallback: options.fallback,
      storage: storage,
      isHidden: function () { return document.hidden === true; },
      load: loadImage,
      paint: paintGroup,
      frostEnabled: frostEnabled,
      layout: layout,
      onShow: function (entry) {
        if (options.onShow) options.onShow(entry);
        if (!options.credit) return;
        var credit = creditText(entry);
        options.credit.textContent = credit;
        options.credit.hidden = !credit;
      }
    });
    document.addEventListener('visibilitychange', slideshow.visibilityChanged);
    window.addEventListener('resize', layout);
    slideshow.start();
    slideshow.layout = layout;
    return slideshow;
  }

  window.LauncherBackgrounds = {
    cleanList: cleanList,
    creditText: creditText,
    sourceDetails: sourceDetails,
    nextIndex: nextIndex,
    startIndex: startIndex,
    createSlideshow: createSlideshow,
    loadImage: loadImage,
    mount: mount,
    ROTATE_MS: ROTATE_MS,
    FADE_MS: FADE_MS
  };
}());
