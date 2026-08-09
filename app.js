// ---------------------------------------------------------
// ESTADO GLOBAL DEL CLIENTE
// ---------------------------------------------------------
var STATE = {
  rol: null,
  username: null,
  metaLists: { comunas: [], tipos: [], regionByComuna: {}, regiones: [] },
  dataPage: 0,
  dataPageSize: 100,
  dataSearch: '',
  dataTipoFilter: [],
  usersCache: [],
  processing: false
};

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

function handleSessionExpired() {
  alert('Tu sesión expiró. Vuelve a iniciar sesión.');
  doLogout(true);
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

function onLoginSuccess() {
  document.getElementById('view-login').classList.add('hidden');
  document.getElementById('view-app').classList.remove('hidden');
  document.getElementById('topbarUser').textContent = STATE.username + ' (' + (STATE.rol === 'ADMIN' ? 'Administrador' : 'Usuario') + ')';

  if (STATE.rol === 'ADMIN') {
    document.getElementById('adminTabs').classList.remove('hidden');
    document.getElementById('userDashboard').classList.add('hidden');
    switchTab('tab-upload');
    loadMetaStats();
    checkResumeProcessPolling();
  } else {
    document.getElementById('adminTabs').classList.add('hidden');
    document.getElementById('userDashboard').classList.remove('hidden');
    renderDataView('dataCardUser', false);
    loadDataTable('dataCardUser');
  }
}

async function doLogout(skipCall) {
  if (!skipCall) { try { await api('/logout', { method: 'POST' }); } catch (e) {} }
  STATE = { rol: null, username: null, metaLists: { comunas: [], tipos: [], regionByComuna: {}, regiones: [] }, dataPage: 0, dataPageSize: 100, dataSearch: '', dataTipoFilter: [], usersCache: [], processing: false };
  document.getElementById('view-app').classList.add('hidden');
  document.getElementById('view-login').classList.remove('hidden');
  document.getElementById('loginUsername').value = '';
  document.getElementById('loginPassword').value = '';
}

// Al cargar la página, revisar si ya hay una sesión activa (cookie válida)
window.addEventListener('DOMContentLoaded', async function () {
  try {
    var res = await api('/me');
    if (res.ok) {
      STATE.rol = res.rol;
      STATE.username = res.username;
      onLoginSuccess();
    }
  } catch (e) { /* no hay sesión, se queda en el login */ }
});

// ---------------------------------------------------------
// CAMBIAR CONTRASEÑA PROPIA
// ---------------------------------------------------------
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
  document.querySelectorAll('.tab-btn').forEach(function (el) { el.classList.remove('active'); });
  document.getElementById(tabId).classList.remove('hidden');
  document.querySelector('.tab-btn[data-tab="' + tabId + '"]').classList.add('active');

  if (tabId === 'tab-users') loadUsers();
  if (tabId === 'tab-data') { renderDataView('dataCardAdmin', true); loadDataTable('dataCardAdmin'); }
  if (tabId === 'tab-upload') loadMetaStats();
}

// ---------------------------------------------------------
// CARGA DE ARCHIVO (ADMIN)
// ---------------------------------------------------------
var processPollTimer = null;

