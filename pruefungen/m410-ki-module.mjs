/**
 * M410 — Die KI kennt jedes Modul: lesen, bedienen, erinnern.
 *
 * Gefragt: „Die KI-Funktionen pro Board und pro Modul sind noch nicht wirklich gut. KI muss alle Funktionen von jedem
 * Modul kennen und bedienen/füllen/auslesen können, damit auch die Module, Board kompletter Inhalt etc. erfasst und
 * logisch verarbeitet werden kann. Wäre es sinnvoll, hierzu eine kleine vektorbasierte DB mit Prompthistory und
 * objektbasiertem Content zu erzeugen?"
 *
 *   A  LESEN: Der Auftrag an das Modell enthält jedes Modul ganz und gegliedert – lange Notiz bis zum letzten Wort,
 *      Tickets, Vorgänge, Einträge, Sitzungen mit Kennung, Tabellen mit Formel UND Ergebnis, Rahmen mit Inhalt,
 *      Portal mit Ziel, Pfeile, Lage; dazu die Operationen der vorhandenen Module.
 *   B  BEDIENEN: Tabelle (Zellen, Zeilen vor der Summe, Aussehen, Sortierung), Kanban (anlegen mit Spalten, Ticket
 *      ändern/verschieben/löschen), Zeitplan, Planer, Protokoll, Zeiterfassung, Ideen, Diagramm, Notiz anhängen –
 *      und alles ist EIN Schritt für Rückgängig.
 *   C  FRAGEN: Eine kurze Antwort steht in der Meldung, eine lange wird eine Notiz; am Board ändert sich sonst nichts.
 *   D  ERINNERN: Die nächste Anweisung kennt die vorige samt der dabei entstandenen Karten; Pfeil hoch holt sie zurück.
 *   E  AUSWAHL: Die gewählte Karte ist das Ziel, der Rest des Boards steht zur Orientierung dabei; das Eingabefeld
 *      nennt ein Beispiel für dieses Modul.
 *   F  GROSSES BOARD: ein Auftrag statt vieler – Passendes ganz, der Rest als Steckbrief; „alle …" arbeitet in Portionen.
 *   G  Keine Fehler.
 */
// Läuft aus dem Repository: `node pruefungen/m410-ki-module.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4726;
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

