# Safe Smart Pickup — Estado del proyecto y estructura de datos

Documento único de referencia: qué hace el software hoy, todo lo que se le agregó
en orden, y cómo está armada la base de datos en Supabase. Última actualización:
2026-08-28 (idioma de la app de padres configurable por el admin, panel de
Estadísticas por colegio, fix del filtro de puerta en Monitor Externo,
agrupación por grado/sección y buscadores inteligentes en Alumnos y Staff,
fotos de alumnos importadas desde Google Drive para TCS Albrook secundaria,
Ajustes responsive para teléfono, alumno vinculado visible en cada solicitud
de reemplazo, fix del lector QR de Check-In que no detectaba nada y de las
recogidas por reemplazo que se anunciaban como si hubiera llegado el papá/mamá,
y fix del reconocimiento facial de Check-In, que nunca había funcionado).

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
  navegador/tablet; solo pasa por el backend un proxy de imagen para las
  fotos que sí viven en Supabase Storage, ver §3 2026-08-28 — nunca había
  funcionado hasta esa fecha).
- **Pool Day**: autorizar a otro padre a recoger a tu hijo un día fijo de la
  semana o como excepción de un solo día; búsqueda de padres por nombre
  (ignora tildes/mayúsculas), con sugerencia de compañeros del mismo salón.
- Solicitud de reemplazo (persona distinta autorizada a recoger), con foto
  opcional de la persona autorizada, visible junto al QR tanto para el padre
  (Pase de Recogida) como para recepción al escanear.
- Elección de puerta de salida antes de anunciar llegada, cuando el colegio
  tiene más de una.
- **Confirmación de llegada sin ubicación**: si el celular no puede compartir
  GPS (permiso denegado, navegador dentro de otra app, etc.), el padre puede
  confirmar manualmente que ya está en el colegio en vez de quedar bloqueado;
  el pickup queda marcado `location_verified = false` y el personal lo ve
  resaltado en el Monitor Externo para verificar identidad con más cuidado.
- Centro de mensajes / notificaciones, incluye **avisos del colegio** (ver
  "Formularios/Avisos" más abajo) con sonido en tiempo real si tiene la app
  abierta.
- **Idioma de la app, elegible por cada padre**: el admin fija español o
  inglés para todo su colegio desde Ajustes (`tenants.default_language`) como
  punto de partida, pero cada padre puede cambiarlo él mismo con el botón
  ES/EN del encabezado — su elección se guarda en ese dispositivo
  (`localStorage`) y tiene prioridad sobre el default del colegio de ahí en
  adelante (ver §3, 2026-08-28).
- Registro de vehículo (placa + descripción) en el alta.
- App Android nativa (Capacitor) distribuida por link de descarga en el correo
  de invitación, servida desde un bucket público de Supabase Storage; además
  en pista de Prueba interna/cerrada de Google Play y TestFlight (iOS) para
  pruebas beta con padres reales antes del lanzamiento público (ver §3 Apps
  móviles).

### Para personal / administración del colegio
- Dashboard operativo (cola en vivo, sincronización en tiempo real).
- Gestión de alumnos, padres/tutores (alta individual y **carga masiva por
  CSV**, con auto-vinculación padre↔alumno por nombre). El listado de alumnos
  se agrupa por grado y, dentro de cada grado, por sección (orden alfabético),
  con selector rápido de grado (pills con conteo) y buscador por
  nombre/grado/sección.
- Gestión de personal (alta individual y **carga masiva por CSV**, con permisos
  por módulo), con **buscador inteligente**: filtra por nombre, correo o el
  nombre del módulo al que tienen acceso (ej. escribir "salidas" encuentra a
  quien tiene el permiso de Seguridad/Salidas).
- Estructura del colegio: puertas de salida, grados (crear, **editar nombre y
  orden después de creados**), secciones por grado (persistidas, se pueden
  agregar y quitar desde Horarios de Salida).
- Horarios de salida por grado/sección/día, con modo distinto para primaria
  (un encargado toda la semana) y secundaria (uno por día), más excepciones de
  un solo día.
- Bienestar: incidentes y medicación de alumnos, con alertas críticas
  automáticas (trigger `create_critical_alert_for_med_schedule`).
- Registro de visitantes: nombre, **identificación/cédula, empresa de
  origen**, a quién visita y motivo — visible en la bitácora y en el PDF
  exportado.
- Formularios dirigidos por grado y sección, en dos modalidades:
  **Autorización** (pide respuesta SÍ/NO por alumno, como antes) o **Aviso /
  Mensaje** (solo informa, sin pedir respuesta). El segmentado usa los
  grados/secciones reales que cada colegio configuró en Ajustes (no una lista
  fija), y al publicarse se manda una notificación real (campana + sonido) a
  los padres que correspondan, en vez de que dependan de abrir la app para
  enterarse.
- Bitácora de auditoría de todo evento sensible.
- Inbox de solicitudes (`RequestsCenter.tsx`): cada solicitud de reemplazo
  muestra debajo el/los alumno(s) vinculados al padre que la hizo ("Para:
  Nombre1, Nombre2"), para que el personal sepa a qué hijo aplica sin tener
  que adivinar (ver §3).
- Verificación de tutores / monitor externo (pantalla de puerta con cola y
  escaneo QR); la tarjeta de cada llegada muestra quién del personal fue
  avisado (nombre de cada profesor/recepción notificado), y "Atender ahora"
  para verificar a alguien fuera del orden de llegada sin perder la cola real
  de los demás. El filtro "Puerta a monitorear" aplica también a la lista "En
  cola" del panel lateral y a su contador (antes solo filtraba la tarjeta
  principal, ver §3). Cuando quien retira es un reemplazo autorizado
  verificado por QR (no el papá/mamá/tutor), la tarjeta, el toast y el
  anuncio de voz muestran su nombre real con la etiqueta "(autorizado)" en
  vez de asumir que llegó el titular (ver §3).
