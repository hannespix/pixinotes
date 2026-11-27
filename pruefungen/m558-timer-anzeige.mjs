// M558: Zwei Gäste im selben Board, mit je eigener Timeranzeige.
import assert from 'node:assert/strict';
import { mitTimerTeam, taste } from './geteiltes-timer-board.mjs';

const chip = (P) => taste(P, 'timer-chip');
const griff = (P) => taste(P, 'timer-griff');
const klapp = (P) => taste(P, 'timer-klapp');
const zeit = (P) => taste(P, 'timer-zeit');
const offen = (P) => klapp(P).getAttribute('aria-expanded', { timeout: 3000 });
const warteKlapp = (P, wert) => P.locator(`[data-taste="timer-klapp"][aria-expanded="${wert}"]`).waitFor();
const rest = async (P) => (await zeit(P).textContent()).split(':').reduce((n, s) => 60 * n + Number(s), 0);
const mitte = ({ x, y, width, height }) => ({ x: x + width / 2, y: y + height / 2 });

async function starten(P, minuten) {
  await taste(P, 'live-auf').click();
  await P.locator(`[data-taste="timer-min"][data-min="${minuten}"]`).click();
}

async function ziehen(P, dx, dy) {
  const ziel = mitte(await griff(P).boundingBox());
  await P.mouse.move(ziel.x, ziel.y);
  await P.mouse.down();
  await P.mouse.move(ziel.x + dx, ziel.y + dy, { steps: 8 });
  await P.mouse.up();
}

async function touchZiehen(P, dx, dy) {
  const cdp = await P.context().newCDPSession(P);
  const ziel = mitte(await griff(P).boundingBox());
  const schicken = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  await schicken('touchStart', [ziel]);
  for (let i = 1; i <= 5; i++) await schicken('touchMove', [{ x: ziel.x + dx * i / 5, y: ziel.y + dy * i / 5 }]);
  await schicken('touchEnd', []);
  await cdp.detach();
}

async function passt(P) {
  await P.waitForFunction(() => {
    const e = document.querySelector('[data-taste="timer-chip"]');
    if (!e) return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
  });
}

let checks = 0;
function pruefe(name, erfuellt) {
  assert.ok(erfuellt, name);
  checks++;
  console.log(`  ✓ ${name}`);
}

