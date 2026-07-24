# Runbook — Despliegue e Infraestructura ATC (paso a paso con comandos)

Cada bloque indica **dónde** se ejecuta: VM `.20` (master), VM `.28` (worker), o tu PC (Windows).

---

## FASE 1 — Preparación de ambas VMs

**En VM `.20` y VM `.28` (por separado, mismos comandos en ambas):**

```bash
# Actualiza todos los paquetes del sistema a sus ultimas versiones (parches de seguridad, kernel, etc.)
sudo dnf upgrade -y

# curl: necesario para descargar el script de instalacion de K3s
# git: para clonar el repo si se necesita
# container-selinux: politicas SELinux requeridas por el runtime de contenedores de K3s
sudo dnf install -y curl git container-selinux

# Solo en la .20: renombra la VM para identificarla como nodo maestro del cluster
sudo hostnamectl set-hostname g1-master

# Solo en la .28: renombra la VM para identificarla como nodo worker
sudo hostnamectl set-hostname g1-worker
```

## FASE 2 — Firewall (en ambas VMs, mismos comandos)

El firewall de AlmaLinux bloquea todo por defecto. K3s necesita estos puertos abiertos para que los nodos se hablen entre si.

```bash
# Puerto del API server de K3s: kubectl y el nodo worker se conectan aqui
sudo firewall-cmd --permanent --add-port=6443/tcp

# VXLAN de Flannel: trafico de red overlay entre pods en distintos nodos
sudo firewall-cmd --permanent --add-port=8472/udp

# Puerto del kubelet: sondeos de salud que hace el API server a cada nodo
sudo firewall-cmd --permanent --add-port=10250/tcp

# HTTP/HTTPS publicos: Traefik (Ingress Controller) necesita escuchar 80 y 443
sudo firewall-cmd --permanent --add-service=http --add-service=https

# Rango de IPs de pods (Flannel default): marca la red interna como confiable
sudo firewall-cmd --permanent --zone=trusted --add-source=10.42.0.0/16

# Rango de IPs de Services (ClusterIP): igual, trafico interno de confianza
sudo firewall-cmd --permanent --zone=trusted --add-source=10.43.0.0/16

# Aplica las reglas permanentes al firewall activo sin reiniciar
sudo firewall-cmd --reload

# Verifica que todas las reglas quedaron cargadas correctamente
sudo firewall-cmd --list-all
```

## FASE 3 — Instalar K3s (master, VM `.20`)

Ejecutar SOLO en la VM maestra. Esto instala k3s server (control plane completo).

```bash
# Descarga y ejecuta el script oficial de K3s. -s = silent, -f = fail on error, -L = follow redirects
# AL terminar, el cluster ya esta funcionando: API server, scheduler, controllers, etcd, Traefik, CoreDNS
curl -sfL https://get.k3s.io | sh -

# Verifica que el nodo maestro aparece como Ready (puede tardar unos segundos)
sudo kubectl get nodes

# Token secreto que usa el worker para autenticarse al unirse al cluster.
# ¡IMPORTANTE! Copia esta salida completa: la necesitas en la FASE 4
sudo cat /var/lib/rancher/k3s/server/node-token
```

## FASE 4 — Unir el worker (VM `.28`)

Ejecutar SOLO en la VM worker. Reemplazar `<TOKEN>` por el token copiado en la FASE 3.

```bash
# K3S_URL: le dice al agente "el maestro esta en la VM .20, puerto 6443"
# K3S_TOKEN: token de autenticacion para que el maestro acepte la union
# El script instala k3s-agent (kubelet + containerd) y lo registra en el cluster
curl -sfL https://get.k3s.io | K3S_URL=https://146.83.102.20:6443 K3S_TOKEN=<TOKEN> sh -

# Confirma que el servicio del agente esta corriendo (should return "active")
sudo systemctl is-active k3s-agent
```

## FASE 5 — Verificación del clúster (en la `.20`)

Desde la VM maestra, confirmar que el cluster completo esta sano.

```bash
# Lista los nodos con IPs y roles. Deben aparecer g1-master y g1-worker, ambos STATUS=Ready
sudo kubectl get nodes -o wide

# Componentes de sistema de K3s en el namespace kube-system.
# coredns (DNS interno), traefik (Ingress controller) y metrics-server deben estar Running
sudo kubectl get pods -n kube-system
```

## FASE 6 — Namespaces del proyecto (en la `.20`)

Los namespaces aislan nuestros recursos de los de otros grupos que comparten el mismo cluster.

```bash
# QA: entorno de pruebas (qa.grupo1.uta.cl). Se despliega con push a develop
sudo kubectl create namespace grupo1-qa

# PROD: entorno de produccion (prod.grupo1.uta.cl). Se despliega con push a main
sudo kubectl create namespace grupo1-prod
```

