// M397: Emojis und der lange Gedankenstrich „—" raus aus den Texten der Oberfläche.
//
//   node werkzeug/ohne-emoji.mjs --liste [pfad …]     → zeigt, was sich ändern würde, und was von Hand zu tun bleibt
//   node werkzeug/ohne-emoji.mjs --schreiben [pfad …] → ändert die Dateien
//   node werkzeug/ohne-emoji.mjs --pruefen            → Rückgabewert 1, wenn in src/ noch ein Emoji in einem Text steht
//
// Gearbeitet wird am Syntaxbaum: nur Zeichenketten, Vorlagen und Text zwischen Tags — Kommentare und Code bleiben.
// Ein Emoji NEBEN Text ist Schmuck und fällt weg („📝 Notiz" → „Notiz"). Ein Emoji ALLEIN ist ein Symbol oder ein
// Datum (Reaktionen, Tasten-Zeichen) — das wird nur gemeldet; dort gehört ein einfarbiges Symbol hin oder es bleibt.
import ts from 'typescript';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));

/** Bunte Bildzeichen: der Emoji-Block, alles mit Emoji-Auswahlzeichen, und Zeichen, die Geräte von sich aus bunt malen */
const BUNT = '✅✨⚡⏱⏰➕➖⬜⬛⬇⬆✋☀☁⚙⚠⌨✂✏✒✍✉❤⚖⭐⏳⌛⛔❌❓❗⛶☝✌⏸⏯⏩⏪☕⚓⛅';
const EIN = `(?:[\\u{1F000}-\\u{1FAFF}]|[\\u2600-\\u27BF\\u2B00-\\u2BFF\\u2300-\\u23FF]\\uFE0F|[${BUNT}]\\uFE0F?)(?:\\uFE0F|[\\u{1F3FB}-\\u{1F3FF}]|\\u200D(?:[\\u{1F000}-\\u{1FAFF}]|[\\u2600-\\u27BF])\\uFE0F?)*`;
export const EMOJI = new RegExp(EIN, 'u');
const EMOJI_G = new RegExp(EIN, 'gu');
const BUCHSTABEN = /[A-Za-zÄÖÜäöüß]{2}/;

/** Das Zahnrad steht in Texten für die Einstellungen — dort wird es zum Wort */
const ZAHNRAD = /⚙️?/gu;
export function ohneEmoji(roh, sprache = 'de') {
  let s = roh;
  const wort = sprache === 'en' ? 'Settings' : 'Einstellungen';
  s = s.replace(new RegExp(`⚙\\uFE0F? ?(?=${wort})`, 'gu'), '');                  // „⚙ Einstellungen" → „Einstellungen"
  s = s.replace(ZAHNRAD, wort);
  // Pfeile bleiben, aber als Schriftzeichen (ohne Emoji-Auswahlzeichen)
  s = s.replace(/([←-⇿✓✔✕✖✎☐-☒])️/gu, '$1');
  // Emoji samt EINEM angrenzenden Leerzeichen: erst das folgende, sonst das davor
  s = s.replace(new RegExp(`(${EIN})+ `, 'gu'), '');
  s = s.replace(new RegExp(` (${EIN})+`, 'gu'), '');
  s = s.replace(EMOJI_G, '');
  // der lange Gedankenstrich ist im Deutschen falsch — richtig ist der Halbgeviertstrich mit Leerzeichen
  s = s.replace(/ — /g, ' – ').replace(/ —(\n|$)/g, ' –$1').replace(/(^|\n)— /g, '$1– ');
  return s;
}

function dateien(dir, endung, aus = []) {
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== 'node_modules' && n !== 'ablage') dateien(p, endung, aus); }
    else if (endung.test(n) && !/\.d\.ts$/.test(n)) aus.push(p);
  }
  return aus;
}

