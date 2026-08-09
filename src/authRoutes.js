const express = require('express');
const auth = require('./auth');

const router = express.Router();

router.post('/login', async function (req, res) {
  var result = await auth.login(req.body.username, req.body.password);
  if (!result.ok) return res.json(result);

  auth.setSessionCookie(res, {
    id: result.user.id,
    username: result.user.username,
    rol: result.user.rol,
    comunas: result.user.comunas,
    tipos: result.user.tipos
  });

  res.json({ ok: true, rol: result.user.rol, username: result.user.username });
});

router.post('/logout', function (req, res) {
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', auth.requireAuth, function (req, res) {
  res.json({ ok: true, username: req.user.username, rol: req.user.rol });
});

router.post('/change-password', auth.requireAuth, async function (req, res) {
  var result = await auth.changePassword(req.user.id, req.body.newPassword);
  res.json(result);
});

/**
 * ===== TEMPORAL: recuperación de emergencia del usuario admin =====
 * Visitar esta URL una sola vez en el navegador borra cualquier usuario ADMIN
 * existente y crea uno nuevo limpio: admin / CambiarClave123!
 * IMPORTANTE: quitar esta ruta (y volver a desplegar) apenas se use, porque
 * cualquiera que conozca la URL podría usarla para tomar control del sistema.
 */
router.get('/emergency-reset-admin-x7f9', async function (req, res) {
  var bcrypt = require('bcryptjs');
  var db = require('./db');
  try {
    await db.query("DELETE FROM users WHERE rol = 'ADMIN'");
    var hash = bcrypt.hashSync('CambiarClave123!', 10);
    await db.query(
      `INSERT INTO users (username, password_hash, rol, comunas, tipos, activo)
       VALUES ('admin', $1, 'ADMIN', '[]', '[]', true)`,
      [hash]
    );
    res.send('Listo. Usuario admin restablecido -> usuario: admin / clave: CambiarClave123! IMPORTANTE: pide que se elimine esta ruta ahora.');
  } catch (e) {
    res.status(500).send('Error: ' + e.message);
  }
});

module.exports = router;

