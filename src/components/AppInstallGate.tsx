import React, { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { ShieldCheck } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

const CONTINUE_KEY = 'ssp_continue_in_browser_session_v1';

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

/**
 * A diferencia de MobileAppBanner (un aviso descartable para siempre), esto
 * bloquea el dashboard del padre con una pantalla completa cada vez que
 * entra desde un navegador móvil — el objetivo es empujar activamente la
 * migración a la app nativa, no solo avisar una vez. "Continuar en el
 * navegador" usa sessionStorage (no localStorage): deja pasar por esta
 * sesión del navegador, pero vuelve a aparecer la próxima vez que abra el
 * sitio. Nunca se muestra dentro de la app empaquetada.
 */
export function AppInstallGate({ children }: { children: React.ReactNode }) {
  const { t } = useLanguage();
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [continued, setContinued] = useState(true);

  useEffect(() => {
    if (Capacitor.isNativePlatform()) return;
    let alreadyContinued = false;
    try {
      alreadyContinued = sessionStorage.getItem(CONTINUE_KEY) === 'true';
    } catch {
      // Sin sessionStorage (navegación privada estricta): se deja pasar sin
      // bloquear en vez de arriesgarse a dejar al padre sin poder entrar.
      return;
    }
    if (alreadyContinued) return;
    const detected = detectMobilePlatform();
    if (detected) {
      setPlatform(detected);
      setContinued(false);
    }
  }, []);

  if (continued || !platform) return <>{children}</>;

  const url = platform === 'android' ? ANDROID_URL : IOS_URL;
  const storeLabel = platform === 'android' ? 'Google Play' : 'App Store';

  const handleContinue = () => {
    try {
      sessionStorage.setItem(CONTINUE_KEY, 'true');
    } catch {
      // Nada que hacer — el clic igual oculta la pantalla en este render.
    }
    setContinued(true);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-700 to-violet-800 flex flex-col items-center justify-center p-8 text-center text-white">
      <div className="w-16 h-16 rounded-2xl bg-white/10 flex items-center justify-center mb-6">
        <ShieldCheck className="w-8 h-8" />
      </div>
      <h1 className="text-2xl font-black mb-3 max-w-xs">{t('parent.installGate.title')}</h1>
      <p className="text-indigo-100 text-sm max-w-xs mb-8 leading-relaxed">
        {t('parent.installGate.description')}
      </p>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="w-full max-w-xs bg-white text-indigo-700 font-black py-4 rounded-2xl mb-4 shadow-xl active:scale-95 transition-all"
      >
        {t('parent.installGate.downloadPrefix')} {storeLabel}
      </a>
      <button
        onClick={handleContinue}
        className="text-indigo-200 text-xs font-bold uppercase tracking-widest underline underline-offset-4"
      >
        {t('parent.installGate.continueLabel')}
      </button>
    </div>
  );
}
