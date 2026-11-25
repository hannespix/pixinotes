// M518: Wie viel Rechenzeit gibt die Maschine gerade her? — für Prüfpunkte, die ZEIT messen (Bildzeit, Bilder/s).
//
// Befund aus dem Gesamtlauf (M518): Laufen mehrere Agenten zugleich (Last 10–25 auf vier Kernen), bekommt jeder
// Browser nur einen Bruchteil der Kerne. Eine Bildzeit von 16,7 ms wird dann zu 33,3 ms – nicht, weil die App
// langsamer rechnet, sondern weil sie seltener drankommt. Solche Prüfpunkte (m485 L2, m491 L1/L2, m500 F2) waren
// unter Last rot und allein grün.
//
// Der Ausweg ist KEINE weichere Grenze, sondern eine Messung der Maschine neben der Messung der App:
//   · `cpuAnteil()` lässt so viele Fäden rechnen, wie die Maschine Kerne hat (höchstens vier – so viele braucht
//     ein Browser ohne Grafikkarte für Skript, Zusammensetzen und Rastern), und vergleicht die verbrauchte
//     Rechenzeit mit der vergangenen Uhrzeit: 1 = alle Kerne frei, 0,3 = nur ein knappes Drittel.
//     (Ein einzelner rechnender Faden taugt nicht als Probe: Er bekommt auch bei Last 10 fast einen ganzen Kern.)
//   · `ruhigeMaschine()` wartet (begrenzt) auf einen ruhigen Moment.
//   · Auf ruhiger Maschine (Anteil ≥ RUHIG) gilt die Grenze unverändert. Nur wenn die Maschine nachweislich nicht
//     frei ist, rechnen `bildGrenze()` / `tempoGrenze()` die Grenze auf den gemessenen Anteil um – in ganzen
//     Bildern, weil der Browser nur im Bildtakt zeichnet (halbe Rechenzeit → jedes zweite Bild).
//   Reihen messen zuerst auf ruhiger Maschine (warten, wiederholen) und rechnen nur um, wenn es keinen ruhigen
//   Moment gab. Ein echter Rückschritt (doppelte Rechenzeit je Bild) fällt damit auch unter Last auf.
//
//   import { cpuAnteil, ruhigeMaschine, bildGrenze, tempoGrenze, lastText, RUHIG } from '../werkzeug/maschinen-last.mjs';
//   node werkzeug/maschinen-last.mjs        → zeigt den Anteil jetzt (fünf Proben)
import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** Ab diesem Anteil gilt die Maschine als ruhig (die Probe selbst streut um einige Prozent) */
export const RUHIG = 0.85;
const BILD_MS = 1000 / 60;
const FAEDEN = Math.max(1, Math.min(4, availableParallelism()));
const RECHNER = `
  const { parentPort } = require('node:worker_threads');
  parentPort.on('message', (ms) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { /* rechnen */ } parentPort.postMessage(performance.now() - t0); });
  parentPort.postMessage(0);
`;

/** Anteil der Kerne, den dieser Prozess gerade bekommt (0…1); dauert etwa `ms` plus das Starten der Fäden */
export async function cpuAnteil(ms = 250) {
  const fertig = (w) => new Promise((ok) => w.once('message', ok));
  const faeden = Array.from({ length: FAEDEN }, () => new Worker(RECHNER, { eval: true }));
  try {
    await Promise.all(faeden.map(fertig));                        // alle gestartet und bereit
    const c0 = process.cpuUsage();
    const dauern = Promise.all(faeden.map(fertig));
    for (const w of faeden) w.postMessage(ms);
    const wand = (await dauern).reduce((a, b) => a + b, 0);       // Uhrzeit, die die Fäden zusammen gerechnet haben wollten
    const c = process.cpuUsage(c0);
    return Math.max(0.02, Math.min(1, (c.user + c.system) / 1000 / wand));
  } finally {
    await Promise.all(faeden.map((w) => w.terminate()));
  }
}

/** Wartet höchstens `ms`, bis zwei Proben hintereinander eine ruhige Maschine melden; liefert den zuletzt gemessenen Anteil */
export async function ruhigeMaschine(ms = 15000) {
  const bis = Date.now() + ms; let vor = 0; let a = await cpuAnteil();
  while (!(a >= RUHIG && vor >= RUHIG) && Date.now() < bis) {
    await new Promise((ok) => setTimeout(ok, 600));
    vor = a; a = await cpuAnteil();
  }
  return a;
}

/** Bilder, die bei diesem Anteil für die Arbeit EINES Bildes vergehen (ruhig: 1) */
const bilderJeBild = (anteil) => (anteil >= RUHIG ? 1 : Math.ceil(1 / anteil - 0.05));

/** Grenze für eine Bildzeit / Verzögerung in ms: ruhig unverändert, sonst um die zusätzlich vergehenden Bilder höher */
export const bildGrenze = (grenzeMs, anteil) => grenzeMs + (bilderJeBild(anteil) - 1) * BILD_MS;

/** Grenze für „mindestens n Bilder je Sekunde": ruhig unverändert, sonst im Verhältnis des Anteils */
export const tempoGrenze = (bilderJeSekunde, anteil) => (anteil >= RUHIG ? bilderJeSekunde : bilderJeSekunde * anteil);

/** Für die Ausgabe einer Reihe: sagt laut, wenn eine Grenze umgerechnet wurde */
export const lastText = (anteil) => (anteil >= RUHIG ? 'Maschine ruhig' : `Maschine ausgelastet: nur ${Math.round(anteil * 100)} % der Rechenzeit frei – Grenze auf diesen Anteil umgerechnet`);

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (let i = 0; i < 5; i += 1) { const a = await cpuAnteil(); console.log(`${Math.round(a * 100)} % · ${lastText(a)} · 18 ms → ${bildGrenze(18, a).toFixed(1)} ms · 15 Bilder/s → ${tempoGrenze(15, a).toFixed(1)}`); await new Promise((ok) => setTimeout(ok, 500)); }
}
