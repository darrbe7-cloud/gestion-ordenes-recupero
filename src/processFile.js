const ExcelJS = require('exceljs');
const fs = require('fs');
const db = require('./db');

var FILTRO_STATUS_ORDEN = 'P';
var FILTRO_ORIGEN = ['MOROSIDAD', 'SERVICIO DE BAJA'];
var FILTRO_STATUS_AB = 'X';
var BATCH_SIZE = 1000; // filas por lote al insertar en la base de datos

// Estado del procesamiento en curso, en memoria (un solo proceso a la vez)
var STATE = {
  estado: 'INACTIVO', // INACTIVO | EN_PROGRESO | COMPLETADO | ERROR
  archivo: '',
  filasLeidas: 0,
  filasCargadas: 0,
  totalEstimado: 0,
  error: ''
};

function getStatus() {
  return Object.assign({}, STATE);
}

function isProcessing() {
  return STATE.estado === 'EN_PROGRESO';
}

/**
 * Procesa el archivo subido: lo lee en modo streaming (fila por fila, sin cargar
 * todo en memoria), aplica el filtro global, y reemplaza por completo data_rows.
 * No bloquea el resto del servidor porque usa async/await + streaming.
 */
async function processUploadedFile(filePath, originalName) {
  if (STATE.estado === 'EN_PROGRESO') {
    throw new Error('Ya hay un procesamiento en curso.');
  }

  STATE = { estado: 'EN_PROGRESO', archivo: originalName, filasLeidas: 0, filasCargadas: 0, totalEstimado: 0, error: '' };

  // Vaciar la tabla de datos de inmediato (se reemplaza por completo)
  await db.query('TRUNCATE TABLE data_rows');

  var comunasSet = {};
  var tiposSet = {};
  var headers = null;
  var idx = {};
  var batch = [];
  var client = await db.pool.connect();

  try {
    var workbookReader = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {
      entries: 'emit',
      sharedStrings: 'cache',
      styles: 'ignore',
      worksheets: 'emit'
    });

    for await (const worksheetReader of workbookReader) {
      for await (const row of worksheetReader) {
        var values = row.values; // 1-indexado, values[0] es undefined
        var arr = [];
        for (var c = 1; c < values.length; c++) arr.push(normalizeCell_(values[c]));

        if (!headers) {
          headers = arr.map(function (h) { return String(h || '').trim(); });
          idx = {};
          headers.forEach(function (h, i) { idx[h] = i; });

          ['STATUS_ORDEN', 'ORIGEN', 'STATUS_AB', 'COMUNA', 'TIPO', 'RUT', 'NOMBRE', 'DIRECCION'].forEach(function (col) {
            if (idx[col] === undefined) throw new Error('El archivo no tiene la columna requerida: ' + col);
          });

          await db.setMeta('HEADERS_JSON', JSON.stringify(headers));
          continue;
        }

        STATE.filasLeidas++;

        var statusOrden = arr[idx['STATUS_ORDEN']];
        var origen = arr[idx['ORIGEN']];
        var statusAb = arr[idx['STATUS_AB']];

        if (statusOrden === FILTRO_STATUS_ORDEN &&
            FILTRO_ORIGEN.indexOf(origen) !== -1 &&
            statusAb === FILTRO_STATUS_AB) {

          var rut = arr[idx['RUT']];
          var nombre = arr[idx['NOMBRE']];
          var comuna = arr[idx['COMUNA']];
          var direccion = arr[idx['DIRECCION']];
          var tipo = arr[idx['TIPO']];

          var rawObj = {};
          headers.forEach(function (h, i) { rawObj[h] = arr[i] !== undefined ? arr[i] : null; });

          batch.push([rut, nombre, comuna, direccion, tipo, JSON.stringify(rawObj)]);
          if (comuna) comunasSet[comuna] = true;
          if (tipo) tiposSet[tipo] = true;
          STATE.filasCargadas++;
        }

        if (batch.length >= BATCH_SIZE) {
          await insertBatch_(client, batch);
          batch = [];
        }
      }
    }

    if (batch.length > 0) {
      await insertBatch_(client, batch);
      batch = [];
    }

    var comunasList = Object.keys(comunasSet).sort();
    var tiposList = Object.keys(tiposSet).sort();

    await db.setMetaMany([
      ['LAST_UPLOAD_DATE', new Date().toISOString()],
      ['LAST_UPLOAD_FILENAME', originalName],
      ['TOTAL_ROWS_RAW', String(STATE.filasLeidas)],
      ['TOTAL_ROWS_FILTERED', String(STATE.filasCargadas)],
      ['COMUNAS_JSON', JSON.stringify(comunasList)],
      ['TIPOS_JSON', JSON.stringify(tiposList)]
    ]);

    STATE.estado = 'COMPLETADO';
  } catch (err) {
    STATE.estado = 'ERROR';
    STATE.error = err.message;
    throw err;
  } finally {
    client.release();
    try { fs.unlinkSync(filePath); } catch (e) {}
  }
}

async function insertBatch_(client, batch) {
  if (!batch.length) return;
  var values = [];
  var placeholders = [];
  var p = 1;
  batch.forEach(function (row) {
    placeholders.push('($' + p++ + ',$' + p++ + ',$' + p++ + ',$' + p++ + ',$' + p++ + ',$' + p++ + ')');
    values.push(row[0], row[1], row[2], row[3], row[4], row[5]);
  });
  var sql = 'INSERT INTO data_rows (rut, nombre, comuna, direccion, tipo, raw) VALUES ' + placeholders.join(',');
  await client.query(sql, values);
}

function normalizeCell_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (v.text !== undefined) return v.text; // rich text
    if (v.result !== undefined) return v.result; // fórmula
    if (v instanceof Date) return v.toISOString();
    return String(v);
  }
  return v;
}

module.exports = { processUploadedFile, getStatus, isProcessing };
