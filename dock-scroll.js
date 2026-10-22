(function () {
  'use strict';

  function mount(grid) {
    if (!grid) return null;
    var bounds = [];
    var width = 0;
    var maximum = 0;
    var position = 0;
    var lastFocus = null;

    // Render and resize own all geometry reads; moving focus only uses this cache.
    function refresh() {
      var rect = grid.getBoundingClientRect();
      width = grid.clientWidth;
      maximum = Math.max(0, grid.scrollWidth - width);
      position = grid.scrollLeft;
      bounds = Array.prototype.map.call(grid.children, function (button) {
        var tile = button.getBoundingClientRect();
        var left = tile.left - rect.left + position;
        return { button: button, left: left, right: left + tile.width };
      });
    }

    function reveal(button) {
      for (var index = 0; index < bounds.length; index++) {
        var item = bounds[index];
        if (item.button !== button) continue;
        lastFocus = button;
        if (!maximum) return;
        var desired = position;
        if (item.left < desired) desired = item.left;
        else if (item.right > desired + width) desired = item.right - width;
        position = Math.max(0, Math.min(maximum, desired));
        // focus() may have scrolled before its asynchronous scroll event arrives.
        grid.scrollLeft = position;
        return;
      }
    }

    grid.addEventListener('scroll', function () { position = grid.scrollLeft; });
    window.addEventListener('resize', function () {
      refresh();
      if (lastFocus) reveal(lastFocus);
    });
    return { refresh: refresh, reveal: reveal };
  }

  window.LauncherDockScroll = { mount: mount };
}());
