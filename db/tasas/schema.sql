-- Database: tasas
-- Service: Servicio 3 - Gestion de Tasas
-- Port: 5434

CREATE TABLE IF NOT EXISTS tasas (
    id SERIAL PRIMARY KEY,
    vuelo_id VARCHAR(32) NOT NULL,
    pista_id VARCHAR(20) NOT NULL,
    costo_aterrizaje NUMERIC(10,2) NOT NULL CHECK (costo_aterrizaje >= 0),
    costo_estacionamiento NUMERIC(10,2) NOT NULL CHECK (costo_estacionamiento >= 0),
    costo_total NUMERIC(10,2) NOT NULL CHECK (costo_total >= 0),
    moneda VARCHAR(3) NOT NULL DEFAULT 'USD',
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for correlation-id lookups
CREATE INDEX IF NOT EXISTS idx_tasas_vuelo_id ON tasas(vuelo_id);
