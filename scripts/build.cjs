const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = fs.realpathSync(path.resolve(__dirname, '..'));
const output = path.join(root, 'dist');
if (path.relative(root, output) !== 'dist') throw Error('Destino de build inválido.');
if (fs.existsSync(output)) {
  if (fs.lstatSync(output).isSymbolicLink()) throw Error('dist no puede ser un enlace simbólico.');
  fs.rmSync(output, { recursive: true, force: true });
}
fs.mkdirSync(output, { recursive: true });

function regularFile(file) {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) throw Error('Debe ser un archivo regular, no un enlace: ' + path.relative(root, file));
}
for (const file of ['index.html', 'styles.css', 'config.js', 'bridge.js', 'app-catalog.js', 'apps-manager.js', 'apps-manager.css', 'dock-scroll.js', 'wallpaper-mode.js', 'weather.js', 'backgrounds.js', 'daily-photos.js', 'transitions.js', 'ambient-wallpaper.js', 'lights-client.js', 'lights-panel.js', 'lights-panel.css', 'app.js', 'appinfo.json', 'icon.png', 'LICENSE']) {
  regularFile(path.join(root, file));
  fs.copyFileSync(path.join(root, file), path.join(output, file));
}
// Configuración opcional que escribe el proyecto padre: fotos, clima, fotos del día y Transitions.
// Si falta, se quita su <script>: wallpaper SVG, "Clima no disponible", solo fotos locales o
// Transitions explica que no hay episodios configurados.
const optional = {};
for (const file of ['wallpapers.js', 'weather-config.js', 'daily-photos-config.js', 'transitions-config.js', 'lights-config.js']) {
  const from = path.join(root, file);
  optional[file] = fs.existsSync(from);
  if (!optional[file]) continue;
  regularFile(from);
  fs.copyFileSync(from, path.join(output, file));
}
fs.mkdirSync(path.join(output, 'vendor'), { recursive: true });
for (const file of ['webOSTV.js', 'LICENSE-2.0.txt', 'SOURCE.md']) {
  fs.copyFileSync(path.join(root, 'vendor', file), path.join(output, 'vendor', file));
}
// Recursos locales: SVG en todo assets/; además fotos (JPEG/WebP/PNG) y textos de licencia
// o créditos dentro de assets/wallpapers/. Solo archivos regulares, sin enlaces.
const IMAGE = /\.svg$/i;
const PHOTO = /\.(?:jpe?g|webp|png)$/i;
const NOTICE = /\.(?:txt|md)$/i;
function copyAssets(source, target, inWallpapers) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    if (entry.isSymbolicLink()) throw Error('assets no puede contener enlaces simbólicos: ' + entry.name);
    if (entry.isDirectory()) copyAssets(from, path.join(target, entry.name), inWallpapers || path.relative(assets, from) === 'wallpapers');
    else if (entry.isFile() && (IMAGE.test(entry.name) || (inWallpapers && (PHOTO.test(entry.name) || NOTICE.test(entry.name))))) {
      fs.copyFileSync(from, path.join(target, entry.name));
    }
  }
}
const assets = path.join(root, 'assets');
if (!fs.existsSync(assets) || fs.lstatSync(assets).isSymbolicLink()) throw Error('Falta la carpeta assets/ con los recursos visuales.');
if (!fs.existsSync(path.join(assets, 'wallpaper.svg'))) throw Error('Falta assets/wallpaper.svg, el fondo de respaldo.');
copyAssets(assets, path.join(output, 'assets'), false);

// Tamaño y tipo de un JPEG leyendo su marcador SOF; null si no es JPEG o no se encuentra.
function jpegInfo(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) { at += 1; continue; }
    const marker = bytes[at + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7), progressive: marker === 0xc2 };
    }
    at += 2 + bytes.readUInt16BE(at + 2);
  }
  return null;
}

