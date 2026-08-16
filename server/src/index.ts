import express from 'express';
import {admin} from './supabase.js';
import {fail, isAdminOf, isStaffOf, ok, requireAuth, requireSuperAdmin} from './auth.js';

const app = express();
app.use(express.json({limit: '10mb'})); // las fotos llegan en base64

const PORT = Number(process.env.PORT ?? 3001);

/** Envuelve un handler async para que los errores no tumben el proceso. */
const wrap =
  (fn: (req: express.Request, res: express.Response) => Promise<unknown>) =>
  (req: express.Request, res: express.Response) => {
    fn(req, res).catch((err) => {
      console.error(`[${req.method} ${req.path}]`, err);
      if (!res.headersSent) fail(res, 500, err?.message ?? 'Error interno');
    });
  };

app.get('/api/health', (_req, res) => res.json({success: true, data: {status: 'ok'}}));

// ════════════════════════════════════════════════════════════════════════════
// COLEGIOS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Alta de colegio + su administrador.
 *
 * Sin autoregistro público: solo el super_admin da de alta colegios, desde
 * SuperAdminDashboard. requireAuth + requireSuperAdmin exigen una sesión
 * válida de super_admin — igual que el resto de endpoints sensibles.
 */
app.post(
  '/api/tenants/register',
  requireAuth,
  requireSuperAdmin,
  wrap(async (req, res) => {
    const {schoolName, domain, firstName, lastName, email} = req.body ?? {};

    if (!schoolName || !email) {
      return fail(res, 400, 'Faltan nombre del colegio o correo.');
    }

    const {data: tenant, error: tenantError} = await admin
      .from('tenants')
      .insert({name: schoolName, domain: domain || null, status: 'active'})
      .select()
      .single();

    if (tenantError) {
      if (tenantError.code === '23505') return fail(res, 409, 'Ese código de colegio ya existe.');
      return fail(res, 500, tenantError.message);
    }

    // Nunca se genera ni envía contraseña: el admin del colegio entra por el
    // enlace de invitación que Supabase Auth manda a su correo.
    const {data: created, error: userError} = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: process.env.PUBLIC_APP_URL || undefined,
      data: {
        first_name: firstName ?? '',
        last_name: lastName ?? '',
        role: 'admin',
        tenant_id: tenant.id,
        needs_password_setup: true,
      },
    });

    if (userError || !created?.user) {
      // No dejamos el colegio huérfano si falla la creación del admin.
      await admin.from('tenants').delete().eq('id', tenant.id);
      return fail(res, 400, userError?.message ?? 'No se pudo crear el administrador.');
    }

    // El trigger handle_new_user() ya creó el perfil con el tenant; completamos.
    await admin
      .from('profiles')
      .update({email, role: 'admin', tenant_id: tenant.id})
      .eq('id', created.user.id);

    return ok(res, {tenant, adminId: created.user.id});
  }),
);

/**
 * Estadísticas por colegio para el panel de super_admin.
 *
 * SuperAdminDashboard.tsx las indexa como `stats[tenant.id].students`,
 * `.parents`, `.staff`, `.doors`, `.latitude/.longitude` — no es un conteo
 * global, es un objeto por tenant. `staff` replica el criterio de
 * StaffManagement.tsx: role='admin' Y el flag is_staff dentro del JSON de
 * additional_tutor_name (así no cuenta doble a los admins fundadores).
 */
app.get(
  '/api/tenants/stats',
  requireAuth,
  requireSuperAdmin,
  wrap(async (_req, res) => {
    const [tenants, students, profiles, doors, settings] = await Promise.all([
      admin.from('tenants').select('id'),
      admin.from('students').select('tenant_id'),
      admin.from('profiles').select('tenant_id, role, additional_tutor_name'),
      admin.from('exit_doors').select('tenant_id'),
      admin.from('school_settings').select('tenant_id, latitude, longitude'),
    ]);

    for (const [name, r] of Object.entries({tenants, students, profiles, doors, settings})) {
      if (r.error) return fail(res, 500, `${name}: ${r.error.message}`);
    }

    const isStaff = (p: {role: string; additional_tutor_name: string | null}) => {
      if (p.role !== 'admin') return false;
      try {
        return JSON.parse(p.additional_tutor_name || '{}')?.is_staff === true;
      } catch {
        return false;
      }
    };

    const stats: Record<
      string,
      {students: number; parents: number; staff: number; doors: number; latitude: number | null; longitude: number | null}
    > = {};

    for (const t of tenants.data ?? []) {
      stats[t.id] = {students: 0, parents: 0, staff: 0, doors: 0, latitude: null, longitude: null};
    }
    for (const s of students.data ?? []) {
      if (s.tenant_id && stats[s.tenant_id]) stats[s.tenant_id].students++;
    }
    for (const p of profiles.data ?? []) {
      if (!p.tenant_id || !stats[p.tenant_id]) continue;
      if (p.role === 'parent') stats[p.tenant_id].parents++;
      else if (isStaff(p)) stats[p.tenant_id].staff++;
    }
    for (const d of doors.data ?? []) {
      if (d.tenant_id && stats[d.tenant_id]) stats[d.tenant_id].doors++;
    }
    for (const s of settings.data ?? []) {
      if (s.tenant_id && stats[s.tenant_id]) {
        stats[s.tenant_id].latitude = s.latitude;
        stats[s.tenant_id].longitude = s.longitude;
      }
    }

    return ok(res, stats);
  }),
);

