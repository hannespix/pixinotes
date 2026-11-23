/**
 * M467 — Start-Leistung Teil 3: der Node-Ersatz (Buffer, process) kommt nur noch mit dem Outlook-Leser.
 *
 *   A  Start: Start-JS unter der neuen Grenze; in den Start-Dateien steckt weder der Buffer- noch der
 *      process-Ersatz, und die Seite kennt kein globales Buffer/process (Browser-Weg aller Bibliotheken).
 *   B  .msg ablegen (Web): E-Mail-Karte mit Betreff, Absender, Text (windows-1252 mit Umlauten — der Weg über
 *      iconv-lite) und Anhang samt Inhalt. Der Ersatz kommt erst mit diesem Ablegen.
 *   C  .eml ablegen: wie vorher (postal-mime, ohne Node-Ersatz).
 *   D  Notiz-Editor tippt wie vorher (lib0/yjs ohne Buffer-Ersatz).
 *   E  Single-File (file://): .msg ablegen erzeugt die Karte mit Anhang, keine Fehler beim Start.
 */
// Läuft aus dem Repository: `node pruefungen/m467-start-leistung-3.mjs` (für E vorher `npm run build:single`)
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync, statSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
import { msgBauen, MSG_BEISPIEL } from './daten/m467-msg.mjs';

const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const SINGLE = process.env.PN_SINGLE ?? path.join(__repo, 'release', 'pixinotes.html');
const PORT = 5467;
/** Grenze knapp über dem gemessenen Stand (2 168 523 B = 2,07 MiB; vorher 2 198 693 B, siehe docs/meilensteine/M467-start-leistung-3.md) */
// M462: BlockNote 0.57 (Tiptap 3, Mantine 8) — Start 2 220 718 B (+50 KB, Emoji-Auswahl schon nachgeladen; siehe docs/meilensteine/M462-blocknote.md)
// M483: Start 2 097 102 B (vorher 2 238 181 B) — Grenze GESENKT auf neuer Stand + gut 20 KB, damit das Polster nicht gleich wieder verbraucht ist (docs/meilensteine/M483-start-leicht.md)
// M502: Live-Team, Gehirn, Rechen-Tabelle, Kommentare, Punkte, Nachschlagen, Handschrift-Struktur, Bildtext nachgeladen — Start 2 044 571 B mit M501 (vorher 2 112 358 B); Grenze GESENKT auf neuer Stand + gut 20 KB (docs/meilensteine/M502-start-leicht-2.md)
const START_JS_GRENZE = 2_065_000;

let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info.slice(0, 500) : JSON.stringify(info).slice(0, 500)}`); }
};
let anfragen = [];
const app = http.createServer((q, r) => {
  const pfad = q.url.split('?')[0];
  anfragen.push(pfad);
  let f = path.join(DIST, pfad === '/' ? 'index.html' : pfad.slice(1));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(f)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });

const MSG = msgBauen(MSG_BEISPIEL);
const EML = [
  'From: Anna Berg <anna.berg@beispiel.de>', 'To: Team <team@beispiel.de>', 'Subject: Angebot Halle',
  'Date: Mon, 16 Nov 2026 09:30:00 +0100', 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="xx"', '',
  '--xx', 'Content-Type: text/plain; charset=utf-8', '', 'Grüße, das Angebot hängt an.', '',
  '--xx', 'Content-Type: text/plain; name="angebot.txt"', 'Content-Disposition: attachment; filename="angebot.txt"', '', 'Summe 18.400 Euro', '',
  '--xx--', '',
].join('\r\n');

/** Board mit einer Notiz; Start wie m459 (kein Konto, kein Termin) */
async function seite(url, { mitServer = true } = {}) {
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1440, height: 900 } });
  if (mitServer) await ctx.route((u) => !u.href.startsWith(`http://localhost:${PORT}`), (r) => r.fulfill({ status: 404, body: '' }));
  await ctx.addInitScript(() => {
    try { if (window !== window.top || localStorage.getItem('pixinotes-board')) return; } catch { return; }
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
      boards: [{ id: 'b1', name: 'Post', edges: [], drawings: [], comments: [], nodes: [
        { id: 'n1', type: 'note', width: 260, position: { x: 600, y: 80 }, data: { color: 'yellow', blocks: [{ id: 'k1', type: 'paragraph', content: 'Hallo Welt' }] } },
      ] }],
      spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }],
      activeId: 'b1', view: 'board', cardFocus: false, navLinks: false } }));
  });
  const P = await ctx.newPage();
  const fehler = [];
  P.on('pageerror', (e) => { fehler.push(e.message); console.log('    PAGEERROR:', e.message); });
  P.on('dialog', (d) => d.accept());
  anfragen = [];
  await P.goto(url);
  await P.waitForSelector('.react-flow__node', { state: 'visible' });
  return { ctx, P, fehler };
}
const brett = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0]);
/** Datei auf die Fläche fallen lassen (wie m451) */
const ablegen = (P, name, typ, bytes) => P.evaluate(([n, t, b]) => {
  const dt = new DataTransfer();
  dt.items.add(new File([new Uint8Array(b)], n, { type: t }));
  const ziel = document.querySelector('.react-flow__pane');
  for (const art of ['dragover', 'drop']) ziel.dispatchEvent(new DragEvent(art, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: 300, clientY: 250 }));
}, [name, typ, [...bytes]]);
const warteAufMail = (P, betreff) => P.waitForFunction((s) => (JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes ?? [])
  .some((n) => n.type === 'email' && n.data.subject === s), betreff, { timeout: 15000 }).catch(() => {});
