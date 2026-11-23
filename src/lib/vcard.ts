// M450: vCard (.vcf) lesen und schreiben — für die Kontakt-Karte.
//
// Bewusst selbst geschrieben statt einer Bibliothek: Gebraucht werden ein Dutzend Felder, und die Stolpersteine sind
// immer dieselben — gefaltete Zeilen (RFC 6350 §3.2), Quoted-Printable mit Zeichensatz aus Outlook/Android (vCard 2.1),
// Gruppen-Präfixe („item1.TEL“ aus Apple), maskierte Kommas und Semikolons, Bilder als Base64 oder data:-Adresse.
// Gelesen werden 2.1, 3.0 und 4.0; geschrieben wird 3.0 — das lesen Outlook, Apple, Google und Android gleichermaßen.
//
// Was von außen kommt, ist Text — eine Adresse wird daraus erst in der Karte (tel:, mailto:, Kartenlink), und das
// Foto nur, wenn es ein eingebettetes Bild ist (lib/sicher.ts kontaktBild). Fremde Bildadressen (PHOTO;VALUE=uri:
// https://…) fallen weg: Sie würden beim Anzeigen einen fremden Server anfragen.
import { rufnummern } from './rufnummer';
import type { KontaktData, KontaktTelefon } from '../types';
import { kontaktBild } from './sicher';

/** Höchstens so viele Kontakte aus einer Datei — ein ganzes Adressbuch soll das Board nicht fluten */
export const VCARD_MAX = 60;
const FELD_MAX = 2000;

interface Eigenschaft { name: string; params: Record<string, string[]>; wert: string }

/** Bytes einer .vcf-Datei als Text: UTF-8, sonst Windows-1252 (ältere Outlook-Exporte) */
export function vcardText(daten: ArrayBuffer): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(daten); } catch { return new TextDecoder('windows-1252').decode(daten); }
}

/** Zeilen entfalten: Fortsetzung beginnt mit Leerzeichen/Tab (RFC 6350), bei Quoted-Printable endet die Zeile auf „=“ */
function logischeZeilen(text: string): string[] {
  const roh = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const aus: string[] = [];
  for (const z of roh) {
    const letzte = aus.length - 1;
    if (letzte >= 0 && /^[ \t]/.test(z)) { aus[letzte] += z.slice(1); continue; }
    if (letzte >= 0 && /quoted-printable/i.test(kopfVon(aus[letzte])) && aus[letzte].endsWith('=')) { aus[letzte] = aus[letzte].slice(0, -1) + z; continue; }
    aus.push(z);
  }
  return aus.filter((z) => z.trim() !== '');
}

/** Der Teil vor dem ersten Doppelpunkt außerhalb von Anführungszeichen */
function trennStelle(z: string): number {
  let inQ = false;
  for (let i = 0; i < z.length; i += 1) {
    if (z[i] === '"') inQ = !inQ;
    else if (z[i] === ':' && !inQ) return i;
  }
  return -1;
}
const kopfVon = (z: string) => { const i = trennStelle(z); return i < 0 ? z : z.slice(0, i); };

function teileAusserhalbQuotes(s: string, zeichen: string): string[] {
  const teile: string[] = []; let akt = ''; let inQ = false;
  for (const c of s) {
    if (c === '"') { inQ = !inQ; continue; }
    if (c === zeichen && !inQ) { teile.push(akt); akt = ''; continue; }
    akt += c;
  }
  teile.push(akt);
  return teile;
}

function zerlegeZeile(z: string): Eigenschaft | null {
  const i = trennStelle(z);
  if (i < 0) return null;
  const [nameRoh, ...paramTeile] = teileAusserhalbQuotes(z.slice(0, i), ';');
  const name = (nameRoh.split('.').pop() ?? '').trim().toUpperCase();
  const params: Record<string, string[]> = {};
  const dazu = (k: string, v: string[]) => { params[k] = [...(params[k] ?? []), ...v.map((x) => x.trim()).filter(Boolean)]; };
  for (const p of paramTeile) {
    const gl = p.indexOf('=');
    if (gl < 0) {
      // vCard 2.1: nackte Parameter („TEL;CELL;VOICE:“, „;QUOTED-PRINTABLE:“)
      const v = p.trim().toUpperCase();
      if (v === 'QUOTED-PRINTABLE' || v === 'BASE64' || v === 'B') dazu('ENCODING', [v]);
      else if (v) dazu('TYPE', [v]);
    } else dazu(p.slice(0, gl).trim().toUpperCase(), p.slice(gl + 1).split(','));
  }
  return { name, params, wert: z.slice(i + 1) };
}

