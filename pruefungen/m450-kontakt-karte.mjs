/**
 * M450 — Kontakt-Karte (KONZEPT §3.7): Visitenkarte mit Rufnummern, E-Mail, Anschrift; vCard rein und raus.
 *
 *   A  Aus der Modul-Palette anlegen: die leere Karte öffnet ihre Felder, der Cursor steht im Namen; ausfüllen.
 *   B  In Ruhe: Rufnummer als tel: (international), E-Mail als mailto:, Anschrift mit Kartenlink (nur Link, nichts
 *      eingebettet, keine Anfrage an den Kartendienst); Bearbeiten/Herunterladen nur im Fokus (M421).
 *   C  .vcf mit zwei Kontakten aufs Board ziehen (3.0 UTF-8 mit Faltung, Maskierung, Foto; 2.1 Quoted-Printable
 *      ISO-8859-1 mit weichem Zeilenumbruch) → zwei Karten mit Umlauten.
 *   D  Export als .vcf (echter Download) → wieder einlesbar, gleiche Angaben; Zeilen höchstens 75 Bytes.
 *   E  Suche (Strg+K) findet den Kontakt über Firma und Ort.
 *   F  Neuladen erhält alles.
 *   G  Fremdes wird entschärft: Foto als Webadresse fällt weg (keine Anfrage), keine javascript:-Links.
 */
// Läuft aus dem Repository: `node pruefungen/m450-kontakt-karte.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const SD = path.join(__repo, 'pruefungen', 'ablage');
mkdirSync(SD, { recursive: true });
const PORT = 5450;
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
const app = http.createServer((q, r) => {
  let f = path.join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' }[path.extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];
const fremd = [];
const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
await ctx.addInitScript(() => {
  try { if (window !== window.top || localStorage.getItem('pixinotes-onboarded')) return; } catch { return; }
  localStorage.setItem('pixinotes-onboarded', '1');
  localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: { boards: [{ id: 'b1', name: 'Büro', edges: [], drawings: [], nodes: [] }],
    spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board', cardFocus: false, navLinks: false, clickZoom: false } }));
});
// jede Anfrage an fremde Server mitschreiben (Kartendienst, Fotos aus der vCard)
await ctx.route(/^https?:\/\/(?!localhost)/, (r) => { fremd.push(r.request().url()); return r.abort(); });
const P = await ctx.newPage();
P.on('pageerror', (e) => fehler.push(e.message));
await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await P.waitForTimeout(1500);

const karten = () => P.evaluate(() => [...document.querySelectorAll('.react-flow__node-kontakt')].map((n) => ({
  id: n.dataset.id, name: n.querySelector('.kontakt-name')?.textContent ?? '', text: n.innerText,
  tel: [...n.querySelectorAll('a[href^="tel:"]')].map((a) => a.getAttribute('href')),
  mail: [...n.querySelectorAll('a[href^="mailto:"]')].map((a) => a.getAttribute('href')),
  links: [...n.querySelectorAll('a[href]')].map((a) => ({ href: a.getAttribute('href'), target: a.getAttribute('target') })),
  bild: n.querySelector('.kontakt-foto img')?.getAttribute('src') ?? null,
  rahmen: n.querySelectorAll('iframe, embed, object').length,
})));
const ablegen = (name, inhalt) => P.evaluate(([n, txt]) => {
  const bytes = Uint8Array.from(txt, (c) => c.charCodeAt(0));   // Zeichen → Bytes 1:1 (Text ist schon als Bytes kodiert)
  const dt = new DataTransfer(); dt.items.add(new File([bytes], n, { type: 'text/vcard' }));
  const ziel = document.querySelector('.board-wrap');
  const r = ziel.getBoundingClientRect();
  ziel.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + r.width * 0.55, clientY: r.top + r.height * 0.3 }));
}, [name, inhalt]);
const utf8Bytes = (s) => Buffer.from(s, 'utf8').toString('latin1');

