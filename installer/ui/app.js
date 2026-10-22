(function (root) {
  'use strict';
  var LABELS = { ready: 'Preparado', planned: 'Plan preparado', pending: 'Pendiente', applied: 'Aplicado', verified: 'Verificado',
    'recovery-pending': 'Recuperación pendiente', complete: 'Completado', partial: 'Parcial', blocked: 'Bloqueado', failed: 'Error', skipped: 'Omitido' };
  function safeText(value, limit) { return typeof value === 'string' ? value.slice(0, limit || 300) : ''; }
  function privateHost(value) {
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return false;
    var parts = value.split('.').map(Number);
    return parts.every(function (part) { return part >= 0 && part <= 255; }) &&
      (parts[0] === 10 || parts[0] === 192 && parts[1] === 168 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
  }
  function createApp(options) {
    var document = options.document, fetch = options.fetch;
    var schedule = options.setTimeout || setTimeout, cancel = options.clearTimeout || clearTimeout;
    var state = { busy: false, revision: 0, plan: null, backupId: null, backupTarget: null, pendingTarget: null, uncertain: false,
      identities: [], media: null, mediaPendingTarget: null, rootPlan: null, rootActive: false, rootTarget: null, rootPendingTarget: null };
    function node(id) { return document.getElementById(id); }
    function text(id, value) { node(id).textContent = value; }
    function values() {
      var removeApps = Array.prototype.slice.call(document.querySelectorAll('[name="removeApps"]')).filter(function (input) { return input.checked; }).map(function (input) { return input.value; });
      return { host: node('host').value.trim(), identity: node('identity').value.trim(), options: {
        install: node('install').checked, home: node('home').checked, privacy: node('privacy').checked, root: false, removeApps: removeApps } };
    }
    function snapshot() { return JSON.stringify(values()); }
    function target() { var input = values(); return JSON.stringify([input.host, input.identity]); }
    function validPlan() {
      if (state.uncertain || state.mediaPendingTarget || state.rootPendingTarget || !state.plan || state.plan.snapshot !== snapshot()) return false;
      var expiry = state.plan.expiresAt;
      return !expiry || (typeof expiry === 'number' ? expiry : Date.parse(expiry)) > Date.now();
    }
    function buttons() {
      node('connect').disabled = state.busy; node('prepare').disabled = state.busy || state.uncertain || !!state.mediaPendingTarget || !!state.rootPendingTarget;
      node('connect').textContent = state.uncertain ? 'Revisar estado' : 'Comprobar conexión';
      node('apply').disabled = state.busy || !validPlan(); node('restore').disabled = state.busy || !!state.mediaPendingTarget || !!state.rootPendingTarget || !state.backupId || state.backupTarget !== target();
      node('identities').disabled = state.busy; node('identity-choice').disabled = state.busy;
      node('root-status').disabled = state.busy;
      node('root-plan').disabled = state.busy || state.rootActive || state.uncertain || !!state.mediaPendingTarget || !!state.rootPendingTarget;
      node('root-apply').disabled = state.busy || !validRootPlan();
      node('screen-status').disabled = state.busy;
      ['Prepare', 'Start', 'Stop'].forEach(function (name) { node('screen-' + name.toLowerCase()).disabled = !canScreen(name); });
      Array.prototype.slice.call(document.querySelectorAll('input')).forEach(function (input) { input.disabled = state.busy; });
      node('setup-form').setAttribute('aria-busy', state.busy ? 'true' : 'false');
    }
    function invalidate() {
      state.revision++; state.plan = null; state.rootPlan = null;
      text('plan-status', state.uncertain ? 'Hay una operación sin confirmar. Volvé al destino original y usá Revisar estado.' : 'Prepará un nuevo plan para revisar esta configuración.');
      text('device-status', 'Compatibilidad y acceso por consultar.');
      text('root-summary', 'Revisá root para comprobar el acceso con esta configuración.');
      if (state.rootTarget !== target()) { state.rootActive = false; state.rootTarget = null; }
      mediaStatus('capture-status'); mediaStatus('lights-status');
      if (state.media && state.media.target !== target()) { state.media = null; screenLabel('Sin revisar', 'Revisá la captura para esta TV y esta clave.', 'unknown'); }
      buttons();
    }
    function validate() {
      var input = values();
      if (!privateHost(input.host)) { text('feedback', 'Ingresá la dirección IPv4 privada de la TV en tu red local.'); return false; }
      if (!input.identity || input.identity.length > 1024 || /[\r\n\u0000]/.test(input.identity)) {
        text('feedback', 'Ingresá la ruta completa del archivo de clave SSH guardado en esta PC, o buscá una clave con el botón.'); return false;
      }
      return true;
    }
    function mediaStatus(id, detail) {
      var verified = detail && detail.verified === true;
      if (id === 'capture-status' && verified && detail.framesVerified === true) { text(id, 'Video recibido · verificado'); return; }
      text(id, verified && detail.active === true ? 'Activo · verificado' : verified && detail.active === false ? 'Verificado · inactivo' : verified ? 'Verificado · estado sin confirmar' : 'Sin verificar');
    }
    function render(result) {
      text('result-summary', safeText(result.summary) || 'Consulta completada. Revisá el detalle de cada paso.');
      text('result-status', LABELS[result.status] || 'Estado sin confirmar');
      node('result-status').setAttribute('data-state', LABELS[result.status] ? result.status : 'unknown');
      var steps = node('steps'); steps.textContent = '';
      (Array.isArray(result.steps) ? result.steps.slice(0, 20) : []).forEach(function (step) {
        if (!step || typeof step !== 'object') return;
        var row = document.createElement('li'), label = document.createElement('span'), badge = document.createElement('span');
        label.textContent = safeText(step.label, 180) || 'Paso sin descripción';
        badge.textContent = LABELS[step.status] || 'Sin confirmar'; badge.setAttribute('class', 'step-state');
        row.appendChild(label); row.appendChild(badge); steps.appendChild(row);
      });
      var device = result.device;
      if (device && typeof device === 'object') {
        var compatibility = device.verified !== true ? 'Identidad sin verificar' : device.supported === true ? 'Modelo y firmware compatibles' : device.supported === false ? 'Equipo no compatible' : 'Compatibilidad sin confirmar';
        var privilege = device.privilege === 'root' ? 'Acceso root confirmado' : device.privilege === 'non-root' ? 'Sin acceso root' : 'Acceso root sin confirmar';
        text('device-status', compatibility + ' · ' + privilege);
      }
      mediaStatus('capture-status', result.capture); mediaStatus('lights-status', result.lights);
    }
    function request(action, payload, onResult) {
      if (state.busy) return Promise.resolve(false);
      var meta = document.querySelector('meta[name="setup-token"]'), token = meta && meta.getAttribute('content');
      if (!token) { text('feedback', 'Abrí esta página desde el asistente local para iniciar una sesión.'); return Promise.resolve(false); }
      var revision = state.revision, timer, finished = false, identityOnly = action === 'identities';
      if (!identityOnly) state.rootPlan = null;
      state.busy = true; buttons(); text('feedback', action === 'apply' || action === 'restore' ? 'Procesando. Esperá la confirmación del asistente local.' : 'Consultando al asistente local…');
      if (!identityOnly) { text('result-status', LABELS.pending); node('result-status').setAttribute('data-state', 'pending');
        mediaStatus('capture-status'); mediaStatus('lights-status'); state.media = null;
        if (!/^screen/.test(action)) screenLabel('Sin revisar', 'Revisá captura para comprobar el estado actual de la sincronización.', 'unknown'); }
      return new Promise(function (resolve) {
        function finish(result, message) {
          if (finished) return;
          finished = true; cancel(timer); state.busy = false;
          var targetChanged = typeof payload.host === 'string' && JSON.stringify([payload.host, payload.identity]) !== target();
          if ((action === 'status' || action === 'plan' || /^root|^screen/.test(action)) && (revision !== state.revision || targetChanged)) {
            text('feedback', 'La configuración cambió. Repetí la consulta para revisar el estado actual.');
          } else if (message) {
            if (action === 'apply' || action === 'restore') {
              state.plan = null; state.uncertain = true;
              text('plan-status', 'La operación no está confirmada. Usá Revisar estado para recuperar su respaldo; no repitas la aplicación.');
            }
            if (/^screen/.test(action)) screenLabel('Sin confirmar', state.mediaPendingTarget ? 'La operación sigue sin confirmar. Revisá captura en el destino original antes de repetirla.' : 'No se pudo comprobar la captura. Volvé a revisar antes de activar las luces.', 'unknown');
            if (action === 'rootStatus') text('root-summary', 'El acceso root sigue sin confirmar. Revisá la conexión e intentá la consulta otra vez.');
            if (action === 'rootApply') text('root-plan-status', 'Aplicación sin confirmar. Conservá el respaldo y usá Revisar root en el destino original; no repitas la cadena.');
            if (!identityOnly) { text('result-status', 'Sin confirmar'); node('result-status').setAttribute('data-state', 'unknown'); }
            text('feedback', message);
          } else {
            if (!identityOnly) render(result); onResult(result); text('feedback', 'Respuesta recibida.');
          }
          buttons(); resolve(!message);
        }
        timer = schedule(function () { finish(null, 'El asistente local no respondió a tiempo. El resultado de la operación no está confirmado.'); }, options.timeoutMs || (action === 'rootApply' || action === 'screenPrepare' ? 305000 : 125000));
        var promise;
        try { promise = fetch('/api', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Setup-Token': token }, body: JSON.stringify({ action: action, payload: payload }) }); }
        catch (error) { finish(null, 'No se pudo contactar al asistente local.'); return; }
        Promise.resolve(promise).then(function (response) { if (!response.ok) throw new Error('http'); return response.json(); }).then(function (data) {
          if (!data || data.ok !== true || !data.result || typeof data.result !== 'object' || Array.isArray(data.result)) {
            finish(null, safeText(data && data.error && data.error.message) || 'El asistente local rechazó la operación.'); return;
          }
          finish(data.result);
        }, function () { finish(null, 'No se pudo contactar al asistente local. El resultado no está confirmado.'); });
      });
    }
    function findIdentities() {
      if (state.busy) return Promise.resolve(false);
      text('identity-status', 'Buscando archivos de clave conocidos en esta computadora…');
      return request('identities', {}, function (result) {
        state.identities = (Array.isArray(result.identities) ? result.identities : []).slice(0, 20).filter(function (item) {
          return item && typeof item.path === 'string' && item.path.length > 0 && item.path.length <= 1024 && !/[\r\n\u0000]/.test(item.path);
        });
        var select = node('identity-choice'); select.textContent = '';
        var empty = document.createElement('option'); empty.value = ''; empty.textContent = 'Elegí una clave…'; select.appendChild(empty);
        state.identities.forEach(function (item) { var option = document.createElement('option'); option.value = item.path;
          option.textContent = (safeText(item.label, 100) || 'Clave SSH') + ' · ' + item.path; select.appendChild(option); });
        node('identity-results').hidden = state.identities.length === 0;
        text('identity-status', state.identities.length ? 'Elegí una clave de la lista. La conexión comprobará si permite acceder a esta TV.' : 'No encontramos claves conocidas. Podés escribir la ruta completa del archivo manualmente.');
      }).then(function (ok) { if (!ok) text('identity-status', 'No se pudo buscar claves. Podés escribir la ruta completa del archivo manualmente.'); return ok; });
    }
    function selectIdentity() {
      if (state.busy) return;
      var selected = node('identity-choice').value;
      if (!state.identities.some(function (item) { return item.path === selected; })) return;
      node('identity').value = selected; invalidate();
      text('identity-status', 'Clave seleccionada. Comprobá la conexión para verificar el acceso.');
    }
    function screenLabel(label, summary, status) {
      text('screen-badge', label); node('screen-badge').setAttribute('data-state', status); text('screen-summary', summary);
    }
    function validRootPlan() {
      var p = state.rootPlan;
      return !state.rootActive && !state.rootPendingTarget && !state.uncertain && !state.mediaPendingTarget && p && p.target === target() && p.snapshot === snapshot() && p.expiresAt > Date.now();
    }
    function rootAction(name) {
      if (state.busy || !validate() || name === 'Plan' && node('root-plan').disabled) return Promise.resolve(false);
      if (name === 'Apply' && !validRootPlan()) { state.rootPlan = null; text('root-plan-status', 'El plan venció o cambió. Prepará y revisá un plan nuevo.'); buttons(); return Promise.resolve(false); }
      var input = values(), queriedTarget = target(), plan = state.rootPlan;
      state.plan = null; state.rootPlan = null;
      if (name === 'Apply') state.rootPendingTarget = queriedTarget;
      text('root-summary', name === 'Apply' ? 'Ejecutando las etapas revisadas. Esperá la verificación final.' : 'Comprobando el acceso y los requisitos para este modelo…');
      return request('root' + name, name === 'Apply' ? { planId: plan.id } : { host: input.host, identity: input.identity }, function (result) {
        var detail = result.root || {}, recovery = result.rootRecovery || result.recovery, pending = recovery && recovery.pending === true;
        var confirmed = detail.active === true && (detail.verified === true || name !== 'Status' && (result.status === 'skipped' || result.physicalBootPending === true));
        state.rootActive = confirmed; state.rootTarget = queriedTarget;
        if (pending && !state.rootPendingTarget) state.rootPendingTarget = queriedTarget;
        if (state.rootPendingTarget === queriedTarget && !pending && (confirmed || name === 'Apply' && result.status === 'blocked')) state.rootPendingTarget = null;
        text('root-summary', confirmed ? detail.persistent === true ? 'Root activo y persistente. No hace falta repetir el procedimiento.' : safeText(result.summary) || 'Root activo. La persistencia después de reiniciar sigue sin confirmar.' : safeText(detail.reason) || safeText(result.summary) || 'El acceso root no está confirmado. Revisá la conexión y los requisitos de este modelo.');
        if (name === 'Plan' && result.status === 'planned' && result.plan && /^[a-f0-9]{32}$/.test(result.plan.id || '') && typeof result.plan.expiresAt === 'number' && Array.isArray(result.steps) && result.steps.length > 0 && result.steps.length <= 20 && result.steps.every(function (s) { return s && typeof s.label === 'string' && s.label.length > 0 && ['planned', 'skipped'].indexOf(s.status) !== -1; })) {
          state.rootPlan = { id: result.plan.id, expiresAt: result.plan.expiresAt, target: queriedTarget, snapshot: snapshot() };
          text('root-plan-status', 'Plan experimental preparado. Revisá todas las etapas en el panel de resultados antes de aplicar.');
        } else text('root-plan-status', pending || state.rootPendingTarget ? 'Recuperación pendiente. Conservá el respaldo' + (safeText(result.backupId || recovery && recovery.backupId, 64) ? ' ' + safeText(result.backupId || recovery.backupId, 64) : '') + ' y revisá el acceso antes de continuar.' : confirmed ? 'La cadena de root se omite porque ya está activo.' : 'Preparar root sólo consulta. La aplicación requiere un plan nuevo y revisado.');
      });
    }
    function canScreen(name) {
      if (state.busy || state.uncertain || state.rootPendingTarget || !state.media || state.media.target !== target()) return false;
      var capture = state.media.capture || {}, lights = state.media.lights || {};
      if (name === 'Stop') return (!state.mediaPendingTarget || state.mediaPendingTarget === target()) && (state.media.canStop === true || state.media.recovery || lights.verified === true && lights.active === true);
      if (state.mediaPendingTarget) return false;
      if (name === 'Prepare') return typeof state.media.canPrepare === 'boolean' ? state.media.canPrepare : capture.verified === true && capture.available !== true;
      return capture.verified === true && capture.available === true && !(lights.verified === true && lights.active === true);
    }
    function screenAction(name) {
      if (state.busy || !validate() || name !== 'Status' && !canScreen(name)) return Promise.resolve(false);
      var queriedTarget = target(), input = values(), mutation = name !== 'Status';
      state.plan = null;
      if (mutation) { state.mediaPendingTarget = queriedTarget; text('plan-status', 'La captura cambió. Prepará un plan nuevo antes de aplicar otros cambios.'); }
      screenLabel('Consultando', mutation ? 'Esperá la verificación antes de repetir esta acción.' : 'Comprobando componentes, captura y sincronización…', 'pending');
      return request('screen' + name, { host: input.host, identity: input.identity }, function (result) {
        if (queriedTarget !== target()) return;
        var capture = result.capture || {}, lights = result.lights || {}, baseline = lights.pending === true || result.recovery && result.recovery.pending === true;
        var active = lights.verified === true && lights.active === true, pending = baseline && !active;
        state.media = { target: queriedTarget, capture: capture, lights: lights, recovery: baseline, canStop: result.canStop, canPrepare: result.canPrepare };
        if (queriedTarget === state.mediaPendingTarget && !pending && capture.verified === true && (name === 'Prepare' ||
            lights.verified === true && (name !== 'Stop' || lights.active === false && lights.pending === false))) state.mediaPendingTarget = null;
        if (pending && !state.mediaPendingTarget) state.mediaPendingTarget = queriedTarget;
        var unknown = !!state.mediaPendingTarget && queriedTarget === state.mediaPendingTarget;
        var label = 'Sin verificar';
        if (unknown) label = 'Revisión pendiente';
        else if (active) label = 'Sincronización activa';
        else if (capture.verified === true && capture.available === true) label = lights.verified === true ? 'Lista para activar' : 'Captura lista · luces sin confirmar';
        else if (capture.verified === true && capture.available === false) label = 'Captura no disponible';
        screenLabel(label,
          unknown ? 'Revisá captura para confirmar el resultado. Si hay una sesión pendiente, podés desactivarla para recuperar las luces.' :
            safeText(result.summary) || safeText(capture.reason) || (active ? 'La captura y las luces confirmaron la sincronización con el video.' : 'La revisión está completa. Elegí la próxima acción.'), unknown ? 'recovery-pending' : active ? 'verified' : result.status || 'ready');
      });
    }
    function connect() {
      if (state.busy || !validate()) return Promise.resolve(false);
      state.plan = null; buttons(); var input = values(), queriedTarget = target();
      return request('status', { host: input.host, identity: input.identity }, function (result) {
        var recovery = result.recovery;
        var confirmedRecovery = recovery && typeof recovery.pending === 'boolean' && ['prepared', 'unconfirmed', 'applied', 'restoring', 'restored', 'inflight'].indexOf(recovery.phase) !== -1;
        var matching = queriedTarget === target() && (queriedTarget === state.pendingTarget || state.pendingTarget === null && confirmedRecovery);
        if (matching) {
          if (state.pendingTarget === null) state.pendingTarget = queriedTarget;
          if (recovery && recovery.pending === true) {
            state.uncertain = true;
            if (!result.backupId) { state.backupId = null; state.backupTarget = null; }
          }
          if (typeof result.backupId === 'string' && result.backupId) { state.backupId = result.backupId; state.backupTarget = queriedTarget; }
          if (recovery && recovery.pending === false && (recovery.phase === 'applied' || recovery.phase === 'restored')) {
            state.uncertain = false;
            if (recovery.phase === 'restored') { state.backupId = null; state.backupTarget = null; state.pendingTarget = null; }
          }
        }
        text('plan-status', state.uncertain ? state.backupId && state.backupTarget === target() ? 'Respaldo recuperado. La operación sigue sin confirmar; podés restaurarlo.' : 'La operación sigue sin confirmar. Revisá el estado del destino original para recuperar su respaldo.' : matching && state.backupId ? 'Respaldo recuperado. Revisá el resultado o restaurá los cambios.' : 'Elegí los cambios y prepará un plan.');
      });
    }
    function prepare() {
      if (state.busy || !validate()) return Promise.resolve(false);
      if (state.uncertain || state.mediaPendingTarget || state.rootPendingTarget) { text('feedback', 'Revisá la operación sin confirmar antes de preparar nuevos cambios.'); return Promise.resolve(false); }
      state.plan = null; var bound = snapshot(), boundTarget = target();
      return request('plan', values(), function (result) {
        var blocked = result.status !== 'planned' && result.status !== 'ready' || result.steps !== undefined && !Array.isArray(result.steps) || (Array.isArray(result.steps) ? result.steps : []).some(function (step) { return !step || step.status === 'blocked' || step.status === 'failed'; });
        if (result.plan && typeof result.plan.id === 'string' && result.plan.id && !blocked) {
          state.plan = { id: result.plan.id, snapshot: bound, target: boundTarget, expiresAt: result.plan.expiresAt };
          text('plan-status', 'Plan preparado. Revisá los pasos antes de aplicar.');
        } else text('plan-status', 'Este plan no puede aplicarse. Revisá los pasos bloqueados.');
      });
    }
    function apply() {
      if (state.busy) return Promise.resolve(false);
      if (!validPlan()) { invalidate(); text('feedback', 'Prepará y revisá un plan nuevo antes de aplicar.'); return Promise.resolve(false); }
      var planId = state.plan.id; state.pendingTarget = state.plan.target; state.plan = null;
      state.backupId = null; state.backupTarget = null;
      return request('apply', { planId: planId }, function (result) {
        if (typeof result.backupId === 'string' && result.backupId) { state.backupId = result.backupId; state.backupTarget = state.pendingTarget; }
        state.uncertain = result.status === 'recovery-pending' || Array.isArray(result.codes) && result.codes.indexOf('APPLY_UNCONFIRMED') !== -1;
        text('plan-status', 'El plan fue enviado. El detalle indica qué se aplicó y qué se verificó.');
      });
    }
    function restore() {
      if (state.busy || state.mediaPendingTarget || state.rootPendingTarget || !state.backupId || state.backupTarget !== target()) return Promise.resolve(false);
      return request('restore', { backupId: state.backupId }, function (result) {
        state.plan = null;
        if (result.status === 'verified' || result.status === 'complete') { state.backupId = null; state.backupTarget = null; state.pendingTarget = null; state.uncertain = false; }
        text('plan-status', result.status === 'verified' ? 'Restauración verificada.' : result.status === 'complete' ? 'Restauración completada.' : 'Revisá el resultado de la restauración.');
      });
    }
    function start() {
      node('setup-form').addEventListener('input', invalidate); node('setup-form').addEventListener('change', invalidate);
      node('setup-form').addEventListener('submit', function (event) { event.preventDefault(); connect(); });
      [['connect', connect], ['prepare', prepare], ['apply', apply], ['restore', restore]].forEach(function (entry) { node(entry[0]).addEventListener('click', entry[1]); });
      node('identities').addEventListener('click', findIdentities); node('identity-choice').addEventListener('change', selectIdentity);
      ['Status', 'Plan', 'Apply'].forEach(function (name) { node('root-' + name.toLowerCase()).addEventListener('click', function () { rootAction(name); }); });
      ['Status', 'Prepare', 'Start', 'Stop'].forEach(function (name) { node('screen-' + name.toLowerCase()).addEventListener('click', function () { screenAction(name); }); });
      mediaStatus('capture-status'); mediaStatus('lights-status'); buttons();
    }
    return { start: start, connect: connect, prepare: prepare, apply: apply, restore: restore, invalidate: invalidate, findIdentities: findIdentities,
      rootStatus: function () { return rootAction('Status'); }, rootPlan: function () { return rootAction('Plan'); }, rootApply: function () { return rootAction('Apply'); },
      screenStatus: function () { return screenAction('Status'); }, screenPrepare: function () { return screenAction('Prepare'); },
      screenStart: function () { return screenAction('Start'); }, screenStop: function () { return screenAction('Stop'); },
      getState: function () { return { busy: state.busy, planId: state.plan && state.plan.id, backupId: state.backupId, uncertain: state.uncertain }; } };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { createApp: createApp, privateHost: privateHost };
  else root.MiPantallaSetup = { createApp: createApp };
  if (root && root.document) root.document.addEventListener('DOMContentLoaded', function () {
    createApp({ document: root.document, fetch: root.fetch.bind(root) }).start();
  });
}(typeof window === 'undefined' ? null : window));
