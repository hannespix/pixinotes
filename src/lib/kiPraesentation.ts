// M427: Präsentationen per KI — die KI liefert eine Gliederung, PixiNotes baut daraus die Folien.
//
// Gewünscht: „Die Präsentation im Präsentationsmodul soll per KI-Funktion erstellt werden können!"
//
// Die KI schreibt KEIN HTML. Sie liefert eine Gliederung als JSON: je Folie eine Art (Titel, Kapitel, Text, drei
// Punkte, Zitat, große Zahl, Ablauf, Schluss), die Texte und Sprechernotizen. Hier wird sie geprüft (bekannte Arten,
// Längen gekappt, fehlende Teile ergänzt oder die Folie verworfen) und mit festen Vorlagen in Abschnitte von Vibe
// Studio übersetzt — genau die Layout-Klassen, die Vibe Studio selbst verwendet. So sieht jede Präsentation aus wie
// von Hand in Vibe Studio gebaut, lässt sich dort weiter bearbeiten, und ein Modell kann das Layout nicht zerlegen.
// Alles Eingesetzte wird maskiert: Text bleibt Text.

export type FolienArt = 'titel' | 'kapitel' | 'text' | 'punkte' | 'zitat' | 'zahl' | 'ablauf' | 'schluss';

export interface Folie {
  art: FolienArt;
  /** kleine Zeile über dem Titel („02 / umsatz") — leer: wird aus der Kapitelnummer gebildet */
  marke?: string;
  titel: string;
  /** Untertitel, Fließtext, Zitat-Quelle oder Erläuterung zur Zahl — je nach Art */
  text?: string;
  /** Punkte bzw. Schritte: Überschrift und Satz (drei Stück) */
  punkte?: { titel: string; text: string }[];
  /** große Zahl (Art „zahl") */
  zahl?: string;
  /** Sprechernotizen */
  notiz?: string;
}

export interface Gliederung {
  titel: string;
  untertitel: string;
  /** Wer vorträgt / Anlass — erscheint klein auf der Titelfolie */
  autor?: string;
  anlass?: string;
  folien: Folie[];
}

const ARTEN: FolienArt[] = ['titel', 'kapitel', 'text', 'punkte', 'zitat', 'zahl', 'ablauf', 'schluss'];
export const FOLIEN_MAX = 24;

/** Längen, die das jeweilige Layout trägt (in Zeichen) */
const LANG = { titel: 90, marke: 40, text: 420, punktTitel: 40, punktText: 140, zahl: 12, notiz: 1200, name: 60 };

const kappen = (v: unknown, max: number): string => {
  const s = typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const schnitt = t.slice(0, max);
  const wort = schnitt.lastIndexOf(' ');
  return `${(wort > max * 0.6 ? schnitt.slice(0, wort) : schnitt).replace(/[,;:.\-–]+$/, '')} …`;
};

