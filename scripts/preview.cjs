// Genera documentos autocontenidos del diseño real (CSS, JS, SVG y fotos en línea), aptos para
// html_preview/html_render: sin overrides de estilo, solo la clase is-preview en <html>
// (desactiva el escalado por alto de pantalla, que depende del viewport de la TV).
//   artifacts/mi-pantalla-preview.html     vidrio con backdrop-filter si el navegador lo soporta
//   artifacts/mi-pantalla-preview-tv.html  fuerza el vidrio de respaldo que verá Chromium 68
// Incluye wallpapers.js, weather-config.js, daily-photos-config.js y transitions-config.js si existen.
// Nunca contacta la TV. Con weather-config.js consulta Open-Meteo y con daily-photos-config.js consulta
// Wikimedia Commons al abrirse (los mismos pedidos reales de la app); no se incrusta metadata de fotos remotas.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const MIME = { svg: 'image/svg+xml', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', png: 'image/png' };

function inlineAssets(source) {
  return source.replace(/assets\/[\w/.-]+\.(svg|jpe?g|webp|png)\b/gi, (reference, extension) => {
    const file = path.join(root, reference);
    if (path.relative(path.join(root, 'assets'), file).startsWith('..')) throw Error('Ruta fuera de assets: ' + reference);
    if (!fs.existsSync(file)) throw Error('Recurso inexistente: ' + reference);
    return 'data:' + MIME[extension.toLowerCase()] + ';base64,' + fs.readFileSync(file).toString('base64');
  });
}
const script = (file) => '<script>' + inlineAssets(read(file)).replace(/<\/script/gi, '<\\/script') + '</script>';

function build(htmlClass) {
  let html = inlineAssets(read('index.html'));
  html = html.replace('<html lang="es">', '<html lang="es" class="' + htmlClass + '">');
  html = html.replace('<link rel="stylesheet" href="styles.css">', () => '<style>\n' + inlineAssets(read('styles.css')) + '</style>');
  html = html.replace('<link rel="stylesheet" href="apps-manager.css">', () => '<style>\n' + inlineAssets(read('apps-manager.css')) + '</style>');
  html = html.replace('<link rel="stylesheet" href="lights-panel.css">', () => '<style>\n' + inlineAssets(read('lights-panel.css')) + '</style>');
  // Las capturas automáticas deben mostrar los siete accesos y el fondo desde el primer cuadro.
  html = html.replace('</head>', '<style>.is-preview .tile{-webkit-animation:none;animation:none}.is-preview .aura,.is-preview .wallpaper-layer,.is-preview .frost-layer{transition:none}</style></head>');
  for (const file of ['config.js', 'wallpapers.js', 'weather-config.js', 'daily-photos-config.js', 'transitions-config.js', 'lights-config.js', 'bridge.js', 'app-catalog.js', 'apps-manager.js', 'dock-scroll.js', 'wallpaper-mode.js', 'weather.js', 'backgrounds.js', 'daily-photos.js', 'transitions.js', 'ambient-wallpaper.js', 'lights-client.js', 'lights-panel.js', 'app.js']) {
    const tag = '<script src="' + file + '"></script>';
    if (fs.existsSync(path.join(root, file))) html = html.replace(tag, () => script(file));
    else html = html.replace(new RegExp('\\s*' + tag.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')), '');
  }
  if (/(?:src|href)="(?!data:)[^"#]+\.(?:css|js|svg|jpe?g|webp|png)"/i.test(html)) throw Error('Quedó una referencia externa en la vista previa.');
  return html;
}

const outputs = [
  ['mi-pantalla-preview.html', 'is-preview'],
  ['mi-pantalla-preview-tv.html', 'is-preview force-fallback']
];
fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
for (const [name, htmlClass] of outputs) {
  const output = path.join(root, 'artifacts', name);
  const html = build(htmlClass);
  fs.writeFileSync(output, html, 'utf8');
  console.log(output + ' (' + (Buffer.byteLength(html) / 1048576).toFixed(2) + ' MB)');
}
