const express = require('express');
const ExcelJS = require('exceljs');
const db = require('./db');
const auth = require('./auth');
const processFile = require('./processFile');

const router = express.Router();
router.use(auth.requireAuth);

async function getGx1DiasMinimos_() {
  var v = await db.getMeta('GX1_DIAS_MINIMOS');
  return v && !isNaN(Number(v)) ? Number(v) : processFile.GX1_DIAS_MINIMOS_DEFAULT;
}

async function getTiposPermitidos_() {
  var gx1 = await db.getMeta('TIPOS_PERMITIDOS_GX1_JSON');
  var gx2 = await db.getMeta('TIPOS_PERMITIDOS_GX2_JSON');
  return { gx1: gx1 ? JSON.parse(gx1) : [], gx2: gx2 ? JSON.parse(gx2) : [] };
}

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
 * Devuelve la cláusula de alcance (comunas/fechas asignadas + sistema +
 * modelos permitidos) del usuario logueado, para usar sobre data_rows.
 * ADMIN no tiene restricción de comuna/fecha.
 */
async function buildUserScope_(user, sistemaFilter) {
  var conditions = [];
  var params = [];
  var p = 1;
  var comunas = user.rol === 'ADMIN' ? [] : (user.comunas || []);

  if (comunas.length) { conditions.push('comuna = ANY($' + p++ + ')'); params.push(comunas); }
  if (user.rol !== 'ADMIN' && user.fecha_desde) { conditions.push('fch_ingreso >= $' + p++); params.push(user.fecha_desde); }
  if (user.rol !== 'ADMIN' && user.fecha_hasta) { conditions.push('fch_ingreso <= $' + p++); params.push(user.fecha_hasta); }
  if (user.rol === 'USER') {
    var dias = await getGx1DiasMinimos_();
    conditions.push("(base <> 'GX1' OR (CURRENT_DATE - fch_ingreso) > $" + p++ + ')');
    params.push(dias);
  }
  if (sistemaFilter === 'GX1' || sistemaFilter === 'GX2') { conditions.push('base = $' + p++); params.push(sistemaFilter); }

  var tiposPermitidos = await getTiposPermitidos_();
  p = buildTiposPermitidosCondition_(tiposPermitidos, p, conditions, params);

  return { where: conditions.length ? 'WHERE ' + conditions.join(' AND ') : '', params: params, nextParamIndex: p };
}

/**
 * Lista de motivos activos (visibles para cualquier usuario logueado, para el formulario de gestión).
 */
router.get('/motivos', async function (req, res) {
  var result = await db.query('SELECT id, texto FROM motivos_pendiente WHERE activo = true ORDER BY texto');
  res.json(result.rows);
});

/**
 * Clientes/direcciones (dentro de una base específica) dentro del alcance
 * del usuario que AÚN no tienen ningún registro de gestión. Paginado.
 */
router.get('/pendientes-sin-gestionar', async function (req, res) {
  var page = parseInt(req.query.page || '0', 10);
  var pageSize = Math.min(parseInt(req.query.pageSize || '50', 10), 200);
  var sistemaFilter = req.query.sistema || '';
  var scope = await buildUserScope_(req.user, sistemaFilter);

  var baseWhere = scope.where;
  var notExists = 'NOT EXISTS (SELECT 1 FROM gestiones g WHERE g.rut = data_rows.rut AND g.direccion = data_rows.direccion AND g.base = data_rows.base)';
  var fullWhere = baseWhere ? baseWhere + ' AND ' + notExists : 'WHERE ' + notExists;

  var countSql = 'SELECT COUNT(*) FROM (SELECT rut, direccion, base FROM data_rows ' + fullWhere + ' GROUP BY rut, direccion, base) x';
  var countResult = await db.query(countSql, scope.params);
  var total = Number(countResult.rows[0].count);

  var params2 = scope.params.slice();
  params2.push(pageSize, page * pageSize);
  var sql =
    'SELECT base, rut, nombre, comuna, region, direccion, ' +
    "array_agg(DISTINCT tipo) AS tipos, COUNT(*) AS cantidad_equipos, " +
    "MAX(raw->>'CASA') AS casa, MAX(raw->>'CELULAR') AS celular " +
    'FROM data_rows ' + fullWhere +
    ' GROUP BY base, rut, nombre, comuna, region, direccion ' +
    ' ORDER BY comuna, nombre ' +
    ' LIMIT $' + scope.nextParamIndex + ' OFFSET $' + (scope.nextParamIndex + 1);

  var result = await db.query(sql, params2);
  res.json({ total: total, page: page, pageSize: pageSize, rows: result.rows });
});

/**
 * Registra una acción de gestión (realizado o pendiente, con motivo/detalle/fecha agendada).
 * Verifica que el rut+dirección+base efectivamente exista dentro del alcance del usuario.
 */
