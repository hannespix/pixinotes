// M443: Baut den PixiNotes-MCP-Server als EINE Datei: release/pixinotes-mcp.mjs (Node ≥ 18, keine Installation nötig).
// Die Modul-Logik kommt direkt aus src/ (kiPlan, kiModule, nodes …); jeder Import von src/store.ts wird auf den
// schlanken Ersatz mcp/storeShim.ts umgelenkt.
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const wurzel = fileURLToPath(new URL('..', import.meta.url));
const storeDatei = path.join(wurzel, 'src', 'store.ts');
const ersatz = path.join(wurzel, 'mcp', 'storeShim.ts');

const umlenken = {
  name: 'store-ersatz',
  setup(b) {
    b.onResolve({ filter: /store$/ }, (args) => {
      const ziel = path.resolve(args.resolveDir, args.path);
      if (ziel === storeDatei.replace(/\.ts$/, '') || ziel === storeDatei) return { path: ersatz };
      return undefined;
    });
  },
};

// Was Bibliotheken der App beim Laden vom Browser erwarten (Sprache, Speicher) — im Server leer
const banner = `
import { createRequire as __pnRequire } from 'node:module';
const require = __pnRequire(import.meta.url);
if (typeof globalThis.localStorage === 'undefined') { const __m = new Map(); globalThis.localStorage = { getItem: (k) => (__m.has(k) ? __m.get(k) : null), setItem: (k, v) => { __m.set(k, String(v)); }, removeItem: (k) => { __m.delete(k); }, clear: () => __m.clear(), key: () => null, length: 0 }; }
if (typeof globalThis.window === 'undefined') { globalThis.window = globalThis; globalThis.window.addEventListener = () => {}; globalThis.window.removeEventListener = () => {}; globalThis.window.dispatchEvent = () => true; globalThis.window.location = { protocol: 'file:', origin: '', pathname: '/', search: '', hash: '' }; }
if (typeof globalThis.navigator === 'undefined') { globalThis.navigator = { language: 'de-DE', languages: ['de-DE'], userAgent: 'node' }; }
if (typeof globalThis.document === 'undefined') { globalThis.document = { documentElement: { lang: 'de', dataset: {}, style: { setProperty() {} } }, addEventListener() {}, removeEventListener() {}, querySelector: () => null, createElement: () => ({ style: {}, getContext: () => null }) }; }
`;

await build({
  entryPoints: [path.join(wurzel, 'mcp', 'server.ts')],
  outfile: path.join(wurzel, 'release', 'pixinotes-mcp.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  plugins: [umlenken],
  banner: { js: `#!/usr/bin/env node${banner}` },
  define: { 'import.meta.env': JSON.stringify({ MODE: 'production', DEV: false, PROD: true, BASE_URL: '/' }) },
  logLevel: 'warning',
  legalComments: 'none',
});
console.log('release/pixinotes-mcp.mjs gebaut');
