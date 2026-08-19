/**
 * M288 — „kann man neben umbenennen noch weitere typische
 * Bearbeitungsmöglichkeiten einführen? kopieren, duplizieren, archivieren
 * etc. … was könnte auf Board- und Projekt-Ebene noch passen?!?"
 *
 * Der Befund vorher: Karten konnten längst alles. Eine Ebene höher hing es an
 * der Ansicht — Reiterleiste: umbenennen, schließen. Übersichts-Kachel:
 * umbenennen, präsentieren, löschen. Navigator: nichts. Drei Ansichten, drei
 * Vorräte.
 *
 * Geprüft wird deshalb nicht nur, DASS es die Handgriffe gibt, sondern dass
 * sie ÜBERALL DIESELBEN sind — und dass Archivieren wirklich das sanfte
 * Löschen ist: nichts verschwindet, es tritt nur zur Seite.
 */
// Läuft aus dem Repository: `node pruefungen/m288-ebenen.mjs`
// Voraussetzung: `npm run build` und ein Chromium (PW_CHROMIUM).
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
import { mkdirSync } from 'node:fs';
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';

const DIST = path.join(__repo, 'dist');
const PORT = 4508;
const app = http.createServer((q, r) => {
  let f = join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));

let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${info}`); }
};

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });

/** Zwei Projekte, drei Boards, eine Aufgabe mit Frist — damit sich Archivieren
 *  auch in der Aufgaben-Zentrale nachweisen lässt. */
async function seite({ ansicht = 'board', archivZeigen = false, aktiv = 'b0' } = {},
  viewport = { width: 1440, height: 900 }, finger = false) {
  // finger = echtes Touch-Gerät (hasTouch): erst dann greifen die Regeln für
  // `pointer: coarse`, an denen die Mindest-Trefferflächen hängen
  const ctx = await browser.newContext({ viewport, hasTouch: finger, isMobile: finger });
  await ctx.addInitScript(([ansicht, archivZeigen, aktiv]) => {
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ navLinks: false }));
    const mk = (id, txt, x, y) => ({ id, type: 'note', position: { x, y }, width: 240, height: 150,
      data: { color: 'yellow', blocks: [{ id: `${id}b`, type: 'paragraph', props: {},
        content: [{ type: 'text', text: txt, styles: {} }], children: [] }] } });
    const aufgabe = { id: 'k1', type: 'kanban', position: { x: 340, y: 60 }, width: 320, height: 240,
      data: { cols: ['Offen', 'Läuft', 'Fertig'], items: [{ id: 'i1', text: 'Bericht abgeben', col: 0, due: '2026-12-01' }] } };
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
      boards: [
        { id: 'b0', name: 'Vorgänge', drawings: [], comments: [],
          nodes: [mk('n1', 'Antrag prüfen', 40, 40), mk('n2', 'Rückmeldung', 40, 240)],
          edges: [{ id: 'e1', source: 'n1', target: 'n2' }] },
        { id: 'b1', name: 'Berichte', edges: [], drawings: [], comments: [], nodes: [aufgabe] },
        { id: 'b2', name: 'Ablage', edges: [], drawings: [], comments: [], nodes: [] },
      ],
      spaces: [{ id: 's1', name: 'Dienst', projects: [
        { id: 'p1', name: 'Laufend', boardIds: ['b0', 'b1'] },
        { id: 'p2', name: 'Archivprojekt', boardIds: ['b2'] },
      ] }],
      activeId: aktiv, view: ansicht, cardFocus: true, navLinks: false, showArchived: archivZeigen } }));
  }, [ansicht, archivZeigen, aktiv]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(2400);
  return { ctx, P };
}

const stand = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state);
const menuEintraege = (P) => P.evaluate(() =>
  [...document.querySelectorAll('.ebenen-menu button')].map((b) => b.textContent.trim()));

/** Seitenleiste ausfahren und den Baum bereitstellen */
async function seitenleiste(P) {
  await P.locator('.sidepanel-fahne').click();
  await P.waitForTimeout(1100);
}

// ══ T1: Der Vorrat am Board — und er ist überall derselbe ═══════════
console.log('════ T1: Ein Menü, überall derselbe Vorrat ════');
let vorratSeite = null;
{
  const { ctx, P } = await seite({ ansicht: 'board' });
  await seitenleiste(P);
  const zeile = P.locator('.side-board', { hasText: 'Berichte' }).first();
  await zeile.locator('.ebenen-menu-knopf').click({ force: true });
  await P.waitForTimeout(500);
  vorratSeite = await menuEintraege(P);
  console.log('    Seitenleiste:', JSON.stringify(vorratSeite));
  for (const wort of ['Umbenennen', 'Duplizieren', 'In Projekt verschieben', 'Teilen-Link kopieren',
    'Als Datei sichern', 'Präsentieren', 'Archivieren', 'Löschen']) {
    pruefe(`T1 „${wort}" steht im Board-Menü`, vorratSeite.some((t) => t.includes(wort)), JSON.stringify(vorratSeite));
  }
  await P.screenshot({ path: `${SD}/m288-boardmenu.png` });
  await ctx.close();
}
{
  // … und in der Übersicht auf der Kachel
  const { ctx, P } = await seite({ ansicht: 'overview' });
  const kachel = P.locator('.ov-board', { hasText: 'Berichte' }).first();
  await kachel.hover();
  await kachel.locator('.ebenen-menu-knopf').click({ force: true });
  await P.waitForTimeout(500);
  const vorratKachel = await menuEintraege(P);
  console.log('    Übersichts-Kachel:', JSON.stringify(vorratKachel));
  pruefe('T1z die Kachel bietet exakt denselben Vorrat wie die Seitenleiste',
    JSON.stringify(vorratKachel) === JSON.stringify(vorratSeite),
    `${JSON.stringify(vorratKachel)} vs ${JSON.stringify(vorratSeite)}`);
  await ctx.close();
}

