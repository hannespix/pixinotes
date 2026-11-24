/**
 * M519: Inhalt einer Karte, die von außen kam (geteilte Board-Datei, Link, Abgleich, Gast im Live-Board), in die
 * Gestalt bringen, mit der Karten und Auswertungen rechnen.
 *
 * `karteGueltig` (lib/sicher.ts) prüft nur das Äußere: Kennung, Art, Lage, „hat Daten". Was IN den Daten steht,
 * lesen aber nicht nur die Karten selbst (jede hat ihre Fehlergrenze), sondern auch Suche, Aufgaben, Rückverweise,
 * Fokus-Kopfzeile und Auswahl-Leiste — außerhalb jeder Karte. Eine Notiz, deren `blocks` kein Feld war (oder ein
 * `null` enthielt), ließ deshalb die ganze App abstürzen; weil der Stand gespeichert wird, nach jedem Neuladen
 * wieder. Eine Mail ohne Absender überstand das Zeichnen (Fehlergrenze), ein Klick auf sie nicht.
 *
 * Hier wird nichts bewertet und nichts verschönert: Felder, die fehlen oder die falsche Art haben, bekommen den
 * leeren Wert ihrer Art; Listen verlieren, was kein Eintrag ist. Gibt DIESELBE Karte zurück, wenn nichts zu tun
 * war (der Abgleich vergleicht Karten per Identität).
 */
import type { AppNode } from '../types';

type Daten = Record<string, unknown>;

const istObjekt = (v: unknown): v is Daten => !!v && typeof v === 'object' && !Array.isArray(v);
const FORMEN = new Set(['process', 'decision', 'terminator', 'note']);

/** Block-Liste einer Notiz/Form: nur Objekte, `children` als Liste, Inline-Inhalt als Text, Liste oder Tabelle */
function bloeckeGerade(roh: unknown): unknown[] {
  if (!Array.isArray(roh)) return [];
  const lauf = (liste: unknown[]): unknown[] => {
    let anders = false;
    const aus: unknown[] = [];
    for (const b of liste) {
      if (!istObjekt(b)) { anders = true; continue; }
      let o = b;
      if (o.children !== undefined) {
        if (!Array.isArray(o.children)) { const { children: _c, ...rest } = o; o = rest; }
        else { const k = lauf(o.children); if (k !== o.children) o = { ...o, children: k }; }
      }
      if (o.type !== undefined && typeof o.type !== 'string') o = { ...o, type: 'paragraph' };
      if (o.props !== undefined && !istObjekt(o.props)) { const { props: _p, ...rest } = o; o = rest; }
      const c = o.content;
      if (Array.isArray(c)) {
        // Textstücke und Links: Objekte; ein Link braucht seine Stück-Liste
        const stuecke = c.filter((t) => istObjekt(t) && (t.type !== 'link' || Array.isArray(t.content)));
        if (stuecke.length !== c.length) o = { ...o, content: stuecke };
      } else if (c !== undefined && typeof c !== 'string' && !(istObjekt(c) && Array.isArray(c.rows))) {
        o = { ...o, content: '' };
      }
      if (o !== b) anders = true;
      aus.push(o);
    }
    return anders ? aus : liste;
  };
  return lauf(roh);
}

export function kartenDatenGerade<T extends AppNode>(n: T): T {
  const d = n.data as Daten;
  const neu: Daten = {};
  /** Feld muss Text sein — sonst der Ersatz (`undefined`: Feld fällt weg) */
  const text = (feld: string, ersatz?: string) => {
    if (typeof d[feld] === 'string' || (d[feld] === undefined && ersatz === undefined)) return;
    neu[feld] = ersatz;
  };
  const zahl = (feld: string) => { if (!(typeof d[feld] === 'number' && Number.isFinite(d[feld]))) neu[feld] = 0; };
  const bloecke = () => {
    if (d.blocks === undefined) return;
    const b = bloeckeGerade(d.blocks);
    if (b !== d.blocks) neu.blocks = b;
  };
  switch (n.type) {
    case 'note':
      bloecke(); text('hex');
      break;
    case 'shape':
      bloecke(); text('text', ''); text('color', '#ffffff');
      if (!FORMEN.has(d.shape as string)) neu.shape = 'process';
      break;
    case 'email': {
      text('subject', ''); text('fromName', ''); text('text', ''); text('fromAddress'); text('date');
      const a = d.attachments;
      const gut = (x: unknown) => istObjekt(x) && typeof x.name === 'string' && (x.size === undefined || typeof x.size === 'number')
        && (x.mime === undefined || typeof x.mime === 'string') && (x.dataUrl === undefined || typeof x.dataUrl === 'string');
      if (!Array.isArray(a)) neu.attachments = [];
      else if (!a.every(gut)) {
        neu.attachments = a.filter(istObjekt).map((x) => ({
          name: typeof x.name === 'string' ? x.name : 'Anhang',
          size: typeof x.size === 'number' && Number.isFinite(x.size) ? x.size : 0,
          ...(typeof x.mime === 'string' ? { mime: x.mime } : {}),
          ...(typeof x.dataUrl === 'string' ? { dataUrl: x.dataUrl } : {}),
        }));
      }
      break;
    }
    case 'file':
      if (typeof d.name !== 'string' || !d.name) neu.name = 'Datei';
      zahl('size'); text('titel'); text('mime');
      break;
    case 'mermaid':
      text('code', '');
      break;
    case 'htmlapp':
      if (typeof d.name !== 'string' || !d.name) neu.name = 'App';
      zahl('size');
      break;
    case 'image':
      text('src', ''); text('name'); text('titel');
      break;
    case 'portal':
      text('boardId');
      break;
    default:
      return n;
  }
  if (Object.keys(neu).length === 0) return n;
  const data: Daten = { ...d, ...neu };
  for (const k of Object.keys(neu)) if (neu[k] === undefined) delete data[k];
  return { ...n, data } as T;
}