const anhangText = (a) => (a?.dataUrl ? Buffer.from(a.dataUrl.split(',')[1], 'base64').toString('utf8').trim() : '');
const jsGeladen = () => [...new Set(anfragen)].filter((p) => p.startsWith('/assets/') && p.endsWith('.js')).map((p) => p.split('/').pop());
const inhalt = (f) => readFileSync(path.join(DIST, 'assets', f), 'utf8');
/** Kennzeichen des Ersatzes: Fehlertexte aus dem buffer-Paket bzw. dem process-Ersatz (kommen sonst nirgends vor) */
const hatBuffer = (f) => /Unknown encoding: |"size" argument must be of type number/.test(inhalt(f));
const hatProcess = (f) => /process\.binding is not supported/.test(inhalt(f));

// ══ A + B + C + D: Web ═════════════════════════════════════════════
console.log('\n════ A: Start ohne Node-Ersatz ════');
{
  const { ctx, P, fehler } = await seite(`http://localhost:${PORT}/`);
  await P.waitForLoadState('networkidle');
  await P.waitForTimeout(400);
  const start = jsGeladen();
  const summe = start.reduce((a, f) => a + statSync(path.join(DIST, 'assets', f)).size, 0);
  console.log(`  Start-JS ${(summe / 1024 / 1024).toFixed(2)} MB (${summe} B) in ${start.length} Dateien: ${start.join(', ')}`);
  pruefe(`A1 Start-JS unter ${(START_JS_GRENZE / 1024 / 1024).toFixed(2)} MB (ist ${(summe / 1024 / 1024).toFixed(2)} MB; vorher 2,10 MB)`, summe < START_JS_GRENZE && summe > 1_000_000, String(summe));
  pruefe('A2 kein Buffer-Ersatz in den Start-Dateien', !start.some(hatBuffer), start.filter(hatBuffer));
  pruefe('A3 kein process-Ersatz in den Start-Dateien', !start.some(hatProcess), start.filter(hatProcess));
  const glob = await P.evaluate(() => ({ buffer: typeof globalThis.Buffer, process: typeof globalThis.process, global: typeof globalThis.global }));
  pruefe('A4 kein globales Buffer/process/global im Browser', glob.buffer === 'undefined' && glob.process === 'undefined' && glob.global === 'undefined', glob);

  console.log('\n════ B: .msg ablegen ════');
  anfragen = [];
  await ablegen(P, 'pruefbericht.msg', 'application/vnd.ms-outlook', MSG);
  await warteAufMail(P, MSG_BEISPIEL.betreff);
  const mail = (await brett(P)).nodes.find((n) => n.type === 'email' && n.data.subject === MSG_BEISPIEL.betreff);
  pruefe('B1 E-Mail-Karte mit Betreff (Umlaute aus windows-1252)', !!mail, (await brett(P)).nodes.map((n) => n.type));
  pruefe('B2 Absender und Text', mail?.data.fromName === 'Jörg Müller' && mail?.data.fromAddress === 'joerg.mueller@example.org' && mail?.data.text === MSG_BEISPIEL.text, mail?.data);
  const anh = mail?.data.attachments?.[0];
  pruefe('B3 Anhang mit Namen, Größe und Inhalt', mail?.data.attachments?.length === 1 && anh.name === 'bericht.txt' && anh.size === 19 && anhangText(anh) === MSG_BEISPIEL.anhangText, anh);
  const nach = jsGeladen();
  pruefe('B4 der Ersatz kommt erst mit dem .msg (nachgeladene Datei trägt ihn)', nach.some(hatBuffer) && nach.some(hatProcess), nach);
  await P.waitForTimeout(300);
  pruefe('B5 Karte zeigt den Anhang', await P.locator(`.react-flow__node[data-id="${mail?.id}"]`).getByText('bericht.txt').count() > 0);

  console.log('\n════ C: .eml ablegen ════');
  await ablegen(P, 'angebot.eml', 'message/rfc822', Buffer.from(EML));
  await warteAufMail(P, 'Angebot Halle');
  const eml = (await brett(P)).nodes.find((n) => n.type === 'email' && n.data.subject === 'Angebot Halle');
  pruefe('C1 .eml wird E-Mail-Karte mit Text und Anhang', !!eml && eml.data.text.includes('Grüße') && eml.data.attachments?.[0]?.name === 'angebot.txt' && anhangText(eml.data.attachments[0]) === 'Summe 18.400 Euro', eml?.data);

  console.log('\n════ D: Notiz-Editor ════');
  // Doppelklick auf freie Fläche legt eine Notiz an, der Editor (BlockNote, yjs/lib0) nimmt den Text
  await P.mouse.dblclick(1100, 700);
  await P.waitForTimeout(800);
  await P.keyboard.type('Neue Notiz mit Grüßen', { delay: 15 });
  await P.waitForTimeout(300);
  await P.keyboard.press('Escape');
  await P.waitForTimeout(1600);
  const notiz = (await brett(P)).nodes.find((n) => n.type === 'note' && n.id !== 'n1');
  const text = JSON.stringify(notiz?.data.blocks ?? []);
  pruefe('D1 getippter Text landet in der neuen Notiz', text.includes('Neue Notiz mit Grüßen'), text.slice(0, 300));
  pruefe('A5/B6 keine Seitenfehler', fehler.length === 0, fehler);
  await ctx.close();
}

// ══ E: Single-File ══════════════════════════════════════════════════
console.log('\n════ E: Single-File (file://) ════');
if (!existsSync(SINGLE)) {
  pruefe('E0 release/pixinotes.html vorhanden (npm run build:single)', false, SINGLE);
} else {
  const { ctx, P, fehler } = await seite(pathToFileURL(SINGLE).href, { mitServer: false });
  await P.waitForTimeout(800);
  await ablegen(P, 'pruefbericht.msg', 'application/vnd.ms-outlook', MSG);
  await warteAufMail(P, MSG_BEISPIEL.betreff);
  const mail = (await brett(P)).nodes.find((n) => n.type === 'email' && n.data.subject === MSG_BEISPIEL.betreff);
  const anh = mail?.data.attachments?.[0];
  pruefe('E1 .msg wird E-Mail-Karte mit Absender', mail?.data.fromName === 'Jörg Müller', mail?.data);
  pruefe('E2 Anhang samt Inhalt', anh?.name === 'bericht.txt' && anhangText(anh) === MSG_BEISPIEL.anhangText, anh);
  pruefe('E3 keine Seitenfehler (auch nicht beim Start)', fehler.length === 0, fehler);
  await ctx.close();
}

await browser.close();
app.close();
console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
