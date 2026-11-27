// M561 – Bereiche und Projekte auf beiden Oberflächen ziehen, speichern und wieder öffnen.
// PN_DIST und PW_CHROMIUM können auf einen anderen Build bzw. Browser zeigen.
import assert from 'node:assert/strict';
import { setTimeout as warten } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { chromium } from 'playwright-core';
import { preview } from 'vite';

const start = [['Nord', 'Atlas', 'Plan'], ['Süd', 'Werk'], ['Frei']];
const projekte = {
  Atlas: { boardIds: ['Zweite', 'Archiv', 'Erste'], sortierung: 'manuell' },
  Plan: { boardIds: ['Heute'] },
  Werk: { boardIds: ['Bau'], sortierung: 'erstellt' },
};
const boards = ['Erste', 'Zweite', 'Archiv', 'Heute', 'Bau'].map((id) => ({
  id, name: id, archived: id === 'Archiv', edges: [], drawings: [], comments: [],
  nodes: [{ id: `notiz-${id}`, type: 'note', position: { x: 30, y: 50 }, width: 240,
    data: { color: 'yellow', blocks: [{ type: 'paragraph', content: `Inhalt von ${id}` }] } }],
}));
const stand = {
  spaces: start.map(([id, ...namen]) => ({ id, name: id, projects: namen.map((p) => ({ id: p, name: p, ...projekte[p] })) })),
  boards, activeId: 'Heute', view: 'overview', overviewMode: 'hierarchie', navLinks: true,
};

// Die Kacheln sind auf der Fläche frei positionierte Geschwister im DOM. Die tatsächlichen
// Rechtecke zeigen sowohl ihre sichtbare Reihenfolge als auch die Zugehörigkeit zu ihren Zonen.
function leseAnsichten() {
  const seitenleiste = Array.from(document.querySelectorAll('.tabs.spalte .side-space'), (s) => [
    s.querySelector('.side-space-name').textContent.trim(),
    ...Array.from(s.querySelectorAll('.side-proj-text'), (p) => p.textContent.trim()),
  ]);
  const zonen = (typ) => Array.from(document.querySelectorAll(`.ov-canvas .react-flow__node-ov${typ}`), (k) => ({
    id: k.dataset.id.slice(2), r: k.getBoundingClientRect(),
  })).sort((a, b) => a.r.top - b.r.top || a.r.left - b.r.left);
  const inZone = (liste, zone) => liste.filter(({ r }) => {
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    return x > zone.left && x < zone.right && y > zone.top && y < zone.bottom;
  });
  const projekte = zonen('Project'), boards = zonen('Board');
  const kacheln = zonen('Space').map(({ id, r }) => [id, ...inZone(projekte, r).map((p) => p.id)]);
  const kachelBoards = Object.fromEntries(projekte.map(({ id, r }) => [id, inZone(boards, r).map((b) => b.id)]));
  const gespeichert = JSON.parse(localStorage.getItem('pixinotes-board')).state;
  return {
    seitenleiste, kacheln, kachelBoards,
    gespeichert: gespeichert.spaces.map((s) => [s.id, ...s.projects.map((p) => p.id)]),
    projekte: Object.fromEntries(gespeichert.spaces.flatMap((s) => s.projects.map(({ id, boardIds, sortierung }) =>
      [id, sortierung ? { boardIds, sortierung } : { boardIds }]))),
    inhalt: gespeichert.boards.filter((b) => !b.system).map((b) => [b.id, b.nodes[0]?.data.blocks[0].content, !!b.archived]),
    aktiveAnsicht: [gespeichert.view, gespeichert.activeId],
  };
}

async function pruefe(seite, name, reihenfolge) {
  const soll = {
    seitenleiste: reihenfolge, kacheln: reihenfolge, gespeichert: reihenfolge, projekte,
    kachelBoards: { Atlas: ['Zweite', 'Erste'], Plan: ['Heute'], Werk: ['Bau'] },
    inhalt: boards.map((b) => [b.id, b.nodes[0].data.blocks[0].content, b.archived]),
    aktiveAnsicht: ['overview', 'Heute'],
  };
  // Das Einrasten der Kacheln und der gedrosselte Speicher-Schreiber dürfen fertig werden.
  const frist = Date.now() + 6500;
  let ist;
  do {
    ist = await seite.evaluate(leseAnsichten);
    if (isDeepStrictEqual(ist, soll)) { console.log(`  ✓ ${name}`); return; }
    await warten(80);
  } while (Date.now() < frist);
  assert.deepEqual(ist, soll, name);
}

