import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Profile } from '../types/database';

// Supabase's PKCE flow (the current default) doesn't carry `type=invite` in
// the URL the app receives, so we can't tell an invite apart from a normal
// sign-in by parsing the redirect. Instead: password-reset links reliably
// fire the PASSWORD_RECOVERY auth event, and invites are marked with a
// `needs_password_setup` flag in user_metadata at invite time (see
// server/src/index.ts) that we clear once the user sets a password or skips.
function passwordSetupTypeFor(event: string, session: Session | null): 'invite' | 'recovery' | null {
  if (event === 'PASSWORD_RECOVERY') return 'recovery';
  if (session?.user?.user_metadata?.needs_password_setup === true) return 'invite';
  return null;
}

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: Profile | null; // Active profile — si el super admin está "entrado" a un colegio, este ya viene disfrazado de admin de ese tenant.
  realProfile: Profile | null; // El perfil real de quien inició sesión, sin disfrazar — para el banner y para saber a quién volver al salir.
  profiles: Profile[]; // All profiles for this user
  loading: boolean;
  signOut: () => Promise<void>;
  switchProfile: (tenantId: string) => void;
  isImpersonating: boolean;
  enterTenantAsAdmin: (tenantId: string) => Promise<void>;
  exitImpersonation: () => void;
  // Colegios extra a los que este staff tiene acceso concedido (además del
  // suyo propio), y el mecanismo para "estar" en uno de ellos.
  schoolAccessGrants: {tenant_id: string; tenant_name: string; role: 'admin' | 'staff'; permissions: string[]}[];
  activeGrantTenantId: string | null;
  switchStaffSchool: (tenantId: string | null) => void;
  error: string | null;
  // 'invite' | 'recovery' | null — set when the session came from an invite
  // or password-reset link, so the app can prompt for a password before
  // showing the normal dashboard.
  authRedirectType: string | null;
  clearAuthRedirectType: () => void;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  profile: null,
  realProfile: null,
  profiles: [],
  loading: true,
  signOut: async () => {},
  switchProfile: () => {},
  isImpersonating: false,
  enterTenantAsAdmin: async () => {},
  exitImpersonation: () => {},
  schoolAccessGrants: [],
  activeGrantTenantId: null,
  switchStaffSchool: () => {},
  error: null,
  authRedirectType: null,
  clearAuthRedirectType: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authRedirectType, setAuthRedirectType] = useState<string | null>(null);

  // Colegios ADEMÁS del propio a los que este staff tiene acceso concedido
  // (ver tabla staff_school_access) — típico de personal que trabaja en más
  // de un colegio de la misma organización.
  const [schoolAccessGrants, setSchoolAccessGrants] = useState<
    {tenant_id: string; tenant_name: string; role: 'admin' | 'staff'; permissions: string[]}[]
  >([]);
  const [activeGrantTenantId, setActiveGrantTenantId] = useState<string | null>(null);

  // "Entrar como Admin": el super admin puede meterse a las pantallas
  // normales de administración de un colegio puntual (para hacer la
  // implementación inicial, por ejemplo) sin dejar de ser super admin. No
  // cambia nada en la base de datos — solo disfraza el `profile` que ve el
  // resto de la app mientras dura, usando sessionStorage (por pestaña, no
  // sobrevive a cerrar el navegador) para que un refresh no lo saque.
  const [impersonatedTenant, setImpersonatedTenant] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session }, error: sessionError }) => {
      if (sessionError) setError(sessionError.message);
      setSession(session);
      setUser(session?.user ?? null);
      setAuthRedirectType((prev) => prev ?? passwordSetupTypeFor('INITIAL_SESSION', session));
      if (session?.user) {
        fetchProfiles(session.user.id);
        fetchSchoolAccessGrants(session.user.id);
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (_event === 'SIGNED_OUT') {
        setError(null);
        setProfiles([]);
        setProfile(null);
        setAuthRedirectType(null);
        setSchoolAccessGrants([]);
        setActiveGrantTenantId(null);
      }
      const redirectType = passwordSetupTypeFor(_event, session);
      if (redirectType) setAuthRedirectType(redirectType);
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfiles(session.user.id);
        fetchSchoolAccessGrants(session.user.id);
      } else {
        setProfile(null);
        setProfiles([]);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Restaura el colegio "impersonado" al recargar la página — solo tiene
  // efecto si quien inició sesión de verdad es super admin, para que un
  // valor viejo en sessionStorage no le dé a nadie más una identidad falsa.
  useEffect(() => {
    if (!user || profile?.role !== 'super_admin') return;
    const saved = sessionStorage.getItem(`impersonated_tenant_${user.id}`);
    if (!saved) return;
    try {
      setImpersonatedTenant(JSON.parse(saved));
    } catch {
      sessionStorage.removeItem(`impersonated_tenant_${user.id}`);
    }
  }, [user, profile?.role]);

  const enterTenantAsAdmin = async (tenantId: string) => {
    if (!user || profile?.role !== 'super_admin') return;
    const { data, error: tenantError } = await supabase
      .from('tenants')
      .select('id, name')
      .eq('id', tenantId)
      .single();
    if (tenantError || !data) {
      console.error('Error al entrar al colegio como admin:', tenantError);
      return;
    }
    setImpersonatedTenant(data);
    sessionStorage.setItem(`impersonated_tenant_${user.id}`, JSON.stringify(data));
  };

  const exitImpersonation = () => {
    if (user) sessionStorage.removeItem(`impersonated_tenant_${user.id}`);
    setImpersonatedTenant(null);
  };

  // El resto de la app (pantallas de admin, endpoints del backend que
  // reciben el tenant en el body) lee `profile.tenant_id`/`profile.role` sin
  // saber nada de impersonación — por eso alcanza con "disfrazar" aquí el
  // perfil expuesto. RLS y el backend ya tratan a super_admin como
  // autorizado en cualquier colegio (ver is_staff_of()/isStaffOf()), así que
  // esto es puramente cosmético del lado del cliente, no un permiso nuevo.
  // Igual que la impersonación de super_admin: "disfraza" el perfil activo
  // con el colegio concedido, sin tocar la fila real de `profiles`. RLS ya
  // reconoce el acceso concedido (is_staff_of() consulta staff_school_access),
  // así que esto solo hace que el resto de la app (que lee profile.tenant_id
  // a ciegas) opere sobre el colegio correcto.
  const activeGrant = activeGrantTenantId
    ? schoolAccessGrants.find((g) => g.tenant_id === activeGrantTenantId)
    : null;

  const effectiveProfile: Profile | null =
    profile?.role === 'super_admin' && impersonatedTenant
      ? ({ ...profile, tenant_id: impersonatedTenant.id, tenant: impersonatedTenant as any, role: 'admin' } as Profile)
      : activeGrant
      ? ({
          ...profile,
          tenant_id: activeGrant.tenant_id,
          tenant: { id: activeGrant.tenant_id, name: activeGrant.tenant_name } as any,
          role: 'admin',
          additional_tutor_name: JSON.stringify({ is_staff: true, permissions: activeGrant.permissions }),
        } as any as Profile)
      : profile;

  async function fetchProfiles(userId: string) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*, tenant:tenants(*)')
        .eq('id', userId);

      if (error) {
        console.error('Error fetching profiles:', error);
        setError(`fetchProfiles error: ${error.message} (code: ${error.code})`);
      } else if (data) {
        setError(null);
        setProfiles(data as Profile[]);

        // Try to restore previous active profile/tenant from localStorage
        const savedTenantId = localStorage.getItem(`active_tenant_${userId}`);
        const active = data.find((p: any) => p.tenant_id === savedTenantId) || data[0];
        setProfile(active as Profile);
      }
    } catch (err: any) {
      setError(`fetchProfiles exception: ${err?.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function fetchSchoolAccessGrants(userId: string) {
    const { data, error } = await supabase
      .from('staff_school_access')
      .select('tenant_id, role, permissions, tenant:tenants(name)')
      .eq('staff_id', userId);

    if (error) {
      console.error('Error fetching staff_school_access:', error);
      return;
    }

    const grants = (data ?? []).map((row: any) => ({
      tenant_id: row.tenant_id,
      tenant_name: row.tenant?.name ?? 'Colegio',
      role: row.role,
      permissions: Array.isArray(row.permissions) ? row.permissions : [],
    }));
    setSchoolAccessGrants(grants);

    const saved = localStorage.getItem(`granted_school_${userId}`);
    if (saved && grants.some((g) => g.tenant_id === saved)) {
      setActiveGrantTenantId(saved);
    }
  }

  const switchProfile = (tenantId: string) => {
    const newProfile = profiles.find(p => p.tenant_id === tenantId);
    if (newProfile && user) {
      setProfile(newProfile);
      localStorage.setItem(`active_tenant_${user.id}`, tenantId);
    }
  };

  // Para el staff con acceso concedido a un segundo colegio: pasar `null` (o
  // el tenant_id de su colegio de casa) vuelve a su perfil real.
  const switchStaffSchool = (tenantId: string | null) => {
    if (!user) return;
    if (!tenantId || tenantId === profile?.tenant_id) {
      setActiveGrantTenantId(null);
      localStorage.removeItem(`granted_school_${user.id}`);
      return;
    }
    const grant = schoolAccessGrants.find((g) => g.tenant_id === tenantId);
    if (!grant) return;
    setActiveGrantTenantId(tenantId);
    localStorage.setItem(`granted_school_${user.id}`, tenantId);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const clearAuthRedirectType = () => {
    if (authRedirectType === 'invite') {
      // Persist the dismissal so this doesn't prompt again on the next login.
      supabase.auth.updateUser({ data: { needs_password_setup: false } }).catch(() => {});
    }
    setAuthRedirectType(null);
    window.history.replaceState(null, '', window.location.pathname);
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        profile: effectiveProfile,
        realProfile: profile,
        profiles,
        loading,
        signOut,
        switchProfile,
        isImpersonating: !!impersonatedTenant,
        enterTenantAsAdmin,
        exitImpersonation,
        schoolAccessGrants,
        activeGrantTenantId,
        switchStaffSchool,
        error,
        authRedirectType,
        clearAuthRedirectType,
      } as any}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
