import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import inject from '@rollup/plugin-inject';
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

/**
 * M467: `process` als freier Name nur in den Node-Modulen des Outlook-Lesers (iconv-lite → stream-browserify →
 * readable-stream, util, safer-buffer …) — sie lesen `process.env`/`process.nextTick` ohne typeof-Prüfung.
 * Alle Pakete hier hängen nur an @kenjiuno/msgreader (lib/parseEmail.ts, per import() nachgeladen).
 */
function processNurMsg(): Plugin {
  return {
    ...(inject({
      include: [/node_modules\/(@kenjiuno\/[^/]+|iconv-lite|safer-buffer|safe-buffer|string_decoder|stream-browserify|readable-stream|util|events|inherits)\//],
      modules: { process: 'vite-plugin-node-polyfills/shims/process' },
    }) as Plugin),
    name: 'pixinotes-process-nur-msg',
    enforce: 'post',
  };
}

/**
 * M462: „frimousse" (Emoji-Auswahl von BlockNote 0.57) für alle Module auf den Nachlader
 * src/lib/frimousseNachladen.tsx lenken — nur der Nachlader selbst bekommt das echte Paket (per import()).
 * So bleibt die Bibliothek aus dem Start-Paket, wie früher emoji-mart bei BlockNote 0.31.
 */
function frimousseNachladen(): Plugin {
  const nachlader = resolve('src/lib/frimousseNachladen.tsx');
  return {
    name: 'pixinotes-frimousse-nachladen',
    enforce: 'pre',
    resolveId(quelle, importeur) {
      if (quelle !== 'frimousse' || !importeur || resolve(importeur.split('?')[0]) === nachlader) return null;
      return nachlader;
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
  plugins: [
    react(),
    // nodePolyfills: @kenjiuno/msgreader (iconv-lite) erwartet Node-Module (buffer, stream, util) im Browser.
    // M467: nur noch als Modul-Ersatz für `require('buffer' | 'stream' | 'util')`, OHNE globales Buffer/process/
    // global. Das Plugin setzte sonst in JEDE Datei, die einen dieser Namen erwähnt, einen Import des Ersatzes —
    // über lib0 (Editor) landeten so ~70 KB Buffer- und process-Ersatz im Start, obwohl dort jede Bibliothek
    // `typeof process`/`typeof Buffer` prüft und den Browser-Weg nimmt. Gebraucht wird `process` nur im
    // Stream-/util-Teil des .msg-Lesers — dorthin kommt er gezielt (processNurMsg) und damit ins MSG-Paket.
    nodePolyfills({
      include: ['buffer', 'stream', 'util'],
      globals: { Buffer: false, global: false, process: false },
      // derselbe Buffer-Ersatz wie bisher für `require('buffer')` (statt des rohen buffer-Pakets)
      overrides: { buffer: 'vite-plugin-node-polyfills/shims/buffer' },
    }),
    processNurMsg(),
    frimousseNachladen(),
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
              manualChunks(id, { getModuleInfo }) {
                // M459: die Weichen der nachgeladenen Erkennungen gehören in deren Paket — sonst legt Rollup die reine
                // Weiterleitung ins Start-Paket und zieht damit das ganze Paket wieder in den Start
                if (/src\/lib\/rufnummerKern\.ts$/.test(id)) return 'rufnummer';
                if (/src\/lib\/chronoKern\.ts$/.test(id)) return 'fristen';
                if (!id.includes('node_modules/')) return undefined;
                if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react';
                // M477: Gemeinsam tippen (Yjs, y-protocols, y-prosemirror samt ihrem lib0 und BlockNotes Yjs-Teil) lädt
                // erst, wenn eine Notiz in einem Live-Board gemeinsam geöffnet wird — nie im Start (Regel unten zöge es
                // ins Editor-Paket). lib0 aus dem Haupt-Ordner bleibt beim Editor: BlockNote nutzt es selbst.
                if (/node_modules\/(yjs|y-prosemirror|y-protocols)\//.test(id) || /node_modules\/@blocknote\/core\/dist\/yjs\.js$/.test(id)) return 'gemeinsam';
                // M446: NUR der Teil, den der Editor beim Start braucht. BlockNote lädt
                // Emoji-Auswahl (emoji-mart samt 480 KB Daten) und die Markdown-/HTML-
                // Kette (unified, remark, rehype, parse5 …) selbst per import() nach —
                // stand das hier mit im Paket, zog manualChunks sie in den Start
                // (rund 1 MB Quelltext, der fürs erste Board nie gebraucht wird).
                if (/node_modules\/(@blocknote|@tiptap|prosemirror-[a-z-]+|y-prosemirror|yjs|lib0|@mantine|@floating-ui|linkifyjs)\//.test(id)) {
                  // M462: BlockNote 0.57 legt die Emoji-Namen je Sprache (frimousse,
                  // 75–190 KB je Datei, 20 Sprachen) als eigene Module in
                  // @blocknote/core/dist ab und lädt sie per import() nach. Ohne
                  // diese Ausnahme zog die Regel oben alle in den Start (4,2 MB).
                  // Was nur dynamisch erreicht wird, bleibt ein eigener Nachlade-Teil.
                  const info = getModuleInfo(id);
                  if (info && info.importers.length === 0 && info.dynamicImporters.length > 0) return undefined;
                  return 'editor';
                }
                if (/node_modules\/(@xyflow|d3-[a-z-]+|classcat|zustand)\//.test(id)) return 'fluss';
                // M414: Rufnummern-Erkennung samt Länderdaten (rund 110 KB) — Fremdcode, der sich so gut wie nie ändert
                if (/node_modules\/libphonenumber-js\//.test(id)) return 'rufnummer';
                // M459: Fristen-Erkennung (chrono-node) — lädt bei Bedarf (lib/dates.ts)
                if (/node_modules\/chrono-node\//.test(id)) return 'fristen';
                return undefined;
              },
            },
          },
        },
}));
