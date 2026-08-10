require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');

const db = require('./src/db');
const authRoutes = require('./src/authRoutes');
const adminRoutes = require('./src/adminRoutes');
const dataRoutes = require('./src/dataRoutes');
const gestionRoutes = require('./src/gestionRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', dataRoutes);
app.use('/api/gestiones', gestionRoutes);

app.get('/health', function (req, res) { res.json({ ok: true }); });

// Manejo de errores centralizado (incluye errores de multer, límite de tamaño, etc.)
app.use(function (err, req, res, next) {
  console.error(err);
  res.status(500).json({ ok: false, error: err.message || 'Error interno del servidor.' });
});

async function start() {
  try {
    await db.initSchema();
    console.log('Base de datos lista.');
  } catch (e) {
    console.error('Error inicializando la base de datos:', e);
    process.exit(1);
  }

  app.listen(PORT, function () {
    console.log('Servidor escuchando en el puerto ' + PORT);
  });
}

start();
