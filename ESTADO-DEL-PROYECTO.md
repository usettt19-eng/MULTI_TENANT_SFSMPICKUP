# Safe Smart Pickup — Estado del proyecto y estructura de datos

Documento único de referencia: qué hace el software hoy, todo lo que se le agregó
en orden, y cómo está armada la base de datos en Supabase. Última actualización:
2026-08-20 (app iOS enviada a revisión de Apple).

> Para el detalle de la auditoría de seguridad original y los pendientes técnicos
> con su razonamiento, ver `DISENO-Y-AVANCE.md`. Para los pasos exactos de
> `docker compose` en el servidor, ver `DESPLIEGUE.md`. Este documento es el
> resumen ejecutivo + el mapa completo de la base de datos.

---

## 1. Qué es el producto

SaaS **multi-tenant de recogida escolar**. Los clientes son colegios (tenants);
los usuarios son padres/tutores, personal del colegio (profesores, seguridad,
recepción, administración) y un super_admin del proveedor.

Un padre puede tener hijos en más de un colegio cliente y gestionarlos desde una
sola cuenta. Ese requisito condiciona todo el modelo de permisos: el aislamiento
es **por pertenencia** (`tenant_id IN user_tenant_ids()`), no por igualdad de un
único `tenant_id` en el perfil.

### Colegios dados de alta hoy

| Colegio | `tenant_id` | Dominio | Estado |
|---|---|---|---|
| Colegio Loyola | `3cc8eb07-a7f8-40bd-9886-23ae86bf505f` | — | Pruebas |
| Colegio Loyola 2 | `11d93213-5e22-430c-beb8-2f730cba3a97` | `loyola` | Pruebas |
| The Casco School | `9543ac45-f058-4596-a7ee-e29191494190` | `The_Casco_School` | **Activo** |
| TCS Albrook | `65221dec-d0d2-448c-a3e2-64a899e380c4` | `tcsalbrook` | En implementación |

---

## 2. Funcionalidades del software (estado actual)

### Para padres/tutores (app web + Android)
- Login por invitación (nunca contraseña por correo) + magic link para volver a
  entrar si la sesión expira.
- Anunciar llegada / recogida de cada hijo, con geocerca automática en Android
  (llegada y salida del perímetro se detectan solas, sin botón).
- Reconocimiento facial opcional en la puerta (`face-api.js`, corre en el
  navegador/tablet, sin llamada a servidor).
- **Pool Day**: autorizar a otro padre a recoger a tu hijo un día fijo de la
  semana o como excepción de un solo día; búsqueda de padres por nombre
  (ignora tildes/mayúsculas), con sugerencia de compañeros del mismo salón.
- Solicitud de reemplazo (persona distinta autorizada a recoger).
- Centro de mensajes / notificaciones.
- Registro de vehículo (placa + descripción) en el alta.
- App Android nativa (Capacitor) distribuida por link de descarga en el correo
  de invitación, servida desde un bucket público de Supabase Storage.

### Para personal / administración del colegio
- Dashboard operativo (cola en vivo, sincronización en tiempo real).
- Gestión de alumnos, padres/tutores (alta individual y **carga masiva por
  CSV**, con auto-vinculación padre↔alumno por nombre).
- Gestión de personal (alta individual y **carga masiva por CSV**, con permisos
  por módulo).
- Estructura del colegio: puertas de salida, grados (crear, **editar nombre y
  orden después de creados**), secciones por grado (persistidas, se pueden
  agregar y quitar desde Horarios de Salida).
- Horarios de salida por grado/sección/día, con modo distinto para primaria
  (un encargado toda la semana) y secundaria (uno por día), más excepciones de
  un solo día.
- Bienestar: incidentes y medicación de alumnos, con alertas críticas
  automáticas (trigger `create_critical_alert_for_med_schedule`).
- Registro de visitantes, formularios/encuestas dirigidos por grado.
- Bitácora de auditoría de todo evento sensible.
- Verificación de tutores / monitor externo (pantalla de puerta con cola y
  escaneo QR).
- **Modo super_admin → "Entrar como Admin"**: el super_admin puede impersonar a
  un colegio específico para configurarlo de punta a punta (uso pensado para
  onboarding de colegios nuevos), con aislamiento de datos verificado entre
  colegios (ver §4 más abajo).

