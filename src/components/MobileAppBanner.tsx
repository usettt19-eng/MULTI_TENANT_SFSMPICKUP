import React, { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Smartphone, X } from 'lucide-react';

const DISMISSED_KEY = 'ssp_app_banner_dismissed_v1';

const ANDROID_URL = 'https://play.google.com/store/apps/details?id=com.safesmartpickup.app';
const IOS_URL = 'https://apps.apple.com/us/app/safe-smart-pickup/id6803200144';

type Platform = 'android' | 'ios';

function detectMobilePlatform(): Platform | null {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent || '';
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  return null;
}

interface MobileAppBannerProps {
  message: string;
  androidLabel?: string;
  iosLabel?: string;
}

/**
 * Solo se muestra en un navegador móvil (Android o iOS) fuera de la app
 * empaquetada — dentro de la app nativa (Capacitor.isNativePlatform()) ya
 * la tienen instalada, no tiene sentido anunciarla. El link va directo a la
 * ficha pública de cada tienda; ambas apps ya están publicadas en
 * producción, sin lista de testers.
 */
export function MobileAppBanner({ message, androidLabel = 'Google Play', iosLabel = 'App Store' }: MobileAppBannerProps) {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (Capacitor.isNativePlatform()) return;
    try {
      if (localStorage.getItem(DISMISSED_KEY) === 'true') return;
    } catch {
      // Si localStorage no está disponible (navegación privada), se muestra
      // igual — solo no se recuerda el cierre entre visitas.
    }
    setPlatform(detectMobilePlatform());
  }, []);

  if (!platform || dismissed) return null;

  const url = platform === 'android' ? ANDROID_URL : IOS_URL;
  const label = platform === 'android' ? androidLabel : iosLabel;

  const handleDismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED_KEY, 'true');
    } catch {
      // No pasa nada si no se puede recordar — solo vuelve a aparecer la próxima visita.
    }
  };

  return (
    <div className="flex items-center gap-3 bg-indigo-600 text-white px-4 py-3 rounded-2xl shadow-lg animate-in fade-in slide-in-from-top-4 duration-500">
      <Smartphone className="w-5 h-5 shrink-0" />
      <p className="flex-1 text-xs sm:text-sm font-medium">{message}</p>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="shrink-0 bg-white text-indigo-700 text-xs font-bold px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition-colors whitespace-nowrap"
      >
        {label}
      </a>
      <button
        onClick={handleDismiss}
        aria-label="Cerrar"
        className="shrink-0 text-white/70 hover:text-white transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
