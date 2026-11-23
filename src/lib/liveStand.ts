// M459: Wer ist live dabei — der Zustand des Live-Kanals, ohne den Abgleich.
//
// Mauszeiger, Vorführen, Gruppenraum, Spiegel, Punkte und die Live-Leiste fragen beim Start nur: Bin ich in einem
// Kanal? Wer ist noch da? Wer hält welche Karte? Der Abgleich selbst (lib/gastSync.ts, mit lib/kontoSync.ts zusammen
// über 100 KB) lädt erst, wenn ein Konto oder ein Gast-Zugang da ist (lib/syncStart.ts). Bis dahin sind die Karten
// hier leer — genau das, was der Abgleich ohne Kanal auch meldete. gastSync füllt sie und reicht alles weiter.
import { getAuthor } from './autor';
import { useBoard } from '../store';
import { loadKonto } from './kontoSitzung';
import type { LiveKanal, Teilnehmer } from './liveKanal';

const ICH_KEY = 'pixinotes-gast-ich';
export const GAST_NAME = 'Per Link';
export const TEILNEHMER_EREIGNIS = 'pixinotes:teilnehmer';
export const LIVE_NACHRICHT = 'pixinotes:live-nachricht';

/** Wer bin ich im Kanal? Kennung je Gerät, Farbe aus der Kennung, Name aus den Kommentaren */
export const FARBEN = ['#2563eb', '#db2777', '#059669', '#d97706', '#7c3aed', '#0891b2', '#dc2626', '#4d7c0f'];
export function ich(): Teilnehmer {
  let id = '';
  try { id = localStorage.getItem(ICH_KEY) ?? ''; if (!id) { id = Math.random().toString(36).slice(2, 12); localStorage.setItem(ICH_KEY, id); } } catch { id = Math.random().toString(36).slice(2, 12); }
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return { id, name: getAuthor().trim() || loadKonto()?.name?.split('@')[0] || 'Gast', farbe: FARBEN[h % FARBEN.length] };
}

/**
 * M385: Zwei Anwesende nie in derselben Farbe. Jeder bringt seine Farbe mit (aus seiner Kennung gerechnet, acht
 * stehen zur Wahl) — bei zwei Leuten trifft es in jedem achten Fall dieselbe, und dann sind zwei Mauszeiger,
 * zwei Rahmen, zwei Kürzel nicht mehr auseinanderzuhalten. Hier wird verteilt: der Reihe der Kennungen nach
 * behält jeder seine Farbe, solange sie frei ist, sonst bekommt er die nächste freie. Alle Geräte rechnen aus
 * derselben Liste dasselbe; gemeldet wird weiter die mitgebrachte Farbe. Ab neun Leuten wiederholen sich Farben.
 */
export function farbenVerteilen(liste: Teilnehmer[]): Teilnehmer[] {
  if (liste.length < 2) return liste;
  const reihe = [...liste].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const belegt = new Set<string>();
  const neu = new Map<string, string>();
  for (const t of reihe) {
    if (neu.has(t.id)) continue;      // derselbe Mensch in zwei Fenstern: eine Farbe
    let f = t.farbe;
    if (belegt.has(f) && belegt.size < FARBEN.length) {
      let i = Math.max(0, FARBEN.indexOf(f));
      while (belegt.has(FARBEN[i % FARBEN.length])) i += 1;
      f = FARBEN[i % FARBEN.length];
    }
    belegt.add(f); neu.set(t.id, f);
  }
  return liste.map((t) => (neu.get(t.id) === t.farbe ? t : { ...t, farbe: neu.get(t.id) ?? t.farbe }));
}

// ---------- Kanäle und Anwesende (gefüllt von lib/gastSync.ts) ----------
export const kanaele = new Map<string, LiveKanal>();                 // boardId → Kanal
export const anwesend = new Map<string, Teilnehmer[]>();             // boardId → wer ist dabei

/** Ich, so wie mich die anderen in diesem Board sehen (mit der verteilten Farbe) */
export function ichIn(boardId: string): Teilnehmer {
  const t = ich();
  const f = anwesend.get(boardId)?.find((x) => x.id === t.id)?.farbe;
  return f && f !== t.farbe ? { ...t, farbe: f } : t;
}
/** M365: Kennung, unter der dieses Gerät Karten anlegt — Gäste per Link „g:…", Konten „k:…" (der Server prüft das Präfix) */
export const meineKennung = (alsGast: boolean): string => (alsGast ? `g:${ich().id}` : `k:${loadKonto()?.userId ?? ich().id}`);

export const teilnehmerVon = (boardId: string): Teilnehmer[] => anwesend.get(boardId) ?? [];
/** Auf diesem Board läuft ein Live-Kanal (geteiltes Board: Besitzer, Gast mit Konto oder Gast per Link) */
export const liveAuf = (boardId: string): boolean => kanaele.has(boardId);
/** Steht die Live-Verbindung gerade? (sonst gleicht der regelmäßige Blick ab — nur ohne „wer ist dabei") */
export const liveVerbunden = (boardId: string): boolean => !!kanaele.get(boardId)?.verbunden;
/** Nachricht an alle anderen auf diesem Board (für „Folgt mir") */
export const liveSenden = (boardId: string, ereignis: string, inhalt?: unknown): void => kanaele.get(boardId)?.senden(ereignis, inhalt);

/** Der eigene Name hat sich geändert (Namensfeld beim Einwählen, Kommentar-Name) — allen Kanälen sagen */
export function nameGeaendert(): void {
  const t = ich();
  for (const k of kanaele.values()) k.ich(t);
}

// ---------- Karten-Sperren (berechnet von lib/gastSync.ts) ----------
/** Wer hält welche Karte (ohne mich)? → an den Speicher (Schutz) und an die Anzeige */
export const SPERREN_EREIGNIS = 'pixinotes:karten-sperren';
export const sperren = new Map<string, Map<string, Teilnehmer>>();          // boardId → Karte → Halter
export const sperrenVon = (boardId: string): Map<string, Teilnehmer> => sperren.get(boardId) ?? new Map();

// ---------- Einladungslinks der eigenen Boards (gefüllt von lib/gastSync.ts) ----------
export interface EigenerLink { token: string; board_id: string; ohne_konto?: boolean }
let eigeneLinkListe: EigenerLink[] = [];
export const eigeneLinks = (): EigenerLink[] => eigeneLinkListe;
export const eigeneLinksSetzen = (l: EigenerLink[]): void => { eigeneLinkListe = l; };
/** Der Einladungslink erschien, änderte sich oder fiel weg (M385: der QR-Knopf richtet sich danach) */
export const EINLADUNG_EREIGNIS = 'pixinotes:einladung';
/**
 * M385: Der Einladungslink eines Boards, soweit dieses Gerät ihn kennt — als Besitzer der eigene Link, als Gast
 * per Link der, über den man selbst hereinkam.
 */
export function einladungVon(boardId: string): { token: string; ohneKonto: boolean } | null {
  const b = useBoard.getState().boards.find((x) => x.id === boardId);
  if (!b) return null;
  if (b.gastLink) return { token: b.gastLink, ohneKonto: true };
  if (b.geteiltVon) return null;
  const l = eigeneLinkListe.find((x) => x.board_id === boardId);
  return l ? { token: l.token, ohneKonto: !!l.ohne_konto } : null;
}
