// M409: Zahlen und Datumswerte so zeigen, wie ihr Excel-Format es sagt.
//
// In einer .xlsx steht die Zahl roh (899.5) und daneben ein Formatcode (#,##0.00 "€"). Ohne den Code zu lesen,
// stand in der Tabelle „899,5" statt „899,50 €", „0,789" statt „78,9 %" und ein Datum als Tageszahl oder im
// ISO-Format. Hier wird der Code ausgewertet – nicht jede Spitzfindigkeit von Excel, aber alles, was in Listen
// vorkommt: Nachkommastellen, Tausenderpunkte, Prozent, Währung und Einheiten, eigene Teile für negative Zahlen
// (auch in Rot), Datum und Uhrzeit. Die Schreibweise ist die hiesige (Komma, Punkt als Tausendertrenner).

/** Die eingebauten Formate von Excel (Nummer → Code); Datum in hiesiger Schreibweise */
export const EINGEBAUT: Record<number, string> = {
  1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 11: '0.00E+00',
  14: 'dd.mm.yyyy', 15: 'd. mmm yy', 16: 'd. mmm', 17: 'mmm yy', 18: 'hh:mm', 19: 'hh:mm:ss', 20: 'hh:mm', 21: 'hh:mm:ss', 22: 'dd.mm.yyyy hh:mm',
  37: '#,##0;-#,##0', 38: '#,##0;[Red]-#,##0', 39: '#,##0.00;-#,##0.00', 40: '#,##0.00;[Red]-#,##0.00',
  44: '#,##0.00 "€"', 45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mm:ss', 49: '@',
};

/** Teile eines Codes, getrennt an „;" außerhalb von "Text" und [Klammern] */
function abschnitte(code: string): string[] {
  const aus: string[] = []; let teil = ''; let inText = false; let inKlammer = false;
  for (let i = 0; i < code.length; i += 1) {
    const c = code[i];
    if (c === '"' && !inKlammer) inText = !inText;
    else if (c === '[' && !inText) inKlammer = true;
    else if (c === ']' && !inText) inKlammer = false;
    else if (c === '\\' && !inText) { teil += c + (code[i + 1] ?? ''); i += 1; continue; }
    if (c === ';' && !inText && !inKlammer) { aus.push(teil); teil = ''; } else teil += c;
  }
  aus.push(teil);
  return aus;
}

const FARBEN: Record<string, string> = { red: '#c0392b', rot: '#c0392b', blue: '#2a5db0', blau: '#2a5db0', green: '#2e7d32', 'grün': '#2e7d32', magenta: '#a0358c', yellow: '#a67c00', gelb: '#a67c00', cyan: '#0e7c86' };

/**
 * Einen Abschnitt in Stücke zerlegen: wörtlicher Text (L) und der Rest (C) – Anführungszeichen, \x, _x (Lücke in
 * der Breite eines Zeichens), *x (Füllzeichen) und [Klammern] (Farbe, Währung, Bedingungen) sind dann aufgelöst.
 */
function stuecke(abschnitt: string): { teile: Array<{ l?: string; c?: string }>; farbe?: string } {
  const teile: Array<{ l?: string; c?: string }> = []; let farbe: string | undefined;
  const lit = (t: string) => { const z = teile[teile.length - 1]; if (z && z.l !== undefined) z.l += t; else teile.push({ l: t }); };
  const cod = (t: string) => { const z = teile[teile.length - 1]; if (z && z.c !== undefined) z.c += t; else teile.push({ c: t }); };
  for (let i = 0; i < abschnitt.length; i += 1) {
    const c = abschnitt[i];
    if (c === '"') { const e = abschnitt.indexOf('"', i + 1); lit(abschnitt.slice(i + 1, e < 0 ? undefined : e)); i = e < 0 ? abschnitt.length : e; }
    else if (c === '\\') { lit(abschnitt[i + 1] ?? ''); i += 1; }
    else if (c === '_') { lit(' '); i += 1; }
    else if (c === '*') { i += 1; }
    else if (c === '[') {
      const e = abschnitt.indexOf(']', i + 1); const innen = abschnitt.slice(i + 1, e < 0 ? undefined : e); i = e < 0 ? abschnitt.length : e;
      const waehrung = /^\$([^-\]]*)/.exec(innen);
      if (waehrung) lit(waehrung[1]);
      else if (/^h+$|^m+$|^s+$/i.test(innen)) cod(`[${innen}]`);
      else if (FARBEN[innen.toLowerCase()]) farbe = FARBEN[innen.toLowerCase()];
    } else cod(c);
  }
  return { teile, farbe };
}

