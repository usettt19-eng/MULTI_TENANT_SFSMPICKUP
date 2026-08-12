import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Shield, Lock, Loader2 } from 'lucide-react';

interface SetPasswordProps {
  type: string; // 'invite' | 'recovery'
  onDone: () => void;
}

export function SetPassword({ type, onDone }: SetPasswordProps) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRecovery = type === 'recovery';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden.');
      return;
    }

    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      onDone();
    } catch (err: any) {
      setError(err?.message || 'No se pudo guardar la contraseña.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-6 px-4 sm:py-12 sm:px-6 lg:px-8 font-body relative">
      <div className="sm:mx-auto sm:w-full sm:max-w-md animate-in slide-in-from-top-10 duration-700">
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
        </div>

        <h2 className="text-center text-2xl sm:text-3xl font-black text-slate-900 tracking-tight leading-none mb-2 font-headline">
          {isRecovery ? 'Restablece tu contraseña' : 'Crea tu contraseña'}
        </h2>
        <p className="text-center text-slate-500 font-medium text-xs sm:text-sm px-4">
          {isRecovery
            ? 'Elige una nueva contraseña para tu cuenta.'
            : 'Ya iniciaste sesión con tu invitación. Puedes crear una contraseña para entrar directo la próxima vez, o seguir usando el enlace de acceso por correo.'}
        </p>
      </div>

      <div className="mt-8 sm:mt-12 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-6 sm:py-10 sm:px-8 shadow-2xl shadow-slate-200/50 rounded-[2rem] sm:rounded-[3rem] border border-slate-50 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 via-indigo-600 to-indigo-800"></div>

          <form className="space-y-6 animate-in fade-in duration-500" onSubmit={handleSubmit}>
            {error && (
              <div className="bg-rose-50 border border-rose-100 text-rose-600 px-5 py-3 rounded-2xl text-xs font-bold animate-shake">
                {error}
              </div>
            )}

            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Nueva Contraseña</label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Lock className="h-4 w-4 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
                </div>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-100 rounded-2xl pl-11 pr-5 py-3 text-sm focus:bg-white focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all"
                  placeholder="Mínimo 8 caracteres"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Confirmar Contraseña</label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Lock className="h-4 w-4 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
                </div>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-100 rounded-2xl pl-11 pr-5 py-3 text-sm focus:bg-white focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all"
                  placeholder="Repite la contraseña"
                />
              </div>
            </div>

            <div className="pt-4">
              <button
                type="submit"
                disabled={loading}
                className="w-full flex justify-center py-4 px-4 bg-primary text-white font-black rounded-3xl shadow-xl shadow-indigo-100 hover:bg-primary-container active:scale-95 transition-all text-sm uppercase tracking-widest disabled:opacity-50"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'GUARDAR CONTRASEÑA'}
              </button>
            </div>

            {!isRecovery && (
              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={onDone}
                  className="text-xs font-bold text-slate-400 hover:text-slate-600 transition-colors"
                >
                  Omitir por ahora, seguiré usando el enlace de acceso
                </button>
              </div>
            )}
          </form>
        </div>

        <p className="mt-8 text-center text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] animate-pulse">
          &copy; 2026 Safe Smart Pickup Technology
        </p>
      </div>
    </div>
  );
}
