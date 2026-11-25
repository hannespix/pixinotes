/**
 * M528 — Rechen-Tabelle: Zeilen und Spalten einfügen/löschen, Bereiche kopieren/ausschneiden/einfügen,
 * Datumsrechnung, ganze Spalten und Zeilen als Bereich, Abgleich mit Umbau-Protokoll.
 *
 *   A   Logik (lib/formel.ts + formelPlus.ts + tabellenUmbau.ts + syncMerge.ts, gebündelt mit esbuild) — jede
 *       erwartete Zahl ist von Hand nachgerechnet und steht fest im Prüfpunkt
 *       A1 Datum · A2 ganze Spalten/Zeilen · A3 Einfügen/Löschen (Bezüge, Bereiche, #BEZUG!, $) · A4 Kopieren und
 *       Ausschneiden (Bezüge wandern bzw. folgen) · A5 Tabulator-Text · A6 Abgleich zweier Geräte · A7 Gestalt-Prüfung
 *   B   Im gebauten Programm (playwright-core gegen dist/, Uhr fest auf den 25.11.2026)
 *       B1 Rechtsklick auf Zeilenkopf → einfügen, Summe rechnet mit, Strg+Z/Strg+Y je ein Schritt
 *       B2 Spalte löschen → #BEZUG! · B3 mehrere Zeilen auf einmal · B4 Ziehen + Strg+C/V (Formeln wandern, Text
 *       für Excel) · B5 aus Excel einfügen (größer als die Tabelle) · B6 Ausschneiden · B7 Entf, Lostippen, Umschalt+Klick,
 *       Kopf wählt Spalte · B8 Datum und ganze Spalten in der Karte · B9 Englisch (Datum, #REF!, Menü) · B10 26 Spalten
 *
 * Läuft aus dem Repository: `node werkzeug/alle-pruefungen.mjs m528`
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const SRC = process.env.M528_SRC ?? path.join(__repo, 'src');
const BILDER = process.env.PN_BILDER ?? path.join(__repo, 'pruefungen', 'ablage', 'm528');
mkdirSync(BILDER, { recursive: true });
const PORT = 5528;
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
async function warteBis(fn, ms = 12000) {
  const ende = Date.now() + ms;
  while (Date.now() < ende) { try { if (await fn()) return true; } catch { /* weiter */ } await new Promise((x) => setTimeout(x, 120)); }
  try { return !!(await fn()); } catch { return false; }
}
const gleich = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ══ A: Logik ═══════════════════════════════════════════════════════
console.log('\n════ A: Logik ════');
let m = null;
{
  const einstieg = path.join(BILDER, 'm528-einstieg.ts');
  const lib = (d) => JSON.stringify(path.join(SRC, 'lib', d));
  writeFileSync(einstieg, [
    `export { rechneBlatt, zeigeWert } from ${lib('formel')};`,
    `export * from ${lib('formelPlus')};`,
    `export * from ${lib('tabellenUmbau')};`,
    `export { dreiWegeMerge } from ${lib('syncMerge')};`,
    `export { standVonAussen } from ${lib('sicherGestalt')};`,
  ].join('\n'));
  const aus = path.join(BILDER, 'm528-buendel.mjs');
  try {
    await build({ entryPoints: [einstieg], bundle: true, format: 'esm', platform: 'node', outfile: aus, logLevel: 'silent' });
    m = await import(pathToFileURL(aus).href);
  } catch (e) { pruefe('A0 Rechenkern lässt sich bündeln (formelPlus/tabellenUmbau vorhanden)', false, String(e).slice(0, 200)); }
}
if (m) {
  const r = (zellen) => { const w = m.rechneBlatt(zellen); return Object.fromEntries(Object.entries(w).map(([k, v]) => [k, m.zeigeWert(v)])); };
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const deu = (d) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  const heute = new Date(); const morgen = new Date(heute.getFullYear(), heute.getMonth(), heute.getDate() + 1);

  // A1 Datum — von Hand: 24.12. − 25.11. = 6 (Rest November) + 23 = 29 Tage; 24.12. + 7 = 31.12.; 24.12. − 30 = 24.11.;
  // 28.02.2024 + 1 = 29.02. (Schaltjahr); 01.03.2026 − 01.02.2026 = 28; 31.12.2026 + 1 = 01.01.2027
  const a = r({
    A1: '24.12.2026', A2: '30', A3: '2026-11-25',
    B1: '=HEUTE()+1', B2: '=DATUM(2026;12;24)-DATUM(2026;11;25)', B3: '=A1+7', B4: '=A1-30', B5: '=DATUM(2024;2;28)+1',
    B6: '=DATUM(2026;3;1)-DATUM(2026;2;1)', B7: '=DATUM(2026;12;31)+1', B8: '=A1-A3', B9: '=JAHR(A1)&"/"&MONAT(A1)&"/"&TAG(A1)',
    C1: '=A1+A3', C2: '=5-A1', C3: '=A1>A3', C4: '=TODAY()+1', C5: '=HEUTE()-A2', C6: '=A1-HEUTE()', C7: '=DATE(2026;11;25)=A3',
    C8: '=7+A1', C9: '=DATUM(2026;11;25)+0,5',
  });
  pruefe('A1a =HEUTE()+1 ist morgen (de: TT.MM.JJJJ), TODAY englisch ebenso', a.B1 === deu(morgen) && a.C4 === deu(morgen), [a.B1, a.C4, deu(morgen)]);
  pruefe('A1b Datum − Datum = Tage: 24.12. − 25.11. = 29 · 01.03. − 01.02.2026 = 28 · eingetipptes „24.12.2026" − „2026-11-25" = 29', a.B2 === '29' && a.B6 === '28' && a.B8 === '29', [a.B2, a.B6, a.B8]);
  pruefe('A1c Datum + Zahl = Datum: 24.12. + 7 = 31.12. · 24.12. − 30 = 24.11. · 28.02.2024 + 1 = 29.02.2024 · 31.12. + 1 = 01.01.2027 · 7 + Datum',
    a.B3 === '31.12.2026' && a.B4 === '24.11.2026' && a.B5 === '29.02.2024' && a.B7 === '01.01.2027' && a.C8 === '31.12.2026', [a.B3, a.B4, a.B5, a.B7, a.C8]);
  pruefe('A1d Datum + Datum und Zahl − Datum sind #WERT!; Vergleich zweier Daten; JAHR/MONAT/TAG', a.C1 === '#WERT!' && a.C2 === '#WERT!' && a.C3 === 'WAHR' && a.C7 === 'WAHR' && a.B9 === '2026/12/24', [a.C1, a.C2, a.C3, a.C7, a.B9]);
  const vorDreissig = new Date(heute.getFullYear(), heute.getMonth(), heute.getDate() - 30);
  const bisWeihnacht = Math.round((Date.UTC(2026, 11, 24) - Date.UTC(heute.getFullYear(), heute.getMonth(), heute.getDate())) / 864e5);
  pruefe('A1e =HEUTE()-A2 (Zahl) ist ein Datum, =A1-HEUTE() die Zahl der Tage; mit halbem Tag eine Uhrzeit', a.C5 === deu(vorDreissig) && a.C6 === bisWeihnacht.toLocaleString('de-DE') && a.C9 === '25.11.2026 12:00', [a.C5, a.C6, bisWeihnacht, a.C9]);
  pruefe('A1f HEUTE() selbst bleibt der Wert „JJJJ-MM-TT" (Vergleiche, Filter, Export unverändert)', m.rechneBlatt({ A1: '=HEUTE()' }).A1 === iso(heute));
  let leer = 'Fehler';
  try { leer = m.zeigeWert(undefined); } catch (e) { leer = String(e); }
  pruefe('A1g eine leere Zelle, die als undefined hereinkommt, bricht die Anzeige nicht (Tabelle in der Notiz, m283)', leer === undefined, leer);

  // A2 ganze Spalten/Zeilen — A: 10, 20, 30, „x" (Text), leer, 5 → Summe 65, Mittelwert 65/4 = 16,25, Anzahl 4, Anzahl2 5
  const b = r({
    A1: '10', A2: '20', A3: '30', A4: 'x', A6: '5',
    B1: '=SUMME(A:A)', B2: '=MITTELWERT(A:A)', B3: '=ANZAHL(A:A)', B4: '=ANZAHL2(A:A)', B5: '=SUMME($A:$A)', B6: '=SUMME(B:B)',
    C4: '=SUMME(A:A;A1)', C5: '=MAX(A:A)', C6: '=SUM(A:A)',
  });
  pruefe('A2a =SUMME(A:A) 65 · =MITTELWERT(A:A) 16,25 (Text und Leeres zählen nicht) · =ANZAHL 4 · =ANZAHL2 5 · $A:$A · SUM englisch · SUMME(A:A;A1) 75',
    b.B1 === '65' && b.B2 === '16,25' && b.B3 === '4' && b.B4 === '5' && b.B5 === '65' && b.C5 === '30' && b.C6 === '65' && b.C4 === '75', b);
  // Zeilen: E1 1, F1 2, G1 =SUMME(E1:F1) 3 → =SUMME(1:1) in E3 = 6; Zeilen 1–2 mit E2 4: 1 + 2 + 3 + 4 = 10
  const zr = r({ E1: '1', F1: '2', G1: '=SUMME(E1:F1)', E2: '4', E3: '=SUMME(1:1)', E4: '=SUMME(1:2)' });
  pruefe('A2b ganze Zeilen: =SUMME(1:1) = 1 + 2 + 3 = 6 · =SUMME(1:2) = 1 + 2 + 3 + 4 = 10', zr.E3 === '6' && zr.E4 === '10', zr);
  const ring = r({ A2: '5', H2: '=SUMME(2:2)', H3: '=H2+1' });
  pruefe('A2c Formel in der eigenen Spalte bzw. Zeile ist ein Ring: =SUMME(B:B) in B6 und =SUMME(2:2) in H2 → #ZYKLUS! (reicht weiter wie jeder Fehler)', b.B6 === '#ZYKLUS!' && ring.H2 === '#ZYKLUS!' && ring.H3 === '#ZYKLUS!', [b.B6, ring]);

  // A3 Einfügen/Löschen
  const d0 = { cells: { A1: '10', A2: '20', A3: '30', A4: '=SUMME(A1:A3)', B1: '=A2*2', B2: '=$A$3+A$1', B3: '=SUMME(A:A)', C1: '=SUMME(2:3)', C2: '=A3' }, rows: 6, cols: 4,
    links: { A3: 'https://x.de' }, stile: { A2: 0 }, colW: { B: 120 }, verbunden: ['A5:B5'], kopf: 1, bis: 3, filter: { C: ['1'] }, sort: { spalte: 'C' } };
  const z1 = m.umbauAnwenden(d0, m.umbauNeu('z', 1, 1));   // vor Zeile 2 eine Zeile
  pruefe('A3a Zeile vor 2 einfügen: Zellen rutschen, =SUMME(A1:A3) → A1:A4, =A2*2 → =A3*2, =$A$3+A$1 → =$A$4+A$1, Zeilenbereich 2:3 → 3:4',
    z1.cells.A3 === '20' && z1.cells.A5 === '=SUMME(A1:A4)' && z1.cells.B1 === '=A3*2' && z1.cells.B3 === '=$A$4+A$1' && z1.cells.C1 === '=SUMME(3:4)' && z1.cells.B4 === '=SUMME(A:A)' && z1.rows === 7, z1.cells);
  pruefe('A3b … Link, Aussehen, verbundene Zellen, Kopfzeile/Datenende wandern mit; das Protokoll hat einen Schritt',
    gleich(z1.links, { A4: 'https://x.de' }) && gleich(z1.stile, { A3: 0 }) && gleich(z1.verbunden, ['A6:B6']) && z1.kopf === 1 && z1.bis === 4 && z1.umbau.length === 1 && z1.umbau[0].n === 1, z1);
  const z2 = m.umbauAnwenden(d0, m.umbauNeu('z', 1, -1));   // Zeile 2 löschen
  pruefe('A3c Zeile 2 löschen: =SUMME(A1:A3) → A1:A2 (Bereich schrumpft), =A2*2 → =#BEZUG!*2, ergibt #BEZUG!; SUMME(2:3) → 2:2',
    z2.cells.A3 === '=SUMME(A1:A2)' && z2.cells.B1 === '=#BEZUG!*2' && z2.cells.C1 === '=SUMME(2:2)' && z2.cells.C2 === undefined && z2.rows === 5 && r(z2.cells).B1 === '#BEZUG!' && r(z2.cells).A3 === '40', z2.cells);
  const z3 = m.umbauAnwenden({ cells: { A1: '1', A2: '2', B1: '=SUMME(A1:A2)', B2: '=A2' }, rows: 4, cols: 2 }, m.umbauNeu('z', 0, -2));
  pruefe('A3d einen ganzen Bereich löschen → #BEZUG!', z3.cells.B1 === undefined && gleich(z3.cells, {}), z3.cells);
  const z4 = m.umbauAnwenden({ cells: { A1: '1', A2: '2', A3: '=SUMME(A1:A2)', C1: '=SUMME(A1:A2)', D1: '=SUMME(A:B)' }, rows: 4, cols: 4 }, m.umbauNeu('z', 2, -1));
  pruefe('A3e die Formelzeile selbst löschen nimmt nur sie weg; andere Formeln behalten A1:A2', gleich(z4.cells, { A1: '1', A2: '2', C1: '=SUMME(A1:A2)', D1: '=SUMME(A:B)' }), z4.cells);
  const s1 = m.umbauAnwenden(d0, m.umbauNeu('s', 0, 1));   // vor A eine Spalte
  pruefe('A3f Spalte vor A einfügen: =A2*2 → =B2*2, A:A → B:B, $A$3 → $B$3, Spaltenbreite/Filter/Sortierung wandern',
    s1.cells.C1 === '=B2*2' && s1.cells.C3 === '=SUMME(B:B)' && s1.cells.C2 === '=$B$3+B$1' && gleich(s1.colW, { C: 120 }) && gleich(s1.filter, { D: ['1'] }) && s1.sort.spalte === 'D' && s1.cols === 5 && gleich(s1.verbunden, ['B5:C5']), s1);
  const s2 = m.umbauAnwenden(d0, m.umbauNeu('s', 0, -1));   // Spalte A löschen
  pruefe('A3g Spalte A löschen: =A2*2 → =#BEZUG!*2, SUMME(A:A) → #BEZUG!, Zeilenbereiche bleiben, Filter auf C wird B',
    s2.cells.A1 === '=#BEZUG!*2' && s2.cells.A3 === '=SUMME(#BEZUG!)' && s2.cells.B1 === '=SUMME(2:3)' && gleich(s2.filter, { B: ['1'] }) && s2.colW?.A === 120 && s2.cols === 3, s2.cells);
  const t1 = m.bezuegeUmbauen('=A3&"A3"+SUMME(A1:A3)', { a: 'z', bei: 0, n: 2 });
  pruefe('A3h Text in "…" bleibt unberührt; mehrere Zeilen auf einmal', t1 === '=A5&"A3"+SUMME(A3:A5)', t1);

  // A4 Kopieren / Ausschneiden
  const v1 = m.bezuegeVerschieben('=A1+$B$1+B$2+$C3+SUMME(A1:B2)+SUMME(A:A)', 2, 1);
  const v2 = m.bezuegeVerschieben('=A1+$A1', -1, 0);
  const v3 = m.bezuegeVerschieben('=B2', 0, -2);
  pruefe('A4a Kopieren 2 Zeilen tiefer, 1 Spalte weiter: A1→B3, $B$1 fest, B$2→C$2, $C3→$C5, A1:B2→B3:C4, A:A→B:B',
    v1 === '=B3+$B$1+C$2+$C5+SUMME(B3:C4)+SUMME(B:B)', v1);
  pruefe('A4b über den Rand → #BEZUG! (nur der verschobene Teil; $A1 hält die Spalte, nicht die Zeile)', v2 === '=#BEZUG!+#BEZUG!' && v3 === '=#BEZUG!', [v2, v3]);
  const l1 = m.bezuegeVerlegen('=A1+A2+SUMME(A1:A2)+SUMME(A1:A3)+$A$1', { s0: 0, s1: 0, z0: 0, z1: 1 }, 0, 2);
  pruefe('A4c Ausschneiden A1:A2 → C1:C2: Bezüge darauf folgen (auch $), ein Bereich, der hinausragt, bleibt', l1 === '=C1+C2+SUMME(C1:C2)+SUMME(A1:A3)+$C$1', l1);

  // A5 Tabulator-Text wie aus Excel (CRLF, Umbruch und " in Zelle, Schluss-Umbruch)
  const tx = m.tsvLesen('Posten\tBetrag\r\n"Miete, ""warm"""\t1.234,50\r\n"zwei\nZeilen"\t\r\n');
  pruefe('A5a Excel-Text lesen: Anführungszeichen, "" und Zeilenumbruch in der Zelle, leere letzte Zelle, Schluss-Umbruch',
    gleich(tx, [['Posten', 'Betrag'], ['Miete, "warm"', '1.234,50'], ['zwei\nZeilen', '']]), tx);
  pruefe('A5b … und zurückschreiben ergibt dasselbe', gleich(m.tsvLesen(m.tsvSchreiben(tx)), tx), m.tsvSchreiben(tx));

  // A6 Abgleich zweier Geräte (dreiWegeMerge, wie Konto/Ordner/WebDAV)
  const karte = (data) => ({ id: 'k1', type: 'sheet', position: { x: 0, y: 0 }, data });
  const stand = (data) => ({ boards: [{ id: 'b1', name: 'B', nodes: [karte(data)], edges: [] }], spaces: [] });
  const misch = (b0, l, f) => { const e = m.dreiWegeMerge(stand(b0), stand(l), stand(f)); return { d: e.boards[0].nodes[0].data, k: e.bericht?.konflikte ?? 0, n: e.boards[0].nodes[0] }; };
  const basis = { title: 'T', rows: 6, cols: 4, cells: { A1: '10', A2: '20', A3: '30', A4: '=SUMME(A1:A3)', C3: 'x' } };
  const geraetA = { ...basis, ...m.umbauAnwenden(basis, m.umbauNeu('z', 2, 1)) };          // fügt vor Zeile 3 ein
  const geraetB = { ...basis, cells: { ...basis.cells, C3: 'neu', A3: '35' } };          // schreibt in Zeile 3
  const aufA = misch(basis, geraetA, geraetB), aufB = misch(basis, geraetB, geraetA);
  pruefe('A6a A fügt eine Zeile ein, B ändert gleichzeitig Zeile 3: auf beiden Geräten landet B\'s Änderung in Zeile 4, Summe =SUMME(A1:A4) = 65',
    gleich(aufA.d.cells, { A1: '10', A2: '20', A4: '35', A5: '=SUMME(A1:A4)', C4: 'neu' }) && gleich(aufA.d.cells, aufB.d.cells) && aufA.d.rows === 7 && aufB.d.rows === 7 && r(aufA.d.cells).A5 === '65' && aufA.k === 0 && aufB.k === 0,
    { a: aufA.d.cells, b: aufB.d.cells, k: [aufA.k, aufB.k] });
  const loeschA = { ...basis, ...m.umbauAnwenden(basis, m.umbauNeu('z', 2, -1)) };
  const schreibB = { ...basis, cells: { ...basis.cells, C3: 'weg?', A1: '11' } };
  const x1 = misch(basis, loeschA, schreibB), x2 = misch(basis, schreibB, loeschA);
  pruefe('A6b A löscht Zeile 3, B schreibt in Zeile 3 und A1: die Zeile bleibt gelöscht (wie Google Sheets), A1 = 11 kommt an, beide gleich',
    gleich(x1.d.cells, { A1: '11', A2: '20', A3: '=SUMME(A1:A2)' }) && gleich(x1.d.cells, x2.d.cells), [x1.d.cells, x2.d.cells]);
  const c1 = { ...basis, cells: { ...basis.cells, B1: 'eins' } }, c2 = { ...basis, cells: { ...basis.cells, B2: 'zwei' }, title: 'Neu' };
  const y1 = misch(basis, c1, c2);
  pruefe('A6c ohne Umbau: zwei Geräte in verschiedenen Zellen — beides bleibt (vorher galt „cells" als ein Feld: eine Änderung war weg)',
    y1.d.cells.B1 === 'eins' && y1.d.cells.B2 === 'zwei' && y1.d.title === 'Neu' && y1.k === 0, y1.d);
  const beide = misch(basis, geraetA, { ...basis, ...m.umbauAnwenden(basis, m.umbauNeu('s', 0, 1)) });
  pruefe('A6d beide bauen gleichzeitig um: die hiesige Fassung gilt, als Konflikt gemeldet (wie bisher bei „beide geändert")', gleich(beide.d.cells, geraetA.cells) && beide.k === 1, beide);
  // B hat A's Umbau schon übernommen und dann weitergeschrieben; A schreibt danach noch einmal
  const bNach = { ...geraetA, cells: { ...geraetA.cells, D1: 'b' } }, aNach = { ...geraetA, cells: { ...geraetA.cells, D2: 'a' } };
  const z5 = misch(basis, aNach, bNach);
  pruefe('A6e gemeinsamer Umbau (beide kennen ihn) + je eine Zelle: beides bleibt, der Umbau wird nicht doppelt angewendet',
    z5.d.cells.D1 === 'b' && z5.d.cells.D2 === 'a' && z5.d.cells.A5 === '=SUMME(A1:A4)' && z5.d.rows === 7 && z5.d.umbau.length === 1, z5.d);
  const nur = misch(basis, { ...basis, title: 'L' }, geraetA);
  pruefe('A6f hier nur der Titel, drüben ein Umbau: Umbau kommt an, Titel bleibt', nur.d.title === 'L' && nur.d.cells.A5 === '=SUMME(A1:A4)' && nur.d.rows === 7, nur.d);
  const lGleich = { ...basis, cells: { ...basis.cells, A1: '1' } };
  const e2 = misch(basis, lGleich, { ...lGleich, title: 'F' });
  pruefe('A6g unveränderte Felder bleiben die hiesigen Objekte (M524)', e2.d.cells === lGleich.cells && e2.d.title === 'F');

  // A7 Gestalt-Prüfung (M522): das Protokoll reist mit, kaputte Schritte fallen heraus
  const g = m.standVonAussen({ boards: [{ id: 'b1', name: 'B', nodes: [karte({ ...geraetA, umbau: [...geraetA.umbau, { id: 'x', a: 'q', bei: 1, n: 1 }, 'kaputt', { id: 'y', a: 'z', bei: -1, n: 1 }] })], edges: [] }], spaces: [] });
  const gu = g?.boards[0].nodes[0].data.umbau;
  pruefe('A7 Umbau-Protokoll von außen: gültige Schritte bleiben, ungültige fallen heraus', Array.isArray(gu) && gu.length === 1 && gu[0].id === geraetA.umbau[0].id, gu);
}

