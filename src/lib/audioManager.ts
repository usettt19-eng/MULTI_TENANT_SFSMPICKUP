import { GoogleGenAI, Modality } from "@google/genai";

let sharedAudioContext: AudioContext | null = null;
let isAudioEnabled = false;
let audioEnableListeners: ((enabled: boolean) => void)[] = [];
let lastPlayedText = "";
let lastPlayedTime = 0;
let quotaExceededUntil = 0;
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
  const now = Date.now();

  // Instrucción de ritmo en el mismo idioma del mensaje — pedido explícito
  // del colegio: un poco más lenta que antes, para que se entienda bien en
  // las bocinas del salón.
  const promptPrefix = lang === 'en'
    ? 'Say slowly, at an unhurried pace, in a warm and professional voice:'
    : 'Diga despacio, con calma, con voz amable y profesional:';

  try {
    if (now < quotaExceededUntil) {
      await useBrowserFallbackWait(text, lang);
    } else {
      const apiKey = process.env.GEMINI_API_KEY || import.meta.env.VITE_GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("GEMINI_API_KEY not configured");
      }

      const ai = new GoogleGenAI({ apiKey });

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: `${promptPrefix} ${text}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      } as any);

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

      if (base64Audio) {
        await playBase64AudioWait(base64Audio);
      } else {
        await useBrowserFallbackWait(text, lang);
      }
    }
  } catch (error: any) {
    console.error("Error generating voice message:", error);

    const errorStr = JSON.stringify(error);
    if (error?.message?.includes('429') || error?.status === 429 || errorStr.includes('429') || errorStr.includes('RESOURCE_EXHAUSTED')) {
      console.warn("Gemini Quota Exceeded. Switching to browser TTS for 60s.");
      quotaExceededUntil = Date.now() + 60000;
    }

    try {
      await useBrowserFallbackWait(text, lang);
    } catch (e) {
      console.error("Fallback also failed", e);
    }
  }

  isPlaying = false;
  // Small pause between announcements
  setTimeout(processAudioQueue, 500);
};

const playBase64AudioWait = (base64Audio: string): Promise<void> => {
  return new Promise(async (resolve) => {
    try {
      const audioContext = getAudioContext();
        
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      const binaryString = atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      const float32Data = new Float32Array(bytes.length / 2);
      const view = new DataView(bytes.buffer);
      for (let i = 0; i < float32Data.length; i++) {
        float32Data[i] = view.getInt16(i * 2, true) / 32768;
      }
      
      const buffer = audioContext.createBuffer(1, float32Data.length, 24000);
      buffer.getChannelData(0).set(float32Data);
      
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);
      source.onended = () => resolve();
      source.start();
    } catch (e) {
      console.error(e);
      resolve();
    }
  });
};

const useBrowserFallbackWait = (text: string, lang: 'es' | 'en'): Promise<void> => {
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
