import express from 'express';
import {admin} from './supabase.js';
import {fail, isAdminOf, isStaffOf, ok, requireAuth, requireSuperAdmin, resolveTenantId} from './auth.js';

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

/**
 * Reproxea una foto de Supabase Storage para SmartCheckIn.tsx (reconocimiento
 * facial vía face-api.js).
 *
 * face-api.js carga la foto de cada padre con `faceapi.fetchImage(url)` y
 * después lee los píxeles de un <canvas> — si la imagen viene de otro origen
 * sin cabeceras CORS que lo permitan, el canvas queda "tainted" y la lectura
 * de píxeles falla en silencio. Pasarla por este mismo origen evita el
 * problema sin depender de la configuración CORS del bucket de Storage.
 *
 * Sin `requireAuth` a propósito: `faceapi.fetchImage()` hace un `fetch()`
 * plano, sin forma de mandarle la cabecera Authorization. No es una fuga —
 * las fotos de `avatars` ya son públicas (se muestran sin auth en <img> por
 * toda la app) — pero para no quedar como proxy abierto hacia cualquier URL,
 * solo se permite reenviar pedidos cuyo origen sea el mismo proyecto de
 * Supabase configurado en este servidor.
 */
app.get(
  '/api/proxy-image',
  wrap(async (req, res) => {
    const rawUrl = req.query.url;
    if (typeof rawUrl !== 'string' || !rawUrl) return fail(res, 400, 'Falta el parámetro url.');

    let target: URL;
    try {
      target = new URL(rawUrl);
    } catch {
      return fail(res, 400, 'URL inválida.');
    }

    const allowedOrigin = new URL(process.env.SUPABASE_URL!).origin;
    if (target.origin !== allowedOrigin) {
      return fail(res, 400, 'Solo se permite reproxear imágenes del proyecto de Supabase.');
    }

    const upstream = await fetch(target.toString());
    if (!upstream.ok || !upstream.body) {
      return fail(res, upstream.status || 502, 'No se pudo obtener la imagen.');
    }

    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(Buffer.from(await upstream.arrayBuffer()));
  }),
);

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
      admin.from('profiles').select('id, tenant_id, role, first_name, last_name, email, phone, additional_tutor_name, created_at'),
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
      {
        students: number; parents: number; staff: number; doors: number;
        latitude: number | null; longitude: number | null;
        admin: {id: string; first_name: string | null; last_name: string | null; email: string | null; phone: string | null} | null;
      }
    > = {};

    for (const t of tenants.data ?? []) {
      stats[t.id] = {students: 0, parents: 0, staff: 0, doors: 0, latitude: null, longitude: null, admin: null};
    }
    for (const s of students.data ?? []) {
      if (s.tenant_id && stats[s.tenant_id]) stats[s.tenant_id].students++;
    }
    // El administrador "principal" es el primer admin creado en el colegio
    // (el que se da de alta junto con el tenant en /api/tenants/register) —
    // mismo criterio que ya usa /api/tenants/reset-admin-password.
    const earliestAdminAt: Record<string, string> = {};
    for (const p of profiles.data ?? []) {
      if (!p.tenant_id || !stats[p.tenant_id]) continue;
      if (p.role === 'parent') stats[p.tenant_id].parents++;
      else if (isStaff(p)) stats[p.tenant_id].staff++;
      else if (p.role === 'admin') {
        const current = earliestAdminAt[p.tenant_id];
        if (!current || p.created_at < current) {
          earliestAdminAt[p.tenant_id] = p.created_at;
          stats[p.tenant_id].admin = {
            id: p.id, first_name: p.first_name, last_name: p.last_name, email: p.email, phone: p.phone,
          };
        }
      }
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

// El PIN identifica al padre en SmartCheckIn (kiosco de puerta) buscando por
// tenant_id + pin_code con .maybeSingle() — si dos padres del mismo colegio
// comparten PIN, esa búsqueda encuentra 2 filas, falla en silencio, y a
// AMBOS les sale "PIN Incorrecto" aunque el suyo sea correcto. No hay
// constraint de unicidad en la base (el campo es texto libre digitado a
// mano o importado del CSV), así que se valida acá antes de guardar.
async function isPinTaken(tenantId: string | null, pinCode: string, excludeId?: string): Promise<boolean> {
  if (!tenantId) return false;
  let query = admin
    .from('profiles')
    .select('id', {count: 'exact', head: true})
    .eq('tenant_id', tenantId)
    .eq('role', 'parent')
    .eq('pin_code', pinCode);
  if (excludeId) query = query.neq('id', excludeId);
  const {count, error} = await query;
  if (error) throw error;
  return (count ?? 0) > 0;
}

app.post(
  '/api/parents',
  requireAuth,
  wrap(async (req, res) => {
    const body = req.body ?? {};
    // El colegio lo decide el llamante, NO el cuerpo de la petición: si no,
    // un admin podría crear padres en otro colegio enviando otro tenant_id.
    const tenantId = resolveTenantId(req.caller, body.tenant_id);

    if (!isStaffOf(req.caller, tenantId)) return fail(res, 403, 'No tienes permisos en ese colegio.');
    if (!body.email) return fail(res, 400, 'Falta el correo.');

    if (typeof body.pin_code === 'string' && body.pin_code.trim()) {
      if (await isPinTaken(tenantId, body.pin_code.trim())) {
        return fail(res, 409, 'Ese PIN ya lo usa otro padre de este colegio. Elige uno distinto.');
      }
    }

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

    if (typeof body.pin_code === 'string' && body.pin_code.trim()) {
      if (await isPinTaken(target.tenant_id, body.pin_code.trim(), id)) {
        return fail(res, 409, 'Ese PIN ya lo usa otro padre de este colegio. Elige uno distinto.');
      }
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

    // Mismo motivo que /api/parents: el colegio lo decide el llamante, no
    // el cuerpo, salvo que sea super_admin operando sobre otro colegio.
    const tenantId = resolveTenantId(req.caller, req.body?.tenant_id);
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

    // Los PIN del CSV vienen copiados a mano (ej. "últimos 4 del teléfono"),
    // así que colisionan seguido entre familias distintas — se rastrean
    // acá los que ya se usaron EN ESTE MISMO archivo, además de consultar
    // los que ya existían en el colegio antes de la importación.
    const pinsUsedInBatch = new Set<string>();

    // Secuencial a propósito: en paralelo se dispara el rate limit de Auth.
    for (const p of parents) {
      if (!p?.email) {
        failed.push({email: '(sin correo)', error: 'Falta el correo'});
        continue;
      }

      const pin = typeof p.pin_code === 'string' ? p.pin_code.trim() : '';
      if (pin) {
        if (pinsUsedInBatch.has(pin) || (await isPinTaken(tenantId, pin))) {
          failed.push({email: p.email, error: `PIN ${pin} ya está en uso por otro padre de este colegio`});
          continue;
        }
        pinsUsedInBatch.add(pin);
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
    const tenantId = resolveTenantId(req.caller, body.tenant_id);

    // Crear personal es más sensible que crear padres: exige ser admin.
    if (!isAdminOf(req.caller, tenantId)) return fail(res, 403, 'Requiere ser administrador del colegio.');
    if (!body.email) return fail(res, 400, 'Falta el correo.');

    // Si el correo ya tiene cuenta (típicamente porque es personal de OTRO
    // colegio de la misma organización), no se le invita de nuevo ni se toca
    // su perfil "de casa": se le concede acceso a este colegio vía
    // staff_school_access (ver AuthContext.switchStaffSchool en el frontend).
    const {data: existing, error: existingError} = await admin
      .from('profiles')
      .select('id, tenant_id')
      .eq('email', body.email)
      .maybeSingle();
    if (existingError) return fail(res, 500, existingError.message);

    if (existing) {
      if (existing.tenant_id === tenantId) {
        return fail(res, 409, 'Ese correo ya es personal de este colegio.');
      }
      const {error: grantError} = await admin.from('staff_school_access').upsert(
        {
          staff_id: existing.id,
          tenant_id: tenantId,
          role: 'admin',
          permissions: body.permissions ?? [],
          granted_by: req.caller!.id,
        },
        {onConflict: 'staff_id,tenant_id'},
      );
      if (grantError) return fail(res, 500, grantError.message);
      return ok(res, {granted_existing: true, staff_id: existing.id});
    }

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
        photo_url: body.photo_url ?? null,
        role: 'admin',
        tenant_id: tenantId,
        additional_tutor_name: JSON.stringify({
          is_staff: true,
          permissions: body.permissions ?? [],
          notify_all_arrivals: body.notify_all_arrivals === true,
        }),
      })
      .eq('id', created.user.id)
      .select()
      .single();

    if (profileError) return fail(res, 500, profileError.message);
    return ok(res, profile);
  }),
);

/**
 * Alta masiva de personal desde un CSV — mismo patrón que /api/parents/bulk:
 * cada fila recibe su propio correo de invitación, sin contraseña. Los
 * módulos de acceso llegan como arreglo de ids (ver AVAILABLE_MODULES en
 * StaffManagement.tsx) y se guardan igual que en el alta individual.
 */
app.post(
  '/api/staff/bulk',
  requireAuth,
  wrap(async (req, res) => {
    const rows = Array.isArray(req.body?.staff) ? req.body.staff : [];
    if (rows.length === 0) return fail(res, 400, 'No se recibió ningún miembro del personal.');
    if (rows.length > 500) return fail(res, 400, 'Máximo 500 filas por importación.');

    const tenantId = resolveTenantId(req.caller, req.body?.tenant_id);
    if (!isAdminOf(req.caller, tenantId)) return fail(res, 403, 'Requiere ser administrador del colegio.');

    const created: unknown[] = [];
    const granted: unknown[] = [];
    const failed: {email: string; error: string}[] = [];

    // Secuencial a propósito: en paralelo se dispara el rate limit de Auth
    // (mismo motivo que /api/parents/bulk).
    for (const r of rows) {
      if (!r?.email) {
        failed.push({email: '(sin correo)', error: 'Falta el correo'});
        continue;
      }

      // Mismo criterio que /api/staff: un correo que ya tiene cuenta en otro
      // colegio recibe acceso concedido, no una invitación nueva.
      const {data: existing, error: existingError} = await admin
        .from('profiles')
        .select('id, tenant_id')
        .eq('email', r.email)
        .maybeSingle();
      if (existingError) {
        failed.push({email: r.email, error: existingError.message});
        continue;
      }
      if (existing) {
        if (existing.tenant_id === tenantId) {
          failed.push({email: r.email, error: 'Ya es personal de este colegio'});
          continue;
        }
        const {error: grantError} = await admin.from('staff_school_access').upsert(
          {
            staff_id: existing.id,
            tenant_id: tenantId,
            role: 'admin',
            permissions: Array.isArray(r.permissions) ? r.permissions : [],
            granted_by: req.caller!.id,
          },
          {onConflict: 'staff_id,tenant_id'},
        );
        if (grantError) {
          failed.push({email: r.email, error: grantError.message});
        } else {
          granted.push({id: existing.id, email: r.email});
        }
        continue;
      }

      const {data: user, error} = await admin.auth.admin.inviteUserByEmail(r.email, {
        redirectTo: process.env.PUBLIC_APP_URL || undefined,
        data: {
          first_name: r.first_name ?? '',
          last_name: r.last_name ?? '',
          role: 'admin',
          tenant_id: tenantId,
          needs_password_setup: true,
        },
      });

      if (error || !user?.user) {
        failed.push({email: r.email, error: error?.message ?? 'desconocido'});
        continue;
      }

      const permissions: string[] = Array.isArray(r.permissions) ? r.permissions : [];
      await admin
        .from('profiles')
        .update({
          first_name: r.first_name ?? '',
          last_name: r.last_name ?? '',
          email: r.email,
          role: 'admin',
          tenant_id: tenantId,
          additional_tutor_name: JSON.stringify({is_staff: true, permissions}),
        })
        .eq('id', user.user.id);

      created.push({id: user.user.id, email: r.email});
    }

    return ok(res, {created: created.length, granted: granted.length, failed});
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

    const profileUpdate: Record<string, unknown> = {
      additional_tutor_name: JSON.stringify({
        ...current,
        is_staff: true,
        permissions: req.body?.permissions ?? [],
        notify_all_arrivals: req.body?.notify_all_arrivals === true,
      }),
    };
    // Nombre y foto son opcionales acá: si el modal solo tocó permisos (el
    // caso más común), no vienen en el body y no se pisan con vacío.
    if (req.body?.first_name !== undefined) profileUpdate.first_name = req.body.first_name;
    if (req.body?.last_name !== undefined) profileUpdate.last_name = req.body.last_name;
    if (req.body?.photo_url !== undefined) profileUpdate.photo_url = req.body.photo_url || null;

    const {data: profile, error} = await admin
      .from('profiles')
      .update(profileUpdate)
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

    // Antes de borrar el usuario de Auth hay que soltar todo lo que lo
    // referencia — si no, Supabase devuelve el genérico "Database error
    // deleting user" sin decir cuál fila fue. Se limpia explícitamente en
    // vez de dejar que la FK bloquee el borrado.
    await admin.from('notifications').delete().eq('user_id', id);
    await admin.from('staff_school_access').delete().eq('staff_id', id);
    await admin.from('staff_school_access').update({granted_by: null}).eq('granted_by', id);

    // dismissal_assignments: si estaba en el slot 1, se promueve el slot 2
    // (si había alguien) en vez de borrar la asignación entera — mismo
    // criterio que ya usa el frontend al vaciar un slot manualmente.
    const {data: assignmentsAsSlot1} = await admin
      .from('dismissal_assignments')
      .select('id, staff_id_2')
      .eq('staff_id', id);
    for (const row of assignmentsAsSlot1 || []) {
      if (row.staff_id_2) {
        await admin.from('dismissal_assignments').update({staff_id: row.staff_id_2, staff_id_2: null}).eq('id', row.id);
      } else {
        await admin.from('dismissal_assignments').delete().eq('id', row.id);
      }
    }
    await admin.from('dismissal_assignments').update({staff_id_2: null}).eq('staff_id_2', id);

    await admin.from('dismissal_overrides').delete().eq('staff_id', id);
    await admin.from('dismissal_overrides').update({created_by: null}).eq('created_by', id);

    // Registros históricos: se intenta anonimizar el autor sin borrar el
    // registro (auditoría / salud del alumno). Si alguna de estas columnas
    // no admite NULL, esa actualización puntual queda con error y se
    // ignora — no interrumpe el resto de la limpieza.
    await admin.from('student_incidents').update({reported_by: null}).eq('reported_by', id);
    await admin.from('daily_reports').update({generated_by: null}).eq('generated_by', id);
    await admin.from('self_dismissal_events').update({verified_by: null}).eq('verified_by', id);

    const {error} = await admin.auth.admin.deleteUser(id);
    if (error) return fail(res, 400, error.message);

    await admin.from('profiles').delete().eq('id', id);
    return ok(res, {id});
  }),
);

/**
 * Revoca el acceso concedido de un staff a un colegio que NO es el suyo
 * (ver /api/staff y staff_school_access) — a diferencia de DELETE
 * /api/staff/:id, esto NO borra la cuenta ni su perfil "de casa", solo
 * la fila de acceso a este colegio en particular.
 */
app.delete(
  '/api/staff/school-access/:staffId/:tenantId',
  requireAuth,
  wrap(async (req, res) => {
    const {staffId, tenantId} = req.params;
    if (!isAdminOf(req.caller, tenantId)) return fail(res, 403, 'Requiere ser administrador del colegio.');

    const {error} = await admin
      .from('staff_school_access')
      .delete()
      .eq('staff_id', staffId)
      .eq('tenant_id', tenantId);

    if (error) return fail(res, 500, error.message);
    return ok(res, {staff_id: staffId, tenant_id: tenantId});
  }),
);

/**
 * Cambia los módulos habilitados de un acceso ya concedido (ver POST
 * /api/staff, rama `granted_existing`). Antes de esto la única forma de
 * ajustar permisos de alguien "de otro colegio" era revocar y volver a
 * agregarlo desde cero — confuso, y sin este endpoint el frontend no tenía
 * forma de distinguir "agregar" de "editar" para este caso.
 */
app.put(
  '/api/staff/school-access/:staffId/:tenantId',
  requireAuth,
  wrap(async (req, res) => {
    const {staffId, tenantId} = req.params;
    if (!isAdminOf(req.caller, tenantId)) return fail(res, 403, 'Requiere ser administrador del colegio.');

    const permissions = Array.isArray(req.body?.permissions) ? req.body.permissions : [];
    const {error} = await admin
      .from('staff_school_access')
      .update({permissions})
      .eq('staff_id', staffId)
      .eq('tenant_id', tenantId);

    if (error) return fail(res, 500, error.message);
    return ok(res, {staff_id: staffId, tenant_id: tenantId, permissions});
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
    const {replacement_name, replacement_phone, photo_url} = req.body ?? {};
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
        photo_url: photo_url ?? null,
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
// AVISO DE LLEGADA AL PERSONAL ENCARGADO DE LA SALIDA
// ════════════════════════════════════════════════════════════════════════════
//
// El padre anuncia su llegada desde su navegador (clave anon + RLS), que solo
// deja insertar en `notifications` filas para uno mismo o si eres staff — un
// padre no puede crear una notificación dirigida al personal. Por eso este
// aviso pasa por aquí (service_role), igual que /api/carpool/pickup-notify.

app.post(
  '/api/pickup/notify-staff',
  requireAuth,
  wrap(async (req, res) => {
    const tenantId = req.caller!.tenantId;
    const {student_id, pickup_event_id} = req.body ?? {};
    if (!tenantId || !student_id) return fail(res, 400, 'Falta el alumno.');

    const todayDow = new Date().getDay();

    const [{data: link}, {data: student}, {data: override}, {data: authorization}, {data: parent}] =
      await Promise.all([
        admin
          .from('parent_students')
          .select('student_id')
          .eq('parent_id', req.caller!.id)
          .eq('student_id', student_id)
          .maybeSingle(),
        admin.from('students').select('first_name, last_name, grade, section').eq('id', student_id).eq('tenant_id', tenantId).maybeSingle(),
        admin
          .from('carpool_overrides')
          .select(`driver_parent_id, authorizing:profiles!carpool_overrides_authorizing_parent_id_fkey(first_name, last_name)`)
          .eq('tenant_id', tenantId)
          .eq('student_id', student_id)
          .eq('override_date', todayStr())
          .maybeSingle(),
        admin
          .from('carpool_authorizations')
          .select(`driver_parent_id, authorizing:profiles!carpool_authorizations_authorizing_parent_id_fkey(first_name, last_name)`)
          .eq('tenant_id', tenantId)
          .eq('student_id', student_id)
          .eq('day_of_week', todayDow)
          .maybeSingle(),
        admin.from('profiles').select('first_name, last_name').eq('id', req.caller!.id).maybeSingle(),
      ]);

    if (!student) return fail(res, 404, 'Alumno no encontrado.');

    // Mismo criterio que /api/carpool/pickup-notify: la excepción del día
    // manda sobre el recurrente semanal.
    const carpoolMatch: any =
      (override as any)?.driver_parent_id === req.caller!.id
        ? override
        : (authorization as any)?.driver_parent_id === req.caller!.id
          ? authorization
          : null;

    // Solo el padre/tutor real, o quien tiene pool day autorizado hoy, puede
    // disparar este aviso.
    if (!link && !carpoolMatch) return fail(res, 403, 'No tienes autorización sobre ese alumno.');

    const {data: grade} = await admin
      .from('school_grades')
      .select('id')
      .eq('tenant_id', tenantId)
      .ilike('name', student.grade ?? '')
      .maybeSingle();

    let staffIds: string[] = [];
    if (grade) {
      const dateStr = todayStr();
      // Comparación sin distinguir mayúsculas/minúsculas: la sección del
      // alumno ("Year 10") y la de la asignación en Ajustes ("YEAR 10") no
      // siempre coinciden con .eq() exacto — eso dejaba sin avisar al
      // encargado real en cualquier colegio que no escribiera la sección
      // idéntica letra por letra en ambos lados.
      const norm = (s: string | null | undefined) => (s || '').trim().toLowerCase();
      const sectionValue = norm(student.section);
      const pickExact = (rows: any[]) =>
        rows.find((r) => norm(r.section) === sectionValue) || rows.find((r) => norm(r.section) === '');

      const {data: assignmentRows} = await admin
        .from('dismissal_assignments')
        .select('staff_id, staff_id_2, section')
        .eq('tenant_id', tenantId)
        .eq('grade_id', grade.id)
        .eq('schedule_type', 'regular')
        .eq('day_of_week', todayDow);

      const assignment = assignmentRows && assignmentRows.length > 0 ? pickExact(assignmentRows) : undefined;
      let slot1: string | null = assignment?.staff_id ?? null;
      let slot2: string | null = assignment?.staff_id_2 ?? null;

      const {data: overrideRows} = await admin
        .from('dismissal_overrides')
        .select('staff_id, section, slot')
        .eq('tenant_id', tenantId)
        .eq('grade_id', grade.id)
        .eq('schedule_type', 'regular')
        .eq('override_date', dateStr);

      if (overrideRows && overrideRows.length > 0) {
        const slot1Overrides = overrideRows.filter((o) => o.slot === 1);
        const slot2Overrides = overrideRows.filter((o) => o.slot === 2);
        const slot1Pick = slot1Overrides.length > 0 ? pickExact(slot1Overrides) : undefined;
        const slot2Pick = slot2Overrides.length > 0 ? pickExact(slot2Overrides) : undefined;
        if (slot1Pick) slot1 = slot1Pick.staff_id;
        if (slot2Pick) slot2 = slot2Pick.staff_id;
      }

      staffIds = Array.from(new Set([slot1, slot2].filter((id): id is string => !!id)));
    }

    // Staff marcado como "recibir todos los avisos de llegada" (ej. recepción)
    // se suma SIEMPRE, tenga o no un encargado asignado a ese grado+sección.
    const {data: alwaysNotifyStaff} = await admin
      .from('profiles')
      .select('id, additional_tutor_name')
      .eq('tenant_id', tenantId)
      .eq('role', 'admin');
    for (const s of alwaysNotifyStaff ?? []) {
      try {
        if (JSON.parse(s.additional_tutor_name || '{}')?.notify_all_arrivals === true) {
          staffIds.push(s.id);
        }
      } catch {
        // ignorar JSON inválido
      }
    }
    staffIds = Array.from(new Set(staffIds));

    if (staffIds.length > 0) {
      const parentName = parent ? `${parent.first_name ?? ''} ${parent.last_name ?? ''}`.trim() : 'El padre/tutor';
      const carpoolNote = carpoolMatch
        ? ` (Pool day: recoge en lugar de ${carpoolMatch.authorizing?.first_name ?? ''} ${carpoolMatch.authorizing?.last_name ?? ''}.)`
        : '';

      await admin.from('notifications').insert(
        staffIds.map((staffId) => ({
          user_id: staffId,
          title: `${parentName} llegó`,
          message: `El padre/tutor de ${student.first_name} ${student.last_name} llegó a la zona de recogida.${carpoolNote}`,
          type: 'info',
          tenant_id: tenantId,
          pickup_event_id: pickup_event_id ?? null,
        })),
      );
    }

    return ok(res);
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
      .eq('role', 'parent')
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

  const {data: driver, error: driverError} = await admin
    .from('profiles')
    .select('id')
    .eq('id', driverParentId)
    .eq('tenant_id', tenantId)
    .eq('role', 'parent')
    .maybeSingle();
  if (driverError) return `Error al validar el conductor: ${driverError.message}`;
  if (!driver) return 'El conductor debe ser un padre/tutor registrado de este colegio.';

  return null;
}

/**
 * Notifica a TODO el personal del colegio (administradores reales y
 * maestros/staff por igual) — no bloquea la respuesta si falla. Pensada
 * para avisos de seguridad (alerta discreta, solicitud de ayuda) donde
 * cualquiera del staff debe enterarse, sin importar su grado/sección.
 *
 * En esta app cada maestro/staff también tiene `role = 'admin'` en la
 * base de datos (con permisos limitados guardados aparte, en
 * `additional_tutor_name`) — por eso esta función alcanza a todo el
 * personal, no solo a quien administra el colegio.
 */
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

/**
 * Notifica solo a quien de verdad administra el colegio, o a quien tenga
 * marcado explícitamente "recibir todos los avisos de llegada"
 * (`notify_all_arrivals`, el mismo check de Gestión de Personal que usa
 * /api/pickup/notify-staff) — a diferencia de notifyTenantAdmins, NO le
 * llega a cualquier maestro con `role = 'admin'` + `is_staff`.
 *
 * Se usa para los avisos de Pool Day: antes de este fix, cada Pool Day
 * (configurado o al momento de la recogida) le llegaba a absolutamente
 * todo el personal del colegio, aunque el alumno no tuviera nada que ver
 * con su grado o sección — confirmado en TCS Albrook el 2026-09-01.
 */
async function notifySchoolAdmins(tenantId: string, title: string, message: string) {
  try {
    const {data: profiles} = await admin
      .from('profiles')
      .select('id, additional_tutor_name')
      .eq('tenant_id', tenantId)
      .eq('role', 'admin');
    if (!profiles || profiles.length === 0) return;
    const recipients = profiles.filter((p) => {
      try {
        const parsed = JSON.parse(p.additional_tutor_name || '{}');
        if (parsed?.is_staff !== true) return true; // administrador real del colegio
        return parsed?.notify_all_arrivals === true;
      } catch {
        return true; // JSON inválido: se trata como administrador real, igual que antes
      }
    });
    if (recipients.length === 0) return;
    await admin.from('notifications').insert(
      recipients.map((a) => ({user_id: a.id, title, message, type: 'info', tenant_id: tenantId})),
    );
  } catch (err) {
    console.error('Error al notificar a administradores del colegio:', err);
  }
}

/**
 * Alerta Discreta: el personal de puerta la activa desde el Monitor Externo
 * sin alterar visualmente esa pantalla (a diferencia del Lockdown, que sí es
 * público) — solo queda en la Bitácora y llega como notificación a los
 * administradores/staff del colegio para que revisen la situación con
 * cautela.
 */
app.post(
  '/api/security/discrete-alert',
  requireAuth,
  wrap(async (req, res) => {
    const tenantId = req.caller!.tenantId;
    if (!tenantId) return fail(res, 403, 'Sin colegio asociado.');

    const doorName = typeof req.body?.door_name === 'string' ? req.body.door_name.slice(0, 120) : null;
    // 'discrete_alert' = Monitor Externo (algo sospechoso, sin alertar al
    // público que ve la pantalla); 'help_request' = Check-In (alguien en el
    // mostrador necesita a un miembro del personal). Mismo mecanismo de
    // aviso a administradores, distinto texto según el origen.
    const kind = req.body?.kind === 'help_request' ? 'help_request' : 'discrete_alert';
    const suffix = doorName ? ` (${doorName})` : '';

    const description =
      kind === 'help_request'
        ? `SOLICITUD DE AYUDA activada desde Check-In${suffix}.`
        : `ALERTA DISCRETA activada desde el Monitor Externo${suffix}.`;
    const title = kind === 'help_request' ? 'Solicitud de ayuda en Check-In' : 'Alerta discreta en Monitor Externo';
    const message =
      kind === 'help_request'
        ? `Alguien necesita ayuda en el mostrador de Check-In${suffix}. Acércate cuando puedas.`
        : `Personal de puerta activó una alerta discreta${suffix}. Revisa la situación con cautela, sin alertar al público.`;

    await admin.from('audit_logs').insert({
      event_type: 'SECURITY',
      description,
      actor_name: req.caller!.email ?? 'Personal',
      metadata: {door_name: doorName, kind},
      tenant_id: tenantId,
    });

    await notifyTenantAdmins(tenantId, title, message);

    return ok(res);
  }),
);

app.post(
  '/api/forms/notify',
  requireAuth,
  wrap(async (req, res) => {
    const {form_id} = req.body ?? {};
    if (!form_id) return fail(res, 400, 'Falta el formulario.');

    const {data: form} = await admin
      .from('forms')
      .select('id, title, description, target_grades, target_sections, tenant_id')
      .eq('id', form_id)
      .maybeSingle();
    if (!form) return fail(res, 404, 'Formulario no encontrado.');
    if (!isStaffOf(req.caller, form.tenant_id)) return fail(res, 403, 'Sin permisos en ese colegio.');

    const grades: string[] = form.target_grades ?? [];
    if (grades.length === 0) return ok(res, {notified: 0});
    const sections: string[] = form.target_sections ?? [];
    const norm = (s: string | null | undefined) => (s || '').trim().toLowerCase();
    const normSections = sections.map(norm);

    // Los padres no ven este aviso hasta que abren la app (fetchPendingForms
    // en el panel), así que además se les manda una notificación real
    // (campana + sonido) para que se enteren sin tener que entrar a
    // revisar. El insert pasa por el backend con service_role porque un
    // padre solo puede insertarse notificaciones a sí mismo (RLS), pero
    // aquí es el colegio notificando a muchos padres a la vez.
    const {data: studentsRaw} = await admin
      .from('students')
      .select('id, grade, section')
      .eq('tenant_id', form.tenant_id)
      .in('grade', grades);
    // Si se segmentó por sección, filtra en el servidor comparando sin
    // mayúsculas/espacios — igual que el resto del sistema, para no
    // repetir el bug de secciones que nunca hacían match por casing.
    const students = normSections.length === 0
      ? (studentsRaw ?? [])
      : (studentsRaw ?? []).filter((s) => normSections.includes(norm(s.section)));
    const studentIds = students.map((s) => s.id);
    if (studentIds.length === 0) return ok(res, {notified: 0});

    const {data: links} = await admin
      .from('parent_students')
      .select('parent_id')
      .in('student_id', studentIds);
    const parentIds = Array.from(new Set((links ?? []).map((l) => l.parent_id)));
    if (parentIds.length === 0) return ok(res, {notified: 0});

    const title = form.title || 'Nuevo aviso del colegio';
    const message = form.description || 'Tienes un nuevo aviso pendiente de revisar.';
    await admin.from('notifications').insert(
      parentIds.map((parent_id) => ({user_id: parent_id, title, message, type: 'info', tenant_id: form.tenant_id})),
    );

    return ok(res, {notified: parentIds.length});
  }),
);

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
    await notifySchoolAdmins(
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
    await notifySchoolAdmins(
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

    await notifySchoolAdmins(
      tenantId,
      'Recogida por Pool Day',
      `${req.caller!.email ?? 'Un padre'} está recogiendo a ${studentName} hoy en lugar de ${authName} (Pool Day autorizado).`,
    );

    return ok(res);
  }),
);

// ════════════════════════════════════════════════════════════════════════════

// Cierre automático de recogidas "en tránsito": si pasan más de 20 minutos
// desde que el padre anunció su llegada (announced_at) sin que confirme el
// encuentro con el alumno, se asume que ya lo tiene en el vehículo y se
// cierra el ciclo solo. Esto complementa el auto-cierre por geocerca que ya
// existe en el cliente (ParentDashboard.tsx sale del perímetro → confirma a
// los 20s) para el caso en que el padre no tenga la app abierta o el GPS
// desactivado. Corre en el backend (siempre encendido en Docker Compose)
// porque no puede depender de que el navegador/app del padre siga activo.
const AUTO_COMPLETE_STALE_MS = 20 * 60 * 1000; // 20 min, igual al umbral de "obsoleto" del frontend (ver src/lib/pickupHelpers.ts)

async function autoCompleteStalePickups() {
  const cutoffIso = new Date(Date.now() - AUTO_COMPLETE_STALE_MS).toISOString();
  const {data: stale, error} = await admin
    .from('pickup_events')
    .select('id, tenant_id, parent_id, students:student_id(first_name, last_name)')
    .eq('status', 'released')
    .lt('announced_at', cutoffIso);

  if (error) {
    console.error('Error buscando recogidas en tránsito vencidas:', error);
    return;
  }
  if (!stale || stale.length === 0) return;

  for (const pickup of stale as any[]) {
    // El filtro por status: 'released' evita pisar una confirmación real
    // del padre que haya llegado justo entre el select y este update.
    const {error: updateError} = await admin
      .from('pickup_events')
      .update({status: 'completed', completed_at: new Date().toISOString()})
      .eq('id', pickup.id)
      .eq('status', 'released');

    if (updateError) {
      console.error(`Error auto-completando recogida ${pickup.id}:`, updateError);
      continue;
    }

    const studentName = pickup.students
      ? `${pickup.students.first_name ?? ''} ${pickup.students.last_name ?? ''}`.trim()
      : 'el alumno';

    await admin.from('audit_logs').insert({
      event_type: 'PICKUP',
      description: `CICLO COMPLETADO (automático por tiempo): pasaron más de 20 minutos desde que se anunció la llegada para ${studentName} sin confirmación del padre.`,
      actor_name: 'Sistema',
      metadata: {pickup_id: pickup.id, auto_confirmed: true, reason: 'stale_timeout'},
      tenant_id: pickup.tenant_id,
    });

    if (pickup.parent_id) {
      await admin.from('notifications').insert({
        user_id: pickup.parent_id,
        title: 'Recogida cerrada automáticamente',
        message: `Se cerró automáticamente el ciclo de recogida de ${studentName} porque pasaron más de 20 minutos sin confirmar. Si aún no lo tienes contigo, contacta al colegio.`,
        type: 'info',
        tenant_id: pickup.tenant_id,
      });
    }
  }
}

setInterval(() => {
  autoCompleteStalePickups().catch((err) => console.error('Error en autoCompleteStalePickups:', err));
}, 60_000);

app.use('/api', (_req, res) => fail(res, 404, 'Endpoint no encontrado.'));

app.listen(PORT, () => {
  console.log(`API de Safe Smart Pickup escuchando en el puerto ${PORT}`);
  autoCompleteStalePickups().catch((err) => console.error('Error en autoCompleteStalePickups:', err));
});
