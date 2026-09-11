import type { ComponentType } from 'react';
import {
  ShieldCheck,
  CheckCircle2,
  Mail,
  MapPin,
  Camera,
  Users,
  QrCode,
  Bell,
  Globe2,
  Bus,
  DoorOpen,
  HeartPulse,
  ClipboardList,
  FileText,
  Radio,
  BarChart3,
  Lock,
  Volume2,
  UserCheck,
  Smartphone,
  Building2,
  MessageCircle,
} from 'lucide-react';

const ANDROID_URL = 'https://play.google.com/store/apps/details?id=com.safesmartpickup.app';
const IOS_URL = 'https://apps.apple.com/us/app/safe-smart-pickup/id6803200144';

interface Feature {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
}

const parentFeatures: Feature[] = [
  {
    icon: MapPin,
    title: 'Llegada automática por geocerca',
    description:
      'En Android, la app detecta sola cuándo entras y sales del perímetro del colegio — sin tener que abrir la app ni tocar ningún botón.',
  },
  {
    icon: Camera,
    title: 'Reconocimiento facial en la puerta',
    description:
      'Verificación opcional por cámara para que la recogida sea aún más ágil y segura, sin depender solo del QR.',
  },
  {
    icon: Users,
    title: 'Pool Day entre padres',
    description:
      'Autoriza a otro padre a recoger a tu hijo un día fijo de la semana, o como excepción de un solo día. Búsqueda por nombre con sugerencia de compañeros del mismo salón.',
  },
  {
    icon: QrCode,
    title: 'Pase de recogida con QR',
    description:
      'Autoriza a una persona distinta a recoger a tu hijo, con foto opcional, y comparte el QR de forma segura para que recepción lo escanee.',
  },
  {
    icon: DoorOpen,
    title: 'Elige tu puerta de salida',
    description:
      'Si el colegio tiene más de una puerta, tú decides cuál usar antes de anunciar la llegada, y puedes guardarla como tu puerta habitual.',
  },
  {
    icon: Bus,
    title: 'Bus escolar y "Hoy no va en bus"',
    description:
      'Ve si tu hijo está asignado a una ruta de bus y avisa al colegio con un botón cuando, por un día, lo recoges tú en vez del bus.',
  },
  {
    icon: Bell,
    title: 'Mensajes y avisos del colegio',
    description:
      'Recibe formularios, autorizaciones y avisos del colegio en tiempo real, con notificación y sonido apenas se publican.',
  },
  {
    icon: Globe2,
    title: 'Español o inglés, a tu elección',
    description:
      'Cambia el idioma de toda la app (incluidos los avisos de voz) cuando quieras, desde el botón ES/EN — tu elección se recuerda en tu celular.',
  },
];

