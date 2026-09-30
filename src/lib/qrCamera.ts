// Compartido por SmartCheckIn.tsx y VerificationDisplay.tsx — ambos usan
// html5-qrcode con el mismo criterio para elegir cámara, así que el fix
// vive en un solo lugar en vez de duplicado en los dos.

export type CameraDevice = { id: string; label: string };

type Html5QrcodeClass = { getCameras: () => Promise<CameraDevice[]> };

export const isMobileDevice = () => /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent);

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

// Solo informativo (panel de diagnóstico en la UI) — no dispara ninguna
// negociación nueva si ya se listaron antes.
export async function listCameras(Html5QrcodeClass: Html5QrcodeClass): Promise<CameraDevice[]> {
  return listCamerasCached(Html5QrcodeClass);
}

// Guarda la elección manual del usuario (botón "Cambiar cámara") para que
// la próxima vez que se abra el lector en esta misma sesión arranque
// directo con esa cámara, sin volver a adivinar.
export function setPreferredSelector(selector: unknown) {
  cachedSelector = selector;
}

// Recibe la clase Html5Qrcode ya importada (import dinámico en los
// call sites) para no repetir el import acá.
//
// 2026-09-30: se probó elegir la trasera por id explícito de dispositivo
// (enumerando y filtrando por etiqueta "back"/"rear") porque
// `facingMode: 'environment'` solo no bastaba en Android — pero un reporte
// con capturas de pantalla reales probó que ESE Android WebView ignora el
// `deviceId` por completo: cambiar de id (incluso entre dos cámaras
// distintas, ambas etiquetadas "facing back") nunca cambió el video en
// pantalla, siempre quedaba la frontal. La etiqueta "facing back"/"facing
// front" que reporta `getCameras()` sí viene correcta (por eso el
// diagnóstico la mostraba bien), así que el dato confiable es el
// `facingMode`, no el `deviceId`. Se vuelve a pedir por `facingMode`
// exacto en teléfono, sin intentar afinar por id.
export async function resolveQrCameraSelector(Html5QrcodeClass: Html5QrcodeClass): Promise<unknown> {
  if (cachedSelector !== null) return cachedSelector;

  if (isMobileDevice()) {
    const selector = { facingMode: { exact: 'environment' } };
    cachedSelector = selector;
    return selector;
  }

  // En una laptop (ej. Mac) normalmente hay una sola cámara, frontal —
  // pedir facingMode: 'environment' ahí deja a getUserMedia esperando una
  // cámara trasera que no existe, y no todos los navegadores caen de
  // vuelta a la única cámara disponible: la pantalla queda pegada
  // esperando el video, sin cámara ni error visible. Se listan las
  // cámaras reales primero — con una sola, se usa su id directo en vez
  // del selector por facingMode. (En desktop el deviceId sí funciona bien
  // — el problema de arriba es específico del WebView de Android.)
  let selector: unknown = { facingMode: 'environment' };
  const cameras = await listCamerasCached(Html5QrcodeClass);
  if (cameras.length === 1) {
    selector = cameras[0].id;
  }

  cachedSelector = selector;
  return selector;
}
