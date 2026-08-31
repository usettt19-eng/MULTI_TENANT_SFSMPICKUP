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

### Visitantes: elegir el día a ver/exportar (2026-08-29)
- Antes la Bitácora traía **todo** el historial de visitantes sin filtro de
  fecha (iba a crecer sin límite). Ahora hay un selector de fecha (por
  defecto hoy, no permite elegir un día futuro) que filtra tanto la lista en
  pantalla como el PDF exportado — el título y el nombre del archivo del PDF
  también reflejan el día elegido (`visitantes_YYYY-MM-DD.pdf`). El filtro
  usa los límites del día en hora local del navegador, no UTC.

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

### Panel "Padres en el Perímetro": mismo tratamiento que En Tránsito (2026-08-29)
- El panel del Dashboard que muestra qué padres están dentro del perímetro
  del colegio (`ParentPerimeterPanel.tsx`) solo mostraba el nombre del padre
  en una sola fila, sin agrupar por puerta ni mostrar a qué alumno venían a
  buscar o en qué vehículo. Se le dio el mismo tratamiento que a la pantalla
  En Tránsito: agrupado/filtrable por puerta de salida (con un grupo aparte
  "Sin puerta asignada" para quien esté en el perímetro sin recogida
  anunciada todavía), ordenado por hora de llegada dentro de cada puerta, y
  cada tarjeta ahora muestra el alumno que vienen a buscar, el nombre del
  padre, y la placa del vehículo (si lo cargó desde su app) — no solo el
  nombre del padre. Cruza `parent_presence` con `pickup_events` (para
  alumno/puerta) y `vehicles` (para la placa) por `parent_id`.

### Padres en el Perímetro: sacar a los ya atendidos y colorear por prioridad (2026-08-29)
- Un padre que ya completó el ciclo de recogida hoy (`pickup_events.status =
  'completed'`, `completed_at` de hoy) ya no aparece en el registro visual de
  vehículos, aunque el GPS todavía lo marque "dentro" mientras se retira —
  se consulta aparte quién completó hoy y se excluye del listado.
- Mismo color de prioridad que En Tránsito, calculado por puerta (no
  global): dentro de cada puerta, los 5 vehículos que llegaron primero en
  rojo, los 5 siguientes en naranja, el resto en verde — el ícono del
  vehículo cambia de borde/color según su posición en la fila de esa puerta.
- **Alumno con grado/sección**: como puede haber más de un alumno con el
  mismo nombre en el colegio, cada tarjeta muestra grado y sección debajo
  del nombre para saber de qué salón es cada uno.
- **Puerta compartida entre pantallas**: el filtro de puerta de este panel
  ya no es independiente por pantalla. Se agregó `src/lib/monitoredDoor.ts`
  — un valor guardado en `localStorage` (por dispositivo, con clave por
  `tenant_id`) más un evento custom para sincronizar entre componentes
  montados en la misma pestaña. Monitor Externo y En Tránsito escriben ahí
  la puerta que eligen; el widget de "carritos" (sea en el Dashboard o
  dentro de Monitor Externo) la adopta automáticamente, sin tener que
  volver a elegirla — y si dentro del propio widget se elige una puerta
  real, también se propaga a las otras dos pantallas. La opción "Sin puerta
  asignada" es exclusiva de este panel (no existe en Monitor Externo/
  Tránsito) y se maneja como anulación local, sin propagarse.

### Anuncios de voz por puerta: cada personal solo escucha su propia puerta (2026-08-29)
- Con varias puertas de salida y una sola bocina por dispositivo, el
  personal ubicado en (por ejemplo) la puerta trasera no debía escuchar los
  anuncios de los alumnos que salen por otra puerta — eso lo atiende el
  personal de esa otra puerta. Antes esto NO se cumplía del todo:
  - En Monitor Externo (`VerificationDisplay.tsx`), la cola visible ya
    filtraba por puerta, pero el anuncio de "Salida de X solicitada" solo
    miraba el mapeo grado→puerta de Horarios de Salida, ignorando
    `pickup_events.door_id` (la puerta que el padre elige directo al
    anunciar) — se unificó en un solo helper `pickupMatchesDoor()` que usan
    tanto la cola como el anuncio, con el mismo criterio: `door_id` manda si
    existe, si no se usa el mapeo por grado.
  - En En Tránsito (`TransitMonitor.tsx`), el anuncio de "Alumno en
    tránsito" sonaba para **todas** las puertas sin importar cuál estuviera
    seleccionada en el filtro — ahora solo anuncia si el `door_id` del
    alumno coincide con la puerta elegida (o anuncia todas si no hay ninguna
    puerta seleccionada, para el dispositivo que vigila el colegio entero).
  - **Bug de cierre obsoleto (stale closure) corregido de paso**: en ambas
    pantallas, el anuncio de voz se dispara desde un `setInterval`/
    suscripción de Realtime armados una sola vez en un `useEffect` con
    `[tenant_id]` como única dependencia — sin una referencia (`useRef`)
    actualizada aparte, ese cierre se quedaba con la puerta seleccionada al
    montar la pantalla, y cambiar de puerta en el selector no tenía efecto
    en el anuncio hasta recargar la página (aunque la cola visible sí se
    actualizaba bien, porque esa se recalcula en cada render). Se agregó
    `selectedDoorIdRef` en ambas pantallas para que el anuncio siempre lea
    la puerta actual.
