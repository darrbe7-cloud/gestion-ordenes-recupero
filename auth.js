const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-cambia-esto';
const TOKEN_TTL = '12h';
const COOKIE_NAME = 'session';

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

function setSessionCookie(res, payload) {
  var token = signToken(payload);
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 12 * 60 * 60 * 1000
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

/**
 * Middleware: exige sesión válida. Deja los datos del usuario en req.user.
 *
 * El JWT solo se usa para confirmar identidad (quién es); el rol, comunas,
 * tipos y estado "activo" SIEMPRE se leen frescos desde la base de datos en
 * cada solicitud. Así, si el administrador cambia los permisos de alguien
 * que ya tiene una sesión abierta, el cambio aplica de inmediato (no hay que
 * esperar a que expire la sesión vieja).
 */
async function requireAuth(req, res, next) {
  var token = req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ ok: false, error: 'SESSION_EXPIRED' });

  var payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (e) {
    // Token realmente inválido o expirado -> esto sí es sesión expirada de verdad.
    return res.status(401).json({ ok: false, error: 'SESSION_EXPIRED' });
  }

  try {
    var result = await db.query('SELECT id, username, rol, comunas, tipos, activo FROM users WHERE id = $1', [payload.id]);
    if (!result.rows.length || !result.rows[0].activo) {
      return res.status(401).json({ ok: false, error: 'SESSION_EXPIRED' });
    }
    req.user = result.rows[0];
    next();
  } catch (e) {
    // Error real de base de datos (ej. servidor recién despertando) -> NO es
    // sesión expirada, no debe forzar el logout. Se informa como error normal.
    return res.status(503).json({ ok: false, error: 'No se pudo conectar a la base de datos. Intenta de nuevo en unos segundos.' });
  }
}

/**
 * Middleware: exige sesión válida Y rol ADMIN.
 */
function requireAdmin(req, res, next) {
  requireAuth(req, res, function () {
    if (req.user.rol !== 'ADMIN') {
      return res.status(403).json({ ok: false, error: 'No tienes permisos de administrador.' });
    }
    next();
  });
}

/**
 * Middleware: exige sesión válida Y rol ADMIN o UPLOADER (para las rutas de
 * carga de archivos, compartidas entre ambos roles).
 */
function requireAdminOrUploader(req, res, next) {
  requireAuth(req, res, function () {
    if (req.user.rol !== 'ADMIN' && req.user.rol !== 'UPLOADER') {
      return res.status(403).json({ ok: false, error: 'No tienes permisos para esta acción.' });
    }
    next();
  });
}

async function login(username, password) {
  username = (username || '').trim();
  if (!username || !password) {
    return { ok: false, error: 'Ingresa usuario y contraseña.' };
  }
  var res = await db.query('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [username]);
  if (!res.rows.length) return { ok: false, error: 'Usuario o contraseña incorrectos.' };

  var user = res.rows[0];
  if (!user.activo) return { ok: false, error: 'Este usuario está deshabilitado. Contacta al administrador.' };

  var match = bcrypt.compareSync(password, user.password_hash);
  if (!match) return { ok: false, error: 'Usuario o contraseña incorrectos.' };

  return {
    ok: true,
    user: {
      id: user.id,
      username: user.username,
      rol: user.rol,
      comunas: user.comunas,
      tipos: user.tipos
    }
  };
}

async function changePassword(userId, newPassword) {
  if (!newPassword || newPassword.length < 6) {
    return { ok: false, error: 'La nueva contraseña debe tener al menos 6 caracteres.' };
  }
  var hash = bcrypt.hashSync(newPassword, 10);
  await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, userId]);
  return { ok: true };
}

module.exports = {
  requireAuth,
  requireAdmin,
  requireAdminOrUploader,
  login,
  changePassword,
  setSessionCookie,
  clearSessionCookie,
  COOKIE_NAME
};
