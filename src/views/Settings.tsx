import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { TopNav } from '../components/TopNav';
import {
  Settings as SettingsIcon, MapPin, Building, Shield,
  Map as MapIcon, Save, Navigation, RefreshCcw,
  Loader2, CheckCircle2, Globe, Ruler, DoorOpen, CalendarClock, Users, BellRing
} from 'lucide-react';
import { SchoolStructureSettings } from '../components/settings/SchoolStructureSettings';
import { DismissalScheduleSettings } from '../components/settings/DismissalScheduleSettings';
import { GeofenceMap } from '../components/settings/GeofenceMap';
import { useLanguage } from '../contexts/LanguageContext';

export function Settings() {
  const { t } = useLanguage();
  const { profile } = useAuth() as any;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'general' | 'structure' | 'dismissal'>('general');
  const [settings, setSettings] = useState({
    id: '',
    school_name: 'SmartPickup Academy',
    address: 'Av. Principal 123',
    latitude: 8.9833,
    longitude: -79.5167,
    pickup_radius_meters: 65,
    logo_url: '',
    primary_dismissal_mode: 'teacher' as 'teacher' | 'staff',
    emergency_lockdown_enabled: true,
  });
  const [defaultLanguage, setDefaultLanguage] = useState<'es' | 'en'>('es');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  // Quién recibe la Alerta Discreta / Solicitud de Ayuda (server/src/index.ts
  // notifyTenantAdmins): TODO perfil con role='admin' de este colegio, sea
  // el administrador dueño de la cuenta o cualquier miembro del staff
  // ascendido a admin desde Gestión de Personal — sin filtrar por permisos
  // de módulo, así que aunque alguien no tenga el permiso "security"
  // igual le llega esta alerta si tiene rol de admin.
  const [alertRecipients, setAlertRecipients] = useState<{ id: string; name: string; isFounder: boolean }[]>([]);

  useEffect(() => {
    fetchSettings();
    fetchAlertRecipients();
  }, [profile?.tenant_id]);

  const fetchAlertRecipients = async () => {
    if (!profile?.tenant_id) return;
    const { data } = await supabase
      .from('profiles')
      .select('id, first_name, last_name, email, additional_tutor_name')
      .eq('tenant_id', profile.tenant_id)
      .eq('role', 'admin');
    const list = (data || []).map((p: any) => {
      let isStaff = false;
      try {
        isStaff = JSON.parse(p.additional_tutor_name || '{}').is_staff === true;
      } catch {}
      const name = [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email || 'Sin nombre';
      return { id: p.id, name, isFounder: !isStaff };
    }).sort((a, b) => Number(b.isFounder) - Number(a.isFounder) || a.name.localeCompare(b.name));
    setAlertRecipients(list);
  };

  const fetchSettings = async () => {
    if (!profile?.tenant_id) return;
    setLoading(true);
    const [{ data, error }, { data: tenantData }] = await Promise.all([
      supabase
        .from('school_settings')
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        // Un colegio recién creado (como en la implementación inicial vía
        // "Entrar como Admin") todavía no tiene fila en school_settings —
        // .single() lanzaría error en ese caso, así que se usa maybeSingle()
        // y se dejan los valores por defecto del estado inicial.
        .maybeSingle(),
      supabase.from('tenants').select('default_language').eq('id', profile.tenant_id).maybeSingle(),
    ]);

    if (data) {
      setSettings(data);
    }
    if (tenantData?.default_language === 'en' || tenantData?.default_language === 'es') {
      setDefaultLanguage(tenantData.default_language);
    }
    setLoading(false);
  };

  const handleLogoUpload = async (file: File): Promise<string | null> => {
    const fileExt = file.name.split('.').pop();
    const tenantFolder = profile?.tenant_id ? `${profile.tenant_id}/` : '';
    const fileName = `${tenantFolder}${settings.id || 'school'}_logo_${Date.now()}.${fileExt}`;
    
    const { error: uploadError } = await supabase.storage
      .from('logos')
      .upload(fileName, file, { upsert: true });

    if (uploadError) {
      alert(t('settings.logoUploadErrorPrefix') + uploadError.message);
      return null;
    }

    const { data } = supabase.storage.from('logos').getPublicUrl(fileName);
    return data.publicUrl;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    
    let currentSettings: any = { ...settings };
    
    if (!currentSettings.id || currentSettings.id === '') {
      delete currentSettings.id;
    }

    if (profile?.tenant_id && profile.tenant_id !== '') {
      currentSettings.tenant_id = profile.tenant_id;
    } else if (currentSettings.tenant_id === '') {
      delete currentSettings.tenant_id;
    }

    if (logoFile) {
      const newLogoUrl = await handleLogoUpload(logoFile);
      if (newLogoUrl) {
        currentSettings.logo_url = newLogoUrl;
      }
    }

    // Si se apaga el sistema, el botón que lo enciende/apaga desde el
    // sidebar desaparece — así que si por casualidad quedaba activo, hay
    // que liberarlo aquí mismo o el colegio se queda bloqueado sin forma de
    // levantarlo hasta que alguien vuelva a prender el interruptor.
    if (!currentSettings.emergency_lockdown_enabled) {
      currentSettings.lockdown_mode = false;
    }

    const [{ error }, { error: langError }] = await Promise.all([
      supabase.from('school_settings').upsert(currentSettings),
      profile?.tenant_id
        ? supabase.from('tenants').update({ default_language: defaultLanguage }).eq('id', profile.tenant_id)
        : Promise.resolve({ error: null }),
    ]);

    if (error || langError) alert(t('settings.saveErrorPrefix') + (error?.message || langError?.message));
    else {
      if (!currentSettings.emergency_lockdown_enabled) {
        const channel = supabase.channel('system_state');
        channel.subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            channel.send({ type: 'broadcast', event: 'lockdown', payload: { active: false } });
            setTimeout(() => supabase.removeChannel(channel), 500);
          }
        });
      }
      alert(t('settings.saveSuccess'));
      setLogoFile(null); // Clear the selected file
      fetchSettings();
    }
    setSaving(false);
  };

  return (
    <>
      <TopNav title="SmartPickup" subtitle={t('settings.topnavSubtitle')} />

      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6 sm:space-y-8 w-full font-body animate-in slide-in-from-bottom-5 duration-700">
        <header className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight flex items-center gap-3">
              {t('settings.title')} <SettingsIcon className="w-6 h-6 sm:w-8 sm:h-8 text-primary animate-[spin_4s_linear_infinite]" />
            </h1>
            <p className="text-sm text-slate-500 font-medium font-body mt-1">{t('settings.subtitle')}</p>
          </div>
          {activeTab === 'general' && (
            <button
              type="submit"
              form="settings-form"
              disabled={saving}
              className="flex items-center justify-center gap-2 bg-primary text-white px-8 py-4 rounded-[1.5rem] font-black text-xs hover:bg-primary-container transition-all shadow-xl shadow-primary/20 active:scale-95 disabled:opacity-50 w-full sm:w-auto"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {t('settings.saveChanges')}
            </button>
          )}
        </header>

        <div className="flex gap-2 border-b border-slate-200 pb-px overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
          <button
            onClick={() => setActiveTab('general')}
            className={`shrink-0 px-4 sm:px-6 py-2.5 sm:py-3 font-bold text-xs sm:text-sm rounded-t-2xl transition-colors whitespace-nowrap ${
              activeTab === 'general'
                ? 'bg-white text-primary border-t border-l border-r border-slate-200 -mb-px relative z-10'
                : 'text-slate-500 hover:bg-slate-100'
            }`}
          >
            {t('settings.tabGeneral')}
          </button>
          <button
            onClick={() => setActiveTab('structure')}
            className={`shrink-0 px-4 sm:px-6 py-2.5 sm:py-3 font-bold text-xs sm:text-sm rounded-t-2xl transition-colors flex items-center gap-2 whitespace-nowrap ${
              activeTab === 'structure'
                ? 'bg-white text-primary border-t border-l border-r border-slate-200 -mb-px relative z-10'
                : 'text-slate-500 hover:bg-slate-100'
            }`}
          >
            <DoorOpen className="w-4 h-4 shrink-0" />
            {t('settings.tabStructure')}
          </button>
          <button
            onClick={() => setActiveTab('dismissal')}
            className={`shrink-0 px-4 sm:px-6 py-2.5 sm:py-3 font-bold text-xs sm:text-sm rounded-t-2xl transition-colors flex items-center gap-2 whitespace-nowrap ${
              activeTab === 'dismissal'
                ? 'bg-white text-primary border-t border-l border-r border-slate-200 -mb-px relative z-10'
                : 'text-slate-500 hover:bg-slate-100'
            }`}
          >
            <CalendarClock className="w-4 h-4 shrink-0" />
            {t('settings.tabDismissal')}
          </button>
        </div>

        {loading ? (
          <div className="h-[50vh] flex flex-col items-center justify-center">
            <Loader2 className="w-12 h-12 text-primary animate-spin" />
            <p className="text-slate-400 font-bold mt-4 italic">{t('settings.loadingGeo')}</p>
          </div>
        ) : activeTab === 'general' ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            
            {/* LEFT: FORM DATA */}
            <div className="lg:col-span-7">
              <form id="settings-form" onSubmit={handleSave} className="space-y-6">
                
                {/* School Identity */}
                <section className="bg-white rounded-[2.5rem] p-8 border border-slate-100 shadow-sm space-y-6">
                  <h3 className="text-lg font-black text-slate-900 flex items-center gap-3 border-b border-slate-50 pb-4">
                    <Building className="w-5 h-5 text-primary" /> {t('settings.institutionalProfile')}
                  </h3>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">{t('settings.officialSchoolName')}</label>
                      <input
                        required
                        value={settings.school_name}
                        onChange={e => setSettings({...settings, school_name: e.target.value})}
                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-bold text-slate-700 outline-none focus:border-primary focus:bg-white transition-all shadow-inner"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">{t('settings.schoolLogo')}</label>
                      <div className="flex items-center gap-4">
                        {settings.logo_url && (
                          <img src={settings.logo_url} alt="Logo" className="w-16 h-16 rounded-xl object-cover" />
                        )}
                        <input 
                          key={logoFile ? 'has-file' : 'no-file'}
                          type="file"
                          accept="image/*"
                          onChange={e => setLogoFile(e.target.files?.[0] || null)}
                          className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-medium text-slate-600 outline-none focus:border-primary focus:bg-white transition-all"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">{t('settings.physicalAddress')}</label>
                      <input
                        required
                        value={settings.address}
                        onChange={e => setSettings({...settings, address: e.target.value})}
                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-medium text-slate-600 outline-none focus:border-primary focus:bg-white transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">{t('settings.parentAppLanguage')}</label>
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={() => setDefaultLanguage('es')}
                          className={`flex-1 py-3 rounded-2xl text-xs font-black uppercase tracking-widest transition-all ${
                            defaultLanguage === 'es'
                              ? 'bg-primary text-white shadow-lg'
                              : 'bg-slate-50 text-slate-400 border border-slate-200'
                          }`}
                        >
                          Español
                        </button>
                        <button
                          type="button"
                          onClick={() => setDefaultLanguage('en')}
                          className={`flex-1 py-3 rounded-2xl text-xs font-black uppercase tracking-widest transition-all ${
                            defaultLanguage === 'en'
                              ? 'bg-primary text-white shadow-lg'
                              : 'bg-slate-50 text-slate-400 border border-slate-200'
                          }`}
                        >
                          English
                        </button>
                      </div>
                      <p className="text-[10px] text-slate-400 font-medium italic mt-2">
                        {t('settings.parentAppLanguageHelp')}
                      </p>
                    </div>
                  </div>
                </section>

                {/* Primaria dismissal coordination mode */}
                <section className="bg-white rounded-[2.5rem] p-8 border border-slate-100 shadow-sm space-y-4">
                  <h3 className="text-lg font-black text-slate-900 flex items-center gap-3 border-b border-slate-50 pb-4">
                    <Users className="w-5 h-5 text-amber-500" /> {t('settings.primaryDismissalCoordTitle')}
                  </h3>
                  <p className="text-xs text-slate-500 font-medium leading-relaxed">
                    {t('settings.primaryDismissalCoordDesc')}
                  </p>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setSettings({ ...settings, primary_dismissal_mode: 'teacher' })}
                      className={`flex-1 py-3 rounded-2xl text-xs font-black uppercase tracking-widest transition-all ${
                        settings.primary_dismissal_mode === 'teacher'
                          ? 'bg-primary text-white shadow-lg'
                          : 'bg-slate-50 text-slate-400 border border-slate-200'
                      }`}
                    >
                      {t('settings.sectionTeacher')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSettings({ ...settings, primary_dismissal_mode: 'staff' })}
                      className={`flex-1 py-3 rounded-2xl text-xs font-black uppercase tracking-widest transition-all ${
                        settings.primary_dismissal_mode === 'staff'
                          ? 'bg-primary text-white shadow-lg'
                          : 'bg-slate-50 text-slate-400 border border-slate-200'
                      }`}
                    >
                      {t('settings.assignedStaff')}
                    </button>
                  </div>
                </section>

                {/* Sistema de Bloqueo de Emergencia */}
                <section className="bg-white rounded-[2.5rem] p-8 border border-slate-100 shadow-sm space-y-4">
                  <h3 className="text-lg font-black text-slate-900 flex items-center gap-3 border-b border-slate-50 pb-4">
                    <Shield className="w-5 h-5 text-rose-500" /> Sistema de Bloqueo de Emergencia
                  </h3>
                  <p className="text-xs text-slate-500 font-medium leading-relaxed">
                    Es el botón rojo/verde que aparece al final del menú del personal para activar o levantar un bloqueo general del colegio. Apágalo si el colegio no quiere usar esta función — el botón deja de aparecer para todo el personal hasta que lo vuelvas a encender aquí.
                  </p>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setSettings({ ...settings, emergency_lockdown_enabled: true })}
                      className={`flex-1 py-3 rounded-2xl text-xs font-black uppercase tracking-widest transition-all ${
                        settings.emergency_lockdown_enabled
                          ? 'bg-emerald-600 text-white shadow-lg'
                          : 'bg-slate-50 text-slate-400 border border-slate-200'
                      }`}
                    >
                      Activado
                    </button>
                    <button
                      type="button"
                      onClick={() => setSettings({ ...settings, emergency_lockdown_enabled: false })}
                      className={`flex-1 py-3 rounded-2xl text-xs font-black uppercase tracking-widest transition-all ${
                        !settings.emergency_lockdown_enabled
                          ? 'bg-rose-600 text-white shadow-lg'
                          : 'bg-slate-50 text-slate-400 border border-slate-200'
                      }`}
                    >
                      Desactivado
                    </button>
                  </div>
                  {!settings.emergency_lockdown_enabled && (
                    <p className="text-[10px] text-rose-500 font-bold uppercase tracking-widest">
                      Al guardar, si el bloqueo estaba activo se levanta automáticamente.
                    </p>
                  )}
                </section>

                {/* Quién recibe la Alerta Discreta */}
                <section className="bg-white rounded-[2.5rem] p-8 border border-slate-100 shadow-sm space-y-4">
                  <h3 className="text-lg font-black text-slate-900 flex items-center gap-3 border-b border-slate-50 pb-4">
                    <BellRing className="w-5 h-5 text-indigo-500" /> Quién recibe la Alerta Discreta
                  </h3>
                  <p className="text-xs text-slate-500 font-medium leading-relaxed">
                    Cuando alguien de recepción activa "Alerta Discreta" (Monitor Externo) o "Necesito ayuda" (Check-In), estas son las personas que reciben la notificación. Es automático según quién tiene rol de administrador — no depende de los permisos de módulo que le hayas dado en Gestión de Personal.
                  </p>
                  {alertRecipients.length === 0 ? (
                    <p className="text-[11px] text-slate-400 font-medium italic">Nadie recibiría esta alerta todavía.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {alertRecipients.map((r) => (
                        <div
                          key={r.id}
                          className="flex items-center gap-2 bg-indigo-50 border border-indigo-100 rounded-xl px-3 py-2"
                        >
                          <span className="text-xs font-black text-indigo-900">{r.name}</span>
                          <span className="text-[9px] font-bold uppercase tracking-widest text-indigo-400">
                            {r.isFounder ? 'Admin' : 'Staff'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="text-[10px] text-slate-400 font-medium italic">
                    Para agregar o quitar a alguien de esta lista, dale o quítale el rol de administrador desde Gestión de Personal.
                  </p>
                </section>

                {/* Geolocation Parameters */}
                <section className="bg-white rounded-[2.5rem] p-8 border border-slate-100 shadow-sm space-y-6">
                  <h3 className="text-lg font-black text-slate-900 flex items-center gap-3 border-b border-slate-50 pb-4">
                    <Globe className="w-5 h-5 text-emerald-500" /> {t('settings.geofenceParamsTitle')}
                  </h3>

                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">{t('settings.latitude')}</label>
                      <input
                        type="number" step="any" required
                        value={settings.latitude}
                        onChange={e => setSettings({...settings, latitude: parseFloat(e.target.value)})}
                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-black text-emerald-600 outline-none focus:border-emerald-500 transition-all font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">{t('settings.longitude')}</label>
                      <input 
                        type="number" step="any" required
                        value={settings.longitude}
                        onChange={e => setSettings({...settings, longitude: parseFloat(e.target.value)})}
                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-black text-emerald-600 outline-none focus:border-emerald-500 transition-all font-mono"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">{t('settings.arrivalRadius')}</label>
                    <div className="flex items-center gap-4">
                      <input 
                        type="range" min="10" max="500" step="5"
                        value={settings.pickup_radius_meters}
                        onChange={e => setSettings({...settings, pickup_radius_meters: parseInt(e.target.value)})}
                        className="flex-1 h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-primary"
                      />
                      <span className="bg-slate-900 text-white px-4 py-2 rounded-xl text-xs font-black min-w-[70px] text-center">
                        {settings.pickup_radius_meters}m
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400 font-medium italic mt-4 flex items-center gap-2">
                       <Shield className="w-3 h-3" /> {t('settings.arrivalRadiusHelp')}
                    </p>
                  </div>
                </section>
              </form>
            </div>

            {/* RIGHT: MAP PREVIEW */}
            <div className="lg:col-span-5">
              <div className="bg-slate-900 rounded-[3rem] p-4 h-full shadow-2xl flex flex-col relative overflow-hidden group">
                {/* Header Overlay */}
                <div className="absolute top-8 left-8 z-10">
                  <div className="bg-white/20 backdrop-blur-md text-white px-4 py-2 rounded-2xl text-[10px] font-black flex items-center gap-2 border border-white/10 uppercase tracking-tighter">
                    <Navigation className="w-3 h-3 text-emerald-400 animate-pulse" /> {t('settings.satelliteViewActive')}
                  </div>
                </div>

                {/* Mapa con el radio real de la geocerca dibujado */}
                <div className="flex-1 rounded-[2.2rem] overflow-hidden bg-slate-800 relative">
                  <GeofenceMap
                    latitude={settings.latitude}
                    longitude={settings.longitude}
                    radiusMeters={settings.pickup_radius_meters}
                  />
                </div>

                {/* Footer Data */}
                <div className="p-6 flex flex-col items-center justify-center space-y-2">
                   <p className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em]">{t('settings.geodeticPoint')}</p>
                   <div className="flex items-center gap-4 text-emerald-400 font-mono text-sm font-black">
                     <span>{settings.latitude.toFixed(6)}</span>
                     <span className="text-white/20">|</span>
                     <span>{settings.longitude.toFixed(6)}</span>
                   </div>
                </div>
              </div>
            </div>
          </div>
        ) : activeTab === 'structure' ? (
          <SchoolStructureSettings />
        ) : (
          <DismissalScheduleSettings />
        )}
      </div>
    </>
  );
}
