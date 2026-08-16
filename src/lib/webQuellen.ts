/**
 * M274: Echte Quellen für die KI-Recherche.
 *
 * Der Anlass (User-Screenshot): Auf „Recherche" antwortete die KI ehrlich
 * „Ich kann keine Live-Online-Recherche durchführen und kein aktuelles
 * Wetter abrufen." Stimmt — die Modelle werden ohne jeden Internet-Zugriff
 * aufgerufen. Raten wäre schlimmer als diese Ehrlichkeit.
 *
 * Die Antwort ist nicht „mehr Prompt", sondern MATERIAL: Es gibt Dienste,
 * die ein Browser direkt und ohne Schlüssel abfragen darf (CORS-offen):
 *
 *  · Wikipedia (de)  — Suche + Artikelauszüge über die MediaWiki-API
 *  · Wikivoyage (de) — Reiseziele, Sehenswürdigkeiten, Praktisches
 *  · Open-Meteo      — Geocoding + 7-Tage-Wettervorhersage, gratis
 *
 * Die Recherche holt daraus echtes Material und lässt das Modell NUR damit
 * arbeiten. Keine Zugangsdaten, keine Konten — die Abrufe gehen direkt vom
 * Gerät an die öffentlichen APIs.
 */

export interface Quelle {
  titel: string;
  url: string;
  text: string;
  art: 'wikipedia' | 'wikivoyage' | 'wetter';
}

/** Auszug-Deckel je Quelle — genug für Substanz, klein genug für den Kontext */
const MAX_AUSZUG = 2600;

async function holeJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

interface MwSearch { query?: { search?: Array<{ title: string }> } }
interface MwExtract { query?: { pages?: Record<string, { title?: string; extract?: string }> } }

/** MediaWiki-Suche + Auszug (Wikipedia und Wikivoyage sprechen dieselbe API) */
async function mediawiki(host: string, art: Quelle['art'], begriff: string, treffer: number): Promise<Quelle[]> {
  const s = await holeJson<MwSearch>(
    `https://${host}/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(begriff)}&srlimit=${treffer}&format=json&origin=*`,
  );
  const titel = (s?.query?.search ?? []).map((t) => t.title);
  const out: Quelle[] = [];
  for (const t of titel) {
    const e = await holeJson<MwExtract>(
      `https://${host}/w/api.php?action=query&prop=extracts&explaintext=1&exchars=${MAX_AUSZUG}&titles=${encodeURIComponent(t)}&format=json&origin=*`,
    );
    const seite = Object.values(e?.query?.pages ?? {})[0];
    const text = seite?.extract?.trim();
    if (text && text.length > 80) {
      out.push({ titel: t, url: `https://${host}/wiki/${encodeURIComponent(t.replace(/ /g, '_'))}`, text, art });
    }
  }
  return out;
}

export const sucheWikipedia = (begriff: string, treffer = 2): Promise<Quelle[]> =>
  mediawiki('de.wikipedia.org', 'wikipedia', begriff, treffer);

export const sucheWikivoyage = (begriff: string, treffer = 1): Promise<Quelle[]> =>
  mediawiki('de.wikivoyage.org', 'wikivoyage', begriff, treffer);

/** Open-Meteo-Wettercode → deutscher Klartext (die wichtigsten Stufen) */
const WETTER_CODE: Array<[number[], string]> = [
  [[0], 'sonnig'], [[1, 2], 'heiter bis wolkig'], [[3], 'bedeckt'],
  [[45, 48], 'Nebel'], [[51, 53, 55, 56, 57], 'Niesel'],
  [[61, 63, 65, 66, 67], 'Regen'], [[71, 73, 75, 77], 'Schnee'],
  [[80, 81, 82], 'Regenschauer'], [[85, 86], 'Schneeschauer'],
  [[95, 96, 99], 'Gewitter'],
];
const wetterText = (code: number): string =>
  WETTER_CODE.find(([cs]) => cs.includes(code))?.[1] ?? `Code ${code}`;

interface GeoAntwort { results?: Array<{ name: string; latitude: number; longitude: number; admin1?: string }> }
interface WetterAntwort {
  daily?: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: Array<number | null> };
}

/** 7-Tage-Vorhersage für einen Ortsnamen — als lesbare Textquelle */
export async function holeWetter(ort: string): Promise<Quelle | null> {
  const geo = await holeJson<GeoAntwort>(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(ort)}&count=1&language=de&format=json`,
  );
  const p = geo?.results?.[0];
  if (!p) return null;
  const w = await holeJson<WetterAntwort>(
    `https://api.open-meteo.com/v1/forecast?latitude=${p.latitude}&longitude=${p.longitude}`
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max'
    + '&timezone=auto&forecast_days=7',
  );
  const d = w?.daily;
  if (!d?.time?.length) return null;
  const zeilen = d.time.map((tag, i) => {
    const dt = new Date(`${tag}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
    const regen = d.precipitation_probability_max[i];
    return `${dt}: ${wetterText(d.weather_code[i])}, ${Math.round(d.temperature_2m_min[i])}–${Math.round(d.temperature_2m_max[i])} °C`
      + (regen != null ? `, Regenrisiko ${regen} %` : '');
  });
  const name = p.admin1 ? `${p.name} (${p.admin1})` : p.name;
  return {
    titel: `Wetter ${name}, nächste 7 Tage`,
    url: 'https://open-meteo.com/',
    text: zeilen.join('\n'),
    art: 'wetter',
  };
}

export interface Sammelauftrag {
  suchbegriffe: string[];
  /** Reise-/Ausflugsthema? Dann liefert Wikivoyage die praktischeren Artikel */
  reise?: boolean;
  wetterOrt?: string | null;
}

/** Alles einsammeln — fehlertolerant, gedeckelt, parallel wo möglich */
export async function sammleQuellen(auftrag: Sammelauftrag): Promise<Quelle[]> {
  const begriffe = auftrag.suchbegriffe.filter((b) => b.trim()).slice(0, 4);
  const arbeiten: Array<Promise<Quelle[] | Quelle | null>> = [
    ...begriffe.map((b) => sucheWikipedia(b, 2)),
    ...(auftrag.reise ? begriffe.slice(0, 2).map((b) => sucheWikivoyage(b, 1)) : []),
    ...(auftrag.wetterOrt ? [holeWetter(auftrag.wetterOrt)] : []),
  ];
  const ergebnisse = await Promise.all(arbeiten.map((p) => p.catch(() => null)));
  const flach = ergebnisse.flatMap((e) => (e ? (Array.isArray(e) ? e : [e]) : []));
  // Duplikate (gleicher Artikel über zwei Suchbegriffe) aussortieren
  const gesehen = new Set<string>();
  const out: Quelle[] = [];
  for (const q of flach) {
    if (gesehen.has(q.url)) continue;
    gesehen.add(q.url);
    out.push(q);
    if (out.length >= 8) break;
  }
  return out;
}
