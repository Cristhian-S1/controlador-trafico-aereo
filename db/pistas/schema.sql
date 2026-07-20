-- Database: pistas
-- Service: Servicio 2 - Asignacion de Pistas
-- Port: 5433

CREATE TABLE IF NOT EXISTS pistas (
    pista_id VARCHAR(20) PRIMARY KEY,
    tipo_pista VARCHAR(20) NOT NULL
        CHECK (tipo_pista IN ('COMERCIAL', 'CARGA', 'PRIVADO')),
    estado VARCHAR(20) NOT NULL DEFAULT 'LIBRE'
        CHECK (estado IN ('LIBRE', 'OCUPADA'))
);

-- Seed sample runways for local development
INSERT INTO pistas (pista_id, tipo_pista, estado) VALUES
    ('RWY-09', 'COMERCIAL', 'LIBRE'),
    ('RWY-27', 'COMERCIAL', 'LIBRE'),
    ('RWY-C1', 'CARGA', 'LIBRE'),
    ('RWY-P1', 'PRIVADO', 'LIBRE')
ON CONFLICT (pista_id) DO NOTHING;

-- Index to quickly find a free runway by type
CREATE INDEX IF NOT EXISTS idx_pistas_libres
    ON pistas(tipo_pista, estado)
    WHERE estado = 'LIBRE';
