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
 * Sube y procesa un archivo para una base específica ('GX1' o 'GX2').
 * Accesible para ADMIN y UPLOADER.
 */
router.post('/', upload.single('file'), async function (req, res) {
  if (!req.file) return res.json({ ok: false, error: 'No se recibió ningún archivo.' });
  var base = req.body.base === 'GX1' ? 'GX1' : 'GX2';
  if (processFile.isProcessing()) return res.json({ ok: false, error: 'Ya hay un procesamiento en curso.' });

  res.json({ ok: true }); // responder de inmediato, procesar en segundo plano

  processFile.processUploadedFile(req.file.path, req.file.originalname, base).catch(function (err) {
    console.error('Error procesando archivo (' + base + '):', err);
  });
});

router.get('/status', function (req, res) {
  res.json(processFile.getStatus());
});

/**
 * Fechas de las últimas subidas (para el panel simplificado del rol UPLOADER,
 * que solo debe ver esto, no estadísticas completas).
 */
router.get('/history', async function (req, res) {
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
