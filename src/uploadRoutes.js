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

module.exports = router;
