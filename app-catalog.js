(function () {
  'use strict';
  var MAX_APPS = 512;
  var FALLBACK = 'assets/logos/app.svg';
  // LG marca estas apps de sistema como visible:false (no salen en su lista) pero sirven desde el inicio.
  // Se permiten solo por id; lo demás que LG oculta (anuncios, fábrica, ejemplos) sigue fuera.
  // Sin Software Update ni Installation: actualizar el firmware quitaría el root. HDMI 3 y 4 quedan
  // fuera porque esta TV tiene dos puertos; HDMI 1 y 2 ya son accesos propios.
  var SYSTEM = {
    'com.palm.app.settings': { title: 'Configuración', logo: 'assets/logos/system-settings.svg' },
    'com.webos.app.livetv': { title: 'TV en vivo', logo: 'assets/logos/system-livetv.svg' },
    'com.webos.app.livemenu': { title: 'Guía de TV', logo: 'assets/logos/system-guide.svg' },
    'com.webos.app.recordings': { title: 'Grabaciones', logo: 'assets/logos/system-recordings.svg' },
    'com.webos.app.notificationcenter': { title: 'Notificaciones', logo: 'assets/logos/system-notifications.svg' },
    'com.webos.app.miracast': { title: 'Compartir pantalla', logo: 'assets/logos/system-cast.svg' },
    'airplay': { title: 'AirPlay', logo: 'assets/logos/system-airplay.svg' },
    'com.webos.app.self-diagnosis': { title: 'Ayuda rápida', logo: 'assets/logos/system-help.svg' },
    'com.webos.app.tvuserguide': { title: 'Guía del usuario', logo: 'assets/logos/system-manual.svg' },
    'com.webos.app.home': { title: 'Home de LG', logo: 'assets/logos/system-home.svg' },
    'com.webos.app.hdmi2': { title: 'HDMI 2', kind: 'input', logo: 'assets/logos/hdmi-2.svg' }
  };
  function systemEntry(id) { return typeof id === 'string' && Object.prototype.hasOwnProperty.call(SYSTEM, id) ? SYSTEM[id] : null; }

  function validId(value) {
    return typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,127}$/i.test(value);
  }
  function copy(item) { return Object.assign({}, item); }
  function label(value) {
    if (typeof value !== 'string') return '';
    return value.replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
  }
  // Íconos que el servicio de luces (root) copió dentro de esta app: la página no puede leer otras carpetas.
  var LOCAL_ICON = /^assets\/app-icons\/[a-z0-9][a-z0-9._-]{0,150}\.(?:png|jpe?g|svg|webp)$/i;
  function icon(value, folder) {
    if (typeof value !== 'string') return FALLBACK;
    if (LOCAL_ICON.test(value)) return value;
    var path = value;
    if (path.indexOf('file:///') === 0) path = path.slice(7);
    else if (path.charAt(0) !== '/' && typeof folder === 'string') path = folder.replace(/\/$/, '') + '/' + path;
    if (path.length > 1024) return FALLBACK;
    if (!/^\/(?:usr\/palm\/applications|media\/(?:developer|cryptofs)\/apps\/usr\/palm\/applications)\/[a-z0-9][a-z0-9._-]*\//i.test(path)) return FALLBACK;
    if (!/^[a-z0-9._ /-]+$/i.test(path) || /(?:^|\/)\.{1,2}(?:\/|$)/.test(path)) return FALLBACK;
    if (!/\.(?:png|jpe?g|svg|webp|gif|bmp)$/i.test(path)) return FALLBACK;
    return 'file://' + path;
  }
  function extra(entry, stored) {
    if (!entry || typeof entry !== 'object') return null;
    var id = stored ? entry.appId : entry.id;
    var system = systemEntry(id);
    var title = system ? system.title : label(entry.title);
    if (!validId(id) || !title) return null;
    if (stored && entry.key !== 'app-' + id) return null;
    if (!stored && (entry.noWindow === true || (entry.visible === false && !system))) return null;
    return {
      key: 'app-' + id, appId: id, title: title,
      // Las apps de sistema usan un ícono propio (siempre carga); el resto, el que declara la TV.
      logo: system && system.logo ? system.logo : icon(stored ? entry.logo : (LOCAL_ICON.test(String(entry.logo)) ? entry.logo : entry.icon), stored ? null : entry.folderPath),
      color: '#a8b5ce', tagline: system ? 'Sistema de LG' : 'Aplicación instalada', kind: system && system.kind || 'app',
      visible: stored ? entry.visible !== false : false, catalogApp: true
    };
  }
  function defaultIds(items) {
    var ids = Object.create(null);
    items.forEach(function (item) { if (!item.catalogApp && !item.action) ids[item.appId] = true; });
    return ids;
  }
  // tvIcon: el acceso usa el ícono que declara la TV (copiado por el servicio en assets/app-icons/);
  // el logo incluido queda como respaldo si la copia falta o no carga.
  function tvIcon(item, logo) {
    if (!item.tvIcon) return;
    if (!item.fallbackLogo) item.fallbackLogo = item.logo;
    if (LOCAL_ICON.test(String(logo))) item.logo = logo;
  }
  function tvIcons(items, apps) {
    var logos = Object.create(null);
    (Array.isArray(apps) ? apps : []).forEach(function (entry) {
      if (entry && typeof entry.id === 'string' && LOCAL_ICON.test(String(entry.logo))) logos[entry.id] = entry.logo;
    });
    return (Array.isArray(items) ? items : []).map(function (entry) {
      var item = copy(entry);
      if (item.tvIcon && logos[item.appId]) tvIcon(item, logos[item.appId]);
      return item;
    });
  }
  function restore(defaults, stored) {
    var base = (Array.isArray(defaults) ? defaults : []).slice(0, MAX_APPS).map(function (item) {
      var result = copy(item);
      result.visible = true;
      tvIcon(result, null);
      return result;
    });
    if (!Array.isArray(stored)) return base;
    var used = Object.create(null);
    var byKey = Object.create(null);
    var ids = defaultIds(base);
    var ordered = [];
    var extras = 0;
    base.forEach(function (item) { byKey[item.key] = item; });
    stored.slice(0, MAX_APPS).forEach(function (entry) {
      if (!entry || typeof entry !== 'object' || typeof entry.key !== 'string' || used[entry.key]) return;
      var item = byKey[entry.key];
      if (item) { item.visible = entry.visible !== false; tvIcon(item, entry.logo); }
      else {
        if (extras >= MAX_APPS - base.length) return;
        item = extra(entry, true);
        if (!item || ids[item.appId]) return;
        extras += 1;
      }
      used[item.key] = true;
      ordered.push(item);
    });
    // New built-in shortcuts retain the original migration behavior and visibility.
    base.forEach(function (item) {
      if (used[item.key]) return;
      var at = -1;
      ordered.forEach(function (candidate, index) { if (candidate.kind === item.kind) at = index; });
      ordered.splice(at + 1, 0, item);
    });
    return ordered;
  }
  function merge(items, apps) {
    if (!Array.isArray(apps)) throw new Error('El catálogo de apps no es válido.');
    var current = Array.isArray(items) ? items : [];
    var ids = defaultIds(current);
    var discovered = Object.create(null);
    var incoming = [];
    apps.forEach(function (entry) {
      var item = extra(entry, false);
      if (!item || ids[item.appId] || discovered[item.key] || incoming.length >= MAX_APPS) return;
      discovered[item.key] = item;
      incoming.push(item);
    });
    var result = [];
    var used = Object.create(null);
    current.forEach(function (entry) {
      var item = entry.catalogApp ? discovered[entry.key] : copy(entry);
      if (!item || used[item.key]) return;
      if (entry.catalogApp) item.visible = entry.visible !== false;
      used[item.key] = true;
      result.push(item);
    });
    incoming.forEach(function (item) {
      if (!used[item.key] && result.length < MAX_APPS) result.push(item);
    });
    return tvIcons(result, apps);
  }
  function serialize(items) {
    return (Array.isArray(items) ? items : []).slice(0, MAX_APPS).map(function (item) {
      var saved = { key: item.key, visible: item.visible !== false };
      if (item.catalogApp) {
        var safe = extra(item, true);
        if (!safe) return null;
        saved.appId = safe.appId;
        saved.title = safe.title;
        saved.logo = safe.logo;
      } else if (item.tvIcon && LOCAL_ICON.test(String(item.logo))) saved.logo = item.logo;
      return saved;
    }).filter(function (item) { return item !== null; });
  }
  function move(items, key, direction) {
    var result = items.slice();
    var at = -1;
    result.forEach(function (item, index) { if (item.key === key) at = index; });
    if (at < 0 || !result[at].visible || (direction !== -1 && direction !== 1)) return result;
    for (var index = at + direction; index >= 0 && index < result.length; index += direction) {
      if (result[index].kind !== result[at].kind || !result[index].visible) continue;
      var other = result[index];
      result[index] = result[at];
      result[at] = other;
      break;
    }
    return result;
  }
  window.LauncherCatalog = { restore: restore, merge: merge, tvIcons: tvIcons, serialize: serialize, move: move };
}());
