// M388: Was von außen kommt, wird geprüft, bevor es der Browser als Adresse, Seite oder Karte nimmt.
//
// Boards reisen: als Link, als Datei, über die Freigabe, über den Live-Kanal. Ihr Inhalt stammt dann von
// anderen — und alles, was daraus zu einer ADRESSE wird (eingebettete Seite, Download, Bildquelle), könnte
// statt „https://…" auch „javascript:…" heißen. Der Browser führt so etwas im Namen von PixiNotes aus, mit
// Zugriff auf alles, was hier gespeichert ist. Darum entscheidet an jeder solchen Stelle diese Datei, nicht
// der Board-Inhalt.
import type { AppNode, KontaktData, KontaktTelefon } from '../types';
import { zeitSaeubern } from './kartenZeit';
import type { BoardDoc } from '../store';

const protokoll = (roh: string): string | null => {
  try { return new URL(roh, window.location.href).protocol; } catch { return null; }
};

/** Adresse einer FREMDEN Webseite zum Einbetten oder Öffnen: nur http(s), nie PixiNotes selbst */
export function fremdeWebAdresse(roh: unknown): string | null {
  if (typeof roh !== 'string' || !roh.trim()) return null;
  try {
    const u = new URL(roh.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.origin === window.location.origin) return null;
    return u.href;
  } catch { return null; }
}

/** Quelle, die als Datei- oder Bildinhalt geladen werden darf: eingebettet (data:, blob:) oder aus dem Netz (http/https) */
export function ladbareQuelle(roh: unknown): string | null {
  if (typeof roh !== 'string' || !roh) return null;
  if (/^data:/i.test(roh) || /^blob:/i.test(roh)) return roh;
  const p = protokoll(roh);
  return p === 'http:' || p === 'https:' ? roh : null;
}

/** Verweis in fremdem Inhalt (Word-Dokument): nur Web und E-Mail */
export function sichererVerweis(roh: unknown): string | null {
  if (typeof roh !== 'string' || !roh.trim()) return null;
  if (roh.trim().startsWith('#')) return roh.trim();
  const p = protokoll(roh.trim());
  return p === 'http:' || p === 'https:' || p === 'mailto:' || p === 'tel:' ? roh.trim() : null;
}

/**
 * Ein von docx-preview aufgebautes Dokument entschärfen: keine eingebetteten Rahmen oder Skripte, Verweise nur
 * ins Web (in neuem Tab, ohne Rückgriff auf dieses Fenster).
 */
export function wordEntschaerfen(wurzel: HTMLElement): void {
  wurzel.querySelectorAll('iframe, object, embed, script, frame, frameset, base, meta, link').forEach((e) => e.remove());
  wurzel.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
    const ziel = sichererVerweis(a.getAttribute('href'));
    if (!ziel) { a.removeAttribute('href'); return; }
    if (!ziel.startsWith('#')) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
  });
  wurzel.querySelectorAll('*').forEach((e) => {
    for (const at of [...e.attributes]) if (/^on/i.test(at.name)) e.removeAttribute(at.name);
  });
}

/**
 * M450: Foto einer Kontakt-Karte — nur ein eingebettetes Rasterbild (data:image/png|jpeg|gif|webp). Keine Webadresse
 * (die fragte beim Anzeigen einen fremden Server an), kein SVG (darin können Skripte stehen), nichts über 1,5 MB.
 */
export function kontaktBild(roh: unknown): string | null {
  if (typeof roh !== 'string' || roh.length > 1_500_000) return null;
  return /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i.test(roh) ? roh : null;
}

/**
 * M458: Text, der von außen hereinkommt (Browser-Erweiterung, Teilen-Adresse). Nur Zeichenketten; Steuerzeichen
 * außer Zeilenumbruch und Tabulator fallen weg, Länge gedeckelt. Spitze Klammern bleiben stehen — der Text landet
 * ausschließlich als TEXT in Notiz und Dialog (nie als HTML), ein „<script>" darin ist dort nur Buchstaben.
 */
export function textVonAussen(roh: unknown, hoechstens = 20_000): string {
  if (typeof roh !== 'string') return '';
  return roh.normalize('NFC').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g, '').trim().slice(0, hoechstens);
}

/**
 * M466: Mail-Inhalt aus Microsoft Graph (meist HTML) als reiner Text für die E-Mail-Karte. Das HTML wird nur in ein
 * TRÄGES Dokument geparst (DOMParser: keine Skripte, keine Ereignisse, kein Nachladen von Bildern oder Styles), dann
 * fallen script/style/head/Formulare weg, Blöcke werden Zeilenumbrüche, und am Ende gilt dieselbe Säuberung wie für
 * jeden Text von außen. Auf dem Board steht danach nie HTML — ein „<script>" in der Mail bleibt Buchstabe oder fällt weg.
 */
