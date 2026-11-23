#!/usr/bin/env node
// M475: vergleicht zwei gebaute Stylesheets (dist/assets/index-*.css) Regel für Regel.
//   node werkzeug/css-vergleich.mjs alt.css neu.css
// Gibt aus: byte-gleich, oder gleiche Regeln in anderer Reihenfolge (mit den verschobenen Regeln), oder
// welche Regeln fehlen bzw. neu sind. Ausgang 0 = gleiche Regelmenge, 1 = Regeln unterscheiden sich.
// Gedacht für Umbauten, die nur verschieben sollen (Aufteilen des Stylesheets, Umsortieren).
import { readFileSync } from 'node:fs';

/** Zerlegt CSS in Regeln der obersten Ebene (Klammertiefe 0), Zeichenketten und Kommentare beachtet. */
export function regeln(css) {
  const out = [];
  let tiefe = 0, start = 0, i = 0;
  while (i < css.length) {
    const c = css[i];
    if (c === '"' || c === "'") { const q = c; i++; while (i < css.length && css[i] !== q) { if (css[i] === '\\') i++; i++; } i++; continue; }
    if (c === '/' && css[i + 1] === '*') { const e = css.indexOf('*/', i + 2); i = e < 0 ? css.length : e + 2; continue; }
    if (c === '{') tiefe++;
    else if (c === '}') { tiefe--; if (tiefe === 0) { out.push(css.slice(start, i + 1).trim()); start = i + 1; } }
    else if (c === ';' && tiefe === 0) { out.push(css.slice(start, i + 1).trim()); start = i + 1; }
    i++;
  }
  const rest = css.slice(start).trim();
  if (rest) out.push(rest);
  return out.filter(Boolean);
}

function zaehle(liste) { const m = new Map(); for (const r of liste) m.set(r, (m.get(r) || 0) + 1); return m; }

/** Längste gemeinsame Teilfolge (Patience-Sortierung über die Positionen in b) – was nicht darin liegt, hat seine Stelle gewechselt. */
function verschoben(a, b) {
  const pos = new Map(); b.forEach((r, j) => { if (!pos.has(r)) pos.set(r, []); pos.get(r).push(j); });
  const folge = [];
  a.forEach((r, i) => { const p = pos.get(r) ?? []; for (let k = p.length - 1; k >= 0; k--) folge.push([i, p[k]]); });
  const tails = []; const vor = new Array(folge.length).fill(-1);
  folge.forEach(([, j], f) => {
    let lo = 0, hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (folge[tails[mid]][1] < j) lo = mid + 1; else hi = mid; }
    if (lo > 0) vor[f] = tails[lo - 1];
    tails[lo] = f;
  });
  const drin = new Set(); let f = tails.length ? tails[tails.length - 1] : -1;
  while (f >= 0) { drin.add(folge[f][0]); f = vor[f]; }
  return a.filter((_, i) => !drin.has(i));
}

const istHaupt = import.meta.url === `file://${process.argv[1]}`;
if (istHaupt) {
  const [, , altPfad, neuPfad] = process.argv;
  if (!altPfad || !neuPfad) { console.error('Aufruf: node werkzeug/css-vergleich.mjs alt.css neu.css'); process.exit(2); }
  const alt = readFileSync(altPfad, 'utf8'), neu = readFileSync(neuPfad, 'utf8');
  if (alt === neu) { console.log('byte-gleich'); process.exit(0); }
  const a = regeln(alt), b = regeln(neu);
  const za = zaehle(a), zb = zaehle(b);
  const fehlt = [...za].filter(([r, k]) => (zb.get(r) || 0) < k).map(([r]) => r);
  const neuR = [...zb].filter(([r, k]) => (za.get(r) || 0) < k).map(([r]) => r);
  console.log(`Regeln: alt ${a.length}, neu ${b.length}`);
  if (fehlt.length || neuR.length) {
    for (const r of fehlt) console.log('  fehlt: ' + r.slice(0, 200));
    for (const r of neuR) console.log('  neu:   ' + r.slice(0, 200));
    process.exit(1);
  }
  const weg = verschoben(a, b);
  console.log(`gleiche Regelmenge; ${weg.length} Regel(n) haben ihre Stelle gewechselt:`);
  for (const r of weg) console.log('  ' + r.slice(0, 160));
  process.exit(0);
}
