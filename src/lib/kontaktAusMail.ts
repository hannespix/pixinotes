// M457: Kontakt aus der Mail-Signatur (KONZEPT.md §3.7).
//
// Auf einer E-Mail-Karte macht „Absender als Kontakt" (im ⋯ der markierten Mail) aus Absender-Kopf und Signatur eine
// Kontakt-Karte neben der Mail, mit Pfeil „Kontakt". Name und E-Mail kommen aus dem Kopf, Funktion, Firma, Rufnummern,
// Anschrift und Webseite aus der Signatur – OHNE KI per Heuristik (`signaturLesen`), weil die meisten Signaturen einem
// festen Muster folgen und das ohne Schlüssel und ohne Wartezeit gehen soll. Ist eine KI eingerichtet, verfeinert sie
// das Ergebnis (Funktion und Firma trennt sie besser, Rufnummer-Arten in fremden Sprachen kennt sie).
//
// Steht schon ein Kontakt mit derselben E-Mail auf dem Board, wird er ERGÄNZT statt doppelt angelegt: nur leere
// Felder werden gefüllt – was jemand von Hand eingetragen hat, bleibt. Alles ist ein Schritt im Verlauf.
// Alles, was aus der Mail (oder von der KI) kommt, läuft durch `kontaktVonAussen` in lib/sicher.ts.
import { findPhoneNumbersInText } from 'libphonenumber-js';
import { mutedHistory, selectActiveBoard, useBoard } from '../store';
import type { AppNode, EmailData, KontaktData, KontaktTelefon } from '../types';
import { aiReady } from './ai';
import { askJson } from './aiActions';
import { findFreeSpot, sizeOf } from './arrange';
import { makeKontakt } from './nodes';
import { kontaktVonAussen } from './sicher';
import { kontaktDaten } from './vcard';

