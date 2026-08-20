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

  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS fecha_desde DATE;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS fecha_hasta DATE;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS distribuidores JSONB NOT NULL DEFAULT '[]';`);

  await query(`
    CREATE TABLE IF NOT EXISTS data_rows (
      id BIGSERIAL PRIMARY KEY,
      base TEXT NOT NULL DEFAULT 'GX2',
      rut TEXT,
      nombre TEXT,
      comuna TEXT,
      region TEXT,
      direccion TEXT,
      tipo TEXT,
      distribuidor TEXT,
      fch_ingreso DATE,
      raw JSONB NOT NULL
    );
  `);
  await query(`ALTER TABLE data_rows ADD COLUMN IF NOT EXISTS region TEXT;`);
  await query(`ALTER TABLE data_rows ADD COLUMN IF NOT EXISTS fch_ingreso DATE;`);
  await query(`ALTER TABLE data_rows ADD COLUMN IF NOT EXISTS base TEXT NOT NULL DEFAULT 'GX2';`);
  await query(`ALTER TABLE data_rows ADD COLUMN IF NOT EXISTS distribuidor TEXT;`);
  await query(`CREATE INDEX IF NOT EXISTS idx_data_rows_comuna ON data_rows (comuna);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_data_rows_tipo ON data_rows (tipo);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_data_rows_rut ON data_rows (rut);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_data_rows_rut_direccion ON data_rows (rut, direccion);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_data_rows_fch_ingreso ON data_rows (fch_ingreso);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_data_rows_base ON data_rows (base);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_data_rows_distribuidor ON data_rows (distribuidor);`);

  await query(`
    CREATE TABLE IF NOT EXISTS bodega_items (
      id BIGSERIAL PRIMARY KEY,
      base TEXT NOT NULL,
      cod_deposito TEXT,
      deposito TEXT,
      cod_articulo TEXT,
      articulo TEXT,
      stock NUMERIC
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_bodega_base ON bodega_items (base);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_bodega_deposito ON bodega_items (deposito);`);

  await query(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS motivos_pendiente (
      id SERIAL PRIMARY KEY,
      texto TEXT NOT NULL,
      activo BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS gestiones (
      id BIGSERIAL PRIMARY KEY,
      base TEXT NOT NULL DEFAULT 'GX2',
      rut TEXT NOT NULL,
      nombre TEXT,
      comuna TEXT,
      region TEXT,
      direccion TEXT NOT NULL,
      tipos_json JSONB,
      cantidad_equipos INTEGER,
      casa TEXT,
      celular TEXT,
      tecnico_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tecnico_username TEXT,
      estado TEXT NOT NULL,
      motivo_id INTEGER REFERENCES motivos_pendiente(id),
      detalle TEXT,
      fecha_agendada DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`ALTER TABLE gestiones ADD COLUMN IF NOT EXISTS base TEXT NOT NULL DEFAULT 'GX2';`);
  await query(`CREATE INDEX IF NOT EXISTS idx_gestiones_rut_direccion ON gestiones (rut, direccion);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_gestiones_tecnico ON gestiones (tecnico_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_gestiones_created ON gestiones (created_at);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_gestiones_base ON gestiones (base);`);

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
