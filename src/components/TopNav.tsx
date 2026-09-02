import React from 'react';
import { Search, LockOpen, Lock, Bell, UserCog, Globe, Settings, LogOut, RefreshCw, Shield, Menu, X, Trash2 } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { useLayout } from '../contexts/LayoutContext';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

interface TopNavProps {
  title: string;
  subtitle?: string;
  showTabs?: boolean;
  tabs?: string[];
  activeTab?: string;
}

export function TopNav({ title, subtitle, showTabs, tabs, activeTab }: TopNavProps) {
  const { language, setLanguage, t } = useLanguage();
  const { isMenuOpen, toggleMenu, setCurrentView } = useLayout();
  const [user, setUser] = React.useState<any>(null);
  const { profile, signOut } = useAuth() as any;
  const [showUserMenu, setShowUserMenu] = React.useState(false);

  // Estado del sistema (bloqueo de emergencia): mismo canal broadcast
  // 'system_state'/'lockdown' que ya usan Sidebar.tsx y VerificationDisplay.tsx
  // — acá es solo de LECTURA (indicador), el botón grande para activar/
  // desactivar el bloqueo sigue siendo exclusivamente el del Sidebar, para
  // no duplicar un control tan sensible en dos lugares distintos.
  const [lockdownActive, setLockdownActive] = React.useState(false);
  const [showLockdownInfo, setShowLockdownInfo] = React.useState(false);

  // Notificaciones reales del usuario logueado (mismo patrón que ya usa
  // ParentDashboard.tsx para los padres).
  const [notifications, setNotifications] = React.useState<any[]>([]);
  const [showNotifications, setShowNotifications] = React.useState(false);
  const unreadCount = notifications.filter(n => !n.is_read).length;

  React.useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
  }, []);

  React.useEffect(() => {
    if (!profile?.tenant_id) return;

    supabase
      .from('school_settings')
      .select('lockdown_mode')
      .eq('tenant_id', profile.tenant_id)
      .maybeSingle()
      .then(({ data }) => setLockdownActive(!!data?.lockdown_mode));

    const channel = supabase
      .channel('system_state')
      .on('broadcast', { event: 'lockdown' }, (payload) => {
        setLockdownActive(!!payload.payload.active);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile?.tenant_id]);

  const fetchNotifications = React.useCallback(async () => {
    if (!profile?.id || !profile?.tenant_id) return;
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', profile.id)
      .eq('tenant_id', profile.tenant_id)
      .order('created_at', { ascending: false })
      .limit(30);
    if (data) setNotifications(data);
  }, [profile?.id, profile?.tenant_id]);

  React.useEffect(() => {
    if (!profile?.id) return;
    fetchNotifications();

    // notifications no está en la publicación de Realtime de Supabase — el
    // canal que había acá nunca recibía nada, así que la campanita nunca se
    // actualizaba sola después de la carga inicial. Poll cada 20s en su lugar.
    const pollInterval = window.setInterval(fetchNotifications, 20000);

    return () => {
      clearInterval(pollInterval);
    };
  }, [profile?.id, fetchNotifications]);

  const markAsRead = async (id: string) => {
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
    setNotifications(prev => prev.map(n => (n.id === id ? { ...n, is_read: true } : n)));
  };

  const markAllAsRead = async () => {
    const unreadIds = notifications.filter(n => !n.is_read).map(n => n.id);
    if (unreadIds.length === 0) return;
    await supabase.from('notifications').update({ is_read: true }).in('id', unreadIds);
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
  };

  const deleteNotification = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const { error } = await supabase.from('notifications').delete().eq('id', id);
    if (!error) setNotifications(prev => prev.filter(n => n.id !== id));
  };

  return (
    <header className="bg-slate-50 sticky top-0 z-40 flex justify-between items-center w-full px-4 sm:px-6 py-3 bg-gradient-to-b from-slate-100 to-transparent">
      <div className="flex items-center gap-2 sm:gap-4">
        <button
          onClick={toggleMenu}
          className="p-2 -ml-2 mr-1 rounded-xl hover:bg-slate-200/50 transition-colors md:hidden text-cyan-900 shadow-sm border border-slate-200/50 bg-white"
        >
          {isMenuOpen ? <X className="w-5 h-5 sm:w-6 sm:h-6" /> : <Menu className="w-5 h-5 sm:w-6 sm:h-6" />}
        </button>
        <div className="flex items-center gap-2">
          {/* Fallback shield icon if logo.png is missing, but prioritizing the img */}
          <div className="w-6 h-6 sm:w-8 sm:h-8 relative flex items-center justify-center">
            <Shield className="w-8 h-8 text-cyan-600 absolute opacity-20" />
            <img
              src="/logo.png"
              alt="Safe Smart Pickup Logo"
              className="w-full h-full object-contain relative z-10"
              onError={(e) => {
                // If logo.png fails to load, hide the broken img icon so fallback shield is visible
                (e.target as HTMLImageElement).style.opacity = '0';
              }}
            />
          </div>
          <span className="text-lg sm:text-xl font-bold text-cyan-950 font-headline tracking-tight">
            Safe Smart<span className="text-cyan-600">PickUP</span>
          </span>
        </div>

        {subtitle && (
          <div className="hidden sm:flex items-center">
            <div className="h-6 w-[1px] bg-slate-300 mx-2"></div>
            <h1 className="text-slate-500 font-medium text-xs sm:text-sm truncate max-w-[100px] md:max-w-none">{subtitle}</h1>
          </div>
        )}

        {showTabs && tabs && (
          <div className="hidden lg:flex gap-6 ml-8">
            {tabs.map((tab) => (
              <span
                key={tab}
                className={`cursor-pointer px-2 py-1 rounded transition-colors ${
                  activeTab === tab
                    ? 'text-cyan-700 font-semibold border-b-2 border-cyan-700 pb-1'
                    : 'text-slate-500 hover:bg-slate-200/50'
                }`}
              >
                {tab}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 sm:gap-6">
        <div className="hidden lg:flex items-center bg-surface-container rounded-full px-4 py-1.5 gap-2 border border-outline-variant/20">
          <Search className="w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder={t('topnav.search')}
            className="bg-transparent border-none text-sm focus:ring-0 w-48 xl:w-64 text-on-surface outline-none"
          />
        </div>

        <div className="flex items-center gap-1 sm:gap-3">
          <div className="relative group">
            <button className="p-1.5 sm:p-2 rounded-full hover:bg-slate-200/50 transition-colors text-cyan-900 flex items-center gap-1">
              <Globe className="w-4 h-4 sm:w-5 sm:h-5" />
              <span className="text-[10px] sm:text-xs font-bold uppercase">{language}</span>
            </button>
            <div className="absolute right-0 mt-2 w-32 bg-white rounded-xl shadow-lg border border-slate-100 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
              <button
                onClick={() => setLanguage('en')}
                className={`w-full text-left px-4 py-2 text-sm hover:bg-slate-50 first:rounded-t-xl ${language === 'en' ? 'font-bold text-primary' : 'text-slate-600'}`}
              >
                English
              </button>
              <button
                onClick={() => setLanguage('es')}
                className={`w-full text-left px-4 py-2 text-sm hover:bg-slate-50 last:rounded-b-xl ${language === 'es' ? 'font-bold text-primary' : 'text-slate-600'}`}
              >
                Español
              </button>
            </div>
          </div>

          <button
            onClick={() => window.location.reload()}
            title="Refrescar Pantalla"
            className="p-1.5 sm:p-2 rounded-full hover:bg-slate-200/50 transition-colors text-cyan-900 flex items-center gap-1"
          >
            <RefreshCw className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className="text-[10px] font-black uppercase hidden lg:inline">Refrescar</span>
          </button>

          <div className="relative hidden sm:block">
            <button
              onClick={() => setShowLockdownInfo(prev => !prev)}
              title="Estado del Sistema"
              className={`p-2 rounded-full transition-colors ${lockdownActive ? 'text-error hover:bg-error/10' : 'text-cyan-900 hover:bg-slate-200/50'}`}
            >
              {lockdownActive ? <Lock className="w-5 h-5" /> : <LockOpen className="w-5 h-5" />}
            </button>
            {showLockdownInfo && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowLockdownInfo(false)} />
                <div className="absolute right-0 mt-2 w-64 bg-white rounded-xl shadow-lg border border-slate-100 z-50 p-4">
                  <div className={`flex items-center gap-2 mb-1 font-black text-xs uppercase tracking-widest ${lockdownActive ? 'text-error' : 'text-emerald-600'}`}>
                    {lockdownActive ? <Lock className="w-4 h-4" /> : <LockOpen className="w-4 h-4" />}
                    {lockdownActive ? 'Bloqueo de Emergencia Activo' : 'Sistema Operativo Normal'}
                  </div>
                  <p className="text-[11px] text-slate-500 font-medium leading-relaxed">
                    {lockdownActive
                      ? 'Las salidas están restringidas. El bloqueo se activa/desactiva desde el menú lateral.'
                      : 'No hay ningún bloqueo de emergencia activo en este colegio.'}
                  </p>
                </div>
              </>
            )}
          </div>

          <div className="relative">
            <button
              onClick={() => setShowNotifications(prev => !prev)}
              title="Notificaciones"
              className="p-1.5 sm:p-2 rounded-full hover:bg-slate-200/50 transition-colors text-cyan-900 relative"
            >
              <Bell className="w-4 h-4 sm:w-5 sm:h-5" />
              {unreadCount > 0 && (
                <span className="absolute top-0.5 sm:top-1 right-0.5 sm:right-1 min-w-[14px] h-3.5 px-0.5 bg-error rounded-full border-2 border-white text-white text-[8px] font-black flex items-center justify-center leading-none">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
            {showNotifications && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowNotifications(false)} />
                <div className="absolute right-0 mt-2 w-80 max-w-[90vw] bg-white rounded-2xl shadow-2xl border border-slate-100 z-50 overflow-hidden">
                  <div className="p-4 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
                    <h3 className="text-xs font-black text-slate-800 uppercase tracking-widest">Notificaciones</h3>
                    {unreadCount > 0 && (
                      <button
                        onClick={markAllAsRead}
                        className="text-[10px] font-black text-primary uppercase hover:text-primary-container transition-colors"
                      >
                        Marcar todas leídas
                      </button>
                    )}
                  </div>
                  <div className="max-h-[60vh] overflow-y-auto p-3 space-y-2">
                    {notifications.length === 0 ? (
                      <div className="py-10 text-center">
                        <Bell className="w-8 h-8 text-slate-100 mx-auto mb-2" />
                        <p className="text-slate-300 font-bold italic text-xs">Sin notificaciones</p>
                      </div>
                    ) : (
                      notifications.map(n => (
                        <div
                          key={n.id}
                          onClick={() => markAsRead(n.id)}
                          className={`p-3 rounded-xl border transition-all cursor-pointer group relative ${n.is_read ? 'bg-white border-slate-100 opacity-60' : 'bg-indigo-50 border-indigo-100 shadow-sm'}`}
                        >
                          <div className="flex justify-between items-start mb-1 pr-6">
                            <h4 className="text-xs font-black text-slate-800">{n.title}</h4>
                            {!n.is_read && <span className="w-2 h-2 bg-error rounded-full shrink-0 mt-1" />}
                          </div>
                          <p className="text-[11px] text-slate-500 font-medium leading-relaxed">{n.message}</p>
                          <span className="text-[8px] font-black text-slate-300 uppercase mt-1.5 block">{new Date(n.created_at).toLocaleString()}</span>
                          <button
                            onClick={(e) => deleteNotification(e, n.id)}
                            className="absolute top-3 right-3 p-1 text-slate-300 hover:text-error transition-colors opacity-0 group-hover:opacity-100"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          {profile?.role === 'admin' && (
            <button
              onClick={() => setCurrentView('settings')}
              title="Configuración"
              className="hidden sm:block p-2 rounded-full hover:bg-slate-200/50 transition-colors text-cyan-900"
            >
              <Settings className="w-5 h-5" />
            </button>
          )}

          <div className="relative ml-2">
            <button
              onClick={() => setShowUserMenu(prev => !prev)}
              className="w-8 h-8 rounded-full overflow-hidden border-2 border-primary-fixed shadow-sm cursor-pointer block"
            >
              <img
                src={user?.user_metadata?.avatar_url || "https://ui-avatars.com/api/?name=" + (user?.email || "User")}
                alt="Profile"
                className="w-full h-full object-cover"
              />
            </button>
            {showUserMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-lg border border-slate-100 z-50 p-2">
                  <div className="px-4 py-2 text-xs font-bold text-slate-500 uppercase truncate">
                    {user?.email}
                  </div>
                  <button
                    onClick={() => {
                      setShowUserMenu(false);
                      if (typeof signOut === 'function') {
                        signOut();
                      } else {
                        supabase.auth.signOut();
                      }
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 rounded-lg flex items-center gap-2"
                  >
                    <LogOut className="w-4 h-4" /> Cerrar Sesión
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