- Como la puerta seleccionada ahora es compartida entre Monitor Externo, En
  Tránsito y el widget de "carritos" (ver entrada anterior), el personal
  solo necesita elegir su puerta una vez en cualquiera de las tres pantallas
  para que el filtro de voz aplique en las demás.

### Salida Autónoma: alumnos que reportan su propia salida (2026-08-29)
- Nueva funcionalidad para alumnos que el colegio autoriza a irse solos
  (ej. mayores que caminan o van en bici a casa), sin que un padre/tutor
  los recoja — antes no había forma de registrar esa salida sin forzar un
  `pickup_event` con un padre inventado.
- **Designación (Students.tsx)**: el staff marca el checkbox "Permitir
  Salida Autónoma" en la ficha del alumno (`students.self_dismissal_allowed`).
  Al activarlo se genera un token único (`students.self_dismissal_qr_token`)
  y se muestra su código QR (`qrcode.react`). Al desactivarlo el token se
  borra, así un QR impreso viejo deja de servir si se reactiva más adelante
  (se genera uno nuevo). La lista de alumnos muestra una etiqueta "Autónomo"
  junto al nombre de quienes lo tienen habilitado. Al tocar el QR se abre un
  modal con el código en grande (`QRCodeCanvas`, no el `<svg>` chico de la
  vista previa — así se le puede sacar un PNG con `canvas.toDataURL()`) con
  botones para **descargarlo** (PNG) o **imprimirlo** (abre una ventana
  nueva solo con el código y dispara `window.print()`).
- **Identificación (Check-In → `SmartCheckIn.tsx`)**: dos métodos, ambos
  reusando la infraestructura de cámara que ya existía en esa pantalla —
  - *Código QR*: el mismo lector QR de la pantalla (antes solo aceptaba QR
    de reemplazo de padre) ahora también reconoce `{type: 'self_dismissal',
    student_id, token}` y valida el token contra el alumno.
  - *Reconocimiento facial*: se agregó un selector "Padre/Tutor" vs "Salida
    Autónoma" en el panel de cámara — en modo alumno compara contra las
    fotos de los alumnos con `self_dismissal_allowed = true` (no contra
    padres). La lógica de comparación se extrajo a un helper compartido
    (`matchFaceAgainstPhotos`) para no duplicarla entre los dos modos.
  - Ambos métodos, antes de registrar nada, muestran un modal de
    confirmación (foto, nombre, grado/sección) para que el personal
    verifique visualmente que el QR/rostro corresponde al alumno correcto
    antes de tocar "Confirmar Salida" — evita registrar una salida por un
    mal escaneo o falso positivo facial.
- **Registro**: se guarda en una tabla propia, `self_dismissal_events` (id,
  tenant_id, student_id, method `'qr'`\|`'face'`, verified_by, created_at) —
  deliberadamente **no** un `pickup_event` (no hay padre ni vehículo, y
  mezclarlo ahí habría distorsionado las estadísticas de recogida por
  padres). RLS: política `staff_only` igual que el resto de tablas
  operativas. Además queda un espejo en `audit_logs` (`event_type:
  'PICKUP'`, descripción con el prefijo "SALIDA AUTÓNOMA:") para que
  aparezca en la Bitácora normal, claramente distinguido de una recogida
  real.
- **Panel en el Dashboard**: nueva sección "Salidas Autónomas de Hoy"
  (`OperationsDashboard.tsx`), junto al panel de Salidas del Día por Grado/
  Sección pero separado de él (no se suman entre sí, son conceptos
  distintos). Lista en tiempo real cada salida autónoma de hoy con foto,
  nombre, grado/sección, método (QR o Facial) y hora — con contador total
  del día, actualizado vía suscripción a `self_dismissal_events` + el mismo
  poll de 10s del resto del Dashboard.

### Reporte del Día (2026-08-29)
- Nuevo botón "Reporte del Día" en el encabezado del Dashboard
  (`OperationsDashboard.tsx`) que abre `DailyReportModal.tsx`:
  - **Vista preliminar**: cifras del día en cuadrícula (recogidas
    anunciadas/completadas, confirmadas sin GPS, tiempo promedio de
    recogida, Salidas Autónomas, visitantes, solicitudes de reemplazo por
    estado, incidentes, alertas de salud, respuestas a formularios) antes
    de generar nada.
  - **PDF con anexos**: al confirmar, genera un PDF (`jsPDF` +
    `jspdf-autotable`, mismo patrón que el PDF de Visitantes) con el
    resumen y 5 anexos de detalle: recogidas, salidas autónomas,
    visitantes, solicitudes de reemplazo e incidentes del día.
  - **Se guarda en el sistema**: el PDF se sube a un bucket de Storage
    privado nuevo, `daily-reports` (a diferencia de `avatars`/`logos`/
    `downloads`, que son públicos — un reporte trae datos agregados de
    todo el colegio, no algo que cualquier padre debería poder ver), en
    `{tenant_id}/{fecha}/{uuid}.pdf`. Políticas de Storage con
    `is_staff_of()` (no solo coincidencia de `tenant_id` como en
    `avatars`/`detections`) para SELECT/INSERT/DELETE. Metadata + cifras
    quedan en la tabla nueva `daily_reports` (RLS `staff_only`), para poder
    listar y volver a descargar reportes ya generados sin regenerarlos
    (URLs firmadas de 60s vía `createSignedUrl`, el bucket no es público).
  - Además de guardarse, el PDF se descarga localmente al generarlo, y
    queda un registro en `audit_logs`.
  - **Selector de fecha (2026-08-29)**: el reporte no está fijo a "hoy" —
    hay un selector de fecha (no permite elegir un día futuro, mismo patrón
    que el de VisitorsLog.tsx) que recalcula la vista preliminar con los
    límites de ese día en hora local, y la lista de "Reportes Guardados" se
    filtra al día elegido (`daily_reports.report_date`).

