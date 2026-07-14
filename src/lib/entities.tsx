// Smart Layer: erkennt Telefonnummern (libphonenumber-js), Links und
// E-Mail-Adressen in beliebigem Text und macht sie klickbar.
// Reihenfolge bewusst: URLs zuerst — Telefonnummern in URLs (z. B.
// wa.me/4917…) dürfen den Link nicht zerschneiden (Audit N4).
import type { ReactNode } from 'react';
import { findPhoneNumbersInText } from 'libphonenumber-js';

const URL_RE = /https?:\/\/[^\s<>"')]+/g;
const MAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]{2,}/g;

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

  // 1. URLs
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
  const overlaps = (start: number, end: number) =>
    matches.some((x) => start < x.end && end > x.start);

  // 2. E-Mail-Adressen (außerhalb von URLs)
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

  // 3. Telefonnummern (außerhalb von URLs/Mails)
  try {
    for (const p of findPhoneNumbersInText(text, 'DE')) {
      if (overlaps(p.startsAt, p.endsAt)) continue;
      const display = text.slice(p.startsAt, p.endsAt);
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
