-- Database: vuelos
-- Service: Servicio 1 - Gestion de Vuelos
-- Port: 5432

CREATE TABLE IF NOT EXISTS vuelos (
    vuelo_id VARCHAR(32) PRIMARY KEY,
    aerolinea VARCHAR(50) NOT NULL,
    numero_vuelo VARCHAR(20) NOT NULL,
    origen VARCHAR(10) NOT NULL,
    destino VARCHAR(10) NOT NULL,
    aeronave VARCHAR(20) NOT NULL,
    pasajeros INTEGER NOT NULL CHECK (pasajeros >= 0),
    timestamp_solicitud TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE'
        CHECK (estado IN ('PENDIENTE', 'ASIGNADA', 'COMPLETADO'))
);

-- Index to speed up state-based queries used by SSE/history endpoints
CREATE INDEX IF NOT EXISTS idx_vuelos_estado ON vuelos(estado);
