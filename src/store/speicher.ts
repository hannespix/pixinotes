/**
 * Speichern: gedrosselter localStorage-Schreiber, Single-Writer (M81), Import-Merker, abgeleitete Änderungen und
 * die Persist-Auswahl samt Migration alter Speicherstände.
 *
 * M480: aus src/store.ts herausgelöst (reiner Umbau) – src/store.ts bleibt der Einstieg und exportiert alles weiter.
 */
import type { Edge, Node } from '@xyflow/react';
import type { TimeSeg } from '../types';
import { anchorStroke } from '../lib/strokeAnchor';
import type { BoardDoc, BoardState } from './typen';
import { persistHaken } from './schutz';
import { defaultHierarchy } from './start';
import { useBoard } from '../store';

/**
 * K1+M5-Schutz: localStorage-Writes werden gedrosselt (max. alle 400 ms statt
 * pro Tastendruck/Drag-Frame) und Quota-Fehler abgefangen statt die App zu
 * crashen. Bei vollem Speicher informiert ein Event die UI (Toast in App.tsx).
 *
 * M525: Gemerkt wird der STAND (ein Verweis, kostet nichts), nicht mehr sein Text. Vorher schrieb jede einzelne
 * Store-Änderung — jedes Maus-Ereignis beim Ziehen, jeder Tastendruck, sogar ein Hinweis-Toast — den kompletten
 * Stand aller Boards als JSON (mehrere MB), nur um ihn 400 ms lang zu puffern und fast immer ungenutzt zu verwerfen.
 * Jetzt entsteht der Text erst beim Schreiben, und unveränderte Karten, Striche und Boards behalten ihren Text
 * (siehe speicherText).
 */
let writeTimer: ReturnType<typeof setTimeout> | undefined;
let pendingWrite: { key: string; wert: Gespeichert } | null = null;
/** Der Stand, der zuletzt zum Schreiben vorgemerkt wurde — Vergleichsbasis für „nichts Gespeichertes geändert" */
let letzterStand: Record<string, unknown> | null = null;
/** reassertPersist: derselbe Stand soll trotzdem geschrieben werden */
let erzwingen = false;
let quotaWarned = false;

type Gespeichert = { state: Record<string, unknown>; version?: number };

/* ───── M525: Text des Stands, ohne Unverändertes neu zu schreiben ─────
   Der Store ersetzt geänderte Karten, Striche, Kanten und Boards durch neue Objekte und lässt alles andere stehen
   (so erkennt auch React, was neu zu zeichnen ist). Der Text eines Objekts wird deshalb an das Objekt selbst geheftet
   (WeakMap): Wer eine Karte verschiebt, schreibt den Text dieser einen Karte neu — nicht die eingebetteten Bilder
   und langen Notizen aller anderen. Das Ergebnis ist Zeichen für Zeichen dasselbe wie JSON.stringify.
   Sicherheitsnetz: Beim Verlassen der Seite (und in den Prüfreihen bei jedem Schreiben, s. u.) entsteht der Text
   ohne Gedächtnis — sollte je ein Objekt an Ort und Stelle verändert worden sein, steht spätestens dann das Richtige
   im Speicher. */
let textVon = new WeakMap<object, string>();
const istObjekt = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const einzeln = (v: unknown): string => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v, ersetzer) ?? 'null';
  let t = textVon.get(v);
  if (t === undefined) { t = JSON.stringify(v, ersetzer) ?? 'null'; textVon.set(v, t); }
  return t;
};
/** Objekt wie JSON.stringify — `eigen` liefert für ausgewählte Felder einen eigenen Text (sonst undefined) */
const objektText = (o: Record<string, unknown>, eigen: (k: string, v: unknown) => string | undefined): string => {
  let aus = '{'; let erster = true;
  for (const k of Object.keys(o)) {
    const v = o[k];
    const t = eigen(k, v) ?? JSON.stringify(v, ersetzer);
    if (t === undefined) continue;   // undefined/Funktion: lässt JSON.stringify ebenfalls aus
    aus += `${erster ? '' : ','}${JSON.stringify(k)}:${t}`; erster = false;
  }
  return `${aus}}`;
};
const liste = (v: unknown, eintrag: (e: unknown) => string): string | undefined => (Array.isArray(v) ? `[${v.map(eintrag).join(',')}]` : undefined);
/** Karte: die kleinen Felder (Lage, Größe, Auswahl) frisch, der Inhalt (`data`) über das Gedächtnis. Eine verschobene
 *  Karte schreibt so ihren Inhalt nicht neu, und je Inhalt bleibt nur EIN Text im Speicher — auch wenn der Verlauf
 *  (Rückgängig) viele Lagen derselben Karte hält. */
