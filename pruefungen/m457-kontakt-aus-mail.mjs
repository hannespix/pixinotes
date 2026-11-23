/**
 * M457 — Kontakt aus der Mail-Signatur.
 *
 * Gefragt (KONZEPT.md §3.7, offen aus M450/M454): An einer E-Mail-Karte macht „Absender als Kontakt" (im ⋯ der Mail,
 * kein neuer Dauer-Knopf) eine Kontakt-Karte neben der Mail mit Pfeil „Kontakt": Name und E-Mail aus dem Kopf,
 * Funktion, Firma, Rufnummern, Anschrift, Webseite aus der Signatur – ohne KI; mit KI verfeinert. Ein vorhandener
 * Kontakt mit derselben Adresse wird ergänzt (nur leere Felder), nicht verdoppelt. Ein Schritt für Rückgängig.
 *
 *   A  DEUTSCH OHNE KI: Signatur nach „Mit freundlichen Grüßen", darunter Rechtshinweis und zitierter Verlauf – nur
 *      die Signatur zählt; Kontakt rechts neben der Mail, Pfeil „Kontakt"; Strg+Z nimmt Karte und Pfeil.
 *   B  ENGLISCH OHNE KI: „Best regards", Kopf „Smith, John", Schweizer Anschrift mit Land, Phone/Mobile.
 *   C  MIT KI: die (abgefangene) KI-Antwort verfeinert; eine Webseite mit fremdem Schema fällt weg (lib/sicher.ts).
 *   D  ZWEITES MAL: vorhandener Kontakt mit derselben Adresse wird ergänzt, nicht doppelt angelegt; beim dritten Mal
 *      „nichts zu ergänzen" ohne Änderung; Strg+Z nimmt die Ergänzung zurück.
 *   E  Der Eintrag steht nur im ⋯ einer einzelnen Mail, nicht als Knopf an der Karte.
 *   F  Keine Fehler.
 */
