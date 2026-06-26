const express  = require('express');
const { pool } = require('./db');
const { publicar } = require('./rabbit');

const router = express.Router();

let contador = 1;
function generarVueloId() {
  const anio = new Date().getFullYear();
  return `ATC-${anio}-${String(contador++).padStart(3, '0')}`;
}

// POST /api/vuelos — recibe solicitud del piloto y publica SolicitudVuelo
router.post('/vuelos', async (req, res) => {
  const { aerolinea, numero_vuelo, origen, destino, aeronave, pasajeros } = req.body;

  if (!aerolinea || !numero_vuelo || !origen || !destino) {
    return res.status(400).json({ error: 'Campos requeridos: aerolinea, numero_vuelo, origen, destino' });
  }

  const vuelo_id  = generarVueloId();
  const timestamp = new Date().toISOString();

  try {
    await pool.query(
      `INSERT INTO vuelos (vuelo_id, aerolinea, numero_vuelo, origen, destino, aeronave, pasajeros, estado)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'PENDIENTE')`,
      [vuelo_id, aerolinea, numero_vuelo, origen, destino, aeronave || null, pasajeros || null]
    );

    await publicar('SolicitudVuelo', {
      evento: 'SolicitudVuelo',
      vuelo_id, aerolinea, numero_vuelo, origen, destino,
      aeronave:  aeronave  || 'N/A',
      pasajeros: pasajeros || 0,
      timestamp,
      estado: 'PENDIENTE',
    });

    return res.status(202).json({ mensaje: 'Solicitud recibida', vuelo_id, estado: 'PENDIENTE', timestamp });
  } catch (err) {
    console.error('[S1][POST /vuelos]', err.message);
    return res.status(500).json({ error: 'Error al procesar la solicitud' });
  }
});

// GET /api/vuelos — historial
router.get('/vuelos', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM vuelos ORDER BY created_at DESC LIMIT 100');
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/vuelos/:vuelo_id — estado de un vuelo
router.get('/vuelos/:vuelo_id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM vuelos WHERE vuelo_id = $1', [req.params.vuelo_id]);
    if (!rows.length) return res.status(404).json({ error: 'Vuelo no encontrado' });
    return res.json(rows[0]);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
