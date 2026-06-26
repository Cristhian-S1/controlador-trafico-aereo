const express = require('express');
const { initDB, pool } = require('./db');
const { conectar, consumir } = require('./rabbit');
const routes = require('./routes');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use('/api', routes);
app.get('/health', (_, res) => res.json({ servicio: 'Gestión de Vuelos', estado: 'ok' }));

// SSE: el frontend mantiene conexión abierta esperando la confirmación final
const clientesSSE = new Map();

app.get('/api/vuelos/:vuelo_id/estado', (req, res) => {
  const { vuelo_id } = req.params;
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();
  clientesSSE.set(vuelo_id, res);
  req.on('close', () => clientesSSE.delete(vuelo_id));
});

function notificarSSE(vuelo_id, data) {
  const cliente = clientesSSE.get(vuelo_id);
  if (cliente) {
    cliente.write(`data: ${JSON.stringify(data)}\n\n`);
    cliente.end();
    clientesSSE.delete(vuelo_id);
  }
}

async function iniciarConsumidores() {
  // Consume ProcesoCompletado → actualiza BD → notifica al piloto por SSE
  await consumir('ProcesoCompletado', 'cola.proceso.completado.s1', async (data) => {
    const { vuelo_id, pista_id, tasa, estado, timestamp } = data;
    await pool.query(
      `UPDATE vuelos SET estado=$1, pista_asignada=$2, tasa_total=$3, updated_at=NOW() WHERE vuelo_id=$4`,
      [estado || 'COMPLETADO', pista_id, tasa?.total || null, vuelo_id]
    );
    notificarSSE(vuelo_id, { vuelo_id, estado: estado || 'COMPLETADO', pista_asignada: pista_id, tasa_total: tasa?.total, moneda: tasa?.moneda || 'USD', timestamp });
  });

  // Consume SolicitudRechazada → notifica al piloto que no hay pistas
  await consumir('SolicitudRechazada', 'cola.solicitud.rechazada.s1', async (data) => {
    const { vuelo_id, motivo, timestamp } = data;
    await pool.query(`UPDATE vuelos SET estado='RECHAZADO', updated_at=NOW() WHERE vuelo_id=$1`, [vuelo_id]);
    notificarSSE(vuelo_id, { vuelo_id, estado: 'RECHAZADO', motivo, timestamp });
  });
}

async function main() {
  for (let i = 1; i <= 10; i++) {
    try { await initDB(); break; }
    catch { await new Promise(r => setTimeout(r, 3000)); }
  }
  await conectar();
  await iniciarConsumidores();
  app.listen(PORT, () => console.log(`[S1] Gestión de Vuelos → :${PORT}`));
}

main().catch(err => { console.error('[S1] Error fatal:', err.message); process.exit(1); });
