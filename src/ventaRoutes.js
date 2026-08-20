const express = require('express');
const ExcelJS = require('exceljs');
const db = require('./db');
const auth = require('./auth');
const processFile = require('./processFile');

const router = express.Router();
router.use(auth.requireVenta);

async function getGx1DiasMinimos_() {
  var v = await db.getMeta('GX1_DIAS_MINIMOS');
  return v && !isNaN(Number(v)) ? Number(v) : processFile.GX1_DIAS_MINIMOS_DEFAULT;
}

/**
 * Cláusula de alcance para las órdenes que puede ver un usuario de venta:
 * - VENTA_GX1: solo base GX1, y solo órdenes con antigüedad <= días configurados
 * - VENTA_GX2: solo base GX2, sin restricción de antigüedad
 * En ambos casos, si tiene distribuidores asignados, se filtra por esos.
 */
async function buildVentaScope_(user, extraSearch) {
  var conditions = [];
  var params = [];
  var p = 1;
  var base = user.rol === 'VENTA_GX1' ? 'GX1' : 'GX2';

  conditions.push('base = $' + p++);
  params.push(base);

  if (base === 'GX1') {
    var dias = await getGx1DiasMinimos_();
    conditions.push('(CURRENT_DATE - fch_ingreso) <= $' + p++);
    params.push(dias);
  }

  var distribuidores = user.distribuidores || [];
  if (distribuidores.length) {
    conditions.push('distribuidor = ANY($' + p++ + ')');
    params.push(distribuidores);
  }

  if (extraSearch) {
    conditions.push('(rut ILIKE $' + p + ' OR nombre ILIKE $' + p + ' OR direccion ILIKE $' + p + ' OR comuna ILIKE $' + p + ')');
    params.push('%' + extraSearch + '%');
    p++;
  }

  return { where: 'WHERE ' + conditions.join(' AND '), params: params, nextParamIndex: p, base: base };
}

router.get('/ordenes', async function (req, res) {
  if (processFile.isProcessing()) {
    return res.json({ total: 0, rows: [], page: 0, pageSize: 100, processing: true });
  }
  var page = parseInt(req.query.page || '0', 10);
  var pageSize = Math.min(parseInt(req.query.pageSize || '100', 10), 500);
  var search = req.query.search || '';

  var scope = await buildVentaScope_(req.user, search);

  var countResult = await db.query('SELECT COUNT(*) FROM data_rows ' + scope.where, scope.params);
  var total = Number(countResult.rows[0].count);

  var params2 = scope.params.slice();
  params2.push(pageSize, page * pageSize);
  var dataResult = await db.query(
    'SELECT rut, nombre, comuna, direccion, tipo, distribuidor, fch_ingreso FROM data_rows ' + scope.where +
    ' ORDER BY id LIMIT $' + scope.nextParamIndex + ' OFFSET $' + (scope.nextParamIndex + 1),
    params2
  );

  res.json({
    total: total,
    base: scope.base,
    rows: dataResult.rows.map(function (r) {
      return { RUT: r.rut, NOMBRE: r.nombre, COMUNA: r.comuna, DIRECCION: r.direccion, TIPO: r.tipo, DISTRIBUIDOR: r.distribuidor, FCH_INGRESO: r.fch_ingreso };
    }),
    page: page,
    pageSize: pageSize
  });
});

router.get('/ordenes/export', async function (req, res) {
  if (processFile.isProcessing()) {
    return res.status(409).json({ ok: false, error: 'La base se está actualizando en este momento. Intenta de nuevo en unos minutos.' });
  }
  var search = req.query.search || '';
  var scope = await buildVentaScope_(req.user, search);

  var countResult = await db.query('SELECT COUNT(*) FROM data_rows ' + scope.where, scope.params);
  var total = Number(countResult.rows[0].count);
  if (total === 0) return res.status(404).json({ ok: false, error: 'No hay filas para exportar con los filtros actuales.' });
  if (total > 150000) return res.status(413).json({ ok: false, error: 'Hay ' + total + ' filas, supera el máximo de exportación.' });

  var headersJson = await db.getMeta('HEADERS_JSON_' + scope.base);
  var headers = headersJson ? JSON.parse(headersJson) : ['RUT', 'NOMBRE', 'COMUNA', 'DIRECCION', 'TIPO', 'DISTRIBUIDOR'];

  var filename = 'ordenes_' + scope.base + '_' + req.user.username + '_' + Date.now() + '.xlsx';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');

  var workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res });
  var sheet = workbook.addWorksheet('Datos');
  sheet.addRow(headers).commit();

  var CHUNK = 2000;
  for (var offset = 0; offset < total; offset += CHUNK) {
    var rowsResult = await db.query(
      'SELECT raw FROM data_rows ' + scope.where + ' ORDER BY id LIMIT $' + scope.nextParamIndex + ' OFFSET $' + (scope.nextParamIndex + 1),
      scope.params.concat([CHUNK, offset])
    );
    rowsResult.rows.forEach(function (r) {
      var raw = r.raw;
      sheet.addRow(headers.map(function (h) { return raw[h] !== undefined ? raw[h] : ''; })).commit();
    });
  }
  sheet.commit();
  await workbook.commit();
});

