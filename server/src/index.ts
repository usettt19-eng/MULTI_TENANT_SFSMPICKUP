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

app.use('/api', (_req, res) => fail(res, 404, 'Endpoint no encontrado.'));

app.listen(PORT, () => {
  console.log(`API de Safe Smart Pickup escuchando en el puerto ${PORT}`);
});