async function uploadFile() {
  var fileInput = document.getElementById('fileInput');
  if (!fileInput.files.length) { alert('Selecciona un archivo .xlsx primero.'); return; }
  if (!confirm('Esto reemplazará TODA la base actual con el contenido de este archivo (ya filtrado). El proceso corre en segundo plano. ¿Continuar?')) return;

  var formData = new FormData();
  formData.append('file', fileInput.files[0]);

  try {
    var res = await api('/admin/upload', { method: 'POST', body: formData });
    if (!res.ok) { alert('Error al iniciar el procesamiento: ' + res.error); return; }
    STATE.processing = true;
    fileInput.value = '';
    startProcessPolling();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

function startProcessPolling() {
  renderProcessProgress({ estado: 'EN_PROGRESO', filasLeidas: 0, filasCargadas: 0 });
  if (processPollTimer) clearInterval(processPollTimer);
  processPollTimer = setInterval(pollProcessStatus, 2000);
  pollProcessStatus();
}

async function pollProcessStatus() {
  try {
    var status = await api('/admin/process-status');
    renderProcessProgress(status);
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
    var status = await api('/admin/process-status');
    if (status.estado === 'EN_PROGRESO') {
      STATE.processing = true;
      renderProcessProgress(status);
      if (processPollTimer) clearInterval(processPollTimer);
      processPollTimer = setInterval(pollProcessStatus, 2000);
    }
  } catch (e) {}
}

function renderProcessProgress(status) {
  var container = document.getElementById('processProgress');
  if (!container) return;

  if (!status.estado || status.estado === 'INACTIVO') { container.innerHTML = ''; return; }
  if (status.estado === 'ERROR') {
    container.innerHTML = '<div class="card"><h3>Error al procesar</h3><p class="error-text">' + escapeHtml(status.error) + '</p></div>';
    return;
  }
  if (status.estado === 'COMPLETADO') {
    container.innerHTML = '<div class="card"><h3>Procesamiento completado</h3>' +
      '<p class="success-text">Archivo: ' + escapeHtml(status.archivo) + ' — ' + status.filasLeidas + ' filas leídas, ' + status.filasCargadas + ' filas cargadas tras el filtro.</p></div>';
    return;
  }
  container.innerHTML =
    '<div class="card">' +
      '<h3>Procesando ' + escapeHtml(status.archivo || '') + '...</h3>' +
      '<div class="progress-bar-outer"><div class="progress-bar-inner" style="width: 100%; animation: pulse 1.5s infinite;"></div></div>' +
      '<p class="muted">' + status.filasLeidas + ' filas revisadas, ' + status.filasCargadas + ' cargadas hasta ahora. Puedes seguir usando la página.</p>' +
    '</div>';
}

async function loadMetaStats() {
  var el = document.getElementById('metaStats');
  try {
    var meta = await api('/admin/meta');
    STATE.metaLists = { comunas: meta.comunas, tipos: meta.tipos, regionByComuna: meta.regionByComuna, regiones: meta.regiones };
    el.innerHTML =
      statBox(meta.totalRowsFiltered, 'Filas activas (filtradas)') +
      statBox(meta.totalRowsRaw, 'Filas en el último archivo') +
      statBox(meta.comunas.length, 'Comunas distintas') +
      statBox(meta.tipos.length, 'Tipos distintos') +
      statBox(meta.lastUploadFilename || '—', 'Último archivo procesado') +
      statBox(meta.lastUploadDate ? new Date(meta.lastUploadDate).toLocaleString() : '—', 'Fecha de última carga');
  } catch (e) {
    el.innerHTML = '<p class="error-text">' + e.message + '</p>';
  }
}

function statBox(num, label) {
  return '<div class="stat-box"><div class="num">' + num + '</div><div class="lbl">' + label + '</div></div>';
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
      html += '<tr>' +
        '<td>' + escapeHtml(u.username) + '</td>' +
        '<td><span class="badge ' + (u.rol === 'ADMIN' ? 'badge-admin' : 'badge-user') + '">' + u.rol + '</span></td>' +
        '<td>' + (u.comunas.length ? u.comunas.length + ' asignadas' : 'Todas') + '</td>' +
        '<td>' + (u.tipos.length ? u.tipos.length + ' asignados' : 'Todos') + '</td>' +
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
async function openUserModal(userId) {
  document.getElementById('userModalError').classList.add('hidden');
  document.getElementById('userModalId').value = userId || '';
  document.getElementById('userModalUsername').value = '';
  document.getElementById('userModalPassword').value = '';
  document.getElementById('userModalRol').value = 'USER';
  document.getElementById('userModalActivo').checked = true;
  document.getElementById('userModalUsername').disabled = false;

  if (!STATE.metaLists.comunas.length && !STATE.metaLists.tipos.length) {
    try {
      var meta = await api('/admin/meta');
      STATE.metaLists = { comunas: meta.comunas, tipos: meta.tipos, regionByComuna: meta.regionByComuna, regiones: meta.regiones };
    } catch (e) {}
  }

  var regionSelect = document.getElementById('regionFilterSelect');
  regionSelect.innerHTML = '<option value="">Todas las regiones</option>' +
    (STATE.metaLists.regiones || []).map(function (r) { return '<option value="' + escapeHtml(r) + '">' + escapeHtml(r) + '</option>'; }).join('');
  regionSelect.value = '';

  renderCheckboxList('comunasCheckboxList', STATE.metaLists.comunas, []);
  renderCheckboxList('tiposCheckboxList', STATE.metaLists.tipos, []);

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
      renderCheckboxList('tiposCheckboxList', STATE.metaLists.tipos, u.tipos);
    }
  } else {
    document.getElementById('userModalTitle').textContent = 'Nuevo usuario';
    document.getElementById('userModalPasswordLabel').textContent = 'Contraseña';
  }
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
  var tipos = getCheckedValues('tiposCheckboxList');
  var errEl = document.getElementById('userModalError');
  errEl.classList.add('hidden');

  try {
    var res;
    if (id) {
      res = await api('/admin/users/' + id, {
        method: 'PUT',
        body: JSON.stringify({ password: password || undefined, rol: rol, comunas: comunas, tipos: tipos, activo: activo })
      });
    } else {
      if (!username || !password) {
        errEl.textContent = 'Usuario y contraseña son obligatorios.';
        errEl.classList.remove('hidden');
        return;
      }
      res = await api('/admin/users', {
        method: 'POST',
        body: JSON.stringify({ username: username, password: password, rol: rol, comunas: comunas, tipos: tipos })
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

// ---------------------------------------------------------
// TABLA DE DATOS (compartida entre admin "Ver datos" y vista de usuario)
// ---------------------------------------------------------
function renderDataView(cardId, isAdmin) {
  var card = document.getElementById(cardId);
  var tipoFilterHtml = '';
  if (isAdmin) {
    tipoFilterHtml =
      '<div class="field" style="max-width:320px;">' +
        '<label>Filtrar por tipo de equipo (opcional)</label>' +
        '<input type="text" class="search-mini" placeholder="Buscar tipo..." oninput="filterCheckboxList(\'adminTipoFilterList\', this.value)">' +
        '<div class="checkbox-list" id="adminTipoFilterList" style="max-height:140px;"></div>' +
        '<button class="btn-secondary" style="margin-top:8px;" onclick="applyAdminTipoFilter()">Aplicar filtro de tipo</button>' +
      '</div>';
  }
  card.innerHTML =
    '<h2>' + (isAdmin ? 'Datos (todas las comunas y tipos)' : 'Mis datos asignados') + '</h2>' +
    (isAdmin ? tipoFilterHtml : '') +
    '<div class="toolbar">' +
      '<input type="text" id="dataSearchInput_' + cardId + '" placeholder="Buscar por RUT, nombre, dirección o comuna...">' +
      '<button class="btn-secondary" onclick="onSearchData(\'' + cardId + '\')">Buscar</button>' +
      '<button class="btn-primary" onclick="downloadExcel()" id="downloadBtn_' + cardId + '">Descargar Excel</button>' +
    '</div>' +
    '<table>' +
      '<thead><tr><th>RUT</th><th>NOMBRE</th><th>COMUNA</th><th>DIRECCIÓN</th><th>TIPO</th></tr></thead>' +
      '<tbody id="dataTableBody_' + cardId + '"><tr><td colspan="5" class="muted">Cargando...</td></tr></tbody>' +
    '</table>' +
    '<div class="pagination" id="pagination_' + cardId + '"></div>';

  if (isAdmin) renderCheckboxList('adminTipoFilterList', STATE.metaLists.tipos, []);
}

function applyAdminTipoFilter() {
  STATE.dataTipoFilter = getCheckedValues('adminTipoFilterList');
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
  tbody.innerHTML = '<tr><td colspan="5" class="muted">Cargando...</td></tr>';
  try {
    var qs = '?page=' + STATE.dataPage + '&pageSize=' + STATE.dataPageSize +
      '&search=' + encodeURIComponent(STATE.dataSearch) +
      '&tipoFilter=' + encodeURIComponent(JSON.stringify(STATE.dataTipoFilter));
    var res = await api('/data' + qs);

    if (res.processing) {
      tbody.innerHTML = '<tr><td colspan="5" class="muted">La base se está actualizando en este momento, intenta de nuevo en unos minutos...</td></tr>';
      document.getElementById('pagination_' + cardId).innerHTML = '';
      return;
    }
    if (!res.rows.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="muted">Sin resultados.</td></tr>';
    } else {
      var html = '';
      res.rows.forEach(function (r) {
        html += '<tr><td>' + escapeHtml(r.RUT) + '</td><td>' + escapeHtml(r.NOMBRE) + '</td><td>' +
                escapeHtml(r.COMUNA) + '</td><td>' + escapeHtml(r.DIRECCION) + '</td><td>' + escapeHtml(r.TIPO) + '</td></tr>';
      });
      tbody.innerHTML = html;
    }
    renderPagination(cardId, res.total);
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="5" class="error-text">' + e.message + '</td></tr>';
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

async function downloadExcel() {
  var btnId = STATE.rol === 'ADMIN' ? 'downloadBtn_dataCardAdmin' : 'downloadBtn_dataCardUser';
  var btn = document.getElementById(btnId);
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Generando...'; }

  try {
    var qs = '?search=' + encodeURIComponent(STATE.dataSearch) + '&tipoFilter=' + encodeURIComponent(JSON.stringify(STATE.dataTipoFilter));
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
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