/** Ist das ein Datums- oder Zeitformat? */
export function istDatumsFormat(code: string): boolean {
  const nur = stuecke(abschnitte(code)[0] ?? '').teile.map((t) => t.c ?? '').join('');
  if (/^general$/i.test(nur.trim()) || /[0#?]/.test(nur)) return false;
  return /[dy]/i.test(nur) || (/[hs]/i.test(nur));
}

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const TAGE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const zwei = (n: number) => String(n).padStart(2, '0');

/** Excel-Tageszahl (Bruchteil = Uhrzeit) nach einem Datumsformat schreiben */
export function formatiereDatum(tage: number, code: string): string {
  if (!Number.isFinite(tage)) return String(tage);
  const d = new Date(Math.round((tage - 25569) * 86400000));
  if (!Number.isFinite(d.getTime())) return String(tage);
  const { teile } = stuecke(abschnitte(code)[0] ?? '');
  const zwoelf = teile.some((t) => /am\/pm|a\/p/i.test(t.c ?? ''));
  const stunden = d.getUTCHours();
  let aus = '';
  let nachStunde = false;
  for (const t of teile) {
    if (t.l !== undefined) { aus += t.l; continue; }
    const c = t.c ?? '';
    for (const m of c.matchAll(/\[h+\]|\[m+\]|\[s+\]|am\/pm|a\/p|d+|m+|y+|h+|s+|0+|./gi)) {
      const s = m[0]; const k = s.toLowerCase();
      if (k === '[h]' || k === '[hh]') { aus += String(Math.floor(tage * 24)); nachStunde = true; }
      else if (/^\[m+\]$/.test(k)) aus += String(Math.floor(tage * 1440));
      else if (/^\[s+\]$/.test(k)) aus += String(Math.round(tage * 86400));
      else if (k === 'am/pm' || k === 'a/p') aus += stunden < 12 ? 'AM' : 'PM';
      else if (/^d+$/.test(k)) { aus += k.length === 1 ? String(d.getUTCDate()) : k.length === 2 ? zwei(d.getUTCDate()) : k.length === 3 ? TAGE[d.getUTCDay()].slice(0, 2) : TAGE[d.getUTCDay()]; nachStunde = false; }
      else if (/^y+$/.test(k)) { aus += k.length <= 2 ? zwei(d.getUTCFullYear() % 100) : String(d.getUTCFullYear()); nachStunde = false; }
      else if (/^h+$/.test(k)) { const h = zwoelf ? (stunden % 12 || 12) : stunden; aus += k.length === 1 ? String(h) : zwei(h); nachStunde = true; }
      else if (/^s+$/.test(k)) aus += k.length === 1 ? String(d.getUTCSeconds()) : zwei(d.getUTCSeconds());
      else if (/^m+$/.test(k)) {
        // „m" ist Minute, wenn eine Stunde davorsteht oder Sekunden folgen – sonst Monat
        const danach = c.slice((m.index ?? 0) + s.length);
        const minute = nachStunde || /^[^a-z]*s/i.test(danach);
        if (minute) aus += k.length === 1 ? String(d.getUTCMinutes()) : zwei(d.getUTCMinutes());
        else aus += k.length === 1 ? String(d.getUTCMonth() + 1) : k.length === 2 ? zwei(d.getUTCMonth() + 1) : k.length === 3 ? MONATE[d.getUTCMonth()].slice(0, 3) : MONATE[d.getUTCMonth()];
        nachStunde = false;
      } else if (/^0+$/.test(k)) aus += k;       // Bruchteile der Sekunde: als Nullen
      else aus += s === '/' ? '.' : s;           // US-Trennstrich wird zum hiesigen Punkt
    }
  }
  return aus.trim();
}

/**
 * Eine Zahl nach einem Excel-Format schreiben. `null`, wenn das Format nichts vorgibt („Standard") – dann gilt
 * die übliche Anzeige. Die Farbe kommt aus [Rot]/[Red] im gewählten Abschnitt.
 */
export function formatiereZahl(wert: number, code: string | undefined): { text: string; farbe?: string } | null {
  if (!code || !Number.isFinite(wert)) return null;
  const alle = abschnitte(code);
  if (/^\s*general\s*$/i.test(alle[0] ?? '')) return null;
  // Abschnitt nach Vorzeichen: positiv; negativ; null
  let abschnitt = alle[0]; let betrag = wert;
  if (wert < 0 && alle.length > 1 && alle[1].trim() !== '') { abschnitt = alle[1]; betrag = Math.abs(wert); }
  else if (wert === 0 && alle.length > 2 && alle[2].trim() !== '') abschnitt = alle[2];
  const { teile, farbe } = stuecke(abschnitt);
  const muster = teile.map((t) => t.c ?? '').join('');
  if (!/[0#?]/.test(muster)) {
    // kein Platz für Ziffern: reiner Text („-" für die Null, „@")
    const nur = teile.map((t) => t.l ?? (t.c ?? '').replace(/@/g, String(wert))).join('').trim();
    return nur ? { text: nur, farbe } : null;
  }
  let zahl = betrag;
  const prozent = (muster.match(/%/g) ?? []).length;
  if (prozent) zahl *= 100 ** prozent;
  // Kommas direkt hinter der letzten Ziffernstelle teilen durch Tausend
  const tausendstel = /[0#?](,+)(?=[^0#?,]*$)/.exec(muster.split('.')[0] ?? '')?.[1].length ?? 0;
  if (tausendstel) zahl /= 1000 ** tausendstel;
  const wissenschaft = /e[+-]0+/i.exec(muster);
  const [vor, nach = ''] = muster.replace(/e[+-]0+/i, '').split('.');
  const mind = (nach.match(/0/g) ?? []).length;
  const hoechstens = (nach.match(/[0#?]/g) ?? []).length;
  const gruppen = /[0#?],[0#?]/.test(vor);
  const stellen = Math.max(1, (vor.match(/0/g) ?? []).length);
  let ziffern: string;
  if (wissenschaft) {
    const [m, e] = zahl.toExponential(hoechstens).split('e');
    ziffern = `${m.replace('.', ',')}E${Number(e) < 0 ? '-' : '+'}${zwei(Math.abs(Number(e)))}`;
  } else {
    ziffern = Math.abs(zahl).toLocaleString('de-DE', { minimumFractionDigits: mind, maximumFractionDigits: hoechstens, useGrouping: gruppen, minimumIntegerDigits: Math.min(stellen, 21) });
    if (zahl < 0 && Number(ziffern.replace(/\./g, '').replace(',', '.')) !== 0) ziffern = `-${ziffern}`;
  }
  // Die Ziffern an die Stelle des Musters, wörtlicher Text bleibt, wo er steht
  let gesetzt = false; let aus = '';
  for (const t of teile) {
    if (t.l !== undefined) { aus += t.l; continue; }
    const c = t.c ?? '';
    if (/[0#?]/.test(c)) {
      if (gesetzt) { aus += c.replace(/[0#?.,]|e[+-]0+/gi, ''); continue; }
      gesetzt = true;
      const a = c.search(/[0#?]/); const e = c.length - [...c].reverse().join('').search(/[0#?]/);
      aus += c.slice(0, a) + ziffern + c.slice(e).replace(/^,+/, '');
    } else aus += c;
  }
  return { text: aus.replace(/\s+/g, ' ').trim(), farbe };
}