export function mailTextVonAussen(roh: unknown, art: 'html' | 'text' = 'html', hoechstens = 200_000): string {
  if (typeof roh !== 'string') return '';
  if (art === 'text') return textVonAussen(roh, hoechstens);
  const doc = new DOMParser().parseFromString(roh.slice(0, 2_000_000), 'text/html');
  doc.querySelectorAll('script, style, head, noscript, template, iframe, object, embed, svg, form').forEach((el) => el.remove());
  doc.querySelectorAll('br').forEach((el) => el.replaceWith('\n'));
  doc.querySelectorAll('p, div, li, tr, h1, h2, h3, h4, h5, h6, blockquote, table').forEach((el) => el.append('\n'));
  const text = (doc.body?.textContent ?? '').replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  return textVonAussen(text, hoechstens);
}

/** M458: Webadresse von außen (Quelle einer gesendeten Seite) — nur http(s), höchstens 2 000 Zeichen */
export function webAdresseVonAussen(roh: unknown): string | null {
  if (typeof roh !== 'string' || !roh.trim() || roh.length > 2000) return null;
  try {
    const u = new URL(roh.trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch { return null; }
}

/**
 * M458: Eingebettetes Rasterbild von außen (Bild oder Bildschirmfoto aus der Browser-Erweiterung): nur
 * data:image/png|jpeg|gif|webp als base64 — kein SVG (darin können Skripte stehen), keine Webadresse.
 */
export function rasterBildVonAussen(roh: unknown, hoechstens = 25_000_000): string | null {
  if (typeof roh !== 'string' || roh.length > hoechstens) return null;
  return /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i.test(roh) ? roh : null;
}

/**
 * M457: Kontakt-Felder, die aus einer fremden E-Mail (Signatur) oder aus einer KI-Antwort stammen. Nur Text, gekürzt,
 * ohne Steuerzeichen; E-Mail nur in Adressform, Webseite nur http(s) (auch ohne „https://“ geschrieben), Rufnummern
 * höchstens zwölf, kein Foto. Felder, die nicht als brauchbarer Text kommen, fehlen im Ergebnis.
 */
export function kontaktVonAussen(roh: unknown): Partial<KontaktData> {
  const o = (roh && typeof roh === 'object' && !Array.isArray(roh) ? roh : {}) as Record<string, unknown>;
  const text = (v: unknown, max: number, zeilen = false): string => (typeof v === 'string'
    ? (zeilen ? v.replace(/\r\n?/g, '\n') : v.replace(/\s+/g, ' '))
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '')
      .split('\n').map((z) => z.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n').slice(0, max)
    : '');
  const aus: Partial<KontaktData> = {};
  const name = text(o.name, 120); if (name) aus.name = name;
  const funktion = text(o.funktion, 160); if (funktion) aus.funktion = funktion;
  const firma = text(o.firma, 160); if (firma) aus.firma = firma;
  const adresse = text(o.adresse, 300, true); if (adresse) aus.adresse = adresse;
  const webRoh = text(o.web, 200);
  const web = webRoh && fremdeWebAdresse(/^[a-z][a-z0-9+.-]*:/i.test(webRoh) ? webRoh : `https://${webRoh}`);
  if (web) aus.web = webRoh.replace(/\/+$/, '');
  if (Array.isArray(o.telefone)) {
    const telefone = o.telefone.map((t): KontaktTelefon | null => {
      const r = (typeof t === 'string' ? { nummer: t } : t) as Record<string, unknown> | null;
      const nummer = text(r?.nummer, 40);
      const art = text(r?.art, 30);
      return nummer && /^[+(]?\d[\d\s()/.\-–]{4,}\d$/.test(nummer) ? { nummer, ...(art ? { art } : {}) } : null;
    }).filter((t): t is KontaktTelefon => !!t).slice(0, 12);
    if (telefone.length) aus.telefone = telefone;
  }
  if (Array.isArray(o.emails)) {
    const emails = o.emails.map((m) => text(m, 200)).filter((m) => /^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(m)).slice(0, 8);
    if (emails.length) aus.emails = emails;
  }
  return aus;
}

const endlich = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Ist das eine Karte, mit der das Board umgehen kann? Eine Karte ohne Lage oder Inhalt bringt die Fläche zum
 * Absturz — und weil der Stand gespeichert wird, auch nach jedem Neuladen wieder.
 */
export function karteGueltig(n: unknown): n is AppNode {
  const k = n as { id?: unknown; type?: unknown; position?: { x?: unknown; y?: unknown }; data?: unknown; width?: unknown; height?: unknown } | null;
  if (!k || typeof k !== 'object' || Array.isArray(k)) return false;
  if (typeof k.id !== 'string' || !k.id || k.id.length > 200) return false;
  if (typeof k.type !== 'string' || !k.type || k.type.length > 40) return false;
  if (!k.position || typeof k.position !== 'object' || !endlich(k.position.x) || !endlich(k.position.y)) return false;
  if (!k.data || typeof k.data !== 'object' || Array.isArray(k.data)) return false;
  if (k.width !== undefined && k.width !== null && !endlich(k.width)) return false;
  if (k.height !== undefined && k.height !== null && !endlich(k.height)) return false;
  return true;
}

/**
 * Adressen in einer Karte entschärfen, die von außen kam: Eine „Live"-Seite, die keine fremde Webseite ist,
 * verliert ihre Adresse; Datei- und Bildquellen mit fremdem Schema werden geleert. Gibt dieselbe Karte zurück,
 * wenn nichts zu tun war.
 * M453: Zeitpunkte (angelegt/geaendert) müssen glaubhafte Zahlen sein und dürfen nicht in der Zukunft liegen.
 */
export function karteEntschaerfen<T extends AppNode>(n0: T): T {
  const n = zeitSaeubern(n0);
  const d = n.data as Record<string, unknown>;
  if (n.type === 'htmlapp' && d.url !== undefined && !fremdeWebAdresse(d.url)) {
    const { url: _u, live: _l, ...rest } = d;
    return { ...n, data: rest } as T;
  }
  if ((n.type === 'file' || n.type === 'sheet') && d.dataUrl !== undefined && !(typeof d.dataUrl === 'string' && /^(data:|blob:)/i.test(d.dataUrl))) {
    const { dataUrl: _d, ...rest } = d;
    return { ...n, data: rest } as T;
  }
  if (n.type === 'kontakt' && d.foto !== undefined && !kontaktBild(d.foto)) {
    const { foto: _f, ...rest } = d;
    return { ...n, data: rest } as T;
  }
  if (n.type === 'image' && d.src !== undefined && !ladbareQuelle(d.src)) {
    return { ...n, data: { ...d, src: '' } } as T;
  }
  if (n.type === 'email' && Array.isArray(d.attachments) && d.attachments.some((a) => a && typeof (a as { dataUrl?: unknown }).dataUrl === 'string' && !/^(data:|blob:)/i.test((a as { dataUrl: string }).dataUrl))) {
    return { ...n, data: { ...d, attachments: d.attachments.map((a) => { const x = a as { dataUrl?: unknown }; return typeof x?.dataUrl === 'string' && !/^(data:|blob:)/i.test(x.dataUrl) ? { ...x, dataUrl: undefined } : a; }) } } as T;
  }
  return n;
}

/**
 * M470: Zeitpunkte eines Sync-Stands von außen (Ordner, WebDAV, Konto über fremdStandEinarbeiten): angelegt/geaendert
 * der Karten und `spalteSeit` der Tickets müssen glaubhaft sein (zeitSaeubern) — sonst stünde ein Ticket „seit -40
 * Tagen" in seiner Spalte oder ein Stempel aus der Zukunft gewönne jeden Abgleich. Sonst bleibt alles, wie es kam.
 */
export function zeitenVonAussen<T extends { nodes?: unknown }>(boards: T[]): T[] {
  if (!Array.isArray(boards)) return boards;
  return boards.map((b) => {
    if (!b || typeof b !== 'object' || !Array.isArray(b.nodes)) return b;
    let anders = false;
    const nodes = (b.nodes as AppNode[]).map((n) => {
      if (!n || typeof n !== 'object') return n;
      const s = zeitSaeubern(n);
      if (s !== n) anders = true;
      return s;
    });
    return anders ? { ...b, nodes } : b;
  });
}

/** Karten eines fremden Boards: Ungültiges fällt weg, Adressen werden entschärft */
export function kartenVonAussen(nodes: unknown): AppNode[] {
  if (!Array.isArray(nodes)) return [];
  return nodes.filter(karteGueltig).map(karteEntschaerfen);
}

/**
 * Ein Board, das ein Server oder ein anderes Gerät geliefert hat. Geprüft wird die Gestalt (ein Board, das keine
 * Kartenliste hat, lässt die Zusammenführung abstürzen — und damit den Abgleich des ganzen Kontos), ungültige
 * Stücke fallen weg, Adressen werden entschärft. Die KENNUNG bestimmt, wer das Board angefordert hat — nie der
 * Inhalt: Stünde in der Datei von Board X die Kennung von Board Y, überschriebe sie hier sonst Y.
 * Gibt null zurück, wenn es kein Board ist.
 */
export function boardVonAussen(roh: unknown, id: string): BoardDoc | null {
  const b = roh as Partial<BoardDoc> | null;
  if (!b || typeof b !== 'object' || Array.isArray(b) || !Array.isArray(b.nodes)) return null;
  const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
  const liste = <T,>(v: unknown, gut: (x: T) => boolean): T[] => (Array.isArray(v) ? (v as T[]).filter((x) => !!x && typeof x === 'object' && text((x as { id?: unknown }).id) && gut(x)) : []);
  return {
    ...(b as BoardDoc),
    id,
    name: typeof b.name === 'string' ? b.name.slice(0, 200) : 'Board',
    nodes: kartenVonAussen(b.nodes),
    edges: liste<BoardDoc['edges'][number]>(b.edges, (e) => text(e.source) && text(e.target)),
    ...(b.drawings !== undefined ? { drawings: liste<NonNullable<BoardDoc['drawings']>[number]>(b.drawings, (s) => Array.isArray(s.points)) } : {}),
    ...(b.comments !== undefined ? { comments: liste<NonNullable<BoardDoc['comments']>[number]>(b.comments, (c) => Array.isArray(c.msgs)) } : {}),
  };
}
