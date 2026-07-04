# Kubernetes — Despliegue ATC

Este directorio contiene los manifiestos para desplegar la arquitectura ATC en un cluster K3s. Incluye namespace, bases de datos PostgreSQL, RabbitMQ, los tres microservicios Node.js y el Ingress/Nginx para los dominios `.uta.cl`.

## Estructura

```
k8s/
├── base/
│   ├── namespace.yaml          # namespace grupo1
│   ├── configmap.yaml          # config no sensible
│   └── secrets.yaml            # plantilla de Secretes
├── postgres/
│   ├── vuelos/                 # PVC, init, deployment, service
│   ├── pistas/
│   └── tasas/
├── rabbitmq/
│   ├── pvc.yaml
│   ├── init-configmap.yaml     # exchange + colas predefinidas
│   ├── deployment.yaml
│   ├── service.yaml            # ClusterIP AMQP
│   └── service-management.yaml # NodePort 30672
├── apps/
│   ├── vuelos/                 # deployment + service
│   ├── pistas/
│   ├── tasas/
│   └── gateway/                # nginx: frontend + proxy /api -> vuelos
├── backups/
│   ├── pvc.yaml                # PVC compartido de respaldos
│   └── cronjob-*.yaml          # pg_dump cada 10 minutos por BD
└── overlays/
    ├── qa/                     # namespace grupo1-qa + ingress qa.grupo1.uta.cl
    └── prod/                   # namespace grupo1-prod + ingress prod.grupo1.uta.cl
```

## Requisitos

- Cluster K3s con al menos 2 nodos (1 servidor + 1 agente).
- `kubectl` configurado.
- Imagenes Docker de los servicios disponibles en cada nodo o en un registro.

## Despliegue rapido

```bash
kubectl apply -k k8s/overlays/qa   # o k8s/overlays/prod
```

Logs unificados de todo el sistema:

```bash
./scripts/logs-unificados.sh grupo1-qa
```

Esperar disponibilidad:

```bash
kubectl wait -n grupo1 deployment/postgres-vuelos deployment/postgres-pistas deployment/postgres-tasas deployment/rabbitmq deployment/vuelos deployment/pistas deployment/tasas --for=condition=Available --timeout=120s
```

## Configuracion de dominios

En la maquina del evaluador/usuario:

```bash
sudo tee -a /etc/hosts <<EOF
146.83.102.20 qa.grupo1.uta.cl
146.83.102.20 prod.grupo1.uta.cl
EOF
```

## Prueba del flujo

```bash
curl -X POST http://qa.grupo1.uta.cl/api/vuelos \
  -H "Content-Type: application/json" \
  -d '{"vuelo_id":"ATC-K8S-001","aerolinea":"LATAM","numero_vuelo":"LA1234","origen":"SCL","destino":"ARI","aeronave":"A320","pasajeros":150}'

sleep 5
curl http://qa.grupo1.uta.cl/api/vuelos/ATC-K8S-001
```

Resultado esperado: `estado: COMPLETADO`.

## RabbitMQ Management

Via port-forward:

```bash
kubectl port-forward -n grupo1 svc/rabbitmq 15672:15672
# http://localhost:15672 (guest/guest)
```

O via NodePort si se accede desde fuera del cluster:

```bash
http://<node-ip>:30672
```

## CI/CD

Los workflows de GitHub Actions en `.github/workflows/` automatizan el despliegue:

- `develop` → overlay `k8s/overlays/qa` → namespace `grupo1-qa`
- `main` → overlay `k8s/overlays/prod` → namespace `grupo1-prod`

Los workflows usan `kustomize edit set image` para inyectar el tag correcto en cada overlay antes de aplicar.

## Notas importantes

- `imagePullPolicy: Never` se usa en `base/` para imagenes locales. Los overlays `qa/` y `prod/` lo sobreescriben a `IfNotPresent`.
- Las credenciales en `base/secrets.yaml` son valores de ejemplo. En produccion generar el Secret por separado y no versionarlo.
- Cada microservicio solo accede a su propia base de datos.
- El plan de CI/CD detallado esta en `docs/superpowers/plans/2026-06-28-atc-cicd-week4-plan.md`.
