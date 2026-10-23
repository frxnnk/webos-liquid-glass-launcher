const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '..');
const APP_FILES = ['index.html', 'styles.css', 'config.js', 'bridge.js', 'app-catalog.js', 'apps-manager.js', 'apps-manager.css', 'dock-scroll.js', 'wallpaper-mode.js', 'weather.js', 'backgrounds.js', 'daily-photos.js', 'transitions.js', 'ambient-wallpaper.js', 'lights-client.js', 'lights-panel.js', 'lights-panel.css', 'app.js', 'appinfo.json', 'icon.png', 'LICENSE'];
const FIXTURE_HTML = '<script src="config.js"></script>\n  <script src="wallpapers.js"></script>\n  <script src="weather-config.js"></script>\n  <script src="daily-photos-config.js"></script>\n  <script src="transitions-config.js"></script>\n  <script src="app.js"></script>';

function withFixture(prepare, check) {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'mi-pantalla-build-'));
  try {
    fs.mkdirSync(path.join(fixture, 'scripts'));
    fs.mkdirSync(path.join(fixture, 'vendor'));
    fs.mkdirSync(path.join(fixture, 'dist'));
    fs.mkdirSync(path.join(fixture, 'assets', 'logos'), { recursive: true });
    fs.copyFileSync(path.join(root, 'scripts', 'build.cjs'), path.join(fixture, 'scripts', 'build.cjs'));
    for (const file of APP_FILES) fs.writeFileSync(path.join(fixture, file), file === 'index.html' ? FIXTURE_HTML : 'fixture');
    for (const file of ['webOSTV.js', 'LICENSE-2.0.txt', 'SOURCE.md']) fs.writeFileSync(path.join(fixture, 'vendor', file), 'fixture');
    fs.writeFileSync(path.join(fixture, 'assets', 'wallpaper.svg'), '<svg/>');
    fs.writeFileSync(path.join(fixture, 'assets', 'logos', 'mark.svg'), '<svg/>');
    prepare(fixture);
    let failure = null;
    let log = '';
    try { log = execFileSync(process.execPath, [path.join(fixture, 'scripts', 'build.cjs')], { stdio: 'pipe' }).toString(); }
    catch (error) { failure = error; }
    check(fixture, failure, log);
  } finally {
    assert.equal(path.dirname(fixture), os.tmpdir());
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}
const dist = (fixture, file) => path.join(fixture, 'dist', file);

test('rebuilding excludes obsolete files and works without the parent configs', () => {
  withFixture((fixture) => {
    fs.writeFileSync(path.join(fixture, 'assets', 'notes.txt'), 'not an asset');
    fs.writeFileSync(path.join(fixture, 'dist', 'obsolete-secret.txt'), 'must not be packaged');
  }, (fixture, failure) => {
    assert.equal(failure, null, failure && failure.stderr.toString());
    assert.equal(fs.existsSync(dist(fixture, 'obsolete-secret.txt')), false);
    const html = fs.readFileSync(dist(fixture, 'index.html'), 'utf8');
    assert.match(html, /vendor\/webOSTV.js/);
    assert.doesNotMatch(html, /wallpapers\.js|weather-config\.js|daily-photos-config\.js|transitions-config\.js/, 'missing configs leave no dangling script tags');
    for (const file of ['weather.js', 'backgrounds.js', 'daily-photos.js', 'transitions.js']) assert.equal(fs.existsSync(dist(fixture, file)), true, file);
    assert.equal(fs.readFileSync(dist(fixture, 'assets/wallpaper.svg'), 'utf8'), '<svg/>');
    assert.equal(fs.existsSync(dist(fixture, 'assets/logos/mark.svg')), true);
    assert.equal(fs.existsSync(dist(fixture, 'assets/notes.txt')), false);
  });
});

test('parent configs, listed photos and their licence notes are packaged', () => {
  withFixture((fixture) => {
    fs.mkdirSync(path.join(fixture, 'assets', 'wallpapers'));
    fs.writeFileSync(path.join(fixture, 'assets', 'wallpapers', 'delta.jpg'), 'jpeg');
    fs.writeFileSync(path.join(fixture, 'assets', 'wallpapers', 'sierra.webp'), 'webp');
    fs.writeFileSync(path.join(fixture, 'assets', 'wallpapers', 'CREDITS.md'), 'credits');
    fs.writeFileSync(path.join(fixture, 'assets', 'wallpapers', 'run.sh'), 'not packaged');
    fs.writeFileSync(path.join(fixture, 'wallpapers.js'), "window.LAUNCHER_WALLPAPERS = [{ src: 'assets/wallpapers/delta.jpg', author: 'A', source: 'B' }, { src: 'assets/wallpapers/sierra.webp' }];");
    fs.writeFileSync(path.join(fixture, 'weather-config.js'), 'window.LAUNCHER_WEATHER = null;');
    fs.writeFileSync(path.join(fixture, 'daily-photos-config.js'), "window.LAUNCHER_DAILY_PHOTOS = { endpoint: 'https://commons.wikimedia.org/w/api.php?action=query', count: 6 };");
    fs.writeFileSync(path.join(fixture, 'transitions-config.js'), "window.LAUNCHER_TRANSITIONS = [{ videoId: 'abcdefghijk', title: 'Transitions 1', url: 'https://www.youtube.com/watch?v=abcdefghijk' }, { videoId: 'bad' }];");
  }, (fixture, failure, log) => {
    assert.equal(failure, null, failure && failure.stderr.toString());
    const html = fs.readFileSync(dist(fixture, 'index.html'), 'utf8');
    for (const name of ['wallpapers', 'weather-config', 'daily-photos-config', 'transitions-config']) {
      assert.ok(html.includes('<script src="' + name + '.js"></script>'), name);
    }
    assert.match(log, /Transitions: 1 episodios válidos/);
    for (const file of ['wallpapers.js', 'weather-config.js', 'daily-photos-config.js', 'transitions-config.js', 'assets/wallpapers/delta.jpg', 'assets/wallpapers/sierra.webp', 'assets/wallpapers/CREDITS.md']) {
      assert.equal(fs.existsSync(dist(fixture, file)), true, file);
    }
    assert.equal(fs.existsSync(dist(fixture, 'assets/wallpapers/run.sh')), false);
  });
});

