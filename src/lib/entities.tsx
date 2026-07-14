// Smart Layer: erkennt Telefonnummern (libphonenumber-js), Links, Dateipfade
// und E-Mail-Adressen in beliebigem Text und macht sie klickbar.
// Reihenfolge bewusst: URLs & Pfade zuerst — Telefonnummern in URLs (z. B.
// wa.me/4917…) oder Datumsangaben in Dateinamen dürfen den Treffer nicht
// zerschneiden (Audit N4 + Praxis-Bug: „08.07.2026" ist keine Rufnummer).
import type { ReactNode } from 'react';
import { findPhoneNumbersInText } from 'libphonenumber-js';

const URL_RE = /https?:\/\/[^\s<>"')]+/g;
/** file://-Links (Netzlaufwerke) — im Büroalltag allgegenwärtig */
const FILE_RE = /file:\/\/[^\s<>"']+/g;
/** Windows-Pfade: Laufwerk (Q:\…) oder UNC (\\server\…) */
const WINPATH_RE = /(?:[A-Za-z]:\\|\\\\)[^\s<>"']+/g;
const MAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]{2,}/g;

/**
 * Sieht der Treffer wie ein Datum aus? „08.07.2026", „8.7.26", „2026-07-08" —
 * libphonenumber hält solche Ziffernfolgen sonst für gültige Rufnummern.
 */
const DATE_LIKE_RE = /^\s*(\d{1,2}[.\-/]\s?\d{1,2}[.\-/]\s?\d{2,4}|\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2})\s*\.?\s*$/;

interface Match {
  start: number;
  end: number;
  node: ReactNode;
}

/** Satzzeichen am Match-Ende gehören zum Satz, nicht zum Link (Audit N3). */
function trimTrailing(raw: string): string {
  return raw.replace(/[.,;:!?)\]]+$/, '');
}

export function enrichText(text: string): ReactNode[] {
  const matches: Match[] = [];
  const overlaps = (start: number, end: number) =>
    matches.some((x) => start < x.end && end > x.start);

  // 1. Web-Links
  for (const m of text.matchAll(URL_RE)) {
    const url = trimTrailing(m[0]);
    if (!url) continue;
    matches.push({
      start: m.index!,
      end: m.index! + url.length,
      node: (
        <a key={`u${m.index}`} href={url} target="_blank" rel="noreferrer" className="ent-link">
          {url}
        </a>
      ),
    });
  }

  // 2. file://-Links (klickbar — aus der lokal geöffneten App heraus nutzbar)
  for (const m of text.matchAll(FILE_RE)) {
    const url = trimTrailing(m[0]);
    if (!url || overlaps(m.index!, m.index! + url.length)) continue;
    matches.push({
      start: m.index!,
      end: m.index! + url.length,
      node: (
        <a key={`f${m.index}`} href={url} className="ent-link ent-path" title="Datei/Ordner öffnen (je nach Browser-Einstellung)">
          {url}
        </a>
      ),
    });
  }

  // 3. Windows-Pfade: geschützte Zone (kein ☎/@ mitten im Dateinamen), dezent als Pfad gesetzt
  for (const m of text.matchAll(WINPATH_RE)) {
    const path = trimTrailing(m[0]);
    if (!path || overlaps(m.index!, m.index! + path.length)) continue;
    matches.push({
      start: m.index!,
      end: m.index! + path.length,
      node: (
        <span key={`p${m.index}`} className="ent-path">
          {path}
        </span>
      ),
    });
  }

  // 4. E-Mail-Adressen (außerhalb von URLs/Pfaden)
  for (const m of text.matchAll(MAIL_RE)) {
    const addr = trimTrailing(m[0]);
    if (!addr || overlaps(m.index!, m.index! + addr.length)) continue;
    matches.push({
      start: m.index!,
      end: m.index! + addr.length,
      node: (
        <a key={`m${m.index}`} href={`mailto:${addr}`} className="ent-link">
          {addr}
        </a>
      ),
    });
  }

  // 5. Telefonnummern (außerhalb von URLs/Pfaden/Mails, keine Datumsangaben)
  try {
    for (const p of findPhoneNumbersInText(text, 'DE')) {
      if (overlaps(p.startsAt, p.endsAt)) continue;
      const display = text.slice(p.startsAt, p.endsAt);
      // Datum statt Rufnummer? Auch den unmittelbaren Kontext prüfen, falls
      // libphonenumber nur einen Teil des Datums erwischt hat (z. B. „07.2026").
      const context = text.slice(Math.max(0, p.startsAt - 3), Math.min(text.length, p.endsAt + 3));
      if (DATE_LIKE_RE.test(display) || /\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}/.test(context)) continue;
      matches.push({
        start: p.startsAt,
        end: p.endsAt,
        node: (
          <a
            key={`t${p.startsAt}`}
            href={`tel:${p.number.number}`}
            className="ent-tel"
            title={`${p.number.number} anrufen`}
          >
            ☎ {display}
          </a>
        ),
      });
    }
  } catch {
    // Erkennung ist Komfort — bei Fehlern einfach ohne Telefon-Links rendern
  }

  matches.sort((a, b) => a.start - b.start);

  const out: ReactNode[] = [];
  let pos = 0;
  for (const m of matches) {
    if (m.start < pos) continue; // Sicherheitsnetz gegen Restüberlappung
    if (m.start > pos) out.push(text.slice(pos, m.start));
    out.push(m.node);
    pos = m.end;
  }
  if (pos < text.length) out.push(text.slice(pos));
  return out;
}
