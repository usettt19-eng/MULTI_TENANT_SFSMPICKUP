import { Capacitor, registerPlugin } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

export interface BackgroundLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
  time: number;
}

interface BackgroundGeolocationError {
  code: string;
  message: string;
}

interface BackgroundGeolocationPlugin {
  addWatcher(
    options: {
      backgroundMessage?: string;
      backgroundTitle?: string;
      requestPermissions?: boolean;
      stale?: boolean;
      distanceFilter?: number;
    },
    callback: (location: BackgroundLocation | null, error?: BackgroundGeolocationError) => void
  ): Promise<string>;
  removeWatcher(options: { id: string }): Promise<void>;
  openSettings(): Promise<void>;
}

const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation');

// Solo se muestra una vez por dispositivo: Android exige explicar el uso de
// ubicación en segundo plano ANTES de pedir el permiso "Permitir siempre"
// (tanto por buena práctica como porque Google Play lo exige al publicar).
const RATIONALE_SEEN_KEY = 'ssp_bg_location_rationale_seen_v1';

export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Detecta el navegador embebido de apps como Gmail o Correo en iOS: a
 * diferencia de Safari real, ese WebView casi nunca puede conceder permiso
 * de ubicación aunque el padre tenga todo activado en Ajustes — hay que
 * abrir el enlace directo en Safari para que funcione.
 */
export function isLikelyIOSInAppBrowser(): boolean {
  const ua = navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  if (!isIOS) return false;
  // Safari real siempre trae "Version/X" junto a "Safari/Y"; los WebView
  // embebidos de otras apps (Gmail, Correo, redes sociales) casi nunca lo
  // incluyen, o traen su propia marca (FBAN/FBAV, Instagram, GSA, etc.).
  const hasSafariVersionTag = /Version\/[\d.]+.*Safari/.test(ua);
  const knownEmbeddedMarkers = /FBAN|FBAV|Instagram|Line\/|GSA\/|EdgiOS|OPT\/|Twitter|Snapchat/.test(ua);
  return knownEmbeddedMarkers || !hasSafariVersionTag;
}

export function hasSeenLocationRationale(): boolean {
  return localStorage.getItem(RATIONALE_SEEN_KEY) === 'true';
}

export function markLocationRationaleSeen(): void {
  localStorage.setItem(RATIONALE_SEEN_KEY, 'true');
}

let watcherId: string | null = null;

/**
 * Inicia el watcher nativo de ubicación en segundo plano. Sobrevive con la
 * app minimizada gracias al servicio en primer plano de Android (que exige
 * mostrar una notificación persistente mientras rastrea). No funciona si la
 * app fue cerrada por completo por el usuario o por el sistema.
 */
export async function startBackgroundWatch(
  onLocation: (loc: BackgroundLocation) => void,
  onError?: (message: string) => void,
): Promise<void> {
  if (watcherId) return;

  try {
    await LocalNotifications.requestPermissions();
  } catch {
    // No bloqueante: si el permiso de notificaciones falla, el plugin de
    // geolocalización reportará su propio error al no poder mostrar el
    // aviso persistente que exige el servicio en primer plano.
  }

  watcherId = await BackgroundGeolocation.addWatcher(
    {
      backgroundTitle: 'Safe Smart Pickup',
      backgroundMessage: 'Avisando al colegio cuando llegues o salgas de la zona de recogida.',
      requestPermissions: true,
      stale: false,
      distanceFilter: 15,
    },
    (location, error) => {
      if (error) {
        if (error.code === 'NOT_AUTHORIZED') {
          onError?.('Falta el permiso de ubicación "Permitir todo el tiempo" para avisar automáticamente al colegio.');
        } else {
          onError?.(error.message);
        }
        return;
      }
      if (location) onLocation(location);
    },
  );
}

export async function stopBackgroundWatch(): Promise<void> {
  if (!watcherId) return;
  await BackgroundGeolocation.removeWatcher({ id: watcherId });
  watcherId = null;
}

export async function openLocationSettings(): Promise<void> {
  await BackgroundGeolocation.openSettings();
}
