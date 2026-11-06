// M327: Struktur aus der Handschrift — Listen, Aufzählungen, Kästchen,
// Überschriften. Zwei Quellen, dann der Kontext:
//
//  1. Die FORM der Striche, noch vor der Erkennung: ein kleines Kästchen oder
//     ein Kreis links vor der Zeile ist ein Kontrollkästchen (mit Haken oder
//     Kreuz darin: erledigt), ein kurzer Strich oder Punkt davor eine
//     Aufzählung, eine Linie unter der Zeile oder deutlich größere Schrift eine
//     Überschrift. Die Marker-Striche gehen nicht mit in die Erkennung — sonst
//     liest der Erkenner „o Milch" oder „— Brot".
//  2. Der erkannte TEXT: „- Milch", „1. Mehl", „[ ] Butter", „# Einkauf", „> Zitat".
//  3. Der KONTEXT der Notiz: Steht die Schrift unter einem Listenpunkt, wird sie
//     ein Listenpunkt derselben Art — es sei denn, Form oder Text sagen etwas
//     anderes, oder die Zeile beginnt links der Einrückung (zurück zu Text).
//
// Die Datei kommt ohne Abhängigkeiten aus (prüfbar direkt unter Node).

export type Pt = [number, number];
export type BlockArt = 'paragraph' | 'heading' | 'bulletListItem' | 'numberedListItem' | 'checkListItem' | 'quote';

export interface ZeilenStruktur { art: BlockArt; checked?: boolean; level?: number }
export interface ZeileMitArt extends ZeilenStruktur { text: string; quelle: 'text' | 'form' | 'kontext' | 'keine' }

/** Die Textarten für den Umschalter im Vorschlag — in dieser Reihenfolge */
export const TEXT_ARTEN: Array<{ art: BlockArt; kurz: string; name: string }> = [
  { art: 'paragraph', kurz: '¶', name: 'Text' },
  { art: 'bulletListItem', kurz: '•', name: 'Aufzählung' },
  { art: 'numberedListItem', kurz: '1.', name: 'Nummerierte Liste' },
  { art: 'checkListItem', kurz: '☐', name: 'Aufgabe mit Kästchen' },
  { art: 'heading', kurz: 'H', name: 'Überschrift' },
];
export const LISTEN_ARTEN: BlockArt[] = ['bulletListItem', 'numberedListItem', 'checkListItem'];
export const istListe = (art: string | null | undefined): art is BlockArt => !!art && LISTEN_ARTEN.includes(art as BlockArt);
export const artName = (art: BlockArt): string => TEXT_ARTEN.find((a) => a.art === art)?.name ?? (art === 'quote' ? 'Zitat' : 'Text');

/* ───────────── Text-Marker ───────────── */

