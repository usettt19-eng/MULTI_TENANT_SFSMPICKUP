import React from 'react';
import { ShieldAlert, LogOut, Building2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

/**
 * Franja fija que aparece cuando un super admin "entró" a un colegio puntual
 * (ver AuthContext.enterTenantAsAdmin) — para que nunca se le olvide que está
 * configurando en nombre de otro colegio y no el suyo. También sirve de
 * selector de colegio para el staff con acceso concedido a más de uno (ver
 * AuthContext.switchStaffSchool / tabla staff_school_access).
 */
export function ImpersonationBanner() {
  const {
    isImpersonating, profile, exitImpersonation,
    realProfile, schoolAccessGrants, activeGrantTenantId, switchStaffSchool,
  } = useAuth() as any;

  if (isImpersonating) {
    return (
      <div className="sticky top-0 z-[500] bg-amber-500 text-white px-4 py-2.5 flex items-center justify-between gap-3 shadow-md">
        <div className="flex items-center gap-2 text-xs sm:text-sm font-bold">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>
            Modo Super Admin — configurando <span className="font-black">{profile?.tenant?.name || 'colegio'}</span>
          </span>
        </div>
        <button
          onClick={exitImpersonation}
          className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 transition-colors px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest shrink-0"
        >
          <LogOut className="w-3.5 h-3.5" />
          Salir
        </button>
      </div>
    );
  }

  if (!schoolAccessGrants || schoolAccessGrants.length === 0) return null;

  const homeId = realProfile?.tenant_id;
  const homeName = realProfile?.tenant?.name || 'Mi colegio';
  const options = [
    { id: homeId, name: homeName },
    ...schoolAccessGrants.map((g: any) => ({ id: g.tenant_id, name: g.tenant_name })),
  ];

  return (
    <div className="sticky top-0 z-[500] bg-indigo-600 text-white px-4 py-2.5 flex items-center justify-between gap-3 shadow-md">
      <div className="flex items-center gap-2 text-xs sm:text-sm font-bold shrink-0">
        <Building2 className="w-4 h-4 shrink-0" />
        <span className="hidden sm:inline">Colegio:</span>
      </div>
      <select
        value={activeGrantTenantId || homeId || ''}
        onChange={(e) => switchStaffSchool(e.target.value)}
        className="bg-white/20 text-white text-xs font-black rounded-lg px-3 py-1.5 border-none outline-none max-w-[65%]"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id} className="text-slate-900">
            {o.name}
          </option>
        ))}
      </select>
    </div>
  );
}