const schoolFeatures: Feature[] = [
  {
    icon: Radio,
    title: 'Dashboard operativo en vivo',
    description:
      'Cola de recogida sincronizada en tiempo real entre todos los dispositivos del colegio, con aviso de voz apenas llega una solicitud.',
  },
  {
    icon: Users,
    title: 'Alumnos, padres y personal',
    description:
      'Alta individual o carga masiva por CSV, con auto-vinculación padre↔alumno, permisos por módulo para cada miembro del staff y buscador inteligente.',
  },
  {
    icon: UserCheck,
    title: 'Verificación de tutores',
    description:
      'Pantalla de puerta con cola de llegada, escaneo de QR, "Atender ahora" para casos fuera de orden, y aviso claro cuando retira un autorizado en vez del padre.',
  },
  {
    icon: Bus,
    title: 'Rutas de bus completas',
    description:
      'Login propio para cada encargado de bus, anuncio de llegada por ruta y exclusión diaria de alumnos que ese día no toman el bus.',
  },
  {
    icon: HeartPulse,
    title: 'Bienestar y medicación',
    description:
      'Registro de incidentes y horarios de medicamentos por alumno, con alertas críticas automáticas para el personal responsable.',
  },
  {
    icon: FileText,
    title: 'Formularios y avisos segmentados',
    description:
      'Autorizaciones que piden respuesta sí/no, o simples avisos informativos, dirigidos por grado y sección — con notificación real a los padres correspondientes.',
  },
  {
    icon: ClipboardList,
    title: 'Registro de visitantes',
    description:
      'Nombre, identificación, empresa de origen, a quién visitan y motivo, con bitácora exportable en PDF.',
  },
  {
    icon: Volume2,
    title: 'Avisos de voz en el idioma que elijas',
    description:
      'Configura si los anuncios por voz del colegio suenan solo en español, solo en inglés, o en ambos — aplica a todas las pantallas del colegio.',
  },
  {
    icon: Lock,
    title: 'Bloqueo de emergencia',
    description:
      'Un interruptor por colegio para activar un modo de bloqueo que detiene las recogidas normales hasta que el personal lo levante.',
  },
  {
    icon: BarChart3,
    title: 'Reportes y estadísticas',
    description:
      'Reporte del Día con salidas sin autorizar y quién debía hacerlo, más un panel de estadísticas: tiempos de recogida, puerta más usada, uso de Pool Day y más.',
  },
  {
    icon: Building2,
    title: 'Aislamiento multi-colegio',
    description:
      'Cada colegio ve solo sus propios datos, reforzado en dos capas (base de datos y aplicación) — pensado para operar varios colegios desde una sola plataforma.',
  },
  {
    icon: Smartphone,
    title: 'App nativa Android e iOS',
    description:
      'Disponible para instalar desde Google Play y App Store, siempre sincronizada con las últimas mejoras del sistema.',
  },
];

function renderFeatureCard({ icon: Icon, title, description }: Feature) {
  return (
    <div key={title} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 hover:shadow-md transition-shadow">
      <div className="w-11 h-11 bg-indigo-50 rounded-xl flex items-center justify-center mb-4">
        <Icon className="w-5 h-5 text-indigo-600" />
      </div>
      <h3 className="text-base font-bold text-slate-900 mb-2">{title}</h3>
      <p className="text-sm text-slate-500 leading-relaxed">{description}</p>
    </div>
  );
}

/**
 * Página de marketing pública, servida aparte del flujo normal de sesión
 * (ver App.tsx, ruta /LandingPage) — el gateway real sin sesión sigue siendo
 * Login directo (ver comentario en App.tsx), esta página es solo para
 * explicar todo lo que incluye el sistema a quien la comparta el colegio.
 */
