import {apiFetch} from '../lib/apiFetch';
import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { TopNav } from '../components/TopNav';
import { ConfirmModal } from '../components/ConfirmModal';
import {
  Users, Search, Filter, Mail, Phone,
  Shield, Trash2, Edit2, CheckCircle2, UserPlus, Plus,
  ExternalLink, Key, X, Camera, Upload, Link,
  Loader2, AlertCircle, FileSpreadsheet, LayoutGrid, List, Download
} from 'lucide-react';

export function GuardiansRegistry() {
  const { profile } = useAuth();
  const [guardians, setGuardians] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null);
  const [editingGuardianId, setEditingGuardianId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');

  // Confirmation Modal State
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    id: string | null;
    name: string;
  }>({ isOpen: false, id: null, name: '' });

  // Form states
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [pinCode, setPinCode] = useState('');
  const [photoPayload, setPhotoPayload] = useState('');
  const [selectedStudents, setSelectedStudents] = useState<string[]>([]);
  const [photoMethod, setPhotoMethod] = useState<'url' | 'file' | 'camera'>('url');
  const [studentSearchTerm, setStudentSearchTerm] = useState('');

  // Additional Tutor (Optional/Occasional)
  const [extraTutorName, setExtraTutorName] = useState('');
  const [extraTutorPhone, setExtraTutorPhone] = useState('');

  // Vehicle states
  const [licensePlate, setLicensePlate] = useState('');
  const [vehicleDesc, setVehicleDesc] = useState('');
  const [replacements, setReplacements] = useState<any[]>([]);
  const [newRepName, setNewRepName] = useState('');
  const [newRepPhone, setNewRepPhone] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const csvRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchGuardians();
    fetchStudents();
    if (localStorage.getItem('openAddGuardianModal') === 'true') {
      setIsModalOpen(true);
      localStorage.removeItem('openAddGuardianModal');
    }
  }, [profile?.tenant_id]);

  const fetchGuardians = async () => {
    if (!profile?.tenant_id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('profiles')
      .select('*, parent_students(students(*)), vehicles(*)')
      .eq('tenant_id', profile.tenant_id)
      .eq('role', 'parent')
      .order('last_name', { ascending: true });

    if (error) console.error('Error fetching guardians:', error);
    else setGuardians(data || []);
    setLoading(false);
  };

  const fetchStudents = async () => {
    if (!profile?.tenant_id) return;
    const { data } = await supabase.from('students').select('*').eq('tenant_id', profile.tenant_id).order('first_name');
    if (data) setStudents(data);
  };

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
      alert("No se pudo acceder a la cámara.");
    }
  };

  const takePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const data = canvas.toDataURL('image/jpeg');
        setPhotoPayload(data);
        stopCamera();
      }
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setPhotoPayload(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleDownloadTemplate = () => {
    // Sin BOM, Excel adivina la codificación del CSV y suele acertar mal con
    // acentos (charset=utf-8 en la URI de datos NO añade el BOM a los bytes
    // reales). Si el admin abre y reguarda desde Excel, los acentos quedan
    // rotos de forma permanente en el archivo — "Pérez" pasa a "PÃ©rez".
    // handleExportCSV, más abajo, ya lo hacía bien; aquí faltaba.
    // vehicle_plate y vehicle_description son opcionales: si vienen vacías,
    // el padre se crea igual, simplemente sin vehículo registrado.
    // student_names: nombre completo del/los hijo(s) tal como están en
    // Estudiantes, separados por "|" si hay más de uno. Debe coincidir
    // exactamente (sin distinguir mayúsculas) con "Nombre Apellido" del
    // alumno ya cargado en el sistema; si no hay coincidencia el padre se
    // crea igual, solo queda sin vincular a ese alumno.
    const csvContent = "first_name,last_name,phone,pin_code,email,vehicle_plate,vehicle_description,student_names\nJuan,Pérez,50760000000,1234,juan@ejemplo.com,ABC-123,Sedán Blanco,Camila Pérez\nMaria,García,50761111111,5678,maria@ejemplo.com,,,Diego García|Sofía García\n";
    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.setAttribute("download", "plantilla_padres.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportCSV = () => {
    let csvData = "Nombre,Apellido,Email,Teléfono,PIN,Estudiantes,Grados,Placa Vehículo,Desc. Vehículo\n";
    
    guardians.forEach(g => {
      const studentsNames = (g.parent_students || []).map((ps: any) => ps.students?.first_name ? `${ps.students.first_name} ${ps.students.last_name || ''}` : '').filter(Boolean).join(' | ');
      const studentsGrades = (g.parent_students || []).map((ps: any) => ps.students?.grade || '').filter(Boolean).join(' | ');
      
      const vehicle = g.vehicles && g.vehicles.length > 0 ? g.vehicles[0] : null;
      const plate = vehicle?.license_plate || '';
      const vdesc = vehicle?.description || '';
      
      const row = [
        g.first_name || '',
        g.last_name || '',
        g.email || '',
        g.phone || '',
        g.pin_code || '',
        studentsNames,
        studentsGrades,
        plate,
        vdesc
      ].map(field => `"${String(field).replace(/"/g, '""')}"`).join(',');
      
      csvData += row + "\n";
    });

    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvData], { type: 'text/csv;charset=utf-8;' }); // BOM for Excel UTF-8
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.setAttribute("download", "registro_padres.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCSVImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const csv = event.target?.result as string;
      const lines = csv.split('\n');
      setProcessing(true);

      const parentsToInsert = [];

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const cols = line.split(',');

        const f_name = cols[0]?.trim();
        const l_name = cols[1]?.trim();
        const tel = cols[2]?.trim();
        const pin = cols[3]?.trim();
        const mail = cols[4]?.trim() || `${f_name.toLowerCase()}@example.com`;
        // Opcionales: si el CSV no trae estas columnas, quedan undefined y
        // el padre se crea igual, sin vehículo ni hijos vinculados.
        const plate = cols[5]?.trim();
        const vdesc = cols[6]?.trim();
        const studentNames = (cols[7] || '')
          .split('|')
          .map(n => n.trim())
          .filter(Boolean);

        if (!f_name || !mail) continue;

        parentsToInsert.push({
          id: crypto.randomUUID(),
          first_name: f_name,
          last_name: l_name,
          phone: tel,
          email: mail,
          pin_code: pin,
          vehicle_plate: plate || undefined,
          vehicle_description: vdesc || undefined,
          student_names: studentNames.length > 0 ? studentNames : undefined,
          role: 'parent',
          tenant_id: profile?.tenant_id
        });
      }

      if (parentsToInsert.length > 0) {
        // Subir en lotes chicos en vez de una sola petición larga: con
        // cientos de filas, una petición de varios minutos es frágil ante
        // cualquier corte de red (el navegador la aborta y se pierde todo
        // el progreso, sin aviso claro de qué pasó). En lotes, cada
        // petición dura segundos, y si una falla solo se pierde ese lote.
        const BATCH_SIZE = 25;
        const batches: typeof parentsToInsert[] = [];
        for (let i = 0; i < parentsToInsert.length; i += BATCH_SIZE) {
          batches.push(parentsToInsert.slice(i, i + BATCH_SIZE));
        }

        let totalCreated = 0;
        const allFailed: any[] = [];
        const allLinkWarnings: any[] = [];
        setImportProgress({ done: 0, total: parentsToInsert.length });

        try {
          for (const batch of batches) {
            const res = await apiFetch('/api/parents/bulk', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ parents: batch, tenant_id: profile?.tenant_id })
            });
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json.error || 'API Error al importar padres');

            const { created: createdCount, failed: failedRows, linkWarnings } = json.data || {};
            totalCreated += createdCount || 0;
            if (failedRows?.length) allFailed.push(...failedRows);
            if (linkWarnings?.length) allLinkWarnings.push(...linkWarnings);

            setImportProgress(prev => prev ? { ...prev, done: prev.done + batch.length } : prev);
          }

          // El backend devuelve success:true aunque ALGUNAS filas fallen
          // (correo duplicado, etc.) — success solo dice que la petición se
          // procesó, no que cada padre se haya creado. Sin esto, una fila
          // fallida no mostraba ningún aviso: el admin creía que había
          // funcionado y el padre simplemente no aparecía en ningún lado.
          let message = allFailed.length > 0
            ? `Importados ${totalCreated} de ${parentsToInsert.length}.\n\n` +
              `No se pudieron crear ${allFailed.length}:\n` +
              allFailed.map((f: any) => `• ${f.email}: ${f.error}`).join('\n')
            : `Se importaron ${totalCreated} padres correctamente.`;

          // Vincular por nombre es opcional y no bloquea la creación del
          // padre: si un nombre no coincide con ningún alumno (o coincide
          // con más de uno), se avisa aparte para que el staff lo revise y
          // lo vincule a mano, en vez de fallar la importación entera.
          if (allLinkWarnings.length > 0) {
            message += `\n\nAlgunos hijos no se pudieron vincular automáticamente (revísalos manualmente):\n` +
              allLinkWarnings.map((w: any) => `• ${w.email} → "${w.student_name}": ${w.reason}`).join('\n');
          }

          alert(message);
        } catch (error: any) {
          alert(
            `Error al importar (se alcanzaron a crear ${totalCreated} de ${parentsToInsert.length} antes de fallar): ` +
            error.message
          );
        } finally {
          setImportProgress(null);
        }
      }

      setProcessing(false);
      fetchGuardians();
    };
    reader.readAsText(file, 'UTF-8');
  };

  const handleEdit = (guardian: any) => {
    setEditingGuardianId(guardian.id);
    setFirstName(guardian.first_name || '');
    setLastName(guardian.last_name || '');
    setEmail(guardian.email || '');
    setPassword('');
    setPhone(guardian.phone || '');
    setPinCode(guardian.pin_code || '');
    setPhotoPayload(guardian.photo_url || '');

    const studentIds = guardian.parent_students?.map((ps: any) => ps.students?.id) || [];
    setSelectedStudents(studentIds);

    setExtraTutorName(guardian.additional_tutor_name || '');
    setExtraTutorPhone(guardian.additional_tutor_phone || '');

    try {
      const parsed = JSON.parse(guardian.additional_tutor_name || '{}');
      if (parsed.replacements) {
        setReplacements(parsed.replacements);
        // If it was JSON, we should clear the simple tutor name field if it was just a string before
        if (typeof parsed === 'object') setExtraTutorName(''); 
      } else {
        setReplacements([]);
      }
    } catch (e) {
      setReplacements([]);
    }

    if (guardian.vehicles?.[0]) {
      setLicensePlate(guardian.vehicles[0].license_plate);
      setVehicleDesc(guardian.vehicles[0].description);
    } else {
      setLicensePlate('');
      setVehicleDesc('');
    }

    setIsModalOpen(true);
  };

  const handleAddGuardian = async (e: React.FormEvent) => {
    e.preventDefault();
    setProcessing(true);

    try {
      let userId = editingGuardianId;

      // Prepare replacements data
      const additionalData = {
        is_staff: false,
        replacements: replacements
      };

      if (!editingGuardianId) {
        // Create new via API
        const res = await apiFetch('/api/parents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            first_name: firstName,
            last_name: lastName,
            phone: phone,
            email: email,
            pin_code: pinCode,
            photo_url: photoPayload,
            role: 'parent',
            additional_tutor_name: JSON.stringify(additionalData),
            additional_tutor_phone: extraTutorPhone,
            tenant_id: profile?.tenant_id
          })
        });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || 'API Error creating parent');
        userId = json.data.id;
      } else {
        // Update existing via API
        const res = await apiFetch(`/api/parents/${userId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            first_name: firstName,
            last_name: lastName,
            phone: phone,
            email: email,
            password: password,
            pin_code: pinCode,
            photo_url: photoPayload,
            additional_tutor_name: JSON.stringify(additionalData),
            additional_tutor_phone: extraTutorPhone,
            tenant_id: profile?.tenant_id
          })
        });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || 'API Error updating parent');
        userId = json.data?.id || userId;
      }

      if (!userId) throw new Error("ID de usuario no generado.");

      // For existing parents, we delete existing links using the OLD id before we insert new ones using the (potentially NEW) userId.
      // Wait, if the ID migrated, the backend already updated the links. 
      // But we still want to replace them with what's in the form right now.
      if (editingGuardianId) {
        // use editingGuardianId to delete just in case it wasn't migrated, or if it was, we need to delete from the new one
        await supabase.from('parent_students').delete().eq('parent_id', userId);
      }

      if (selectedStudents.length > 0) {
        const studentLinks = selectedStudents.map(studentId => ({
          parent_id: userId,
          student_id: studentId
        }));
        await supabase.from('parent_students').insert(studentLinks);
      }

      if (licensePlate) {
        if (editingGuardianId) {
          await supabase.from('vehicles').delete().eq('parent_id', userId);
        }
        await supabase.from('vehicles').insert({
          parent_id: userId,
          license_plate: licensePlate,
          description: vehicleDesc,
          tenant_id: profile?.tenant_id
        });
      }

      setIsModalOpen(false);
      resetForm();
      fetchGuardians();
    } catch (error: any) {
      alert("Error: " + error.message);
    } finally {
      setProcessing(false);
    }
  };

  const requestDelete = (id: string, name: string) => {
    setConfirmModal({ isOpen: true, id, name });
  };

  const executeDelete = async () => {
    const id = confirmModal.id;
    if (!id) return;

    setConfirmModal({ isOpen: false, id: null, name: '' });
    setProcessing(true);
    
    try {
      // Delete from parent_students first
      await supabase.from('parent_students').delete().eq('parent_id', id);
      
      // Delete from vehicles
      await supabase.from('vehicles').delete().eq('parent_id', id);
      
      // Delete profile via API
      const res = await apiFetch(`/api/parents/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Failed to delete parent');
      
      fetchGuardians();
    } catch (error: any) {
      alert("Error al eliminar: " + error.message);
    } finally {
      setProcessing(false);
    }
  };

  const resetForm = () => {
    setFirstName(''); setLastName(''); setEmail(''); setPassword('');
    setPhone(''); setPinCode(''); setPhotoPayload('');
    setSelectedStudents([]); setExtraTutorName(''); setExtraTutorPhone('');
    setLicensePlate(''); setVehicleDesc('');
    setReplacements([]); setNewRepName(''); setNewRepPhone('');
    setEditingGuardianId(null);
    setStudentSearchTerm('');
  };

  const filteredGuardians = guardians.filter(g =>
    `${g.first_name} ${g.last_name}`.toLowerCase().includes(searchTerm.toLowerCase()) ||
    g.email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <>
      <TopNav title="SafePickup" subtitle="Gestión de Familias" />

      <div className="p-6 max-w-7xl mx-auto space-y-6 w-full font-body">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div>
            <h1 className="text-2xl font-black text-primary tracking-tight">Directorio de Padres</h1>
            <p className="text-sm text-slate-500 font-medium">Control de accesos y vínculos familiares.</p>
          </div>
          <div className="flex flex-wrap lg:flex-nowrap items-center gap-3 w-full lg:w-auto">
            <div className="flex bg-slate-100 p-1 rounded-xl shrink-0">
              <button onClick={() => setViewMode('grid')} className={`p-2 rounded-lg transition-all ${viewMode === 'grid' ? 'bg-white shadow-sm text-primary' : 'text-slate-400'}`}>
                <LayoutGrid className="w-4 h-4" />
              </button>
              <button onClick={() => setViewMode('table')} className={`p-2 rounded-lg transition-all ${viewMode === 'table' ? 'bg-white shadow-sm text-primary' : 'text-slate-400'}`}>
                <List className="w-4 h-4" />
              </button>
            </div>

            <div className="relative group flex-1 md:flex-none">
              <input
                type="text"
                placeholder="Buscar padre..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm outline-none w-full md:w-64 shadow-sm"
              />
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            </div>

            <input 
              type="file" 
              accept=".csv" 
              className="hidden" 
              ref={csvRef} 
              onChange={handleCSVImport} 
            />
            
            <button 
              onClick={handleExportCSV} 
              className="flex items-center gap-2 bg-surface-container-high text-primary px-4 py-2 rounded-xl font-bold text-sm hover:bg-surface-variant transition-colors shadow-sm"
            >
              <FileSpreadsheet className="w-4 h-4" />
              Exportar
            </button>
            
            <button 
              onClick={handleDownloadTemplate} 
              className="flex items-center gap-2 bg-surface-container-high text-primary px-4 py-2 rounded-xl font-bold text-sm hover:bg-surface-variant transition-colors shadow-sm"
            >
              <Download className="w-4 h-4" />
              Plantilla
            </button>
            
            <button 
              onClick={() => csvRef.current?.click()} 
              className="flex items-center gap-2 bg-secondary text-white px-4 py-2 rounded-xl font-bold text-sm hover:bg-secondary/90 transition-colors shadow-md"
            >
              <Upload className="w-4 h-4" />
              Importar
            </button>

            <button
              onClick={() => setIsModalOpen(true)}
              className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-xl font-bold text-sm hover:bg-primary-container transition-all shadow-lg"
            >
              <UserPlus className="w-4 h-4" />
              Nuevo
            </button>
          </div>
        </div>

        {/* Directory View */}
        {loading ? (
          <div className="col-span-full py-20 text-center">
            <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto" />
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredGuardians.map((guardian) => (
              <div key={guardian.id} className="bg-white rounded-[2.5rem] p-6 shadow-sm border border-slate-50 hover:shadow-xl transition-all duration-300 group relative">
                <div className="flex items-start gap-4 mb-6">
                  <div className="relative">
                    <img
                      src={guardian.photo_url || "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100"}
                      alt={guardian.first_name}
                      className="w-16 h-16 rounded-[1.25rem] object-cover border-2 border-slate-50 shadow-md group-hover:scale-105 transition-transform"
                    />
                    <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-500 border-2 border-white rounded-full"></div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-black text-slate-900 truncate leading-none mb-1">{guardian.first_name} {guardian.last_name}</h3>
                    <div className="flex flex-wrap gap-1 mt-2">
                      <span className="bg-primary/5 text-primary px-2 py-0.5 rounded-lg text-[9px] font-black flex items-center gap-1">
                        PIN: {guardian.pin_code || '---'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="space-y-2 mb-4">
                  <div className="flex items-center gap-3 text-[11px] text-slate-500 font-bold truncate">
                    <Mail className="w-3.5 h-3.5 text-indigo-400" />
                    {guardian.email}
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-slate-500 font-bold">
                    <Phone className="w-3.5 h-3.5 text-indigo-400" />
                    {guardian.phone}
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-50">
                  <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest block mb-1.5">Alumnos Vinculados</span>
                  <div className="flex flex-wrap gap-1.5">
                    {guardian.parent_students?.map((ps: any) => (
                      <span key={ps.students.id} className="bg-slate-50 text-slate-600 px-2 py-1 rounded-lg text-[9px] font-bold border border-slate-100">
                        {ps.students.first_name}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                  <button onClick={() => handleEdit(guardian)} className="p-2 bg-indigo-50 text-indigo-600 rounded-xl hover:bg-primary hover:text-white transition-all shadow-sm">
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => requestDelete(guardian.id, `${guardian.first_name} ${guardian.last_name}`)} className="p-2 bg-rose-50 text-rose-600 rounded-xl hover:bg-rose-600 hover:text-white transition-all shadow-sm">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-[2.5rem] shadow-sm border border-slate-50 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm min-w-[800px]">
              <thead className="bg-slate-50 text-slate-400 font-black text-[10px] uppercase tracking-widest">
                <tr>
                  <th className="p-4">Nombre</th>
                  <th className="p-4">Email</th>
                  <th className="p-4">Teléfono</th>
                  <th className="p-4">PIN</th>
                  <th className="p-4">Alumnos</th>
                  <th className="p-4 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredGuardians.map(g => (
                  <tr key={g.id} className="hover:bg-slate-50/50">
                    <td className="p-4 font-bold text-slate-900">{g.first_name} {g.last_name}</td>
                    <td className="p-4 text-slate-500">{g.email}</td>
                    <td className="p-4 text-slate-500">{g.phone}</td>
                    <td className="p-4 font-black text-emerald-600">{g.pin_code}</td>
                    <td className="p-4">
                      <div className="flex flex-wrap gap-1">
                        {g.parent_students?.map((ps: any) => (
                          <span key={ps.students.id} className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded-lg text-[10px] font-bold">
                            {ps.students.first_name}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => handleEdit(g)} className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg"><Edit2 className="w-4 h-4" /></button>
                        <button onClick={() => requestDelete(g.id, `${g.first_name} ${g.last_name}`)} className="p-2 text-rose-600 hover:bg-rose-50 rounded-lg"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

        <ConfirmModal
          isOpen={confirmModal.isOpen}
          title="Eliminar Tutor"
          message={`¿Estás seguro de que deseas eliminar a ${confirmModal.name}? Esta acción eliminará su acceso y desvinculará a los alumnos asociados.`}
          onConfirm={executeDelete}
          onCancel={() => setConfirmModal({ isOpen: false, id: null, name: '' })}
          confirmText="Eliminar Tutor"
        />

        {/* Overlay de progreso de importación CSV */}
        {importProgress && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-primary/30 backdrop-blur-md">
            <div className="bg-white rounded-3xl w-full max-w-sm p-6 sm:p-8 shadow-2xl flex flex-col items-center text-center animate-in zoom-in-95">
              <Loader2 className="w-10 h-10 text-secondary animate-spin mb-4" />
              <h3 className="text-lg font-black text-primary mb-1">Importando padres...</h3>
              <p className="text-sm text-slate-500 mb-5">
                {importProgress.done} de {importProgress.total}
              </p>
              <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-secondary rounded-full transition-all duration-500 ease-out"
                  style={{
                    width: `${Math.min(100, Math.round((importProgress.done / importProgress.total) * 100))}%`,
                  }}
                />
              </div>
              <p className="text-xs text-slate-400 mt-3">No cierres esta pestaña</p>
            </div>
          </div>
        )}

        {/* REDESIGNED COMPACT MODAL */}
        {isModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-2 sm:p-4 bg-primary/30 backdrop-blur-md">
            <div className="bg-white rounded-3xl sm:rounded-[2.5rem] w-full max-w-3xl max-h-[95vh] sm:max-h-[90vh] overflow-hidden shadow-2xl flex flex-col animate-in zoom-in-95">
              {/* Sticky Header */}
              <div className="flex justify-between items-center p-5 sm:p-6 bg-slate-50 border-b border-slate-100 flex-shrink-0">
                <h2 className="text-lg sm:text-xl font-black text-primary tracking-tight">
                  {editingGuardianId ? 'Editar Padre' : 'Registro Familiar'}
                </h2>
                <button onClick={() => { setIsModalOpen(false); resetForm(); }} className="p-2 bg-white text-slate-400 hover:text-rose-500 rounded-xl shadow-sm transition-all hover:rotate-90">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Scrollable Form Body */}
              <form onSubmit={handleAddGuardian} className="p-4 sm:p-6 overflow-y-auto custom-scrollbar flex-1 space-y-6">
                {/* Row 1: Photo and Core Identity */}
                <div className="flex flex-col md:flex-row gap-4 sm:gap-6 items-start">
                  {/* Photo Component (1/3 width) */}
                  <div className="w-full md:w-1/3 group">
                    <div 
                      onClick={() => !photoPayload && photoMethod !== 'camera' && document.getElementById('fileInput')?.click()}
                      className={`w-full aspect-square rounded-2xl sm:rounded-[2.5rem] bg-slate-50 border-4 border-dashed border-slate-200 overflow-hidden flex items-center justify-center transition-all ${!photoPayload && photoMethod !== 'camera' ? 'hover:border-primary cursor-pointer' : ''}`}
                    >
                      {photoPayload ? (
                        <img src={photoPayload} alt="Preview" className="w-full h-full object-cover" />
                      ) : photoMethod === 'camera' ? (
                        <div className="relative w-full h-full group/cam">
                          <video ref={videoRef} autoPlay className="w-full h-full object-cover transform scale-x-[-1]" />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover/cam:opacity-100 transition-opacity">
                            <button type="button" onClick={takePhoto} className="bg-white text-primary px-4 py-2 rounded-xl font-black text-[10px] shadow-xl">CAPTURAR</button>
                          </div>
                        </div>
                      ) : (
                        <div className="text-center">
                          <Camera className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                          <p className="text-[10px] font-black text-slate-300 uppercase">Foto</p>
                        </div>
                      )}
                    </div>
                    
                    <div className="grid grid-cols-3 gap-1.5 mt-3">
                      <button type="button" onClick={() => { stopCamera(); setPhotoMethod('url'); }} className={`py-2 rounded-xl border text-[9px] font-black transition-all ${photoMethod === 'url' ? 'bg-primary text-white border-primary' : 'bg-white text-slate-400 border-slate-100'}`}>URL</button>
                      <button type="button" onClick={() => { stopCamera(); document.getElementById('fileInput')?.click(); setPhotoMethod('file'); }} className={`py-2 rounded-xl border text-[9px] font-black transition-all ${photoMethod === 'file' ? 'bg-primary text-white border-primary' : 'bg-white text-slate-400 border-slate-100'}`}>FILE</button>
                      <button type="button" onClick={startCamera} className={`py-2 rounded-xl border text-[9px] font-black transition-all ${photoMethod === 'camera' ? 'bg-primary text-white border-primary' : 'bg-white text-slate-400 border-slate-100'}`}>CAM</button>
                    </div>
                  </div>

                  {/* Core Fields (2/3 width) */}
                  <div className="flex-1 w-full space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Nombre</label>
                        <input required value={firstName} onChange={e => setFirstName(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-2.5 text-sm outline-none focus:border-primary transition-all" />
                      </div>
                      <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Apellido</label>
                        <input required value={lastName} onChange={e => setLastName(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-2.5 text-sm outline-none focus:border-primary transition-all" />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">WhatsApp</label>
                        <input required value={phone} onChange={e => setPhone(e.target.value)} placeholder="+507..." className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-2.5 text-sm outline-none focus:border-primary transition-all" />
                      </div>
                      <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">PIN Secreto</label>
                        <input required maxLength={4} value={pinCode} onChange={e => setPinCode(e.target.value)} placeholder="0000" className="w-full bg-slate-50 border border-emerald-100 rounded-2xl px-4 py-2.5 text-sm font-black text-center tracking-widest outline-none focus:border-emerald-500 transition-all" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Correo Electrónico (Acceso)</label>
                      <input required readOnly={!!editingGuardianId} type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-2.5 text-sm outline-none read-only:bg-slate-100 transition-all" />
                    </div>
                    {editingGuardianId ? (
                      <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Cambiar Contraseña <span className="text-[9px] text-slate-400 font-normal lowercase tracking-normal ml-2">(opcional, dejar en blanco para no cambiarla)</span></label>
                        <input type="password" minLength={6} value={password} onChange={e => setPassword(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-2.5 text-sm outline-none focus:border-primary transition-all" />
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500 bg-indigo-50/50 border border-indigo-100 rounded-2xl px-4 py-3">
                        Se le enviará un correo de invitación a este padre para que active su acceso — no hace falta definir una contraseña aquí.
                      </p>
                    )}
                  </div>
                </div>

                {/* Section: Student Linking */}
                <div className="bg-slate-50/50 p-6 rounded-3xl border border-slate-100 flex flex-col">
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4">
                        <h4 className="text-[10px] font-black text-indigo-500 uppercase tracking-widest shrink-0">Vincular Estudiantes</h4>
                        <div className="relative w-full sm:w-64 shrink-0">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input 
                        type="text" 
                        placeholder="Buscar alumno..." 
                        value={studentSearchTerm}
                        onChange={(e) => setStudentSearchTerm(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all shadow-sm"
                      />
                    </div>
                  </div>
                  
                  {/* Selected count badges if needed could go here, or we emphasize selection via UI */}
                  {selectedStudents.length > 0 && (
                    <div className="mb-3 flex flex-wrap gap-1.5">
                      {selectedStudents.map(id => {
                        const s = students.find(st => st.id === id);
                        return s ? (
                          <div key={`sel-${id}`} className="bg-indigo-100 text-indigo-700 px-2 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5">
                            {s.first_name} {s.last_name}
                            <button type="button" onClick={() => setSelectedStudents(prev => prev.filter(sid => sid !== id))} className="text-indigo-400 hover:text-indigo-900">
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ) : null;
                      })}
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-[200px] overflow-y-auto pr-2 custom-scrollbar bg-white p-2 rounded-2xl border border-slate-100">
                    {students
                      .filter(s => `${s.first_name} ${s.last_name}`.toLowerCase().includes(studentSearchTerm.toLowerCase()))
                      .map(s => {
                      const isSel = selectedStudents.includes(s.id);
                      return (
                        <button
                          key={s.id} type="button"
                          onClick={() => setSelectedStudents(prev => isSel ? prev.filter(id => id !== s.id) : [...prev, s.id])}
                          className={`flex items-center gap-2 p-3 sm:p-2 rounded-xl border text-left transition-all ${isSel ? 'bg-indigo-600 border-indigo-600 text-white shadow-lg shadow-indigo-100' : 'bg-white border-slate-100 text-slate-600 hover:border-slate-200'}`}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] sm:text-[10px] font-black truncate">{s.first_name} {s.last_name}</p>
                            <p className={`text-[9px] sm:text-[8px] font-medium ${isSel ? 'text-indigo-100' : 'text-slate-400'}`}>{s.grade}</p>
                          </div>
                          {isSel && <CheckCircle2 className="w-4 h-4 sm:w-3 sm:h-3 text-white" />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Section: Additional Tutor */}
                <div className="bg-emerald-50/20 p-6 rounded-3xl border border-emerald-100/30">
                  <div className="flex justify-between items-center mb-4">
                    <h4 className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">Reemplazos Autorizados (QR)</h4>
                  </div>
                  
                  <div className="space-y-3 mb-4">
                    {replacements.map((rep, idx) => (
                      <div key={idx} className="bg-white p-3 rounded-2xl border border-emerald-100 flex justify-between items-center">
                        <div>
                          <p className="text-xs font-black text-slate-800">{rep.name}</p>
                          <p className="text-[10px] text-slate-400 font-bold">{rep.phone}</p>
                        </div>
                        <button 
                          type="button"
                          onClick={() => setReplacements(prev => prev.filter((_, i) => i !== idx))}
                          className="p-2 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <input 
                      value={newRepName} 
                      onChange={e => setNewRepName(e.target.value)} 
                      placeholder="Nombre del reemplazo" 
                      className="w-full bg-white border border-emerald-50 rounded-2xl px-4 py-2.5 text-sm outline-none focus:border-emerald-500 transition-all font-medium" 
                    />
                    <div className="flex gap-2">
                      <input 
                        value={newRepPhone} 
                        onChange={e => setNewRepPhone(e.target.value)} 
                        placeholder="WhatsApp" 
                        className="flex-1 bg-white border border-emerald-50 rounded-2xl px-4 py-2.5 text-sm outline-none focus:border-emerald-500 transition-all font-medium" 
                      />
                      <button 
                        type="button"
                        onClick={() => {
                          if (!newRepName || !newRepPhone) return;
                          setReplacements([...replacements, { 
                            name: newRepName, 
                            phone: newRepPhone, 
                            token: crypto.randomUUID().slice(0, 8),
                            created_at: new Date().toISOString()
                          }]);
                          setNewRepName('');
                          setNewRepPhone('');
                        }}
                        className="bg-emerald-600 text-white p-2.5 rounded-xl hover:bg-emerald-700 transition-all shadow-md"
                      >
                        <Plus className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Section: Vehicle */}
                <div className="grid grid-cols-2 gap-4 pb-4">
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Placa Vehículo</label>
                    <input value={licensePlate} onChange={e => setLicensePlate(e.target.value)} placeholder="XXX-000" className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-2.5 text-sm font-black uppercase outline-none focus:border-primary" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Descripción</label>
                    <input value={vehicleDesc} onChange={e => setVehicleDesc(e.target.value)} placeholder="Ej. Sedan Blanco" className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-2.5 text-sm outline-none focus:border-primary" />
                  </div>
                </div>

                {/* Sticky-ish Footer Buttons */}
                <div className="flex gap-4 pt-4 border-t border-slate-100">
                  <button type="button" onClick={() => { setIsModalOpen(false); resetForm(); }} className="flex-1 bg-slate-100 text-slate-600 font-black py-4 rounded-3xl hover:bg-slate-200 transition-all text-[11px] uppercase tracking-widest">Cancelar</button>
                  <button type="submit" disabled={processing} className="flex-[2] bg-primary text-white font-black py-4 rounded-3xl hover:bg-primary/90 transition-all shadow-xl shadow-primary/20 disabled:opacity-50 flex items-center justify-center gap-3 text-[11px] uppercase tracking-widest">
                    {processing ? <Loader2 className="w-5 h-5 animate-spin" /> : (editingGuardianId ? 'GUARDAR CAMBIOS' : 'REGISTRAR FAMILIA')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>

      <canvas ref={canvasRef} className="hidden" />
      <input
        id="fileInput" type="file" accept="image/*"
        className="hidden" onChange={handleFileUpload}
      />
    </>
  );
}
