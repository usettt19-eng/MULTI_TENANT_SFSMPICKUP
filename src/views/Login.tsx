import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Shield, User as UserIcon, Lock, Loader2, ArrowLeft } from 'lucide-react';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Todas las cuentas se crean por invitación del colegio (sin autoregistro
  // público) y muchas nunca reciben una contraseña: entran con un enlace
  // mágico enviado a su correo.
  const [showMagicLink, setShowMagicLink] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Timeout: La conexión con el servidor tardó demasiado.")), 15000)
      );

      const result = await Promise.race([
        supabase.auth.signInWithPassword({ email, password }),
        timeout
      ]) as any;

      const { error } = result;

      if (error) {
        setError(error.message);
      } else {
        // SignIn successful
      }
    } catch (err: any) {
      setError(err?.message || "Error al iniciar sesión.");
    } finally {
      setLoading(false);
    }
  };

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin },
      });
      if (otpError) throw otpError;
      setMagicLinkSent(true);
    } catch (err: any) {
      setError(err?.message || 'No se pudo enviar el enlace de acceso.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-6 px-4 sm:py-12 sm:px-6 lg:px-8 font-body relative">
      <div className="absolute top-4 left-4 sm:top-8 sm:left-8 z-50">
        <a href="/" className="flex items-center gap-2 text-slate-500 hover:text-slate-900 font-bold transition-colors text-xs sm:text-sm">
          <ArrowLeft className="w-4 h-4 sm:w-5 sm:h-5" />
          Volver al Inicio
        </a>
      </div>
      <div className="sm:mx-auto sm:w-full sm:max-w-md animate-in slide-in-from-top-10 duration-700 mt-12 sm:mt-0">
        <div className="flex justify-center mb-6 sm:mb-8 relative">
           <div className="w-20 h-20 sm:w-24 sm:h-24 relative flex items-center justify-center p-2 rounded-2xl shadow-xl shadow-cyan-900/10 bg-white">
             <Shield className="w-12 h-12 text-cyan-600 absolute opacity-10" />
             <img
               src="/logo.png"
               alt="Safe Smart Pickup Logo"
               className="w-full h-full object-contain relative z-10"
               onError={(e) => {
                 (e.target as HTMLImageElement).style.opacity = '0';
               }}
             />
           </div>
           <div className="absolute top-0 right-1/4 w-12 h-12 bg-emerald-400/20 rounded-full blur-xl animate-pulse"></div>
        </div>

        <h2 className="text-center text-3xl sm:text-4xl font-black text-slate-900 tracking-tight leading-none mb-2 font-headline">
          Safe Smart<span className="text-cyan-600">PickUP</span>
        </h2>
        <p className="text-center text-slate-500 font-medium text-xs sm:text-sm px-4">
          Gestión de entrega estudiantil segura
        </p>
      </div>

      <div className="mt-8 sm:mt-12 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-6 sm:py-10 sm:px-8 shadow-2xl shadow-slate-200/50 rounded-[2rem] sm:rounded-[3rem] border border-slate-50 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 via-indigo-600 to-indigo-800"></div>

          {showMagicLink ? (
            magicLinkSent ? (
              <div className="space-y-6 animate-in fade-in duration-500 text-center">
                <p className="text-sm text-slate-600 font-medium">
                  Te enviamos un enlace de acceso a <span className="font-black text-slate-900">{email}</span>. Revisa tu bandeja de entrada (y spam) y sigue el enlace para entrar.
                </p>
                <button
                  type="button"
                  onClick={() => { setShowMagicLink(false); setMagicLinkSent(false); setError(null); }}
                  className="inline-flex items-center gap-2 text-xs font-bold text-indigo-600 hover:text-indigo-800 transition-colors"
                >
                  <ArrowLeft className="w-3.5 h-3.5" /> Volver al inicio de sesión
                </button>
              </div>
            ) : (
              <form className="space-y-6 animate-in fade-in duration-500" onSubmit={handleMagicLink}>
                {error && (
                  <div className="bg-rose-50 border border-rose-100 text-rose-600 px-5 py-3 rounded-2xl text-xs font-bold animate-shake">
                    {error}
                  </div>
                )}
                <p className="text-xs text-slate-500 font-medium">
                  Te enviamos un enlace a tu correo para entrar sin contraseña. Útil si tu cuenta fue creada por invitación del colegio.
                </p>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Correo Electrónico</label>
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <UserIcon className="h-4 w-4 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
                    </div>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-100 rounded-2xl pl-11 pr-5 py-3 text-sm focus:bg-white focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all"
                      placeholder="ejemplo@correo.com"
                    />
                  </div>
                </div>
                <div className="pt-4">
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full flex justify-center py-4 px-4 bg-primary text-white font-black rounded-3xl shadow-xl shadow-indigo-100 hover:bg-primary-container active:scale-95 transition-all text-sm uppercase tracking-widest disabled:opacity-50"
                  >
                    {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'ENVIAR ENLACE DE ACCESO'}
                  </button>
                </div>
                <div className="text-center pt-2">
                  <button
                    type="button"
                    onClick={() => { setShowMagicLink(false); setError(null); }}
                    className="inline-flex items-center gap-2 text-xs font-bold text-indigo-600 hover:text-indigo-800 transition-colors"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" /> Volver al inicio de sesión
                  </button>
                </div>
              </form>
            )
          ) : (
          <form className="space-y-6 animate-in fade-in duration-500" onSubmit={handleLogin}>
            {error && (
              <div className="bg-rose-50 border border-rose-100 text-rose-600 px-5 py-3 rounded-2xl text-xs font-bold animate-shake">
                {error}
              </div>
            )}

            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Correo Electrónico</label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <UserIcon className="h-4 w-4 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
                </div>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-100 rounded-2xl pl-11 pr-5 py-3 text-sm focus:bg-white focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all"
                  placeholder="ejemplo@correo.com"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Contraseña</label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Lock className="h-4 w-4 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
                </div>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-100 rounded-2xl pl-11 pr-5 py-3 text-sm focus:bg-white focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <div className="pt-4">
              <button
                type="submit"
                disabled={loading}
                className="w-full flex justify-center py-4 px-4 bg-primary text-white font-black rounded-3xl shadow-xl shadow-indigo-100 hover:bg-primary-container active:scale-95 transition-all text-sm uppercase tracking-widest disabled:opacity-50"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'INGRESAR'}
              </button>
            </div>

            <div className="text-center pt-2">
              <button
                type="button"
                onClick={() => { setShowMagicLink(true); setError(null); }}
                className="text-xs font-bold text-slate-400 hover:text-slate-600 transition-colors"
              >
                ¿No tienes contraseña? Pide un enlace de acceso
              </button>
            </div>
          </form>
          )}
        </div>

        <p className="mt-8 text-center text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] animate-pulse">
           &copy; 2026 Safe Smart Pickup Technology
        </p>
      </div>
    </div>
  );
}
