import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase, authRedirectType as initialAuthRedirectType } from '../lib/supabase';
import type { Profile } from '../types/database';

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
  const [authRedirectType, setAuthRedirectType] = useState<string | null>(initialAuthRedirectType);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session }, error: sessionError }) => {
      if (sessionError) setError(sessionError.message);
      setSession(session);
      setUser(session?.user ?? null);
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
      }
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