app.post(
  '/api/tenants/reset-admin-password',
  requireAuth,
  requireSuperAdmin,
  wrap(async (req, res) => {
    const {tenantId, newPassword} = req.body ?? {};
    if (!tenantId || !newPassword) return fail(res, 400, 'Faltan tenantId o newPassword.');
    if (String(newPassword).length < 8) {
      return fail(res, 400, 'La contraseña debe tener al menos 8 caracteres.');
    }

    const {data: adminProfile, error} = await admin
      .from('profiles')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('role', 'admin')
      .order('created_at', {ascending: true})
      .limit(1)
      .maybeSingle();

    if (error) return fail(res, 500, error.message);
    if (!adminProfile) return fail(res, 404, 'Ese colegio no tiene administrador.');

    const {error: updateError} = await admin.auth.admin.updateUserById(adminProfile.id, {
      password: newPassword,
    });
    if (updateError) return fail(res, 400, updateError.message);

    return ok(res, {id: adminProfile.id});
  }),
);

// ════════════════════════════════════════════════════════════════════════════
// PADRES
// ════════════════════════════════════════════════════════════════════════════

const PARENT_FIELDS = [
  'first_name',
  'last_name',
  'phone',
  'email',
  'pin_code',
  'photo_url',
  'additional_tutor_name',
  'additional_tutor_phone',
] as const;

const pick = (body: Record<string, unknown>) =>
  Object.fromEntries(
    PARENT_FIELDS.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]),
  );

app.post(
  '/api/parents',
  requireAuth,
  wrap(async (req, res) => {
    const body = req.body ?? {};
    // El colegio lo decide el llamante, NO el cuerpo de la petición: si no,
    // un admin podría crear padres en otro colegio enviando otro tenant_id.
    const tenantId = req.caller!.role === 'super_admin' ? body.tenant_id : req.caller!.tenantId;

    if (!isStaffOf(req.caller, tenantId)) return fail(res, 403, 'No tienes permisos en ese colegio.');
    if (!body.email) return fail(res, 400, 'Falta el correo.');

    const {data: created, error} = await admin.auth.admin.inviteUserByEmail(body.email, {
      redirectTo: process.env.PUBLIC_APP_URL || undefined,
      data: {
        first_name: body.first_name ?? '',
        last_name: body.last_name ?? '',
        role: 'parent',
        tenant_id: tenantId,
        needs_password_setup: true,
      },
    });
    if (error || !created?.user) return fail(res, 400, error?.message ?? 'No se pudo crear el padre.');

    const {data: profile, error: profileError} = await admin
      .from('profiles')
      .update({...pick(body), role: 'parent', tenant_id: tenantId})
      .eq('id', created.user.id)
      .select()
      .single();

    if (profileError) return fail(res, 500, profileError.message);
    return ok(res, profile);
  }),
);

app.put(
  '/api/parents/:id',
  requireAuth,
  wrap(async (req, res) => {
    const {id} = req.params;
    const body = req.body ?? {};

    const {data: target, error: findError} = await admin
      .from('profiles')
      .select('id, tenant_id')
      .eq('id', id)
      .maybeSingle();

    if (findError) return fail(res, 500, findError.message);
    if (!target) return fail(res, 404, 'Padre no encontrado.');
    // Se comprueba contra el colegio REAL del padre, no contra el que envían.
    if (!isStaffOf(req.caller, target.tenant_id)) return fail(res, 403, 'Sin permisos sobre ese padre.');

    if (body.password) {
      const {error} = await admin.auth.admin.updateUserById(id, {password: body.password});
      if (error) return fail(res, 400, error.message);
    }
    if (body.email) {
      const {error} = await admin.auth.admin.updateUserById(id, {email: body.email});
      if (error) return fail(res, 400, error.message);
    }

    const {data: profile, error} = await admin
      .from('profiles')
      .update(pick(body))
      .eq('id', id)
      .select()
      .single();

    if (error) return fail(res, 500, error.message);
    return ok(res, profile);
  }),
);

app.delete(
  '/api/parents/:id',
  requireAuth,
  wrap(async (req, res) => {
    const {id} = req.params;

    const {data: target} = await admin
      .from('profiles')
      .select('id, tenant_id')
      .eq('id', id)
      .maybeSingle();

    if (!target) return fail(res, 404, 'Padre no encontrado.');
    if (!isStaffOf(req.caller, target.tenant_id)) return fail(res, 403, 'Sin permisos sobre ese padre.');

    await admin.from('parent_students').delete().eq('parent_id', id);
    await admin.from('vehicles').delete().eq('parent_id', id);

    const {error} = await admin.auth.admin.deleteUser(id);
    if (error) return fail(res, 400, error.message);

    await admin.from('profiles').delete().eq('id', id);
    return ok(res, {id});
  }),
);

