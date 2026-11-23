/**
 * M444 — KI: Board-Briefing. „Was ist auf diesem Board gerade wichtig?"
 *
 *   A  OHNE KI: Dock ⋯ → KI-Assistent → „Board-Briefing (Lage)" legt eine neue Notiz rechts neben den sichtbaren
 *      Ausschnitt – Fristen überfällig zuerst, dann bald, dann später, Zahl ohne Frist; Beschluss aus dem Protokoll;
 *      Risiko-Zeile; keine Checklisten (würden neue Aufgaben); keine Anfrage ins Netz; die übrigen Karten bleiben,
 *      Strg+Z nimmt die Notiz wieder weg.
 *   B  MIT KI: ein Auftrag mit den lokal erkannten Fakten und dem Inhalt der Karten; die Notiz trägt die lokale
 *      Fristenliste und den Text des Modells – eine Checkliste des Modells wird zum einfachen Stichpunkt.
 *   C  KI ANTWORTET NICHT: das Briefing entsteht trotzdem lokal, die Meldung sagt es.
 *   D  STRG+K: „Briefing" in der Suche findet den Befehl und legt das Briefing an.
 *   E  Keine Fehler.
 */
// Läuft aus dem Repository: `node pruefungen/m444-board-briefing.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 5444;
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

const iso = (tage) => { const d = new Date(); d.setDate(d.getDate() + tage); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const absatz = (t) => ({ type: 'paragraph', content: t });
const board = () => [
  { id: 'k1', type: 'kanban', position: { x: 40, y: 40 }, width: 520, data: { title: 'Aufgaben Umbau', cols: ['Offen', 'In Arbeit', 'Erledigt'], items: [
    { id: 't3', text: 'Bauantrag einreichen SPAETER', col: 0, due: iso(20) },
    { id: 't1', text: 'Angebot schreiben UEBERFAELLIG', col: 0, due: iso(-3), who: 'Anna' },
    { id: 't2', text: 'Statik prüfen BALD', col: 1, due: iso(1) },
    { id: 't4', text: 'Fotos sortieren OHNEFRIST', col: 0 },
    { id: 't5', text: 'Alles erledigt ERLEDIGT', col: 2, due: iso(-10) },
  ] } },
  { id: 'm1', type: 'minutes', position: { x: 600, y: 40 }, width: 420, height: 380, data: { title: 'Jour fixe Bau', color: 'white', entries: [{ id: 'x1', date: '2026-11-10', attendees: 'Anna, Ben', blocks: [absatz('Abriss im Dezember.')], decisions: [{ id: 'd1', text: 'Budget 20.000 Euro freigegeben' }] }] } },
  { id: 'n1', type: 'note', position: { x: 40, y: 480 }, width: 260, data: { color: 'yellow', blocks: [{ type: 'heading', props: { level: 3 }, content: 'Lieferkette' }, absatz('Risiko: Der Stahllieferant ist blockiert.'), absatz('Sonst läuft alles nach Plan.')] } },
];

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];
const auf = async (anbieter, antwort) => {
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(([nn, an]) => {
    try { if (window !== window.top || localStorage.getItem('pixinotes-onboarded')) return; } catch { return; }
    localStorage.setItem('pixinotes-onboarded', '1'); localStorage.setItem('pixinotes-ohne-emoji', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
      boards: [{ id: 'b1', name: 'Umbau', edges: [], drawings: [], nodes: nn, comments: [] }],
      spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board', cardFocus: false, navLinks: false, clickZoom: false, physicsEnabled: false,
      ai: an === 'openai' ? { provider: 'openai', model: 'gpt-test', apiKey: 'test', baseUrl: '' } : { provider: 'none', model: '', apiKey: '', baseUrl: '' } } }));
  }, [board(), anbieter]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  const aufrufe = [];
  // Jede Anfrage an irgendein Modell wird mitgezählt – ohne KI darf keine hinausgehen
  await P.route(/chat\/completions|api\/generate|anthropic|pollinations|openrouter/, async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    const c = body.messages?.[0]?.content;
    aufrufe.push(typeof c === 'string' ? c : (c ?? []).map((t) => t.text ?? '').join('\n'));
    if (antwort === 'fehler') { await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"message":"kaputt"}}' }); return; }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: antwort ?? '' }, finish_reason: 'stop' }] }) });
  });
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  return { ctx, P, aufrufe };
};
const knoten = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes);
const toast = (P) => P.evaluate(() => document.querySelector('.toast')?.textContent ?? '');
const fertig = async (P) => {
  await P.waitForFunction(() => /Briefing/.test(document.querySelector('.toast')?.textContent ?? ''), null, { timeout: 30000 }).catch(() => {});
  const t = await toast(P);
  await P.waitForTimeout(1400);
  return t;
};
/** Rechter Rand des sichtbaren Ausschnitts in Board-Koordinaten */
const rechterRand = (P) => P.evaluate(() => {
  const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([-\d.]+)\)/.exec(document.querySelector('.react-flow__viewport')?.style.transform ?? '');
  if (!m) return null;
  const [, tx, , z] = m.map(Number);
  const pane = document.querySelector('.react-flow')?.getBoundingClientRect();
  return ((pane ? pane.right - pane.left : window.innerWidth) - tx) / z;
});
const briefingPerDock = async (P) => {
  await P.evaluate(() => [...document.querySelectorAll('.dock button')].find((b) => b.getAttribute('aria-label') === 'Mehr')?.click());
  await P.waitForTimeout(300);
  await P.evaluate(() => [...document.querySelectorAll('.dock-menu-more button')].find((b) => b.textContent.includes('KI-Assistent'))?.click());
  await P.waitForTimeout(300);
  await P.locator('[data-taste="ki-briefing"]').click();
  return fertig(P);
};
/** Text einer Notiz in Lesereihenfolge + die Blocktypen */
const notizText = (n) => {
  const texte = []; const typen = [];
  const lauf = (b) => {
    if (Array.isArray(b)) { b.forEach(lauf); return; }
    if (!b || typeof b !== 'object') return;
    if (b.type && b.props) typen.push(b.type);
    if (typeof b.content === 'string') texte.push(b.content);
    if (typeof b.text === 'string') texte.push(b.text);
    if (b.content) lauf(b.content);
    if (b.children) lauf(b.children);
  };
  lauf(n?.data?.blocks ?? []);
  return { text: texte.join('\n'), typen };
};
/** Was eine Karte ausmacht – ohne Laufzeit-Angaben wie Auswahl oder gemessene Größe */
// (Notiz- und Protokolltext normalisiert der Editor nach dem Laden selbst, das Kanban stempelt Erledigtes mit erledigtAm –
// maßgeblich sind Lage, Tickets und Beschlüsse)
const kern = (liste) => liste.map((n) => ({ id: n.id, type: n.type, x: n.position.x, y: n.position.y, items: n.data.items?.map(({ erledigtAm, ...i }) => i), beschluesse: n.data.entries?.map((e) => e.decisions) }));
const neueNotiz = (vorher, nachher) => nachher.find((n) => !vorher.some((v) => v.id === n.id));

