# Safe Smart Pickup — Diseño y estado del proyecto

Documento de trabajo. Recoge la arquitectura, los hallazgos de la auditoría y
lo que queda pendiente. Última actualización: 2026-08-08.

---

## 1. Qué es

SaaS **multi-tenant de recogida escolar**. Los clientes finales son colegios
(tenants); los usuarios son padres, personal del colegio y administración.

Un padre puede tener hijos en **más de un colegio cliente**, y debe poder
gestionarlos desde una sola cuenta. Este requisito condiciona todo el modelo de
datos y de permisos.

### Instancias en producción

| Colegio | `tenant_id` | Estado |
|---|---|---|
| The Casco School | `9543ac45-f058-4596-a7ee-e29191494190` | **Activo** — 3 perfiles, 21 recogidas, 212 registros de auditoría |
| Colegio Loyola | `3cc8eb07-a7f8-40bd-9886-23ae86bf505f` | Prácticamente vacío (pruebas) |
| Colegio Loyola 2 | `11d93213-5e22-430c-beb8-2f730cba3a97` | Vacío (pruebas) |

---

## 2. Stack

**Frontend:** Vite 6 · React 19 · TypeScript · Tailwind 4. Es una **SPA pura**:
no hay SSR ni `vercel.json`. El navegador habla **directamente con Supabase**
mediante `supabase-js` con la clave `anon`.

Consecuencia importante: **no hay servidor de aplicación en la ruta de datos.**
Dónde se alojen los archivos estáticos no afecta a la latencia de las consultas,
porque el navegador del padre se conecta a Supabase directamente.

**Backend:** `package.json` declara `"dev": "tsx server.ts"` y
`"server": "tsx watch server/index.ts"`, pero **ninguno de esos archivos existe
en el repositorio** y `.gitignore` no los excluye. Ver §6.

**Librerías relevantes:**

| Función | Librería | ¿Usa IA? |
|---|---|---|
| Generar QR | `qrcode.react` | No — algorítmico |
| Leer QR | `html5-qrcode` | No — algorítmico |
| Reconocimiento facial | `face-api.js` | ML local en el navegador, sin API |
| Anuncios por voz | `@google/genai` (`gemini-2.5-flash-preview-tts`) | Sí — TTS en la nube |

El Gemini del proyecto **solo hace texto a voz**, no identifica a nadie ni
conversa. La identificación de padres es `face-api.js` corriendo local.

---

## 3. Infraestructura

**Base de datos: Supabase Cloud.** Proyecto `SAFE SMART PICKUP MULTI TENANT`
(ref `fvzhfzogigewsvcyopel`), organización `srubend's Org`, **plan FREE**.

Se decidió mantenerla en la nube en lugar de auto-alojarla porque el producto se
factura al colegio: los backups y el PITR vienen incluidos, y construirlos sobre
un self-hosted era la única contrapartida seria.

> **Pendiente crítico:** el plan FREE **no incluye backups** y **pausa el
> proyecto tras una semana sin actividad**. Hay datos reales de un colegio.
> Activar **Pro antes del primer cliente que pague**.

**Servidor de aplicaciones: `187.33.153.78`.** 4 vCPU, ~4.9 GB de RAM libres,
RAM y disco ampliables. Disponible si se decide sacar el frontend de Vercel o
alojar el backend que falta.

Al no haber servidor en la ruta de datos, mover la SPA fuera de Vercel es una
decisión de coste, no de arquitectura. El servidor sí hace falta para el backend
(§6), que necesita proceso persistente.

**Correo: Amazon SES**, ya fuera de sandbox. Falta verificar el dominio del
proyecto como identidad y añadir sus 3 CNAME de Easy DKIM al DNS.

- No hay que tocar el SPF existente: SES firma con `d=<dominio>` y DMARC pasa por
  alineación de DKIM. Zoho (correo humano) y SES (transaccional) conviven, porque
  un dominio admite varios selectores DKIM.