await mitTimerTeam(5558, async (A, B) => {
  await starten(A, 5);
  await Promise.all([chip(A).waitFor(), chip(B).waitFor()]);
  pruefe('Beide sehen denselben frisch gestarteten Lauf', await rest(A) >= 297 && Math.abs(await rest(A) - await rest(B)) <= 2);
  pruefe('Der laufende Timer hat einen Einklappknopf', await klapp(A).count() === 1);
  pruefe('Der Timer startet bei beiden in voller Größe', await offen(A) === 'true' && await offen(B) === 'true');

  const vorher = await chip(A).boundingBox();
  const gastVorher = await chip(B).boundingBox();
  await ziehen(A, 490, 625);
  const gezogen = await chip(A).boundingBox();
  pruefe('Ziehen am Griff verschiebt den Timer auf beiden Achsen', gezogen.x > vorher.x + 300 && gezogen.y > vorher.y + 450);
  await griff(A).press('ArrowLeft');
  const tastenlage = await chip(A).boundingBox();
  pruefe('Die Pfeiltaste bewegt den fokussierten Griff nach links', tastenlage.x < gezogen.x - 5 && Math.abs(tastenlage.y - gezogen.y) < 2);

  const sek = await rest(A);
  await klapp(A).click();
  pruefe('Eingeklappt bleiben Griff und Restzeit sichtbar', await offen(A) === 'false' && await griff(A).isVisible()
    && await zeit(A).isVisible() && (await chip(A).boundingBox()).width < tastenlage.width);
  await A.waitForFunction((alt) => {
    const s = document.querySelector('[data-taste="timer-zeit"]')?.textContent;
    return !!s && s.split(':').reduce((n, z) => n * 60 + Number(z), 0) < alt;
  }, sek);
  const gastJetzt = await chip(B).boundingBox();
  pruefe('Das Einklappen lässt den Timer weiterlaufen und ändert beim Gast nichts', await offen(A) === 'false' && await offen(B) === 'true'
    && Math.abs(await rest(A) - await rest(B)) <= 2 && Math.abs(gastVorher.x - gastJetzt.x) < 3 && Math.abs(gastVorher.y - gastJetzt.y) < 3);

  const kompakteLage = await chip(A).boundingBox();
  await A.mouse.click(50, 450);
  await A.keyboard.press('Alt+p');
  await A.locator('.presenter-slide').waitFor();
  const folienLage = await chip(A).boundingBox();
  pruefe('In der Präsentation bleibt der eingeklappte Timer an der eigenen Stelle', await offen(A) === 'false'
    && await zeit(A).isVisible() && Math.abs(folienLage.x - kompakteLage.x) < 3 && Math.abs(folienLage.y - kompakteLage.y) < 3);
  await klapp(A).press('Enter');
  pruefe('Enter öffnet den Timer in der Präsentation und der Fokus bleibt auf dem Knopf', await offen(A) === 'true'
    && await klapp(A).evaluate((e) => e === document.activeElement));
  await A.keyboard.press('Space');
  pruefe('Die Leertaste klappt den Timer wieder ein und lässt den Fokus auf dem Knopf', await offen(A) === 'false'
    && await klapp(A).evaluate((e) => e === document.activeElement));
  await zeit(A).click();
  pruefe('Ein Klick auf die Restzeit öffnet den Timer auch über der Folie', await offen(A) === 'true' && await taste(A, 'timer-zu').isVisible());
  await klapp(A).click();
  await taste(A, 'vortrag-zu').click();
  pruefe('Beim Verlassen der Präsentation bleibt der Timer eingeklappt', await offen(A) === 'false');

  await taste(A, 'einstellungen').first().click();
  await A.getByRole('group', { name: 'Anzeigegröße' }).getByRole('button', { name: '175 %', exact: true }).click();
  await A.waitForFunction(() => getComputedStyle(document.documentElement).zoom === '1.75');
  await A.keyboard.press('Escape');
  await A.setViewportSize({ width: 570, height: 420 });
  await passt(A);
  await zeit(A).click();
  await passt(A);
  pruefe('Bei 175 % bleibt der Timer nach Verkleinern und Wiederherstellen im Fenster', await offen(A) === 'true');

  await touchZiehen(B, 85, 185);
  const touch = await chip(B).boundingBox();
  pruefe('Auf dem Telefon lässt sich der Timer mit dem Finger verschieben', touch.x > gastJetzt.x + 30 && touch.y > gastJetzt.y + 120);
  await klapp(B).tap();
  await warteKlapp(B, false);
  pruefe('Ein Tipp klappt nur die eigene Anzeige ein', await offen(B) === 'false' && await offen(A) === 'true');
  await zeit(B).tap();
  await warteKlapp(B, true);
  pruefe('Ein Tipp auf die Restzeit öffnet den Timer wieder', await offen(B) === 'true');

  await klapp(A).click();
  const alterLauf = await chip(A).boundingBox();
  await starten(B, 3);
  await A.waitForFunction(() => {
    const klapp = document.querySelector('[data-taste="timer-klapp"]');
    const zeit = document.querySelector('[data-taste="timer-zeit"]')?.textContent;
    return klapp?.getAttribute('aria-expanded') === 'true' && /^(3:00|2:5[6-9])$/.test(zeit ?? '');
  });
  pruefe('Ein neuer gemeinsamer Lauf beginnt wieder mit der vollen Anzeige an der Vorgabestelle',
    await offen(B) === 'true' && (await chip(A).boundingBox()).y < alterLauf.y - 50);
  await taste(B, 'timer-zu').tap();
  await Promise.all([chip(A).waitFor({ state: 'detached' }), chip(B).waitFor({ state: 'detached' })]);
  pruefe('Anhalten über den separaten Knopf beendet den Timer auf beiden Geräten', await chip(A).count() === 0 && await chip(B).count() === 0);
});
console.log(`M558: ${checks} bestanden, 0 fehlgeschlagen`);
