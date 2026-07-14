import { chromium } from 'playwright-core';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`); };

await page.goto('http://localhost:4199/');
await page.waitForSelector('.react-flow__node', { timeout: 15000 });
await page.waitForTimeout(1200);

const undoBtn = page.locator('.dock button[aria-label="Rückgängig"]');
const redoBtn = page.locator('.dock button[aria-label="Wiederholen"]');
check('Undo/Redo-Buttons im Dock', await undoBtn.count() === 1 && await redoBtn.count() === 1);
check('Initial deaktiviert', await undoBtn.isDisabled() && await redoBtn.isDisabled());

// ---------- 1) Strich zeichnen → Undo entfernt ihn → Redo bringt ihn zurück ----------
await page.locator('.dock button[aria-label="Stift"]').click();
await page.waitForTimeout(300);
await page.evaluate(async () => {
  const el = document.querySelector('.drawing-layer');
  const ev = (type, x, y) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 5, pointerType: 'pen', isPrimary: true, buttons: 1 }));
  ev('pointerdown', 300, 700);
  for (let x = 310; x <= 500; x += 15) { ev('pointermove', x, 700 + Math.sin(x / 9) * 40); await new Promise((r) => setTimeout(r, 8)); }
  ev('pointerup', 500, 700);
});
await page.waitForTimeout(300);
const paths1 = await page.locator('.drawing-layer path').count();
check('Strich gezeichnet', paths1 === 1, `paths=${paths1}`);
check('Undo-Button jetzt aktiv', !(await undoBtn.isDisabled()));

await undoBtn.click();
await page.waitForTimeout(300);
check('Undo entfernt den Strich', await page.locator('.drawing-layer path').count() === 0);
check('Redo-Button aktiv', !(await redoBtn.isDisabled()));
await redoBtn.click();
await page.waitForTimeout(300);
check('Redo bringt den Strich zurück', await page.locator('.drawing-layer path').count() === 1);

// ---------- 2) Radierer: eine Geste = EIN Undo-Schritt ----------
// Zweiten Strich zeichnen
await page.evaluate(async () => {
  const el = document.querySelector('.drawing-layer');
  const ev = (type, x, y) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 6, pointerType: 'pen', isPrimary: true, buttons: 1 }));
  ev('pointerdown', 600, 700);
  for (let x = 610; x <= 780; x += 15) { ev('pointermove', x, 700); await new Promise((r) => setTimeout(r, 8)); }
  ev('pointerup', 780, 700);
});
await page.waitForTimeout(300);
check('Zwei Striche vorhanden', await page.locator('.drawing-layer path').count() === 2);
// Radieren: über BEIDE Striche in einer Geste
await page.locator('.dock button[aria-label="Radierer"]').click();
await page.waitForTimeout(300);
await page.evaluate(async () => {
  const el = document.querySelector('.drawing-layer');
  const ev = (type, x, y, buttons = 1) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 7, pointerType: 'pen', isPrimary: true, buttons }));
  ev('pointerdown', 300, 700);
  for (let x = 310; x <= 780; x += 10) { ev('pointermove', x, 700); await new Promise((r) => setTimeout(r, 5)); }
  ev('pointerup', 780, 700, 0);
});
await page.waitForTimeout(300);
const afterErase = await page.locator('.drawing-layer path').count();
check('Radiergeste löscht beide Striche', afterErase === 0, `paths=${afterErase}`);
await page.keyboard.press('Escape'); // Zeichenmodus verlassen
await page.waitForTimeout(200);
// EIN Undo muss BEIDE Striche zurückbringen (eine Geste = ein Schritt)
await page.keyboard.press('Control+z');
await page.waitForTimeout(300);
check('Ein Strg+Z stellt die ganze Radier-Geste wieder her', await page.locator('.drawing-layer path').count() === 2);

// ---------- 3) Karte löschen → Strg+Z holt sie zurück; Strg+Y löscht wieder ----------
const nodesBefore = await page.locator('.react-flow__node').count();
await page.locator('.react-flow__node[data-id="demo-idea"]').click({ position: { x: 6, y: 5 } });
await page.waitForTimeout(200);
await page.keyboard.press('Delete');
await page.waitForTimeout(400);
check('Karte gelöscht', await page.locator('.react-flow__node').count() === nodesBefore - 1);
await page.keyboard.press('Control+z');
await page.waitForTimeout(400);
check('Strg+Z holt die Karte zurück', await page.locator('.react-flow__node').count() === nodesBefore);
await page.keyboard.press('Control+y');
await page.waitForTimeout(400);
check('Strg+Y löscht sie wieder', await page.locator('.react-flow__node').count() === nodesBefore - 1);

check('Keine Seitenfehler', errors.length === 0, errors.slice(0, 2).join(' | '));
console.log(results.join('\n'));
await browser.close();
