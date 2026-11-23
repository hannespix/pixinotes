/**
 * M451 — E-Mail-Destillat: aus einem langen Mail-Verlauf Kernaussage, offene Fragen, Aufgaben, Termine.
 *
 * Gefragt (KONZEPT.md §5 Punkt 3): „Eine KI-Aktion macht aus einem langen Mail-Thread ein Destillat: Kernaussage,
 * offene Fragen, Aufgaben mit Frist und Verantwortlichem, wichtige Termine/Zahlen – als Notiz neben der Mail, nie
 * destruktiv; erkannte Aufgaben optional mit einem Klick als Kanban-Tickets bzw. Checklisten-Punkte."
 *
 *   A  DESTILLAT: .eml aufs Board ziehen → „Destillat" an der Mail: eine neue Notiz mit den vier Abschnitten neben der
 *      Mail (frei liegend), ein Pfeil Mail → Notiz „Destillat"; die Mail bleibt unverändert; ein Strg+Z nimmt alles.
 *   B  CHECKLISTE: „Als Checkliste" macht die Aufgaben-Punkte abhakbar – sie stehen mit Frist in der Aufgaben-Zentrale.
 *   C  TICKETS: „Als Tickets" legt eine Kanban-Karte an (Frist, Person) – in der Zentrale, nichts doppelt.
 *   D  LANGER VERLAUF: Anfang und Ende gehen an die KI, die Mitte wird ausgelassen und die Meldung sagt es.
 *   E  GEHIRN (M445-Nachtrag): „Nach Themen ordnen" ohne Chat-KI in einem vom Gehirn ausgeschlossenen Bereich sagt
 *      genau das – nicht mehr „Zu wenig Inhalt".
 *   F  Keine Fehler.
 */
// Läuft aus dem Repository: `node pruefungen/m451-mail-destillat.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 5451;
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

const eml = (text) => [
  'From: Anna Berg <anna.berg@beispiel.de>',
  'To: Team Bau <team@beispiel.de>',
  'Subject: Re: Umbau Halle - Angebot und Termine',
  'Date: Mon, 16 Nov 2026 09:30:00 +0100',
  'MIME-Version: 1.0',
  'Content-Type: text/plain; charset=utf-8',
  'Content-Transfer-Encoding: 8bit',
  '',
  text,
].join('\r\n');
const VERLAUF = 'Hallo zusammen,\n\ndas Angebot von Müller liegt jetzt bei 18.400 Euro. Ben, kannst du es bis 04.12. prüfen? '
  + 'Wer die Bauleitung übernimmt, ist noch offen.\n\nViele Grüße\nAnna\n\n> Am 12.11.2026 schrieb Ben:\n> Baubeginn ist der 07.12.2026. Reicht das Budget für die Elektrik?';
