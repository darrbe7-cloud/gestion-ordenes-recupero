const express = require('express');
const ExcelJS = require('exceljs');
const db = require('./db');
const auth = require('./auth');
const processFile = require('./processFile');

const router = express.Router();
router.use(auth.requireAuth);

var EXPORT_ROW_CAP = 150000;

/**
 * Construye la cláusula WHERE + parámetros según el alcance del usuario
 * (comunas/tipos asignados) más los filtros opcionales (búsqueda, tipo ad-hoc para admin).
 */
function buildScopeQuery_(user, search, tipoFilter) {
  var conditions = [];
  var params = [];
  var p = 1;

  var comunas = user.rol === 'ADMIN' ? [] : (user.comunas || []);
  var tipos = user.rol === 'ADMIN' ? [] : (user.tipos || []);

  if (comunas.length) {
    conditions.push('comuna = ANY($' + p++ + ')');
    params.push(comunas);
  }
  if (tipos.length) {
    conditions.push('tipo = ANY($' + p++ + ')');
    params.push(tipos);
  }
  if (user.rol === 'ADMIN' && tipoFilter && tipoFilter.length) {
    conditions.push('tipo = ANY($' + p++ + ')');
    params.push(tipoFilter);
  }
  if (search) {
    conditions.push('(rut ILIKE $' + p + ' OR nombre ILIKE $' + p + ' OR direccion ILIKE $' + p + ' OR comuna ILIKE $' + p + ')');
    params.push('%' + search + '%');
    p++;
  }

  var where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  return { where: where, params: params, nextParamIndex: p };
}

router.get('/data', async function (req, res) {
  if (processFile.isProcessing()) {
    return res.json({ total: 0, rows: [], page: 0, pageSize: 100, processing: true });
  }

  var page = parseInt(req.query.page || '0', 10);
  var pageSize = Math.min(parseInt(req.query.pageSize || '100', 10), 500);
  var search = req.query.search || '';
  var tipoFilter = req.query.tipoFilter ? JSON.parse(req.query.tipoFilter) : [];

  var scoped = buildScopeQuery_(req.user, search, tipoFilter);

  var countResult = await db.query('SELECT COUNT(*) FROM data_rows ' + scoped.where, scoped.params);
  var total = Number(countResult.rows[0].count);

  var params2 = scoped.params.slice();
  params2.push(pageSize, page * pageSize);
  var dataResult = await db.query(
    'SELECT rut, nombre, comuna, direccion, tipo FROM data_rows ' + scoped.where +
    ' ORDER BY id LIMIT $' + scoped.nextParamIndex + ' OFFSET $' + (scoped.nextParamIndex + 1),
    params2
  );

  res.json({
    total: total,
    rows: dataResult.rows.map(function (r) {
      return { RUT: r.rut, NOMBRE: r.nombre, COMUNA: r.comuna, DIRECCION: r.direccion, TIPO: r.tipo };
    }),
    page: page,
    pageSize: pageSize
  });
});

router.get('/data/export', async function (req, res) {
  if (processFile.isProcessing()) {
    return res.status(409).json({ ok: false, error: 'La base se está actualizando en este momento. Intenta de nuevo en unos minutos.' });
  }

  var search = req.query.search || '';
  var tipoFilter = req.query.tipoFilter ? JSON.parse(req.query.tipoFilter) : [];
  var scoped = buildScopeQuery_(req.user, search, tipoFilter);

  var countResult = await db.query('SELECT COUNT(*) FROM data_rows ' + scoped.where, scoped.params);
  var total = Number(countResult.rows[0].count);

  if (total === 0) {
    return res.status(404).json({ ok: false, error: 'No hay filas para exportar con los filtros actuales.' });
  }
  if (total > EXPORT_ROW_CAP) {
    return res.status(413).json({ ok: false, error: 'Hay ' + total + ' filas, supera el máximo de exportación (' + EXPORT_ROW_CAP + ').' });
  }

  var headersJson = await db.getMeta('HEADERS_JSON');
  var headers = headersJson ? JSON.parse(headersJson) : ['RUT', 'NOMBRE', 'COMUNA', 'DIRECCION', 'TIPO'];

  var filename = 'ordenes_recupero_' + req.user.username + '_' + Date.now() + '.xlsx';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');

  var workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res });
  var sheet = workbook.addWorksheet('Datos');
  sheet.addRow(headers).commit();

  var CHUNK = 2000;
  for (var offset = 0; offset < total; offset += CHUNK) {
    var rowsResult = await db.query(
      'SELECT raw FROM data_rows ' + scoped.where + ' ORDER BY id LIMIT $' + scoped.nextParamIndex + ' OFFSET $' + (scoped.nextParamIndex + 1),
      scoped.params.concat([CHUNK, offset])
    );
    rowsResult.rows.forEach(function (r) {
      var raw = r.raw;
      var rowValues = headers.map(function (h) { return raw[h] !== undefined ? raw[h] : ''; });
      sheet.addRow(rowValues).commit();
    });
  }

  sheet.commit();
  await workbook.commit();
});

router.get('/me/scope', async function (req, res) {
  res.json({ rol: req.user.rol, comunas: req.user.comunas || [], tipos: req.user.tipos || [] });
});

module.exports = router;
