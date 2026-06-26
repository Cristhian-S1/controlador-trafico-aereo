const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'db-tasas',
  port:     process.env.DB_PORT     || 5432,
  database: process.env.DB_NAME     || 'db_tasas',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cobros (
      id                   SERIAL PRIMARY KEY,
      folio_contable       VARCHAR(80) UNIQUE NOT NULL,
      vuelo_id             VARCHAR(50) NOT NULL,
      pista_id             VARCHAR(20) NOT NULL,
      tasa_aterrizaje      NUMERIC(10,2),
      tasa_estacionamiento NUMERIC(10,2),
      total                NUMERIC(10,2),
      moneda               VARCHAR(5)  DEFAULT 'USD',
      estado               VARCHAR(20) DEFAULT 'COMPLETADO',
      created_at           TIMESTAMP   DEFAULT NOW()
    );
  `);
  console.log('[DB-S3] Tabla cobros lista');
}

module.exports = { pool, initDB };