- Al configurarlo en Supabase Auth: las credenciales SMTP de SES **no son** las
  access keys de AWS, y hay que **subir el límite en Authentication → Rate
  Limits**, que viene bajo por defecto y bloquea aunque SES esté perfecto.
- **Enganchar rebotes por SNS antes de la primera tanda de invitaciones.** Las
  direcciones las teclean los padres y vendrán con erratas. AWS suspende cuentas
  por encima del 5% de rebotes — y esa misma cuenta SES sirve al FusionPBX, así
  que una suspensión se llevaría también la telefonía. Usar un Configuration Set
  separado.

**Autenticación: nunca enviar contraseñas por correo.** Usar `inviteUserByEmail`
o **magic link** de Supabase Auth. Para padres de familia el magic link elimina
las contraseñas olvidadas, que serían la principal carga de soporte. Y la
credencial gobierna quién puede recoger a un menor: no debe viajar por email.

---

## 4. Modelo multi-tenant

### Principio

La comprobación es de **pertenencia**, no de igualdad:

```sql
tenant_id IN (SELECT public.user_tenant_ids())
```

El template original usaba una subconsulta escalar
(`tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())`), que
lanza `more than one row returned by a subquery` en cuanto un padre tiene hijos
en dos colegios — justo el caso de uso central del producto.

### Dos ejes de permisos

El aislamiento por colegio **no basta**. Un padre de The Casco School tampoco
debe ver la medicación de los demás alumnos de The Casco School. Por eso hay dos
capas:

| Rol | Alcance |
|---|---|
| **Padre** | Solo sus hijos (vía `parent_students`) y sus propias filas (`parent_id = auth.uid()`) |
| **Personal** | Todo su colegio |
| **super_admin** | Todos los colegios — administración y soporte |

### Funciones auxiliares

Todas `SECURITY DEFINER` (para leer `profiles` desde una política sobre
`profiles` sin recursión), `STABLE` (el planificador las evalúa una vez por
consulta, no por fila) y con `SET search_path` fijo (sin él son manipulables; es
el aviso del Security Advisor de Supabase).

| Función | Qué responde |
|---|---|
| `user_tenant_ids()` | Colegios a los que pertenece el usuario (0, 1 o N) |
| `is_super_admin()` | Global, sin filtro de tenant |
| `is_staff_of(tenant_id)` | Personal de **ese** colegio. Incluye `OR is_super_admin()` |
| `is_parent_of(student_id)` | Tutor de ese alumno, vía `parent_students` |

`is_staff_of()` reemplaza a `is_admin()`, que devolvía `true` si el usuario era
admin en **cualquier** colegio — el agujero por el que un director accedía a
otro centro.

### El super_admin

Ve y modifica todo, en todos los colegios, para administración y mantenimiento.
Puede además registrar auditoría en colegios de los que no es miembro (necesario
cuando entra a dar soporte).

Implicación de gobernanza, pendiente de resolver fuera del código: el proveedor
puede leer datos de salud y medicación de menores de todos sus colegios cliente.
Conviene que los super_admin sean mínimos y nominales, que el contrato con cada
colegio lo diga explícitamente, y que **el acceso cruzado quede registrado** —
hoy las lecturas de un super_admin en otro colegio no dejan rastro.

---

## 5. Auditoría de seguridad

### 5.1 Datos de menores expuestos a internet — CORREGIDO

El estado real de la base (volcado de `pg_policies`) era mucho peor que lo que
reflejaba la carpeta `sql/`. Unas **30 políticas** estaban definidas `TO public`,
que en Postgres **incluye al rol `anon`** — la clave que viaja en el bundle
JavaScript que descarga cualquiera.

Con `USING (true)`, quedaban **legibles por cualquier persona en internet**:

| Tabla | Contenido expuesto |
|---|---|
| `health_alerts` | Alertas de salud de menores |
| `medication_schedule` | Medicación — legible **y modificable** (`UPDATE public true`) |
| `student_incidents` | Incidentes de alumnos |
| `profiles` | Nombres, correos, PIN |
| `pickup_events` | **`ALL`** — crear, modificar y borrar eventos de recogida |
| `audit_logs`, `form_responses`, `forms`, `school_settings`, `wellness_logs` | Lectura, y escritura en varios |

