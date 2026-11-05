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
      : {
          chunkSizeWarningLimit: 1500,
          rollupOptions: {
            output: {
              // M321: Fremdcode in stabile Pakete, getrennt vom eigenen Code.
              // Ein Deploy ändert meist nur den App-Teil — React, Editor und
              // Fluss bleiben dann im Browser-Cache (und im Service Worker),
              // statt dass eine 6-MB-Datei komplett neu kommt. Schwergewichte
              // (Mermaid-Rohtext, PDF, XLSX, MSG) bleiben eigene Nachlade-Teile.
              manualChunks(id) {
                if (!id.includes('node_modules/')) return undefined;
                if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react';
                if (/node_modules\/(@blocknote|@tiptap|prosemirror-[a-z-]+|y-prosemirror|yjs|lib0|@mantine|@floating-ui|emoji-mart|@emoji-mart|linkifyjs|micromark[a-z-]*|mdast-[a-z-]+|hast-[a-z-]+|hastscript|unified|remark-[a-z-]+|rehype-[a-z-]+|parse5|vfile[a-z-]*|unist-[a-z-]+|property-information|@ungap)\//.test(id)) return 'editor';
                if (/node_modules\/(@xyflow|d3-[a-z-]+|classcat|zustand)\//.test(id)) return 'fluss';
                return undefined;
              },
            },
          },
        },
}));