/** Quoted-Printable → Text im angegebenen Zeichensatz */
function qpDecode(s: string, charset: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) { bytes.push(parseInt(s.slice(i + 1, i + 3), 16)); i += 2; continue; }
    const code = s.charCodeAt(i);
    if (code < 128) bytes.push(code);
    else for (const b of new TextEncoder().encode(s[i])) bytes.push(b);
  }
  try { return new TextDecoder(charset || 'utf-8').decode(new Uint8Array(bytes)); } catch { return new TextDecoder('utf-8').decode(new Uint8Array(bytes)); }
}

/** An nicht maskierten Semikolons teilen (strukturierte Werte: N, ADR, ORG) */
function teileStruktur(s: string): string[] {
  const teile: string[] = []; let akt = '';
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === '\\' && i + 1 < s.length) { akt += s[i] + s[i + 1]; i += 1; continue; }
    if (s[i] === ';') { teile.push(akt); akt = ''; continue; }
    akt += s[i];
  }
  teile.push(akt);
  return teile;
}

/** Maskierungen auflösen: \n \N \, \; \\ */
function entmaskiere(s: string): string {
  return s.replace(/\\([nN,;:\\])/g, (_m, c: string) => (c === 'n' || c === 'N' ? '\n' : c)).trim();
}

const kurz = (s: string) => s.slice(0, FELD_MAX);

/** Art einer Rufnummer aus den TYPE-Werten */
function telefonArt(typen: string[]): string {
  const t = typen.map((x) => x.toLowerCase());
  const dienst = t.includes('work');
  if (t.includes('fax')) return dienst ? 'Fax dienstlich' : 'Fax';
  if (t.includes('cell') || t.includes('mobile') || t.includes('iphone')) return dienst ? 'Mobil dienstlich' : 'Mobil';
  if (dienst) return 'Dienstlich';
  if (t.includes('home')) return 'Privat';
  if (t.includes('pager')) return 'Pager';
  return '';
}

const BILD_TYP: Record<string, string> = { JPEG: 'jpeg', JPG: 'jpeg', PNG: 'png', GIF: 'gif', WEBP: 'webp' };

/** Den Inhalt einer .vcf-Datei als Kontakte lesen (2.1, 3.0, 4.0) — eine Datei kann viele enthalten */
export function vcardLesen(text: string): KontaktData[] {
  const kontakte: KontaktData[] = [];
  let akt: Eigenschaft[] | null = null;
  for (const zeile of logischeZeilen(text)) {
    const e = zerlegeZeile(zeile);
    if (!e) continue;
    if (e.name === 'BEGIN' && /^vcard$/i.test(e.wert.trim())) { akt = []; continue; }
    if (e.name === 'END' && /^vcard$/i.test(e.wert.trim())) {
      if (akt) { const k = ausEigenschaften(akt); if (k) kontakte.push(k); }
      akt = null;
      if (kontakte.length >= VCARD_MAX) break;
      continue;
    }
    if (akt) akt.push(e);
  }
  return kontakte;
}

