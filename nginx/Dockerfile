# Etapa 1: Build del frontend Next.js
FROM node:18-alpine AS builder

WORKDIR /app

# Instalar dependencias
COPY frontend/package*.json ./
RUN npm ci

# Copiar fuente y compilar export estatico
COPY frontend/ ./
ENV NEXT_PUBLIC_API_BASE_URL=""
RUN npm run build

# Etapa 2: Servir con Nginx
FROM nginx:alpine

# Copiar archivos estaticos generados
COPY --from=builder /app/out /usr/share/nginx/html

# Copiar configuracion personalizada
COPY nginx/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
