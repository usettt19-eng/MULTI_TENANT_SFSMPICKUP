import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { TopNav } from '../components/TopNav';
import {
  Settings as SettingsIcon, MapPin, Building, Shield,
  Map as MapIcon, Save, Navigation, RefreshCcw,
  Loader2, CheckCircle2, Globe, Ruler, DoorOpen, CalendarClock, Users
} from 'lucide-react';
import { SchoolStructureSettings } from '../components/settings/SchoolStructureSettings';
import { DismissalScheduleSettings } from '../components/settings/DismissalScheduleSettings';

export function Settings() {
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
  });
  const [defaultLanguage, setDefaultLanguage] = useState<'es' | 'en'>('es');
  const [logoFile, setLogoFile] = useState<File | null>(null);

  useEffect(() => {
    fetchSettings();
  }, [profile?.tenant_id]);

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
      alert('Error uploading logo: ' + uploadError.message);
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

    const [{ error }, { error: langError }] = await Promise.all([
      supabase.from('school_settings').upsert(currentSettings),
      profile?.tenant_id
        ? supabase.from('tenants').update({ default_language: defaultLanguage }).eq('id', profile.tenant_id)
        : Promise.resolve({ error: null }),
    ]);

    if (error || langError) alert("Error al guardar: " + (error?.message || langError?.message));
    else {
      alert("Ajustes guardados correctamente.");
      setLogoFile(null); // Clear the selected file
      fetchSettings();
    }
    setSaving(false);
  };

  const getMapUrl = () => {
    return `https://www.google.com/maps/embed/v1/view?key=YOUR_API_KEY_OR_FREE_MODE&center=${settings.latitude},${settings.longitude}&zoom=18&maptype=satellite`;
  };

  // Alternative for preview without API Key
  const getStaticMapUrl = () => {
    return `https://maps.google.com/maps?q=${settings.latitude},${settings.longitude}&z=15&output=embed`;
  };

  return (
    <>
      <TopNav title="SmartPickup" subtitle="Configuración Global del Colegio" />

      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6 sm:space-y-8 w-full font-body animate-in slide-in-from-bottom-5 duration-700">
        <header className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight flex items-center gap-3">
              Ajustes del Sistema <SettingsIcon className="w-6 h-6 sm:w-8 sm:h-8 text-primary animate-[spin_4s_linear_infinite]" />
            </h1>
            <p className="text-sm text-slate-500 font-medium font-body mt-1">Control de georeferencia, perímetros y datos oficiales.</p>
          </div>
          {activeTab === 'general' && (
            <button
              type="submit"
              form="settings-form"
              disabled={saving}
              className="flex items-center justify-center gap-2 bg-primary text-white px-8 py-4 rounded-[1.5rem] font-black text-xs hover:bg-primary-container transition-all shadow-xl shadow-primary/20 active:scale-95 disabled:opacity-50 w-full sm:w-auto"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              GUARDAR CAMBIOS
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
            Configuración General
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
            Estructura y Puertas
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
            Horarios de Salida
          </button>
        </div>

        {loading ? (
          <div className="h-[50vh] flex flex-col items-center justify-center">
            <Loader2 className="w-12 h-12 text-primary animate-spin" />
            <p className="text-slate-400 font-bold mt-4 italic">Cargando parámetros de geolocalización...</p>
          </div>
        ) : activeTab === 'general' ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            
            {/* LEFT: FORM DATA */}
            <div className="lg:col-span-7">
              <form id="settings-form" onSubmit={handleSave} className="space-y-6">
                
                {/* School Identity */}
                <section className="bg-white rounded-[2.5rem] p-8 border border-slate-100 shadow-sm space-y-6">
                  <h3 className="text-lg font-black text-slate-900 flex items-center gap-3 border-b border-slate-50 pb-4">
                    <Building className="w-5 h-5 text-primary" /> Perfil Institucional
                  </h3>
                  
                  <div className="space-y-4">
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Nombre Oficial del Colegio</label>
                      <input 
                        required
                        value={settings.school_name}
                        onChange={e => setSettings({...settings, school_name: e.target.value})}
                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-bold text-slate-700 outline-none focus:border-primary focus:bg-white transition-all shadow-inner"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Logo del Colegio</label>
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
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Dirección Física</label>
                      <input
                        required
                        value={settings.address}
                        onChange={e => setSettings({...settings, address: e.target.value})}
                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-medium text-slate-600 outline-none focus:border-primary focus:bg-white transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Idioma de la app para padres</label>
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
                        Todos los padres de este colegio verán su app en este idioma.
                      </p>
                    </div>
                  </div>
                </section>

                {/* Primaria dismissal coordination mode */}
                <section className="bg-white rounded-[2.5rem] p-8 border border-slate-100 shadow-sm space-y-4">
                  <h3 className="text-lg font-black text-slate-900 flex items-center gap-3 border-b border-slate-50 pb-4">
                    <Users className="w-5 h-5 text-amber-500" /> Coordinación de Salida en Primaria
                  </h3>
                  <p className="text-xs text-slate-500 font-medium leading-relaxed">
                    En primaria, ¿quién es el encargado de la entrega de los alumnos: el profesor de cada sección,
                    o un personal designado para esa tarea (recepción, coordinador, etc.)? Esto define el texto
                    que verán al asignar encargados en la pestaña "Horarios de Salida".
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
                      El Profesor de la Sección
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
                      Personal Asignado
                    </button>
                  </div>
                </section>

                {/* Geolocation Parameters */}
                <section className="bg-white rounded-[2.5rem] p-8 border border-slate-100 shadow-sm space-y-6">
                  <h3 className="text-lg font-black text-slate-900 flex items-center gap-3 border-b border-slate-50 pb-4">
                    <Globe className="w-5 h-5 text-emerald-500" /> Parámetros de Geocerca (GPS)
                  </h3>
                  
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Latitud (Y)</label>
                      <input 
                        type="number" step="any" required
                        value={settings.latitude}
                        onChange={e => setSettings({...settings, latitude: parseFloat(e.target.value)})}
                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-black text-emerald-600 outline-none focus:border-emerald-500 transition-all font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Longitud (X)</label>
                      <input 
                        type="number" step="any" required
                        value={settings.longitude}
                        onChange={e => setSettings({...settings, longitude: parseFloat(e.target.value)})}
                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-black text-emerald-600 outline-none focus:border-emerald-500 transition-all font-mono"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Radio de Llegada (Metros)</label>
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
                       <Shield className="w-3 h-3" /> El sistema autorizará la recogida solo si el padre está a menos de esta distancia.
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
                    <Navigation className="w-3 h-3 text-emerald-400 animate-pulse" /> Vista Satelital Activa
                  </div>
                </div>

                {/* Map Iframe */}
                <div className="flex-1 rounded-[2.2rem] overflow-hidden bg-slate-800 relative">
                  <iframe 
                    width="100%" 
                    height="100%" 
                    frameBorder="0" 
                    title="School Map Location"
                    className="grayscale-[0.1] contrast-[1.1]"
                    src={getStaticMapUrl()}
                  ></iframe>
                </div>

                {/* Footer Data */}
                <div className="p-6 flex flex-col items-center justify-center space-y-2">
                   <p className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em]">Punto Geodésico</p>
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