router.post('/', async function (req, res) {
  var b = req.body;
  if (!b.rut || !b.direccion || !b.estado || !b.base) {
    return res.json({ ok: false, error: 'Faltan datos obligatorios.' });
  }
  if (['REALIZADO', 'PENDIENTE'].indexOf(b.estado) === -1) {
    return res.json({ ok: false, error: 'Estado inválido.' });
  }
  if (b.estado === 'PENDIENTE' && !b.motivoId) {
    return res.json({ ok: false, error: 'Selecciona un motivo.' });
  }

  var scope = await buildUserScope_(req.user, '');
  var checkWhere = scope.where
    ? scope.where + ' AND rut = $' + scope.nextParamIndex + ' AND direccion = $' + (scope.nextParamIndex + 1) + ' AND base = $' + (scope.nextParamIndex + 2)
    : 'WHERE rut = $' + scope.nextParamIndex + ' AND direccion = $' + (scope.nextParamIndex + 1) + ' AND base = $' + (scope.nextParamIndex + 2);
  var checkParams = scope.params.concat([b.rut, b.direccion, b.base]);
  var checkResult = await db.query(
    "SELECT nombre, comuna, region, array_agg(DISTINCT tipo) AS tipos, COUNT(*) AS cantidad, MAX(raw->>'CASA') AS casa, MAX(raw->>'CELULAR') AS celular " +
    'FROM data_rows ' + checkWhere + ' GROUP BY nombre, comuna, region',
    checkParams
  );

  if (!checkResult.rows.length) {
    return res.json({ ok: false, error: 'Ese cliente no está dentro de tu alcance asignado.' });
  }
  var info = checkResult.rows[0];

  await db.query(
    `INSERT INTO gestiones
      (base, rut, nombre, comuna, region, direccion, tipos_json, cantidad_equipos, casa, celular,
       tecnico_id, tecnico_username, estado, motivo_id, detalle, fecha_agendada)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      b.base, b.rut, info.nombre, info.comuna, info.region, b.direccion,
      JSON.stringify(info.tipos), info.cantidad, info.casa, info.celular,
      req.user.id, req.user.username, b.estado, b.motivoId || null, b.detalle || null,
      b.fechaAgendada || null
    ]
  );

  res.json({ ok: true });
});

/**
 * Últimos registros de gestión del técnico logueado cuyo estado actual es PENDIENTE
 * (agenda / seguimiento), ordenados por fecha agendada.
 */
router.get('/agendados', async function (req, res) {
  var sql = `
    WITH ultimos AS (
      SELECT DISTINCT ON (rut, direccion, base) *
      FROM gestiones
      WHERE tecnico_id = $1
      ORDER BY rut, direccion, base, created_at DESC
    )
    SELECT g.*, m.texto AS motivo_texto
    FROM ultimos g
    LEFT JOIN motivos_pendiente m ON m.id = g.motivo_id
    WHERE g.estado = 'PENDIENTE'
    ORDER BY g.fecha_agendada ASC NULLS LAST, g.created_at DESC
  `;
  var result = await db.query(sql, [req.user.id]);
  res.json(result.rows);
});

/**
 * Últimos registros de gestión del técnico logueado cuyo estado actual es REALIZADO.
 */
router.get('/gestionados', async function (req, res) {
  var sql = `
    WITH ultimos AS (
      SELECT DISTINCT ON (rut, direccion, base) *
      FROM gestiones
      WHERE tecnico_id = $1
      ORDER BY rut, direccion, base, created_at DESC
    )
    SELECT * FROM ultimos WHERE estado = 'REALIZADO'
    ORDER BY created_at DESC
  `;
  var result = await db.query(sql, [req.user.id]);
  res.json(result.rows);
});

/**
 * Exporta a Excel los retiros REALIZADOS del técnico logueado (todas las bases, con columna SISTEMA).
 */
router.get('/gestionados/export', async function (req, res) {
  var sql = `
    WITH ultimos AS (
      SELECT DISTINCT ON (rut, direccion, base) *
      FROM gestiones
      WHERE tecnico_id = $1
      ORDER BY rut, direccion, base, created_at DESC
    )
    SELECT * FROM ultimos WHERE estado = 'REALIZADO'
    ORDER BY created_at DESC
  `;
  var result = await db.query(sql, [req.user.id]);

  if (!result.rows.length) {
    return res.status(404).json({ ok: false, error: 'No tienes retiros realizados para exportar.' });
  }

  var filename = 'retiros_realizados_' + req.user.username + '_' + Date.now() + '.xlsx';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');

  var workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res });
  var sheet = workbook.addWorksheet('Retiros');
  sheet.addRow(['SISTEMA', 'RUT', 'NOMBRE', 'REGION', 'COMUNA', 'DIRECCION', 'TIPOS', 'CANTIDAD_EQUIPOS', 'CASA', 'CELULAR', 'FECHA_GESTION']).commit();
  result.rows.forEach(function (r) {
    sheet.addRow([
      r.base, r.rut, r.nombre, r.region, r.comuna, r.direccion,
      (r.tipos_json || []).join(', '), r.cantidad_equipos, r.casa, r.celular,
      new Date(r.created_at).toLocaleString('es-CL')
    ]).commit();
  });
  sheet.commit();
  await workbook.commit();
});

module.exports = router;
