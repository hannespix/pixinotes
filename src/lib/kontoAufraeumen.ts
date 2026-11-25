// M529: „Speicher aufräumen" — Dateien im Dateispeicher des PixiNotes-Kontos, auf die nichts mehr verweist.
//
// Im Dateispeicher liegen je Karte die Anhänge und Tool-Quelltexte (`datei-<Kennung>`) und seit M529 die
// Speicherstände der Tools (`zustand-<Kennung>`). Verschwindet eine Karte, löscht der nächste Schreibvorgang ihre
// Datei — scheitert das (Netz), bleibt eine Leiche. Mehr Objekte als Karten entstehen außerdem durch den Import einer
// Board-Datei (jede Karte bekommt eine neue Kennung) und durch Kopien (M524, „Was wo liegt").
//
// Hier wird nur ANGEZEIGT, was nichts mehr nennt (Anzahl, Größe); gelöscht wird erst, wenn der Nutzer bestätigt.
// Als „genannt" gilt jede Kennung einer Karte auf diesem Gerät (eigene Boards, Vorlagen) und in den Board-Zeilen des
// Kontos sowie jede Datei, die die Umgebung des Kontos nennt. Was in den letzten 24 Stunden geschrieben wurde, bleibt
// in jedem Fall — ein anderes Gerät kann es gerade erst hochgeladen haben und die Board-Zeile noch nicht. Namen, die
// diese Fassung nicht kennt, bleiben ebenfalls (sie gehören vielleicht einer neueren).
import { useBoard } from '../store';
import { kontoObjekte, kontoObjekteLoeschen, kontoVerweise } from './kontoSync';

export const SCHONFRIST_MS = 24 * 3600_000;
const BEKANNT = /^(datei|zustand)-(.+)$/;

export interface Aufraeumen {
  /** verwaiste Objekte, älter als die Schonfrist */
  leichen: Array<{ name: string; groesse: number; am: string }>;
  groesse: number;
  /** verwaist, aber jünger als 24 h — bleiben */
  geschont: number;
  /** alle Objekte im eigenen Ordner */
  gesamt: number;
}

/** Nachsehen, was verwaist ist. `null`: Konto oder Dateispeicher nicht vollständig lesbar — dann nichts anbieten */
export async function speicherPruefen(jetzt = Date.now()): Promise<Aufraeumen | null> {
  const [objekte, verweise] = await Promise.all([kontoObjekte(), kontoVerweise()]);
  if (!objekte || !verweise) return null;
  const st = useBoard.getState();
  const karten = new Set(verweise.karten);
  for (const b of st.boards) if (!b.geteiltVon && !b.gastLink) for (const n of b.nodes) karten.add(n.id);
  for (const v of st.templates ?? []) if (v?.node?.id) karten.add(v.node.id);
  // Versionen dieses Geräts (M449): ein Stand, der sich zurückholen lässt, bringt seine Anhänge mit
  try { for (const id of await import('./boardVersionen').then((m) => m.versionsAnhaenge())) karten.add(id); } catch { return null; }
  const aus: Aufraeumen = { leichen: [], groesse: 0, geschont: 0, gesamt: objekte.size };
  for (const [name, o] of objekte) {
    const m = BEKANNT.exec(name);
    if (!m) continue;
    const id = m[2];
    if (karten.has(id) || (m[1] === 'datei' && verweise.dateien.has(id))) continue;
    const am = Date.parse(o.am);
    if (!Number.isFinite(am) || jetzt - am < SCHONFRIST_MS) { aus.geschont += 1; continue; }
    aus.leichen.push({ name, groesse: o.groesse, am: o.am });
    aus.groesse += o.groesse;
  }
  return aus;
}

/** Die angezeigten Leichen löschen — nur auf ausdrückliche Bestätigung. Prüft vorher noch einmal frisch. */
export async function speicherAufraeumen(bestaetigt: Aufraeumen): Promise<number> {
  const frisch = await speicherPruefen();
  if (!frisch) return 0;
  const jetztVerwaist = new Set(frisch.leichen.map((l) => l.name));
  // nur, was der Nutzer gesehen hat UND noch immer verwaist ist
  return kontoObjekteLoeschen(bestaetigt.leichen.map((l) => l.name).filter((n) => jetztVerwaist.has(n)));
}