/** „- Milch" → Aufzählung „Milch"; „[x] Brot" → erledigte Aufgabe; „# Titel" → Überschrift … */
export function markerAusText(zeile: string): { art: BlockArt | null; text: string; checked?: boolean; level?: number } {
  const t = zeile.trim();
  let m: RegExpExecArray | null;
  if ((m = /^(#{1,3})\s*(\S.*)$/.exec(t))) return { art: 'heading', level: m[1].length, text: m[2].trim() };
  if ((m = /^[-–—*•·]\s*\[\s?([xX✓✔]?)\s?\]\s*(\S.*)$/.exec(t))) return { art: 'checkListItem', checked: !!m[1], text: m[2].trim() };
  if ((m = /^(\[\s?\]|\[\s?[xX✓✔]\s?\]|\(\s?\)|\(\s?[xX✓✔]\s?\)|[☐□▢◻]|[☑☒■◼✅])\s*(\S.*)$/.exec(t))) {
    return { art: 'checkListItem', checked: /[xX✓✔☑☒■◼✅]/.test(m[1]), text: m[2].trim() };
  }
  if ((m = /^[-–—*•·]\s+(\S.*)$/.exec(t))) return { art: 'bulletListItem', text: m[1].trim() };
  if ((m = /^\d{1,2}[.)]\s+(\S.*)$/.exec(t))) return { art: 'numberedListItem', text: m[1].trim() };
  if ((m = /^>\s?(\S.*)$/.exec(t))) return { art: 'quote', text: m[1].trim() };
  return { art: null, text: t };
}

/* ───────────── Form-Marker ───────────── */

interface Box { minX: number; minY: number; maxX: number; maxY: number; w: number; h: number }
const box = (pts: Pt[]): Box => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  return { minX, minY, maxX, maxY, w: Math.max(0, maxX - minX), h: Math.max(0, maxY - minY) };
};
const vereint = (a: Box, b: Box): Box => {
  const minX = Math.min(a.minX, b.minX), minY = Math.min(a.minY, b.minY), maxX = Math.max(a.maxX, b.maxX), maxY = Math.max(a.maxY, b.maxY);
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
};
const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export interface Zeile { striche: number[]; box: Box }

/**
 * Striche zu Schreibzeilen: ein Strich gehört zur Zeile, wenn sich seine Höhe
 * mit ihr zu mindestens 40 % überschneidet (bezogen auf die kleinere Höhe).
 * Ergebnis von oben nach unten, Striche je Zeile von links nach rechts.
 */
export function zeilenAusStrichen(striche: Pt[][]): Zeile[] {
  const boxen = striche.map(box);
  const reihenfolge = boxen.map((_, i) => i).sort((a, b) => (boxen[a].minY + boxen[a].maxY) - (boxen[b].minY + boxen[b].maxY));
  const zeilen: Zeile[] = [];
  for (const i of reihenfolge) {
    const b = boxen[i];
    const my = (b.minY + b.maxY) / 2;
    let ziel: Zeile | undefined;
    for (const z of zeilen) {
      const ueber = Math.min(z.box.maxY, b.maxY) - Math.max(z.box.minY, b.minY);
      const klein = Math.max(1, Math.min(z.box.h, b.h));
      if ((ueber > 0 && ueber / klein >= 0.4) || (my >= z.box.minY && my <= z.box.maxY)) { ziel = z; break; }
    }
    if (ziel) { ziel.striche.push(i); ziel.box = vereint(ziel.box, b); } else zeilen.push({ striche: [i], box: { ...b } });
  }
  for (const z of zeilen) z.striche.sort((a, b) => boxen[a].minX - boxen[b].minX);
  return zeilen.sort((a, b) => a.box.minY - b.box.minY);
}

export interface FormErgebnis {
  /** Die Striche ohne die Marker — das geht in die Erkennung */
  ohneMarker: Pt[][];
  /** Je Schreibzeile (oben → unten) die erkannte Struktur oder null */
  zeilen: Array<ZeilenStruktur | null>;
}

/**
 * Marker aus der Form der Striche lesen. Je Zeile wird der linkeste Strich
 * geprüft, wenn er klein ist (höchstens zeilenhoch) und mit Abstand vor dem
 * Rest steht: geschlossen → Kästchen (ein zweiter kleiner Strich darin → Haken),
 * flach → Gedankenstrich, winzig → Punkt. Eine flache Linie unter einer Zeile,
 * die mindestens die halbe Zeile lang ist, macht sie zur Überschrift; ebenso
 * eine Zeile, die deutlich größer geschrieben ist als die anderen.
 */
export function markerAusStrichen(striche: Pt[][]): FormErgebnis {
  const boxen = striche.map(box);
  const zeilen = zeilenAusStrichen(striche);
  const weg = new Set<number>();
  const struktur: Array<ZeilenStruktur | null> = zeilen.map(() => null);
  const entfernt = new Set<number>(); // ganze Zeilen, die nur Unterstreichung waren

  // 1) Unterstreichungen: eine Zeile aus genau einem flachen Strich direkt unter einer Textzeile
  const istFlach = (i: number, mindestBreite: number) => boxen[i].h <= Math.max(4, boxen[i].w * 0.12) && boxen[i].w >= mindestBreite;
  zeilen.forEach((z, zi) => {
    if (z.striche.length !== 1 || entfernt.has(zi)) return;
    const s = z.striche[0];
    const oben = zeilen.findIndex((o, oi) => oi !== zi && !entfernt.has(oi) && o.striche.length >= 1 && !(o.striche.length === 1 && istFlach(o.striche[0], 0))
      && z.box.minY >= o.box.maxY - o.box.h * 0.25 && z.box.minY <= o.box.maxY + o.box.h * 0.7
      && boxen[s].minX <= o.box.minX + o.box.w * 0.4 && boxen[s].maxX >= o.box.minX + o.box.w * 0.5);
    if (oben < 0 || !istFlach(s, zeilen[oben].box.w * 0.5)) return;
    struktur[oben] = { art: 'heading', level: 2 };
    weg.add(s); entfernt.add(zi);
  });
  // Unterstreichung, die in dieselbe Zeile gerutscht ist (y überschneidet die Unterlängen)
  zeilen.forEach((z, zi) => {
    if (entfernt.has(zi) || z.striche.length < 2) return;
    for (const s of z.striche) {
      const b = boxen[s];
      const rest = z.striche.filter((k) => k !== s);
      const restBox = rest.map((k) => boxen[k]).reduce(vereint);
      if (istFlach(s, restBox.w * 0.5) && b.minY >= restBox.minY + restBox.h * 0.7) { struktur[zi] = { art: 'heading', level: 2 }; weg.add(s); break; }
    }
  });

  // 2) Marker links: Kästchen, Strich, Punkt
  zeilen.forEach((z, zi) => {
    if (entfernt.has(zi)) return;
    const reihe = z.striche.filter((s) => !weg.has(s));
    if (reihe.length < 2) return;
    const m = reihe[0];
    const mb = boxen[m];
    // Striche, deren Mitte im Marker liegt und die kaum größer sind — Haken oder Kreuz in einem Kästchen
    // (ein Haken ragt gern über den Rand; die Glättung macht kleine Kästchen zudem etwas kleiner)
    const rand = Math.max(mb.w, mb.h) * 0.35;
    const drin = reihe.slice(1).filter((k) => {
      const b = boxen[k];
      const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
      return cx >= mb.minX - rand && cx <= mb.maxX + rand && cy >= mb.minY - rand && cy <= mb.maxY + rand && b.w <= mb.w * 1.5 && b.h <= mb.h * 1.5;
    });
    const textStriche = reihe.slice(1).filter((k) => !drin.includes(k));
    if (textStriche.length === 0) return;
    const rest = textStriche.map((k) => boxen[k]).reduce(vereint);
    const h = Math.max(rest.h, 8);
    const abstand = rest.minX - mb.maxX;
    // Marker: höchstens zeilenhoch und mit Luft vor dem Text — sonst ist es ein Buchstabe („O", „l")
    if (mb.w > h * 1.15 || mb.h > h * 1.15 || abstand < h * 0.2) return;
    const pts = striche[m];
    const geschlossen = pts.length >= 4 && dist(pts[0], pts[pts.length - 1]) <= Math.max(mb.w, mb.h) * 0.4;
    const kasten = geschlossen && mb.w >= h * 0.3 && mb.h >= h * 0.3;
    const flach = mb.h <= Math.max(3, h * 0.22) && mb.w >= h * 0.2;
    const punkt = mb.w <= h * 0.3 && mb.h <= h * 0.3;
    if (kasten) {
      const checked = drin.length > 0 && drin.length <= 2;
      if (checked) drin.forEach((k) => weg.add(k));
      struktur[zi] = { art: 'checkListItem', checked };
      weg.add(m);
    } else if (drin.length === 0 && (flach || punkt)) {
      struktur[zi] = { art: 'bulletListItem' };
      weg.add(m);
    }
  });

  // 3) Deutlich größere Schrift (≥ 1,6 × Median der anderen Zeilen) → Überschrift
  const textZeilen = zeilen.map((z, zi) => ({ zi, h: z.striche.filter((s) => !weg.has(s)).map((s) => boxen[s]).reduce<Box | null>((a, b) => (a ? vereint(a, b) : b), null)?.h ?? 0 }))
    .filter((z) => !entfernt.has(z.zi) && z.h > 0);
  if (textZeilen.length >= 2) {
    for (const z of textZeilen) {
      if (struktur[z.zi]) continue;
      const andere = textZeilen.filter((o) => o.zi !== z.zi).map((o) => o.h);
      if (z.h >= median(andere) * 1.6 && z.h >= 12) struktur[z.zi] = { art: 'heading', level: 2 };
    }
  }

  const zeilenOhne = zeilen.map((_, zi) => zi).filter((zi) => !entfernt.has(zi));
  return {
    ohneMarker: striche.filter((_, i) => !weg.has(i)),
    zeilen: zeilenOhne.map((zi) => struktur[zi]),
  };
}

/* ───────────── Zusammenführen ───────────── */

/**
 * Textzeilen der Erkennung + Form je Zeile + Kontext → Zeilen mit Art.
 * Vorrang: Text-Marker (ausdrücklich geschrieben) › Form › Kontext › Absatz.
 * Die Form zählt nur, wenn Erkennung und Geometrie gleich viele Zeilen sehen
 * (sonst wäre die Zuordnung geraten). Ein Listen-Kontext setzt sich auf jede
 * Zeile fort, eine Überschrift oder ein Zitat im Kontext nicht.
 */
export function zeilenMitArt(textZeilen: string[], form: Array<ZeilenStruktur | null>, kontext: BlockArt | null): ZeileMitArt[] {
  const formPasst = form.length === textZeilen.length;
  return textZeilen.map((roh, i) => {
    const t = markerAusText(roh);
    // Nach dem Marker beginnt der eigentliche Text — Satzanfang groß wie in textAufraeumen
    if (/^[a-zäöü]/.test(t.text)) t.text = t.text[0].toUpperCase() + t.text.slice(1);
    if (t.art) return { art: t.art, text: t.text, checked: t.checked, level: t.level, quelle: 'text' };
    const f = formPasst ? form[i] : (textZeilen.length === 1 && form.length >= 1 ? form[0] : null);
    if (f) return { art: f.art, text: t.text, checked: f.checked, level: f.level, quelle: 'form' };
    if (istListe(kontext)) return { art: kontext, text: t.text, checked: false, quelle: 'kontext' };
    return { art: 'paragraph', text: t.text, quelle: 'keine' };
  });
}

/** Alle Zeilen auf eine Art umstellen (der Umschalter im Vorschlag) */
export function artSetzen(zeilen: ZeileMitArt[], art: BlockArt): ZeileMitArt[] {
  return zeilen.map((z) => ({ ...z, art, checked: art === 'checkListItem' ? z.checked ?? false : undefined, level: art === 'heading' ? z.level ?? 2 : undefined }));
}

/** Die vorherrschende Art der Zeilen (für den Umschalter: welche ist „an"?) */
export function hauptArt(zeilen: ZeileMitArt[]): BlockArt {
  const zaehler = new Map<BlockArt, number>();
  for (const z of zeilen) zaehler.set(z.art, (zaehler.get(z.art) ?? 0) + 1);
  return [...zaehler.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'paragraph';
}

/** Zeilen → BlockNote-Blöcke */
export function zeilenZuBloecken(zeilen: ZeileMitArt[]): unknown[] {
  const out = zeilen.filter((z) => z.text.trim()).map((z) => {
    if (z.art === 'heading') return { type: 'heading', props: { level: Math.min(3, Math.max(1, z.level ?? 2)) }, content: z.text };
    if (z.art === 'checkListItem') return { type: 'checkListItem', props: { checked: !!z.checked }, content: z.text };
    return { type: z.art, content: z.text };
  });
  return out.length ? out : [{ type: 'paragraph', content: '' }];
}

/** Kurzer Vorsatz für den Vorschlag-Chip: „• ", „☐ ", „☑ ", „1. ", „H " */
export function artVorsatz(z: ZeileMitArt): string {
  if (z.art === 'bulletListItem') return '• ';
  if (z.art === 'numberedListItem') return '1. ';
  if (z.art === 'checkListItem') return z.checked ? '☑ ' : '☐ ';
  if (z.art === 'heading') return 'H ';
  if (z.art === 'quote') return '› ';
  return '';
}