export function LandingPage() {
  return (
    <div className="min-h-screen bg-slate-50 font-sans selection:bg-indigo-500 selection:text-white">
      <header className="relative overflow-hidden bg-indigo-900 text-white">
        <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[80%] bg-indigo-600/30 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[80%] bg-cyan-500/20 rounded-full blur-3xl pointer-events-none"></div>

        <div className="relative z-10 max-w-5xl mx-auto px-6 py-16 sm:py-24">
          <div className="flex items-center gap-3 mb-10">
            <ShieldCheck className="w-9 h-9 text-cyan-400" />
            <span className="text-2xl font-black tracking-tighter">
              Safe Smart<span className="text-cyan-400">PickUP</span>
            </span>
          </div>

          <h1 className="text-4xl sm:text-5xl font-black leading-[1.1] mb-6 max-w-3xl">
            Todo lo que necesita tu colegio para una recogida segura, en una sola plataforma.
          </h1>
          <p className="text-lg sm:text-xl text-indigo-200 font-medium leading-relaxed mb-10 max-w-2xl">
            Recogidas en tiempo real, bus escolar, bienestar de los alumnos, formularios,
            reportes y control de acceso — pensado para padres, personal y administración
            de tu colegio.
          </p>

          <div className="flex flex-wrap items-center gap-4">
            <a
              href="/login"
              className="bg-white text-indigo-900 rounded-xl px-7 py-3.5 font-bold hover:bg-indigo-50 transition-colors"
            >
              Iniciar sesión
            </a>
            <a
              href="#padres"
              className="border border-white/30 text-white rounded-xl px-7 py-3.5 font-bold hover:bg-white/10 transition-colors"
            >
              Ver todas las funciones
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6">
        <section id="padres" className="py-16 sm:py-20 scroll-mt-8">
          <div className="mb-10 max-w-2xl">
            <span className="text-xs font-bold text-indigo-600 uppercase tracking-wide">Para padres y tutores</span>
            <h2 className="text-3xl font-black text-slate-900 mt-2">
              Anuncia la llegada de tu hijo sin complicaciones
            </h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {parentFeatures.map(renderFeatureCard)}
          </div>
        </section>

        <section id="colegios" className="py-16 sm:py-20 border-t border-slate-200 scroll-mt-8">
          <div className="mb-10 max-w-2xl">
            <span className="text-xs font-bold text-indigo-600 uppercase tracking-wide">Para colegios y administración</span>
            <h2 className="text-3xl font-black text-slate-900 mt-2">
              Control total, sin perder de vista a ningún alumno
            </h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {schoolFeatures.map(renderFeatureCard)}
          </div>
        </section>

        <section className="py-16 sm:py-20 border-t border-slate-200">
          <div className="bg-white rounded-3xl shadow-xl border border-slate-100 p-8 sm:p-12 flex flex-col lg:flex-row items-center gap-10">
            <div className="flex-1 text-center lg:text-left">
              <h2 className="text-2xl font-black text-slate-900 mb-3">Llévala en tu celular</h2>
              <p className="text-slate-500 font-medium mb-6 max-w-md">
                La app de Safe Smart Pickup está disponible para descargar gratis en Android e iOS.
              </p>
              <div className="flex flex-wrap items-center justify-center lg:justify-start gap-3">
                <a
                  href={ANDROID_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-slate-900 text-white rounded-xl px-6 py-3 font-bold text-sm hover:bg-slate-800 transition-colors inline-flex items-center gap-2"
                >
                  <Smartphone className="w-4 h-4" />
                  Google Play
                </a>
                <a
                  href={IOS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-slate-900 text-white rounded-xl px-6 py-3 font-bold text-sm hover:bg-slate-800 transition-colors inline-flex items-center gap-2"
                >
                  <Smartphone className="w-4 h-4" />
                  App Store
                </a>
              </div>
            </div>
            <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center shrink-0">
              <ShieldCheck className="w-8 h-8 text-indigo-600" />
            </div>
          </div>
        </section>

        <section className="pb-20">
          <div className="bg-indigo-900 rounded-3xl p-8 sm:p-12 text-center text-white">
            <h2 className="text-2xl font-black mb-3">¿Tu colegio aún no está en la plataforma?</h2>
            <p className="text-indigo-200 font-medium mb-8 max-w-xl mx-auto">
              Contáctanos para configurar tu colegio y empezar a usar Safe Smart Pickup con tu
              equipo y tus familias.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-4">
              <a
                href="mailto:info@safesmartpickup.com"
                className="bg-white text-indigo-900 rounded-xl px-7 py-3.5 font-bold hover:bg-indigo-50 transition-colors inline-flex items-center gap-2"
              >
                <Mail className="w-4 h-4" />
                info@safesmartpickup.com
              </a>
              <a
                href="https://wa.me/5074320507"
                target="_blank"
                rel="noopener noreferrer"
                className="bg-emerald-500 text-white rounded-xl px-7 py-3.5 font-bold hover:bg-emerald-400 transition-colors inline-flex items-center gap-2"
              >
                <MessageCircle className="w-4 h-4" />
                +507 4320507
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 py-8">
        <div className="max-w-5xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-slate-400 font-medium">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-indigo-400" />
            <span>© {new Date().getFullYear()} Safe Smart Pickup Technology.</span>
          </div>
          <a href="/login" className="text-indigo-600 font-bold hover:text-indigo-800 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" />
            Ya tengo cuenta — iniciar sesión
          </a>
        </div>
      </footer>
    </div>
  );
}