### Panel "Operational Speed" del Dashboard: más accesos y color (2026-08-29)
- El panel de accesos rápidos del Dashboard pasó de 4 a 8 botones a lo
  largo del día: se agregaron **Bitácora de Visitantes**, **Formularios**,
  **Solicitudes** (de reemplazo) y **En Tránsito**, junto a los ya
  existentes (Agregar Padre, Firma de Invitado, Registro Médico, Monitor
  Externo).
- A pedido del usuario, se cambió el color de fondo de los 8 botones —
  antes `bg-[#1e293b]` (negro/gris muy oscuro) — a `bg-indigo-600`
  (`hover:bg-indigo-500`), el mismo acento que ya se usa en las pantallas
  más nuevas (En Tránsito, Padres en el Perímetro, Salida Autónoma).

### Diseño responsive en toda la app: móvil, tablet, iPad, escritorio (2026-08-29)
- El "shell" de la app (`Layout.tsx` + `Sidebar.tsx` + `TopNav.tsx`) ya
  estaba bien resuelto de antes: el sidebar es un cajón (`drawer`) que se
  esconde bajo `md` y se abre con el botón hamburguesa de `TopNav`, y el
  contenido nunca desborda horizontalmente (`overflow-x-hidden`). La mayoría
  de las pantallas (Ajustes, Familias, Bienestar, Cumplimiento, Formularios,
  Estadísticas, Login, Check-In) también ya usaban breakpoints (`sm:`/`md:`/
  `lg:`) de una pasada anterior de este mismo día.
- Se auditaron las 23 pantallas de `src/views/` buscando patrones típicos
  de ruptura en pantallas angostas — filas `flex justify-between` que no
  envuelven, tablas sin `overflow-x-auto`, texto con tamaño fijo grande,
  inputs con ancho fijo (`w-64`) — y se corrigieron los que sí rompían:
  - `VisitorsLog.tsx`: la tabla no tenía `overflow-x-auto` (desbordaba en
    móvil); el encabezado (fecha + buscador + exportar) no apilaba.
  - `AuditLogs.tsx`: la fila de 5 filtros + exportar no envolvía ni
    scrolleaba en pantallas angostas.
  - `VerificationDisplay.tsx`: el selector de puerta no apilaba; el overlay
    de Lockdown tenía texto `text-6xl` fijo que se salía en pantallas
    chicas.
  - `StaffManagement.tsx` / `RequestsCenter.tsx`: encabezados con
    buscador de ancho fijo que no apilaban con los botones de acción.
  - `OperationsDashboard.tsx`: la barra de "activar audio", el banner de
    alerta de salud (con mensaje dinámico que puede ser largo) y cada
    tarjeta de la cola en vivo (nombre + PIN + botón) no apilaban.
  - `WellnessCenter.tsx`: las tarjetas de alertas críticas, medicación
    crítica y horario de medicación (foto + nombre + detalles + botones)
    tampoco apilaban.
- El resto de patrones revisados (grids de 2-4 columnas dentro de tarjetas/
  modales angostos, formularios de 2 campos por fila) ya funcionaban bien
  en móvil sin cambios — se dejaron así para no tocar código que no estaba
  roto.
- **Pendiente**: esta auditoría se hizo por inspección de código (patrones
  de Tailwind), no con pruebas visuales en dispositivos reales — si el
  colegio encuentra alguna pantalla específica que se vea mal en un
  celular/tablet/iPad en particular, conviene reportarla para corregirla
  puntualmente.

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
- `public/manual-personal.html` (2026-08-30, nueva): guía general para
  todo el staff involucrado en la salida (no solo recepción) — el flujo
  completo de una recogida, roles y qué pantalla usa cada uno, cómo
  configurar cada dispositivo el día de salida, casos especiales, Bloqueo
  de Emergencia, y la red de seguridad del auto-completado. Complementa
  `manual-recepcion.html`/`manual-enfermeria.html`, mismo estilo visual.
  `manual-recepcion.html` se actualizó el mismo día con Salida Autónoma en
  Check-In, el selector de idioma, y una nota sobre el contador de la
  campana de notificaciones. También se generó una presentación (.pptx,
  13 slides) del mismo contenido para capacitación presencial del staff.
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

### Bugs reales de responsive encontrados en dispositivo (2026-08-29)
Tras la auditoría de código de la sección "Diseño responsive" de más arriba,
el colegio reportó con capturas de un celular real tres problemas que la
auditoría por patrones no había detectado:
- **Dashboard**: el encabezado (logo + título + botón "Reporte del Día") se
  encimaba en pantallas angostas — la fila no apilaba. Corregido apilando en
  `flex-col` bajo `sm:` con el botón `shrink-0`.