`pickup_events` con `ALL USING(true)` era el más grave: la tabla que registra
quién recoge a qué niño aceptaba escrituras de cualquiera.

**Detalle que hacía inútil el arreglo ingenuo:** las políticas `PERMISSIVE` se
combinan con **OR**. Añadir una política estricta junto a una `USING (true)` no
cierra nada. La migración **elimina** las existentes antes de crear el juego
nuevo.

### 5.2 Clave de Gemini en el navegador — PENDIENTE

`src/lib/audioManager.ts:72` lee `import.meta.env.VITE_GEMINI_API_KEY`. Vite
expone **todas** las variables con prefijo `VITE_` en el bundle del cliente: esa
clave está en el JavaScript que descarga cada usuario.

Relacionado: `.env.example` define `VITE_SUPABASE_SERVICE_KEY`. La `service_role`
**bypasea toda RLS**; con ese prefijo, el proyecto está a una línea de exponer la
llave maestra. **Renombrarla sin `VITE_`.**

### 5.3 Modelos de reconocimiento facial desde un repo ajeno — PENDIENTE

```ts
// src/views/SmartCheckIn.tsx:90
const MODEL_URL = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights';
```

El control de acceso depende en tiempo de ejecución de un repositorio de GitHub
de terceros, **sin mantenimiento desde 2020**. Si se archiva o renombra, el
reconocimiento facial cae en todos los colegios a la vez. Además la tablet de la
puerta necesita salida a GitHub para arrancar, y se cargan pesos de modelo de un
tercero en el navegador que decide quién se lleva a un niño.

**Solución:** vendorizar los pesos en `public/models/` y servirlos desde el
propio origen.

### 5.4 Otros

- `@supabase/supabase-js` está en **`optionalDependencies`**. Es la dependencia
  central; un `npm install --no-optional` produce un build roto. Mover a
  `dependencies`.
- 30 scripts `check_*.ts` de depuración en la raíz, con `service_role`.
- **Reconocimiento facial de menores** (`face-api.js` + `camera_detections`) es
  dato biométrico, con requisitos de consentimiento y retención propios en la
  mayoría de jurisdicciones. Pendiente de revisión legal.

---

## 6. El backend que falta

`package.json` apunta a `server.ts` y `server/index.ts`; **ninguno existe en el
repositorio**, y `.gitignore` no los excluye. El build de Vercel es `vite build`,
que solo compila la SPA — la hipótesis es que **en producción no hay backend** y
las funciones que dependen de él están rotas.

Comprobación rápida en la app en vivo: ¿funciona crear un usuario en
StaffManagement? ¿carga la sección de medicamentos y alertas?

Lo que ese servicio tiene que hacer:

1. **Crear usuarios** con `service_role` — `StaffManagement.tsx:111`
2. **API de wellness** — medicamentos y alertas críticas (`VITE_WELLNESS_API_URL`, `:3001`)
3. **Webhook de cámaras** — ahora obligatorio: la migración cierra el `INSERT`
   anónimo en `camera_detections`, así que debe escribir con `service_role`
4. **Pregeneración de TTS con caché** — ver §7
5. **Proxy de las llamadas a IA**, para sacar las claves del navegador

> El webhook tiene un **contrato ya existente** con el sistema de cámaras. No se
> puede reimplementar a ciegas: hace falta saber qué envía y cómo se autentica.

---

## 7. Optimización del TTS

Los anuncios se generan hoy **desde cada navegador y sin caché**: la misma frase
se pide a la API desde cada dispositivo, y se vuelve a pedir al día siguiente.
Con 500 alumnos son miles de llamadas al mes para generar el mismo puñado de
frases.

El patrón correcto ya está funcionando en la infraestructura propia: la PBX
(FusionPBX) **no sintetiza voz** — `mod_say_es` concatena audio pregrabado. Por
eso va rápido y no cuesta nada.

