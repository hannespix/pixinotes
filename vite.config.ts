import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Modus "single": baut EINE portable pixinotes.html (läuft per Doppelklick,
// auch von file:// ohne Server/Installation/Adminrechte).
export default defineConfig(({ mode }) => ({
  // Relative Pfade: läuft so unter jeder URL — GitHub Pages (/repo/), Unterordner, file://
  base: './',
  // nodePolyfills: @kenjiuno/msgreader (iconv-lite) erwartet Node-Buffer im Browser
  plugins: [
    react(),
    nodePolyfills({ include: ['buffer', 'stream', 'util'] }),
    ...(mode === 'single' ? [viteSingleFile({ removeViteModuleLoader: true })] : []),
  ],
  build:
    mode === 'single'
      ? { outDir: 'release', chunkSizeWarningLimit: 10000 }
      : undefined,
}));