/** Beginn eines zitierten Verlaufs: ab hier spricht nicht mehr der Absender */
const ZITAT_RE = [
  /^>/,
  /^-{2,}\s*(Original Message|Ursprüngliche Nachricht|Originalnachricht|Forwarded message|Weitergeleitete Nachricht)/i,
  /^(Am|On)\s.{4,120}\s(schrieb|wrote)\b.*:?\s*$/i,
  /^(Von|From)\s*:\s.+/i,
  /^_{8,}\s*$/,
];
/** Grußformeln, nach denen die Signatur beginnt (die letzte gilt) */
const GRUSS_RE = /^(mit\s+(den\s+)?(besten|freundlichen|herzlichen|sonnigen|kollegialen)\s+gr(ü|ue)(ß|ss)en|(mit\s+)?freundliche[nm]?\s+gr(ü|ue)(ß|ss)(e|en)|(viele|beste|liebe|herzliche|sonnige|schöne|freundliche)\s+gr(ü|ue)(ß|ss)e|gr(ü|ue)(ß|ss)e(\s+aus\s+.+)?|(mit\s+)?gru(ß|ss)|mfg|lg|vg|(best|kind|warm|warmest)\s+regards|regards|best\s+wishes|best|cheers|sincerely(\s+yours)?|yours\s+sincerely|yours\s+truly|thanks|thank\s+you|many\s+thanks|vielen\s+dank|danke)\s*[,.!]?\s*$/i;
/** Ab hier Rechtliches, Werbung, Umwelthinweis – gehört nicht mehr zum Kontakt */
const DISCLAIMER_RE = /^(diese\s+(e-?mail|nachricht)|this\s+(e-?mail|message|communication)|the\s+information\s+(contained|in\s+this)|confidential|vertraulich|disclaimer|haftungsausschluss|rechtlicher\s+hinweis|datenschutz(hinweis|erklärung)?\s*:|privacy\s+notice|please\s+consider\s+the\s+environment|bitte\s+denken\s+sie\s+an\s+die\s+umwelt|bitte\s+prüfen\s+sie|sitz\s+der\s+gesellschaft|registergericht|handelsregister|amtsgericht|geschäftsführ(er|ung)\s*:|ust-?id|vat\s+(no|id)|registered\s+(office|in)|gesendet\s+von|von\s+meinem\s+\S+\s+gesendet|sent\s+from\s+my)/i;
/** Rechtsformen und Behörden: diese Zeile ist die Firma */
const FIRMA_RE = /\b(GmbH|gGmbH|AG|KG|KGaA|OHG|GbR|UG|SE|e\.\s?V\.|eG|mbH|Co\.|Ltd\.?|Limited|LLC|LLP|Inc\.?|Corp\.?|Corporation|plc|S\.A\.|S\.à\s?r\.l\.|B\.V\.|N\.V\.|Sàrl|Stiftung|Verband|Verein|Amt|Behörde|Ministerium|Regierungspräsidium|Landratsamt|Landesamt|Stadtverwaltung|Gemeinde|Universität|Hochschule|University|College|Kanzlei|Praxis|Klinik|Klinikum|Bank|Sparkasse|Versicherung|Holding|Group|Gruppe)\b/;
/** Bezeichnungen vor Rufnummern → Art auf der Kontakt-Karte */
const TEL_ART: Array<[RegExp, string]> = [
  [/^(mobil|mobile|handy|cell|cellphone|mob|m)\b\.?/i, 'Mobil'],
  [/^(fax|telefax|f)\b\.?/i, 'Fax'],
  [/^(tel|telefon|fon|phone|ph|t|direkt|direct|durchwahl|office|büro|zentrale|switchboard|p)\b\.?/i, 'Dienstlich'],
];
const MAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const WEB_RE = /\b(?:https?:\/\/[^\s<>"'|]+|www\.[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s<>"'|]*)?)/i;
/** PLZ + Ort: Deutschland (5 Ziffern), Österreich und Schweiz (4 Ziffern), mit oder ohne Länderkürzel */
const PLZ_ORT_RE = /^(?:(?:D|DE|A|AT|CH)\s?-\s?)?\d{4,5}\s+\p{Lu}[\p{L} .'()/-]+$/u;
const LAND_RE = /^(deutschland|germany|österreich|oesterreich|austria|schweiz|switzerland|suisse|svizzera)$/i;
const STRASSE_RE = /(stra(ß|ss)e|str\.|weg|platz|allee|gasse|ring|damm|ufer|markt|steig|pfad|chaussee|postfach|p\.?\s?o\.?\s?box|street|road|avenue|lane)\b|\d+\s?[a-z]?$/i;

const kurz = (s: string): string => s.replace(/\s+/g, ' ').trim();
const ziffern = (s: string): string => s.replace(/\D/g, '');
const nameNormal = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z\u00df ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Teil der Mail, der vom Absender selbst stammt: alles vor dem ersten Zitat */
export function ohneZitat(text: string): string[] {
  const zeilen = (text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const ende = zeilen.findIndex((z) => ZITAT_RE.some((re) => re.test(z.trim())));
  return ende < 0 ? zeilen : zeilen.slice(0, ende);
}

/** Die Signatur: nach der letzten Grußformel (oder dem Trenner „-- "), vor Disclaimer und Werbung; höchstens 16 Zeilen */
export function signaturBlock(text: string): string[] {
  const zeilen = ohneZitat(text);
  let start = -1;
  for (let i = zeilen.length - 1; i >= 0; i -= 1) {
    const z = zeilen[i].trim();
    if (z === '--' || zeilen[i] === '-- ' || GRUSS_RE.test(z)) { start = i + 1; break; }
  }
  // Ohne Grußformel: die letzten Zeilen – eine Signatur steht unten
  let block = (start >= 0 ? zeilen.slice(start) : zeilen.slice(-10)).map((z) => z.trim());
  const disc = block.findIndex((z) => DISCLAIMER_RE.test(z));
  if (disc >= 0) block = block.slice(0, disc);
  // Leerzeilen weg; eine lange Leerstrecke beendet die Signatur (dahinter steht meist Werbung)
  const aus: string[] = [];
  let leer = 0;
  for (const z of block) {
    if (!z) { leer += 1; if (leer >= 2 && aus.length) break; continue; }
    leer = 0;
    if (/^[-_=*~]{3,}$/.test(z)) { if (aus.length) break; continue; }
    aus.push(z);
  }
  return aus.slice(0, 16);
}

/** „Berg, Anna" → „Anna Berg"; Anführungszeichen und Adress-Namen weg */
export function absenderName(fromName: string | undefined, fromAddress: string | undefined): string {
  let n = kurz((fromName ?? '').replace(/["'«»„“”]/g, ''));
  if (!n || n.includes('@') || n === 'Unbekannt' || (fromAddress && n.toLowerCase() === fromAddress.toLowerCase())) return '';
  n = n.replace(/\s*\(.*?\)\s*/g, ' ').trim();
  const m = /^([^,]+),\s*([^,]+)$/.exec(n);
  if (m && !FIRMA_RE.test(n)) n = `${m[2].trim()} ${m[1].trim()}`;
  return n;
}

/** Sieht die Zeile wie ein Personenname aus? 2–4 Wörter mit großen Anfangsbuchstaben, keine Ziffern */
const istName = (z: string): boolean => {
  const w = z.replace(/^(dr\.|prof\.|dipl\.-?\S*|mag\.|ing\.)\s*/gi, '').split(/\s+/).filter(Boolean);
  return w.length >= 2 && w.length <= 4 && !/\d|@/.test(z) && w.every((x) => /^\p{Lu}[\p{L}'.-]*$/u.test(x));
};

/** Rufnummern einer Zeile samt Art (aus der Bezeichnung davor) */
function rufnummern(teil: string): KontaktTelefon[] {
  const label = /^([\p{L}.]+)\s*[:.]?\s*/u.exec(teil);
  const art = label ? TEL_ART.find(([re]) => re.test(label[1]))?.[1] : undefined;
  const aus: KontaktTelefon[] = [];
  try {
    for (const p of findPhoneNumbersInText(teil, 'DE')) {
      const nummer = kurz(teil.slice(p.startsAt, p.endsAt));
      if (ziffern(nummer).length < 6) continue;
      aus.push({ nummer, ...(art ? { art } : {}) });
    }
  } catch { /* Erkennung ist Komfort */ }
  // Eine benannte Nummer, die libphonenumber nicht nimmt (Durchwahl mit Bindestrich, Fax-Kurzform) – Ziffernmuster
  if (!aus.length && art) {
    const m = /\+?\(?\d[\d\s()/.-]{5,}\d/.exec(teil.slice(label![0].length));
    if (m && ziffern(m[0]).length >= 6) aus.push({ nummer: kurz(m[0]), art });
  }
  return aus;
}

/**
 * Felder aus Kopf und Signatur – ohne KI. Rückgabe ist noch ungeprüft (läuft danach durch `kontaktVonAussen`).
 */
export function signaturLesen(mail: Pick<EmailData, 'fromName' | 'fromAddress' | 'text'>): Partial<KontaktData> & { signatur: string[] } {
  const block = signaturBlock(mail.text ?? '');
  const name = absenderName(mail.fromName, mail.fromAddress);
  const emails: string[] = [];
  const mailDazu = (m: string) => { const x = m.replace(/[.,;:]+$/, ''); if (!emails.some((e) => e.toLowerCase() === x.toLowerCase())) emails.push(x); };
  if (mail.fromAddress) mailDazu(mail.fromAddress);

  // Teile: eine Zeile kann mehrere Angaben tragen („T +49 761 1 | M +49 171 2 | anna@beispiel.de")
  const teile = block.flatMap((z) => z.split(/\s+[|·•]\s+|\s{3,}|\t+/).map((t) => t.trim()).filter(Boolean));
  const vergeben = new Set<number>();
  // 1. Anschrift: PLZ + Ort, davor die Straße (eigener Teil oder im selben Teil durch Komma getrennt), danach das Land
  let adresse = '';
  for (let i = 0; i < teile.length && !adresse; i += 1) {
    const stuecke = teile[i].split(/\s*,\s*/);
    const j = stuecke.findIndex((s) => PLZ_ORT_RE.test(s));
    if (j < 0) continue;
    const z: string[] = [];
    if (j > 0) z.push(stuecke.slice(0, j).join(', '));
    else if (i > 0 && !vergeben.has(i - 1) && STRASSE_RE.test(teile[i - 1]) && !teile[i - 1].includes('@') && !rufnummern(teile[i - 1]).length) {
      z.push(teile[i - 1]); vergeben.add(i - 1);
    }
    z.push(stuecke[j]);
    const rest = stuecke.slice(j + 1).join(', ');
    if (rest && LAND_RE.test(rest)) z.push(rest);
    else if (i + 1 < teile.length && LAND_RE.test(teile[i + 1])) { z.push(teile[i + 1]); vergeben.add(i + 1); }
    vergeben.add(i);
    adresse = z.join('\n');
  }
  // 2. E-Mail, Webseite, Rufnummern
  let web = '';
  const telefone: KontaktTelefon[] = [];
  teile.forEach((t, i) => {
    if (vergeben.has(i)) return;
    let treffer = false;
    for (const m of t.match(MAIL_RE) ?? []) { mailDazu(m); treffer = true; }
    const ohneMail = t.replace(MAIL_RE, ' ');
    const w = WEB_RE.exec(ohneMail);
    if (w) { if (!web) web = w[0].replace(/[.,;:)]+$/, ''); treffer = true; }
    for (const r of rufnummern(ohneMail.replace(WEB_RE, ' '))) {
      if (!telefone.some((x) => ziffern(x.nummer) === ziffern(r.nummer))) telefone.push(r);
      treffer = true;
    }
    if (treffer) vergeben.add(i);
  });
  // 3. Übrige Textzeilen: Name, Funktion, Firma
  let sigName = '';
  let funktion = '';
  let firma = '';
  const nameWorte = new Set(nameNormal(name).split(' ').filter((w) => w.length >= 2));
  teile.forEach((t0, i) => {
    if (vergeben.has(i)) return;
    const t = t0.replace(/^(i\.\s?a\.|i\.\s?v\.|p\.\s?p\.|ppa\.)\s*/i, '').replace(/[,;]+$/, '').trim();
    if (!t || t.length > 90 || /^(e-?mail|web|internet|www|tel|fax)\s*:?\s*$/i.test(t)) return;
    const worte = nameNormal(t).split(' ');
    // Die Namenszeile der Signatur (ganz, oder nur der Vorname wie „Anna")
    if (!sigName && !funktion && !firma && (worte.some((w) => nameWorte.has(w)) || (!name && istName(t))) && !/\d/.test(t)) { sigName = t; return; }
    if (FIRMA_RE.test(t)) { if (!firma) firma = t; return; }
    if (!funktion) { funktion = t; return; }
    if (!firma) firma = t;
  });
  const volleName = name || (istName(sigName) ? sigName : '') || sigName;
  return {
    name: volleName,
    ...(funktion ? { funktion } : {}),
    ...(firma ? { firma } : {}),
    telefone,
    emails,
    ...(adresse ? { adresse } : {}),
    ...(web ? { web } : {}),
    signatur: block,
  };
}

/** Die KI liest Kopf und Signatur; ihr Ergebnis ersetzt die Heuristik Feld für Feld, wo sie etwas liefert */
async function kiVerfeinern(mail: EmailData, roh: Partial<KontaktData>, signatur: string[]): Promise<Partial<KontaktData>> {
  const antwort = await askJson<unknown>(
    'Du bekommst Absender-Kopf und Signatur einer E-Mail. Lies daraus die Kontaktdaten des ABSENDERS.\n'
    + 'Antworte NUR mit JSON, exakt in dieser Form (fehlende Angaben leer lassen, nichts erfinden):\n'
    + '{"name":"Vorname Nachname","funktion":"Funktion oder Rolle","firma":"Firma, Behörde oder Organisation","telefone":[{"nummer":"+49 761 1234","art":"Dienstlich|Mobil|Fax|Privat"}],"emails":["adresse@beispiel.de"],"adresse":"Straße Nr\\nPLZ Ort\\nLand (nur wenn genannt)","web":"www.beispiel.de"}\n'
    + `Vorschlag ohne KI (zum Prüfen und Verbessern): ${JSON.stringify({ name: roh.name, funktion: roh.funktion, firma: roh.firma, telefone: roh.telefone, emails: roh.emails, adresse: roh.adresse, web: roh.web })}\n\n`
    + `Von: ${mail.fromName ?? ''}${mail.fromAddress ? ` <${mail.fromAddress}>` : ''}\n`
    + `Signatur:\n${(signatur.length ? signatur : ohneZitat(mail.text ?? '').slice(-25)).join('\n').slice(0, 2500)}`,
  );
  const ki = kontaktVonAussen(antwort);
  const aus: Partial<KontaktData> = { ...roh };
  for (const f of ['name', 'funktion', 'firma', 'adresse', 'web', 'telefone'] as const) if (ki[f] !== undefined) (aus as Record<string, unknown>)[f] = ki[f];
  // Die Adresse aus dem Kopf bleibt immer, die KI darf weitere nennen
  const emails = [...(roh.emails ?? [])];
  for (const m of ki.emails ?? []) if (!emails.some((e) => e.toLowerCase() === m.toLowerCase())) emails.push(m);
  aus.emails = emails;
  return aus;
}

const FELD_NAMEN: Record<string, string> = { name: 'Name', funktion: 'Funktion', firma: 'Firma', telefone: 'Rufnummer', emails: 'E-Mail', adresse: 'Anschrift', web: 'Webseite' };

/** Nur leere Felder füllen; Rückgabe: was ergänzt wurde */
export function kontaktErgaenzen(alt: KontaktData, neu: Partial<KontaktData>): { patch: Partial<KontaktData>; felder: string[] } {
  const patch: Partial<KontaktData> = {};
  const felder: string[] = [];
  for (const f of ['name', 'funktion', 'firma', 'adresse', 'web'] as const) {
    const wert = neu[f];
    if (typeof wert === 'string' && wert && !(alt[f] ?? '').trim()) { patch[f] = wert; felder.push(FELD_NAMEN[f]); }
  }
  if (neu.telefone?.length && !alt.telefone.some((t) => t.nummer.trim())) { patch.telefone = neu.telefone; felder.push(FELD_NAMEN.telefone); }
  if (neu.emails?.length && !alt.emails.some((m) => m.trim())) { patch.emails = neu.emails; felder.push(FELD_NAMEN.emails); }
  return { patch, felder };
}

/** Ein Kontakt auf dem Board, der eine dieser Adressen trägt */
function kontaktMitAdresse(nodes: AppNode[], emails: string[]): AppNode | undefined {
  const gesucht = new Set(emails.map((m) => m.trim().toLowerCase()).filter(Boolean));
  return nodes.find((n) => n.type === 'kontakt' && !n.archived && kontaktDaten(n.data as Partial<KontaktData>).emails.some((m) => gesucht.has(m.trim().toLowerCase())));
}

/** Absender der Mail als Kontakt-Karte (oder vorhandenen Kontakt ergänzen). Rückgabe = Meldung für den Nutzer und ob
 *  sich etwas geändert hat (nur dann bietet die Meldung „Rückgängig“ an). */
export async function absenderAlsKontakt(mailId: string): Promise<{ text: string; geaendert: boolean }> {
  const meldung = (text: string, geaendert = false) => ({ text, geaendert });
  const st0 = useBoard.getState();
  const mail = selectActiveBoard(st0).nodes.find((n) => n.id === mailId);
  if (!mail || mail.type !== 'email') return meldung('Die E-Mail ist nicht mehr da.');
  const e = mail.data as EmailData;
  const { signatur, ...heuristik } = signaturLesen(e);
  let felder = kontaktVonAussen(heuristik);
  let kiHinweis = '';
  if (aiReady(st0.ai)) {
    try {
      felder = kontaktVonAussen(await kiVerfeinern(e, felder, signatur));
      kiHinweis = ' (von der KI geprüft)';
    } catch (err) {
      kiHinweis = ` – KI nicht erreichbar (${(err as Error).message.slice(0, 80)}), nur aus der Signatur gelesen`;
    }
  }
  const d = kontaktDaten(felder);
  if (!d.name && !d.firma && !d.telefone.length && !d.emails.length) return meldung('In dieser Mail stehen keine Absender-Angaben, aus denen ein Kontakt werden könnte.');

  const st = useBoard.getState();
  const nodes = selectActiveBoard(st).nodes;
  const m = nodes.find((n) => n.id === mailId) ?? mail;
  const vorhanden = kontaktMitAdresse(nodes, d.emails);
  const anzeige = (k: KontaktData) => k.name || k.firma || k.emails[0] || 'Kontakt';
  if (vorhanden) {
    const alt = kontaktDaten(vorhanden.data as Partial<KontaktData>);
    const { patch, felder: ergaenzt } = kontaktErgaenzen(alt, d);
    const pfeilFehlt = !selectActiveBoard(st).edges.some((x) => (x.source === mailId && x.target === vorhanden.id) || (x.source === vorhanden.id && x.target === mailId));
    if (!ergaenzt.length && !pfeilFehlt) return meldung(`„${anzeige(alt)}" steht schon als Kontakt auf dem Board – nichts zu ergänzen.`);
    st.pushHistory();
    mutedHistory(() => {
      if (ergaenzt.length) st.updateNodeData(vorhanden.id, patch);
      if (pfeilFehlt) st.addLabeledEdge(mailId, vorhanden.id, 'Kontakt');
    });
    return meldung(ergaenzt.length
      ? `Kontakt „${anzeige(alt)}" ergänzt: ${ergaenzt.join(', ')}${kiHinweis}`
      : `„${anzeige(alt)}" steht schon als Kontakt auf dem Board – nichts zu ergänzen, mit der Mail verbunden.`, true);
  }
  const pos = findFreeSpot(nodes, { x: m.position.x + sizeOf(m).w + 60, y: m.position.y }, { w: 300, h: 220 });
  const karte = makeKontakt(pos, d);
  st.pushHistory();
  mutedHistory(() => {
    st.addNode(karte);
    st.addLabeledEdge(mailId, karte.id, 'Kontakt');
  });
  const teile = [d.funktion && 'Funktion', d.firma && 'Firma', d.telefone.length && (d.telefone.length > 1 ? 'Rufnummern' : 'Rufnummer'), d.adresse && 'Anschrift', d.web && 'Webseite'].filter(Boolean);
  return meldung(teile.length
    ? `Kontakt „${anzeige(d)}" angelegt – mit ${teile.join(', ')}${kiHinweis}`
    : `Kontakt „${anzeige(d)}" angelegt${kiHinweis}`, true);
}