const ANTWORT = {
  kern: 'Der Umbau der Halle beginnt am 07.12.2026. Das Angebot von Müller liegt bei 18.400 Euro und muss geprüft werden.',
  fragen: ['Wer übernimmt die Bauleitung?', 'Reicht das Budget für die Elektrik?'],
  aufgaben: [
    { text: 'Angebot Müller prüfen', wer: 'Ben', frist: '2026-12-04' },
    { text: 'Bauleitung klären', wer: 'Anna', frist: '2026-12-10' },
    { text: 'Protokoll verschicken', wer: '', frist: 'irgendwann' },
  ],
  termine: ['Baubeginn 07.12.2026', 'Angebot Müller: 18.400 Euro'],
};

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];
/** Seite mit leerem Board, Chat-KI abgefangen; `antwort` = JSON der KI */
const auf = async ({ antwort = ANTWORT, nodes = [], ki = true, brainOff = false } = {}) => {
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(([nn, mitKi, aus]) => {
    try { if (window !== window.top || localStorage.getItem('pixinotes-onboarded')) return; } catch { return; }
    localStorage.setItem('pixinotes-onboarded', '1'); localStorage.setItem('pixinotes-ohne-emoji', '1');
    // Die Aufgaben-Zentrale öffnet über die linke Spalte (navLinks)
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: true }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
      boards: [{ id: 'b1', name: 'Post', edges: [], drawings: [], nodes: nn, comments: [] }],
      spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board', cardFocus: false, navLinks: true, clickZoom: false, physicsEnabled: false,
      brainOffSpaces: aus ? ['s1'] : [],
      ai: mitKi ? { provider: 'openai', model: 'gpt-test', apiKey: 'test', baseUrl: '' } : { provider: 'ollama', model: '', apiKey: '', baseUrl: 'http://localhost:11434' },
      brain: mitKi ? { on: false, provider: 'auto' } : { on: true, provider: 'ollama', embedModel: 'nomic-embed-text' } } }));
  }, [nodes, ki, brainOff]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  const aufrufe = [];
  const einbettungen = [];
  await P.route('**/chat/completions', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    const c = body.messages?.[0]?.content;
    aufrufe.push(typeof c === 'string' ? c : (c ?? []).map((t) => t.text ?? '').join('\n'));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(antwort) }, finish_reason: 'stop' }] }) });
  });
  await P.route('**/api/embed', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    einbettungen.push(...body.input);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ embeddings: body.input.map(() => [1, 0, 0]) }) });
  });
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  return { ctx, P, aufrufe, einbettungen };
};
const stand = async (P) => { await P.waitForTimeout(900); return P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0]); };
const toast = (P) => P.evaluate(() => document.querySelector('.toast')?.textContent ?? '');
const ablegen = (P, text) => P.evaluate(([inhalt]) => {
  const dt = new DataTransfer();
  dt.items.add(new File([inhalt], 'umbau.eml', { type: 'message/rfc822' }));
  const ziel = document.querySelector('.react-flow__pane');
  for (const art of ['dragover', 'drop']) ziel.dispatchEvent(new DragEvent(art, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: 300, clientY: 250 }));
}, [eml(text)]);
const textVon = (b) => (typeof b.content === 'string' ? b.content : (b.content ?? []).map((c) => c.text ?? '').join(''));
const mailKnopf = (P, mailId, name) => P.locator(`.react-flow__node[data-id="${mailId}"] button`, { hasText: name });
const rechteck = (n) => ({ x: n.position.x, y: n.position.y, w: n.measured?.width ?? n.width ?? 300, h: n.measured?.height ?? n.height ?? 200 });
const ueber = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
/** Destillat erzeugen: .eml ablegen, „Destillat" klicken, warten */
const destillieren = async (P, text = VERLAUF) => {
  await ablegen(P, text);
  await P.waitForTimeout(1800);
  const mail = (await stand(P)).nodes.find((n) => n.type === 'email');
  if (!mail) return { mail: null };
  await mailKnopf(P, mail.id, 'Destillat').click();
  await P.waitForFunction(() => /Destillat als Notiz|KI-Fehler/.test(document.querySelector('.toast')?.textContent ?? ''), null, { timeout: 20000 }).catch(() => {});
  const meldung = await toast(P);
  return { mail, meldung, b: await stand(P) };
};
const zentrale = async (P) => {
  await P.locator('.tab-tasks').first().click();
  await P.waitForTimeout(800);
  return P.locator('.taskhub .task-row').evaluateAll((rows) => rows.map((r) => ({
    text: r.querySelector('.task-text')?.textContent ?? '', due: r.querySelector('.task-due')?.textContent ?? '', who: r.querySelector('.task-who')?.textContent ?? '',
  })));
};

