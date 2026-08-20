const ExcelJS = require('exceljs');
const fs = require('fs');
const db = require('./db');

var FILTRO_STATUS_ORDEN = 'P';
var FILTRO_ORIGEN = ['MOROSIDAD', 'SERVICIO DE BAJA'];
var FILTRO_STATUS_AB = 'X';
var BATCH_SIZE = 1000; // filas por lote al insertar en la base de datos
var GX1_DIAS_MINIMOS_DEFAULT = 90; // valor por defecto si el admin no ha configurado uno propio

// Estado del procesamiento en curso, en memoria (un solo proceso a la vez, por base/tipo)
var STATE = {
  estado: 'INACTIVO', // INACTIVO | EN_PROGRESO | COMPLETADO | ERROR
  tipo: '', // 'ORDENES' | 'BODEGA'
  base: '',
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
 * Procesa el archivo de ÓRDENES subido para una base específica ('GX1' o
 * 'GX2'): lo lee en modo streaming, aplica el filtro global (STATUS_ORDEN,
 * ORIGEN, STATUS_AB). Guarda TODAS las filas que pasan ese filtro, sin
 * importar su antigüedad -- el filtro de "más de N días" o "N días o menos"
 * se aplica luego, al consultar, según el tipo de usuario que esté mirando
 * (técnico de terreno ve las antiguas, usuario de venta ve las recientes).
 * Reemplaza SOLO las filas de esa base (la otra base no se toca).
 */
async function processUploadedFile(filePath, originalName, base) {
  if (STATE.estado === 'EN_PROGRESO') {
    throw new Error('Ya hay un procesamiento en curso.');
  }
  base = base === 'GX1' ? 'GX1' : 'GX2';

  STATE = { estado: 'EN_PROGRESO', tipo: 'ORDENES', base: base, archivo: originalName, filasLeidas: 0, filasCargadas: 0, totalEstimado: 0, error: '' };

  // Vaciar SOLO las filas de esta base (la otra base queda intacta)
  await db.query('DELETE FROM data_rows WHERE base = $1', [base]);

  var comunasSet = {};
  var tiposSet = {};
  var regionByComuna = {};
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

          ['STATUS_ORDEN', 'ORIGEN', 'STATUS_AB', 'COMUNA', 'TIPO', 'RUT', 'NOMBRE', 'DIRECCION', 'REGION', 'FCH_INGRESO', 'DISTRIBUIDOR'].forEach(function (col) {
            if (idx[col] === undefined) throw new Error('El archivo no tiene la columna requerida: ' + col);
          });

          await db.setMeta('HEADERS_JSON_' + base, JSON.stringify(headers));
          continue;
        }

        STATE.filasLeidas++;

        var statusOrden = arr[idx['STATUS_ORDEN']];
        var origen = arr[idx['ORIGEN']];
        var statusAb = arr[idx['STATUS_AB']];

        var pasaFiltroBase =
          statusOrden === FILTRO_STATUS_ORDEN &&
          FILTRO_ORIGEN.indexOf(origen) !== -1 &&
          statusAb === FILTRO_STATUS_AB;

        if (pasaFiltroBase) {
          var rut = arr[idx['RUT']];
          var nombre = arr[idx['NOMBRE']];
          var comuna = arr[idx['COMUNA']];
          var direccion = arr[idx['DIRECCION']];
          var tipo = arr[idx['TIPO']];
          var region = arr[idx['REGION']];
          var distribuidor = arr[idx['DISTRIBUIDOR']];
          var fchIngreso = parseFechaIngreso_(arr[idx['FCH_INGRESO']]);

          var rawObj = {};
          headers.forEach(function (h, i) { rawObj[h] = arr[i] !== undefined ? arr[i] : null; });

          batch.push([base, rut, nombre, comuna, region, direccion, tipo, distribuidor, fchIngreso, JSON.stringify(rawObj)]);
          if (comuna) comunasSet[comuna] = true;
          if (tipo) tiposSet[tipo] = true;
          if (comuna && region) regionByComuna[comuna] = region;
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

    var tiposList = Object.keys(tiposSet).sort();

    await db.setMetaMany([
      ['LAST_UPLOAD_DATE_' + base, new Date().toISOString()],
      ['LAST_UPLOAD_FILENAME_' + base, originalName],
      ['TOTAL_ROWS_RAW_' + base, String(STATE.filasLeidas)],
      ['TOTAL_ROWS_FILTERED_' + base, String(STATE.filasCargadas)],
      ['TIPOS_JSON_' + base, JSON.stringify(tiposList)]
    ]);

    // Recalcular comunas/regiones GLOBALES combinando ambas bases (usadas
    // para la asignación de territorio por usuario, que aplica a ambas bases).
    await recalcularComunasRegionesGlobales_();

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

/**
 * Procesa un archivo de BODEGA (inventario) para una base ('GX1' o 'GX2').
 * Estructura esperada: COD_DEPOSITO, DEPOSITO, COD_ARTICULO, ARTICULO, STOCK.
 * Reemplaza por completo el inventario de esa base.
 */
async function processBodegaFile(filePath, originalName, base) {
  if (STATE.estado === 'EN_PROGRESO') {
    throw new Error('Ya hay un procesamiento en curso.');
  }
  base = base === 'GX1' ? 'GX1' : 'GX2';

  STATE = { estado: 'EN_PROGRESO', tipo: 'BODEGA', base: base, archivo: originalName, filasLeidas: 0, filasCargadas: 0, totalEstimado: 0, error: '' };

  await db.query('DELETE FROM bodega_items WHERE base = $1', [base]);

  var depositosSet = {};
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
        var values = row.values;
        var arr = [];
        for (var c = 1; c < values.length; c++) arr.push(normalizeCell_(values[c]));

        if (!headers) {
          headers = arr.map(function (h) { return String(h || '').trim(); });
          idx = {};
          headers.forEach(function (h, i) { idx[h] = i; });

          ['COD_DEPOSITO', 'DEPOSITO', 'COD_ARTICULO', 'ARTICULO', 'STOCK'].forEach(function (col) {
            if (idx[col] === undefined) throw new Error('El archivo de bodega no tiene la columna requerida: ' + col);
          });
          continue;
        }

        STATE.filasLeidas++;

        var deposito = arr[idx['DEPOSITO']];
        var articulo = arr[idx['ARTICULO']];
        if (deposito || articulo) {
          batch.push([
            base,
            arr[idx['COD_DEPOSITO']],
            deposito,
            arr[idx['COD_ARTICULO']],
            articulo,
            Number(arr[idx['STOCK']]) || 0
          ]);
          if (deposito) depositosSet[deposito] = true;
          STATE.filasCargadas++;
        }

        if (batch.length >= BATCH_SIZE) {
          await insertBodegaBatch_(client, batch);
          batch = [];
        }
      }
    }

    if (batch.length > 0) {
      await insertBodegaBatch_(client, batch);
      batch = [];
    }

    await db.setMetaMany([
      ['LAST_UPLOAD_DATE_BODEGA_' + base, new Date().toISOString()],
      ['LAST_UPLOAD_FILENAME_BODEGA_' + base, originalName],
      ['TOTAL_ROWS_BODEGA_' + base, String(STATE.filasCargadas)]
    ]);

    await recalcularDepositosGlobales_();

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

async function recalcularDepositosGlobales_() {
  var result = await db.query("SELECT DISTINCT deposito FROM bodega_items WHERE deposito IS NOT NULL AND deposito <> '' ORDER BY deposito");
  var lista = result.rows.map(function (r) { return r.deposito; });
  await db.setMeta('DEPOSITOS_JSON', JSON.stringify(lista));
}

async function insertBodegaBatch_(client, batch) {
  if (!batch.length) return;
  var values = [];
  var placeholders = [];
  var p = 1;
  batch.forEach(function (row) {
    placeholders.push('($' + p++ + ',$' + p++ + ',$' + p++ + ',$' + p++ + ',$' + p++ + ',$' + p++ + ')');
    values.push(row[0], row[1], row[2], row[3], row[4], row[5]);
  });
  var sql = 'INSERT INTO bodega_items (base, cod_deposito, deposito, cod_articulo, articulo, stock) VALUES ' + placeholders.join(',');
  await client.query(sql, values);
}

async function recalcularComunasRegionesGlobales_() {
  var comunasResult = await db.query('SELECT DISTINCT comuna FROM data_rows WHERE comuna IS NOT NULL AND comuna <> \'\' ORDER BY comuna');
  var comunasList = comunasResult.rows.map(function (r) { return r.comuna; });

  var regionResult = await db.query(
    "SELECT DISTINCT comuna, region FROM data_rows WHERE comuna IS NOT NULL AND region IS NOT NULL AND comuna <> '' AND region <> ''"
  );
  var regionByComuna = {};
  var regionesSet = {};
  regionResult.rows.forEach(function (r) {
    regionByComuna[r.comuna] = r.region;
    regionesSet[r.region] = true;
  });
  var regionesList = Object.keys(regionesSet).sort();

  await db.setMetaMany([
    ['COMUNAS_JSON', JSON.stringify(comunasList)],
    ['REGION_BY_COMUNA_JSON', JSON.stringify(regionByComuna)],
    ['REGIONES_JSON', JSON.stringify(regionesList)]
  ]);
}

async function insertBatch_(client, batch) {
  if (!batch.length) return;
  var values = [];
  var placeholders = [];
  var p = 1;
  batch.forEach(function (row) {
    placeholders.push('($' + p++ + ',$' + p++ + ',$' + p++ + ',$' + p++ + ',$' + p++ + ',$' + p++ + ',$' + p++ + ',$' + p++ + ',$' + p++ + ',$' + p++ + ')');
    values.push(row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7], row[8], row[9]);
  });
  var sql = 'INSERT INTO data_rows (base, rut, nombre, comuna, region, direccion, tipo, distribuidor, fch_ingreso, raw) VALUES ' + placeholders.join(',');
  await client.query(sql, values);
}