const absatz = (t) => ({ type: 'paragraph', content: t });
const langerText = Array.from({ length: 14 }, (_, i) => `Absatz ${i + 1}: Die Halle wird im Herbst umgebaut, die Lieferanten sind informiert und der Zeitplan steht.`);
const board = () => [
  { id: 'n1', type: 'note', position: { x: 40, y: 60 }, width: 260, data: { color: 'yellow', blocks: [{ type: 'heading', props: { level: 3 }, content: 'Umbau Halle' }, ...langerText.map(absatz), absatz('SCHLUSSWORT ganz am Ende')] } },
  { id: 'k1', type: 'kanban', position: { x: 360, y: 40 }, width: 560, data: { title: 'Aufgaben Umbau', cols: ['Offen', 'In Arbeit', 'Erledigt'], items: [
    { id: 't1', text: 'Angebot schreiben', col: 0, due: '2026-12-01', who: 'Anna' },
    { id: 't2', text: 'Rechnung prüfen', col: 1, prio: 1, note: 'Skonto beachten', subs: [{ id: 'u1', text: 'Betrag', done: true }, { id: 'u2', text: 'Frist' }] },
    { id: 't3', text: 'Alter Entwurf', col: 0 },
  ] } },
  { id: 's1', type: 'sheet', position: { x: 40, y: 760 }, width: 420, height: 260, data: { title: 'Kosten', cols: 3, rows: 6, cells: { A1: 'Posten', B1: 'Betrag', A2: 'Miete', B2: '850', A3: 'Strom', B3: '95', A4: 'Summe', B4: '=SUMME(B2:B3)' }, stilListe: [{ f: 1 }], stile: { A4: 0, B4: 0 } } },
  { id: 'g1', type: 'gantt', position: { x: 980, y: 40 }, width: 520, height: 240, data: { title: 'Bauphasen', rows: [{ id: 'r1', name: 'Abriss', start: '2026-12-01', end: '2026-12-10' }, { id: 'r2', name: 'Rohbau', start: '2026-12-11', end: '2026-12-31', who: 'Ben', dep: 'r1' }] } },
  { id: 'w1', type: 'week', position: { x: 980, y: 320 }, width: 620, height: 440, data: { title: 'Dienstplan', days: 5, from: 480, to: 1020, entries: [{ id: 'e1', day: 0, start: 540, dur: 90, text: 'Baubesprechung', who: 'Anna' }] } },
  { id: 'm1', type: 'minutes', position: { x: 520, y: 760 }, width: 420, height: 420, data: { title: 'Jour fixe Bau', color: 'white', agenda: ['Stand', 'Kosten'], carryOpen: true, entries: [{ id: 'x1', date: '2026-11-10', attendees: 'Anna, Ben', blocks: [absatz('Der Abriss beginnt im Dezember.')], decisions: [{ id: 'd1', text: 'Budget 20.000 Euro freigegeben' }] }] } },
  { id: 'z1', type: 'time', position: { x: 980, y: 800 }, width: 460, height: 380, data: { title: 'Stunden Anna', segs: [{ id: 'q1', date: '2026-11-18', start: 480, end: 720, kind: 'arbeit', note: 'Planung' }] } },
  { id: 'd1m', type: 'mermaid', position: { x: 1640, y: 40 }, width: 360, height: 260, data: { code: 'flowchart TD\n  A[Start] --> B[Ende]' } },
  { id: 'p1', type: 'portal', position: { x: 1640, y: 340 }, width: 220, data: { boardId: 'b2' } },
  { id: 'f1', type: 'frame', position: { x: 10, y: 10 }, width: 320, height: 700, data: { name: 'Planung' } },
];
const kanten = [{ id: 'k-1', source: 'n1', target: 'k1', label: 'führt zu', type: 'pn', data: {} }];

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];
/** Seite mit simuliertem Modell: `antworten(nr, prompt)` liefert den Plan (oder Rohtext) je Aufruf */
const auf = async (nodes, antworten, wahl = {}) => {
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(([nn, ee, anbieter]) => {
    try { if (window !== window.top || localStorage.getItem('pixinotes-onboarded')) return; } catch { return; }
    localStorage.setItem('pixinotes-onboarded', '1'); localStorage.setItem('pixinotes-ohne-emoji', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
      boards: [{ id: 'b1', name: 'Umbau', edges: ee, drawings: [], nodes: nn, comments: [] }, { id: 'b2', name: 'Ablage 2025', edges: [], drawings: [], nodes: [], comments: [] }],
      spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['b1', 'b2'] }] }], activeId: 'b1', view: 'board', cardFocus: false, navLinks: false, clickZoom: false, physicsEnabled: false,
      ai: anbieter === 'ollama' ? { provider: 'ollama', model: 'klein', apiKey: '', baseUrl: 'http://localhost:11434' } : { provider: 'openai', model: 'gpt-test', apiKey: 'test', baseUrl: '' } } }));
  }, [nodes, wahl.kanten ?? [], wahl.anbieter ?? 'openai']);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  const aufrufe = [];
  await P.route('**/chat/completions', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    const c = body.messages?.[0]?.content;
    const prompt = typeof c === 'string' ? c : (c ?? []).map((t) => t.text ?? '').join('\n');
    aufrufe.push(prompt);
    const a = antworten(aufrufe.length, prompt);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: typeof a === 'string' ? a : JSON.stringify(a) }, finish_reason: 'stop' }] }) });
  });
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  return { ctx, P, aufrufe };
};
const knoten = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes);
const karte = async (P, id) => (await knoten(P)).find((n) => n.id === id);
const toast = (P) => P.evaluate(() => document.querySelector('.toast')?.textContent ?? '');
const fertig = async (P) => {
  await P.waitForFunction(() => { const t = document.querySelector('.toast')?.textContent ?? ''; return t !== '' && !/analysiert|^KI: /.test(t); }, null, { timeout: 30000 }).catch(() => {});
  const t = await toast(P);
  await P.waitForTimeout(1300);   // der Stand wird verzögert gespeichert
  return t;
};
const dockAuf = async (P) => {
  await P.evaluate(() => [...document.querySelectorAll('.dock button')].find((b) => b.getAttribute('aria-label') === 'Mehr')?.click());
  await P.waitForTimeout(300);
  await P.evaluate(() => [...document.querySelectorAll('.dock-menu-more button')].find((b) => b.textContent.includes('KI-Assistent'))?.click());
  await P.waitForTimeout(300);
};
const anweisen = async (P, wunsch) => {
  await dockAuf(P);
  await P.locator('[data-taste="ki-board-eingabe"]').fill(wunsch);
  await P.locator('.dock-menu-ai .ai-cmd-go').click();
  return fertig(P);
};
/** Die Kartenliste aus dem Auftrag */
const liste = (prompt, marke = 'Vorhandene Karten (id, type, text):') => {
  const i = prompt.indexOf(marke); if (i < 0) return [];
  const rest = prompt.slice(i + marke.length + 1); const ende = rest.indexOf(']\n\n');
  try { return JSON.parse(rest.slice(0, ende + 1)); } catch { return []; }
};
const von = (items, id) => items.find((c) => c.id === id)?.text ?? '';

