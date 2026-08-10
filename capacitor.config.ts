import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.safesmartpickup.app',
  appName: 'Safe Smart Pickup',
  webDir: 'dist',
  // La app nativa carga el sitio real en vez de un bundle local: evita
  // reescribir las llamadas relativas a /api/... (apiFetch.ts) y mantiene la
  // app siempre sincronizada con lo último desplegado, sin tener que generar
  // un APK nuevo por cada cambio de código. El costo es que requiere
  // conexión — aceptable porque la app ya depende de Supabase Realtime y del
  // backend para todo lo que hace (cola de recogida en vivo, GPS, etc.).
  server: {
    url: 'https://safesmartpickup.com',
    androidScheme: 'https',
  },
};

export default config;
