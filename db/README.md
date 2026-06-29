# Bases de datos — ATC

Este directorio contiene los esquemas SQL dedicados para cada microservicio. Cada base de datos es propia de su servicio; no hay acceso cruzado entre ellas.

## Estructura

```
db/
├── vuelos/
│   └── schema.sql   # Base de datos del Servicio 1 — Gestion de Vuelos
├── pistas/
│   └── schema.sql   # Base de datos del Servicio 2 — Asignacion de Pistas
└── tasas/
    └── schema.sql   # Base de datos del Servicio 3 — Gestion de Tasas
```

## Esquemas

### `vuelos`

- Tabla `vuelos`: almacena las solicitudes de aterrizaje.
- Estados permitidos: `PENDIENTE`, `ASIGNADA`, `COMPLETADO`.
- El campo `vuelo_id` actua como Correlation ID del flujo de eventos.

### `pistas`

- Tabla `pistas`: catalogo de pistas con tipo (`COMERCIAL`, `CARGA`, `PRIVADO`) y estado (`LIBRE`, `OCUPADA`).
- Incluye pistas de ejemplo para desarrollo local.
- El servicio `pistas` busca la primera pista `LIBRE` al recibir un evento.

### `tasas`

- Tabla `tasas`: registra los costos calculados por aterrizaje y estacionamiento.
- Moneda por defecto: `USD`.

## Uso local

Los esquemas se montan automaticamente en los contenedores PostgreSQL a traves de `docker-compose.yml`:

```yaml
volumes:
  - ./db/vuelos/schema.sql:/docker-entrypoint-initdb.d/01-schema.sql:ro
```

En Kubernetes se incluyen como ConfigMaps de inicializacion (`init-configmap.yaml`) dentro de `k8s/postgres/`.