- **Monitor Externo**: la fila de 3 botones (Probar Voz / Escanear Reemplazo
  / Alerta Discreta) se cortaba en vez de envolver. Corregido agregando
  `flex-wrap`.
- **Bitácora de Visitantes — "Exportar PDF" invisible**: el botón
  desaparecía (bloque de color sólido, sin texto visible) solo en
  orientación vertical, reproducible tanto en Chrome como en Firefox del
  mismo dispositivo. Resultó ser **tres bugs distintos apilados**:
  1. Bug real de layout: el buscador tenía `flex-1` y absorbía todo el
     ancho de la fila, empujando el botón de exportar fuera de la vista.
     Corregido quitando el `flex-1` y dando ancho explícito
     (`w-full sm:w-auto` / `sm:w-64`) a cada control.
  2. **Bug de caché de Docker Compose Bake**: `docker compose build` estaba
     marcando `COPY . .` y `RUN npm run build` como `CACHED` aunque ya
     hubiera commits nuevos descargados — el contenedor seguía sirviendo el
     JS/CSS viejo pese a un build "exitoso". Diagnosticado comparando la
     salida de `docker compose build` (todo `CACHED`, 0.0s) contra un
     rebuild forzado (build real de 15.5s). **Desde ahora, el procedimiento
     estándar de redespliegue para este proyecto es**:
     `docker compose build --no-cache sfsmpickup && docker compose up -d --force-recreate sfsmpickup`
     — un `docker compose build && docker compose up -d` simple ya no es
     confiable aquí.
  3. Una vez desplegado el fix real, el botón seguía invisible en vertical.
     Se descartó por captura del usuario que fueran los ajustes de
     Accesibilidad de Android ("Mejoras de la visión" — fuentes, alto
     contraste, inversión de color, corrección de color — todos
     desactivados). Se verificó con una réplica aislada en Playwright (CSS
     real compilado, 375×800 y 800×375) que el botón renderiza bien en
     ambos casos, descartando el código. Diagnóstico final: auto-oscurecido
     de contenido a nivel de navegador (Chrome/Firefox en Android oscurecen
     automáticamente páginas que no declaran su esquema de color cuando el
     celular está en modo oscuro del sistema), independiente de las
     opciones de Accesibilidad. Corregido agregando
     `<meta name="color-scheme" content="light">` en `index.html` más
     `:root { color-scheme: light; }` en `index.css`, para que la app
     siempre se declare clara sin importar el tema del sistema.

### TopNav: candado, campana y engranaje ahora tienen función (2026-08-30)
El colegio reportó que en la mayoría de las pantallas estos tres íconos de
la barra superior aparecían pero no hacían nada. Cambios en `TopNav.tsx`:
- **Candado**: pasa a ser un indicador de solo lectura del estado de
  Bloqueo (Lockdown) — se suscribe al mismo canal Realtime
  `system_state`/`lockdown` que ya usan `Sidebar.tsx` y
  `VerificationDisplay.tsx`, más una lectura inicial de
  `school_settings.lockdown_mode`. Se dejó deliberadamente como solo
  lectura (no un segundo interruptor) para no duplicar un control sensible
  en dos lugares — el popover aclara que el toggle real vive en el sidebar.
- **Campana**: panel de notificaciones real (antes solo mostraba un punto
  rojo fijo sin abrir nada) — trae `notifications` del usuario, marcar
  leída individual/todas, eliminar, y actualización en tiempo real vía
  `postgres_changes`, replicando el patrón ya usado en
  `ParentDashboard.tsx`. El contador del badge solo aparece si hay no
  leídas.
- **Engranaje** (solo admin): navega a la vista de Configuración. Como
  `TopNav` se instancia dentro de cada pantalla (no una sola vez en
  `Layout.tsx`), no tenía forma de llegar al `setCurrentView` de `App.tsx`
  — se agregó `setCurrentView` a `LayoutContext.tsx` para resolverlo.

### Más botones decorativos conectados (2026-08-30)
Tras el arreglo del TopNav se hizo un barrido de toda la app buscando
`<button>` sin `onClick`. Se conectaron los que sí tenían algo real detrás:
- **Vigilancia de Accesos → "Abrir Monitor"**: navega al Monitor Externo
  (misma pantalla del sidebar), vía `setCurrentView` de `LayoutContext`.
- **Monitor Externo → "Alerta Discreta"**: nuevo endpoint
  `POST /api/security/discrete-alert` — registra en `audit_logs` y notifica
  a los administradores/staff del colegio (`notifyTenantAdmins`), sin
  alterar visualmente la pantalla del monitor (a propósito: no debe delatar
  al personal frente a quien esté mirando la pantalla).
- **Check-In → "¿Necesitas ayuda?"**: mismo endpoint con
  `kind: 'help_request'`, para pedir que se acerque personal al mostrador.
- **Bienestar → "Ver Plan"** en cada alerta crítica: abre el modal de
  Expediente ya existente con el alumno de esa alerta preseleccionado.
- **Bienestar → "Ver todos los registros"**: abre ese mismo Expediente para
  elegir cualquier alumno, en vez de quedarse solo con el resumen del día.