/** Die Antwort des Modells in eine sichere Gliederung verwandeln — oder einen verständlichen Fehler werfen */
export function gliederungPruefen(roh: unknown): Gliederung {
  const o = (roh && typeof roh === 'object' ? roh : {}) as Record<string, unknown>;
  const liste = Array.isArray(o.folien) ? o.folien : Array.isArray(o.slides) ? o.slides : [];
  const folien: Folie[] = [];
  for (const f of liste.slice(0, FOLIEN_MAX * 2)) {
    if (!f || typeof f !== 'object') continue;
    const r = f as Record<string, unknown>;
    const artRoh = String(r.art ?? r.type ?? '').toLowerCase().trim() as FolienArt;
    const art: FolienArt = ARTEN.includes(artRoh) ? artRoh : 'text';
    const titel = kappen(r.titel ?? r.title, LANG.titel);
    const text = kappen(r.text ?? r.untertitel, LANG.text) || undefined;
    const notiz = kappen(r.notiz ?? r.notes, LANG.notiz) || undefined;
    const marke = kappen(r.marke, LANG.marke) || undefined;
    let punkte: Folie['punkte'];
    if (art === 'punkte' || art === 'ablauf') {
      punkte = (Array.isArray(r.punkte) ? r.punkte : [])
        .map((p) => (p && typeof p === 'object'
          ? { titel: kappen((p as Record<string, unknown>).titel, LANG.punktTitel), text: kappen((p as Record<string, unknown>).text, LANG.punktText) }
          : { titel: kappen(p, LANG.punktTitel), text: '' }))
        .filter((p) => p.titel || p.text)
        .slice(0, art === 'ablauf' ? 3 : 4);
      // Ein Ablauf hat genau drei Schritte, Punkte zwei bis vier — sonst trägt die Folie als Text
      if (art === 'ablauf' && punkte.length !== 3) { folien.push({ art: 'text', titel, marke, notiz, text: [text, ...punkte.map((p) => `${p.titel}${p.text ? `: ${p.text}` : ''}`)].filter(Boolean).join(' · ').slice(0, LANG.text) }); continue; }
      if (art === 'punkte' && punkte.length < 2) { folien.push({ art: 'text', titel, marke, notiz, text: [text, ...punkte.map((p) => `${p.titel} ${p.text}`.trim())].filter(Boolean).join(' ') }); continue; }
    }
    const zahl = art === 'zahl' ? kappen(r.zahl, LANG.zahl) : undefined;
    if (art === 'zahl' && !zahl) { if (titel || text) folien.push({ art: 'text', titel, text, marke, notiz }); continue; }
    if (!titel && art !== 'zahl') continue;
    folien.push({ art, titel, text, punkte, zahl, notiz, marke });
  }
  // Titelfolie gehört an den Anfang (genau eine); fehlt sie, entsteht sie aus Titel und Untertitel
  const titelFolie = folien.find((f) => f.art === 'titel');
  const rest = folien.filter((f) => f.art !== 'titel').slice(0, FOLIEN_MAX - 1);
  const titel = kappen(o.titel ?? o.title, LANG.titel) || titelFolie?.titel || '';
  if (!titel && rest.length === 0) throw new Error('Die KI hat keine Folien geliefert.');
  if (rest.length === 0) throw new Error('Die KI hat nur eine Titelfolie geliefert – bitte genauer beschreiben, worum es gehen soll.');
  return {
    titel: titel || 'Präsentation',
    untertitel: kappen(o.untertitel ?? o.subtitle, LANG.titel) || titelFolie?.text || '',
    autor: kappen(o.autor, LANG.name) || undefined,
    anlass: kappen(o.anlass, LANG.name) || undefined,
    folien: [{ art: 'titel', titel: titel || titelFolie?.titel || 'Präsentation', text: titelFolie?.text, notiz: titelFolie?.notiz }, ...rest],
  };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const notizen = (t?: string) => `<aside class="notes">${esc(t ?? '')}</aside>`;
const HAKEN = '<svg class="rule-mark" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="29"/><path d="M19 33l9 9 18-20"/></svg>';
/** Anzeigedauer im automatischen Durchlauf (P) — grob nach Textmenge */
const dauer = (f: Folie) => Math.round(Math.min(90, Math.max(8, ((f.titel.length + (f.text?.length ?? 0) + (f.punkte ?? []).reduce((a, p) => a + p.titel.length + p.text.length, 0)) / 14))) * 1000);
const anf = (s: string) => (/^[„"»«]/.test(s) ? s : `„${s.replace(/^["']|["']$/g, '')}“`);

/** Die Folien als Abschnitte von Vibe Studio. `motiv`: Bildquelle der Titelfolie (aus der Vorlage). */
export function folienHtml(g: Gliederung, motiv: string): string {
  let kapitel = 0;
  const marke = (f: Folie, vorgabe: string) => esc((f.marke || (kapitel ? `${String(kapitel).padStart(2, '0')} / ${vorgabe}` : vorgabe)).toLowerCase());
  const name = (f: Folie) => esc(f.titel || f.zahl || 'Folie');
  return g.folien.map((f) => {
    switch (f.art) {
      case 'titel':
        return `<section class="chapter paper" data-scene="paper" data-name="Titel" data-duration="7000"><div class="motion-layer" aria-hidden="true"><img class="motion-image" src="${esc(motiv)}" alt=""></div>`
          + `<div class="chapter-title"><h1>${esc(g.titel)}</h1><p>${esc(g.untertitel)}</p></div>`
          + `<div class="signature">${esc(g.autor ?? '')} <span>${esc(g.anlass ?? '')}</span></div>${notizen(f.notiz)}</section>`;
      case 'kapitel':
        kapitel += 1;
        return `<section class="content ink quote-slide big" data-name="${name(f)}" data-duration="${dauer(f)}"><div class="eyebrow">${esc(f.marke?.toLowerCase() || `kapitel ${kapitel}`)}</div>`
          + `<h2>${esc(f.titel)}</h2>${f.text ? `<p class="endnote">${esc(f.text)}</p>` : ''}${notizen(f.notiz)}</section>`;
      case 'punkte':
        return `<section class="content cream rules-slide" data-name="${name(f)}" data-duration="${dauer(f)}"><div class="eyebrow">${marke(f, 'überblick')}</div><h2>${esc(f.titel)}</h2>`
          + `<div class="rules stagger"${(f.punkte?.length ?? 3) !== 3 ? ` style="grid-template-columns:repeat(${f.punkte?.length},1fr)"` : ''}>`
          + (f.punkte ?? []).map((p) => `<div>${HAKEN}<h3>${esc(p.titel)}</h3>${p.text ? `<p class="story-copy">${esc(p.text)}</p>` : ''}</div>`).join('')
          + `</div>${notizen(f.notiz)}</section>`;
      case 'ablauf':
        return `<section class="content sage flow-slide" data-name="${name(f)}" data-duration="${dauer(f)}"><div class="eyebrow">${marke(f, 'ablauf')}</div><h2>${esc(f.titel)}</h2><div class="flow-cards">`
          + (f.punkte ?? []).map((p) => `<div class="flow-card"><span class="small-label story-copy">${esc(p.titel)}</span><p class="story-copy flow-say">${esc(p.text)}</p></div>`).join('<i class="flow-arrow" aria-hidden="true"><i></i></i>')
          + `</div>${notizen(f.notiz)}</section>`;
      case 'zitat':
        return `<section class="content ink quote-slide" data-name="${name(f)}" data-duration="${dauer(f)}"><div class="eyebrow">${marke(f, 'zitat')}</div><h2>${esc(anf(f.titel))}</h2>`
          + `${f.text ? `<p class="story-copy quote-by">${esc(f.text)}</p>` : ''}${notizen(f.notiz)}</section>`;
      case 'zahl': {
        const z = f.zahl ?? '';
        const zahlwert = /^\d+$/.test(z) ? ` data-count="${z}"` : '';
        return `<section class="content cream count-slide" data-name="${esc(z)} ${name(f)}" data-duration="${dauer(f)}"><div class="eyebrow">${marke(f, 'in einer zahl')}</div>`
          + `<h2><span class="count"${zahlwert}>${esc(z)}</span> ${esc(f.titel)}</h2>${f.text ? `<p class="story-copy statement-sub">${esc(f.text)}</p>` : ''}${notizen(f.notiz)}</section>`;
      }
      case 'schluss':
        return `<section class="content ink quote-slide big" data-name="${name(f)}" data-duration="${dauer(f)}"><div class="eyebrow">${esc(f.marke?.toLowerCase() || 'zum schluss')}</div>`
          + `<h2>${esc(f.titel)}</h2>${f.text ? `<p class="endnote">${esc(f.text)}</p>` : ''}${notizen(f.notiz)}</section>`;
      default:
        return `<section class="content cream" data-name="${name(f)}" data-duration="${dauer(f)}"><div class="eyebrow">${marke(f, 'thema')}</div><h2>${esc(f.titel)}</h2>`
          + `${f.text ? `<p class="slide-copy">${esc(f.text)}</p>` : ''}${notizen(f.notiz)}</section>`;
    }
  }).join('\n');
}

const START = '<div class="slides">';
const ENDE = '</div></div>\n\n<div class="deck-ui"';

/** Die Vorlage von Vibe Studio mit diesen Folien — eine fertige, bearbeitbare Präsentation */
export function deckBauen(vorlage: string, g: Gliederung): string {
  const a = vorlage.indexOf(START);
  const b = vorlage.indexOf(ENDE, a);
  const motiv = /class="motion-image" src="([^"]+)"/.exec(vorlage)?.[1];
  if (a < 0 || b < 0 || !motiv) throw new Error('Die Vorlage für Präsentationen hat sich geändert – bitte PixiNotes neu laden.');
  const html = vorlage.slice(0, a + START.length) + '\n' + folienHtml(g, motiv) + '\n' + vorlage.slice(b);
  return html.replace(/<title>[^<]*<\/title>/, () => `<title>${esc(g.titel)}</title>`);
}

/** Form und Regeln der Antwort — für Erstellen und Überarbeiten dieselben */
const FORMAT_REGELN = `Antworte NUR mit JSON in genau dieser Form:
{"titel":"…","untertitel":"…","autor":"","anlass":"","folien":[
 {"art":"kapitel","titel":"Kurzer Kapiteltitel.","text":"optionaler Satz","notiz":"Sprechernotiz"},
 {"art":"text","marke":"01 / thema","titel":"Aussage als Satz.","text":"2–3 Sätze","notiz":"…"},
 {"art":"punkte","titel":"Drei Gründe.","punkte":[{"titel":"Kurz.","text":"Ein Satz."},{"titel":"…","text":"…"},{"titel":"…","text":"…"}],"notiz":"…"},
 {"art":"ablauf","titel":"Schritt. Schritt. Schritt.","punkte":[{"titel":"schritt 1","text":"Ein Satz."},{"titel":"…","text":"…"},{"titel":"…","text":"…"}],"notiz":"…"},
 {"art":"zahl","zahl":"18","titel":"Prozent mehr.","text":"Was die Zahl bedeutet.","notiz":"…"},
 {"art":"zitat","titel":"Wörtliches Zitat","text":"Wer, wann","notiz":"…"},
 {"art":"schluss","titel":"Danke. Fragen?","text":"optional: nächster Schritt oder Kontakt","notiz":"…"}
]}

