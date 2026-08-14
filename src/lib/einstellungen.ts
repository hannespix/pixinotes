import { useBoard } from '../store';

/**
 * M247: Vorlieben werden IMMER gespeichert — auch im Mitlese-Fenster.
 *
 * Der Befund war eindeutig und ärgerlich: „Wenn man Design-Settings verändert,
 * werden diese nicht gespeichert! Bei jedem Reload sind Einstellungen
 * zurückgesetzt!“
 *
 * Die Ursache liegt in M81. Damit zwei offene Fenster sich nicht gegenseitig
 * die Karten überschreiben, darf nur EINES schreiben; jedes weitere wird zum
 * Mitleser und verwirft seine Schreibversuche stillschweigend. Das ist für
 * Board-Daten genau richtig — dort kostet ein verlorenes Rennen echte Arbeit.
 *
 * Für Vorlieben ist es falsch. Eine Akzentfarbe, eine Schriftgröße, ein
 * Hell/Dunkel-Wechsel kann nichts zerstören: Es gibt keinen Datenverlust,
 * gegen den man sich schützen müsste, und „zuletzt gewinnt“ ist hier die
 * richtige und erwartete Regel. Wer das zweite Fenster oben hat und dort die
 * Schrift größer stellt, will genau das — und zwar dauerhaft.
 *
 * Also ein zweiter, winziger Speicher-Kanal, der die Rollenprüfung nicht
 * kennt. Er trägt nur Vorlieben, nie Inhalte: Selbst wenn zwei Fenster
 * gleichzeitig schreiben, steht am Ende eine gültige Einstellung da.
 */

const SCHLUESSEL = 'pixinotes-einstellungen';

/**
 * Was zählt als Vorliebe?
 *
 * Faustregel für die Aufnahme in diese Liste: Der Wert beschreibt, WIE die App
 * aussieht oder sich bedienen lässt — nicht, WAS darin steht. Ein verlorener
 * Wert wäre ärgerlich, aber nie ein Datenverlust.
 */
const FELDER = [
  'ui',              // Hell/Dunkel + Akzentfarbe
  'anzeige',         // Anzeigegröße (A− / A+)
  'lesbareSchrift',
  'hoherKontrast',
  'milchglas',
  'syncDateienMb',  // wie viele MB Dateien der Sync-Stand mitnimmt
  'navLinks',        // Navigation links statt oben
  'leisteVersatz',   // wohin die Bearbeiten-Leiste geschoben wurde
  'navBreite',       // Breite des linken Slideouts
  'sidebar',         // offen? welche Ansicht? wie breit?
  'clickZoom',
  'wheelZoom',
  'cardFocus',
  'fokusEinKlick',
  'fokusVollbild',
  'physicsEnabled', 'stiftZeichnet',
  'gridSnap',
  'showArchived',
  'overviewMode',
  'graphLayers',
] as const;

type Feld = (typeof FELDER)[number];
type Vorlieben = Partial<Record<Feld, unknown>>;

function lies(): Vorlieben | null {
  try {
    const roh = localStorage.getItem(SCHLUESSEL);
    if (!roh) return null;
    const daten = JSON.parse(roh) as Vorlieben;
    return daten && typeof daten === 'object' ? daten : null;
  } catch {
    return null;   // beschädigt oder kein Speicher — dann gelten die Standards
  }
}

function schreibe(v: Vorlieben): void {
  try {
    localStorage.setItem(SCHLUESSEL, JSON.stringify(v));
  } catch {
    /* Speicher voll oder gesperrt: Vorlieben sind es nicht wert, dass die App
       deswegen stehen bleibt. Die Karten haben ihre eigene Quota-Meldung. */
  }
}

const auszug = (s: Record<string, unknown>): Vorlieben => {
  const v: Vorlieben = {};
  for (const f of FELDER) if (s[f] !== undefined) v[f] = s[f];
  return v;
};

/**
 * Beim Start anwenden — VOR dem ersten Bild.
 *
 * Reihenfolge ist wichtig: zustand/persist hat den Hauptstand zu diesem
 * Zeitpunkt schon synchron aus localStorage geholt. Die Vorlieben werden
 * darübergelegt, weil sie der jüngere und verlässlichere Stand sind: Sie
 * wurden auch dann geschrieben, wenn das Fenster nur mitliest.
 */
export function initEinstellungen(): () => void {
  const gespeichert = lies();
  if (gespeichert) {
    const patch: Record<string, unknown> = {};
    for (const f of FELDER) if (gespeichert[f] !== undefined) patch[f] = gespeichert[f];
    if (Object.keys(patch).length > 0) useBoard.setState(patch);
  } else {
    // Erster Start mit dieser Fassung: den vorhandenen Stand übernehmen,
    // damit bereits eingestellte Vorlieben nicht beim nächsten Mal fehlen.
    schreibe(auszug(useBoard.getState() as unknown as Record<string, unknown>));
  }

  let letzte = JSON.stringify(auszug(useBoard.getState() as unknown as Record<string, unknown>));
  return useBoard.subscribe((s) => {
    const jetzt = auszug(s as unknown as Record<string, unknown>);
    const text = JSON.stringify(jetzt);
    if (text === letzte) return;   // nur bei echter Änderung schreiben
    letzte = text;
    schreibe(jetzt);
  });
}
