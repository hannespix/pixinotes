// M468: Pfad des Chromiums, das playwright-core installiert hat – für PW_CHROMIUM im nächtlichen CI-Lauf.
//
//   npx playwright-core install --with-deps chromium
//   echo "PW_CHROMIUM=$(node werkzeug/chromium-pfad.mjs)" >> "$GITHUB_ENV"
//
// Die Prüfreihen erwarten sonst /opt/pw-browsers/chromium (Claude-Umgebung). Fehlt die Datei unter dem Pfad,
// endet das Skript mit Rückgabewert 1 und einer Meldung auf stderr – dann schlägt der Schritt laut fehl, statt
// dass 187 Reihen einzeln an einem fehlenden Browser scheitern.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const pfad = chromium.executablePath();
if (!pfad || !existsSync(pfad)) {
  console.error(`Chromium fehlt unter „${pfad || '(kein Pfad)'}" – erst \`npx playwright-core install chromium\` ausführen`);
  process.exit(1);
}
console.log(pfad);
