const express = require('express');
const ExcelJS = require('exceljs');
const db = require('./db');
const auth = require('./auth');

const router = express.Router();
router.use(auth.requireAuth);

/**
 * Devuelve la cláusula de alcance (comunas/tipos asignados) del usuario logueado,
 * para usar sobre data_rows. ADMIN no tiene restricción.
 */
function buildUserScope_(user) {
  var conditions = [];
  var params = [];
  var p = 1;
  var comunas = user.rol === 'ADMIN' ? [] : (user.comunas || []);
  var tipos = user.rol === 'ADMIN' ? [] : (user.tipos || []);

  if (comunas.length) { conditions.push('comuna = ANY($' + p++ + ')'); params.push(comunas); }
  if (tipos.length) { conditions.push('tipo = ANY($' + p++ + ')'); params.push(tipos); }

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
 * Clientes/direcciones dentro del alcance del usuario que AÚN no tienen ningún
 * registro de gestión (de ningún técnico). Paginado.
 */
router.get('/pendientes-sin-gestionar', async function (req, res) {
  var page = parseInt(req.query.page || '0', 10);
  var pageSize = Math.min(parseInt(req.query.pageSize || '50', 10), 200);
  var scope = buildUserScope_(req.user);

  var baseWhere = scope.where;
  var notExists = 'NOT EXISTS (SELECT 1 FROM gestiones g WHERE g.rut = data_rows.rut AND g.direccion = data_rows.direccion)';
  var fullWhere = baseWhere ? baseWhere + ' AND ' + notExists : 'WHERE ' + notExists;

  var countSql = 'SELECT COUNT(*) FROM (SELECT rut, direccion FROM data_rows ' + fullWhere + ' GROUP BY rut, direccion) x';
  var countResult = await db.query(countSql, scope.params);
  var total = Number(countResult.rows[0].count);

  var params2 = scope.params.slice();
  params2.push(pageSize, page * pageSize);
  var sql =
    'SELECT rut, nombre, comuna, region, direccion, ' +
    "array_agg(DISTINCT tipo) AS tipos, COUNT(*) AS cantidad_equipos, " +
    "MAX(raw->>'CASA') AS casa, MAX(raw->>'CELULAR') AS celular " +
    'FROM data_rows ' + fullWhere +
    ' GROUP BY rut, nombre, comuna, region, direccion ' +
    ' ORDER BY comuna, nombre ' +
    ' LIMIT $' + scope.nextParamIndex + ' OFFSET $' + (scope.nextParamIndex + 1);

  var result = await db.query(sql, params2);
  res.json({ total: total, page: page, pageSize: pageSize, rows: result.rows });
});

/**
 * Registra una acción de gestión (realizado o pendiente, con motivo/detalle/fecha agendada).
 * Verifica que el rut+dirección efectivamente exista dentro del alcance del usuario.
 */
router.post('/', async function (req, res) {
  var b = req.body;
  if (!b.rut || !b.direccion || !b.estado) {
    return res.json({ ok: false, error: 'Faltan datos obligatorios.' });
  }
  if (['REALIZADO', 'PENDIENTE'].indexOf(b.estado) === -1) {
    return res.json({ ok: false, error: 'Estado inválido.' });
  }
  if (b.estado === 'PENDIENTE' && !b.motivoId) {
    return res.json({ ok: false, error: 'Selecciona un motivo.' });
  }

  var scope = buildUserScope_(req.user);
  var checkWhere = scope.where ? scope.where + ' AND rut = $' + scope.nextParamIndex + ' AND direccion = $' + (scope.nextParamIndex + 1)
                                : 'WHERE rut = $' + scope.nextParamIndex + ' AND direccion = $' + (scope.nextParamIndex + 1);
  var checkParams = scope.params.concat([b.rut, b.direccion]);
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
      (rut, nombre, comuna, region, direccion, tipos_json, cantidad_equipos, casa, celular,
       tecnico_id, tecnico_username, estado, motivo_id, detalle, fecha_agendada)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      b.rut, info.nombre, info.comuna, info.region, b.direccion,
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
      SELECT DISTINCT ON (rut, direccion) *
      FROM gestiones
      WHERE tecnico_id = $1
      ORDER BY rut, direccion, created_at DESC
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
      SELECT DISTINCT ON (rut, direccion) *
      FROM gestiones
      WHERE tecnico_id = $1
      ORDER BY rut, direccion, created_at DESC
    )
    SELECT * FROM ultimos WHERE estado = 'REALIZADO'
    ORDER BY created_at DESC
  `;
  var result = await db.query(sql, [req.user.id]);
  res.json(result.rows);
});

/**
 * Exporta a Excel los retiros REALIZADOS del técnico logueado.
 */
router.get('/gestionados/export', async function (req, res) {
  var sql = `
    WITH ultimos AS (
      SELECT DISTINCT ON (rut, direccion) *
      FROM gestiones
      WHERE tecnico_id = $1
      ORDER BY rut, direccion, created_at DESC
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
  sheet.addRow(['RUT', 'NOMBRE', 'REGION', 'COMUNA', 'DIRECCION', 'TIPOS', 'CANTIDAD_EQUIPOS', 'CASA', 'CELULAR', 'FECHA_GESTION']).commit();
  result.rows.forEach(function (r) {
    sheet.addRow([
      r.rut, r.nombre, r.region, r.comuna, r.direccion,
      (r.tipos_json || []).join(', '), r.cantidad_equipos, r.casa, r.celular,
      new Date(r.created_at).toLocaleString('es-CL')
    ]).commit();
  });
  sheet.commit();
  await workbook.commit();
});

module.exports = router;
