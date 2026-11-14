// M373: Entscheidungs-Bubbles — Ideen sammeln, gruppieren, abstimmen.
//
// Vorbild ist das Ideen-Board des Präsentationstools (pix-el.de/interactive, `PhysicsBubbleBoard`): Jede Idee ist
// eine Blase, gleiche Ideen verschmelzen und wachsen, Gruppen ziehen ihre Blasen zusammen, mit Punkten wird
// abgestimmt. Hier ist es eine Karte auf dem Board — und damit Teil der Gruppenarbeit.
//
// Die eine Besonderheit gegenüber allen anderen Karten: An einer Bubbles-Karte arbeiten VIELE gleichzeitig.
// Sonst gehört eine Karte dem, der sie gerade bearbeitet, und von zwei gleichzeitigen Fassungen gilt eine. Das
// würde hier Ideen und Stimmen kosten. Darum sind die Inhalte so abgelegt, dass sich zwei Fassungen IMMER
// verlustfrei vereinigen lassen (bubblesMischen): jede Idee, jede Stimme, jede Gruppe ist ein eigener Eintrag
// mit Zeitstempel; von zwei Fassungen desselben Eintrags gilt die jüngere; Gelöschtes bleibt als Grabstein
// stehen, damit es beim Vereinigen nicht wiederkommt. Die Reihenfolge des Vereinigens ist egal, das Ergebnis
// dasselbe — jedes Gerät kommt beim selben Stand an.

export interface BubbleIdee {
  text: string;
  /** Wer sie eingebracht hat (Kennung wie bei Karten: g:<Gerät> / k:<Konto>) und unter welchem Namen */
  von: string;
  name?: string;
  /** Zeitstempel der letzten Änderung an diesem Eintrag (ms) */
  t: number;
  /** Gruppe (Kennung) — fehlt oder null: frei */
  g?: string | null;
  /** Grabstein: gelöscht */
  weg?: boolean;
}
export interface BubbleStimme { n: number; t: number }
export interface BubbleGruppe { name: string; farbe: number; t: number; weg?: boolean }
export interface BubbleAbstimmung { phase: 'aus' | 'offen' | 'fertig'; punkte: number; t: number }
/**
 * M378: Regeln der Moderation — gelten für alle, die jüngste Fassung gewinnt als Ganzes.
 *   zu       – die Sammlung ist geschlossen (Schritt „Gruppieren"): nur wer leitet, trägt noch ein
 *   anonym   – Namen werden weder gezeigt noch an neuen Ideen vermerkt
 *   verdeckt – solange gesammelt wird, sieht jeder nur seine eigenen Ideen im Wortlaut
 *   still    – beim Abstimmen sieht jeder nur seine eigenen Punkte; der Stand erscheint mit dem Auswerten
 */
export interface BubbleRegeln { zu?: boolean; anonym?: boolean; verdeckt?: boolean; still?: boolean; t: number }
export type BubbleSchritt = 'sammeln' | 'gruppieren' | 'abstimmen' | 'ergebnis';

export interface BubblesData {
  title: string;
  /** Die Frage, um die es geht — steht über den Blasen */
  frage?: string;
  ideen: Record<string, BubbleIdee>;
  /** Stimmen: Schlüssel „<Idee>|<Wer>" → Anzahl Punkte */
  stimmen: Record<string, BubbleStimme>;
  gruppen: Record<string, BubbleGruppe>;
  abstimmung: BubbleAbstimmung;
  regeln?: BubbleRegeln;
  [key: string]: unknown;
}

/** Farben der Gruppen (und der freien Blasen, der Reihe nach) — kräftig genug für weiße Schrift */
export const BUBBLE_FARBEN = ['#4f7cff', '#e8590c', '#2b8a3e', '#c2255c', '#7048e8', '#0c8599', '#e67700', '#5c940d', '#a61e4d', '#1971c2'];

export const leereBubbles = (): Pick<BubblesData, 'ideen' | 'stimmen' | 'gruppen' | 'abstimmung'> => ({
  ideen: {}, stimmen: {}, gruppen: {}, abstimmung: { phase: 'aus', punkte: 3, t: 0 },
});