// ---------- A: LESEN ----------
console.log('A  Lesen: jedes Modul ganz und gegliedert');
{
  const { ctx, P, aufrufe } = await auf(board(), () => ({ summary: 'ok', ops: [{ op: 'answer', text: 'Gelesen.' }] }), { kanten });
  await anweisen(P, 'Verschaffe dir einen Überblick');
  const prompt = aufrufe[0] ?? ''; const items = liste(prompt);
  pruefe('A1 ein Auftrag, alle zehn Karten darin', aufrufe.length === 1 && items.length === 10, { aufrufe: aufrufe.length, karten: items.length });
  pruefe('A2 die lange Notiz steht ganz da – bis zum letzten Wort (früher: 400 Zeichen)', von(items, 'n1').includes('SCHLUSSWORT ganz am Ende') && von(items, 'n1').length > 1200, von(items, 'n1').length);
  const k = von(items, 'k1');
  pruefe('A3 Kanban: Spalten, jedes Ticket mit Kennung, Frist, Person, Priorität, Checkliste', /Spalten: Offen \| In Arbeit \| Erledigt/.test(k) && k.includes('[t1] Offen · Angebot schreiben · fällig 2026-12-01 · @Anna') && /\[t2\] In Arbeit · Rechnung prüfen · Prio hoch · Notiz: Skonto beachten · Checkliste 1\/2/.test(k), k);
  const s = von(items, 's1');
  pruefe('A4 Tabelle: Zeilen mit Nummer, die Formel UND ihr Ergebnis', s.includes('2: Miete | 850') && s.includes('4: Summe | =SUMME(B2:B3) → 945') && /Spalten A–C/.test(s), s);
  pruefe('A5 Zeitplan und Planer: Vorgänge und Einträge mit Kennung, Vorgänger, Zeiten', von(items, 'g1').includes('[r2] Rohbau · 2026-12-11 → 2026-12-31 · @Ben · nach r1') && /\[e1\] day 0 \(Mo\) · start 540 dur 90 \(9:00–10:30\) · Baubesprechung · Anna/.test(von(items, 'w1')), { g: von(items, 'g1'), w: von(items, 'w1') });
  pruefe('A6 Protokoll und Zeiterfassung: Sitzung mit Kennung, Text, Beschluss; Abschnitte mit Summe', von(items, 'm1').includes('[x1] Sitzung 2026-11-10 · Teilnehmende: Anna, Ben') && von(items, 'm1').includes('§ Budget 20.000 Euro freigegeben') && von(items, 'm1').includes('Der Abriss beginnt') && /Arbeit gesamt 4:00/.test(von(items, 'z1')) && von(items, 'z1').includes('[q1] 2026-11-18 8:00–12:00 Arbeit · Planung'), { m: von(items, 'm1'), z: von(items, 'z1') });
  pruefe('A7 Rahmen nennt, was in ihm liegt; das Portal sein Ziel-Board', /Rahmen „Planung" · enthält die Karten: n1/.test(von(items, 'f1')) && von(items, 'p1') === 'Portal zum Board „Ablage 2025"', { f: von(items, 'f1'), p: von(items, 'p1') });
  pruefe('A8 Pfeile und Lage der Karten gehen mit', prompt.includes('Pfeile zwischen den Karten: n1 → k1 (führt zu)') && JSON.stringify(items.find((c) => c.id === 'k1')?.pos) === '[360,40]', items.find((c) => c.id === 'k1')?.pos);
  const ops = ['"op":"answer"', '"op":"sheet"', '"op":"set_cells"', '"op":"add_rows"', '"op":"format_cells"', '"op":"sheet_view"', '"op":"edit_ticket"', '"op":"delete_tickets"', '"op":"add_gantt_rows"', '"op":"edit_gantt_row"', '"op":"add_week_entries"', '"op":"edit_week_entry"', '"op":"minutes"', '"op":"add_session"', '"op":"add_decisions"', '"op":"add_time"', '"op":"bubbles"', '"op":"edit_mermaid"', '"op":"append_note"'];
  pruefe('A9 der Auftrag nennt die Operationen der vorhandenen Module – und das Datum', ops.every((o) => prompt.includes(o)) && /Heute ist \d{4}-\d{2}-\d{2}\./.test(prompt) && !prompt.includes('"op":"add_ideas"'), ops.filter((o) => !prompt.includes(o)));
  await ctx.close();
}

// ---------- B: BEDIENEN ----------
console.log('B  Bedienen: jedes Modul füllen und ändern');
{
  const plan = { summary: 'Alles eingetragen', ops: [
    { op: 'add_rows', id: 's1', rows: [['Wasser', 40], ['Müll', '12,5']] },
    { op: 'set_cells', id: 's1', cells: { C1: 'Jahr', C2: '=B2*12' } },
    { op: 'format_cells', id: 's1', range: 'A1:C1', bold: true, bg: '#1F4E79', color: '#ffffff', align: 'center' },
    { op: 'format_cells', id: 's1', range: 'B2:B6', format: '#,##0.00 "€"' },
    { op: 'sheet_view', id: 's1', sort: { column: 'B', desc: true } },
    { op: 'edit_ticket', id: 'k1', ticket: 't1', column: 'Erledigt', who: 'Ben', due: '' },
    { op: 'edit_ticket', id: 'k1', ticket: 't2', prio: 3, text: 'Rechnung prüfen und zahlen' },
    { op: 'add_tickets', id: 'k1', items: [{ text: 'Gerüst bestellen', column: 'In Arbeit', prio: 'hoch', who: 'Cem', subs: ['Angebot A', 'Angebot B'], due: '2026-12-05' }] },
    { op: 'delete_tickets', id: 'k1', tickets: ['t3'] },
    { op: 'add_gantt_rows', id: 'g1', rows: [{ name: 'Ausbau', start: '2027-01-04', end: '2027-01-29', after: 'r2', progress: 10 }] },
    { op: 'edit_gantt_row', id: 'g1', row: 'r1', end: '2026-12-12', progress: 50 },
    { op: 'add_week_entries', id: 'w1', entries: [{ day: 2, start: 1080, dur: 60, text: 'Abnahme' }] },
    { op: 'edit_week_entry', id: 'w1', entry: 'e1', start: 600, who: '' },
    { op: 'add_session', id: 'm1', date: '2026-11-24', text: '## Stand\n\n- Abriss ist beauftragt', decisions: ['Start am 1. Dezember'] },
    { op: 'add_decisions', id: 'm1', session: 'x1', decisions: ['Gutachter wird bestellt'] },
    { op: 'add_time', id: 'z1', segments: [{ date: '2026-11-19', start: 540, end: 600, kind: 'pause' }, { date: '2026-11-19', start: 700, end: 650 }] },
    { op: 'append_note', id: 'n1', text: '## Nachtrag\n\nDer Gutachter kommt am Montag.' },
    { op: 'edit_mermaid', id: 'd1m', code: 'flowchart TD\n  A[Start] --> P[Prüfung] --> B[Ende]' },
    { op: 'sheet', title: 'Angebote', rows: [['Firma', 'Preis'], ['Alpha', 1200.5], ['Beta', '980'], ['Mittel', '=MITTELWERT(B2:B3)']], filter: true, from: 'n1' },
    { op: 'kanban', title: 'Einkauf', columns: ['Idee', 'Bestellt', 'Da'], items: [{ text: 'Farbe', column: 'Bestellt' }, { text: 'Pinsel' }] },
    { op: 'minutes', title: 'Baurunde', agenda: ['Termine'], sessions: [{ date: '2026-11-20', attendees: 'Cem', text: 'Erste Runde.', decisions: ['Wöchentlich dienstags'] }] },
    { op: 'bubbles', title: 'Namen', question: 'Wie heißt die Halle?', ideas: ['Werk 1', 'Halle Nord', 'Depot'], groups: [{ name: 'Nüchtern', ideas: [0, 2] }] },
    { op: 'time', title: 'Stunden Cem', segments: [{ date: '2026-11-20', start: 480, end: 540, kind: 'arbeit', note: 'Aufmaß' }] },
    { op: 'edit_ticket', id: 'k1', ticket: 'gibt-es-nicht', text: 'x' },
  ] };
  const { ctx, P } = await auf(board(), () => plan);
  const meldung = await anweisen(P, 'Trage alles ein');
  const s = (await karte(P, 's1')).data;
  pruefe('B1 Zeilen kommen VOR die Summenzeile; die Summe rückt nach unten und rechnet sie mit', s.cells.A4 === 'Wasser' && s.cells.B4 === '40' && s.cells.B5 === '12,5' && s.cells.A6 === 'Summe' && s.cells.B6 === '=SUMME(B2:B5)' && s.rows >= 6, s.cells);
  pruefe('B2 einzelne Zellen und Formeln; die Tabelle wächst mit', s.cells.C1 === 'Jahr' && s.cells.C2 === '=B2*12' && s.cols >= 3, { c1: s.cells.C1, c2: s.cells.C2 });
  const stil = (adr) => s.stilListe[s.stile[adr]];
  pruefe('B3 Aussehen: Kopfzeile fett, gefüllt, mittig; Zahlenformat an der Spalte; die Summe bleibt fett', stil('A1')?.f === 1 && stil('C1')?.bg === '#1f4e79' && stil('B1')?.fa === '#ffffff' && stil('A1')?.a === 'm' && stil('B3')?.z === '#,##0.00 "€"' && stil('B6')?.f === 1 && stil('B6')?.z === '#,##0.00 "€"', { a1: stil('A1'), b3: stil('B3'), b6: stil('B6') });
  pruefe('B4 Ansicht: Datentabelle an, sortiert nach B absteigend', s.filterAn === true && s.kopf === 1 && s.sort?.spalte === 'B' && s.sort.ab === true, { an: s.filterAn, sort: s.sort });
  const zeigt = await P.evaluate(() => document.querySelector('.react-flow__node[data-id="s1"] td[data-zelle="B2"]')?.textContent?.trim());
  pruefe('B5 die Karte zeigt es: 850,00 €', zeigt === '850,00 €', zeigt);
  const k = (await karte(P, 'k1')).data; const t = (id) => k.items.find((i) => i.id === id);
  pruefe('B6 Ticket verschoben und erledigt gestempelt, Person geändert, Frist entfernt', t('t1')?.col === 2 && !!t('t1').erledigtAm && t('t1').who === 'Ben' && t('t1').due === undefined, t('t1'));
  pruefe('B7 Ticket umbenannt, Priorität geändert – Notiz und Checkliste bleiben', t('t2')?.text === 'Rechnung prüfen und zahlen' && t('t2').prio === 3 && t('t2').note === 'Skonto beachten' && t('t2').subs.length === 2, t('t2'));
  const neu = k.items.find((i) => i.text === 'Gerüst bestellen');
  pruefe('B8 neues Ticket in der genannten Spalte, mit Person, Priorität, Frist und Checkliste; ein Ticket gelöscht', neu?.col === 1 && neu.who === 'Cem' && neu.prio === 1 && neu.due === '2026-12-05' && neu.subs?.length === 2 && !t('t3') && k.items.length === 3, { neu, zahl: k.items.length });
  const g = (await karte(P, 'g1')).data;
  pruefe('B9 Zeitplan: neuer Vorgang mit Vorgänger und Fortschritt; bestehender geändert', g.rows.length === 3 && g.rows[2].name === 'Ausbau' && g.rows[2].dep === 'r2' && g.rows[2].progress === 10 && g.rows[0].end === '2026-12-12' && g.rows[0].progress === 50, g.rows);
  const w = (await karte(P, 'w1')).data;
  pruefe('B10 Planer: Eintrag ergänzt (das Raster wächst mit), Eintrag verschoben, Person entfernt', w.entries.length === 2 && w.entries[1].text === 'Abnahme' && w.to >= 1140 && w.entries[0].start === 600 && w.entries[0].who === undefined, { e: w.entries, to: w.to });
  const m = (await karte(P, 'm1')).data;
  const neueSitzung = m.entries.find((e) => e.date === '2026-11-24'); const alte = m.entries.find((e) => e.id === 'x1');
  pruefe('B11 Protokoll: neue Sitzung mit Text und Beschluss (zuerst, übernimmt die Runde); Beschluss an der alten ergänzt', m.entries.length === 2 && m.entries[0].date === '2026-11-24' && JSON.stringify(neueSitzung.blocks).includes('Abriss ist beauftragt') && neueSitzung.decisions[0].text === 'Start am 1. Dezember' && neueSitzung.attendees === 'Anna, Ben' && alte.decisions.length === 2, { n: neueSitzung, a: alte?.decisions });
  const z = (await karte(P, 'z1')).data;
  pruefe('B12 Zeiterfassung: gültiger Abschnitt ergänzt, der unmögliche (Ende vor Beginn) nicht', z.segs.length === 2 && z.segs[1].kind === 'pause' && z.segs[1].end === 600, z.segs);
  const n = (await karte(P, 'n1')).data; const nt = JSON.stringify(n.blocks);
  pruefe('B13 Notiz: Text angehängt, der bisherige steht noch da', nt.includes('Nachtrag') && nt.includes('Der Gutachter kommt am Montag.') && nt.includes('SCHLUSSWORT ganz am Ende') && nt.indexOf('Nachtrag') > nt.indexOf('SCHLUSSWORT'), nt.length);
  pruefe('B14 Diagramm: Code ersetzt', (await karte(P, 'd1m')).data.code.includes('P[Prüfung]'));
  const alle = await knoten(P);
  const tab = alle.find((x) => x.type === 'sheet' && x.data.title === 'Angebote')?.data;
  pruefe('B15 neue Tabelle: Kopf fett, Zahl in hiesiger Schreibweise, Formel, Filterknöpfe', !!tab && tab.cells.B2 === '1200,5' && tab.cells.B4 === '=MITTELWERT(B2:B3)' && tab.filterAn === true && tab.stilListe[tab.stile.A1].f === 1, tab?.cells);
  const kb = alle.find((x) => x.type === 'kanban' && x.data.title === 'Einkauf')?.data;
  const pr = alle.find((x) => x.type === 'minutes' && x.data.title === 'Baurunde')?.data;
  const bu = alle.find((x) => x.type === 'bubbles')?.data;
  const ze = alle.find((x) => x.type === 'time' && x.data.title === 'Stunden Cem')?.data;
  pruefe('B16 neues Kanban mit eigenen Spalten, neues Protokoll mit Sitzung, neue Zeiterfassung mit Abschnitt', kb?.cols?.join() === 'Idee,Bestellt,Da' && kb.items[0].col === 1 && kb.items[1].col === 0 && pr?.entries?.length === 1 && pr.entries[0].decisions[0].text === 'Wöchentlich dienstags' && pr.agenda[0] === 'Termine' && ze?.segs?.length === 1, { kb, pr: pr?.entries?.length, ze: ze?.segs });
  const ideen = Object.values(bu?.ideen ?? {}); const gruppe = Object.entries(bu?.gruppen ?? {})[0];
  pruefe('B17 neue Ideen-Sammlung: Frage, drei Ideen, zwei davon in der Gruppe', bu?.frage === 'Wie heißt die Halle?' && ideen.length === 3 && gruppe?.[1].name === 'Nüchtern' && ideen.filter((i) => i.g === gruppe[0]).length === 2, bu);
  const kantenJetzt = await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].edges.length);
  pruefe('B18 „from" verbindet die neue Tabelle mit ihrer Quelle; die Meldung nennt die Schritte (23 von 24 – das unbekannte Ticket nicht)', kantenJetzt === 1 && /Alles eingetragen \(23 Schritte/.test(meldung) && alle.length === 15, { kantenJetzt, meldung, karten: alle.length });
  await P.screenshot({ path: path.join(SD, 'm410-bedienen.png') });
  // EIN Schritt für Rückgängig
  await P.keyboard.press('Control+z'); await P.waitForTimeout(1600);
  const zurueck = await knoten(P); const s0 = zurueck.find((x) => x.id === 's1').data; const k0 = zurueck.find((x) => x.id === 'k1').data;
  pruefe('B19 Strg+Z macht alles in einem Schritt rückgängig', zurueck.length === 10 && s0.cells.B4 === '=SUMME(B2:B3)' && !s0.cells.C1 && k0.items.length === 3 && k0.items.find((i) => i.id === 't1').col === 0 && JSON.stringify(zurueck.find((x) => x.id === 'n1').data.blocks).includes('Nachtrag') === false, { karten: zurueck.length, b4: s0.cells.B4 });
  await ctx.close();
}