Regeln:
- Die Titelfolie entsteht aus "titel" und "untertitel" – nicht als eigene Folie aufführen. "autor" und "anlass" nur, wenn sie aus Wunsch oder Karten hervorgehen, sonst "".
- 6 bis 12 Folien, sofern der Wunsch nichts anderes sagt. Gliedere bei mehr als 6 Folien mit "kapitel"-Folien; ende mit "schluss".
- Eine Aussage pro Folie. Titel sind kurze, ganze Sätze mit Punkt (höchstens 8 Wörter). Text knapp: höchstens 3 kurze Sätze.
- "punkte": 2 bis 4 Punkte (am besten 3), "ablauf": genau 3 Schritte. Punkt-Titel höchstens 4 Wörter.
- "zahl" nur mit einer Zahl, die wirklich in den Karten steht; "zitat" nur mit einem wörtlichen Zitat aus den Karten. Erfinde keine Fakten, Zahlen, Namen oder Zitate.
- "marke": kleine Zeile über dem Titel, klein geschrieben, z. B. "02 / umsatz" (Kapitelnummer / Stichwort); darf fehlen.
- "notiz": was die vortragende Person dazu sagt (2–4 Sätze, mit den Details aus den Karten).
- Wechsle die Folienarten ab, wo es passt – nicht nur "text". Keine Emojis, kein Markdown.
- Sprache: wie der Wunsch bzw. die Karten.`;

/** Der Auftrag an das Modell */
export function gliederungPrompt(wunsch: string, inhalt: string, heute: string): string {
  return `Du erstellst eine Präsentation für das Präsentations-Werkzeug „Vibe Studio".
