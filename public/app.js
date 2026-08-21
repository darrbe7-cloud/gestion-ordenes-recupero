// ---------------------------------------------------------
// ESTADO GLOBAL DEL CLIENTE
// ---------------------------------------------------------
var STATE = {
  rol: null,
  username: null,
  metaLists: { comunas: [], regionByComuna: {}, regiones: [] },
  dataPage: 0,
  dataPageSize: 100,
  dataSearch: '',
  dataTipoFilter: [],
  dataMesDesde: '',
  dataMesHasta: '',
  dataSistema: '',
  usersCache: [],
  processing: false
};

function estadoInicial_() {
  return {
    rol: null, username: null,
    metaLists: { comunas: [], regionByComuna: {}, regiones: [] },
    dataPage: 0, dataPageSize: 100, dataSearch: '', dataTipoFilter: [],
    dataMesDesde: '', dataMesHasta: '', dataSistema: '',
    usersCache: [], processing: false
  };
}

// ---------------------------------------------------------
// HELPER: fetch con manejo uniforme de errores/sesión
// ---------------------------------------------------------
async function api(path, options) {
  options = options || {};
  options.credentials = 'same-origin';
  if (options.body && !(options.body instanceof FormData)) {
    options.headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
  }
  var res = await fetch('/api' + path, options);
  if (res.status === 401) {
    handleSessionExpired();
    throw new Error('SESSION_EXPIRED');
  }
  var data = await res.json().catch(function () { return {}; });
  if (!res.ok && data.ok === undefined) {
    throw new Error(data.error || ('Error ' + res.status));
  }
  return data;
}

var sessionExpiredHandled = false;

function handleSessionExpired() {
  if (sessionExpiredHandled) return; // evita mostrarlo varias veces si fallan varias peticiones a la vez
  sessionExpiredHandled = true;
  doLogout(true);
  var errEl = document.getElementById('loginError');
  errEl.textContent = 'Tu sesión expiró. Vuelve a iniciar sesión.';
  errEl.classList.remove('hidden');
  setTimeout(function () { sessionExpiredHandled = false; }, 2000);
}

// ---------------------------------------------------------
// LOGIN / LOGOUT
// ---------------------------------------------------------
async function doLogin() {
  var username = document.getElementById('loginUsername').value;
  var password = document.getElementById('loginPassword').value;
  var btn = document.getElementById('btnLogin');
  var errEl = document.getElementById('loginError');
  errEl.classList.add('hidden');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Ingresando...';

  try {
    var res = await api('/login', { method: 'POST', body: JSON.stringify({ username: username, password: password }) });
    btn.disabled = false;
    btn.innerHTML = 'Ingresar';
    if (!res.ok) {
      errEl.textContent = res.error;
      errEl.classList.remove('hidden');
      return;
    }
    STATE.rol = res.rol;
    STATE.username = res.username;
    onLoginSuccess();
  } catch (e) {
    btn.disabled = false;
    btn.innerHTML = 'Ingresar';
    errEl.textContent = 'Error de conexión: ' + e.message;
    errEl.classList.remove('hidden');
  }
}

/**
 * Deja la pantalla en blanco/oculta todo lo que dependa de una sesión anterior.
 * Se llama SIEMPRE al iniciar sesión y al cerrar sesión, para que nunca queden
 * restos visuales de la cuenta anterior.
 */
function resetAppView() {
  document.querySelectorAll('.tab-content').forEach(function (el) { el.classList.add('hidden'); });
  document.querySelectorAll('.tab-btn').forEach(function (el) { el.classList.remove('active'); });
  document.querySelector('.tab-btn[data-tab="tab-upload"]').classList.add('active');

  document.getElementById('adminTabs').classList.add('hidden');
  document.getElementById('userDashboard').classList.add('hidden');
  document.getElementById('uploaderDashboard').classList.add('hidden');
  document.getElementById('ventaDashboard').classList.add('hidden');

  document.getElementById('usersTableBody').innerHTML = '';
  document.getElementById('dataCardAdmin').innerHTML = '';
  document.getElementById('dataCardUser').innerHTML = '';
  document.getElementById('metaStatsGx1').innerHTML = '';
  document.getElementById('metaStatsGx2').innerHTML = '';
  document.getElementById('metaStatsBodegaGx1').innerHTML = '';
  document.getElementById('metaStatsBodegaGx2').innerHTML = '';
  document.getElementById('processProgress').innerHTML = '';
  document.getElementById('processProgressUploader').innerHTML = '';
  document.getElementById('uploaderHistory').innerHTML = '';
  document.getElementById('uploaderHistoryBodega').innerHTML = '';
  document.getElementById('motivosTableBody').innerHTML = '';
  document.getElementById('gestionGlobalTableBody').innerHTML = '';
  document.getElementById('cardSinGestionar').innerHTML = '';
  document.getElementById('cardAgendados').innerHTML = '';
  document.getElementById('cardGestionados').innerHTML = '';
  document.getElementById('userUploadDatesCard').innerHTML = '';
  document.getElementById('modelosGx1List').innerHTML = '';
  document.getElementById('modelosGx2List').innerHTML = '';
  document.getElementById('depositosVisiblesList').innerHTML = '';
  document.getElementById('bodegaCardAdmin').innerHTML = '';
  document.getElementById('ventaOrdenesCard').innerHTML = '';
  document.getElementById('ventaBodegaCard').innerHTML = '';
  document.getElementById('uploaderBodegaCard').innerHTML = '';

  if (processPollTimer) { clearInterval(processPollTimer); processPollTimer = null; }
  if (processPollTimerUploader) { clearInterval(processPollTimerUploader); processPollTimerUploader = null; }
}

function onLoginSuccess() {
  resetAppView();
  document.getElementById('view-login').classList.add('hidden');
  document.getElementById('view-app').classList.remove('hidden');

  var rolLabels = { ADMIN: 'Administrador', UPLOADER: 'Carga de archivos', VENTA_GX1: 'Venta e instalación GX1', VENTA_GX2: 'Venta e instalación GX2' };
  var rolLabel = rolLabels[STATE.rol] || 'Usuario';
  document.getElementById('topbarUser').textContent = STATE.username + ' (' + rolLabel + ')';

  if (STATE.rol === 'ADMIN') {
    document.getElementById('adminTabs').classList.remove('hidden');
    switchTab('tab-upload');
    loadMetaStats();
    checkResumeProcessPolling();
  } else if (STATE.rol === 'UPLOADER') {
    document.getElementById('uploaderDashboard').classList.remove('hidden');
    loadUploaderHistory();
    checkResumeProcessPollingUploader();
  } else if (STATE.rol === 'VENTA_GX1' || STATE.rol === 'VENTA_GX2') {
    document.getElementById('ventaDashboard').classList.remove('hidden');
    var ordenesTabBtn = document.querySelector('#ventaTabs .tab-btn[data-vtab="v-ordenes"]');
    if (STATE.rol === 'VENTA_GX2') {
      ordenesTabBtn.classList.add('hidden');
      switchVentaTab('v-bodega');
    } else {
      ordenesTabBtn.classList.remove('hidden');
      switchVentaTab('v-ordenes');
    }
  } else {
    document.getElementById('userDashboard').classList.remove('hidden');
    loadUserUploadDates();
    switchUserTab('u-sin-gestionar');
  }
}

async function doLogout(skipCall) {
  if (!skipCall) { try { await api('/logout', { method: 'POST' }); } catch (e) {} }
  STATE = estadoInicial_();
  resetAppView();
  document.getElementById('view-app').classList.add('hidden');
  document.getElementById('view-login').classList.remove('hidden');
  document.getElementById('loginUsername').value = '';
  document.getElementById('loginPassword').value = '';
}

// Al cargar la página, revisar EN SILENCIO si ya hay una sesión activa
// (cookie válida). Se usa fetch directo (no la función api()) a propósito,
// para que un "no hay sesión todavía" (lo normal al abrir la página) no
// dispare el aviso de "tu sesión expiró".
window.addEventListener('DOMContentLoaded', async function () {
  try {
    var res = await fetch('/api/me', { credentials: 'same-origin' });
    if (res.status !== 200) return;
    var data = await res.json();
    if (data.ok) {
      STATE.rol = data.rol;
      STATE.username = data.username;
      onLoginSuccess();
    }
  } catch (e) { /* no hay sesión, se queda en el login */ }
});

// ---------------------------------------------------------
// CAMBIAR CONTRASEÑA PROPIA
// ---------------------------------------------------------
function openRecoverAdmin() {
  document.getElementById('recoverCodeInput').value = '';
  document.getElementById('recoverNewPasswordInput').value = '';
  document.getElementById('recoverModalMsg').classList.add('hidden');
  document.getElementById('recoverModalOverlay').classList.remove('hidden');
}
function closeRecoverAdmin() { document.getElementById('recoverModalOverlay').classList.add('hidden'); }

async function submitRecoverAdmin() {
  var recoveryCode = document.getElementById('recoverCodeInput').value;
  var newPassword = document.getElementById('recoverNewPasswordInput').value;
  var msgEl = document.getElementById('recoverModalMsg');
  msgEl.classList.add('hidden');
  try {
    var res = await fetch('/api/recover-admin', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recoveryCode: recoveryCode, newPassword: newPassword })
    });
    var data = await res.json();
    msgEl.classList.remove('hidden');
    if (data.ok) {
      msgEl.className = 'success-text';
      msgEl.textContent = 'Listo. La clave del usuario "' + data.username + '" fue restablecida. Ya puedes iniciar sesión con la nueva clave.';
      setTimeout(closeRecoverAdmin, 2500);
    } else {
      msgEl.className = 'error-text';
      msgEl.textContent = data.error;
    }
  } catch (e) {
    msgEl.classList.remove('hidden');
    msgEl.className = 'error-text';
    msgEl.textContent = e.message;
  }
}

