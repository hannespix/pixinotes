import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { readFileSync } from 'node:fs';

const pkgVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

// Modus "single": baut EINE portable pixinotes.html (läuft per Doppelklick,
// auch von file:// ohne Server/Installation/Adminrechte).
export default defineConfig(({ mode }) => ({
  // Relative Pfade: läuft so unter jeder URL — GitHub Pages (/repo/), Unterordner, file://
  base: './',
  // Build-Stempel in den Einstellungen: macht sichtbar, WELCHE Version gerade
  // läuft (PWA-Caches können nach einem Deploy kurz die alte ausliefern)
  define: {
    __BUILD_STAMP__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'),
    // M210: Version fürs „Über PixiNotes"-Menü — kommt aus package.json, damit
    // die Anzeige nicht von Hand veraltet
    __APP_VERSION__: JSON.stringify(pkgVersion),
  },
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