// ══ B: Browser ═══════════════════════════════════════════════════════
const app = http.createServer((q, r) => {
  const p = q.url.split('?')[0].split('#')[0];
  let f = path.join(DIST, p === '/' ? 'index.html' : p.slice(1));
  if (!existsSync(f) || statSync(f).isDirectory()) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.json': 'application/json' }[path.extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];
const brett = (id, nodes) => ({ id, name: 'Tabelle', nodes, edges: [], drawings: [], comments: [] });
const standMit = (boards) => ({ boards, spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: boards.map((b) => b.id) }] }], activeId: boards[0].id, view: 'board' });
const tabelle = (id, data, x = 80, y = 80) => ({ id, type: 'sheet', width: 620, height: 380, position: { x, y }, data: { title: 'Tabelle', cols: 4, rows: 6, ...data } });

async function profil(st, opt = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 1, locale: opt.en ? 'en-GB' : 'de-DE', timezoneId: 'Europe/Berlin' });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `http://localhost:${PORT}` });
  await ctx.addInitScript(({ st, en }) => {
    if (sessionStorage.getItem('x-init')) return;
    sessionStorage.setItem('x-init', '1');
    localStorage.setItem('pixinotes-onboarded', '1');
    if (en) localStorage.setItem('pixinotes-sprache', 'en');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, { st, en: !!opt.en });
  const P = await ctx.newPage();
  await P.clock.setFixedTime(new Date('2026-11-25T10:00:00+01:00'));
  P.on('pageerror', (e) => { fehler.push(e.message); console.log('    PAGEERROR:', e.message.slice(0, 300)); });
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForSelector('[data-zelle="A1"]', { timeout: 20000 });
  await P.evaluate(() => {
    window.__toasts = [];
    new MutationObserver(() => { const t = document.querySelector('.toast.show')?.textContent; if (t && window.__toasts.at(-1) !== t) window.__toasts.push(t); }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  });
  const karte = (id) => P.locator(`.react-flow__node[data-id="${id}"]`);
  /** Angezeigte Werte einer Tabelle (nur belegte Zellen) */
  const werte = (id = 'sh') => P.evaluate((id) => Object.fromEntries([...document.querySelectorAll(`.react-flow__node[data-id="${id}"] td[data-zelle]`)].map((t) => [t.dataset.zelle, t.textContent.trim()]).filter(([, v]) => v)), id);
  /** Die gespeicherten Daten der Karte — der Speicher schreibt verzögert, darum warten, bis `bis(daten)` zutrifft
   *  (höchstens 10 s; danach der letzte Stand, damit der Prüfpunkt ihn zeigt) */
  const zellen = async (bis = () => true, id = 'sh') => {
    let d = null;
    await warteBis(async () => {
      d = await P.evaluate((id) => { const t = localStorage.getItem('pixinotes-board'); if (!t) return null; const s = JSON.parse(t).state; return s.boards.find((b) => b.id === s.activeId)?.nodes.find((k) => k.id === id)?.data ?? null; }, id);
      return !!d && bis(d);
    }, 10000);
    return d;
  };
  const zelle = (adr, id = 'sh') => karte(id).locator(`td[data-zelle="${adr}"]`);
  const mitte = async (adr, id = 'sh') => { const b = await zelle(adr, id).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
  const ziehen = async (von, bis, id = 'sh') => {
    const [x0, y0] = await mitte(von, id); const [x1, y1] = await mitte(bis, id);
    await P.mouse.move(x0, y0); await P.mouse.down(); await P.mouse.move(x1, y1, { steps: 6 }); await P.mouse.up();
    await P.waitForFunction((id) => document.activeElement?.classList.contains('sheet-ablage') && document.activeElement.closest(`.react-flow__node[data-id="${id}"]`), id);
  };
  const toasts = () => P.evaluate(() => window.__toasts);
  return { ctx, P, karte, werte, zellen, zelle, mitte, ziehen, toasts };
}
const kopfZeile = (h, n, id = 'sh') => h.karte(id).locator('.sheet-zeilenkopf').nth(n - 1);
const kopfSpalte = (h, b, id = 'sh') => h.karte(id).locator(`thead th[data-spalte="${b}"]`);

/** Ein Abschnitt im Browser: bricht er ab (etwa gegen einen alten Build ohne diese Funktionen), wird das ein roter Prüfpunkt, kein Absturz */
async function abschnitt(fn) {
  try { await fn(); } catch (e) { pruefe('Abschnitt lief durch', false, String(e).split('\n')[0].slice(0, 200)); }
}
console.log('\n════ B: im Programm ════');
await abschnitt(async () => {
  const h = await profil(standMit([brett('b1', [tabelle('sh', { cells: { A1: 'Miete', B1: '1.234,50', A2: 'Strom', B2: '89,90', A3: 'Wasser', B3: '40', A4: 'Summe', B4: '=SUMME(B1:B3)', C1: '=B1*2', D1: '=B3' } })])]));
  const { P } = h;
  // B1 Zeile einfügen über den Zeilenkopf
  await kopfZeile(h, 3).click({ button: 'right' });
  const menue = await P.waitForSelector('[data-taste="sheet-umbau-menu"]', { timeout: 5000 }).then(() => true).catch(() => false);
  const texte = menue ? await P.locator('[data-taste="sheet-umbau-menu"] button').allInnerTexts() : [];
  pruefe('B1a Rechtsklick auf den Zeilenkopf öffnet das eigene Menü (nicht das Karten-Menü)', menue && gleich(texte.map((t) => t.trim()), ['Zeile oberhalb einfügen', 'Zeile unterhalb einfügen', 'Zeile löschen']) && !(await P.locator('.karten-menue, [data-taste="karten-menue"]').count()), texte);
  await P.screenshot({ path: path.join(BILDER, 'm528-menue.png') }).catch(() => {});
  if (menue) await P.locator('[data-taste="sheet-zeile-oben"]').click();
  await warteBis(async () => (await h.werte()).A4 === 'Wasser');
  let w = await h.werte();
  // 1.234,50 + 89,90 + 40 = 1.364,40; =B1*2 = 2.469; D1 =B3 → =B4 = 40
  pruefe('B1b Zeile über 3 eingefügt: Wasser rutscht nach 4, Summe steht in B5 und rechnet weiter 1.364,4, =B3 zeigt weiter 40',
    w.A4 === 'Wasser' && w.B5 === '1.364,4' && w.A3 === undefined && w.C1 === '2.469' && w.D1 === '40', w);
  await P.locator('.sheet-ablage').focus();
  await P.keyboard.type('7');   // Lostippen in der Auswahl (die neue Zeile 3, Anker A3)
  await P.keyboard.press('Enter');
  await warteBis(async () => (await h.werte()).B5 === '1.364,4' && (await h.werte()).A3 === '7');
  w = await h.werte();
  pruefe('B1c in die neue Zeile tippen: der Anker der Auswahl nimmt die Eingabe', w.A3 === '7', w);
  const d1 = await h.zellen((d) => d.cells.A3 === '7');
  pruefe('B1d gespeichert: =SUMME(B1:B4), =B4, Protokoll mit einem Schritt', d1?.cells.B5 === '=SUMME(B1:B4)' && d1?.cells.D1 === '=B4' && d1?.umbau?.length === 1, d1?.cells);
  await P.locator('.sheet-ablage').focus().catch(() => {});
  await P.keyboard.press('Escape');
  await P.mouse.click(1400, 800);
  await P.keyboard.press('Control+z');   // die Eingabe „7"
  await P.keyboard.press('Control+z');   // das Einfügen
  await warteBis(async () => (await h.werte()).A3 === 'Wasser');
  w = await h.werte();
  pruefe('B1e Strg+Z (zweimal: Eingabe, Einfügen) stellt alles her — das Einfügen ist EIN Schritt', w.A3 === 'Wasser' && w.B4 === '1.364,4' && w.D1 === '40' && w.A4 === 'Summe', w);
  await P.keyboard.press('Control+y');
  await warteBis(async () => (await h.werte()).A4 === 'Wasser');
  pruefe('B1f Strg+Y bringt die Zeile wieder', (await h.werte()).A4 === 'Wasser', await h.werte());
  await P.keyboard.press('Control+z');
  await warteBis(async () => (await h.werte()).A3 === 'Wasser');

  // B2 Spalte B löschen über den Spaltenkopf
  await kopfSpalte(h, 'B').click({ button: 'right' });
  await P.locator('[data-taste="sheet-spalte-weg"]').click();
  await warteBis(async () => (await h.werte()).B1 === '#BEZUG!');
  w = await h.werte();
  const t2 = await h.toasts();
  pruefe('B2a Spalte B gelöscht: =B1*2 wird #BEZUG!, C rückt nach B, ein Hinweis mit „Rückgängig"',
    w.B1 === '#BEZUG!' && w.C1 === '#BEZUG!' && w.A1 === 'Miete' && t2.some((t) => /Gelöscht: 1 Spalte/.test(t)), { w, t2 });
  const d2 = await h.zellen((d) => d.cols === 3);
  pruefe('B2b in der Formel steht #BEZUG! (=#BEZUG!*2), die Tabelle hat 3 Spalten', d2?.cells.B1 === '=#BEZUG!*2' && d2?.cols === 3, d2);
  await P.keyboard.press('Control+z');
  await warteBis(async () => (await h.werte()).C1 === '2.469');

  // B3 mehrere Zeilen auf einmal: Zeilenköpfe 1–2 wählen, Rechtsklick → „2 Zeilen oberhalb einfügen"
  await kopfZeile(h, 1).click();
  await kopfZeile(h, 2).click({ modifiers: ['Shift'] });
  await kopfZeile(h, 2).click({ button: 'right' });
  const t3 = (await P.locator('[data-taste="sheet-zeile-oben"]').innerText()).trim();
  await P.locator('[data-taste="sheet-zeile-oben"]').click();
  await warteBis(async () => (await h.werte()).A3 === 'Miete');
  w = await h.werte();
  pruefe('B3 zwei Zeilen gewählt → „2 Zeilen oberhalb einfügen": alles rutscht um 2, Summe in B6', t3 === '2 Zeilen oberhalb einfügen' && w.A3 === 'Miete' && w.B6 === '1.364,4' && w.C3 === '2.469', { t3, w });
  await P.keyboard.press('Control+z');
  await warteBis(async () => (await h.werte()).A1 === 'Miete');

  // B4 Bereich ziehen, Strg+C, woanders Strg+V
  await h.ziehen('A1', 'C2');
  const gew = await P.evaluate(() => [...document.querySelectorAll('td.gewaehlt')].map((t) => t.dataset.zelle));
  pruefe('B4a Ziehen wählt A1:C2 (sechs Zellen), keine Zelle geht in Bearbeitung', gleich(gew.sort(), ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']) && !(await P.locator('.sheet-eingabe').count()), gew);
  await P.keyboard.press('Control+c');
  const clip = await P.evaluate(() => navigator.clipboard.readText());
  pruefe('B4b Strg+C legt den sichtbaren Text als Tabulator-Text ab (für Excel & Co.): 1.234,5 und 2.469 wie in der Zelle', clip === 'Miete\t1.234,5\t2.469\nStrom\t89,9\t', JSON.stringify(clip));
  await h.zelle('B5').click();
  await P.keyboard.press('Escape');
  await P.keyboard.press('Control+v');
  await warteBis(async () => (await h.werte()).B5 === 'Miete');
  const d4 = await h.zellen((d) => !!d.cells.B5);
  w = await h.werte();
  // C1 =B1*2 nach D5 kopiert → =C5*2 = 1.234,5 · 2 = 2.469
  pruefe('B4c Strg+V an B5: Werte und Formel kommen an, =B1*2 wird =C5*2 (relativ) und rechnet 2.469; die Tabelle wächst um eine Zeile',
    d4?.cells.B5 === 'Miete' && d4?.cells.C5 === '1.234,50' && d4?.cells.D5 === '=C5*2' && w.D5 === '2.469' && d4?.rows === 6 && d4?.cells.B6 === 'Strom', d4?.cells);
  await P.keyboard.press('Control+z');
  await warteBis(async () => !(await h.werte()).B5);
  pruefe('B4d Strg+Z nimmt das ganze Einfügen in einem Schritt zurück', !(await h.werte()).B5 && !(await h.werte()).D5, await h.werte());

  // B5 aus „Excel" einfügen — größer als die Tabelle: sie wächst
  await P.evaluate(() => navigator.clipboard.writeText('Nr\tMonat\tDatum\tBetrag\tFällig\r\n1\tJan\t24.12.2026\t1.000,00\t"=C7+14"\r\n2\tFeb\t"mit ""Zitat"""\t2.000,00\t\r\n'));
  await h.zelle('A6').click();
  await P.keyboard.press('Escape');
  await P.keyboard.press('Control+v');
  await warteBis(async () => (await h.werte()).E6 === 'Fällig');
  const d5 = await h.zellen((d) => !!d.cells.A6);
  w = await h.werte();
  pruefe('B5 Tabulator-Text aus Excel an A6: drei Zeilen, fünf Spalten — die Tabelle wächst auf 8 Zeilen und 5 Spalten, "" wird ", =C7+14 rechnet mit dem Datum: 24.12.2026 + 14 = 07.01.2027',
    d5?.rows === 8 && d5?.cols === 5 && d5?.cells.C8 === 'mit "Zitat"' && d5?.cells.D7 === '1.000,00' && w.E7 === '07.01.2027' && d5?.cells.C7 === '24.12.2026', { rows: d5?.rows, cols: d5?.cols, w });
  await P.keyboard.press('Control+z');
  await warteBis(async () => !(await h.werte()).A6);

  // B6 Ausschneiden: B1:B2 nach D1, Bezüge folgen
  await h.ziehen('B1', 'B2');
  await P.keyboard.press('Control+x');
  const gestrichelt = await P.evaluate(() => [...document.querySelectorAll('td.ausgeschnitten')].map((t) => t.dataset.zelle));
  await P.screenshot({ path: path.join(BILDER, 'm528-ausschneiden.png') }).catch(() => {});
  await h.zelle('D3').click(); await P.keyboard.press('Escape');
  await P.keyboard.press('Control+v');
  await warteBis(async () => (await h.werte()).D3 === '1.234,5');
  const d6 = await h.zellen((d) => !!d.cells.D3);
  w = await h.werte();
  pruefe('B6 Ausschneiden B1:B2 → D3:D4: Quelle leer, =B1*2 folgt zu =D3*2, =SUMME(B1:B3) bleibt (Bereich ragt hinaus), gestrichelt bis zum Einfügen',
    gleich(gestrichelt, ['B1', 'B2']) && !d6?.cells.B1 && !d6?.cells.B2 && d6?.cells.D3 === '1.234,50' && d6?.cells.C1 === '=D3*2' && w.C1 === '2.469' && d6?.cells.B4 === '=SUMME(B1:B3)' && !(await P.locator('td.ausgeschnitten').count()),
    { gestrichelt, cells: d6?.cells });
  await P.keyboard.press('Control+z');
  await warteBis(async () => (await h.werte()).B1 === '1.234,50');

  // B7 Entf, Umschalt+Klick, Kopf wählt Spalte
  await h.zelle('A1').click(); await P.keyboard.press('Escape');
  await h.zelle('A2').click({ modifiers: ['Shift'] });
  const gew7 = await P.evaluate(() => [...document.querySelectorAll('td.gewaehlt')].map((t) => t.dataset.zelle));
  await P.keyboard.press('Delete');
  await warteBis(async () => !(await h.werte()).A1);
  pruefe('B7a Umschalt+Klick erweitert (A1:A2), Entf leert beide in einem Schritt', gleich(gew7, ['A1', 'A2']) && !(await h.werte()).A1 && !(await h.werte()).A2, gew7);
  await P.keyboard.press('Control+z');
  await warteBis(async () => (await h.werte()).A1 === 'Miete');
  await kopfSpalte(h, 'B').click();
  const gew7b = await P.evaluate(() => [...document.querySelectorAll('td.gewaehlt')].map((t) => t.dataset.zelle));
  pruefe('B7b Klick auf den Spaltenkopf wählt die ganze Spalte (6 Zellen), der Fuß nennt den Bereich', gew7b.length === 6 && gew7b.every((a) => a.startsWith('B')) && (await P.locator('[data-taste="sheet-auswahl-stand"]').innerText()).startsWith('B1:B6'), gew7b);
  await P.keyboard.press('ArrowDown');
  const anker = await P.evaluate(() => document.querySelector('td.anker')?.dataset.zelle);
  pruefe('B7c Pfeiltaste bewegt die Auswahl', anker === 'B2', anker);
  await h.zelle('A3').click();
  await P.keyboard.type('xyz');
  await P.keyboard.press('Escape');
  await P.keyboard.press('ArrowRight');
  const nachEsc = await h.werte();
  pruefe('B7d Esc im Bearbeiten verwirft das Getippte; danach führt die Tastatur die Auswahl weiter (A3 → B3)',
    nachEsc.A3 === 'Wasser' && (await P.evaluate(() => document.querySelector('td.anker')?.dataset.zelle)) === 'B3', nachEsc);
  await h.ctx.close();
});
await abschnitt(async () => {
  // B8 Datum und ganze Spalten in der Karte (Uhr: 25.11.2026)
  const h = await profil(standMit([brett('b2', [tabelle('sh', { cells: { A1: '10', A2: '20', A3: '30', B1: '=SUMME(A:A)', B2: '=MITTELWERT(A:A)', C1: '=HEUTE()+1', C2: '=DATUM(2026;12;24)-HEUTE()', C3: '24.12.2026', C4: '=C3+7', D1: '=SUMME(D:D)' } })])]));
  const w = await h.werte();
  pruefe('B8a =HEUTE()+1 zeigt 26.11.2026 (rechtsbündig), 24.12. − heute = 29 Tage, 24.12. + 7 = 31.12.2026',
    w.C1 === '26.11.2026' && w.C2 === '29' && w.C4 === '31.12.2026' && (await h.zelle('C1').evaluate((t) => getComputedStyle(t).textAlign)) === 'right', w);
  pruefe('B8b =SUMME(A:A) 60 · =MITTELWERT(A:A) 20 · Formel in der eigenen Spalte → #ZYKLUS!', w.B1 === '60' && w.B2 === '20' && w.D1 === '#ZYKLUS!', w);
  await h.zelle('A4').click();
  await h.P.keyboard.type('40'); await h.P.keyboard.press('Enter');
  await warteBis(async () => (await h.werte()).B1 === '100');
  pruefe('B8c eine neue Zahl in Spalte A zählt sofort mit: 100 · Mittelwert 25', (await h.werte()).B1 === '100' && (await h.werte()).B2 === '25', await h.werte());
  await h.P.screenshot({ path: path.join(BILDER, 'm528-datum.png') }).catch(() => {});
  await h.ctx.close();
});
await abschnitt(async () => {
  // B9 Englisch
  const h = await profil(standMit([brett('b3', [tabelle('sh', { cells: { A1: '10', B1: '=A1*2', C1: '=TODAY()+1', C2: '=SUM(A:A)' } })])]), { en: true });
  await warteBis(async () => (await h.werte()).C1 === '26/11/2026');
  await kopfSpalte(h, 'A').click({ button: 'right' });
  await h.P.waitForSelector('[data-taste="sheet-umbau-menu"]');
  const texte = (await h.P.locator('[data-taste="sheet-umbau-menu"] button').allInnerTexts()).map((t) => t.trim());
  await h.P.locator('[data-taste="sheet-spalte-weg"]').click();
  await warteBis(async () => (await h.werte()).A1 === '#REF!');
  const w = await h.werte(); const d = await h.zellen((x) => x.cols === 2);
  pruefe('B9 Englisch: Datum 26/11/2026, Menü „Insert column left …", gelöschter Bezug zeigt #REF! (in der Formel ebenso)',
    gleich(texte, ['Insert column left', 'Insert column right', 'Delete column']) && w.A1 === '#REF!' && d?.cells.A1 === '=#REF!*2' && w.B1 === '26/11/2026', { texte, w, f: d?.cells.A1 });
  await h.P.screenshot({ path: path.join(BILDER, 'm528-englisch.png') }).catch(() => {});
  await h.ctx.close();
});
await abschnitt(async () => {
  // B10 Grenze 26 Spalten: Einfügen nur, wenn hinten Platz ist
  const voll = {}; for (let s = 0; s < 26; s += 1) voll[`${String.fromCharCode(65 + s)}1`] = String(s);
  const h = await profil(standMit([brett('b4', [tabelle('sh', { cols: 26, cells: voll })])]));
  await kopfSpalte(h, 'B').click({ button: 'right' });
  await h.P.locator('[data-taste="sheet-spalte-links"]').click();
  await warteBis(async () => (await h.toasts()).length > 0, 4000);
  const t = await h.toasts(); const d = await h.zellen();
  pruefe('B10a 26 volle Spalten: Einfügen sagt, dass nicht mehr passt, und ändert nichts', t.some((x) => /26 Spalten/.test(x)) && d?.cells.B1 === '1' && d?.cols === 26, t);
  await h.zelle('A2').click(); await h.P.keyboard.press('Escape');
  await h.P.evaluate(() => navigator.clipboard.writeText('a\tb\tc'));
  await h.zelle('Y2').click(); await h.P.keyboard.press('Escape');
  await h.P.keyboard.press('Control+v');
  await warteBis(async () => (await h.toasts()).length > 1, 4000);
  const d2 = await h.zellen((x) => !!x.cells.Y2); const t2 = await h.toasts();
  pruefe('B10b drei Werte ab Y2 einfügen: Y2 und Z2 kommen an, der Rest wird mit Hinweis weggelassen', d2?.cells.Y2 === 'a' && d2?.cells.Z2 === 'b' && d2?.cols === 26 && t2.some((x) => /höchstens 26 Spalten/.test(x)), { c: d2?.cells, t2 });
  await h.ctx.close();
});

pruefe('Z keine Seitenfehler', fehler.length === 0, fehler);
await browser.close();
app.close();
console.log(`\n${ok} grün, ${bad} rot`);
process.exit(bad ? 1 : 0);
