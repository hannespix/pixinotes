/**
 * M293 — „Kanban-Modul: erledigte Aufgaben sollen archivierbar sein … auch
 * Auto-Archivierung aktivierbar machen, dass z. B. nach einer einstellbaren
 * Zeit erledigte Aufgaben automatisch archiviert werden."
 *
 * Diese Reihe prüft das Verhalten, nicht die Bauform:
 *   A  Die Automatik räumt beim Start genau das weg, was älter ist als die
 *      eingestellte Frist — und stempelt Altbestand, statt ihn zu archivieren.
 *      Danach die Handgriffe: Ticket-Fenster, Zurückholen, 🗃 am Ticket,
 *      „Alle archivieren", Strg+Z, Suche.
 *   B  Die Einstellung selbst: Einschalten wirkt sofort, die Tage-Zahl greift
 *      beim Übernehmen (nicht bei jedem Tastendruck), Ausschalten lässt das
 *      Archiv in Ruhe, „Alle zurückholen" leert es.
 */
// Läuft aus dem Repository: `node pruefungen/m293-ticket-archiv.mjs`
// Voraussetzung: `npm run build` und ein Chromium (PW_CHROMIUM).
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const DIST = path.join(__repo, 'dist');
const PORT = 4513;
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

const TAG = 86_400_000;
const vorTagen = (n) => new Date(Date.now() - n * TAG).toISOString();

/** Ein Board mit EINEM Kanban: drei Erledigte (alt, frisch, ohne Stempel) und ein Offenes */
async function seite({ automatik } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(([automatik, alt, frisch]) => {
    localStorage.setItem('pixinotes-onboarded', '1');
    sessionStorage.setItem('pixinotes-hint-shown', '1');
    const data = {
      title: 'Prüf-Kanban',
      items: [
        { id: 't1', text: 'Alt erledigt', col: 2, erledigtAm: alt },
        { id: 't2', text: 'Frisch erledigt', col: 2, erledigtAm: frisch },
        { id: 't3', text: 'Ohne Stempel', col: 2 },
        { id: 't4', text: 'Noch offen', col: 0 },
      ],
    };
    if (automatik) { data.autoArchiv = true; data.autoArchivTage = 7; }
    const state = {
      boards: [{ id: 'b0', name: 'Test', edges: [], drawings: [], comments: [], nodes: [
        { id: 'k1', type: 'kanban', position: { x: 120, y: 120 }, width: 560, data },
      ] }],
      spaces: [{ id: 's1', name: 'Dienst', projects: [{ id: 'p1', name: 'Beratung', boardIds: ['b0'] }] }],
      activeId: 'b0', view: 'board', physicsEnabled: false, clickZoom: false,
    };
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state }));
  }, [!!automatik, vorTagen(10), vorTagen(2)]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  // Der Archiv-Lauf startet 4 s nach dem Laden — danach noch das gebündelte Speichern abwarten
  await P.waitForTimeout(5600);
  return { ctx, P };
}

/** Was steht in den Spalten, was im Archiv, was im Speicher? */
const lage = (P) => P.evaluate(() => {
  const inSpalten = [...document.querySelectorAll('.kanban-item')].map((el) => el.dataset.kid);
  const erledigtSpalte = [...document.querySelectorAll('.kanban-item.col-done')].map((el) => el.dataset.kid);
  const badge = document.querySelector('.k-archiv-head .k-head-count')?.textContent ?? '';
  const zeilen = [...document.querySelectorAll('.k-archiv-row')].map((el) => el.dataset.archivId);
  let gespeichert = null;
  try {
    const st = JSON.parse(localStorage.getItem('pixinotes-board')).state;
    const d = st.boards[0].nodes.find((n) => n.id === 'k1').data;
    gespeichert = {
      items: Object.fromEntries((d.items ?? []).map((it) => [it.id, { col: it.col, erledigtAm: it.erledigtAm ?? null }])),
      archiv: (d.archiv ?? []).map((it) => ({ id: it.id, erledigtAm: it.erledigtAm ?? null, archiviertAm: it.archiviertAm ?? null })),
      autoArchiv: d.autoArchiv ?? null,
      autoArchivTage: d.autoArchivTage ?? null,
    };
  } catch { /* noch nicht gespeichert */ }
  const toast = document.querySelector('.toast.show')?.textContent ?? '';
  return { inSpalten, erledigtSpalte, badge, zeilen, gespeichert, toast };
});

