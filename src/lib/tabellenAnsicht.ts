// M407: Die Rechen-Tabelle als Datentabelle – Kopfzeile, Filter je Spalte, Sortieren, Links.
//
// Filtern und Sortieren sind hier eine ANSICHT: Die Zellen bleiben, wo sie sind (A7 bleibt A7), nur die Reihenfolge
// und Auswahl der gezeigten Zeilen ändert sich. Darum rechnen alle Formeln unverändert weiter, nichts muss
// umgeschrieben werden, und „Filter aufheben" zeigt wieder genau den Stand von vorher. Die Zeilennummern am Rand
// bleiben die echten – wie in Excel bei gesetztem Filter.

/** Spaltenname zu einem Index: 0 → A, 25 → Z, 26 → AA */
export function spaltenName(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

export interface TabellenAnsicht {
  /** Kopfzeile (1 = erste Zeile) */
  kopf: number;
  /** Letzte Datenzeile, wenn sie feststeht (aus Excel übernommen) – sonst wird sie am Inhalt erkannt */
  bis?: number;
  /** Spalte → zugelassene Anzeigewerte; fehlt die Spalte, ist sie ungefiltert */
  filter?: Record<string, string[]>;
  sort?: { spalte: string; ab?: boolean };
}

/** Die erste Zeile, in der etwas steht – die naheliegende Kopfzeile */
export function ersteZeile(zellen: Record<string, string>, zeilen: number): number {
  let erste = zeilen + 1;
  for (const adr of Object.keys(zellen)) {
    const z = Number(adr.replace(/\D+/g, ''));
    if (z >= 1 && z < erste) erste = z;
  }
  return erste > zeilen ? 1 : erste;
}

/**
 * Die Datenzeilen unter der Kopfzeile: der zusammenhängende Block bis zur ersten leeren Zeile. Eine Summenzeile am
 * Ende gehört nicht dazu – erkannt daran, dass eine ihrer Formeln einen Bereich über mehrere Zeilen zusammenfasst
 * (=SUMME(B2:B9)); eine Zeilensumme (=SUMME(B2:D2)) macht aus einer Datenzeile keine Summenzeile.
 */
export function datenBereich(zellen: Record<string, string>, spalten: number, zeilen: number, kopf: number, bis?: number): { von: number; bis: number } {
  const von = kopf + 1;
  if (bis !== undefined) return { von, bis: Math.max(kopf, Math.min(bis, zeilen)) };
  const leer = (z: number) => { for (let s = 0; s < spalten; s += 1) if ((zellen[`${spaltenName(s)}${z}`] ?? '').trim() !== '') return false; return true; };
  let ende = kopf;
  while (ende + 1 <= zeilen && !leer(ende + 1)) ende += 1;
  const fasstZusammen = (z: number) => {
    for (let s = 0; s < spalten; s += 1) {
      const roh = zellen[`${spaltenName(s)}${z}`] ?? '';
      if (!roh.startsWith('=')) continue;
      for (const m of roh.matchAll(/\$?[A-Z]+\$?(\d+):\$?[A-Z]+\$?(\d+)/g)) if (m[1] !== m[2]) return true;
    }
    return false;
  };
  while (ende > von && fasstZusammen(ende)) ende -= 1;
  return { von, bis: ende };
}

/** Schlüssel zum Sortieren: Zahlen als Zahl, Datum (TT.MM.JJJJ) nach der Zeit, sonst Text */
function sortierWert(roh: unknown, text: string): { art: 0 | 1 | 2; zahl: number; text: string } {
  if (typeof roh === 'number' && Number.isFinite(roh)) return { art: 0, zahl: roh, text };
  const d = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/.exec(text.trim());
  if (d) return { art: 0, zahl: new Date(Number(d[3].length === 2 ? `20${d[3]}` : d[3]), Number(d[2]) - 1, Number(d[1])).getTime(), text };
  if (text.trim() === '') return { art: 2, zahl: 0, text };
  return { art: 1, zahl: 0, text };
}

/**
 * Reihenfolge der gezeigten Zeilen (echte Zeilennummern). Bis einschließlich der Kopfzeile und unterhalb des
 * Datenblocks bleibt alles stehen; dazwischen wird gefiltert und sortiert.
 * `wert` liefert den gerechneten Wert einer Zelle, `text` ihren Anzeigetext.
 */
export function gezeigteZeilen(
  a: TabellenAnsicht, zellen: Record<string, string>, spalten: number, zeilen: number,
  wert: (adr: string) => unknown, text: (adr: string) => string,
): { zeilen: number[]; daten: number; gezeigt: number; bereich: { von: number; bis: number } } {
  const bereich = datenBereich(zellen, spalten, zeilen, a.kopf, a.bis);
  const oben: number[] = []; const unten: number[] = []; let mitte: number[] = [];
  for (let z = 1; z <= zeilen; z += 1) (z < bereich.von ? oben : z > bereich.bis ? unten : mitte).push(z);
  const daten = mitte.length;
  for (const [spalte, erlaubt] of Object.entries(a.filter ?? {})) {
    const menge = new Set(erlaubt);
    mitte = mitte.filter((z) => menge.has(text(`${spalte}${z}`)));
  }
  if (a.sort) {
    const { spalte, ab } = a.sort;
    const schluessel = new Map(mitte.map((z) => [z, sortierWert(wert(`${spalte}${z}`), text(`${spalte}${z}`))]));
    mitte = [...mitte].sort((x, y) => {
      const p = schluessel.get(x)!; const q = schluessel.get(y)!;
      if (p.art !== q.art) return p.art - q.art;                       // Zahlen, dann Text, Leeres immer zuletzt
      if (p.art === 2) return x - y;
      const d = p.art === 0 ? p.zahl - q.zahl : p.text.localeCompare(q.text, 'de', { numeric: true, sensitivity: 'base' });
      return d === 0 ? x - y : ab ? -d : d;
    });
  }
  return { zeilen: [...oben, ...mitte, ...unten], daten, gezeigt: mitte.length, bereich };
}

/** Die Werte einer Spalte im Datenblock – jeder einmal, sortiert, mit Häufigkeit (für die Filterliste) */
export function spaltenWerte(spalte: string, bereich: { von: number; bis: number }, wert: (adr: string) => unknown, text: (adr: string) => string): Array<{ text: string; zahl: number }> {
  const zaehler = new Map<string, { n: number; s: ReturnType<typeof sortierWert> }>();
  for (let z = bereich.von; z <= bereich.bis; z += 1) {
    const t = text(`${spalte}${z}`);
    const e = zaehler.get(t);
    if (e) e.n += 1; else zaehler.set(t, { n: 1, s: sortierWert(wert(`${spalte}${z}`), t) });
  }
  return [...zaehler.entries()].sort(([, p], [, q]) => (p.s.art !== q.s.art ? p.s.art - q.s.art
    : p.s.art === 0 ? p.s.zahl - q.s.zahl : p.s.text.localeCompare(q.s.text, 'de', { numeric: true, sensitivity: 'base' })))
    .map(([t, e]) => ({ text: t, zahl: e.n }));
}

/**
 * Eine Adresse, die sich gefahrlos öffnen lässt: nur Web, Mail und Telefon. „www.…" wird zur Webadresse, eine
 * Mailadresse zu mailto:. Alles andere (javascript:, data:, Dateipfade) gibt null – Tabellen kommen auch von anderen.
 */
export function sichererLink(roh: unknown): string | null {
  if (typeof roh !== 'string') return null;
  const t = roh.trim();
  if (!t || /\s/.test(t) || t.length > 2000) return null;
  if (/^https?:\/\/[^/\s]+/i.test(t) || /^mailto:[^\s@]+@[^\s@]+/i.test(t) || /^tel:\+?[\d\-()/.]+$/i.test(t)) return t;
  if (/^www\.[^\s.]+\.[^\s]+$/i.test(t)) return `https://${t}`;
  if (/^[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}$/i.test(t)) return `mailto:${t}`;
  return null;
}

/** Ziel einer =HYPERLINK("…";"…")-Formel, wenn die Adresse wörtlich darin steht; sonst der Name der Zelle, in der sie steht */
export function hyperlinkZiel(roh: string): { adresse?: string; zelle?: string } | null {
  const m = /^=\s*HYPERLINK\(\s*(?:"([^"]*)"|\$?([A-Z]+)\$?(\d+))\s*[;)]/i.exec(roh);
  if (!m) return null;
  return m[1] !== undefined ? { adresse: m[1] } : { zelle: `${m[2].toUpperCase()}${m[3]}` };
}

/** Tabelle als CSV — öffnet sich in Excel, LibreOffice und Numbers. (M409: hier statt beim Excel-Leser, damit
 *  der erst geladen wird, wenn eine Excel-Datei kommt.) */
export function alsCsv(zellen: Record<string, string>, werte: Record<string, string>, spalten: number, zeilen: number): string {
  const raus: string[] = [];
  for (let z = 1; z <= zeilen; z += 1) {
    const zeile: string[] = [];
    for (let s = 0; s < spalten; s += 1) {
      // Ausgegeben wird der ERRECHNETE Wert — eine CSV kennt keine Formeln
      const v = werte[`${spaltenName(s)}${z}`] ?? zellen[`${spaltenName(s)}${z}`] ?? '';
      zeile.push(/[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    }
    raus.push(zeile.join(';'));
  }
  return `\uFEFF${raus.join('\r\n')}`;   // BOM, damit Excel die Umlaute erkennt
}