// ══ T2: Duplizieren — mit Inhalt, aber mit frischen Kennungen ═══════
console.log('\n════ T2: Board duplizieren ════');
{
  const { ctx, P } = await seite({ ansicht: 'board' });
  await seitenleiste(P);
  const zeile = P.locator('.side-board', { hasText: 'Vorgänge' }).first();
  await zeile.locator('.ebenen-menu-knopf').click({ force: true });
  await P.waitForTimeout(400);
  await P.locator('.ebenen-menu button', { hasText: 'Duplizieren' }).first().click();
  await P.waitForTimeout(1200);
  const st = await stand(P);
  const kopie = st.boards.find((b) => b.name === 'Vorgänge (Kopie)');
  pruefe('T2a die Kopie heißt „Vorgänge (Kopie)"', !!kopie, JSON.stringify(st.boards.map((b) => b.name)));
  if (kopie) {
    const orig = st.boards.find((b) => b.id === 'b0');
    pruefe('T2b sie trägt denselben Inhalt', kopie.nodes.length === orig.nodes.length,
      `${kopie.nodes.length} vs ${orig.nodes.length}`);
    const gemeinsam = kopie.nodes.filter((n) => orig.nodes.some((o) => o.id === n.id));
    pruefe('T2c aber KEINE einzige geteilte Karten-Kennung', gemeinsam.length === 0,
      JSON.stringify(gemeinsam.map((n) => n.id)));
    const kante = kopie.edges[0];
    pruefe('T2d die Verbindung zeigt auf die Karten der KOPIE',
      !!kante && kopie.nodes.some((n) => n.id === kante.source) && kopie.nodes.some((n) => n.id === kante.target),
      JSON.stringify(kante));
    pruefe('T2e und die Kopie liegt im selben Projekt neben dem Original',
      st.spaces[0].projects[0].boardIds.includes(kopie.id),
      JSON.stringify(st.spaces[0].projects[0].boardIds));
  }
  await ctx.close();
}

