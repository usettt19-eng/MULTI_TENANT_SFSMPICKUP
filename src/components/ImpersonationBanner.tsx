import React from 'react';
import { ShieldAlert, LogOut } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

/**
 * Franja fija que solo aparece cuando un super admin "entró" a un colegio
 * puntual (ver AuthContext.enterTenantAsAdmin) — para que nunca se le
 * olvide que está configurando en nombre de otro colegio y no el suyo.
 */
export function ImpersonationBanner() {
  const { isImpersonating, profile, exitImpersonation } = useAuth() as any;

  if (!isImpersonating) return null;

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