const karteText = (n: unknown): string => (istObjekt(n) && istObjekt(n.data)
  ? objektText(n, (k, v) => (k === 'data' ? einzeln(v) : undefined))
  : JSON.stringify(n, ersetzer) ?? 'null');
const boardText = (b: unknown): string => {
  if (!istObjekt(b)) return JSON.stringify(b, ersetzer) ?? 'null';
  let t = textVon.get(b);
  if (t === undefined) {
    t = objektText(b, (k, v) => (k === 'nodes' ? liste(v, karteText) : k === 'edges' || k === 'drawings' || k === 'comments' ? liste(v, einzeln) : undefined));
    textVon.set(b, t);
  }
  return t;
};
/* M532: Große data-URLs (Bilder) gehen nicht in den localStorage-Stand, sondern in die Ablage (ablage.ts, IndexedDB);
   im Text steht ein Verweis. Das Wie lädt nach: Bis ablage.ts da ist, merkt dieser kleine Ersetzer nur, DASS es etwas
   auszulagern gibt, und holt das Modul — das setzt dann seinen Ersetzer ein und schreibt den Stand einmal neu. */
export const AUSLAGERN_AB = 10_000;
export const ablageModul = () => import('./ablageIdb');
let ersetzer = (_k: string, v: unknown): unknown => {
  if (typeof v === 'string' && v.length >= AUSLAGERN_AB && v.startsWith('data:')) void ablageModul();
  return v;
};
/** ablage.ts meldet sich an: ab jetzt lagert der Speicher aus (Gedächtnis verwerfen, einmal neu schreiben) */
export function ablageAnmelden(f: (k: string, v: unknown) => unknown, nachSichern: { an: () => void }): void {
  ersetzer = f;
  textVon = new WeakMap();
  nachSichern.an = () => { textVon = new WeakMap(); if (writerRole === 'writer') reassertPersist(); };
  if (writerRole === 'writer') setTimeout(reassertPersist, 0);
}
/** Gemerkten Text verwerfen (die Ablage hat Neues als gesichert übernommen) */
export const gedaechtnisVerwerfen = (): void => { textVon = new WeakMap(); };
/**
 * Einen Stand von außen (Konto, Ordner, WebDAV) VOR dem Übernehmen in die Ablage legen: Dann trägt schon das erste
 * Speichern nach dem Einarbeiten Verweise statt der Bilder — und scheitert nicht am vollen localStorage.
 */
