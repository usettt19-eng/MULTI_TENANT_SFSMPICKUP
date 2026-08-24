import {ShieldCheck, CheckCircle2, Mail} from 'lucide-react';

/**
 * Sin autoregistro público: solo el super_admin da de alta colegios, desde
 * SuperAdminDashboard (POST /api/tenants/register exige esa sesión). Antes
 * este componente traía un formulario de autoregistro que llamaba a ese
 * mismo endpoint sin autenticación — quedaba abierto a que cualquiera creara
 * colegios en la base sin límite.
 */
export function LandingPage() {
  return (
    <div className="min-h-screen bg-slate-50 flex font-sans selection:bg-indigo-500 selection:text-white">
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
            La plataforma para gestión escolar segura.
          </h1>
          <p className="text-xl text-indigo-200 font-medium leading-relaxed mb-8">
            Recogidas, bienestar de los alumnos, controles parentales y cumplimiento
            normativo desde un panel centralizado por colegio.
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

      <div className="flex-1 flex flex-col justify-center items-center p-6 sm:p-12">
        <div className="w-full max-w-md text-center">
          <div className="lg:hidden flex items-center justify-center gap-2 mb-8">
            <ShieldCheck className="w-8 h-8 text-indigo-600" />
            <span className="text-2xl font-black tracking-tighter text-slate-900">Safe Smart<span className="text-cyan-600">PickUP</span></span>
          </div>

          <div className="bg-white p-10 rounded-3xl shadow-xl border border-slate-100">
            <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-6">
              <ShieldCheck className="w-8 h-8 text-indigo-600" />
            </div>
            <h2 className="text-2xl font-black text-slate-900 mb-3">¿Ya tienes cuenta?</h2>
            <p className="text-slate-500 font-medium mb-8">
              Si eres padre, tutor o personal de un colegio, inicia sesión con tu
              correo y contraseña de siempre.
            </p>

            <a
              href="/login"
              className="bg-indigo-600 text-white rounded-xl px-8 py-4 font-bold w-full inline-block hover:bg-indigo-700 transition-colors"
            >
              Iniciar sesión
            </a>

            <div className="mt-8 pt-6 border-t border-slate-100 flex items-center justify-center gap-2 text-xs text-slate-400 font-medium">
              <Mail className="w-4 h-4 shrink-0" />
              <span>
                ¿Tu colegio aún no está en la plataforma? Contáctanos para configurarlo.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
