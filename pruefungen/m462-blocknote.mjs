/**
 * M462 — Editor-Bibliothek BlockNote 0.31 → 0.57 (Tiptap 2 → 3, Mantine 7 → 8).
 *
 * Notizen sind das Herzstück. Geprüft wird darum vor allem der ALTBESTAND:
 * `pruefungen/daten/m462-notizen-blocknote031.json` ist Block-JSON, wie es der
 * Editor in 0.31 geschrieben hat (aus dem alten Build erzeugt, mit allen
 * damals üblichen Vorgabe-Eigenschaften, Tabellenzellen als `tableCell`,
 * Inline-Stilen textSize/textFont, Bild als Daten-URL).
 *
 *   A  Laden: ein Board mit alten Notizen lädt ohne Fehler, die ruhende
 *      Darstellung zeigt alles (Überschriften, Haken, Listen, Tabellen, Bild)
 *   B  Wecken: der Editor zeigt denselben Inhalt – Überschriften h1–h3, Haken
 *      gesetzt/leer, Link, Schrift-Stile, Ausrichtung, Rechentabelle rechnet,
 *      alte Tabelle, Bild mit Bildunterschrift
 *   C  Bearbeiten und Speichern: getippter Text landet im Stand, kein alter
 *      Block geht verloren, nach dem Neuladen ist alles da
 *   D  Einfügen-Menü „/" ist deutsch, bietet Überschrift, Checkliste, EINE
 *      Tabelle (die rechnende), Bild – und kein Video/Ton/Datei
 *   E  Über das Menü eingefügt: Überschrift, Checkliste, Rechentabelle
 *   F  Formatier-Leiste: markierter Text → A+ setzt die Größe (Stil textSize)
 *   G  keine Seitenfehler
 */
// Läuft aus dem Repository: `node pruefungen/m462-blocknote.mjs` (braucht dist/).
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import http from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { chromium } from 'playwright-core';

const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = path.join(__repo, 'dist');
const PORT = 5462;
const ALT = JSON.parse(readFileSync(path.join(__repo, 'pruefungen', 'daten', 'm462-notizen-blocknote031.json'), 'utf8'));
const [ALT_A, ALT_B] = ALT.notizen.map((n) => n.blocks);
/** Einfache Notiz (nur Überschrift, Absatz, Haken) – sie ruht ohne Editor (M338) */
const ALT_C = [ALT_A[0], ALT_A[3], ALT_A[12]];

const app = http.createServer((q, r) => {
  let f = join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }[extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));

