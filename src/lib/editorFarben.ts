/* M499: Editor-Farben (BlockNote-Namen) als feste Werte für Export, E-Mail, Druck und PDF — Outlook, Word und das
   PDF kennen weder die Namen noch CSS-Variablen. Dieselben Hellstufen wie `--tag-hl-*` in src/styles/00-tokens.css
   (Prüfreihe m499 vergleicht beide): jede Schrift ≥ 4,5:1 auf Weiß, auf den Haftnotiz-Farben und auf jedem
   Hintergrund. Vorher BlockNotes Originale (Gelb 2,1:1, Grau 2,8:1 auf Weiß). */
export const EDITOR_SCHRIFT: Record<string, string> = {
  gray: '#5e5d59', brown: '#6e4530', red: '#b42318', orange: '#9a4a00', yellow: '#7c5d00',
  green: '#1e6e4e', blue: '#0b62a8', purple: '#6c36b5', pink: '#ad1771',
};
export const EDITOR_GRUND: Record<string, string> = {
  gray: '#e3e4e6', brown: '#ecdcd2', red: '#fcd9d6', orange: '#fde1c6', yellow: '#fbe98e',
  green: '#d3ecdf', blue: '#d6e7f7', purple: '#e7dcf6', pink: '#f8d9ea',
};
