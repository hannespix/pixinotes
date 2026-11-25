// M534: Die Zurück-Taste des Browsers springt in der App zurück, statt sie zu verlassen.
//
// Vorher stand nur die Karte im Fokus im Verlauf (FocusSheet, für die Android-Zurück-Geste). Wer ein anderes Board
// öffnete, zur Übersicht wechselte oder die Einstellungen aufhatte und dann „Zurück" drückte (Taste, Wischgeste,
// Alt+←), landete auf der Seite davor — meist außerhalb der App.
//
// Jetzt legt jeder sinnvolle Schritt einen Eintrag an: Ansicht (Board/Übersicht), Board, Karte im Fokus und die
// Fenster Einstellungen, Hilfe, Suche und Aufgaben-Zentrale. Nicht jeder Klick: Blättern im Fokus und der Wechsel
// Baum/Netz in der Übersicht ersetzen den Eintrag nur. Wer ein Fenster selbst schließt (Esc, ✕, Klick daneben), geht
// damit auch im Verlauf einen Schritt zurück — sonst sammelten sich tote Einträge, und „Zurück" öffnete das eben
// geschlossene Fenster wieder. Die Adresse bleibt unangetastet (Deep-Links, `#b=…`), nur `history.state` trägt den
// Schritt. In der portablen Datei (`file://`) gilt dasselbe; verweigert der Browser den Verlauf, bleibt alles wie vorher.
//
// Das Modul lädt nicht mit dem Start (Start-Paket): im Leerlauf nach dem Start oder mit dem ersten Fenster bzw. der
// ersten Karte im Fokus (App.tsx, FocusSheet.tsx). Es nimmt dann den Stand, wie er ist, als Ausgangspunkt.
import { useBoard } from '../store';
import type { BoardState } from '../store/typen';

interface Schritt {
  /** Ansicht */ v: 'board' | 'overview';
  /** Übersicht: Baum oder Netz */ o: string;
  /** Board */ b: string;
  /** Karte im Fokus */ f: string | null;
  /** Fenster: Einstellungen, Hilfe, Suche, Aufgaben-Zentrale */ e: boolean; h: boolean; s: boolean; t: boolean;
}
const SCHICHTEN = ['e', 'h', 's', 't'] as const;

const schrittVon = (st: BoardState): Schritt => ({
  v: st.view, o: st.overviewMode, b: st.activeId, f: st.focusCard,
  e: st.settingsOpen, h: st.helpOpen, s: st.searchOpen, t: st.tasksOpen,
});
// In der Übersicht zählt das Board nicht (aus der Übersicht in eine Karte und zurück wechselt es mit)
const grund = (x: Schritt) => `${x.v}|${x.v === 'board' ? x.b : ''}`;
const gleich = (a: Schritt, b: Schritt) => grund(a) === grund(b) && a.f === b.f && (a.v !== 'overview' || a.o === b.o)
  && SCHICHTEN.every((k) => a[k] === b[k]);
/** Hat `a` eine Schicht (Fenster, Karte im Fokus), die `b` nicht hat? */
const schichtWeg = (a: Schritt, b: Schritt) => (!!a.f && !b.f) || SCHICHTEN.some((k) => a[k] && !b[k]);
/** Ist `unten` derselbe Stand wie `oben`, nur mit weniger Schichten — also der Schritt, aus dem `oben` aufging? */
const darunter = (unten: Schritt, oben: Schritt) => grund(unten) === grund(oben) && (unten.v !== 'overview' || unten.o === oben.o)
  && (!unten.f || unten.f === oben.f) && SCHICHTEN.every((k) => !unten[k] || oben[k]) && !gleich(unten, oben);
/** Nur „ersetzen": Blättern im Fokus, Baum ↔ Netz */
const nurErsetzen = (a: Schritt, b: Schritt) => grund(a) === grund(b) && SCHICHTEN.every((k) => a[k] === b[k])
  && (a.f === b.f ? a.o !== b.o : !!a.f && !!b.f);

let gestartet = false;
/** Einträge dieses Seitenaufrufs, je Position im Verlauf (nach einem Neuladen sind die früheren unbekannt) */
const eintraege: (Schritt | undefined)[] = [];
let i = 0;
/** Ein eigener Schritt zurück läuft (history.go) — bis er ankommt, wird nichts eingetragen */
let unterwegs = false;
let unterwegsUhr = 0;
/** Ein Zurück/Vor wird gerade auf die App übertragen */
let anwenden = false;

const eintragen = (s: Schritt, neu: boolean) => {
  try {
    if (neu) { i += 1; eintraege.length = i; history.pushState({ pn: { i, s } }, ''); }
    else history.replaceState({ pn: { i, s } }, '');
    eintraege[i] = s;
  } catch { /* Verlauf gesperrt (eingebettet, Sandkasten): dann bleibt es beim Verhalten des Browsers */ }
};