## FASE 7 — Kubeconfig local para tu usuario (en la `.20`)

Por defecto K3s solo deja usar `kubectl` con `sudo`. Esto configura acceso sin `sudo` para el usuario `dici-uta`.

```bash
# Crea el directorio donde kubectl busca su configuracion
mkdir -p ~/.kube

# K3s guarda el kubeconfig en /etc/rancher/k3s/. Lo copiamos a la carpeta del usuario
sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config

# Cambia el dueño del archivo a dici-uta:dici-uta (por defecto es root)
sudo chown dici-uta:dici-uta ~/.kube/config

# Permisos restrictivos (solo el dueño lee/escribe): seguridad basica del kubeconfig
chmod 600 ~/.kube/config

# Prueba: ya debe listar nodos sin pedir sudo (usa el kubeconfig de ~/.kube)
kubectl get nodes
```

## FASE 8 — Publicar los manifiestos de Kubernetes (en tu PC, Git Bash)

Subir los YAML de `k8s/` y los workflows a GitHub para que el pipeline CI/CD los use.

```bash
cd /c/Proyectos/controlador-trafico-aereo     # entra al repo clonado desde Git Bash en Windows

git checkout develop                          # rama develop es la que dispara el deploy a QA

git add k8s .github/workflows                 # stagea todos los manifiestos y workflows

git commit -m "feat(k8s): manifiestos base y overlays de QA/PROD"  # versiona los cambios

git push                                      # push a develop dispara ci.yml + deploy-qa.yml
```

## FASE 9 — Runner self-hosted en la VM `.20`

**NOTA:** Este metodo requiere que la VM tenga salida a internet (para polling a github.com). Si las VMs del lab no tienen internet, esta fase queda bloqueada — usar el plan B de imagenes precargadas documentado en `docs/DIAGRAMAS-K8S-Y-CICD.md`.

El runner es un agente que corre dentro de la VM y ejecuta los jobs de GitHub Actions localmente (tiene acceso directo al API server del cluster).

```bash
mkdir actions-runner && cd actions-runner    # carpeta dedicada al agente

# Descarga el binario del runner. <URL-que-entrega-GitHub> se obtiene en:
# GitHub repo > Settings > Actions > Runners > New self-hosted runner
curl -o actions-runner-linux-x64-2.335.1.tar.gz -L <URL-que-entrega-GitHub>

# Verifica integridad del binario con el checksum SHA256 proporcionado por GitHub
echo "<SHA256-que-entrega-GitHub>  actions-runner-linux-x64-2.335.1.tar.gz" | sha256sum -c

tar xzf ./actions-runner-linux-x64-2.335.1.tar.gz  # extrae el runner

# Configura el runner: lo asocia al repo y lo autentica con <TOKEN> (tambien de GitHub)
./config.sh --url https://github.com/Cristhian-S1/controlador-trafico-aereo --token <TOKEN>

# Instala el runner como servicio del sistema (systemd) corriendo como dici-uta
sudo ./svc.sh install dici-uta

sudo ./svc.sh start                           # arranca el servicio

sudo ./svc.sh status                          # verifica que esta corriendo y conectado a GitHub
```

## FASE 10 — Generar kubeconfig para GitHub Secrets (en la `.20`)

El workflow deploy necesita una llave para hablar con el cluster. Esta la guardamos como Secret en GitHub.

```bash
# Lee el kubeconfig de K3s, cambia 127.0.0.1 por la IP real de la VM (146.83.102.20),
# y lo codifica en base64 en una sola linea (-w0 = sin saltos de linea)
sudo cat /etc/rancher/k3s/k3s.yaml | sed 's/127.0.0.1/146.83.102.20/' | base64 -w0
```

**Importante:** Copiar **toda** la salida (una linea larga en base64) y pegarla en GitHub → Settings → Secrets and variables → Actions, como `KUBECONFIG_QA` y `KUBECONFIG_PROD`. El workflow la decodifica y escribe en `~/.kube/config` para que `kubectl` funcione.

## FASE 11 — Configurar el archivo hosts (en tu PC, PowerShell como administrador)

Como los dominios `*.uta.cl` son ficticios (no existen en DNS real), debemos decirle a Windows que los resuelva a la IP de la VM maestra.

```powershell
# Agrega dos lineas al archivo hosts de Windows:
#   146.83.102.20  qa.grupo1.uta.cl prod.grupo1.uta.cl
# Ambos dominios apuntan a la misma IP publica de la VM maestra (Traefik :80)
Add-Content -Path C:\Windows\System32\drivers\etc\hosts -Value "146.83.102.20  qa.grupo1.uta.cl prod.grupo1.uta.cl"

# Verifica que las lineas se agregaron correctamente
Get-Content C:\Windows\System32\drivers\etc\hosts | Select-String grupo1

# Prueba de conectividad: ping al dominio QA debe responder 146.83.102.20
ping qa.grupo1.uta.cl
```

