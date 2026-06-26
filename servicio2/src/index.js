const { initDB, pool } = require('./db');
const { conectar, consumir, publicar } = require('./rabbit');

async function asignarPista(data) {
  const { vuelo_id } = data;

  // FOR UPDATE SKIP LOCKED evita doble asignación en solicitudes simultáneas
  const { rows } = await pool.query(`
    SELECT pista_id, tipo FROM pistas
    WHERE disponible = TRUE
    ORDER BY pista_id ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  `);

  if (rows.length === 0) {
    console.warn(`[S2] Sin pistas disponibles para vuelo ${vuelo_id}`);
    await publicar('SolicitudRechazada', {
      evento:    'SolicitudRechazada',
      vuelo_id,
      motivo:    'No hay pistas disponibles en este momento',
      timestamp: new Date().toISOString(),
      estado:    'RECHAZADO',
    });
    return;
  }

  const { pista_id, tipo } = rows[0];
  const hora_asignacion = new Date().toISOString();

  await pool.query(
    'UPDATE pistas SET disponible=FALSE, reserved_at=NOW() WHERE pista_id=$1',
    [pista_id]
  );
  await pool.query(
    'INSERT INTO asignaciones (vuelo_id, pista_id) VALUES ($1,$2)',
    [vuelo_id, pista_id]
  );

  console.log(`[S2] Pista ${pista_id} asignada → vuelo ${vuelo_id}`);

  await publicar('AsignacionPista', {
    evento: 'AsignacionPista',
    vuelo_id, pista_id,
    tipo_pista: tipo,
    hora_asignacion,
    estado: 'ASIGNADA',
  });
}

async function liberarPista(data) {
  const { vuelo_id } = data;
  const { rows } = await pool.query(
    'SELECT pista_id FROM asignaciones WHERE vuelo_id=$1 ORDER BY id DESC LIMIT 1',
    [vuelo_id]
  );
  if (rows.length > 0) {
    await pool.query(
      'UPDATE pistas SET disponible=TRUE, reserved_at=NULL WHERE pista_id=$1',
      [rows[0].pista_id]
    );
    console.log(`[S2] Pista ${rows[0].pista_id} liberada → vuelo ${vuelo_id}`);
  }
  await publicar('PistaLiberada', { evento: 'PistaLiberada', vuelo_id, timestamp: new Date().toISOString() });
}

// Libera pistas bloqueadas más de 30 min sin confirmación de aterrizaje
function iniciarTTL() {
  setInterval(async () => {
    const { rows } = await pool.query(`
      UPDATE pistas SET disponible=TRUE, reserved_at=NULL
      WHERE disponible=FALSE AND reserved_at < NOW() - INTERVAL '30 minutes'
      RETURNING pista_id
    `);
    if (rows.length > 0) console.warn(`[S2][TTL] Pistas liberadas: ${rows.map(r => r.pista_id).join(', ')}`);
  }, 5 * 60 * 1000);
}

async function main() {
  for (let i = 1; i <= 10; i++) {
    try { await initDB(); break; }
    catch { await new Promise(r => setTimeout(r, 3000)); }
  }
  await conectar();
  await consumir('SolicitudVuelo',  'cola.solicitud.vuelo.s2',   asignarPista);
  await consumir('CobrosAnulados',  'cola.cobros.anulados.s2',   liberarPista);
  iniciarTTL();
  console.log('[S2] Asignación de Pistas activo');
}

main().catch(err => { console.error('[S2] Error fatal:', err.message); process.exit(1); });