Wunsch des Nutzers: ${wunsch.trim() || 'Eine klare Präsentation über den Inhalt der Karten.'}
Heute ist ${heute}.

${FORMAT_REGELN}

${inhalt ? `Inhalt der Karten:\n${inhalt}` : 'Es gibt keine Karten – erstelle die Präsentation aus dem Wunsch und allgemeinem Wissen, ohne erfundene Zahlen.'}`;
}

/**
 * M428: Der Auftrag zum Überarbeiten — die bestehende Präsentation als Gliederung (aus der laufenden Präsentation
 * gelesen, mit allen Änderungen im Editor) und der Wunsch. Was der Wunsch nicht betrifft, soll bleiben.
 */
export function ueberarbeitenPrompt(wunsch: string, bisher: Gliederung, inhalt: string, heute: string): string {
  return `Du überarbeitest eine bestehende Präsentation im Präsentations-Werkzeug „Vibe Studio".
Wunsch des Nutzers: ${wunsch.trim() || 'Klarer und knapper formulieren, Struktur und Aussagen beibehalten.'}
Heute ist ${heute}.

Die Präsentation jetzt (JSON, Folie für Folie; die Titelfolie steckt in "titel"/"untertitel"):
${JSON.stringify(bisher)}

Ändere nur, was der Wunsch verlangt. Alles andere bleibt möglichst wörtlich: Reihenfolge, Titel, Texte, Sprechernotizen,
Folienarten. Verlangt der Wunsch neue Folien, füge sie an passender Stelle ein; soll etwas weg, lass es weg.
Die Regel „6 bis 12 Folien" gilt hier nicht: Behalte die Zahl der Folien, außer der Wunsch verlangt anderes.
Antworte mit der VOLLSTÄNDIGEN überarbeiteten Präsentation im selben Format.