// ---------- A: ohne KI ----------
console.log('A  Ohne KI: lokales Briefing neben dem Ausschnitt');
{
  const { ctx, P, aufrufe } = await auf('none');
  const vorher = await knoten(P);
  const rand = await rechterRand(P);
  const meldung = await briefingPerDock(P);
  const nachher = await knoten(P);
  const neu = neueNotiz(vorher, nachher);
  const { text, typen } = notizText(neu);
  pruefe('A1 eine neue Notiz, die übrigen Karten unverändert', !!neu && neu.type === 'note' && nachher.length === vorher.length + 1
    && JSON.stringify(kern(nachher.filter((n) => n.id !== neu?.id))) === JSON.stringify(kern(vorher)), kern(nachher).filter((n) => !kern(vorher).some((v) => JSON.stringify(v) === JSON.stringify(n))));
  pruefe('A2 sie liegt rechts neben dem sichtbaren Ausschnitt', rand !== null && neu && neu.position.x >= rand, { rand, x: neu?.position.x });
  const i = (s) => text.indexOf(s);
  pruefe('A3 Fristen: überfällig zuerst, dann bald, dann später; Erledigtes fehlt', i('UEBERFAELLIG') >= 0 && i('UEBERFAELLIG') < i('BALD') && i('BALD') < i('SPAETER') && i('ERLEDIGT') < 0 && /überfällig/.test(text), text.slice(0, 600));
  pruefe('A4 offene ohne Frist werden gezählt, die Person steht dabei', /1 offene ohne Frist/.test(text) && text.includes('OHNEFRIST') && text.includes('@Anna'), text);
  pruefe('A5 Entscheidung aus dem Protokoll und Risiko aus der Notiz', text.includes('Budget 20.000 Euro freigegeben') && text.includes('Stahllieferant ist blockiert') && /Risiken und Blocker/.test(text) && /1 Aufgabe überfällig/.test(text), text);
  pruefe('A6 Abschnitte: Aufgaben, Entscheidungen, Inhalte, Risiken – keine Checklisten', ['Aufgaben und Fristen', 'Entscheidungen', 'Wichtigste Inhalte', 'Risiken und Blocker'].every((s) => text.includes(s)) && !typen.includes('checkListItem'), typen);
  pruefe('A7 ohne KI geht keine Anfrage hinaus; die Meldung sagt es', aufrufe.length === 0 && /ohne KI/.test(meldung), { aufrufe: aufrufe.length, meldung });
  await P.mouse.click(700, 860); await P.keyboard.press('Escape');
  await P.keyboard.press('Control+z'); await P.waitForTimeout(1600);
  const zurueck = await knoten(P);
  pruefe('A8 Strg+Z nimmt das Briefing wieder weg', zurueck.length === vorher.length && !zurueck.some((n) => n.id === neu?.id), zurueck.length);
  await ctx.close();
}