/**
 * Inventario de bodega (ambas bases GX1 y GX2), filtrado por los depósitos
 * que el administrador dejó visibles de forma global.
 */
async function buildBodegaScope_(search) {
  var conditions = [];
  var params = [];
  var p = 1;

  var visiblesJson = await db.getMeta('DEPOSITOS_VISIBLES_JSON');
  var visibles = visiblesJson ? JSON.parse(visiblesJson) : [];
  if (visibles.length) {
    conditions.push('deposito = ANY($' + p++ + ')');
    params.push(visibles);
  }
  if (search) {
    conditions.push('(articulo ILIKE $' + p + ' OR cod_articulo ILIKE $' + p + ' OR deposito ILIKE $' + p + ')');
    params.push('%' + search + '%');
    p++;
  }

  return { where: conditions.length ? 'WHERE ' + conditions.join(' AND ') : '', params: params, nextParamIndex: p };
}

router.get('/bodega', async function (req, res) {
  var page = parseInt(req.query.page || '0', 10);
  var pageSize = Math.min(parseInt(req.query.pageSize || '100', 10), 500);
  var search = req.query.search || '';
  var base = req.query.base === 'GX1' || req.query.base === 'GX2' ? req.query.base : '';

  var scope = await buildBodegaScope_(search);
  var where = scope.where;
  var params = scope.params.slice();
  var p = scope.nextParamIndex;
  if (base) {
    where = where ? where + ' AND base = $' + p++ : 'WHERE base = $' + p++;
    params.push(base);
  }

  var countResult = await db.query('SELECT COUNT(*) FROM bodega_items ' + where, params);
  var total = Number(countResult.rows[0].count);

  var params2 = params.slice();
  params2.push(pageSize, page * pageSize);
  var result = await db.query(
    'SELECT base, cod_deposito, deposito, cod_articulo, articulo, stock FROM bodega_items ' + where +
    ' ORDER BY deposito, articulo LIMIT $' + p + ' OFFSET $' + (p + 1),
    params2
  );

  res.json({ total: total, page: page, pageSize: pageSize, rows: result.rows });
});

router.get('/bodega/export', async function (req, res) {
  var search = req.query.search || '';
  var base = req.query.base === 'GX1' || req.query.base === 'GX2' ? req.query.base : '';

  var scope = await buildBodegaScope_(search);
  var where = scope.where;
  var params = scope.params.slice();
  var p = scope.nextParamIndex;
  if (base) {
    where = where ? where + ' AND base = $' + p++ : 'WHERE base = $' + p++;
    params.push(base);
  }

  var result = await db.query('SELECT base, cod_deposito, deposito, cod_articulo, articulo, stock FROM bodega_items ' + where + ' ORDER BY deposito, articulo', params);
  if (!result.rows.length) return res.status(404).json({ ok: false, error: 'No hay filas de bodega para exportar.' });

  var filename = 'bodega_' + (base || 'todo') + '_' + Date.now() + '.xlsx';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');

  var workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res });
  var sheet = workbook.addWorksheet('Bodega');
  sheet.addRow(['SISTEMA', 'COD_DEPOSITO', 'DEPOSITO', 'COD_ARTICULO', 'ARTICULO', 'STOCK']).commit();
  result.rows.forEach(function (r) {
    sheet.addRow([r.base, r.cod_deposito, r.deposito, r.cod_articulo, r.articulo, r.stock]).commit();
  });
  sheet.commit();
  await workbook.commit();
});

module.exports = router;