app.post(
  '/api/parents/bulk',
  requireAuth,
  wrap(async (req, res) => {
    const parents = Array.isArray(req.body?.parents) ? req.body.parents : [];
    if (parents.length === 0) return fail(res, 400, 'No se recibió ningún padre.');
    if (parents.length > 500) return fail(res, 400, 'Máximo 500 padres por importación.');

    const tenantId = req.caller!.tenantId;
    if (!isStaffOf(req.caller, tenantId)) return fail(res, 403, 'Sin permisos en ese colegio.');

    const created: unknown[] = [];
    const failed: {email: string; error: string}[] = [];
    const linkWarnings: {email: string; student_name: string; reason: string}[] = [];

    // Para vincular por nombre: un solo fetch de todo el colegio, no uno por
    // fila. Se indexa por "nombre apellido" en minúsculas; si el nombre no
    // es único dentro del colegio, se guardan todas las coincidencias para
    // poder avisar de la ambigüedad en vez de vincular al azar.
    const {data: tenantStudents, error: studentsError} = await admin
      .from('students')
      .select('id, first_name, last_name')
      .eq('tenant_id', tenantId);
    if (studentsError) return fail(res, 500, studentsError.message);

    const studentsByName = new Map<string, string[]>();
    for (const s of tenantStudents ?? []) {
      const key = `${s.first_name ?? ''} ${s.last_name ?? ''}`.trim().toLowerCase();
      if (!key) continue;
      studentsByName.set(key, [...(studentsByName.get(key) ?? []), s.id]);
    }

    // Secuencial a propósito: en paralelo se dispara el rate limit de Auth.
    for (const p of parents) {
      if (!p?.email) {
        failed.push({email: '(sin correo)', error: 'Falta el correo'});
        continue;
      }
      // Sin contraseña: cada padre recibe su propio correo de invitación.
      const {data: user, error} = await admin.auth.admin.inviteUserByEmail(p.email, {
        redirectTo: process.env.PUBLIC_APP_URL || undefined,
        data: {
          first_name: p.first_name ?? '',
          last_name: p.last_name ?? '',
          role: 'parent',
          tenant_id: tenantId,
          needs_password_setup: true,
        },
      });

      if (error || !user?.user) {
        failed.push({email: p.email, error: error?.message ?? 'desconocido'});
        continue;
      }

      await admin
        .from('profiles')
        .update({...pick(p), role: 'parent', tenant_id: tenantId})
        .eq('id', user.user.id);

      // Vehículo opcional, mismo patrón que el alta manual en
      // GuardiansRegistry.tsx: una fila en `vehicles` por padre, solo si
      // trae placa o descripción.
      if (p.vehicle_plate || p.vehicle_description) {
        await admin.from('vehicles').insert({
          parent_id: user.user.id,
          tenant_id: tenantId,
          license_plate: p.vehicle_plate ?? '',
          description: p.vehicle_description ?? '',
        });
      }

      // Vínculo con hijos por nombre, opcional: no falla el alta del padre
      // si un nombre no coincide o es ambiguo, solo queda registrado como
      // aviso para que el staff lo resuelva a mano.
      const studentNames: string[] = Array.isArray(p.student_names) ? p.student_names : [];
      const studentIdsToLink: string[] = [];
      for (const name of studentNames) {
        const matches = studentsByName.get(String(name).trim().toLowerCase()) ?? [];
        if (matches.length === 1) {
          studentIdsToLink.push(matches[0]);
        } else if (matches.length === 0) {
          linkWarnings.push({email: p.email, student_name: name, reason: 'No se encontró ningún alumno con ese nombre'});
        } else {
          linkWarnings.push({email: p.email, student_name: name, reason: `Hay ${matches.length} alumnos con ese nombre, vincúlalo manualmente`});
        }
      }
      if (studentIdsToLink.length > 0) {
        await admin
          .from('parent_students')
          .insert(studentIdsToLink.map((student_id) => ({parent_id: user.user.id, student_id})));
      }

      created.push({id: user.user.id, email: p.email});
    }

    return res.json({success: true, data: {created: created.length, failed, linkWarnings}, error: null});
  }),
);

// ════════════════════════════════════════════════════════════════════════════
// PERSONAL
// ════════════════════════════════════════════════════════════════════════════

app.post(
  '/api/staff',
  requireAuth,
  wrap(async (req, res) => {
    const body = req.body ?? {};
    const tenantId = req.caller!.role === 'super_admin' ? body.tenant_id : req.caller!.tenantId;

    // Crear personal es más sensible que crear padres: exige ser admin.
    if (!isAdminOf(req.caller, tenantId)) return fail(res, 403, 'Requiere ser administrador del colegio.');
    if (!body.email) return fail(res, 400, 'Falta el correo.');

    const {data: created, error} = await admin.auth.admin.inviteUserByEmail(body.email, {
      redirectTo: process.env.PUBLIC_APP_URL || undefined,
      data: {
        first_name: body.first_name ?? '',
        last_name: body.last_name ?? '',
        role: 'admin',
        tenant_id: tenantId,
        needs_password_setup: true,
      },
    });
    if (error || !created?.user) return fail(res, 400, error?.message ?? 'No se pudo crear el usuario.');

    const {data: profile, error: profileError} = await admin
      .from('profiles')
      .update({
        first_name: body.first_name ?? '',
        last_name: body.last_name ?? '',
        email: body.email,
        role: 'admin',
        tenant_id: tenantId,
        additional_tutor_name: JSON.stringify({
          is_staff: true,
          permissions: body.permissions ?? [],
        }),
      })
      .eq('id', created.user.id)
      .select()
      .single();

    if (profileError) return fail(res, 500, profileError.message);
    return ok(res, profile);
  }),
);