const gleich = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

// ══ A: Automatik an (7 Tage) ══════════════════════════════════════════
console.log('════ A: Automatik räumt beim Start ════');
{
  const { ctx, P } = await seite({ automatik: true });
  let l = await lage(P);
  console.log('   ', JSON.stringify({ spalten: l.inSpalten, badge: l.badge, toast: l.toast.slice(0, 70) }));
  pruefe('A1 das 10 Tage alte Ticket ist aus der Spalte verschwunden', !l.inSpalten.includes('t1'), JSON.stringify(l.inSpalten));
  pruefe('A2 das 2 Tage alte bleibt (Frist 7 Tage)', l.inSpalten.includes('t2'));
  pruefe('A3 das Ticket OHNE Stempel bleibt — es wird gestempelt, nicht weggeräumt', l.inSpalten.includes('t3'));
  pruefe('A4 das offene Ticket bleibt unberührt', l.inSpalten.includes('t4'));
  pruefe('A5 die Kopfzeile zählt 1 archiviertes Ticket', l.badge === '1', `badge=${l.badge}`);
  pruefe('A6 der Lauf meldet sich (Toast)', /automatisch archiviert/.test(l.toast), l.toast);
  pruefe('A7 im Speicher: t1 im Archiv mit Archiv-Stempel', l.gespeichert?.archiv?.length === 1
    && l.gespeichert.archiv[0].id === 't1' && !!l.gespeichert.archiv[0].archiviertAm, JSON.stringify(l.gespeichert));
  pruefe('A8 im Speicher: t3 hat jetzt ein Erledigt-Datum (ab heute zählt die Frist)',
    !!l.gespeichert?.items?.t3?.erledigtAm, JSON.stringify(l.gespeichert?.items?.t3));
  const stempelT3 = l.gespeichert?.items?.t3?.erledigtAm;
  pruefe('A9 … und zwar ein frisches (keine Stunde alt)',
    stempelT3 && Date.now() - Date.parse(stempelT3) < 3_600_000, String(stempelT3));
  await P.screenshot({ path: `${SD}/m293-a-start.png` });

  // Ticket-Fenster: Erledigt-Datum sichtbar, Archivieren von dort
  await P.locator('.kanban-item[data-kid="t2"] .kanban-item-text').click();
  await P.waitForTimeout(400);
  const erledigtText = await P.locator('.ticket-modal .ticket-erledigt').textContent().catch(() => '');
  const erwartet = new Date(vorTagen(2)).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
  pruefe('A10 das Ticket-Fenster zeigt „erledigt am <Datum>"', erledigtText.includes(`erledigt am ${erwartet}`), `${erledigtText} ≠ ${erwartet}`);
  await P.locator('.ticket-modal .ticket-erledigt button').click();
  await P.waitForTimeout(700);
  l = await lage(P);
  pruefe('A11 Archivieren im Ticket-Fenster: Fenster zu, Ticket aus der Spalte',
    (await P.locator('.ticket-modal').count()) === 0 && !l.inSpalten.includes('t2'), JSON.stringify(l.inSpalten));
  pruefe('A12 Zähler steht auf 2', l.badge === '2', l.badge);

  // Archiv-Panel: Zeilen, neueste zuerst, zurückholen
  await P.locator('.k-archiv-head').click();
  await P.waitForTimeout(400);
  l = await lage(P);
  pruefe('A13 das Archiv listet beide — das zuletzt archivierte oben', JSON.stringify(l.zeilen) === JSON.stringify(['t2', 't1']), JSON.stringify(l.zeilen));
  await P.locator('.k-archiv-row[data-archiv-id="t2"] .k-archiv-back').click();
  await P.waitForTimeout(700);
  l = await lage(P);
  pruefe('A14 ↩ holt das Ticket zurück in die Erledigt-Spalte', l.erledigtSpalte.includes('t2'), JSON.stringify(l.erledigtSpalte));
  pruefe('A15 … und aus dem Archiv heraus', JSON.stringify(l.zeilen) === JSON.stringify(['t1']), JSON.stringify(l.zeilen));
  pruefe('A16 sein Erledigt-Datum blieb erhalten (nicht neu gestempelt)',
    l.gespeichert?.items?.t2?.erledigtAm && Date.now() - Date.parse(l.gespeichert.items.t2.erledigtAm) > 1.9 * TAG, JSON.stringify(l.gespeichert?.items?.t2));
  await P.screenshot({ path: `${SD}/m293-a-panel.png` });
  await P.keyboard.press('Escape');
  await P.waitForTimeout(300);
  pruefe('A17 Esc schließt das Archiv — auch nachdem der geklickte Knopf mit seiner Zeile verschwand',
    (await P.locator('.k-archiv-panel').count()) === 0);
  // Rückfallweg, damit die folgenden Messungen nicht am offenen Panel scheitern
  if (await P.locator('.k-archiv-panel').count()) { await P.locator('.k-archiv-panel .ticket-detail-head button').click(); await P.waitForTimeout(300); }

  // 🗃 direkt am Ticket
  await P.locator('.kanban-item[data-kid="t2"]').hover();
  await P.locator('.kanban-item[data-kid="t2"] .k-archiv-btn').click();
  await P.waitForTimeout(600);
  l = await lage(P);
  pruefe('A18 🗃 am Ticket archiviert es', !l.inSpalten.includes('t2') && l.badge === '2', JSON.stringify({ s: l.inSpalten, b: l.badge }));

  // Die ganze Erledigt-Spalte
  const spalten = P.locator('.kanban-col');
  await spalten.nth(2).hover();
  await P.locator('.kanban-col-archiv').click();
  await P.waitForTimeout(600);
  l = await lage(P);
  pruefe('A19 „Alle archivieren" leert die Erledigt-Spalte', l.erledigtSpalte.length === 0 && l.badge === '3', JSON.stringify({ e: l.erledigtSpalte, b: l.badge }));
  pruefe('A20 das offene Ticket steht noch', l.inSpalten.includes('t4'));
  pruefe('A21 kein Alle-archivieren-Knopf mehr an der leeren Spalte', (await P.locator('.kanban-col-archiv').count()) === 0);

  // Strg+Z nimmt den Schritt zurück. Kurz aufeinanderfolgende Änderungen an
  // derselben Karte bündelt die History zu EINEM Eintrag (M122) — deshalb
  // kann hier auch das eben archivierte t2 mit zurückkommen; gemessen wird,
  // dass die Spalte wieder da ist und das Archiv kleiner wurde.
  await P.keyboard.press('Control+z');
  await P.waitForTimeout(700);
  l = await lage(P);
  pruefe('A22 Strg+Z holt die Spalte zurück', l.erledigtSpalte.includes('t3') && Number(l.badge || 0) < 3, JSON.stringify({ e: l.erledigtSpalte, b: l.badge }));

  // Die Suche findet Archiviertes weiterhin
  await P.keyboard.press('Control+k');
  await P.waitForTimeout(400);
  await P.keyboard.type('Alt erledigt');
  await P.waitForTimeout(600);
  const treffer = await P.locator('.search-hit').count();
  pruefe('A23 Strg+K findet die Karte über ein archiviertes Ticket', treffer >= 1, `treffer=${treffer}`);
  await P.keyboard.press('Escape');
  await ctx.close();
}

