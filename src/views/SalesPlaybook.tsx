import { useEffect, useState, type ComponentType } from 'react';
import {
  ShieldCheck,
  Mail,
  MessageCircle,
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
  ChevronDown,
  Sparkles,
} from 'lucide-react';

const PAGE_URL = 'https://safesmartpickup.com/speach';
const CONTACT_EMAIL = 'info@safesmartpickup.com';
const CONTACT_WHATSAPP = 'https://wa.me/5074320507';
const CONTACT_WHATSAPP_LABEL = '+507 4320507';

function setMetaTag(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

// ── Datos ────────────────────────────────────────────────────────────────

interface Feature {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
}

const parentFeatures: Feature[] = [
  { icon: MapPin, title: 'Llegada automática por geocerca', description: 'En Android, detecta solo cuándo el padre entra y sale del perímetro del colegio — sin abrir la app ni tocar un botón.' },
  { icon: QrCode, title: 'PIN y QR de identificación', description: 'Cada padre tiene un PIN de 4 dígitos, visible siempre en su app, para que recepción pueda anunciar su llegada aunque falle el GPS o la app.' },
  { icon: Camera, title: 'Reconocimiento facial opcional', description: 'Verificación por cámara en la puerta, la comparación corre en el propio dispositivo — no depende solo del QR.' },
  { icon: Users, title: '"Pool Day" entre padres', description: 'Un padre autoriza a otro a recoger a su hijo un día fijo o como excepción puntual, con búsqueda de compañeros del mismo salón.' },
  { icon: Bus, title: 'Bus escolar y "hoy no va en bus"', description: 'El padre ve la ruta asignada de su hijo y avisa con un botón cuando, por un día, lo recoge él en vez del bus.' },
  { icon: Bell, title: 'Avisos y formularios en tiempo real', description: 'Autorizaciones y avisos del colegio con notificación y sonido apenas se publican, segmentados por grado y sección.' },
  { icon: Globe2, title: 'Español o inglés, a su elección', description: 'Toda la app y los avisos de voz cambian de idioma con un botón — la elección se recuerda por dispositivo.' },
  { icon: Smartphone, title: 'App nativa Android e iOS', description: 'Disponible para descargar gratis en Google Play y App Store, además de funcionar desde cualquier navegador.' },
];

const schoolFeatures: Feature[] = [
  { icon: Radio, title: 'Dashboard operativo en vivo', description: 'Cola de recogida sincronizada en tiempo real entre todos los dispositivos del colegio, con aviso de voz apenas llega una solicitud.' },
  { icon: Users, title: 'Alumnos, padres y personal', description: 'Alta individual o carga masiva por CSV con auto-vinculación padre↔alumno, permisos por módulo para cada miembro del staff.' },
  { icon: UserCheck, title: 'Verificación de tutores en puerta', description: 'Cola de llegada, escaneo de QR, "Atender ahora" para casos fuera de orden, y aviso claro cuando retira un autorizado y no el padre.' },
  { icon: Bus, title: 'Rutas de bus completas', description: 'Login propio para cada encargado de bus, anuncio de llegada por ruta y exclusión diaria de quien no toma el bus ese día.' },
  { icon: HeartPulse, title: 'Bienestar y medicación', description: 'Incidentes y horarios de medicamentos por alumno, con alertas críticas automáticas para el personal responsable.' },
  { icon: FileText, title: 'Formularios y avisos segmentados', description: 'Autorizaciones que piden sí/no, o avisos informativos, dirigidos por grado y sección, con notificación real a los padres.' },
  { icon: ClipboardList, title: 'Registro de visitantes', description: 'Nombre, identificación, empresa de origen, a quién visitan y motivo, con bitácora exportable en PDF.' },
  { icon: Volume2, title: 'Avisos de voz configurables', description: 'El colegio decide si suenan en español, inglés, o ambos — aplica a todas las pantallas del colegio.' },
  { icon: Lock, title: 'Bloqueo de emergencia y alerta discreta', description: 'Un interruptor detiene las recogidas normales ante una emergencia, y el personal puede avisar a seguridad sin alarmar a nadie presente.' },
  { icon: BarChart3, title: 'Reportes y estadísticas', description: 'Reporte del Día con salidas sin autorizar y quién debía hacerlo, más un panel de estadísticas completo.' },
  { icon: Building2, title: 'Aislamiento multi-colegio', description: 'Cada colegio ve solo sus propios datos, reforzado en dos capas (base de datos y aplicación).' },
  { icon: ShieldCheck, title: 'Bitácora de auditoría', description: 'Todo evento sensible queda registrado — quién hizo qué y cuándo, disponible para el colegio en cualquier momento.' },
];

interface QA {
  q: string;
  a: string;
}

const faqSeguridad: QA[] = [
  { q: '¿Dónde se guardan los datos de nuestros alumnos y familias?', a: 'En infraestructura en la nube con separación estricta por colegio: cada colegio solo puede ver y consultar sus propios datos, reforzado tanto en la base de datos como en la aplicación. Ningún otro colegio de la plataforma tiene acceso a su información.' },
  { q: '¿El reconocimiento facial es seguro? ¿A dónde se manda la foto?', a: 'Es una función opcional. La comparación de rostro corre en el propio dispositivo (navegador o tablet de la puerta) al momento de la recogida — no se envía a ningún tercero para "identificar" a la persona en ese instante. El colegio decide si la activa.' },
  { q: '¿Cómo se evita que alguien no autorizado se lleve a un niño?', a: 'Cada recogida requiere verificar al padre/tutor por PIN, o a un autorizado por el código QR de un "Pase de Recogida" generado por el padre titular — nunca basta con la palabra de la persona. El personal del colegio siempre da la autorización final antes de entregar al alumno.' },
  { q: '¿Qué pasa si un padre pierde el celular o no tiene batería?', a: 'Recepción puede identificar al padre con su PIN de 4 dígitos directamente desde la pantalla de Check-In del colegio, sin depender del celular del padre en ese momento.' },
];

const faqImplementacion: QA[] = [
  { q: '¿Cuánto tiempo toma implementarlo?', a: 'El colegio queda dado de alta y la matrícula (alumnos, padres y personal) se puede cargar de una vez por CSV — el colegio puede empezar a operar el mismo día que se completa la carga.' },
  { q: '¿Necesitamos comprar tablets u otro hardware?', a: 'No. Safe Smart Pickup funciona en cualquier navegador — la computadora, tablet o celular que el colegio ya tenga en recepción y en cada puerta de salida sirve.' },
  { q: '¿Reemplaza a nuestro personal de recepción?', a: 'No. Reduce el trabajo repetitivo de anotar a mano y llamar a los salones uno por uno, pero la decisión de autorizar cada salida la sigue tomando una persona del colegio, siempre.' },
  { q: '¿Podemos probarlo antes de decidir?', a: 'Sí — se puede configurar un colegio de prueba con datos ficticios para que el equipo lo explore de punta a punta antes de comprometerse. Coordínalo con nosotros.' },
  { q: '¿Qué pasa si se cae el internet durante la salida?', a: 'Es un sistema en la nube, en tiempo real — como cualquier plataforma digital, un corte de internet prolongado afecta el flujo digital. Recomendamos mantener el protocolo manual de respaldo que el colegio ya tenga para esos casos, igual que con cualquier otro sistema.' },
];

const faqUso: QA[] = [
  { q: '¿Los padres tienen que instalar una app sí o sí?', a: 'Es lo recomendado por la mejor experiencia (geocerca automática, notificaciones), pero no es obligatorio: recepción puede anunciar la llegada de cualquier padre con su PIN desde Check-In, sin que el padre use la app.' },
  { q: '¿Funciona en iPhone y en Android?', a: 'Sí, hay apps nativas para ambos en Google Play y App Store, además de la versión web que corre en cualquier navegador.' },
  { q: '¿En qué idiomas está disponible?', a: 'Español e inglés — tanto la interfaz como los avisos de voz. El colegio fija un idioma por defecto y cada padre puede cambiarlo por su cuenta.' },
  { q: '¿Qué pasa si los papás están divorciados o hay varios tutores?', a: 'Cada adulto responsable puede tener su propia cuenta vinculada al mismo alumno y anunciar la llegada — el sistema no depende de una sola persona por familia.' },
  { q: '¿Un padre con hijos en dos colegios distintos necesita dos cuentas?', a: 'No, puede gestionar hijos en más de un colegio cliente desde una sola cuenta.' },
];

const objections: QA[] = [
  { q: '"Ya tenemos un grupo de WhatsApp para avisar cuando llega el papá."', a: 'WhatsApp no verifica identidad, no ordena una cola real, y no dice quién está autorizado a recoger a cada alumno — el mensaje se pierde entre otros cien. Safe Smart Pickup reemplaza ese caos por una cola en vivo, con verificación real y registro de todo.' },
  { q: '"¿Y si un padre no tiene smartphone?"', a: 'No es un obstáculo: el personal puede anunciar su llegada por PIN desde la recepción, sin depender de que el padre use la app.' },
  { q: '"Nos preocupa exponer los datos de nuestros alumnos."', a: 'El aislamiento entre colegios está reforzado en dos capas — ningún otro colegio de la plataforma puede ver los datos de tus alumnos, padres o personal.' },
  { q: '"¿Cuánto cuesta?"', a: 'Depende de la cantidad de alumnos y los módulos que el colegio necesite — se arma una cotización personalizada en la llamada con el equipo comercial.' },
  { q: '"¿Qué colegios ya lo usan?"', a: 'Ya opera en producción con cientos de familias activas a diario en TCS Albrook y TCS Costa del Este, en Panamá.' },
];

const openingScript = `"Buenos días/tardes [nombre]. Le llamo de Safe Smart Pickup — ayudamos a colegios a resolver dos problemas al mismo tiempo: la fila de carros a la salida, y la seguridad de saber con certeza quién retira a cada alumno. Hoy ya operamos con cientos de familias en TCS Albrook y TCS Costa del Este. ¿Cómo manejan ustedes hoy la salida y la verificación de quién recoge a cada niño?"`;

// ── UI helpers ───────────────────────────────────────────────────────────

function renderFeatureCard({ icon: Icon, title, description }: Feature) {
  return (
    <div key={title} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 hover:shadow-md transition-shadow">
      <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center mb-3">
        <Icon className="w-5 h-5 text-indigo-600" />
      </div>
      <h3 className="text-sm font-bold text-slate-900 mb-1.5">{title}</h3>
      <p className="text-xs text-slate-500 leading-relaxed">{description}</p>
    </div>
  );
}

function QAAccordion({ items }: { items: QA[] }) {
  const [openIdx, setOpenIdx] = useState<number | null>(0);
  return (
    <div className="space-y-2.5">
      {items.map((item, i) => {
        const isOpen = openIdx === i;
        return (
          <div key={item.q} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <button
              type="button"
              onClick={() => setOpenIdx(isOpen ? null : i)}
              className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left"
            >
              <span className="text-sm font-bold text-slate-800">{item.q}</span>
              <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            {isOpen && (
              <div className="px-5 pb-4">
                <p className="text-sm text-slate-500 leading-relaxed">{item.a}</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SectionHeader({ eyebrow, title, id }: { eyebrow: string; title: string; id: string }) {
  return (
    <div id={id} className="mb-8 max-w-2xl scroll-mt-24">
      <span className="text-xs font-bold text-indigo-600 uppercase tracking-wide">{eyebrow}</span>
      <h2 className="text-2xl sm:text-3xl font-black text-slate-900 mt-2">{title}</h2>
    </div>
  );
}

const NAV_ITEMS: { id: string; label: string }[] = [
  { id: 'resumen', label: 'Resumen de 30 segundos' },
  { id: 'guion', label: 'Guión de apertura' },
  { id: 'padres', label: 'Funciones — padres' },
  { id: 'colegio', label: 'Funciones — colegio' },
  { id: 'objeciones', label: 'Objeciones comunes' },
  { id: 'seguridad', label: 'Seguridad y privacidad' },
  { id: 'implementacion', label: 'Implementación' },
  { id: 'uso', label: 'Uso diario' },
  { id: 'referencias', label: 'Colegios de referencia' },
  { id: 'material', label: 'Material visual' },
];

/**
 * Página interna de apoyo comercial (safesmartpickup.com/speach) — para que
 * el equipo de ventas tenga, en un solo lugar, todo lo necesario para
 * responder las preguntas más comunes de un director de colegio en una
 * llamada o reunión. Pública (no requiere sesión) para poder compartirla
 * como enlace, pero marcada noindex para que no aparezca en buscadores —
 * a diferencia de /LandingPage, esta no es material de marketing público.
 *
 * No incluye precios: por decisión del equipo, la cotización se arma en
 * vivo según cantidad de alumnos y módulos, no se publica un número fijo.
 */
export function SalesPlaybook() {
  useEffect(() => {
    document.title = 'Guía de Ventas — Safe Smart Pickup (uso interno)';
    setMetaTag('name', 'robots', 'noindex, nofollow');
    setMetaTag('name', 'description', 'Guía interna de apoyo comercial para el equipo de ventas de Safe Smart Pickup.');

    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.setAttribute('rel', 'canonical');
      document.head.appendChild(canonical);
    }
    canonical.setAttribute('href', PAGE_URL);
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 font-sans selection:bg-indigo-500 selection:text-white">
      <header className="relative overflow-hidden bg-indigo-900 text-white">
        <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[80%] bg-indigo-600/30 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[80%] bg-cyan-500/20 rounded-full blur-3xl pointer-events-none"></div>

        <div className="relative z-10 max-w-5xl mx-auto px-6 py-12 sm:py-16">
          <div className="flex items-center gap-3 mb-6">
            <ShieldCheck className="w-8 h-8 text-cyan-400" />
            <span className="text-xl font-black tracking-tighter">
              Safe Smart<span className="text-cyan-400">PickUP</span>
            </span>
            <span className="ml-2 bg-white/10 border border-white/20 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest text-cyan-200">
              Guía de Ventas
            </span>
          </div>

          <h1 className="text-3xl sm:text-4xl font-black leading-[1.1] mb-4 max-w-3xl">
            Todo lo que necesitas para hablar con un director de colegio.
          </h1>
          <p className="text-base sm:text-lg text-indigo-200 font-medium leading-relaxed max-w-2xl">
            Esta página es para el equipo de ventas: el pitch, las funciones completas, y las
            respuestas listas a las preguntas más comunes. No es la página pública del colegio
            — para eso está <span className="font-bold text-white">safesmartpickup.com/LandingPage</span>.
          </p>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6">
        <div className="grid sm:grid-cols-2 gap-3 -mt-8 relative z-20">
          <img
            src="/sales-playbook/foto-bus-verificacion.jpg"
            alt="Personal de seguridad verificando la llegada de un alumno desde la app, con el bus escolar de fondo"
            className="w-full h-40 sm:h-48 object-cover rounded-2xl shadow-lg border-4 border-white"
            loading="lazy"
          />
          <img
            src="/sales-playbook/foto-padre-hija.jpg"
            alt="Padre recibiendo a su hija a la salida del colegio"
            className="w-full h-40 sm:h-48 object-cover rounded-2xl shadow-lg border-4 border-white"
            loading="lazy"
          />
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-6">
        {/* Navegación rápida */}
        <nav className="py-8 -mb-2">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex flex-wrap gap-2">
            {NAV_ITEMS.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className="text-xs font-bold text-slate-600 hover:text-indigo-600 bg-slate-50 hover:bg-indigo-50 rounded-full px-3.5 py-2 transition-colors"
              >
                {item.label}
              </a>
            ))}
          </div>
        </nav>

        {/* Resumen de 30 segundos */}
        <section className="py-10 scroll-mt-24" id="resumen">
          <SectionHeader eyebrow="Para empezar" title="Resumen de 30 segundos" id="resumen-inner" />
          <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6 sm:p-8">
            <div className="flex items-start gap-4">
              <div className="w-11 h-11 bg-indigo-50 rounded-xl flex items-center justify-center shrink-0">
                <Sparkles className="w-5 h-5 text-indigo-600" />
              </div>
              <div>
                <p className="text-base font-bold text-slate-800 leading-relaxed mb-3">
                  Safe Smart Pickup resuelve dos problemas del colegio a la vez: la fila de carros a
                  la hora de salida, y la certeza de que solo la persona autorizada se lleva a cada
                  alumno.
                </p>
                <p className="text-sm text-slate-500 leading-relaxed">
                  El padre anuncia su llegada desde el celular (o recepción lo hace por él con su
                  PIN), el maestro autoriza desde su salón, y el personal de la puerta verifica con
                  QR, PIN o reconocimiento facial antes de entregar al alumno. Todo sincronizado en
                  tiempo real, con reportes y bitácora de todo lo que pasó en el día.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Guión de apertura */}
        <section className="py-10 border-t border-slate-200 scroll-mt-24" id="guion">
          <SectionHeader eyebrow="Para la llamada" title="Guión de apertura sugerido" id="guion-inner" />
          <div className="bg-indigo-50 border border-indigo-100 rounded-3xl p-6 sm:p-8">
            <p className="text-sm sm:text-base text-indigo-900 font-medium leading-relaxed italic">
              {openingScript}
            </p>
            <p className="text-xs text-indigo-500 font-bold uppercase tracking-wide mt-4">
              Deja que el director describa su proceso actual antes de seguir — la respuesta te dice
              qué parte del producto destacar primero.
            </p>
          </div>
        </section>

        {/* Funciones para padres */}
        <section className="py-10 border-t border-slate-200 scroll-mt-24" id="padres">
          <SectionHeader eyebrow="Funciones" title="Lo que ve y usa cada padre/tutor" id="padres-inner" />
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {parentFeatures.map(renderFeatureCard)}
          </div>
        </section>

        {/* Funciones para el colegio */}
        <section className="py-10 border-t border-slate-200 scroll-mt-24" id="colegio">
          <SectionHeader eyebrow="Funciones" title="Lo que ve y usa el colegio" id="colegio-inner" />
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {schoolFeatures.map(renderFeatureCard)}
          </div>
        </section>

        {/* Objeciones comunes */}
        <section className="py-10 border-t border-slate-200 scroll-mt-24" id="objeciones">
          <SectionHeader eyebrow="Manejo de objeciones" title="Lo que va a decir el director, y qué responder" id="objeciones-inner" />
          <QAAccordion items={objections} />
        </section>

        {/* Seguridad y privacidad */}
        <section className="py-10 border-t border-slate-200 scroll-mt-24" id="seguridad">
          <SectionHeader eyebrow="Preguntas frecuentes" title="Seguridad y privacidad" id="seguridad-inner" />
          <QAAccordion items={faqSeguridad} />
        </section>

        {/* Implementación */}
        <section className="py-10 border-t border-slate-200 scroll-mt-24" id="implementacion">
          <SectionHeader eyebrow="Preguntas frecuentes" title="Implementación y operación" id="implementacion-inner" />
          <QAAccordion items={faqImplementacion} />
        </section>

        {/* Uso diario */}
        <section className="py-10 border-t border-slate-200 scroll-mt-24" id="uso">
          <SectionHeader eyebrow="Preguntas frecuentes" title="Uso diario" id="uso-inner" />
          <QAAccordion items={faqUso} />
        </section>

        {/* Colegios de referencia */}
        <section className="py-10 border-t border-slate-200 scroll-mt-24" id="referencias">
          <SectionHeader eyebrow="Prueba social" title="Colegios de referencia" id="referencias-inner" />
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
              <div className="flex items-center gap-2 mb-2">
                <Building2 className="w-4 h-4 text-indigo-600" />
                <h3 className="text-sm font-bold text-slate-900">TCS Albrook</h3>
                <span className="text-[9px] font-black uppercase tracking-widest bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full">Activo</span>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Operando en producción, con cientos de familias usando la app a diario para
                recogida, bus escolar y avisos del colegio.
              </p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
              <div className="flex items-center gap-2 mb-2">
                <Building2 className="w-4 h-4 text-indigo-600" />
                <h3 className="text-sm font-bold text-slate-900">TCS Costa del Este</h3>
                <span className="text-[9px] font-black uppercase tracking-widest bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full">Activo</span>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Segundo colegio en producción sobre la misma plataforma, con el mismo nivel de
                aislamiento de datos que cualquier colegio nuevo tendría desde el primer día.
              </p>
            </div>
          </div>
          <p className="text-xs text-slate-400 font-medium mt-4">
            Ambos colegios pueden dar contexto de primera mano si un director lo pide — coordinar
            la referencia con el equipo antes de ofrecerla en la llamada.
          </p>
        </section>

        {/* Material visual de apoyo */}
        <section className="py-10 border-t border-slate-200 scroll-mt-24" id="material">
          <SectionHeader eyebrow="Para compartir" title="Material visual de apoyo" id="material-inner" />
          <p className="text-sm text-slate-500 leading-relaxed mb-5 max-w-2xl">
            Imágenes listas para mandar por WhatsApp o correo a un director, o para usar en redes.
            Toca una para verla en tamaño completo.
          </p>
          <div className="grid sm:grid-cols-2 gap-4">
            <a href="/sales-playbook/infografia-10-ventajas.jpg" target="_blank" rel="noopener noreferrer" className="block group">
              <img
                src="/sales-playbook/infografia-10-ventajas.jpg"
                alt="Infografía: las 10 principales ventajas de Safe Smart Pickup"
                className="w-full rounded-2xl border border-slate-100 shadow-sm group-hover:shadow-md transition-shadow"
                loading="lazy"
              />
              <p className="text-xs font-bold text-slate-500 mt-2">Las 10 ventajas — infografía completa</p>
            </a>
            <a href="/sales-playbook/infografia-futuro.jpg" target="_blank" rel="noopener noreferrer" className="block group">
              <img
                src="/sales-playbook/infografia-futuro.jpg"
                alt="Infografía: El futuro de la salida escolar, seguridad, logística y prestigio escolar"
                className="w-full rounded-2xl border border-slate-100 shadow-sm group-hover:shadow-md transition-shadow"
                loading="lazy"
              />
              <p className="text-xs font-bold text-slate-500 mt-2">Seguridad, logística y prestigio — resumen ejecutivo</p>
            </a>
          </div>
        </section>

        {/* CTA final */}
        <section className="py-16">
          <div className="bg-indigo-900 rounded-3xl p-8 sm:p-12 text-center text-white">
            <h2 className="text-2xl font-black mb-3">¿Listo para coordinar la cotización?</h2>
            <p className="text-indigo-200 font-medium mb-8 max-w-xl mx-auto">
              La cotización se arma según la cantidad de alumnos y los módulos que el colegio
              necesite — coordínala con el equipo comercial antes de darle un número al director.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-4">
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="bg-white text-indigo-900 rounded-xl px-7 py-3.5 font-bold hover:bg-indigo-50 transition-colors inline-flex items-center gap-2"
              >
                <Mail className="w-4 h-4" />
                {CONTACT_EMAIL}
              </a>
              <a
                href={CONTACT_WHATSAPP}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-emerald-500 text-white rounded-xl px-7 py-3.5 font-bold hover:bg-emerald-400 transition-colors inline-flex items-center gap-2"
              >
                <MessageCircle className="w-4 h-4" />
                {CONTACT_WHATSAPP_LABEL}
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 py-8">
        <div className="max-w-5xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-slate-400 font-medium">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-indigo-400" />
            <span>© {new Date().getFullYear()} Safe Smart Pickup Technology — uso interno del equipo de ventas.</span>
          </div>
          <a href="/LandingPage" className="text-indigo-600 font-bold hover:text-indigo-800">
            Ver la página pública del colegio →
          </a>
        </div>
      </footer>
    </div>
  );
}
