// M388: Was von außen kommt, wird geprüft, bevor es der Browser als Adresse, Seite oder Karte nimmt.
//
// Boards reisen: als Link, als Datei, über die Freigabe, über den Live-Kanal. Ihr Inhalt stammt dann von
// anderen — und alles, was daraus zu einer ADRESSE wird (eingebettete Seite, Download, Bildquelle), könnte
// statt „https://…" auch „javascript:…" heißen. Der Browser führt so etwas im Namen von PixiNotes aus, mit
// Zugriff auf alles, was hier gespeichert ist. Darum entscheidet an jeder solchen Stelle diese Datei, nicht
// der Board-Inhalt.
import type { AppNode } from '../types';
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
 */
export function karteEntschaerfen<T extends AppNode>(n: T): T {
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
