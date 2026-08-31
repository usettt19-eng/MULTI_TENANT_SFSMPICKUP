// profiles.photo_url / students.photo_url guardan la foto como base64 tal
// cual (convención de toda la app — nunca sube a Supabase Storage), pero una
// foto de cámara/galería sin recortar puede pesar varios MB de texto. Esa
// columna se trae de vuelta en CADA `select('*')` que la toque — medido en
// producción: 4 padres de TCS Albrook con fotos sin comprimir (2-4MB cada
// una) hicieron que el Directorio de Padres (~439 filas) se colgara al
// cargar, y por separado un UPDATE de una sola foto sin comprimir tardó
// 1.5s. Toda pantalla que suba fotos (padres, alumnos, staff, guardianes)
// debe pasar por acá antes de guardar — nunca por el `toDataURL()` crudo.
const MAX_PHOTO_DIM = 480;
const PHOTO_JPEG_QUALITY = 0.72;

/** Recorta un frame de video (cámara) a un data URL JPEG comprimido. */
export function captureVideoFrameCompressed(video: HTMLVideoElement, canvas: HTMLCanvasElement): string {
  const scale = Math.min(1, MAX_PHOTO_DIM / Math.max(video.videoWidth, video.videoHeight));
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo obtener el contexto 2D del canvas.');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', PHOTO_JPEG_QUALITY);
}

/** Lee un archivo de imagen elegido por el usuario y lo devuelve como data URL JPEG comprimido. */
export function compressImageFile(file: File, canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, MAX_PHOTO_DIM / Math.max(img.width, img.height));
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('No se pudo obtener el contexto 2D del canvas.')); return; }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', PHOTO_JPEG_QUALITY));
      };
      img.onerror = () => reject(new Error('No se pudo leer la imagen.'));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.readAsDataURL(file);
  });
}
