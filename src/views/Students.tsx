import React, { useState, useEffect, useRef } from 'react';
import { supabase, logActivity } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { TopNav } from '../components/TopNav';
import { 
  Users, UserPlus, Search, Filter, X, 
  GraduationCap, BookOpen, Layers, Camera, 
  Upload, Download, Trash2, Edit2, CheckCircle2, Image as ImageIcon
} from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

export function Students() {
  const { t } = useLanguage();
  const { profile } = useAuth() as any;
  const [students, setStudents] = useState<any[]>([]);
  const [filteredStudents, setFilteredStudents] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [gradeFilter, setGradeFilter] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [currentStudentId, setCurrentStudentId] = useState<string | null>(null);

  // Form State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [grade, setGrade] = useState('');
  const [section, setSection] = useState('');
  const [photoPayload, setPhotoPayload] = useState('');
  const [photoFile, setPhotoFile] = useState<File | Blob | null>(null);
  const [photoMode, setPhotoMode] = useState<'url' | 'upload' | 'camera'>('url');
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [schoolGrades, setSchoolGrades] = useState<any[]>([]);

  const csvRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    fetchStudents();
    fetchSchoolGrades();

    const channel = supabase
      .channel('public:students')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'students' }, () => {
        fetchStudents();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      stopCamera();
    };
  }, [profile?.tenant_id]);

  useEffect(() => {
    const term = searchTerm.toLowerCase();
    const filtered = students.filter(s => {
      const matchesSearch =
        `${s.first_name} ${s.last_name}`.toLowerCase().includes(term) ||
        s.grade?.toLowerCase().includes(term) ||
        s.section?.toLowerCase().includes(term);
      const matchesGrade = gradeFilter === 'all' || s.grade === gradeFilter;
      return matchesSearch && matchesGrade;
    });
    setFilteredStudents(filtered);
  }, [searchTerm, gradeFilter, students]);

  // Orden de grados: el de school_grades (level_order) primero; cualquier
  // valor de `students.grade` que no tenga fila en school_grades (datos
  // viejos/sueltos) se agrega al final, ordenado alfabéticamente, para que
  // nunca desaparezca un alumno de la vista agrupada.
  const gradeOrder = schoolGrades.map(g => g.name);
  const knownGrades = new Set(gradeOrder);
  const extraGrades = Array.from(new Set(students.map(s => s.grade).filter(g => g && !knownGrades.has(g)))).sort();
  const orderedGrades = [...gradeOrder, ...extraGrades];

  const groupedStudents = orderedGrades
    .map(g => ({ grade: g, list: filteredStudents.filter(s => s.grade === g) }))
    .filter(group => group.list.length > 0);
  // Alumnos sin grado asignado, si los hay dentro del filtro actual.
  const noGradeList = filteredStudents.filter(s => !s.grade);
  if (noGradeList.length > 0) groupedStudents.push({ grade: '', list: noGradeList });

  const fetchStudents = async () => {
    if (!profile?.tenant_id) return;
    const { data, error } = await supabase
      .from('students')
      .select('*')
      .eq('tenant_id', profile.tenant_id)
      .order('last_name', { ascending: true });

    if (error) {
      console.error('Error fetching students:', error);
    } else {
      setStudents(data || []);
    }
  };

  const fetchSchoolGrades = async () => {
    if (!profile?.tenant_id) return;
    const { data } = await supabase
      .from('school_grades')
      .select('*')
      .eq('tenant_id', profile.tenant_id)
      .order('level_order', { ascending: true });
    if (data) {
      setSchoolGrades(data);
    }
  };

  // Camera Logic
  const startCamera = async () => {
    setPhotoMode('camera');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      setCameraStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      alert("No se pudo acceder a la cámara. Revisa los permisos del navegador.");
    }
  };

  const stopCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
  };

  const takePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const context = canvasRef.current.getContext('2d');
      if (context) {
        canvasRef.current.width = videoRef.current.videoWidth;
        canvasRef.current.height = videoRef.current.videoHeight;
        context.drawImage(videoRef.current, 0, 0, canvasRef.current.width, canvasRef.current.height);
        
        // Setup payload for preview
        const dataUrl = canvasRef.current.toDataURL('image/jpeg', 0.8);
        setPhotoPayload(dataUrl);

        // Setup File payload for upload
        canvasRef.current.toBlob((blob) => {
          if (blob) setPhotoFile(blob);
        }, 'image/jpeg', 0.8);

        stopCamera();
      }
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPhotoFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setPhotoPayload(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSaveStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    let finalPhotoUrl = photoPayload;

    if (photoFile && profile?.tenant_id && (photoMode === 'upload' || photoMode === 'camera')) {
      const fileExt = photoFile instanceof File ? photoFile.name.split('.').pop() : 'jpeg';
      const fileName = `student_${Date.now()}.${fileExt}`;
      const filePath = `${profile.tenant_id}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, photoFile);

      if (uploadError) {
        console.error("Error subiendo:", uploadError);
        alert('Error al subir la imagen: ' + uploadError.message);
        setIsSubmitting(false);
        return;
      }

      const { data: publicUrlData } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);

      finalPhotoUrl = publicUrlData.publicUrl;
    }

    const studentData = {
      first_name: firstName,
      last_name: lastName,
      grade,
      section,
      photo_url: finalPhotoUrl,
      tenant_id: profile?.tenant_id
    };

    if (isEditing && currentStudentId) {
      const { error } = await supabase
        .from('students')
        .update(studentData)
        .eq('id', currentStudentId);
      
      if (error) {
        alert('Error updating student: ' + error.message);
      } else {
        await logActivity(
          'SECURITY',
          `ALUMNO ACTUALIZADO: ${firstName} ${lastName}`,
          profile?.first_name || 'Admin',
          { student_id: currentStudentId, student_name: `${firstName} ${lastName}` },
          profile?.tenant_id
        );
        setIsEditing(false);
      }
    } else {
      const { data, error } = await supabase
        .from('students')
        .insert([studentData])
        .select()
        .single();
      
      if (error) {
        alert('Error adding student: ' + error.message);
      } else {
        await logActivity(
          'SECURITY',
          `NUEVO ALUMNO CREADO: ${firstName} ${lastName}`,
          profile?.first_name || 'Admin',
          { student_id: data.id, student_name: `${firstName} ${lastName}` },
          profile?.tenant_id
        );
      }
    }

    setIsSubmitting(false);
    closeAndResetModal();
    fetchStudents();
  };

  const handleEdit = (student: any) => {
    setFirstName(student.first_name);
    setLastName(student.last_name);
    setGrade(student.grade || '');
    setSection(student.section || '');
    setPhotoPayload(student.photo_url || '');
    setCurrentStudentId(student.id);
    setIsEditing(true);
    setShowModal(true);
  };

  const handleDelete = async (student: any) => {
    if (confirm('¿Estás seguro de que deseas eliminar este alumno?')) {
      const { error } = await supabase
        .from('students')
        .delete()
        .eq('id', student.id);
      
      if (error) {
        alert('Error deleting student: ' + error.message);
      } else {
        await logActivity(
          'SECURITY',
          `ALUMNO ELIMINADO: ${student.first_name} ${student.last_name}`,
          profile?.first_name || 'Admin',
          { student_id: student.id, student_name: `${student.first_name} ${student.last_name}` },
          profile?.tenant_id
        );
        fetchStudents();
      }
    }
  };

  const closeAndResetModal = () => {
    setShowModal(false);
    setIsEditing(false);
    setFirstName('');
    setLastName('');
    setGrade('');
    setSection('');
    setPhotoPayload('');
    setPhotoFile(null);
    setPhotoMode('url');
    setCurrentStudentId(null);
    stopCamera();
  };

  const handleCsvImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target?.result as string;
      const rows = text.split('\n').map(r => r.trim()).filter(r => r);
      const studentsToInsert = [];
      
      for (const row of rows) {
        const cols = row.split(',');
        const first_name = cols[0]?.trim();
        const last_name = cols[1]?.trim();
        const grade = cols[2]?.trim();
        const section = cols[3]?.trim();

        if (first_name.toLowerCase() === 'first_name' || !first_name) continue;
        
        studentsToInsert.push({
          first_name,
          last_name: last_name || '',
          grade: grade || '',
          section: section || '',
          tenant_id: profile?.tenant_id
        });
      }

      if (studentsToInsert.length > 0) {
        const { error } = await supabase.from('students').insert(studentsToInsert);
        if (error) {
          alert('Error importing CSV: ' + error.message);
        } else {
          alert(`¡Importación exitosa de ${studentsToInsert.length} alumnos!`);
          fetchStudents();
        }
      } else {
        alert('El archivo CSV no contiene registros válidos.');
      }
      
      if (csvRef.current) csvRef.current.value = '';
    };
    reader.readAsText(file);
  };

  const handleDownloadTemplate = () => {
    const csvContent = "data:text/csv;charset=utf-8,first_name,last_name,grade,section\nJuan,Pérez,1ero,A\nMaria,García,2do,B\n";
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "plantilla_alumnos.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <>
      <TopNav title="SafePickup" subtitle={t('students.title')} />
      
      <div className="p-6 max-w-7xl mx-auto space-y-6 w-full relative font-body">
        {/* Header & Quick Actions */}
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div>
            <h1 className="text-2xl font-black text-primary tracking-tight">{t('students.title')}</h1>
            <p className="text-sm text-slate-500 font-medium">{t('students.subtitle')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 w-full lg:w-auto">
            <div className="relative group flex-1 sm:flex-none">
              <input 
                type="text" 
                placeholder="Buscar alumno..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 pr-4 py-2 bg-surface-container-low border border-outline-variant/20 rounded-xl text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none w-full sm:w-64 transition-all"
              />
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            </div>
            
            <input 
              type="file" 
              accept=".csv" 
              className="hidden" 
              ref={csvRef} 
              onChange={handleCsvImport} 
            />
            
            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto mt-2 sm:mt-0">
              <button 
                onClick={handleDownloadTemplate} 
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-surface-container-high text-primary px-3 sm:px-4 py-2 rounded-xl font-bold text-[10px] sm:text-sm hover:bg-surface-variant transition-colors shadow-sm"
              >
                <Download className="w-4 h-4" />
                <span className="hidden sm:inline">Plantilla</span>
              </button>
              
              <button 
                onClick={() => csvRef.current?.click()} 
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-secondary text-white px-3 sm:px-4 py-2 rounded-xl font-bold text-[10px] sm:text-sm hover:bg-secondary/90 transition-colors shadow-md"
              >
                <Upload className="w-4 h-4" />
                Importar
              </button>
              
              <button 
                onClick={() => setShowModal(true)} 
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-primary text-white px-3 sm:px-4 py-2 rounded-xl font-bold text-[10px] sm:text-sm hover:bg-primary-container transition-colors shadow-md"
              >
                <UserPlus className="w-4 h-4" />
                {t('students.addStudent')}
              </button>
            </div>
          </div>
        </div>

        {/* Filtro rápido por grado */}
        {orderedGrades.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            <button
              onClick={() => setGradeFilter('all')}
              className={`shrink-0 px-4 py-2 rounded-full text-xs font-black uppercase tracking-widest transition-all ${
                gradeFilter === 'all' ? 'bg-primary text-white shadow-md' : 'bg-white text-slate-400 border border-slate-200 hover:text-primary'
              }`}
            >
              Todos ({students.length})
            </button>
            {orderedGrades.map(g => {
              const count = students.filter(s => s.grade === g).length;
              if (count === 0) return null;
              return (
                <button
                  key={g}
                  onClick={() => setGradeFilter(g)}
                  className={`shrink-0 px-4 py-2 rounded-full text-xs font-black uppercase tracking-widest transition-all ${
                    gradeFilter === g ? 'bg-primary text-white shadow-md' : 'bg-white text-slate-400 border border-slate-200 hover:text-primary'
                  }`}
                >
                  {g} ({count})
                </button>
              );
            })}
          </div>
        )}

        {/* Students List */}
        <div className="bg-surface-container-lowest rounded-[2rem] shadow-sm border border-outline-variant/10 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 border-b border-slate-100">
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('students.firstName')}</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('students.lastName')}</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('students.grade')}</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('students.section')}</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filteredStudents.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-slate-400 font-bold">
                      {t('students.noStudents')}
                    </td>
                  </tr>
                ) : (
                  groupedStudents.map(group => (
                    <React.Fragment key={group.grade || '__sin_grado__'}>
                      <tr className="bg-slate-100/70">
                        <td colSpan={5} className="px-6 py-2 text-[10px] font-black text-slate-500 uppercase tracking-widest">
                          {group.grade || 'Sin grado asignado'} · {group.list.length} alumno{group.list.length !== 1 ? 's' : ''}
                        </td>
                      </tr>
                      {group.list.map((student) => (
                        <tr key={student.id} className="hover:bg-slate-50/80 transition-colors group">
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              {student.photo_url ? (
                                <img
                                  src={student.photo_url}
                                  alt={student.first_name}
                                  className="w-10 h-10 rounded-full object-cover border border-slate-200"
                                />
                              ) : (
                                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs uppercase border border-primary/5">
                                  {student.first_name[0]}
                                </div>
                              )}
                              <span className="font-bold text-primary">{student.first_name}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 font-medium text-slate-600">{student.last_name}</td>
                          <td className="px-6 py-4">
                            <span className="bg-secondary-container/30 text-secondary px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap">
                              {student.grade || 'N/A'}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <span className="bg-tertiary-container/30 text-tertiary px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap">
                              {student.section || 'N/A'}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={() => handleEdit(student)}
                                className="p-2 hover:bg-primary/10 rounded-lg text-primary transition-colors"
                                title="Editar"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDelete(student)}
                                className="p-2 hover:bg-error/10 rounded-lg text-error transition-colors"
                                title="Eliminar"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Stats / Insights */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-primary text-white p-8 rounded-[2rem] shadow-xl relative overflow-hidden group">
            <div className="relative z-10">
              <h3 className="text-lg font-bold mb-1">Total Alumnos</h3>
              <p className="text-5xl font-black">{students.length}</p>
              <div className="mt-4 flex items-center gap-2 text-[10px] font-black uppercase tracking-wider bg-white/10 w-fit px-3 py-1 rounded-full border border-white/20">
                <CheckCircle2 className="w-3 h-3" />
                Matrícula Activa 2026
              </div>
            </div>
            <Users className="absolute -bottom-8 -right-8 w-40 h-40 text-white/10 rotate-12 group-hover:scale-110 transition-transform" />
          </div>

          <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-outline-variant/10 flex flex-col justify-between">
            <div>
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Distribución Grados</h3>
              <p className="text-sm font-bold text-primary">Análisis de capacidad por nivel</p>
            </div>
            <div className="mt-6 flex items-end gap-2 h-16">
              {[40, 70, 45, 90, 60, 80].map((h, i) => (
                <div key={i} className="flex-1 bg-secondary/10 rounded-t-lg relative group">
                  <div 
                    className="absolute bottom-0 w-full bg-secondary/40 rounded-t-lg transition-all duration-700 group-hover:bg-secondary" 
                    style={{ height: `${h}%` }}
                  ></div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-outline-variant/10">
            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Accesos Directos</h3>
            <div className="grid grid-cols-2 gap-3">
              <button className="flex items-center gap-2.5 p-3 rounded-2xl bg-surface-container-low hover:bg-surface-container-high transition-colors text-xs font-bold text-primary border border-outline-variant/10 shadow-sm">
                <GraduationCap className="w-4 h-4 text-secondary" />
                Reporte Notas
              </button>
              <button className="flex items-center gap-2.5 p-3 rounded-2xl bg-surface-container-low hover:bg-surface-container-high transition-colors text-xs font-bold text-primary border border-outline-variant/10 shadow-sm">
                <BookOpen className="w-4 h-4 text-secondary" />
                Asistencia
              </button>
              <button className="flex items-center gap-2.5 p-3 rounded-2xl bg-surface-container-low hover:bg-surface-container-high transition-colors text-xs font-bold text-primary border border-outline-variant/10 shadow-sm">
                <Layers className="w-4 h-4 text-secondary" />
                Secciones
              </button>
              <button className="flex items-center gap-2.5 p-3 rounded-2xl bg-surface-container-low hover:bg-surface-container-high transition-colors text-xs font-bold text-primary border border-outline-variant/10 shadow-sm">
                <Filter className="w-4 h-4 text-secondary" />
                Filtros
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Modal Add/Edit Student */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-md z-[100] flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-[3rem] w-full max-w-5xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 my-8 border border-white/20">
            <div className="p-10 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
              <div>
                <h2 className="text-3xl font-black text-primary tracking-tight">
                  {isEditing ? 'Editar Alumno' : 'Nuevo Alumno'}
                </h2>
                <p className="text-sm text-slate-500 font-medium mt-1">Completa el perfil académico</p>
              </div>
              <button type="button" onClick={closeAndResetModal} className="p-4 hover:bg-slate-200 rounded-full transition-colors group">
                <X className="w-7 h-7 text-slate-400 group-hover:text-slate-600 transition-colors" />
              </button>
            </div>
            
            <form onSubmit={handleSaveStudent} className="p-6 md:p-10 flex flex-col md:flex-row gap-6 md:gap-10">
              
              {/* Photo Section */}
              <div className="w-full md:w-80 flex-shrink-0 space-y-4">
                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Fotografía</h3>
                
                <div className="p-1 bg-surface-container rounded-2xl flex gap-1">
                  <button type="button" onClick={() => { setPhotoMode('url'); stopCamera(); }} className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-[10px] font-black uppercase rounded-xl transition-all ${photoMode === 'url' ? 'bg-white text-primary shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                    <Layers className="w-3 h-3" /> URL
                  </button>
                  <button type="button" onClick={() => { setPhotoMode('upload'); stopCamera(); }} className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-[10px] font-black uppercase rounded-xl transition-all ${photoMode === 'upload' ? 'bg-white text-primary shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                    <Upload className="w-3 h-3" /> Archivo
                  </button>
                  <button type="button" onClick={startCamera} className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-[10px] font-black uppercase rounded-xl transition-all ${photoMode === 'camera' ? 'bg-white text-primary shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                    <Camera className="w-3 h-3" /> Cámara
                  </button>
                </div>

                <div className="aspect-[4/5] bg-surface-container-low rounded-3xl overflow-hidden border-2 border-dashed border-outline-variant/30 relative group flex items-center justify-center">
                  {photoMode === 'url' && (
                    <div className="p-6 w-full flex flex-col gap-3">
                      <div className="w-20 h-20 bg-primary/5 rounded-full flex items-center justify-center mx-auto mb-2 group-hover:scale-110 transition-transform">
                        <Layers className="w-10 h-10 text-primary/20" />
                      </div>
                      <input 
                        value={photoPayload} 
                        onChange={e => setPhotoPayload(e.target.value)} 
                        type="url" 
                        className="w-full bg-white border border-outline-variant/20 rounded-xl px-4 py-3 text-xs outline-none focus:border-primary focus:ring-4 focus:ring-primary/5 transition-all text-center" 
                        placeholder="Pega el enlace aquí..." 
                      />
                      {photoPayload && <img src={photoPayload} alt="Preview" className="absolute inset-0 w-full h-full object-cover" />}
                    </div>
                  )}

                  {photoMode === 'upload' && (
                    <div className="w-full h-full flex flex-col items-center justify-center relative cursor-hover">
                      {photoPayload ? (
                        <>
                          <img src={photoPayload} alt="Preview" className="absolute inset-0 w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <Upload className="w-8 h-8 text-white" />
                          </div>
                        </>
                      ) : (
                        <>
                          <Upload className="w-12 h-12 text-slate-300 mb-2" />
                          <p className="text-xs text-slate-400 font-bold">Subir archivo</p>
                        </>
                      )}
                      <input type="file" accept="image/*" onChange={handleFileUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                    </div>
                  )}

                  {photoMode === 'camera' && (
                    <div className="w-full h-full bg-black relative flex items-center justify-center">
                      {!photoPayload ? (
                        <>
                          <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
                          <button type="button" onClick={takePhoto} className="absolute bottom-6 bg-white text-primary p-4 rounded-full shadow-2xl hover:scale-110 active:scale-95 transition-all border-4 border-primary/10">
                            <Camera className="w-6 h-6" />
                          </button>
                        </>
                      ) : (
                        <>
                          <img src={photoPayload} alt="Captured" className="w-full h-full object-cover" />
                          <button type="button" onClick={() => { setPhotoPayload(''); startCamera(); }} className="absolute bottom-6 bg-white text-primary px-6 py-3 rounded-2xl font-black text-xs shadow-2xl hover:scale-105 active:scale-95 transition-all border-b-4 border-slate-200">
                            REPETIR FOTO
                          </button>
                        </>
                      )}
                      <canvas ref={canvasRef} className="hidden" />
                    </div>
                  )}
                </div>
                <p className="text-[10px] text-slate-400 font-medium text-center italic px-4">Utiliza una foto clara para facilitar la identificación.</p>
              </div>

              <div className="flex-1 space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">{t('students.firstName')}</label>
                    <input 
                      required 
                      value={firstName} 
                      onChange={e => setFirstName(e.target.value)} 
                      type="text" 
                      className="w-full bg-surface-container-low border border-outline-variant/20 rounded-[1.25rem] px-6 py-4 text-sm outline-none focus:border-primary focus:ring-4 focus:ring-primary/5 transition-all font-bold text-primary" 
                      placeholder="Eje. Mateo" 
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">{t('students.lastName')}</label>
                    <input 
                      required 
                      value={lastName} 
                      onChange={e => setLastName(e.target.value)} 
                      type="text" 
                      className="w-full bg-surface-container-low border border-outline-variant/20 rounded-[1.25rem] px-6 py-4 text-sm outline-none focus:border-primary focus:ring-4 focus:ring-primary/5 transition-all font-bold text-primary" 
                      placeholder="Eje. Ross" 
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">{t('students.grade')}</label>
                    <select 
                      required
                      value={grade}
                      onChange={e => setGrade(e.target.value)}
                      className="w-full bg-surface-container-low border border-outline-variant/20 rounded-[1.25rem] px-6 py-4 text-sm outline-none focus:border-primary focus:ring-4 focus:ring-primary/5 transition-all font-bold text-primary appearance-none cursor-pointer"
                    >
                      <option value="">Seleccionar grado</option>
                      {schoolGrades.length > 0 ? (
                        schoolGrades.map(g => (
                          <option key={g.id} value={g.name}>{g.name}</option>
                        ))
                      ) : (
                        <>
                          <option value="Maternal">Maternal</option>
                          <option value="Pre-K">Pre-K</option>
                          <option value="Kinder">Kinder</option>
                          <option value="1ero">1er Grado</option>
                          <option value="2do">2do Grado</option>
                          <option value="3ero">3er Grado</option>
                          <option value="4to">4to Grado</option>
                          <option value="5to">5to Grado</option>
                          <option value="6to">6to Grado</option>
                          <option value="7mo">7mo Grado</option>
                          <option value="8vo">8vo Grado</option>
                          <option value="9no">9no Grado</option>
                          <option value="10mo">10mo Grado</option>
                          <option value="11vo">11vo Grado</option>
                          <option value="12vo">12vo Grado</option>
                        </>
                      )}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">{t('students.section')}</label>
                    <input 
                      required 
                      value={section} 
                      onChange={e => setSection(e.target.value)} 
                      type="text" 
                      className="w-full bg-surface-container-low border border-outline-variant/20 rounded-[1.25rem] px-6 py-4 text-sm outline-none focus:border-primary focus:ring-4 focus:ring-primary/5 transition-all font-bold text-primary" 
                      placeholder="Eje. A" 
                    />
                  </div>
                </div>

                <div className="pt-10 flex border-t border-slate-100 justify-end gap-4">
                  <button 
                    type="button" 
                    onClick={closeAndResetModal} 
                    className="px-8 py-4 text-slate-500 font-bold text-sm hover:bg-slate-100 rounded-2xl transition-colors"
                  >
                    Descartar
                  </button>
                  <button 
                    type="submit" 
                    disabled={isSubmitting}
                    className="px-10 py-4 bg-primary text-white font-black text-sm hover:bg-primary-container rounded-2xl shadow-xl active:scale-[0.98] transition-all flex items-center gap-3 disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-5 h-5" />
                    {isSubmitting ? 'Subiendo...' : (isEditing ? 'Guardar Cambios' : t('students.save'))}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
