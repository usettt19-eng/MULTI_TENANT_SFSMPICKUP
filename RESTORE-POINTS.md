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
