import {apiFetch, apiJson} from '../lib/apiFetch';
import React, { useEffect, useState, useRef } from 'react';
import { supabase, logActivity } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { QRCodeSVG } from 'qrcode.react';
import { Share } from '@capacitor/share';
import {
  isNativeApp, hasSeenLocationRationale, markLocationRationaleSeen,
  startBackgroundWatch, stopBackgroundWatch, openLocationSettings,
  isLikelyIOSInAppBrowser,
} from '../lib/backgroundGeolocation';
import {
  MapPin, Navigation, CheckCircle2, AlertTriangle,
  Clock, User, LogOut, ChevronRight, Bell, ShieldCheck,
  Eye, EyeOff, Map as MapIcon, Loader2, FileText, X, Send, UserCheck,
  UserPlus, QrCode, Share2, Trash2, MessageSquare, Car, CalendarDays, Search, Camera
} from 'lucide-react';

export function ParentDashboard() {
  const { profile, profiles, switchProfile, signOut } = useAuth();
  const [students, setStudents] = useState<any[]>([]);
  const [pendingForms, setPendingForms] = useState<any[]>([]);
  const [activeForm, setActiveForm] = useState<any | null>(null);
  const [answers, setAnswers] = useState<any>({});
  
  const [distance, setDistance] = useState<number | null>(null);
  const [isInside, setIsInside] = useState(false);
  const [status, setStatus] = useState<'idle' | 'announced' | 'pickup_active' | 'released'>('idle');
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  // School selector state
  const [showSchoolSelector, setShowSchoolSelector] = useState(false);

  const [notifications, setNotifications] = useState<any[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showReplacementModal, setShowReplacementModal] = useState(false);
  const [replacementName, setReplacementName] = useState('');
  const [replacementPhone, setReplacementPhone] = useState('');
  const [replacementPhotoFile, setReplacementPhotoFile] = useState<File | null>(null);
  const [replacementPhotoPreview, setReplacementPhotoPreview] = useState<string | null>(null);
  const [isSubmittingReplacement, setIsSubmittingReplacement] = useState(false);

  const [showDeliveryModal, setShowDeliveryModal] = useState(false);
  const [deliveryMessage, setDeliveryMessage] = useState('');
  const [deliveryLink, setDeliveryLink] = useState('');

  // "Pool day": otro padre registrado recoge a mi hijo/a ciertos días (fijo
  // cada semana o solo un día puntual), con aviso al encargado y al admin.
  const [showCarpoolModal, setShowCarpoolModal] = useState(false);
  const [carpoolStudentId, setCarpoolStudentId] = useState('');
  const [carpoolMode, setCarpoolMode] = useState<'weekly' | 'oneday'>('weekly');
  const [carpoolDays, setCarpoolDays] = useState<number[]>([]);
  const [carpoolDate, setCarpoolDate] = useState('');
  const [driverQuery, setDriverQuery] = useState('');
  const [driverResults, setDriverResults] = useState<any[]>([]);
  const [isSearchingDrivers, setIsSearchingDrivers] = useState(false);
  const [classmateParents, setClassmateParents] = useState<any[]>([]);
  const [isLoadingClassmates, setIsLoadingClassmates] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState<any | null>(null);
  const [isSubmittingCarpool, setIsSubmittingCarpool] = useState(false);
  const [carpoolData, setCarpoolData] = useState<{
    authorizations: any[]; overrides: any[]; drivingFor: any[]; drivingForOverrides: any[]; todaysCarpoolStudents: any[];
  }>({ authorizations: [], overrides: [], drivingFor: [], drivingForOverrides: [], todaysCarpoolStudents: [] });

  const unreadCount = notifications.filter(n => !n.is_read).length;
  
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  
  // Puertas de salida del colegio: si hay más de una, el padre elige por
  // cuál va a pasar, para que el personal de esa puerta sepa a quién esperar
  // sin depender solo del mapeo grado→puerta (que no siempre aplica, ej.
  // hermanos de distinto grado que salen juntos por la misma puerta).
  const [doors, setDoors] = useState<{ id: string; name: string }[]>([]);
  const [selectedDoorId, setSelectedDoorId] = useState<string>('');

  // Geofencing states from Database
  const [schoolPos, setSchoolPos] = useState({ lat: 8.9833, lng: -79.5167, radius: 65 });
  const [parentPos, setParentPos] = useState<{lat: number, lng: number} | null>(null);
  const [isLocationEnabled, setIsLocationEnabled] = useState(false);
  const [showManualArrival, setShowManualArrival] = useState(false);
  const watchId = useRef<number | null>(null);

  // El watcher nativo en segundo plano se registra una sola vez al montar la
  // pantalla (antes de que fetchSchoolSettings() traiga la ubicación real del
  // colegio). Si su callback leyera "schoolPos" directamente, quedaría para
  // siempre comparando contra el valor por defecto de arriba, ya que ese
  // closure nunca se vuelve a crear. Este ref sí se mantiene al día.
  const schoolPosRef = useRef(schoolPos);
  useEffect(() => { schoolPosRef.current = schoolPos; }, [schoolPos]);

  // En la app nativa (Android), la ubicación se rastrea en segundo plano sin
  // que el padre tenga que abrir la app ni tocar nada — solo se pide el
  // permiso "Permitir siempre" una vez, con una pantalla propia explicando
  // el motivo antes del prompt del sistema.
  const isNative = isNativeApp();
  const isInAppBrowser = !isNative && isLikelyIOSInAppBrowser();
  const [showLocationRationale, setShowLocationRationale] = useState(false);
  const [isBackgroundTrackingActive, setIsBackgroundTrackingActive] = useState(false);

  const playBeep = () => {
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContext) return;
      
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime); // A5 note
      
      gainNode.gain.setValueAtTime(0.1, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      
      osc.connect(gainNode);
      gainNode.connect(ctx.destination);
      
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    } catch (e) {
      console.error("Audio playback failed", e);
    }
  };

  useEffect(() => {
    if (profile) {
      initDashboard();

      // Listen for TEACHER AUTHORIZATIONS & NEW NOTIFICATIONS
      const channel = supabase
        .channel(`parent-feed-${profile.id}-${Math.random()}`)
        .on('postgres_changes', { 
          event: '*', 
          schema: 'public', 
          table: 'pickup_events',
          filter: `parent_id=eq.${profile.id}`
        }, (payload) => {
          const record = payload.new || payload.old;
          if (record && record.tenant_id && record.tenant_id !== profile.tenant_id) return;
          console.log('Pickup event update received:', payload);
          checkActivePickups();
        })
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${profile.id}`
        }, (payload) => {
          const record = payload.new;
          if (record && record.tenant_id && record.tenant_id !== profile.tenant_id) return;
          console.log('New notification received:', payload);
          setNotifications(prev => [payload.new, ...prev]);
          playBeep();
          checkActivePickups();
          
          if (payload.new.title.includes('camino') || payload.new.title.includes('Autorizado')) {
            setSuccessMessage(payload.new.message);
            setTimeout(() => setSuccessMessage(null), 10000);
          }
        })
        .subscribe((status) => {
          console.log(`Real-time channel status for parent ${profile.id}:`, status);
        });

      return () => {
        stopLocationWatch();
        supabase.removeChannel(channel);
      };
    }
  }, [profile]);

  const initDashboard = async () => {
    setLoading(true);
    await fetchStudents();
    await fetchSchoolSettings();
    await fetchDoors();
    await checkActivePickups();
    await fetchPendingForms();
    await fetchNotifications();
    await fetchCarpoolData();
    setLoading(false);
  };

  const fetchDoors = async () => {
    if (!profile?.tenant_id) return;
    const { data } = await supabase
      .from('exit_doors')
      .select('id, name')
      .eq('tenant_id', profile.tenant_id)
      .order('name');
    const list = data || [];
    setDoors(list);

    const savedDoorId = localStorage.getItem(`preferred_door_${profile.id}`);
    if (savedDoorId && list.some(d => d.id === savedDoorId)) {
      setSelectedDoorId(savedDoorId);
    } else if (list.length > 0) {
      setSelectedDoorId(list[0].id);
    }
  };

  const handleSelectDoor = (doorId: string) => {
    setSelectedDoorId(doorId);
    if (profile?.id) localStorage.setItem(`preferred_door_${profile.id}`, doorId);
  };

  const fetchCarpoolData = async () => {
    if (!profile?.tenant_id) return;
    try {
      const res = await apiJson('/api/carpool/mine');
      setCarpoolData(res.data);
    } catch (e) {
      console.error('Error al cargar pool days:', e);
    }
  };

  // Busca padres registrados del mismo colegio para elegir "quién conduce"
  // (con debounce, ya que dispara una llamada al backend por cada letra).
  useEffect(() => {
    if (!showCarpoolModal || driverQuery.trim().length < 2) {
      setDriverResults([]);
      return;
    }
    setIsSearchingDrivers(true);
    const timeoutId = window.setTimeout(async () => {
      try {
        const res = await apiJson(`/api/parents/search?q=${encodeURIComponent(driverQuery.trim())}`);
        setDriverResults(res.data || []);
      } catch (e) {
        console.error('Error al buscar padres:', e);
      } finally {
        setIsSearchingDrivers(false);
      }
    }, 350);
    return () => window.clearTimeout(timeoutId);
  }, [driverQuery, showCarpoolModal]);

  // Al elegir el hijo, trae directo a los padres de sus compañeros de salón
  // — casi siempre el pool day es entre familias del mismo salón, así que
  // se pueden seleccionar con un toque en vez de tener que escribir.
  useEffect(() => {
    if (!showCarpoolModal || !carpoolStudentId) {
      setClassmateParents([]);
      return;
    }
    setIsLoadingClassmates(true);
    apiJson(`/api/carpool/classmates-parents?student_id=${encodeURIComponent(carpoolStudentId)}`)
      .then(res => setClassmateParents(res.data || []))
      .catch(e => { console.error('Error al cargar padres del salón:', e); setClassmateParents([]); })
      .finally(() => setIsLoadingClassmates(false));
  }, [carpoolStudentId, showCarpoolModal]);

  const resetCarpoolForm = () => {
    setCarpoolStudentId('');
    setCarpoolMode('weekly');
    setCarpoolDays([]);
    setCarpoolDate('');
    setDriverQuery('');
    setDriverResults([]);
    setSelectedDriver(null);
  };

  const toggleCarpoolDay = (day: number) => {
    setCarpoolDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort());
  };

  const handleSubmitCarpool = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!carpoolStudentId || !selectedDriver) return;
    if (carpoolMode === 'weekly' && carpoolDays.length === 0) {
      alert('Selecciona al menos un día de la semana.');
      return;
    }
    if (carpoolMode === 'oneday' && !carpoolDate) {
      alert('Selecciona la fecha.');
      return;
    }

    setIsSubmittingCarpool(true);
    try {
      const student = students.find(s => s.id === carpoolStudentId);
      const driverName = `${selectedDriver.first_name} ${selectedDriver.last_name}`;

      if (carpoolMode === 'weekly') {
        await apiJson('/api/carpool/authorizations', {
          method: 'POST',
          body: JSON.stringify({ student_id: carpoolStudentId, driver_parent_id: selectedDriver.id, days_of_week: carpoolDays }),
        });
        await logActivity(
          'CARPOOL_AUTHORIZATION',
          `POOL DAY: ${profile.first_name} autorizó a ${driverName} a recoger a ${student?.first_name || ''} ${student?.last_name || ''} (recurrente).`,
          profile.first_name,
          { student_id: carpoolStudentId, driver_parent_id: selectedDriver.id, days_of_week: carpoolDays },
          profile?.tenant_id
        );
      } else {
        await apiJson('/api/carpool/overrides', {
          method: 'POST',
          body: JSON.stringify({ student_id: carpoolStudentId, driver_parent_id: selectedDriver.id, date: carpoolDate }),
        });
        await logActivity(
          'CARPOOL_AUTHORIZATION',
          `POOL DAY: ${profile.first_name} autorizó a ${driverName} a recoger a ${student?.first_name || ''} ${student?.last_name || ''} el ${carpoolDate} (excepción de un día).`,
          profile.first_name,
          { student_id: carpoolStudentId, driver_parent_id: selectedDriver.id, date: carpoolDate },
          profile?.tenant_id
        );
      }

      alert('¡Pool day configurado! El encargado y el administrador serán notificados.');
      setShowCarpoolModal(false);
      resetCarpoolForm();
      await fetchCarpoolData();
    } catch (err: any) {
      console.error(err);
      alert('Error al configurar el pool day: ' + (err.message || String(err)));
    } finally {
      setIsSubmittingCarpool(false);
    }
  };

  const handleDeleteCarpoolAuthorization = async (id: string) => {
    if (!confirm('¿Quitar esta autorización recurrente?')) return;
    try {
      await apiJson(`/api/carpool/authorizations/${id}`, { method: 'DELETE' });
      await fetchCarpoolData();
    } catch (err: any) {
      alert('Error al quitar la autorización: ' + (err.message || String(err)));
    }
  };

  const handleDeleteCarpoolOverride = async (id: string) => {
    if (!confirm('¿Quitar esta excepción de un día?')) return;
    try {
      await apiJson(`/api/carpool/overrides/${id}`, { method: 'DELETE' });
      await fetchCarpoolData();
    } catch (err: any) {
      alert('Error al quitar la excepción: ' + (err.message || String(err)));
    }
  };

  const handleReplacementPhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setReplacementPhotoFile(file);
    const reader = new FileReader();
    reader.onloadend = () => setReplacementPhotoPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleRequestReplacement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replacementName || !replacementPhone) return;

    setIsSubmittingReplacement(true);
    try {
      // Foto de la persona autorizada: para que recepción la vea al lado del
      // QR al momento de escanearlo, no solo el nombre.
      let photoUrl: string | null = null;
      if (replacementPhotoFile && profile?.tenant_id) {
        const fileExt = replacementPhotoFile.name.split('.').pop() || 'jpg';
        const filePath = `${profile.tenant_id}/replacement_${Date.now()}.${fileExt}`;
        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(filePath, replacementPhotoFile);
        if (uploadError) {
          throw new Error('No se pudo subir la foto: ' + uploadError.message);
        }
        const { data: publicUrlData } = supabase.storage.from('avatars').getPublicUrl(filePath);
        photoUrl = publicUrlData.publicUrl;
      }

      // 1. Insert via API to bypass RLS limits for parents
      const response = await apiFetch('/api/requests/replacement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parent_id: profile.id,
          replacement_name: replacementName,
          replacement_phone: replacementPhone,
          photo_url: photoUrl,
          tenant_id: profile?.tenant_id
        })
      });

      if (!response.ok) {
         const errorData = await response.json();
         throw new Error(errorData.error || 'Error al enviar la solicitud');
      }

      // 2. Also log it for history
      await logActivity(
        'REPLACEMENT_REQUEST',
        `SOLICITUD DE REEMPLAZO: ${profile.first_name} solicita autorizar a ${replacementName}.`,
        profile.first_name,
        { replacement_name: replacementName },
        profile?.tenant_id
      );

      alert("Solicitud enviada. La recepción revisará y autorizará el reemplazo en breve.");
      setShowReplacementModal(false);
      setReplacementName('');
      setReplacementPhone('');
      setReplacementPhotoFile(null);
      setReplacementPhotoPreview(null);
    } catch (err: any) {
      console.error(err);
      alert("Error al enviar solicitud: " + (err.message || String(err)));
    } finally {
      setIsSubmittingReplacement(false);
    }
  };

  const handleRequestDelivery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deliveryMessage) return;
    
    setIsSubmittingReplacement(true);
    try {
      const response = await apiFetch('/api/requests/replacement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parent_id: profile.id,
          replacement_name: `[MENSAJE] ${deliveryMessage}`,
          replacement_phone: deliveryLink || 'N/A',
          tenant_id: profile?.tenant_id
        })
      });

      if (!response.ok) {
         const errorData = await response.json();
         throw new Error(errorData.error || 'Error al enviar la solicitud');
      }

      await logActivity(
        'REPLACEMENT_REQUEST',
        `MENSAJE/DELIVERY: ${profile.first_name} envió un aviso: ${deliveryMessage}.`,
        profile.first_name,
        { delivery: true, message: deliveryMessage },
        profile?.tenant_id
      );

      alert("Aviso enviado correctamente a recepción.");
      setShowDeliveryModal(false);
      setDeliveryMessage('');
      setDeliveryLink('');
    } catch (err: any) {
      console.error(err);
      alert("Error al enviar aviso: " + (err.message || String(err)));
    } finally {
      setIsSubmittingReplacement(false);
    }
  };

  const authorizedReplacements = React.useMemo(() => {
    try {
      const data = JSON.parse(profile?.additional_tutor_name || '{}');
      return data.replacements || [];
    } catch (e) {
      return [];
    }
  }, [profile?.additional_tutor_name]);

  const handleShareQR = async (replacement: any) => {
    const qrData = JSON.stringify({
      type: 'replacement_pickup',
      parent_id: profile.id,
      parent_name: `${profile.first_name} ${profile.last_name}`,
      replacement_name: replacement.name,
      photo_url: replacement.photo_url ?? null,
      token: replacement.token,
      students: students.map(s => ({ id: s.id, name: `${s.first_name} ${s.last_name}` }))
    });
    const url = window.location.origin + '/external?qr=' + encodeURIComponent(qrData);

    // En apps nativas (Android/iOS) el WebView no siempre implementa la Web
    // Share API del navegador, así que el share.can().value salía en false
    // y no pasaba nada al tocar "Enviar". El plugin de Capacitor sí abre la
    // hoja de compartir nativa (WhatsApp, SMS, etc.) en ambas plataformas.
    try {
      if (isNativeApp()) {
        await Share.share({
          title: 'Pase de Recogida - Safe SmartPickUP',
          text: `Hola ${replacement.name}, aquí tienes tu código QR para recoger a los niños hoy.`,
          url,
        });
      } else if (navigator.share) {
        await navigator.share({
          title: 'Pase de Recogida - Safe SmartPickUP',
          text: `Hola ${replacement.name}, aquí tienes tu código QR para recoger a los niños hoy.`,
          url,
        });
      } else {
        alert("QR listo para ser escaneado desde tu pantalla.");
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchSchoolSettings = async () => {
    if (!profile?.tenant_id) return;
    const { data } = await supabase
      .from('school_settings')
      .select('*')
      .eq('tenant_id', profile.tenant_id)
      .maybeSingle();
    if (data) {
      setSchoolPos({ 
        lat: Number(data.latitude), 
        lng: Number(data.longitude), 
        radius: data.pickup_radius_meters 
      });
    }
  };

  const fetchStudents = async () => {
    if (!profile?.tenant_id) return;
    const { data } = await supabase
      .from('parent_students')
      .select('students(*)')
      .eq('parent_id', profile.id)
      .eq('students.tenant_id', profile.tenant_id);
    
    if (data) setStudents(data.map(d => d.students).filter(Boolean));
  };

  const fetchNotifications = async () => {
    if (!profile?.tenant_id) return;
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', profile.id)
      .eq('tenant_id', profile.tenant_id)
      .order('created_at', { ascending: false });
    if (data) setNotifications(data);
  };

  const markAsRead = async (id: string) => {
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
  };

  const deleteNotification = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const { data, error } = await supabase.from('notifications').delete().eq('id', id).select();
    if (error) {
      console.error('Error deleting notification:', error);
    } else if (data && data.length > 0) {
      setNotifications(prev => prev.filter(n => n.id !== id));
    } else {
      console.warn('No notification was deleted. Check RLS policies.');
    }
  };

  const clearAllNotifications = async () => {
    const { data, error } = await supabase.from('notifications').delete().eq('user_id', profile.id).select();
    if (error) {
      console.error('Error clearing notifications:', error);
    } else if (data && data.length > 0) {
      setNotifications([]);
    } else {
      console.warn('No notifications were deleted. Check RLS policies.');
    }
  };

  const fetchPendingForms = async () => {
    if (!profile?.tenant_id) return;
    // 1. Get student grade+section for THIS tenant
    const { data: stdData } = await supabase
      .from('parent_students')
      .select('students(grade, section, tenant_id)')
      .eq('parent_id', profile.id)
      .eq('students.tenant_id', profile.tenant_id);

    const myStudents = (stdData?.map(d => d.students as any).filter(Boolean) || []) as { grade: string; section: string | null }[];
    const grades = myStudents.map(s => s.grade).filter(Boolean);
    if (grades.length === 0) return;

    // 2. Fetch active forms targeted to these grades in this tenant (filtro
    // grueso por grado a nivel de base de datos; la sección se afina abajo)
    const { data: formsData } = await supabase
      .from('forms')
      .select('*, form_questions(*)')
      .eq('is_active', true)
      .eq('tenant_id', profile.tenant_id)
      .overlaps('target_grades', grades);

    // Un formulario aplica si alguno de mis hijos está en un grado
    // segmentado, y si además se segmentó por sección, en una de esas
    // secciones (comparación sin mayúsculas/espacios, como el resto del
    // sistema, porque cada colegio escribe sus secciones distinto).
    const norm = (s: string | null | undefined) => (s || '').trim().toLowerCase();
    const matchesForm = (form: any) => myStudents.some(s => {
      if (!form.target_grades?.includes(s.grade)) return false;
      const sections: string[] = form.target_sections || [];
      if (sections.length === 0) return true;
      return sections.map(norm).includes(norm(s.section));
    });
    const matchingForms = (formsData || []).filter(matchesForm);

    // 3. Filter forms NOT answered yet
    const { data: responses } = await supabase
      .from('form_responses')
      .select('form_id')
      .eq('parent_id', profile.id)
      .eq('tenant_id', profile.tenant_id);

    const answeredIds = responses?.map(r => r.form_id) || [];
    setPendingForms(matchingForms.filter(f => !answeredIds.includes(f.id)));
  };

  const checkActivePickups = async () => {
    if (!profile?.tenant_id) return;
    const { data } = await supabase
      .from('pickup_events')
      .select('*, student:students(first_name, tenant_id)')
      .eq('parent_id', profile.id)
      .eq('tenant_id', profile.tenant_id)
      .in('status', ['announced', 'in_queue', 'released']);

    if (data && data.length > 0) {
      // Prioritize 'released' status: if any child is released, show the released UI
      const hasReleased = data.some(event => event.status === 'released');
      if (hasReleased) {
        setStatus('released');
      } else {
        setStatus('pickup_active');
      }
    } else {
      setStatus('idle');
    }
  };

  const handleFinalConfirm = async (auto = false) => {
    setLoading(true);
    const { error } = await supabase
      .from('pickup_events')
      .update({ status: 'completed', completed_at: new Date() })
      .eq('parent_id', profile.id)
      .eq('status', 'released');

    if (!error) {
      await logActivity(
        'PICKUP',
        auto
          ? `CICLO COMPLETADO (automático): se detectó que ${profile.first_name} salió del perímetro del colegio con la recogida ya autorizada.`
          : `CICLO COMPLETADO: ${profile.first_name} confirmó reunión con el alumno en el vehículo.`,
        profile.first_name,
        { auto_confirmed: auto },
        profile?.tenant_id
      );
      setStatus('idle');
      setJustCompletedToday(true);
      if (auto) {
        setSuccessMessage('Detectamos que saliste del colegio — dimos por confirmada la recogida automáticamente.');
        setTimeout(() => setSuccessMessage(null), 10000);
      } else {
        alert("¡Ciclo de recogida terminado! Buen viaje.");
      }
    }
    setLoading(false);
  };

  // Mientras el padre siga dentro del perímetro después de cerrar el ciclo
  // de hoy, no tiene sentido volver a ofrecerle "Anunciar Llegada" — ya
  // recogió al alumno. Se muestra un cierre amable en su lugar, y se olvida
  // solo en cuanto se retira (para que mañana vuelva a funcionar normal).
  const [justCompletedToday, setJustCompletedToday] = useState(false);
  useEffect(() => {
    if (!isInside) setJustCompletedToday(false);
  }, [isInside]);

  const getFarewellMessage = () => {
    const day = new Date().getDay(); // 0=domingo … 5=viernes, 6=sábado
    if (day === 5) return { title: '¡Buen fin de semana!', subtitle: 'Nos vemos el lunes.' };
    if (day === 0 || day === 6) return { title: '¡Nos vemos pronto!', subtitle: 'Que descanses.' };
    return { title: '¡Nos vemos mañana!', subtitle: 'Buen viaje a casa.' };
  };

  const handleSubmitForm = async () => {
    if (!activeForm || students.length === 0) return;
    
    setLoading(true);
    try {
      // 1. We link the response to the context of the children
      const firstStudentId = students[0]?.id;
      
      const { data, error } = await supabase
        .from('form_responses')
        .insert({
          form_id: activeForm.id,
          parent_id: profile.id,
          student_id: firstStudentId,
          answers: answers,
          tenant_id: profile?.tenant_id
        })
        .select();

      if (error) throw error;

      await logActivity(
        'FORM', 
        `AUTORIZACIÓN FIRMADA: ${profile.first_name} firmó "${activeForm.title}" para su hijo.`,
        profile.first_name,
        {},
        profile?.tenant_id
      );

      setActiveForm(null);
      setAnswers({});
      await fetchPendingForms();
      alert("¡Respuesta enviada con éxito!");
    } catch (err: any) {
      console.error(err);
      alert("Error al enviar: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleLocation = () => {
    if (!isLocationEnabled) startLocationWatch();
    else stopLocationWatch();
    setIsLocationEnabled(!isLocationEnabled);
  };

  const startLocationWatch = () => {
    if (!("geolocation" in navigator)) {
      setErrorMessage("Este navegador no permite compartir ubicación.");
      setIsLocationEnabled(false);
      return;
    }

    watchId.current = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setParentPos({ lat: latitude, lng: longitude });
        const dist = calculateDistance(latitude, longitude, schoolPosRef.current.lat, schoolPosRef.current.lng);
        setDistance(dist);
        setIsInside(dist <= schoolPosRef.current.radius);
        setErrorMessage(null);
      },
      (error) => {
        // El código 1 (PERMISSION_DENIED) en iOS suele quedar así para
        // siempre una vez negado: Safari no vuelve a mostrar el diálogo del
        // sistema, así que hay que decirle al padre exactamente dónde
        // activarlo a mano (o, si abrió el enlace dentro de otra app como
        // Gmail/Outlook, que lo abra directo en Safari).
        if (error.code === error.PERMISSION_DENIED) {
          setErrorMessage(
            isInAppBrowser
              ? 'No se pudo activar la ubicación porque abriste el enlace dentro de Gmail/Correo, y ese navegador interno no puede pedir permiso de ubicación aunque tu iPhone lo tenga activado. Toca el botón de menú (⋯) o compartir arriba de la pantalla y elige "Abrir en Safari", y ahí sí funcionará.'
              : 'Tu iPhone está bloqueando la ubicación para esta página. Ve a Ajustes → Privacidad y seguridad → Localización y actívala si está apagada (interruptor arriba); luego, dentro de esa misma pantalla, busca Safari (páginas web) y ponlo en "Preguntar" o "Mientras se usa la app".'
          );
        } else if (error.code === error.TIMEOUT) {
          setErrorMessage("No se pudo obtener tu ubicación a tiempo. Verifica tu señal e intenta de nuevo.");
        } else {
          setErrorMessage("No se pudo obtener tu ubicación en este momento. Intenta de nuevo.");
        }
        setIsLocationEnabled(false);
      },
      { enableHighAccuracy: true }
    );
  };

  const stopLocationWatch = () => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    setParentPos(null);
    setDistance(null);
    setIsInside(false);
    setErrorMessage(null);
  };

  const handleBackgroundLocation = (lat: number, lng: number) => {
    setParentPos({ lat, lng });
    const dist = calculateDistance(lat, lng, schoolPosRef.current.lat, schoolPosRef.current.lng);
    setDistance(dist);
    setIsInside(dist <= schoolPosRef.current.radius);
    setErrorMessage(null);
    setIsLocationEnabled(true);
  };

  const startNativeTracking = async () => {
    try {
      await startBackgroundWatch(
        (loc) => handleBackgroundLocation(loc.latitude, loc.longitude),
        (message) => setErrorMessage(message),
      );
      setIsBackgroundTrackingActive(true);
    } catch (err: any) {
      setErrorMessage(err?.message || 'No se pudo activar el rastreo de ubicación en segundo plano.');
    }
  };

  const handleAcceptLocationRationale = async () => {
    markLocationRationaleSeen();
    setShowLocationRationale(false);
    await startNativeTracking();
  };

  // En la app nativa, la ubicación se activa sola (sin toggle manual): se
  // pide el permiso "Permitir siempre" una vez, con explicación previa, y a
  // partir de ahí el colegio se entera de las llegadas y salidas del padre
  // aunque la app esté minimizada.
  useEffect(() => {
    if (!isNative) return;

    if (hasSeenLocationRationale()) {
      startNativeTracking();
    } else {
      setShowLocationRationale(true);
    }

    return () => {
      stopBackgroundWatch();
      setIsBackgroundTrackingActive(false);
    };
  }, []);

  // Al entrar al perímetro por rastreo nativo en segundo plano, se anuncia la
  // llegada sin que el padre tenga que abrir la app ni tocar nada.
  //
  // Importante: solo debe dispararse quien acaba de ENTRAR al perímetro
  // (transición fuera→dentro), no simplemente "está dentro y el estado está
  // en idle". Sin ese matiz, terminar la recogida (que deja status en
  // 'idle') mientras el padre sigue parado dentro del perímetro —porque
  // todavía no arrancó el carro— volvía a disparar un anuncio de llegada
  // repetido, en loop, hasta que finalmente se retiraba.
  const wasInsideRef = useRef(false);
  useEffect(() => {
    if (!isNative || !isBackgroundTrackingActive) return;
    const justEntered = isInside && !wasInsideRef.current;
    wasInsideRef.current = isInside;
    if (justEntered && status === 'idle' && !loading) {
      handleAnnounceArrival();
    }
  }, [isNative, isBackgroundTrackingActive, isInside, status, loading]);

  // Reporta al colegio si el padre está dentro o fuera del perímetro, para
  // que recepción vea en vivo quién está llegando — sin guardar coordenadas,
  // solo un booleano y desde cuándo. Se actualiza cada vez que isInside
  // cambia de valor (no en cada lectura de GPS), así que sirve tanto para el
  // rastreo nativo en segundo plano como para el watch del navegador.
  useEffect(() => {
    if (!profile?.id || !profile?.tenant_id || !isLocationEnabled) return;
    supabase.from('parent_presence').upsert({
      parent_id: profile.id,
      tenant_id: profile.tenant_id,
      is_inside: isInside,
      entered_at: isInside ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }).then(({ error }) => {
      if (error) console.error('Error al reportar presencia:', error);
    });
  }, [isInside, isLocationEnabled, profile?.id, profile?.tenant_id]);

  // Auto-refresh every 3 seconds when inside perimeter
  useEffect(() => {
    let interval: number | null = null;
    
    if (isInside && isLocationEnabled) {
      interval = window.setInterval(() => {
        console.log('Parent inside school perimeter: Auto-refreshing status...');
        checkActivePickups();
        fetchNotifications();
        fetchPendingForms();
      }, 3000);
    } else {
      // General fallback polling every 10 seconds when outside or location disabled
      interval = window.setInterval(() => {
        console.log('Parent fallback polling...');
        checkActivePickups();
        fetchNotifications();
        fetchPendingForms();
      }, 10000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isInside, isLocationEnabled]);

  // Si la escuela ya autorizó la salida (status 'released') y el padre sale del
  // perímetro sin presionar "Confirmar reunión", lo damos por confirmado solo:
  // probablemente ya recogió al alumno y olvidó tocar el botón. Se espera 20s
  // fuera del perímetro (no al primer instante) para evitar falsos positivos
  // por ruido del GPS cerca del borde de la geocerca.
  useEffect(() => {
    if (status !== 'released' || !isLocationEnabled || isInside) return;

    const timeoutId = window.setTimeout(() => {
      handleFinalConfirm(true);
    }, 20000);

    return () => window.clearTimeout(timeoutId);
  }, [status, isLocationEnabled, isInside]);

  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  };

  // A los hijos propios se les suman los alumnos que hoy le tocan a este
  // padre por un pool day (autorizado por el padre/tutor real). Así puede
  // anunciar la llegada y aparecer en la tarjeta de abajo igual que con sus
  // propios hijos, aunque no esté vinculado a ellos en parent_students.
  const pickupStudents = React.useMemo(() => {
    const ownIds = new Set(students.map(s => s.id));
    const extra = (carpoolData.todaysCarpoolStudents || [])
      .filter(s => !ownIds.has(s.id))
      .map(s => ({ ...s, _isCarpool: true }));
    return [...students, ...extra];
  }, [students, carpoolData.todaysCarpoolStudents]);

  const handleAnnounceArrival = async (manual: boolean = false) => {
    if (!isInside && !manual) return;
    setLoading(true);
    for (const student of pickupStudents) {
      const { error: insertError } = await supabase.from('pickup_events').insert({
        parent_id: profile.id,
        student_id: student.id,
        status: 'announced',
        announced_at: new Date().toISOString(),
        tenant_id: profile.tenant_id,
        door_id: selectedDoorId || null,
        location_verified: !manual,
      });

      if (insertError) {
        console.error('Error inserting pickup event:', insertError);
        setErrorMessage(`Error al anunciar: ${insertError.message}`);
        setLoading(false);
        return;
      }

      // Aviso dirigido al profesor/personal encargado de este grado+sección
      // hoy (excepción del día, si hay, si no el horario semanal). No
      // reemplaza la cola compartida que ya ven recepción y administración —
      // solo se suma para avisar directamente a la persona correcta.
      //
      // El padre no tiene permiso (RLS) para insertar una notificación
      // dirigida a OTRO usuario (solo a sí mismo, o si fuera staff) — insertar
      // esto directo desde aquí fallaba en silencio para TODOS los avisos de
      // llegada. Por eso pasa por el backend, igual que el aviso de pool day
      // al admin un poco más abajo.
      try {
        const isCarpool = !!(student as any)._isCarpool;

        await apiFetch('/api/pickup/notify-staff', {
          method: 'POST',
          body: JSON.stringify({ student_id: student.id }),
        });

        // El padre no tiene permiso para leer la lista de administradores
        // (RLS), así que el aviso al admin de que hoy aplica un pool day pasa
        // por el backend, que además revalida que la autorización sea real
        // antes de notificar a nadie.
        if (isCarpool) {
          await apiFetch('/api/carpool/pickup-notify', {
            method: 'POST',
            body: JSON.stringify({ student_id: student.id }),
          });
        }
      } catch (routeErr) {
        console.error('Error al enrutar el aviso al encargado:', routeErr);
      }
    }

    await logActivity(
      'PICKUP',
      manual
        ? `ANUNCIO DE LLEGADA: ${profile.first_name} confirmó su llegada manualmente (sin GPS).`
        : `ANUNCIO DE LLEGADA: ${profile.first_name} llegó a la escuela mediante GPS.`,
      profile.first_name,
      { coords: [parentPos?.lat, parentPos?.lng] },
      profile?.tenant_id
    );

    setShowManualArrival(false);
    setStatus('pickup_active');
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 font-body pb-10">
      {/* Header */}
      <div className="bg-gradient-to-br from-indigo-700 to-violet-800 text-white p-6 rounded-b-[3rem] shadow-2xl relative overflow-hidden">
        <div className="relative z-10 flex justify-between items-center mb-6">
          <div className="flex items-center gap-4">
            <img src={profile?.photo_url || "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100"} className="w-16 h-16 rounded-[1.25rem] object-cover border-2 border-white" />
            <div>
              {profiles.length > 1 ? (
                <button 
                  onClick={() => setShowSchoolSelector(!showSchoolSelector)}
                  className="flex items-center gap-1 group"
                >
                  <p className="text-indigo-100 text-[10px] font-black uppercase tracking-widest opacity-80 group-hover:opacity-100">
                    {profile?.tenant?.name || 'Cambiar Colegio'}
                  </p>
                  <ChevronRight className={`w-3 h-3 text-indigo-100 transition-transform ${showSchoolSelector ? 'rotate-90' : ''}`} />
                </button>
              ) : (
                <p className="text-indigo-100 text-[10px] font-black uppercase tracking-widest opacity-80">
                  {profile?.tenant?.name || 'Safe SmartPickUP'}
                </p>
              )}
              <h1 className="text-2xl font-black">{profile?.first_name} {profile?.last_name}</h1>
            </div>
          </div>
          <div className="flex gap-3">
            <button 
              onClick={() => setShowNotifications(!showNotifications)}
              className="p-3 bg-white/10 rounded-2xl hover:bg-white/20 relative transition-all active:scale-95"
            >
              <Bell className="w-5 h-5 text-white" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 bg-rose-500 text-white text-[10px] font-black flex items-center justify-center rounded-full border-2 border-indigo-700 animate-pulse">
                  {unreadCount}
                </span>
              )}
            </button>
            <button onClick={signOut} className="p-3 bg-white/10 rounded-2xl hover:bg-white/20 transition-all active:scale-95">
              <LogOut className="w-5 h-5 text-white" />
            </button>
          </div>
        </div>

        {/* School Selector Dropdown */}
        {showSchoolSelector && (
          <div className="absolute top-24 left-6 right-6 z-50 bg-white rounded-3xl shadow-2xl border border-indigo-100 p-2 animate-in slide-in-from-top-4 duration-300">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] p-3">Selecciona tu colegio</p>
            {profiles.map((p: any) => (
              <button
                key={p.tenant_id}
                onClick={() => {
                  switchProfile(p.tenant_id);
                  setShowSchoolSelector(false);
                }}
                className={`w-full flex items-center justify-between p-4 rounded-2xl transition-all ${p.tenant_id === profile?.tenant_id ? 'bg-indigo-600 text-white shadow-lg' : 'hover:bg-slate-50 text-slate-600 font-bold'}`}
              >
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-xl ${p.tenant_id === profile?.tenant_id ? 'bg-white/20' : 'bg-slate-100'}`}>
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <span className="text-sm">{p.tenant?.name || 'Sede Alterna'}</span>
                </div>
                {p.tenant_id === profile?.tenant_id && <CheckCircle2 className="w-4 h-4" />}
              </button>
            ))}
          </div>
        )}

        {isNative ? (
          <div className={`p-4 rounded-2xl flex items-center justify-between border ${isLocationEnabled ? 'bg-emerald-500/20 border-emerald-400/30' : 'bg-white/10 border-white/10'}`}>
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${isLocationEnabled ? 'bg-emerald-500 text-white' : 'bg-white/20'}`}>
                <Navigation className="w-4 h-4" />
              </div>
              <div>
                <span className="text-xs font-black block">Ubicación en Segundo Plano</span>
                <span className="text-[10px] text-indigo-100 opacity-80">
                  {isLocationEnabled ? 'Activa automáticamente' : 'Esperando permiso del sistema'}
                </span>
              </div>
            </div>
            {!isLocationEnabled && (
              <button
                onClick={openLocationSettings}
                className="text-[10px] font-black uppercase tracking-widest text-indigo-100 underline"
              >
                Ajustes
              </button>
            )}
          </div>
        ) : (
          <div onClick={toggleLocation} className={`p-4 rounded-2xl flex items-center justify-between border cursor-pointer ${isLocationEnabled ? 'bg-emerald-500/20 border-emerald-400/30' : 'bg-white/10 border-white/10'}`}>
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${isLocationEnabled ? 'bg-emerald-500 text-white' : 'bg-white/20'}`}>
                <Navigation className="w-4 h-4" />
              </div>
              <span className="text-xs font-black">Compartir Ubicación GPS</span>
            </div>
            <div className={`w-12 h-6 rounded-full relative border-2 ${isLocationEnabled ? 'bg-emerald-500 border-emerald-400' : 'bg-slate-400/20 border-white/10'}`}>
               <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${isLocationEnabled ? 'left-6' : 'left-0.5'}`} />
            </div>
          </div>
        )}

        {doors.length > 1 && (
          <div className="p-4 rounded-2xl border bg-white/10 border-white/10 mt-3">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 rounded-lg bg-white/20">
                <MapPin className="w-4 h-4" />
              </div>
              <span className="text-xs font-black">¿Por cuál puerta vas a pasar?</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {doors.map(door => (
                <button
                  key={door.id}
                  type="button"
                  onClick={() => handleSelectDoor(door.id)}
                  className={`px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all ${
                    selectedDoorId === door.id
                      ? 'bg-emerald-500 text-white'
                      : 'bg-white/10 text-indigo-100 hover:bg-white/20'
                  }`}
                >
                  {door.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="max-w-md mx-auto p-6 space-y-6">
        
        {isInAppBrowser && !isLocationEnabled && !errorMessage && (
          <div className="bg-amber-50 text-amber-700 p-4 rounded-2xl text-xs font-bold flex items-center gap-3 border border-amber-100 animate-in slide-in-from-top-2">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            Parece que abriste este enlace dentro de Gmail o Correo. Para poder compartir tu ubicación con el colegio, toca el menú (⋯) o el ícono de compartir arriba y elige "Abrir en Safari".
          </div>
        )}

        {errorMessage && (
          <div className="bg-red-50 text-red-600 p-4 rounded-2xl text-sm font-bold flex items-center gap-3 border border-red-100 animate-in slide-in-from-top-2">
            <AlertTriangle className="w-5 h-5" />
            {errorMessage}
          </div>
        )}

        {successMessage && (
          <div className="bg-emerald-50 text-emerald-600 p-4 rounded-2xl text-sm font-bold flex items-center gap-3 border border-emerald-100 animate-in slide-in-from-top-2">
            <CheckCircle2 className="w-5 h-5" />
            {successMessage}
          </div>
        )}

        {/* Pending Autorizations Alert */}
        {pendingForms.length > 0 && (
          <section className="bg-white rounded-[2.5rem] p-6 shadow-xl border border-indigo-100 overflow-hidden relative group animate-in slide-in-from-top-4">
            <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-50 rounded-full -mr-16 -mt-16 blur-2xl" />
            <div className="flex items-center gap-3 mb-4">
               <div className="p-2 bg-indigo-600 rounded-xl">
                  <Bell className="w-4 h-4 text-white animate-ring" />
               </div>
               <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight">Avisos y Autorizaciones</h3>
            </div>
            <div className="space-y-3">
              {pendingForms.map(form => (
                <button
                  key={form.id}
                  onClick={() => setActiveForm(form)}
                  className="w-full bg-slate-50 p-4 rounded-2xl flex items-center justify-between border border-transparent hover:border-indigo-200 transition-all text-left"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-bold text-slate-700 text-xs">{form.title}</h4>
                      <span className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest ${form.form_type === 'announcement' ? 'bg-indigo-100 text-indigo-600' : 'bg-amber-100 text-amber-700'}`}>
                        {form.form_type === 'announcement' ? 'Aviso' : 'Autorización'}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400 font-bold uppercase mt-1">Grados: {form.target_grades?.join(', ')}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-indigo-400" />
                </button>
              ))}
            </div>
          </section>
        )}

        <div className={`p-6 rounded-[2.5rem] shadow-xl border-2 ${isInside ? 'bg-white border-emerald-500/30' : 'bg-slate-50 border-slate-200'}`}>
          <div className="flex items-center gap-4 mb-4">
            <div className={`p-4 rounded-2xl ${isInside ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-200'}`}>
              <MapPin className="w-7 h-7" />
            </div>
            <div>
              <h2 className={`font-black uppercase text-[10px] tracking-widest ${isInside ? 'text-emerald-600' : 'text-slate-400'}`}>
                Sede: {profile?.tenant?.name || 'Colegio'}
              </h2>
              <p className="text-xl font-black">
                {isInside ? '¡Llegaste!' : isLocationEnabled ? `${Math.round(distance || 0)}m de distancia` : 'Ubicación no disponible'}
              </p>
            </div>
          </div>
        </div>

        {status === 'released' ? (
          <div className="bg-amber-500 p-8 rounded-[3rem] text-white shadow-2xl relative overflow-hidden animate-bounce-short">
             <div className="flex items-center gap-4 mb-6">
               <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center border border-white/10">
                 <UserCheck className="w-7 h-7 text-white" />
               </div>
               <div>
                  <h3 className="text-xl font-black">¡Alumno en camino!</h3>
                  <p className="text-[10px] font-bold text-amber-100 uppercase">El maestro ha autorizado la salida</p>
               </div>
             </div>
             <button 
               onClick={handleFinalConfirm}
               disabled={loading}
               className="w-full bg-white text-amber-600 font-black py-5 rounded-[2rem] shadow-xl active:scale-95 flex items-center justify-center gap-3 text-xs uppercase tracking-widest"
             >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'CONFIRMAR REUNIÓN / FINALIZAR'}
             </button>
          </div>
        ) : status === 'pickup_active' ? (
          <div className="bg-indigo-900 p-8 rounded-[3rem] text-white shadow-2xl relative overflow-hidden">
             <div className="flex items-center gap-4 mb-6">
               <div className="w-14 h-14 bg-emerald-500/20 rounded-2xl flex items-center justify-center border border-white/10">
                 <Bell className="w-7 h-7 text-emerald-400 animate-bounce" />
               </div>
               <h3 className="text-xl font-black">Maestro Notificado</h3>
             </div>
             <div className="bg-white/10 p-6 rounded-3xl flex flex-col items-center">
               <span className="text-xs font-black text-indigo-200 uppercase tracking-widest mb-2">Tu PIN</span>
               <span className="text-4xl font-black tracking-[0.3em]">{profile?.pin_code}</span>
             </div>
          </div>
        ) : justCompletedToday && isInside ? (
          <div className="bg-emerald-600 p-8 rounded-[3rem] text-white shadow-2xl relative overflow-hidden text-center">
             <ShieldCheck className="w-10 h-10 mx-auto mb-4 text-emerald-100" />
             <h3 className="text-2xl font-black">{getFarewellMessage().title}</h3>
             <p className="text-sm font-bold text-emerald-100 mt-2">{getFarewellMessage().subtitle}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {isLocationEnabled ? (
              <button
                onClick={() => handleAnnounceArrival()}
                disabled={!isInside || loading}
                className={`w-full p-8 rounded-[3rem] shadow-2xl transition-all flex flex-col items-center gap-4 ${isInside ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-400 shadow-none'}`}
              >
                 <ShieldCheck className="w-10 h-10" />
                 <span className="text-2xl font-black">ANUNCIAR LLEGADA</span>
              </button>
            ) : (
              <div className="bg-white border-2 border-dashed border-slate-200 rounded-[3rem] p-6 space-y-3">
                <p className="text-xs font-bold text-slate-500 text-center">
                  No pudimos confirmar tu ubicación automáticamente. Puedes intentar activarla, o avisar que ya llegaste sin ella.
                </p>
                {!showManualArrival ? (
                  <>
                    <button
                      onClick={() => setShowManualArrival(true)}
                      disabled={loading}
                      className="w-full p-6 bg-indigo-600 text-white rounded-[2.5rem] shadow-xl flex flex-col items-center gap-2"
                    >
                      <ShieldCheck className="w-8 h-8" />
                      <span className="text-lg font-black">YA ESTOY EN EL COLEGIO</span>
                    </button>
                    <button
                      onClick={toggleLocation}
                      className="w-full text-center text-[10px] font-black uppercase tracking-widest text-indigo-500 underline"
                    >
                      Intentar activar ubicación
                    </button>
                  </>
                ) : (
                  <div className="space-y-3">
                    <p className="text-xs font-bold text-slate-600 text-center">
                      Confirma que estás físicamente en la zona de recogida. El colegio verificará tu identidad como siempre al llegar.
                    </p>
                    <div className="flex gap-3">
                      <button
                        onClick={() => setShowManualArrival(false)}
                        disabled={loading}
                        className="flex-1 py-4 rounded-2xl bg-slate-100 text-slate-500 font-black text-xs uppercase tracking-widest"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={() => handleAnnounceArrival(true)}
                        disabled={loading}
                        className="flex-1 py-4 rounded-2xl bg-indigo-600 text-white font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2"
                      >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirmar llegada'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <button
              onClick={() => setShowReplacementModal(true)}
              className="w-full p-6 bg-white border-2 border-dashed border-indigo-200 rounded-[2.5rem] flex items-center justify-center gap-3 text-indigo-600 font-black text-xs uppercase tracking-widest hover:bg-indigo-50 transition-all"
            >
              <UserPlus className="w-5 h-5" />
              Solicitar Reemplazo de Recogida
            </button>
            <button
              onClick={() => setShowDeliveryModal(true)}
              className="w-full p-6 bg-white border-2 border-dashed border-amber-200 rounded-[2.5rem] flex items-center justify-center gap-3 text-amber-600 font-black text-xs uppercase tracking-widest hover:bg-amber-50 transition-all"
            >
              <MessageSquare className="w-5 h-5" />
              Enviar Mensaje / Delivery
            </button>
            {students.length > 0 && (
              <button
                onClick={() => setShowCarpoolModal(true)}
                className="w-full p-6 bg-white border-2 border-dashed border-emerald-200 rounded-[2.5rem] flex items-center justify-center gap-3 text-emerald-600 font-black text-xs uppercase tracking-widest hover:bg-emerald-50 transition-all"
              >
                <Car className="w-5 h-5" />
                Configurar Pool Day
              </button>
            )}
          </div>
        )}

        {/* Pool Day: lo que configuré para mis hijos + lo que conduzco para otros */}
        {(carpoolData.authorizations.length > 0 || carpoolData.overrides.length > 0 || carpoolData.drivingFor.length > 0 || carpoolData.drivingForOverrides.length > 0) && (
          <section className="space-y-4">
            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">Pool Day</h3>
            <div className="grid grid-cols-1 gap-3">
              {carpoolData.authorizations.map((a: any) => (
                <div key={a.id} className="bg-white p-5 rounded-[2rem] shadow-sm border border-slate-100 flex items-center gap-4">
                  <div className="p-3 bg-emerald-50 rounded-2xl text-emerald-600"><Car className="w-5 h-5" /></div>
                  <div className="flex-1">
                    <h4 className="font-black text-slate-800 text-sm">{a.student?.first_name} {a.student?.last_name}</h4>
                    <p className="text-[10px] text-slate-400 font-bold uppercase">
                      {['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][a.day_of_week]} · Conduce {a.driver?.first_name} {a.driver?.last_name}
                    </p>
                  </div>
                  <button onClick={() => handleDeleteCarpoolAuthorization(a.id)} className="p-3 bg-rose-50 text-rose-500 rounded-xl hover:bg-rose-500 hover:text-white transition-all">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              {carpoolData.overrides.map((o: any) => (
                <div key={o.id} className="bg-white p-5 rounded-[2rem] shadow-sm border border-slate-100 flex items-center gap-4">
                  <div className="p-3 bg-amber-50 rounded-2xl text-amber-600"><CalendarDays className="w-5 h-5" /></div>
                  <div className="flex-1">
                    <h4 className="font-black text-slate-800 text-sm">{o.student?.first_name} {o.student?.last_name}</h4>
                    <p className="text-[10px] text-slate-400 font-bold uppercase">{o.override_date} (solo ese día) · Conduce {o.driver?.first_name} {o.driver?.last_name}</p>
                  </div>
                  <button onClick={() => handleDeleteCarpoolOverride(o.id)} className="p-3 bg-rose-50 text-rose-500 rounded-xl hover:bg-rose-500 hover:text-white transition-all">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              {(carpoolData.drivingFor.length > 0 || carpoolData.drivingForOverrides.length > 0) && (
                <div className="bg-indigo-50 p-5 rounded-[2rem] border border-indigo-100">
                  <p className="text-[10px] font-black text-indigo-500 uppercase tracking-widest mb-3">Tú conduces para</p>
                  <div className="space-y-2">
                    {carpoolData.drivingFor.map((a: any) => (
                      <p key={a.id} className="text-xs font-bold text-indigo-700">
                        {a.student?.first_name} {a.student?.last_name} — {['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][a.day_of_week]} (por {a.authorizing?.first_name} {a.authorizing?.last_name})
                      </p>
                    ))}
                    {carpoolData.drivingForOverrides.map((o: any) => (
                      <p key={o.id} className="text-xs font-bold text-indigo-700">
                        {o.student?.first_name} {o.student?.last_name} — {o.override_date} (por {o.authorizing?.first_name} {o.authorizing?.last_name})
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Authorized Replacements Section */}
        {authorizedReplacements.length > 0 && (
          <section className="space-y-4">
            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">Reemplazos Autorizados</h3>
            <div className="grid grid-cols-1 gap-4">
              {authorizedReplacements.map((rep: any, idx: number) => (
                <div key={idx} className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100 flex items-center gap-6">
                  <div className="bg-slate-50 p-3 rounded-2xl">
                    <QRCodeSVG
                      value={JSON.stringify({
                        type: 'replacement_pickup',
                        parent_id: profile.id,
                        token: rep.token,
                        replacement_name: rep.name,
                        photo_url: rep.photo_url ?? null
                      })}
                      size={64}
                    />
                  </div>
                  {rep.photo_url && (
                    <div className="w-14 h-14 rounded-2xl overflow-hidden shrink-0 border border-slate-100">
                      <img src={rep.photo_url} alt={rep.name} className="w-full h-full object-cover" />
                    </div>
                  )}
                  <div className="flex-1">
                    <h4 className="font-black text-slate-800 text-sm">{rep.name}</h4>
                    <p className="text-[10px] text-slate-400 font-bold uppercase">{rep.phone}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-lg text-[8px] font-black uppercase border border-emerald-100">Activo</span>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleShareQR(rep)}
                    className="p-4 bg-indigo-50 text-indigo-600 rounded-2xl hover:bg-indigo-600 hover:text-white transition-all shadow-sm"
                  >
                    <Share2 className="w-5 h-5" />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="space-y-4">
           {pickupStudents.map(s => (
             <div key={s.id} className="bg-white p-4 rounded-3xl shadow-sm border border-slate-100 flex items-center gap-4">
                <img src={s.photo_url || "https://images.unsplash.com/photo-1595152772835-219674b2a8a6?w=200"} className="w-16 h-16 rounded-2xl object-cover" />
                <div className="flex-1">
                   <h5 className="font-bold text-slate-800">{s.first_name} {s.last_name}</h5>
                   <p className="text-[11px] text-slate-500 font-black uppercase">{s.grade || 'Grado no asignado'}</p>
                </div>
                {(s as any)._isCarpool && (
                  <span className="bg-emerald-50 text-emerald-600 px-2.5 py-1 rounded-lg text-[8px] font-black uppercase border border-emerald-100 flex items-center gap-1">
                    <Car className="w-3 h-3" /> Pool day hoy
                  </span>
                )}
             </div>
           ))}
        </div>
      </div>

      {/* FORM MODAL */}
      {activeForm && (
        <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md animate-in fade-in">
           <div className="bg-white w-full max-w-lg rounded-t-[3rem] sm:rounded-[3rem] overflow-hidden shadow-2xl animate-in slide-in-from-bottom-10">
              <div className="p-8 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
                 <div className="flex items-center gap-4">
                    <div className="p-3 bg-indigo-600 rounded-2xl text-white">
                       <FileText className="w-6 h-6" />
                    </div>
                    <h2 className="text-xl font-black text-slate-900">{activeForm.title}</h2>
                 </div>
                 <button onClick={() => setActiveForm(null)} className="p-2.5 bg-white text-slate-400 rounded-xl shadow-sm"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-8 space-y-6 max-h-[60vh] overflow-y-auto">
                 <p className="text-slate-500 text-sm font-medium whitespace-pre-wrap">{activeForm.description}</p>
                 {activeForm.form_type !== 'announcement' && (
                   <div className="space-y-6">
                      {activeForm.form_questions.map((q: any) => (
                        <div key={q.id} className="space-y-4">
                           <label className="text-sm font-black text-slate-800 leading-tight block">{q.question_text}</label>
                           {q.question_type === 'boolean' ? (
                             <div className="grid grid-cols-2 gap-4">
                               <button
                                 onClick={() => setAnswers({...answers, [q.id]: 'SI'})}
                                 className={`py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest border-2 transition-all ${answers[q.id] === 'SI' ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-slate-50 border-slate-100 text-slate-400'}`}
                               >SÍ, AUTORIZO</button>
                               <button
                                 onClick={() => setAnswers({...answers, [q.id]: 'NO'})}
                                 className={`py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest border-2 transition-all ${answers[q.id] === 'NO' ? 'bg-rose-600 border-rose-600 text-white' : 'bg-slate-50 border-slate-100 text-slate-400'}`}
                               >NO AUTORIZO</button>
                             </div>
                           ) : (
                             <input
                               placeholder="Escribe tu respuesta..."
                               onChange={e => setAnswers({...answers, [q.id]: e.target.value})}
                               className="w-full bg-slate-50 border-none rounded-2xl px-6 py-4 text-sm font-medium outline-none focus:ring-2 ring-indigo-500/20"
                             />
                           )}
                        </div>
                      ))}
                   </div>
                 )}
              </div>
              <div className="p-8 border-t border-slate-50 flex gap-4">
                 <button onClick={handleSubmitForm} disabled={loading} className="w-full bg-indigo-600 text-white font-black py-5 rounded-[2rem] shadow-xl shadow-indigo-100 active:scale-95 flex items-center justify-center gap-3 text-xs uppercase tracking-widest">
                    {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : activeForm.form_type === 'announcement' ? <><CheckCircle2 className="w-4 h-4" /> ENTENDIDO</> : <><Send className="w-4 h-4" /> ENVIAR FIRMA DIGITAL</>}
                 </button>
              </div>
           </div>
        </div>
      )}
      {/* REPLACEMENT REQUEST MODAL */}
      {showLocationRationale && (
        <div className="fixed inset-0 z-[400] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md animate-in fade-in">
          <div className="bg-white w-full max-w-sm rounded-[3rem] overflow-hidden shadow-2xl animate-in zoom-in-95">
            <div className="p-8 bg-slate-50 border-b border-slate-100 flex items-center gap-3">
              <div className="p-2 bg-indigo-600 rounded-xl text-white">
                <MapPin className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest">Ubicación en Segundo Plano</h3>
            </div>
            <div className="p-8 space-y-6">
              <p className="text-xs text-slate-500 font-medium leading-relaxed">
                Safe Smart Pickup usa tu ubicación para avisarle al colegio automáticamente cuando llegas a la
                zona de recogida y cuando te retiras con tu hijo o hija — sin que tengas que abrir la app.
              </p>
              <p className="text-xs text-slate-500 font-medium leading-relaxed">
                Para eso, Android te va a pedir el permiso <b>“Permitir todo el tiempo”</b>. Solo se usa para
                esta función; nunca se comparte ni se usa con otro fin.
              </p>
              <button
                onClick={handleAcceptLocationRationale}
                className="w-full bg-indigo-600 text-white font-black py-5 rounded-[2rem] shadow-xl shadow-indigo-100 active:scale-95 flex items-center justify-center gap-3 text-xs uppercase tracking-widest"
              >
                Activar Ubicación
              </button>
              <button
                onClick={() => { markLocationRationaleSeen(); setShowLocationRationale(false); }}
                className="w-full text-slate-400 font-bold text-xs uppercase tracking-widest"
              >
                Ahora no
              </button>
            </div>
          </div>
        </div>
      )}

      {showReplacementModal && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md animate-in fade-in">
          <div className="bg-white w-full max-w-sm rounded-[3rem] overflow-hidden shadow-2xl animate-in zoom-in-95">
             <div className="p-8 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
               <div className="flex items-center gap-3">
                 <div className="p-2 bg-indigo-600 rounded-xl text-white">
                   <UserPlus className="w-5 h-5" />
                 </div>
                 <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest">Solicitar Reemplazo</h3>
               </div>
               <button onClick={() => setShowReplacementModal(false)} className="p-2.5 bg-white text-slate-400 rounded-xl shadow-sm"><X className="w-5 h-5" /></button>
             </div>
             <form onSubmit={handleRequestReplacement} className="p-8 space-y-6">
                <p className="text-xs text-slate-500 font-medium leading-relaxed">
                  Ingresa los datos de la persona que recogerá a los niños hoy. El administrador recibirá tu solicitud y generará un código QR seguro.
                </p>
                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Nombre Completo</label>
                    <input 
                      required
                      value={replacementName}
                      onChange={e => setReplacementName(e.target.value)}
                      placeholder="Ej. Juan Pérez"
                      className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-bold text-slate-700 outline-none focus:border-indigo-500 focus:bg-white transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">WhatsApp / Teléfono</label>
                    <input 
                      required
                      value={replacementPhone}
                      onChange={e => setReplacementPhone(e.target.value)}
                      placeholder="+507 ..."
                      className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-bold text-slate-700 outline-none focus:border-indigo-500 focus:bg-white transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Foto de la persona (opcional)</label>
                    <label className="w-full flex items-center gap-4 bg-slate-50 border border-dashed border-slate-300 rounded-2xl px-5 py-4 cursor-pointer hover:border-indigo-400 transition-all">
                      <div className="w-14 h-14 rounded-xl overflow-hidden bg-white border border-slate-200 flex items-center justify-center shrink-0">
                        {replacementPhotoPreview ? (
                          <img src={replacementPhotoPreview} alt="Vista previa" className="w-full h-full object-cover" />
                        ) : (
                          <Camera className="w-5 h-5 text-slate-400" />
                        )}
                      </div>
                      <span className="text-xs font-bold text-slate-500">
                        {replacementPhotoPreview ? 'Cambiar foto' : 'Tomar o subir una foto'}
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={handleReplacementPhotoChange}
                        className="hidden"
                      />
                    </label>
                    <p className="text-[10px] text-slate-400 font-medium mt-2 ml-1">
                      Ayuda a recepción a reconocer a la persona al momento de escanear el QR.
                    </p>
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={isSubmittingReplacement}
                  className="w-full bg-indigo-600 text-white font-black py-5 rounded-[2rem] shadow-xl shadow-indigo-100 active:scale-95 flex items-center justify-center gap-3 text-xs uppercase tracking-widest disabled:opacity-50"
                >
                  {isSubmittingReplacement ? <Loader2 className="w-5 h-5 animate-spin" /> : 'ENVIAR SOLICITUD'}
                </button>
             </form>
          </div>
        </div>
      )}

      {/* DELIVERY MODAL */}
      {showDeliveryModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md animate-in fade-in">
          <div className="bg-white w-full max-w-sm rounded-[3rem] overflow-hidden shadow-2xl animate-in zoom-in-95">
             <div className="p-8 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
               <div className="flex items-center gap-3">
                 <div className="p-2 bg-amber-600 rounded-xl text-white">
                   <MessageSquare className="w-5 h-5" />
                 </div>
                 <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest">Aviso / Delivery</h3>
               </div>
               <button onClick={() => setShowDeliveryModal(false)} className="p-2.5 bg-white text-slate-400 rounded-xl shadow-sm"><X className="w-5 h-5" /></button>
             </div>
             <form onSubmit={handleRequestDelivery} className="p-8 space-y-6">
                <p className="text-xs text-slate-500 font-medium leading-relaxed">
                  Envía un mensaje a recepción. Ejemplo: "Enviaré un pedido por Uber Eats" o "Pasaré dejando una encomienda". Puedes incluir un enlace si lo tienes.
                </p>
                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Mensaje / Detalle</label>
                    <textarea 
                      required
                      value={deliveryMessage}
                      onChange={e => setDeliveryMessage(e.target.value)}
                      placeholder="Ej. Mi hijo olvidó su termo, enviaré un Uber Flash a dejarlo."
                      className="w-full min-h-[100px] bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-bold text-slate-700 outline-none focus:border-amber-500 focus:bg-white transition-all resize-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Enlace / Link (Opcional)</label>
                    <input 
                      value={deliveryLink}
                      onChange={e => setDeliveryLink(e.target.value)}
                      placeholder="Ej. https://ubereats.com/..."
                      className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-bold text-slate-700 outline-none focus:border-amber-500 focus:bg-white transition-all"
                    />
                  </div>
                </div>
                <button 
                  type="submit"
                  disabled={isSubmittingReplacement}
                  className="w-full bg-amber-600 text-white font-black py-5 rounded-[2rem] shadow-xl shadow-amber-100 active:scale-95 flex items-center justify-center gap-3 text-xs uppercase tracking-widest disabled:opacity-50"
                >
                  {isSubmittingReplacement ? <Loader2 className="w-5 h-5 animate-spin" /> : 'ENVIAR AVISO'}
                </button>
             </form>
          </div>
        </div>
      )}

      {/* POOL DAY MODAL */}
      {showCarpoolModal && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md animate-in fade-in">
          <div className="bg-white w-full max-w-sm rounded-[3rem] overflow-hidden shadow-2xl animate-in zoom-in-95 max-h-[90vh] flex flex-col">
             <div className="p-8 bg-slate-50 border-b border-slate-100 flex justify-between items-center shrink-0">
               <div className="flex items-center gap-3">
                 <div className="p-2 bg-emerald-600 rounded-xl text-white">
                   <Car className="w-5 h-5" />
                 </div>
                 <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest">Configurar Pool Day</h3>
               </div>
               <button onClick={() => { setShowCarpoolModal(false); resetCarpoolForm(); }} className="p-2.5 bg-white text-slate-400 rounded-xl shadow-sm"><X className="w-5 h-5" /></button>
             </div>
             <form onSubmit={handleSubmitCarpool} className="p-8 space-y-6 overflow-y-auto">
                <p className="text-xs text-slate-500 font-medium leading-relaxed">
                  Autoriza a otro padre o madre ya registrado a recoger a tu hijo/a. Se activa al instante — el encargado de la salida y el administrador serán notificados, sin necesidad de aprobación.
                </p>

                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Hijo/a</label>
                  <select
                    required
                    value={carpoolStudentId}
                    onChange={e => setCarpoolStudentId(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-bold text-slate-700 outline-none focus:border-emerald-500 focus:bg-white transition-all"
                  >
                    <option value="">Selecciona...</option>
                    {students.map(s => (
                      <option key={s.id} value={s.id}>{s.first_name} {s.last_name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Frecuencia</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setCarpoolMode('weekly')}
                      className={`py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest border-2 transition-all ${carpoolMode === 'weekly' ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-slate-50 border-slate-100 text-slate-400'}`}
                    >Cada Semana</button>
                    <button
                      type="button"
                      onClick={() => setCarpoolMode('oneday')}
                      className={`py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest border-2 transition-all ${carpoolMode === 'oneday' ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-slate-50 border-slate-100 text-slate-400'}`}
                    >Solo Un Día</button>
                  </div>
                </div>

                {carpoolMode === 'weekly' ? (
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Días de la semana</label>
                    <div className="grid grid-cols-4 gap-2">
                      {['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map((label, day) => (
                        <button
                          key={day}
                          type="button"
                          onClick={() => toggleCarpoolDay(day)}
                          className={`py-3 rounded-xl font-black text-[10px] uppercase border-2 transition-all ${carpoolDays.includes(day) ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-slate-50 border-slate-100 text-slate-400'}`}
                        >{label}</button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Fecha</label>
                    <input
                      type="date"
                      required
                      min={new Date().toISOString().slice(0, 10)}
                      value={carpoolDate}
                      onChange={e => setCarpoolDate(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-bold text-slate-700 outline-none focus:border-emerald-500 focus:bg-white transition-all"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">¿Quién conduce?</label>
                  {selectedDriver ? (
                    <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-100 rounded-2xl px-5 py-4">
                      <img src={selectedDriver.photo_url || "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100"} className="w-9 h-9 rounded-xl object-cover" />
                      <span className="flex-1 text-sm font-bold text-slate-700">{selectedDriver.first_name} {selectedDriver.last_name}</span>
                      <button type="button" onClick={() => { setSelectedDriver(null); setDriverQuery(''); }} className="p-1.5 text-slate-400 hover:text-rose-500">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {isLoadingClassmates ? (
                        <div className="flex items-center gap-2 text-slate-400 text-xs font-bold py-2">
                          <Loader2 className="w-4 h-4 animate-spin" /> Cargando padres del salón...
                        </div>
                      ) : classmateParents.length > 0 ? (
                        <div>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Padres del mismo salón</p>
                          <div className="flex flex-wrap gap-2">
                            {classmateParents.map(p => (
                              <button
                                type="button"
                                key={p.id}
                                onClick={() => { setSelectedDriver(p); setDriverResults([]); setDriverQuery(''); }}
                                className="flex items-center gap-2 bg-slate-50 hover:bg-emerald-50 border border-slate-200 hover:border-emerald-300 rounded-2xl pl-2 pr-4 py-2 transition-all"
                              >
                                <img src={p.photo_url || "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100"} className="w-7 h-7 rounded-lg object-cover" />
                                <span className="text-xs font-bold text-slate-700">{p.first_name} {p.last_name}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    <div className="relative">
                      <Search className="w-4 h-4 text-slate-300 absolute left-5 top-1/2 -translate-y-1/2" />
                      <input
                        value={driverQuery}
                        onChange={e => setDriverQuery(e.target.value)}
                        placeholder="O busca por nombre o correo..."
                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-12 pr-5 py-4 text-sm font-bold text-slate-700 outline-none focus:border-emerald-500 focus:bg-white transition-all"
                      />
                      {isSearchingDrivers && <Loader2 className="w-4 h-4 text-slate-300 animate-spin absolute right-5 top-1/2 -translate-y-1/2" />}
                      {driverResults.length > 0 && (
                        <div className="mt-2 bg-white border border-slate-100 rounded-2xl shadow-lg overflow-hidden max-h-48 overflow-y-auto">
                          {driverResults.map(p => (
                            <button
                              type="button"
                              key={p.id}
                              onClick={() => { setSelectedDriver(p); setDriverResults([]); }}
                              className="w-full flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition-all text-left"
                            >
                              <img src={p.photo_url || "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100"} className="w-8 h-8 rounded-lg object-cover" />
                              <div>
                                <p className="text-xs font-bold text-slate-700">{p.first_name} {p.last_name}</p>
                                <p className="text-[10px] text-slate-400">{p.email}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    </div>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={isSubmittingCarpool || !carpoolStudentId || !selectedDriver}
                  className="w-full bg-emerald-600 text-white font-black py-5 rounded-[2rem] shadow-xl shadow-emerald-100 active:scale-95 flex items-center justify-center gap-3 text-xs uppercase tracking-widest disabled:opacity-50"
                >
                  {isSubmittingCarpool ? <Loader2 className="w-5 h-5 animate-spin" /> : 'AUTORIZAR'}
                </button>
             </form>
          </div>
        </div>
      )}

      {/* NOTIFICATIONS MODAL */}
      {showNotifications && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md animate-in fade-in">
          <div className="bg-white w-full max-w-sm rounded-[3rem] overflow-hidden shadow-2xl animate-in zoom-in-95">
             <div className="p-6 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
               <div>
                 <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest">Centro de Mensajes</h3>
                 {notifications.length > 0 && (
                   <button 
                    onClick={clearAllNotifications}
                    className="text-[10px] font-black text-rose-500 uppercase mt-1 hover:text-rose-600 transition-colors"
                   >
                     Limpiar todo
                   </button>
                 )}
               </div>
               <button onClick={() => setShowNotifications(false)} className="p-2.5 bg-white text-slate-400 rounded-xl shadow-sm"><X className="w-5 h-5" /></button>
             </div>
             <div className="max-h-[60vh] overflow-y-auto p-4 space-y-3">
               {notifications.length === 0 ? (
                 <div className="py-12 text-center">
                   <Bell className="w-10 h-10 text-slate-100 mx-auto mb-2" />
                   <p className="text-slate-300 font-bold italic text-xs">Buzón vacío</p>
                 </div>
               ) : (
                 notifications.map(n => (
                   <div 
                    key={n.id} 
                    onClick={() => markAsRead(n.id)}
                    className={`p-4 rounded-2xl border transition-all cursor-pointer group relative ${n.is_read ? 'bg-white border-slate-100 opacity-60' : 'bg-indigo-50 border-indigo-100 shadow-sm'}`}
                   >
                     <div className="flex justify-between items-start mb-1 pr-6">
                        <h4 className="text-xs font-black text-slate-800">{n.title}</h4>
                        {!n.is_read && <span className="w-2 h-2 bg-rose-500 rounded-full" />}
                     </div>
                     <p className="text-[11px] text-slate-500 font-medium leading-relaxed">{n.message}</p>
                     <span className="text-[8px] font-black text-slate-300 uppercase mt-2 block">{new Date(n.created_at).toLocaleString()}</span>
                     
                     {n.is_read && (
                       <button 
                          onClick={(e) => deleteNotification(e, n.id)}
                          className="absolute top-4 right-4 p-1.5 text-slate-300 hover:text-rose-500 transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                     )}
                   </div>
                 ))
               )}
             </div>
          </div>
        </div>
      )}
    </div>
  );
}