**Pendiente a discreción del colegio** (quedaron sin tocar a propósito,
confirmado con el usuario): los botones "Reporte Notas", "Asistencia",
"Secciones" y "Filtros" en Estudiantes (Accesos Directos), y
"View Full History" en Cumplimiento — no tienen tablas ni datos reales
detrás en el sistema (no existe módulo de notas/calificaciones ni de
asistencia); son botones de la plantilla original nunca conectados. Antes
de darles función habría que decidir si se construyen de verdad o si se
quitan.

### Sidebar reordenado por uso (2026-08-30)
El orden anterior no seguía ninguna lógica (mezclaba operación diaria con
back-office). Nuevo orden en `Sidebar.tsx` (`allNavItems`), en 4 grupos:
1. **Operación del día**: Dashboard, Check-In, Security, External Monitor,
   In Transit, Wellness, Visitors — el recorrido real de un alumno
   saliendo, de lo que más se consulta a lo que menos.
2. **Rosters**: Students, Parents/Guardians.
3. **Comunicación**: Forms, Requests.
4. **Back-office**: Logs, Compliance, Staff Management, Statistics — lo
   que el personal de puerta rara vez abre.

No cambia qué ve cada staff (sigue dependiendo de sus permisos en
`StaffManagement.tsx`), solo el orden dentro de esa lista.

### Operational Speed del Dashboard, mismo orden (2026-08-30)
El panel de accesos rápidos del Dashboard tenía el mismo problema que el
sidebar: External Monitor e In Transit (el flujo real de salida) estaban
al final, después incluso de Forms/Requests. Reordenado a: External
Monitor, In Transit, Guest Sign, Visitor Log, Med Log, Add Parent, Forms,
Requests.

### Ajustes del Sistema traducido al inglés (2026-08-30)
Se reportó que, aunque el idioma de la UI (selector del TopNav) estaba en
inglés, la pantalla de **Ajustes** (`Settings.tsx` y sus 2 sub-pestañas
`SchoolStructureSettings.tsx` y `DismissalScheduleSettings.tsx`) seguía
en español. Causa: esos 3 archivos nunca llamaban a `useLanguage()`/`t()`
— todo el texto estaba fijo en español desde que se escribieron,
independiente del sistema de traducción que sí usa el resto de la app.
Se agregaron ~100 claves nuevas (`settings.*`, `settingsStructure.*`,
`settingsDismissal.*`) en `i18n/translations.ts` y se conectaron los 3
archivos.

Dos decisiones de alcance, documentadas en el commit:
- Los mensajes que se guardan en la bitácora de actividad (`logActivity`)
  se dejan siempre en español — son registros de auditoría, no texto de
  UI en vivo; traducirlos mezclaría idiomas dentro de un mismo registro
  según quién lo generó en cada momento. `staffLabel()`/`scheduleLabelEs`
  siguen en español para eso; se agregaron `staffLabelUi()`/
  `scheduleLabel` (sí traducidos) para lo que se ve en pantalla.
- Los bloques de instrucciones SQL para configurar tablas/RLS faltantes
  en `SchoolStructureSettings.tsx` (un error de configuración de base de
  datos que nunca debería verse en producción) se dejan sin traducir —
  son texto para el desarrollador, no para el usuario final.

### Más pantallas traducidas: formulario de padres, de estudiantes, y el panel de perímetro (2026-08-30)
Mismo patrón que Ajustes — el usuario reportó que estas tres piezas
tampoco cambiaban con el selector de idioma del TopNav:
- **`ParentPerimeterPanel.tsx`** (el "box" de vehículos/padres dentro del
  perímetro, usado en Vigilancia de Accesos y Monitor Externo).
- **`GuardiansRegistry.tsx`**: encabezado, barra de herramientas, vista de
  grilla/tabla, modal de confirmación de borrado, overlay de progreso de
  importación CSV, y el formulario completo de alta/edición de padre. Se
  dejan sin traducir a propósito los encabezados del CSV exportado
  (contenido de archivo, no UI) y los mensajes de resultado de la
  importación masiva (multilínea, generados en bucle, poco frecuentes).
- **`Students.tsx`**: el modal de alta/edición de alumno ya usaba algunas
  claves (`students.firstName`, etc.) pero el resto — título, sección de
  foto, Salida Autónoma, botones del pie, y el modal de vista previa del
  QR — seguía fijo en español.

~70 claves nuevas en `i18n/translations.ts` (`perimeter.*`,
`guardiansPage.*`, más ~26 nuevas bajo `students.*`).