// ---------- C: FRAGEN ----------
console.log('C  Fragen: Antwort statt Umbau');
{
  const lang = 'Die Kosten verteilen sich so:\n\n- Miete: 850 Euro\n- Strom: 95 Euro\n\nDas ergibt zusammen 945 Euro im Monat. Der größte Posten ist mit Abstand die Miete; beim Strom lässt sich am ehesten sparen.';
  const { ctx, P } = await auf(board(), (nr) => (nr === 1 ? { summary: 'Antwort', ops: [{ op: 'answer', text: 'Zusammen 945 Euro im Monat.' }] } : { summary: 'Antwort', ops: [{ op: 'answer', text: lang }] }));
  const m1 = await anweisen(P, 'Wie hoch sind die Kosten im Monat?');
  const nach1 = await knoten(P);
  pruefe('C1 kurze Antwort steht in der Meldung – am Board ändert sich nichts', m1.includes('Zusammen 945 Euro im Monat.') && nach1.length === 10 && !/Strg\+Z/.test(m1), m1);
  const rueck = await P.evaluate(() => document.querySelector('[data-taste="undo"], button[aria-label="Rückgängig"]')?.disabled ?? null);
  pruefe('C2 eine reine Antwort legt keinen Schritt für Rückgängig an', rueck !== false, rueck);
  const m2 = await anweisen(P, 'Erkläre mir die Kosten genauer');
  const nach2 = await knoten(P); const notiz = nach2.find((x) => !nach1.some((y) => y.id === x.id));
  pruefe('C3 lange Antwort wird eine Notiz – mit der Frage als Überschrift', /Antwort liegt als Notiz/.test(m2) && nach2.length === 11 && notiz?.type === 'note' && JSON.stringify(notiz.data.blocks).includes('Erkläre mir die Kosten genauer') && JSON.stringify(notiz.data.blocks).includes('größte Posten'), { m2, typ: notiz?.type });
  await ctx.close();
}

