// M535: Welche eigenen Tools (HTML-Apps) laufen gerade — und „Alle Tools anhalten".
//
// Gestartete Tools laufen weiter (Zeitgeber, Animationen), auch wenn niemand hinsieht (M525). Die Tool-Karte meldet
// sich hier an, solange sie läuft; das Kontextmenü des Boards fragt die Zahl ab und hält auf Wunsch alle an. Angehalten
// wird wie mit dem Knopf an der Karte: der Rahmen verschwindet, was das Tool selbst gespeichert hat, bleibt (es liegt
// längst in der Ablage, M158) — gestartet wird wieder per Klick. Bewusst winzig: liegt im Start-Paket.
const laufen = new Set<string>();
export const TOOLS_ANHALTEN = 'pixinotes:tools-anhalten';

export function toolLaeuft(id: string, an: boolean): void { if (an) laufen.add(id); else laufen.delete(id); }
export const laufendeTools = (): number => laufen.size;
export function alleToolsAnhalten(): void { window.dispatchEvent(new Event(TOOLS_ANHALTEN)); }

/** Wie lange ein laufendes Tool außerhalb des Bildes sein darf, bevor es von selbst anhält (Prüfreihen kürzen es) */
export const ausserSichtMs = (): number => {
  const w = (globalThis as { __pnToolAnhaltenMs?: number }).__pnToolAnhaltenMs;
  return typeof w === 'number' && w > 0 ? w : 30_000;
};
