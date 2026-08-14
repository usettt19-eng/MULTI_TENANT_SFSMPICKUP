import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { DoorOpen, GraduationCap, Plus, Trash2, Save, AlertCircle, Link as LinkIcon, CheckCircle2 } from 'lucide-react';
import type { ExitDoor, SchoolGrade, GradeDoor } from '../../types/database';

export function SchoolStructureSettings() {
  const [doors, setDoors] = useState<ExitDoor[]>([]);
  const [grades, setGrades] = useState<SchoolGrade[]>([]);
  const [gradeDoors, setGradeDoors] = useState<GradeDoor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<{message: string, isRls?: boolean} | null>(null);

  // New item states
  const [newDoorName, setNewDoorName] = useState('');
  const [newDoorDesc, setNewDoorDesc] = useState('');
  const [newGradeName, setNewGradeName] = useState('');
  const [newGradeOrder, setNewGradeOrder] = useState(1);
  const [newGradeStage, setNewGradeStage] = useState<'primaria' | 'secundaria'>('primaria');
  const [newGradeExitTime, setNewGradeExitTime] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  const handleError = (err: any, context: string) => {
    console.error(context, err);
    if (err?.code === '42501') {
      setActionError({
        message: 'Error de permisos (RLS). Necesitas configurar las políticas de seguridad en Supabase para permitir insertar/modificar datos.',
        isRls: true
      });
    } else {
      setActionError({ message: `${context}: ${err.message || 'Error desconocido'}` });
    }
  };

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [doorsRes, gradesRes, gradeDoorsRes] = await Promise.all([
        supabase.from('exit_doors').select('*').order('name'),
        supabase.from('school_grades').select('*').order('level_order'),
        supabase.from('grade_doors').select('*')
      ]);

      if (doorsRes.error) throw doorsRes.error;
      if (gradesRes.error) throw gradesRes.error;
      if (gradeDoorsRes.error) throw gradeDoorsRes.error;

      setDoors(doorsRes.data || []);
      setGrades(gradesRes.data || []);
      setGradeDoors(gradeDoorsRes.data || []);
    } catch (err: any) {
      console.error('Error fetching structure data:', err);
      setError('Las tablas necesarias no existen. Por favor, ejecuta el script SQL de migración en Supabase.');
    } finally {
      setLoading(false);
    }
  };

  const handleAddDoor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDoorName.trim()) return;
    
    setSaving(true);
    setActionError(null);
    try {
      const { data, error } = await supabase
        .from('exit_doors')
        .insert([{ name: newDoorName, description: newDoorDesc }])
        .select()
        .single();
        
      if (error) throw error;
      setDoors([...doors, data]);
      setNewDoorName('');
      setNewDoorDesc('');
    } catch (err: any) {
      handleError(err, 'Error al añadir puerta');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteDoor = async (id: string) => {
    setActionError(null);
    try {
      const { error } = await supabase.from('exit_doors').delete().eq('id', id);
      if (error) throw error;
      setDoors(doors.filter(d => d.id !== id));
      setGradeDoors(gradeDoors.filter(gd => gd.door_id !== id));
    } catch (err: any) {
      handleError(err, 'Error al eliminar puerta');
    }
  };

  const handleAddGrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGradeName.trim()) return;

    setSaving(true);
    setActionError(null);
    try {
      const { data, error } = await supabase
        .from('school_grades')
        .insert([{
          name: newGradeName,
          level_order: newGradeOrder,
          stage: newGradeStage,
          exit_time: newGradeExitTime || null,
        }])
        .select()
        .single();

      if (error) throw error;
      setGrades([...grades, data].sort((a, b) => a.level_order - b.level_order));
      setNewGradeName('');
      setNewGradeOrder(grades.length > 0 ? Math.max(...grades.map(g => g.level_order)) + 1 : 1);
      setNewGradeExitTime('');
    } catch (err: any) {
      handleError(err, 'Error al añadir grado');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateGradeField = async (gradeId: string, field: 'stage' | 'exit_time', value: string) => {
    setActionError(null);
    const prev = grades;
    setGrades(grades.map(g => g.id === gradeId ? { ...g, [field]: value || null } as SchoolGrade : g));
    try {
      const { error } = await supabase
        .from('school_grades')
        .update({ [field]: value || null })
        .eq('id', gradeId);
      if (error) throw error;
    } catch (err: any) {
      setGrades(prev);
      handleError(err, 'Error al actualizar grado');
    }
  };

  const handleDeleteGrade = async (id: string) => {
    setActionError(null);
    try {
      const { error } = await supabase.from('school_grades').delete().eq('id', id);
      if (error) throw error;
      setGrades(grades.filter(g => g.id !== id));
      setGradeDoors(gradeDoors.filter(gd => gd.grade_id !== id));
    } catch (err: any) {
      handleError(err, 'Error al eliminar grado');
    }
  };

  const handleAssignDoor = async (gradeId: string, doorId: string) => {
    setActionError(null);
    try {
      // Check if assignment already exists
      const existing = gradeDoors.find(gd => gd.grade_id === gradeId && gd.door_id === doorId);
      
      if (existing) {
        // Remove assignment
        const { error } = await supabase.from('grade_doors').delete().eq('id', existing.id);
        if (error) throw error;
        setGradeDoors(gradeDoors.filter(gd => gd.id !== existing.id));
      } else {
        // Add assignment
        const { data, error } = await supabase
          .from('grade_doors')
          .insert([{ grade_id: gradeId, door_id: doorId }])
          .select()
          .single();
          
        if (error) throw error;
        setGradeDoors([...gradeDoors, data]);
      }
    } catch (err: any) {
      handleError(err, 'Error al actualizar asignación');
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-slate-500">Cargando configuración de estructura...</div>;
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-red-700 flex items-start gap-4">
        <AlertCircle className="w-6 h-6 flex-shrink-0 mt-1" />
        <div>
          <h3 className="font-bold text-lg mb-2">Faltan Tablas en la Base de Datos</h3>
          <p className="mb-4">{error}</p>
          <div className="bg-white p-4 rounded-xl border border-red-100 text-sm font-mono overflow-x-auto">
            <p className="font-bold mb-2 text-slate-800">Ejecuta este SQL en el editor de Supabase:</p>
            <pre className="text-xs text-slate-600">
{`CREATE TABLE IF NOT EXISTS exit_doors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS school_grades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    level_order INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS grade_doors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grade_id UUID REFERENCES school_grades(id) ON DELETE CASCADE,
    door_id UUID REFERENCES exit_doors(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(grade_id, door_id)
);`}
            </pre>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {actionError && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-red-700 flex items-start gap-4 animate-in fade-in slide-in-from-top-4">
          <AlertCircle className="w-6 h-6 flex-shrink-0 mt-1" />
          <div>
            <h3 className="font-bold text-lg mb-2">Error al procesar la acción</h3>
            <p className="mb-4">{actionError.message}</p>
            {actionError.isRls && (
              <div className="bg-white p-4 rounded-xl border border-red-100 text-sm font-mono overflow-x-auto">
                <p className="font-bold mb-2 text-slate-800">Ejecuta este SQL en el editor de Supabase para permitir acceso a los administradores:</p>
                <pre className="text-xs text-slate-600">
{`-- Habilitar RLS
ALTER TABLE exit_doors ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_grades ENABLE ROW LEVEL SECURITY;
ALTER TABLE grade_doors ENABLE ROW LEVEL SECURITY;

-- Políticas para lectura (todos los autenticados)
CREATE POLICY "Permitir lectura a usuarios autenticados" ON exit_doors FOR SELECT TO authenticated USING (true);
CREATE POLICY "Permitir lectura a usuarios autenticados" ON school_grades FOR SELECT TO authenticated USING (true);
CREATE POLICY "Permitir lectura a usuarios autenticados" ON grade_doors FOR SELECT TO authenticated USING (true);

-- Políticas para escritura (solo admins)
-- (Asumiendo que tienes una forma de verificar admins, o permitiendo a todos los autenticados temporalmente)
CREATE POLICY "Permitir escritura a usuarios autenticados" ON exit_doors FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Permitir escritura a usuarios autenticados" ON school_grades FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Permitir escritura a usuarios autenticados" ON grade_doors FOR ALL TO authenticated USING (true) WITH CHECK (true);
`}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* Exit Doors Section */}
        <section className="bg-white rounded-[2.5rem] p-8 border border-slate-100 shadow-sm">
          <h3 className="text-lg font-black text-slate-900 flex items-center gap-3 border-b border-slate-50 pb-4 mb-6">
            <DoorOpen className="w-5 h-5 text-indigo-500" /> Puertas de Salida
          </h3>
          
          <form onSubmit={handleAddDoor} className="mb-6 flex gap-3">
            <div className="flex-1 space-y-3">
              <input 
                required
                placeholder="Nombre de la puerta (ej. Puerta Principal)"
                value={newDoorName}
                onChange={e => setNewDoorName(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium outline-none focus:border-indigo-500 transition-all"
              />
              <input 
                placeholder="Descripción (opcional)"
                value={newDoorDesc}
                onChange={e => setNewDoorDesc(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium outline-none focus:border-indigo-500 transition-all"
              />
            </div>
            <button 
              type="submit"
              disabled={saving || !newDoorName.trim()}
              className="bg-indigo-600 text-white px-4 rounded-xl hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center justify-center h-[104px]"
            >
              <Plus className="w-5 h-5" />
            </button>
          </form>

          <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2">
            {doors.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-4">No hay puertas configuradas.</p>
            ) : (
              doors.map(door => (
                <div key={door.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                  <div>
                    <p className="font-bold text-slate-800">{door.name}</p>
                    {door.description && <p className="text-xs text-slate-500">{door.description}</p>}
                  </div>
                  <button 
                    onClick={() => handleDeleteDoor(door.id)}
                    className="p-2 text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Grades Section */}
        <section className="bg-white rounded-[2.5rem] p-8 border border-slate-100 shadow-sm">
          <h3 className="text-lg font-black text-slate-900 flex items-center gap-3 border-b border-slate-50 pb-4 mb-6">
            <GraduationCap className="w-5 h-5 text-amber-500" /> Grados Escolares
          </h3>
          
          <form onSubmit={handleAddGrade} className="mb-6 space-y-3">
            <div className="flex gap-3">
              <input
                required
                placeholder="Nombre (ej. 1er Grado)"
                value={newGradeName}
                onChange={e => setNewGradeName(e.target.value)}
                className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium outline-none focus:border-amber-500 transition-all"
              />
              <input
                type="number"
                required
                min="1"
                placeholder="Orden"
                value={newGradeOrder}
                onChange={e => setNewGradeOrder(parseInt(e.target.value) || 1)}
                className="w-20 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium outline-none focus:border-amber-500 transition-all text-center"
                title="Orden lógico (1 = Maternal, 2 = Pre-Kinder, etc.)"
              />
            </div>
            <div className="flex gap-3">
              <select
                value={newGradeStage}
                onChange={e => setNewGradeStage(e.target.value as 'primaria' | 'secundaria')}
                className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium outline-none focus:border-amber-500 transition-all"
              >
                <option value="primaria">Primaria</option>
                <option value="secundaria">Secundaria</option>
              </select>
              <input
                type="time"
                value={newGradeExitTime}
                onChange={e => setNewGradeExitTime(e.target.value)}
                title="Hora de salida"
                className="w-36 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium outline-none focus:border-amber-500 transition-all"
              />
              <button
                type="submit"
                disabled={saving || !newGradeName.trim()}
                className="bg-amber-500 text-white px-4 rounded-xl hover:bg-amber-600 transition-colors disabled:opacity-50 flex items-center justify-center"
              >
                <Plus className="w-5 h-5" />
              </button>
            </div>
          </form>

          <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
            {grades.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-4">No hay grados configurados.</p>
            ) : (
              grades.map(grade => (
                <div key={grade.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="w-6 h-6 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center text-xs font-bold">
                        {grade.level_order}
                      </span>
                      <p className="font-bold text-slate-800">{grade.name}</p>
                    </div>
                    <button
                      onClick={() => handleDeleteGrade(grade.id)}
                      className="p-2 text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex gap-3 pl-9">
                    <select
                      value={grade.stage}
                      onChange={e => handleUpdateGradeField(grade.id, 'stage', e.target.value)}
                      className="flex-1 bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold outline-none focus:border-amber-500"
                    >
                      <option value="primaria">Primaria</option>
                      <option value="secundaria">Secundaria</option>
                    </select>
                    <input
                      type="time"
                      value={grade.exit_time?.slice(0, 5) || ''}
                      onChange={e => handleUpdateGradeField(grade.id, 'exit_time', e.target.value)}
                      title="Hora de salida"
                      className="w-32 bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold outline-none focus:border-amber-500"
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      {/* Door Assignments Section */}
      {doors.length > 0 && grades.length > 0 && (
        <section className="bg-white rounded-[2.5rem] p-8 border border-slate-100 shadow-sm">
          <h3 className="text-lg font-black text-slate-900 flex items-center gap-3 border-b border-slate-50 pb-4 mb-6">
            <LinkIcon className="w-5 h-5 text-emerald-500" /> Asignación de Puertas por Grado
          </h3>
          <p className="text-sm text-slate-500 mb-6">
            Selecciona por qué puertas está permitida la salida para cada grado. Un grado puede tener múltiples puertas asignadas.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr>
                  <th className="p-4 border-b border-slate-200 font-black text-slate-400 text-xs uppercase tracking-wider bg-slate-50 rounded-tl-2xl">
                    Grado
                  </th>
                  {doors.map((door, index) => (
                    <th key={door.id} className={`p-4 border-b border-slate-200 font-black text-slate-600 text-sm text-center bg-slate-50 ${index === doors.length - 1 ? 'rounded-tr-2xl' : ''}`}>
                      {door.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grades.map(grade => (
                  <tr key={grade.id} className="hover:bg-slate-50/50 transition-colors border-b border-slate-100 last:border-0">
                    <td className="p-4 font-bold text-slate-800">
                      {grade.name}
                    </td>
                    {doors.map(door => {
                      const isAssigned = gradeDoors.some(gd => gd.grade_id === grade.id && gd.door_id === door.id);
                      return (
                        <td key={door.id} className="p-4 text-center">
                          <button
                            onClick={() => handleAssignDoor(grade.id, door.id)}
                            className={`w-8 h-8 rounded-lg flex items-center justify-center mx-auto transition-all ${
                              isAssigned 
                                ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/20' 
                                : 'bg-slate-100 text-slate-300 hover:bg-slate-200'
                            }`}
                          >
                            {isAssigned && <CheckCircle2 className="w-5 h-5" />}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
