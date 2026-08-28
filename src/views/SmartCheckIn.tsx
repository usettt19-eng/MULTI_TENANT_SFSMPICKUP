import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { TopNav } from '../components/TopNav';
import { 
  QrCode, 
  Users, 
  MapPin, 
  CheckCircle2, 
  Clock, 
  AlertTriangle,
  ChevronRight,
  ShieldCheck,
  Camera
} from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { GoogleGenAI, Modality } from "@google/genai";

export function SmartCheckIn() {
  const { t } = useLanguage();
  const { profile: staffProfile } = useAuth() as any;
  const [pin, setPin] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [recognitionResult, setRecognitionResult] = useState<'idle' | 'success' | 'failure'>('idle');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [recognizedParent, setRecognizedParent] = useState<any>(null);
  const [linkedStudents, setLinkedStudents] = useState<any[]>([]);
  const [showStudentModal, setShowStudentModal] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [isQrScannerActive, setIsQrScannerActive] = useState(false);
  const html5QrCode = useRef<any>(null);

  const playVoiceMessage = async (text: string) => {
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error("GEMINI_API_KEY not configured");
      
      const ai = new GoogleGenAI({ apiKey });
      
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: `Diga con voz amable y profesional: ${text}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      } as any);

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      
      if (base64Audio) {
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        const binaryString = atob(base64Audio);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        
        const float32Data = new Float32Array(bytes.length / 2);
        const view = new DataView(bytes.buffer);
        for (let i = 0; i < float32Data.length; i++) {
          float32Data[i] = view.getInt16(i * 2, true) / 32768;
        }
        
        const buffer = audioContext.createBuffer(1, float32Data.length, 24000);
        buffer.getChannelData(0).set(float32Data);
        
        const source = audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(audioContext.destination);
        source.start();
      }
    } catch (error) {
      console.error("Error generating voice message:", error);
    }
  };

  // Load face-api models
  useEffect(() => {
    const loadModels = async () => {
      try {
        const faceapi = await import('face-api.js');
        const MODEL_URL = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights';
        
        setStatusMsg('Cargando modelos de IA...');
        await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL);
        await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
        await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
        setStatusMsg('');
      } catch (err: any) {
        console.error("Error loading models:", err);
        setStatusMsg(`Error al cargar modelos de IA: ${err.message}. Verifique su conexión.`);
      }
    };
    loadModels();
  }, []);

  useEffect(() => {
    if (isCameraActive && stream && videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [isCameraActive, stream]);

  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      if (html5QrCode.current && html5QrCode.current.isScanning) {
        html5QrCode.current.stop().catch(console.error);
      }
    };
  }, [stream]);

  const startQrScanner = async () => {
    setIsQrScannerActive(true);
    try {
      const { Html5Qrcode } = await import('html5-qrcode');
      
      // Small delay to ensure the DOM element is rendered
      setTimeout(async () => {
        if (!html5QrCode.current) {
          html5QrCode.current = new Html5Qrcode("qr-reader");
        }
        
        await html5QrCode.current.start(
          { facingMode: "environment" },
          {
            fps: 10,
            // Caja fija en px: si el contenedor real termina siendo más chico
            // que 200x200 (pantallas angostas, o el layout no terminó de
            // asentarse en los 100ms de espera), html5-qrcode puede ignorar
            // la caja o calcular mal la región de escaneo y nunca detecta
            // nada aunque la cámara se vea bien. Con una función se recalcula
            // contra el tamaño real del viewfinder en cada intento.
            qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
              const edge = Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.8);
              return { width: edge, height: edge };
            },
            // Sin esto, el navegador suele entregar video en baja resolución
            // (ej. 640x480), lo que hace casi imposible decodificar un QR
            // mostrado en otra pantalla (moiré) o algo alejado de la cámara.
            videoConstraints: {
              facingMode: "environment",
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          },
          async (decodedText: string) => {
            // Handle success
            handleQrSuccess(decodedText);
          },
          (errorMessage: string) => {
            // Handle error (ignore usually)
          }
        );
      }, 100);
    } catch (err) {
      console.error("Error starting QR scanner", err);
      setStatusMsg("Error al iniciar la cámara para QR");
      setIsQrScannerActive(false);
    }
  };

  const stopQrScanner = async () => {
    if (html5QrCode.current && html5QrCode.current.isScanning) {
      await html5QrCode.current.stop();
      html5QrCode.current.clear();
    }
    setIsQrScannerActive(false);
  };

  const handleQrSuccess = async (decodedText: string) => {
    try {
      const data = JSON.parse(decodedText);
      if (data.type === 'replacement_pickup') {
        setStatusMsg('Verificando código QR...');
        await stopQrScanner();
        
        // Verify parent and token
        const { data: parentProfile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', data.parent_id)
          .single();
          
        if (parentProfile) {
          let additionalData: any = {};
          try {
            additionalData = JSON.parse(parentProfile.additional_tutor_name || '{}');
          } catch (e) {}
          
          const replacements = additionalData.replacements || [];
          const isValid = replacements.some((r: any) => r.token === data.token && r.name === data.replacement_name);
          
          if (isValid) {
            setStatusMsg(`¡QR Válido! Bienvenido/a ${data.replacement_name}`);
            playVoiceMessage(`Código verificado para ${data.replacement_name}. Por favor, seleccione al alumno.`);
            
            // Set recognized parent so the modal works
            setRecognizedParent(parentProfile);
            
            // Fetch students
            const { data: studentLinks } = await supabase
              .from('parent_students')
              .select('student_id, students(*)')
              .eq('parent_id', parentProfile.id);
            
            if (studentLinks && studentLinks.length > 0) {
              setLinkedStudents(studentLinks.map(l => l.students));
              setShowStudentModal(true);
            } else {
              setStatusMsg('Padre reconocido pero no tiene alumnos asignados.');
            }
            
            // Log success
            await supabase.from('audit_logs').insert({
              event_type: 'SECURITY',
              description: `VERIFICACIÓN QR EXITOSA: Reemplazo ${data.replacement_name} autorizado por ${parentProfile.first_name}.`,
              actor_name: 'Sistema QR',
              metadata: { method: 'qr_code', result: 'success', parent_id: parentProfile.id, replacement_name: data.replacement_name },
              tenant_id: parentProfile.tenant_id
            });
          } else {
            setStatusMsg('Código QR inválido o expirado.');
            // Log failure
            await supabase.from('audit_logs').insert({
              event_type: 'SECURITY',
              description: `VERIFICACIÓN QR FALLIDA: Intento de uso de QR inválido para ${data.replacement_name || 'Desconocido'}.`,
              actor_name: 'Sistema QR',
              metadata: { method: 'qr_code', result: 'failure' },
              tenant_id: parentProfile.tenant_id
            });
          }
        } else {
          setStatusMsg('Código QR inválido.');
        }
      }
    } catch (e) {
      console.error("Invalid QR code format", e);
      setStatusMsg('Formato de código QR no reconocido.');
    }
  };

  const handleKeyPress = (num: number | string) => {
    if (pin.length < 4) setPin(prev => prev + num);
  };

  const handleClear = () => setPin('');

  const handleEnter = async () => {
    if (pin.length !== 4 || !staffProfile?.tenant_id) return;
    setStatusMsg('Verificando...');
    // Un PIN de 4 dígitos tiene solo 10,000 combinaciones — sin filtrar por
    // colegio, dos padres de tenants distintos podrían compartir PIN y este
    // kiosco terminaría anunciando la llegada del padre equivocado.
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('tenant_id', staffProfile.tenant_id)
      .eq('pin_code', pin)
      .maybeSingle();
    if (!profile) {
      setStatusMsg('PIN Incorrecto');
      setPin('');
      setTimeout(() => setStatusMsg(''), 3000);
      return;
    }
    
    const { data: students } = await supabase.from('parent_students').select('student_id, students(tenant_id)').eq('parent_id', profile.id);
    if (students && students.length > 0) {
      for (const st of students) {
        await supabase.from('pickup_events').insert({
          student_id: st.student_id,
          parent_id: profile.id,
          status: 'announced',
          announced_at: new Date(),
          tenant_id: (st.students as any)?.tenant_id
        });
      }
      setStatusMsg('¡Anuncio Exitoso!');
      setPin('');
      setTimeout(() => setStatusMsg(''), 3000);
    } else {
      setStatusMsg('Sin alumnos asignados');
      setPin('');
      setTimeout(() => setStatusMsg(''), 3000);
    }
  };

  const startCamera = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true });
      setStream(s);
      setIsCameraActive(true);
    } catch (err) {
      console.error("Error accessing camera:", err);
      setStatusMsg('Error al acceder a la cámara');
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
  };

  const captureAndMatch = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    setIsProcessing(true);
    setStatusMsg('Analizando rostro...');
    setRecognitionResult('idle');
    setCapturedPhoto(null);
    setRecognizedParent(null);
    setLinkedStudents([]);
    
    try {
      const faceapi = await import('face-api.js');
      
      // Capture photo
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg');
      setCapturedPhoto(dataUrl);

      // Detect face in captured photo
      const detection = await faceapi.detectSingleFace(video).withFaceLandmarks().withFaceDescriptor();
      
      if (!detection) {
        setIsProcessing(false);
        setRecognitionResult('failure');
        setStatusMsg('No se detectó ningún rostro. Intente de nuevo.');
        stopCamera();
        return;
      }

      // Fetch parents with photos
      const { data: parents, error: fetchError } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, photo_url')
        .not('photo_url', 'is', null);

      if (fetchError || !parents || parents.length === 0) {
        throw new Error("No hay padres registrados con foto para comparar.");
      }

      let bestMatch = null;
      let minDistance = 0.6; // Threshold for matching

      for (const parent of parents) {
        try {
          // Use proxy to avoid CORS issues
          const proxiedUrl = `/api/proxy-image?url=${encodeURIComponent(parent.photo_url)}`;
          const img = await faceapi.fetchImage(proxiedUrl);
          const parentDetection = await faceapi.detectSingleFace(img).withFaceLandmarks().withFaceDescriptor();
          
          if (parentDetection) {
            const distance = faceapi.euclideanDistance(detection.descriptor, parentDetection.descriptor);
            if (distance < minDistance) {
              minDistance = distance;
              bestMatch = parent;
            }
          }
        } catch (e) {
          console.warn(`Error procesando foto del padre ${parent.id}:`, e);
        }
      }

      setIsProcessing(false);
      stopCamera();

      if (bestMatch) {
        setRecognitionResult('success');
        setRecognizedParent(bestMatch);
        setStatusMsg(`¡Reconocimiento exitoso: ${bestMatch.first_name}!`);
        
        // Log success
        await supabase.from('audit_logs').insert({
          event_type: 'SECURITY',
          description: `VERIFICACIÓN FACIAL EXITOSA: ${bestMatch.first_name} ${bestMatch.last_name} reconocido.`,
          actor_name: 'Sistema Facial',
          metadata: { method: 'facial_recognition', result: 'success', parent_id: bestMatch.id },
          tenant_id: bestMatch.tenant_id
        });

        // Audio feedback
        playVoiceMessage(`Reconocimiento exitoso para ${bestMatch.first_name}. Por favor, seleccione al alumno.`);

        // Fetch students
        const { data: studentLinks } = await supabase
          .from('parent_students')
          .select('student_id, students(*)')
          .eq('parent_id', bestMatch.id);
        
        if (studentLinks && studentLinks.length > 0) {
          setLinkedStudents(studentLinks.map(l => l.students));
          setShowStudentModal(true);
        } else {
          setStatusMsg('Padre reconocido pero no tiene alumnos asignados.');
        }
      } else {
        setRecognitionResult('failure');
        setStatusMsg('No se encontró coincidencia con los padres registrados.');
        
        // Log failure
        await supabase.from('audit_logs').insert({
          event_type: 'SECURITY',
          description: 'VERIFICACIÓN FACIAL FALLIDA: Rostro no coincide con ningún padre registrado.',
          actor_name: 'Sistema Facial',
          metadata: { method: 'facial_recognition', result: 'failure' }
        });
      }
    } catch (error: any) {
      console.error("Error en reconocimiento facial:", error);
      setIsProcessing(false);
      setRecognitionResult('failure');
      setStatusMsg(`Error: ${error.message}`);
      stopCamera();
    }
  };

  const handleStudentSelect = async (studentId: string) => {
    if (!recognizedParent) return;
    
    try {
      const student = linkedStudents.find(s => s.id === studentId);
      await supabase.from('pickup_events').insert({
        student_id: studentId,
        parent_id: recognizedParent.id,
        status: 'announced',
        announced_at: new Date(),
        tenant_id: student?.tenant_id
      });
      
      setShowStudentModal(false);
      setStatusMsg('¡Anuncio Exitoso!');
      setTimeout(() => {
        setStatusMsg('');
        setRecognitionResult('idle');
        setCapturedPhoto(null);
      }, 3000);
    } catch (error) {
      console.error("Error al anunciar recogida:", error);
      setStatusMsg('Error al procesar la recogida.');
    }
  };

  return (
    <>
      <TopNav title="SafePickup" subtitle={t('checkin.title')} />
      
      <div className="p-6 max-w-5xl mx-auto space-y-8 w-full">
        <div className="text-center space-y-2 mb-8">
          <h1 className="text-3xl font-black text-primary tracking-tight">{t('checkin.welcome')}</h1>
          <p className="text-slate-500 font-medium">{t('checkin.instruction')}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* QR Scanner Section */}
          <div className="bg-surface-container-lowest rounded-[2rem] p-8 shadow-lg border border-outline-variant/10 flex flex-col items-center justify-center text-center group hover:border-primary/30 transition-colors">
            <div className="w-20 h-20 bg-primary/5 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
              <QrCode className="w-10 h-10 text-primary" />
            </div>
            <h2 className="text-2xl font-bold text-primary mb-2">{t('checkin.scanQR')}</h2>
            <p className="text-slate-500 text-sm mb-8 max-w-xs">
              {t('checkin.scanInstruction')}
            </p>
            
            <div className="w-full max-w-[240px] aspect-square bg-slate-100 rounded-2xl border-4 border-dashed border-slate-300 flex items-center justify-center relative overflow-hidden">
              {isQrScannerActive ? (
                <div id="qr-reader" className="w-full h-full"></div>
              ) : (
                <>
                  {/* Scanner Animation Line */}
                  <div className="absolute top-0 left-0 w-full h-1 bg-secondary shadow-[0_0_15px_rgba(43,103,103,0.8)] animate-[scan_2s_ease-in-out_infinite]"></div>
                  <img 
                    src="https://lh3.googleusercontent.com/aida-public/AB6AXuAvW7NFukkNL77hwDQIFTvxTLwbr25yM_qRRlc1aWPI_NIRaWjSLsEeB4VMq8twaHlWWEecMvBDsSIVETtIrNpb1srdanPB_29AOMpgAMJVcId2EHvUz83xLZ6226m1FDx9MJZjFsuCZ7qmUqRJEpS5EMQMswVQBWaSFzxVyZ1yweB7XJKG8ieIQbyUFWSjwqbeqsXSapy-p2_BKkS7HHYYR4_QGv6N7V6zwMYIMx3YMkjQsX36sw5yIC4WaMpdpEPvKxdXPzAcV8Bg" 
                    alt="QR Placeholder" 
                    className="w-32 h-32 opacity-20"
                  />
                </>
              )}
            </div>

            <div className="mt-6">
              {!isQrScannerActive ? (
                <button onClick={startQrScanner} className="bg-primary text-white px-6 py-3 rounded-xl font-bold">Activar Lector QR</button>
              ) : (
                <button onClick={stopQrScanner} className="bg-rose-500 text-white px-6 py-3 rounded-xl font-bold">Detener Lector</button>
              )}
            </div>
          </div>

          {/* Facial Recognition Section */}
          <div className="bg-surface-container-lowest rounded-[2rem] p-8 shadow-lg border border-outline-variant/10 flex flex-col items-center justify-center text-center group hover:border-primary/30 transition-colors">
            <div className="w-20 h-20 bg-primary/5 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
              <Camera className="w-10 h-10 text-primary" />
            </div>
            <h2 className="text-2xl font-bold text-primary mb-2">Facial Recognition</h2>
            <p className="text-slate-500 text-sm mb-8 max-w-xs">
              Look at the camera to verify your identity.
            </p>
            
            <div className="w-full max-w-[240px] aspect-square bg-slate-900 rounded-2xl flex items-center justify-center relative overflow-hidden">
              {capturedPhoto ? (
                <img src={capturedPhoto} alt="Captured" className="w-full h-full object-cover" />
              ) : isCameraActive ? (
                <video 
                  ref={videoRef} 
                  autoPlay 
                  playsInline 
                  muted 
                  className="w-full h-full object-cover" 
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-white/20">
                  <Camera className="w-16 h-16" />
                </div>
              )}
              <div className={`absolute inset-0 border-4 rounded-2xl ${recognitionResult === 'success' ? 'border-emerald-500' : recognitionResult === 'failure' ? 'border-rose-500' : 'border-primary/50'}`}></div>
            </div>
            
            <div className="mt-6">
              {!isCameraActive ? (
                <button onClick={() => { setCapturedPhoto(null); setRecognitionResult('idle'); startCamera(); }} className="bg-primary text-white px-6 py-3 rounded-xl font-bold">Iniciar Cámara</button>
              ) : (
                <button onClick={captureAndMatch} disabled={isProcessing} className="bg-emerald-600 text-white px-6 py-3 rounded-xl font-bold">
                  {isProcessing ? 'Analizando...' : 'Capturar y Verificar'}
                </button>
              )}
            </div>
          </div>

          {/* Manual Entry Section */}
          <div className="bg-surface-container-lowest rounded-[2rem] p-8 shadow-lg border border-outline-variant/10 flex flex-col">
            <div className="flex items-center gap-4 mb-8">
              <div className="w-12 h-12 bg-surface-container-high rounded-xl flex items-center justify-center">
                <Users className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-primary">{t('checkin.manualEntry')}</h2>
                <p className="text-sm text-slate-500">{t('checkin.enterPin')}</p>
              </div>
            </div>

            <div className="flex-1 flex flex-col justify-center max-w-xs mx-auto w-full">
              {statusMsg && <div className="text-center mb-4 text-sm font-bold text-primary animate-pulse">{statusMsg}</div>}
              {/* PIN Display */}
              <div className="flex justify-center gap-3 mb-8">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="w-12 h-14 rounded-xl border-2 border-surface-container-highest flex items-center justify-center text-2xl font-black text-primary bg-slate-50">
                    {pin[i] ? '•' : ''}
                  </div>
                ))}
              </div>

              {/* Keypad */}
              <div className="grid grid-cols-3 gap-3">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                  <button key={num} onClick={() => handleKeyPress(num)} className="h-14 rounded-xl bg-surface-container-low hover:bg-surface-container-high text-xl font-bold text-primary transition-colors active:scale-95">
                    {num}
                  </button>
                ))}
                <button onClick={handleClear} className="h-14 rounded-xl bg-surface-container-low hover:bg-surface-container-high text-sm font-bold text-slate-500 transition-colors active:scale-95">
                  {t('checkin.clear')}
                </button>
                <button onClick={() => handleKeyPress(0)} className="h-14 rounded-xl bg-surface-container-low hover:bg-surface-container-high text-xl font-bold text-primary transition-colors active:scale-95">
                  0
                </button>
                <button onClick={handleEnter} className="h-14 rounded-xl bg-primary text-white hover:bg-primary-container text-sm font-bold transition-colors active:scale-95 shadow-md">
                  {t('checkin.enter')}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Status / Info Bar */}
        <div className="bg-slate-800 text-white rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xl">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-secondary-fixed" />
            </div>
            <div>
              <p className="font-bold text-sm">{t('checkin.systemSecure')}</p>
              <p className="text-xs text-slate-400">{t('checkin.lastSynced')}</p>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-center sm:text-right">
              <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">{t('checkin.currentZone')}</p>
              <p className="font-bold text-sm flex items-center gap-1 justify-center sm:justify-end">
                <MapPin className="w-4 h-4 text-secondary-fixed" /> Main Lobby
              </p>
            </div>
            <div className="h-8 w-[1px] bg-white/20 hidden sm:block"></div>
            <button className="text-sm font-bold text-secondary-fixed hover:text-white transition-colors flex items-center gap-1">
              {t('checkin.needHelp')} <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
      
      <canvas ref={canvasRef} className="hidden" />

      {/* Student Selection Modal */}
      {showStudentModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-[2.5rem] w-full max-w-lg overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-300">
            <div className="p-8 text-center border-b border-slate-100">
              <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <Users className="w-10 h-10 text-primary" />
              </div>
              <h3 className="text-2xl font-black text-primary mb-2">Seleccionar Alumno</h3>
              <p className="text-slate-500">
                {recognizedParent?.first_name}, ¿a quién viene a recoger hoy?
              </p>
            </div>
            
            <div className="p-6 max-h-[60vh] overflow-y-auto space-y-3">
              {linkedStudents.map((student) => (
                <button
                  key={student.id}
                  onClick={() => handleStudentSelect(student.id)}
                  className="w-full flex items-center gap-4 p-4 rounded-2xl border-2 border-slate-100 hover:border-primary hover:bg-primary/5 transition-all text-left group"
                >
                  <div className="w-14 h-14 rounded-xl bg-slate-100 overflow-hidden flex-shrink-0">
                    {student.photo_url ? (
                      <img src={student.photo_url} alt={student.first_name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-400">
                        <Users className="w-6 h-6" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-primary text-lg">{student.first_name} {student.last_name}</p>
                    <p className="text-sm text-slate-500 font-medium">{student.grade || 'Grado no especificado'}</p>
                  </div>
                  <ChevronRight className="w-6 h-6 text-slate-300 group-hover:text-primary transition-colors" />
                </button>
              ))}
            </div>
            
            <div className="p-6 bg-slate-50 flex justify-center">
              <button 
                onClick={() => setShowStudentModal(false)}
                className="text-slate-500 font-bold hover:text-primary transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      <style dangerouslySetInnerHTML={{__html: `
        @keyframes scan {
          0% { top: 0; opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { top: 100%; opacity: 0; }
        }
      `}} />
    </>
  );
}
