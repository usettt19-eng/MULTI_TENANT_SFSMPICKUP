import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

// Sin este archivo, Vite no carga @tailwindcss/vite y el build sale SIN
// utilidades de Tailwind: la aplicación se ve completamente sin estilos.
// (Comprobado: el CSS generado pasaba de 23 KB con 1 sola clase a 100+ KB con
// las utilidades reales al añadir el plugin.)
export default defineConfig({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