/** Unvollständige oder alte Daten auf die volle Form bringen (nie werfen — die Karte soll immer aufgehen) */
export function bubblesDaten(d: Partial<BubblesData> | undefined): BubblesData {
  const a = d?.abstimmung;
  return {
    ...(d ?? {}),
    title: typeof d?.title === 'string' ? d.title : 'Ideen',
    ideen: d?.ideen && typeof d.ideen === 'object' ? d.ideen : {},
    stimmen: d?.stimmen && typeof d.stimmen === 'object' ? d.stimmen : {},
    gruppen: d?.gruppen && typeof d.gruppen === 'object' ? d.gruppen : {},
    abstimmung: a && (a.phase === 'aus' || a.phase === 'offen' || a.phase === 'fertig')
      ? { phase: a.phase, punkte: Math.min(10, Math.max(1, Math.round(Number(a.punkte) || 3))), t: Number(a.t) || 0 }
      : { phase: 'aus', punkte: 3, t: 0 },
    regeln: regelnVon(d?.regeln),
  };
}
function regelnVon(r: Partial<BubbleRegeln> | undefined): BubbleRegeln {
  return { ...(r?.zu ? { zu: true } : {}), ...(r?.anonym ? { anonym: true } : {}), ...(r?.verdeckt ? { verdeckt: true } : {}), ...(r?.still ? { still: true } : {}), t: Number(r?.t) || 0 };
}
/** Wo steht die Runde? Sammeln → Gruppieren → Abstimmen → Ergebnis */
export function bubblesSchritt(d0: Partial<BubblesData> | undefined): BubbleSchritt {
  const d = bubblesDaten(d0);
  if (d.abstimmung.phase === 'offen') return 'abstimmen';
  if (d.abstimmung.phase === 'fertig') return 'ergebnis';
  return d.regeln?.zu ? 'gruppieren' : 'sammeln';
}
/** Wie viele Personen haben beigetragen? (über die lebenden Ideen) */
export function beteiligte(d0: Partial<BubblesData> | undefined): number {
  const d = bubblesDaten(d0);
  return new Set(Object.values(d.ideen).filter((i) => i && !i.weg && typeof i.text === 'string' && i.text.trim()).map((i) => i.von)).size;
}

/** Tabelle mit sortierten Schlüsseln — so schreibt jedes Gerät dieselbe Fassung gleich auf (kein Hin und Her wegen der Reihenfolge) */
export function geordnet<T>(t: Record<string, T>): Record<string, T> {
  const aus: Record<string, T> = {};
  for (const k of Object.keys(t).sort()) aus[k] = t[k];
  return aus;
}
/** Von zwei Fassungen eines Eintrags die jüngere; bei gleichem Stempel entscheidet der Inhalt (überall gleich) */
function juenger<T extends { t: number }>(a: T | undefined, b: T | undefined): T | undefined {
  if (!a) return b;
  if (!b) return a;
  if (a.t !== b.t) return a.t > b.t ? a : b;
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}
function tabelleMischen<T extends { t: number }>(a: Record<string, T> | undefined, b: Record<string, T> | undefined): Record<string, T> {
  const aus: Record<string, T> = {};
  // sortierte Schlüssel: zwei Geräte bauen dieselbe Tabelle in derselben Reihenfolge (sonst schrieben sie ewig hin und her)
  for (const k of [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].sort()) {
    const w = juenger(a?.[k], b?.[k]);
    if (w) aus[k] = w;
  }
  return aus;
}
/**
 * Zwei Fassungen der Inhalte einer Bubbles-Karte verlustfrei vereinigen. Kommutativ, assoziativ, idempotent:
 * mischen(a, b) = mischen(b, a), und mischen(a, a) = a.
 */
export function bubblesMischen(a0: Partial<BubblesData> | undefined, b0: Partial<BubblesData> | undefined): Pick<BubblesData, 'ideen' | 'stimmen' | 'gruppen' | 'abstimmung'> & { regeln?: BubbleRegeln } {
  const a = bubblesDaten(a0); const b = bubblesDaten(b0);
  const regeln = juenger(a.regeln, b.regeln)!;
  return {
    ideen: tabelleMischen(a.ideen, b.ideen),
    stimmen: tabelleMischen(a.stimmen, b.stimmen),
    gruppen: tabelleMischen(a.gruppen, b.gruppen),
    abstimmung: juenger(a.abstimmung, b.abstimmung)!,
    // Regeln nur mitführen, wenn je welche gesetzt wurden (alte Karten bleiben, wie sie sind)
    ...(regeln.t > 0 ? { regeln } : {}),
  };
}
/** Sind die vereinigbaren Inhalte zweier Fassungen gleich? */
export const bubblesGleich = (a: Partial<BubblesData> | undefined, b: Partial<BubblesData> | undefined): boolean => {
  const x = bubblesMischen(a, undefined); const y = bubblesMischen(b, undefined);
  return JSON.stringify(x) === JSON.stringify(y);
};

