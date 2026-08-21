const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('./db');
const auth = require('./auth');

const router = express.Router();
router.use(auth.requireAdmin);

function normalizeRol_(r) {
  if (['ADMIN', 'UPLOADER', 'VENTA_GX1', 'VENTA_GX2'].indexOf(r) !== -1) return r;
  return 'USER';
}

// ---------------------------------------------------------
// USUARIOS
// ---------------------------------------------------------
router.get('/users', async function (req, res) {
  var result = await db.query('SELECT id, username, rol, comunas, distribuidores, activo, created_at, fecha_desde, fecha_hasta FROM users ORDER BY username');
  res.json(result.rows);
});

router.post('/users', async function (req, res) {
  var b = req.body;
  if (!b.username || !b.password) return res.json({ ok: false, error: 'Usuario y contraseña son obligatorios.' });
  if (b.password.length < 6) return res.json({ ok: false, error: 'La contraseña debe tener al menos 6 caracteres.' });

  try {
    var hash = bcrypt.hashSync(b.password, 10);
    var result = await db.query(
      `INSERT INTO users (username, password_hash, rol, comunas, tipos, distribuidores, activo, fecha_desde, fecha_hasta)
       VALUES ($1, $2, $3, $4, '[]', $5, true, $6, $7) RETURNING id`,
      [b.username.trim(), hash, normalizeRol_(b.rol), JSON.stringify(b.comunas || []), JSON.stringify(b.distribuidores || []), b.fechaDesde || null, b.fechaHasta || null]
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

  if (b.rol) { fields.push('rol = $' + p++); values.push(normalizeRol_(b.rol)); }
  if (b.comunas !== undefined) { fields.push('comunas = $' + p++); values.push(JSON.stringify(b.comunas || [])); }
  if (b.distribuidores !== undefined) { fields.push('distribuidores = $' + p++); values.push(JSON.stringify(b.distribuidores || [])); }
  if (b.activo !== undefined) { fields.push('activo = $' + p++); values.push(b.activo === true); }
  if (b.fechaDesde !== undefined) { fields.push('fecha_desde = $' + p++); values.push(b.fechaDesde || null); }
  if (b.fechaHasta !== undefined) { fields.push('fecha_hasta = $' + p++); values.push(b.fechaHasta || null); }
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
  var result = await db.query('SELECT username, password_hash, rol, comunas, distribuidores, activo, fecha_desde, fecha_hasta FROM users');
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
      `INSERT INTO users (username, password_hash, rol, comunas, tipos, distribuidores, activo, fecha_desde, fecha_hasta)
       VALUES ($1, $2, $3, $4, '[]', $5, $6, $7, $8)
       ON CONFLICT (username) DO UPDATE SET
         password_hash = EXCLUDED.password_hash, rol = EXCLUDED.rol,
         comunas = EXCLUDED.comunas, distribuidores = EXCLUDED.distribuidores, activo = EXCLUDED.activo,
         fecha_desde = EXCLUDED.fecha_desde, fecha_hasta = EXCLUDED.fecha_hasta`,
      [u.username, u.password_hash, normalizeRol_(u.rol), JSON.stringify(u.comunas || []), JSON.stringify(u.distribuidores || []), u.activo !== false,
       u.fecha_desde || null, u.fecha_hasta || null]
    );
    count++;
  }
  res.json({ ok: true, restored: count });
});

// ---------------------------------------------------------
// META / ESTADO DE LA BASE (por sistema GX1 / GX2 + territorio global)
// ---------------------------------------------------------
router.get('/meta', async function (req, res) {
  var comunas = await db.getMeta('COMUNAS_JSON');
  var regionByComuna = await db.getMeta('REGION_BY_COMUNA_JSON');
  var regiones = await db.getMeta('REGIONES_JSON');

  async function statsPorBase(base) {
    var tipos = await db.getMeta('TIPOS_JSON_' + base);
    return {
      tipos: tipos ? JSON.parse(tipos) : [],
      lastUploadDate: await db.getMeta('LAST_UPLOAD_DATE_' + base) || '',
      lastUploadFilename: await db.getMeta('LAST_UPLOAD_FILENAME_' + base) || '',
      totalRowsRaw: await db.getMeta('TOTAL_ROWS_RAW_' + base) || '0',
      totalRowsFiltered: await db.getMeta('TOTAL_ROWS_FILTERED_' + base) || '0'
    };
  }

  async function bodegaStats(base) {
    return {
      lastUploadDate: await db.getMeta('LAST_UPLOAD_DATE_BODEGA_' + base) || '',
      lastUploadFilename: await db.getMeta('LAST_UPLOAD_FILENAME_BODEGA_' + base) || '',
      totalRows: await db.getMeta('TOTAL_ROWS_BODEGA_' + base) || '0'
    };
  }

  res.json({
    comunas: comunas ? JSON.parse(comunas) : [],
    regionByComuna: regionByComuna ? JSON.parse(regionByComuna) : {},
    regiones: regiones ? JSON.parse(regiones) : [],
    gx1: await statsPorBase('GX1'),
    gx2: await statsPorBase('GX2'),
    bodegaGx1: await bodegaStats('GX1'),
    bodegaGx2: await bodegaStats('GX2')
  });
});

