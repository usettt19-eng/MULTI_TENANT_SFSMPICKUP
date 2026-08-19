import {apiFetch} from '../lib/apiFetch';
import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { TopNav } from '../components/TopNav';
import { Users, Shield, Plus, Edit2, Loader2, Check, X, Trash2, Download, Upload } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { ConfirmModal } from '../components/ConfirmModal';

const AVAILABLE_MODULES = [
  { id: 'dashboard', label: 'Panel Principal' },
  { id: 'security', label: 'Seguridad (Salidas)' },
  { id: 'wellness', label: 'Centro de Bienestar' },
  { id: 'students', label: 'Alumnos' },
  { id: 'guardians', label: 'Padres / Tutores' },
  { id: 'checkin', label: 'Check-In' },
  { id: 'forms', label: 'Formularios' },
  { id: 'requests', label: 'Solicitudes de Reemplazo' },
  { id: 'logs', label: 'Bitácora' },
  { id: 'compliance', label: 'Cumplimiento' },
  { id: 'external', label: 'Monitor Externo' }
];

export function StaffManagement() {
  const { profile } = useAuth();
  const [staff, setStaff] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
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
    permissions: [] as string[]
  });

  useEffect(() => {
    fetchStaff();
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
      if (editingId) {
        // Update permissions via API to keep logic centralized
        const res = await apiFetch(`/api/staff/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ permissions: formData.permissions })
        });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || 'API Error');
      } else {
        // Create new staff via API
        const res = await apiFetch('/api/staff', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: formData.email,
            first_name: formData.first_name,
            last_name: formData.last_name,
            permissions: formData.permissions,
            tenant_id: profile?.tenant_id
          })
        });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || 'Error de permisos o falta de Backend (Verifique VITE_SUPABASE_SERVICE_KEY en .env)');
      }

      setIsModalOpen(false);
      fetchStaff();
      setFormData({ email: '', first_name: '', last_name: '', permissions: [] });
      setEditingId(null);
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
  const csvRef = useRef<HTMLInputElement>(null);

  const handleDownloadTemplate = () => {
    const moduleIds = AVAILABLE_MODULES.map(m => m.id).join('|');
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
          .filter(p => AVAILABLE_MODULES.some(m => m.id === p));

        rows.push({first_name, last_name, email, permissions});
      }

      if (rows.length === 0) {
        alert('El archivo CSV no contiene filas válidas.');
        setIsImporting(false);
        if (csvRef.current) csvRef.current.value = '';
        return;
      }

      try {
        const res = await apiFetch('/api/staff/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ staff: rows, tenant_id: profile?.tenant_id })
        });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || 'Error al importar');

        const { created: createdCount, failed } = json.data || {};
        const message = failed?.length > 0
          ? `Se crearon ${createdCount} de ${rows.length}.\n\nNo se pudieron crear ${failed.length}:\n` +
            failed.map((f: any) => `• ${f.email}: ${f.error}`).join('\n')
          : `Se crearon ${createdCount} miembros del personal correctamente.`;
        alert(message);
        fetchStaff();
      } catch (error: any) {
        alert('Error al importar: ' + error.message);
      }

      setIsImporting(false);
      if (csvRef.current) csvRef.current.value = '';
    };
    reader.readAsText(file, 'UTF-8');
  };

  const openEditModal = (user: any) => {
    let perms = [];
    try {
      const parsed = JSON.parse(user.additional_tutor_name || '{}');
      perms = parsed.permissions || [];
    } catch (e) {}
    
    setFormData({
      email: user.email || '',
      first_name: user.first_name || '',
      last_name: user.last_name || '',
      permissions: perms
    });
    setEditingId(user.id);
    setIsModalOpen(true);
  };

  if (profile?.role !== 'admin') {
    return (
      <div className="p-8 text-center text-red-500 font-bold">
        Acceso denegado. Solo administradores pueden ver esta sección.
      </div>
    );
  }

  return (
    <>
      <TopNav title="SmartPickup" subtitle="Gestión de Staff y Permisos" />

      <div className="p-6 max-w-7xl mx-auto space-y-8 font-body animate-in slide-in-from-bottom-5">
        <header className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tight flex items-center gap-3">
              Personal Administrativo <Shield className="w-8 h-8 text-indigo-600" />
            </h1>
            <p className="text-sm text-slate-500 font-medium mt-1">Crea usuarios para enfermeras, recepcionistas y guardias.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
              PLANTILLA
            </button>
            <button
              onClick={() => csvRef.current?.click()}
              disabled={isImporting}
              className="flex items-center gap-2 bg-slate-800 text-white px-4 py-4 rounded-[1.5rem] font-black text-xs hover:bg-slate-700 transition-all shadow-xl shadow-slate-200 active:scale-95 disabled:opacity-50"
            >
              {isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              IMPORTAR
            </button>
            <button
              onClick={() => {
                setEditingId(null);
                setFormData({ email: '', first_name: '', last_name: '', permissions: [] });
                setIsModalOpen(true);
              }}
              className="flex items-center gap-2 bg-indigo-600 text-white px-6 py-4 rounded-[1.5rem] font-black text-xs hover:bg-indigo-500 transition-all shadow-xl shadow-indigo-200 active:scale-95"
            >
              <Plus className="w-5 h-5" />
              NUEVO STAFF
            </button>
          </div>
        </header>

        {loading ? (
          <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-indigo-600" /></div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {staff.map(user => {
              let perms: string[] = [];
              try { 
                const parsed = JSON.parse(user.additional_tutor_name || '{}'); 
                perms = parsed.permissions || [];
              } catch (e) {}

              return (
                <div key={user.id} className="bg-white rounded-[2rem] p-6 shadow-sm border border-slate-100 flex flex-col relative group">
                  <button
                    onClick={() => requestDelete(user.id, `${user.first_name} ${user.last_name}`)}
                    disabled={isDeletingId === user.id}
                    className="absolute top-4 right-4 p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all opacity-0 group-hover:opacity-100 disabled:opacity-50"
                    title="Eliminar Staff"
                  >
                    {isDeletingId === user.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                  <div className="flex items-center gap-4 mb-4 pr-8">
                    <div className="w-12 h-12 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600">
                      <Users className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="font-black text-slate-800">{user.first_name} {user.last_name}</h3>
                      <p className="text-xs font-bold text-slate-400">{user.email}</p>
                    </div>
                  </div>
                  
                  <div className="flex-1">
                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Módulos Permitidos</h4>
                    <div className="flex flex-wrap gap-2">
                      {perms.length === 0 ? (
                        <span className="text-xs text-slate-400 italic">Sin accesos configurados</span>
                      ) : (
                        perms.map(p => {
                          const mod = AVAILABLE_MODULES.find(m => m.id === p);
                          return (
                            <span key={p} className="bg-emerald-50 text-emerald-700 px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border border-emerald-100">
                              {mod ? mod.label : p}
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
                    <Edit2 className="w-4 h-4" /> EDITAR PERMISOS
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title="Eliminar Staff"
        message={`¿Estás seguro de que deseas eliminar a ${confirmModal.name}? Esta acción no se puede deshacer y revocará su acceso al sistema.`}
        onConfirm={executeDelete}
        onCancel={() => setConfirmModal({ isOpen: false, id: null, name: '' })}
        confirmText="Eliminar Staff"
      />

      {isModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-md animate-in fade-in">
          <div className="bg-white rounded-[2.5rem] w-full max-w-2xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col">
            <div className="flex justify-between items-center p-8 bg-slate-50 border-b border-slate-100 shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-50 rounded-xl">
                  <Shield className="w-5 h-5 text-indigo-600" />
                </div>
                <h2 className="text-xl font-black text-slate-900 tracking-tight">
                  {editingId ? 'Editar Permisos de Staff' : 'Crear Nuevo Staff'}
                </h2>
              </div>
              <button onClick={() => setIsModalOpen(false)} className="p-2.5 bg-white text-slate-400 hover:text-indigo-600 rounded-xl shadow-sm transition-all">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-8 flex-1 overflow-y-auto">
              <form id="staff-form" onSubmit={handleSave} className="space-y-6">
                {!editingId && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Nombre</label>
                      <input 
                        required
                        value={formData.first_name}
                        onChange={e => setFormData({...formData, first_name: e.target.value})}
                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-bold text-slate-700 outline-none focus:border-indigo-500 focus:bg-white transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Apellido</label>
                      <input 
                        required
                        value={formData.last_name}
                        onChange={e => setFormData({...formData, last_name: e.target.value})}
                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-bold text-slate-700 outline-none focus:border-indigo-500 focus:bg-white transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Correo Electrónico</label>
                      <input 
                        type="email" required
                        value={formData.email}
                        onChange={e => setFormData({...formData, email: e.target.value})}
                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-bold text-slate-700 outline-none focus:border-indigo-500 focus:bg-white transition-all"
                      />
                    </div>
                    <p className="text-xs text-slate-500 bg-indigo-50/50 border border-indigo-100 rounded-2xl px-4 py-3">
                      Se le enviará un correo de invitación a este correo para que active su acceso — no hace falta definir una contraseña aquí.
                    </p>
                  </div>
                )}

                <div>
                  <h3 className="text-sm font-black text-slate-800 mb-4 uppercase tracking-widest border-b border-slate-100 pb-2">Permisos de Acceso</h3>
                  <div className="grid grid-cols-2 gap-3">
                    {AVAILABLE_MODULES.map(mod => {
                      const isSelected = formData.permissions.includes(mod.id);
                      return (
                        <div 
                          key={mod.id}
                          onClick={() => handleTogglePermission(mod.id)}
                          className={`p-4 rounded-2xl border-2 cursor-pointer transition-all flex items-center justify-between ${isSelected ? 'bg-indigo-50 border-indigo-500' : 'bg-white border-slate-100 hover:border-indigo-200'}`}
                        >
                          <span className={`text-xs font-black uppercase tracking-widest ${isSelected ? 'text-indigo-700' : 'text-slate-500'}`}>
                            {mod.label}
                          </span>
                          <div className={`w-5 h-5 rounded-md flex items-center justify-center ${isSelected ? 'bg-indigo-500 text-white' : 'bg-slate-100'}`}>
                            {isSelected && <Check className="w-3 h-3" />}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </form>
            </div>

            <div className="p-8 border-t border-slate-100 bg-slate-50 shrink-0">
              <button 
                type="submit" form="staff-form"
                disabled={isSaving}
                className="w-full bg-indigo-600 text-white font-black py-5 rounded-[2rem] shadow-xl shadow-indigo-200 active:scale-95 flex items-center justify-center gap-3 text-xs uppercase tracking-widest disabled:opacity-50"
              >
                {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : 'GUARDAR STAFF'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
