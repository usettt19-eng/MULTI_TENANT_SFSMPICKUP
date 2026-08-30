import React from 'react';
import { 
  LayoutDashboard, 
  ShieldCheck, 
  Heart, 
  MapPin, 
  FileEdit, 
  Gavel, 
  Lock, 
  Unlock,
  Settings, 
  Shield,
  LogOut,
  Monitor,
  Users,
  History,
  UserCog,
  MessageSquare,
  BarChart3,
  Footprints
} from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

interface SidebarProps {
  currentView: string;
  setCurrentView: (view: string) => void;
  isOpen: boolean;
  onClose: () => void;
}

export function Sidebar({ currentView, setCurrentView, isOpen, onClose }: SidebarProps) {
  const { t } = useLanguage();
  const { profile, signOut } = useAuth();
  const [lockdownActive, setLockdownActive] = React.useState(false);
  const lockdownActiveRef = React.useRef(false);
  const [settingsId, setSettingsId] = React.useState<string | null>(null);
  const [schoolInfo, setSchoolInfo] = React.useState<{ name: string, logo: string | null }>({ name: 'THE GUARDIAN', logo: null });
  const channelRef = React.useRef<any>(null);

  React.useEffect(() => {
    lockdownActiveRef.current = lockdownActive;
  }, [lockdownActive]);

  React.useEffect(() => {
    const fetchInitialState = async () => {
      if (!profile?.tenant_id) return;
      const { data } = await supabase
        .from('school_settings')
        .select('id, school_name, logo_url')
        .eq('tenant_id', profile.tenant_id)
        .maybeSingle();
      if (data) {
        setSettingsId(data.id);
        if (data.school_name) {
          setSchoolInfo({ name: data.school_name, logo: data.logo_url });
        }
      }
    };

    fetchInitialState();

    channelRef.current = supabase.channel('system_state')
      .on('broadcast', { event: 'lockdown' }, (payload) => {
        console.log('Sidebar received lockdown broadcast:', payload);
        setLockdownActive(payload.payload.active);
      })
      .on('broadcast', { event: 'request_lockdown_status' }, () => {
        console.log('Sidebar received status request, responding with:', lockdownActiveRef.current);
        if (channelRef.current) {
          channelRef.current.send({
            type: 'broadcast',
            event: 'lockdown',
            payload: { active: lockdownActiveRef.current }
          });
        }
      })
      .subscribe((status) => {
        console.log('Sidebar channel status:', status);
      });

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [profile?.tenant_id]);

  const handleLockdownToggle = async () => {
    const newState = !lockdownActive;
    console.log('Toggling lockdown to:', newState);
    
    if (settingsId) {
      try {
        const { error } = await supabase.from('school_settings').update({ lockdown_mode: newState }).eq('id', settingsId);
        if (error) console.error("DB update error:", error);
      } catch (e) {
        console.error("DB update failed:", e);
      }
    }

    if (channelRef.current) {
      console.log('Sending broadcast...');
      channelRef.current.send({
        type: 'broadcast',
        event: 'lockdown',
        payload: { active: newState }
      });
    }

    setLockdownActive(newState);
    
    // Log the event
    await supabase.from('audit_logs').insert({
      event_type: 'SECURITY',
      description: newState ? 'BLOQUEO DE EMERGENCIA ACTIVADO' : 'BLOQUEO DE EMERGENCIA LEVANTADO',
      actor_name: profile?.first_name || 'Admin',
      metadata: { action: newState ? 'lockdown' : 'unlock' },
      tenant_id: profile?.tenant_id
    });
  };

  // Orden agrupado por uso, no alfabético ni por fecha de creación del
  // módulo (2026-08-30): 1) operación del día — el recorrido real de un
  // alumno saliendo, de lo que más se consulta a lo que menos; 2) rosters
  // (datos maestros que casi no cambian en el día); 3) comunicación con
  // padres; 4) back-office, lo que el personal de puerta rara vez abre.
  const allNavItems = [
    // 1. Operación del día
    { id: 'dashboard', label: t('nav.dashboard'), icon: LayoutDashboard },
    { id: 'checkin', label: t('nav.checkin'), icon: MapPin },
    { id: 'security', label: t('nav.security'), icon: ShieldCheck },
    { id: 'external', label: t('nav.external'), icon: Monitor },
    { id: 'transit', label: t('nav.transit'), icon: Footprints },
    { id: 'wellness', label: t('nav.wellness'), icon: Heart },
    { id: 'visitors', label: t('nav.visitors'), icon: Users },
    // 2. Rosters
    { id: 'students', label: t('nav.students'), icon: Users },
    { id: 'guardians', label: t('nav.guardians'), icon: ShieldCheck },
    // 3. Comunicación
    { id: 'forms', label: t('nav.forms'), icon: FileEdit },
    { id: 'requests', label: t('nav.requests'), icon: MessageSquare },
    // 4. Back-office — 'staff' y 'statistics' ya no son adminOnly: quedan a
    // discreción del administrador, que decide desde Gestión de Personal si
    // otorgárselos a cada miembro del staff, igual que cualquier otro
    // módulo.
    { id: 'logs', label: t('nav.logs'), icon: History },
    { id: 'compliance', label: t('nav.compliance'), icon: Gavel },
    { id: 'staff', label: t('nav.staff'), icon: UserCog },
    { id: 'statistics', label: t('nav.statistics'), icon: BarChart3 },
  ];

  let isStaff = false;
  let permissions: string[] = [];
  
  if (profile?.role === 'admin') {
    try {
      const parsed = JSON.parse(profile.additional_tutor_name || '{}');
      if (parsed.is_staff === true) {
        isStaff = true;
        permissions = parsed.permissions || [];
      }
    } catch (e) {}
  }

  const navItems = allNavItems.filter(item => {
    if (profile?.role === 'admin' && !isStaff) return true;
    if (isStaff) return permissions.includes(item.id);
    return true; // Fallback
  });

  // El botón de Ajustes vive fuera de allNavItems (es parte del pie del
  // sidebar, no de la lista con ícono), pero sigue el mismo criterio: el
  // administrador real siempre lo ve, y un miembro del staff solo si tiene
  // el permiso 'settings' otorgado — igual que cualquier otro módulo.
  const canSeeSettingsButton = profile?.role === 'admin' && (!isStaff || permissions.includes('settings'));

  return (
    <>
      {/* Mobile Overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-[60] md:hidden backdrop-blur-sm transition-opacity"
          onClick={onClose}
        />
      )}

      <aside className={`flex flex-col h-screen w-64 fixed left-0 top-0 bg-slate-100 p-4 z-[70] shadow-xl transition-transform duration-300 ease-in-out md:translate-x-0 ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className="mb-8 px-2">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center text-white overflow-hidden">
            {schoolInfo.logo ? (
              <img src={schoolInfo.logo} alt="Logo" className="w-full h-full object-cover" />
            ) : (
              <Shield className="w-6 h-6" fill="currentColor" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-black text-cyan-900 uppercase tracking-widest font-headline truncate" title={schoolInfo.name}>{schoolInfo.name}</h2>
            <p className="text-[10px] font-medium text-slate-500 uppercase tracking-tighter truncate">
              {profile?.role === 'admin' && !isStaff ? t('sidebar.adminSession') : isStaff ? t('sidebar.staffSession') : t('sidebar.parentSession')}
            </p>
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => {
                setCurrentView(item.id);
                onClose();
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all duration-200 hover:translate-x-1 ${
                isActive 
                  ? 'bg-cyan-900/10 text-cyan-900 font-bold' 
                  : 'text-slate-600 hover:bg-slate-200/50'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="mt-auto pt-6 border-t border-slate-200 space-y-1">
        <button 
          onClick={handleLockdownToggle}
          className={`w-full mb-4 py-3 ${lockdownActive ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-error hover:bg-red-700'} text-white font-bold rounded-xl flex items-center justify-center gap-2 active:scale-95 transition-all shadow-lg`}
        >
          {lockdownActive ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
          {lockdownActive ? t('sidebar.lockdownActive') : t('sidebar.lockdownInactive')}
        </button>
        {canSeeSettingsButton && (
          <button
            onClick={() => {
              setCurrentView('settings');
              onClose();
            }}
            className={`w-full flex items-center gap-3 px-4 py-2 text-sm font-medium rounded-xl transition-all ${
              currentView === 'settings' 
                ? 'bg-cyan-900/10 text-cyan-900 font-bold' 
                : 'text-slate-600 hover:bg-slate-200/50'
            }`}
          >
            <Settings className="w-5 h-5" />
            <span>{t('topnav.settings')}</span>
          </button>
        )}
        <button 
          onClick={signOut}
          className="w-full flex items-center gap-3 px-4 py-2 text-red-600 text-sm font-medium hover:bg-red-50 rounded-xl transition-colors"
        >
          <LogOut className="w-5 h-5" />
          <span>{t('sidebar.signOut')}</span>
        </button>
      </div>
    </aside>
    </>
  );
}