// ---------- A: Destillat ----------
console.log('A  .eml ablegen → Destillat als Notiz daneben');
{
  const { ctx, P, aufrufe } = await auf();
  const { mail, meldung, b } = await destillieren(P);
  pruefe('A1 die abgelegte .eml wird eine E-Mail-Karte mit Betreff und Text', !!mail && mail.data.subject.includes('Umbau Halle') && mail.data.text.includes('18.400 Euro'), mail?.data);
  const prompt = aufrufe[0] ?? '';
  pruefe('A2 ein Auftrag an die KI: Betreff, Absender, Datum, der ganze Verlauf samt Zitat, das heutige Datum', aufrufe.length === 1 && prompt.includes('Umbau Halle') && prompt.includes('anna.berg@beispiel.de') && prompt.includes('Datum: 2026-11-16') && prompt.includes('Reicht das Budget für die Elektrik') && /Heute ist \d{4}-\d{2}-\d{2}/.test(prompt) && prompt.includes('"aufgaben"'), prompt.slice(0, 500));
  const notiz = b?.nodes.find((n) => n.type === 'note');
  const texte = (notiz?.data.blocks ?? []).map(textVon);
  const typen = (notiz?.data.blocks ?? []).map((x) => x.type);
  pruefe('A3 eine neue Notiz mit Titel und den vier Abschnitten', !!notiz && texte[0] === 'Destillat: Re: Umbau Halle - Angebot und Termine' && ['Kernaussage', 'Offene Fragen', 'Aufgaben', 'Termine und Zahlen'].every((t) => texte.includes(t)), texte);
  const ab = (titel) => { const i = texte.indexOf(titel); const r = []; for (let k = i + 1; k < texte.length && typen[k] !== 'heading'; k += 1) r.push(texte[k]); return r; };
  pruefe('A4 Kernaussage als Absatz, Fragen und Termine als Punkte', ab('Kernaussage')[0]?.startsWith('Der Umbau der Halle beginnt') && ab('Offene Fragen').length === 2 && ab('Termine und Zahlen').includes('Angebot Müller: 18.400 Euro'), { k: ab('Kernaussage'), f: ab('Offene Fragen'), t: ab('Termine und Zahlen') });
  pruefe('A5 Aufgaben mit Person und Frist (deutsch), eine ungültige Frist fällt weg; noch keine Haken', JSON.stringify(ab('Aufgaben')) === JSON.stringify(['Angebot Müller prüfen – Ben – bis 04.12.2026', 'Bauleitung klären – Anna – bis 10.12.2026', 'Protokoll verschicken']) && !typen.includes('checkListItem'), ab('Aufgaben'));
  const kante = b?.edges.find((e) => e.source === mail?.id && e.target === notiz?.id);
  pruefe('A6 ein Pfeil von der Mail zur Notiz, beschriftet „Destillat"', kante?.data?.label === 'Destillat', b?.edges);
  const m = b?.nodes.find((n) => n.id === mail?.id);
  pruefe('A7 die Mail bleibt, wie sie war (Text, Betreff, Lage)', m?.data.text === mail?.data.text && m?.data.subject === mail?.data.subject && m?.position.x === mail?.position.x && m?.position.y === mail?.position.y);
  const rn = notiz && rechteck(notiz); const rm = m && rechteck(m);
  pruefe('A8 die Notiz liegt rechts neben der Mail, ohne sie zu überdecken', !!rn && !!rm && rn.x >= rm.x + rm.w && Math.abs(rn.y - rm.y) < 200 && !ueber(rn, rm), { rn, rm });
  pruefe('A9 die Meldung nennt Fragen und Aufgaben', /Destillat als Notiz daneben gelegt – offene Fragen: 2, Aufgaben: 3/.test(meldung), meldung);
  const knoepfe = await P.locator(`.react-flow__node[data-id="${mail?.id}"] [data-taste^="destillat-"]`).count();
  pruefe('A10 an der Mail stehen jetzt „Als Checkliste" und „Als Tickets"', knoepfe === 2, knoepfe);
  // Strg+Z: ein Schritt nimmt Notiz und Pfeil weg
  await P.evaluate(() => document.activeElement?.blur());
  await P.keyboard.press('Control+z');
  const nach = await stand(P);
  pruefe('A11 ein Strg+Z nimmt Notiz und Pfeil zurück – die Mail bleibt', nach.nodes.filter((n) => n.type === 'note').length === 0 && nach.edges.length === 0 && nach.nodes.some((n) => n.type === 'email'), { nodes: nach.nodes.map((n) => n.type), edges: nach.edges.length });
  await ctx.close();
}

