import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

const pkgVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

/**
 * M452: Texterkennung (tesseract.js, Apache-2.0) — Worker, Kern (WASM) und Sprachdaten Deutsch + Englisch
 * liegen nach dem Web-Build in dist/ocr/ neben der App (kein fremdes CDN). Sie werden erst geladen, wenn ein
 * Bild erkannt wird (src/lib/ocrEngine.ts). Drei Kern-Fassungen, weil tesseract.js je nach Browser (SIMD,
 * Relaxed-SIMD) eine andere anfordert — geladen wird nur eine. Die portable Datei bekommt sie nicht
 * (sie holt die Dateien bei Bedarf von der Web-Adresse der App); release/ bleibt so schlank.
 */
function ocrDateienKopieren(): Plugin {
  let outDir = 'dist';
  return {
    name: 'pixinotes-ocr-dateien',
    apply: 'build',
    configResolved(c) { outDir = resolve(c.root, c.build.outDir); },
    closeBundle() {
      const ziel = resolve(outDir, 'ocr');
      mkdirSync(ziel, { recursive: true });
      const nm = (p: string) => resolve('node_modules', p);
      const dateien: Array<[string, string]> = [
        [nm('tesseract.js/dist/worker.min.js'), 'worker.min.js'],
        ...['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js']
          .map((f): [string, string] => [nm(`tesseract.js-core/${f}`), f]),
        [nm('@tesseract.js-data/deu/4.0.0_best_int/deu.traineddata.gz'), 'deu.traineddata.gz'],
        [nm('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'), 'eng.traineddata.gz'],
        // Lizenztexte gehören zu den ausgelieferten Dateien (Apache-2.0)
        [nm('tesseract.js/LICENSE.md'), 'LIZENZ-tesseract.js.md'],
        [nm('tesseract.js-core/LICENSE'), 'LIZENZ-tesseract.js-core.txt'],
      ];
      for (const [von, nach] of dateien) copyFileSync(von, resolve(ziel, nach));
    },
  };
}

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
    ...(mode === 'single' ? [viteSingleFile({ removeViteModuleLoader: true })] : [ocrDateienKopieren()]),
  ],
  build:
    mode === 'single'
      ? { outDir: 'release', chunkSizeWarningLimit: 10000, emptyOutDir: false } // M443: der MCP-Server liegt daneben
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
