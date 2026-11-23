/**
 * M467: baut eine kleine Outlook-Nachricht (.msg) für die Prüfreihen — ohne eingecheckte Binärdatei.
 *
 * Nutzt den CFB-Schreiber von @kenjiuno/msgreader (lib/Burner.js). Betreff, Absendername und Text stehen als
 * ANSI-Zeichenketten (Typ 001E, windows-1252 mit Umlauten) — genau dieser Weg braucht iconv-lite und damit den
 * Buffer-/Stream-Ersatz im Browser. Dazu die Absender-Adresse als Unicode (001F) und ein Anhang „bericht.txt".
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { burn } = require('@kenjiuno/msgreader/lib/Burner.js');

const ROOT = 5; const DIRECTORY = 1; const DOCUMENT = 2;

/** windows-1252 für die Zeichen, die hier vorkommen (ASCII + deutsche Umlaute) */
const ansi = (s) => Uint8Array.from([...s].map((c) => ({ ä: 0xe4, ö: 0xf6, ü: 0xfc, Ä: 0xc4, Ö: 0xd6, Ü: 0xdc, ß: 0xdf })[c] ?? c.charCodeAt(0)));
const utf16 = (s) => { const b = new Uint8Array(s.length * 2); for (let i = 0; i < s.length; i += 1) { b[i * 2] = s.charCodeAt(i) & 0xff; b[i * 2 + 1] = s.charCodeAt(i) >> 8; } return b; };
const nameVon = (tag, typ) => `__substg1.0_${tag}${typ}`;

/**
 * Eigenschaften-Strom: Kopf (32 Byte Wurzel, 8 Byte Anhang) + je Eintrag 16 Byte (Tag, Flags, Länge/Wert).
 * Variable Werte (Zeichenketten, Binär) stehen als eigene Ströme daneben; hier steht nur ihre Länge.
 */
function eigenschaften(kopf, eintraege) {
  const b = new Uint8Array(kopf + eintraege.length * 16);
  const dv = new DataView(b.buffer);
  eintraege.forEach(([tag, laenge], i) => {
    const o = kopf + i * 16;
    dv.setUint32(o, tag, true);
    dv.setUint32(o + 4, 0x6, true);
    dv.setUint32(o + 8, laenge, true);
  });
  return b;
}

export function msgBauen({ betreff, absender, adresse, text, anhangName, anhangText }) {
  const anhang = new TextEncoder().encode(anhangText);
  const dok = (name, daten) => ({ name, type: DOCUMENT, length: daten.length, binaryProvider: () => daten });
  const wurzel = [
    dok(nameVon('0037', '001E'), ansi(betreff)),
    dok(nameVon('0C1A', '001E'), ansi(absender)),
    dok(nameVon('0C1F', '001F'), utf16(adresse)),
    dok(nameVon('1000', '001E'), ansi(text)),
  ];
  const anh = [
    dok(nameVon('3707', '001F'), utf16(anhangName)),
    dok(nameVon('3704', '001F'), utf16(anhangName)),
    dok(nameVon('3701', '0102'), anhang),
  ];
  const props = eigenschaften(32, [
    [0x0037001e, ansi(betreff).length + 1],
    [0x0c1a001e, ansi(absender).length + 1],
    [0x1000001e, ansi(text).length + 1],
  ]);
  const anhProps = eigenschaften(8, [[0x37010102, anhang.length]]);
  const eintraege = [{ name: 'Root Entry', type: ROOT, length: 0, children: [] }];
  const dazu = (eltern, e) => { eintraege[eltern].children.push(eintraege.length); eintraege.push(e); return eintraege.length - 1; };
  for (const d of wurzel) dazu(0, d);
  dazu(0, dok('__properties_version1.0', props));
  dazu(0, { name: '__nameid_version1.0', type: DIRECTORY, length: 0, children: [] });
  const a = dazu(0, { name: '__attach_version1.0_#00000000', type: DIRECTORY, length: 0, children: [] });
  for (const d of anh) dazu(a, d);
  dazu(a, dok('__properties_version1.0', anhProps));
  return Buffer.from(burn(eintraege));
}

export const MSG_BEISPIEL = {
  betreff: 'Prüfbericht Größe',
  absender: 'Jörg Müller',
  adresse: 'joerg.mueller@example.org',
  text: 'Grüße aus dem Büro, anbei der Bericht.',
  anhangName: 'bericht.txt',
  anhangText: 'Inhalt des Berichts',
};
