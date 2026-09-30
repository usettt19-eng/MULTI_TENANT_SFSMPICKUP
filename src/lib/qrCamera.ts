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

// Respiro entre cerrar una cámara y abrir la siguiente — no era la causa
// real del bug de abajo, pero no hace daño dejarlo como margen de
// seguridad para el hardware de cámara.
export function cameraReleaseDelay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 500));
}

// CAUSA REAL encontrada el 2026-09-30, después de que deviceId,
// facingMode y la espera de arriba no cambiaran nada en un equipo real
// (confirmado con capturas): en el código fuente de `html5-qrcode`,
// `Html5Qrcode.start(cameraIdOrConfig, config, ...)` arma el
// `videoConstraints` real que le pasa a `getUserMedia` así — mirar
// html5-qrcode.js:
//
//   var videoConstraints = areVideoConstraintsEnabled
//       ? internalConfig.videoConstraints      // si mandamos esto...
//       : $this.createVideoConstraints(cameraIdOrConfig); // ...esto NUNCA se llama
//
// Es decir: en cuanto `config.videoConstraints` viene presente (lo
// usábamos para pedir mejor resolución, `{width:{ideal:1280}, ...}`),
// la librería usa ESE objeto tal cual para `getUserMedia` y el selector
// de cámara (`cameraIdOrConfig`, el primer argumento — deviceId o
// facingMode) se ignora por completo, sin error ni aviso. Por eso el
// navegador siempre abría la cámara "por defecto" del dispositivo (la
// frontal) sin importar qué selector se le pasara — nunca llegaba a
// pedirse. La prueba con la página de Google
// (webrtc.github.io/samples/.../input-output) confirmó que el teléfono y
// Chrome sí pueden cambiar de cámara sin problema quitando esa
// intermediación.
//
// Fix: combinar el selector de cámara DENTRO del mismo objeto que la
// resolución, para que sea un solo `videoConstraints` completo.
const RESOLUTION_HINT = { width: { ideal: 1280 }, height: { ideal: 720 } };

export function buildVideoConstraints(cameraSelector: unknown): Record<string, unknown> {
  const constraints: Record<string, unknown> = { ...RESOLUTION_HINT };
  if (typeof cameraSelector === 'string') {
    constraints.deviceId = { exact: cameraSelector };
  } else if (cameraSelector && typeof cameraSelector === 'object') {
    Object.assign(constraints, cameraSelector);
  }
  return constraints;
}

// Recibe la clase Html5Qrcode ya importada (import dinámico en los
// call sites) para no repetir el import acá.
//
// 2026-09-30: se probó elegir la trasera por id explícito de dispositivo
// (enumerando y filtrando por etiqueta "back"/"rear") porque
// `facingMode: 'environment'` solo no bastaba en Android — pero un reporte
// con capturas de pantalla reales probó que en ese teléfono, tanto en la
// app como en el navegador móvil normal (no es algo específico del
// WebView de Capacitor), cambiar de `deviceId` nunca cambió el video en
// pantalla, siempre quedaba la frontal. La etiqueta "facing back"/"facing
// front" que reporta `getCameras()` sí viene correcta, así que el dato
// confiable es el `facingMode`, no el `deviceId` — se pide por
// `facingMode` exacto en teléfono. Ver también `cameraReleaseDelay()` más
// abajo: el problema de fondo parece ser que Android no suelta la cámara
// anterior a tiempo para la siguiente negociación.
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
