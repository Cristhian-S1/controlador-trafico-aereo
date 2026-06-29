# Controlador de Trafico Aereo (ATC)

Proyecto final de Aplicaciones Distribuidas — Grupo 1. Sistema de microservicios para la gestion automatizada de aterrizajes, asignacion de pistas y calculo de tasas aeroportuarias.

---

## Flujo

El sistema se compone de **3 microservicios** que se comunican de forma asincrona via RabbitMQ (exchange `atc.exchange` de tipo `topic`):

| Servicio | Rol | HTTP | Puertos |
|----------|-----|------|---------|
| **Gestion de Vuelos** | API REST + consumidor de eventos + SSE | `POST /api/vuelos`, `GET /api/vuelos`, `GET /api/vuelos/events` | `:3001` |
| **Asignacion de Pistas** | Solo consumidor/publicador de eventos | No tiene | Solo red interna |
| **Gestion de Tasas** | Solo consumidor/publicador de eventos | No tiene | Solo red interna |

### Paso a paso

1. Se envia un `POST /api/vuelos` al **Servicio de Vuelos** (`:3001`) con los datos del vuelo.
2. El servicio registra el vuelo en **PostgreSQL (vuelos)** con estado `PENDIENTE` y publica un evento en RabbitMQ con routing key `vuelo.solicitud`.
3. El **Servicio de Pistas** consume el evento (`vuelo.solicitud`), busca una pista libre en **PostgreSQL (pistas)**, la marca como `OCUPADA` y publica un evento con routing key `pista.asignacion`.
4. El **Servicio de Tasas** consume el evento (`pista.asignacion`), calcula los costos (aterrizaje + estacionamiento) segun el tipo de pista, los registra en **PostgreSQL (tasas)** y publica un evento con routing key `proceso.completado`.
5. El **Servicio de Vuelos** consume el evento (`proceso.completado`), actualiza el estado del vuelo a `COMPLETADO` y notifica a los clientes SSE (Server-Sent Events) conectados a `GET /api/vuelos/events`.

---

## Stack Tecnologico

| Capa | Tecnologia |
|---|---|
| Backend | Node.js + Express |
| Frontend | Next.js |
| API Gateway | Nginx |
| Message Broker | RabbitMQ |
| Bases de Datos | PostgreSQL (1 por microservicio) |
| Contenedores | Docker (imagenes node:18-alpine) |
| Orquestacion | Kubernetes / K3s |
| CI/CD | GitHub Actions (ramas develop y main) |

---

## Ejecucion Local con Docker Compose

Levanta los 3 PostgreSQL, RabbitMQ y los 3 microservicios:

```bash
docker compose up -d
```

Para ver los logs de todos los servicios:

```bash
docker compose logs -f
```

Para detener y eliminar los contenedores:

```bash
docker compose down
```

### Conexion a las Bases de Datos

Cada microservicio tiene su propia base de datos PostgreSQL expuesta en un puerto distinto:

| Base | Puerto | Usuario | Password | Database |
|------|--------|---------|----------|----------|
| vuelos | `5432` | `atc` | `atc123` | `vuelos` |
| pistas | `5433` | `atc` | `atc123` | `pistas` |
| tasas  | `5434` | `atc` | `atc123` | `tasas`  |

Ejemplo de conexion con `psql`:

```bash
psql -h localhost -p 5432 -U atc -d vuelos
```

RabbitMQ management console: `http://localhost:15672` (usuario: `guest`, password: `guest`)

---

## Repositorio

- *Rama develop*: despliegues automaticos a QA (qa.grupo1.uta.cl)
- *Rama main*: despliegues automaticos a PROD (prod.grupo1.uta.cl)

---

## Integrantes — Grupo 1

| Nombre | Rol |
|---|---|
| Katalina Ignacia Oviedo Diaz | Backend |
| Fernanda Javiera Ventura Briceno | Frontend |
| Sebastian Alejandro Torres Santibanez | API Gateway |
| Cristhian Manuel Sanchez Femayor | Database |