function openChangePassword() {
  document.getElementById('newPasswordInput').value = '';
  document.getElementById('passModalMsg').classList.add('hidden');
  document.getElementById('passModalOverlay').classList.remove('hidden');
}
function closeChangePassword() { document.getElementById('passModalOverlay').classList.add('hidden'); }

async function submitChangePassword() {
  var newPass = document.getElementById('newPasswordInput').value;
  var msgEl = document.getElementById('passModalMsg');
  try {
    var res = await api('/change-password', { method: 'POST', body: JSON.stringify({ newPassword: newPass }) });
    if (res.ok) {
      msgEl.classList.remove('hidden');
      msgEl.className = 'success-text';
      msgEl.textContent = 'Contraseña actualizada.';
      setTimeout(closeChangePassword, 1200);
    } else {
      msgEl.classList.remove('hidden');
      msgEl.className = 'error-text';
      msgEl.textContent = res.error;
    }
  } catch (e) {
    msgEl.classList.remove('hidden');
    msgEl.className = 'error-text';
    msgEl.textContent = e.message;
  }
}

// ---------------------------------------------------------
// TABS (admin)
// ---------------------------------------------------------
function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(function (el) { el.classList.add('hidden'); });
  document.querySelectorAll('#adminTabs .tab-btn').forEach(function (el) { el.classList.remove('active'); });
  document.getElementById(tabId).classList.remove('hidden');
  document.querySelector('#adminTabs .tab-btn[data-tab="' + tabId + '"]').classList.add('active');

  if (tabId === 'tab-users') loadUsers();
  if (tabId === 'tab-data') { renderDataView('dataCardAdmin', true); loadDataTable('dataCardAdmin'); }
  if (tabId === 'tab-bodega') { loadDepositosVisibles(); renderBodegaView('bodegaCardAdmin', 'admin'); loadBodegaTable('bodegaCardAdmin', 'admin'); }
  if (tabId === 'tab-upload') loadMetaStats();
  if (tabId === 'tab-modelos') loadModelosPermitidos();
  if (tabId === 'tab-motivos') loadMotivos();
  if (tabId === 'tab-gestion') loadGestionGlobal();
}

// ---------------------------------------------------------
// CARGA DE ARCHIVO (ADMIN)
// ---------------------------------------------------------
var processPollTimer = null;