/** Eine Quelldatei durchgehen → { neu, geaendert, allein: [{zeile, text}] } */
export function bearbeiten(datei, text, sprache = 'de') {
  const sf = ts.createSourceFile(datei, text, ts.ScriptTarget.Latest, true, /\.(tsx|jsx)$/.test(datei) ? ts.ScriptKind.TSX : /\.mjs$/.test(datei) ? ts.ScriptKind.JS : ts.ScriptKind.TS);
  const ersatz = []; const allein = [];
  const zeile = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const stueck = (node, ganzerText) => {
    const a = node.getStart(sf); const b = node.getEnd();
    const roh = text.slice(a, b);
    if (!EMOJI.test(roh) && !roh.includes('—') && !/[←-⇿]️/u.test(roh)) return;
    const mitText = BUCHSTABEN.test((ganzerText ?? roh).replace(/\$\{[^}]*\}/g, ''));
    if (!mitText) { if (EMOJI.test(roh)) allein.push({ zeile: zeile(a), text: roh.slice(0, 90).replace(/\s+/g, ' ') }); return; }
    const neu = ohneEmoji(roh, sprache);
    if (neu !== roh) ersatz.push({ a, b, neu });
  };
  const gehe = (node) => {
    switch (node.kind) {
      case ts.SyntaxKind.StringLiteral:
      case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      case ts.SyntaxKind.JsxText:
        stueck(node); break;
      case ts.SyntaxKind.RegularExpressionLiteral:
        // Muster der App lesen Eingaben (Checkboxen in Word, Handschrift) — die bleiben. In Prüfungen stehen sie für Texte der Oberfläche.
        if (/\.mjs$/.test(datei)) stueck(node);
        break;
      case ts.SyntaxKind.TemplateExpression: {
        const ganz = text.slice(node.getStart(sf), node.getEnd());
        // nur die festen Teile der Vorlage — nicht, was in ${…} steht (dort geht es mit gehe() weiter)
        // Eine Vorlage setzt Text ein — ein Emoji darin schmückt diesen Text, auch wenn die festen Teile keine Buchstaben haben
        const feste = `${ganz.replace(/\$\{[^}]*\}/g, ' ')} xx`;
        stueck(node.head, feste);
        for (const sp of node.templateSpans) { stueck(sp.literal, feste); gehe(sp.expression); }
        return;
      }
      default:
    }
    ts.forEachChild(node, gehe);
  };
  gehe(sf);
  let neu = text;
  for (const e of ersatz.sort((x, y) => y.a - x.a)) neu = neu.slice(0, e.a) + e.neu + neu.slice(e.b);
  return { neu, geaendert: ersatz.length, allein };
}

const args = process.argv.slice(2);
if (import.meta.url === `file://${process.argv[1]}`) {
  const modus = args.find((a) => a.startsWith('--')) ?? '--liste';
  const pfade = args.filter((a) => !a.startsWith('--'));
  const ziele = (pfade.length ? pfade : ['src']).flatMap((p) => {
    const voll = path.resolve(repo, p);
    return statSync(voll).isDirectory() ? dateien(voll, /\.(tsx?|mjs)$/) : [voll];
  });
  let summe = 0; let offen = 0;
  for (const f of ziele) {
    const text = readFileSync(f, 'utf-8');
    const { neu, geaendert, allein } = bearbeiten(f, text, /HelpOverlayEn\.tsx$/.test(f) ? 'en' : 'de');
    summe += geaendert;
    const rel = path.relative(repo, f);
    if (modus === '--schreiben' && geaendert) writeFileSync(f, neu);
    if (modus !== '--pruefen' && geaendert) console.log(`${String(geaendert).padStart(4)} ${rel}`);
    if (modus === '--pruefen') { for (const a of allein) void a; }
    for (const a of allein) { offen += 1; if (modus !== '--pruefen') console.log(`       allein ${rel}:${a.zeile}  ${a.text}`); }
  }
  console.log(`${summe} Textstellen ${modus === '--schreiben' ? 'geändert' : 'zu ändern'}, ${offen} Emojis stehen allein`);
  if (modus === '--pruefen') process.exit(summe > 0 ? 1 : 0);
}
