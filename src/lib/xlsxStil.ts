// M409: Das Aussehen der Zellen aus einer Excel-Datei lesen – Schrift, Füllung, Linien, Ausrichtung, Zahlenformat.
//
// In xl/styles.xml stehen vier Listen (Schriften, Füllungen, Rahmen, Zahlenformate) und eine fünfte, die sie
// kombiniert (cellXfs). Jede Zelle nennt nur die Nummer ihrer Kombination (s="3"). Farben stehen entweder direkt da
// (rgb), als Nummer im Farbschema der Mappe (theme, mit Aufhellung/Abdunklung „tint") oder in der alten Palette
// (indexed). Heraus kommt je Kombination ein kleiner, CSS-naher Stil (`ZellStil`).
import type { ZellStil } from '../types';
import { EINGEBAUT } from './zahlFormat';

const attr = (s: string, name: string): string | undefined => new RegExp(`\\b${name}="([^"]*)"`).exec(s)?.[1];

/** Die alte Farbpalette (indexed 0–63) */
const PALETTE = ('000000,FFFFFF,FF0000,00FF00,0000FF,FFFF00,FF00FF,00FFFF,000000,FFFFFF,FF0000,00FF00,0000FF,FFFF00,FF00FF,00FFFF,'
  + '800000,008000,000080,808000,800080,008080,C0C0C0,808080,9999FF,993366,FFFFCC,CCFFFF,660066,FF8080,0066CC,CCCCFF,'
  + '000080,FF00FF,FFFF00,00FFFF,800080,800000,008080,0000FF,00CCFF,CCFFFF,CCFFCC,FFFF99,99CCFF,FF99CC,CC99FF,FFCC99,'
  + '3366FF,33CCCC,99CC00,FFCC00,FF9900,FF6600,666699,969696,003366,339966,003300,333300,993300,993366,333399,333333').split(',');
/** Das Standard-Farbschema von Office – gilt, wenn die Mappe keines mitbringt */
const SCHEMA_STANDARD = ['FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47'];

/** Farbschema der Mappe in der Reihenfolge, in der die Zellen es zählen (hell 1, dunkel 1, hell 2, dunkel 2, Akzent 1–6) */
export function leseSchema(themeXml: string | null): string[] {
  if (!themeXml) return SCHEMA_STANDARD;
  const farbe = (name: string): string | undefined => {
    const m = new RegExp(`<a:${name}>([\\s\\S]*?)</a:${name}>`).exec(themeXml)?.[1] ?? '';
    return attr(/<a:srgbClr\b([^>]*)>/.exec(m)?.[1] ?? '', 'val') ?? attr(/<a:sysClr\b([^>]*)>/.exec(m)?.[1] ?? '', 'lastClr');
  };
  const namen = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'];
  return namen.map((n, i) => (farbe(n) ?? SCHEMA_STANDARD[i]).toUpperCase());
}

/** Aufhellen (tint > 0) oder abdunkeln (tint < 0) – wie Excel: über die Helligkeit im HSL-Raum */
function toenen(hex: string, tint: number): string {
  if (!tint) return hex;
  const r = parseInt(hex.slice(0, 2), 16) / 255, g = parseInt(hex.slice(2, 4), 16) / 255, b = parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b); let h = 0; let s = 0; let l = (max + min) / 2;
  if (max !== min) {
    const d = max - min; s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6;
  }
  l = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const k = (t: number) => { let x = t; if (x < 0) x += 1; if (x > 1) x -= 1; return x < 1 / 6 ? p + (q - p) * 6 * x : x < 0.5 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p; };
  const hexa = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  return s === 0 ? hexa(l).repeat(3).toUpperCase() : (hexa(k(h + 1 / 3)) + hexa(k(h)) + hexa(k(h - 1 / 3))).toUpperCase();
}

/** Farbe aus den Angaben eines <color …/>-, <fgColor …/>-Elements; `undefined` = „automatisch" */
function farbeAus(angaben: string | undefined, schema: string[]): string | undefined {
  if (!angaben || attr(angaben, 'auto') === '1') return undefined;
  const tint = Number(attr(angaben, 'tint') ?? '0') || 0;
  const rgb = attr(angaben, 'rgb');
  if (rgb && /^[0-9a-fA-F]{6,8}$/.test(rgb)) return `#${toenen(rgb.slice(-6).toUpperCase(), tint).toLowerCase()}`;
  const theme = attr(angaben, 'theme');
  if (theme !== undefined && schema[Number(theme)]) return `#${toenen(schema[Number(theme)], tint).toLowerCase()}`;
  const nr = Number(attr(angaben, 'indexed') ?? '-1');
  return nr >= 0 && nr < PALETTE.length ? `#${PALETTE[nr].toLowerCase()}` : undefined;
}

const liste = (xml: string, aussen: string, innen: string): Array<{ kopf: string; inhalt: string }> => {
  const block = new RegExp(`<${aussen}\\b[^>]*>([\\s\\S]*?)</${aussen}>`).exec(xml)?.[1] ?? '';
  return [...block.matchAll(new RegExp(`<${innen}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${innen}>)`, 'g'))].map((m) => ({ kopf: m[1], inhalt: m[2] ?? '' }));
};
const gesetzt = (inhalt: string, name: string): boolean => {
  const m = new RegExp(`<${name}\\b([^>]*)/?>`).exec(inhalt);
  return !!m && attr(m[1], 'val') !== '0' && attr(m[1], 'val') !== 'false' && attr(m[1], 'val') !== 'none';
};
const LINIE: Record<string, string> = {
  hair: '1px solid', thin: '1px solid', dotted: '1px dotted', dashed: '1px dashed', dashDot: '1px dashed', dashDotDot: '1px dashed',
  medium: '2px solid', mediumDashed: '2px dashed', mediumDashDot: '2px dashed', mediumDashDotDot: '2px dashed', slantDashDot: '2px dashed', thick: '3px solid', double: '3px double',
};

