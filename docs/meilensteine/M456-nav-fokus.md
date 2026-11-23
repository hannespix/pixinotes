# M456 — Navigation am Telefon barrierefrei
PR: siehe Merge-Titel „… (M456)" · Prüfreihe: `pruefungen/m456-nav-fokus.mjs` (Port 5456) · Datum: 2026-11-23

## Warum
Befund B11 aus M447 (`docs/AUDIT.md` §5): Die ausklappbare Navigation am Telefon (`.nav-panel`) war ein
`role="dialog"` ohne `aria-modal` und ohne Fokus-Falle. Der Fokus blieb beim Öffnen auf dem Knopf in der
Kopfleiste, Tab lief ins Board dahinter, ein Vorlese-Programm las den Hintergrund weiter vor.

## Was
- Beim Öffnen steht der Fokus im Panel; Tab und Umschalt+Tab laufen darin im Kreis.
- Esc, ✕ und ein Tipp daneben schließen; der Fokus kehrt zum Auslöser zurück.
- Solange das Panel offen ist, ist alles dahinter `inert` (nicht anwählbar, nicht antippbar, nicht vorgelesen).
- Auslöser (Brotkrume bzw. Weg-Knopf „Projekt › Board") melden `aria-haspopup="dialog"`, `aria-expanded`,
  `aria-controls="nav-panel"`; das Panel trägt `id="nav-panel"`, `aria-modal="true"`, Name „Navigation".
- Aussehen unverändert; „Bewegung reduzieren" schaltet Einfahren und Abdunkeln ab (globale Regel, geprüft).

## Wie (Architektur)
- `src/lib/fensterFokus.ts`: `.nav-backdrop` steht in `FENSTER` — dieselbe Fokus-Führung wie für alle Fenster
  (Fokus hinein auf den `[role="dialog"]`, Tab im Kreis, Fokus zurück, wenn er mit dem Fenster verschwand).
- `src/components/Tabs.tsx`: `useLayoutEffect` auf `navOpen` setzt ein Bild später `inert` auf alle direkten
  Kinder von `body` außer `.nav-backdrop` (nur die, die es noch nicht waren) und hebt es in der Aufräum-Funktion
  auf. Ein Bild später, weil die Fenster-Führung im MutationObserver erst den Auslöser als „vorher" merkt;
  Aufräumen im Layout-Effekt, weil es noch im Commit laufen muss — sonst gäbe die Fenster-Führung den Fokus an
  einen Knopf zurück, der noch inert ist.
- Die Abdunklung (`.nav-backdrop`, z-index 70) liegt über der Kopfleiste (`.tabs`, z-index 50): Ein Tipp auf den
  Auslöser trifft die Abdunklung und schließt. Die in M447 befürchtete Ausnahme für die Kopfleiste braucht es
  deshalb nicht.
- Hilfe DE/EN: „Was ist neu".

## Grenzen / offen
- Die Spalte ab Tablet-Breite ist kein Fenster und bleibt ohne Falle (richtig so).
- Die Ausstülpung ab Tablet-Breite (Spalte ausgeblendet) nutzt denselben Weg und ist damit mit abgedeckt.
