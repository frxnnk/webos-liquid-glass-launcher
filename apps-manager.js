(function () {
  'use strict';

  function element(tag, className, text) {
    var node = document.createElement(tag);
    node.className = className || '';
    if (text) node.textContent = text;
    return node;
  }

  function mount(options) {
    var list = options.list;
    if (!list) return null;
    var rows = [];
    var rememberedKey = null;
    list.className += ' apps-manager';
    var toolbar = element('div', 'apps-toolbar');
    var summary = element('p', 'apps-summary');
    var refresh = element('button', 'ghost-button apps-refresh', 'Actualizar apps');
    refresh.type = 'button';
    refresh.setAttribute('data-app-action', 'refresh');
    refresh.addEventListener('click', function () {
      if (!refresh.disabled && options.onRefresh) options.onRefresh();
    });
    toolbar.appendChild(summary);
    toolbar.appendChild(refresh);
    var feedback = element('p', 'apps-feedback');
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');
    var scroller = element('div', 'apps-rows');
    scroller.setAttribute('role', 'list');
    scroller.setAttribute('aria-label', 'Aplicaciones y entradas disponibles');
    list.appendChild(toolbar);
    list.appendChild(feedback);
    list.appendChild(scroller);

    function focus(key, action) {
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].key !== key) continue;
        var target = rows[i].controls.filter(function (button) {
          return button.getAttribute('data-app-action') === (action || 'toggle') && !button.disabled;
        })[0] || rows[i].controls[0];
        target.focus();
        return true;
      }
      return false;
    }

    function actionButton(item, action, label, callback) {
      var button = element('button', action === 'toggle' ? 'switch-button apps-toggle' : 'apps-move');
      button.type = 'button';
      button.setAttribute('aria-label', label);
      button.setAttribute('data-app-key', item.key);
      button.setAttribute('data-app-action', action);
      button.addEventListener('click', function () { if (!button.disabled) callback(); });
      button.addEventListener('focus', function () {
        rememberedKey = item.key;
        if (button.parentNode && button.parentNode.scrollIntoView) {
          button.parentNode.scrollIntoView({block:'nearest', inline:'nearest'});
        }
      });
      return button;
    }

    function appRow(item, position, total) {
      var row = element('div', 'apps-row' + (item.visible ? '' : ' is-hidden'));
      row.setAttribute('role', 'listitem');
      row.setAttribute('data-app-row', item.key);
      var icon = element('span', 'apps-icon');
      icon.setAttribute('aria-hidden', 'true');
      var initial = element('span', 'apps-initial', (item.title || 'A').charAt(0).toUpperCase());
      initial.hidden = !!item.logo;
      icon.appendChild(initial);
      if (item.logo) {
        var image = element('img', 'apps-image');
        image.src = item.logo;
        image.alt = '';
        image.setAttribute('draggable', 'false');
        image.addEventListener('error', function () { image.hidden = true; initial.hidden = false; });
        icon.appendChild(image);
      }
      row.appendChild(icon);
      var name = element('span', 'apps-name');
      var title = element('span', 'apps-title', item.title);
      title.setAttribute('title', item.title);
      name.appendChild(title);
      name.appendChild(element('small', '', (item.kind === 'input' ? 'Entrada' : 'Aplicación') +
        ' · ' + (item.visible ? 'Posición ' + position : 'Fuera del inicio')));
      row.appendChild(name);

      var toggle = actionButton(item, 'toggle', (item.visible ? 'Ocultar ' : 'Agregar ') + item.title + (item.visible ? ' del inicio' : ' al inicio'), function () {
        if (options.onToggle) options.onToggle(item.key);
      });
      toggle.setAttribute('role', 'switch');
      toggle.setAttribute('aria-checked', item.visible ? 'true' : 'false');
      var track = element('span', 'switch');
      track.appendChild(element('span', 'switch-knob'));
      toggle.appendChild(track);
      row.appendChild(toggle);

      var earlier = actionButton(item, 'earlier', 'Mover ' + item.title + ' antes', function () {
        if (options.onMove) options.onMove(item.key, -1);
      });
      earlier.textContent = '↑';
      earlier.disabled = !item.visible || position <= 1;
      row.appendChild(earlier);
      var later = actionButton(item, 'later', 'Mover ' + item.title + ' después', function () {
        if (options.onMove) options.onMove(item.key, 1);
      });
      later.textContent = '↓';
      later.disabled = !item.visible || position >= total;
      row.appendChild(later);
      rows.push({key:item.key, controls:[toggle, earlier, later]});
      return row;
    }

    function render(items, state) {
      state = state || {};
      var active = document.activeElement;
      var focusKey = state.focusKey;
      var focusAction = state.focusAction;
      if (!focusKey && active && list.contains(active) && active.getAttribute) {
        focusKey = active.getAttribute('data-app-key');
        focusAction = active.getAttribute('data-app-action');
      }
      var totals = {app:0, input:0};
      var positions = {app:0, input:0};
      items.forEach(function (item) { if (item.visible) totals[item.kind === 'input' ? 'input' : 'app']++; });
      summary.textContent = (totals.app + totals.input) + ' en el inicio · ' + items.length + ' disponibles';
      refresh.disabled = !!state.loading;
      refresh.textContent = state.loading ? 'Actualizando…' : 'Actualizar apps';
      feedback.textContent = state.loading ? 'Buscando las apps instaladas en la TV…' : state.error || 'Elegí qué ver y usá ↑ ↓ para cambiar el orden.';
      scroller.textContent = '';
      rows = [];
      items.forEach(function (item) {
        var kind = item.kind === 'input' ? 'input' : 'app';
        if (item.visible) positions[kind]++;
        scroller.appendChild(appRow(item, positions[kind], totals[kind]));
      });
      if (focusKey && !focus(focusKey, focusAction)) {
        if (!refresh.disabled) refresh.focus();
        else if (rows.length) focus(rows[0].key, 'toggle');
      } else if (active === refresh && refresh.disabled && rows.length) focus(rows[0].key, 'toggle');
    }

    // Las flechas dentro del catálogo no necesitan medir las otras 100 filas.
    // Salir por sus bordes queda a cargo de la navegación general del panel.
    function handlesNavigation(key, active) {
      if (!active || !list.contains(active) || !/^Arrow(Left|Right|Up|Down)$/.test(key)) return false;
      if (active === refresh) {
        if (key !== 'ArrowDown' || !rows.length) return false;
        if (!focus(rememberedKey, 'toggle')) focus(rows[0].key, 'toggle');
        return true;
      }
      for (var i = 0; i < rows.length; i++) {
        var at = rows[i].controls.indexOf(active);
        if (at === -1) continue;
        if (key === 'ArrowUp' || key === 'ArrowDown') {
          var next = i + (key === 'ArrowDown' ? 1 : -1);
          if (next < 0 && !refresh.disabled) { refresh.focus(); return true; }
          if (!rows[next]) return false;
          focus(rows[next].key, active.getAttribute('data-app-action'));
          return true;
        }
        var step = key === 'ArrowRight' ? 1 : -1;
        for (var index = at + step; index >= 0 && index < rows[i].controls.length; index += step) {
          if (!rows[i].controls[index].disabled) { rows[i].controls[index].focus(); break; }
        }
        return true;
      }
      return false;
    }

    return {render:render, focus:focus, handlesNavigation:handlesNavigation};
  }

  window.LauncherAppsManager = {mount:mount};
}());