// ---------- D: ERINNERN ----------
console.log('D  Erinnern: die nächste Anweisung kennt die vorige');
{
  const { ctx, P, aufrufe } = await auf(board(), (nr) => (nr === 1
    ? { summary: 'Tabelle mit den Angeboten angelegt', ops: [{ op: 'sheet', title: 'Angebote', rows: [['Firma', 'Preis'], ['Alpha', '1200']] }] }
    : { summary: 'Zeile ergänzt', ops: [{ op: 'add_rows', id: (/Karten: ([a-z0-9]+)\)/.exec(nr === 2 ? aufrufe[1] : '') ?? [])[1] ?? 'fehlt', rows: [['Beta', '980']] }] }));
  await anweisen(P, 'Lege eine Tabelle mit den Angeboten an');
  const neu = (await knoten(P)).find((x) => x.type === 'sheet' && x.data.title === 'Angebote');
  pruefe('D1 der erste Auftrag hat keinen Verlauf', !aufrufe[0].includes('Bisher auf diesem Board verlangt'));
  await anweisen(P, 'Füge dort noch Beta mit 980 hinzu');
  const p2 = aufrufe[1] ?? '';
  pruefe('D2 der zweite Auftrag nennt die erste Anweisung, ihr Ergebnis und die dabei entstandene Karte', p2.includes('Bisher auf diesem Board verlangt') && p2.includes('1. „Lege eine Tabelle mit den Angeboten an" → Tabelle mit den Angeboten angelegt') && p2.includes(`(Karten: ${neu?.id})`), p2.slice(p2.indexOf('Bisher'), p2.indexOf('Bisher') + 300));
  const danach = (await karte(P, neu.id)).data;
  pruefe('D3 „dort" trifft die Tabelle von eben: die Zeile steht darin', danach.cells.A3 === 'Beta' && danach.cells.B3 === '980', danach.cells);
  const gemerkt = await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-ki-verlauf') ?? '{}'));
  pruefe('D4 der Verlauf liegt je Board auf dem Gerät', gemerkt.b1?.length === 2 && gemerkt.b1[1].wunsch === 'Füge dort noch Beta mit 980 hinzu' && gemerkt.b1[1].karten.includes(neu.id) && !gemerkt.b2, gemerkt);
  await dockAuf(P);
  const feld = P.locator('[data-taste="ki-board-eingabe"]');
  await feld.focus(); await P.keyboard.press('ArrowUp'); const hoch1 = await feld.inputValue();
  await P.keyboard.press('ArrowUp'); const hoch2 = await feld.inputValue();
  await P.keyboard.press('ArrowDown'); await P.keyboard.press('ArrowDown'); const leer = await feld.inputValue();
  pruefe('D5 Pfeil hoch holt die letzte Anweisung, nochmal die davor; Pfeil runter führt zurück ins leere Feld', hoch1 === 'Füge dort noch Beta mit 980 hinzu' && hoch2 === 'Lege eine Tabelle mit den Angeboten an' && leer === '', { hoch1, hoch2, leer });
  await feld.fill('Mein eigener Text'); await P.keyboard.press('ArrowUp');
  pruefe('D6 wer schon tippt, behält seinen Text', (await feld.inputValue()) === 'Mein eigener Text');
  await P.reload({ waitUntil: 'networkidle' }); await P.waitForTimeout(1200);
  await dockAuf(P); await P.locator('[data-taste="ki-board-eingabe"]').focus(); await P.keyboard.press('ArrowUp');
  pruefe('D7 der Verlauf übersteht das Neuladen', (await P.locator('[data-taste="ki-board-eingabe"]').inputValue()) === 'Füge dort noch Beta mit 980 hinzu');
  await ctx.close();
}

