# Despliegue en Docker

Para desplegar la SPA en un servidor propio (por ejemplo `187.33.153.78`).

La aplicación es **estática**: `vite build` genera archivos que sirve nginx. El
navegador habla directamente con Supabase, así que el contenedor no necesita
acceso a la base ni credenciales en ejecución.

---

## Antes de empezar

**Comprueba que el puerto está libre.** En `187.33.153.78` ya están ocupados
5432 y 6543 (Supavisor), 8000 y 8443 (Kong), 80 y 22. Por defecto usamos 8095:

```bash
ss -tulnp | grep 8095   # sin salida = libre
```

**Memoria.** El build de Node necesita ~1,5 GB. Con Omada fuera hay ~4,9 GB
libres, así que construir en el propio servidor es viable. Si alguna vez falla
por memoria, construye la imagen en GitHub Actions y aquí solo haz `pull`.

---

## 1. Clonar y configurar

```bash
cd /root
git clone -b claude/tenant-isolation-rls \
  https://github.com/usettt19-eng/MULTI_TENANT_SFSMPICKUP.git sfsmpickup
cd sfsmpickup

cp .env.example .env
nano .env
```

Rellena en `.env`:

```bash
VITE_SUPABASE_URL=https://fvzhfzogigewsvcyopel.supabase.co
VITE_SUPABASE_ANON_KEY=<la clave anon del proyecto>
VITE_WELLNESS_API_URL=            # vacío; no se usa desde que /api/ va por nginx
GEMINI_API_KEY=<la clave de Gemini>
HOST_PORT=8095

# La API interna (server/) — ver DISENO-Y-AVANCE.md §6.
# NUNCA con prefijo VITE_: si lo lleva, Vite la empotra en el bundle del
# navegador. Esta es la llave maestra que salta toda política RLS.
# Supabase -> Project Settings -> API -> service_role
SUPABASE_SERVICE_ROLE_KEY=<la clave service_role>

# Opcional: si se define, el autoregistro público de colegios (la landing)
# exige este token. Vacío = cualquiera puede autoregistrar un colegio.
TENANT_SIGNUP_TOKEN=
```

El `docker compose build` ahora construye **dos** imágenes: `sfsmpickup`
(frontend) y `sfsmpickup-api` (backend). El backend no publica ningún puerto al
host — solo lo alcanza nginx, dentro de la red interna de Docker.

Los valores exactos que usa hoy la app están en Vercel, en
**Project → Settings → Environment Variables**.

> **Importante:** Vite empotra estas variables **al construir**, no al
> ejecutar. Si cambias una, hay que reconstruir la imagen — reiniciar el
> contenedor no basta.

> **Sobre `GEMINI_API_KEY`:** acaba dentro del JavaScript que descarga cada
> usuario, así que es extraíble. Es el comportamiento actual, no una regresión
> de este despliegue, pero conviene resolverlo (ver `DISENO-Y-AVANCE.md` §5.2).

## 2. Construir y levantar

```bash
docker compose build
docker compose up -d
docker compose logs -f          # Ctrl-C para salir
```

## 3. Comprobar

```bash
curl -I http://localhost:8095/                    # 200
curl -s http://localhost:8095/ | grep -o '<title>.*</title>'
curl -I http://localhost:8095/external?qr=test    # 200, no 404 (fallback SPA)
curl -s http://localhost:8095/ | grep -oE 'assets/index-[^"]+\.css'
```

Ese último te da el nombre del CSS. Descárgalo y confirma que Tailwind compiló:

```bash
curl -s http://localhost:8095/assets/index-XXXX.css | grep -c '\.flex{'
```

Debe devolver **1 o más**. Si devuelve 0, el CSS salió sin utilidades y la app
se verá sin estilos. (El propio `Dockerfile` ya aborta el build en ese caso.)

## 4. Publicar hacia fuera

El contenedor solo escucha en el puerto local. Para exponerlo con dominio y
TLS, apúntale tu proxy inverso como haces con los demás proyectos de la
máquina. Si usas Caddy:

```
pickup.tudominio.com {
    reverse_proxy localhost:8095
}
```

Con nginx en el host, un `proxy_pass http://127.0.0.1:8095;` equivalente.

**No publiques el puerto 8095 directamente a internet sin TLS**: la aplicación
maneja sesiones y datos de menores.

---

## Actualizar

```bash
cd /root/sfsmpickup
git pull
docker compose build
docker compose up -d
```

## Volver atrás

Las imágenes anteriores siguen en disco:

```bash
docker images sfsmpickup
docker tag sfsmpickup:<id-anterior> sfsmpickup:latest
docker compose up -d
```

---

## Qué está verificado y qué no

**Verificado en un entorno real:**

- `npm ci` y `vite build` completan.
- Tailwind compila: el CSS pasa de 23 KB con 1 clase (sin `vite.config.ts`) a
  **83,8 KB con las utilidades** (`.flex`, `.w-full`, `.bg-slate-50`…).
- `docker compose config` valida sin errores.

**No verificado:** el `docker build` completo y el arranque de nginx. El
entorno donde se preparó esto tiene el registro de Docker Hub bloqueado, así
que no se pudieron descargar las imágenes base. **Vigila la primera
construcción**; el `Dockerfile` lleva dos comprobaciones que abortan si algo
va mal (variables ausentes y CSS sin Tailwind).

## Notas

- **`vite.config.ts` no estaba en el repositorio.** Sin él, Vite no carga
  `@tailwindcss/vite` ni `@vitejs/plugin-react`, y la app se construye sin
  estilos. Se añadió, junto con `tsconfig.json` y `package-lock.json`.
- **`@supabase/supabase-js` estaba en `optionalDependencies`.** Se movió a
  `dependencies`: como dependencia opcional, un `npm ci --no-optional` o un
  fallo de resolución produciría una imagen rota.
- Los modelos de `face-api.js` se siguen descargando de `raw.githubusercontent.com`
  en tiempo de ejecución, así que **la tablet de la puerta necesita salida a
  internet hacia GitHub**. Ver `DISENO-Y-AVANCE.md` §5.3.
