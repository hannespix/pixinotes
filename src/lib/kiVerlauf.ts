// M410: Was auf einem Board schon von der KI verlangt wurde – ihr Gedächtnis.
//
// Jede Anweisung war bisher ein Neuanfang: „Lege eine Kostentabelle an" und danach „füge noch die Miete hinzu"
// ging nicht, weil das Modell von der ersten Anweisung nichts mehr wusste. Hier stehen je Board die letzten
// Anweisungen mit Ergebnis und den Karten, die dabei entstanden oder geändert wurden. Sie gehen in den nächsten
// Auftrag mit – „es", „die Tabelle", „noch" haben damit einen Bezug – und die Pfeil-nach-oben-Taste im
// Eingabefeld holt sie zurück. Liegt nur auf diesem Gerät (localStorage), reist mit keinem Board mit.
const KEY = 'pixinotes-ki-verlauf';
const JE_BOARD = 12;
const BOARDS = 60;

export interface KiEintrag {
  t: number;
  wunsch: string;
  ergebnis: string;
  /** Karten, die dabei entstanden oder geändert wurden */
  karten: string[];
}

type Alle = Record<string, KiEintrag[]>;
function lesen(): Alle {
  try {
    const roh = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown;
    return roh && typeof roh === 'object' && !Array.isArray(roh) ? roh as Alle : {};
  } catch { return {}; }
}

/** Die letzten Anweisungen auf diesem Board, älteste zuerst */
export function kiVerlauf(boardId: string): KiEintrag[] {
  const liste = lesen()[boardId];
  return Array.isArray(liste) ? liste.filter((e) => e && typeof e.wunsch === 'string') : [];
}

export function kiMerken(boardId: string, e: KiEintrag): void {
  try {
    const alle = lesen();
    const liste = [...(Array.isArray(alle[boardId]) ? alle[boardId] : []), { ...e, wunsch: e.wunsch.slice(0, 600), ergebnis: e.ergebnis.slice(0, 400), karten: e.karten.slice(0, 30) }].slice(-JE_BOARD);
    delete alle[boardId];
    alle[boardId] = liste;                                   // zuletzt benutztes Board ans Ende
    const schluessel = Object.keys(alle);
    for (const k of schluessel.slice(0, Math.max(0, schluessel.length - BOARDS))) delete alle[k];
    localStorage.setItem(KEY, JSON.stringify(alle));
  } catch { /* voller oder gesperrter Speicher: dann eben ohne Gedächtnis */ }
}

/** Frühere Anweisungen dieses Boards für das Eingabefeld – neueste zuerst, jede einmal */
export function kiFruehere(boardId: string): string[] {
  return [...new Set(kiVerlauf(boardId).map((e) => e.wunsch).reverse())];
}

/**
 * Pfeil hoch/runter im Eingabefeld: durch die früheren Anweisungen blättern. Nur wenn das Feld leer ist oder
 * gerade eine frühere Anweisung zeigt – wer schon tippt, behält seinen Text. `null`: nichts tun.
 */
export function kiBlaettern(boardId: string, aktuell: string, hoch: boolean): string | null {
  const liste = kiFruehere(boardId);
  if (liste.length === 0) return null;
  const i = liste.indexOf(aktuell);
  if (aktuell !== '' && i < 0) return null;
  if (hoch) return i + 1 < liste.length ? liste[i + 1] : null;
  return i > 0 ? liste[i - 1] : i === 0 ? '' : null;
}

/** Was man ein einzelnes Modul fragen kann – steht als Beispiel im Eingabefeld der Auswahl */
export function kiBeispiel(typ: string | undefined): string {
  switch (typ) {
    case 'sheet': return 'z. B. „Summenzeile ergänzen“ oder „Was fällt an den Zahlen auf?“';
    case 'kanban': return 'z. B. „Was ist überfällig?“ oder „Nach Dringlichkeit ordnen“';
    case 'gantt': return 'z. B. „Alles um eine Woche verschieben“';
    case 'week': return 'z. B. „Wann ist noch Zeit frei?“';
    case 'minutes': return 'z. B. „Welche Punkte sind noch offen?“';
    case 'time': return 'z. B. „Stunden je Woche zusammenrechnen“';
    case 'note': return 'z. B. „Kürzer fassen“ oder „Als Checkliste“';
    case 'mermaid': return 'z. B. „Schritt Prüfung ergänzen“';
    case 'bubbles': return 'z. B. „Zehn weitere Ideen ergänzen“';
    case 'file': return 'z. B. „Die wichtigsten Punkte als Notiz“';
    case 'email': return 'z. B. „Antwort entwerfen“';
    default: return 'Anweisung für die Auswahl …';
  }
}