// Cada foto listada en wallpapers.js debe estar empaquetada: la app nunca la descarga.
if (optional['wallpapers.js']) {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'wallpapers.js'), 'utf8'), sandbox, { timeout: 1000 });
  const list = sandbox.window.LAUNCHER_WALLPAPERS;
  if (!Array.isArray(list)) throw Error('wallpapers.js debe definir window.LAUNCHER_WALLPAPERS como lista.');
  for (const entry of list) {
    const src = entry && entry.src;
    if (typeof src !== 'string' || !/^assets\/wallpapers\/\w[\w.-]*\.(?:jpe?g|webp|png)$/i.test(src)) {
      throw Error('Foto con ruta no local o formato no admitido: ' + JSON.stringify(src));
    }
    if (!fs.existsSync(path.join(output, src))) throw Error('Falta la foto listada en wallpapers.js: ' + src);
    const size = fs.statSync(path.join(output, src)).size;
    if (size > 3 * 1024 * 1024) console.warn('Aviso: ' + src + ' pesa ' + (size / 1048576).toFixed(1) + ' MB; conviene ≤ 1 MB para la TV.');
    const jpeg = jpegInfo(fs.readFileSync(path.join(output, src)));
    if (jpeg && (jpeg.width > 2560 || jpeg.height > 1440 || jpeg.progressive)) {
      console.warn('Aviso: ' + src + ' es ' + jpeg.width + '×' + jpeg.height + (jpeg.progressive ? ' progresivo' : '') +
        '; en la TV conviene 1920×1080 baseline (menos memoria y decodificación más rápida).');
    }
  }
  console.log('Fotos de fondo empaquetadas: ' + list.length + '.');
} else console.log('Sin wallpapers.js: se usará assets/wallpaper.svg.');
if (!optional['weather-config.js']) console.log('Sin weather-config.js: el widget mostrará "Clima no disponible" y no hará pedidos.');

// Configuraciones del padre: se ejecutan aisladas solo para revisar su forma; la app vuelve a validarlas.
function readConfig(file, name) {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { timeout: 1000 });
  return sandbox.window[name];
}
if (optional['daily-photos-config.js']) {
  const daily = readConfig('daily-photos-config.js', 'LAUNCHER_DAILY_PHOTOS');
  if (!daily || typeof daily.endpoint !== 'string' || !daily.endpoint.startsWith('https://commons.wikimedia.org/w/api.php?')) {
    throw Error('daily-photos-config.js debe definir LAUNCHER_DAILY_PHOTOS.endpoint en https://commons.wikimedia.org/w/api.php.');
  }
  console.log('Fotos del día: Wikimedia Commons, hasta ' + Math.min(6, Number(daily.count) || 6) + ' por día.');
} else console.log('Sin daily-photos-config.js: solo fotos locales, sin pedidos a Wikimedia Commons.');
if (optional['transitions-config.js']) {
  const episodes = readConfig('transitions-config.js', 'LAUNCHER_TRANSITIONS');
  if (!Array.isArray(episodes)) throw Error('transitions-config.js debe definir window.LAUNCHER_TRANSITIONS como lista.');
  const valid = episodes.filter((entry) => entry && /^[A-Za-z0-9_-]{11}$/.test(entry.videoId) && entry.url === 'https://www.youtube.com/watch?v=' + entry.videoId);
  if (valid.length !== episodes.length) console.warn('Aviso: ' + (episodes.length - valid.length) + ' episodio(s) de Transitions con ID o URL inválidos se ignorarán.');
  console.log('Transitions: ' + valid.length + ' episodios válidos.');
} else console.log('Sin transitions-config.js: el acceso Transitions explicará que no hay episodios.');

let html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
if (!fs.existsSync(path.join(output, 'vendor', 'webOSTV.js'))) throw Error('Falta el SDK oficial de LG en vendor/webOSTV.js');
for (const file of Object.keys(optional)) {
  if (!optional[file]) html = html.replace(new RegExp('\\s*<script src="' + file.replace('.', '\\.') + '"></script>'), '');
}
html = html.replace('<script src="config.js">', '<script src="vendor/webOSTV.js"></script>\n  <script src="config.js">');
fs.writeFileSync(path.join(output, 'index.html'), html, 'utf8');
console.log('App webOS preparada en dist/. Sin instalación ni cambios en TV.');