// ---------- E: AUSWAHL ----------
console.log('E  Auswahl: ein Modul ist das Ziel, das Board steht dabei');
{
  const { ctx, P, aufrufe } = await auf(board(), () => ({ summary: 'Tickets eingetragen', ops: [{ op: 'add_rows', id: 's1', rows: [['Angebot schreiben', '']] }] }));
  const k = await P.locator('.react-flow__node[data-id="s1"]').boundingBox();
  await P.mouse.click(k.x + 150, k.y + 14); await P.waitForTimeout(300);
  await P.evaluate(() => [...document.querySelectorAll('.sel-toolbar button')].find((b) => b.getAttribute('aria-label') === 'Mehr')?.click());
  await P.waitForTimeout(400);
  await P.evaluate(() => [...document.querySelectorAll('button')].find((b) => /KI-Aktionen/.test(b.textContent ?? ''))?.click());
  await P.waitForTimeout(400);
  const feld = P.locator('[data-taste="ki-auswahl-eingabe"]');
  pruefe('E1 das Eingabefeld nennt ein Beispiel für dieses Modul', /Summenzeile ergänzen/.test((await feld.getAttribute('placeholder')) ?? ''), await feld.getAttribute('placeholder'));
  await feld.fill('Trage die offenen Tickets aus dem Kanban ein'); await P.keyboard.press('Enter');
  await fertig(P);
  const prompt = aufrufe[0] ?? ''; const ziel = liste(prompt); const rest = liste(prompt, 'ändere sie nur, wenn er es ausdrücklich verlangt):');
  pruefe('E2 Ziel des Auftrags ist nur die gewählte Tabelle', ziel.length === 1 && ziel[0].id === 's1', ziel.map((c) => c.id));
  pruefe('E3 der Rest des Boards steht zur Orientierung dabei – das Kanban ganz, weil der Wunsch es nennt', rest.length === 9 && von(rest, 'k1').includes('[t1] Offen · Angebot schreiben') && !rest.some((c) => c.id === 's1'), rest.map((c) => `${c.id}:${c.text.length}`));
  pruefe('E4 die Operation trifft die gewählte Tabelle', (await karte(P, 's1')).data.cells.A4 === 'Angebot schreiben', (await karte(P, 's1')).data.cells);
  await ctx.close();
}

