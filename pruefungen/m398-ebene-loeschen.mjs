/**
 * M398 — Projekte und Bereiche löschen, in denen noch Boards liegen.
 *
 * Gewünscht: „Es ist sehr mühsam, wenn man Bereiche oder Projekte löschen will, in welchen noch Boards sind."
 *
 *   A  Projekt mit Boards: Das Menü öffnet einen Dialog, der zeigt, was darin liegt. „Mit löschen" entfernt Projekt
 *      und Boards in einem Schritt; „Rückgängig" in der Meldung holt alles an seine Stelle zurück.
 *   B  „Behalten und verschieben": Die Boards ziehen in ein anderes Projekt; auch das lässt sich zurücknehmen.
 *   C  Bereich: dasselbe eine Ebene höher – mit allen Projekten; der letzte Bereich bleibt.
 *   D  Leere Projekte und Bereiche verschwinden ohne Rückfrage, aber mit „Rückgängig".
 *   E  Grenzfälle: Es bleibt immer eine Arbeitsfläche; Boards anderer Konten werden nicht gelöscht; Esc bricht ab.
 *   F  Telefon, Englisch, Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m398-ebene-loeschen.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import { chromium, devices } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4714;
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
const app = http.createServer((q, r) => {
  let f = path.join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' }[path.extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];

const notiz = (id, text) => ({ id, type: 'note', position: { x: 0, y: 0 }, width: 220, height: 120, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: [{ type: 'text', text, styles: {} }] }] } });
const board = (id, name, karten = 0, mehr = {}) => ({ id, name, edges: [], drawings: [], nodes: Array.from({ length: karten }, (_, i) => notiz(`${id}-n${i}`, `${name} ${i + 1}`)), ...mehr });
/** Zwei Bereiche: „Arbeit" (Alpha: 3 Boards, Beta: 1 Board, Leer) und „Privat" (Haus: 2 Boards) */
const grundStand = () => ({
  boards: [board('a1', 'Alpha eins', 3), board('a2', 'Alpha zwei', 2), board('a3', 'Alpha drei', 0, { archived: true }), board('b1', 'Beta eins', 1), board('h1', 'Haus eins', 4), board('h2', 'Haus zwei', 1)],
  spaces: [
    { id: 's1', name: 'Arbeit', projects: [{ id: 'pa', name: 'Alpha', boardIds: ['a1', 'a2', 'a3'] }, { id: 'pb', name: 'Beta', boardIds: ['b1'] }, { id: 'pl', name: 'Leer', boardIds: [] }] },
    { id: 's2', name: 'Privat', projects: [{ id: 'ph', name: 'Haus', boardIds: ['h1', 'h2'] }] },
  ],
  activeId: 'b1', view: 'board', cardFocus: false, navLinks: true,
});
const auf = async (stand, opt = {}, sprache = '') => {
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1440, height: 900 }, ...opt });
  await ctx.addInitScript(([s, sp]) => {
    try { if (window !== window.top || localStorage.getItem('pixinotes-onboarded')) return; } catch { return; }
    localStorage.setItem('pixinotes-onboarded', '1'); localStorage.setItem('pixinotes-ohne-emoji', '1');
    if (sp) localStorage.setItem('pixinotes-sprache', sp);
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: s }));
  }, [stand, sprache]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1400);
  return { ctx, P };
};
/** Der Stand, wie die App ihn gerade führt (über die Baumansicht und den Speicher gelesen) */
const stand = async (P) => {
  await P.waitForTimeout(700);   // der Speicher schreibt verzögert
  return P.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('pixinotes-board')).state;
    return {
      boards: s.boards.map((b) => b.id), namen: s.boards.map((b) => b.name), aktiv: s.activeId,
      bereiche: s.spaces.map((sp) => sp.name),
      baum: s.spaces.map((sp) => `${sp.name}[${sp.projects.map((p) => `${p.name}(${p.boardIds.join(',')})`).join(' ')}]`).join(' | '),
    };
  });
};
const projektMenu = async (P, name) => {
  const kopf = P.locator('.nav-tree .side-proj-head', { hasText: name }).first();
  await kopf.hover(); await kopf.locator('.ebenen-menu-knopf').click(); await P.waitForTimeout(250);
};
const bereichMenu = async (P, name) => {
  const kopf = P.locator('.nav-tree .side-space-head', { hasText: name }).first();
  await kopf.hover(); await kopf.locator('.ebenen-menu-knopf').click(); await P.waitForTimeout(250);
};
const dialog = (P) => P.evaluate(() => {
  const d = document.querySelector('[data-taste="ebene-weg"]'); if (!d) return null;
  return {
    titel: d.querySelector('h2')?.textContent ?? '', inhalt: (d.querySelector('[data-taste="ebene-weg-inhalt"]')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    zeilen: [...d.querySelectorAll('[data-taste="ebene-weg-liste"] li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim()),
    loeschen: d.querySelector('[data-taste="ebene-weg-loeschen"]')?.checked, behalten: d.querySelector('[data-taste="ebene-weg-behalten"]')?.checked,
    behaltenAus: d.querySelector('[data-taste="ebene-weg-behalten"]')?.disabled,
    ziele: [...d.querySelectorAll('[data-taste="ebene-weg-ziel"] option')].map((o) => o.textContent),
    gruppen: [...d.querySelectorAll('[data-taste="ebene-weg-ziel"] optgroup')].map((o) => o.label),
    knopf: d.querySelector('[data-taste="ebene-weg-tun"]')?.textContent ?? '', fokus: document.activeElement?.getAttribute('data-taste') ?? '',
    fremd: d.querySelector('[data-taste="ebene-weg-fremd"]')?.textContent ?? '',
    breite: d.getBoundingClientRect().width, rechts: d.getBoundingClientRect().right, links: d.getBoundingClientRect().left,
  };
});
const meldung = (P) => P.evaluate(() => ({ text: document.querySelector('.toast')?.textContent ?? '', knopf: !!document.querySelector('.toast .toast-undo') }));

// ---------- A: Projekt mit Boards löschen ----------
console.log('A  Projekt mit Boards');
{
  const { ctx, P } = await auf(grundStand());
  await projektMenu(P, 'Alpha');
  const eintrag = P.locator('[data-taste="projekt-loeschen"]');
  pruefe('A1 das Menü bietet „Löschen …" an – nicht mehr „nur wenn leer"', /^Löschen …$/.test((await eintrag.textContent()).trim()) && !(await eintrag.isDisabled()));
  await eintrag.click(); await P.waitForTimeout(300);
  let d = await dialog(P);
  pruefe('A2 der Dialog heißt „Projekt löschen"', d?.titel === 'Projekt löschen', d?.titel);
  pruefe('A3 … und nennt Namen und Inhalt: 3 Boards, 5 Karten', d?.inhalt === 'Alpha · 3 Boards · 5 Karten', d?.inhalt);
  pruefe('A4 … Board für Board, das archivierte ist markiert', d?.zeilen.length === 3 && /Alpha eins.*3 Karten/.test(d.zeilen[0]) && /Alpha drei.*Archiv.*0 Karten/.test(d.zeilen[2]), d?.zeilen);
  pruefe('A5 vorgewählt ist „Mit löschen", der Knopf heißt „Löschen" und hat den Fokus', d?.loeschen === true && d.behalten === false && d.knopf === 'Löschen' && d.fokus === 'ebene-weg-tun', d);
  pruefe('A6 als Ziel stehen die anderen Projekte bereit, nach Bereich gruppiert', d?.ziele.join(',') === 'Beta,Leer,Haus' && d.gruppen.join(',') === 'Arbeit,Privat', d);
  const vorher = await stand(P);
  await P.locator('[data-taste="ebene-weg-tun"]').click(); await P.waitForTimeout(300);
  const m = await meldung(P);
  let s = await stand(P);
  pruefe('A7 Projekt und Boards sind in einem Schritt weg', s.baum === 'Arbeit[Beta(b1) Leer()] | Privat[Haus(h1,h2)]' && s.boards.join(',') === 'b1,h1,h2', s);
  pruefe('A8 die Meldung sagt es und bietet „Rückgängig"', /Projekt „Alpha" mit 3 Board\(s\) gelöscht\./.test(m.text) && m.knopf, m);
  pruefe('A9 der Dialog ist zu', (await dialog(P)) === null);
  await P.locator('.toast .toast-undo').click(); await P.waitForTimeout(300);
  s = await stand(P);
  pruefe('A10 „Rückgängig" stellt Projekt und Boards an ihrer Stelle wieder her', s.baum === vorher.baum && s.boards.join(',') === vorher.boards.join(','), s);
  pruefe('A11 … mit ihren Karten', await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards.find((b) => b.id === 'a1').nodes.length) === 3);
  pruefe('A12 … und meldet es', /„Alpha" ist wieder da\./.test((await meldung(P)).text), (await meldung(P)).text);
  // das Projekt mit dem offenen Board löschen: es geht auf einem anderen Board weiter
  await projektMenu(P, 'Beta'); await P.locator('[data-taste="projekt-loeschen"]').click(); await P.waitForTimeout(300);
  d = await dialog(P);
  pruefe('A13 Einzahl stimmt: „1 Board · 1 Karte"', d?.inhalt === 'Beta · 1 Board · 1 Karte', d?.inhalt);
  await P.keyboard.press('Enter'); await P.waitForTimeout(300);
  s = await stand(P);
  pruefe('A14 Eingabe bestätigt; das offene Board war dabei – es geht auf einem sichtbaren weiter', !s.boards.includes('b1') && s.aktiv === 'a1', s);
  await P.locator('.toast .toast-undo').click(); await P.waitForTimeout(300);
  s = await stand(P);
  pruefe('A15 nach „Rückgängig" ist wieder das alte Board offen', s.aktiv === 'b1' && s.baum === vorher.baum, s);
  await ctx.close();
}

// ---------- B: Behalten und verschieben ----------
console.log('B  Behalten und verschieben');
{
  const { ctx, P } = await auf(grundStand());
  await projektMenu(P, 'Alpha'); await P.locator('[data-taste="projekt-loeschen"]').click(); await P.waitForTimeout(300);
  await P.locator('[data-taste="ebene-weg-ziel"]').selectOption({ label: 'Haus' }); await P.waitForTimeout(150);
  const d = await dialog(P);
  pruefe('B1 ein Ziel zu wählen stellt auf „Behalten" um; der Knopf sagt, was geschieht', d?.behalten === true && d.knopf === 'Löschen und verschieben', d);
  await P.locator('[data-taste="ebene-weg-tun"]').click(); await P.waitForTimeout(300);
  let s = await stand(P);
  pruefe('B2 das Projekt ist weg, seine Boards liegen im Ziel', s.baum === 'Arbeit[Beta(b1) Leer()] | Privat[Haus(h1,h2,a1,a2,a3)]' && s.boards.length === 6, s);
  const m = await meldung(P);
  pruefe('B3 die Meldung nennt das Ziel', /Projekt „Alpha" gelöscht – die Boards liegen jetzt in „Haus"\./.test(m.text) && m.knopf, m);
  await P.locator('.toast .toast-undo').click(); await P.waitForTimeout(300);
  s = await stand(P);
  pruefe('B4 „Rückgängig" holt das Projekt zurück und nimmt die Boards wieder aus dem Ziel', s.baum === 'Arbeit[Alpha(a1,a2,a3) Beta(b1) Leer()] | Privat[Haus(h1,h2)]', s);
  await ctx.close();
}

// ---------- C: Bereich ----------
console.log('C  Bereich');
{
  const { ctx, P } = await auf(grundStand());
  await bereichMenu(P, 'Arbeit');
  const eintrag = P.locator('[data-taste="bereich-loeschen"]');
  pruefe('C1 auch der Bereich lässt sich mit Inhalt löschen', /^Löschen …$/.test((await eintrag.textContent()).trim()) && !(await eintrag.isDisabled()));
  await eintrag.click(); await P.waitForTimeout(300);
  const d = await dialog(P);
  pruefe('C2 der Dialog zählt Projekte, Boards und Karten', d?.titel === 'Bereich löschen' && d?.inhalt === 'Arbeit · 3 Projekte · 4 Boards · 6 Karten', d);
  pruefe('C3 jede Zeile nennt ihr Projekt', d?.zeilen.length === 4 && /Alpha eins.*Alpha.*3 Karten/.test(d.zeilen[0]) && /Beta eins.*Beta.*1 Karte$/.test(d.zeilen[3]), d?.zeilen);
  pruefe('C4 als Ziel steht der andere Bereich bereit', d?.ziele.join(',') === 'Privat', d?.ziele);
  await P.locator('[data-taste="ebene-weg-tun"]').click(); await P.waitForTimeout(300);
  let s = await stand(P);
  pruefe('C5 Bereich, Projekte und Boards sind weg; es geht auf einem verbliebenen Board weiter', s.baum === 'Privat[Haus(h1,h2)]' && s.boards.join(',') === 'h1,h2' && s.aktiv === 'h1', s);
  pruefe('C6 die Meldung bietet „Rückgängig"', /Bereich „Arbeit" mit 4 Board\(s\) gelöscht\./.test((await meldung(P)).text) && (await meldung(P)).knopf, (await meldung(P)).text);
  await P.locator('.toast .toast-undo').click(); await P.waitForTimeout(300);
  s = await stand(P);
  pruefe('C7 „Rückgängig": der Bereich steht wieder vorn, mit allem', s.baum === 'Arbeit[Alpha(a1,a2,a3) Beta(b1) Leer()] | Privat[Haus(h1,h2)]' && s.boards.join(',') === 'a1,a2,a3,b1,h1,h2' && s.aktiv === 'b1', s);
  // Projekte behalten: sie ziehen in den anderen Bereich
  await bereichMenu(P, 'Privat'); await P.locator('[data-taste="bereich-loeschen"]').click(); await P.waitForTimeout(300);
  await P.locator('[data-taste="ebene-weg-behalten"]').check(); await P.waitForTimeout(100);
  await P.locator('[data-taste="ebene-weg-tun"]').click(); await P.waitForTimeout(300);
  s = await stand(P);
  pruefe('C8 „Behalten": die Projekte des Bereichs ziehen in den anderen', s.baum === 'Arbeit[Alpha(a1,a2,a3) Beta(b1) Leer() Haus(h1,h2)]' && s.boards.length === 6, s);
  pruefe('C9 … die Meldung nennt ihn', /Bereich „Privat" gelöscht – die Projekte liegen jetzt in „Arbeit"\./.test((await meldung(P)).text), (await meldung(P)).text);
  await bereichMenu(P, 'Arbeit');
  pruefe('C10 der letzte Bereich bleibt: „Löschen" ist dort aus', await P.locator('[data-taste="bereich-loeschen"]').isDisabled());
  await P.keyboard.press('Escape');
  await ctx.close();
}

// ---------- D: leere Ebenen ----------
console.log('D  Leere Projekte und Bereiche');
{
  const st = grundStand(); st.spaces.push({ id: 's3', name: 'Ablage', projects: [] });
  const { ctx, P } = await auf(st);
  await projektMenu(P, 'Leer');
  pruefe('D1 am leeren Projekt heißt es schlicht „Löschen"', (await P.locator('[data-taste="projekt-loeschen"]').textContent()).trim() === 'Löschen');
  await P.locator('[data-taste="projekt-loeschen"]').click(); await P.waitForTimeout(300);
  let s = await stand(P);
  pruefe('D2 es verschwindet ohne Rückfrage', (await dialog(P)) === null && !/Leer\(/.test(s.baum), s.baum);
  pruefe('D3 … mit „Rückgängig" in der Meldung', /Projekt „Leer" gelöscht\./.test((await meldung(P)).text) && (await meldung(P)).knopf, (await meldung(P)).text);
  await P.locator('.toast .toast-undo').click(); await P.waitForTimeout(300);
  s = await stand(P);
  pruefe('D4 … und kommt an seine Stelle zurück', /Arbeit\[Alpha\(a1,a2,a3\) Beta\(b1\) Leer\(\)\]/.test(s.baum), s.baum);
  await bereichMenu(P, 'Ablage'); await P.locator('[data-taste="bereich-loeschen"]').click(); await P.waitForTimeout(300);
  s = await stand(P);
  pruefe('D5 der leere Bereich ebenso', (await dialog(P)) === null && !s.bereiche.includes('Ablage') && /Bereich „Ablage" gelöscht\./.test((await meldung(P)).text), s.bereiche);
  await ctx.close();
}

// ---------- E: Grenzfälle ----------
console.log('E  Grenzfälle');
{
  // Alles Sichtbare liegt in einem Projekt
  const { ctx, P } = await auf({ boards: [board('x1', 'Einzig', 2), board('x2', 'Ruht', 1, { archived: true })],
    spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Alles', boardIds: ['x1', 'x2'] }] }], activeId: 'x1', view: 'board', cardFocus: false, navLinks: true });
  await projektMenu(P, 'Alles'); await P.locator('[data-taste="projekt-loeschen"]').click(); await P.waitForTimeout(300);
  let d = await dialog(P);
  pruefe('E1 ohne anderes Projekt ist „Behalten" nicht wählbar – und das steht da', d?.behaltenAus === true && d.ziele.length === 0 && /Es gibt kein anderes Projekt/.test(await P.locator('[data-taste="ebene-weg"]').textContent()), d);
  await P.locator('[data-taste="ebene-weg-tun"]').click(); await P.waitForTimeout(300);
  let s = await stand(P);
  pruefe('E2 danach liegt ein leeres Board bereit – die Arbeitsfläche geht nie verloren', s.boards.length === 1 && s.namen[0] === 'Mein Board' && s.aktiv === s.boards[0] && /Arbeit\[Allgemein\(/.test(s.baum), s);
  await P.locator('.toast .toast-undo').click(); await P.waitForTimeout(300);
  s = await stand(P);
  pruefe('E3 „Rückgängig" räumt das leere Board samt Projekt wieder weg', s.baum === 'Arbeit[Alles(x1,x2)]' && s.boards.join(',') === 'x1,x2' && s.aktiv === 'x1', s);
  await ctx.close();
}
{
  // Ein Board gehört einem anderen Konto
  const st = grundStand(); st.boards[1] = board('a2', 'Alpha zwei', 2, { geteiltVon: 'u-anna', geteiltVonName: 'anna@example.de' });
  const { ctx, P } = await auf(st);
  await projektMenu(P, 'Alpha'); await P.locator('[data-taste="projekt-loeschen"]').click(); await P.waitForTimeout(300);
  const d = await dialog(P);
  pruefe('E4 der Dialog sagt, dass das geteilte Board bleibt', /Ein Board gehört einem anderen Konto und bleibt erhalten\./.test(d?.fremd ?? '') && /Alpha zwei.*geteilt/.test(d.zeilen[1]), d);
  await P.locator('[data-taste="ebene-weg-tun"]').click(); await P.waitForTimeout(300);
  let s = await stand(P);
  pruefe('E5 es wird nicht gelöscht, sondern zieht in ein verbleibendes Projekt', s.boards.includes('a2') && !s.boards.includes('a1') && /Beta\(b1,a2\)/.test(s.baum), s);
  pruefe('E6 die Meldung sagt es', /Projekt „Alpha" mit 2 Board\(s\) gelöscht – geteilte Boards anderer bleiben\./.test((await meldung(P)).text), (await meldung(P)).text);
  await P.locator('.toast .toast-undo').click(); await P.waitForTimeout(300);
  s = await stand(P);
  pruefe('E7 „Rückgängig" legt es zurück ins Projekt', s.baum === 'Arbeit[Alpha(a1,a2,a3) Beta(b1) Leer()] | Privat[Haus(h1,h2)]', s.baum);
  // Abbrechen
  await projektMenu(P, 'Alpha'); await P.locator('[data-taste="projekt-loeschen"]').click(); await P.waitForTimeout(300);
  await P.keyboard.press('Escape'); await P.waitForTimeout(250);
  pruefe('E8 Esc schließt den Dialog, nichts ist gelöscht', (await dialog(P)) === null && (await stand(P)).baum === s.baum);
  await projektMenu(P, 'Alpha'); await P.locator('[data-taste="projekt-loeschen"]').click(); await P.waitForTimeout(300);
  await P.locator('[data-taste="ebene-weg-abbrechen"]').click(); await P.waitForTimeout(250);
  pruefe('E9 „Abbrechen" ebenso', (await dialog(P)) === null && (await stand(P)).baum === s.baum);
  // Auch die Übersicht führt dorthin
  await P.locator('.nav-tree').getByText('Übersicht', { exact: true }).first().click().catch(() => {});
  await P.evaluate(() => 0);
  await ctx.close();
}

// ---------- F: Telefon, Englisch, Texte ----------
console.log('F  Telefon, Englisch, Texte');
{
  const T = await auf(grundStand(), { ...devices['Pixel 7'] });
  await T.P.evaluate(() => window.dispatchEvent(new CustomEvent('pixinotes:ebene-loeschen', { detail: { art: 'bereich', id: 's1' } })));
  await T.P.waitForTimeout(400);
  const d = await dialog(T.P);
  const breit = await T.P.evaluate(() => innerWidth);
  pruefe('F1 am Telefon passt der Dialog in die Breite', !!d && d.links >= 0 && d.rechts <= breit && d.zeilen.length === 4, { d: d && [d.links, d.rechts], breit });
  await T.ctx.close();
  const E = await auf(grundStand(), {}, 'en');
  await projektMenu(E.P, 'Alpha'); await E.P.locator('[data-taste="projekt-loeschen"]').click(); await E.P.waitForTimeout(400);
  const text = await E.P.locator('[data-taste="ebene-weg"]').textContent();
  pruefe('F2 der Dialog ist englisch', /Delete project/.test(text) && /Alpha · 3 boards · 5 cards/i.test(text.replace(/\s+/g, ' ')) && /Delete along with it/.test(text) && /Keep and move/.test(text) && !/löschen|Boards geschehen|Behalten/.test(text), text.replace(/\s+/g, ' ').slice(0, 300));
  await E.P.locator('[data-taste="ebene-weg-tun"]').click(); await E.P.waitForTimeout(300);
  const m = await meldung(E.P);
  pruefe('F3 … und die Meldung auch', /Project “Alpha” deleted with 3 board\(s\)\./.test(m.text) && /Undo/.test(m.text), m.text);
  await E.ctx.close();
  const lies = (p) => readFileSync(path.join(__repo, p), 'utf-8');
  pruefe('F4 die Hilfe nennt M398 – deutsch und englisch', lies('src/components/HelpOverlay.tsx').includes('(M398)') && lies('src/components/HelpOverlayEn.tsx').includes('(M398)'));
  pruefe('F5 keine Fehler in der Konsole', fehler.length === 0, fehler.join(' | ').slice(0, 300));
}

console.log(`\nm398-ebene-loeschen: ${ok} bestanden, ${bad} fehlgeschlagen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
