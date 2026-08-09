# ─────────────────────────────────────────────────────────────────────────────
# Etapa 1 — build
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS build

WORKDIR /app

# Capa de dependencias aparte: no se reinstala si solo cambia el código.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# Vite empotra las variables VITE_* EN TIEMPO DE BUILD, no de ejecución.
# Por eso van como ARG y no como variables del contenedor: cambiarlas exige
# reconstruir la imagen, no basta con reiniciar.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_WELLNESS_API_URL
ARG GEMINI_API_KEY

ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
    VITE_WELLNESS_API_URL=$VITE_WELLNESS_API_URL \
    GEMINI_API_KEY=$GEMINI_API_KEY

# Falla pronto y con un mensaje claro si falta lo imprescindible: sin esto el
# build sale bien pero la aplicación revienta al arrancar en el navegador.
RUN test -n "$VITE_SUPABASE_URL"      || (echo "FALTA VITE_SUPABASE_URL" && exit 1) && \
    test -n "$VITE_SUPABASE_ANON_KEY" || (echo "FALTA VITE_SUPABASE_ANON_KEY" && exit 1)

RUN npm run build

# Comprobación de que Tailwind compiló de verdad. Sin vite.config.ts el build
# termina "bien" pero el CSS sale sin utilidades y la app se ve sin estilos.
RUN grep -q '\.flex{' dist/assets/*.css || \
    (echo "ERROR: el CSS no contiene utilidades de Tailwind. ¿Falta vite.config.ts?" && exit 1)

# ─────────────────────────────────────────────────────────────────────────────
# Etapa 2 — servir
# ─────────────────────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

# nginx:alpine ya corre los workers como usuario nginx.
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