- **En Tránsito**: pantalla de solo lectura (sin botones) que muestra a los
  alumnos ya autorizados camino al vehículo, agrupada/filtrable por puerta
  de salida, con prioridad por color calculada por puerta y anuncio de voz
  bilingüe cuando entra un alumno nuevo (ver §3).
- **Ajustes**, pantalla completa (pestañas, cabecera, Configuración General,
  Estructura y Puertas, Horarios de Salida) adaptada para verse bien en
  teléfono: pestañas con scroll horizontal, cabecera apilada, grillas y
  selects que se apilan en vez de comprimirse en pantallas angostas (ver §3).
- **Panel de Estadísticas** por colegio (admin siempre; staff solo si se le
  otorga el permiso, ver §3): tiempo promedio de
  recogida, % de confirmación automática (GPS) vs. manual, puerta más usada,
  recogidas por hora del día y por día de la semana, reemplazos
  solicitados/aprobados/rechazados, avisos y autorizaciones enviados/
  respondidos, uso de Pool Day, visitantes registrados y tamaño de la
  comunidad (alumnos/padres). Selector de periodo: Hoy, 7, 30 o 90 días. Todo
  filtrado por `tenant_id` como el resto del panel, sin exponer datos entre
  colegios.
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
- **2026-08-21 — App Android enviada a Google Play, pista de Prueba
  interna**. Workflow nuevo `android-deploy.yml` (`workflow_dispatch` manual,
  nunca automático en cada push): compila el AAB firmado con
  `android/keystore.properties` generado desde secrets de GitHub
  (`ANDROID_KEYSTORE_BASE64` y contraseñas), verifica el keystore apenas se
  decodifica (falla en segundos con mensaje claro si el secret se pegó
  incompleto, en vez de esperar minutos de build para enterarse), y lo sube
  al track elegido (`internal`/`alpha`/`beta`/`production`) vía la API de
  Google Play con `r0adkll/upload-google-play`, usando una cuenta de
  servicio (`GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`).
