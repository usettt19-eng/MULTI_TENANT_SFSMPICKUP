import {apiFetch} from '../lib/apiFetch';
import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { TopNav } from '../components/TopNav';
import { Users, Shield, Plus, Edit2, Loader2, Check, X, Trash2, Download, Upload, Search, Camera, Layers } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { ConfirmModal } from '../components/ConfirmModal';
import { useLanguage } from '../contexts/LanguageContext';
import type { TranslationKey } from '../i18n/translations';
import { captureVideoFrameCompressed, compressImageFile } from '../lib/photoCompression';

const AVAILABLE_MODULE_IDS = [
  'dashboard', 'security', 'wellness', 'students', 'guardians', 'checkin',
  'forms', 'requests', 'logs', 'arrivals', 'compliance', 'external', 'myclassroom', 'visitors',
  'transit', 'settings',
  // Estos dos otorgan control sobre otros miembros del personal (incluida
  // la asignación de permisos) y sobre las estadísticas del colegio — a
  // diferencia del resto, no son solo acceso a una pantalla operativa.
  // Quedan disponibles para que el administrador decida caso por caso, pero
  // conviene otorgarlos con cautela.
  'staff', 'statistics',
] as const;

// La mayoría reutiliza la etiqueta que ya existe para el sidebar
// (nav.*) — solo los módulos cuyo texto acá es más específico que en el
// sidebar tienen su propia clave (staffModule.*).
const MODULE_LABEL_KEYS: Record<string, TranslationKey> = {
  dashboard: 'staffModule.dashboard',
  security: 'staffModule.security',
  wellness: 'staffModule.wellness',
  students: 'nav.students',
  guardians: 'nav.guardians',
  checkin: 'nav.checkin',
  forms: 'nav.forms',
  requests: 'staffModule.requests',
  logs: 'staffModule.logs',
  arrivals: 'nav.arrivals',
  compliance: 'nav.compliance',
  external: 'nav.external',
  myclassroom: 'nav.myClassroom',
  visitors: 'staffModule.visitors',
  transit: 'nav.transit',
  settings: 'staffModule.settings',
  staff: 'nav.staff',
  statistics: 'nav.statistics',
};

