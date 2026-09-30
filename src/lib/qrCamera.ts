// Compartido por SmartCheckIn.tsx y VerificationDisplay.tsx — ambos usan
// html5-qrcode con el mismo criterio para elegir cámara, así que el fix
// vive en un solo lugar en vez de duplicado en los dos.

export type CameraDevice = { id: string; label: string };

type Html5QrcodeClass = { getCameras: () => Promise<CameraDevice[]> };

const isMobileDevice = () => /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent);

// getCameras() de html5-qrcode dispara su propio getUserMedia() interno
// para desbloquear las etiquetas de los dispositivos, ANTES del
// getUserMedia() real que hace start() — abrir el lector significa
// negociar la cámara dos veces seguidas. Se cachea el resultado para que
// eso solo pase una vez por sesión del navegador, no cada vez que se abre
// el lector (antes se sentía como "tarda en leerlo" en computadora).
let cachedCameras: CameraDevice[] | null = null;
let cachedSelector: unknown = null;

async function listCamerasCached(Html5QrcodeClass: Html5QrcodeClass): Promise<CameraDevice[]> {
  if (cachedCameras !== null) return cachedCameras;
  try {
    cachedCameras = await Html5QrcodeClass.getCameras();
  } catch (listErr) {
    console.error('No se pudieron listar las cámaras:', listErr);
    cachedCameras = [];
  }
  return cachedCameras;
}

// Para el selector manual de cámara en la UI (ver switchCamera en
// SmartCheckIn.tsx/VerificationDisplay.tsx) — no dispara ninguna
// negociación nueva si ya se listaron antes.
export async function listCameras(Html5QrcodeClass: Html5QrcodeClass): Promise<CameraDevice[]> {
  return listCamerasCached(Html5QrcodeClass);
}

// Guarda la elección manual del usuario (botón "Cambiar cámara") para que
// la próxima vez que se abra el lector en esta misma sesión arranque
// directo con esa cámara, sin volver a adivinar.
export function setPreferredCameraId(id: string) {
  cachedSelector = id;
}

// El WebView de Android no siempre respeta bien el constraint
// `facingMode: 'environment'` — reporte real: en el teléfono elegía la
// cámara frontal por defecto igual. Se prefiere el id explícito de la
// cámara cuya etiqueta diga "back"/"rear"/"trasera"/"environment" (así
// suele venir en Android/Chrome); si ninguna etiqueta ayuda, se apuesta
// por la última de la lista — por convención la frontal suele enumerar
// primero. Si ninguna de las dos formas da con la cámara correcta en un
// equipo puntual, queda el botón "Cambiar cámara" en la UI como salida.
function pickRearCameraId(cameras: CameraDevice[]): string {
  const backMatch = cameras.find((c) => /back|rear|trasera|environment/i.test(c.label));
  if (backMatch) return backMatch.id;
  return cameras[cameras.length - 1].id;
}

// Recibe la clase Html5Qrcode ya importada (import dinámico en los
// call sites) para no repetir el import acá.
export async function resolveQrCameraSelector(Html5QrcodeClass: Html5QrcodeClass): Promise<unknown> {
  if (cachedSelector !== null) return cachedSelector;

  const mobile = isMobileDevice();
  // Selector de respaldo si la enumeración de abajo falla o no ayuda:
  // en teléfono, `exact` fuerza la trasera (o falla con error visible, en
  // vez de caer en silencio a la frontal); en laptop, 'environment' sin
  // `exact` para no colgarse si de verdad solo hay una cámara frontal.
  let selector: unknown = mobile ? { facingMode: { exact: 'environment' } } : { facingMode: 'environment' };

  const cameras = await listCamerasCached(Html5QrcodeClass);
  if (cameras.length === 1) {
    // Una sola cámara (ej. laptop sin cámara trasera, o un teléfono cuya
    // enumeración no reportó las dos): pedir 'environment' ahí puede
    // colgarse esperando una cámara que no va a aparecer — se usa el id
    // de la única que hay.
    selector = cameras[0].id;
  } else if (mobile && cameras.length > 1) {
    selector = pickRearCameraId(cameras);
  }
  // En desktop con más de una cámara se deja el facingMode: 'environment'
  // de respaldo — caso poco común (webcams externas) y no es lo que
  // reportaron con problemas.

  cachedSelector = selector;
  return selector;
}
