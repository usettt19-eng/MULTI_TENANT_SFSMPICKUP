// Compartido por SmartCheckIn.tsx y VerificationDisplay.tsx — ambos usan
// html5-qrcode con el mismo criterio para elegir cámara, así que el fix
// vive en un solo lugar en vez de duplicado en los dos.

const isMobileDevice = () => /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent);

// getCameras() de html5-qrcode dispara su propio getUserMedia() interno
// para desbloquear las etiquetas de los dispositivos, ANTES del
// getUserMedia() real que hace start() — abrir el lector significa
// negociar la cámara dos veces seguidas. En computadora (donde sí hace
// falta enumerar para el fix de abajo) eso se sentía como "tarda en
// leerlo"; se cachea el resultado para que solo pase una vez por sesión,
// no cada vez que se abre el lector.
let cachedDesktopSelector: unknown = null;

// Recibe la clase Html5Qrcode ya importada (import dinámico en los
// call sites) para no repetir el import acá.
export async function resolveQrCameraSelector(Html5QrcodeClass: {
  getCameras: () => Promise<{ id: string; label: string }[]>;
}): Promise<unknown> {
  if (isMobileDevice()) {
    // En el teléfono casi siempre hay cámara trasera — pedirla directo
    // (exact, no ideal) es más rápido que enumerar cámaras primero (una
    // sola negociación de cámara, no dos) y evita quedarse pegado en la
    // frontal cuando el navegador enumera mal y reporta una sola cámara
    // en un teléfono que en realidad tiene dos.
    return { facingMode: { exact: 'environment' } };
  }

  if (cachedDesktopSelector !== null) return cachedDesktopSelector;

  // En una laptop (ej. Mac) normalmente hay una sola cámara, frontal —
  // pedir facingMode: 'environment' ahí deja a getUserMedia esperando una
  // cámara trasera que no existe, y no todos los navegadores caen de
  // vuelta a la única cámara disponible: la pantalla queda pegada
  // esperando el video, sin cámara ni error visible. Se listan las
  // cámaras reales primero — con una sola, se usa su id directo en vez
  // del selector por facingMode.
  let selector: unknown = { facingMode: 'environment' };
  try {
    const cameras = await Html5QrcodeClass.getCameras();
    if (cameras.length === 1) {
      selector = cameras[0].id;
    }
  } catch (listErr) {
    console.error('No se pudieron listar las cámaras, se sigue con facingMode:', listErr);
  }
  cachedDesktopSelector = selector;
  return selector;
}
