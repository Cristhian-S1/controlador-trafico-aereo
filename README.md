# Controlador de Trafico Aereo (ATC)

Proyecto final de Aplicaciones Distribuidas — Grupo 1. Sistema de microservicios para la gestion automatizada de aterrizajes, asignacion de pistas y calculo de tasas aeroportuarias.

---

## 1. Diagrama Arquitectonico

```mermaid
graph TB
    subgraph Frontend["Frontend"]
        UI["Panel de Control ATC<br/>Next.js"]
    end

    subgraph Gateway["Capa de Entrada"]
        NGINX["API Gateway<br/>Nginx<br/>qa.grupo1.uta.cl / prod.grupo1.uta.cl"]
    end

    subgraph Servicios["Microservicios — Node.js + Express (Alpine Linux)"]
        direction LR
        S1["Servicio 1<br/>Gestion de Vuelos<br/>REST + Eventos<br/>Puerto :3001"]

        RMQ["RabbitMQ<br/>Exchange: atc.exchange (topic)<br/>Puerto :5672 / Management :15672"]

        S2["Servicio 2<br/>Asignacion de Pistas<br/>Event Driven<br/>Puerto :3002"]
        S3["Servicio 3<br/>Gestion de Tasas<br/>Event Driven<br/>Puerto :3003"]
    end


    subgraph Bases["Bases de Datos — PostgreSQL (Alpine)"]
        DB1[("DB Vuelos<br/>Puerto :5432")]
        DB2[("DB Pistas<br/>Puerto :5433")]
        DB3[("DB Tasas<br/>Puerto :5434")]
    end

    UI -->|"HTTP /vuelos"| NGINX
    NGINX -->|"POST /api/vuelos"| S1
    S1 -->|"1. Publica SolicitudVuelo"| RMQ
    S1 -->|"Registra vuelo"| DB1
    RMQ -->|"2. Consume SolicitudVuelo"| S2
    S2 -->|"Consulta pistas libres"| DB2
    S2 -->|"3. Publica AsignacionPista"| RMQ
    RMQ -->|"4. Consume AsignacionPista"| S3
    S3 -->|"Registra tasa"| DB3
    S3 -->|"5. Publica ProcesoCompletado"| RMQ
    RMQ -->|"6. Consume ProcesoCompletado"| S1
    S1 -->|"Actualiza estado"| DB1
    S1 -->|"SSE — Confirmacion"| NGINX
    NGINX -->|"Actualizacion en tiempo real"| UI
```

### Flujo

1. Un **piloto** (o el frontend simulandolo) envia una solicitud de aterrizaje via REST al API Gateway.
2. El **Servicio 1 (Gestion de Vuelos)** recibe la peticion, registra el vuelo en su base de datos y publica el evento `SolicitudVuelo` en RabbitMQ.
3. El **Servicio 2 (Asignacion de Pistas)** consume el evento, consulta su base de datos de pistas, selecciona una pista libre y publica el evento `AsignacionPista`.
4. El **Servicio 3 (Gestion de Tasas)** consume `AsignacionPista`, calcula los costos operativos del aterrizaje, los registra y publica `ProcesoCompletado`.
5. El **Servicio 1** consume `ProcesoCompletado`, actualiza el estado del vuelo y notifica al frontend via SSE (Server-Sent Events) que el proceso fue exitoso.

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
