#!/bin/sh
# Vista unificada de logs de TODOS los contenedores del sistema ATC.
# Uso: ./scripts/logs-unificados.sh [namespace]   (por defecto grupo1-qa)
NS="${1:-grupo1-qa}"
kubectl logs -n "$NS" \
  -l app.kubernetes.io/part-of=atc \
  --all-containers --prefix -f --max-log-requests 20