/**
 * Lista de distribuidores distintos por base (para armar la asignación al
 * crear/editar usuarios de venta).
 */
router.get('/distribuidores', async function (req, res) {
  var gx1 = await db.query("SELECT DISTINCT distribuidor FROM data_rows WHERE base = 'GX1' AND distribuidor IS NOT NULL AND distribuidor <> '' ORDER BY distribuidor");
  var gx2 = await db.query("SELECT DISTINCT distribuidor FROM data_rows WHERE base = 'GX2' AND distribuidor IS NOT NULL AND distribuidor <> '' ORDER BY distribuidor");
  res.json({
    gx1: gx1.rows.map(function (r) { return r.distribuidor; }),
    gx2: gx2.rows.map(function (r) { return r.distribuidor; })
  });
});

// ---------------------------------------------------------
// CONFIGURACIÓN: días mínimos de antigüedad para GX1
// ---------------------------------------------------------
router.get('/config/gx1-dias-minimos', async function (req, res) {
  var valor = await db.getMeta('GX1_DIAS_MINIMOS');
  res.json({ dias: valor ? Number(valor) : 90 });
});

router.put('/config/gx1-dias-minimos', async function (req, res) {
  var dias = Number(req.body.dias);
  if (isNaN(dias) || dias < 0) return res.json({ ok: false, error: 'Ingresa un número de días válido.' });
  await db.setMeta('GX1_DIAS_MINIMOS', String(Math.round(dias)));
  res.json({ ok: true });
});

// ---------------------------------------------------------
// TIPOS/MODELOS PERMITIDOS PARA RETIRO (global por base GX1/GX2)
// ---------------------------------------------------------
router.get('/tipos-permitidos', async function (req, res) {
  var gx1 = await db.getMeta('TIPOS_PERMITIDOS_GX1_JSON');
  var gx2 = await db.getMeta('TIPOS_PERMITIDOS_GX2_JSON');
  res.json({
    gx1: gx1 ? JSON.parse(gx1) : [],
    gx2: gx2 ? JSON.parse(gx2) : []
  });
});

router.put('/tipos-permitidos/:base', async function (req, res) {
  var base = req.params.base === 'GX1' ? 'GX1' : 'GX2';
  var tipos = Array.isArray(req.body.tipos) ? req.body.tipos : [];
  await db.setMeta('TIPOS_PERMITIDOS_' + base + '_JSON', JSON.stringify(tipos));
  res.json({ ok: true });
});

// ---------------------------------------------------------
// BODEGA: depósitos visibles (global, para todos los usuarios de venta)
// ---------------------------------------------------------
router.get('/depositos', async function (req, res) {
  var todos = await db.getMeta('DEPOSITOS_JSON');
  var visibles = await db.getMeta('DEPOSITOS_VISIBLES_JSON');
  res.json({
    todos: todos ? JSON.parse(todos) : [],
    visibles: visibles ? JSON.parse(visibles) : []
  });
});

router.put('/depositos-visibles', async function (req, res) {
  var depositos = Array.isArray(req.body.depositos) ? req.body.depositos : [];
  await db.setMeta('DEPOSITOS_VISIBLES_JSON', JSON.stringify(depositos));
  res.json({ ok: true });
});

/**
 * Vista de bodega para el admin: ve todo, sin restricción de depósito.
 */
