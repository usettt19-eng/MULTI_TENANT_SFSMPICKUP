import React, { useState } from 'react';
import { ShieldCheck, Building2, User, Mail, Lock, ArrowRight, CheckCircle2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

export function LandingPage() {
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    schoolName: '',
    domain: '',
    firstName: '',
    lastName: '',
    email: '',
    password: ''
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/tenants/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schoolName: formData.schoolName,
          domain: formData.domain,
          firstName: formData.firstName,
          lastName: formData.lastName,
          email: formData.email,
          password: formData.password
        })
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Error al registrar la institución');
      }

      setSuccess(true);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Error occurred during registration');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-6">
        <div className="bg-white p-10 rounded-3xl shadow-xl max-w-md w-full text-center">
          <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-10 h-10 text-emerald-600" />
          </div>
          <h2 className="text-3xl font-black text-slate-900 mb-4">¡Registro Exitoso!</h2>
          <p className="text-slate-500 mb-8 font-medium">
            Tu colegio ha sido registrado y tu cuenta de administrador ha sido creada. 
            Por favor inicia sesión con tu correo y contraseña.
          </p>
          <a href="/login" className="bg-indigo-600 text-white rounded-xl px-8 py-4 font-bold w-full inline-block hover:bg-indigo-700 transition-colors">
            Ir a Iniciar Sesión
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex font-sans selection:bg-indigo-500 selection:text-white">
      {/* Left Side: Presentation */}
      <div className="hidden lg:flex flex-1 bg-indigo-900 text-white p-12 flex-col justify-between relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-full">
          <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-indigo-600/30 rounded-full blur-3xl"></div>
          <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-cyan-500/20 rounded-full blur-3xl"></div>
        </div>
        
        <div className="relative z-10 flex items-center gap-3">
          <ShieldCheck className="w-10 h-10 text-cyan-400" />
          <span className="text-3xl font-black tracking-tighter">Safe Smart<span className="text-cyan-400">PickUP</span></span>
        </div>

        <div className="relative z-10 max-w-xl">
          <h1 className="text-5xl font-black leading-[1.1] mb-6">
            La plataforma líder para gestión escolar segura.
          </h1>
          <p className="text-xl text-indigo-200 font-medium leading-relaxed mb-8">
            Registra tu institución educativa en minutos. Comienza a gestionar recogidas, bienestar de los alumnos, controles parentales y más desde un panel centralizado.
          </p>
          <ul className="space-y-4 text-indigo-100 font-medium">
            <li className="flex items-center gap-3">
              <CheckCircle2 className="w-6 h-6 text-emerald-400" />
              Soporte Multi-colegio (Tenants)
            </li>
            <li className="flex items-center gap-3">
              <CheckCircle2 className="w-6 h-6 text-emerald-400" />
              Control de recogidas mediante QR
            </li>
            <li className="flex items-center gap-3">
              <CheckCircle2 className="w-6 h-6 text-emerald-400" />
              Centro de Bienestar y Medicamentos
            </li>
            <li className="flex items-center gap-3">
              <CheckCircle2 className="w-6 h-6 text-emerald-400" />
              Cumplimiento normativo y bitácoras
            </li>
          </ul>
        </div>

        <div className="relative z-10 text-indigo-300 font-medium text-sm">
          © {new Date().getFullYear()} Safe Smart Pickup Technology.
        </div>
      </div>

      {/* Right Side: Registration Form */}
      <div className="flex-1 flex flex-col justify-center items-center p-6 sm:p-12 relative overflow-y-auto">
        <div className="w-full max-w-md">
          {/* Mobile Logo */}
          <div className="lg:hidden flex items-center justify-center gap-2 mb-8">
            <ShieldCheck className="w-8 h-8 text-indigo-600" />
            <span className="text-2xl font-black tracking-tighter text-slate-900">Safe Smart<span className="text-cyan-600">PickUP</span></span>
          </div>

          <div className="mb-10 text-center lg:text-left">
            <h2 className="text-3xl font-black text-slate-900 mb-2">Registrar Colegio</h2>
            <p className="text-slate-500 font-medium">Crea tu tenant y perfil de administrador.</p>
          </div>

          <form onSubmit={handleRegister} className="space-y-5">
            {error && (
              <div className="bg-rose-50 text-rose-600 p-4 rounded-xl text-sm font-bold border border-rose-100">
                {error}
              </div>
            )}

            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-5">
              <h3 className="font-bold text-slate-800 flex items-center gap-2 border-b border-slate-100 pb-3">
                <Building2 className="w-5 h-5 text-indigo-500" /> 1. Datos de la Institución
              </h3>
              
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Nombre del Colegio <span className="text-rose-500">*</span></label>
                <input
                  type="text"
                  name="schoolName"
                  required
                  value={formData.schoolName}
                  onChange={handleChange}
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-600 focus:border-indigo-600 transition-all font-medium"
                  placeholder="Ej. Instituto Bilingüe"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Subdominio / Código (Opcional)</label>
                <div className="flex rounded-xl overflow-hidden border border-slate-200 focus-within:ring-2 focus-within:ring-indigo-600">
                  <input
                    type="text"
                    name="domain"
                    value={formData.domain}
                    onChange={handleChange}
                    className="flex-1 bg-slate-50 px-4 py-3 font-medium outline-none"
                    placeholder="instituto"
                  />
                  <div className="bg-slate-100 px-4 py-3 text-slate-500 font-medium border-l border-slate-200 text-sm flex items-center">
                    .safesmartpickup.com
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-5">
              <h3 className="font-bold text-slate-800 flex items-center gap-2 border-b border-slate-100 pb-3">
                <User className="w-5 h-5 text-indigo-500" /> 2. Datos del Administrador
              </h3>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Nombre <span className="text-rose-500">*</span></label>
                  <input
                    type="text"
                    name="firstName"
                    required
                    value={formData.firstName}
                    onChange={handleChange}
                    className="w-full border border-slate-200 rounded-xl px-4 py-3 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-600 focus:border-indigo-600 transition-all font-medium"
                    placeholder="Tu nombre"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Apellido <span className="text-rose-500">*</span></label>
                  <input
                    type="text"
                    name="lastName"
                    required
                    value={formData.lastName}
                    onChange={handleChange}
                    className="w-full border border-slate-200 rounded-xl px-4 py-3 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-600 focus:border-indigo-600 transition-all font-medium"
                    placeholder="Tu apellido"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1 flex items-center gap-2">
                  <Mail className="w-4 h-4 text-slate-400" /> Correo Electrónico <span className="text-rose-500">*</span>
                </label>
                <input
                  type="email"
                  name="email"
                  required
                  value={formData.email}
                  onChange={handleChange}
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-600 focus:border-indigo-600 transition-all font-medium"
                  placeholder="admin@colegio.edu"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1 flex items-center gap-2">
                  <Lock className="w-4 h-4 text-slate-400" /> Contraseña <span className="text-rose-500">*</span>
                </label>
                <input
                  type="password"
                  name="password"
                  required
                  minLength={6}
                  value={formData.password}
                  onChange={handleChange}
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-600 focus:border-indigo-600 transition-all font-medium"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 text-white rounded-xl py-4 font-bold text-lg hover:bg-indigo-700 hover:shadow-xl hover:shadow-indigo-600/30 transition-all disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-4"
            >
              {loading ? (
                <>
                  <div className="w-6 h-6 border-3 border-white/30 border-t-white rounded-full animate-spin"></div>
                  Procesando...
                </>
              ) : (
                <>
                  Completar Registro <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>
            
            <div className="text-center mt-6">
              <a href="/login" className="text-sm font-bold text-slate-500 hover:text-indigo-600 transition-colors">
                ¿Ya tienes una cuenta o eres padre? Inicia sesión aquí
              </a>
            </div>
            
            <div className="text-center mt-2">
              <p className="text-xs text-slate-400 font-medium">
                Si encuentras problemas de acceso, asegúrate de que el <strong className="text-indigo-500">Super Admin</strong> haya configurado tu tenant.
              </p>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

