import type {NextFunction, Request, Response} from 'express';
import {admin} from './supabase.js';

// Perfil del usuario que hace la petición, resuelto desde su JWT.
export interface Caller {
  id: string;
  email: string | null;
  role: 'parent' | 'admin' | 'super_admin';
  tenantId: string | null;
  isStaff: boolean;
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

  const {data, error} = await admin.auth.getUser(token);
  if (error || !data.user) return fail(res, 401, 'Sesión inválida o expirada.');

  const {data: profile, error: profileError} = await admin
    .from('profiles')
    .select('id, email, role, tenant_id, additional_tutor_name')
    .eq('id', data.user.id)
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

  req.caller = {
    id: profile.id,
    email: profile.email,
    role: profile.role,
    tenantId: profile.tenant_id,
    isStaff: profile.role === 'admin' || profile.role === 'super_admin' || isStaffFlag,
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
  return caller.isStaff && caller.tenantId === tenantId;
}

/** Admin del colegio (no basta con ser personal). */
export function isAdminOf(caller: Caller | undefined, tenantId: string | null | undefined): boolean {
  if (!caller) return false;
  if (caller.role === 'super_admin') return true;
  if (!tenantId) return false;
  return caller.role === 'admin' && caller.tenantId === tenantId;
}
