const express = require('express');
const ExcelJS = require('exceljs');
const db = require('./db');
const auth = require('./auth');
const processFile = require('./processFile');

const router = express.Router();
router.use(auth.requireAuth);

var EXPORT_ROW_CAP = 150000;

async function getTiposPermitidos_() {
  var gx1 = await db.getMeta('TIPOS_PERMITIDOS_GX1_JSON');
  var gx2 = await db.getMeta('TIPOS_PERMITIDOS_GX2_JSON');
  return { gx1: gx1 ? JSON.parse(gx1) : [], gx2: gx2 ? JSON.parse(gx2) : [] };
}

/**
 * Condición SQL para el filtro global de modelos/tipos permitidos por
 * retiro, definido por el admin de forma independiente para GX1 y GX2
 * (vacío = sin restricción para esa base).
 */
function buildTiposPermitidosCondition_(tiposPermitidos, p, conditions, params) {
  var gx1 = tiposPermitidos.gx1 || [];
  var gx2 = tiposPermitidos.gx2 || [];
  if (!gx1.length && !gx2.length) return p;

  if (gx1.length && gx2.length) {
    conditions.push("((base = 'GX1' AND tipo = ANY($" + p++ + ")) OR (base = 'GX2' AND tipo = ANY($" + p++ + ")))");
    params.push(gx1, gx2);
  } else if (gx1.length) {
    conditions.push("(base <> 'GX1' OR tipo = ANY($" + p++ + "))");
    params.push(gx1);
  } else if (gx2.length) {
    conditions.push("(base <> 'GX2' OR tipo = ANY($" + p++ + "))");
    params.push(gx2);
  }
  return p;
}

/**
 * Construye la cláusula WHERE + parámetros según el alcance del usuario
 * (comunas/rango de fechas de ingreso asignados) más los filtros opcionales
 * (búsqueda, tipo y mes ad-hoc para admin, sistema GX1/GX2, tipos permitidos globales).
 */