${FORMAT_REGELN}

${inhalt ? `Inhalt der Karten, aus denen die Präsentation entstand (für neue Fakten nur diese verwenden):\n${inhalt}` : ''}`;
}

/** M428: Die gelesenen Folien (Brücke in der laufenden Präsentation) als Gliederung */
export function standAlsGliederung(titelFenster: string, folien: { klassen: string; marke: string; titel: string; untertitel: string; absaetze: string[]; punkte: { titel: string; text: string }[]; zahl: string; zusatz: string[]; notiz: string }[]): Gliederung {
  const g: Gliederung = { titel: '', untertitel: '', folien: [] };
  const k = (f: { klassen: string }, c: string) => (` ${f.klassen} `).includes(` ${c} `);
  const letzteGross = folien.map((f, i) => (k(f, 'quote-slide') && k(f, 'big') ? i : -1)).filter((i) => i >= 0).pop() ?? -1;
  folien.forEach((f, i) => {
    const text = [...f.absaetze, ...f.zusatz].join(' ').trim() || undefined;
    const notiz = f.notiz || undefined; const marke = f.marke || undefined;
    if (i === 0 && k(f, 'chapter')) {
      g.titel = f.titel; g.untertitel = f.untertitel;
      return;
    }
    if (k(f, 'chapter')) { g.folien.push({ art: 'kapitel', titel: f.titel, text: f.untertitel || text, notiz, marke }); return; }
    if (k(f, 'quote-slide') && k(f, 'big')) { g.folien.push({ art: i === letzteGross && i >= folien.length - 2 ? 'schluss' : 'kapitel', titel: f.titel, text, notiz, marke }); return; }
    if (k(f, 'quote-slide')) { g.folien.push({ art: 'zitat', titel: f.titel.replace(/^[„"»]|[“"«]$/g, ''), text, notiz, marke }); return; }
    if (k(f, 'count-slide') && f.zahl) { g.folien.push({ art: 'zahl', zahl: f.zahl, titel: f.titel.replace(f.zahl, '').trim(), text, notiz, marke }); return; }
    if (k(f, 'flow-slide') && f.punkte.length) { g.folien.push({ art: 'ablauf', titel: f.titel, punkte: f.punkte, notiz, marke }); return; }
    if (f.punkte.length >= 2) { g.folien.push({ art: 'punkte', titel: f.titel, punkte: f.punkte, text, notiz, marke }); return; }
    g.folien.push({ art: 'text', titel: f.titel || f.zahl || 'Folie', text, notiz, marke });
  });
  if (!g.titel) g.titel = titelFenster.replace(/ · .*$/, '') || 'Präsentation';
  return g;
}