console.log('A  Anlegen und ausfüllen');
await P.locator('.dock .dock-add-wrap').nth(0).locator('button').first().click(); await P.waitForTimeout(400);
await P.fill('.modul-suche input', 'visitenkarte'); await P.waitForTimeout(200);
pruefe('A1 die Palette findet „Kontakt" auch über ein Suchwort', await P.locator('.modul-kachel[data-modul="kontakt"]').count() === 1);
await P.locator('.modul-kachel[data-modul="kontakt"]').click(); await P.waitForTimeout(700);
pruefe('A2 eine Kontakt-Karte liegt auf dem Board', (await karten()).length === 1);
pruefe('A3 der Cursor steht gleich im Namen', await P.evaluate(() => document.activeElement?.getAttribute('aria-label')) === 'Name');
await P.keyboard.type('Anna Müller');
const k1 = P.locator('.react-flow__node-kontakt').first();
await k1.locator('input[aria-label="Funktion"]').fill('Sachbearbeiterin');
await k1.locator('input[aria-label="Firma"]').fill('Regierungspräsidium Freiburg');
await k1.locator('.kontakt-dazu', { hasText: 'Rufnummer' }).click();
await k1.locator('input[aria-label="Art der Rufnummer"]').fill('Dienstlich');
await k1.locator('input[aria-label="Rufnummer"]').fill('0761 208-1234');
await k1.locator('.kontakt-dazu', { hasText: 'Rufnummer' }).click();
await k1.locator('input[aria-label="Rufnummer"]').nth(1).fill('+49 170 1234567');
await k1.locator('.kontakt-dazu', { hasText: 'E-Mail' }).click();
await k1.locator('input[aria-label="E-Mail"]').fill('anna.mueller@example.de');
await k1.locator('textarea[aria-label="Anschrift"]').fill('Kaiser-Joseph-Straße 167\n79098 Freiburg');
await k1.locator('textarea[aria-label="Notiz"]').fill('Zuständig für Ausbildung, Raum 3.12');
await k1.locator('button[aria-label="Fertig"]').click(); await P.waitForTimeout(400);

console.log('B  In Ruhe: Links');
let [a] = await karten();
pruefe('B1 Name, Funktion und Firma stehen auf der Karte', a.name === 'Anna Müller' && /Sachbearbeiterin · Regierungspräsidium Freiburg/.test(a.text), a.text);
pruefe('B2 Rufnummern als tel:, international', a.tel.length === 2 && a.tel[0] === 'tel:+497612081234' && a.tel[1] === 'tel:+491701234567', a.tel);
pruefe('B3 E-Mail als mailto:', a.mail.length === 1 && a.mail[0] === 'mailto:anna.mueller@example.de', a.mail);
const karte = a.links.find((l) => /openstreetmap\.org/.test(l.href));
pruefe('B4 Anschrift mit Kartenlink (neuer Tab), nichts eingebettet', !!karte && karte.target === '_blank' && /query=Kaiser-Joseph-Stra%C3%9Fe%20167%2C%2079098%20Freiburg/.test(karte.href) && a.rahmen === 0, { karte, rahmen: a.rahmen });
pruefe('B5 die Notiz steht auf der Karte', /Raum 3\.12/.test(a.text));
// Ruhe und Fokus (M421): Bedienung unsichtbar, solange die Karte nicht markiert ist
await P.mouse.click(300, 820); await P.mouse.move(80, 860); await P.waitForTimeout(500);
const deckkraft = () => P.evaluate(() => getComputedStyle(document.querySelector('.react-flow__node-kontakt .kontakt-tools')).opacity);
pruefe('B6 in Ruhe ist die Bedienung ausgeblendet', (await deckkraft()) === '0', await deckkraft());
await k1.locator('.kontakt-name').click(); await P.waitForTimeout(500);
pruefe('B7 markiert erscheint sie', (await deckkraft()) === '1', await deckkraft());
pruefe('B8 kein Abruf beim Kartendienst', !fremd.some((u) => /openstreetmap/.test(u)), fremd);

console.log('D  Export als .vcf');
const [dl] = await Promise.all([P.waitForEvent('download'), k1.locator('button[aria-label="Als vCard herunterladen"]').click()]);
const exportPfad = path.join(SD, 'm450-export.vcf');
await dl.saveAs(exportPfad);
const exportText = readFileSync(exportPfad, 'utf8');
pruefe('D1 Dateiname nach dem Namen (Umlaute als ae, oe, ue)', dl.suggestedFilename() === 'Anna Mueller.vcf', dl.suggestedFilename());
pruefe('D2 gültige vCard 3.0 mit Umlauten', /^BEGIN:VCARD\r\nVERSION:3\.0\r\n/.test(exportText) && /FN:Anna Müller\r\n/.test(exportText) && /END:VCARD\r\n$/.test(exportText), exportText.slice(0, 200));
pruefe('D3 jede Zeile höchstens 75 Bytes', exportText.split('\r\n').every((z) => Buffer.byteLength(z, 'utf8') <= 75));
pruefe('D4 Rufnummer, E-Mail, Anschrift, Firma enthalten', /TEL;TYPE=WORK,VOICE:0761 208-1234/.test(exportText) && /EMAIL;TYPE=INTERNET:anna\.mueller@example\.de/.test(exportText) && /ADR;TYPE=WORK:;;Kaiser-Joseph-Straße 167;Freiburg;;79098;/.test(exportText) && /ORG:Regierungspräsidium Freiburg/.test(exportText), exportText);