// ---------- B: Checkliste ----------
console.log('B  Aufgaben als Checkliste → Aufgaben-Zentrale');
{
  const { ctx, P } = await auf();
  const { mail } = await destillieren(P);
  await mailKnopf(P, mail.id, 'Als Checkliste').click();
  await P.waitForTimeout(400);
  const meldung = await toast(P);
  const b = await stand(P);
  const notiz = b.nodes.find((n) => n.type === 'note');
  const haken = (notiz?.data.blocks ?? []).filter((x) => x.type === 'checkListItem').map(textVon);
  pruefe('B1 die drei Aufgaben-Punkte sind jetzt Haken, Fragen und Termine bleiben Punkte', haken.length === 3 && haken[0] === 'Angebot Müller prüfen – Ben – bis 04.12.2026' && (notiz?.data.blocks ?? []).filter((x) => x.type === 'bulletListItem').length === 4, haken);
  pruefe('B2 Meldung und die Knöpfe an der Mail verschwinden', /Als Checkliste übernommen: 3/.test(meldung) && (await P.locator(`.react-flow__node[data-id="${mail.id}"] [data-taste^="destillat-"]`).count()) === 0, meldung);
  const sichtbar = await P.locator('.react-flow__node[data-id="' + notiz.id + '"] [data-content-type="checkListItem"]').count();
  pruefe('B3 der Editor der Notiz zeigt die Haken sofort', sichtbar === 3, sichtbar);
  const rows = await zentrale(P);
  const r1 = rows.find((r) => r.text.includes('Angebot Müller prüfen'));
  const r2 = rows.find((r) => r.text.includes('Bauleitung klären'));
  pruefe('B4 die Aufgaben stehen in der Aufgaben-Zentrale – mit Frist', !!r1 && /04\.12\./.test(r1.due) && !!r2 && /10\.12\./.test(r2.due) && rows.some((r) => r.text.includes('Protokoll verschicken')), rows);
  await ctx.close();
}

// ---------- C: Tickets ----------
console.log('C  Aufgaben als Kanban-Tickets');
{
  const { ctx, P } = await auf();
  const { mail } = await destillieren(P);
  await mailKnopf(P, mail.id, 'Als Tickets').click();
  await P.waitForTimeout(500);
  const meldung = await toast(P);
  const b = await stand(P);
  const k = b.nodes.find((n) => n.type === 'kanban');
  const items = k?.data.items ?? [];
  pruefe('C1 eine Kanban-Karte mit drei Tickets: Frist und Person übernommen', k?.data.title === 'Aufgaben: Re: Umbau Halle - Angebot und Termine' && items.length === 3 && items[0].text === 'Angebot Müller prüfen' && items[0].due === '2026-12-04' && items[0].who === 'Ben' && items[2].due === undefined && items.every((i) => i.col === 0), items);
  const notiz = b.nodes.find((n) => n.type === 'note');
  pruefe('C2 Pfeil Mail → Kanban („Aufgaben"), keiner zwischen Destillat und Kanban; die Notiz bleibt ohne Haken', b.edges.some((e) => e.source === mail.id && e.target === k?.id && e.data?.label === 'Aufgaben') && !b.edges.some((e) => [e.source, e.target].includes(notiz?.id) && [e.source, e.target].includes(k?.id)) && !(notiz?.data.blocks ?? []).some((x) => x.type === 'checkListItem'), b.edges);
  pruefe('C3 Meldung, Knöpfe an der Mail weg', /Als Tickets angelegt: 3/.test(meldung) && (await P.locator(`.react-flow__node[data-id="${mail.id}"] [data-taste^="destillat-"]`).count()) === 0, meldung);
  const kr = rechteck(k); const nr = rechteck(notiz); const mr = rechteck(b.nodes.find((n) => n.id === mail.id));
  pruefe('C4 die Kanban-Karte überdeckt weder Mail noch Destillat', !ueber(kr, nr) && !ueber(kr, mr), { kr, nr, mr });
  await P.waitForTimeout(1500);   // ein Kanban sammelt verbundene Quellen nach — es darf nichts dazukommen
  const rows = await zentrale(P);
  const angebot = rows.filter((r) => r.text.includes('Angebot Müller prüfen'));
  pruefe('C5 in der Aufgaben-Zentrale: jede Aufgabe genau einmal, mit Frist und Person', angebot.length === 1 && /04\.12\./.test(angebot[0].due) && angebot[0].who === 'Ben' && rows.filter((r) => /Bauleitung|Protokoll/.test(r.text)).length === 2 && !rows.some((r) => /Wer übernimmt|Baubeginn/.test(r.text)), rows);
  const k2 = (await stand(P)).nodes.find((n) => n.type === 'kanban');
  pruefe('C6 das Kanban hat keine Fragen oder Termine eingesammelt', (k2?.data.items ?? []).length === 3, (k2?.data.items ?? []).map((i) => i.text));
  await ctx.close();
}

