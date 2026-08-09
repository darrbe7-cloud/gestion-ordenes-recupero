const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false }
});

async function query(text, params) {
  return pool.query(text, params);
}

/**
 * Crea las tablas si no existen, y un usuario admin inicial si no hay ninguno.
 * Se llama automáticamente al arrancar el servidor.
 */
async function initSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      rol TEXT NOT NULL DEFAULT 'USER',
      comunas JSONB NOT NULL DEFAULT '[]',
      tipos JSONB NOT NULL DEFAULT '[]',
      activo BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `).catch(async (e) => {
    // gen_random_uuid() requiere la extensión pgcrypto; si falla, la habilitamos y reintentamos
    if (String(e.message).indexOf('gen_random_uuid') !== -1) {
      await query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
      await query(`
        CREATE TABLE IF NOT EXISTS users (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          rol TEXT NOT NULL DEFAULT 'USER',
          comunas JSONB NOT NULL DEFAULT '[]',
          tipos JSONB NOT NULL DEFAULT '[]',
          activo BOOLEAN NOT NULL DEFAULT true,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);
    } else {
      throw e;
    }
  });

  await query(`
    CREATE TABLE IF NOT EXISTS data_rows (
      id BIGSERIAL PRIMARY KEY,
      rut TEXT,
      nombre TEXT,
      comuna TEXT,
      direccion TEXT,
      tipo TEXT,
      raw JSONB NOT NULL
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_data_rows_comuna ON data_rows (comuna);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_data_rows_tipo ON data_rows (tipo);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_data_rows_rut ON data_rows (rut);`);

  await query(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  var adminCount = await query("SELECT COUNT(*) FROM users WHERE rol = 'ADMIN'");
  if (Number(adminCount.rows[0].count) === 0) {
    var hash = bcrypt.hashSync('CambiarClave123!', 10);
    await query(
      `INSERT INTO users (username, password_hash, rol, comunas, tipos, activo)
       VALUES ('admin', $1, 'ADMIN', '[]', '[]', true)
       ON CONFLICT (username) DO NOTHING`,
      [hash]
    );
    console.log('----------------------------------------------------');
    console.log('Usuario administrador creado -> usuario: admin / clave: CambiarClave123!');
    console.log('Cambia esta clave apenas inicies sesión.');
    console.log('----------------------------------------------------');
  }
}

async function getMeta(key) {
  var res = await query('SELECT value FROM meta WHERE key = $1', [key]);
  return res.rows.length ? res.rows[0].value : null;
}

async function setMeta(key, value) {
  await query(
    `INSERT INTO meta (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, String(value)]
  );
}

async function setMetaMany(pairs) {
  for (var i = 0; i < pairs.length; i++) {
    await setMeta(pairs[i][0], pairs[i][1]);
  }
}

module.exports = { pool, query, initSchema, getMeta, setMeta, setMetaMany };