**Diseño propuesto:** pregenerar el audio de cada alumno **una vez**, guardarlo
en Supabase Storage y servir el archivo. De miles de llamadas al mes se pasa a
~500 al año por colegio.

Consecuencia económica: **con caché, la calidad de la voz sale gratis.** La
pregunta deja de ser qué proveedor es más barato y pasa a ser cuál suena mejor.
Amazon Polly encaja bien porque la cuenta AWS ya está montada. Y el audio
pregenerado se reproduce al instante y **funciona sin conexión**, que en una
salida escolar vale más que la voz perfecta.

---

## 8. Estado del trabajo

### Hecho — rama `claude/tenant-isolation-rls`

- `sql/tenant_isolation_rls.sql` — migración completa de aislamiento
- `sql/tests/fixture_schema.sql` — réplica del esquema y las políticas reales
- `sql/tests/test_tenant_isolation.sql` — 15 asserts
- `sql/tests/test_super_admin.sql` — 6 asserts
- `sql/tests/test_multi_school_parent.sql` — padre con hijos en dos colegios

**21 asserts en verde** contra un Postgres real con las políticas de producción
replicadas.

### Para aplicar, en este orden

1. **Rellenar las 51 filas huérfanas** (11 `pickup_events`, 39 `audit_logs`,
   1 `profile` con `tenant_id` NULL). Con RLS activo esas filas **desaparecen**
   de la aplicación. Son de The Casco School, el único colegio con actividad.
2. **Aplicar `sql/tenant_isolation_rls.sql`.** El Paso 0 solo informa.
3. **Verificar** que los cuatro bloques del Paso 9 devuelven 0 filas.
4. **Probar la app** como padre y como director.
5. **Reconfigurar el webhook de cámaras** con `service_role`.

### Opcional pero necesario para el multi-colegio

Hoy `profiles` tiene `PRIMARY KEY (id)`, así que **un padre no puede tener una
fila por colegio**: la funcionalidad que contempla `AuthContext` no existe en la
base. El Paso 10 de la migración la habilita:

```sql
ALTER TABLE public.profiles DROP CONSTRAINT profiles_pkey;
ALTER TABLE public.profiles ADD PRIMARY KEY (id, tenant_id);
ALTER TABLE public.profiles ADD CONSTRAINT profiles_email_tenant_key UNIQUE (email, tenant_id);
```

Requiere haber rellenado antes el perfil con `tenant_id` NULL: las columnas de
una PK son implícitamente `NOT NULL`.

### Pendiente

| Tarea | Bloqueado por |
|---|---|
| Sacar la clave de Gemini del navegador | El backend |
| Pregeneración de TTS con caché | El backend |
| Webhook de cámaras con `service_role` | El backend |
| Vendorizar los modelos de `face-api.js` | Nada — se puede hacer ya |
| `@supabase/supabase-js` a `dependencies` | Nada — se puede hacer ya |
| Registrar el acceso cruzado del super_admin | Nada |
| Activar plan Pro en Supabase | Decisión comercial |
| Verificar el dominio en SES + rebotes por SNS | Nada |

---

## Notas de operación

- **El tenant activo se guarda en `localStorage`** (`AuthContext`). Eso está bien
  como preferencia de interfaz, pero **no puede decidir a qué datos se accede**:
  el usuario lo edita desde la consola. Por eso la autorización es por
  pertenencia en `profiles`, no por lo que diga el cliente.
- **`parent_students` no tiene `tenant_id`**: solo `parent_id` y `student_id`.
  El colegio se deduce del alumno.
- **El personal no es un rol del enum.** `user_role` tiene `parent`, `admin` y
  `super_admin`; el resto del personal se marca con un flag `is_staff` dentro del
  JSON de la columna `additional_tutor_name`. `is_staff_of()` replica esa lógica
  para no romper a esos usuarios, pero es deuda técnica que conviene limpiar.
