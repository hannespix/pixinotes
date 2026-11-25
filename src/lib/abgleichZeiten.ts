// M472: Reine Zeit- und Merkfelder im Abgleich — eine Liste, eine Regel.
//
// Manche Felder sagen nicht, WAS eine Karte ist, sondern WANN etwas mit ihr geschah: die Kartenzeit (M453), die
// Spaltenzeit eines Tickets (M470), die Uhr der Auto-Archivierung (M293/M390), der Zeitpunkt der Texterkennung
// (M452). Jedes Gerät stempelt sie mit seiner eigenen Uhr — zwei Geräte, die dasselbe tun (dasselbe Ticket in
// dieselbe Spalte ziehen, dasselbe erledigte Ticket archivieren, dasselbe Bild erkennen), kommen zu derselben
// Fassung mit verschiedenen Zeitpunkten. Das ist kein Konflikt.
//
// Regel (Drei-Wege-Abgleich, syncMerge.ts → mergeBoard):
//   · Beim VERGLEICHEN zweier Fassungen zählen diese Felder nicht (`vergleichsText`).
//   · Sind zwei Fassungen bis auf sie gleich, werden sie ZUSAMMENGEFÜHRT (`zeitenVereinen`): je Feld gilt der
//     spätere Wert — auf beiden Geräten derselbe, also kein Hin und Her.
//   · Echte Inhaltsänderungen (Spalte, Text, Frist …) entscheiden weiter wie bisher (hiesige Fassung bei Konflikt).
//
// Ordner, WebDAV, Konto und der Live-Kanal (Gäste und Konten, gastSync → mischen) laufen alle durch
// `dreiWegeMerge` — die Regel gilt damit überall. Patches (gastPatch.ts) tragen Zeitfelder bewusst weiter: Nur so
// erreicht der spätere Wert nach dem Zusammenführen auch die anderen.
//
// NEUE Zeit- oder Merkfelder (ein Stempel, den jedes Gerät selbst setzt) hier eintragen — sonst erzeugen sie
// Schein-Konflikte. Inhalt (was der Nutzer sieht und ändern will) gehört NICHT hierher.
import type { AppNode } from '../types';

/** Felder an der Karte selbst (neben `data`) */
export const ZEIT_FELDER_KARTE = ['geaendert'] as const;                 // M453
/** Felder in `data` (Bild- und Datei-Karten) */
export const ZEIT_FELDER_DATEN = ['ocrAm'] as const;                     // M452
/** Felder an Kanban-Tickets in `data.items` und `data.archiv` */
export const ZEIT_FELDER_TICKET = ['spalteSeit', 'erledigtAm', 'archiviertAm', 'zurueckAm'] as const;   // M470, M293, M390
/** Listen, deren Einträge Tickets sind */
const TICKET_LISTEN = ['items', 'archiv'] as const;

type Satz = Record<string, unknown>;

const mitTickets = (n: AppNode): boolean => n.type === 'kanban';

function ohne(x: Satz, felder: readonly string[]): Satz {
  if (!felder.some((f) => f in x)) return x;
  const kopie = { ...x };
  for (const f of felder) delete kopie[f];
  return kopie;
}

/** Die Karte ohne ihre Zeit- und Merkfelder (Karte, `data`, Tickets) */
export function ohneZeiten(n: AppNode): AppNode {
  const karte = ohne(n as unknown as Satz, ZEIT_FELDER_KARTE);
  let daten = ohne(n.data as Satz, ZEIT_FELDER_DATEN);
  if (mitTickets(n)) {
    for (const l of TICKET_LISTEN) {
      const liste = daten[l];
      if (!Array.isArray(liste)) continue;
      daten = { ...daten, [l]: liste.map((it) => (it && typeof it === 'object' ? ohne(it as Satz, ZEIT_FELDER_TICKET) : it)) };
    }
  }
  return (karte === n && daten === n.data ? n : { ...karte, data: daten }) as unknown as AppNode;
}