export const ablageVorab = (wert: unknown): Promise<void> => ablageModul().then((m) => m.vorab(wert), () => {});
/** Der Text, der in localStorage geht — gleich JSON.stringify(wert, ersetzer) */
export const vollText = (wert: unknown): string => JSON.stringify(wert, ersetzer);
export function speicherText(wert: Gespeichert, ohneGedaechtnis = false): string {
  if (ohneGedaechtnis) return vollText(wert);
  return objektText(wert as unknown as Record<string, unknown>, (k, v) => (k === 'state' && istObjekt(v)
    ? objektText(v, (k2, v2) => (k2 === 'boards' ? liste(v2, boardText) : undefined))
    : undefined));
}
/** Prüfreihen (und wer es wissen will) schalten mit diesem Schlüssel den Vergleich bei JEDEM Schreiben ein */
const PRUEF_KEY = 'pixinotes-speicher-pruefen';
/** Prüf-Build: VITE_SPEICHER_PRUEFEN=1 prüft immer; =2 lässt bei einer Abweichung zusätzlich die Seite sichtbar scheitern (damit jede Prüfreihe rot wird) */
// (`env` kann fehlen: die Prüfreihen bündeln den Speicher auch ohne Vite — m522, „Labor")
const PRUEF_BAU = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_SPEICHER_PRUEFEN ?? '';
let pruefen: boolean | null = null;
const pruefenAn = (): boolean => {
  if (pruefen === null) { try { pruefen = !!PRUEF_BAU || localStorage.getItem(PRUEF_KEY) === '1'; } catch { pruefen = false; } }
  return pruefen;
};
/** Zähler für Prüfreihen und Fehlersuche; `abweichungen` (gemerkter Text ≠ Stand) muss 0 bleiben */
export const speicherZaehler = { vorgemerkt: 0, uebersprungen: 0, geschrieben: 0, abweichungen: 0 };
if (typeof window !== 'undefined') (window as unknown as { pixinotesSpeicher: typeof speicherZaehler }).pixinotesSpeicher = speicherZaehler;