async function uploadFile() {
  var fileInput = document.getElementById('fileInput');
  var base = document.getElementById('uploadBaseSelect').value;
  var tipo = document.getElementById('uploadTipoSelect').value;
  if (!fileInput.files.length) { alert('Selecciona un archivo .xlsx primero.'); return; }
  var tipoTexto = tipo === 'BODEGA' ? 'de bodega' : 'de órdenes';
  if (!confirm('Esto reemplazará TODA la base ' + tipoTexto + ' ' + base + ' actual con el contenido de este archivo. El proceso corre en segundo plano. ¿Continuar?')) return;

  var formData = new FormData();
  formData.append('file', fileInput.files[0]);
  formData.append('base', base);
  formData.append('tipo', tipo);

  try {
    var res = await api('/upload', { method: 'POST', body: formData });
    if (!res.ok) { alert('Error al iniciar el procesamiento: ' + res.error); return; }
    STATE.processing = true;
    fileInput.value = '';
    startProcessPolling();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

function startProcessPolling() {
  renderProcessProgress({ estado: 'EN_PROGRESO', filasLeidas: 0, filasCargadas: 0 }, 'processProgress');
  if (processPollTimer) clearInterval(processPollTimer);
  processPollTimer = setInterval(pollProcessStatus, 2000);
  pollProcessStatus();
}

async function pollProcessStatus() {
  try {
    var status = await api('/upload/status');
    renderProcessProgress(status, 'processProgress');
    if (status.estado === 'COMPLETADO') {
      STATE.processing = false;
      clearInterval(processPollTimer);
      processPollTimer = null;
      loadMetaStats();
    } else if (status.estado === 'ERROR') {
      STATE.processing = false;
      clearInterval(processPollTimer);
      processPollTimer = null;
    }
  } catch (e) {
    clearInterval(processPollTimer);
    processPollTimer = null;
  }
}

async function checkResumeProcessPolling() {
  try {
    var status = await api('/upload/status');
    if (status.estado === 'EN_PROGRESO') {
      STATE.processing = true;
      renderProcessProgress(status, 'processProgress');
      if (processPollTimer) clearInterval(processPollTimer);
      processPollTimer = setInterval(pollProcessStatus, 2000);
    }
  } catch (e) {}
}

function renderProcessProgress(status, containerId) {
  var container = document.getElementById(containerId);
  if (!container) return;

  if (!status.estado || status.estado === 'INACTIVO') { container.innerHTML = ''; return; }
  if (status.estado === 'ERROR') {
    container.innerHTML = '<div class="card"><h3>Error al procesar</h3><p class="error-text">' + escapeHtml(status.error) + '</p></div>';
    return;
  }
  if (status.estado === 'COMPLETADO') {
    container.innerHTML = '<div class="card"><h3>Procesamiento completado (' + escapeHtml(status.base || '') + ')</h3>' +
      '<p class="success-text">Archivo: ' + escapeHtml(status.archivo) + ' — ' + status.filasLeidas + ' filas leídas, ' + status.filasCargadas + ' filas cargadas tras el filtro.</p></div>';
    return;
  }
  container.innerHTML =
    '<div class="card">' +
      '<h3>Procesando ' + escapeHtml(status.base || '') + ': ' + escapeHtml(status.archivo || '') + '...</h3>' +
      '<div class="progress-bar-outer"><div class="progress-bar-inner" style="width: 100%; animation: pulse 1.5s infinite;"></div></div>' +
      '<p class="muted">' + status.filasLeidas + ' filas revisadas, ' + status.filasCargadas + ' cargadas hasta ahora. Puedes seguir usando la página.</p>' +
    '</div>';
}

async function loadMetaStats() {
  try {
    var meta = await api('/admin/meta');
    var tiposUnicos = Array.from(new Set((meta.gx1.tipos || []).concat(meta.gx2.tipos || []))).sort();
    STATE.metaLists = { comunas: meta.comunas, regionByComuna: meta.regionByComuna, regiones: meta.regiones, tipos: tiposUnicos };
    renderStatsBase_('metaStatsGx1', meta.gx1);
    renderStatsBase_('metaStatsGx2', meta.gx2);
    document.getElementById('metaStatsBodegaGx1').innerHTML =
      statBox(meta.bodegaGx1.totalRows, 'Ítems cargados') +
      statBox(meta.bodegaGx1.lastUploadFilename || '—', 'Último archivo') +
      statBox(meta.bodegaGx1.lastUploadDate ? new Date(meta.bodegaGx1.lastUploadDate).toLocaleString() : '—', 'Fecha de última carga');
    document.getElementById('metaStatsBodegaGx2').innerHTML =
      statBox(meta.bodegaGx2.totalRows, 'Ítems cargados') +
      statBox(meta.bodegaGx2.lastUploadFilename || '—', 'Último archivo') +
      statBox(meta.bodegaGx2.lastUploadDate ? new Date(meta.bodegaGx2.lastUploadDate).toLocaleString() : '—', 'Fecha de última carga');
  } catch (e) {
    document.getElementById('metaStatsGx1').innerHTML = '<p class="error-text">' + e.message + '</p>';
  }
  try {
    var config = await api('/admin/config/gx1-dias-minimos');
    document.getElementById('gx1DiasMinimosInput').value = config.dias;
  } catch (e) {}
}

async function guardarGx1DiasMinimos() {
  var dias = document.getElementById('gx1DiasMinimosInput').value;
  try {
    var res = await api('/admin/config/gx1-dias-minimos', { method: 'PUT', body: JSON.stringify({ dias: dias }) });
    if (!res.ok) { alert('Error: ' + res.error); return; }
    alert('Guardado. Ahora se usarán ' + dias + ' días como corte entre venta y terreno para GX1.');
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

function renderStatsBase_(elId, stats) {
  document.getElementById(elId).innerHTML =
    statBox(stats.totalRowsFiltered, 'Filas activas (filtradas)') +
    statBox(stats.totalRowsRaw, 'Filas en el último archivo') +
    statBox(stats.tipos.length, 'Modelos distintos') +
    statBox(stats.lastUploadFilename || '—', 'Último archivo procesado') +
    statBox(stats.lastUploadDate ? new Date(stats.lastUploadDate).toLocaleString() : '—', 'Fecha de última carga');
}

function statBox(num, label) {
  return '<div class="stat-box"><div class="num">' + num + '</div><div class="lbl">' + label + '</div></div>';
}

// ---------------------------------------------------------
// CARGA DE ARCHIVO (ROL UPLOADER)
// ---------------------------------------------------------
var processPollTimerUploader = null;

async function uploadFileUploader() {
  var fileInput = document.getElementById('fileInputUploader');
  var base = document.getElementById('uploadBaseSelectUploader').value;
  var tipo = document.getElementById('uploadTipoSelectUploader').value;
  if (!fileInput.files.length) { alert('Selecciona un archivo .xlsx primero.'); return; }
  if (!confirm('Esto reemplazará TODA la base ' + base + ' actual con el contenido de este archivo. ¿Continuar?')) return;

  var formData = new FormData();
  formData.append('file', fileInput.files[0]);
  formData.append('base', base);
  formData.append('tipo', tipo);

  try {
    var res = await api('/upload', { method: 'POST', body: formData });
    if (!res.ok) { alert('Error al iniciar el procesamiento: ' + res.error); return; }
    fileInput.value = '';
    startProcessPollingUploader();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

function startProcessPollingUploader() {
  renderProcessProgress({ estado: 'EN_PROGRESO', filasLeidas: 0, filasCargadas: 0 }, 'processProgressUploader');
  if (processPollTimerUploader) clearInterval(processPollTimerUploader);
  processPollTimerUploader = setInterval(pollProcessStatusUploader, 2000);
  pollProcessStatusUploader();
}

async function pollProcessStatusUploader() {
  try {
    var status = await api('/upload/status');
    renderProcessProgress(status, 'processProgressUploader');
    if (status.estado === 'COMPLETADO' || status.estado === 'ERROR') {
      clearInterval(processPollTimerUploader);
      processPollTimerUploader = null;
      loadUploaderHistory();
    }
  } catch (e) {
    clearInterval(processPollTimerUploader);
    processPollTimerUploader = null;
  }
}

async function checkResumeProcessPollingUploader() {
  try {
    var status = await api('/upload/status');
    if (status.estado === 'EN_PROGRESO') {
      renderProcessProgress(status, 'processProgressUploader');
      if (processPollTimerUploader) clearInterval(processPollTimerUploader);
      processPollTimerUploader = setInterval(pollProcessStatusUploader, 2000);
    }
  } catch (e) {}
}

function switchUploaderTab(tabId) {
  document.querySelectorAll('#up-subir, #up-bodega').forEach(function (el) { el.classList.add('hidden'); });
  document.querySelectorAll('#uploaderTabs .tab-btn').forEach(function (el) { el.classList.remove('active'); });
  document.getElementById(tabId).classList.remove('hidden');
  document.querySelector('#uploaderTabs .tab-btn[data-uptab="' + tabId + '"]').classList.add('active');

  if (tabId === 'up-bodega') { renderBodegaView('uploaderBodegaCard', 'uploader'); loadBodegaTable('uploaderBodegaCard', 'uploader'); }
}

async function loadUploaderHistory() {
  var el = document.getElementById('uploaderHistory');
  var elBodega = document.getElementById('uploaderHistoryBodega');
  try {
    var hist = await api('/upload/history');
    el.innerHTML =
      statBox(hist.gx1.fecha ? new Date(hist.gx1.fecha).toLocaleString() : '—', 'GX1 — última subida') +
      statBox(hist.gx1.archivo || '—', 'GX1 — archivo') +
      statBox(hist.gx2.fecha ? new Date(hist.gx2.fecha).toLocaleString() : '—', 'GX2 — última subida') +
      statBox(hist.gx2.archivo || '—', 'GX2 — archivo');
    elBodega.innerHTML =
      statBox(hist.bodegaGx1.fecha ? new Date(hist.bodegaGx1.fecha).toLocaleString() : '—', 'GX1 — última subida') +
      statBox(hist.bodegaGx1.archivo || '—', 'GX1 — archivo') +
      statBox(hist.bodegaGx2.fecha ? new Date(hist.bodegaGx2.fecha).toLocaleString() : '—', 'GX2 — última subida') +
      statBox(hist.bodegaGx2.archivo || '—', 'GX2 — archivo');
  } catch (e) {
    el.innerHTML = '<p class="error-text">' + e.message + '</p>';
  }
}

// ---------------------------------------------------------
// FECHAS DE SUBIDA (vista de usuario/técnico)
// ---------------------------------------------------------
async function loadUserUploadDates() {
  var el = document.getElementById('userUploadDatesCard');
  try {
    var info = await api('/base-info');
    el.innerHTML =
      '<span class="muted"><strong>GX1</strong> actualizado: ' + (info.gx1.fecha ? new Date(info.gx1.fecha).toLocaleString() : 'sin datos') + '</span>' +
      '<span class="muted" style="margin-left:24px;"><strong>GX2</strong> actualizado: ' + (info.gx2.fecha ? new Date(info.gx2.fecha).toLocaleString() : 'sin datos') + '</span>';
  } catch (e) {
    el.innerHTML = '';
  }
}

// ---------------------------------------------------------
// ADMIN: MODELOS PERMITIDOS (global por base)
// ---------------------------------------------------------
async function loadModelosPermitidos() {
  try {
    if (!STATE.metaLists.comunas.length) {
      var meta = await api('/admin/meta');
      STATE.metaLists = { comunas: meta.comunas, regionByComuna: meta.regionByComuna, regiones: meta.regiones };
      window.__metaGx1Tipos = meta.gx1.tipos;
      window.__metaGx2Tipos = meta.gx2.tipos;
    } else {
      var meta2 = await api('/admin/meta');
      window.__metaGx1Tipos = meta2.gx1.tipos;
      window.__metaGx2Tipos = meta2.gx2.tipos;
    }
    var permitidos = await api('/admin/tipos-permitidos');
    renderCheckboxList('modelosGx1List', window.__metaGx1Tipos || [], permitidos.gx1 || []);
    renderCheckboxList('modelosGx2List', window.__metaGx2Tipos || [], permitidos.gx2 || []);
  } catch (e) {
    document.getElementById('modelosGx1List').innerHTML = '<p class="error-text">' + e.message + '</p>';
  }
}

async function guardarModelosPermitidos(base) {
  var containerId = base === 'GX1' ? 'modelosGx1List' : 'modelosGx2List';
  var tipos = getCheckedValues(containerId);
  try {
    await api('/admin/tipos-permitidos/' + base, { method: 'PUT', body: JSON.stringify({ tipos: tipos }) });
    alert('Guardado. ' + (tipos.length ? tipos.length + ' modelos permitidos para ' + base + '.' : 'Sin restricción — todos los modelos permitidos para ' + base + '.'));
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

// ---------------------------------------------------------
// USUARIOS (ADMIN)
// ---------------------------------------------------------
async function loadUsers() {
  var tbody = document.getElementById('usersTableBody');
  tbody.innerHTML = '<tr><td colspan="6" class="muted">Cargando...</td></tr>';
  try {
    var users = await api('/admin/users');
    STATE.usersCache = users;
    if (!users.length) { tbody.innerHTML = '<tr><td colspan="6" class="muted">No hay usuarios.</td></tr>'; return; }
    var html = '';
    users.forEach(function (u) {
      var fechasTxt = (u.fecha_desde || u.fecha_hasta)
        ? (u.fecha_desde ? String(u.fecha_desde).slice(0, 7) : '…') + ' a ' + (u.fecha_hasta ? String(u.fecha_hasta).slice(0, 7) : '…')
        : 'Sin límite';
      var rolLabel = u.rol === 'ADMIN' ? 'ADMIN' : (u.rol === 'UPLOADER' ? 'UPLOADER' : 'USER');
      var rolBadgeClass = u.rol === 'ADMIN' ? 'badge-admin' : (u.rol === 'UPLOADER' ? 'badge-gx1' : 'badge-user');
      html += '<tr>' +
        '<td>' + escapeHtml(u.username) + '</td>' +
        '<td><span class="badge ' + rolBadgeClass + '">' + rolLabel + '</span></td>' +
        '<td>' + (u.comunas.length ? u.comunas.length + ' asignadas' : 'Todas') + '</td>' +
        '<td>' + escapeHtml(fechasTxt) + '</td>' +
        '<td><span class="badge ' + (u.activo ? 'badge-active' : 'badge-inactive') + '">' + (u.activo ? 'Activo' : 'Inactivo') + '</span></td>' +
        '<td class="users-table-actions">' +
          '<button class="btn-secondary" onclick="openUserModal(\'' + u.id + '\')">Editar</button>' +
          '<button class="btn-danger" onclick="deleteUser(\'' + u.id + '\', \'' + escapeHtml(u.username) + '\')">Eliminar</button>' +
        '</td>' +
      '</tr>';
    });
    tbody.innerHTML = html;
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="6" class="error-text">' + e.message + '</td></tr>';
  }
}

async function deleteUser(id, username) {
  if (!confirm('¿Eliminar al usuario "' + username + '"? Esta acción no se puede deshacer.')) return;
  try {
    var res = await api('/admin/users/' + id, { method: 'DELETE' });
    if (!res.ok) { alert('Error: ' + res.error); return; }
    loadUsers();
  } catch (e) { alert('Error: ' + e.message); }
}

async function downloadUsersBackup() {
  window.location.href = '/api/admin/users/backup/download';
}

async function restoreUsersBackup(file) {
  if (!file) return;
  try {
    var text = await file.text();
    var users = JSON.parse(text);
    var res = await api('/admin/users/backup/restore', { method: 'POST', body: JSON.stringify({ users: users }) });
    if (!res.ok) { alert('Error: ' + res.error); return; }
    alert('Restaurados ' + res.restored + ' usuarios.');
    loadUsers();
  } catch (e) {
    alert('Error leyendo el respaldo: ' + e.message);
  }
}

// ---- Modal crear/editar usuario ----
function onUserModalRolChange() {
  var rol = document.getElementById('userModalRol').value;
  document.getElementById('userModalTerritorioWrap').classList.toggle('hidden', rol !== 'USER');
  var esVenta = rol === 'VENTA_GX1' || rol === 'VENTA_GX2';
  document.getElementById('userModalDistribuidoresWrap').classList.toggle('hidden', !esVenta);
  if (esVenta) cargarDistribuidoresParaModal_(rol);
}

async function cargarDistribuidoresParaModal_(rol) {
  try {
    var dist = await api('/admin/distribuidores');
    var lista = rol === 'VENTA_GX1' ? dist.gx1 : dist.gx2;
    var idParam = document.getElementById('userModalId').value;
    var seleccionados = [];
    if (idParam) {
      var u = STATE.usersCache.filter(function (x) { return x.id === idParam; })[0];
      if (u) seleccionados = u.distribuidores || [];
    }
    renderCheckboxList('distribuidoresCheckboxList', lista, seleccionados);
  } catch (e) {
    document.getElementById('distribuidoresCheckboxList').innerHTML = '<p class="error-text">' + e.message + '</p>';
  }
}

async function openUserModal(userId) {
  document.getElementById('userModalError').classList.add('hidden');
  document.getElementById('userModalId').value = userId || '';
  document.getElementById('userModalUsername').value = '';
  document.getElementById('userModalPassword').value = '';
  document.getElementById('userModalRol').value = 'USER';
  document.getElementById('userModalActivo').checked = true;
  document.getElementById('userModalUsername').disabled = false;
  document.getElementById('userModalMesDesde').value = '';
  document.getElementById('userModalMesHasta').value = '';
  document.getElementById('distribuidoresCheckboxList').innerHTML = '';

  if (!STATE.metaLists.comunas.length) {
    try {
      var meta = await api('/admin/meta');
      STATE.metaLists = { comunas: meta.comunas, regionByComuna: meta.regionByComuna, regiones: meta.regiones };
    } catch (e) {}
  }

  var regionSelect = document.getElementById('regionFilterSelect');
  regionSelect.innerHTML = '<option value="">Todas las regiones</option>' +
    (STATE.metaLists.regiones || []).map(function (r) { return '<option value="' + escapeHtml(r) + '">' + escapeHtml(r) + '</option>'; }).join('');
  regionSelect.value = '';

  renderCheckboxList('comunasCheckboxList', STATE.metaLists.comunas, []);

  if (userId) {
    var u = STATE.usersCache.filter(function (x) { return x.id === userId; })[0];
    if (u) {
      document.getElementById('userModalTitle').textContent = 'Editar usuario';
      document.getElementById('userModalUsername').value = u.username;
      document.getElementById('userModalUsername').disabled = true;
      document.getElementById('userModalRol').value = u.rol;
      document.getElementById('userModalActivo').checked = u.activo;
      document.getElementById('userModalPasswordLabel').textContent = 'Nueva contraseña (dejar en blanco para no cambiar)';
      renderCheckboxList('comunasCheckboxList', STATE.metaLists.comunas, u.comunas);
      document.getElementById('userModalMesDesde').value = u.fecha_desde ? String(u.fecha_desde).slice(0, 7) : '';
      document.getElementById('userModalMesHasta').value = u.fecha_hasta ? String(u.fecha_hasta).slice(0, 7) : '';
    }
  } else {
    document.getElementById('userModalTitle').textContent = 'Nuevo usuario';
    document.getElementById('userModalPasswordLabel').textContent = 'Contraseña';
  }
  onUserModalRolChange();
  document.getElementById('userModalOverlay').classList.remove('hidden');
}

function closeUserModal() { document.getElementById('userModalOverlay').classList.add('hidden'); }

async function saveUserModal() {
  var id = document.getElementById('userModalId').value;
  var username = document.getElementById('userModalUsername').value.trim();
  var password = document.getElementById('userModalPassword').value;
  var rol = document.getElementById('userModalRol').value;
  var activo = document.getElementById('userModalActivo').checked;
  var comunas = getCheckedValues('comunasCheckboxList');
  var distribuidores = getCheckedValues('distribuidoresCheckboxList');
  var mesDesde = document.getElementById('userModalMesDesde').value;
  var mesHasta = document.getElementById('userModalMesHasta').value;
  var fechaDesde = mesDesde ? mesDesde + '-01' : null;
  var fechaHasta = mesHasta ? ultimoDiaDeMes_(mesHasta) : null;
  var errEl = document.getElementById('userModalError');
  errEl.classList.add('hidden');

  try {
    var res;
    if (id) {
      res = await api('/admin/users/' + id, {
        method: 'PUT',
        body: JSON.stringify({ password: password || undefined, rol: rol, comunas: comunas, distribuidores: distribuidores, activo: activo, fechaDesde: fechaDesde, fechaHasta: fechaHasta })
      });
    } else {
      if (!username || !password) {
        errEl.textContent = 'Usuario y contraseña son obligatorios.';
        errEl.classList.remove('hidden');
        return;
      }
      res = await api('/admin/users', {
        method: 'POST',
        body: JSON.stringify({ username: username, password: password, rol: rol, comunas: comunas, distribuidores: distribuidores, fechaDesde: fechaDesde, fechaHasta: fechaHasta })
      });
    }
    if (!res.ok) { errEl.textContent = res.error; errEl.classList.remove('hidden'); return; }
    closeUserModal();
    loadUsers();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
  }
}

// ---- Utilidad: listas de checkboxes con buscador ----
function renderCheckboxList(containerId, items, selected) {
  var container = document.getElementById(containerId);
  var selectedSet = {};
  (selected || []).forEach(function (s) { selectedSet[s] = true; });
  var html = '';
  items.forEach(function (item) {
    var checked = selectedSet[item] ? 'checked' : '';
    html += '<label><input type="checkbox" value="' + escapeHtml(item) + '" ' + checked + '> ' + escapeHtml(item) + '</label>';
  });
  container.innerHTML = html || '<p class="muted">No hay datos cargados aún.</p>';
}

function filterCheckboxList(containerId, term) {
  term = term.toLowerCase();
  var labels = document.getElementById(containerId).querySelectorAll('label');
  labels.forEach(function (l) {
    var text = l.textContent.toLowerCase();
    l.style.display = text.indexOf(term) !== -1 ? 'block' : 'none';
  });
}

/**
 * Filtra la lista de comunas mostrando solo las que pertenecen a la región
 * seleccionada (usando la columna REGION del archivo original). Región vacía = mostrar todas.
 */
function filterCheckboxListByRegion(containerId, regionName) {
  var map = STATE.metaLists.regionByComuna || {};
  var labels = document.getElementById(containerId).querySelectorAll('label');
  labels.forEach(function (l) {
    var comuna = l.textContent.trim();
    var region = map[comuna];
    l.style.display = (!regionName || region === regionName) ? 'block' : 'none';
  });
}

/**
 * Marca o desmarca todos los checkboxes actualmente visibles (respeta cualquier
 * filtro de búsqueda o de región aplicado antes).
 */
function checkVisible(containerId, checked) {
  var labels = document.getElementById(containerId).querySelectorAll('label');
  labels.forEach(function (l) {
    if (l.style.display !== 'none') {
      var cb = l.querySelector('input[type="checkbox"]');
      if (cb) cb.checked = checked;
    }
  });
}

function getCheckedValues(containerId) {
  var boxes = document.getElementById(containerId).querySelectorAll('input[type="checkbox"]:checked');
  var out = [];
  boxes.forEach(function (b) { out.push(b.value); });
  return out;
}

function ultimoDiaDeMes_(mesStr) {
  var partes = mesStr.split('-');
  var anio = Number(partes[0]);
  var mes = Number(partes[1]);
  var ultimoDia = new Date(anio, mes, 0).getDate();
  return mesStr + '-' + String(ultimoDia).padStart(2, '0');
}

// ---------------------------------------------------------
// TABLA DE DATOS (compartida entre admin "Ver datos" y vista de usuario)
// ---------------------------------------------------------
function sistemaBadge_(base) {
  if (!base) return '';
  return '<span class="badge ' + (base === 'GX1' ? 'badge-gx1' : 'badge-gx2') + '">' + base + '</span>';
}

function renderDataView(cardId, isAdmin) {
  var card = document.getElementById(cardId);
  var tipoFilterHtml = '';
  if (isAdmin) {
    tipoFilterHtml =
      '<div class="field" style="max-width:320px;">' +
        '<label>Filtrar por tipo de equipo (opcional)</label>' +
        '<input type="text" class="search-mini" placeholder="Buscar tipo..." oninput="filterCheckboxList(\'adminTipoFilterList\', this.value)">' +
        '<div class="checkbox-list" id="adminTipoFilterList" style="max-height:140px;"></div>' +
      '</div>' +
      '<div class="field" style="max-width:320px;">' +
        '<label>Filtrar por mes de ingreso (opcional)</label>' +
        '<div class="form-row">' +
          '<div class="field"><label class="muted" style="font-size:11px;">Desde</label><input type="month" id="adminMesDesdeInput"></div>' +
          '<div class="field"><label class="muted" style="font-size:11px;">Hasta</label><input type="month" id="adminMesHastaInput"></div>' +
        '</div>' +
      '</div>';
  }
  card.innerHTML =
    '<h2>' + (isAdmin ? 'Datos (todas las comunas y tipos)' : 'Mis datos asignados') + '</h2>' +
    '<div class="field" style="max-width:220px;">' +
      '<label>Sistema</label>' +
      '<select id="sistemaFilterSelect_' + cardId + '" onchange="onSistemaFilterChange(\'' + cardId + '\')">' +
        '<option value="">GX1 y GX2</option>' +
        '<option value="GX1">Solo GX1</option>' +
        '<option value="GX2">Solo GX2</option>' +
      '</select>' +
    '</div>' +
    (isAdmin ? tipoFilterHtml + '<button class="btn-secondary" style="margin-top:0px; margin-bottom:14px;" onclick="applyAdminTipoFilter()">Aplicar filtros</button>' : '') +
    '<div class="toolbar">' +
      '<input type="text" id="dataSearchInput_' + cardId + '" placeholder="Buscar por RUT, nombre, dirección o comuna...">' +
      '<button class="btn-secondary" onclick="onSearchData(\'' + cardId + '\')">Buscar</button>' +
      '<button class="btn-primary" onclick="downloadExcel(\'' + cardId + '\')" id="downloadBtn_' + cardId + '">Descargar Excel</button>' +
    '</div>' +
    '<table>' +
      '<thead><tr><th>Sistema</th><th>RUT</th><th>NOMBRE</th><th>COMUNA</th><th>DIRECCIÓN</th><th>TIPO</th><th>DISTRIBUIDOR</th></tr></thead>' +
      '<tbody id="dataTableBody_' + cardId + '"><tr><td colspan="7" class="muted">Cargando...</td></tr></tbody>' +
    '</table>' +
    '<div class="pagination" id="pagination_' + cardId + '"></div>';

  if (isAdmin) renderCheckboxList('adminTipoFilterList', STATE.metaLists.tipos || [], []);
}

function onSistemaFilterChange(cardId) {
  STATE.dataSistema = document.getElementById('sistemaFilterSelect_' + cardId).value;
  STATE.dataPage = 0;
  loadDataTable(cardId);
}

function applyAdminTipoFilter() {
  STATE.dataTipoFilter = getCheckedValues('adminTipoFilterList');
  var mesDesdeEl = document.getElementById('adminMesDesdeInput');
  var mesHastaEl = document.getElementById('adminMesHastaInput');
  STATE.dataMesDesde = mesDesdeEl ? mesDesdeEl.value : '';
  STATE.dataMesHasta = mesHastaEl ? mesHastaEl.value : '';
  STATE.dataPage = 0;
  loadDataTable('dataCardAdmin');
}

function onSearchData(cardId) {
  STATE.dataSearch = document.getElementById('dataSearchInput_' + cardId).value;
  STATE.dataPage = 0;
  loadDataTable(cardId);
}

async function loadDataTable(cardId) {
  var tbody = document.getElementById('dataTableBody_' + cardId);
  tbody.innerHTML = '<tr><td colspan="7" class="muted">Cargando...</td></tr>';
  try {
    var qs = '?page=' + STATE.dataPage + '&pageSize=' + STATE.dataPageSize +
      '&search=' + encodeURIComponent(STATE.dataSearch) +
      '&tipoFilter=' + encodeURIComponent(JSON.stringify(STATE.dataTipoFilter)) +
      '&mesDesde=' + encodeURIComponent(STATE.dataMesDesde || '') +
      '&mesHasta=' + encodeURIComponent(STATE.dataMesHasta || '') +
      '&sistema=' + encodeURIComponent(STATE.dataSistema || '');
    var res = await api('/data' + qs);

    if (res.processing) {
      tbody.innerHTML = '<tr><td colspan="7" class="muted">La base se está actualizando en este momento, intenta de nuevo en unos minutos...</td></tr>';
      document.getElementById('pagination_' + cardId).innerHTML = '';
      return;
    }
    if (!res.rows.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="muted">Sin resultados.</td></tr>';
    } else {
      var html = '';
      res.rows.forEach(function (r) {
        html += '<tr><td>' + sistemaBadge_(r.SISTEMA) + '</td><td>' + escapeHtml(r.RUT) + '</td><td>' + escapeHtml(r.NOMBRE) + '</td><td>' +
                escapeHtml(r.COMUNA) + '</td><td>' + escapeHtml(r.DIRECCION) + '</td><td>' + escapeHtml(r.TIPO) + '</td><td>' + escapeHtml(r.DISTRIBUIDOR) + '</td></tr>';
      });
      tbody.innerHTML = html;
    }
    renderPagination(cardId, res.total);
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="7" class="error-text">' + e.message + '</td></tr>';
  }
}

function renderPagination(cardId, total) {
  var el = document.getElementById('pagination_' + cardId);
  var totalPages = Math.max(1, Math.ceil(total / STATE.dataPageSize));
  var currentPage = STATE.dataPage + 1;
  el.innerHTML =
    '<span>' + total + ' resultados — página ' + currentPage + ' de ' + totalPages + '</span>' +
    '<button class="btn-secondary" ' + (STATE.dataPage <= 0 ? 'disabled' : '') + ' onclick="changePage(\'' + cardId + '\', -1)">Anterior</button>' +
    '<button class="btn-secondary" ' + (currentPage >= totalPages ? 'disabled' : '') + ' onclick="changePage(\'' + cardId + '\', 1)">Siguiente</button>';
}

function changePage(cardId, delta) {
  STATE.dataPage = Math.max(0, STATE.dataPage + delta);
  loadDataTable(cardId);
}

async function downloadExcel(cardId) {
  var btn = document.getElementById('downloadBtn_' + cardId);
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Generando...'; }

  try {
    var qs = '?search=' + encodeURIComponent(STATE.dataSearch) + '&tipoFilter=' + encodeURIComponent(JSON.stringify(STATE.dataTipoFilter)) +
      '&mesDesde=' + encodeURIComponent(STATE.dataMesDesde || '') + '&mesHasta=' + encodeURIComponent(STATE.dataMesHasta || '') +
      '&sistema=' + encodeURIComponent(STATE.dataSistema || '');
    var res = await fetch('/api/data/export' + qs, { credentials: 'same-origin' });

    if (!res.ok) {
      var errData = await res.json().catch(function () { return {}; });
      alert('Error: ' + (errData.error || ('Error ' + res.status)));
      return;
    }

    var disposition = res.headers.get('Content-Disposition') || '';
    var match = disposition.match(/filename="(.+)"/);
    var filename = match ? match[1] : 'exportacion.xlsx';

    var blob = await res.blob();
    downloadBase64FromResponse_(blob, filename);
  } catch (e) {
    alert('Error: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = 'Descargar Excel'; }
  }
}

// ---------------------------------------------------------
// UTILIDADES
// ---------------------------------------------------------
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function downloadBase64FromResponse_(blob, filename) {
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function downloadFileFromApi_(url, btn, defaultName) {
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Generando...'; }
  try {
    var res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) {
      var errData = await res.json().catch(function () { return {}; });
      alert('Error: ' + (errData.error || ('Error ' + res.status)));
      return;
    }
    var disposition = res.headers.get('Content-Disposition') || '';
    var match = disposition.match(/filename="(.+)"/);
    var filename = match ? match[1] : defaultName;
    var blob = await res.blob();
    downloadBase64FromResponse_(blob, filename);
  } catch (e) {
    alert('Error: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = 'Descargar Excel'; }
  }
}

// ---------------------------------------------------------
// PESTAÑAS DEL TÉCNICO (Sin gestionar / Agendados / Gestionados / Base completa)
// ---------------------------------------------------------
var TECNICO_SISTEMA_FILTRO = '';

function switchUserTab(tabId) {
  document.querySelectorAll('#u-sin-gestionar, #u-agendados, #u-gestionados, #u-base').forEach(function (el) { el.classList.add('hidden'); });
  document.querySelectorAll('#userTabs .tab-btn').forEach(function (el) { el.classList.remove('active'); });
  document.getElementById(tabId).classList.remove('hidden');
  document.querySelector('#userTabs .tab-btn[data-utab="' + tabId + '"]').classList.add('active');

  if (tabId === 'u-sin-gestionar') loadSinGestionar();
  if (tabId === 'u-agendados') loadAgendados();
  if (tabId === 'u-gestionados') loadGestionados();
  if (tabId === 'u-base') { renderDataView('dataCardUser', false); loadDataTable('dataCardUser'); }
}

function selectorSistemaHtml_(onchangeFn, current) {
  return '<div class="field" style="max-width:200px;">' +
    '<label>Sistema</label>' +
    '<select onchange="' + onchangeFn + '(this.value)">' +
      '<option value="" ' + (current === '' ? 'selected' : '') + '>GX1 y GX2</option>' +
      '<option value="GX1" ' + (current === 'GX1' ? 'selected' : '') + '>Solo GX1</option>' +
      '<option value="GX2" ' + (current === 'GX2' ? 'selected' : '') + '>Solo GX2</option>' +
    '</select>' +
  '</div>';
}

var STATE_SIN_GESTIONAR_PAGE = 0;

function cambiarSistemaSinGestionar(valor) {
  TECNICO_SISTEMA_FILTRO = valor;
  STATE_SIN_GESTIONAR_PAGE = 0;
  loadSinGestionar();
}

async function loadSinGestionar() {
  var card = document.getElementById('cardSinGestionar');
  card.innerHTML = '<h2>Clientes sin gestionar</h2><p class="muted">Cargando...</p>';
  try {
    var qs = '?page=' + STATE_SIN_GESTIONAR_PAGE + '&pageSize=30&sistema=' + encodeURIComponent(TECNICO_SISTEMA_FILTRO);
    var res = await api('/gestiones/pendientes-sin-gestionar' + qs);
    var html = '<h2>Clientes sin gestionar (' + res.total + ')</h2>' + selectorSistemaHtml_('cambiarSistemaSinGestionar', TECNICO_SISTEMA_FILTRO);
    if (!res.rows.length) {
      html += '<p class="muted">No hay clientes pendientes de gestionar en tu zona. 🎉</p>';
    } else {
      html += renderClienteCards_(res.rows);
      var totalPages = Math.max(1, Math.ceil(res.total / 30));
      html += '<div class="pagination"><span>Página ' + (STATE_SIN_GESTIONAR_PAGE + 1) + ' de ' + totalPages + '</span>' +
        '<button class="btn-secondary" ' + (STATE_SIN_GESTIONAR_PAGE <= 0 ? 'disabled' : '') + ' onclick="changeSinGestionarPage(-1)">Anterior</button>' +
        '<button class="btn-secondary" ' + (STATE_SIN_GESTIONAR_PAGE + 1 >= totalPages ? 'disabled' : '') + ' onclick="changeSinGestionarPage(1)">Siguiente</button></div>';
    }
    card.innerHTML = html;
  } catch (e) {
    card.innerHTML = '<h2>Clientes sin gestionar</h2><p class="error-text">' + e.message + '</p>';
  }
}

function changeSinGestionarPage(delta) {
  STATE_SIN_GESTIONAR_PAGE = Math.max(0, STATE_SIN_GESTIONAR_PAGE + delta);
  loadSinGestionar();
}

function renderClienteCards_(rows) {
  var html = '<div>';
  rows.forEach(function (r) {
    var payload = JSON.stringify({ rut: r.rut, nombre: r.nombre, direccion: r.direccion, comuna: r.comuna, base: r.base }).replace(/'/g, '&#39;');
    html +=
      '<div class="card" style="margin-bottom:10px; padding:14px;">' +
        '<div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:10px;">' +
          '<div>' +
            '<div style="font-weight:600;">' + sistemaBadge_(r.base) + ' ' + escapeHtml(r.nombre) + ' — ' + escapeHtml(r.rut) + '</div>' +
            '<div class="muted">' + escapeHtml(r.region || '') + (r.region ? ' · ' : '') + escapeHtml(r.comuna) + '</div>' +
            '<div class="muted">' + escapeHtml(r.direccion) + '</div>' +
            '<div class="muted">Tel. casa: ' + escapeHtml(r.casa || '—') + ' · Celular: ' + escapeHtml(r.celular || '—') + '</div>' +
            '<div class="muted">Equipos: ' + r.cantidad_equipos + ' (' + escapeHtml((r.tipos || []).join(', ')) + ')</div>' +
          '</div>' +
          '<button class="btn-primary" onclick=\'openGestionModal(' + payload + ')\'>Gestionar</button>' +
        '</div>' +
      '</div>';
  });
  html += '</div>';
  return html;
}

var AGENDADOS_CACHE = [];
var AGENDADOS_FILTRO_FECHA = '';
var AGENDADOS_FILTRO_SISTEMA = '';

async function loadAgendados() {
  var card = document.getElementById('cardAgendados');
  card.innerHTML = '<h2>Agendados</h2><p class="muted">Cargando...</p>';
  try {
    var rows = await api('/gestiones/agendados');
    AGENDADOS_CACHE = rows;
    var hoy = new Date().toISOString().slice(0, 10);
    renderAgendadosTabla_(hoy);
  } catch (e) {
    card.innerHTML = '<h2>Agendados</h2><p class="error-text">' + e.message + '</p>';
  }
}

function cambiarSistemaAgendados(valor) {
  AGENDADOS_FILTRO_SISTEMA = valor;
  renderAgendadosTabla_();
}

function renderAgendadosTabla_(hoyParam) {
  var card = document.getElementById('cardAgendados');
  var hoy = hoyParam || new Date().toISOString().slice(0, 10);
  var rows = AGENDADOS_CACHE;
  if (AGENDADOS_FILTRO_SISTEMA) rows = rows.filter(function (r) { return r.base === AGENDADOS_FILTRO_SISTEMA; });
  var filtered = AGENDADOS_FILTRO_FECHA
    ? rows.filter(function (r) { return r.fecha_agendada && String(r.fecha_agendada).slice(0, 10) === AGENDADOS_FILTRO_FECHA; })
    : rows;

  var html =
    '<div class="toolbar" style="justify-content: space-between;">' +
      '<h2 style="margin:0;">Agendados (' + filtered.length + (AGENDADOS_FILTRO_FECHA ? ' de ' + rows.length : '') + ')</h2>' +
    '</div>' +
    selectorSistemaHtml_('cambiarSistemaAgendados', AGENDADOS_FILTRO_SISTEMA) +
    '<div class="toolbar">' +
      '<label class="muted" style="margin:0;">Ver fecha:</label>' +
      '<input type="date" id="agendadosFechaFiltro" value="' + AGENDADOS_FILTRO_FECHA + '" onchange="filtrarAgendadosPorFecha(this.value)">' +
      '<button class="btn-secondary" onclick="filtrarAgendadosPorFecha(\'' + hoy + '\')">Hoy</button>' +
      '<button class="btn-secondary" onclick="filtrarAgendadosPorFecha(\'\')">Ver todos</button>' +
    '</div>';

  if (!filtered.length) {
    html += '<p class="muted">' + (AGENDADOS_FILTRO_FECHA ? 'No tienes nada agendado para esa fecha.' : 'No tienes retiros agendados/pendientes.') + '</p>';
  } else {
    html += '<table><thead><tr><th>Sistema</th><th>Cliente</th><th>Comuna</th><th>Dirección</th><th>Motivo</th><th>Detalle</th><th>Agendado para</th><th></th></tr></thead><tbody>';
    filtered.forEach(function (r) {
      var esHoy = r.fecha_agendada && String(r.fecha_agendada).slice(0, 10) === hoy;
      var payload = JSON.stringify({ rut: r.rut, nombre: r.nombre, direccion: r.direccion, comuna: r.comuna, base: r.base }).replace(/'/g, '&#39;');
      html += '<tr' + (esHoy ? ' style="background:#fff8e1;"' : '') + '>' +
        '<td>' + sistemaBadge_(r.base) + '</td>' +
        '<td>' + escapeHtml(r.nombre) + '</td>' +
        '<td>' + escapeHtml(r.comuna) + '</td>' +
        '<td>' + escapeHtml(r.direccion) + '</td>' +
        '<td>' + escapeHtml(r.motivo_texto || '') + '</td>' +
        '<td>' + escapeHtml(r.detalle || '') + '</td>' +
        '<td>' + (r.fecha_agendada ? new Date(r.fecha_agendada).toLocaleDateString('es-CL') + (esHoy ? ' (HOY)' : '') : 'Sin fecha') + '</td>' +
        '<td><button class="btn-secondary" onclick=\'openGestionModal(' + payload + ')\'>Actualizar</button></td>' +
      '</tr>';
    });
    html += '</tbody></table>';
  }
  card.innerHTML = html;
}

function filtrarAgendadosPorFecha(fecha) {
  AGENDADOS_FILTRO_FECHA = fecha || '';
  renderAgendadosTabla_();
}

var GESTIONADOS_FILTRO_SISTEMA = '';
var GESTIONADOS_CACHE = [];

async function loadGestionados() {
  var card = document.getElementById('cardGestionados');
  card.innerHTML = '<h2>Gestionados</h2><p class="muted">Cargando...</p>';
  try {
    var rows = await api('/gestiones/gestionados');
    GESTIONADOS_CACHE = rows;
    renderGestionadosTabla_();
  } catch (e) {
    card.innerHTML = '<h2>Gestionados</h2><p class="error-text">' + e.message + '</p>';
  }
}

function cambiarSistemaGestionados(valor) {
  GESTIONADOS_FILTRO_SISTEMA = valor;
  renderGestionadosTabla_();
}

function renderGestionadosTabla_() {
  var card = document.getElementById('cardGestionados');
  var rows = GESTIONADOS_FILTRO_SISTEMA ? GESTIONADOS_CACHE.filter(function (r) { return r.base === GESTIONADOS_FILTRO_SISTEMA; }) : GESTIONADOS_CACHE;

  var html = '<div class="toolbar" style="justify-content: space-between;"><h2 style="margin:0;">Gestionados (' + rows.length + ')</h2>' +
    '<button class="btn-primary" onclick="downloadGestionadosPropio()">Descargar Excel</button></div>' +
    selectorSistemaHtml_('cambiarSistemaGestionados', GESTIONADOS_FILTRO_SISTEMA);
  if (!rows.length) {
    html += '<p class="muted">Aún no has marcado retiros como realizados.</p>';
  } else {
    html += '<table><thead><tr><th>Sistema</th><th>Cliente</th><th>Comuna</th><th>Dirección</th><th>Equipos</th><th>Fecha</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      html += '<tr>' +
        '<td>' + sistemaBadge_(r.base) + '</td>' +
        '<td>' + escapeHtml(r.nombre) + '</td>' +
        '<td>' + escapeHtml(r.comuna) + '</td>' +
        '<td>' + escapeHtml(r.direccion) + '</td>' +
        '<td>' + r.cantidad_equipos + '</td>' +
        '<td>' + new Date(r.created_at).toLocaleString('es-CL') + '</td>' +
      '</tr>';
    });
    html += '</tbody></table>';
  }
  card.innerHTML = html;
}

function downloadGestionadosPropio() {
  downloadFileFromApi_('/api/gestiones/gestionados/export', null, 'retiros_realizados.xlsx');
}

// ---- Modal de gestión ----
var GESTION_CLIENTE_ACTUAL = null;

async function openGestionModal(cliente) {
  GESTION_CLIENTE_ACTUAL = cliente;
  document.getElementById('gestionModalCliente').textContent =
    (cliente.base ? '[' + cliente.base + '] ' : '') + cliente.nombre + ' — ' + cliente.direccion + ' (' + cliente.comuna + ')';
  document.getElementById('gestionEstadoInput').value = 'REALIZADO';
  document.getElementById('gestionDetalleInput').value = '';
  document.getElementById('gestionFechaInput').value = '';
  document.getElementById('gestionModalError').classList.add('hidden');

  try {
    var motivos = await api('/gestiones/motivos');
    var sel = document.getElementById('gestionMotivoInput');
    sel.innerHTML = motivos.map(function (m) { return '<option value="' + m.id + '">' + escapeHtml(m.texto) + '</option>'; }).join('');
    if (!motivos.length) sel.innerHTML = '<option value="">(no hay motivos configurados, pide al admin que agregue uno)</option>';
  } catch (e) {}

  toggleMotivoField();
  document.getElementById('gestionModalOverlay').classList.remove('hidden');
}

function closeGestionModal() {
  document.getElementById('gestionModalOverlay').classList.add('hidden');
  GESTION_CLIENTE_ACTUAL = null;
}

function toggleMotivoField() {
  var estado = document.getElementById('gestionEstadoInput').value;
  document.getElementById('gestionMotivoWrap').classList.toggle('hidden', estado !== 'PENDIENTE');
}

async function submitGestion() {
  if (!GESTION_CLIENTE_ACTUAL) return;
  var estado = document.getElementById('gestionEstadoInput').value;
  var motivoId = document.getElementById('gestionMotivoInput').value;
  var detalle = document.getElementById('gestionDetalleInput').value;
  var fecha = document.getElementById('gestionFechaInput').value;
  var errEl = document.getElementById('gestionModalError');
  errEl.classList.add('hidden');

  try {
    var res = await api('/gestiones', {
      method: 'POST',
      body: JSON.stringify({
        rut: GESTION_CLIENTE_ACTUAL.rut,
        direccion: GESTION_CLIENTE_ACTUAL.direccion,
        base: GESTION_CLIENTE_ACTUAL.base,
        estado: estado,
        motivoId: estado === 'PENDIENTE' ? (motivoId || null) : null,
        detalle: detalle || null,
        fechaAgendada: fecha || null
      })
    });
    if (!res.ok) { errEl.textContent = res.error; errEl.classList.remove('hidden'); return; }
    closeGestionModal();
    // refrescar la pestaña activa
    if (!document.getElementById('u-sin-gestionar').classList.contains('hidden')) loadSinGestionar();
    if (!document.getElementById('u-agendados').classList.contains('hidden')) loadAgendados();
    if (!document.getElementById('u-gestionados').classList.contains('hidden')) loadGestionados();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
  }
}

// ---------------------------------------------------------
// ADMIN: MOTIVOS
// ---------------------------------------------------------
async function loadMotivos() {
  var tbody = document.getElementById('motivosTableBody');
  tbody.innerHTML = '<tr><td colspan="3" class="muted">Cargando...</td></tr>';
  try {
    var motivos = await api('/admin/motivos');
    if (!motivos.length) { tbody.innerHTML = '<tr><td colspan="3" class="muted">No hay motivos definidos aún.</td></tr>'; return; }
    var html = '';
    motivos.forEach(function (m) {
      html += '<tr>' +
        '<td>' + escapeHtml(m.texto) + '</td>' +
        '<td><span class="badge ' + (m.activo ? 'badge-active' : 'badge-inactive') + '">' + (m.activo ? 'Activo' : 'Inactivo') + '</span></td>' +
        '<td class="users-table-actions">' +
          '<button class="btn-secondary" onclick="toggleMotivoActivo(' + m.id + ', ' + (!m.activo) + ')">' + (m.activo ? 'Desactivar' : 'Activar') + '</button>' +
          '<button class="btn-danger" onclick="eliminarMotivo(' + m.id + ')">Eliminar</button>' +
        '</td>' +
      '</tr>';
    });
    tbody.innerHTML = html;
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="3" class="error-text">' + e.message + '</td></tr>';
  }
}

async function crearMotivo() {
  var input = document.getElementById('nuevoMotivoInput');
  var texto = input.value.trim();
  if (!texto) return;
  try {
    var res = await api('/admin/motivos', { method: 'POST', body: JSON.stringify({ texto: texto }) });
    if (!res.ok) { alert('Error: ' + res.error); return; }
    input.value = '';
    loadMotivos();
  } catch (e) { alert('Error: ' + e.message); }
}

async function toggleMotivoActivo(id, nuevoActivo) {
  try {
    await api('/admin/motivos/' + id, { method: 'PUT', body: JSON.stringify({ activo: nuevoActivo }) });
    loadMotivos();
  } catch (e) { alert('Error: ' + e.message); }
}

async function eliminarMotivo(id) {
  if (!confirm('¿Eliminar este motivo? Los registros de gestión que ya lo usaron lo conservarán en su historial.')) return;
  try {
    await api('/admin/motivos/' + id, { method: 'DELETE' });
    loadMotivos();
  } catch (e) { alert('Error: ' + e.message); }
}

// ---------------------------------------------------------
// ADMIN: VISTA GLOBAL DE GESTIÓN
// ---------------------------------------------------------
async function loadGestionGlobal() {
  var tbody = document.getElementById('gestionGlobalTableBody');
  tbody.innerHTML = '<tr><td colspan="8" class="muted">Cargando...</td></tr>';
  try {
    var estado = document.getElementById('gestionEstadoFilter').value;
    var base = document.getElementById('gestionSistemaFilter').value;
    var qs = '?estado=' + encodeURIComponent(estado) + '&base=' + encodeURIComponent(base);
    var res = await api('/admin/gestiones' + qs);
    if (!res.rows.length) { tbody.innerHTML = '<tr><td colspan="8" class="muted">Sin registros.</td></tr>'; return; }
    var html = '';
    res.rows.forEach(function (r) {
      html += '<tr>' +
        '<td>' + sistemaBadge_(r.base) + '</td>' +
        '<td>' + escapeHtml(r.tecnico_username) + '</td>' +
        '<td>' + escapeHtml(r.nombre) + '</td>' +
        '<td>' + escapeHtml(r.comuna) + '</td>' +
        '<td>' + escapeHtml(r.direccion) + '</td>' +
        '<td><span class="badge ' + (r.estado === 'REALIZADO' ? 'badge-active' : 'badge-inactive') + '">' + r.estado + '</span></td>' +
        '<td>' + escapeHtml(r.motivo_texto || '') + (r.detalle ? ' — ' + escapeHtml(r.detalle) : '') + '</td>' +
        '<td>' + new Date(r.created_at).toLocaleString('es-CL') + '</td>' +
      '</tr>';
    });
    tbody.innerHTML = html;
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="8" class="error-text">' + e.message + '</td></tr>';
  }
}

function downloadGestionGlobal() {
  var estado = document.getElementById('gestionEstadoFilter').value;
  var base = document.getElementById('gestionSistemaFilter').value;
  var qs = '?estado=' + encodeURIComponent(estado) + '&base=' + encodeURIComponent(base);
  downloadFileFromApi_('/api/admin/gestiones/export' + qs, null, 'gestion_completa.xlsx');
}

// ---------------------------------------------------------
// ADMIN: BODEGA (depósitos visibles + tabla de inventario)
// ---------------------------------------------------------
async function loadDepositosVisibles() {
  try {
    var data = await api('/admin/depositos');
    renderCheckboxList('depositosVisiblesList', data.todos, data.visibles);
  } catch (e) {
    document.getElementById('depositosVisiblesList').innerHTML = '<p class="error-text">' + e.message + '</p>';
  }
}

async function guardarDepositosVisibles() {
  var depositos = getCheckedValues('depositosVisiblesList');
  try {
    var res = await api('/admin/depositos-visibles', { method: 'PUT', body: JSON.stringify({ depositos: depositos }) });
    if (!res.ok) { alert('Error: ' + res.error); return; }
    alert('Guardado. ' + (depositos.length ? depositos.length + ' depósito(s) visibles para venta.' : 'Sin restricción — todos los depósitos visibles para venta.'));
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

/**
 * Vista de tabla de bodega, reutilizada por el admin (sin restricción de
 * depósito) y por el equipo de venta (ya restringido en el servidor).
 */
var BODEGA_STATE = { page: 0, pageSize: 100, search: '', base: '', deposito: '' };

function bodegaPathPrefix_(mode) {
  if (mode === 'admin') return '/admin';
  if (mode === 'uploader') return '/upload';
  return '/venta';
}

async function renderBodegaView(cardId, mode) {
  var card = document.getElementById(cardId);
  card.innerHTML =
    '<h2>Material en bodega</h2>' +
    '<div class="form-row">' +
      '<div class="field" style="max-width:220px;">' +
        '<label>Sistema</label>' +
        '<select id="bodegaSistemaSelect_' + cardId + '" onchange="onBodegaSistemaChange(\'' + cardId + '\', \'' + mode + '\')">' +
          '<option value="">GX1 y GX2</option>' +
          '<option value="GX1">Solo GX1</option>' +
          '<option value="GX2">Solo GX2</option>' +
        '</select>' +
      '</div>' +
      '<div class="field" style="max-width:260px;">' +
        '<label>Depósito</label>' +
        '<select id="bodegaDepositoSelect_' + cardId + '" onchange="onBodegaDepositoChange(\'' + cardId + '\', \'' + mode + '\')">' +
          '<option value="">Todos los depósitos disponibles</option>' +
        '</select>' +
      '</div>' +
    '</div>' +
    '<div class="toolbar">' +
      '<input type="text" id="bodegaSearchInput_' + cardId + '" placeholder="Buscar por artículo o depósito...">' +
      '<button class="btn-secondary" onclick="onBodegaSearch(\'' + cardId + '\', \'' + mode + '\')">Buscar</button>' +
      '<button class="btn-primary" onclick="downloadBodega(\'' + cardId + '\', \'' + mode + '\')" id="bodegaDownloadBtn_' + cardId + '">Descargar Excel</button>' +
    '</div>' +
    '<table>' +
      '<thead><tr><th>Sistema</th><th>Depósito</th><th>Cód. Artículo</th><th>Artículo</th><th>Stock</th></tr></thead>' +
      '<tbody id="bodegaTableBody_' + cardId + '"><tr><td colspan="5" class="muted">Cargando...</td></tr></tbody>' +
    '</table>' +
    '<div class="pagination" id="bodegaPagination_' + cardId + '"></div>';

  try {
    var path = bodegaPathPrefix_(mode) + '/depositos';
    var data = await api(path);
    var opciones = mode === 'venta' ? data.depositos : data.todos;
    var sel = document.getElementById('bodegaDepositoSelect_' + cardId);
    (opciones || []).forEach(function (d) {
      var opt = document.createElement('option');
      opt.value = d;
      opt.textContent = d;
      sel.appendChild(opt);
    });
  } catch (e) {}
}

function onBodegaSistemaChange(cardId, mode) {
  BODEGA_STATE.base = document.getElementById('bodegaSistemaSelect_' + cardId).value;
  BODEGA_STATE.page = 0;
  loadBodegaTable(cardId, mode);
}

function onBodegaDepositoChange(cardId, mode) {
  BODEGA_STATE.deposito = document.getElementById('bodegaDepositoSelect_' + cardId).value;
  BODEGA_STATE.page = 0;
  loadBodegaTable(cardId, mode);
}

function onBodegaSearch(cardId, mode) {
  BODEGA_STATE.search = document.getElementById('bodegaSearchInput_' + cardId).value;
  BODEGA_STATE.page = 0;
  loadBodegaTable(cardId, mode);
}

async function loadBodegaTable(cardId, mode) {
  var tbody = document.getElementById('bodegaTableBody_' + cardId);
  tbody.innerHTML = '<tr><td colspan="5" class="muted">Cargando...</td></tr>';
  try {
    var qs = '?page=' + BODEGA_STATE.page + '&pageSize=' + BODEGA_STATE.pageSize +
      '&search=' + encodeURIComponent(BODEGA_STATE.search) + '&base=' + encodeURIComponent(BODEGA_STATE.base) +
      '&deposito=' + encodeURIComponent(BODEGA_STATE.deposito);
    var path = bodegaPathPrefix_(mode) + '/bodega' + qs;
    var res = await api(path);
    if (!res.rows.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="muted">Sin resultados.</td></tr>';
    } else {
      var html = '';
      res.rows.forEach(function (r) {
        html += '<tr><td>' + sistemaBadge_(r.base) + '</td><td>' + escapeHtml(r.deposito) + '</td><td>' +
                escapeHtml(r.cod_articulo) + '</td><td>' + escapeHtml(r.articulo) + '</td><td>' + r.stock + '</td></tr>';
      });
      tbody.innerHTML = html;
    }
    renderBodegaPagination_(cardId, res.total, mode);
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="5" class="error-text">' + e.message + '</td></tr>';
  }
}

function renderBodegaPagination_(cardId, total, mode) {
  var el = document.getElementById('bodegaPagination_' + cardId);
  var totalPages = Math.max(1, Math.ceil(total / BODEGA_STATE.pageSize));
  var currentPage = BODEGA_STATE.page + 1;
  el.innerHTML =
    '<span>' + total + ' resultados — página ' + currentPage + ' de ' + totalPages + '</span>' +
    '<button class="btn-secondary" ' + (BODEGA_STATE.page <= 0 ? 'disabled' : '') + ' onclick="changeBodegaPage(\'' + cardId + '\', -1, \'' + mode + '\')">Anterior</button>' +
    '<button class="btn-secondary" ' + (currentPage >= totalPages ? 'disabled' : '') + ' onclick="changeBodegaPage(\'' + cardId + '\', 1, \'' + mode + '\')">Siguiente</button>';
}

function changeBodegaPage(cardId, delta, mode) {
  BODEGA_STATE.page = Math.max(0, BODEGA_STATE.page + delta);
  loadBodegaTable(cardId, mode);
}

async function downloadBodega(cardId, mode) {
  var btn = document.getElementById('bodegaDownloadBtn_' + cardId);
  var qs = '?search=' + encodeURIComponent(BODEGA_STATE.search) + '&base=' + encodeURIComponent(BODEGA_STATE.base) + '&deposito=' + encodeURIComponent(BODEGA_STATE.deposito);
  var path = '/api' + bodegaPathPrefix_(mode) + '/bodega/export' + qs;
  await downloadFileFromApi_(path, btn, 'bodega.xlsx');
}


// ---------------------------------------------------------
// VENTA (GX1 / GX2): órdenes por distribuidor + bodega
// ---------------------------------------------------------
function switchVentaTab(tabId) {
  document.querySelectorAll('#v-ordenes, #v-bodega').forEach(function (el) { el.classList.add('hidden'); });
  document.querySelectorAll('#ventaTabs .tab-btn').forEach(function (el) { el.classList.remove('active'); });
  document.getElementById(tabId).classList.remove('hidden');
  document.querySelector('#ventaTabs .tab-btn[data-vtab="' + tabId + '"]').classList.add('active');

  if (tabId === 'v-ordenes') { renderVentaOrdenesView(); loadVentaOrdenes(); }
  if (tabId === 'v-bodega') { renderBodegaView('ventaBodegaCard', 'venta'); loadBodegaTable('ventaBodegaCard', 'venta'); }
}

var VENTA_ORDENES_STATE = { page: 0, pageSize: 100, search: '' };

function renderVentaOrdenesView() {
  var card = document.getElementById('ventaOrdenesCard');
  var tituloBase = STATE.rol === 'VENTA_GX1' ? 'GX1' : 'GX2';
  card.innerHTML =
    '<h2>Órdenes de recupero — ' + tituloBase + '</h2>' +
    '<div class="toolbar">' +
      '<input type="text" id="ventaOrdenesSearchInput" placeholder="Buscar por RUT, nombre, dirección o comuna...">' +
      '<button class="btn-secondary" onclick="onVentaOrdenesSearch()">Buscar</button>' +
      '<button class="btn-primary" onclick="downloadVentaOrdenes()" id="ventaOrdenesDownloadBtn">Descargar Excel</button>' +
    '</div>' +
    '<table>' +
      '<thead><tr><th>RUT</th><th>NOMBRE</th><th>COMUNA</th><th>DIRECCIÓN</th><th>TIPO</th><th>DISTRIBUIDOR</th><th>FCH_INGRESO</th></tr></thead>' +
      '<tbody id="ventaOrdenesTableBody"><tr><td colspan="7" class="muted">Cargando...</td></tr></tbody>' +
    '</table>' +
    '<div class="pagination" id="ventaOrdenesPagination"></div>';
}

function onVentaOrdenesSearch() {
  VENTA_ORDENES_STATE.search = document.getElementById('ventaOrdenesSearchInput').value;
  VENTA_ORDENES_STATE.page = 0;
  loadVentaOrdenes();
}

async function loadVentaOrdenes() {
  var tbody = document.getElementById('ventaOrdenesTableBody');
  tbody.innerHTML = '<tr><td colspan="7" class="muted">Cargando...</td></tr>';
  try {
    var qs = '?page=' + VENTA_ORDENES_STATE.page + '&pageSize=' + VENTA_ORDENES_STATE.pageSize + '&search=' + encodeURIComponent(VENTA_ORDENES_STATE.search);
    var res = await api('/venta/ordenes' + qs);
    if (res.processing) {
      tbody.innerHTML = '<tr><td colspan="7" class="muted">La base se está actualizando en este momento, intenta de nuevo en unos minutos...</td></tr>';
      document.getElementById('ventaOrdenesPagination').innerHTML = '';
      return;
    }
    if (!res.rows.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="muted">Sin resultados.</td></tr>';
    } else {
      var html = '';
      res.rows.forEach(function (r) {
        html += '<tr><td>' + escapeHtml(r.RUT) + '</td><td>' + escapeHtml(r.NOMBRE) + '</td><td>' + escapeHtml(r.COMUNA) + '</td><td>' +
                escapeHtml(r.DIRECCION) + '</td><td>' + escapeHtml(r.TIPO) + '</td><td>' + escapeHtml(r.DISTRIBUIDOR) + '</td><td>' +
                (r.FCH_INGRESO ? new Date(r.FCH_INGRESO).toLocaleDateString('es-CL') : '') + '</td></tr>';
      });
      tbody.innerHTML = html;
    }
    var el = document.getElementById('ventaOrdenesPagination');
    var totalPages = Math.max(1, Math.ceil(res.total / VENTA_ORDENES_STATE.pageSize));
    var currentPage = VENTA_ORDENES_STATE.page + 1;
    el.innerHTML =
      '<span>' + res.total + ' resultados — página ' + currentPage + ' de ' + totalPages + '</span>' +
      '<button class="btn-secondary" ' + (VENTA_ORDENES_STATE.page <= 0 ? 'disabled' : '') + ' onclick="changeVentaOrdenesPage(-1)">Anterior</button>' +
      '<button class="btn-secondary" ' + (currentPage >= totalPages ? 'disabled' : '') + ' onclick="changeVentaOrdenesPage(1)">Siguiente</button>';
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="7" class="error-text">' + e.message + '</td></tr>';
  }
}

function changeVentaOrdenesPage(delta) {
  VENTA_ORDENES_STATE.page = Math.max(0, VENTA_ORDENES_STATE.page + delta);
  loadVentaOrdenes();
}

async function downloadVentaOrdenes() {
  var btn = document.getElementById('ventaOrdenesDownloadBtn');
  var qs = '?search=' + encodeURIComponent(VENTA_ORDENES_STATE.search);
  await downloadFileFromApi_('/api/venta/ordenes/export' + qs, btn, 'ordenes_venta.xlsx');
}
