const express = require('express');
const multer = require('multer');
const path = require('path');
const os = require('os');
const db = require('./db');
const auth = require('./auth');
const processFile = require('./processFile');

const router = express.Router();
router.use(auth.requireAdminOrUploader);

const upload = multer({
  dest: path.join(os.tmpdir(), 'uploads-tmp'),
  limits: { fileSize: 150 * 1024 * 1024 } // 150 MB
});

/**
 * Sube y procesa un archivo. body.tipo: 'ORDENES' | 'BODEGA'. body.base: 'GX1' | 'GX2'.
 * Accesible para ADMIN y UPLOADER.
 */
router.post('/', upload.single('file'), async function (req, res) {
  if (!req.file) return res.json({ ok: false, error: 'No se recibió ningún archivo.' });
  var base = req.body.base === 'GX1' ? 'GX1' : 'GX2';
  var tipo = req.body.tipo === 'BODEGA' ? 'BODEGA' : 'ORDENES';
  if (processFile.isProcessing()) return res.json({ ok: false, error: 'Ya hay un procesamiento en curso.' });

  res.json({ ok: true }); // responder de inmediato, procesar en segundo plano

  var promesa = tipo === 'BODEGA'
    ? processFile.processBodegaFile(req.file.path, req.file.originalname, base)
    : processFile.processUploadedFile(req.file.path, req.file.originalname, base);

  promesa.catch(function (err) {
    console.error('Error procesando archivo (' + tipo + ' ' + base + '):', err);
  });
});

router.get('/status', function (req, res) {
  res.json(processFile.getStatus());
});

/**
 * Fechas de las últimas subidas (para el panel simplificado del rol UPLOADER,
 * que solo debe ver esto, no estadísticas completas). Incluye órdenes y bodega.
 */
router.get('/history', async function (req, res) {
  async function info(key) {
    return {
      fecha: await db.getMeta('LAST_UPLOAD_DATE_' + key) || '',
      archivo: await db.getMeta('LAST_UPLOAD_FILENAME_' + key) || ''
    };
  }
  res.json({
    gx1: await info('GX1'),
    gx2: await info('GX2'),
    bodegaGx1: await info('BODEGA_GX1'),
    bodegaGx2: await info('BODEGA_GX2')
  });
});

/**
 * Vista de bodega para UPLOADER: se restringe a los mismos depósitos visibles
 * que el equipo de venta (el que sube el archivo solo verifica lo que
 * corresponde mostrar, no la bodega completa). El admin usa su propia ruta
 * en /api/admin/bodega, que sí ve todo sin restricción.
 */
router.get('/bodega', async function (req, res) {
  if (req.user.rol !== 'UPLOADER') {
    return res.status(403).json({ ok: false, error: 'Usa /api/admin/bodega si eres administrador.' });
  }
  var page = parseInt(req.query.page || '0', 10);
  var pageSize = Math.min(parseInt(req.query.pageSize || '100', 10), 500);
  var search = req.query.search || '';
  var base = req.query.base === 'GX1' || req.query.base === 'GX2' ? req.query.base : '';
  var deposito = req.query.deposito || '';

  var conditions = ['stock > 0'];
  var params = [];
  var p = 1;

  var visiblesJson = await db.getMeta('DEPOSITOS_VISIBLES_JSON');
  var visibles = visiblesJson ? JSON.parse(visiblesJson) : [];
  if (visibles.length) { conditions.push('deposito = ANY($' + p++ + ')'); params.push(visibles); }

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

router.get('/depositos', async function (req, res) {
  var visiblesJson = await db.getMeta('DEPOSITOS_VISIBLES_JSON');
  var visibles = visiblesJson ? JSON.parse(visiblesJson) : [];
  if (visibles.length) {
    return res.json({ todos: visibles });
  }
  var result = await db.query("SELECT DISTINCT deposito FROM bodega_items WHERE stock > 0 AND deposito IS NOT NULL AND deposito <> '' ORDER BY deposito");
  res.json({ todos: result.rows.map(function (r) { return r.deposito; }) });
});

module.exports = router;