/** Ist gegenüber dem zuletzt vorgemerkten Stand nichts anders, das gespeichert wird? */
function standGleich(a: Record<string, unknown> | null, b: Record<string, unknown>): boolean {
  if (!a) return false;
  const kb = Object.keys(b);
  if (Object.keys(a).length !== kb.length) return false;
  for (const k of kb) {
    const x = a[k]; const y = b[k];
    if (x === y) continue;
    // `boards` baut die Auswahl bei jedem Aufruf als neue Liste (persistHaken) — die Boards darin sind dieselben
    if (k === 'boards' && Array.isArray(x) && Array.isArray(y) && x.length === y.length && x.every((e, i) => e === y[i])) continue;
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Single-Writer-Schutz (Sync-Audit M81): Läuft PixiNotes doppelt (installierte
// PWA + vergessener Browser-Tab), teilen sich beide Kontexte denselben
// localStorage — bisher überschrieb der zuletzt schreibende kommentarlos den
// anderen. Genau so ging ein frisch geladener Sync-Stand nach dem Neustart
// wieder verloren. Jetzt hält genau EIN Kontext die Schreibrechte (Web Lock);
// alle weiteren Fenster laufen als Mitleser: sie schreiben nichts und
// übernehmen den Stand des Schreibers live (storage-Event → adopt).
export type WriterRole = 'writer' | 'follower';
let writerRole: WriterRole = 'writer'; // Standard: einziges Fenster schreibt
const LOCK_NAME = 'pixinotes-writer';
const hasLocks = typeof navigator !== 'undefined' && 'locks' in navigator;

export const getWriterRole = (): WriterRole => writerRole;
export const singleWriterSupported = (): boolean => hasLocks;

function setWriterRole(role: WriterRole): void {
  if (writerRole === role) return;
  writerRole = role;
  // Nie einen veralteten Puffer nachschieben (z. B. via visibilitychange-Flush)
  if (role === 'follower') pendingWrite = null;
  letzterStand = null;   // M525: nach einem Rollenwechsel zählt der nächste Stand in jedem Fall als neu
  window.dispatchEvent(new CustomEvent('pixinotes:writer-change'));
}

/** Ausstehenden (gedrosselten) Persist-Write sofort schreiben.
 *  true = der aktuelle Stand liegt jetzt sicher in localStorage.
 *  Bei Quota-Fehler bleibt der Write gepuffert (Retry beim nächsten Flush).
 *  M525 `gruendlich` (Seite wird verlassen/verdeckt): Text ohne Gedächtnis, siehe speicherText. */
export function flushPersist(gruendlich?: boolean): boolean {
  if (!pendingWrite) return true;
  let text = '';
  try {
    const wert = pendingWrite.wert;
    text = speicherText(wert, gruendlich === true);
    if (gruendlich !== true && pruefenAn()) {
      const soll = vollText(wert);
      if (soll !== text) { abweichung(); text = soll; }
    }
    localStorage.setItem(pendingWrite.key, text);
    // Mit Gedächtnis geschrieben: beim Verlassen der Seite noch einmal ohne nachsehen (nachpruefen)
    ungeprueft = gruendlich === true ? null : { key: pendingWrite.key, wert };
    pendingWrite = null;
    quotaWarned = false;
    letzterFehler = null;
    speicherZaehler.geschrieben += 1;
    if (reserve.da) { reserve.da = false; void ablageModul().then((m) => m.reserveLoeschen()); }
    return true;
  } catch (e) {
    // M532: voll oder anders gesperrt? — der Abgleich nennt es beim Namen statt zu raten
    letzterFehler = /quota/i.test((e as Error)?.name) ? 'voll' : 'anderer';
    // M532: voll → der Stand geht in den Ersatzspeicher (IndexedDB) statt verloren (ablageIdb.ts → reserveSchreiben)
    if (text && letzterFehler === 'voll' && writerRole === 'writer') void ablageModul().then((m) => m.reserveSchreiben(text));
    if (!quotaWarned) {
      quotaWarned = true;
      window.dispatchEvent(new CustomEvent('pixinotes:quota'));
    }
    return false;
  }
}
/** M532: Warum das letzte Schreiben scheiterte (null = es gelang) */
/* (die Meldung dazu baut kontoSync.ts → speicherFehlerText) */
export let letzterFehler: 'voll' | 'anderer' | null = null;
/** M532: Liegt ein Stand im Ersatzspeicher, der nach dem nächsten gelungenen Schreiben weg kann? (ablageIdb.ts setzt es) */
export const reserve = { da: false };
/** Meldung des Prüfbetriebs (kein Oberflächentext — Nutzer sehen sie nie) */
const ABWEICHUNG = 'M525: gemerkter Speichertext weicht vom Stand ab';
/** Der zuletzt MIT Gedächtnis geschriebene Stand — beim Verlassen der Seite einmal ohne Gedächtnis gegengeprüft */
let ungeprueft: { key: string; wert: Gespeichert } | null = null;
function abweichung(): void {
  speicherZaehler.abweichungen += 1;
  textVon = new WeakMap();   // dem Gedächtnis ist nicht mehr zu trauen
  console.error('PixiNotes: Speichertext wich vom Stand ab (M525), neu geschrieben.');
  // Im Prüfbetrieb laut scheitern (die Prüfreihen sammeln Seitenfehler) — geschrieben ist der richtige Stand trotzdem
  if (pruefenAn()) setTimeout(() => { throw new Error(ABWEICHUNG); }, 0);
  if (PRUEF_BAU === '2') document.documentElement.textContent = ABWEICHUNG;
}
/** Sicherheitsnetz: Stimmt, was mit Gedächtnis geschrieben wurde, mit dem Stand überein? Sonst jetzt richtig schreiben. */
function nachpruefen(): void {
  const u = ungeprueft;
  if (!u || writerRole !== 'writer') return;
  ungeprueft = null;
  try {
    const soll = vollText(u.wert);
    if (soll === speicherText(u.wert)) return;
    abweichung();
    localStorage.setItem(u.key, soll);
  } catch { /* voll: der Stand von eben bleibt stehen */ }
}
if (typeof window !== 'undefined') {
  // M525: Beim Verlassen sofort und gründlich schreiben — der gedrosselte Schreiber bleibt nichts schuldig
  const sofort = () => { clearTimeout(writeTimer); if (pendingWrite) flushPersist(true); else nachpruefen(); };
  window.addEventListener('beforeunload', sofort);
  window.addEventListener('pagehide', sofort);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') sofort();
  });
}
/** Die Ablage für persist: nimmt den Stand als Objekt (kein JSON je Änderung, M525) und schreibt gedrosselt. */
export const speicherAblage = {
  // pendingWrite mitlesen: ein getItem direkt nach setItem darf nie den
  // schon überholten localStorage-Stand liefern
  getItem: (k: string): Gespeichert | null => {
    // (Puffer: der Stand im Arbeitsspeicher — ohne Verweise, M532)
    const roh = pendingWrite?.key === k ? JSON.stringify(pendingWrite.wert) : localStorage.getItem(k);
    if (roh === null) return null;
    nachDemLaden(roh);   // (verträgt Unlesbares: das Nachgeladene fängt seinen Fehler selbst)
    try { return JSON.parse(roh) as Gespeichert; } catch {
      // M529 (M522 O2): Unlesbar — sofort (synchron, vor jedem Überschreiben) aufheben. sessionStorage hat ein eigenes
      // Kontingent; lib/rettung.ts (lädt im Leerlauf mit den Einstellungen) legt es in die Geräte-Ablage. Hier steht
      // so wenig wie möglich — das Start-Paket hat kaum Luft.
      try { sessionStorage.setItem('pixinotes-rettung', roh); } catch { /* kein Platz: nichts zu retten */ }
      return null;
    }
  },
  setItem: (k: string, v: Gespeichert): void => {
    if (writerRole !== 'writer') return; // Mitlese-Fenster schreibt NIE
    // M525: Nichts geändert, das gespeichert wird (Toast, Dialog auf/zu, Schwebezustände) → kein Schreiben
    if (!erzwingen && standGleich(letzterStand, v.state)) {
      speicherZaehler.uebersprungen += 1;
      // Wartet noch ein Schreiben (der Speicher war voll), wird es wie bisher mit jeder Änderung neu versucht
      if (pendingWrite) { clearTimeout(writeTimer); writeTimer = setTimeout(flushPersist, 400); }
      return;
    }
    letzterStand = v.state;
    pendingWrite = { key: k, wert: v };
    speicherZaehler.vorgemerkt += 1;
    clearTimeout(writeTimer);
    writeTimer = setTimeout(flushPersist, 400);
  },
  removeItem: (k: string): void => {
    if (writerRole !== 'writer') return;
    pendingWrite = null;
    letzterStand = null;
    localStorage.removeItem(k);
  },
};

/* ───── M532: Verweise im gespeicherten Stand wieder durch ihre Inhalte ersetzen ─────
   Der Stand kommt synchron aus localStorage (wie immer) — mit Verweisen statt großer data-URLs. Ihre Inhalte holt
   die IndexedDB nach; erst danach zeichnet main.tsx die Oberfläche (standBereit), damit nie eine Karte ohne Bild
   erscheint und kein Abgleich, Export oder Teilen einen Verweis zu sehen bekommt. Ersetzt wird nur, was ein Verweis
   ist; alles andere bleibt dasselbe Objekt. */
let bereit: Promise<void> = Promise.resolve();
const VERWEIS = '"pixinotes-ablage:';
export const RESERVE_MARKE = 'pixinotes-reserve';
/** Verweise einsetzen oder alte eingebettete Bilder umziehen — das Wie lädt nach (ablageIdb.ts) */
function nachDemLaden(roh: string): void {
  // (… oder liegt im Ersatzspeicher ein neuerer Stand? Die Marke steht immer da — '0' —, damit ablageIdb.ts sie auch
  // in einem vollen Speicher auf '1' setzen kann: gleich lang, braucht keinen Platz)
  let marke: string | null = '0';
  try { marke = localStorage.getItem(RESERVE_MARKE); if (marke === null) localStorage.setItem(RESERVE_MARKE, '0'); } catch { /* voll: dann eben ohne */ }
  if (roh.includes(VERWEIS) || (roh.length > AUSLAGERN_AB && roh.includes('"data:')) || marke === '1') {
    bereit = ablageModul().then((m) => m.nachDemLaden(roh)).catch(() => { /* keine IndexedDB: nichts wird überschrieben */ });
  }
}
/** Auf die Inhalte des gespeicherten Stands warten (main.tsx: vor dem ersten Zeichnen) */
export const standBereit = (): Promise<void> => bereit;


/** Persistierten Stand aus localStorage in den laufenden Store übernehmen —
 *  Mitleser folgen so dem Schreiber; ein Nachfolger übernimmt vor dem ersten
 *  eigenen Write, was der alte Schreiber zuletzt gesichert hat. */
export function adoptPersistedState(): boolean {
  // Der Text wird JETZT gelesen (ein Nachfolger schreibt gleich selbst) — Prüfen, Bilder einsetzen und Übernehmen laden
  // nach (ablageIdb.ts → uebernehmen; M532: hält das Start-Paket klein, Mitlesen ist nicht eilig)
  let raw: string | null = null;
  try { raw = localStorage.getItem('pixinotes-board'); } catch { /* gesperrt */ }
  if (!raw) return false;
  void ablageModul().then((m) => m.uebernehmen(raw!));
  return true;
}

const holdForever = () => new Promise<never>(() => {});
let succession: AbortController | null = null;

/** In die Warteschlange: sobald der aktuelle Schreiber schließt, übernehmen wir. */
function queueSuccession(): void {
  succession?.abort();
  const ctl = new AbortController();
  succession = ctl;
  void navigator.locks
    .request(LOCK_NAME, { signal: ctl.signal }, () => {
      adoptPersistedState(); // der alte Schreiber kann Neueres hinterlassen haben
      setWriterRole('writer');
      useBoard.getState().showToast('Das andere Fenster ist zu – dieses Fenster speichert jetzt wieder selbst.');
      return holdForever();
    })
    .catch(() => {
      // Eigener abort() (Übernahme-Klick) → nichts tun; sonst wurde uns der
      // gerade gewonnene Lock gestohlen → zurück in die Mitleser-Rolle
      if (!ctl.signal.aborted && writerRole === 'writer') demoted();
    });
}

/** Wir haben die Schreibrechte verloren (anderes Fenster hat übernommen). */
function demoted(): void {
  setWriterRole('follower');
  adoptPersistedState();
  useBoard.getState().showToast('Ein anderes Fenster hat die Bearbeitung übernommen – dieses Fenster liest nur noch mit.');
  queueSuccession();
}

/** Schreibrechte JETZT in dieses Fenster holen (bewusste Nutzer-Aktion wie
 *  Import/Zurücksetzen). Wirkt sofort; der Web-Lock-Steal bestätigt asynchron. */
export function claimWriter(): void {
  if (!hasLocks || writerRole === 'writer') return;
  succession?.abort();
  succession = null;
  setWriterRole('writer');
  void navigator.locks
    .request(LOCK_NAME, { steal: true }, () => holdForever())
    .catch(() => demoted());
}

/** „Hier weiterarbeiten"-Banner: letzten Speicherstand übernehmen, dann schreiben. */
export function takeOverWriter(): void {
  if (writerRole === 'writer') return;
  adoptPersistedState();
  claimWriter();
}

function initSingleWriter(): void {
  if (!hasLocks) return; // sehr alte Browser: bisheriges Verhalten (nur Warn-Toast)
  void navigator.locks
    .request(LOCK_NAME, { ifAvailable: true }, (lock) => {
      if (!lock) {
        // Ein anderes Fenster schreibt bereits → mitlesen und Nachfolge anmelden
        setWriterRole('follower');
        queueSuccession();
        return;
      }
      return holdForever();
    })
    .catch(() => {
      if (writerRole === 'writer') demoted(); // Lock gestohlen („Hier weiterarbeiten" woanders)
    });
}
if (typeof window !== 'undefined') initSingleWriter();

// Sync-Audit M81: Nach einem Import (Sync-Ordner/WebDAV/Datei/anderes Fenster)
// darf der Auto-Sync denselben Stand nicht gleich wieder MIT NEUEM Zeitstempel
// hochladen — andere Geräte sähen sonst grundlos „fremden Stand" (Konflikt).
let importedRefs: { boards: unknown; spaces: unknown } = { boards: null, spaces: null };
export const isImportedState = (boards: unknown, spaces: unknown): boolean =>
  importedRefs.boards === boards && importedRefs.spaces === spaces;
export const markImported = (boards: unknown, spaces: unknown): void => {
  importedRefs = { boards, spaces };
};

// Abgeleitete Änderungen (z. B. Auto-Einsammeln des Kanbans beim Start):
// verändern zwar die Boards, sind aber jederzeit aus ihnen rekonstruierbar —
// sie dürfen darum NICHT als „eigene lokale Bearbeitung" zählen, sonst
// blockieren sie das automatische Übernehmen eines neueren Sync-Stands.
// zustand-Subscriber laufen synchron innerhalb von set(), daher reicht ein
// einfacher Tiefenzähler um den Aufruf herum.
let derivedDepth = 0;
export function runDerived<T>(fn: () => T): T {
  derivedDepth += 1;
  try { return fn(); } finally { derivedDepth -= 1; }
}
export const inDerived = (): boolean => derivedDepth > 0;

/** Eigenen Stand erneut nach localStorage durchsetzen — der Schreiber wehrt
 *  damit fremde Writes ab (z. B. ein alter Tab mit einer App-Version ohne
 *  Single-Writer-Schutz), statt Daten zu verlieren. */
export function reassertPersist(): void {
  // M525: Der Stand selbst ist unverändert — der Vergleich „nichts geändert" darf dieses Schreiben nicht schlucken
  erzwingen = true;
  try { useBoard.setState({}); } finally { erzwingen = false; } // no-op-Merge: stößt den persist-Layer neu an
  flushPersist();
}

/** Was vom Board-Stand auf die Platte geht (persist → partialize) */
export const speicherAuswahl = (s: BoardState) => ({
  boards: s.boards.map((b) => persistHaken.board(b)),
  spaces: s.spaces,
  activeId: s.activeId,
  view: s.view,
  ai: s.ai,
  brain: s.brain,
  brainOffSpaces: s.brainOffSpaces,
  rejectedLinks: s.rejectedLinks,
  templates: s.templates,
  ui: s.ui,
  ziehBewegung: s.ziehBewegung,
  konfetti: s.konfetti,
  pfeilSchatten: s.pfeilSchatten,
  stiftZeichnet: s.stiftZeichnet,
  cardFocus: s.cardFocus,
  fokusEinKlick: s.fokusEinKlick,
  fokusVollbild: s.fokusVollbild,
  navLinks: s.navLinks,
  navBreite: s.navBreite,
  spalteBreite: s.spalteBreite,
  milchglas: s.milchglas,
  syncDateienMb: s.syncDateienMb,
  anzeige: s.anzeige,
  lesbareSchrift: s.lesbareSchrift,
  hoherKontrast: s.hoherKontrast,
  wheelZoom: s.wheelZoom,
  handschriftOnline: s.handschriftOnline,
  handschriftAuto: s.handschriftAuto,
  fingerGesten: s.fingerGesten,
  handschriftKi: s.handschriftKi,
  showArchived: s.showArchived,
  gridSnap: s.gridSnap,
  fangLinien: s.fangLinien,
  overviewMode: s.overviewMode,
  graphLayers: s.graphLayers,
});

/** Ältere Speicherstände auf den heutigen bringen (persist → migrate) */
export const speicherMigration = (persisted: unknown, version: number) => {
  const p = persisted as Record<string, unknown>;
  // v3 (M127): bestehende freie Striche EINMALIG nach derselben Regel wie
  // beim Zeichnen ankern (größte Schnittmenge ≥ 50 % der Strich-Fläche)
  const anchorLegacyStrokes = <T,>(out: T): T => {
    if (version >= 3 || !out || !Array.isArray((out as Record<string, unknown>).boards)) return out;
    const boards = (out as unknown as { boards: BoardDoc[] }).boards.map((b) =>
      b.drawings?.length ? { ...b, drawings: b.drawings.map((s) => anchorStroke(s, b.nodes ?? [])) } : b);
    return { ...out, boards };
  };
  // v4 (M160): App-Karten hatten ein dragHandle auf die Kopfzeile — die
  // war aber fast komplett vom Titel-Eingabefeld (nodrag) bedeckt und
  // der Universal-Griff lag AUSSERHALB des Handles: die Karte war
  // praktisch unverschiebbar. Jetzt ziehen sie wie alle Karten (die
  // App-Fläche schluckt ihre Eingaben ohnehin selbst) — gespeicherte
  // dragHandle-Einträge werden hier einmalig entfernt.
  const stripHappHandle = <T,>(out: T): T => {
    if (!out || !Array.isArray((out as Record<string, unknown>).boards)) return out;
    const boards = (out as unknown as { boards: BoardDoc[] }).boards.map((b) => ({
      ...b,
      nodes: (b.nodes ?? []).map((n) =>
        n.type === 'htmlapp' && n.dragHandle ? { ...n, dragHandle: undefined } : n),
    }));
    return { ...out, boards };
  };
  // v5 (M171): Zeiterfassung nur noch Arbeit & Pause — alte Fahrzeit-/
  // Dienstgeschäft-Abschnitte werden zu Arbeit (sie zählten ohnehin als
  // Arbeitszeit, die Summen bleiben also identisch); die frühere Art
  // wandert als Vermerk in die Bemerkung, damit nichts verloren geht.
  const mergeTimeKinds = <T,>(out: T): T => {
    if (!out || !Array.isArray((out as Record<string, unknown>).boards)) return out;
    const LABEL: Record<string, string> = { fahrt: 'Fahrzeit', dienst: 'Dienstgeschäft' };
    const boards = (out as unknown as { boards: BoardDoc[] }).boards.map((b) => ({
      ...b,
      nodes: (b.nodes ?? []).map((n) => {
        if (n.type !== 'time') return n;
        const segs = (n.data as { segs?: TimeSeg[] }).segs ?? [];
        if (!segs.some((s) => LABEL[s.kind as string])) return n;
        return {
          ...n,
          data: {
            ...n.data,
            segs: segs.map((s) => (LABEL[s.kind as string]
              ? { ...s, kind: 'arbeit' as const, note: s.note ? `${LABEL[s.kind as string]} · ${s.note}` : LABEL[s.kind as string] }
              : s)),
          },
        } as typeof n;
      }),
    }));
    return { ...out, boards };
  };
  // v0: {nodes, edges} — Einzelboard
  if (version === 0 && p && 'nodes' in p) {
    const boards = [
      { id: 'main', name: 'Mein Schreibtisch', nodes: p.nodes as Node[], edges: p.edges as Edge[] },
    ];
    return anchorLegacyStrokes({ boards, spaces: defaultHierarchy(['main']), activeId: 'main', view: 'board' });
  }
  // v1: {boards, activeId} — flache Boards ohne Hierarchie
  if (version === 1 && p && 'boards' in p) {
    const boards = (p.boards as BoardDoc[]) ?? [];
    if (boards.length === 0) {
      return { boards: [{ id: 'main', name: 'Mein Schreibtisch', nodes: [], edges: [] }], spaces: defaultHierarchy(['main']), activeId: 'main', view: 'board' };
    }
    return anchorLegacyStrokes({
      boards,
      spaces: defaultHierarchy(boards.map((b) => b.id)),
      activeId: (p.activeId as string) ?? boards[0]?.id,
      view: 'board',
    });
  }
  // v2: defensiv validieren (leeres boards-Array oder tote activeId reparieren)
  if (p && 'boards' in p) {
    const boards = (p.boards as BoardDoc[]) ?? [];
    if (boards.length === 0) {
      return { boards: [{ id: 'main', name: 'Mein Schreibtisch', nodes: [], edges: [] }], spaces: defaultHierarchy(['main']), activeId: 'main', view: 'board' };
    }
    if (!boards.some((b) => b.id === (p.activeId as string))) {
      return mergeTimeKinds(stripHappHandle(anchorLegacyStrokes({ ...p, activeId: boards[0].id })));
    }
  }
  return mergeTimeKinds(stripHappHandle(anchorLegacyStrokes(p)));
};
