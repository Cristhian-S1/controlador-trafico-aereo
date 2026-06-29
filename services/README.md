# Backend — Microservicios ATC

Este directorio contiene los tres microservicios Node.js/Express del proyecto ATC. Cada servicio tiene su propio `package.json`, `Dockerfile`, `.env.example` y un unico archivo de codigo `src/index.js` para mantener la simplicidad de la fase inicial.

## Estructura

```
services/
├── vuelos/    # Puerto 3001 — REST + eventos
├── pistas/    # Puerto 3002 — event-driven
└── tasas/     # Puerto 3003 — event-driven
```

## Servicios

### `vuelos` — Servicio 1

Responsabilidades:
- Recibir solicitudes de vuelo via REST.
- Guardar el vuelo en estado `PENDIENTE`.
- Publicar el evento `SolicitudVuelo` en RabbitMQ.
- Consumir `ProcesoCompletado` y actualizar el estado a `COMPLETADO`.
- Notificar al frontend via SSE (`/api/vuelos/events`).

Endpoints:
- `GET /health`
- `POST /api/vuelos`
- `GET /api/vuelos`
- `GET /api/vuelos/:id`
- `GET /api/vuelos/events` (SSE)

### `pistas` — Servicio 2

Responsabilidades:
- Consumir `SolicitudVuelo`.
- Buscar la primera pista `LIBRE` en su base de datos.
- Marcar la pista como `OCUPADA`.
- Publicar `AsignacionPista`.

No expone endpoints REST.

### `tasas` — Servicio 3

Responsabilidades:
- Consumir `AsignacionPista`.
- Calcular costos segun el tipo de pista:
  - `COMERCIAL`: 250 USD aterrizaje + 50 USD estacionamiento
  - `CARGA`: 200 USD aterrizaje + 80 USD estacionamiento
  - `PRIVADO`: 150 USD aterrizaje + 30 USD estacionamiento
- Guardar la tasa en su base de datos.
- Publicar `ProcesoCompletado`.

No expone endpoints REST.

## Desarrollo local

1. Copiar `.env.example` a `.env` y ajustar valores.
2. Levantar PostgreSQL y RabbitMQ con `docker compose up -d`.
3. Instalar dependencias y ejecutar:

```bash
cd services/vuelos
npm install
npm start
```

## Construccion de imagenes

```bash
docker build -t atc-vuelos:latest ./services/vuelos
docker build -t atc-pistas:latest ./services/pistas
docker build -t atc-tasas:latest ./services/tasas
```

Para Kubernetes/K3s con `imagePullPolicy: Never`, las imagenes deben existir localmente en cada nodo del cluster.