test('a photo listed but missing, or a remote URL, stops the build', () => {
  for (const src of ['assets/wallpapers/missing.jpg', 'https://example.com/photo.jpg']) {
    withFixture((fixture) => {
      fs.writeFileSync(path.join(fixture, 'wallpapers.js'), 'window.LAUNCHER_WALLPAPERS = [{ src: ' + JSON.stringify(src) + ' }];');
    }, (fixture, failure) => {
      assert.notEqual(failure, null, src + ' must fail');
      assert.match(failure.stderr.toString(), /Falta la foto|no local/);
    });
  }
});

test('a daily-photos config pointing outside Wikimedia Commons stops the build', () => {
  for (const endpoint of ['https://evil.example/w/api.php?x=1', 'http://commons.wikimedia.org/w/api.php?x=1']) {
    withFixture((fixture) => {
      fs.writeFileSync(path.join(fixture, 'daily-photos-config.js'), 'window.LAUNCHER_DAILY_PHOTOS = { endpoint: ' + JSON.stringify(endpoint) + ' };');
    }, (fixture, failure) => {
      assert.notEqual(failure, null, endpoint + ' must fail');
      assert.match(failure.stderr.toString(), /commons\.wikimedia\.org/);
    });
  }
});

test('every asset referenced by the app exists locally', () => {
  const sources = ['index.html', 'styles.css', 'config.js', 'app.js', 'backgrounds.js', 'weather.js', 'daily-photos.js', 'transitions.js'].map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
  const references = Array.from(new Set(sources.match(/assets\/[\w/.-]+\.\w+/g) || []));
  assert.ok(references.includes('assets/wallpaper.svg'), 'SVG fallback wallpaper is referenced');
  assert.ok(references.length >= 8, 'fallback wallpaper and seven marks are referenced');
  for (const reference of references) {
    assert.match(reference, /\.(?:svg|jpe?g|webp|png)$/);
    assert.equal(fs.statSync(path.join(root, reference)).isFile(), true, reference);
  }
  const config = fs.readFileSync(path.join(root, 'config.js'), 'utf8');
  assert.doesNotMatch(config, /mark:/, 'unicode marks were replaced by SVG logos');
});

test('home shows icons only: no visible titles, spotlight or availability captions', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.doesNotMatch(html, /spotlight|spot-title/);
  assert.doesNotMatch(app, /tile-title|tile-meta|Disponible|Por verificar/);
  assert.match(app, /setAttribute\('aria-label', labelFor\(item\)\)/);
});

test('runtime CSS and JS avoid features missing from Chromium 68', () => {
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const pattern of [/(?<![-\w])gap\s*:/, /(?<![-\w])aspect-ratio\s*:/, /color-mix\(/, /oklch\(/, /@container/, /\binset\s*:/, /\b(?:clamp|min|max)\(/, /:focus-visible/, /:is\(/, /100vh/, /(?<!backdrop-)filter:\s*blur/]) {
    assert.equal(pattern.test(css), false, 'styles.css uses ' + pattern);
  }
  const js = ['app.js', 'config.js', 'app-catalog.js', 'apps-manager.js', 'dock-scroll.js', 'wallpaper-mode.js', 'weather.js', 'backgrounds.js', 'daily-photos.js', 'transitions.js', 'bridge.js'].map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
  assert.doesNotMatch(js, /\?\.|\?\?|=>|\bclass\s+\w|\blet\s|\bconst\s|`|\basync\b|\bawait\b/);
  assert.doesNotMatch(js, /geolocation|getImageData|toDataURL|innerHTML|insertAdjacentHTML|randomUUID|com\.webos\.app\.browser/);
});

test('Transitions opens YouTube only from the tile click, never on focus or load', () => {
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.equal(app.split('launchYouTubeVideo(').length - 1, 1, 'a single launch site');
  assert.equal(app.split('transitions.next()').length - 1, 1, 'a single pick site');
  const openTransitions = app.slice(app.indexOf('function openTransitions'), app.indexOf('function openItem'));
  assert.match(openTransitions, /transitions\.next\(\)/);
  assert.match(openTransitions, /launchYouTubeVideo\(episode\.videoId\)/);
  assert.match(app, /if \(item\.action === 'transitions'\) \{ openTransitions\(item\); return; \}/);
  assert.equal(app.split('openItem(').length - 1, 2, 'openItem: its declaration and the tile click only');
  assert.match(app, /tile\.addEventListener\('click', function \(\) \{ openItem\(item\); \}\)/);
  const focusCode = app.slice(app.indexOf('function showFocus'), app.indexOf('// ---------- Inicio'));
  assert.doesNotMatch(focusCode, /openItem|openTransitions|transitions\.|bridge\./);
});