/**
 * Interpreta el valor de FCH_INGRESO como fecha, soportando:
 * - Fecha real de Excel ya convertida a objeto Date (llega como string ISO tras normalizeCell_)
 * - Número crudo de Excel (fecha "serial", días desde 1899-12-30) -- pasa esto
 *   cuando la celda no está formateada como fecha en el archivo original
 * - Texto en formato dd-mm-yyyy o dd/mm/yyyy (formato chileno)
 * Devuelve una fecha 'yyyy-mm-dd' o null si no se pudo interpretar o el
 * resultado no es una fecha plausible (para evitar valores absurdos como
 * "año 46203" que rompen la base de datos).
 */
function parseFechaIngreso_(v) {
  if (v === null || v === undefined || v === '') return null;

  // Número crudo de Excel (fecha serial)
  if (typeof v === 'number' && isFinite(v)) {
    var excelEpochMs = Date.UTC(1899, 11, 30);
    return validarYFormatearFecha_(new Date(excelEpochMs + v * 86400000));
  }

  var s = String(v).trim();
  if (!s) return null;

  // Formato dd-mm-yyyy o dd/mm/yyyy (chileno) -- se revisa primero porque
  // new Date() interpretaría mal "05-07-2026" (lo leería como mes-día).
  var m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) {
    var dd = m[1].padStart(2, '0');
    var mm = m[2].padStart(2, '0');
    return validarYFormatearFecha_(new Date(m[3] + '-' + mm + '-' + dd + 'T00:00:00Z'));
  }

  // Fecha ISO (ya sea "2026-07-05" o "2026-07-05T00:00:00.000Z")
  return validarYFormatearFecha_(new Date(s));
}

function validarYFormatearFecha_(d) {
  if (isNaN(d.getTime())) return null;
  var year = d.getUTCFullYear();
  if (year < 1990 || year > 2100) return null; // fecha no plausible, se descarta en vez de romper la base
  return d.toISOString().slice(0, 10);
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

module.exports = { processUploadedFile, processBodegaFile, getStatus, isProcessing, GX1_DIAS_MINIMOS_DEFAULT };
