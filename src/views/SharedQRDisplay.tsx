import React, { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { ShieldCheck, UserCheck, AlertTriangle, User } from 'lucide-react';

export function SharedQRDisplay() {
  const [qrData, setQrData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const qrParam = params.get('qr');

    if (qrParam) {
      try {
        const parsed = JSON.parse(decodeURIComponent(qrParam));
        if (parsed.type === 'replacement_pickup') {
          setQrData(parsed);
        } else {
          setError("Formato de código QR no válido.");
        }
      } catch (e) {
        setError("Error al leer el código QR.");
      }
    } else {
      setError("No se encontró ningún código QR en el enlace.");
    }
  }, []);

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white p-8 rounded-[2rem] shadow-xl text-center max-w-sm w-full border border-slate-100">
          <div className="w-16 h-16 bg-rose-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-8 h-8 text-rose-500" />
          </div>
          <h2 className="text-xl font-black text-slate-800 mb-2">Enlace Inválido</h2>
          <p className="text-slate-500 font-medium text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!qrData) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 font-body">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-indigo-600 rounded-3xl shadow-lg shadow-indigo-200 mb-4">
            <ShieldCheck className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">Pase de Recogida</h1>
          <p className="text-slate-500 font-medium mt-1">SafePickup System</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-[2.5rem] shadow-2xl overflow-hidden border border-slate-100">
          {/* Top Section */}
          <div className="bg-indigo-600 p-8 text-center text-white relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16 blur-2xl" />
            <div className="absolute bottom-0 left-0 w-24 h-24 bg-indigo-900/20 rounded-full -ml-12 -mb-12 blur-xl" />

            <div className="relative z-10">
              <div className="w-24 h-24 rounded-full overflow-hidden mx-auto mb-4 border-4 border-white/30 shadow-lg bg-indigo-500 flex items-center justify-center">
                {qrData.photo_url ? (
                  <img src={qrData.photo_url} alt={qrData.replacement_name} className="w-full h-full object-cover" />
                ) : (
                  <User className="w-10 h-10 text-white/70" />
                )}
              </div>
              <p className="text-indigo-200 text-[10px] font-black uppercase tracking-widest mb-1">Autorizado a</p>
              <h2 className="text-2xl font-black">{qrData.replacement_name}</h2>
            </div>
          </div>

          {/* QR Section */}
          <div className="p-8 flex flex-col items-center bg-white relative">
            {/* Cutout effect */}
            <div className="absolute -top-4 left-0 w-8 h-8 bg-slate-50 rounded-full -ml-4 shadow-inner" />
            <div className="absolute -top-4 right-0 w-8 h-8 bg-slate-50 rounded-full -mr-4 shadow-inner" />

            <div className="bg-white p-4 rounded-3xl shadow-sm border-2 border-slate-100 mb-6">
              <QRCodeSVG
                value={JSON.stringify({
                  type: qrData.type,
                  parent_id: qrData.parent_id,
                  token: qrData.token,
                  replacement_name: qrData.replacement_name,
                  photo_url: qrData.photo_url ?? null
                })}
                size={200}
                level="H"
              />
            </div>

            <p className="text-center text-xs text-slate-400 font-bold uppercase tracking-widest max-w-[200px]">
              Muestra este código en el kiosco de la escuela
            </p>
          </div>

          {/* Details Section */}
          <div className="bg-slate-50 p-6 border-t border-slate-100">
            <div className="space-y-4">
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Autorizado por</p>
                <div className="flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-indigo-500" />
                  <p className="text-sm font-bold text-slate-700">{qrData.parent_name}</p>
                </div>
              </div>
              
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Alumnos a recoger</p>
                <div className="space-y-1">
                  {qrData.students?.map((student: any, idx: number) => (
                    <p key={idx} className="text-sm font-bold text-slate-700 flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      {student.name}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
