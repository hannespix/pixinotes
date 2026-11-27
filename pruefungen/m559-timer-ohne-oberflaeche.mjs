// M559: Der laufende Timer gehört auch zum geteilten Board mit ausgeblendeter Bedienung.
import assert from 'node:assert/strict';
import { mitTimerTeam, taste } from './geteiltes-timer-board.mjs';

await mitTimerTeam(5559, async (desktop, telefon) => {
  const timer = taste(desktop, 'timer-chip');
  const zeit = taste(desktop, 'timer-zeit');
  const klapp = taste(desktop, 'timer-klapp');

  // Der Gast blendet die Bedienung bereits vor dem Start aus.
  await telefon.locator('.dock button[aria-label="Mehr"]').tap();
  await taste(telefon, 'dock-nur-board').tap();
  await telefon.locator('html[data-nur-board]').waitFor();
  assert.ok(await telefon.locator('.app > .dock').isHidden());
  await taste(desktop, 'live-auf').click();
  await desktop.locator('[data-taste="timer-min"][data-min="5"]').click();
  await timer.waitFor();
  await taste(telefon, 'timer-chip').waitFor();
  await taste(telefon, 'timer-klapp').tap();
  await telefon.locator('[data-taste="timer-klapp"][aria-expanded="false"]').waitFor();
  await taste(telefon, 'timer-zeit').tap();
  await taste(telefon, 'timer-zu').waitFor();

  // Der Starter schaltet bei schon verschobener, minimierter Uhr in den Modus.
  await taste(desktop, 'timer-griff').press('ArrowDown');
  await klapp.click();
  const vorher = await timer.boundingBox();
  await desktop.keyboard.press('Alt+b');
  await desktop.locator('html[data-nur-board]').waitFor();
  assert.ok(await desktop.locator('.app > .dock').isHidden());
  await zeit.waitFor();
  assert.deepEqual(await timer.boundingBox(), vorher);
  assert.equal(await klapp.getAttribute('aria-expanded'), 'false');
  await desktop.waitForFunction((alt) => document.querySelector('[data-taste="timer-zeit"]').textContent !== alt, await zeit.textContent());
  await zeit.click();
  await taste(desktop, 'timer-zu').waitFor();
  // Auch an der Ausblende-Ecke muss der kompakte Timer einen Tipp annehmen.
  await klapp.click();
  const griff = await taste(desktop, 'timer-griff').boundingBox();
  await desktop.mouse.move(griff.x + griff.width / 2, griff.y + griff.height / 2);
  await desktop.mouse.down();
  const fenster = desktop.viewportSize();
  await desktop.mouse.move(fenster.width - 2, fenster.height - 2, { steps: 5 });
  await desktop.mouse.up();
  await zeit.click();
  await taste(desktop, 'timer-zu').waitFor();
  await desktop.keyboard.press('Escape');
  await desktop.locator('.app > .dock').waitFor();
  assert.ok(await zeit.isVisible());
  // Auch das gemeinsame Ende wirkt bei weiter ausgeblendeter Bedienung.
  await taste(desktop, 'timer-zu').click();
  await taste(telefon, 'timer-chip').waitFor({ state: 'detached' });
  assert.ok(await telefon.locator('.app > .dock').isHidden());
});
console.log('M559: Der Timer läuft in beiden Ansichten sichtbar weiter und lässt sich wiederherstellen.');
