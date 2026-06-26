const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'db-vuelos',
  port:     process.env.DB_PORT     || 5432,
  database: process.env.DB_NAME     || 'db_vuelos',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vuelos (
      id              SERIAL PRIMARY KEY,
      vuelo_id        VARCHAR(50)  UNIQUE NOT NULL,
      aerolinea       VARCHAR(100),
      numero_vuelo    VARCHAR(20),
      origen          VARCHAR(10),
      destino         VARCHAR(10),
      aeronave        VARCHAR(50),
      pasajeros       INTEGER,
      estado          VARCHAR(30)  DEFAULT 'PENDIENTE',
      pista_asignada  VARCHAR(20),
      tasa_total      NUMERIC(10,2),
      created_at      TIMESTAMP    DEFAULT NOW(),
      updated_at      TIMESTAMP    DEFAULT NOW()
    );
  `);
  console.log('[DB-S1] Tabla vuelos lista');
}

module.exports = { pool, initDB };