- **2026-08-25/26 — Prueba beta con padres reales, Android + iOS**, antes del
  lanzamiento público:
  - Se identificaron en la base de datos los padres con correo Gmail (único
    requisito real de Google Play — TestFlight no exige ningún proveedor de
    correo en particular, solo un iPhone) de TCS Albrook, TCS Costa del Este
    y The Casco School: 410 en total.
  - **Android**: 100 en la lista de correo `Test_01` de la pista de Prueba
    interna (tope real de Google Play: 100 testers por lista); el resto
    (310) repartidos en varias listas de la pista de **Prueba cerrada**
    ("test externo"), que no tiene ese tope — luego se sumaron también los
    100 de Interna a Prueba cerrada, así que ahora los 410 comparten el
    mismo link universal de unirse
    (`play.google.com/store/apps/details?id=com.safesmartpickup.app`, no el
    link especial `/apps/internaltest/...` de Interna). **Bug real
    encontrado y corregido en el camino**: Prueba cerrada no dejaba guardar
    ninguna lista de testers porque el canal no tenía ninguna versión
    publicada todavía — se resolvió disparando el workflow
    `android-deploy.yml` (track `alpha`) para publicar un build ahí antes de
    poder asignar testers.
  - **iOS**: Public Link activado en el grupo externo de TestFlight ("Test
    Casco"), que no tiene tope de 100 como Interna.
  - Páginas `public/prueba-android.html` / `public/prueba-ios.html` con el
    paso a paso para cada plataforma, y scripts (`scripts/send-*-beta-invite*.mjs`)
    para mandar la invitación por correo vía SES SMTP a las listas ya
    filtradas.
  - **Pendiente antes de publicación pública**: sacar a estos padres de las
    listas de testers cuando la app pase a producción, para no dejarlos
    mezclados con usuarios reales (ver §7).
- **2026-08-20 — Animación de progreso en import CSV + fix de bug de tenant
  en import masivo de padres en Modo Super Admin**:
  - El import de padres/personal por CSV ahora sube en lotes de 25 filas
    (antes era una sola petición larga por las cientos de filas, frágil
    ante cualquier corte de red — el navegador la abortaba y se perdía
    todo el progreso sin aviso claro). Se agregó un overlay animado
    (`GuardiansRegistry.tsx`, `StaffManagement.tsx`) con barra de
    progreso "Importando X de Y" mientras sube.
  - **Bug encontrado en producción**: al importar 451 padres para
    "TCS ALBROOK" en Modo Super Admin, saltó error de "correo duplicado"
    y no aparecía nadie en el directorio. Causa: `/api/parents/bulk`
    (a diferencia de `/api/parents` y `/api/staff/bulk`, que sí lo hacen)
    usaba siempre `req.caller.tenantId` — el colegio *real* del
    super_admin — en vez del colegio que estaba configurando. Los 433
    padres creados quedaron con `tenant_id` de "The Casco School" en vez
    de "TCS ALBROOK". Los correos de invitación SÍ habían salido
    correctamente (eso no depende del tenant_id); el import solo quedó
    mal archivado internamente. Corregido en `server/src/index.ts`
    (mismo patrón `role === 'super_admin' ? body.tenant_id : caller.tenantId`
    que ya usaban los otros endpoints) y reasignados los 433 registros a
    mano con una `UPDATE` directa en Supabase.
  - Además, la vinculación automática padre↔alumno del import había fallado
    para esos mismos 433 padres (el backend buscaba los alumnos en el
    colegio equivocado por el mismo bug). Se reconstruyeron los 577 vínculos
    faltantes a mano, cruzando el CSV original contra el roster real de
    TCS ALBROOK por nombre — 12 nombres de hijos no encontraron alumno
    exacto en el roster (probablemente orden de nombre invertido) y quedaron
    pendientes de vincular manualmente desde el Directorio de Padres.
- **2026-08-20 — Horarios de Salida: 2 encargados por sección en vez de 1**.
  El colegio pidió poder asignar 2 personas de staff por salón para la
  salida, que el aviso de "padre llegó" les llegue a ambas, y poder
  reemplazar solo a una de las dos por un día suelto sin tocar a la otra.
  - `dismissal_assignments` ganó la columna `staff_id_2` (nullable;
    `staff_id` sigue siendo obligatorio — si se vacía el slot 1 pero el 2
    tiene a alguien, se promueve automáticamente al slot 1 en vez de dejar
    la fila inválida).
  - `dismissal_overrides` ganó la columna `slot` (1 o 2) y su UNIQUE pasó a
    incluirla, para poder reemplazar a una sola de las dos personas en un
    día específico.
  - `resolveResponsibleStaff` (en `lib/dismissalSchedule.ts`) pasó a
    `resolveResponsibleStaffIds`, devolviendo hasta 2 ids; el aviso de
    llegada en `ParentDashboard.tsx` ahora inserta una notificación por
    cada encargado resuelto (deduplicado con `Set` por si es la misma
    persona en ambos slots).
  - `DismissalScheduleSettings.tsx`: cada sección/día ahora muestra 2
    selects apilados ("Persona 1" / "Persona 2"), y el formulario de
    excepciones de un día agregó un selector "Reemplaza a" (Persona 1/2).
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

### Staff en más de un colegio de la misma organización (agosto 2026)
- Tabla nueva `staff_school_access` (`staff_id, tenant_id, role, permissions,
  granted_by`) para dar acceso a un colegio ADEMÁS del propio, sin duplicar
  la fila en `profiles` — se evaluó y descartó darle a una persona 2 filas en
  `profiles` (una por colegio) porque ~18 foreign keys de otras tablas
  (`dismissal_assignments.staff_id`, `student_incidents.reported_by`,
  `wellness_logs.logged_by`, etc.) apuntan a `profiles.id` asumiendo una sola
  fila por persona.
- `is_staff_of()`/`user_tenant_ids()` (las funciones RLS centrales) ahora
  también consultan `staff_school_access`, así que el acceso se propaga solo
  a casi todas las políticas del esquema sin tocarlas una por una.
- Mismo patrón que "Entrar como Admin": el frontend "disfraza" el `profile`
  activo con el colegio concedido (`AuthContext.switchStaffSchool`), sin
  crear una segunda cuenta ni tocar el perfil real. Selector de colegio en
  `ImpersonationBanner.tsx` (antes solo mostraba el aviso de super_admin).
- `POST /api/staff` y `/api/staff/bulk`: si el correo ya tiene cuenta (típico
  de alguien que ya es personal de otro colegio), en vez de fallar con "ya
  existe" se le concede acceso al colegio nuevo (`staff_school_access`) sin
  mandar invitación ni tocar su cuenta original.
- `server/src/auth.ts`: `Caller.grants` + `resolveTenantId()` reemplaza el
  patrón repetido `role === 'super_admin' ? body.tenant_id : caller.tenantId`
  en los 4 endpoints que lo usaban (`/api/parents`, `/api/parents/bulk`,
  `/api/staff`, `/api/staff/bulk`), para que también honre el acceso
  concedido y no solo al super_admin.
- `StaffManagement.tsx`: sección "Acceso de otros colegios" para que el admin
  vea y revoque (`DELETE /api/staff/school-access/:staffId/:tenantId`) los
  accesos concedidos a su colegio.

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

### Formularios / Avisos y notificaciones a padres (2026-08-26)
- **Nuevo tipo de formulario "Aviso / Mensaje"** (`forms.form_type`), junto al
  ya existente "Autorización": un aviso no pide preguntas ni respuesta
  SÍ/NO, solo informa. En el panel del padre se ven juntos bajo "Avisos y
  Autorizaciones", con etiqueta de color por tipo; el modal de un aviso solo
  muestra el mensaje y un botón "Entendido".
- **Fix de fondo: el segmentado por grado usaba una lista fija en español**
  (K3, K4, K5, 1ro, 2do... 12mo) que no coincidía con los grados reales de
  ningún colegio — cada uno usa su propia convención (TCS Albrook/Costa del
  Este: códigos "01".."13"+"NR"/"PN"/"RC"; The Casco School: "1er ", "2do",
  "6to"). Esto afectaba **todos** los formularios, autorizaciones incluidas,
  desde siempre — el selector ahora sale de `school_grades` (la tabla real de
  Ajustes → Grados Escolares).
- **Segmentado también por sección** (`forms.target_sections text[]`),
  opcional: aparece un segundo selector con las secciones reales del grado
  elegido (las mismas de Ajustes → Salidas). Sin elegir ninguna, aplica a
  todo el grado, como antes.
- **Notificación real al publicar un formulario o aviso**: nuevo endpoint
  `POST /api/forms/notify` (server, con `service_role` porque un padre/staff
  no puede insertar notificaciones para otros por RLS) — calcula qué padres
  tienen hijos en el grado/sección segmentados e inserta una fila en
  `notifications` para cada uno. El panel del padre ya escuchaba esa tabla en
  tiempo real y reproducía un sonido (`playBeep()`, reusado de los avisos de
  llegada) — así que ahora el aviso suena de inmediato si el padre tiene la
  app abierta, sin tocar nada nuevo del lado del padre. Limitación conocida:
  solo suena con la app abierta — no hay push nativo (aún) para cuando está
  cerrada.
- **Quién fue avisado, visible en el Monitor Externo**: se agregó
  `notifications.pickup_event_id` (referencia al pickup puntual) — al
  anunciar llegada, el padre manda ese id junto con el aviso al personal
  encargado. La tarjeta de verificación del Monitor Externo ahora muestra
  "🔔 Avisado: Nombre1, Nombre2..." con el personal real que recibió esa
  llegada específica, sin tener que consultar la base de datos a mano.

### Confirmación de llegada sin ubicación (2026-08-25/26)
- Si el padre no puede compartir GPS (permiso denegado, o abrió el enlace
  dentro de otra app), ya no queda bloqueado sin poder anunciar llegada:
  puede confirmar manualmente que está en el colegio. Se guarda
  `pickup_events.location_verified = false`, y el Monitor Externo muestra un
  aviso "Sin GPS" en la tarjeta y en la cola para que el personal verifique
  identidad con más cuidado en ese caso.

### Visitantes: identificación y empresa (2026-08-26)
- El registro de visitantes ahora también pide cédula/identificación y
  empresa de origen (`daily_visitors.id_number`, `daily_visitors.company`),
  visibles en la bitácora y en el PDF exportado.

### Visitantes: hora de salida editable (2026-08-29)
- Nueva columna `daily_visitors.check_out_time` (nullable). En la Bitácora,
  cada visitante sin salida registrada muestra un botón "Registrar salida"
  que guarda la hora actual con un clic; una vez registrada, se puede
  corregir con el ícono de lápiz (por si el personal olvidó marcarla al
  momento) mediante un selector de fecha/hora. Ambas acciones quedan en
  `audit_logs`. La hora de salida también se agregó al PDF exportado.

### Idioma de la app de padres: default del colegio + selector propio del padre (2026-08-28)
- Nueva columna `tenants.default_language` (`'es'`\|`'en'`, default `'es'`),
  editable por el admin desde Ajustes → Perfil Institucional (toggle
  Español/English).
- `ParentDashboard.tsx` (única pantalla que no pasaba por el sistema de
  `t()`/`useLanguage`, ~1850 líneas casi todas en español fijo) se conectó por
  completo — se agregaron 132 claves nuevas `parent.*` a
  `src/i18n/translations.ts` (inglés y español) cubriendo cabecera, ubicación,
  puertas, avisos/autorizaciones, reemplazo, delivery, Pool Day, centro de
  mensajes y los estados de recogida.
- **Primera versión: el admin fijaba el idioma sin que el padre pudiera
  cambiarlo.** Se revirtió el mismo día — el colegio pidió que el padre sí
  pueda elegir. `LanguageContext.tsx` ganó persistencia en `localStorage`
  (clave `ssp_language`) y un flag `hasManualLanguage`; se agregó un botón
  ES/EN visible en el encabezado de `ParentDashboard.tsx`. El
  `default_language` del colegio sigue aplicando como punto de partida (la
  primera vez, o si el padre nunca tocó el botón en ese dispositivo), pero
  una vez que el padre elige, su elección manda de ahí en adelante en ese
  dispositivo.
- De paso se tradujo `SharedQRDisplay.tsx` (el "Pase de Recogida" que se
  comparte por WhatsApp/SMS con la persona de reemplazo), que vivía fuera del
  `LanguageProvider` en `App.tsx` y no pasaba por `t()` — ahora hereda el
  idioma guardado en `localStorage` del mismo navegador/dispositivo.

### Panel de Estadísticas (2026-08-27/28)
- Vista nueva `Statistics.tsx`, solo para admin (no se puede otorgar como
  permiso de staff — el módulo ni siquiera existe en la lista de permisos de
  `StaffManagement.tsx`), con las métricas descritas en §2. Gráficos de
  barras simples con CSS, sin librería nueva.
- **Bug real encontrado tras el primer despliegue**: el `SELECT` a
  `pickup_events` pedía la columna `released_at`, que nunca existió en la
  tabla (la columna real es `verified_at`, que además no la usa/escribe
  ningún flujo todavía). Supabase rechazaba el query completo con 400, y como
  el código hacía `data || []` sin revisar `error`, el panel mostraba
  "Recogidas completadas: 0" y los gráficos "Sin datos" en silencio pese a
  haber cientos de recogidas reales en el periodo. Corregido: se quitó
  `released_at` del `SELECT` (y el cómputo de "tiempo de respuesta" que
  dependía de esa columna inexistente, nunca mostrado en pantalla), y se
  agregaron `console.error` en cada query del panel para que un fallo similar
  no vuelva a pasar inadvertido.
- De paso, "Puerta más usada" mostraba el UUID crudo de `door_id` en vez del
  nombre — ahora se resuelve contra `exit_doors`.
- Selector de periodo ganó la opción **"Hoy"** (desde la medianoche), además
  de 7/30/90 días.

### Fix: filtro de puerta en Monitor Externo no aplicaba a la cola (2026-08-27)
- La tarjeta principal de verificación sí filtraba por la puerta seleccionada
  (`filteredPickups[0]`), pero la lista "En cola" del panel derecho, su
  contador ("N total") y la numeración de posición se calculaban de
  `pickups` sin filtrar — con una puerta específica seleccionada, la tarjeta
  filtraba bien pero la cola seguía mostrando alumnos de todas las puertas.
  Los tres ahora usan `filteredPickups` consistentemente.

### Alumnos: agrupación y buscadores (2026-08-28)
- `Students.tsx` (Student Registry): listado agrupado por grado (pills de
  filtro rápido con conteo, en el orden de `school_grades.level_order`), y
  dentro de cada grado, sub-agrupado por sección en orden alfabético (el
  sub-encabezado solo aparece si el grado tiene más de una sección). La
  búsqueda por nombre/grado/sección ya existente se combina con el filtro de
  grado.
- `StaffManagement.tsx`: buscador inteligente que además de nombre/correo
  encuentra por el nombre del módulo al que tienen acceso.

### Fotos de alumnos de secundaria — TCS Albrook (2026-08-28)
- El colegio compartió por Google Drive una carpeta de fotos ("High School
  Pictures", subcarpetas "Year 7".."Year 11") con el nombre y apellido del
  alumno como nombre de archivo. **Hallazgo**: las subcarpetas de Drive
  correspondían al grado de un año escolar anterior, no al grado actual en
  el sistema (ej. la carpeta "Year 7" tenía mezclados alumnos que hoy están
  en grados 08, 09, 12 y 13) — el cruce se hizo por nombre contra **todos**
  los alumnos de secundaria (grados 07-13), ignorando de qué subcarpeta venía
  cada foto.
- De 105 fotos, 77 hicieron match exacto (o casi exacto, 4 con variación de
  ortografía confirmadas a mano) con un alumno real; 28 no correspondían a
  ningún alumno actualmente matriculado (probablemente egresados/retirados,
  la carpeta es de un año anterior) y 42 alumnos de secundaria (31 de ellos
  del grado 07 completo, matriculados después de esa carpeta) siguen sin
  foto.
- Las fotos se subieron directo a Supabase Storage (bucket `avatars`, carpeta
  `<tenant_id>/`) manualmente por el colegio vía el Dashboard de Supabase —
  más rápido que descargar cada archivo de Drive por API uno por uno — y la
  vinculación `students.photo_url` se hizo con un `UPDATE` masivo por SQL
  cruzando el nombre de archivo contra el `student_id` ya identificado.

### Ajustes: diseño responsive para teléfono (2026-08-28)
- Motivado por necesitar una captura limpia de "Horarios de Salida" tomada
  desde un teléfono real para la ficha de Google Play (ver pendiente de
  "afirmaciones engañosas" en §7). `Settings.tsx`: la barra de pestañas ahora
  tiene scroll horizontal en vez de comprimirse, la cabecera se apila en
  vertical en pantallas angostas. `DismissalScheduleSettings.tsx`: en
  primaria los selects de encargado se apilan verticalmente; en secundaria la
  grilla de 5 días × 2 encargados vive en un contenedor con scroll horizontal
  en vez de aplastarse hasta ser ilegible. `SchoolStructureSettings.tsx`:
  mismos ajustes de padding/tamaño de texto y la fila "Etapa + Hora de
  salida" por grado ahora se envuelve en vez de desbordar.

### Solicitudes: alumno vinculado visible en cada solicitud de reemplazo (2026-08-28)
- La tarjeta de "Solicita autorizar a..." en `RequestsCenter.tsx` solo
  mostraba el nombre/teléfono de la persona a autorizar, sin indicar a qué
  hijo del padre aplica — el personal tenía que adivinarlo. Se unió
  `parent_students` en la consulta de `replacement_requests` y se agregó una
  línea "Para: Nombre1, Nombre2" con los alumnos vinculados a ese padre (o un
  aviso en ámbar si el padre todavía no tiene ninguno vinculado).

### Check-In: lector QR que no detectaba nada, y recogidas por reemplazo mal atribuidas (2026-08-28)
- **El lector QR de recepción (`SmartCheckIn.tsx`) abría la cámara
  normalmente pero nunca detectaba ningún código**, ni siquiera QR reales
  generados por la propia app. Dos causas reales encontradas:
  1. `qrbox` fijo en 200×200px podía quedar mal calculado contra el tamaño
     real del contenedor en el momento de iniciar el escaneo (layout no
     asentado todavía), y sin `videoConstraints` el navegador entregaba video
     en baja resolución — casi imposible de decodificar, sobre todo un QR
     mostrado en otra pantalla (moiré). Se cambió `qrbox` a una función que
     se calcula contra el viewfinder real, y se pide explícitamente
     1280×720.
  2. El QR de "Pase de Recogida" (`ParentDashboard.tsx` y
     `SharedQRDisplay.tsx`) codificaba la **URL completa de la foto** del
     reemplazo (100+ caracteres) dentro del payload, sin que el lector la use
     para nada (`handleQrSuccess` solo valida `parent_id`/`token`/
     `replacement_name`) — eso inflaba la densidad del código muy por encima
     de lo necesario. Se quitó `photo_url` del payload en ambos lugares y se
     bajó el nivel de corrección de errores de H a M en la versión grande.
- **Las recogidas hechas por un reemplazo autorizado (verificado por QR) se
  anunciaban/mostraban como si hubiera llegado el papá/mamá/tutor**: al
  escanear el QR y elegir el alumno, `pickup_events` se creaba solo con
  `parent_id` (el titular que autorizó), sin registrar en ningún lado que
  quien llegó físicamente fue otra persona — el Monitor Externo entonces
  decía "el papá de X ha llegado" por voz y en pantalla, aunque fuera el
  reemplazo. Se guarda ahora el nombre del reemplazo en
  `pickup_events.notes` (prefijo `[REEMPLAZO]`) y `VerificationDisplay.tsx`
  lo usa en sus dos anuncios de voz/toast y en la tarjeta principal de
  verificación para mostrar el nombre correcto con la etiqueta "(autorizado)".
  **Bug de despliegue encontrado al probar el fix**: la columna `notes` ya
  estaba en el archivo de tipos TypeScript pero **nunca existió realmente**
  en la tabla `pickup_events` de producción — el `INSERT` fallaba en
  silencio (el cliente de Supabase no lanza excepción por defecto) y el
  campo quedaba `null` pese a que el código ya la mandaba. Se agregó la
  columna real con una migración (`ALTER TABLE pickup_events ADD COLUMN
  notes text`) directamente sobre el proyecto de producción.

### Check-In: reconocimiento facial nunca había funcionado (2026-08-28)
- **`SmartCheckIn.tsx` compara la foto capturada contra la de cada padre
  registrado usando `/api/proxy-image?url=...` para evitar que el `<canvas>`
  quede "manchado" por CORS al leer la foto de otro origen — pero ese
  endpoint nunca existió en el backend.** Cada comparación fallaba en
  silencio (capturada por un `catch` por-padre dentro del loop), así que
  `bestMatch` quedaba `null` siempre, sin importar quién estuviera frente a
  la cámara — el reconocimiento facial jamás encontró una coincidencia desde
  que existe. Se agregó el endpoint en `server/src/index.ts`, **sin**
  `requireAuth` a propósito (`faceapi.fetchImage()` hace un `fetch()` plano,
  no hay forma de mandarle la cabecera Authorization) pero restringido a
  reenviar solo pedidos cuyo origen sea el propio proyecto de Supabase, para
  no quedar como proxy abierto hacia cualquier URL.
- Encontrados y corregidos de paso, en la misma función:
  - La consulta de "padres con foto" no filtraba por `tenant_id` —
    comparaba la cara contra los padres de **todos** los colegios, no solo
    el del kiosco (mismo patrón de fuga que las demás pantallas, ver §4).
  - El `audit_log` de éxito/fallo se insertaba sin `tenant_id` porque ese
    campo nunca se había incluido en el `SELECT` de `bestMatch`.
  - Muchas fotos de perfil (`profiles.photo_url`) no son URLs de Supabase
    Storage sino **imágenes base64 embebidas** (`data:image/jpeg;base64,...`)
    — el proxy recién agregado las rechazaba (un `data:` URL tiene
    `origin` = `"null"`) o las mandaba como parámetro de query gigante. Los
    `data:` URL no tienen problema de CORS con el canvas, así que ahora se
    cargan directo con `faceapi.fetchImage()` sin pasar por el proxy; solo
    las URLs `http(s)` reales lo usan. De paso se excluyen también los
    `photo_url` en cadena vacía (`''`) de la consulta, no solo `null`.

### Nuevo flujo de salida: pantalla "En Tránsito" y anuncios de voz (2026-08-28/29)
- **Flujo completo**: el padre anuncia su llegada → el personal de puerta
  (Monitor Externo) pulsa "Autorizar" como siempre (`status: 'released'`) →
  el alumno aparece automáticamente en la nueva pantalla **En Tránsito**
  (`TransitMonitor.tsx`), de solo lectura — no tiene botones, es solo guía
  visual para el personal — con foto y nombre del alumno, grado, sección,
  nombre/foto/PIN del padre o del reemplazo autorizado, y placa/descripción
  del vehículo si el padre la cargó desde su app. Al confirmar el padre
  desde su propia app que ya se reunió con el alumno, la tarjeta desaparece
  de En Tránsito (`status: 'completed'`).
- Agrupada y filtrable por puerta de salida. Dentro de cada puerta, las
  tarjetas se ordenan por orden de llegada (`announced_at` ascendente, no
  hay columna `released_at` en la base) y el color de prioridad (primeros 5
  en rojo, siguientes 5 en naranja, resto en verde) se calcula **por
  puerta**, no de forma global — cada puerta tiene su propia fila de espera.
- Padres: nueva sección "Mi Vehículo" en su app para cargar placa y
  descripción, que se refleja en la tarjeta de Monitor Externo y en la de En
  Tránsito.
- Anuncios de voz por las bocinas del salón (Monitor Externo / En Tránsito),
  en español y luego en inglés, más despacio que antes: al anunciar la
  salida solicitada (con grado y sección) y al entrar un alumno nuevo a En
  Tránsito (para el personal de entrega final en la puerta).
- **Aviso de autorización — dentro de la app del padre, no en las bocinas
  del colegio**: cuando el maestro autoriza la salida, el propio teléfono
  del padre reproduce (una sola vez, español y luego inglés) que el alumno
  fue autorizado y va camino al vehículo, recordando pulsar el botón de
  confirmación al tenerlo. Usa `speechSynthesis` del navegador del padre, no
  el `audioManager` del kiosco (ese requiere activarse con un clic previo,
  pensado para una bocina fija, no para el teléfono de cada padre).
- **Panel de Dashboard**: salidas completadas de hoy, acumuladas en tiempo
  real por grado/sección, con total del día.
- **Cierre automático del ciclo tras 20 minutos sin confirmar**: además del
  cierre automático ya existente cuando el padre sale del perímetro del
  colegio (20s de margen para ruido de GPS), ahora un job en el backend
  (`server/src/index.ts`, corre cada 60s) cierra solo cualquier recogida que
  lleve más de 20 minutos en `released` sin que el padre confirme — se
  asume que ya tiene al alumno. Corre en el servidor (siempre encendido en
  Docker Compose), no en el navegador del padre, para no depender de que la
  app siga abierta o el GPS esté activado. Deja registro en `audit_logs` y
  notifica al padre.

### Permisos de staff: todos los módulos del sidebar ahora configurables (2026-08-29)
- Antes, cinco pantallas tenían reglas fijas fuera del sistema de permisos
  por módulo: **Bitácora de Visitantes** (protegida en el código pero sin
  checkbox para otorgarla — inalcanzable para cualquier staff), **En
  Tránsito** y **Ajustes** (visibles para todo el staff sin poder
  restringirlas), y **Gestión de Personal**/**Estadísticas** (bloqueadas
  para todo el staff sin poder otorgarlas). Las cinco se agregaron a
  `AVAILABLE_MODULES` en `StaffManagement.tsx` y quedan, como el resto, a
  discreción del administrador vía checkbox. Los administradores reales (no
  marcados como staff) siguen viendo todo sin restricción.
- **Nota de seguridad**: "Gestión de Personal" le da a quien lo tenga la
  capacidad de crear/editar otro staff y asignarle (o asignarse a sí mismo)
  cualquier otro permiso, incluido ese mismo — no es solo acceso a una
  pantalla operativa como el resto, así que conviene otorgarlo con cautela.

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
  Day, notificaciones, elección de puerta, confirmación de llegada sin
  ubicación), en español e inglés.
- Manual de recepción (login, Monitor Externo, reemplazos por QR, Pool Day,
  atender fuera de orden), en español e inglés.
- Manual de enfermería / Centro de Bienestar (alertas de salud, horario de
  medicamentos, medicamentos críticos, incidentes, expedientes).
- Todos los manuales viven como páginas reales en `safesmartpickup.com`
  (`public/manual-*.html`, `public/guia-padres.html`, `public/parent-guide.html`,
  `public/reception-guide.html`), no solo como Artifacts de Claude —
  marcadas `noindex, nofollow`.
- Páginas de invitación a la prueba beta (`public/prueba-android.html`,
  `public/prueba-ios.html`) con los enlaces de unirse a TestFlight / Google
  Play, para compartir con los padres seleccionados (ver "Apps móviles" más
  abajo). `prueba-ios.html` ganó (2026-08-27) una aclaración sobre el código
  de canje de TestFlight (aparece si el enlace se abre desde Gmail/Mail en
  vez de Safari) con el código correcto visible en la página.

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
| `tenants` | `id, name, domain, status, subscription_plan, created_at, updated_at, default_language` | La tabla raíz del multi-tenant; `default_language` (`'es'`\|`'en'`, agregada 2026-08-28) fija el idioma de la app de padres para todo el colegio |
| `profiles` | `id, role(user_role), first_name, last_name, phone, created_at, updated_at, pin_code, photo_url, email, additional_tutor_name, additional_tutor_phone, tenant_id` | `PRIMARY KEY (id)` — un padre con hijos en 2 colegios comparte una sola fila; `additional_tutor_name` guarda JSON con `{is_staff, permissions}` para el personal que no es `admin`/`teacher`/`guard` |
| `staff_school_access` | `staff_id, tenant_id, role, permissions jsonb, granted_by, created_at` | `PRIMARY KEY (staff_id, tenant_id)` — acceso de un staff a un colegio ADEMÁS del suyo (`profiles.tenant_id`), sin duplicar su perfil |
| `students` | `id, first_name, last_name, grade, section, created_at, photo_url, tenant_id` | |
| `parent_students` | `parent_id, student_id` | Sin `id` propio, sin `tenant_id` — es la tabla puente |
| `school_grades` | `id, name, level_order, created_at, updated_at, tenant_id, stage, exit_time, sections text[]` | `sections` agregada 2026-08-19 (antes no persistía) |
| `exit_doors` | `id, name, description, created_at, updated_at, tenant_id` | |
| `grade_doors` | `id, grade_id, door_id, created_at, tenant_id` | Puente grado↔puerta |
| `school_settings` | `id, school_name, address, latitude, longitude, pickup_radius_meters, updated_at, tenant_id, logo_url, primary_dismissal_mode` | Una fila por colegio; `primary_dismissal_mode` = `teacher`\|`staff` |
| `dismissal_assignments` | `id, tenant_id, grade_id, section, schedule_type, day_of_week, staff_id, created_at, updated_at` | Horario regular/post-school recurrente |
| `dismissal_overrides` | `id, tenant_id, grade_id, section, schedule_type, override_date, staff_id, created_by, created_at` | Excepción de un solo día |
| `pickup_events` | `id, parent_id, student_id, status(pickup_status), announced_at, completed_at, verified_at, tenant_id, door_id, location_verified, notes` | El evento central de recogida. `verified_at` existe pero ningún flujo la escribe todavía (no usar en queries nuevos); `location_verified = false` marca confirmación manual sin GPS; `notes` (agregada 2026-08-28) guarda el nombre del reemplazo autorizado cuando quien retira no es el titular (prefijo `[REEMPLAZO] `, ver §3) |
| `carpool_authorizations` | `id, tenant_id, student_id, authorizing_parent_id, driver_parent_id, day_of_week, created_at, updated_at` | Pool Day recurrente |
| `carpool_overrides` | `id, tenant_id, student_id, authorizing_parent_id, driver_parent_id, override_date, created_by, created_at` | Pool Day de un solo día |
| `replacement_requests` | `id, parent_id, replacement_name, replacement_phone, status, created_at, updated_at, tenant_id` | |
| `vehicles` | `id, parent_id, license_plate, description, created_at, tenant_id` | |
| `parent_presence` | `parent_id, tenant_id, is_inside, entered_at, updated_at` | Geocerca — quién está dentro del perímetro ahora mismo |
| `health_alerts` | `id, student_id, title, severity, action_plan, created_at, tenant_id` | |
| `medication_schedule` | `id, student_id, medication_name, dosage, scheduled_time, status, administered_by, administered_at, notes, created_at, frequency, is_critical, critical_reason, tenant_id` | Trigger `create_critical_alert_for_med_schedule` genera alerta automática |
| `student_incidents` | `id, student_id, type, description, reported_by, created_at, tenant_id` | Sin columna `evolution` — se agrega al `description` con timestamp desde el backend |
| `wellness_logs` | `id, student_id, type, value, logged_by, created_at, tenant_id` | |
| `daily_visitors` | `id, visitor_name, id_number, company, visiting_whom, reason, check_in_time, check_out_time, tenant_id` | `id_number`/`company` agregadas 2026-08-26; `check_out_time` agregada 2026-08-29 |
| `camera_detections` | `id, door_id, image_url, detected_at, tenant_id` | El `INSERT` anónimo se cerró; falta endpoint propio para el webhook de cámaras (pendiente, ver `DISENO-Y-AVANCE.md` §6) |
| `forms` | `id, title, description, is_active, created_at, updated_at, target_grades text[], target_sections text[], form_type, tenant_id` | `form_type` (`'authorization'`\|`'announcement'`) y `target_sections` agregadas 2026-08-26 |
| `form_questions` | `id, form_id, question_text, question_type, order, created_at, tenant_id` | |
| `form_responses` | `id, form_id, parent_id, student_id, answers jsonb, created_at, tenant_id` | |
| `notifications` | `id, user_id, title, message, type, is_read, created_at, tenant_id, pickup_event_id` | `pickup_event_id` (agregada 2026-08-26, `ON DELETE SET NULL`) liga el aviso al personal con el pickup puntual que lo generó — usado por "quién fue avisado" en el Monitor Externo |
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
- App iOS: build 1.0 enviado a revisión de Apple el 2026-08-20, sigue
  "Pendiente de revisión" en App Store Connect (verificado el 2026-08-25).
- App Android: build publicado en las pistas de Prueba interna y Prueba
  cerrada de Google Play (no en producción todavía).
- **Pendiente antes de publicar cualquiera de las dos apps al público**:
  sacar a los 410 padres de prueba (Android: listas de Prueba interna/cerrada
  en Google Play; iOS: grupo externo "Test Casco" de TestFlight) para no
  dejarlos mezclados con usuarios reales — ver el detalle en "Apps móviles"
  §3.
- Notificación push nativa (aunque la app esté cerrada) para avisos/formularios
  y llegadas — hoy solo suena si el padre tiene la app abierta (Realtime +
  `notifications`). Requiere certificados APNs/FCM y backend que dispare el
  envío.
- 12 alumnos de TCS Albrook sin vincular a su padre tras el import masivo del
  2026-08-20 (nombre de hijo con orden invertido en el CSV, no encontró match
  exacto en el roster) — pendiente de vincular a mano desde el Directorio de
  Padres.
- ~~Google Play rechazó la ficha por "afirmaciones engañosas"~~ **Resuelto
  2026-08-27/28**: al menos 2 de las capturas de pantalla subidas a la ficha
  de Android tenían un badge morado "Apple Review" superpuesto (capturas
  hechas para la revisión de App Store, subidas por error también a Google
  Play). Se reemplazaron por capturas limpias reales de Android en todas las
  fichas de Play Store (inglés, español España/EE.UU./Latinoamérica) —
  Envío 3, publicado el 27-ago-2026 9:05pm en la pista de Prueba cerrada
  (Alpha), sin aviso de rechazo en "Resumen de publicación". Esto también
  desbloquea `android-deploy.yml`, que fallaba con 403 al subir un build
  nuevo mientras la app estaba en estado "Rechazada".
- 42 alumnos de secundaria de TCS Albrook sin foto (31 de ellos todo el grado
  07, matriculados después de la carpeta de fotos que compartió el colegio) —
  pendiente de que el colegio tome/envíe fotos nuevas para completarlos.
