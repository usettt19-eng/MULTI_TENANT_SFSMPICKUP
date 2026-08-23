import type {NextFunction, Request, Response} from 'express';
import {admin} from './supabase.js';

// Perfil del usuario que hace la petición, resuelto desde su JWT.
export interface Caller {
  id: string;
  email: string | null;
  role: 'parent' | 'admin' | 'super_admin';
  tenantId: string | null;
  isStaff: boolean;
  // Colegios ADEMÁS del propio a los que se le concedió acceso (ver tabla
  // staff_school_access) — personal que trabaja en más de un colegio de la
  // misma organización, sin tener una segunda fila en `profiles`.
  grants: {tenantId: string; role: 'admin' | 'staff'}[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      caller?: Caller;
    }
  }
}

export function fail(res: Response, status: number, error: string) {
  return res.status(status).json({success: false, error});
}

export function ok(res: Response, data?: unknown) {
  return res.json({success: true, data});
}

/**
 * Valida el JWT de Supabase y carga el perfil del llamante.
 *
 * Esto NO es opcional: este servicio usa la clave `service_role`, que salta
 * todas las políticas RLS. Sin esta comprobación, cualquiera con la URL podría
 * crear o borrar usuarios en cualquier colegio — exactamente el agujero que se
 * cerró en la base de datos.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header('authorization') ?? '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';

  if (!token) return fail(res, 401, 'Falta la cabecera de autorización.');

  // admin.auth.getUser() no está envuelto por wrap() (es middleware, no la ruta
  // final), así que sin este try/catch un fallo de RED al validar el token —
  // service_role mal copiada, SUPABASE_URL incorrecta, sin salida a internet —
  // queda como una promesa rechazada sin capturar. El mensaje al cliente se
  // mantiene genérico por seguridad, pero el motivo real queda en el log del
  // contenedor (`docker compose logs api`) para poder diagnosticarlo.
  let data: Awaited<ReturnType<typeof admin.auth.getUser>>['data'] | undefined;
  try {
    const result = await admin.auth.getUser(token);
    if (result.error || !result.data.user) {
      console.error('[requireAuth] token rechazado:', result.error?.message ?? 'sin usuario');
      return fail(res, 401, 'Sesión inválida o expirada.');
    }
    data = result.data;
  } catch (err: any) {
    console.error('[requireAuth] fallo al validar el token contra Supabase Auth:', err?.message ?? err);
    return fail(res, 502, 'No se pudo verificar la sesión (fallo de conexión con Supabase).');
  }

  const {data: profile, error: profileError} = await admin
    .from('profiles')
    .select('id, email, role, tenant_id, additional_tutor_name')
    .eq('id', data.user!.id)
    .maybeSingle();

  if (profileError) return fail(res, 500, profileError.message);
  if (!profile) return fail(res, 403, 'El usuario no tiene perfil asignado.');

  // El personal que no es admin se marca con un flag dentro del JSON de
  // additional_tutor_name. Se replica la lógica de is_staff_of() en la base.
  let isStaffFlag = false;
  try {
    isStaffFlag = JSON.parse(profile.additional_tutor_name || '{}')?.is_staff === true;
  } catch {
    isStaffFlag = false;
  }

  const {data: grantRows} = await admin
    .from('staff_school_access')
    .select('tenant_id, role')
    .eq('staff_id', profile.id);

  req.caller = {
    id: profile.id,
    email: profile.email,
    role: profile.role,
    tenantId: profile.tenant_id,
    isStaff: profile.role === 'admin' || profile.role === 'super_admin' || isStaffFlag,
    grants: (grantRows ?? []).map((g) => ({tenantId: g.tenant_id, role: g.role as 'admin' | 'staff'})),
  };

  return next();
}

/** Sólo el super_admin: operaciones que cruzan colegios. */
export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.caller?.role !== 'super_admin') {
    return fail(res, 403, 'Requiere permisos de super administrador.');
  }
  return next();
}

/** El llamante debe ser personal del colegio indicado (el super_admin pasa siempre). */
export function isStaffOf(caller: Caller | undefined, tenantId: string | null | undefined): boolean {
  if (!caller) return false;
  if (caller.role === 'super_admin') return true;
  if (!tenantId) return false;
  if (caller.isStaff && caller.tenantId === tenantId) return true;
  return caller.grants.some((g) => g.tenantId === tenantId);
}

/** Admin del colegio (no basta con ser personal). */
export function isAdminOf(caller: Caller | undefined, tenantId: string | null | undefined): boolean {
  if (!caller) return false;
  if (caller.role === 'super_admin') return true;
  if (!tenantId) return false;
  if (caller.role === 'admin' && caller.tenantId === tenantId) return true;
  return caller.grants.some((g) => g.tenantId === tenantId && g.role === 'admin');
}

/**
 * Colegio sobre el que opera la petición: el que pide el cuerpo, SI el
 * llamante tiene acceso legítimo a él (su propio colegio, uno concedido, o
 * cualquiera si es super_admin); si no, cae al colegio de casa del llamante.
 * Reemplaza el patrón repetido `role === 'super_admin' ? body.tenant_id :
 * caller.tenantId`, que ignoraba el acceso concedido a un segundo colegio.
 */
export function resolveTenantId(caller: Caller | undefined, bodyTenantId?: string | null): string | null {
  if (!caller) return null;
  if (bodyTenantId && isStaffOf(caller, bodyTenantId)) return bodyTenantId;
  return caller.tenantId;
}
