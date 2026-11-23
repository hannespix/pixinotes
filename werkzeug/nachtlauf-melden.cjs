// M468: Auswertung des nächtlichen Laufs aller Prüfreihen (.github/workflows/nachtlauf.yml).
//
// Läuft über actions/github-script:
//   const melden = require('./werkzeug/nachtlauf-melden.cjs');
//   await melden({ github, context, core, datei: 'nachtlauf-ergebnis.json', bau: '…', lauf: '…', laufUrl: '…' });
//
// Schreibt die Zusammenfassung (grün/rot je Reihe, Dauer) in $GITHUB_STEP_SUMMARY und hält GENAU EIN Issue
// „Nachtlauf rot" (Label `nachtlauf`) aktuell: rot → anlegen bzw. Text erneuern und kommentieren, grün → schließen.
// So sieht der Orchestrator morgens an einer Stelle, was zu tun ist (docs/AGENTEN.md, „Nachtlauf").
// CommonJS (.cjs), weil github-script `require` nutzt und package.json "type": "module" setzt.
const fs = require('node:fs');

const TITEL = 'Nachtlauf rot';
const LABEL = 'nachtlauf';

const dauer = (sek) => `${Math.floor(sek / 60)}:${String(sek % 60).padStart(2, '0')}`;
const zelle = (t) => String(t ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/** Ergebnis lesen und bewerten – ohne GitHub, damit es sich lokal prüfen lässt */
function auswerten({ datei, bau = 'success', lauf = 'success' }) {
  let stand = null;
  try { stand = JSON.parse(fs.readFileSync(datei, 'utf-8')); } catch { /* fehlt: Bau oder Läufer abgebrochen */ }
  const reihen = stand?.reihen ?? [];
  const rot = reihen.filter((r) => r.rot);
  const wackler = reihen.filter((r) => !r.rot && r.wiederholt);
  const gruen = reihen.filter((r) => !r.rot);
  const gruende = [];
  if (bau !== 'success') gruende.push(`App nicht gebaut (Schritt „Bauen": ${bau}) – Installation, Browser oder Build fehlgeschlagen`);
  else if (!stand) gruende.push('kein Ergebnis – der Läufer ist nicht gestartet oder abgebrochen');
  else if (!stand.fertig) gruende.push(`Lauf abgebrochen (Zeitlimit?) nach ${reihen.length} von ${stand.gesamt} Reihen (Schritt „Prüfreihen": ${lauf})`);
  if (rot.length) gruende.push(`${rot.length} ${rot.length === 1 ? 'Reihe' : 'Reihen'} rot`);
  return { stand, reihen, rot, wackler, gruen, gruende, problem: gruende.length > 0 };
}

function zusammenfassung(a, laufUrl) {
  const z = [];
  const s = a.stand;
  z.push(`## Nachtlauf: ${a.problem ? 'rot' : 'grün'}`);
  z.push('');
  if (s) z.push(`${a.gruen.length} von ${s.gesamt} Reihen grün · ${a.wackler.length} erst beim zweiten Mal · ${s.minuten} min bei ${s.bahnen} Bahnen${s.ausgelassen?.length ? ` · ausgelassen (braucht Datenbank): ${s.ausgelassen.join(', ')}` : ''}`);
  for (const g of a.gruende) z.push(`- ${g}`);
  if (laufUrl) z.push('', `Lauf: ${laufUrl}`);
  if (a.rot.length) {
    z.push('', '### Rot', '', '| Reihe | Dauer | Stand | Erste Fehlerzeilen |', '|---|---|---|---|');
    for (const r of a.rot) z.push(`| ${r.reihe} | ${dauer(r.sek)} | ${zelle(r.summe || `rc=${r.rc}`)} | ${zelle((r.fehler ?? []).slice(0, 3).join(' · '))} |`);
  }
  if (a.wackler.length) {
    z.push('', '### Erst beim zweiten Lauf grün (Wackler)', '', '| Reihe | Dauer | Erster Lauf |', '|---|---|---|');
    for (const r of a.wackler) z.push(`| ${r.reihe} | ${dauer(r.sek)} | ${zelle((r.fehler ?? []).slice(0, 2).join(' · '))} |`);
  }
  if (a.reihen.length) {
    z.push('', '<details><summary>Alle Reihen</summary>', '', '| Reihe | Ergebnis | Dauer | Stand |', '|---|---|---|---|');
    for (const r of [...a.reihen].sort((x, y) => x.reihe.localeCompare(y.reihe))) {
      z.push(`| ${r.reihe} | ${r.rot ? 'rot' : r.wiederholt ? 'grün (2. Lauf)' : 'grün'} | ${dauer(r.sek)} | ${zelle(r.summe)} |`);
    }
    z.push('', '</details>');
  }
  return z.join('\n');
}

function issueText(a, laufUrl) {
  const z = [
    'Der nächtliche Lauf aller Prüfreihen (`.github/workflows/nachtlauf.yml`, M468) ist rot.',
    'Dieses Issue wird bei jedem roten Lauf erneuert und beim nächsten grünen Lauf geschlossen.',
    '',
    `Letzter Lauf: ${laufUrl} (${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC)`,
    '',
    ...a.gruende.map((g) => `- ${g}`),
  ];
  if (a.rot.length) {
    z.push('', '**Rote Reihen** (auch allein wiederholt rot):', '');
    for (const r of a.rot) {
      z.push(`- [ ] \`${r.reihe}\` – ${r.summe || `rc=${r.rc}`}`);
      for (const f of (r.fehler ?? []).slice(0, 4)) z.push(`  - \`${f.trim().replace(/`/g, "'").slice(0, 200)}\``);
    }
  }
  if (a.wackler.length) z.push('', `Wackler (erst beim zweiten Mal grün): ${a.wackler.map((r) => `\`${r.reihe}\``).join(', ')}`);
  z.push('', 'Lokal nachstellen: `npm run build && node werkzeug/alle-pruefungen.mjs <reihe>`; Bericht als Artefakt am Lauf.');
  return z.join('\n');
}

async function labelSicherstellen(github, owner, repo) {
  try { await github.rest.issues.getLabel({ owner, repo, name: LABEL }); } catch (e) {
    if (e.status !== 404) throw e;
    await github.rest.issues.createLabel({ owner, repo, name: LABEL, color: 'b60205', description: 'Nächtlicher Lauf aller Prüfreihen (M468)' });
  }
}

module.exports = async function melden({ github, context, core, datei = 'nachtlauf-ergebnis.json', bau, lauf, laufUrl, teilauswahl = '' }) {
  const a = auswerten({ datei, bau, lauf });
  await core.summary.addRaw(zusammenfassung(a, laufUrl)).write();
  // Ein Hand-Lauf über eine Teilauswahl sagt nichts über die ganze Reihe – er darf das Issue weder öffnen noch schließen
  if (teilauswahl.trim()) {
    core.info(`Teilauswahl „${teilauswahl.trim()}" – Issue „${TITEL}" bleibt unberührt`);
    if (a.problem) core.setFailed(`Teilauswahl rot: ${a.gruende.join(' · ')}`);
    return a;
  }
  const { owner, repo } = context.repo;
  const offene = await github.paginate(github.rest.issues.listForRepo, { owner, repo, state: 'open', labels: LABEL, per_page: 100 });
  const vorhanden = offene.find((i) => i.title === TITEL && !i.pull_request);
  if (a.problem) {
    await labelSicherstellen(github, owner, repo);
    const body = issueText(a, laufUrl);
    const kurz = `Lauf ${laufUrl}: ${a.gruende.join(' · ')}${a.rot.length ? ` – ${a.rot.map((r) => r.reihe).join(', ')}` : ''}`;
    if (vorhanden) {
      await github.rest.issues.update({ owner, repo, issue_number: vorhanden.number, body });
      await github.rest.issues.createComment({ owner, repo, issue_number: vorhanden.number, body: `Weiter rot. ${kurz}` });
      core.info(`Issue #${vorhanden.number} „${TITEL}" erneuert`);
    } else {
      const neu = await github.rest.issues.create({ owner, repo, title: TITEL, body, labels: [LABEL] });
      core.info(`Issue #${neu.data.number} „${TITEL}" angelegt`);
    }
    core.setFailed(`Nachtlauf rot: ${a.gruende.join(' · ')}`);
  } else if (vorhanden) {
    await github.rest.issues.createComment({ owner, repo, issue_number: vorhanden.number, body: `Wieder grün: ${laufUrl} – ${a.gruen.length} von ${a.stand.gesamt} Reihen.` });
    await github.rest.issues.update({ owner, repo, issue_number: vorhanden.number, state: 'closed', state_reason: 'completed' });
    core.info(`Issue #${vorhanden.number} „${TITEL}" geschlossen`);
  }
  return a;
};
module.exports.auswerten = auswerten;
module.exports.zusammenfassung = zusammenfassung;
module.exports.issueText = issueText;
