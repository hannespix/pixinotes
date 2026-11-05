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

async function imBrowser(striche: Punkt[][], sprache: string): Promise<string> {
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
  return (vorhersage[0]?.text ?? '').trim();
}

async function online(striche: Punkt[][], w: number, h: number, sprache: string): Promise<string> {
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
  return (j[1]?.[0]?.[1]?.[0] ?? '').trim();
}

/**
 * Striche (Flow-Koordinaten, absolut) zu Text. Wirft mit Klartext, wenn kein
 * Weg offen ist — der Hinweis nennt den Schalter.
 */
export async function handschriftErkennen(strichePunkte: Punkt[][], sprache = 'de'): Promise<string> {
  const { striche, w, h } = normieren(strichePunkte.filter((s) => s.length > 1));
  if (striche.length === 0) throw new Error('Nichts geschrieben — erst mit dem Stift schreiben, dann „Text".');
  const weg = handschriftWeg();
  if (weg === 'browser') return imBrowser(striche, sprache);
  if (weg === 'online') return online(striche, w, h, sprache);
  throw new Error('Dein Browser erkennt Handschrift nicht selbst. Unter ⚙ → Dienste → Handschrift lässt sich die Online-Erkennung einschalten.');
}
