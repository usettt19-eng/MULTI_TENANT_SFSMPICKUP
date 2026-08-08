import { GoogleGenAI, Modality } from "@google/genai";

let sharedAudioContext: AudioContext | null = null;
let isAudioEnabled = false;
let audioEnableListeners: ((enabled: boolean) => void)[] = [];
let lastPlayedText = "";
let lastPlayedTime = 0;
let quotaExceededUntil = 0;

// Audio Queue
interface AudioTask {
  text: string;
}
let audioQueue: AudioTask[] = [];
let isPlaying = false;

export const getAudioContext = () => {
  if (!sharedAudioContext) {
    sharedAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
  }
  return sharedAudioContext;
};

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
  isAudioEnabled = true;
  audioEnableListeners.forEach(l => l(true));

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

  const { text } = task;
  const now = Date.now();

  try {
    if (now < quotaExceededUntil) {
      await useBrowserFallbackWait(text);
    } else {
      const apiKey = process.env.GEMINI_API_KEY || import.meta.env.VITE_GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("GEMINI_API_KEY not configured");
      }
      
      const ai = new GoogleGenAI({ apiKey });
      
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: `Diga con voz amable y profesional: ${text}` }] }],
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
        await useBrowserFallbackWait(text);
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
      await useBrowserFallbackWait(text);
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

const useBrowserFallbackWait = (text: string): Promise<void> => {
  return new Promise((resolve) => {
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'es-ES';
      utterance.rate = 0.9;
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      window.speechSynthesis.speak(utterance);
    } else {
      resolve();
    }
  });
};

export const playGlobalVoiceMessage = async (text: string) => {
  console.log('playGlobalVoiceMessage called with:', text);
  if (!isAudioEnabled) {
    console.log('Audio is not enabled globally. Skipping message:', text);
    return;
  }

  // Debounce exact duplicates within 3 seconds 
  // (we still want them queued if they happen legally, but prevent double firing)
  const now = Date.now();
  if (text === lastPlayedText && now - lastPlayedTime < 3000) {
    console.log('Debouncing duplicate message:', text);
    return;
  }
  
  lastPlayedText = text;
  lastPlayedTime = now;

  audioQueue.push({ text });
  processAudioQueue();
};
