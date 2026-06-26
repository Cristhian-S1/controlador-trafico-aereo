const { initDB, pool } = require('./db');
const { conectar, consumir, publicar } = require('./rabbit');

const TARIFAS = {
  COMERCIAL: { aterrizaje: 250.00, estacionamiento: 50.00 },
  CARGA:     { aterrizaje: 300.00, estacionamiento: 75.00 },
  PRIVADO:   { aterrizaje: 150.00, estacionamiento: 30.00 },
};

function calcularTasa(tipo_pista) {
  const t = TARIFAS[tipo_pista] || TARIFAS['COMERCIAL'];
  return { aterrizaje: t.aterrizaje, estacionamiento: t.estacionamiento, total: t.aterrizaje + t.estacionamiento, moneda: 'USD' };
}

async function procesarAsignacion(data) {
  const { vuelo_id, pista_id, tipo_pista } = data;
  const tasa           = calcularTasa(tipo_pista);
  const folio_contable = `ATC-FOLIO-${vuelo_id}-${Date.now()}`;
  const timestamp      = new Date().toISOString();

  await pool.query(
    `INSERT INTO cobros (folio_contable, vuelo_id, pista_id, tasa_aterrizaje, tasa_estacionamiento, total, moneda, estado)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'COMPLETADO')`,
    [folio_contable, vuelo_id, pista_id, tasa.aterrizaje, tasa.estacionamiento, tasa.total, tasa.moneda]
  );

  console.log(`[S3] Cobro registrado → ${folio_contable} | ${tasa.total} ${tasa.moneda}`);

  await publicar('ProcesoCompletado', {
    evento: 'ProcesoCompletado',
    vuelo_id, pista_id,
    tasa: { aterrizaje: tasa.aterrizaje, estacionamiento: tasa.estacionamiento, total: tasa.total, moneda: tasa.moneda },
    timestamp,
    estado: 'COMPLETADO',
  });
}

async function anularCobro(data) {
  const { vuelo_id } = data;
  await pool.query(
    `UPDATE cobros SET estado='ANULADO' WHERE vuelo_id=$1 AND estado='COMPLETADO'`,
    [vuelo_id]
  );
  console.log(`[S3] Cobro anulado → vuelo ${vuelo_id}`);
  await publicar('CobrosAnulados', { evento: 'CobrosAnulados', vuelo_id, timestamp: new Date().toISOString() });
}

async function main() {
  for (let i = 1; i <= 10; i++) {
    try { await initDB(); break; }
    catch { await new Promise(r => setTimeout(r, 3000)); }
  }
  await conectar();
  await consumir('AsignacionPista',    'cola.asignacion.pista.s3',     procesarAsignacion);
  await consumir('AterrizajeAbortado', 'cola.aterrizaje.abortado.s3',  anularCobro);
  console.log('[S3] Gestión de Tasas activo');
}

main().catch(err => { console.error('[S3] Error fatal:', err.message); process.exit(1); });
