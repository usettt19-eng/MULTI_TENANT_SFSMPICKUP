import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

// Sin este archivo, Vite no carga @tailwindcss/vite y el build sale SIN
// utilidades de Tailwind: la aplicación se ve completamente sin estilos.
// (Comprobado: el CSS generado pasaba de 23 KB con 1 sola clase a 100+ KB con
// las utilidades reales al añadir el plugin.)
export default defineConfig(({mode}) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react(), tailwindcss()],

    // SmartCheckIn.tsx:38 y audioManager.ts:72 leen process.env.GEMINI_API_KEY,
    // que en el navegador no existe: sin esta sustitución lanzan
    // "process is not defined" al ejecutarse.
    //
    // OJO: esto empotra la clave en el bundle que descarga cada usuario. Es el
    // comportamiento actual, no una regresión, pero la solución correcta es
    // proxear las llamadas a Gemini desde el backend. Ver DISENO-Y-AVANCE.md §5.2.
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(
        env.GEMINI_API_KEY ?? env.VITE_GEMINI_API_KEY ?? '',
      ),
    },

    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
  };
});