// ---------- F: GROSSES BOARD ----------
console.log('F  Großes Board: ein Auftrag, Passendes ganz');
{
  const viele = Array.from({ length: 60 }, (_, i) => ({ id: `n${i}`, type: 'note', position: { x: (i % 10) * 300, y: Math.floor(i / 10) * 400 }, width: 260,
    data: { color: 'yellow', blocks: [{ type: 'heading', props: { level: 3 }, content: i === 37 ? 'Brandschutz Halle' : `Thema ${i}` }, ...Array.from({ length: 24 }, (_, z) => absatz(`Zeile ${z} zu Thema ${i}: Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod.`)), absatz(`ENDE${i}`)] } }));
  const { ctx, P, aufrufe } = await auf(viele, () => ({ summary: 'ok', ops: [{ op: 'answer', text: 'Gelesen.' }] }));
  await anweisen(P, 'Was steht zum Brandschutz in den Notizen?');
  const items = liste(aufrufe[0] ?? '');
  pruefe('F1 ein einziger Auftrag über das ganze Board (früher: viele Portionen, jede für sich)', aufrufe.length === 1 && items.length === 60 && !aufrufe[0].includes('Dies ist Teil'), { aufrufe: aufrufe.length, karten: items.length });
  pruefe('F2 die Karte, um die es geht, steht ganz darin', von(items, 'n37').includes('ENDE37'), von(items, 'n37').length);
  const gekuerzt = items.filter((c) => !c.text.includes(`ENDE${c.id.slice(1)}`));
  pruefe('F3 was nicht hineinpasst, steht als Steckbrief da – keine Karte fehlt', gekuerzt.length >= 10 && gekuerzt.every((c) => /nur Anfang/.test(c.text) && c.text.length <= 420) && aufrufe[0].length < 100_000, { gekuerzt: gekuerzt.length, laenge: aufrufe[0].length });
  const vorher = aufrufe.length;
  await anweisen(P, 'Fasse jede Notiz in einem Satz zusammen');
  const teile = aufrufe.slice(vorher);
  pruefe('F4 „jede Notiz" arbeitet weiter in Portionen – jede Karte ganz, jede genau einmal', teile.length >= 3 && teile.every((p) => p.includes('Dies ist Teil')) && new Set(teile.flatMap((p) => liste(p).map((c) => c.id))).size === 60 && teile.every((p) => liste(p).every((c) => c.text.includes(`ENDE${c.id.slice(1)}`))), { teile: teile.length });
  await ctx.close();
}
{
  // Kleines Modell (Ollama): der alte, engere Platz
  const viele = Array.from({ length: 30 }, (_, i) => ({ id: `n${i}`, type: 'note', position: { x: (i % 10) * 300, y: Math.floor(i / 10) * 400 }, width: 260, data: { color: 'yellow', blocks: [absatz(`Thema ${i}`), ...Array.from({ length: 20 }, (_, z) => absatz(`Zeile ${z}: Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy.`))] } }));
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(([nn]) => {
    if (localStorage.getItem('pixinotes-onboarded')) return;
    localStorage.setItem('pixinotes-onboarded', '1'); localStorage.setItem('pixinotes-ohne-emoji', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: { boards: [{ id: 'b1', name: 'Klein', edges: [], drawings: [], nodes: nn }], spaces: [{ id: 's1', name: 'A', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board', navLinks: false,
      ai: { provider: 'ollama', model: 'klein', apiKey: '', baseUrl: 'http://localhost:11434' } } }));
  }, [viele]);
  const P = await ctx.newPage(); P.on('pageerror', (e) => fehler.push(e.message));
  let prompt = '';
  await P.route('**/api/generate', async (route) => { prompt = JSON.parse(route.request().postData() ?? '{}').prompt ?? ''; await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ response: JSON.stringify({ summary: 'ok', ops: [{ op: 'answer', text: 'Gelesen.' }] }), done: true }) }); });
  await P.route('**/api/tags', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"models":[{"name":"klein"}]}' }));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' }); await P.waitForTimeout(1500);
  await anweisen(P, 'Worum geht es hier?');
  pruefe('F5 ein kleines lokales Modell bekommt einen kürzeren Auftrag (rund 30.000 Zeichen statt 80.000)', prompt.length > 8000 && prompt.length < 45_000 && liste(prompt).length === 30, prompt.length);
  await ctx.close();
}

// ---------- G ----------
pruefe('G1 keine Fehler in der Seite', fehler.length === 0, fehler.slice(0, 3));

await browser.close(); app.close();
console.log(`\nM410: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