// ══ T3: Archivieren ist das sanfte Löschen ══════════════════════════
console.log('\n════ T3: Board archivieren ════');
{
  const { ctx, P } = await seite({ ansicht: 'board', aktiv: 'b0' });
  await seitenleiste(P);
  const zeile = P.locator('.side-board', { hasText: 'Berichte' }).first();
  await zeile.locator('.ebenen-menu-knopf').click({ force: true });
  await P.waitForTimeout(400);
  await P.locator('.ebenen-menu button', { hasText: 'Archivieren' }).first().click();
  await P.waitForTimeout(1200);
  const st = await stand(P);
  pruefe('T3a das Board ist als archiviert vermerkt',
    st.boards.find((b) => b.id === 'b1')?.archived === true, JSON.stringify(st.boards.map((b) => [b.name, !!b.archived])));
  pruefe('T3b es ist NICHT gelöscht — alle Karten sind noch da',
    st.boards.find((b) => b.id === 'b1')?.nodes.length === 1);
  pruefe('T3c es verschwindet aus der Seitenleiste',
    await P.locator('.side-board', { hasText: 'Berichte' }).count() === 0);
  pruefe('T3d und aus der Reiterleiste',
    await P.evaluate(() => ![...document.querySelectorAll('.tab .tab-name, .tab-picker-eintrag-name')]
      .some((e) => e.textContent.includes('Berichte'))));
  // Aufgaben-Zentrale: die Frist des archivierten Boards ruht
  const offen = await P.evaluate(() => {
    const el = [...document.querySelectorAll('.dock button')].find((b) => b.dataset.taste === 'aufgaben');
    return el?.getAttribute('title') ?? '';
  });
  console.log('    Aufgaben-Knopf:', JSON.stringify(offen));
  pruefe('T3e die Aufgaben-Zentrale mahnt nichts mehr aus dem Archiv an',
    !/Bericht abgeben/.test(offen) && !/1 offen/.test(offen), offen);
  await P.screenshot({ path: `${SD}/m288-archiviert.png` });
  await ctx.close();
}

// ══ T4: „Archiv einblenden" holt es sichtbar zurück ═════════════════
console.log('\n════ T4: Archiv einblenden und zurückholen ════');
{
  const { ctx, P } = await seite({ ansicht: 'board', archivZeigen: true });
  // Board b1 vorab archivieren (über dieselbe Bedienung wie der Mensch)
  await seitenleiste(P);
  const zeile = P.locator('.side-board', { hasText: 'Berichte' }).first();
  await zeile.locator('.ebenen-menu-knopf').click({ force: true });
  await P.waitForTimeout(400);
  await P.locator('.ebenen-menu button', { hasText: 'Archivieren' }).first().click();
  await P.waitForTimeout(1000);
  pruefe('T4a mit eingeblendetem Archiv bleibt das Board sichtbar',
    await P.locator('.side-board', { hasText: 'Berichte' }).count() > 0);
  pruefe('T4b und trägt sichtbar die Marke „Archiv"',
    await P.locator('.side-board', { hasText: 'Berichte' }).locator('.archiv-marke').count() > 0);
  const zeile2 = P.locator('.side-board', { hasText: 'Berichte' }).first();
  await zeile2.locator('.ebenen-menu-knopf').click({ force: true });
  await P.waitForTimeout(400);
  const eintraege = await menuEintraege(P);
  pruefe('T4c das Menü bietet jetzt „Zurückholen" statt „Archivieren"',
    eintraege.some((t) => t.includes('Zurückholen')) && !eintraege.some((t) => t.trim() === 'Archivieren'),
    JSON.stringify(eintraege));
  await P.locator('.ebenen-menu button', { hasText: 'Zurückholen' }).first().click();
  await P.waitForTimeout(900);
  const st = await stand(P);
  pruefe('T4d Zurückholen macht es rückgängig', st.boards.find((b) => b.id === 'b1')?.archived === false,
    JSON.stringify(st.boards.map((b) => [b.name, !!b.archived])));
  await ctx.close();
}