function ausEigenschaften(liste: Eigenschaft[]): KontaktData | null {
  const k: KontaktData = { name: '', telefone: [], emails: [] };
  let nName = ''; let adr = ''; let rolle = '';
  for (const e of liste) {
    const enc = (e.params.ENCODING?.[0] ?? '').toUpperCase();
    const roh = enc === 'QUOTED-PRINTABLE' ? qpDecode(e.wert, e.params.CHARSET?.[0] ?? 'utf-8') : e.wert;
    const typen = [...(e.params.TYPE ?? [])];
    switch (e.name) {
      case 'FN': k.name = kurz(entmaskiere(roh)); break;
      case 'N': {
        const [fam = '', vor = '', weitere = '', pre = '', suf = ''] = teileStruktur(roh).map(entmaskiere);
        nName = [pre, vor, weitere, fam, suf].filter(Boolean).join(' ');
        break;
      }
      case 'ORG': if (!k.firma) k.firma = kurz(teileStruktur(roh).map(entmaskiere).filter(Boolean).join(', ')); break;
      case 'TITLE': if (!k.funktion) k.funktion = kurz(entmaskiere(roh)); break;
      case 'ROLE': if (!rolle) rolle = kurz(entmaskiere(roh)); break;
      case 'TEL': {
        const nummer = entmaskiere(roh).replace(/^tel:/i, '').slice(0, 60);
        if (nummer && k.telefone.length < 12) k.telefone.push({ art: telefonArt(typen) || undefined, nummer });
        break;
      }
      case 'EMAIL': {
        const mail = entmaskiere(roh).replace(/^mailto:/i, '').slice(0, 200);
        if (mail && k.emails.length < 8 && !k.emails.includes(mail)) k.emails.push(mail);
        break;
      }
      case 'ADR': {
        if (adr) break;
        const [, ext = '', strasse = '', ort = '', region = '', plz = '', land = ''] = teileStruktur(roh).map(entmaskiere);
        adr = [[strasse, ext].filter(Boolean).join(', '), [plz, ort].filter(Boolean).join(' '), region, land].filter(Boolean).join('\n');
        break;
      }
      case 'LABEL': if (!adr) adr = entmaskiere(roh); break;
      case 'URL': if (!k.web) k.web = entmaskiere(roh).slice(0, 500); break;
      case 'NOTE': k.notiz = kurz(k.notiz ? `${k.notiz}\n${entmaskiere(roh)}` : entmaskiere(roh)); break;
      case 'PHOTO': {
        if (k.foto) break;
        const w = roh.replace(/\s+/g, '');
        let quelle: string | null = null;
        if (/^data:image\//i.test(w)) quelle = w;
        else if (enc === 'B' || enc === 'BASE64') {
          const t = (typen[0] ?? e.params.MEDIATYPE?.[0] ?? 'JPEG').toUpperCase().replace(/^IMAGE\//, '');
          quelle = `data:image/${BILD_TYP[t] ?? 'jpeg'};base64,${w}`;
        }
        const bild = kontaktBild(quelle);
        if (bild) k.foto = bild;
        break;
      }
      default: break;
    }
  }
  if (!k.name) k.name = nName || k.firma || k.emails[0] || '';
  if (!k.funktion && rolle) k.funktion = rolle;
  if (adr) k.adresse = kurz(adr);
  if (!k.name && !k.telefone.length && !k.emails.length) return null;
  return k;
}

/* ════════════════════════════ SCHREIBEN ════════════════════════════ */

function maskiere(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

/** Zeile auf 75 Bytes falten, ohne ein UTF-8-Zeichen zu zerschneiden (RFC 6350 §3.2) */
function falte(z: string): string {
  const enc = new TextEncoder();
  const teile: string[] = []; let akt = ''; let bytes = 0;
  for (const c of z) {
    const b = enc.encode(c).length;
    const grenze = teile.length === 0 ? 75 : 74;   // Folgezeilen beginnen mit einem Leerzeichen
    if (bytes + b > grenze) { teile.push(akt); akt = ''; bytes = 0; }
    akt += c; bytes += b;
  }
  teile.push(akt);
  return teile.join('\r\n ');
}

/** Name in Nachname und Vorname: „Müller, Anna“ oder „Anna Müller“ */
function nameTeile(name: string): [string, string] {
  const n = name.trim();
  if (n.includes(',')) { const [fam, ...rest] = n.split(','); return [fam.trim(), rest.join(',').trim()]; }
  const w = n.split(/\s+/);
  return w.length > 1 ? [w[w.length - 1], w.slice(0, -1).join(' ')] : [n, ''];
}

/** Freie Anschrift in die Teile von ADR: Zeilen vor „PLZ Ort“ sind die Straße, danach das Land */
function adrTeile(adresse: string): string[] {
  const zeilen = adresse.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const i = zeilen.findIndex((z) => /^[A-Z]{0,2}-?\d{4,5}\s+\S/.test(z));
  if (i < 0) return ['', '', zeilen.join(', '), '', '', '', ''];
  const m = /^([A-Z]{0,2}-?\d{4,5})\s+(.+)$/.exec(zeilen[i])!;
  return ['', '', zeilen.slice(0, i).join(', '), m[2], '', m[1], zeilen.slice(i + 1).join(', ')];
}

function telTyp(art?: string): string {
  const a = (art ?? '').toLowerCase();
  const t: string[] = [];
  if (/dienst|arbeit|büro|work/.test(a)) t.push('WORK');
  if (/privat|home/.test(a)) t.push('HOME');
  if (/mobil|handy|cell/.test(a)) t.push('CELL');
  else if (/fax/.test(a)) t.push('FAX');
  else t.push('VOICE');
  return t.join(',');
}

/** Ein Kontakt als vCard 3.0 */
export function vcardSchreiben(k: KontaktData): string {
  const name = (k.name ?? '').trim() || (k.firma ?? '').trim() || 'Kontakt';
  const [fam, vor] = nameTeile(name);
  const z = ['BEGIN:VCARD', 'VERSION:3.0', 'PRODID:-//PixiNotes//DE', `N:${maskiere(fam)};${maskiere(vor)};;;`, `FN:${maskiere(name)}`];
  if (k.firma?.trim()) z.push(`ORG:${maskiere(k.firma.trim())}`);
  if (k.funktion?.trim()) z.push(`TITLE:${maskiere(k.funktion.trim())}`);
  for (const t of k.telefone ?? []) if (t.nummer?.trim()) z.push(`TEL;TYPE=${telTyp(t.art)}:${maskiere(t.nummer.trim())}`);
  for (const m of k.emails ?? []) if (m?.trim()) z.push(`EMAIL;TYPE=INTERNET:${maskiere(m.trim())}`);
  if (k.adresse?.trim()) z.push(`ADR;TYPE=WORK:${adrTeile(k.adresse).map(maskiere).join(';')}`);
  if (k.web?.trim()) z.push(`URL:${k.web.trim().replace(/[\r\n]/g, '')}`);
  if (k.notiz?.trim()) z.push(`NOTE:${maskiere(k.notiz.trim())}`);
  const foto = kontaktBild(k.foto);
  const m = foto ? /^data:image\/([a-z+]+);base64,(.+)$/i.exec(foto) : null;
  if (m) z.push(`PHOTO;ENCODING=b;TYPE=${m[1].toUpperCase() === 'JPEG' ? 'JPEG' : m[1].toUpperCase()}:${m[2]}`);
  z.push('END:VCARD');
  return `${z.map(falte).join('\r\n')}\r\n`;
}

/** Daten in fester Gestalt — eine Karte aus einem fremden Board kann Felder anderer Art tragen.
 *  M454: aus KontaktCard.tsx hierher, damit auch KI-Operationen und der Sammel-Export sie nutzen (ohne JSX). */
export function kontaktDaten(d: Partial<KontaktData> | undefined): KontaktData {
  const text = (v: unknown) => (typeof v === 'string' ? v : '');
  const telefone = (Array.isArray(d?.telefone) ? d!.telefone : [])
    .filter((t): t is KontaktTelefon => !!t && typeof t === 'object' && typeof (t as KontaktTelefon).nummer === 'string')
    .map((t) => ({ nummer: t.nummer, ...(typeof t.art === 'string' && t.art ? { art: t.art } : {}) }));
  const emails = (Array.isArray(d?.emails) ? d!.emails : []).filter((m): m is string => typeof m === 'string');
  return {
    ...d,
    name: text(d?.name), funktion: text(d?.funktion), firma: text(d?.firma), adresse: text(d?.adresse),
    web: text(d?.web), notiz: text(d?.notiz), telefone, emails, foto: kontaktBild(d?.foto) ?? undefined,
  };
}

/** M454: Mehrere Kontakte in EINER Datei — vCards hintereinander, so wie Outlook, Apple und Google ein Adressbuch
 *  exportieren und wieder einlesen */
export function vcardSammeln(liste: KontaktData[]): string {
  return liste.map((k) => vcardSchreiben(kontaktDaten(k))).join('');
}

/**
 * Dateiname für den Export: der Name in ASCII (ä → ae, ß → ss, Akzente weg), ohne Zeichen, die Dateisysteme nicht
 * mögen. Umlaute im Dateinamen gehen nicht überall durch — Chromium ohne UTF-8-Umgebung machte daraus „download“,
 * ältere Mail-Programme verstümmeln sie im Anhang. Der Inhalt der Datei bleibt UTF-8.
 */
export function vcardDateiname(k: KontaktData | string): string {
  // M454: auch ein freier Name (Sammel-Export: „Board – 3 Kontakte“)
  const ascii = (typeof k === 'string' ? k : (k.name || k.firma || 'Kontakt'))
    .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '');
  const basis = ascii.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return `${basis || 'Kontakt'}.vcf`;
}

/** Rufnummer → tel:-Adresse: international (E.164), wenn libphonenumber sie erkennt (Inland = Deutschland), sonst Ziffern und + */
export function telAdresse(nummer: string): string | null {
  try {
    // M459: die Kontakt-Karte lädt erst mit der Erkennung (Board.tsx) — ohne sie bleibt die Ziffernfassung unten
    const p = rufnummern()?.parsePhoneNumberFromString(nummer, 'DE');
    if (p?.isPossible()) return `tel:${p.number}`;
  } catch { /* unten weiter */ }
  const n = nummer.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
  return n.replace(/\+/g, '').length >= 3 ? `tel:${n}` : null;
}