console.log('C  vCard mit zwei Kontakten ablegen');
const FOTO = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP8z8Dwn4GBgYGJAQoAAAD//wMAEBEBA2dK8bQAAAAASUVORK5CYII=';
const vcf = [
  'BEGIN:VCARD', 'VERSION:3.0',
  'N:Weiß;Jürgen;;Dr.;', 'FN:Dr. Jürgen Weiß',
  'ORG:Gärtnerei Weiß\\, Söhne & Töchter;Vertrieb',
  'TITLE:Geschäftsführer',
  'item1.TEL;TYPE=CELL:+49 151 2345678',
  'TEL;TYPE="work,voice":07 61/55 66 77',
  'EMAIL;TYPE=INTERNET:j.weiss@gaertnerei-',
  ' weiss.example',
  'ADR;TYPE=WORK:;;Schlossbergstraße 4;Überlingen;;88662;Deutschland',
  'NOTE:Erste Zeile\\nzweite Zeile mit Semikolon\\; und Komma\\,',
  `PHOTO;ENCODING=b;TYPE=PNG:${FOTO.slice(0, 40)}`,
  ` ${FOTO.slice(40)}`,
  'END:VCARD',
  'BEGIN:VCARD', 'VERSION:2.1',
  'N;CHARSET=ISO-8859-1;ENCODING=QUOTED-PRINTABLE:M=FCller-L=FCdenscheid;Bj=F6rn',
  'FN;CHARSET=ISO-8859-1;ENCODING=QUOTED-PRINTABLE:Bj=F6rn M=FCller-L=FCdenscheid',
  'TEL;HOME;VOICE:0711 123456',
  'NOTE;ENCODING=QUOTED-PRINTABLE;CHARSET=UTF-8:Gr=C3=BC=C3=9Fe aus Stuttgart, =',
  'sch=C3=B6n',
  'END:VCARD', '',
].join('\r\n');
await ablegen('Kontakte.vcf', utf8Bytes(vcf));
await P.waitForTimeout(900);
let alle = await karten();
const juergen = alle.find((k) => k.name === 'Dr. Jürgen Weiß');
const bjoern = alle.find((k) => k.name === 'Björn Müller-Lüdenscheid');
pruefe('C1 zwei neue Karten (eine je Kontakt)', alle.length === 3, alle.map((k) => k.name));
pruefe('C2 Umlaute aus UTF-8 und ß', !!juergen && /Geschäftsführer · Gärtnerei Weiß, Söhne & Töchter, Vertrieb/.test(juergen.text), juergen?.text);
pruefe('C3 Umlaute aus Quoted-Printable (ISO-8859-1)', !!bjoern, alle.map((k) => k.name));
pruefe('C4 gefaltete Zeile wieder zusammengesetzt', juergen?.mail[0] === 'mailto:j.weiss@gaertnerei-weiss.example', juergen?.mail);
pruefe('C5 Gruppen-Präfix und Typ in Anführungszeichen', juergen?.tel.join(' ') === 'tel:+491512345678 tel:+49761556677' && /Mobil/.test(juergen?.text ?? '') && /Dienstlich/.test(juergen?.text ?? ''), juergen?.tel);
pruefe('C6 Anschrift aus ADR', /Schlossbergstraße 4\s+88662 Überlingen\s+Deutschland/.test(juergen?.text ?? ''), juergen?.text);
pruefe('C7 maskierte Zeilenumbrüche, Semikolon, Komma', /Erste Zeile\s*\n\s*zweite Zeile mit Semikolon; und Komma,/.test(juergen?.text ?? ''), juergen?.text);
pruefe('C8 Foto (Base64, gefaltet) als eingebettetes Bild', juergen?.bild === `data:image/png;base64,${FOTO}`, juergen?.bild?.slice(0, 60));
pruefe('C9 Quoted-Printable mit weichem Zeilenumbruch (UTF-8)', /Grüße aus Stuttgart, schön/.test(bjoern?.text ?? ''), bjoern?.text);
pruefe('C10 Rufnummer aus vCard 2.1 (nackte Parameter)', bjoern?.tel[0] === 'tel:+49711123456' && /Privat/.test(bjoern?.text ?? ''), bjoern);

