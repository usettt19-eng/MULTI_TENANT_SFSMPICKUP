let sharedAudioContext: AudioContext | null = null;
let isAudioEnabled = false;
let audioEnableListeners: ((enabled: boolean) => void)[] = [];
let lastPlayedText = "";
let lastPlayedTime = 0;
// Una vez que un clic real del usuario desbloqueó el audio, el navegador
// deja reanudarlo sin pedir otro gesto — así que si se suspende solo
// después de eso, se intenta reactivar automáticamente en vez de obligar
// al kiosco a tocar la barra de nuevo cada vez.
let hasBeenUnlockedByUser = false;
let keepAliveOscillator: OscillatorNode | null = null;
let keepAliveGain: GainNode | null = null;

// Audio Queue
interface AudioTask {
  text: string;
  lang: 'es' | 'en';
}
let audioQueue: AudioTask[] = [];
let isPlaying = false;

function notifyAudioState(enabled: boolean) {
  if (isAudioEnabled === enabled) return;
  isAudioEnabled = enabled;
  audioEnableListeners.forEach(l => l(enabled));
  if (enabled) startKeepAlive(); else stopKeepAlive();
}

// Chrome (y derivados) suspenden un AudioContext que no tiene ningún nodo
// de audio activo conectado por un rato, para ahorrar batería — no es solo
// la pestaña en segundo plano. Un tono continuo casi inaudible (ganancia
// mínima, fuera del rango audible normal) mantiene al menos un nodo activo
// y reduce que esto pase entre un aviso de voz y el siguiente.
function startKeepAlive() {
  if (keepAliveOscillator || !sharedAudioContext) return;
  try {
    keepAliveGain = sharedAudioContext.createGain();
    keepAliveGain.gain.value = 0.0001;
    keepAliveOscillator = sharedAudioContext.createOscillator();
    keepAliveOscillator.frequency.value = 20;
    keepAliveOscillator.connect(keepAliveGain);
    keepAliveGain.connect(sharedAudioContext.destination);
    keepAliveOscillator.start();
  } catch (e) {
    console.error('No se pudo iniciar el tono de mantenimiento:', e);
  }
}

function stopKeepAlive() {
  try { keepAliveOscillator?.stop(); } catch {}
  keepAliveOscillator = null;
  keepAliveGain = null;
}

export const getAudioContext = () => {
  if (!sharedAudioContext) {
    sharedAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    // El navegador puede suspender el AudioContext solo (ahorro de batería,
    // pestaña en segundo plano, la tablet del kiosco apagó pantalla) sin que
    // la app haga nada. Sin este listener, isAudioEnabled se quedaba en
    // true para siempre aunque el audio real ya estuviera bloqueado de
    // nuevo — la barra para reactivarlo nunca volvía a aparecer y no sonaba
    // nada, sin ningún aviso de que había que tocarla otra vez.
    sharedAudioContext.addEventListener('statechange', () => {
      const ctx = sharedAudioContext!;
      if (ctx.state === 'suspended' && hasBeenUnlockedByUser) {
        // Ya se activó una vez con un gesto real — el navegador deja
        // reanudarlo sin pedir otro clic. Si de verdad hace falta un gesto
        // nuevo, esto simplemente no hace nada y notifyAudioState(false)
        // de abajo vuelve a mostrar la barra.
        ctx.resume().catch(() => {});
      }
      notifyAudioState(ctx.state === 'running');
    });
  }
  return sharedAudioContext;
};

// Refuerzo extra: cuando el kiosco vuelve de estar en segundo plano (otra
// app al frente, pantalla que se apagó y se prendió), a veces 'statechange'
// tarda o no llega a tiempo — se intenta reanudar también aquí.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && hasBeenUnlockedByUser && sharedAudioContext?.state === 'suspended') {
      sharedAudioContext.resume().catch(() => {});
    }
  });
}

export const getIsAudioEnabled = () => isAudioEnabled;

export const subscribeToAudioState = (listener: (enabled: boolean) => void) => {
  audioEnableListeners.push(listener);
  listener(isAudioEnabled);
  return () => {
    audioEnableListeners = audioEnableListeners.filter(l => l !== listener);
  };
};

