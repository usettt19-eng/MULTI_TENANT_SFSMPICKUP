import React, { useEffect, useState } from 'react';
import { supabase, logActivity } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Bus, Plus, Settings2, X, Search, CheckCircle2, Trash2, Loader2, Check } from 'lucide-react';

interface BusRoute {
  id: string;
  name: string;
  profile_id: string;
  student_count: number;
}

/**
 * Un "bus" es, por dentro, un perfil de padre fantasma (profiles.role =
 * 'parent', sin email, marcado con additional_tutor_name.is_bus_route) que
 * nunca inicia sesión — solo sirve como contenedor de parent_students para
 * agrupar a los alumnos de esa ruta. Anunciar la llegada crea un
 * pickup_events por cada alumno con parent_id apuntando a ese perfil, igual
 * que hace SmartCheckIn.tsx con un padre real por PIN — reutiliza toda la
 * cadena existente (Mi Salón, Monitor Externo, Tránsito, notificaciones)
 * sin tocar nada de eso. La contraparte: aparece mezclado con los padres
 * reales en Gestión de Guardianes y en reportes de "padres sin loguear" —
 * el flag is_bus_route queda ahí para poder filtrarlo si hace falta.
 */
export function BusRoutesPanel() {
  const { profile } = useAuth() as any;
  const [routes, setRoutes] = useState<BusRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [announcingId, setAnnouncingId] = useState<string | null>(null);
  const [announcedId, setAnnouncedId] = useState<string | null>(null);

  const [showManageModal, setShowManageModal] = useState(false);
  const [editingRoute, setEditingRoute] = useState<BusRoute | null>(null);
  const [routeName, setRouteName] = useState('');
  const [students, setStudents] = useState<any[]>([]);
  const [selectedStudents, setSelectedStudents] = useState<string[]>([]);
  const [studentSearchTerm, setStudentSearchTerm] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!profile?.tenant_id) return;
    fetchRoutes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.tenant_id]);

  const fetchRoutes = async () => {
    if (!profile?.tenant_id) return;
    const { data: routesData } = await supabase
      .from('bus_routes')
      .select('id, name, profile_id')
      .eq('tenant_id', profile.tenant_id)
      .order('name');

    if (!routesData) {
      setLoading(false);
      return;
    }

    const profileIds = routesData.map((r) => r.profile_id);
    const { data: links } = profileIds.length > 0
      ? await supabase.from('parent_students').select('parent_id').in('parent_id', profileIds)
      : { data: [] as { parent_id: string }[] };

    const counts = new Map<string, number>();
    (links || []).forEach((l: any) => counts.set(l.parent_id, (counts.get(l.parent_id) || 0) + 1));

    setRoutes(routesData.map((r) => ({ ...r, student_count: counts.get(r.profile_id) || 0 })));
    setLoading(false);
  };

  const fetchStudents = async () => {
    if (!profile?.tenant_id) return;
    const { data } = await supabase.from('students').select('*').eq('tenant_id', profile.tenant_id).order('first_name');
    if (data) setStudents(data);
  };

  const openCreateModal = () => {
    setEditingRoute(null);
    setRouteName('');
    setSelectedStudents([]);
    setStudentSearchTerm('');
    fetchStudents();
    setShowManageModal(true);
  };

  const openEditModal = async (route: BusRoute) => {
    setEditingRoute(route);
    setRouteName(route.name);
    setStudentSearchTerm('');
    await fetchStudents();
    const { data: links } = await supabase.from('parent_students').select('student_id').eq('parent_id', route.profile_id);
    setSelectedStudents((links || []).map((l: any) => l.student_id));
    setShowManageModal(true);
  };

  const handleSaveRoute = async () => {
    const name = routeName.trim();
    if (!name || !profile?.tenant_id) return;
    setSaving(true);
    try {
      if (editingRoute) {
        const { error: updateError } = await supabase.from('bus_routes').update({ name }).eq('id', editingRoute.id);
        if (updateError) throw updateError;

        await supabase.from('parent_students').delete().eq('parent_id', editingRoute.profile_id);
        if (selectedStudents.length > 0) {
          await supabase.from('parent_students').insert(
            selectedStudents.map((student_id) => ({ parent_id: editingRoute.profile_id, student_id })),
          );
        }
      } else {
        const profileId = crypto.randomUUID();
        const { error: profileError } = await supabase.from('profiles').insert({
          id: profileId,
          tenant_id: profile.tenant_id,
          role: 'parent',
          first_name: name,
          last_name: '',
          additional_tutor_name: JSON.stringify({ is_bus_route: true }),
        });
        if (profileError) throw profileError;

        const { error: routeError } = await supabase.from('bus_routes').insert({
          tenant_id: profile.tenant_id,
          name,
          profile_id: profileId,
        });
        if (routeError) throw routeError;

        if (selectedStudents.length > 0) {
          await supabase.from('parent_students').insert(
            selectedStudents.map((student_id) => ({ parent_id: profileId, student_id })),
          );
        }

        await logActivity(
          'SYSTEM',
          `RUTA DE BUS CREADA: "${name}" con ${selectedStudents.length} alumno(s) asignado(s).`,
          profile.first_name || 'Admin',
          { bus_route: name },
          profile.tenant_id,
        );
      }

      setShowManageModal(false);
      fetchRoutes();
    } catch (err: any) {
      alert('Error al guardar la ruta: ' + (err.message || String(err)));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRoute = async (route: BusRoute) => {
    if (!confirm(`¿Eliminar la ruta "${route.name}"? No borra a los alumnos, solo la ruta.`)) return;
    await supabase.from('parent_students').delete().eq('parent_id', route.profile_id);
    await supabase.from('bus_routes').delete().eq('id', route.id);
    await supabase.from('profiles').delete().eq('id', route.profile_id);
    fetchRoutes();
  };

  const handleAnnounce = async (route: BusRoute) => {
    if (!profile?.tenant_id) return;
    setAnnouncingId(route.id);
    try {
      const { data: links } = await supabase
        .from('parent_students')
        .select('student_id')
        .eq('parent_id', route.profile_id);
      const studentIds = (links || []).map((l: any) => l.student_id);

      if (studentIds.length === 0) {
        alert(`La ruta "${route.name}" no tiene alumnos asignados todavía.`);
        return;
      }

      const rows = studentIds.map((student_id) => ({
        student_id,
        parent_id: route.profile_id,
        status: 'announced',
        announced_at: new Date().toISOString(),
        tenant_id: profile.tenant_id,
      }));
      const { error } = await supabase.from('pickup_events').insert(rows);
      if (error) throw error;

      await logActivity(
        'PICKUP',
        `LLEGADA DE BUS: "${route.name}" anunció la llegada de ${studentIds.length} alumno(s).`,
        profile.first_name || 'Recepción',
        { bus_route: route.name, student_count: studentIds.length },
        profile.tenant_id,
      );

      setAnnouncedId(route.id);
      setTimeout(() => setAnnouncedId((current) => (current === route.id ? null : current)), 3000);
    } catch (err: any) {
      alert('Error al anunciar la llegada: ' + (err.message || String(err)));
    } finally {
      setAnnouncingId(null);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="p-5 border-b border-slate-100 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Bus className="w-5 h-5 text-[#1e293b]" />
          <h2 className="text-[13px] font-black text-[#1e293b] uppercase tracking-wider">Buses</h2>
        </div>
        <button
          onClick={openCreateModal}
          className="flex items-center gap-1.5 bg-[#1e293b] text-white px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest hover:bg-slate-700 transition-all"
        >
          <Plus className="w-3.5 h-3.5" /> Nueva Ruta
        </button>
      </div>
      <div className="p-5">
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="w-5 h-5 animate-spin text-slate-300" />
          </div>
        ) : routes.length === 0 ? (
          <p className="text-[11px] font-bold text-slate-300 italic uppercase tracking-widest text-center py-6">
            Ninguna ruta configurada
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {routes.map((route) => {
              const isAnnouncing = announcingId === route.id;
              const justAnnounced = announcedId === route.id;
              return (
                <div key={route.id} className="flex items-stretch gap-1.5">
                  <button
                    onClick={() => handleAnnounce(route)}
                    disabled={isAnnouncing}
                    className={`flex-1 flex items-center gap-3 p-4 rounded-2xl border transition-all text-left disabled:opacity-60 ${
                      justAnnounced
                        ? 'bg-emerald-50 border-emerald-200'
                        : 'bg-amber-50 border-amber-100 hover:bg-amber-100'
                    }`}
                  >
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${justAnnounced ? 'bg-emerald-500' : 'bg-amber-500'} text-white`}>
                      {isAnnouncing ? <Loader2 className="w-5 h-5 animate-spin" /> : justAnnounced ? <Check className="w-5 h-5" /> : <Bus className="w-5 h-5" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-black text-slate-800 truncate">{route.name}</p>
                      <p className="text-[10px] font-bold text-slate-400 uppercase">
                        {justAnnounced ? 'Llegada anunciada' : `${route.student_count} alumno${route.student_count === 1 ? '' : 's'}`}
                      </p>
                    </div>
                  </button>
                  <button
                    onClick={() => openEditModal(route)}
                    title="Gestionar ruta"
                    className="w-10 shrink-0 flex items-center justify-center rounded-2xl border border-slate-100 text-slate-400 hover:text-indigo-600 hover:border-indigo-200 transition-all"
                  >
                    <Settings2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showManageModal && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md animate-in fade-in">
          <div className="bg-white w-full max-w-lg rounded-[2rem] overflow-hidden shadow-2xl animate-in zoom-in-95 max-h-[90vh] flex flex-col">
            <div className="p-6 bg-slate-50 border-b border-slate-100 flex justify-between items-center shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-500 rounded-xl text-white">
                  <Bus className="w-5 h-5" />
                </div>
                <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest">
                  {editingRoute ? 'Editar Ruta' : 'Nueva Ruta de Bus'}
                </h3>
              </div>
              <button onClick={() => setShowManageModal(false)} className="p-2.5 bg-white text-slate-400 rounded-xl shadow-sm">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5 overflow-y-auto">
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Nombre de la ruta</label>
                <input
                  autoFocus
                  value={routeName}
                  onChange={(e) => setRouteName(e.target.value)}
                  placeholder="Ej. Ruta 1 — Costa del Este"
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 text-sm font-bold text-slate-700 outline-none focus:border-amber-500 focus:bg-white transition-all"
                />
              </div>

              <div>
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-3">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest shrink-0">Alumnos en esta ruta</label>
                  <div className="relative w-full sm:w-56 shrink-0">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Buscar alumno..."
                      value={studentSearchTerm}
                      onChange={(e) => setStudentSearchTerm(e.target.value)}
                      className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all shadow-sm"
                    />
                  </div>
                </div>

                {selectedStudents.length > 0 && (
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    {selectedStudents.map((id) => {
                      const s = students.find((st) => st.id === id);
                      return s ? (
                        <div key={`sel-${id}`} className="bg-amber-100 text-amber-700 px-2 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5">
                          {s.first_name} {s.last_name}
                          <button type="button" onClick={() => setSelectedStudents((prev) => prev.filter((sid) => sid !== id))} className="text-amber-500 hover:text-amber-900">
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ) : null;
                    })}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[240px] overflow-y-auto pr-2 bg-slate-50 p-2 rounded-2xl border border-slate-100">
                  {students
                    .filter((s) => `${s.first_name} ${s.last_name}`.toLowerCase().includes(studentSearchTerm.toLowerCase()))
                    .map((s) => {
                      const isSel = selectedStudents.includes(s.id);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setSelectedStudents((prev) => (isSel ? prev.filter((id) => id !== s.id) : [...prev, s.id]))}
                          className={`flex items-center gap-2 p-3 sm:p-2 rounded-xl border text-left transition-all ${
                            isSel ? 'bg-amber-500 border-amber-500 text-white shadow-lg shadow-amber-100' : 'bg-white border-slate-100 text-slate-600 hover:border-slate-200'
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] sm:text-[10px] font-black truncate">{s.first_name} {s.last_name}</p>
                            <p className={`text-[9px] sm:text-[8px] font-medium ${isSel ? 'text-amber-100' : 'text-slate-400'}`}>{s.grade} · {s.section}</p>
                          </div>
                          {isSel && <CheckCircle2 className="w-4 h-4 sm:w-3 sm:h-3 text-white shrink-0" />}
                        </button>
                      );
                    })}
                </div>
              </div>
            </div>

            <div className="p-6 pt-0 shrink-0 space-y-2">
              <button
                onClick={handleSaveRoute}
                disabled={saving || !routeName.trim()}
                className="w-full bg-amber-500 text-white font-black py-4 rounded-2xl shadow-xl shadow-amber-100 active:scale-95 flex items-center justify-center gap-3 text-xs uppercase tracking-widest disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : editingRoute ? 'Guardar Cambios' : 'Crear Ruta'}
              </button>
              {editingRoute && (
                <button
                  onClick={() => { setShowManageModal(false); handleDeleteRoute(editingRoute); }}
                  className="w-full text-rose-500 font-bold py-2 flex items-center justify-center gap-2 text-xs uppercase tracking-widest hover:text-rose-700"
                >
                  <Trash2 className="w-4 h-4" /> Eliminar Ruta
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