app.put(
  '/api/staff/:id',
  requireAuth,
  wrap(async (req, res) => {
    const {id} = req.params;

    const {data: target} = await admin
      .from('profiles')
      .select('id, tenant_id, additional_tutor_name')
      .eq('id', id)
      .maybeSingle();

    if (!target) return fail(res, 404, 'Usuario no encontrado.');
    if (!isAdminOf(req.caller, target.tenant_id)) return fail(res, 403, 'Sin permisos sobre ese usuario.');

    let current: Record<string, unknown> = {};
    try {
      current = JSON.parse(target.additional_tutor_name || '{}');
    } catch {
      current = {};
    }

    const {data: profile, error} = await admin
      .from('profiles')
      .update({
        additional_tutor_name: JSON.stringify({
          ...current,
          is_staff: true,
          permissions: req.body?.permissions ?? [],
        }),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) return fail(res, 500, error.message);
    return ok(res, profile);
  }),
);

app.delete(
  '/api/staff/:id',
  requireAuth,
  wrap(async (req, res) => {
    const {id} = req.params;
    if (id === req.caller!.id) return fail(res, 400, 'No puedes eliminar tu propio usuario.');

    const {data: target} = await admin
      .from('profiles')
      .select('id, tenant_id')
      .eq('id', id)
      .maybeSingle();

    if (!target) return fail(res, 404, 'Usuario no encontrado.');
    if (!isAdminOf(req.caller, target.tenant_id)) return fail(res, 403, 'Sin permisos sobre ese usuario.');

    const {error} = await admin.auth.admin.deleteUser(id);
    if (error) return fail(res, 400, error.message);

    await admin.from('profiles').delete().eq('id', id);
    return ok(res, {id});
  }),
);

// ════════════════════════════════════════════════════════════════════════════
// BIENESTAR
// ════════════════════════════════════════════════════════════════════════════

app.post(
  '/api/wellness/incident',
  requireAuth,
  wrap(async (req, res) => {
    const {student_id, type, description} = req.body ?? {};
    if (!student_id) return fail(res, 400, 'Falta el alumno.');

    // El colegio se toma del alumno, no del cuerpo de la petición.
    const {data: student} = await admin
      .from('students')
      .select('id, tenant_id')
      .eq('id', student_id)
      .maybeSingle();

    if (!student) return fail(res, 404, 'Alumno no encontrado.');
    if (!isStaffOf(req.caller, student.tenant_id)) return fail(res, 403, 'Sin permisos sobre ese alumno.');

    const {data, error} = await admin
      .from('student_incidents')
      .insert({
        student_id,
        type: type ?? 'general',
        description: description ?? '',
        reported_by: req.caller!.id,
        tenant_id: student.tenant_id,
      })
      .select()
      .single();

    if (error) return fail(res, 500, error.message);
    return ok(res, data);
  }),
);

app.put(
  '/api/wellness/incident/:id',
  requireAuth,
  wrap(async (req, res) => {
    const {id} = req.params;
    const evolution = String(req.body?.evolution ?? '').trim();
    if (!evolution) return fail(res, 400, 'La evolución está vacía.');

    const {data: incident} = await admin
      .from('student_incidents')
      .select('id, tenant_id, description')
      .eq('id', id)
      .maybeSingle();

    if (!incident) return fail(res, 404, 'Incidencia no encontrada.');
    if (!isStaffOf(req.caller, incident.tenant_id)) return fail(res, 403, 'Sin permisos sobre esa incidencia.');

    // student_incidents no tiene columna `evolution`: se añade al historial
    // dentro de `description`, que es lo que la ficha ya muestra.
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const description = `${incident.description ?? ''}\n\n[Evolución ${stamp}] ${evolution}`.trim();

    const {data, error} = await admin
      .from('student_incidents')
      .update({description})
      .eq('id', id)
      .select()
      .single();

    if (error) return fail(res, 500, error.message);
    return ok(res, data);
  }),
);

// ════════════════════════════════════════════════════════════════════════════
// SOLICITUDES DE REEMPLAZO
// ════════════════════════════════════════════════════════════════════════════

app.post(
  '/api/requests/replacement',
  requireAuth,
  wrap(async (req, res) => {
    const {replacement_name, replacement_phone} = req.body ?? {};
    if (!replacement_name) return fail(res, 400, 'Falta el nombre del reemplazo.');

    // El padre sólo puede solicitar por sí mismo; el personal, por cualquiera
    // de su colegio.
    const requestedFor = req.body?.parent_id ?? req.caller!.id;
    if (requestedFor !== req.caller!.id) {
      const {data: target} = await admin
        .from('profiles')
        .select('tenant_id')
        .eq('id', requestedFor)
        .maybeSingle();
      if (!target) return fail(res, 404, 'Padre no encontrado.');
      if (!isStaffOf(req.caller, target.tenant_id)) {
        return fail(res, 403, 'Sólo puedes crear solicitudes a tu nombre.');
      }
    }

    const {data, error} = await admin
      .from('replacement_requests')
      .insert({
        parent_id: requestedFor,
        replacement_name,
        replacement_phone: replacement_phone ?? null,
        status: 'pending',
        tenant_id: req.caller!.tenantId,
      })
      .select()
      .single();

    if (error) return fail(res, 500, error.message);
    return ok(res, data);
  }),
);

// ════════════════════════════════════════════════════════════════════════════
// POOL DAY (CARPOOL)
// ════════════════════════════════════════════════════════════════════════════
//
// Un padre autoriza a OTRO padre ya registrado a recoger a su hijo/a ciertos
// días (semanal recurrente, tabla carpool_authorizations) o un solo día
// puntual (excepción, carpool_overrides) — mismo patrón de
// dismissal_assignments/dismissal_overrides. No requiere aprobación de
// recepción/admin: se activa al instante y solo se notifica al encargado de
// la salida (a la hora de la recogida) y al/los administrador(es) del
// colegio (al configurarse y de nuevo al momento de la recogida).
//
// Las lecturas con nombres de otros padres/alumnos y las escrituras pasan por
// aquí (service_role) porque las políticas de `profiles`/`students` solo
// dejan ver el propio perfil o los hijos propios — un padre "conductor" no
// está vinculado al alumno que va a recoger, así que RLS por sí sola no
// alcanza para mostrarle esos datos.

const CARPOOL_STUDENT_FIELDS = 'id, first_name, last_name, grade, section, photo_url';
const CARPOOL_PARENT_FIELDS = 'id, first_name, last_name, photo_url';
const todayStr = () => new Date().toISOString().slice(0, 10);

app.get(
  '/api/parents/search',
  requireAuth,
  wrap(async (req, res) => {
    const tenantId = req.caller!.tenantId;
    if (!tenantId) return ok(res, []);

    const raw = String(req.query.q ?? '').trim().slice(0, 60);
    if (raw.length < 2) return ok(res, []);

    // "Juan Perez" no aparece completo en NINGUNA columna por separado
    // (first_name="Juan", last_name="Pérez"), y además ILIKE de Postgres no
    // ignora tildes ("pérez" no contiene "perez" como texto literal). Como
    // el universo de padres de un colegio es chico, es más simple y
    // confiable traer a todos los del tenant y filtrar en JS, sin tilde y
    // sin importar en qué columna caiga cada palabra escrita.
    const stripAccents = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const words = stripAccents(raw.toLowerCase()).split(/\s+/).filter(Boolean).slice(0, 4);
    if (words.length === 0) return ok(res, []);

    const {data, error} = await admin
      .from('profiles')
      .select('id, first_name, last_name, email, photo_url')
      .eq('tenant_id', tenantId)
      .in('role', ['parent', 'guardian'])
      .neq('id', req.caller!.id)
      .limit(500);

    if (error) return fail(res, 500, error.message);

    const matches = (data ?? []).filter((p) => {
      const haystack = stripAccents(`${p.first_name ?? ''} ${p.last_name ?? ''} ${p.email ?? ''}`.toLowerCase());
      return words.every((w) => haystack.includes(w));
    });

    return ok(res, matches.slice(0, 10));
  }),
);

/**
 * Padres/tutores de los compañeros de salón (mismo grado+sección) del
 * alumno dado, para elegir "quién conduce" con un toque en vez de tener que
 * buscar a ciegas en todo el colegio — el pool day casi siempre es entre
 * familias del mismo salón.
 */
app.get(
  '/api/carpool/classmates-parents',
  requireAuth,
  wrap(async (req, res) => {
    const tenantId = req.caller!.tenantId;
    const studentId = String(req.query.student_id ?? '');
    if (!tenantId || !studentId) return ok(res, []);

    // Solo para quien de verdad sea padre/tutor de ese alumno. parent_students
    // no tiene columna `id` (llave compuesta parent_id+student_id), así que
    // se separa en dos consultas simples en vez de anidar el filtro de
    // tenant sobre el join, que es más frágil.
    const {data: link} = await admin
      .from('parent_students')
      .select('student_id')
      .eq('parent_id', req.caller!.id)
      .eq('student_id', studentId)
      .maybeSingle();
    if (!link) return ok(res, []);

    const {data: student} = await admin
      .from('students')
      .select('id, grade, section')
      .eq('id', studentId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (!student || !student.grade) return ok(res, []);

    // La data real trae inconsistencias de mayúsculas en grado/sección
    // (p.ej. sección "C" vs "c"), así que se compara sin distinguir
    // mayúsculas — si no, dos alumnos del mismo salón quedan fuera por una
    // diferencia puramente de formato. Ojo: NO se recorta el texto, porque
    // algunos grados quedaron guardados con un espacio al final ("1er ") y
    // recortarlo rompería la coincidencia contra esos mismos datos.
    const {data: classmates, error: classmatesError} = await admin
      .from('students')
      .select('id')
      .eq('tenant_id', tenantId)
      .ilike('grade', student.grade)
      .ilike('section', student.section ?? '');
    if (classmatesError) return fail(res, 500, classmatesError.message);

    const classmateIds = (classmates ?? []).map((s) => s.id).filter((id) => id !== studentId);
    if (classmateIds.length === 0) return ok(res, []);

    const {data: links, error: linksError} = await admin
      .from('parent_students')
      .select('parent:profiles!parent_students_parent_id_fkey(id, first_name, last_name, email, photo_url)')
      .in('student_id', classmateIds);
    if (linksError) return fail(res, 500, linksError.message);

    const seen = new Map<string, any>();
    for (const row of links ?? []) {
      const p = (row as any).parent;
      if (p && p.id !== req.caller!.id && !seen.has(p.id)) seen.set(p.id, p);
    }

    return ok(res, [...seen.values()]);
  }),
);

/** Todo lo que el padre que llama configuró y todo aquello para lo que a él lo autorizaron a conducir. */
app.get(
  '/api/carpool/mine',
  requireAuth,
  wrap(async (req, res) => {
    const callerId = req.caller!.id;
    const tenantId = req.caller!.tenantId;
    if (!tenantId) return ok(res, {authorizations: [], overrides: [], drivingFor: [], drivingForOverrides: [], todaysCarpoolStudents: []});

    const today = todayStr();
    const todayDow = new Date().getDay();

    const [authRes, overrideRes, drivingForRes, drivingForOverrideRes]: any[] = await Promise.all([
      (admin
        .from('carpool_authorizations')
        .select(`id, day_of_week, student:students(${CARPOOL_STUDENT_FIELDS}), driver:profiles!carpool_authorizations_driver_parent_id_fkey(${CARPOOL_PARENT_FIELDS})`) as any)
        .eq('tenant_id', tenantId)
        .eq('authorizing_parent_id', callerId)
        .order('day_of_week'),
      (admin
        .from('carpool_overrides')
        .select(`id, override_date, student:students(${CARPOOL_STUDENT_FIELDS}), driver:profiles!carpool_overrides_driver_parent_id_fkey(${CARPOOL_PARENT_FIELDS})`) as any)
        .eq('tenant_id', tenantId)
        .eq('authorizing_parent_id', callerId)
        .gte('override_date', today)
        .order('override_date'),
      (admin
        .from('carpool_authorizations')
        .select(`id, day_of_week, student:students(${CARPOOL_STUDENT_FIELDS}), authorizing:profiles!carpool_authorizations_authorizing_parent_id_fkey(${CARPOOL_PARENT_FIELDS})`) as any)
        .eq('tenant_id', tenantId)
        .eq('driver_parent_id', callerId)
        .order('day_of_week'),
      (admin
        .from('carpool_overrides')
        .select(`id, override_date, student:students(${CARPOOL_STUDENT_FIELDS}), authorizing:profiles!carpool_overrides_authorizing_parent_id_fkey(${CARPOOL_PARENT_FIELDS})`) as any)
        .eq('tenant_id', tenantId)
        .eq('driver_parent_id', callerId)
        .gte('override_date', today)
        .order('override_date'),
    ]);

    if (authRes.error) return fail(res, 500, authRes.error.message);
    if (overrideRes.error) return fail(res, 500, overrideRes.error.message);
    if (drivingForRes.error) return fail(res, 500, drivingForRes.error.message);
    if (drivingForOverrideRes.error) return fail(res, 500, drivingForOverrideRes.error.message);

    // Alumnos que hoy le toca recoger a este padre por pool day: la
    // excepción del día exacto manda sobre el recurrente semanal (mismo
    // criterio que resolveResponsibleStaff), por si alguien cambió el
    // conductor de hoy sin tocar su horario habitual.
    const todaysOverrideStudentIds = new Set(
      (drivingForOverrideRes.data ?? []).filter((o: any) => o.override_date === today).map((o: any) => o.student?.id),
    );
    const todaysFromOverrides = (drivingForOverrideRes.data ?? [])
      .filter((o: any) => o.override_date === today && o.student)
      .map((o: any) => ({...o.student, _carpoolAuthorizingParent: o.authorizing}));
    const todaysFromWeekly = (drivingForRes.data ?? [])
      .filter((a: any) => a.day_of_week === todayDow && a.student && !todaysOverrideStudentIds.has(a.student.id))
      .map((a: any) => ({...a.student, _carpoolAuthorizingParent: a.authorizing}));

    return ok(res, {
      authorizations: authRes.data ?? [],
      overrides: overrideRes.data ?? [],
      drivingFor: drivingForRes.data ?? [],
      drivingForOverrides: drivingForOverrideRes.data ?? [],
      todaysCarpoolStudents: [...todaysFromOverrides, ...todaysFromWeekly],
    });
  }),
);

/** Valida que `callerId` sea padre/tutor de `studentId` y que `driverParentId` sea otro padre registrado del mismo colegio. */
async function validateCarpoolActors(
  tenantId: string,
  callerId: string,
  studentId: string,
  driverParentId: string,
): Promise<string | null> {
  if (driverParentId === callerId) return 'El conductor debe ser otro padre distinto de ti.';

  // parent_students no tiene columna `id` (su llave es compuesta
  // parent_id+student_id) — se separa en dos consultas simples en vez de
  // anidar el filtro de tenant sobre el join, que es más frágil.
  const {data: link} = await admin
    .from('parent_students')
    .select('student_id')
    .eq('parent_id', callerId)
    .eq('student_id', studentId)
    .maybeSingle();
  if (!link) return 'No eres padre/tutor registrado de ese alumno.';

  const {data: linkedStudent} = await admin
    .from('students')
    .select('id')
    .eq('id', studentId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (!linkedStudent) return 'No eres padre/tutor registrado de ese alumno.';

  const {data: driver} = await admin
    .from('profiles')
    .select('id')
    .eq('id', driverParentId)
    .eq('tenant_id', tenantId)
    .in('role', ['parent', 'guardian'])
    .maybeSingle();
  if (!driver) return 'El conductor debe ser un padre/tutor registrado de este colegio.';

  return null;
}

/** Notifica a los administradores del colegio (no bloquea la respuesta si falla). */
async function notifyTenantAdmins(tenantId: string, title: string, message: string) {
  try {
    const {data: admins} = await admin.from('profiles').select('id').eq('tenant_id', tenantId).eq('role', 'admin');
    if (!admins || admins.length === 0) return;
    await admin.from('notifications').insert(
      admins.map((a) => ({user_id: a.id, title, message, type: 'info', tenant_id: tenantId})),
    );
  } catch (err) {
    console.error('Error al notificar a administradores:', err);
  }
}

app.post(
  '/api/carpool/authorizations',
  requireAuth,
  wrap(async (req, res) => {
    const tenantId = req.caller!.tenantId;
    if (!tenantId) return fail(res, 403, 'Sin colegio asociado.');

    const {student_id, driver_parent_id, days_of_week} = req.body ?? {};
    if (!student_id || !driver_parent_id) return fail(res, 400, 'Falta el alumno o el conductor.');
    const days: number[] = Array.isArray(days_of_week)
      ? [...new Set(days_of_week.map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      : [];
    if (days.length === 0) return fail(res, 400, 'Selecciona al menos un día de la semana.');

    const validationError = await validateCarpoolActors(tenantId, req.caller!.id, student_id, driver_parent_id);
    if (validationError) return fail(res, 403, validationError);

    const rows = days.map((day_of_week) => ({
      tenant_id: tenantId,
      student_id,
      authorizing_parent_id: req.caller!.id,
      driver_parent_id,
      day_of_week,
      updated_at: new Date().toISOString(),
    }));

    const {data, error} = await admin
      .from('carpool_authorizations')
      .upsert(rows, {onConflict: 'tenant_id,student_id,day_of_week'})
      .select(`id, day_of_week, student:students(${CARPOOL_STUDENT_FIELDS}), driver:profiles!carpool_authorizations_driver_parent_id_fkey(${CARPOOL_PARENT_FIELDS})`) as any;

    if (error) return fail(res, 500, error.message);

    const studentName = data?.[0]?.student ? `${(data[0] as any).student.first_name} ${(data[0] as any).student.last_name}` : 'un alumno';
    const driverName = data?.[0]?.driver ? `${(data[0] as any).driver.first_name} ${(data[0] as any).driver.last_name}` : 'otro padre';
    const dayNames = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    await notifyTenantAdmins(
      tenantId,
      'Nuevo Pool Day configurado',
      `${req.caller!.email ?? 'Un padre'} autorizó a ${driverName} a recoger a ${studentName} los días: ${days.map((d) => dayNames[d]).join(', ')}.`,
    );

    return ok(res, data);
  }),
);

app.delete(
  '/api/carpool/authorizations/:id',
  requireAuth,
  wrap(async (req, res) => {
    const {data: row} = await admin.from('carpool_authorizations').select('id, tenant_id, authorizing_parent_id').eq('id', req.params.id).maybeSingle();
    if (!row) return fail(res, 404, 'No encontrado.');
    if (row.authorizing_parent_id !== req.caller!.id && !isStaffOf(req.caller, row.tenant_id)) {
      return fail(res, 403, 'Sin permisos sobre esa autorización.');
    }
    const {error} = await admin.from('carpool_authorizations').delete().eq('id', req.params.id);
    if (error) return fail(res, 500, error.message);
    return ok(res);
  }),
);

app.post(
  '/api/carpool/overrides',
  requireAuth,
  wrap(async (req, res) => {
    const tenantId = req.caller!.tenantId;
    if (!tenantId) return fail(res, 403, 'Sin colegio asociado.');

    const {student_id, driver_parent_id, date} = req.body ?? {};
    if (!student_id || !driver_parent_id || !date) return fail(res, 400, 'Falta el alumno, el conductor o la fecha.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail(res, 400, 'Fecha inválida.');
    if (date < todayStr()) return fail(res, 400, 'La fecha debe ser hoy o en el futuro.');

    const validationError = await validateCarpoolActors(tenantId, req.caller!.id, student_id, driver_parent_id);
    if (validationError) return fail(res, 403, validationError);

    const {data, error} = await admin
      .from('carpool_overrides')
      .upsert(
        {
          tenant_id: tenantId,
          student_id,
          authorizing_parent_id: req.caller!.id,
          driver_parent_id,
          override_date: date,
          created_by: req.caller!.id,
        },
        {onConflict: 'tenant_id,student_id,override_date'},
      )
      .select(`id, override_date, student:students(${CARPOOL_STUDENT_FIELDS}), driver:profiles!carpool_overrides_driver_parent_id_fkey(${CARPOOL_PARENT_FIELDS})`) as any;

    if (error) return fail(res, 500, error.message);

    const studentName = data?.[0]?.student ? `${(data[0] as any).student.first_name} ${(data[0] as any).student.last_name}` : 'un alumno';
    const driverName = data?.[0]?.driver ? `${(data[0] as any).driver.first_name} ${(data[0] as any).driver.last_name}` : 'otro padre';
    await notifyTenantAdmins(
      tenantId,
      'Pool Day de un día configurado',
      `${req.caller!.email ?? 'Un padre'} autorizó a ${driverName} a recoger a ${studentName} el ${date} (excepción de un día).`,
    );

    return ok(res, data);
  }),
);

app.delete(
  '/api/carpool/overrides/:id',
  requireAuth,
  wrap(async (req, res) => {
    const {data: row} = await admin.from('carpool_overrides').select('id, tenant_id, authorizing_parent_id').eq('id', req.params.id).maybeSingle();
    if (!row) return fail(res, 404, 'No encontrado.');
    if (row.authorizing_parent_id !== req.caller!.id && !isStaffOf(req.caller, row.tenant_id)) {
      return fail(res, 403, 'Sin permisos sobre esa excepción.');
    }
    const {error} = await admin.from('carpool_overrides').delete().eq('id', req.params.id);
    if (error) return fail(res, 500, error.message);
    return ok(res);
  }),
);

/**
 * Se llama al anunciar la llegada por un alumno que hoy es pool day para
 * quien llama. Revalida server-side (no confía en lo que mande el cliente)
 * que exista una autorización real de hoy antes de avisar a los
 * administradores — así un padre no puede fabricar el aviso para un alumno
 * cualquiera.
 */
app.post(
  '/api/carpool/pickup-notify',
  requireAuth,
  wrap(async (req, res) => {
    const tenantId = req.caller!.tenantId;
    const {student_id} = req.body ?? {};
    if (!tenantId || !student_id) return fail(res, 400, 'Falta el alumno.');

    const today = todayStr();
    const todayDow = new Date().getDay();

    const [{data: override}, {data: assignment}, {data: student}] = await Promise.all([
      admin
        .from('carpool_overrides')
        .select(`driver_parent_id, authorizing:profiles!carpool_overrides_authorizing_parent_id_fkey(first_name, last_name)`)
        .eq('tenant_id', tenantId)
        .eq('student_id', student_id)
        .eq('override_date', today)
        .maybeSingle(),
      admin
        .from('carpool_authorizations')
        .select(`driver_parent_id, authorizing:profiles!carpool_authorizations_authorizing_parent_id_fkey(first_name, last_name)`)
        .eq('tenant_id', tenantId)
        .eq('student_id', student_id)
        .eq('day_of_week', todayDow)
        .maybeSingle(),
      admin.from('students').select('first_name, last_name').eq('id', student_id).maybeSingle(),
    ]);

    // La excepción del día manda sobre el recurrente semanal, mismo criterio
    // que resolveResponsibleStaff().
    const applicable: any = (override as any)?.driver_parent_id === req.caller!.id
      ? override
      : (assignment as any)?.driver_parent_id === req.caller!.id
        ? assignment
        : null;

    // No hay pool day real para hoy con este llamante: no se notifica a
    // nadie, pero tampoco se trata como error (el cliente ya decidió llamar
    // aquí basado en su copia local, que pudo quedar desactualizada).
    if (!applicable) return ok(res);

    const studentName = student ? `${student.first_name} ${student.last_name}` : 'un alumno';
    const authName = applicable.authorizing
      ? `${applicable.authorizing.first_name} ${applicable.authorizing.last_name}`
      : 'el padre/tutor habitual';

    await notifyTenantAdmins(
      tenantId,
      'Recogida por Pool Day',
      `${req.caller!.email ?? 'Un padre'} está recogiendo a ${studentName} hoy en lugar de ${authName} (Pool Day autorizado).`,
    );

    return ok(res);
  }),
);

// ════════════════════════════════════════════════════════════════════════════

app.use('/api', (_req, res) => fail(res, 404, 'Endpoint no encontrado.'));

app.listen(PORT, () => {
  console.log(`API de Safe Smart Pickup escuchando en el puerto ${PORT}`);
});