function abgleichen(): void {
  if (unterwegs || anwenden) return;
  const neu = schrittVon(useBoard.getState());
  const alt = eintraege[i];
  if (!alt) { eintragen(neu, false); return; }
  if (gleich(neu, alt)) return;
  // Schichten zu (Fenster, Fokus): so weit zurück, wie die Einträge darunter liegen, aus denen sie aufgingen
  let j = i;
  while (j > 0 && eintraege[j] && eintraege[j - 1] && schichtWeg(eintraege[j]!, neu)
    && (darunter(eintraege[j - 1]!, eintraege[j]!) || gleich(eintraege[j - 1]!, neu))) j -= 1;
  if (j < i) {
    unterwegs = true;
    clearTimeout(unterwegsUhr);
    // Kommt das popstate nicht (abgebrochen), nicht ewig warten
    unterwegsUhr = window.setTimeout(() => { if (unterwegs) { unterwegs = false; i = j; abgleichen(); } }, 800);
    try { history.go(j - i); } catch { unterwegs = false; }
    return;
  }
  eintragen(neu, !nurErsetzen(alt, neu));
}

/** Einen Eintrag aus dem Verlauf auf die App übertragen (nur, was abweicht) */
function uebertragen(z: Schritt): void {
  const st = useBoard.getState();
  anwenden = true;
  try {
    if (!z.e && st.settingsOpen) st.setSettingsOpen(false);
    if (!z.h && st.helpOpen) st.setHelpOpen(false);
    if (!z.s && st.searchOpen) st.setSearchOpen(false);
    const patch: Partial<BoardState> = {};
    if (z.v !== st.view) patch.view = z.v;
    if (z.v === 'overview' && z.o !== st.overviewMode && (z.o === 'hierarchie' || z.o === 'netz')) patch.overviewMode = z.o;
    const board = st.boards.find((x) => x.id === z.b);
    if (board && z.b !== st.activeId) patch.activeId = z.b;
    if (z.t !== st.tasksOpen) patch.tasksOpen = z.t;
    // Eine Karte, die es nicht mehr gibt, öffnet sich nicht wieder
    const f = z.f && (board ?? st.boards.find((x) => x.id === st.activeId))?.nodes.some((n) => n.id === z.f) ? z.f : null;
    if (f !== st.focusCard) Object.assign(patch, { focusCard: f, ...(f ? {} : { focusHerkunft: null }) });
    if (Object.keys(patch).length) useBoard.setState(patch);
    if (z.e && !st.settingsOpen) st.setSettingsOpen(true);
    if (z.h && !st.helpOpen) st.setHelpOpen(true);
    if (z.s && !st.searchOpen) st.setSearchOpen(true);
  } finally { anwenden = false; }
}

/** Startet die Verlaufsführung (mehrfacher Aufruf schadet nicht) */
export function verlaufStarten(): void {
  if (gestartet || typeof history === 'undefined') return;
  gestartet = true;
  const pn = (history.state as { pn?: { i?: number } } | null)?.pn;
  i = typeof pn?.i === 'number' && pn.i >= 0 ? pn.i : 0;
  // Andere Teile räumen die Adresse mit replaceState(null, …) auf (Teilen-Links, Anmeldung) — der Schritt bleibt
  const ersetzen = history.replaceState.bind(history);
  history.replaceState = (daten: unknown, titel: string, url?: string | URL | null) => {
    const mein = (history.state as { pn?: unknown } | null)?.pn;
    ersetzen(daten == null && mein ? { pn: mein } : daten, titel, url);
  };
  // Ausgangspunkt: der Stand ohne Fenster und Fokus, darüber (falls schon offen) der Stand mit ihnen
  const jetzt = schrittVon(useBoard.getState());
  const basis: Schritt = { ...jetzt, f: null, e: false, h: false, s: false, t: false };
  eintragen(basis, false);
  if (!gleich(basis, jetzt)) eintragen(jetzt, true);

  window.addEventListener('popstate', (ev) => {
    const ziel = (ev.state as { pn?: { i: number; s: Schritt } } | null)?.pn;
    if (!ziel || typeof ziel.i !== 'number' || !ziel.s) return;   // fremder Eintrag (Anker in der Adresse) — nichts zu tun
    i = ziel.i;
    eintraege[i] = ziel.s;
    if (unterwegs) { unterwegs = false; clearTimeout(unterwegsUhr); abgleichen(); return; }
    uebertragen(ziel.s);
    // Ging nicht alles (Board gelöscht, Karte weg)? Dann steht im Eintrag, was wirklich zu sehen ist
    const ist = schrittVon(useBoard.getState());
    if (!gleich(ist, ziel.s)) eintragen(ist, false);
  });
  // Gebündelt: Eine Handlung setzt oft mehrere Felder nacheinander (Suche zu, Board auf, Fokus an)
  let geplant = false;
  useBoard.subscribe((st, vor) => {
    if (geplant || (st.view === vor.view && st.activeId === vor.activeId && st.focusCard === vor.focusCard && st.overviewMode === vor.overviewMode
      && st.settingsOpen === vor.settingsOpen && st.helpOpen === vor.helpOpen && st.searchOpen === vor.searchOpen && st.tasksOpen === vor.tasksOpen)) return;
    geplant = true;
    queueMicrotask(() => { geplant = false; abgleichen(); });
  });
}
