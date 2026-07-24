# Runbook — Despliegue e Infraestructura ATC (paso a paso con comandos)

Cada bloque indica **dónde** se ejecuta: VM `.20` (master), VM `.28` (worker), o tu PC (Windows).

---

## FASE 1 — Preparación de ambas VMs

**En VM `.20` y VM `.28` (por separado, mismos comandos en ambas):**

```bash
sudo dnf upgrade -y
sudo dnf install -y curl git container-selinux

# Solo en la .20:
sudo hostnamectl set-hostname g1-master
# Solo en la .28:
sudo hostnamectl set-hostname g1-worker
```

## FASE 2 — Firewall (en ambas VMs, mismos comandos)

```bash
sudo firewall-cmd --permanent --add-port=6443/tcp
sudo firewall-cmd --permanent --add-port=8472/udp
sudo firewall-cmd --permanent --add-port=10250/tcp
sudo firewall-cmd --permanent --add-service=http --add-service=https
sudo firewall-cmd --permanent --zone=trusted --add-source=10.42.0.0/16
sudo firewall-cmd --permanent --zone=trusted --add-source=10.43.0.0/16
sudo firewall-cmd --reload
sudo firewall-cmd --list-all
```

## FASE 3 — Instalar K3s (master, VM `.20`)

```bash
curl -sfL https://get.k3s.io | sh -
sudo kubectl get nodes
sudo cat /var/lib/rancher/k3s/server/node-token   # copiar este token
```

## FASE 4 — Unir el worker (VM `.28`)

```bash
curl -sfL https://get.k3s.io | K3S_URL=https://146.83.102.20:6443 K3S_TOKEN=<TOKEN> sh -
sudo systemctl is-active k3s-agent
```

## FASE 5 — Verificación del clúster (en la `.20`)

```bash
sudo kubectl get nodes -o wide          # ambos nodos deben salir Ready
sudo kubectl get pods -n kube-system    # coredns, traefik, metrics-server Running
```

## FASE 6 — Namespaces del proyecto (en la `.20`)

```bash
sudo kubectl create namespace grupo1-qa
sudo kubectl create namespace grupo1-prod
```

## FASE 7 — Kubeconfig local para tu usuario (en la `.20`)

```bash
mkdir -p ~/.kube
sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
sudo chown dici-uta:dici-uta ~/.kube/config
chmod 600 ~/.kube/config
kubectl get nodes   # ya sin sudo
```

## FASE 8 — Publicar los manifiestos de Kubernetes (en tu PC, Git Bash)

```bash
cd /c/Proyectos/controlador-trafico-aereo
git checkout develop
git add k8s .github/workflows
git commit -m "feat(k8s): manifiestos base y overlays de QA/PROD"
git push
```

## FASE 9 — Runner self-hosted en la VM `.20`

```bash
mkdir actions-runner && cd actions-runner
curl -o actions-runner-linux-x64-2.335.1.tar.gz -L <URL-que-entrega-GitHub>
echo "<SHA256-que-entrega-GitHub>  actions-runner-linux-x64-2.335.1.tar.gz" | sha256sum -c
tar xzf ./actions-runner-linux-x64-2.335.1.tar.gz
./config.sh --url https://github.com/Cristhian-S1/controlador-trafico-aereo --token <TOKEN>
sudo ./svc.sh install dici-uta
sudo ./svc.sh start
sudo ./svc.sh status
```

## FASE 10 — Generar kubeconfig para GitHub Secrets (en la `.20`)

```bash
sudo cat /etc/rancher/k3s/k3s.yaml | sed 's/127.0.0.1/146.83.102.20/' | base64 -w0
```

Copiar la salida completa y crearla en GitHub → Settings → Secrets and variables → Actions, como `KUBECONFIG_QA` y `KUBECONFIG_PROD`.

## FASE 11 — Configurar el archivo hosts (en tu PC, PowerShell como administrador)

```powershell
Add-Content -Path C:\Windows\System32\drivers\etc\hosts -Value "146.83.102.20  qa.grupo1.uta.cl prod.grupo1.uta.cl"
Get-Content C:\Windows\System32\drivers\etc\hosts | Select-String grupo1
ping qa.grupo1.uta.cl
```

## FASE 12 — Disparar el despliegue (en tu PC)

```bash
git checkout develop
git pull
git commit --allow-empty -m "ci: primer despliegue a QA"
git push
```

Verificación en la VM:

```bash
sudo kubectl get pods -n grupo1-qa
sudo kubectl get cronjobs -n grupo1-qa
```

## FASE 13 — Ensayo local de resiliencia (Kubernetes de Docker Desktop, en tu PC)

```powershell
kubectl config use-context docker-desktop
kubectl get nodes

docker compose build
docker tag controlador-trafico-aereo-vuelos ghcr.io/cristhian-s1/atc-vuelos:local
docker tag controlador-trafico-aereo-pistas ghcr.io/cristhian-s1/atc-pistas:local
docker tag controlador-trafico-aereo-tasas ghcr.io/cristhian-s1/atc-tasas:local
docker tag controlador-trafico-aereo-gateway ghcr.io/cristhian-s1/atc-gateway:local

git checkout -b ensayo-local
cd k8s/overlays/qa
kustomize edit set image atc-vuelos=ghcr.io/cristhian-s1/atc-vuelos:local atc-pistas=ghcr.io/cristhian-s1/atc-pistas:local atc-tasas=ghcr.io/cristhian-s1/atc-tasas:local atc-gateway=ghcr.io/cristhian-s1/atc-gateway:local
cd ../../..

kubectl apply -k k8s/overlays/qa
kubectl get pods -n grupo1-qa
```

**Prueba de resiliencia:**

```bash
kubectl get pods -n grupo1-qa -l app=postgres-vuelos
kubectl delete pod <nombre-del-pod> -n grupo1-qa --force --grace-period=0
kubectl get pods -n grupo1-qa -w

kubectl get cronjobs -n grupo1-qa
kubectl get jobs -n grupo1-qa

kubectl delete pod -n grupo1-qa -l app=pistas --force --grace-period=0
kubectl get pods -n grupo1-qa -w
```

**Limpieza al terminar el ensayo:**

```bash
git checkout develop
git branch -D ensayo-local
```
