// Handschrift → Text (M320).
//
// Zwei Wege, in dieser Reihenfolge:
//  1. Der Browser selbst — die Handwriting Recognition API (Chrome auf
//     ChromeOS, Windows und macOS). Nichts verlässt das Gerät.
//  2. Online über Googles Handschrift-Dienst (Input Tools) — nur, wenn der
//     Nutzer das unter ⚙ → Dienste ausdrücklich eingeschaltet hat: Die
//     Striche gehen dann außer Haus. Kein Konto, kein Schlüssel.
// Am iPad braucht es beides nicht: Scribble schreibt mit dem Pencil direkt in
// jedes Textfeld, auch in die Notizen hier.
import { useBoard } from '../store';
import { aiReady, askAi } from './ai';

export type Punkt = [number, number];

interface HwStroke { addPoint(p: { x: number; y: number; t: number }): void }
interface HwDrawing { addStroke(s: HwStroke): void; getPrediction(): Promise<Array<{ text: string }>> }
interface HwRecognizer { startDrawing(h: { recognitionType?: string; inputType?: string; alternatives?: number }): HwDrawing; finish?(): void }
type NavMitHw = Navigator & { createHandwritingRecognizer?: (c: { languages: string[] }) => Promise<HwRecognizer> };
type WinMitHw = Window & { HandwritingStroke?: new () => HwStroke };

/** Kann der Browser Handschrift selbst erkennen? */
export const browserErkenntHandschrift = (): boolean =>
  typeof navigator !== 'undefined' && typeof (navigator as NavMitHw).createHandwritingRecognizer === 'function';

export type HandschriftWeg = 'browser' | 'online' | 'keine';
export function handschriftWeg(): HandschriftWeg {
  if (browserErkenntHandschrift()) return 'browser';
  if (useBoard.getState().handschriftOnline) return 'online';
  return 'keine';
}

/** Striche auf den Ursprung schieben — Erkenner mögen kleine, positive Zahlen */
function normieren(striche: Punkt[][]): { striche: Punkt[][]; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of striche) for (const [x, y] of s) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  if (!Number.isFinite(minX)) return { striche: [], w: 0, h: 0 };
  const rand = 10;
  return {
    striche: striche.map((s) => s.map(([x, y]) => [x - minX + rand, y - minY + rand] as Punkt)),
    w: Math.ceil(maxX - minX + 2 * rand),
    h: Math.ceil(maxY - minY + 2 * rand),
  };
}

async function imBrowser(striche: Punkt[][], sprache: string): Promise<string[]> {
  const nav = navigator as NavMitHw;
  const win = window as unknown as WinMitHw;
  const rec = await nav.createHandwritingRecognizer!({ languages: [sprache] });
  const drawing = rec.startDrawing({ recognitionType: 'text', inputType: 'pen', alternatives: 3 });
  let t = 0;
  for (const s of striche) {
    const st = new win.HandwritingStroke!();
    for (const [x, y] of s) { t += 16; st.addPoint({ x, y, t }); }
    t += 120; // Pause zwischen den Strichen
    drawing.addStroke(st);
  }
  const vorhersage = await drawing.getPrediction();
  try { rec.finish?.(); } catch { /* egal */ }
  return vorhersage.map((v) => (v.text ?? '').trim()).filter(Boolean);
}