// ---------- D: langer Verlauf ----------
console.log('D  Langer Verlauf im Platzbudget');
{
  const { ctx, P, aufrufe } = await auf();
  const lang = `ANFANG neueste Nachricht.\n${Array.from({ length: 400 }, (_, i) => `> Zitierte Zeile ${i + 1} aus dem älteren Verlauf, mit allerlei Text darin.`).join('\n')}\n> ENDE erste Nachricht des Verlaufs.`;
  const { meldung } = await destillieren(P, lang);
  const prompt = aufrufe[0] ?? '';
  pruefe('D1 Anfang und Ende des Verlaufs gehen an die KI, die Mitte nicht', prompt.includes('ANFANG neueste Nachricht') && prompt.includes('ENDE erste Nachricht') && prompt.includes('Mitte des Verlaufs ausgelassen') && !prompt.includes('Zitierte Zeile 200 ') && prompt.length < 14500, prompt.length);
  pruefe('D2 die Meldung sagt, dass die Mitte ausgelassen wurde', /Mitte wurde ausgelassen/.test(meldung), meldung);
  await ctx.close();
}

// ---------- E: Gehirn ausgeschlossen ----------
console.log('E  Nach Themen ordnen ohne Chat-KI in einem vom Gehirn ausgeschlossenen Bereich');
{
  const notiz = (id, x, y, text) => ({ id, type: 'note', position: { x, y }, width: 220, height: 110, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: [{ type: 'text', text, styles: {} }] }] } });
  const nodes = [notiz('a', 60, 80, 'Urlaub Mallorca planen'), notiz('b', 360, 80, 'Rechnung Lieferant prüfen'), notiz('c', 660, 80, 'Hotel Mallorca buchen'), notiz('d', 60, 300, 'Rechnung Steuer')];
  const { ctx, P, aufrufe, einbettungen } = await auf({ nodes, ki: false, brainOff: true });
  for (const [i, id] of ['a', 'b', 'c', 'd'].entries()) await P.locator(`.react-flow__node[data-id="${id}"]`).click({ modifiers: i ? ['Shift'] : [], position: { x: 30, y: 40 } });
  await P.waitForTimeout(300);
  await P.locator('[data-taste="auswahl-mehr"]').click(); await P.waitForTimeout(200);
  await P.locator('[data-taste="anordnen-auf"]').click(); await P.waitForTimeout(250);
  await P.locator('[data-anordnen="themen"]').click();
  await P.waitForFunction(() => /fehlgeschlagen/.test(document.querySelector('.toast')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => {});
  const meldung = await toast(P);
  pruefe('E1 die Meldung sagt: Bereich vom Gehirn ausgeschlossen – nicht „zu wenig Inhalt"', /vom Gehirn ausgeschlossen/.test(meldung) && !/Zu wenig Inhalt/.test(meldung) && /Einstellungen/.test(meldung), meldung);
  pruefe('E2 weder Chat-KI noch Einbettungen wurden gefragt, kein Dialog, nichts geordnet', aufrufe.length === 0 && einbettungen.length === 0 && !(await P.locator('.themen-dialog').count()) && !(await stand(P)).nodes.some((n) => n.type === 'frame'), { chat: aufrufe.length, emb: einbettungen.length });
  await ctx.close();
}

console.log('F  Keine Fehler');
pruefe('F1 keine Seitenfehler', fehler.length === 0, fehler);

await browser.close();
app.close();
console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