// Läuft aus dem Repository: `node pruefungen/m457-kontakt-aus-mail.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 5457;
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info.slice(0, 700) : JSON.stringify(info).slice(0, 700)}`); }
};
const app = http.createServer((q, r) => {
  let f = path.join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' }[path.extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));

const eml = ({ von, betreff, text }) => [
  `From: ${von}`,
  'To: Team <team@beispiel.de>',
  `Subject: ${betreff}`,
  'Date: Mon, 16 Nov 2026 09:30:00 +0100',
  'MIME-Version: 1.0',
  'Content-Type: text/plain; charset=utf-8',
  'Content-Transfer-Encoding: 8bit',
  '',
  text,
].join('\r\n');

const DEUTSCH = eml({
  von: 'Anna Berg <anna.berg@beispiel.de>',
  betreff: 'Angebot Umbau Halle',
  text: [
    'Hallo Ben,', '', 'anbei das Angebot. Ruf mich gern an, Termin wäre der 08.12.2026.', '',
    'Mit freundlichen Grüßen', '',
    'Anna Berg', 'Leiterin Einkauf', 'Beispiel Bau GmbH', 'Hauptstraße 5', '79098 Freiburg im Breisgau',
    'Tel. +49 761 208-1234 | Mobil 0171 2345678', 'Fax +49 761 208-1299', 'anna.berg@beispiel.de | www.beispiel-bau.de', '',
    'Diese E-Mail enthält vertrauliche Informationen. Wenn Sie nicht der richtige Adressat sind, rufen Sie 0800 1234567 an.',
    'Sitz der Gesellschaft: Freiburg, Amtsgericht Freiburg HRB 12345', '',
    '-----Ursprüngliche Nachricht-----', 'Von: Ben Kurz <ben.kurz@kurz-planung.de>', 'Gesendet: Freitag, 13. November 2026 14:02',
    'Betreff: Umbau Halle', '', 'Hallo Anna, schickst du mir das Angebot?', '', 'Viele Grüße', 'Ben Kurz', 'Kurz Planung AG', 'Tel. 0761 999999',
  ].join('\n'),
});
const ENGLISCH = eml({
  von: '"Smith, John" <john.smith@acme-solutions.ch>',
  betreff: 'Re: Quote for the hall',
  text: [
    'Hi Anna,', '', 'thanks, the quote looks good. Let us talk on Monday.', '',
    'Best regards,', '',
    'John Smith', 'Head of Procurement', 'Acme Solutions Ltd.',
    'Phone: +41 44 123 45 67', 'Mobile: +41 79 123 45 67', 'john.smith@acme-solutions.ch',
    'Bahnhofstrasse 10, 8001 Zürich, Switzerland', 'www.acme-solutions.ch', '',
    'This e-mail may contain confidential information. If you are not the intended recipient, call +41 44 000 00 00.', '',
    'On Mon, 16 Nov 2026 at 09:30, Anna Berg <anna.berg@beispiel.de> wrote:', '> Hi John,', '> please find the quote attached.',
    '> Best regards', '> Anna Berg', '> Tel. +49 761 208-1234',
  ].join('\n'),
});
const KI_ANTWORT = {
  name: 'Anna Berg', funktion: 'Leiterin Einkauf und Logistik', firma: 'Beispiel Bau GmbH',
  telefone: [{ nummer: '+49 761 208-1234', art: 'Dienstlich' }, { nummer: '+49 171 2345678', art: 'Mobil' }, { nummer: '<script>', art: 'X' }],
  emails: ['anna.berg@beispiel.de', 'einkauf@beispiel-bau.de', 'kein-mail'],
  adresse: 'Hauptstraße 5\n79098 Freiburg im Breisgau\nDeutschland', web: 'javascript:alert(1)',
};

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];
/** Seite mit Board; `ki` = Chat-KI eingerichtet (Antwort abgefangen), `nodes` = Karten von Anfang an */
const auf = async ({ ki = false, nodes = [] } = {}) => {
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(([nn, mitKi]) => {
    try { if (window !== window.top || localStorage.getItem('pixinotes-onboarded')) return; } catch { return; }
    localStorage.setItem('pixinotes-onboarded', '1'); localStorage.setItem('pixinotes-ohne-emoji', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2 }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
      boards: [{ id: 'b1', name: 'Post', edges: [], drawings: [], nodes: nn, comments: [] }],
      spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board', cardFocus: false, navLinks: false, clickZoom: false, physicsEnabled: false,
      ai: mitKi ? { provider: 'openai', model: 'gpt-test', apiKey: 'test', baseUrl: '' } : { provider: 'ollama', model: '', apiKey: '', baseUrl: 'http://localhost:11434' },
      brain: { on: false, provider: 'auto' } } }));
  }, [nodes, ki]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  const aufrufe = [];
  await P.route('**/chat/completions', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    const c = body.messages?.[0]?.content;
    aufrufe.push(typeof c === 'string' ? c : (c ?? []).map((x) => x.text ?? '').join('\n'));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(KI_ANTWORT) }, finish_reason: 'stop' }] }) });
  });
  await P.route('**/api/**', (route) => route.abort());
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  return { ctx, P, aufrufe };
};
const stand = async (P) => { await P.waitForTimeout(900); return P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0]); };
const ablegen = async (P, inhalt) => {
  await P.evaluate(([text]) => {
    const dt = new DataTransfer();
    dt.items.add(new File([text], 'post.eml', { type: 'message/rfc822' }));
    const ziel = document.querySelector('.react-flow__pane');
    for (const art of ['dragover', 'drop']) ziel.dispatchEvent(new DragEvent(art, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: 300, clientY: 250 }));
  }, [inhalt]);
  await P.waitForTimeout(1800);
  return (await stand(P)).nodes.find((n) => n.type === 'email');
};
/** Rechtsklick auf die Mail → ⋯ → „Absender als Kontakt"; liefert die Meldung */
const alsKontakt = async (P, mailId) => {
  const vorher = await P.evaluate(() => document.querySelector('.toast')?.textContent ?? '');
  await P.locator(`.react-flow__node[data-id="${mailId}"] h3`).click({ button: 'right' });
  await P.waitForTimeout(450);
  const eintrag = P.locator('.sel-more-menu [data-taste="absender-kontakt"]');
  if (!(await eintrag.count())) return '(kein Eintrag im Menü)';
  await eintrag.click();
  // M457: auf eine NEUE Meldung warten (beim dritten Mal kann der Text gleich bleiben – dann reicht die Zeit)
  await P.waitForFunction((alt) => { const t = document.querySelector('.toast')?.textContent ?? ''; return /Kontakt|Absender/.test(t) && t !== alt; }, vorher, { timeout: 8000 }).catch(() => {});
  return P.evaluate(() => document.querySelector('.toast')?.textContent ?? '');
};
const rueckgaengig = async (P) => {
  await P.mouse.click(1380, 860);
  await P.evaluate(() => document.activeElement?.blur());
  await P.keyboard.press('Control+z');
  return stand(P);
};
const rechteck = (n) => ({ x: n.position.x, y: n.position.y, w: n.measured?.width ?? n.width ?? 300, h: n.measured?.height ?? n.height ?? 200 });
const ueber = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const nummern = (k) => (k?.data.telefone ?? []).map((t) => `${t.art ?? ''}:${t.nummer}`);

// ---------- A: Deutsch ohne KI ----------
console.log('A  Deutsche Signatur ohne KI');
{
  const { ctx, P, aufrufe } = await auf();
  const mail = await ablegen(P, DEUTSCH);
  pruefe('A1 die .eml wird eine E-Mail-Karte', !!mail && mail.data.fromAddress === 'anna.berg@beispiel.de', mail?.data);
  const meldung = await alsKontakt(P, mail.id);
  const b = await stand(P);
  const k = b.nodes.find((n) => n.type === 'kontakt');
  pruefe('A2 eine Kontakt-Karte mit Name und E-Mail aus dem Kopf', k?.data.name === 'Anna Berg' && JSON.stringify(k?.data.emails) === '["anna.berg@beispiel.de"]', k?.data);
  pruefe('A3 Funktion und Firma aus der Signatur', k?.data.funktion === 'Leiterin Einkauf' && k?.data.firma === 'Beispiel Bau GmbH', k?.data);
  pruefe('A4 drei Rufnummern mit Art (Dienstlich, Mobil, Fax)', JSON.stringify(nummern(k)) === JSON.stringify(['Dienstlich:+49 761 208-1234', 'Mobil:0171 2345678', 'Fax:+49 761 208-1299']), nummern(k));
  pruefe('A5 Anschrift aus Straße und PLZ/Ort, Webseite', k?.data.adresse === 'Hauptstraße 5\n79098 Freiburg im Breisgau' && k?.data.web === 'www.beispiel-bau.de', { a: k?.data.adresse, w: k?.data.web });
  const alles = JSON.stringify(k?.data ?? {});
  pruefe('A6 nichts aus Rechtshinweis und zitiertem Verlauf (0800 …, Ben Kurz, Kurz Planung, 0761 999999)', !/0800|Ben Kurz|Kurz Planung|999999|Amtsgericht|HRB/.test(alles), alles);
  pruefe('A7 ohne eingerichtete KI wurde keine KI gefragt', aufrufe.length === 0, aufrufe.length);
  const kante = b.edges.find((e) => e.source === mail.id && e.target === k?.id);
  pruefe('A8 ein Pfeil Mail → Kontakt, beschriftet „Kontakt"', kante?.data?.label === 'Kontakt', b.edges);
  const rk = k && rechteck(k); const rm = rechteck(b.nodes.find((n) => n.id === mail.id));
  pruefe('A9 der Kontakt liegt rechts neben der Mail, ohne sie zu überdecken', !!rk && rk.x >= rm.x + rm.w && Math.abs(rk.y - rm.y) < 200 && !ueber(rk, rm), { rk, rm });
  pruefe('A10 die Meldung nennt den Kontakt und was gefunden wurde', /Kontakt „Anna Berg" angelegt – mit Funktion, Firma, Rufnummern, Anschrift, Webseite/.test(meldung), meldung);
  const sicht = await P.locator(`.react-flow__node[data-id="${k?.id}"]`).innerText().catch(() => '');
  pruefe('A11 die Karte zeigt Name, Firma und eine wählbare Rufnummer', sicht.includes('Anna Berg') && sicht.includes('Beispiel Bau GmbH') && (await P.locator(`.react-flow__node[data-id="${k?.id}"] a[href="tel:+497612081234"]`).count()) === 1, sicht);
  const nach = await rueckgaengig(P);
  pruefe('A12 ein Strg+Z nimmt Kontakt und Pfeil zurück – die Mail bleibt', !nach.nodes.some((n) => n.type === 'kontakt') && nach.edges.length === 0 && nach.nodes.some((n) => n.id === mail.id), { typen: nach.nodes.map((n) => n.type), kanten: nach.edges.length });
  await ctx.close();
}

// ---------- B: Englisch ohne KI ----------
console.log('B  Englische Signatur ohne KI');
{
  const { ctx, P } = await auf();
  const mail = await ablegen(P, ENGLISCH);
  const meldung = await alsKontakt(P, mail.id);
  const k = (await stand(P)).nodes.find((n) => n.type === 'kontakt');
  pruefe('B1 „Smith, John" im Kopf wird „John Smith", die E-Mail aus dem Kopf', k?.data.name === 'John Smith' && k?.data.emails?.[0] === 'john.smith@acme-solutions.ch', k?.data);
  pruefe('B2 Funktion und Firma', k?.data.funktion === 'Head of Procurement' && k?.data.firma === 'Acme Solutions Ltd.', k?.data);
  pruefe('B3 Phone → Dienstlich, Mobile → Mobil', JSON.stringify(nummern(k)) === JSON.stringify(['Dienstlich:+41 44 123 45 67', 'Mobil:+41 79 123 45 67']), nummern(k));
  pruefe('B4 Schweizer Anschrift mit Land, Webseite', k?.data.adresse === 'Bahnhofstrasse 10\n8001 Zürich\nSwitzerland' && k?.data.web === 'www.acme-solutions.ch', { a: k?.data.adresse, w: k?.data.web });
  pruefe('B5 nichts aus Disclaimer und Zitat (+41 44 000 00 00, Anna Berg, +49 761)', !/000 00 00|Anna|\+49/.test(JSON.stringify(k?.data ?? {})), k?.data);
  pruefe('B6 Meldung', /Kontakt „John Smith" angelegt/.test(meldung), meldung);
  await ctx.close();
}

// ---------- C: mit KI ----------
console.log('C  Mit KI verfeinert');
{
  const { ctx, P, aufrufe } = await auf({ ki: true });
  const mail = await ablegen(P, DEUTSCH);
  const meldung = await alsKontakt(P, mail.id);
  const k = (await stand(P)).nodes.find((n) => n.type === 'kontakt');
  const prompt = aufrufe[0] ?? '';
  pruefe('C1 genau ein Auftrag an die KI mit Absender und Signatur, ohne Rechtshinweis und Zitat', aufrufe.length === 1 && prompt.includes('anna.berg@beispiel.de') && prompt.includes('Leiterin Einkauf') && prompt.includes('79098 Freiburg') && !prompt.includes('vertrauliche Informationen') && !prompt.includes('Ursprüngliche Nachricht') && !prompt.includes('999999'), prompt.slice(-900));
  pruefe('C2 die Antwort der KI gilt: Funktion, Anschrift mit Land, Rufnummer international', k?.data.funktion === 'Leiterin Einkauf und Logistik' && k?.data.adresse === 'Hauptstraße 5\n79098 Freiburg im Breisgau\nDeutschland' && nummern(k).includes('Mobil:+49 171 2345678'), k?.data);
  pruefe('C3 Unbrauchbares der KI fällt weg (Rufnummer „<script>", Adresse ohne @, Webseite javascript: – die aus der Signatur bleibt)', !nummern(k).some((n) => n.includes('script')) && JSON.stringify(k?.data.emails) === '["anna.berg@beispiel.de","einkauf@beispiel-bau.de"]' && k?.data.web === 'www.beispiel-bau.de', k?.data);
  pruefe('C4 die Meldung sagt, dass die KI geprüft hat', /angelegt.*von der KI geprüft/.test(meldung), meldung);
  const nach = await rueckgaengig(P);
  pruefe('C5 Strg+Z nimmt auch hier alles in einem Schritt', !nach.nodes.some((n) => n.type === 'kontakt') && nach.edges.length === 0, nach.nodes.map((n) => n.type));
  await ctx.close();
}

// ---------- D: vorhandener Kontakt ----------
console.log('D  Vorhandener Kontakt wird ergänzt, nicht verdoppelt');
{
  const vorher = { id: 'k1', type: 'kontakt', width: 300, position: { x: 900, y: 600 }, data: { name: 'Anna Berg', funktion: 'Einkauf', telefone: [], emails: ['Anna.Berg@beispiel.de'] } };
  const { ctx, P } = await auf({ nodes: [vorher] });
  const mail = await ablegen(P, DEUTSCH);
  const meldung = await alsKontakt(P, mail.id);
  const b = await stand(P);
  const kontakte = b.nodes.filter((n) => n.type === 'kontakt');
  const k = kontakte[0];
  pruefe('D1 kein zweiter Kontakt (gleiche Adresse, Groß-/Kleinschreibung egal)', kontakte.length === 1 && k.id === 'k1', kontakte.map((n) => n.id));
  pruefe('D2 nur leere Felder gefüllt: Funktion bleibt „Einkauf", Firma, Rufnummern, Anschrift, Webseite kommen dazu', k.data.funktion === 'Einkauf' && k.data.firma === 'Beispiel Bau GmbH' && nummern(k).length === 3 && k.data.adresse?.startsWith('Hauptstraße 5') && k.data.web === 'www.beispiel-bau.de' && k.data.emails.length === 1, k.data);
  pruefe('D3 die Meldung sagt, was ergänzt wurde', /Kontakt „Anna Berg" ergänzt: Firma, Anschrift, Webseite, Rufnummer/.test(meldung), meldung);
  pruefe('D4 ein Pfeil Mail → vorhandener Kontakt', b.edges.some((e) => e.source === mail.id && e.target === 'k1' && e.data?.label === 'Kontakt'), b.edges);
  const meldung2 = await alsKontakt(P, mail.id);
  const b2 = await stand(P);
  pruefe('D5 beim nächsten Mal: „nichts zu ergänzen", weder Karte noch Pfeil dazu', /steht schon als Kontakt auf dem Board – nichts zu ergänzen/.test(meldung2) && b2.nodes.filter((n) => n.type === 'kontakt').length === 1 && b2.edges.length === 1, { meldung2, kanten: b2.edges.length });
  const nach = await rueckgaengig(P);
  const k0 = nach.nodes.find((n) => n.id === 'k1');
  pruefe('D6 Strg+Z nimmt Ergänzung und Pfeil in einem Schritt zurück', !k0?.data.firma && (k0?.data.telefone ?? []).length === 0 && k0?.data.funktion === 'Einkauf' && nach.edges.length === 0, { d: k0?.data, kanten: nach.edges.length });
  await ctx.close();
}

// ---------- E: kein Dauer-Knopf ----------
console.log('E  Nur im Menü der Mail');
{
  const { ctx, P } = await auf();
  const mail = await ablegen(P, DEUTSCH);
  const anKarte = await P.locator(`.react-flow__node[data-id="${mail.id}"] button`, { hasText: 'Kontakt' }).count();
  pruefe('E1 an der Mail-Karte selbst steht kein neuer Knopf', anKarte === 0, anKarte);
  await P.locator(`.react-flow__node[data-id="${mail.id}"] h3`).click({ button: 'right' });
  await P.waitForTimeout(450);
  pruefe('E2 im ⋯ der Mail steht „Absender als Kontakt"', (await P.locator('.sel-more-menu [data-taste="absender-kontakt"]').innerText().catch(() => '')).includes('Absender als Kontakt'));
  await ctx.close();
}

console.log('F  Keine Fehler');
pruefe('F1 keine Seitenfehler', fehler.length === 0, fehler);

await browser.close();
app.close();
console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
