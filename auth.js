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
 */
function requireAuth(req, res, next) {
  var token = req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ ok: false, error: 'SESSION_EXPIRED' });
  try {
    var payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: 'SESSION_EXPIRED' });
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
  login,
  changePassword,
  setSessionCookie,
  clearSessionCookie,
  COOKIE_NAME
};
