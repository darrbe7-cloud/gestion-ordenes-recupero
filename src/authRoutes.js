const express = require('express');
const auth = require('./auth');

const router = express.Router();

router.post('/login', async function (req, res) {
  var result = await auth.login(req.body.username, req.body.password);
  if (!result.ok) return res.json(result);

  // El token solo necesita identificar quién es (id/usuario/rol) — las comunas y
  // tipos asignados siempre se leen frescos desde la base de datos en cada
  // solicitud (ver auth.js), así que NO se guardan aquí. Esto evita que una
  // sesión falle por exceso de tamaño cuando un usuario tiene muchas comunas
  // o tipos asignados.
  auth.setSessionCookie(res, {
    id: result.user.id,
    username: result.user.username,
    rol: result.user.rol
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
 * Recuperación de la cuenta admin, para cuando nadie puede iniciar sesión.
 * Requiere conocer ADMIN_RECOVERY_CODE, una variable de entorno que SOLO tú
 * configuras en Render (Environment) — no está en el código ni en GitHub.
 * Restablece la clave del primer usuario ADMIN que exista.
 */
router.post('/recover-admin', async function (req, res) {
  var codigo = process.env.ADMIN_RECOVERY_CODE;
  if (!codigo) {
    return res.json({ ok: false, error: 'La recuperación no está configurada. Pide a soporte técnico que configure ADMIN_RECOVERY_CODE en Render.' });
  }
  if (req.body.recoveryCode !== codigo) {
    return res.json({ ok: false, error: 'Código de recuperación incorrecto.' });
  }
  var newPassword = req.body.newPassword;
  if (!newPassword || newPassword.length < 6) {
    return res.json({ ok: false, error: 'La nueva contraseña debe tener al menos 6 caracteres.' });
  }

  var db = require('./db');
  var bcrypt = require('bcryptjs');
  var result = await db.query("SELECT id, username FROM users WHERE rol = 'ADMIN' ORDER BY created_at ASC LIMIT 1");
  if (!result.rows.length) {
    return res.json({ ok: false, error: 'No existe ningún usuario ADMIN en el sistema.' });
  }
  var hash = bcrypt.hashSync(newPassword, 10);
  await db.query('UPDATE users SET password_hash = $1, activo = true WHERE id = $2', [hash, result.rows[0].id]);

  res.json({ ok: true, username: result.rows[0].username });
});

module.exports = router;
