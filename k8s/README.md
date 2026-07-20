# Kubernetes — Despliegue ATC

Manifiestos para desplegar la arquitectura ATC en un cluster K3s. Incluye namespace, bases de datos PostgreSQL, RabbitMQ, los tres microservicios Node.js, el gateway Nginx, Ingress por dominio y backups automaticos cada 10 minutos.

## Estructura

```
k8s/
├── base/
│   ├── namespace.yaml              # namespace grupo1 (los overlays renombran a grupo1-qa / grupo1-prod)
│   ├── configmap.yaml              # config no sensible (placeholder)
│   ├── secrets.yaml                # plantilla de Secret (VER NOTA)
│   ├── postgres/<vuelos|pistas|tasas>/
│   │   ├── pvc.yaml                # volumen persistente (datos sobreviven a caidas de pod)
│   │   ├── init-configmap.yaml     # schema.sql montado en docker-entrypoint-initdb.d
│   │   ├── deployment.yaml
│   │   └── service.yaml            # ClusterIP
│   ├── rabbitmq/
│   │   ├── pvc.yaml
│   │   ├── init-configmap.yaml     # exchange + colas predefinidas
│   │   ├── deployment.yaml
│   │   └── service.yaml            # ClusterIP AMQP (sin NodePort publico)
│   ├── apps/
│   │   ├── vuelos|pistas|tasas/    # deployment + service
│   │   └── gateway/                # nginx: frontend estatico + proxy /api -> vuelos
│   └── backups/
│       ├── pvc.yaml                # PVC compartido de respaldos
│       └── cronjob-*.yaml          # pg_dump cada 10 minutos por BD
└── overlays/
    ├── qa/                         # namespace grupo1-qa + ingress qa.grupo1.uta.cl
    └── prod/                       # namespace grupo1-prod + ingress prod.grupo1.uta.cl
```

Justificacion: este arbol contiene unicamente lo mandatorio del enunciado. Se elimino la pila
Loki/Grafana/Promtail y los HPA porque `scripts/logs-unificados.sh` ya entrega la vista unificada
de logs exigida, y los HPA requieren metrics-server instalado. La consola de gestion de RabbitMQ
se expone solo via `kubectl port-forward` (no como NodePort publico, para respetar la prohibicion
de puertos aleatorios).

## Requisitos

- Cluster K3s (1 servidor + 1 agente).
- `kubectl` y `kustomize` en la maquina que dispara el deploy (CI los instala solo).
- Imagenes en GHCR (`ghcr.io/cristhian-s1/atc-*`). QA/PROD usan `imagePullPolicy: IfNotPresent`.

## Despliegue (manual, para testing local - en CI es automatico)

```bash
kubectl apply -k k8s/overlays/qa      # o k8s/overlays/prod
kubectl wait -n grupo1-qa deployment/postgres-vuelos deployment/postgres-pistas \
  deployment/postgres-tasas deployment/rabbitmq \
  deployment/vuelos deployment/pistas deployment/tasas deployment/gateway \
  --for=condition=Available --timeout=180s
```

Logs unificados de todo el sistema:

```bash
./scripts/logs-unificados.sh grupo1-qa      # por defecto grupo1-qa
```

RabbitMQ Management (solo port-forward, no hay NodePort):

```bash
kubectl port-forward -n grupo1-qa svc/rabbitmq 15672:15672
# http://localhost:15672 (guest/guest)
```

## Configuracion de dominios (en la maquina del evaluador)

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
curl http://qa.grupo1.uta.cl/api/vuelos/ATC-K8S-001     # estado esperado: COMPLETADO
```

## Verificacion de backups (cada 10 minutos)

```bash
kubectl -n grupo1-qa get jobs --sort-by=.metadata.creationTimestamp
kubectl -n grupo1-qa logs -l job-name=backup-vuelos-*  --tail=20
# Listar respaldos en el PVC
kubectl -n grupo1-qa exec deployment/postgres-vuelos -- ls -la /backups
```

## CI/CD

GitHub Actions automatiza todo, sin accesos manuales:

- `push a develop`  -> `k8s/overlays/qa`   -> namespace `grupo1-qa`   (qa.grupo1.uta.cl)
- `push a main`     -> `k8s/overlays/prod`  -> namespace `grupo1-prod` (prod.grupo1.uta.cl)

Los workflows (`deploy-qa.yml`, `deploy-prod.yml`) buildean y empujan las 4 imagenes a GHCR,
luego `kustomize edit set image` inyecta el tag `qa-<sha>` / `<sha>` en cada overlay y aplican.

## Notas importantes

- `vuelos` corre con 1 replica en QA y PROD: el broadcast SSE es en memoria por pod. Escalarlo
  a 2+ replicas rompe SSE para clientes conectados al pod que no procesa el evento.
- `base/` usa `imagePullPolicy: Never` (imagenes locales). Los overlays lo parchean a `IfNotPresent`.
- El Secret `base/secrets.yaml` es plantilla con valores de ejemplo. En produccion cree el Secret
  por separado (no versionado) con `kubectl create secret generic atc-secrets ...`.
- Cada microservicio solo accede a su propia base de datos.
- Las imagenes son publicas en GHCR (proyecto academico) para evitar configurar imagePullSecret
  en el cluster. Si las haces privadas, crea un Secret con un PAT `read:packages` y referencialo
  como `imagePullSecrets` en los deployments.