/** Stil je Zell-Kombination (Index = Nummer in `s="…"`); `datum[i]` = Datumsformat dieser Kombination, falls eines */
export function leseStile(stylesXml: string | null, themeXml: string | null): { stile: ZellStil[]; datum: Array<string | undefined> } {
  if (!stylesXml) return { stile: [], datum: [] };
  const schema = leseSchema(themeXml);
  const eigene = new Map<number, string>();
  for (const m of stylesXml.matchAll(/<numFmt\b([^>]*)\/?>/g)) {
    const id = Number(attr(m[1], 'numFmtId') ?? '-1'); const code = attr(m[1], 'formatCode');
    if (id >= 0 && code !== undefined) eigene.set(id, code.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'"));
  }
  const schriften = liste(stylesXml, 'fonts', 'font').map((f, i) => {
    const s: ZellStil = {};
    if (gesetzt(f.inhalt, 'b')) s.f = 1;
    if (gesetzt(f.inhalt, 'i')) s.k = 1;
    if (gesetzt(f.inhalt, 'u')) s.u = 1;
    if (gesetzt(f.inhalt, 'strike')) s.d = 1;
    const groesse = Number(attr(/<sz\b([^>]*)\/?>/.exec(f.inhalt)?.[1] ?? '', 'val') ?? '0');
    if (groesse && Math.abs(groesse - 11) >= 1) s.g = groesse;
    const farbe = farbeAus(/<color\b([^>]*)\/?>/.exec(f.inhalt)?.[1], schema);
    // Schwarz ist die Farbe „ohne Angabe" – sie bleibt weg, damit die Schrift im dunklen Design lesbar bleibt
    if (farbe && farbe !== '#000000' && i >= 0) s.fa = farbe;
    return s;
  });
  const fuellungen = liste(stylesXml, 'fills', 'fill').map((f) => {
    const muster = /<patternFill\b([^>]*?)(?:\/>|>([\s\S]*?)<\/patternFill>)/.exec(f.inhalt);
    if (muster) {
      const art = attr(muster[1], 'patternType');
      if (!art || art === 'none' || art === 'gray125' || art === 'gray0625') return undefined;
      return farbeAus(/<fgColor\b([^>]*)\/?>/.exec(muster[2] ?? '')?.[1], schema) ?? farbeAus(/<bgColor\b([^>]*)\/?>/.exec(muster[2] ?? '')?.[1], schema);
    }
    return farbeAus(/<color\b([^>]*)\/?>/.exec(f.inhalt)?.[1], schema);    // Verlauf: seine erste Farbe
  });
  const rahmen = liste(stylesXml, 'borders', 'border').map((b) => {
    const seite = (name: string): string | undefined => {
      const m = new RegExp(`<${name}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${name}>)`).exec(b.inhalt);
      const art = m ? attr(m[1], 'style') : undefined;
      if (!m || !art || art === 'none' || !LINIE[art]) return undefined;
      return `${LINIE[art]} ${farbeAus(/<color\b([^>]*)\/?>/.exec(m[2] ?? '')?.[1], schema) ?? 'currentColor'}`;
    };
    return { ro: seite('top'), rr: seite('right') ?? seite('end'), ru: seite('bottom'), rl: seite('left') ?? seite('start') };
  });
  const stile: ZellStil[] = []; const datum: Array<string | undefined> = [];
  for (const xf of liste(stylesXml, 'cellXfs', 'xf')) {
    const s: ZellStil = { ...(schriften[Number(attr(xf.kopf, 'fontId') ?? '0')] ?? {}) };
    const bg = fuellungen[Number(attr(xf.kopf, 'fillId') ?? '0')];
    if (bg && bg !== '#ffffff') s.bg = bg;
    const r = rahmen[Number(attr(xf.kopf, 'borderId') ?? '0')];
    if (r) { if (r.ro) s.ro = r.ro; if (r.rr) s.rr = r.rr; if (r.ru) s.ru = r.ru; if (r.rl) s.rl = r.rl; }
    const aus = /<alignment\b([^>]*)\/?>/.exec(xf.inhalt)?.[1] ?? '';
    const h = attr(aus, 'horizontal');
    if (h === 'center' || h === 'centerContinuous') s.a = 'm'; else if (h === 'right') s.a = 'r'; else if (h === 'left') s.a = 'l';
    const v = attr(aus, 'vertical');
    if (v === 'top') s.v = 'o'; else if (v === 'center') s.v = 'm';
    if (attr(aus, 'wrapText') === '1' || attr(aus, 'wrapText') === 'true') s.um = 1;
    const nr = Number(attr(xf.kopf, 'numFmtId') ?? '0');
    const code = eigene.get(nr) ?? EINGEBAUT[nr];
    const istDatum = (nr >= 14 && nr <= 22) || (nr >= 45 && nr <= 47) || (!!eigene.get(nr) && datumsCode(eigene.get(nr) as string));
    datum.push(istDatum ? code : undefined);
    if (code && !istDatum && code !== '@' && !/^general$/i.test(code)) s.z = code;
    stile.push(s);
  }
  return { stile, datum };
}

/** Trägt der Code ein Datum oder eine Uhrzeit? (dieselbe Regel wie seit M388) */
function datumsCode(roh: string): boolean {
  const code = roh.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
  if (/[0#?]/.test(code)) return false;
  return /[dy]/i.test(code) || (/(^|[^a-z])(h{1,2}|m{1,2}|s{1,2})([^a-z]|$)/i.test(code) && /[hs]/i.test(code));
}