## FASE 12 — Disparar el despliegue (en tu PC)

Si el runner self-hosted esta funcionando y las VMs tienen internet, un push a develop dispara todo el pipeline.

```bash
git checkout develop                                 # rama que gatilla deploy-qa.yml

git pull                                             # sincroniza con el remoto

# Commit vacio (sin cambios de codigo): fuerza un push y dispara el workflow
git commit --allow-empty -m "ci: primer despliegue a QA"

git push                                             # push a develop -> build + deploy a grupo1-qa
```

**Verificacion en la VM maestra** (despues de que el pipeline termine):

```bash
# Lista todos los pods del proyecto en QA. Deben aparecer 11 pods (8 infra+apps + 3 replicas extra)
sudo kubectl get pods -n grupo1-qa

# CronJobs de backup: deben aparecer 3, uno por cada base (vuelos, pistas, tasas)
sudo kubectl get cronjobs -n grupo1-qa
```

## FASE 13 — Ensayo local de resiliencia (Kubernetes de Docker Desktop, en tu PC)

Antes de ir a las VMs, practicar en local los comandos de resiliencia que el docente ejecutara.

```powershell
# Cambia kubectl al cluster local de Docker Desktop (minikube-like integrado)
kubectl config use-context docker-desktop

kubectl get nodes                        # confirma que Docker Desktop Kubernetes esta funcionando

docker compose build                     # construye las 4 imagenes desde los Dockerfiles locales

# Etiqueta las imagenes con el nombre que espera GHCR. Tag :local para identificarlas
docker tag controlador-trafico-aereo-vuelos ghcr.io/cristhian-s1/atc-vuelos:local
docker tag controlador-trafico-aereo-pistas ghcr.io/cristhian-s1/atc-pistas:local
docker tag controlador-trafico-aereo-tasas ghcr.io/cristhian-s1/atc-tasas:local
docker tag controlador-trafico-aereo-gateway ghcr.io/cristhian-s1/atc-gateway:local

# Rama temporal para no ensuciar develop/main con cambios del overlay
git checkout -b ensayo-local

cd k8s/overlays/qa
# Reemplaza el tag qa-TAG por :local en las 4 imagenes (el overlay usa :local en vez de :qa-SHA)
kustomize edit set image atc-vuelos=ghcr.io/cristhian-s1/atc-vuelos:local atc-pistas=ghcr.io/cristhian-s1/atc-pistas:local atc-tasas=ghcr.io/cristhian-s1/atc-tasas:local atc-gateway=ghcr.io/cristhian-s1/atc-gateway:local
cd ../../..

# Aplica los 32 recursos del overlay QA en el cluster local de Docker Desktop
kubectl apply -k k8s/overlays/qa

# Verifica que los pods arrancan (puede tardar ~30s en readiness)
kubectl get pods -n grupo1-qa
```

**Prueba de resiliencia (simula lo que hara el docente):**

```bash
# 1. Identifica el pod de postgres-vuelos
kubectl get pods -n grupo1-qa -l app=postgres-vuelos

# 2. MATA el pod a la fuerza (--force --grace-period=0 = sin esperar shutdown limpio)
#    Esto simula una caida real del contenedor
kubectl delete pod <nombre-del-pod> -n grupo1-qa --force --grace-period=0

# 3. Mira en tiempo real (-w = watch) como el pod viejo muere (Terminating)
#    y el Deployment crea uno nuevo automaticamente
kubectl get pods -n grupo1-qa -w

# 4. Verifica que los CronJobs de backup estan configurados
kubectl get cronjobs -n grupo1-qa

# 5. Si paso suficiente tiempo, revisa los Jobs de backup ejecutados
kubectl get jobs -n grupo1-qa

# 6. Simula caida del worker pistas (tiene 2 replicas: una sigue viva, la otra se recrea)
kubectl delete pod -n grupo1-qa -l app=pistas --force --grace-period=0

# 7. Observa como el pod de pistas eliminado se recrea (quedan 2 de nuevo)
kubectl get pods -n grupo1-qa -w

# 8. PRUEBA CLAVE: despues de recrear postgres, verifica que los datos sobrevivieron
kubectl exec -n grupo1-qa deployment/postgres-vuelos -- psql -U atc -d vuelos -c "SELECT COUNT(*) FROM vuelos;"
# Debe devolver el mismo conteo que antes de borrar el pod
```

**Limpieza al terminar el ensayo:**

```bash
# Vuelve a la rama develop y descarta la rama temporal del overlay
git checkout develop
git branch -D ensayo-local
```