/** Schlüssel sortiert — dieselbe Fassung ergibt denselben Text, gleich in welcher Reihenfolge die Felder entstanden */
const kanonisch = (x: unknown): unknown => {
  if (Array.isArray(x)) return x.map(kanonisch);
  if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x).sort().map((k) => [k, kanonisch((x as Satz)[k])]));
  return x;
};
/** M524: Derselbe Inhalt ergibt denselben Text — gleich in welcher Reihenfolge die Felder entstanden sind */
export const kanonText = (x: unknown): string => JSON.stringify(kanonisch(x)) ?? '';
/** Vergleichstext einer Karte ohne Zeit- und Merkfelder */
export function vergleichsText(n: AppNode): string {
  return JSON.stringify(kanonisch(ohneZeiten(n)));
}

const zahl = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : Number.NaN);
/** Der spätere von zwei Zeitwerten (ms oder ISO); fehlt einer, gilt der andere. Deterministisch in beide Richtungen. */
export function spaeterWert(a: unknown, b: unknown): unknown {
  if (a === undefined) return b;
  if (b === undefined) return a;
  const za = zahl(a); const zb = zahl(b);
  if (za === zb || (Number.isNaN(za) && Number.isNaN(zb))) return String(b) > String(a) ? b : a;
  if (Number.isNaN(za)) return b;
  if (Number.isNaN(zb)) return a;
  return zb > za ? b : a;
}

/** In `ziel` je Feld den späteren Wert aus `ziel` und `andere` setzen (Kopie nur, wenn sich etwas ändert) */
function spaetereFelder(ziel: Satz, andere: Satz, felder: readonly string[]): Satz {
  let aus = ziel;
  for (const f of felder) {
    const w = spaeterWert(ziel[f], andere[f]);
    if (w === ziel[f]) continue;
    if (aus === ziel) aus = { ...ziel };
    if (w === undefined) delete aus[f]; else aus[f] = w;
  }
  return aus;
}

/**
 * Zwei Fassungen derselben Karte, die sich nur in Zeit- und Merkfeldern unterscheiden (vergleichsText gleich), zu
 * EINER: Grundlage ist die später geänderte, jedes Zeitfeld bekommt den späteren Wert beider Seiten (bei Tickets je
 * Kennung). Auf beiden Geräten kommt dasselbe heraus. Unverändertes bleibt referenzgleich.
 */
export function zeitenVereinen<T extends AppNode>(a: T, b: T): T {
  const ga = zahl((a as unknown as Satz).geaendert); const gb = zahl((b as unknown as Satz).geaendert);
  const [grund, andere] = (gb > ga || (Number.isNaN(ga) && !Number.isNaN(gb))) ? [b, a] : [a, b];
  let karte = spaetereFelder(grund as unknown as Satz, andere as unknown as Satz, ZEIT_FELDER_KARTE);
  let daten = spaetereFelder(grund.data as Satz, andere.data as Satz, ZEIT_FELDER_DATEN);
  if (mitTickets(grund)) {
    for (const l of TICKET_LISTEN) {
      const liste = daten[l]; const gegen = (andere.data as Satz)[l];
      if (!Array.isArray(liste) || !Array.isArray(gegen)) continue;
      const nachId = new Map(gegen.filter((it) => it && typeof it === 'object').map((it) => [(it as Satz).id, it as Satz]));
      let anders = false;
      const neu = liste.map((it) => {
        if (!it || typeof it !== 'object') return it;
        const g = nachId.get((it as Satz).id);
        if (!g) return it;
        const w = spaetereFelder(it as Satz, g, ZEIT_FELDER_TICKET);
        if (w !== it) anders = true;
        return w;
      });
      if (anders) daten = { ...daten, [l]: neu };
    }
  }
  if (daten !== grund.data) karte = { ...karte, data: daten };
  return karte as unknown as T;
}
