'use strict';
var nodeFs = require('fs');
var path = require('path');

var LIMIT = 512;
var ICON_LIMIT = 160;
var ICON_BYTES = 262144;
var ICON_DIR = 'assets/app-icons';
var ROOTS = ['/usr/palm/applications/', '/media/cryptofs/apps/usr/palm/applications/', '/media/developer/apps/usr/palm/applications/'];

function text(value, max) {
  return typeof value === 'string' && value.length <= max ? value : '';
}
// Only what the launcher's catalog reads. The TV answers with ~1 KB per app (permissions, versions...).
function clean(entry) {
  if (!entry || typeof entry !== 'object') return null;
  var id = text(entry.id, 128);
  if (!id) return null;
  var result = {id:id, title:text(entry.title, 160), icon:text(entry.icon, 300), folderPath:text(entry.folderPath, 400)};
  if (entry.visible === false) result.visible = false;
  if (entry.noWindow === true) result.noWindow = true;
  return result;
}
// The icon a native app declares, as an absolute path below the three application roots, or null.
function sourceOf(entry) {
  if (!entry.icon) return null;
  var file = entry.icon.charAt(0) === '/' ? entry.icon : (entry.folderPath ? entry.folderPath.replace(/\/$/, '') + '/' + entry.icon : '');
  if (!file || file.indexOf('\0') !== -1 || file.length > 700) return null;
  var normal = path.posix.normalize(file);
  if (normal !== file || /(^|\/)\.\.(\/|$)/.test(file)) return null;
  if (!ROOTS.some(function (root) { return file.indexOf(root) === 0 && /^[a-z0-9][a-z0-9._-]*\//i.test(file.slice(root.length)); })) return null;
  if (!/^[a-z0-9._ \/-]+$/i.test(file) || !/\.(png|jpe?g|svg|webp)$/i.test(file)) return null;
  return file;
}

// The TV denies com.webos.applicationManager/listApps to the launcher app AND to this service under their own
// identities ("Denied method call"), but answers a root luna-send, like the installer and the Auto watcher use.
// The launcher page cannot read other apps' folders either, so this root service copies each icon of a visible
// app into the launcher's own assets/app-icons/. Read-only on the TV's apps: it never launches, installs or removes.
module.exports = function createAppList(options) {
  options = options || {};
  var execFile = options.execFile || require('child_process').execFile;
  var fs = options.fs || nodeFs;
  var iconRoot = options.iconRoot !== undefined ? options.iconRoot : path.join(__dirname, '..', '..', 'applications', 'com.frxn.mipantalla');
  var iconDir = iconRoot ? path.posix.join(iconRoot, ICON_DIR) : null;

  function copyIcon(entry) {
    var source = sourceOf(entry);
    if (!source) return null;
    var stat = fs.lstatSync(source);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0 || stat.size > ICON_BYTES) return null;
    var name = entry.id.toLowerCase().replace(/[^a-z0-9._-]/g, '_') + path.extname(source).toLowerCase();
    var target = path.posix.join(iconDir, name);
    var same = false;
    try { same = fs.statSync(target).size === stat.size; } catch (ignored) { same = false; }
    if (!same) {
      var temporary = target + '.tmp';
      fs.writeFileSync(temporary, fs.readFileSync(source), {mode:420});
      fs.renameSync(temporary, target);
    }
    return {name:name, logo:ICON_DIR + '/' + name};
  }
  function withIcons(apps) {
    if (!iconDir) return apps;
    try {
      if (!fs.existsSync(iconRoot)) return apps;
      if (!fs.existsSync(iconDir)) fs.mkdirSync(iconDir, 493);
    } catch (ignored) { return apps; }
    var kept = {}, copied = 0;
    apps.forEach(function (entry) {
      if (entry.visible === false || entry.noWindow === true || copied >= ICON_LIMIT) return;
      try {
        var icon = copyIcon(entry);
        if (icon) { entry.logo = icon.logo; kept[icon.name] = true; copied += 1; }
      } catch (ignored) { /* This app keeps the generic icon. */ }
    });
    try {
      fs.readdirSync(iconDir).forEach(function (file) {
        if (!kept[file]) { try { fs.unlinkSync(path.posix.join(iconDir, file)); } catch (ignored) {} }
      });
    } catch (ignored) { /* Stale icons are harmless. */ }
    return apps;
  }
  return {
    list:function () {
      return new Promise(function (resolve, reject) {
        execFile('/usr/bin/luna-send', ['-n', '1', 'luna://com.webos.applicationManager/listApps', '{}'],
          {timeout:9000, maxBuffer:4 * 1024 * 1024, encoding:'utf8', env:Object.assign({}, process.env, {LD_PRELOAD:''})},
          function (error, out) {
            if (error) { reject(new Error('La TV no respondió al listar las apps.')); return; }
            var payload;
            try { payload = JSON.parse(out); } catch (ignored) { payload = null; }
            if (!payload || payload.returnValue !== true || !Array.isArray(payload.apps)) {
              reject(new Error('La TV no devolvió el catálogo de apps.')); return;
            }
            var apps = payload.apps.slice(0, LIMIT * 2).map(clean).filter(function (entry) { return entry !== null; }).slice(0, LIMIT);
            resolve({apps:withIcons(apps)});
          });
      });
    }
  };
};
module.exports.sourceOf = sourceOf;