// ══ T5: Das AKTIVE Board archivieren lässt niemanden im Leeren ══════
console.log('\n════ T5: Das offene Board archivieren ════');
{
  const { ctx, P } = await seite({ ansicht: 'board', aktiv: 'b0' });
  await seitenleiste(P);
  const zeile = P.locator('.side-board', { hasText: 'Vorgänge' }).first();
  await zeile.locator('.ebenen-menu-knopf').click({ force: true });
  await P.waitForTimeout(400);
  await P.locator('.ebenen-menu button', { hasText: 'Archivieren' }).first().click();
  await P.waitForTimeout(1200);
  const st = await stand(P);
  console.log('    aktiv danach:', st.activeId);
  pruefe('T5a man landet auf einem anderen, sichtbaren Board',
    st.activeId !== 'b0' && st.boards.find((b) => b.id === st.activeId)?.archived !== true,
    JSON.stringify({ activeId: st.activeId }));
  pruefe('T5b bevorzugt im selben Projekt', st.activeId === 'b1', st.activeId);
  await ctx.close();
}

// ══ T6: In ein anderes Projekt verschieben ══════════════════════════
console.log('\n════ T6: In Projekt verschieben ════');
{
  const { ctx, P } = await seite({ ansicht: 'board' });
  await seitenleiste(P);
  const zeile = P.locator('.side-board', { hasText: 'Berichte' }).first();
  await zeile.locator('.ebenen-menu-knopf').click({ force: true });
  await P.waitForTimeout(400);
  await P.locator('.ebenen-menu button', { hasText: 'In Projekt verschieben' }).first().click();
  await P.waitForTimeout(400);
  const ziele = await menuEintraege(P);
  console.log('    Ziele:', JSON.stringify(ziele));
  pruefe('T6a das Untermenü zeigt alle Projekte mit ihrem Bereich',
    ziele.some((t) => t.includes('Dienst › Archivprojekt')), JSON.stringify(ziele));
  pruefe('T6b das eigene Projekt ist als „(hier)" gekennzeichnet',
    ziele.some((t) => t.includes('(hier)')), JSON.stringify(ziele));
  await P.locator('.ebenen-menu button', { hasText: 'Archivprojekt' }).first().click();
  await P.waitForTimeout(1000);
  const st = await stand(P);
  const p2 = st.spaces[0].projects.find((p) => p.id === 'p2');
  pruefe('T6c das Board liegt jetzt im Zielprojekt', p2.boardIds.includes('b1'), JSON.stringify(p2.boardIds));
  pruefe('T6d und nicht mehr im alten',
    !st.spaces[0].projects.find((p) => p.id === 'p1').boardIds.includes('b1'));
  await ctx.close();
}

// ══ T7: Projekt-Ebene ═══════════════════════════════════════════════
console.log('\n════ T7: Handgriffe am Projekt ════');
{
  const { ctx, P } = await seite({ ansicht: 'board' });
  await seitenleiste(P);
  const kopf = P.locator('.side-proj-head', { hasText: 'Laufend' }).first();
  await kopf.locator('.ebenen-menu-knopf').click({ force: true });
  await P.waitForTimeout(500);
  const eintraege = await menuEintraege(P);
  console.log('    Projekt-Menü:', JSON.stringify(eintraege));
  for (const wort of ['Umbenennen', 'Neues Board', 'Duplizieren', 'Alle Boards archivieren', 'Löschen']) {
    pruefe(`T7 „${wort}" steht im Projekt-Menü`, eintraege.some((t) => t.includes(wort)), JSON.stringify(eintraege));
  }
  await P.locator('.ebenen-menu button', { hasText: 'Duplizieren' }).first().click();
  await P.waitForTimeout(1400);
  const st = await stand(P);
  const kopie = st.spaces[0].projects.find((p) => p.name === 'Laufend (Kopie)');
  pruefe('T7f das Projekt wird samt seiner Boards kopiert',
    !!kopie && kopie.boardIds.length === 2, JSON.stringify(st.spaces[0].projects.map((p) => [p.name, p.boardIds.length])));
  if (kopie) {
    pruefe('T7g die kopierten Boards sind eigene Boards (frische Kennungen)',
      kopie.boardIds.every((id) => !['b0', 'b1', 'b2'].includes(id)) && kopie.boardIds.every((id) => st.boards.some((b) => b.id === id)),
      JSON.stringify(kopie.boardIds));
  }
  await P.screenshot({ path: `${SD}/m288-projektmenu.png` });
  await ctx.close();
}

