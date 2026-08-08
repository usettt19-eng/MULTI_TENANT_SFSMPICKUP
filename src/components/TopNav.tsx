import React from 'react';
import { Search, LockOpen, Bell, UserCog, Globe, Settings, LogOut, RefreshCw, Shield, Menu, X } from 'lucide-react';
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
  const { isMenuOpen, toggleMenu } = useLayout();
  const [user, setUser] = React.useState<any>(null);
  const { profile } = useAuth();

  React.useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
  }, []);

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
          <button title="Estado del Sistema" className="hidden sm:block p-2 rounded-full hover:bg-slate-200/50 transition-colors text-cyan-900">
            <LockOpen className="w-5 h-5" />
          </button>
          <button title="Notificaciones" className="p-1.5 sm:p-2 rounded-full hover:bg-slate-200/50 transition-colors text-cyan-900 relative">
            <Bell className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className="absolute top-1 sm:top-1.5 right-1 sm:right-1.5 w-2 h-2 bg-error rounded-full border-2 border-white"></span>
          </button>
          {profile?.role === 'admin' && (
            <button title="Configuración" className="hidden sm:block p-2 rounded-full hover:bg-slate-200/50 transition-colors text-cyan-900">
              <Settings className="w-5 h-5" />
            </button>
          )}
          
          <div className="relative group ml-2">
            <div className="w-8 h-8 rounded-full overflow-hidden border-2 border-primary-fixed shadow-sm cursor-pointer">
              <img 
                src={user?.user_metadata?.avatar_url || "https://ui-avatars.com/api/?name=" + (user?.email || "User")}
                alt="Profile" 
                className="w-full h-full object-cover"
              />
            </div>
            <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-lg border border-slate-100 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 p-2">
              <div className="px-4 py-2 text-xs font-bold text-slate-500 uppercase">
                {user?.email}
              </div>
              <button 
                onClick={() => supabase.auth.signOut()}
                className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 rounded-lg flex items-center gap-2"
              >
                <LogOut className="w-4 h-4" /> Cerrar Sesión
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