export function StaffManagement() {
  const { t } = useLanguage();
  const { profile } = useAuth();
  const [staff, setStaff] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  // staff_id de un acceso concedido (staff_school_access) que se está
  // editando — distinto de editingId (que es el id de profiles de un
  // miembro "de casa"). Solo se edita su lista de permisos en este colegio,
  // nunca su nombre/correo/foto (eso vive en su perfil de su colegio real).
  const [editingGrantId, setEditingGrantId] = useState<string | null>(null);
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null);

  // Confirmation Modal State
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    id: string | null;
    name: string;
  }>({ isOpen: false, id: null, name: '' });

  const [formData, setFormData] = useState({
    email: '',
    first_name: '',
    last_name: '',
    permissions: [] as string[],
    notify_all_arrivals: false,
  });

  // Foto del staff — mismo componente URL/Archivo/Cámara que ya existe en
  // el alta de padres (GuardiansRegistry.tsx), reutilizado tal cual acá.
  const [photoPayload, setPhotoPayload] = useState('');
  const [photoMethod, setPhotoMethod] = useState<'url' | 'file' | 'camera'>('url');
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const startCamera = async () => {
    setPhotoPayload('');
    setPhotoMethod('camera');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 400, height: 400, facingMode: 'user' }
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Error accessing camera:", err);
      alert(t('guardiansPage.cameraError'));
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
  };

  const takePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      setPhotoPayload(captureVideoFrameCompressed(videoRef.current, canvasRef.current));
      stopCamera();
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && canvasRef.current) {
      compressImageFile(file, canvasRef.current)
        .then(setPhotoPayload)
        .catch(err => console.error('Error comprimiendo la foto:', err));
    }
  };

  const resetPhoto = () => {
    stopCamera();
    setPhotoPayload('');
    setPhotoMethod('url');
  };

  // Personal que ya tenía cuenta en OTRO colegio y al que se le dio acceso a
  // este también (ver /api/staff y tabla staff_school_access) — no aparece
  // en `staff` porque su fila de profiles sigue perteneciendo a su colegio
  // de casa.
  const [grantedAccess, setGrantedAccess] = useState<any[]>([]);
  const [revokingStaffId, setRevokingStaffId] = useState<string | null>(null);

  useEffect(() => {
    fetchStaff();
    fetchGrantedAccess();
  }, [profile?.tenant_id]);

  const fetchStaff = async () => {
    if (!profile?.tenant_id) return;
    setLoading(true);
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('tenant_id', profile.tenant_id)
      .eq('role', 'admin')
      .order('created_at', { ascending: false });

    if (data) {
      // Filter out true admins
      const staffUsers = data.filter(user => {
        try {
          const parsed = JSON.parse(user.additional_tutor_name || '{}');
          return parsed.is_staff === true;
        } catch (e) {
          return false;
        }
      });
      setStaff(staffUsers);
    }
    setLoading(false);
  };

  const fetchGrantedAccess = async () => {
    if (!profile?.tenant_id) return;
    const { data } = await supabase
      .from('staff_school_access')
      .select('staff_id, created_at, permissions, staff:profiles!staff_school_access_staff_id_fkey(first_name, last_name, email)')
      .eq('tenant_id', profile.tenant_id)
      .order('created_at', { ascending: false });
    setGrantedAccess(data || []);
  };

  const handleRevokeAccess = async (staffId: string) => {
    if (!profile?.tenant_id) return;
    setRevokingStaffId(staffId);
    try {
      const res = await apiFetch(`/api/staff/school-access/${staffId}/${profile.tenant_id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Error al revocar el acceso');
      setGrantedAccess(prev => prev.filter(g => g.staff_id !== staffId));
    } catch (error: any) {
      alert('Error: ' + error.message);
    } finally {
      setRevokingStaffId(null);
    }
  };

  const handleTogglePermission = (moduleId: string) => {
    setFormData(prev => {
      const perms = prev.permissions.includes(moduleId)
        ? prev.permissions.filter(p => p !== moduleId)
        : [...prev.permissions, moduleId];
      return { ...prev, permissions: perms };
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);

    try {
      if (editingGrantId) {
        // Solo se edita la lista de módulos de este acceso concedido — el
        // nombre/correo/foto pertenecen a su perfil "de casa", en otro
        // colegio, y no se tocan desde aquí.
        const res = await apiFetch(`/api/staff/school-access/${editingGrantId}/${profile?.tenant_id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ permissions: formData.permissions })
        });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || 'API Error');
        fetchGrantedAccess();
      } else if (editingId) {
        // Update via API to keep logic centralized
        const res = await apiFetch(`/api/staff/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            first_name: formData.first_name,
            last_name: formData.last_name,
            photo_url: photoPayload,
            permissions: formData.permissions,
            notify_all_arrivals: formData.notify_all_arrivals,
          })
        });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || 'API Error');
        fetchStaff();
      } else {
        // Create new staff via API
        const res = await apiFetch('/api/staff', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: formData.email,
            first_name: formData.first_name,
            last_name: formData.last_name,
            photo_url: photoPayload,
            permissions: formData.permissions,
            notify_all_arrivals: formData.notify_all_arrivals,
            tenant_id: profile?.tenant_id
          })
        });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || 'Error de permisos o falta de Backend (Verifique VITE_SUPABASE_SERVICE_KEY en .env)');

        // Ese correo ya tenía cuenta (típicamente personal de otro colegio):
        // se le dio acceso a este, sin mandarle una invitación nueva.
        if (json.data?.granted_existing) {
          alert('Ese correo ya tenía cuenta en otro colegio — se le dio acceso a este también, con el mismo correo y contraseña de siempre.');
          fetchGrantedAccess();
        } else {
          fetchStaff();
        }
      }

      setIsModalOpen(false);
      setFormData({ email: '', first_name: '', last_name: '', permissions: [], notify_all_arrivals: false });
      resetPhoto();
      setEditingId(null);
      setEditingGrantId(null);
    } catch (error: any) {
      alert("Error: " + error.message);
    }

    setIsSaving(false);
  };

  const requestDelete = (id: string, name: string) => {
    setConfirmModal({ isOpen: true, id, name });
  };

  const executeDelete = async () => {
    const id = confirmModal.id;
    if (!id) return;

    setConfirmModal({ isOpen: false, id: null, name: '' });
    setIsDeletingId(id);
    
    try {
      const res = await apiFetch(`/api/staff/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Failed to delete user');
      
      fetchStaff();
    } catch (error: any) {
      alert("Error al eliminar: " + error.message);
    }
    setIsDeletingId(null);
  };

  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null);
  const csvRef = useRef<HTMLInputElement>(null);

  const handleDownloadTemplate = () => {
    const moduleIds = AVAILABLE_MODULE_IDS.join('|');
    const csvContent =
      "data:text/csv;charset=utf-8,first_name,last_name,email,permissions\n" +
      `Ana,Gomez,ana@correo.com,dashboard|checkin\n` +
      `Luis,Torres,luis@correo.com,${moduleIds}\n`;
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csvContent));
    link.setAttribute("download", "plantilla_staff.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCsvImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const csv = event.target?.result as string;
      const lines = csv.split('\n');
      setIsImporting(true);

      const rows = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const cols = line.split(',');

        const first_name = cols[0]?.trim();
        const last_name = cols[1]?.trim();
        const email = cols[2]?.trim();
        if (first_name?.toLowerCase() === 'first_name' || !first_name || !email) continue;

        const permissions = (cols[3] || '')
          .split('|')
          .map(p => p.trim())
          .filter(p => (AVAILABLE_MODULE_IDS as readonly string[]).includes(p));

        rows.push({first_name, last_name, email, permissions});
      }

      if (rows.length === 0) {
        alert(t('staffPage.csvNoValidRows'));
        setIsImporting(false);
        if (csvRef.current) csvRef.current.value = '';
        return;
      }

      // Subir en lotes chicos en vez de una sola petición larga: con muchas
      // filas, una petición de varios minutos es frágil ante cualquier corte
      // de red (el navegador la aborta y se pierde todo el progreso). En
      // lotes, cada petición dura segundos y una falla no arrastra al resto.
      const BATCH_SIZE = 25;
      const batches: typeof rows[] = [];
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        batches.push(rows.slice(i, i + BATCH_SIZE));
      }

      let totalCreated = 0;
      let totalGranted = 0;
      const allFailed: any[] = [];
      setImportProgress({ done: 0, total: rows.length });

      try {
        for (const batch of batches) {
          const res = await apiFetch('/api/staff/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ staff: batch, tenant_id: profile?.tenant_id })
          });
          const json = await res.json();
          if (!res.ok || !json.success) throw new Error(json.error || 'Error al importar');

          const { created: createdCount, granted: grantedCount, failed } = json.data || {};
          totalCreated += createdCount || 0;
          totalGranted += grantedCount || 0;
          if (failed?.length) allFailed.push(...failed);

          setImportProgress(prev => prev ? { ...prev, done: prev.done + batch.length } : prev);
        }

        const grantedNote = totalGranted > 0
          ? `\n${totalGranted} ya tenían cuenta en otro colegio y se les dio acceso a este.`
          : '';
        const message = allFailed.length > 0
          ? `Se crearon ${totalCreated} de ${rows.length}.${grantedNote}\n\nNo se pudieron crear ${allFailed.length}:\n` +
            allFailed.map((f: any) => `• ${f.email}: ${f.error}`).join('\n')
          : `Se crearon ${totalCreated} miembros del personal correctamente.${grantedNote}`;
        alert(message);
        fetchStaff();
      } catch (error: any) {
        alert(
          `Error al importar (se alcanzaron a crear ${totalCreated} de ${rows.length} antes de fallar): ` +
          error.message
        );
      } finally {
        setImportProgress(null);
      }

      setIsImporting(false);
      if (csvRef.current) csvRef.current.value = '';
    };
    reader.readAsText(file, 'UTF-8');
  };

  const openEditModal = (user: any) => {
    let perms = [];
    let notifyAllArrivals = false;
    try {
      const parsed = JSON.parse(user.additional_tutor_name || '{}');
      perms = parsed.permissions || [];
      notifyAllArrivals = parsed.notify_all_arrivals === true;
    } catch (e) {}

    setFormData({
      email: user.email || '',
      first_name: user.first_name || '',
      last_name: user.last_name || '',
      permissions: perms,
      notify_all_arrivals: notifyAllArrivals,
    });
    stopCamera();
    setPhotoPayload(user.photo_url || '');
    setPhotoMethod('url');
    setEditingId(user.id);
    setEditingGrantId(null);
    setIsModalOpen(true);
  };

  const openEditGrantModal = (g: any) => {
    setFormData({
      email: g.staff?.email || '',
      first_name: g.staff?.first_name || '',
      last_name: g.staff?.last_name || '',
      permissions: Array.isArray(g.permissions) ? g.permissions : [],
      notify_all_arrivals: false,
    });
    resetPhoto();
    setEditingId(null);
    setEditingGrantId(g.staff_id);
    setIsModalOpen(true);
  };

  // Búsqueda "inteligente": no solo nombre/correo, también permite encontrar
  // staff por el módulo al que tienen acceso (ej. escribir "salidas"
  // encuentra a quienes tienen el permiso "Seguridad (Salidas)").
  const term = searchTerm.trim().toLowerCase();
  const staffWithPerms = staff.map(user => {
    let perms: string[] = [];
    try {
      const parsed = JSON.parse(user.additional_tutor_name || '{}');
      perms = parsed.permissions || [];
    } catch (e) {}
    return { user, perms };
  });
  const filteredStaff = term
    ? staffWithPerms.filter(({ user, perms }) => {
        const haystack = [
          user.first_name,
          user.last_name,
          user.email,
          ...perms.map(p => (MODULE_LABEL_KEYS[p] ? t(MODULE_LABEL_KEYS[p]) : p)),
        ].join(' ').toLowerCase();
        return haystack.includes(term);
      })
    : staffWithPerms;
  const filteredGrantedAccess = term
    ? grantedAccess.filter((g: any) =>
        `${g.staff?.first_name} ${g.staff?.last_name} ${g.staff?.email}`.toLowerCase().includes(term)
      )
    : grantedAccess;

  if (profile?.role !== 'admin') {
    return (
      <div className="p-8 text-center text-red-500 font-bold">
        {t('staffPage.accessDeniedMsg')}
      </div>
    );
  }

  return (
    <>
      <TopNav title="SmartPickup" subtitle={t('staffPage.topnavSubtitle')} />

      <div className="p-6 max-w-7xl mx-auto space-y-8 font-body animate-in slide-in-from-bottom-5">
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tight flex items-center gap-3">
              {t('staffPage.pageTitle')} <Shield className="w-8 h-8 text-indigo-600" />
            </h1>
            <p className="text-sm text-slate-500 font-medium mt-1">{t('staffPage.pageSubtitle')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
            <div className="relative flex-1 min-w-[200px] md:flex-none">
              <input
                type="text"
                placeholder={t('staffPage.searchPlaceholder')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 pr-4 py-4 bg-white border border-slate-200 rounded-[1.5rem] text-sm font-bold text-slate-700 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all w-full md:w-64"
              />
              <Search className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
            </div>
            <input
              type="file"
              accept=".csv"
              className="hidden"
              ref={csvRef}
              onChange={handleCsvImport}
            />
            <button
              onClick={handleDownloadTemplate}
              className="flex items-center gap-2 bg-white text-indigo-600 border border-indigo-100 px-4 py-4 rounded-[1.5rem] font-black text-xs hover:bg-indigo-50 transition-all shadow-sm"
            >
              <Download className="w-4 h-4" />
              {t('staffPage.templateBtn')}
            </button>
            <button
              onClick={() => csvRef.current?.click()}
              disabled={isImporting}
              className="flex items-center gap-2 bg-slate-800 text-white px-4 py-4 rounded-[1.5rem] font-black text-xs hover:bg-slate-700 transition-all shadow-xl shadow-slate-200 active:scale-95 disabled:opacity-50"
            >
              {isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {t('staffPage.importBtn')}
            </button>
            <button
              onClick={() => {
                setEditingId(null);
                setEditingGrantId(null);
                setFormData({ email: '', first_name: '', last_name: '', permissions: [], notify_all_arrivals: false });
                resetPhoto();
                setIsModalOpen(true);
              }}
              className="flex items-center gap-2 bg-indigo-600 text-white px-6 py-4 rounded-[1.5rem] font-black text-xs hover:bg-indigo-500 transition-all shadow-xl shadow-indigo-200 active:scale-95"
            >
              <Plus className="w-5 h-5" />
              {t('staffPage.newStaffBtn')}
            </button>
          </div>
        </header>

        {loading ? (
          <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-indigo-600" /></div>
        ) : filteredStaff.length === 0 ? (
          <div className="text-center py-12 text-slate-400 font-bold text-sm">
            {term ? t('staffPage.noMatchSearch') : t('staffPage.noStaffYet')}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredStaff.map(({ user, perms }) => {
              return (
                <div key={user.id} className="bg-white rounded-[2rem] p-6 shadow-sm border border-slate-100 flex flex-col relative group">
                  <button
                    onClick={() => requestDelete(user.id, `${user.first_name} ${user.last_name}`)}
                    disabled={isDeletingId === user.id}
                    className="absolute top-4 right-4 p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all opacity-0 group-hover:opacity-100 disabled:opacity-50"
                    title={t('staffPage.deleteStaffTooltip')}
                  >
                    {isDeletingId === user.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                  <div className="flex items-center gap-4 mb-4 pr-8">
                    <div className="w-12 h-12 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600 overflow-hidden shrink-0">
                      {user.photo_url ? (
                        <img src={user.photo_url} alt={user.first_name} className="w-full h-full object-cover" />
                      ) : (
                        <Users className="w-6 h-6" />
                      )}
                    </div>
                    <div>
                      <h3 className="font-black text-slate-800">{user.first_name} {user.last_name}</h3>
                      <p className="text-xs font-bold text-slate-400">{user.email}</p>
                    </div>
                  </div>
                  
                  <div className="flex-1">
                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{t('staffPage.allowedModulesLabel')}</h4>
                    <div className="flex flex-wrap gap-2">
                      {perms.length === 0 ? (
                        <span className="text-xs text-slate-400 italic">{t('staffPage.noAccessConfigured')}</span>
                      ) : (
                        perms.map(p => {
                          const labelKey = MODULE_LABEL_KEYS[p];
                          return (
                            <span key={p} className="bg-emerald-50 text-emerald-700 px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border border-emerald-100">
                              {labelKey ? t(labelKey) : p}
                            </span>
                          )
                        })
                      )}
                    </div>
                  </div>

                  <button 
                    onClick={() => openEditModal(user)}
                    className="mt-6 w-full py-3 bg-slate-50 text-indigo-600 font-black text-xs rounded-xl hover:bg-indigo-50 transition-colors flex items-center justify-center gap-2"
                  >
                    <Edit2 className="w-4 h-4" /> {t('staffPage.editPermissionsBtn')}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {grantedAccess.length > 0 && (
          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-black text-slate-800">
                {t('staffPage.otherSchoolsAccessTitle')} <span className="text-xs font-bold text-slate-400">({filteredGrantedAccess.length})</span>
              </h2>
              <p className="text-xs text-slate-500 font-medium mt-1">
                {t('staffPage.otherSchoolsAccessDesc')}
              </p>
            </div>
            {filteredGrantedAccess.length === 0 ? (
              <p className="text-xs text-slate-400 italic">{t('staffPage.noneMatchSearch')}</p>
            ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredGrantedAccess.map((g: any) => {
                const gPerms: string[] = Array.isArray(g.permissions) ? g.permissions : [];
                return (
                <div key={g.staff_id} className="bg-white rounded-[1.5rem] p-5 shadow-sm border border-slate-100 flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 shrink-0 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600">
                        <Users className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-black text-slate-800 text-sm truncate">{g.staff?.first_name} {g.staff?.last_name}</h3>
                        <p className="text-xs font-bold text-slate-400 truncate">{g.staff?.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => openEditGrantModal(g)}
                        className="p-2 text-slate-300 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all"
                        title={t('staffPage.editPermissionsBtn')}
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleRevokeAccess(g.staff_id)}
                        disabled={revokingStaffId === g.staff_id}
                        className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all disabled:opacity-50"
                        title={t('staffPage.revokeAccessTooltip')}
                      >
                        {revokingStaffId === g.staff_id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {gPerms.length === 0 ? (
                      <span className="text-xs text-slate-400 italic">{t('staffPage.noAccessConfigured')}</span>
                    ) : (
                      gPerms.map(p => {
                        const labelKey = MODULE_LABEL_KEYS[p];
                        return (
                          <span key={p} className="bg-emerald-50 text-emerald-700 px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border border-emerald-100">
                            {labelKey ? t(labelKey) : p}
                          </span>
                        );
                      })
                    )}
                  </div>
                </div>
                );
              })}
            </div>
            )}
          </section>
        )}
      </div>

      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={t('staffPage.deleteStaffTooltip')}
        message={t('staffPage.deleteStaffConfirmMessageTemplate').replace('{name}', confirmModal.name)}
        onConfirm={executeDelete}
        onCancel={() => setConfirmModal({ isOpen: false, id: null, name: '' })}
        confirmText={t('staffPage.deleteStaffTooltip')}
      />

      {importProgress && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-md">
          <div className="bg-white rounded-3xl w-full max-w-sm p-8 shadow-2xl flex flex-col items-center text-center animate-in zoom-in-95">
            <Loader2 className="w-10 h-10 text-indigo-600 animate-spin mb-4" />
            <h3 className="text-lg font-black text-slate-800 mb-1">{t('staffPage.importingStaffTitle')}</h3>
            <p className="text-sm text-slate-500 mb-5">
              {t('guardiansPage.progressOfTemplate').replace('{done}', String(importProgress.done)).replace('{total}', String(importProgress.total))}
            </p>
            <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-600 rounded-full transition-all duration-500 ease-out"
                style={{
                  width: `${Math.min(100, Math.round((importProgress.done / importProgress.total) * 100))}%`,
                }}
              />
            </div>
            <p className="text-xs text-slate-400 mt-3">{t('guardiansPage.dontCloseTab')}</p>
          </div>
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-md animate-in fade-in">
          <div className="bg-white rounded-[2.5rem] w-full max-w-2xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col">
            <div className="flex justify-between items-center p-8 bg-slate-50 border-b border-slate-100 shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-50 rounded-xl">
                  <Shield className="w-5 h-5 text-indigo-600" />
                </div>
                <h2 className="text-xl font-black text-slate-900 tracking-tight">
                  {editingGrantId
                    ? t('staffPage.editGrantModalTitle')
                    : editingId
                    ? t('staffPage.editPermissionsModalTitle')
                    : t('staffPage.createNewStaffModalTitle')}
                </h2>
              </div>
              <button onClick={() => { setIsModalOpen(false); setEditingGrantId(null); stopCamera(); }} className="p-2.5 bg-white text-slate-400 hover:text-indigo-600 rounded-xl shadow-sm transition-all">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-8 flex-1 overflow-y-auto">
              <form id="staff-form" onSubmit={handleSave} className="space-y-6">
                {editingGrantId ? (
                  <div className="flex items-center gap-4 bg-slate-50 border border-slate-100 rounded-2xl px-5 py-4">
                    <div className="w-12 h-12 shrink-0 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600">
                      <Users className="w-6 h-6" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-black text-slate-800 truncate">{formData.first_name} {formData.last_name}</p>
                      <p className="text-xs font-bold text-slate-400 truncate">{formData.email}</p>
                      <p className="text-[10px] text-slate-400 font-medium mt-1">{t('staffPage.editGrantHint')}</p>
                    </div>
                  </div>
                ) : (
                <div className="grid grid-cols-1 sm:grid-cols-[7rem_1fr] gap-4 sm:gap-6 items-start">
                  {/* Foto */}
                  <div className="w-28 mx-auto sm:mx-0 space-y-2">
                    <div className="w-24 h-24 mx-auto sm:mx-0 rounded-2xl bg-slate-50 border-2 border-dashed border-slate-200 overflow-hidden flex items-center justify-center relative">
                      {photoMethod === 'camera' ? (
                        !photoPayload ? (
                          <>
                            <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
                            <button
                              type="button"
                              onClick={takePhoto}
                              className="absolute bottom-1 left-1/2 -translate-x-1/2 bg-white text-indigo-600 p-1.5 rounded-full shadow-lg"
                            >
                              <Camera className="w-3.5 h-3.5" />
                            </button>
                          </>
                        ) : (
                          <img src={photoPayload} alt="Preview" className="w-full h-full object-cover" />
                        )
                      ) : photoPayload ? (
                        <img src={photoPayload} alt="Preview" className="w-full h-full object-cover" />
                      ) : (
                        <Users className="w-8 h-8 text-slate-300" />
                      )}
                      <canvas ref={canvasRef} className="hidden" />
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      <button type="button" onClick={() => { stopCamera(); setPhotoMethod('url'); }} className={`py-1.5 rounded-lg border text-[8px] font-black transition-all ${photoMethod === 'url' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-400 border-slate-100'}`}>URL</button>
                      <button type="button" onClick={() => { stopCamera(); document.getElementById('staffPhotoFileInput')?.click(); setPhotoMethod('file'); }} className={`py-1.5 rounded-lg border text-[8px] font-black transition-all ${photoMethod === 'file' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-400 border-slate-100'}`}>{t('students.photoFileTab')}</button>
                      <button type="button" onClick={startCamera} className={`py-1.5 rounded-lg border text-[8px] font-black transition-all ${photoMethod === 'camera' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-400 border-slate-100'}`}>{t('students.photoCameraTab')}</button>
                    </div>
                    {photoMethod === 'url' && (
                      <input
                        value={photoPayload}
                        onChange={e => setPhotoPayload(e.target.value)}
                        type="url"
                        placeholder={t('students.pasteLinkPlaceholder')}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-[10px] outline-none focus:border-indigo-500 transition-all"
                      />
                    )}
                    <input id="staffPhotoFileInput" type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
                  </div>

                  {/* Nombre / Correo */}
                  <div className="flex-1 w-full space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">{t('guardiansPage.firstNameLabel')}</label>
                        <input
                          required
                          value={formData.first_name}
                          onChange={e => setFormData({...formData, first_name: e.target.value})}
                          className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-bold text-slate-700 outline-none focus:border-indigo-500 focus:bg-white transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">{t('guardiansPage.lastNameLabel')}</label>
                        <input
                          required
                          value={formData.last_name}
                          onChange={e => setFormData({...formData, last_name: e.target.value})}
                          className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-bold text-slate-700 outline-none focus:border-indigo-500 focus:bg-white transition-all"
                        />
                      </div>
                    </div>
                    {!editingId && (
                      <>
                        <div>
                          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">{t('staffPage.emailLabel')}</label>
                          <input
                            type="email" required
                            value={formData.email}
                            onChange={e => setFormData({...formData, email: e.target.value})}
                            className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-bold text-slate-700 outline-none focus:border-indigo-500 focus:bg-white transition-all"
                          />
                        </div>
                        <p className="text-xs text-slate-500 bg-indigo-50/50 border border-indigo-100 rounded-2xl px-4 py-3">
                          {t('staffPage.inviteNotice')}
                        </p>
                      </>
                    )}
                  </div>
                </div>
                )}

                <div>
                  <h3 className="text-sm font-black text-slate-800 mb-4 uppercase tracking-widest border-b border-slate-100 pb-2">{t('staffPage.accessPermissionsTitle')}</h3>
                  <div className="grid grid-cols-2 gap-3">
                    {AVAILABLE_MODULE_IDS.map(id => {
                      const isSelected = formData.permissions.includes(id);
                      return (
                        <div
                          key={id}
                          onClick={() => handleTogglePermission(id)}
                          className={`p-4 rounded-2xl border-2 cursor-pointer transition-all flex items-center justify-between ${isSelected ? 'bg-indigo-50 border-indigo-500' : 'bg-white border-slate-100 hover:border-indigo-200'}`}
                        >
                          <span className={`text-xs font-black uppercase tracking-widest ${isSelected ? 'text-indigo-700' : 'text-slate-500'}`}>
                            {t(MODULE_LABEL_KEYS[id])}
                          </span>
                          <div className={`w-5 h-5 rounded-md flex items-center justify-center ${isSelected ? 'bg-indigo-500 text-white' : 'bg-slate-100'}`}>
                            {isSelected && <Check className="w-3 h-3" />}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {!editingGrantId && (
                <div
                  onClick={() => setFormData(prev => ({ ...prev, notify_all_arrivals: !prev.notify_all_arrivals }))}
                  className={`p-4 rounded-2xl border-2 cursor-pointer transition-all flex items-center justify-between ${formData.notify_all_arrivals ? 'bg-emerald-50 border-emerald-500' : 'bg-white border-slate-100 hover:border-emerald-200'}`}
                >
                  <div>
                    <span className={`block text-xs font-black uppercase tracking-widest ${formData.notify_all_arrivals ? 'text-emerald-700' : 'text-slate-500'}`}>
                      {t('staffPage.notifyAllArrivalsLabel')}
                    </span>
                    <span className="block text-[11px] text-slate-400 font-medium mt-1">
                      {t('staffPage.notifyAllArrivalsDesc')}
                    </span>
                  </div>
                  <div className={`w-5 h-5 shrink-0 rounded-md flex items-center justify-center ml-3 ${formData.notify_all_arrivals ? 'bg-emerald-500 text-white' : 'bg-slate-100'}`}>
                    {formData.notify_all_arrivals && <Check className="w-3 h-3" />}
                  </div>
                </div>
                )}
              </form>
            </div>

            <div className="p-8 border-t border-slate-100 bg-slate-50 shrink-0">
              <button 
                type="submit" form="staff-form"
                disabled={isSaving}
                className="w-full bg-indigo-600 text-white font-black py-5 rounded-[2rem] shadow-xl shadow-indigo-200 active:scale-95 flex items-center justify-center gap-3 text-xs uppercase tracking-widest disabled:opacity-50"
              >
                {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : t('staffPage.saveStaffBtn')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
