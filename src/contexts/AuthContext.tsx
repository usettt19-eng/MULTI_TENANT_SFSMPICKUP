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
  profile: Profile | null; // Active profile
  profiles: Profile[]; // All profiles for this user
  loading: boolean;
  signOut: () => Promise<void>;
  switchProfile: (tenantId: string) => void;
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
  profiles: [],
  loading: true,
  signOut: async () => {},
  switchProfile: () => {},
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

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session }, error: sessionError }) => {
      if (sessionError) setError(sessionError.message);
      setSession(session);
      setUser(session?.user ?? null);
      setAuthRedirectType((prev) => prev ?? passwordSetupTypeFor('INITIAL_SESSION', session));
      if (session?.user) {
        fetchProfiles(session.user.id);
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
      }
      const redirectType = passwordSetupTypeFor(_event, session);
      if (redirectType) setAuthRedirectType(redirectType);
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfiles(session.user.id);
      } else {
        setProfile(null);
        setProfiles([]);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

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

  const switchProfile = (tenantId: string) => {
    const newProfile = profiles.find(p => p.tenant_id === tenantId);
    if (newProfile && user) {
      setProfile(newProfile);
      localStorage.setItem(`active_tenant_${user.id}`, tenantId);
    }
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
    <AuthContext.Provider value={{ session, user, profile, profiles, loading, signOut, switchProfile, error, authRedirectType, clearAuthRedirectType } as any}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