### Gestión de Personal traducida, incluido el modal de permisos (2026-08-30)
Mismo patrón, esta vez reportado con captura del modal "Editar Permisos de
Staff" en español pese a tener el idioma en inglés. `StaffManagement.tsx`
tampoco llamaba nunca a `useLanguage()`/`t()`. Cambio notable: el array
`AVAILABLE_MODULES` (`{id, label}` con el label fijo en español) se separó
en `AVAILABLE_MODULE_IDS` (solo ids, para iterar/filtrar) +
`MODULE_LABEL_KEYS` (id → `TranslationKey`), reutilizando las claves
`nav.*` del sidebar cuando el texto coincide exactamente (ej. `students`,
`checkin`, `forms`) y agregando `staffModule.*` nuevas para los que tienen
texto más específico en este contexto (ej. `security` → "Seguridad
(Salidas)" en vez de solo "Seguridad"). ~35 claves nuevas bajo
`staffPage.*`/`staffModule.*`, reutilizando además varias de
`guardiansPage.*` ya existentes en vez de duplicarlas.

### Editar staff (nombre y foto), no solo permisos (2026-08-30)
El usuario notó que el modal de edición de staff ocultaba por completo
Nombre/Apellido/Correo cuando se editaba un staff existente — solo dejaba
tocar permisos y el aviso de llegadas, sin forma de corregir un nombre mal
escrito ni de agregarle foto. Cambios:
- **Frontend** (`StaffManagement.tsx`): Nombre y Apellido ahora son
  editables tanto al crear como al editar (el correo sigue solo
  disponible en alta — cambiarlo tocaría el login en Supabase Auth, fuera
  de alcance por ahora). Se agregó selector de foto (URL/Archivo/Cámara),
  el mismo componente ya usado en el alta de padres, con el mismo patrón
  de guardar el payload directamente en `photo_url` sin subirlo a Storage
  aparte. La tarjeta de cada staff en la lista ahora muestra su foto si
  tiene una.
- **Backend**: `POST /api/staff` ahora guarda `photo_url` en la creación;
  `PUT /api/staff/:id` ahora también acepta `first_name`/`last_name`/
  `photo_url` además de `permissions`/`notify_all_arrivals` — todos
  opcionales, así que guardar solo permisos (el caso más común) no pisa
  el resto con vacío.
- Título del modal y del botón cambiados de "Editar Permisos" a "Editar
  Staff" para reflejar el alcance nuevo.

**Pendiente** (fuera de alcance de este cambio, discutido con el usuario):
un perfil de staff que el propio miembro del personal pueda completar por
sí mismo (no solo el admin) — requeriría una pantalla nueva accesible
para cualquier staff, no solo admin, y decidir qué campos puede tocar de
su propio perfil.

### Fix: "Escanear Reemplazo" era una simulación, no escaneaba nada (2026-08-30)
El usuario reportó (con captura) que el modal de "Escanear Reemplazo" en
Monitor Externo decía literalmente *"In a real environment, the camera
would activate here. For this demo, paste the generated QR data"* — nunca
activaba la cámara, solo pedía pegar el JSON a mano. Peor aún: revisando
el código, tampoco validaba nada — aceptaba cualquier JSON con
`type:"replacement_pickup"` y mostraba "QR VÁLIDO" sin comprobar el token
contra los reemplazos reales del padre, justo en la pantalla que autoriza
entregar a un alumno. Arreglado:
- Cámara real vía `html5-qrcode` (mismo lector y configuración que ya usa
  Check-In en `SmartCheckIn.tsx`, sin agregar dependencia nueva).
- El código escaneado ahora se valida de verdad: se busca al padre por
  `parent_id` y se comprueba que el token coincida con uno de sus
  reemplazos autorizados (`additional_tutor_name.replacements`) — mismo
  criterio que ya aplicaba Check-In, que Monitor Externo nunca tuvo.
- Cada verificación (éxito o fallo) queda en `audit_logs`.
- Se quitó el textarea de "pegar el QR a mano".

### Fix: "Database error deleting user" al borrar staff (2026-08-30)
`DELETE /api/staff/:id` llamaba a `admin.auth.admin.deleteUser(id)` sin
soltar antes las filas que referencian a ese usuario en otras tablas —
cualquier FK bloqueando el borrado hacía que Supabase devolviera ese
mensaje genérico sin decir cuál. Ahora, antes de borrar el usuario de
Auth: se borran `notifications` y `staff_school_access` (como
`staff_id`); se anonimizan a `NULL` `staff_school_access.granted_by` y
`dismissal_overrides.created_by` (sin borrar el acceso/excepción de otra
persona); en `dismissal_assignments`, si el staff estaba en el slot 1 y
había alguien en el slot 2 se promueve, si no se borra la asignación, y
si solo estaba en el slot 2 se vacía ese slot; y se intentan anonimizar
`student_incidents.reported_by`, `daily_reports.generated_by` y
`self_dismissal_events.verified_by` sin borrar esos registros (son
historial de auditoría/salud del alumno).

### Acceso directo al manual desde la app de padres (2026-08-30)
El usuario pidió un atajo al manual de uso online desde la propia app de
padres (`ParentDashboard.tsx`). Se agregó un botón con ícono `HelpCircle`
en el header, junto al selector de idioma/campana/logout, que abre en una
pestaña nueva `/guia-padres.html` o `/parent-guide.html` según el idioma
activo (`language` de `useLanguage()`). Ambos archivos ya existían en
`public/` (actualizados el mismo día) pero no estaban enlazados desde
ningún lado de la app — solo accesibles escribiendo la URL a mano.

### Fix: mini-gráfica "Distribución Grados" en Estudiantes era falsa (2026-08-30)
El usuario mandó una captura de la tarjeta "Distribución Grados / Análisis
de capacidad por nivel" en `Students.tsx`, vacía. Al revisar el código, las
barras usaban alturas fijas hardcodeadas (`[40, 70, 45, 90, 60, 80]`), sin
relación con los alumnos reales — y "capacidad por nivel" no corresponde a
nada real: `school_grades` no tiene ningún campo de cupo/capacidad máxima.
Se reemplazó por una distribución real: cuenta de alumnos por grado
(`gradeDistribution`, sobre `orderedGrades`/`students`, sin aplicar el
filtro de búsqueda activo para que la tarjeta siempre refleje el total del
colegio), barras con altura proporcional al grado con más alumnos, tooltip
con el nombre del grado y su cuenta al pasar el mouse, y estado vacío si
aún no hay alumnos con grado asignado. Título y subtítulo ahora traducidos
(`students.gradeDistribution*`) en vez del texto engañoso anterior.

**Seguía vacía tras el primer fix** — el usuario confirmó que los 320
alumnos sí tienen grado asignado (se agrupan bien en la tabla de arriba),
así que no era falta de datos: era un bug de CSS que ya existía desde
antes de tocar la lógica. Cada barra es un `div` interno `absolute` con
`height: X%`, dentro de un `div` "riel" con `flex-1` — pero `flex-1` en un
flex-row solo reparte ancho, no da altura, así que el riel quedaba con
altura `auto` (0, porque su único hijo es `absolute` y no cuenta en el
flujo). Un `height: %` sin una altura de referencia concreta en el padre
no tiene contra qué calcularse, así que la barra nunca se veía — con datos
falsos o reales, daba igual. Fix: `h-full` en el riel para que herede los
64px del contenedor (`h-16`), y ahí sí el `height: %` interno tiene algo
real contra qué resolverse.

### Fotos de alumnos — TCS Costa del Este (2026-08-30)
Mismo proceso que con TCS Albrook: el colegio compartió una carpeta de
fotos en Supabase Storage (`avatars/f51150be-8d11-42e2-9d12-58fe9634b0eb/`),
subdividida por clase (`NURSERY - TURTLES`, `RECEPTION - MONKEYS`,
`YEAR 1 - FROGS`...`YEAR 6 - EAGLES`). **Hallazgo**: el nombre de esas
subcarpetas va un grado corrido respecto al `grade` real en el sistema —
`NURSERY` = grado `RC`, `RECEPTION` = grado `01`, `YEAR 1` = grado `02`,
..., `YEAR 5` = grado `06`. Se confirmó cruzando cada nombre de archivo
contra el alumno real de ese grado (varios con apodo o error de tipeo:
"Bailey"→Yung-Pei Chen, "Sasha"→Alexander Halmos, "Mateo"→Matteo Masi,
"Traad"→Tradd Mora Sanchez). De 85 fotos, 68 hicieron match y se
vincularon por `UPDATE` masivo (mismo criterio que TCS Albrook); 17 no
corresponden a ningún alumno matriculado actualmente (`YEAR 6 - EAGLES`
completo — grado `07`, que no existe todavía en este colegio — más un
puñado sueltos en otras carpetas) y quedan pendientes de que el colegio
confirme si son alumnos nuevos por agregar. 53 alumnos de los 121 siguen
sin foto (la carpeta no los cubría).

### Fix: RLS de Storage bloqueaba subir fotos como super_admin en otro colegio (2026-08-30)
Al subir una foto de alumno desde la app estando en "Modo Super Admin"
configurando TCS Costa del Este: `Error al subir la imagen: new row
violates row-level security policy`. Causa: las políticas de
`storage.objects` para los buckets `avatars`/`detections`
(`sql/storage_setup.sql`) comparan la carpeta del archivo contra el
`tenant_id` del **propio perfil** de quien sube — nunca se les agregó la
excepción `public.is_super_admin()` que sí tiene el resto de tablas desde
`tenant_isolation_rls.sql`, así que un super_admin (cuyo perfil no
pertenece al tenant que está configurando) quedaba bloqueado. Se agrega
`sql/fix_storage_super_admin.sql`: recrea las 6 políticas (SELECT/INSERT/
UPDATE/DELETE en `avatars`, SELECT/INSERT en `detections`) con
`OR public.is_super_admin()`.

### Gestión de Personal: no se podía editar los permisos de alguien "de otro colegio" (2026-08-30)
El staff con acceso concedido a un segundo colegio (tabla
`staff_school_access`, sección "Access from other schools" en
`StaffManagement.tsx`) solo se podía revocar, nunca editar — si al
otorgarle el acceso no se marcó ningún módulo, quedaba con permisos
vacíos y sin forma de arreglarlo salvo revocar y volver a agregarlo desde
"Agregar Staff" (confuso, y nada obvio). Se agrega:
- Backend: `PUT /api/staff/school-access/:staffId/:tenantId` — actualiza
  solo `permissions` de esa fila (nombre/correo/foto no aplican, viven en
  su perfil real de su colegio de casa).
- Frontend: cada tarjeta de "acceso de otro colegio" ahora muestra los
  módulos ya otorgados como chips (antes no se veía nada, por eso no era
  obvio que estaban vacíos) y tiene un botón de editar junto al de
  revocar. El modal, en este modo (`editingGrantId`), oculta foto/nombre/
  correo/aviso de invitación y el toggle de "notificar todas las
  llegadas" (no existen en `staff_school_access`) y solo deja tocar la
  grilla de módulos.

### En Tránsito: el personal puede sacar a un alumno sin esperar al padre (2026-08-31)
`TransitMonitor.tsx` era de solo lectura — si el padre no confirmaba en su
app (sin señal, batería, o simplemente no lo hizo), el alumno se quedaba
ahí indefinidamente hasta que el auto-cierre a los 20 minutos lo sacara.
Se agregó un botón pequeño en la fila del adulto de cada tarjeta
(`handleStaffComplete`) para que el personal que entrega físicamente al
alumno lo confirme desde ahí mismo. Usa la misma transición de estado que
el botón del padre en `ParentDashboard.tsx` (`handleFinalConfirm`):
`pickup_events` de `'released'` a `'completed'`, con `completed_at` — pero
filtrando por el `id` del pickup en vez de por `parent_id`, así que no
toca ni depende de la lógica del padre. Queda registrado en la Bitácora
con el prefijo "CICLO COMPLETADO (personal)" para diferenciarlo del cierre
hecho por el padre o del automático a los 20 minutos.

### El padre ya puede subir su propia foto (2026-08-31)
Antes solo el staff podía cargarle foto a un padre (`GuardiansRegistry.tsx`,
desde el colegio). Se agregó el mismo selector de URL/archivo/cámara al
header de `ParentDashboard.tsx` — tocar el avatar abre un modal para
cambiar la foto. Se guarda como base64 directo en `profiles.photo_url`
(mismo criterio que `GuardiansRegistry.tsx`, no vía Storage: el padre no
es `is_staff_of()` de ningún tenant, así que las políticas del bucket
`avatars` lo rechazarían). Como `AuthContext` nunca exponía una forma de
refrescar el perfil activo sin recargar la página, se agregó
`refreshProfile()` al contexto (reutiliza `fetchProfiles` internamente) —
útil en general para cualquier edición futura del propio perfil, no solo
la foto.

### Dashboard: nueva tarjeta con los Car Pools configurados (2026-08-31)
Los car pools recurrentes (`carpool_authorizations`) solo se veían de
pasada en Solicitudes (`RequestsCenter.tsx`), mezclados en el feed de
actividad junto con reemplazos y limitados a los últimos 50 creados — uno
configurado hace tiempo podía quedar fuera de esa vista aunque siguiera
activo, sin ninguna pantalla que mostrara "esto es lo que hay configurado
ahora mismo". Se agregó una tarjeta "Car Pools Configurados" en
`OperationsDashboard.tsx` (entre "Salidas Autónomas de Hoy" y "Pickup Zone
Analysis"), con tiempo real vía suscripción a `carpool_authorizations`:
cada fila muestra el alumno, quién autoriza → quién conduce, y el día de
la semana, sin límite de antigüedad. Se agregaron las claves de traducción
de fin de semana que faltaban en `WEEKDAY_KEYS`
(`settingsDismissal.weekdaySat`/`weekdaySun`) para poder cubrir los 7 días
que admite `day_of_week`, aunque en la práctica el colegio solo configura
de lunes a viernes.

### Fix: foto de perfil del padre sin comprimir causaba timeouts en toda la app (2026-08-31)
El colegio reportó la app lenta y, al iniciar sesión, `Timeout: La conexión
con el servidor tardó demasiado.` / `fetchProfiles error: upstream request
timeout`. Se descartó el servidor Docker (contenedores sanos, `sfsmpickup`
responde en 1.3ms local) y la red del colegio (el mismo timeout salía
también desde el servidor). La causa real, confirmada con
`pg_stat_statements` en el SQL Editor de Supabase: el `UPDATE profiles SET
photo_url = ...` de la foto de perfil del padre (agregada hoy mismo, ver
entrada "El padre ya puede subir su propia foto") tardaba **1.5s
promedio** — porque se guarda como base64 directo en la columna sin
comprimir, y una foto de cámara/galería sin recortar pesa varios MB de
texto. Esa misma columna se trae de vuelta en **cada** `SELECT * FROM
profiles` de toda la app — incluido `fetchProfiles`, que corre en cada
login — así que una sola foto pesada podía arrastrar timeouts para
cualquiera, no solo para ese padre. Se agrega compresión del lado del
cliente en `ParentDashboard.tsx` (`takePhotoPicture`/
`handlePhotoFileUpload`, vía un `<canvas>` oculto): recorta a máximo 480px
de lado y JPEG calidad 0.72 antes de guardar, bajando el peso típico de
varios MB a decenas de KB. Las 4 fotos que ya se habían guardado sin
comprimir mientras se probaba la función quedan pendientes de limpiar a
mano (o de que esos padres vuelvan a subirlas con la app ya actualizada).

**Pendiente/hallazgo aparte, sin resolver**: `pg_stat_statements` también
mostró `SELECT name FROM pg_timezone_names` con 632 llamadas y 368
segundos acumulados — no lo llama nuestro código en ningún lado; probable
una pestaña de Supabase Studio con algún selector de fecha/zona horaria
refrescándose sola. No se investigó más a fondo.

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
| `students` | `id, first_name, last_name, grade, section, created_at, photo_url, tenant_id, self_dismissal_allowed, self_dismissal_qr_token` | `self_dismissal_allowed`/`self_dismissal_qr_token` agregadas 2026-08-29 (ver Salida Autónoma en §3) |
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
| `self_dismissal_events` | `id, tenant_id, student_id, method('qr'\|'face'), verified_by, created_at` | Agregada 2026-08-29 — salidas autónomas de alumnos, separado de `pickup_events` (ver §3) |
| `daily_reports` | `id, tenant_id, report_date, generated_by, file_path, summary jsonb, created_at` | Agregada 2026-08-29 — metadata de los PDFs de Reporte del Día guardados en el bucket privado `daily-reports` (ver §3) |
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
