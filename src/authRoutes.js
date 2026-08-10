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

module.exports = router;