// ---------- B: mit KI ----------
console.log('B  Mit KI: lokale Fristen + Text des Modells');
{
  const ki = '### Board-Briefing\n## Lage\nDer **Umbau** läuft, MODELL-LAGE.\n## Risiken und Blocker\n- [ ] Stahl nachbestellen MODELL-RISIKO';
  const { ctx, P, aufrufe } = await auf('openai', ki);
  const vorher = await knoten(P);
  const meldung = await briefingPerDock(P);
  const neu = neueNotiz(vorher, await knoten(P));
  const { text, typen } = notizText(neu);
  const prompt = aufrufe[0] ?? '';
  pruefe('B1 genau ein Auftrag mit Fakten und Karteninhalt', aufrufe.length === 1 && prompt.includes('Lokal erkannte Fakten') && prompt.includes('Angebot schreiben UEBERFAELLIG') && prompt.includes('Budget 20.000 Euro freigegeben') && prompt.includes('Stahllieferant'), { n: aufrufe.length, prompt: prompt.slice(0, 400) });
  pruefe('B2 Fristenliste lokal vorn, dann der Text des Modells', text.indexOf('UEBERFAELLIG') >= 0 && text.indexOf('UEBERFAELLIG') < text.indexOf('MODELL-LAGE') && text.includes('MODELL-RISIKO'), text);
  pruefe('B3 die Checkliste des Modells wird ein einfacher Stichpunkt', !typen.includes('checkListItem') && typen.includes('bulletListItem'), typen);
  pruefe('B4 Meldung: mit KI', /mit KI/.test(meldung), meldung);
  await ctx.close();
}

// ---------- C: KI scheitert ----------
console.log('C  KI antwortet nicht: lokal weiter');
{
  const { ctx, P, aufrufe } = await auf('openai', 'fehler');
  const vorher = await knoten(P);
  const meldung = await briefingPerDock(P);
  const neu = neueNotiz(vorher, await knoten(P));
  const { text } = notizText(neu);
  pruefe('C1 das Briefing entsteht trotzdem, die Meldung sagt warum', aufrufe.length >= 1 && !!neu && text.includes('UEBERFAELLIG') && text.includes('Budget 20.000 Euro') && /ohne KI/.test(meldung) && /antwortete nicht/.test(meldung), { meldung, n: aufrufe.length });
  await ctx.close();
}

// ---------- D: Strg+K ----------
console.log('D  Strg+K → Board-Briefing');
{
  const { ctx, P } = await auf('none');
  const vorher = await knoten(P);
  await P.mouse.click(700, 860);
  await P.keyboard.press('Control+k'); await P.waitForTimeout(300);
  await P.keyboard.type('Briefing'); await P.waitForTimeout(300);
  const befehl = P.locator('button, [role="option"], li, div').filter({ hasText: /^Board-Briefing/ }).first();
  await befehl.click().catch(() => {});
  await fertig(P);
  const neu = neueNotiz(vorher, await knoten(P));
  pruefe('D1 der Befehl legt das Briefing an', !!neu && notizText(neu).text.includes('UEBERFAELLIG'), (await knoten(P)).length);
  await ctx.close();
}

pruefe('E1 keine Fehler in der Seite', fehler.length === 0, fehler.slice(0, 3));

await browser.close(); app.close();
console.log(`\nM444: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
