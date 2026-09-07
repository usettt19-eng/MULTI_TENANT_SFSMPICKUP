import React, { useEffect, useRef, useState } from 'react';
import { supabase, logActivity } from '../lib/supabase';
import { apiJson } from '../lib/apiFetch';
import { useAuth } from '../contexts/AuthContext';
import { Bus, Plus, Settings2, X, Search, CheckCircle2, Trash2, Loader2, Check, Car } from 'lucide-react';

interface BusRoute {
  id: string;
  name: string;
  profile_id: string;
  door_id: string | null;
  student_count: number;
}

interface ExitDoor {
  id: string;
  name: string;
}

interface RouteActivity {
  total: number;
  released: number;
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
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [confirmedId, setConfirmedId] = useState<string | null>(null);
  // parent_id (el perfil fantasma del bus) -> conteo de pickup_events activos
  // y cuántos de esos ya están 'released' (el maestro autorizó la salida).
  // Se refresca sola cada 8s, igual que TransitMonitor, porque no hay
  // Realtime en pickup_events — así el botón cambia de color solo, sin que
  // recepción tenga que recargar la pantalla.
  const [activity, setActivity] = useState<Record<string, RouteActivity>>({});
  const routesRef = useRef<BusRoute[]>([]);

  const [showManageModal, setShowManageModal] = useState(false);
  const [editingRoute, setEditingRoute] = useState<BusRoute | null>(null);
  const [routeName, setRouteName] = useState('');
  const [routeDoorId, setRouteDoorId] = useState<string>('');
  const [doors, setDoors] = useState<ExitDoor[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [selectedStudents, setSelectedStudents] = useState<string[]>([]);
  const [studentSearchTerm, setStudentSearchTerm] = useState('');
  const [saving, setSaving] = useState(false);

  // Acceso de login para el encargado físico del bus (ver comentario del
  // endpoint en el backend) — se muestra/edita solo dentro de "Editar Ruta".
  const [currentLoginUsername, setCurrentLoginUsername] = useState<string | null>(null);
  const [newLoginUsername, setNewLoginUsername] = useState('');
  const [newLoginPassword, setNewLoginPassword] = useState('');
  const [savingCredentials, setSavingCredentials] = useState(false);
  const [credentialsError, setCredentialsError] = useState('');

  useEffect(() => {
    if (!profile?.tenant_id) return;
    fetchRoutes();
    fetchDoors();

    const pollInterval = window.setInterval(fetchActivity, 8000);
    return () => window.clearInterval(pollInterval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.tenant_id]);

  const fetchRoutes = async () => {
    if (!profile?.tenant_id) return;
    const { data: routesData } = await supabase
      .from('bus_routes')
      .select('id, name, profile_id, door_id')
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

    const withCounts = routesData.map((r) => ({ ...r, student_count: counts.get(r.profile_id) || 0 }));
    setRoutes(withCounts);
    routesRef.current = withCounts;
    setLoading(false);
    fetchActivity();
  };

  // Cuenta, por cada ruta, cuántos pickup_events siguen activos y cuántos de
  // esos ya están 'released' — cuando coinciden (todos autorizados por su
  // maestro), el botón pasa a naranja para que recepción confirme que el
  // bus ya se los llevó, igual que el botón ámbar del padre en su panel
  // cuando el alumno está autorizado y falta confirmar que ya lo tiene.
  const fetchActivity = async () => {
    const profileIds = routesRef.current.map((r) => r.profile_id);
    if (profileIds.length === 0) return;
    const { data } = await supabase
      .from('pickup_events')
      .select('parent_id, status')
      .in('parent_id', profileIds)
      .in('status', ['announced', 'in_queue', 'released']);

    const next: Record<string, RouteActivity> = {};
    (data || []).forEach((row: any) => {
      const entry = next[row.parent_id] || { total: 0, released: 0 };
      entry.total += 1;
      if (row.status === 'released') entry.released += 1;
      next[row.parent_id] = entry;
    });
    setActivity(next);
  };

  const fetchDoors = async () => {
    if (!profile?.tenant_id) return;
    const { data } = await supabase.from('exit_doors').select('id, name').eq('tenant_id', profile.tenant_id).order('name');
    if (data) setDoors(data);
  };

  const fetchStudents = async () => {
    if (!profile?.tenant_id) return;
    const { data } = await supabase.from('students').select('*').eq('tenant_id', profile.tenant_id).order('first_name');
    if (data) setStudents(data);
  };

  const openCreateModal = () => {
    setEditingRoute(null);
    setRouteName('');
    setRouteDoorId('');
    setSelectedStudents([]);
    setStudentSearchTerm('');
    fetchStudents();
    setShowManageModal(true);
  };

  const openEditModal = async (route: BusRoute) => {
    setEditingRoute(route);
    setRouteName(route.name);
    setRouteDoorId(route.door_id || '');
    setStudentSearchTerm('');
    setNewLoginUsername('');
    setNewLoginPassword('');
    setCredentialsError('');
    setCurrentLoginUsername(null);
    await fetchStudents();
    const { data: links } = await supabase.from('parent_students').select('student_id').eq('parent_id', route.profile_id);
    setSelectedStudents((links || []).map((l: any) => l.student_id));
    setShowManageModal(true);

    try {
      const res = await apiJson(`/api/bus-routes/${route.id}/credentials`);
      setCurrentLoginUsername(res.data?.username ?? null);
    } catch (err) {
      console.error('Error fetching bus login:', err);
    }
  };

  const handleSaveCredentials = async () => {
    if (!editingRoute) return;
    setCredentialsError('');
    setSavingCredentials(true);
    try {
      const res = await apiJson(`/api/bus-routes/${editingRoute.id}/credentials`, {
        method: 'PUT',
        body: JSON.stringify({ username: newLoginUsername.trim(), password: newLoginPassword }),
      });
      setCurrentLoginUsername(res.data.username);
      setNewLoginUsername('');
      setNewLoginPassword('');
    } catch (err: any) {
      setCredentialsError(err.message || 'Error al guardar el acceso.');
    } finally {
      setSavingCredentials(false);
    }
  };

  const handleSaveRoute = async () => {
    const name = routeName.trim();
    if (!name || !profile?.tenant_id) return;
    setSaving(true);
    try {
      if (editingRoute) {
        const { error: updateError } = await supabase
          .from('bus_routes')
          .update({ name, door_id: routeDoorId || null })
          .eq('id', editingRoute.id);
        if (updateError) throw updateError;

        await supabase.from('parent_students').delete().eq('parent_id', editingRoute.profile_id);
        if (selectedStudents.length > 0) {
          await supabase.from('parent_students').insert(
            selectedStudents.map((student_id) => ({ parent_id: editingRoute.profile_id, student_id })),
          );
        }
      } else {
        await apiJson('/api/bus-routes', {
          method: 'POST',
          body: JSON.stringify({
            tenant_id: profile.tenant_id,
            name,
            door_id: routeDoorId || null,
            student_ids: selectedStudents,
          }),
        });

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
    try {
      await apiJson(`/api/bus-routes/${route.id}`, { method: 'DELETE' });
    } catch (err: any) {
      alert('Error al eliminar la ruta: ' + (err.message || String(err)));
      return;
    }
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
        door_id: route.door_id || null,
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
      fetchActivity();
    } catch (err: any) {
      alert('Error al anunciar la llegada: ' + (err.message || String(err)));
    } finally {
      setAnnouncingId(null);
    }
  };

  // Se habilita cuando TODOS los pickup_events activos de la ruta llegaron a
  // 'released' (cada maestro ya autorizó al alumno correspondiente) — marca
  // el cierre del ciclo para el bus completo de una vez, igual que el padre
  // confirma "ya lo tengo" en su panel cuando el suyo queda autorizado.
  const handleConfirmComplete = async (route: BusRoute) => {
    setConfirmingId(route.id);
    try {
      const { error } = await supabase
        .from('pickup_events')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('parent_id', route.profile_id)
        .eq('status', 'released');
      if (error) throw error;

      const releasedCount = activity[route.profile_id]?.released ?? 0;
      await logActivity(
        'PICKUP',
        `SALIDA DE BUS CONFIRMADA: "${route.name}" — ${releasedCount} alumno(s) ya autorizado(s) subieron al bus.`,
        profile?.first_name || 'Recepción',
        { bus_route: route.name, student_count: releasedCount },
        profile?.tenant_id,
      );

      setConfirmedId(route.id);
      setTimeout(() => setConfirmedId((current) => (current === route.id ? null : current)), 3000);
      fetchActivity();
    } catch (err: any) {
      alert('Error al confirmar la salida del bus: ' + (err.message || String(err)));
    } finally {
      setConfirmingId(null);
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
              const isConfirming = confirmingId === route.id;
              const justAnnounced = announcedId === route.id;
              const justConfirmed = confirmedId === route.id;
              const act = activity[route.profile_id];
              const total = act?.total ?? 0;
              const released = act?.released ?? 0;
              // idle: nada activo, tocar anuncia la llegada.
              // waiting: ya se anunció, pero faltan alumnos por autorizar en su salón.
              // ready: todos los activos ya están autorizados — tocar confirma que el bus se los llevó.
              const stage = total === 0 ? 'idle' : released === total ? 'ready' : 'waiting';
              const flashing = justAnnounced || justConfirmed;

              const handleClick = () => {
                if (stage === 'idle') handleAnnounce(route);
                else if (stage === 'ready') handleConfirmComplete(route);
              };

              const cardClasses = flashing
                ? 'bg-emerald-50 border-emerald-200'
                : stage === 'ready'
                ? 'bg-orange-50 border-orange-200 hover:bg-orange-100'
                : stage === 'waiting'
                ? 'bg-slate-50 border-slate-200 cursor-default'
                : 'bg-amber-50 border-amber-100 hover:bg-amber-100';

              const iconBgClasses = flashing ? 'bg-emerald-500' : stage === 'ready' ? 'bg-orange-500' : stage === 'waiting' ? 'bg-slate-400' : 'bg-amber-500';

              let subtitle: string;
              if (justAnnounced) subtitle = 'Llegada anunciada';
              else if (justConfirmed) subtitle = 'Salida confirmada';
              else if (stage === 'ready') subtitle = `Listo — ${released} alumno${released === 1 ? '' : 's'} autorizado${released === 1 ? '' : 's'}, toca para confirmar salida`;
              else if (stage === 'waiting') subtitle = `${released}/${total} autorizados por su salón`;
              else subtitle = `${route.student_count} alumno${route.student_count === 1 ? '' : 's'}${route.door_id ? ` · ${doors.find((d) => d.id === route.door_id)?.name || 'Puerta'}` : ''}`;

              return (
                <div key={route.id} className="flex items-stretch gap-1.5">
                  <button
                    onClick={handleClick}
                    disabled={isAnnouncing || isConfirming || stage === 'waiting'}
                    className={`flex-1 flex items-center gap-3 p-4 rounded-2xl border transition-all text-left disabled:opacity-60 ${cardClasses}`}
                  >
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${iconBgClasses} text-white`}>
                      {isAnnouncing || isConfirming ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : flashing ? (
                        <Check className="w-5 h-5" />
                      ) : stage === 'ready' ? (
                        <Car className="w-5 h-5" />
                      ) : (
                        <Bus className="w-5 h-5" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-black text-slate-800 truncate">{route.name}</p>
                      <p className="text-[10px] font-bold text-slate-400 uppercase truncate">{subtitle}</p>
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
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Puerta por donde sale este bus</label>
                <select
                  value={routeDoorId}
                  onChange={(e) => setRouteDoorId(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 text-sm font-bold text-slate-700 outline-none focus:border-amber-500 focus:bg-white transition-all"
                >
                  <option value="">Sin puerta fija (usa el grado de cada alumno)</option>
                  {doors.map((door) => (
                    <option key={door.id} value={door.id}>{door.name}</option>
                  ))}
                </select>
                <p className="text-[10px] text-slate-400 font-medium mt-2 ml-1">
                  Si la asignas, todos los alumnos de esta ruta salen agrupados por esa puerta al anunciar, sin importar su grado.
                </p>
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

              {editingRoute && (
                <div className="border-t border-slate-100 pt-5">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">
                    Acceso para el encargado del bus
                  </label>
                  <p className="text-[11px] text-slate-400 font-medium mb-3 ml-1 leading-relaxed">
                    Con esto, la persona que viaja en el bus puede anunciar la llegada ella misma desde su celular, igual que un padre. No hace falta correo real — solo un usuario inventado y una contraseña.
                  </p>

                  {currentLoginUsername && (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3 mb-3">
                      <p className="text-[10px] font-black text-emerald-700 uppercase tracking-widest">Usuario actual</p>
                      <p className="text-sm font-bold text-emerald-800 break-all">{currentLoginUsername}</p>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      value={newLoginUsername}
                      onChange={(e) => setNewLoginUsername(e.target.value)}
                      placeholder="usuario (ej. bus5monitor)"
                      className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:border-amber-500 focus:bg-white transition-all"
                    />
                    <input
                      value={newLoginPassword}
                      onChange={(e) => setNewLoginPassword(e.target.value)}
                      placeholder="contraseña (mín. 6)"
                      className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:border-amber-500 focus:bg-white transition-all"
                    />
                  </div>
                  {credentialsError && (
                    <p className="text-xs text-rose-500 font-bold mt-2 ml-1">{credentialsError}</p>
                  )}
                  <button
                    type="button"
                    onClick={handleSaveCredentials}
                    disabled={savingCredentials || !newLoginUsername.trim() || newLoginPassword.length < 6}
                    className="w-full mt-2 bg-slate-800 text-white font-black py-3 rounded-xl text-xs uppercase tracking-widest disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {savingCredentials ? <Loader2 className="w-4 h-4 animate-spin" /> : (currentLoginUsername ? 'Cambiar Acceso' : 'Crear Acceso')}
                  </button>
                </div>
              )}
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