export const enableGlobalAudio = async () => {
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') {
    await ctx.resume();
  }
  hasBeenUnlockedByUser = true;
  // El listener de 'statechange' ya sincroniza isAudioEnabled con el estado
  // real, pero se confirma aquí también por si el navegador no dispara el
  // evento de inmediato — así el botón no queda mostrando "activar" un
  // instante de más después de que sí funcionó.
  notifyAudioState(ctx.state === 'running');

  // Play a confirmation beep
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = 'sine';
  osc.frequency.setValueAtTime(440, ctx.currentTime);
  gain.gain.setValueAtTime(0.1, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
  osc.start();
  osc.stop(ctx.currentTime + 0.2);
};

const processAudioQueue = async () => {
  if (isPlaying || audioQueue.length === 0) return;
  isPlaying = true;

  const task = audioQueue.shift();
  if (!task) {
    isPlaying = false;
    return;
  }

  const { text, lang } = task;

  // Voz nativa del navegador/dispositivo (speechSynthesis) — sin costo, sin
  // clave, sin límite de cuota. Antes se intentaba primero una voz más
  // natural vía la API de Gemini, con esto como fallback ante error/cuota
  // excedida; se retiró Gemini por completo el 2026-09-25 porque la clave
  // vive en el plan gratuito de Google (10 llamadas/día), insuficiente para
  // un colegio real — en la práctica el sistema ya pasaba casi todo el día
  // usando este mismo camino de todos modos.
  try {
    await useBrowserFallbackWait(text, lang);
  } catch (e) {
    console.error("Error reproduciendo el anuncio de voz:", e);
  }

  isPlaying = false;
  // Small pause between announcements
  setTimeout(processAudioQueue, 500);
};

export const useBrowserFallbackWait = (text: string, lang: 'es' | 'en'): Promise<void> => {
  return new Promise((resolve) => {
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang === 'en' ? 'en-US' : 'es-ES';
      // Un poco más lenta que antes (era 0.9) — pedido explícito del colegio.
      utterance.rate = 0.8;
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      window.speechSynthesis.speak(utterance);
    } else {
      resolve();
    }
  });
};

// Ajustes > General: en qué idioma(s) suenan TODOS los avisos de voz de la
// app (Dashboard, Monitor Externo, Tránsito) — un módulo plano, no un hook
// de React, así que cada pantalla que llama a fetchSchoolSettings() avisa
// aquí con setVoiceLanguageSetting() en vez de pasarlo por props.
let voiceLanguageSetting: 'es' | 'en' | 'both' = 'es';

export const setVoiceLanguageSetting = (value: string | null | undefined) => {
  voiceLanguageSetting = value === 'en' || value === 'both' ? value : 'es';
};

export const getVoiceLanguageSetting = () => voiceLanguageSetting;

// Punto de entrada recomendado para cualquier aviso nuevo: recibe el texto
// en los dos idiomas y decide solo, según el ajuste del colegio, cuál(es)
// encolar — evita que cada pantalla repita el mismo if/else.
export const announceBilingual = (esText: string, enText: string) => {
  if (voiceLanguageSetting === 'es') {
    playGlobalVoiceMessage(esText, 'es');
  } else if (voiceLanguageSetting === 'en') {
    playGlobalVoiceMessage(enText, 'en');
  } else {
    playGlobalVoiceMessage(esText, 'es');
    playGlobalVoiceMessage(enText, 'en');
  }
};

export const playGlobalVoiceMessage = async (text: string, lang: 'es' | 'en' = 'es') => {
  console.log('playGlobalVoiceMessage called with:', text, lang);
  if (!isAudioEnabled) {
    console.log('Audio is not enabled globally. Skipping message:', text);
    return;
  }

  // Debounce exact duplicates within 3 seconds
  // (we still want them queued if they happen legally, but prevent double firing)
  const key = `${lang}:${text}`;
  const now = Date.now();
  if (key === lastPlayedText && now - lastPlayedTime < 3000) {
    console.log('Debouncing duplicate message:', text);
    return;
  }

  lastPlayedText = key;
  lastPlayedTime = now;

  audioQueue.push({ text, lang });
  processAudioQueue();
};
