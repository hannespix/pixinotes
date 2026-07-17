/// <reference types="vite/client" />

// Build-Stempel aus vite.config.ts (define) — angezeigt in den Einstellungen
declare const __BUILD_STAMP__: string;

// Mermaid-Vollbundle (IIFE, setzt window.mermaid) — bewusst ohne eigene Typen

// Eingebettete Schriften (?inline liefert eine data:-URL — offline/PWA-sicher)
declare module '*.woff2?inline' {
  const dataUri: string;
  export default dataUri;
}