router.get('/bodega', async function (req, res) {
  var page = parseInt(req.query.page || '0', 10);
  var pageSize = Math.min(parseInt(req.query.pageSize || '100', 10), 500);
  var search = req.query.search || '';
  var base = req.query.base === 'GX1' || req.query.base === 'GX2' ? req.query.base : '';
  var deposito = req.query.deposito || '';

  var conditions = ['stock > 0']; // los ítems sin stock no se muestran
  var params = [];
  var p = 1;
  if (base) { conditions.push('base = $' + p++); params.push(base); }
  if (deposito) { conditions.push('deposito = $' + p++); params.push(deposito); }
  if (search) {
    conditions.push('(articulo ILIKE $' + p + ' OR cod_articulo ILIKE $' + p + ' OR deposito ILIKE $' + p + ')');
    params.push('%' + search + '%');
    p++;
  }
  var where = 'WHERE ' + conditions.join(' AND ');

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
  var deposito = req.query.deposito || '';
  var conditions = ['stock > 0']; // los ítems sin stock no se muestran
  var params = [];
  var p = 1;
  if (base) { conditions.push('base = $' + p++); params.push(base); }
  if (deposito) { conditions.push('deposito = $' + p++); params.push(deposito); }
  if (search) {
    conditions.push('(articulo ILIKE $' + p + ' OR cod_articulo ILIKE $' + p + ' OR deposito ILIKE $' + p + ')');
    params.push('%' + search + '%');
    p++;
  }
  var where = 'WHERE ' + conditions.join(' AND ');

  var result = await db.query('SELECT base, cod_deposito, deposito, cod_articulo, articulo, stock FROM bodega_items ' + where + ' ORDER BY deposito, articulo', params);
  if (!result.rows.length) return res.status(404).json({ ok: false, error: 'No hay filas de bodega para exportar.' });

  var filename = 'bodega_admin_' + (base || 'todo') + '_' + Date.now() + '.xlsx';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');

  var ExcelJS2 = require('exceljs');
  var workbook = new ExcelJS2.stream.xlsx.WorkbookWriter({ stream: res });
  var sheet = workbook.addWorksheet('Bodega');
  sheet.addRow(['SISTEMA', 'COD_DEPOSITO', 'DEPOSITO', 'COD_ARTICULO', 'ARTICULO', 'STOCK']).commit();
  result.rows.forEach(function (r) {
    sheet.addRow([r.base, r.cod_deposito, r.deposito, r.cod_articulo, r.articulo, r.stock]).commit();
  });
  sheet.commit();
  await workbook.commit();
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
// VISTA GLOBAL DE GESTIÓN (todos los técnicos, ambas bases)
// ---------------------------------------------------------
router.get('/gestiones', async function (req, res) {
  var page = parseInt(req.query.page || '0', 10);
  var pageSize = Math.min(parseInt(req.query.pageSize || '100', 10), 500);
  var estado = req.query.estado || ''; // '', 'PENDIENTE', 'REALIZADO'
  var tecnico = req.query.tecnico || '';
  var base = req.query.base || ''; // '', 'GX1', 'GX2'

  var conditions = [];
  var params = [];
  var p = 1;
  if (estado) { conditions.push('estado = $' + p++); params.push(estado); }
  if (tecnico) { conditions.push('tecnico_username = $' + p++); params.push(tecnico); }
  if (base) { conditions.push('base = $' + p++); params.push(base); }
  var where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  var sqlBase = `
    WITH ultimos AS (
      SELECT DISTINCT ON (rut, direccion, tecnico_id, base) g.*, m.texto AS motivo_texto
      FROM gestiones g
      LEFT JOIN motivos_pendiente m ON m.id = g.motivo_id
      ORDER BY rut, direccion, tecnico_id, base, created_at DESC
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
  var base = req.query.base || '';
  var conditions = [];
  var params = [];
  var p = 1;
  if (estado) { conditions.push('estado = $' + p++); params.push(estado); }
  if (base) { conditions.push('base = $' + p++); params.push(base); }
  var where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  var sql = `
    WITH ultimos AS (
      SELECT DISTINCT ON (rut, direccion, tecnico_id, base) g.*, m.texto AS motivo_texto
      FROM gestiones g
      LEFT JOIN motivos_pendiente m ON m.id = g.motivo_id
      ORDER BY rut, direccion, tecnico_id, base, created_at DESC
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
  sheet.addRow(['SISTEMA', 'TECNICO', 'RUT', 'NOMBRE', 'REGION', 'COMUNA', 'DIRECCION', 'TIPOS', 'CANTIDAD_EQUIPOS', 'ESTADO', 'MOTIVO', 'DETALLE', 'FECHA_AGENDADA', 'FECHA_GESTION']).commit();
  result.rows.forEach(function (r) {
    sheet.addRow([
      r.base, r.tecnico_username, r.rut, r.nombre, r.region, r.comuna, r.direccion,
      (r.tipos_json || []).join(', '), r.cantidad_equipos, r.estado, r.motivo_texto || '', r.detalle || '',
      r.fecha_agendada ? new Date(r.fecha_agendada).toLocaleDateString('es-CL') : '',
      new Date(r.created_at).toLocaleString('es-CL')
    ]).commit();
  });
  sheet.commit();
  await workbook.commit();
});

module.exports = router;