### Multi-tenant / plataforma
- `SuperAdminDashboard`: alta de colegios, estadísticas por colegio, contacto
  del administrador principal de cada uno, reseteo de contraseña de soporte.
- Aislamiento estricto por `tenant_id` reforzado en dos capas: RLS en Postgres
  + filtros explícitos en cada consulta del frontend (ver §4).

---

## 3. Historial de actualizaciones (orden cronológico por tema)

### Base de datos y aislamiento multi-tenant
- Volcado de rollback de las 58 políticas RLS previas a la migración (punto de
  referencia por si hacía falta revertir).
- Cierre del acceso público (`anon`) a datos de menores — ~30 políticas
  `TO public USING (true)` sobre `health_alerts`, `medication_schedule`,
  `student_incidents`, `profiles`, `pickup_events` (incluía `ALL`, o sea
  cualquiera podía crear/borrar recogidas) y varias más.
- Aislamiento entre colegios aplicado por RLS a todas las tablas de datos.
- Cierre de la vista y funciones auxiliares que rodeaban RLS; `EXECUTE`
  revocado también a `anon` en las funciones de apoyo.
- `super_admin`: permiso explícito para auditar colegios de los que no es
  miembro (necesario para dar soporte).

### Correo real e invitaciones (Amazon SES)
- Verificación de `safesmartpickup.com` en SES con Easy DKIM.
- Configuration Set propio (`sfsmpickup-transactional`), separado del que usa
  el FusionPBX en la misma cuenta AWS.
- Rebotes/quejas enganchados por SNS a `info@safesmartpickup.com`.
- Credenciales SMTP de un IAM dedicado, cargadas en Supabase Auth, con Rate
  Limits subido.
- Plantillas de Invite/Magic Link bilingües (inglés + español).
- Los 4 puntos de alta (`tenants/register`, `parents`, `parents/bulk`, `staff`)
  pasaron de `createUser({password})` a `inviteUserByEmail()` — se envía
  correo real en vez de crear cuentas silenciosas.
- Login gana botón de magic link (`signInWithOtp`) para invitados sin
  contraseña.
- Cierre del autoregistro público de padres (`signUp()` directo con código de
  colegio) — era un flujo paralelo que no pasaba por invitación.
- Fix de PKCE: detectar correctamente el flujo de invitación/recuperación para
  que el usuario invitado pueda de verdad fijar su contraseña.

### Apps móviles (Capacitor)
- App Android generada (build en GitHub Actions, `assembleDebug` sin firmar;
  requiere Node ≥22 para `@capacitor/cli`).
- App iOS scaffold (en standby — pendiente de credenciales de Apple Developer
  del cliente).
- **2026-08-19 — Primer build de iOS subido a TestFlight, de punta a punta**:
  se generaron en Apple Developer/App Store Connect el App ID
  (`com.safesmartpickup.app`), el certificado "Apple Distribution", el
  perfil de aprovisionamiento tipo App Store, y una API Key de App Store
  Connect (rol "App Manager") — cargados como Secrets del repo. Workflow
  `ios-deploy.yml`: compila firmado y sube el `.ipa` a App Store Connect,
  se dispara a mano desde Actions (consume un número de build por
  corrida). Tres bugs reales del proyecto, encontrados y corregidos
  durante el primer despliegue (no simulados, cada uno rompió un intento
  real):
  1. `ios-build.yml` tenía un paso `pod install` que siempre fallaba — el
     proyecto usa Swift Package Manager, no CocoaPods, no hay Podfile.
  2. Ambos workflows compilaban con `-workspace App.xcworkspace`, que
     nunca existió (ese archivo lo genera CocoaPods) — se cambió a
     `-project App.xcodeproj`.
  3. El proyecto no tenía ningún **esquema de Xcode compartido**
     committeado (`xcuserdata` está en `.gitignore`, así que el esquema
     autogenerado por Xcode nunca se subió) — se agregó a mano
     `ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme`, sin el
     cual `xcodebuild -scheme App` no resuelve nada en un checkout limpio
     de CI.
  4. El target tiene `CODE_SIGN_IDENTITY = "iPhone Developer"` fijo en el
     proyecto (config heredada del template de Capacitor); sin
     sobreescribirlo, el archive pedía un certificado de desarrollo en vez
     de usar el de distribución cargado — se agregó
     `CODE_SIGN_IDENTITY="Apple Distribution"` al `xcodebuild archive`.
  Build 3 (`build_number: 3`) subió con éxito. La app iOS ya se puede
  distribuir por TestFlight; falta invitar testers y, cuando se quiera
  publicar, completar la ficha de la App Store (capturas, descripción) en
  App Store Connect.