// ══ B: Automatik aus — die Einstellung selbst ═════════════════════════
console.log('\n════ B: Einstellung der Automatik ════');
{
  const { ctx, P } = await seite({ automatik: false });
  let l = await lage(P);
  pruefe('B1 ohne Automatik bleibt alles in den Spalten', gleich(l.inSpalten, ['t1', 't2', 't3', 't4']), JSON.stringify(l.inSpalten));
  pruefe('B2 … der Altbestand wird trotzdem gestempelt (die Uhr läuft schon)', !!l.gespeichert?.items?.t3?.erledigtAm, JSON.stringify(l.gespeichert?.items));
  pruefe('B3 kein Zähler, kein Archiv', l.badge === '' && (l.gespeichert?.archiv?.length ?? 0) === 0, `badge=${l.badge}`);

  await P.locator('.k-archiv-head').click();
  await P.waitForTimeout(400);
  const kasten = P.locator('.k-archiv-auto input[type="checkbox"]');
  const tage = P.locator('.k-archiv-auto input[type="number"]');
  pruefe('B4 Automatik ist aus, das Tage-Feld gesperrt und auf 7 vorbelegt',
    !(await kasten.isChecked()) && (await tage.isDisabled()) && (await tage.inputValue()) === '7');

  await kasten.click();
  await P.waitForTimeout(800);
  l = await lage(P);
  pruefe('B5 Einschalten wirkt sofort: das 10 Tage alte Ticket ist im Archiv', !l.inSpalten.includes('t1') && l.zeilen.includes('t1'), JSON.stringify(l.zeilen));
  pruefe('B6 das 2 Tage alte bleibt (7 Tage Frist)', l.inSpalten.includes('t2'));
  pruefe('B7 die Meldung sagt, was passiert ist', /älter als 7/.test(l.toast), l.toast);
  pruefe('B8 gespeichert: autoArchiv an, 7 Tage', l.gespeichert?.autoArchiv === true && l.gespeichert?.autoArchivTage === 7, JSON.stringify(l.gespeichert));
  pruefe('B9 das Tage-Feld ist jetzt frei', !(await tage.isDisabled()));

  // Tippen allein ändert nichts — erst Enter übernimmt
  await tage.fill('1');
  await P.waitForTimeout(500);
  l = await lage(P);
  pruefe('B10 Tippen allein räumt nichts weg (sonst flöge bei „14" schon bei der 1 alles raus)', l.inSpalten.includes('t2'), JSON.stringify(l.inSpalten));
  await tage.press('Enter');
  await P.waitForTimeout(800);
  l = await lage(P);
  pruefe('B11 Enter übernimmt: mit 1 Tag Frist geht auch das 2 Tage alte ins Archiv', !l.inSpalten.includes('t2') && l.zeilen.includes('t2'), JSON.stringify(l.zeilen));
  pruefe('B12 das gerade erst gestempelte bleibt', l.inSpalten.includes('t3'));
  pruefe('B13 gespeichert: 1 Tag', l.gespeichert?.autoArchivTage === 1, JSON.stringify(l.gespeichert));

  // Unsinn im Feld wird bereinigt
  await P.locator('.k-archiv-auto input[type="number"]').fill('0');
  await P.locator('.k-archiv-auto input[type="number"]').press('Enter');
  await P.waitForTimeout(600);
  l = await lage(P);
  pruefe('B14 0 Tage gibt es nicht — das Feld fällt auf die Voreinstellung', l.gespeichert?.autoArchivTage === 7
    && (await P.locator('.k-archiv-auto input[type="number"]').inputValue()) === '7', JSON.stringify(l.gespeichert));

  // Ausschalten: Archiv bleibt, Feld gesperrt, Wert gemerkt
  await P.locator('.k-archiv-auto input[type="checkbox"]').click();
  await P.waitForTimeout(600);
  l = await lage(P);
  pruefe('B15 Ausschalten lässt das Archiv in Ruhe', gleich(l.zeilen, ['t1', 't2']), JSON.stringify(l.zeilen));
  pruefe('B16 gespeichert: Automatik aus, Tage-Wert bleibt gemerkt', !l.gespeichert?.autoArchiv && l.gespeichert?.autoArchivTage === 7, JSON.stringify(l.gespeichert));
  pruefe('B17 das Feld ist wieder gesperrt', await P.locator('.k-archiv-auto input[type="number"]').isDisabled());

  // Alle zurückholen
  await P.locator('.k-archiv-foot .collect-reset').first().click();
  await P.waitForTimeout(700);
  l = await lage(P);
  pruefe('B18 „Alle zurückholen" stellt die Erledigt-Spalte wieder her', gleich(l.erledigtSpalte, ['t1', 't2', 't3']) && l.zeilen.length === 0, JSON.stringify({ e: l.erledigtSpalte, z: l.zeilen }));
  pruefe('B19 die Reihenfolge der Spalte: Zurückgeholte hängen hinten an', JSON.stringify(l.erledigtSpalte) === JSON.stringify(['t3', 't1', 't2']), JSON.stringify(l.erledigtSpalte));
  await P.screenshot({ path: `${SD}/m293-b-zurueck.png` });
  await ctx.close();
}

console.log(`\n  ${ok} bestanden, ${bad} durchgefallen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
