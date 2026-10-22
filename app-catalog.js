(function () {
  'use strict';
  var MAX_APPS = 512;
  var FALLBACK = 'assets/logos/app.svg';

  function validId(value) {
    return typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,127}$/i.test(value);
  }
  function copy(item) { return Object.assign({}, item); }
  function label(value) {
    if (typeof value !== 'string') return '';
    return value.replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
  }
  function icon(value, folder) {
    if (typeof value !== 'string') return FALLBACK;
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
    var title = label(entry.title);
    if (!validId(id) || !title) return null;
    if (stored && entry.key !== 'app-' + id) return null;
    if (!stored && (entry.visible === false || entry.noWindow === true)) return null;
    return {
      key: 'app-' + id, appId: id, title: title,
      logo: icon(stored ? entry.logo : entry.icon, stored ? null : entry.folderPath),
      color: '#a8b5ce', tagline: 'Aplicación instalada', kind: 'app',
      visible: stored ? entry.visible !== false : false, catalogApp: true
    };
  }
  function defaultIds(items) {
    var ids = Object.create(null);
    items.forEach(function (item) { if (!item.catalogApp && !item.action) ids[item.appId] = true; });
    return ids;
  }
  function restore(defaults, stored) {
    var base = (Array.isArray(defaults) ? defaults : []).slice(0, MAX_APPS).map(function (item) {
      var result = copy(item);
      result.visible = true;
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
      if (item) item.visible = entry.visible !== false;
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
    return result;
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
      }
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
  window.LauncherCatalog = { restore: restore, merge: merge, serialize: serialize, move: move };
}());