console.log('D  Export wieder einlesen');
await ablegen('Anna Müller.vcf', Buffer.from(exportText, 'utf8').toString('latin1'));
await P.waitForTimeout(900);
alle = await karten();
const zurueck = alle.filter((k) => k.name === 'Anna Müller');
pruefe('D5 die exportierte Datei ergibt wieder die Karte', zurueck.length === 2, alle.map((k) => k.name));
if (zurueck.length === 2) {
  const [o, n] = zurueck;
  pruefe('D6 gleiche Rufnummern, E-Mail, Kartenlink und Text', JSON.stringify(o.tel) === JSON.stringify(n.tel) && JSON.stringify(o.mail) === JSON.stringify(n.mail)
    && o.links.find((l) => /openstreetmap/.test(l.href))?.href === n.links.find((l) => /openstreetmap/.test(l.href))?.href && o.text === n.text, { o: o.text, n: n.text });
}

console.log('E  Suche');
await P.mouse.click(300, 820); await P.waitForTimeout(200);
await P.keyboard.press('Control+k'); await P.waitForTimeout(400);
await P.keyboard.type('Gärtnerei Überlingen'); await P.waitForTimeout(500);
const treffer = await P.locator('.search-hit').allInnerTexts();
pruefe('E1 Strg+K findet den Kontakt über Firma und Ort', treffer.some((t) => /Jürgen Weiß/.test(t)), treffer);
await P.fill('.search-box input', '0761 208'); await P.waitForTimeout(500);
const treffer2 = await P.locator('.search-hit').allInnerTexts();
pruefe('E2 … und über die Rufnummer', treffer2.some((t) => /Anna Müller/.test(t)), treffer2);
await P.keyboard.press('Escape'); await P.waitForTimeout(300);

console.log('G  Fremdes entschärfen');
const boese = ['BEGIN:VCARD', 'VERSION:4.0', 'FN:Mallory', 'PHOTO;MEDIATYPE=image/png:https://evil.example/pixel.png', 'TEL;VALUE=uri:javascript:alert(1)', 'EMAIL:mallory@example.org', 'END:VCARD', ''].join('\r\n');
await ablegen('boese.vcf', boese); await P.waitForTimeout(900);
alle = await karten();
const m = alle.find((k) => k.name === 'Mallory');
pruefe('G1 Karte angelegt, Foto als Webadresse fällt weg', !!m && m.bild === null, m);
pruefe('G2 keine Anfrage an den fremden Server', !fremd.some((u) => /evil\.example/.test(u)), fremd);
pruefe('G3 kein Link mit javascript:', !alle.some((k) => k.links.some((l) => /^\s*javascript:/i.test(l.href))), m?.links);
await P.screenshot({ path: path.join(SD, 'm450-kontakte.png') });

console.log('F  Neuladen');
await P.waitForTimeout(1500);
const vorher = (await karten()).map((k) => k.text).sort();
await P.reload({ waitUntil: 'networkidle' }); await P.waitForTimeout(1800);
const nachher = (await karten()).map((k) => k.text).sort();
pruefe('F1 alle Kontakte samt Inhalt sind nach dem Neuladen da', nachher.length === 5 && JSON.stringify(vorher) === JSON.stringify(nachher), { vorher: vorher.length, nachher: nachher.length });
pruefe('F2 das Foto bleibt', (await karten()).some((k) => k.bild === `data:image/png;base64,${FOTO}`));

pruefe('keine Seitenfehler', fehler.length === 0, fehler.slice(0, 3).join(' | '));
{
  const hilfe = readFileSync(path.join(__repo, 'src/components/HelpOverlay.tsx'), 'utf8');
  const hilfeEn = readFileSync(path.join(__repo, 'src/components/HelpOverlayEn.tsx'), 'utf8');
  pruefe('H1 Hilfe (deutsch und englisch) nennt M450', /M450/.test(hilfe) && /M450/.test(hilfeEn));
}
await browser.close(); app.close();
console.log(`\nM450: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
