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

module.exports = router;
