// Smart Layer: erkennt Telefonnummern (libphonenumber-js), Links und
// E-Mail-Adressen in beliebigem Text und macht sie klickbar.
import type { ReactNode } from 'react';
import { findPhoneNumbersInText } from 'libphonenumber-js';

const URL_RE = /https?:\/\/[^\s<>"')]+/g;
const MAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]{2,}/g;

function linkifyPlain(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  // URLs und Mail-Adressen in einem Durchgang einsammeln
  const matches: { start: number; end: number; node: ReactNode }[] = [];
  for (const m of text.matchAll(URL_RE)) {
    matches.push({
      start: m.index!,
      end: m.index! + m[0].length,
      node: (
        <a key={`${keyPrefix}-u${m.index}`} href={m[0]} target="_blank" rel="noreferrer" className="ent-link">
          {m[0]}
        </a>
      ),
    });
  }
  for (const m of text.matchAll(MAIL_RE)) {
    const insideUrl = matches.some((x) => m.index! >= x.start && m.index! < x.end);
    if (insideUrl) continue;
    matches.push({
      start: m.index!,
      end: m.index! + m[0].length,
      node: (
        <a key={`${keyPrefix}-m${m.index}`} href={`mailto:${m[0]}`} className="ent-link">
          {m[0]}
        </a>
      ),
    });
  }
  matches.sort((a, b) => a.start - b.start);

  let pos = 0;
  for (const m of matches) {
    if (m.start > pos) out.push(text.slice(pos, m.start));
    out.push(m.node);
    pos = m.end;
  }
  if (pos < text.length) out.push(text.slice(pos));
  return out;
}

/**
 * Reichert Text mit klickbaren Entities an:
 * ☎️ Telefonnummern → tel:-Links (ein Klick wählt), URLs → Links, E-Mails → mailto.
 */
export function enrichText(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let phones: ReturnType<typeof findPhoneNumbersInText> = [];
  try {
    phones = findPhoneNumbersInText(text, 'DE');
  } catch {
    phones = [];
  }

  let pos = 0;
  phones.forEach((p, i) => {
    if (p.startsAt > pos) out.push(...linkifyPlain(text.slice(pos, p.startsAt), `s${i}`));
    const display = text.slice(p.startsAt, p.endsAt);
    out.push(
      <a
        key={`tel-${p.startsAt}`}
        href={`tel:${p.number.number}`}
        className="ent-tel"
        title={`${p.number.number} anrufen`}
      >
        ☎ {display}
      </a>,
    );
    pos = p.endsAt;
  });
  if (pos < text.length) out.push(...linkifyPlain(text.slice(pos), 'rest'));
  return out;
}
