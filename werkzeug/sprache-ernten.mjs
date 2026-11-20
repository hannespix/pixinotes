// M381: Erntet alle Texte der Oberfläche aus dem Quelltext — die Grundlage des englischen Wörterbuchs
// (src/sprache/en.json) und der Prüfung, dass kein neuer Text ohne Übersetzung bleibt.
//
//   node werkzeug/sprache-ernten.mjs            → schreibt werkzeug/ernte.json (alle Texte mit Fundstelle)
//   node werkzeug/sprache-ernten.mjs --fehlend  → listet, was im Wörterbuch fehlt (Rückgabewert 1, wenn etwas fehlt)
//
// Geerntet wird, was ein Mensch zu lesen bekommt:
//   · Text zwischen Tags (JSX-Text)
//   · Texte in Attributen (title, aria-label, placeholder, eigene Text-Eigenschaften …)
//   · Texte in Ausdrücken innerhalb von JSX ({bedingung ? 'A' : 'B'})
//   · Texte an bekannten Ausgängen (showToast, confirm, prompt, alert, Error …) und in Beschriftungs-Feldern
//     von Objekten (label, hint, title, name, text …)
// Vorlagen mit Einsetzungen (`Board „${name}" angelegt.`) werden zu Mustern mit {0}, {1} …
import ts from 'typescript';
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const SRC = path.join(repo, 'src');
/** Dateien, deren Texte nie in der Oberfläche erscheinen (Anweisungen an die KI, Beispiel-Inhalte, die Hilfe hat ihre eigene Fassung) */
const OHNE = [/lib\/ai\.ts$/, /lib\/aiActions\.ts$/, /lib\/kiAnweisung\.ts$/, /lib\/kiModule\.ts$/, /lib\/starter\.ts$/, /lib\/ollama\.ts$/, /components\/HelpOverlayEn\.tsx$/, /sprache\//, /lib\/sprache\.ts$/, /lib\/mermaidTemplates\.ts$/, /lib\/mermaidEdit\.ts$/, /lib\/serialize\.ts$/, /lib\/brain\.ts$/, /lib\/recherche\.ts$/];
const KEIN_TEXT_ATTR = new Set(['className', 'class', 'id', 'key', 'type', 'role', 'href', 'src', 'style', 'translate', 'lang', 'dir', 'd', 'viewBox', 'fill', 'stroke', 'xmlns', 'target', 'rel', 'htmlFor', 'method', 'autoComplete', 'inputMode', 'accept', 'value', 'defaultValue', 'name', 'points', 'transform', 'strokeWidth', 'strokeLinecap', 'strokeLinejoin', 'strokeDasharray', 'x', 'y', 'cx', 'cy', 'r', 'rx', 'ry', 'x1', 'x2', 'y1', 'y2', 'width', 'height', 'min', 'max', 'step', 'pattern', 'enterKeyHint', 'spellCheck', 'tabIndex', 'loading', 'sandbox', 'allow', 'referrerPolicy', 'crossOrigin', 'klasse', 'theme', 'position', 'side', 'variant', 'size', 'color', 'mode', 'kind', 'art', 'taste', 'slot', 'as', 'list', 'form', 'wrap', 'capture', 'download', 'media', 'sizes', 'srcSet', 'charSet', 'content', 'property', 'scope', 'headers', 'shape', 'coords', 'useMap', 'align', 'valign', 'char', 'charoff', 'preserveAspectRatio', 'markerEnd', 'markerStart', 'clipPath', 'mask', 'filter', 'opacity', 'fontFamily', 'fontSize', 'textAnchor', 'dominantBaseline']);
const AUSGAENGE = new Set(['t', 'h', 'li', 'nr', 'haken', 'notiz', 'rahmen', 'kanban', 'bubbles', 'protokoll', 'woche', 'zeitplan', 'feld', 'spalte', 'nextName', 'showToast', 'confirm', 'prompt', 'alert', 'Error', 'setFehler', 'setError', 'setStatus', 'setBusy', 'setMeldung', 'setHinweis', 'toast', 'melde', 'meldung', 'fehler', 'hinweis', 'setInfo', 'setMsg', 'setNotice']);
const KEIN_TEXT_FELD = new Set(['id', 'key', 'type', 'kind', 'className', 'class', 'icon', 'color', 'farbe', 'shape', 'code', 'src', 'href', 'url', 'path', 'pfad', 'selector', 'query', 'regex', 'pattern', 'format', 'font', 'fontFamily', 'style', 'role', 'content', 'prompt', 'system', 'model', 'mime', 'ext', 'accept', 'lang', 'locale', 'event', 'ereignis', 'method', 'mode', 'value', 'wert', 'data', 'blocks']);
const TEXT_FELDER = new Set(['suchwort', 'hinweis', 'subtext', 'label', 'hint', 'title', 'titel', 'name', 'text', 'beschreibung', 'kurz', 'tip', 'tooltip', 'placeholder', 'was', 'frage', 'info', 'desc', 'description', 'caption', 'heading', 'kopf', 'aria', 'ariaLabel', 'short', 'long', 'empty', 'leer', 'hilfe', 'help', 'unit', 'einheit', 'suffix', 'prefix', 'gruppe', 'group', 'alias', 'sub', 'detail', 'note', 'fuss', 'summary', 'message', 'msg', 'error', 'warnung', 'ok', 'cancel', 'yes', 'no', 'ja', 'nein', 'button', 'knopf', 'aktion', 'action']);

/** Sieht die Zeichenkette nach Text für Menschen aus (und nicht nach Klassenname, Schlüssel, Pfad)? */
export function istText(s) {
  const t = s.trim();
  if (t.length < 2 || t.length > 600) return false;
  if (/<\/?[a-z][^>]*>/i.test(t)) return false;   // HTML für den Export — erscheint nie als ein Textknoten
  if (!/[A-Za-zÄÖÜäöüß]{2}/.test(t)) return false;
  if (/^(https?:|data:|blob:|mailto:|\.\/|\.\.\/|\/|#[0-9a-f]{3,8}$)/i.test(t)) return false;
  if (/^[a-z0-9_.:\-/#[\]="'()>+~*, ]+$/.test(t) && !/ [a-zäöü]{3,} [a-zäöü]{3,}/.test(t)) return false;   // css, schlüssel, selektoren
  if (/^[A-Za-z0-9_$]+$/.test(t) && !/^[A-ZÄÖÜ][a-zäöüß]+$/.test(t) && !/[äöüßÄÖÜ]/.test(t)) return false;   // bezeichner (aber: „Speichern")
  if (/^[A-Z0-9_]+$/.test(t)) return false;
  if (/^(rgba?|hsla?|calc|var|translate|scale|rotate|url)\(/.test(t)) return false;
  return true;
}
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', bdquo: '„', ldquo: '“', rdquo: '”', times: '×', middot: '·', rarr: '→', larr: '←' };
const entities = (s) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENT[e] ?? m));

function dateien(dir, aus = []) {
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) dateien(p, aus);
    else if (/\.tsx?$/.test(n) && !/\.d\.ts$/.test(n)) aus.push(p);
  }
  return aus;
}

export function ernten() {
  /** Text → { de, muster, stellen: [datei:zeile], art } */
  const funde = new Map();
  const merke = (de, muster, sf, node, art) => {
    const k = norm(de);
    // Text zwischen Tags ist immer für Menschen — auch ein einzelnes kleines Wort („nicht", „und der")
    if (art === 'text' || art === 'ausdruck' ? !/[A-Za-zÄÖÜäöüß]{2}/.test(muster ? k.replace(/\{\d+\}/g, '') : k) || /<\/?[a-z][^>]*>/i.test(k) : !(muster ? /[A-Za-zÄÖÜäöüß]{3}/.test(k.replace(/\{\d+\}/g, '')) && istText(k.replace(/\{\d+\}/g, ' Xx ').trim()) : istText(k))) return;
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    const stelle = `${path.relative(repo, sf.fileName)}:${line + 1}`;
    const f = funde.get(k) ?? { de: k, muster, stellen: [], art };
    if (f.stellen.length < 3 && !f.stellen.includes(stelle)) f.stellen.push(stelle);
    if (!f.kontext) f.kontext = norm(node.parent?.getText(sf) ?? '').slice(0, 220);
    funde.set(k, f);
  };
  /** Zeichenkette oder Vorlage → Text (bei Einsetzungen als Muster) */
  const ausAusdruck = (n, sf, art) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) merke(n.text, false, sf, n, art);
    else if (ts.isTemplateExpression(n)) {
      let s = n.head.text; let i = 0;
      for (const sp of n.templateSpans) { s += `{${i++}}` + sp.literal.text; }
      merke(s, true, sf, n, art);
      for (const sp of n.templateSpans) tief(sp.expression, sf, art);   // Texte in den Einsetzungen selbst
    }
  };
  /** Alle Zeichenketten in einem Ausdruck (Bedingungen, Verknüpfungen, Aufrufe …) */
  const tief = (n, sf, art) => {
    if (!n) return;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n)) { ausAusdruck(n, sf, art); return; }
    if (ts.isJsxElement(n) || ts.isJsxFragment(n) || ts.isJsxSelfClosingElement(n)) return;   // eigene Regeln
    if (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) { if (!ts.isBlock(n.body)) tief(n.body, sf, art); return; }
    if (ts.isCallExpression(n)) {
      // Zeichenketten als Argumente gewöhnlicher Aufrufe sind meist Schlüssel (classList.add, includes …) — nur die Ausgänge zählen
      const name = ts.isIdentifier(n.expression) ? n.expression.text : ts.isPropertyAccessExpression(n.expression) ? n.expression.name.text : '';
      if (AUSGAENGE.has(name)) n.arguments.forEach((a) => tief(a, sf, art));
      return;
    }
    if (ts.isBinaryExpression(n) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(n.operatorToken.kind)) return;   // Vergleiche mit Schlüsseln
    if (ts.isElementAccessExpression(n) || ts.isPropertyAccessExpression(n)) return;
    ts.forEachChild(n, (c) => tief(c, sf, art));
  };
  for (const datei of dateien(SRC)) {
    const rel = path.relative(repo, datei).replace(/\\/g, '/');
    if (OHNE.some((r) => r.test(rel))) continue;
    const sf = ts.createSourceFile(datei, readFileSync(datei, 'utf-8'), ts.ScriptTarget.Latest, true, datei.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    /** Bereiche, die nicht übersetzt werden (data-sprache="aus") */
    const aus = (n) => (ts.isJsxElement(n) ? n.openingElement : ts.isJsxSelfClosingElement(n) ? n : null)?.attributes.properties.some((a) => ts.isJsxAttribute(a) && ((a.name.getText(sf) === 'data-sprache' && a.initializer && ts.isStringLiteral(a.initializer) && a.initializer.text === 'aus')));
    const geh = (n) => {
      if (aus(n)) return;
      if (ts.isJsxText(n)) { const t = entities(n.text); if (t.trim()) merke(t, false, sf, n, 'text'); }
      else if (ts.isJsxAttribute(n)) {
        const name = n.name.getText(sf);
        if (!KEIN_TEXT_ATTR.has(name) && !name.startsWith('data-') && !/^on[A-Z]/.test(name) && n.initializer) {
          if (ts.isStringLiteral(n.initializer)) merke(entities(n.initializer.text), false, sf, n.initializer, `attr:${name}`);
          else if (ts.isJsxExpression(n.initializer) && n.initializer.expression) tief(n.initializer.expression, sf, `attr:${name}`);
        }
      } else if (ts.isJsxExpression(n) && n.expression && (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent))) tief(n.expression, sf, 'ausdruck');
      else if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
        const e = n.expression;
        const name = ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : '';
        if (AUSGAENGE.has(name)) (n.arguments ?? []).forEach((a) => tief(a, sf, `aufruf:${name}`));
      } else if (ts.isPropertyAssignment(n) && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name)) && TEXT_FELDER.has(n.name.text)) tief(n.initializer, sf, `feld:${n.name.text}`);
      // Andere Felder (hinweis: '…', process: 'Schritt (Rechteck)', 'aria-label': '…'): nur, was eindeutig deutscher Text ist
      else if (ts.isPropertyAssignment(n) && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name)) && !KEIN_TEXT_FELD.has(n.name.text) && (ts.isStringLiteral(n.initializer) || ts.isNoSubstitutionTemplateLiteral(n.initializer) || ts.isTemplateExpression(n.initializer))) {
        const roh = ts.isTemplateExpression(n.initializer) ? n.initializer.head.text + n.initializer.templateSpans.map((x) => x.literal.text).join(' ') : n.initializer.text;
        if (/[äöüßÄÖÜ]/.test(roh) || /^[^a-zA-Z]*[A-ZÄÖÜ][a-zäöüß]+([ ,:(–—-]|$)/.test(roh) && / /.test(roh.trim())) tief(n.initializer, sf, `feld:${n.name.text}`);
      }
      else if (ts.isArrayLiteralExpression(n)) {
        // Listen von Beschriftungen: [['light', 'Hell'], ['dark', 'Dunkel']], ['Montag', 'Dienstag', …]
        for (const e of n.elements) if ((ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) && /^[^a-z]*[A-ZÄÖÜ][a-zäöüß]|[äöüß]| [a-zäöü]{3}/.test(e.text) && !/^[A-Za-z]+[A-Z][A-Za-z]*$/.test(e.text)) merke(e.text, false, sf, e, 'liste');
        for (const e of n.elements) if (ts.isTemplateExpression(e) && /[A-ZÄÖÜ][a-zäöüß]{2}/.test(e.head.text)) ausAusdruck(e, sf, 'liste');
      }
      else if (ts.isJsxElement(n) && n.openingElement.tagName.getText(sf) === 'code') return;   // Code bleibt Code
      else if (ts.isReturnStatement(n) && n.expression && (ts.isStringLiteral(n.expression) || ts.isTemplateExpression(n.expression) || ts.isNoSubstitutionTemplateLiteral(n.expression) || ts.isConditionalExpression(n.expression))) tief(n.expression, sf, 'rueckgabe');
      ts.forEachChild(n, geh);
    };
    geh(sf);
  }
  // Was nie in der Oberfläche steht (Anweisungen an die KI in Listenform …), steht in werkzeug/sprache-ohne.json
  const ohne = existsSync(path.join(repo, 'werkzeug/sprache-ohne.json')) ? new Set(JSON.parse(readFileSync(path.join(repo, 'werkzeug/sprache-ohne.json'), 'utf-8'))) : new Set();
  for (const k of [...funde.keys()]) if (ohne.has(k)) funde.delete(k);
  return [...funde.values()].sort((a, b) => a.stellen[0].localeCompare(b.stellen[0], 'de', { numeric: true }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const funde = ernten();
  if (process.argv.includes('--fehlend')) {
    const wb = existsSync(path.join(SRC, 'sprache/en.json')) ? JSON.parse(readFileSync(path.join(SRC, 'sprache/en.json'), 'utf-8')) : {};
    const fehlt = funde.filter((f) => !(f.de in wb));
    for (const f of fehlt) console.log(`${f.stellen[0]}  ${JSON.stringify(f.de)}`);
    console.log(`\n${fehlt.length} von ${funde.length} Texten fehlen im Wörterbuch.`);
    process.exit(fehlt.length ? 1 : 0);
  }
  writeFileSync(path.join(repo, 'werkzeug/ernte.json'), JSON.stringify(funde, null, 1));
  const zeichen = funde.reduce((s, f) => s + f.de.length, 0);
  console.log(`${funde.length} Texte, ${zeichen} Zeichen, davon ${funde.filter((f) => f.muster).length} Muster → werkzeug/ernte.json`);
}