async function online(striche: Punkt[][], w: number, h: number, sprache: string): Promise<string[]> {
  let t = 0;
  const ink = striche.map((s) => {
    const xs: number[] = [], ys: number[] = [], ts: number[] = [];
    for (const [x, y] of s) { xs.push(Math.round(x)); ys.push(Math.round(y)); ts.push(t += 16); }
    t += 120;
    return [xs, ys, ts];
  });
  const res = await fetch(`https://inputtools.google.com/request?itc=${sprache}-t-i0-handwrit&app=pixinotes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ options: 'enable_pre_space', requests: [{ writing_guide: { writing_area_width: w, writing_area_height: h }, ink, language: sprache }] }),
  });
  if (!res.ok) throw new Error(`Online-Erkennung nicht erreichbar (HTTP ${res.status}).`);
  const j = (await res.json()) as [string, Array<[string, string[]]>?];
  if (j[0] !== 'SUCCESS') throw new Error('Online-Erkennung hat nichts erkannt.');
  return (j[1]?.[0]?.[1] ?? []).map((t) => t.trim()).filter(Boolean);
}

export interface Erkannt { text: string; alternativen: string[] }

/** Wie handschriftErkennen, aber mit den weiteren Lesarten des Erkenners (für die KI-Korrektur) */
export async function handschriftKandidaten(strichePunkte: Punkt[][], sprache = 'de'): Promise<Erkannt> {
  const { striche, w, h } = normieren(strichePunkte.filter((s) => s.length > 1));
  if (striche.length === 0) throw new Error('Nichts geschrieben — erst mit dem Stift schreiben, dann „Text".');
  const weg = handschriftWeg();
  let kandidaten: string[];
  if (weg === 'browser') kandidaten = await imBrowser(striche, sprache);
  else if (weg === 'online') kandidaten = await online(striche, w, h, sprache);
  else throw new Error('Dein Browser erkennt Handschrift nicht selbst. Unter ⚙ → Dienste → Handschrift lässt sich die Online-Erkennung einschalten.');
  return { text: kandidaten[0] ?? '', alternativen: kandidaten.slice(1, 5) };
}

/**
 * M324: Erkannten Text ohne KI aufräumen — Leerraum, Satzanfang groß,
 * Leerzeichen vor Satzzeichen weg. Mehr nicht: Was der Erkenner liefert,
 * bleibt der Text des Nutzers.
 */
export function textAufraeumen(roh: string): string {
  return roh
    .split(/\n+/)
    .map((z) => z.replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim())
    .filter(Boolean)
    .map((z) => (/^[a-zäöü]/.test(z) ? z[0].toUpperCase() + z.slice(1) : z))
    .join('\n');
}

export interface SchriftKontext {
  /** Name des Boards */
  board?: string;
  /** Titel und Text der Zielnotiz (gekürzt) */
  notiz?: string;
  /** Namen und Begriffe aus den anderen Karten des Boards */
  begriffe?: string[];
}

/**
 * M324: KI-Nachkorrektur mit Kontext — nur, wenn eine KI eingerichtet ist.
 * Korrigiert offensichtliche Lesefehler (ähnliche Buchstaben, Umlaute,
 * Groß-/Kleinschreibung, Zahlen), kennt Namen und Fachwörter aus Notiz und
 * Board. Ergänzt nichts, lässt nichts weg. Bei Zweifel, Zeitüberschreitung
 * oder einer Antwort, die nicht nach Korrektur aussieht: der Rohtext.
 */
export async function kiKorrektur(roh: string, alternativen: string[], kontext: SchriftKontext, zeitMs = 8000): Promise<string> {
  if (!roh.trim() || !aiReady(useBoard.getState().ai)) return roh;
  const prompt = [
    'Du korrigierst die Ausgabe einer Handschrift-Erkennung (Deutsch, gelegentlich Englisch).',
    'Gib NUR den korrigierten Text zurück — ohne Anführungszeichen, ohne Erklärung, ohne Einleitung.',
    'Regeln: Nur offensichtliche Lesefehler beheben (ähnliche Buchstaben wie rn/m, l/1, O/0; fehlende Umlaute und ß; Groß-/Kleinschreibung am Satzanfang; Zahlen, Uhrzeiten und Datumsformate wie 12.11. oder 14:30).',
    'Nichts hinzufügen, nichts weglassen, nichts umformulieren, Zeilenumbrüche genau beibehalten. Ist der Text schon richtig, gib ihn unverändert zurück.',
    'Namen, Orte und Fachwörter aus dem Kontext haben Vorrang vor ähnlich aussehenden Wörtern.',
    kontext.board ? `Board: „${kontext.board}"` : '',
    kontext.notiz ? `Zielnotiz (Auszug):\n${kontext.notiz}` : '',
    kontext.begriffe?.length ? `Begriffe und Namen vom Board: ${kontext.begriffe.join(' · ')}` : '',
    alternativen.length ? `Alternative Lesarten des Erkenners: ${alternativen.map((a) => `„${a}"`).join(', ')}` : '',
    `Erkannter Text:\n${roh}`,
  ].filter(Boolean).join('\n\n');
  try {
    const antwort = await Promise.race([
      askAi(prompt),
      new Promise<string>((_, nein) => { window.setTimeout(() => nein(new Error('Zeit')), zeitMs); }),
    ]);
    const t = antwort.trim().replace(/^["„»]+|["“«]+$/g, '').trim();
    const zeilenRoh = roh.split('\n').length, zeilenNeu = t.split('\n').length;
    // Plausibel? Ähnliche Länge, gleiche Zeilenzahl (±1), keine Erklärung
    if (!t || t.length > roh.length * 2 + 20 || t.length < roh.length * 0.5 - 10) return roh;
    if (Math.abs(zeilenNeu - zeilenRoh) > 1) return roh;
    if (/^(hier|der korrigierte|korrigiert|natürlich|gerne)/i.test(t)) return roh;
    return t;
  } catch {
    return roh;
  }
}

/**
 * Striche (Flow-Koordinaten, absolut) zu Text. Wirft mit Klartext, wenn kein
 * Weg offen ist — der Hinweis nennt den Schalter.
 */
export async function handschriftErkennen(strichePunkte: Punkt[][], sprache = 'de'): Promise<string> {
  const { striche, w, h } = normieren(strichePunkte.filter((s) => s.length > 1));
  if (striche.length === 0) throw new Error('Nichts geschrieben — erst mit dem Stift schreiben, dann „Text".');
  const weg = handschriftWeg();
  if (weg === 'browser') return (await imBrowser(striche, sprache))[0] ?? '';
  if (weg === 'online') return (await online(striche, w, h, sprache))[0] ?? '';
  throw new Error('Dein Browser erkennt Handschrift nicht selbst. Unter ⚙ → Dienste → Handschrift lässt sich die Online-Erkennung einschalten.');
}