let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${info}`); }
};
const fehler = [];
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });

async function seite() {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await ctx.addInitScript(({ a, b, c }) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ navLinks: false }));
    const nodes = [
      { id: 'nA', type: 'note', position: { x: 40, y: 60 }, width: 520, height: 760, data: { blocks: a, color: 'amber' } },
      { id: 'nB', type: 'note', position: { x: 620, y: 60 }, width: 520, height: 600, data: { blocks: b, color: 'mint' } },
      { id: 'nC', type: 'note', position: { x: 620, y: 700 }, width: 360, data: { blocks: c, color: 'sky' } },
    ];
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
      boards: [{ id: 'b0', name: 'Test', edges: [], drawings: [], nodes, comments: [] }],
      spaces: [{ id: 's1', name: 'Privat', projects: [{ id: 'p1', name: 'P', boardIds: ['b0'] }] }],
      activeId: 'b0', view: 'board', cardFocus: false, navLinks: false } }));
  }, { a: ALT_A, b: ALT_B, c: ALT_C });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => { fehler.push(e.message); console.log('    PAGEERROR:', e.message); });
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(2400);
  return { ctx, P };
}
const karte = (P, id) => P.locator(`.react-flow__node[data-id="${id}"]`);
const editorDa = (P, id) => P.evaluate((id) => !!document.querySelector(`.react-flow__node[data-id="${id}"] .note-editor [contenteditable="true"]`), id);
const stand = (P, id) => P.evaluate((id) => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes.find((n) => n.id === id).data.blocks, id);
const wecke = async (P, id) => {
  await P.evaluate((id) => window.dispatchEvent(new CustomEvent('pixinotes:notiz-aktiv', { detail: { id } })), id);
  await P.waitForTimeout(1000);
};
/** Blöcke flach (mit Kindern) als „typ:text" – für den Vergleich vor/nach */
const flach = (bl) => bl.flatMap((b) => [`${b.type}:${Array.isArray(b.content) ? b.content.map((c) => c.text ?? (c.content ?? []).map((x) => x.text).join('')).join('') : ''}`, ...flach(b.children ?? [])]);

// ══ A/B ═══════════════════════════════════════════════════════════════
console.log('════ A: Altbestand lädt (ruhend) ════');
{
  const { ctx, P } = await seite();
  const tx = await karte(P, 'nA').textContent();
  pruefe('A1 alte Notiz zeigt Überschriften, Haken, Listen, Zitat, Code', ['Projektplan Kaiserstuhl', 'Aufgaben', 'Angebot einholen', 'Unterpunkt', 'Zweitens', 'Weniger ist mehr.', 'const a = 1;', 'Ende der Notiz'].every((s) => tx.includes(s)), tx.slice(0, 200));
  const txB = await karte(P, 'nB').textContent();
  pruefe('A2 Tabellen-Notiz zeigt Rechentabelle (gerechnet) und alte Tabelle', txB.includes('1.650,5') && txB.includes('Alt B') && txB.includes('32'), txB.slice(0, 200));

  console.log('\n════ B: geweckt im neuen Editor ════');
  await wecke(P, 'nA');
  await wecke(P, 'nB');
  pruefe('B1 beide Editoren sind da', await editorDa(P, 'nA') && await editorDa(P, 'nB'));
  const a = await P.evaluate(() => {
    const k = document.querySelector('.react-flow__node[data-id="nA"] .note-editor');
    const q = (s) => k.querySelector(s);
    // M462: Eigene Stile rendern jetzt als Mark-View (Hülle + Span mit Stil) — den innersten nehmen
    const span = (text) => [...k.querySelectorAll('span[style]')].find((s) => s.textContent.trim() === text);
    const boxen = [...k.querySelectorAll('input[type="checkbox"]')].map((c) => c.checked);
    const mittig = [...k.querySelectorAll('.bn-block-content')].find((b) => b.textContent.includes('Mittig'));
    return {
      h: ['h1', 'h2', 'h3'].map((h) => q(h)?.textContent ?? null),
      boxen,
      link: q('a[href="https://example.org"]')?.textContent ?? null,
      fett: !!q('strong'), kursiv: !!q('em'), unter: !!q('u'), durch: !!q('s'),
      gross: span('groß') ? getComputedStyle(span('groß')).fontSize : null,
      basis: getComputedStyle(q('p')).fontSize,
      serif: span('Serif') ? getComputedStyle(span('Serif')).fontFamily : null,
      mittig: mittig ? getComputedStyle(mittig.querySelector('.bn-inline-content') ?? mittig).textAlign : null,
      mittigFarbe: mittig?.getAttribute('data-text-color') ?? mittig?.closest('[data-text-color]')?.getAttribute('data-text-color') ?? null,
      zitat: !!q('blockquote, [data-content-type="quote"]'),
      code: !!q('pre, [data-content-type="codeBlock"]'),
      nummern: k.querySelectorAll('[data-content-type="numberedListItem"]').length,
    };
  });
  console.log('   ', JSON.stringify(a));
  pruefe('B2 Überschriften h1–h3 stehen da', a.h[0] === 'Projektplan Kaiserstuhl' && a.h[1] === 'Aufgaben' && a.h[2] === 'Details', JSON.stringify(a.h));
  pruefe('B3 Haken: der erste gesetzt, der zweite leer', JSON.stringify(a.boxen) === '[true,false]', JSON.stringify(a.boxen));
  pruefe('B4 Link, fett, kursiv, unterstrichen, durchgestrichen bleiben', a.link === 'Verweis' && a.fett && a.kursiv && a.unter && a.durch);
  pruefe('B5 Schrift-Stile (textSize, textFont) wirken', !!a.gross && parseFloat(a.gross) > parseFloat(a.basis) && /serif/i.test(a.serif ?? ''), `${a.gross} vs ${a.basis}, ${a.serif}`);
  pruefe('B6 Ausrichtung und Blockfarbe des Absatzes bleiben', a.mittig === 'center' && a.mittigFarbe === 'blue', `${a.mittig} ${a.mittigFarbe}`);
  pruefe('B7 Zitat, Codeblock und zwei Nummern-Punkte', a.zitat && a.code && a.nummern === 2, JSON.stringify(a));
  const b = await P.evaluate(() => {
    const k = document.querySelector('.react-flow__node[data-id="nB"] .note-editor');
    const img = k.querySelector('img');
    return {
      rt: [...k.querySelectorAll('.rt-tabelle tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim())),
      alt: [...k.querySelectorAll('table:not(.rt-tabelle) td')].map((td) => td.textContent.trim()),
      bild: img ? { src: img.getAttribute('src')?.slice(0, 21), w: Math.round(img.getBoundingClientRect().width) } : null,
      unterschrift: k.textContent.includes('Grauer Punkt'),
    };
  });
  console.log('   ', JSON.stringify(b));
  pruefe('B8 Rechentabelle rechnet im Editor (=SUMME → 1.650,5)', b.rt[3]?.[1] === '1.650,5', JSON.stringify(b.rt));
  pruefe('B9 alte Fließtext-Tabelle zeigt ihre Zellen', JSON.stringify(b.alt) === JSON.stringify(['Alt A', '10', 'Alt B', '32']), JSON.stringify(b.alt));
  pruefe('B10 Bild (Daten-URL) mit Breite und Bildunterschrift', b.bild?.src === 'data:image/png;base64' && b.bild.w > 60 && b.bild.w < 200 && b.unterschrift, JSON.stringify(b.bild));
  await P.screenshot({ path: path.join(SD, 'm462-altbestand.png') });
  await ctx.close();
}

// ══ C ═════════════════════════════════════════════════════════════════
console.log('\n════ C: Bearbeiten, Speichern, Neuladen ════');
{
  const { ctx, P } = await seite();
  const vorher = flach(ALT_A);
  const ziel = karte(P, 'nA').getByText('Ende der Notiz', { exact: true });
  await ziel.click(); await P.waitForTimeout(600);
  await ziel.click(); await P.keyboard.press('End');
  await P.keyboard.type(' – neu geschrieben');
  await P.waitForTimeout(800);
  // Haken im Editor umlegen
  await karte(P, 'nA').locator('input[type="checkbox"]').nth(1).click();
  await P.waitForTimeout(800);
  await P.mouse.click(1300, 950); await P.waitForTimeout(1500);
  const s = await stand(P, 'nA');
  const nachher = flach(s);
  pruefe('C1 getippter Text steht im gespeicherten Stand', nachher.includes('paragraph:Ende der Notiz – neu geschrieben'), JSON.stringify(nachher.slice(-3)));
  const fehlt = vorher.filter((v) => v !== 'paragraph:Ende der Notiz' && !nachher.includes(v));
  pruefe('C2 kein alter Block geht verloren (Typ und Text)', fehlt.length === 0, JSON.stringify(fehlt));
  pruefe('C3 umgelegter Haken ist gespeichert', s.filter((x) => x.type === 'checkListItem').map((x) => x.props.checked).join() === 'true,true');
  const stileAlt = JSON.stringify(ALT_A[1].content.map((c) => c.styles ?? c.href));
  const stileNeu = JSON.stringify(s[1].content.map((c) => c.styles ?? c.href));
  pruefe('C4 Inline-Stile überstehen das Speichern unverändert', stileAlt === stileNeu, `${stileAlt}\n      ${stileNeu}`);
  await P.reload({ waitUntil: 'networkidle' }); await P.waitForTimeout(2200);
  const tx = await karte(P, 'nA').textContent();
  pruefe('C5 nach dem Neuladen ist alles da', tx.includes('Ende der Notiz – neu geschrieben') && tx.includes('Projektplan Kaiserstuhl') && tx.includes('Unterpunkt'));
  // Eine einfache Notiz, die der NEUE Editor gespeichert hat, ruht weiterhin (M338)
  pruefe('C6 einfache Alt-Notiz ruht nach dem Laden', await P.evaluate(() => !!document.querySelector('.react-flow__node[data-id="nC"] .notiz-ruhend')));
  const zc = karte(P, 'nC').getByText('Ende der Notiz', { exact: true });
  await zc.click(); await P.waitForTimeout(600);
  await zc.click(); await P.keyboard.press('End'); await P.keyboard.type(' C');
  await P.waitForTimeout(800);
  await P.mouse.click(1300, 950); await P.waitForTimeout(1500);
  const sc = await stand(P, 'nC');
  console.log('    ', JSON.stringify(sc.map((x) => [x.type, x.props])));
  await P.reload({ waitUntil: 'networkidle' }); await P.waitForTimeout(2200);
  pruefe('C7 vom neuen Editor gespeichert, ruht sie weiter (keine neuen Block-Eigenschaften)', await P.evaluate(() => !!document.querySelector('.react-flow__node[data-id="nC"] .notiz-ruhend') && !document.querySelector('.react-flow__node[data-id="nC"] [contenteditable="true"]')) && JSON.stringify(sc).includes('Ende der Notiz C'));
  await ctx.close();
}

// ══ D/E ═══════════════════════════════════════════════════════════════
console.log('\n════ D: Einfügen-Menü „/" ════');
{
  const { ctx, P } = await seite();
  const ziel = karte(P, 'nB').getByText('Nach dem Bild', { exact: true });
  const slash = async () => {
    await ziel.click(); await P.waitForTimeout(500);
    await ziel.click(); await P.keyboard.press('End');
    await P.keyboard.press('Enter'); await P.keyboard.type('/'); await P.waitForTimeout(900);
  };
  await slash();
  const titel = await P.evaluate(() => [...document.querySelectorAll('.bn-suggestion-menu-item')].map((e) => (e.querySelector('.bn-mt-suggestion-menu-item-title') ?? e).textContent.trim()));
  console.log('    ', titel.join(' | '));
  const hat = (re) => titel.some((t) => re.test(t));
  pruefe('D1 das Menü ist offen und deutsch (Überschrift, Checkliste, Absatz)', hat(/^Überschrift 1/) && hat(/^Checkliste/) && hat(/^Absatz/), titel.slice(0, 8).join('|'));
  pruefe('D2 keine englischen Einträge', !hat(/^Heading 1|^Check List|^Paragraph/));
  pruefe('D3 genau eine Tabelle – die rechnende', titel.filter((t) => /Tabelle|Table/i.test(t)).length === 1 && hat(/^Tabelle$/), titel.filter((t) => /Tabelle|Table/i.test(t)).join('|'));
  pruefe('D4 Bild ja, Video/Ton/Datei nein', hat(/^Bild$/) && !hat(/^Video$|^Audio$|^Ton$|^Datei$/), titel.join('|'));
  pruefe('D5 die Neuheiten aus 0.57 bleiben draußen (aufklappbar, Trennlinie, Überschrift 4–6)', !hat(/Aufklappbar|Trennlinie|Überschrift [456]/), titel.join('|'));

  console.log('\n════ E: über das Menü einfügen ════');
  const waehle = async (text) => { await P.keyboard.type(text); await P.waitForTimeout(500); await P.keyboard.press('Enter'); await P.waitForTimeout(600); };
  await waehle('Überschrift 2');
  await P.keyboard.type('Neue Überschrift'); await P.keyboard.press('Enter');
  await P.keyboard.type('/'); await P.waitForTimeout(700);
  await waehle('Checkliste');
  await P.keyboard.type('Neuer Haken'); await P.keyboard.press('Enter'); await P.keyboard.press('Enter');
  await P.keyboard.type('/'); await P.waitForTimeout(700);
  await waehle('Tabelle');
  await P.mouse.click(1300, 950); await P.waitForTimeout(1500);
  const s = await stand(P, 'nB');
  const typen = s.map((x) => x.type);
  pruefe('E1 eingefügte Überschrift (Stufe 2) gespeichert', s.some((x) => x.type === 'heading' && x.props.level === 2 && JSON.stringify(x.content).includes('Neue Überschrift')), typen.join());
  pruefe('E2 eingefügter Haken gespeichert', s.some((x) => x.type === 'checkListItem' && JSON.stringify(x.content).includes('Neuer Haken')), typen.join());
  pruefe('E3 zweite Rechentabelle eingefügt', typen.filter((t) => t === 'rechentabelle').length === 2, typen.join());
  pruefe('E4 Bild und alte Tabelle bleiben', typen.includes('image') && typen.includes('table'), typen.join());
  await P.screenshot({ path: path.join(SD, 'm462-eingefuegt.png') });
  await ctx.close();
}

// ══ F ═════════════════════════════════════════════════════════════════
console.log('\n════ F: Formatier-Leiste ════');
{
  const { ctx, P } = await seite();
  const ziel = karte(P, 'nA').getByText('Mittig blau auf grau', { exact: true });
  await ziel.click(); await P.waitForTimeout(600);
  await ziel.dblclick(); await P.waitForTimeout(700);
  const leiste = await P.locator('.bn-formatting-toolbar').count();
  pruefe('F1 Markieren zeigt die Formatier-Leiste', leiste === 1, String(leiste));
  const knopf = P.locator('.bn-formatting-toolbar button', { hasText: 'A+' }).first();
  pruefe('F2 die eigenen Knöpfe A−/A+/Aa sind darin', await knopf.count() === 1 && await P.locator('.bn-formatting-toolbar button', { hasText: 'Aa' }).count() === 1);
  if (await knopf.count()) await knopf.click();
  await P.waitForTimeout(600);
  await P.mouse.click(1300, 950); await P.waitForTimeout(1500);
  const s = await stand(P, 'nA');
  const absatz = s.find((x) => JSON.stringify(x.content ?? '').includes('Mittig'));
  pruefe('F3 A+ schreibt die Größe als Stil textSize', JSON.stringify(absatz?.content ?? '').includes('textSize'), JSON.stringify(absatz?.content));
  await ctx.close();
}

console.log('\n════ G: Fehler ════');
pruefe('G1 keine Seitenfehler', fehler.length === 0, fehler.slice(0, 3).join(' | '));

await browser.close();
app.close();
console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