// ══ T8: Am Telefon erreichbar ═══════════════════════════════════════
console.log('\n════ T8: Telefon ════');
{
  const { ctx, P } = await seite({ ansicht: 'overview' }, { width: 390, height: 844 }, true);
  const kachel = P.locator('.ov-board', { hasText: 'Berichte' }).first();
  const knopf = kachel.locator('.ebenen-menu-knopf');
  pruefe('T8a das ⋯ steht auch am Telefon zur Verfügung', await knopf.count() > 0);
  if (await knopf.count()) {
    /* Die Übersicht ist eine gezoomte Fläche: Am Telefon liegt der Maßstab
       weit unter 1, also ist JEDE Kachel klein — das ist die Ansicht, nicht
       der Knopf. Gemessen wird deshalb die Regel (Mindestmaß im Stylesheet),
       nicht der momentane Zoom. */
    const mass = await knopf.first().evaluate((el) => {
      const cs = getComputedStyle(el);
      return { minW: parseFloat(cs.minWidth), minH: parseFloat(cs.minHeight) };
    });
    console.log('    Mindestmaß laut Stylesheet:', JSON.stringify(mass));
    pruefe('T8b am Finger gilt das Mindestmaß von 34 Punkten',
      mass.minW >= 34 && mass.minH >= 34, JSON.stringify(mass));
    await knopf.first().click({ force: true });
    await P.waitForTimeout(600);
    const box2 = await P.locator('.ebenen-menu').boundingBox();
    pruefe('T8c das Menü steht vollständig im Bild',
      !!box2 && box2.x >= 0 && box2.x + box2.width <= 390 + 1 && box2.y >= 0 && box2.y + box2.height <= 844 + 1,
      JSON.stringify(box2));
    await P.screenshot({ path: `${SD}/m288-telefon.png` });
  }
  await ctx.close();
}

{
  /* Im Kopf-Navigator gibt es keinen Zoom — dort muss die Trefferfläche
     wirklich stimmen, und zwar in Bildpunkten am Gerät. */
  const { ctx, P } = await seite({ ansicht: 'board' }, { width: 390, height: 844 }, true);
  await P.locator('[data-taste="navigator"]').click();
  await P.waitForTimeout(900);
  const knopf = P.locator('.nav-board-row .ebenen-menu-knopf').first();
  pruefe('T8d auch der Navigator der Kopfleiste trägt das Menü', await knopf.count() > 0);
  if (await knopf.count()) {
    const box = await knopf.boundingBox();
    console.log('    Trefferfläche im Navigator:', JSON.stringify(box && { w: Math.round(box.width), h: Math.round(box.height) }));
    pruefe('T8e und ist dort mit dem Finger sicher zu treffen (≥ 34 Punkte)',
      !!box && box.width >= 33 && box.height >= 33, JSON.stringify(box));
    await knopf.click({ force: true });
    await P.waitForTimeout(600);
    const eintraege = await menuEintraege(P);
    pruefe('T8f mit demselben Vorrat wie überall sonst',
      JSON.stringify(eintraege) === JSON.stringify(vorratSeite), JSON.stringify(eintraege));
    await P.screenshot({ path: `${SD}/m288-telefon-navigator.png` });
  }
  await ctx.close();
}

console.log(`\n  ${ok} bestanden, ${bad} durchgefallen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