/** Eine Blase, wie sie zu sehen ist: gleiche Texte sind zu einer verschmolzen */
export interface Blase {
  /** Kennung der ältesten Idee mit diesem Text — bleibt stabil, wenn weitere dazukommen */
  id: string;
  text: string;
  /** alle Ideen, die in dieser Blase stecken */
  ids: string[];
  /** wie oft sie genannt wurde */
  mal: number;
  /** Punkte aus der Abstimmung (über alle verschmolzenen Ideen) */
  punkte: number;
  /** davon meine */
  meine: number;
  gruppe: string | null;
  von: string[];
  namen: string[];
}
const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Die sichtbaren Blasen: lebende Ideen, gleiche Texte verschmolzen, Stimmen zusammengezählt */
export function blasenVon(d0: Partial<BubblesData> | undefined, ich: string, opt: { jeAutor?: boolean } = {}): Blase[] {
  const d = bubblesDaten(d0);
  const nachText = new Map<string, Blase & { t0: number }>();
  const zuBlase = new Map<string, string>();     // Idee → Schlüssel der Blase
  const lebend = Object.entries(d.ideen).filter(([, i]) => i && !i.weg && typeof i.text === 'string' && i.text.trim()).sort((a, b) => a[1].t - b[1].t || a[0].localeCompare(b[0]));
  for (const [id, i] of lebend) {
    // M378 (verdeckt sammeln): gleiche Texte verschiedener Personen bleiben getrennt — sonst verriete die Zahl, dass ein anderer dasselbe schrieb
    const k = opt.jeAutor ? `${norm(i.text)}\u0000${i.von}` : norm(i.text);
    const gruppe = i.g && d.gruppen[i.g] && !d.gruppen[i.g].weg ? i.g : null;
    const b = nachText.get(k);
    if (b) {
      b.ids.push(id); b.mal += 1;
      if (!b.von.includes(i.von)) b.von.push(i.von);
      if (i.name && !b.namen.includes(i.name)) b.namen.push(i.name);
      if (!b.gruppe && gruppe) b.gruppe = gruppe;
    } else {
      nachText.set(k, { id, text: i.text.trim(), ids: [id], mal: 1, punkte: 0, meine: 0, gruppe, von: [i.von], namen: i.name ? [i.name] : [], t0: i.t });
    }
    zuBlase.set(id, k);
  }
  for (const [schluessel, s] of Object.entries(d.stimmen)) {
    if (!s || !(s.n > 0)) continue;
    const trenn = schluessel.indexOf('|');
    const b = nachText.get(zuBlase.get(schluessel.slice(0, trenn)) ?? '');
    if (!b) continue;
    b.punkte += s.n;
    if (schluessel.slice(trenn + 1) === ich) b.meine += s.n;
  }
  return [...nachText.values()].map(({ t0: _t, ...b }) => b);
}

/** Wie viele Punkte habe ich schon vergeben? (nur auf Ideen, die es noch gibt) */
export function meinePunkte(d0: Partial<BubblesData> | undefined, ich: string): number {
  return blasenVon(d0, ich).reduce((s, b) => s + b.meine, 0);
}

/** Radius einer Blase: wächst mit der Textlänge (ein wenig), mit Nennungen und mit Punkten; bei vielen Blasen kleiner */
export function blasenRadius(b: Pick<Blase, 'text' | 'mal' | 'punkte'>, anzahl: number, masstab = 1): number {
  const l = b.text.length;
  let basis: number;
  if (anzahl <= 5) basis = 50 + Math.min(l * 0.6, 18);
  else if (anzahl <= 12) basis = 42 + Math.min(l * 0.5, 14);
  else if (anzahl <= 25) basis = 34 + Math.min(l * 0.4, 10);
  else if (anzahl <= 50) basis = 27 + Math.min(l * 0.35, 8);
  else basis = 22 + Math.min(l * 0.3, 6);
  const gewicht = 1 + Math.log2(Math.max(1, b.mal)) * 0.35 + Math.log2(1 + Math.max(0, b.punkte)) * 0.22;
  return basis * gewicht * masstab;
}