async function ziehen(seite, baum, quelle, ziel, platz) {
  const art = (id) => Object.hasOwn(projekte, id) ? 'projekt' : 'bereich';
  const kopf = (id) => seite.locator(art(id) === 'projekt' ? '.tabs.spalte .side-proj-head' : '.tabs.spalte .side-space-head')
    .filter({ has: seite.getByText(id, { exact: true }) });
  const zone = (id) => seite.locator(`.ov-canvas .react-flow__node[data-id="${art(id) === 'projekt' ? 'p' : 's'}-${id}"]`);
  const suche = seite.locator('.tabs.spalte .side-tree-find');
  if (baum) {
    const start = kopf(quelle).locator(art(quelle) === 'projekt' ? '.side-proj-name' : '.side-space-name');
    const ende = ziel ? kopf(ziel) : suche;
    const r = await ende.boundingBox();
    await start.dragTo(ende, { targetPosition: { x: r.width / 2, y: r.height * (platz === 'vor' ? 0.2 : 0.8) } });
    return;
  }

  const griff = zone(quelle).locator(`[data-taste="uebersicht-${art(quelle)}-griff"]`);
  let ende = suche;
  if (ziel) {
    ende = zone(ziel);
    if (art(quelle) === 'projekt') ende = ende.locator(art(ziel) === 'projekt' ? '.ovc-project-head' : '.ovc-space-head');
  }
  await griff.hover();
  await ende.scrollIntoViewIfNeeded();
  const r = await ende.boundingBox();
  let x = r.x + r.width / 2, y = r.y + r.height / 2;
  if (ziel && art(quelle) === 'bereich') y = r.y + r.height * (platz === 'vor' ? 0.2 : 0.8);
  if (ziel && art(ziel) === 'projekt') x = r.x + r.width * (platz === 'vor' ? 0.2 : 0.8);
  await seite.mouse.down();
  await seite.mouse.move(x, y, { steps: 18 });
  await seite.mouse.up();
}

const server = await preview({ configFile: false, build: { outDir: process.env.PN_DIST ?? fileURLToPath(new URL('../dist', import.meta.url)) },
  preview: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium' });
  for (const baum of [true, false]) {
    const seite = await browser.newPage({ viewport: { width: 1600, height: 1060 }, serviceWorkers: 'block', locale: 'de-DE' });
    const fehler = [];
    seite.on('pageerror', (e) => fehler.push(e.message));
    await seite.addInitScript((st) => {
      if (localStorage.getItem('pixinotes-board')) return;
      localStorage.setItem('pixinotes-onboarded', '1');
      localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
    }, stand);
    console.log(baum ? 'Seitenleiste' : 'Kachelübersicht');
    await seite.goto(server.resolvedUrls.local[0]);
    await seite.locator('.ov-canvas.ov-weich').waitFor();
    await pruefe(seite, 'Ausgangsordnung und Boardinhalte', start);

    const schritt = async (name, quelle, ziel, platz, soll) => {
      await ziehen(seite, baum, quelle, ziel, platz);
      await pruefe(seite, name, soll);
    };
    await schritt('Im eigenen Projekt loslassen', 'Atlas', 'Atlas', 'nach', start);
    const ende = [['Frei'], ['Süd', 'Werk', 'Atlas'], ['Nord', 'Plan']];
    await schritt('Bereich vor den ersten Bereich', 'Frei', 'Nord', 'vor', [['Frei'], ...start.slice(0, 2)]);
    await schritt('Bereich mit Projekten und Boards ans Ende', 'Nord', 'Süd', 'nach', [['Frei'], start[1], start[0]]);
    await schritt('Projekt hinter das letzte Projekt', 'Atlas', 'Plan', 'nach', [['Frei'], ['Süd', 'Werk'], ['Nord', 'Plan', 'Atlas']]);
    await schritt('Projekt vor ein Projekt eines anderen Bereichs', 'Atlas', 'Werk', 'vor', [['Frei'], ['Süd', 'Atlas', 'Werk'], ['Nord', 'Plan']]);
    await schritt('Projekt in den leeren Bereich', 'Atlas', 'Frei', 'ende', [['Frei', 'Atlas'], ['Süd', 'Werk'], ['Nord', 'Plan']]);
    await schritt('Projekt über den Bereichskopf ans Ende', 'Atlas', 'Süd', 'ende', ende);
    await schritt('Außerhalb der Struktur loslassen', 'Atlas', null, 'abbruch', ende);
    await seite.reload();
    await seite.locator('.ov-canvas.ov-weich').waitFor();
    await pruefe(seite, 'Nach Neuladen stimmen beide Ansichten, Boardinhalte und aktives Board', ende);
    if (baum) {
      async function verschiebeImMenu(kopf, wahl) {
        await kopf.locator('.ebenen-menu-knopf').press('Enter');
        await seite.getByRole('menuitem', { name: 'Verschieben …', exact: true }).press('Enter');
        await seite.getByRole('menuitem', { name: wahl, exact: true }).press('Enter');
      }
      await verschiebeImMenu(seite.locator('.side-proj-head').filter({ has: seite.getByText('Atlas', { exact: true }) }), 'Frei');
      await pruefe(seite, 'Projektmenü verschiebt Atlas in den gewählten Bereich', [['Frei', 'Atlas'], ['Süd', 'Werk'], ['Nord', 'Plan']]);
      await verschiebeImMenu(seite.locator('.ov-canvas [data-id="s-Süd"] .ovc-space-head'), 'Eine Position nach vorn');
      await pruefe(seite, 'Bereichsmenü setzt Süd eine Position nach vorn', [['Süd', 'Werk'], ['Frei', 'Atlas'], ['Nord', 'Plan']]);
    }
    assert.deepEqual(fehler, [], 'Browserfehler');
    await seite.close();
  }
} finally {
  await browser?.close();
  await server.close();
}
