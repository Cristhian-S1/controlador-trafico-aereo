const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'db-pistas',
  port:     process.env.DB_PORT     || 5432,
  database: process.env.DB_NAME     || 'db_pistas',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pistas (
      id          SERIAL PRIMARY KEY,
      pista_id    VARCHAR(20) UNIQUE NOT NULL,
      tipo        VARCHAR(20) NOT NULL,
      disponible  BOOLEAN     DEFAULT TRUE,
      reserved_at TIMESTAMP   DEFAULT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS asignaciones (
      id              SERIAL PRIMARY KEY,
      vuelo_id        VARCHAR(50) NOT NULL,
      pista_id        VARCHAR(20) NOT NULL,
      hora_asignacion TIMESTAMP   DEFAULT NOW()
    );
  `);

  const { rowCount } = await pool.query('SELECT 1 FROM pistas LIMIT 1');
  if (rowCount === 0) {
    await pool.query(`
      INSERT INTO pistas (pista_id, tipo) VALUES
        ('RWY-01','COMERCIAL'), ('RWY-02','COMERCIAL'), ('RWY-03','CARGA'),
        ('RWY-04','PRIVADO'),   ('RWY-05','COMERCIAL'), ('RWY-06','COMERCIAL'),
        ('RWY-07','CARGA'),     ('RWY-08','PRIVADO'),   ('RWY-09','COMERCIAL'),
        ('RWY-10','COMERCIAL');
    `);
    console.log('[DB-S2] Pistas iniciales insertadas');
  }

  console.log('[DB-S2] Tablas de pistas listas');
}

module.exports = { pool, initDB };
