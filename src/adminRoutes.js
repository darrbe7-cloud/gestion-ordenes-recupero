const express = require('express');
const multer = require('multer');
const path = require('path');
const os = require('os');
const bcrypt = require('bcryptjs');
const db = require('./db');
const auth = require('./auth');
const processFile = require('./processFile');

const router = express.Router();
router.use(auth.requireAdmin);

const upload = multer({
  dest: path.join(os.tmpdir(), 'uploads-tmp'),
  limits: { fileSize: 150 * 1024 * 1024 } // 150 MB
});

// ---------------------------------------------------------
// USUARIOS
// ---------------------------------------------------------
router.get('/users', async function (req, res) {
  var result = await db.query('SELECT id, username, rol, comunas, tipos, activo, created_at FROM users ORDER BY username');
  res.json(result.rows);
});

router.post('/users', async function (req, res) {
  var b = req.body;
  if (!b.username || !b.password) return res.json({ ok: false, error: 'Usuario y contraseña son obligatorios.' });
  if (b.password.length < 6) return res.json({ ok: false, error: 'La contraseña debe tener al menos 6 caracteres.' });

  try {
    var hash = bcrypt.hashSync(b.password, 10);
    var result = await db.query(
      `INSERT INTO users (username, password_hash, rol, comunas, tipos, activo)
       VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
      [b.username.trim(), hash, b.rol === 'ADMIN' ? 'ADMIN' : 'USER', JSON.stringify(b.comunas || []), JSON.stringify(b.tipos || [])]
    );
    res.json({ ok: true, id: result.rows[0].id });
  } catch (e) {
    if (String(e.message).indexOf('duplicate key') !== -1) {
      return res.json({ ok: false, error: 'Ya existe un usuario con ese nombre.' });
    }
    res.json({ ok: false, error: e.message });
  }
});

router.put('/users/:id', async function (req, res) {
  var b = req.body;
  var fields = [];
  var values = [];
  var p = 1;

  if (b.rol) { fields.push('rol = $' + p++); values.push(b.rol === 'ADMIN' ? 'ADMIN' : 'USER'); }
  if (b.comunas !== undefined) { fields.push('comunas = $' + p++); values.push(JSON.stringify(b.comunas || [])); }
  if (b.tipos !== undefined) { fields.push('tipos = $' + p++); values.push(JSON.stringify(b.tipos || [])); }
  if (b.activo !== undefined) { fields.push('activo = $' + p++); values.push(b.activo === true); }
  if (b.password) {
    if (b.password.length < 6) return res.json({ ok: false, error: 'La contraseña debe tener al menos 6 caracteres.' });
    fields.push('password_hash = $' + p++);
    values.push(bcrypt.hashSync(b.password, 10));
  }

  if (!fields.length) return res.json({ ok: true });

  values.push(req.params.id);
  var sql = 'UPDATE users SET ' + fields.join(', ') + ' WHERE id = $' + p;
  var result = await db.query(sql, values);
  if (result.rowCount === 0) return res.json({ ok: false, error: 'Usuario no encontrado.' });
  res.json({ ok: true });
});

router.delete('/users/:id', async function (req, res) {
  var result = await db.query('DELETE FROM users WHERE id = $1', [req.params.id]);
  if (result.rowCount === 0) return res.json({ ok: false, error: 'Usuario no encontrado.' });
  res.json({ ok: true });
});

/**
 * Respaldo de usuarios en JSON (para restaurar rápido si la base gratuita expira).
 * OJO: incluye el hash de la contraseña (no la clave en texto plano), sirve para restaurar tal cual.
 */
router.get('/users/backup/download', async function (req, res) {
  var result = await db.query('SELECT username, password_hash, rol, comunas, tipos, activo FROM users');
  res.setHeader('Content-Disposition', 'attachment; filename="respaldo_usuarios.json"');
  res.json(result.rows);
});

router.post('/users/backup/restore', async function (req, res) {
  var users = req.body.users;
  if (!Array.isArray(users)) return res.json({ ok: false, error: 'Formato de respaldo inválido.' });
  var count = 0;
  for (var i = 0; i < users.length; i++) {
    var u = users[i];
    await db.query(
      `INSERT INTO users (username, password_hash, rol, comunas, tipos, activo)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (username) DO UPDATE SET
         password_hash = EXCLUDED.password_hash, rol = EXCLUDED.rol,
         comunas = EXCLUDED.comunas, tipos = EXCLUDED.tipos, activo = EXCLUDED.activo`,
      [u.username, u.password_hash, u.rol, JSON.stringify(u.comunas || []), JSON.stringify(u.tipos || []), u.activo !== false]
    );
    count++;
  }
  res.json({ ok: true, restored: count });
});

// ---------------------------------------------------------
// META / ESTADO DE LA BASE
// ---------------------------------------------------------
router.get('/meta', async function (req, res) {
  var comunas = await db.getMeta('COMUNAS_JSON');
  var tipos = await db.getMeta('TIPOS_JSON');
  var regionByComuna = await db.getMeta('REGION_BY_COMUNA_JSON');
  var regiones = await db.getMeta('REGIONES_JSON');
  res.json({
    comunas: comunas ? JSON.parse(comunas) : [],
    tipos: tipos ? JSON.parse(tipos) : [],
    regionByComuna: regionByComuna ? JSON.parse(regionByComuna) : {},
    regiones: regiones ? JSON.parse(regiones) : [],
    lastUploadDate: await db.getMeta('LAST_UPLOAD_DATE') || '',
    lastUploadFilename: await db.getMeta('LAST_UPLOAD_FILENAME') || '',
    totalRowsRaw: await db.getMeta('TOTAL_ROWS_RAW') || '0',
    totalRowsFiltered: await db.getMeta('TOTAL_ROWS_FILTERED') || '0'
  });
});

// ---------------------------------------------------------
// SUBIR / PROCESAR ARCHIVO
// ---------------------------------------------------------
router.post('/upload', upload.single('file'), async function (req, res) {
  if (!req.file) return res.json({ ok: false, error: 'No se recibió ningún archivo.' });
  if (processFile.isProcessing()) return res.json({ ok: false, error: 'Ya hay un procesamiento en curso.' });

  res.json({ ok: true }); // responder de inmediato, procesar en segundo plano

  processFile.processUploadedFile(req.file.path, req.file.originalname).catch(function (err) {
    console.error('Error procesando archivo:', err);
  });
});

router.get('/process-status', function (req, res) {
  res.json(processFile.getStatus());
});

// ---------------------------------------------------------
// MOTIVOS DE PENDIENTE (predefinidos por el admin)
// ---------------------------------------------------------
router.get('/motivos', async function (req, res) {
  var result = await db.query('SELECT id, texto, activo FROM motivos_pendiente ORDER BY texto');
  res.json(result.rows);
});

router.post('/motivos', async function (req, res) {
  var texto = (req.body.texto || '').trim();
  if (!texto) return res.json({ ok: false, error: 'Escribe el texto del motivo.' });
  var result = await db.query('INSERT INTO motivos_pendiente (texto) VALUES ($1) RETURNING id', [texto]);
  res.json({ ok: true, id: result.rows[0].id });
});

router.put('/motivos/:id', async function (req, res) {
  var fields = [];
  var values = [];
  var p = 1;
  if (req.body.texto !== undefined) { fields.push('texto = $' + p++); values.push(req.body.texto.trim()); }
  if (req.body.activo !== undefined) { fields.push('activo = $' + p++); values.push(req.body.activo === true); }
  if (!fields.length) return res.json({ ok: true });
  values.push(req.params.id);
  await db.query('UPDATE motivos_pendiente SET ' + fields.join(', ') + ' WHERE id = $' + p, values);
  res.json({ ok: true });
});

router.delete('/motivos/:id', async function (req, res) {
  await db.query('DELETE FROM motivos_pendiente WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ---------------------------------------------------------
// VISTA GLOBAL DE GESTIÓN (todos los técnicos)
// ---------------------------------------------------------
router.get('/gestiones', async function (req, res) {
  var page = parseInt(req.query.page || '0', 10);
  var pageSize = Math.min(parseInt(req.query.pageSize || '100', 10), 500);
  var estado = req.query.estado || ''; // '', 'PENDIENTE', 'REALIZADO'
  var tecnico = req.query.tecnico || '';

  var conditions = [];
  var params = [];
  var p = 1;
  if (estado) { conditions.push('estado = $' + p++); params.push(estado); }
  if (tecnico) { conditions.push('tecnico_username = $' + p++); params.push(tecnico); }
  var where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  var sqlBase = `
    WITH ultimos AS (
      SELECT DISTINCT ON (rut, direccion, tecnico_id) g.*, m.texto AS motivo_texto
      FROM gestiones g
      LEFT JOIN motivos_pendiente m ON m.id = g.motivo_id
      ORDER BY rut, direccion, tecnico_id, created_at DESC
    )
    SELECT * FROM ultimos ${where}
  `;

  var countResult = await db.query('SELECT COUNT(*) FROM (' + sqlBase + ') x', params);
  var total = Number(countResult.rows[0].count);

  var params2 = params.slice();
  params2.push(pageSize, page * pageSize);
  var result = await db.query(sqlBase + ' ORDER BY created_at DESC LIMIT $' + p + ' OFFSET $' + (p + 1), params2);

  res.json({ total: total, page: page, pageSize: pageSize, rows: result.rows });
});

router.get('/gestiones/export', async function (req, res) {
  var estado = req.query.estado || '';
  var conditions = [];
  var params = [];
  var p = 1;
  if (estado) { conditions.push('estado = $' + p++); params.push(estado); }
  var where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  var sql = `
    WITH ultimos AS (
      SELECT DISTINCT ON (rut, direccion, tecnico_id) g.*, m.texto AS motivo_texto
      FROM gestiones g
      LEFT JOIN motivos_pendiente m ON m.id = g.motivo_id
      ORDER BY rut, direccion, tecnico_id, created_at DESC
    )
    SELECT * FROM ultimos ${where} ORDER BY created_at DESC
  `;
  var result = await db.query(sql, params);

  if (!result.rows.length) return res.status(404).json({ ok: false, error: 'No hay registros de gestión para exportar.' });

  var filename = 'gestion_completa_' + Date.now() + '.xlsx';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');

  var ExcelJS = require('exceljs');
  var workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res });
  var sheet = workbook.addWorksheet('Gestión');
  sheet.addRow(['TECNICO', 'RUT', 'NOMBRE', 'REGION', 'COMUNA', 'DIRECCION', 'TIPOS', 'CANTIDAD_EQUIPOS', 'ESTADO', 'MOTIVO', 'DETALLE', 'FECHA_AGENDADA', 'FECHA_GESTION']).commit();
  result.rows.forEach(function (r) {
    sheet.addRow([
      r.tecnico_username, r.rut, r.nombre, r.region, r.comuna, r.direccion,
      (r.tipos_json || []).join(', '), r.cantidad_equipos, r.estado, r.motivo_texto || '', r.detalle || '',
      r.fecha_agendada ? new Date(r.fecha_agendada).toLocaleDateString('es-CL') : '',
      new Date(r.created_at).toLocaleString('es-CL')
    ]).commit();
  });
  sheet.commit();
  await workbook.commit();
});

module.exports = router;