- App Android sigue funcionando de punta a punta como antes (sin cambios
  en esta sesión).
- **2026-08-19 — Ficha de tienda: política de privacidad y soporte
  publicadas**: `public/privacy.html` (bilingüe ES/EN — qué datos se
  recopilan, geocerca opcional, reconocimiento facial procesado en el
  propio dispositivo, tratamiento de datos de menores, retención,
  contacto) y `public/support.html`, servidas como HTML estático en
  `https://safesmartpickup.com/privacy.html` y `/support.html`.
  Requeridas por Apple y Google Play para publicar la ficha de la app.
- **2026-08-19 — Cuenta de Google Play Console recreada**: la cuenta
  anterior ("USE SERVICES") fue cerrada por Google en marzo 2024 por
  inactividad — no es reversible, el pago de $25 no es reembolsable. Se
  creó una cuenta de organización nueva ("Use Union de Servicios
  Especializados", ID `9115502081694003474`), vinculada al D-U-N-S ya
  existente de la empresa (`816808791`). **Pendiente**: verificación de
  identidad por Google (varios días) y, después de esa, verificación de
  los números de teléfono — bloquea poder publicar hasta completarse.
- **2026-08-19 — Ícono real de la app**: se reemplazó el ícono genérico
  de Capacitor (una "X" azul de plantilla) por el escudo del logo real de
  Safe Smart Pickup, recortado del banner de marketing (`public/logo.png`)
  sin el texto (no se lee a tamaño de ícono). Actualizado en iOS
  (`AppIcon-512@2x.png`) y Android (mipmaps de las 5 densidades, versión
  cuadrada, circular y de capa "adaptive" con zona segura). El ícono
  512×512 para la ficha de Google Play también quedó preparado, pendiente
  de subir cuando la cuenta de Play Console termine su verificación.
- **2026-08-19 — Fix de crash de iOS al pedir ubicación**: en pruebas
  reales de TestFlight, la app se cerraba al instante al activar la
  geocerca. Causa: `Info.plist` no tenía
  `NSLocationAlwaysAndWhenInUseUsageDescription` — el plugin
  `@capacitor-community/background-geolocation` pide autorización
  "Always" para la geocerca, y sin esa clave iOS mata la app en vez de
  mostrar el diálogo de permiso (confirmado contra la documentación
  oficial del plugin). Se agregaron `NSLocationAlwaysAndWhenInUseUsageDescription`,
  `NSLocationAlwaysUsageDescription` y `UIBackgroundModes: [location]`.
- **2026-08-20 — App iOS enviada a revisión de Apple** (build 5, versión
  1.0). Se completó toda la ficha de App Store Connect:
  - Categoría: Educación. Subtítulo, descripción, palabras clave, texto
    promocional, URLs de soporte/marketing/privacidad, copyright.
  - Ícono de la app: mismo escudo recortado del logo real (ver más
    arriba).
  - 5 capturas de iPhone (6,5"), reales, tomadas por el usuario en su
    propio dispositivo desde TestFlight — se limpiaron 3 de ellas con
    edición de imagen (recorte/relleno de color) para quitar el banner
    de "TestFlight" que aparece superpuesto sobre la UI real cuando se
    corre desde ahí, ya que Apple no permite mostrar chrome de otras
    apps en las capturas de la ficha.
  - 2 capturas de iPad (13"), generadas localmente: `safesmartpickup.com`
    y el proyecto de Supabase están bloqueados por la política de red de
    este entorno de trabajo (egress proxy — confirmado con `curl` contra
    el endpoint de estado del proxy, error 403 de política, no un
    problema de configuración), así que no se pudo automatizar un login
    real contra producción. En su lugar se corrió el frontend localmente
    (`npx vite`, con `.env.local` temporal con las credenciales públicas
    del proyecto Supabase, borrado después) y se capturó con Playwright
    a la resolución nativa exacta de iPad de 13" (2064×2752, viewport
    1032×1376 @2x) — solo alcanzó para la pantalla de login/marca (no
    requiere backend), suficiente para cumplir el mínimo de Apple.
  - Cuenta de revisión para el equipo de Apple: se creó una cuenta de
    padre de prueba (`applereview@safesmartpickup.com`) en el tenant de
    pruebas vacío "Colegio Loyola 2", con un alumno ficticio ya
    vinculado, insertada directamente en `auth.users`/`auth.identities`
    vía SQL (con `pgcrypto`) para que tenga contraseña utilizable sin
    pasar por el flujo de invitación por correo (los revisores no pueden
    recibir/abrir esos correos).
  - Clasificación por edad: 13+ (por el módulo de bienestar/medicación,
    marcado como "poco frecuente" — honesto en vez de declarar "ninguno"
    para evitar un rechazo posterior por inconsistencia).
  - Cumplimiento de cifrado (export compliance): cifrado estándar
    (HTTPS/TLS), sin distribución en Francia.
  - Reglamento de Servicios Digitales (DSA) de la UE: declarado "no
    comerciante / sin intención de distribuir en la UE" — coherente con
    que la disponibilidad de la app se limitó a 39 países (Panamá +
    Latinoamérica + EE. UU./Canadá), sin Europa.
  - Privacidad de la app ("nutrition label"): 9 tipos de datos declarados
    (nombre, correo, teléfono, salud, ubicación exacta, fotos/vídeos,
    otro contenido del usuario, historial de búsqueda, ID de usuario),
    todos con finalidad única "Funcionalidad de la app", vinculados a la
    identidad del usuario, sin uso para tracking.
  - Precio: gratis. Disponibilidad: Estados Unidos, Canadá, y toda
    América Latina y el Caribe (39 países) — sin Europa ni Asia-Pacífico.
  - Publicación: manual (no automática al aprobarse), para controlar el
    momento exacto del lanzamiento público.
  **Estado: en cola de revisión de Apple, hasta 48 horas.**
- Distribución del APK por bucket público de Supabase Storage.
- Geocerca en segundo plano para llegada/salida automática del padre.
- Auto-confirmación de recogida si el padre sale del perímetro sin confirmar.
- Panel en vivo de qué padres están dentro del perímetro.
- Fix de bucle de auto-anuncio repetido al quedarse cerca del perímetro.
- Fix de bug de closure obsoleto que usaba coordenadas por defecto del colegio
  en vez de las reales al calcular distancia.

### Pool Day (recogida compartida entre padres)
- Tablas `carpool_authorizations` (recurrente, por día de semana) y
  `carpool_overrides` (excepción de un día).
- Búsqueda de padres por nombre completo, insensible a mayúsculas y tildes.
- Sugerencia automática de padres del mismo salón al configurar.
- Corrección de la consulta a `parent_students` que rompía la función por
  completo (la tabla no tiene columna `id`).
- Corrección del rol usado para validar al conductor (`'guardian'` no existe
  en el enum; el rol correcto es `'parent'`).
- Eventos de Pool Day visibles en el Inbox de recepción/administración.

### Importación masiva (CSV)
- Alta masiva de padres con auto-vinculación a estudiantes por nombre
  (columna opcional `student_names`, separador `|`).
- Vehículo (placa + descripción) sumado a la plantilla de importación de
  padres.
- Reporte de filas fallidas de la importación (no todo o nada).
- **Alta masiva de personal por CSV** (`/api/staff/bulk`), mismo patrón:
  invitación secuencial fila por fila (no en paralelo, por el rate limit de
  Supabase Auth), con permisos por módulo en una columna adicional.
- Fix de BOM en la plantilla CSV que rompía el backend en producción.

### Backend / API
- Implementación completa del backend que faltaba: 16+ endpoints `/api/...`
  con Node + Express + TypeScript, usando la clave `service_role` pero
  validando el JWT de cada llamada contra el colegio del recurso (nunca
  confía en un `tenant_id` que venga en el cuerpo de la petición).
- Cierre del autoregistro público de colegios (`POST /tenants/register` exige
  `requireAuth` + `requireSuperAdmin`).
- Log del motivo real cuando `requireAuth` rechaza un token (antes era un 401
  mudo, costaba depurar).

### "Entrar como Admin" e impersonación (agosto 2026)
- Botón en `SuperAdminDashboard` para que el super_admin impersone a un
  colegio y lo configure directamente (pensado para el onboarding recurrente
  de colegios nuevos) — cambia solo el `profile` del lado del cliente
  (`role: 'admin'`, `tenant_id` del colegio elegido); el rol real en
  Postgres/JWT sigue siendo `super_admin`. Persistido en `sessionStorage`,
  con banner fijo para salir.
- **Fuga de datos entre colegios descubierta y corregida**: como
  `is_staff_of()`/`isAdminOf()` devuelven `true` para cualquier
  `super_admin` sin importar el `tenant_id`, cualquier pantalla que confiara
  solo en RLS (sin filtro explícito `.eq('tenant_id', ...)`) mostraba datos
  de **todos** los colegios en vez del que se estaba impersonando. Se
  corrigió en 13 pantallas/componentes, agregando filtro explícito por
  `tenant_id`, guarda si no hay `tenant_id` aún, y refetch al cambiar de
  colegio impersonado. De paso se cerraron dos riesgos de escritura
  cruzada (`.single()` sin filtro en `Settings.tsx`/`Sidebar.tsx`, que podía
  corromper la config de otro colegio) y un PIN de check-in que podía
  autenticar al padre equivocado en una colisión de 4 dígitos.
- `SuperAdminDashboard` ahora muestra el administrador principal de cada
  colegio (nombre, correo, teléfono).

### Configuración escolar (grados, secciones, horarios)
- Horario de salida por grado/sección/día (con excepciones de un día) —
  tabla `dismissal_assignments` + `dismissal_overrides`.
- Fix de ambigüedad en el join a `profiles` en las consultas de
  `dismissal_overrides`.
- Edición de nombre y orden de un grado ya creado (antes solo se podía fijar
  al crearlo).
- **Fix de secciones que no se guardaban**: las secciones agregadas en
  "Horarios de Salida" solo existían en estado de React derivado de
  asignaciones existentes — desaparecían al salir si no tenían encargado
  asignado. Se agregó la columna real `school_grades.sections text[]`, con
  botón para agregar y quitar sección, persistido de inmediato.

### Dashboard / i18n
- Corrección de etiquetas mal identificadas ("Quick Scan" en realidad abría
  alta de padres → "Add Parent"; "Handover" y "External Monitor" eran la
  misma pantalla con dos nombres).
- Traducción de Bienestar, Firma de Invitados, Monitor Externo, Solicitudes y
  el resto de etiquetas fijas en español/inglés que no pasaban por `t()`.
- Se quitó del dashboard la sección "Staff-to-Child Ratios" y el
  "throughput 94%" — eran datos inventados del template original, no salían
  de la base de datos.

### Documentación
- `DISENO-Y-AVANCE.md`: arquitectura, auditoría de seguridad y pendientes.
- Sesión de correo real + apps móviles + limpieza de dashboard documentada.
- Manual de llenado para onboarding de colegios nuevos (a rellenar por el
  administrador del colegio).
- Manual de uso de la app de padres (flujo básico, reemplazo/entrega, Pool
  Day, notificaciones), en español e inglés.

### Infraestructura de despliegue (self-hosted)
- Se pasó de Vercel a **Docker Compose auto-alojado** en servidor propio
  (`use-services2026`, carpeta `/root/sfsmpickup`): contenedor `sfsmpickup`
  (nginx + build de la SPA, expuesto solo en `127.0.0.1:8095`) + contenedor
  `api` (backend Express, **sin puerto publicado al host** — solo alcanzable
  vía la red interna de Docker).
- nginx del contenedor enruta `/api/` al servicio `api` antes del fallback de
  la SPA, con reintento de DNS de Docker (para no cachear la IP si el
  contenedor `api` se reinicia) y devuelve JSON con 503 si el backend está
  caído (en vez de la página HTML de error, que rompía el `JSON.parse` del
  frontend).
- **nginx externo del host** (`/etc/nginx/sites-available/safesmartpickup.com`,
  gestionado por Certbot/Let's Encrypt) hace de frontera real de
  `safesmartpickup.com` → `127.0.0.1:8095`. Corregido el 2026-08-19: no tenía
  `proxy_read_timeout` propio (default 60s de nginx), así que una importación
  CSV grande (invitaciones secuenciales) podía superar ese tiempo y el
  usuario veía el error genérico de nginx en vez de la respuesta del backend.
  Se subió a `proxy_connect_timeout 10s` / `proxy_send_timeout 600s` /
  `proxy_read_timeout 600s`.
- **2026-08-20 — Importación CSV de padres/staff en lotes con progreso
  animado**: con el timeout de nginx ya corregido, apareció un caso distinto
  — una importación de 451 filas de padres falló con "Failed to fetch". Los
  logs mostraron `POST /api/parents/bulk` con código `499` (nginx: el
  *cliente* cerró la conexión mientras el servidor seguía trabajando) a los
  27s, muy por debajo de cualquier timeout configurado — el problema real es
  que una sola petición HTTP larga y monolítica para cientos de invitaciones
  secuenciales es frágil ante cualquier corte de red del navegador, y además
  no daba ninguna señal de progreso mientras corría. Se cambió
  `GuardiansRegistry.tsx` y `StaffManagement.tsx` para trocear el CSV en
  lotes de 25 filas y subirlos uno por uno contra `/api/parents/bulk` /
  `/api/staff/bulk`, con una ventana modal animada (spinner + barra de
  progreso "X de Y") mientras dura la subida. Si un lote falla a mitad de
  camino, el mensaje de error ahora informa cuántas filas se alcanzaron a
  crear antes del fallo, en vez de perder todo el progreso sin explicación.

---

## 4. Modelo de permisos (resumen)

Dos ejes, no uno:

| Rol | Alcance |
|---|---|
| Padre | Solo sus hijos (`parent_students`) y sus propias filas |
| Personal (`admin`/`teacher`/`guard`, o `is_staff` dentro de `additional_tutor_name`) | Todo su colegio |
| `super_admin` | Todos los colegios — administración y soporte |

Funciones auxiliares en Postgres (`SECURITY DEFINER`, `STABLE`,
`SET search_path` fijo):

| Función | Qué responde |
|---|---|
| `user_tenant_ids()` | Colegios a los que pertenece el usuario (0, 1 o N) |
| `is_super_admin()` | Global, sin filtro de tenant |
| `is_staff_of(tenant_id)` | Personal de **ese** colegio — `OR is_super_admin()` |
| `is_parent_of(student_id)` | Tutor de ese alumno, vía `parent_students` |
| `is_admin()` | Legado — devuelve `true` si el usuario es admin en **cualquier** colegio; reemplazada por `is_staff_of()` en las políticas nuevas |

**Importante para cualquier pantalla nueva**: como `is_staff_of()` siempre es
`true` para un `super_admin` sin importar qué `tenant_id` se le pase, ninguna
consulta puede confiar solo en RLS para acotar el colegio. Todo `SELECT`
debe llevar `.eq('tenant_id', profile.tenant_id)` explícito además de RLS —
ese fue exactamente el bug de fuga de datos corregido en agosto 2026 (§3).

---

## 5. Estructura completa de la base de datos (Supabase, proyecto `fvzhfzogigewsvcyopel`)

### Enums propios del proyecto

| Enum | Valores |
|---|---|
| `user_role` | `admin`, `parent`, `teacher`, `guard`, `super_admin` — **no existe `guardian`** |
| `pickup_status` | `announced`, `in_queue`, `dispatched`, `completed`, `cancelled`, `released` |

(El resto de enums del listado — `aal_level`, `factor_type`, `oauth_*`, etc. —
son internos de Supabase Auth/Storage, no del dominio del producto.)

### Tablas (esquema `public`)

Todas las tablas de datos llevan `tenant_id uuid` (excepto `parent_students`,
que deduce el colegio del alumno) y tienen RLS activado.

| Tabla | Columnas | Notas |
|---|---|---|
| `tenants` | `id, name, domain, status, subscription_plan, created_at, updated_at` | La tabla raíz del multi-tenant |
| `profiles` | `id, role(user_role), first_name, last_name, phone, created_at, updated_at, pin_code, photo_url, email, additional_tutor_name, additional_tutor_phone, tenant_id` | `PRIMARY KEY (id)` — un padre con hijos en 2 colegios comparte una sola fila; `additional_tutor_name` guarda JSON con `{is_staff, permissions}` para el personal que no es `admin`/`teacher`/`guard` |
| `students` | `id, first_name, last_name, grade, section, created_at, photo_url, tenant_id` | |
| `parent_students` | `parent_id, student_id` | Sin `id` propio, sin `tenant_id` — es la tabla puente |
| `school_grades` | `id, name, level_order, created_at, updated_at, tenant_id, stage, exit_time, sections text[]` | `sections` agregada 2026-08-19 (antes no persistía) |
| `exit_doors` | `id, name, description, created_at, updated_at, tenant_id` | |
| `grade_doors` | `id, grade_id, door_id, created_at, tenant_id` | Puente grado↔puerta |
| `school_settings` | `id, school_name, address, latitude, longitude, pickup_radius_meters, updated_at, tenant_id, logo_url, primary_dismissal_mode` | Una fila por colegio; `primary_dismissal_mode` = `teacher`\|`staff` |
| `dismissal_assignments` | `id, tenant_id, grade_id, section, schedule_type, day_of_week, staff_id, created_at, updated_at` | Horario regular/post-school recurrente |
| `dismissal_overrides` | `id, tenant_id, grade_id, section, schedule_type, override_date, staff_id, created_by, created_at` | Excepción de un solo día |
| `pickup_events` | `id, parent_id, student_id, status(pickup_status), announced_at, completed_at, verified_at, tenant_id` | El evento central de recogida |
| `carpool_authorizations` | `id, tenant_id, student_id, authorizing_parent_id, driver_parent_id, day_of_week, created_at, updated_at` | Pool Day recurrente |
| `carpool_overrides` | `id, tenant_id, student_id, authorizing_parent_id, driver_parent_id, override_date, created_by, created_at` | Pool Day de un solo día |
| `replacement_requests` | `id, parent_id, replacement_name, replacement_phone, status, created_at, updated_at, tenant_id` | |
| `vehicles` | `id, parent_id, license_plate, description, created_at, tenant_id` | |
| `parent_presence` | `parent_id, tenant_id, is_inside, entered_at, updated_at` | Geocerca — quién está dentro del perímetro ahora mismo |
| `health_alerts` | `id, student_id, title, severity, action_plan, created_at, tenant_id` | |
| `medication_schedule` | `id, student_id, medication_name, dosage, scheduled_time, status, administered_by, administered_at, notes, created_at, frequency, is_critical, critical_reason, tenant_id` | Trigger `create_critical_alert_for_med_schedule` genera alerta automática |
| `student_incidents` | `id, student_id, type, description, reported_by, created_at, tenant_id` | Sin columna `evolution` — se agrega al `description` con timestamp desde el backend |
| `wellness_logs` | `id, student_id, type, value, logged_by, created_at, tenant_id` | |
| `daily_visitors` | `id, visitor_name, visiting_whom, reason, check_in_time, tenant_id` | |
| `camera_detections` | `id, door_id, image_url, detected_at, tenant_id` | El `INSERT` anónimo se cerró; falta endpoint propio para el webhook de cámaras (pendiente, ver `DISENO-Y-AVANCE.md` §6) |
| `forms` | `id, title, description, is_active, created_at, updated_at, target_grades text[], tenant_id` | |
| `form_questions` | `id, form_id, question_text, question_type, order, created_at, tenant_id` | |
| `form_responses` | `id, form_id, parent_id, student_id, answers jsonb, created_at, tenant_id` | |
| `notifications` | `id, user_id, title, message, type, is_read, created_at, tenant_id` | |
| `audit_logs` | `id, event_type, description, actor_name, metadata jsonb, created_at, tenant_id` | Bitácora de todo evento sensible |
| `compliance_status` | `id, percentage, last_audit_at, warning_count, critical_violations, tenant_id` | |
| `compliance_action_items` | `id, title, description, priority, status, created_at, tenant_id` | |
| `compliance_resources` | `id, title, url, tenant_id` | |
| `regulation_status` | `id, name, description, status, metrics jsonb, tenant_id` | |
| `active_critical_medications` | (vista) | Vista de solo lectura sobre `medication_schedule` + `students` |
| `_backfill_20260808` | `tabla, id` | Tabla de trabajo temporal de una migración anterior — candidata a borrar |

### Funciones auxiliares (`public`, todas `SECURITY DEFINER`)

| Función | Retorna | Uso |
|---|---|---|
| `user_tenant_ids()` | `SETOF uuid` | Colegios del usuario actual |
| `is_super_admin()` | `boolean` | — |
| `is_staff_of(p_tenant_id uuid)` | `boolean` | Reemplaza a `is_admin()` en políticas nuevas |
| `is_admin()` | `boolean` | Legado — cualquier colegio, no filtra por tenant |
| `is_parent_of(p_student_id uuid)` | `boolean` | — |
| `handle_new_user()` | `trigger` | Crea el `profile` al registrarse un usuario en `auth.users` |
| `create_critical_alert_for_med_schedule()` | `trigger` | Genera `health_alerts` cuando una medicación se marca crítica |
| `rls_auto_enable()` | `event_trigger` | Fuerza RLS en tablas nuevas automáticamente |

### Políticas RLS

31 tablas de `public` con RLS activo, 1–3 políticas cada una (la mayoría
`ALL` + `SELECT` separadas, un patrón típico: escritura acotada a personal del
colegio o al propio dueño de la fila, lectura acotada a pertenencia). El
detalle completo de cada política (USING/WITH CHECK) vive en
`sql/tenant_isolation_rls.sql`; este documento resume el mapa, no lo
reemplaza.

---

## 6. Infraestructura resumida

| Componente | Dónde | Notas |
|---|---|---|
| Base de datos | Supabase Cloud, proyecto `fvzhfzogigewsvcyopel`, plan **FREE** | **Pendiente crítico**: sin backups, se pausa tras una semana sin actividad — pasar a Pro antes del primer cliente que pague |
| Frontend + API | Docker Compose en `use-services2026:/root/sfsmpickup` | Contenedores `sfsmpickup` (nginx+SPA, `127.0.0.1:8095`) y `api` (Express, sin puerto publicado) |
| Proxy externo / TLS | nginx del host + Certbot, `/etc/nginx/sites-available/safesmartpickup.com` | Timeouts subidos a 600s el 2026-08-19 |
| Correo | Amazon SES, dominio `safesmartpickup.com` con Easy DKIM | Configuration Set y credenciales IAM propios, separados de la telefonía (FusionPBX) |
| Descarga de APK | Bucket público `downloads` en Supabase Storage | `https://fvzhfzogigewsvcyopel.supabase.co/storage/v1/object/public/downloads/app-debug.apk` |

Para el paso a paso de `docker compose build/up` y el detalle de cada
decisión de infraestructura, ver `DESPLIEGUE.md` y `DISENO-Y-AVANCE.md`.

---

## 7. Pendientes activos

Ver la tabla completa en `DISENO-Y-AVANCE.md` §8 ("Pendiente"). Los más
relevantes de cara a producción:

- Activar plan **Pro** en Supabase antes del primer colegio que pague (sin
  backups hoy).
- Webhook propio de cámaras con `service_role` (el `INSERT` anónimo se cerró).
- Sacar la clave de Gemini del navegador (proxy en el backend).
- Vendorizar los pesos de `face-api.js` (hoy dependen de un repo de GitHub de
  terceros sin mantenimiento desde 2020).
- Registrar el acceso cruzado del `super_admin` (hoy no deja rastro propio
  más allá de lo que cada endpoint ya audita).
- App iOS: en standby a la espera de credenciales de Apple Developer del
  cliente.
