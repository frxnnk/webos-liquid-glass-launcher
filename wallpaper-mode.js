(function () {
  'use strict';

  function mount(options) {
    var button = options.button, root = options.root, shell = options.shell;
    if (!button || !root || !shell) return null;
    var active = false;
    var previousHidden = false;
    var suppressedKey = null;
    button.setAttribute('aria-pressed', 'false');

    function hidden() {
      return document.hidden === true || document.visibilityState === 'hidden';
    }
    function enter() {
      if (hidden()) return false;
      if (active) return true;
      previousHidden = shell.hidden;
      active = true;
      root.classList.add('is-wallpaper-only');
      shell.hidden = true;
      button.setAttribute('aria-pressed', 'true');
      return true;
    }
    function exit(restoreFocus) {
      if (!active) return false;
      active = false;
      root.classList.remove('is-wallpaper-only');
      shell.hidden = previousHidden;
      button.setAttribute('aria-pressed', 'false');
      if (typeof options.onExit === 'function') options.onExit();
      if (restoreFocus !== false && !hidden()) button.focus();
      return true;
    }
    function consume(event) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    function exitKey(event) {
      var named = {Enter:13, ' ':32, Space:32, Spacebar:32, ArrowLeft:37,
        ArrowUp:38, ArrowRight:39, ArrowDown:40, Escape:27, Backspace:8, Tab:9};
      if (typeof named[event.key] === 'number') return named[event.key];
      return [13, 32, 37, 38, 39, 40, 27, 8, 9, 461].indexOf(event.keyCode) !== -1 ? event.keyCode : null;
    }

    button.addEventListener('click', enter);
    // Capture wins over the launcher's arrows and Back, regardless of mount order.
    document.addEventListener('keydown', function (event) {
      var key = exitKey(event);
      if (key === null) return;
      if (event.repeat !== true) suppressedKey = null;
      if (!active && suppressedKey !== key) return;
      consume(event);
      if (active && event.repeat !== true) { suppressedKey = key; exit(); }
    }, true);
    document.addEventListener('keyup', function (event) {
      if (suppressedKey === null || exitKey(event) !== suppressedKey) return;
      suppressedKey = null;
      consume(event);
    }, true);
    document.addEventListener('click', function (event) {
      if (active) { consume(event); exit(); }
    }, true);
    document.addEventListener('visibilitychange', function () {
      if (hidden()) { suppressedKey = null; exit(false); }
    });

    return {enter:enter, exit:exit, isActive:function () { return active; }};
  }

  window.LauncherWallpaperMode = {mount:mount};
}());