/** Rangfolge nach Punkten (dann Nennungen) — für das Ergebnis */
export function rangfolge(blasen: Blase[]): Blase[] {
  return [...blasen].sort((a, b) => b.punkte - a.punkte || b.mal - a.mal || a.text.localeCompare(b.text, 'de'));
}

/** Als Text (Suche, Export, Präsentation ohne Bühne) */
export function bubblesAlsText(d0: Partial<BubblesData> | undefined): string {
  const d = bubblesDaten(d0);
  const blasen = rangfolge(blasenVon(d, ''));
  const zeile = (b: Blase) => `• ${b.text}${b.mal > 1 ? ` (${b.mal}×)` : ''}${b.punkte ? ` — ${b.punkte} ${b.punkte === 1 ? 'Punkt' : 'Punkte'}` : ''}`;
  const kopf = [d.title || 'Ideen', d.frage ?? ''].filter(Boolean).join('\n');
  const gruppen = Object.entries(d.gruppen).filter(([, g]) => g && !g.weg).sort((a, b) => a[1].t - b[1].t);
  if (!gruppen.length) return `${kopf}\n${blasen.map(zeile).join('\n')}`.trim();
  const teile = gruppen.map(([id, g]) => {
    const drin = blasen.filter((b) => b.gruppe === id);
    return drin.length ? `${g.name}:\n${drin.map(zeile).join('\n')}` : '';
  }).filter(Boolean);
  const frei = blasen.filter((b) => !b.gruppe);
  if (frei.length) teile.push(`Ohne Gruppe:\n${frei.map(zeile).join('\n')}`);
  return `${kopf}\n${teile.join('\n\n')}`.trim();
}

/** M378: Das Ergebnis als Blöcke einer Notiz (Überschrift, Frage, je Gruppe eine Liste nach Punkten) */
export function bubblesAlsBloecke(d0: Partial<BubblesData> | undefined): Array<{ type: string; props?: Record<string, unknown>; content: string }> {
  const d = bubblesDaten(d0);
  const blasen = rangfolge(blasenVon(d, ''));
  const zeile = (b: Blase) => `${b.text}${b.mal > 1 ? ` (${b.mal}×)` : ''}${b.punkte ? ` — ${b.punkte} ${b.punkte === 1 ? 'Punkt' : 'Punkte'}` : ''}`;
  const aus: Array<{ type: string; props?: Record<string, unknown>; content: string }> = [{ type: 'heading', props: { level: 2 }, content: d.title || 'Ideen' }];
  if (d.frage) aus.push({ type: 'paragraph', content: d.frage });
  const n = beteiligte(d);
  aus.push({ type: 'paragraph', content: `${blasen.length} ${blasen.length === 1 ? 'Idee' : 'Ideen'}${n > 1 ? ` von ${n} Personen` : ''}` });
  const gruppen = Object.entries(d.gruppen).filter(([, g]) => g && !g.weg).sort((a, b) => a[1].t - b[1].t);
  if (!gruppen.length) { for (const b of blasen) aus.push({ type: 'bulletListItem', content: zeile(b) }); return aus; }
  for (const [id, g] of gruppen) {
    const drin = blasen.filter((b) => b.gruppe === id);
    if (!drin.length) continue;
    const summe = drin.reduce((s, b) => s + b.punkte, 0);
    aus.push({ type: 'heading', props: { level: 3 }, content: `${g.name}${summe ? ` — ${summe} ${summe === 1 ? 'Punkt' : 'Punkte'}` : ''}` });
    for (const b of drin) aus.push({ type: 'bulletListItem', content: zeile(b) });
  }
  const frei = blasen.filter((b) => !b.gruppe);
  if (frei.length) { aus.push({ type: 'heading', props: { level: 3 }, content: 'Ohne Gruppe' }); for (const b of frei) aus.push({ type: 'bulletListItem', content: zeile(b) }); }
  return aus;
}