function buildScopeQuery_(user, search, tipoFilter, mesDesde, mesHasta, sistemaFilter, tiposPermitidos) {
  var conditions = [];
  var params = [];
  var p = 1;

  var comunas = user.rol === 'ADMIN' ? [] : (user.comunas || []);

  if (comunas.length) {
    conditions.push('comuna = ANY($' + p++ + ')');
    params.push(comunas);
  }
  // Rango de fechas de ingreso asignado al usuario (fijo, definido por el admin)
  if (user.rol !== 'ADMIN' && user.fecha_desde) {
    conditions.push('fch_ingreso >= $' + p++);
    params.push(user.fecha_desde);
  }
  if (user.rol !== 'ADMIN' && user.fecha_hasta) {
    conditions.push('fch_ingreso <= $' + p++);
    params.push(user.fecha_hasta);
  }
  if (user.rol === 'ADMIN' && tipoFilter && tipoFilter.length) {
    conditions.push('tipo = ANY($' + p++ + ')');
    params.push(tipoFilter);
  }
  // Filtro libre de mes/año por FCH_INGRESO, solo para admin (no queda guardado, es ad-hoc)
  if (user.rol === 'ADMIN' && mesDesde) {
    conditions.push('fch_ingreso >= $' + p++);
    params.push(mesDesde + '-01');
  }
  if (user.rol === 'ADMIN' && mesHasta) {
    conditions.push("fch_ingreso < (date_trunc('month', $" + p++ + "::date) + interval '1 month')");
    params.push(mesHasta + '-01');
  }
  // Filtro por sistema (GX1 / GX2), disponible para cualquier usuario
  if (sistemaFilter === 'GX1' || sistemaFilter === 'GX2') {
    conditions.push('base = $' + p++);
    params.push(sistemaFilter);
  }
  if (tiposPermitidos) {
    p = buildTiposPermitidosCondition_(tiposPermitidos, p, conditions, params);
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
  var mesDesde = req.query.mesDesde || '';
  var mesHasta = req.query.mesHasta || '';
  var sistemaFilter = req.query.sistema || '';

  var tiposPermitidos = await getTiposPermitidos_();
  var scoped = buildScopeQuery_(req.user, search, tipoFilter, mesDesde, mesHasta, sistemaFilter, tiposPermitidos);

  var countResult = await db.query('SELECT COUNT(*) FROM data_rows ' + scoped.where, scoped.params);
  var total = Number(countResult.rows[0].count);

  var params2 = scoped.params.slice();
  params2.push(pageSize, page * pageSize);
  var dataResult = await db.query(
    'SELECT base, rut, nombre, comuna, direccion, tipo FROM data_rows ' + scoped.where +
    ' ORDER BY id LIMIT $' + scoped.nextParamIndex + ' OFFSET $' + (scoped.nextParamIndex + 1),
    params2
  );

  res.json({
    total: total,
    rows: dataResult.rows.map(function (r) {
      return { SISTEMA: r.base, RUT: r.rut, NOMBRE: r.nombre, COMUNA: r.comuna, DIRECCION: r.direccion, TIPO: r.tipo };
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
  var mesDesde = req.query.mesDesde || '';
  var mesHasta = req.query.mesHasta || '';
  var sistemaFilter = req.query.sistema || '';

  var tiposPermitidos = await getTiposPermitidos_();
  var scoped = buildScopeQuery_(req.user, search, tipoFilter, mesDesde, mesHasta, sistemaFilter, tiposPermitidos);

  var countResult = await db.query('SELECT COUNT(*) FROM data_rows ' + scoped.where, scoped.params);
  var total = Number(countResult.rows[0].count);

  if (total === 0) {
    return res.status(404).json({ ok: false, error: 'No hay filas para exportar con los filtros actuales.' });
  }
  if (total > EXPORT_ROW_CAP) {
    return res.status(413).json({ ok: false, error: 'Hay ' + total + ' filas, supera el máximo de exportación (' + EXPORT_ROW_CAP + ').' });
  }

  var headersGx1 = await db.getMeta('HEADERS_JSON_GX1');
  var headersGx2 = await db.getMeta('HEADERS_JSON_GX2');
  var headers;
  if (sistemaFilter === 'GX1' && headersGx1) headers = JSON.parse(headersGx1);
  else if (sistemaFilter === 'GX2' && headersGx2) headers = JSON.parse(headersGx2);
  else headers = JSON.parse(headersGx2 || headersGx1 || '["RUT","NOMBRE","COMUNA","DIRECCION","TIPO"]');

  var filename = 'ordenes_recupero_' + (sistemaFilter || 'todo') + '_' + req.user.username + '_' + Date.now() + '.xlsx';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');

  var workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res });
  var sheet = workbook.addWorksheet('Datos');
  sheet.addRow(['SISTEMA'].concat(headers)).commit();

  var CHUNK = 2000;
  for (var offset = 0; offset < total; offset += CHUNK) {
    var rowsResult = await db.query(
      'SELECT base, raw FROM data_rows ' + scoped.where + ' ORDER BY id LIMIT $' + scoped.nextParamIndex + ' OFFSET $' + (scoped.nextParamIndex + 1),
      scoped.params.concat([CHUNK, offset])
    );
    rowsResult.rows.forEach(function (r) {
      var raw = r.raw;
      var rowValues = [r.base].concat(headers.map(function (h) { return raw[h] !== undefined ? raw[h] : ''; }));
      sheet.addRow(rowValues).commit();
    });
  }

  sheet.commit();
  await workbook.commit();
});

router.get('/me/scope', async function (req, res) {
  res.json({ rol: req.user.rol, comunas: req.user.comunas || [] });
});

/**
 * Fechas de la última subida de cada base (GX1/GX2), visibles para cualquier
 * usuario logueado (no solo admin/uploader) — el técnico también debe verlas.
 */
router.get('/base-info', async function (req, res) {
  res.json({
    gx1: {
      fecha: await db.getMeta('LAST_UPLOAD_DATE_GX1') || '',
      archivo: await db.getMeta('LAST_UPLOAD_FILENAME_GX1') || ''
    },
    gx2: {
      fecha: await db.getMeta('LAST_UPLOAD_DATE_GX2') || '',
      archivo: await db.getMeta('LAST_UPLOAD_FILENAME_GX2') || ''
    }
  });
});

module.exports = router;
