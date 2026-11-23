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
                // M446: NUR der Teil, den der Editor beim Start braucht. BlockNote lädt
                // Emoji-Auswahl (emoji-mart samt 480 KB Daten) und die Markdown-/HTML-
                // Kette (unified, remark, rehype, parse5 …) selbst per import() nach —
                // stand das hier mit im Paket, zog manualChunks sie in den Start
                // (rund 1 MB Quelltext, der fürs erste Board nie gebraucht wird).
                if (/node_modules\/(@blocknote|@tiptap|prosemirror-[a-z-]+|y-prosemirror|yjs|lib0|@mantine|@floating-ui|linkifyjs)\//.test(id)) return 'editor';
                if (/node_modules\/(@xyflow|d3-[a-z-]+|classcat|zustand)\//.test(id)) return 'fluss';
                // M414: Rufnummern-Erkennung samt Länderdaten (rund 110 KB) — Fremdcode, der sich so gut wie nie ändert
                if (/node_modules\/libphonenumber-js\//.test(id)) return 'rufnummer';
                return undefined;
              },
            },
          },
        },
}));
