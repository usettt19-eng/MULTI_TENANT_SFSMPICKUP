# Puntos de restauración

Marcas manuales de commits confirmados como estables en producción. No se
usan tags de git (esta sesión de trabajo solo tiene permiso de escritura
sobre la rama `claude/tenant-isolation-rls`, no para crear tags nuevos en
el repo) — el commit mismo, ya empujado a GitHub, es el respaldo.

Para volver a un punto de restauración si algo se rompe:

```bash
cd /home/user/multi_tenant_sfsmpickup
git fetch origin claude/tenant-isolation-rls
git reset --hard <hash>
git push --force-with-lease origin claude/tenant-isolation-rls
```

Y luego, en el servidor (`/root/sfsmpickup`):

```bash
git pull origin claude/tenant-isolation-rls
docker compose build --no-cache
docker compose up -d
```

---

## 2026-09-19 — `40fb03984f6ecebd8926147e5e7e54dd15ad10e1`

**Landing page pública + SEO + botón por hijo + Reporte del Día con alertas de login + roster de Salida Autónoma**

Confirmado funcionando en producción. Incluye todo lo del punto anterior (2026-09-10) más:

- Página pública `/LandingPage` con todas las funciones del sistema (para padres y para colegios), enlaces a Android/iOS, WhatsApp e Instagram/Facebook.
- SEO: `robots.txt`, `sitemap.xml`, meta tags OG/Twitter, JSON-LD, verificación de Google Search Console — dominio verificado y sitemap aceptado.
- Enlaces a Instagram y Facebook en el login.
- Fix de seguridad: la foto de la persona de reemplazo fallaba por RLS al subirse a Storage (un padre no es "staff") — ahora se guarda como base64 directo, igual que la foto de perfil.
- Botón de "Anunciar llegada" por cada hijo cuando hay más de uno (antes siempre anunciaba a todos juntos), con la pregunta de "¿cuáles salen juntos?" — soporta subgrupos (ej. 2 de 3 hijos), no solo todos-o-nada.
- Reporte del Día: nuevas secciones "Padres pendientes de loguearse" y "Padres inactivos hoy" (con la sección/grado de cada uno), excluyendo a quienes ya están cubiertos por otro padre, a quienes tienen hijo en bus, y a quienes tienen Salida Autónoma autorizada.
- Mismas alertas de login, agregadas por alumno/salón, en las tarjetas de "Salidas del Día por Grado/Sección" del dashboard — más la proporción de salidas (`N / total`) y cuántos van en bus por salón.
- Fix: familias mixtas (un padre nunca logueado, el otro logueado antes pero no hoy) no caían en ninguna categoría de alerta — corregido.
- Guía de padres (`parent-guide.html`) actualizada con el botón por hijo, "Hoy no va en bus" y la selección de puerta obligatoria.
- Sugerencia automática de un PIN de 4 dígitos libre al registrar un padre nuevo (antes había que adivinar uno que no chocara).
- Widget "Salidas Autónomas de Hoy" ahora muestra el roster completo de alumnos autorizados (quién ya salió y quién no), no solo los eventos del día.

---

## 2026-09-10 — `2de0c8a41f206a6101c2eaf21c1f4e87f9f20213`

**Fix "Marcar como leído" + "Hoy no va en bus" + idioma de avisos de voz + Android en producción**

Confirmado funcionando en producción. Incluye:

- Fix de seguridad: "Marcar como leído" en un mensaje libre (`[MENSAJE]`)
  ya no crea una autorización de reemplazo falsa con QR — solo marca
  leído y audita. Limpieza de 20 entradas falsas ya creadas en 15 padres.
- Feature "Hoy no va en bus": botón en `ParentDashboard` para excluir a
  un alumno del anuncio automático de su ruta ese día
  (`bus_daily_exclusions`), visible también en Ajustes de Rutas de Bus y
  registrado en el Inbox de Solicitudes del colegio.
- Fix de RLS: endpoint `GET /api/parents/bus-info` (service_role) para
  que un padre real pueda ver la ruta de bus de su hijo — la consulta
  directa fallaba en silencio por la política `parent_read_own_links`.
- Setting `school_settings.voice_announcement_language` (es/en/both) en
  Ajustes, aplicado a todos los avisos de voz (Dashboard, Monitor
  Externo, Tránsito, Verificación) vía `audioManager.announceBilingual`.
- Tres fixes encadenados en el aviso de voz de autorización de la app de
  padres: desbloqueo de `speechSynthesis` por gesto del usuario, conexión
  al setting de idioma, y fix de closure obsoleta (`voiceLangSettingRef`)
  que lo dejaba pegado siempre en español.
- Publicación exitosa de la app de Android al track de **producción** de
  Google Play (run de GitHub Actions `34542605595`) — primera vez que el
  plugin nativo de voz (`@capacitor-community/text-to-speech`, agregado
  el 3 de sept.) llega a usuarios reales. Requirió que el admin del
  cliente le diera permiso de "Lanzar a producción" a la cuenta de
  servicio de CI en Play Console → Usuarios y permisos.

---

## 2026-09-09 — `d65bf9623c49402363390c28fe66884155065617`

**Permitir elegir quién recibe la Alerta Discreta en Ajustes**

Confirmado funcionando en producción (TCS Albrook y TCS Costa del Este).
Incluye:

- Interruptor por bus (`reception_can_announce`) para bloquear el botón
  "Anunciar" solo en el dashboard de recepción, sin afectar el anuncio que
  hace el encargado del bus desde su propio celular.
- Usuario y contraseña para el encargado de cada bus (login como padre,
  correo sintético `usuario@buses.<colegio>.internal`).
- Interruptor en Ajustes para apagar el sistema de bloqueo de emergencia
  por colegio (`school_settings.emergency_lockdown_enabled`) — oculta el
  botón rojo/verde del sidebar para todo el personal cuando está apagado.
- Fix: la pantalla de Monitor Externo ya no queda pegada mostrando
  "RESTRICTED EXIT" si es la única pantalla conectada — ahora consulta
  `school_settings.lockdown_mode` directamente en vez de depender solo de
  que otra pestaña le responda.
- Selección de quién recibe la Alerta Discreta / Solicitud de Ayuda
  (`profiles.additional_tutor_name.receive_discrete_alert`, endpoint
  `PUT /api/staff/:id/discrete-alert`).

---

## 2026-09-10 — `1e7d8038799ed77e6ca4b5167109229aceca6978`

**Exigir selección consciente de puerta antes de anunciar la llegada**

Confirmado funcionando en producción. Incluye, además de lo del punto
anterior:

- Autorización automática de salidas después de cierto horario
  (`school_settings.auto_release_enabled` / `auto_release_after_time`,
  job `autoReleaseAfterHours` en el backend, corre cada 60s) — para el
  personal que queda al cierre y ya no usa la app.
- El Reporte del Día ahora incluye las salidas que quedaron sin autorizar
  y quién era el responsable de cada grado+sección ese día (Anexo 6).
- Enlaces de restablecer/pedir contraseña resaltados en azul índigo en el
  login (antes eran texto gris casi invisible).
- Con más de una puerta de salida, ninguna queda preseleccionada — el
  padre debe elegirla a conciencia y no puede anunciar la llegada (ni a
  mano ni por el rastreo automático en segundo plano) hasta hacerlo.
  Nuevo checkbox "Guardar como mi puerta habitual" para el que sí quiera
  que se le recuerde la próxima vez.
