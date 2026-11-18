// M373: Entscheidungs-Bubbles — die Karte. Daten und das verlustfreie Vereinigen stehen in lib/bubbles.ts.
//
// Die Blasen bewegen sich wie im Vorbild (pix-el.de/interactive) mit einer kleinen Physik: Jede zieht es zu
// ihrem Anker (die Mitte, oder der Platz ihrer Gruppe), keine zwei überlappen. Gerechnet wird direkt auf den
// DOM-Elementen — 60-mal je Sekunde durch React zu gehen, wäre für fünfzig Blasen zu teuer —, und sobald alles
// ruht, hört die Rechnung auf (kein Dauerlauf im Hintergrund). Die Lage der Blasen gehört dem Gerät: Geteilt
// werden Ideen, Stimmen und Gruppen, nicht Koordinaten.
//
// M378 — ausgebaut für Workshops und große Runden:
//   · Physik: Blasen haben Masse (große weichen kleinen kaum), lassen sich werfen, prallen weich von den Wänden;
//     Gruppen stehen in einem Raster nebeneinander statt auf einem Kreis, freie Ideen haben ihr eigenes Feld.
//   · Gruppieren mit der Hand: eine Blase auf eine Gruppe ziehen (hinein), auf eine andere Blase (neue Gruppe
//     aus beiden — oder verschmelzen), ins Freie (heraus). Gruppen lassen sich umbenennen, verschieben, auflösen.
//   · Moderation: vier Schritte (Sammeln · Gruppieren · Abstimmen · Ergebnis), für alle sichtbar; verdeckt und
//     anonym sammeln; Zwischenstand beim Abstimmen verbergen; Liste statt Blasen; Ergebnis als Notiz; Timer.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { NodeProps } from '@xyflow/react';
import { gruppeVon, GRUPPE_EREIGNIS, selectActiveBoard, useBoard, useKarteFest } from '../../store';
import type { BubblesNode } from '../../types';
import { uid } from '../../types';
import { ich, liveAuf, meineKennung } from '../../lib/gastSync';
import { timerStart } from '../../lib/gruppenraum';
import { makeNote } from '../../lib/nodes';
import { aiReady, askAi } from '../../lib/ai';
import {
  beteiligte, blasenRadius, blasenVon, BUBBLE_FARBEN, bubblesAlsBloecke, bubblesDaten, bubblesSchritt, geordnet, meinePunkte, rangfolge,
  type Blase, type BubbleRegeln, type BubbleSchritt, type BubblesData,
} from '../../lib/bubbles';
import { CardShell } from './CardShell';
import { DragTitle } from './DragTitle';

import { IBubbles, ITrash, IWand } from '../Icons';
interface Koerper { x: number; y: number; vx: number; vy: number; r: number; ziel: number; g: string | null; len: number; wort: number }
/**
 * M378: Radius des Kreises, den eine Gruppe mit diesen Blasen braucht (samt Luft für den Ring). Eine Blase: sie
 * selbst; zwei: nebeneinander; mehr: dichte Packung (Kreise füllen einen Kreis zu gut 60 %).
 */
function feldRadius(rs: number[]): number {
  if (rs.length === 0) return 30;
  if (rs.length === 1) return rs[0] + 12;
  if (rs.length === 2) return rs[0] + rs[1] + 2 + 12;
  return Math.sqrt(rs.reduce((s, r) => s + (r + 2) * (r + 2), 0) / 0.6) + 12;
}
const SCHRITTE: Array<[BubbleSchritt, string, string]> = [
  ['sammeln', 'Sammeln', 'Alle tragen Ideen ein'],
  ['gruppieren', 'Gruppieren', 'Die Sammlung ist geschlossen – Ideen ordnen und zusammenfassen'],
  ['abstimmen', 'Abstimmen', 'Jede Person vergibt ihre Punkte'],
  ['ergebnis', 'Ergebnis', 'Die Rangfolge steht fest'],
];

/** Zahl aus einer Kennung — gleiche Kennung, gleiche Zahl, auf jedem Gerät (für den Startplatz einer Blase) */
const zahlAus = (s: string): number => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; };

export function BubblesBody({ id, data: roh, gross = false }: { id: string; data: Partial<BubblesData>; gross?: boolean }) {
  const d = useMemo(() => bubblesDaten(roh), [roh]);
  const updateRoh = useBoard((s) => s.updateNodeData);
  /** Tabellen immer mit sortierten Schlüsseln schreiben (siehe lib/bubbles.ts: geordnet) */
  const updateNodeData = useCallback((kid: string, p: Partial<BubblesData>) => {
    const q: Record<string, unknown> = { ...p };
    if (p.ideen) q.ideen = geordnet(p.ideen);
    if (p.stimmen) q.stimmen = geordnet(p.stimmen);
    if (p.gruppen) q.gruppen = geordnet(p.gruppen);
    updateRoh(kid, q);
  }, [updateRoh]);
  const showToast = useBoard((s) => s.showToast);
  const boardId = useBoard((s) => s.activeId);
  const ai = useBoard((s) => s.ai);
  const fest = useKarteFest((roh as { von?: string }).von);
  // Wer bin ich in diesem Board? (In der Gruppe die Kennung der Gruppe, sonst die des Kontos oder Geräts)
  const [, gruppenTakt] = useState(0);
  useEffect(() => {
    const auf = () => gruppenTakt((n) => n + 1);
    window.addEventListener(GRUPPE_EREIGNIS, auf);
    return () => window.removeEventListener(GRUPPE_EREIGNIS, auf);
  }, []);
  const gruppe = gruppeVon(boardId);
  const wer = gruppe?.ich ?? meineKennung(false);
  /** Leiten (Abstimmung steuern, fremde Ideen löschen, Gruppen bilden) dürfen alle außer Gästen mit eingeschränktem Recht */
  const leiten = !fest && (!gruppe || !gruppe.gast || gruppe.recht === 'alles');

  const regeln: BubbleRegeln = d.regeln ?? { t: 0 };
  const schritt0 = bubblesSchritt(d);
  /** Verdeckt gesammelt wird nur, solange die Sammlung offen ist — mit dem nächsten Schritt liegt alles offen */
  const verdeckt = !!regeln.verdeckt && schritt0 === 'sammeln';
  /** Zwischenstand verbergen: beim Abstimmen zählt für die Anzeige nur, was ich selbst vergeben habe */
  const still = !!regeln.still && d.abstimmung.phase === 'offen';
  const blasen = useMemo(() => {
    const roh1 = blasenVon(d, wer, { jeAutor: verdeckt });
    return still ? roh1.map((b) => ({ ...b, punkte: b.meine })) : roh1;
  }, [d, wer, verdeckt, still]);
  /** Eine Blase, deren Wortlaut ich (noch) nicht sehe */
  const zu = useCallback((b: Blase) => verdeckt && !b.von.includes(wer), [verdeckt, wer]);
  const personen = useMemo(() => beteiligte(d), [d]);
  const gruppen = useMemo(() => Object.entries(d.gruppen).filter(([, g]) => g && !g.weg).sort((a, b) => a[1].t - b[1].t || a[0].localeCompare(b[0])), [d.gruppen]);
  const phase = d.abstimmung.phase;
  const vergeben = useMemo(() => meinePunkte(d, wer), [d, wer]);
  const uebrig = Math.max(0, d.abstimmung.punkte - vergeben);
  const rang = useMemo(() => (phase === 'fertig' ? rangfolge(blasen).filter((b) => b.punkte > 0) : []), [blasen, phase]);
  /**
   * Platz je Blase nach dem Auswerten: Die meisten Punkte sind Platz 1, gleiche Punktzahl teilt sich den Platz
   * (zwei Zweite, dann folgt der Vierte). Eine nackte Zahl an der Blase wurde als Platz gelesen, meinte aber
   * Punkte — darum steht jetzt beides ausdrücklich da: „1." für den Platz, „5 Punkte" für die Punkte.
   */
  const platz = useMemo(() => {
    const m = new Map<string, number>();
    rang.forEach((b, i) => m.set(b.id, i > 0 && rang[i - 1].punkte === b.punkte ? m.get(rang[i - 1].id)! : i + 1));
    return m;
  }, [rang]);
  const punkteText = (n: number) => `${n} ${n === 1 ? 'Punkt' : 'Punkte'}`;

  const [eingabe, setEingabe] = useState('');
  const [wahl, setWahl] = useState<string | null>(null);
  const [menue, setMenue] = useState(false);
  const [neuGruppe, setNeuGruppe] = useState('');
  const [bearbeite, setBearbeite] = useState<string | null>(null);
  const [kiLaeuft, setKiLaeuft] = useState(false);
  /** M378: gewählte Gruppe (Pille zum Umbenennen/Auflösen), Listenansicht, Frage nach dem Fallenlassen auf eine Blase */
  const [gWahl, setGWahl] = useState<string | null>(null);
  const [liste, setListe] = useState(false);
  const [fallen, setFallen] = useState<{ was: string; auf: string } | null>(null);
  const gewaehlt = wahl ? blasen.find((b) => b.id === wahl) ?? null : null;
  useEffect(() => { if (wahl && !blasen.some((b) => b.id === wahl)) setWahl(null); }, [wahl, blasen]);

  // ───── Ändern: immer nur die betroffenen Einträge, mit frischem Zeitstempel ─────
  const jetzt = () => Date.now();
  const ideeDazu = () => {
    const text = eingabe.trim().slice(0, 140);
    if (!text || fest) return;
    if (regeln.zu && !leiten) { showToast('Die Sammlung ist geschlossen – gerade wird gruppiert oder abgestimmt.'); return; }
    // anonym: der Name wird gar nicht erst vermerkt
    updateNodeData(id, { ideen: { ...d.ideen, [uid()]: { text, von: wer, ...(regeln.anonym ? {} : { name: ich().name }), t: jetzt() } } });
    setEingabe('');
  };
  const ideenAendern = (ids: string[], p: (alt: BubblesData['ideen'][string]) => Partial<BubblesData['ideen'][string]>) => {
    const ideen = { ...d.ideen };
    for (const i of ids) if (ideen[i]) ideen[i] = { ...ideen[i], ...p(ideen[i]), t: jetzt() };
    updateNodeData(id, { ideen });
  };
  const darfAendern = (b: Blase) => !fest && (leiten || b.von.every((v) => v === wer));
  const loeschen = (b: Blase) => { if (darfAendern(b)) { ideenAendern(b.ids, () => ({ weg: true })); setWahl(null); } };
  const inGruppe = (b: Blase, g: string | null) => { if (!fest) ideenAendern(b.ids, () => ({ g })); };
  /** Zwei Blasen in dieselbe (eben angelegte) Gruppe — `auf` steckt schon darin, `was` kommt dazu */
  const inGruppeMit = (was: Blase, auf: Blase, gid: string) => {
    if (fest) return;
    const t = jetzt();
    const ideen = { ...d.ideen };
    for (const i of [...was.ids, ...auf.ids]) if (ideen[i]) ideen[i] = { ...ideen[i], g: gid, t };
    // die Gruppe selbst steht seit gruppeAnlegen im Speicher, aber noch nicht in `d` — sie darf hier nicht überschrieben werden
    updateNodeData(id, { ideen });
  };
  const gruppeAnlegen = (name: string, fuer?: Blase): string | null => {
    const n = name.trim().slice(0, 40);
    if (!n || fest) return null;
    const gid = uid();
    const farbe = (gruppen.length ? Math.max(...gruppen.map(([, g]) => g.farbe)) + 1 : 0) % BUBBLE_FARBEN.length;
    const patch: Partial<BubblesData> = { gruppen: { ...d.gruppen, [gid]: { name: n, farbe, t: jetzt() } } };
    if (fuer) { const ideen = { ...d.ideen }; for (const i of fuer.ids) if (ideen[i]) ideen[i] = { ...ideen[i], g: gid, t: jetzt() }; patch.ideen = ideen; }
    updateNodeData(id, patch);
    return gid;
  };
  const gruppeWeg = (gid: string) => { if (leiten && d.gruppen[gid]) { updateNodeData(id, { gruppen: { ...d.gruppen, [gid]: { ...d.gruppen[gid], weg: true, t: jetzt() } } }); setGWahl(null); } };
  const gruppeUmbenennen = (gid: string, name: string) => {
    const n = name.trim().slice(0, 40);
    if (!n || fest || !d.gruppen[gid] || d.gruppen[gid].name === n) return;
    updateNodeData(id, { gruppen: { ...d.gruppen, [gid]: { ...d.gruppen[gid], name: n, t: jetzt() } } });
  };
  /** Zwei Ideen zu einer machen: Die gezogene übernimmt den Wortlaut der anderen — gleiche Texte verschmelzen von selbst */
  const verschmelzen = (was: Blase, auf: Blase) => {
    if (fest || !darfAendern(was)) { showToast('Verschmelzen kannst du nur deine eigenen Ideen – oder wer die Runde leitet.'); return; }
    ideenAendern(was.ids, () => ({ text: auf.text, g: auf.gruppe ?? null }));
    setWahl(auf.id);
  };
  const regelnSetzen = (p: Partial<BubbleRegeln>) => { if (leiten) updateNodeData(id, { regeln: { ...regeln, ...p, t: Math.max(jetzt(), regeln.t + 1) } }); };
  /** Zum Schritt wechseln (wer leitet): Sammeln öffnet die Eingabe, ab Gruppieren ist sie geschlossen */
  const schrittSetzen = (ziel: BubbleSchritt) => {
    if (!leiten || ziel === schritt0) return;
    const t = jetzt();
    const zuNeu = ziel !== 'sammeln';
    const phaseNeu: BubblesData['abstimmung']['phase'] = ziel === 'abstimmen' ? 'offen' : ziel === 'ergebnis' ? 'fertig' : 'aus';
    updateNodeData(id, {
      ...(zuNeu !== !!regeln.zu ? { regeln: { ...regeln, ...(zuNeu ? { zu: true } : { zu: false }), t: Math.max(t, regeln.t + 1) } } : {}),
      ...(phaseNeu !== d.abstimmung.phase ? { abstimmung: { ...d.abstimmung, phase: phaseNeu, t: Math.max(t, d.abstimmung.t + 1) } } : {}),
    });
  };
  /** Das Ergebnis als Notiz neben die Karte legen */
  const alsNotiz = () => {
    const st = useBoard.getState();
    const hier = selectActiveBoard(st)?.nodes.find((n) => n.id === id);
    const pos = hier ? { x: hier.position.x + ((hier.measured?.width ?? hier.width ?? 560) as number) + 40, y: hier.position.y } : { x: 0, y: 0 };
    st.addNode(makeNote(pos, { color: 'white', blocks: bubblesAlsBloecke(d) as never }));
    showToast('Ergebnis als Notiz neben die Karte gelegt.');
  };
  const stimme = (b: Blase, dazu: 1 | -1) => {
    if (fest || phase !== 'offen') return;
    if (dazu === 1 && uebrig <= 0) { showToast(`Alle ${d.abstimmung.punkte} Punkte sind vergeben – tippe auf deine Punkte an einer Blase, um einen zurückzunehmen.`); return; }
    // Meine Punkte liegen an der Idee, auf die ich getippt habe; beim Zurücknehmen von irgendeiner in dieser Blase
    const stimmen = { ...d.stimmen };
    if (dazu === 1) {
      const k = `${b.id}|${wer}`;
      stimmen[k] = { n: (stimmen[k]?.n ?? 0) + 1, t: jetzt() };
    } else {
      const k = b.ids.map((i) => `${i}|${wer}`).find((x) => (stimmen[x]?.n ?? 0) > 0);
      if (!k) return;
      stimmen[k] = { n: stimmen[k].n - 1, t: jetzt() };
    }
    updateNodeData(id, { stimmen });
  };
  const phaseSetzen = (p: BubblesData['abstimmung']['phase']) => { if (leiten) updateNodeData(id, { abstimmung: { ...d.abstimmung, phase: p, t: jetzt() } }); };
  const punkteSetzen = (n: number) => { if (leiten) updateNodeData(id, { abstimmung: { ...d.abstimmung, punkte: Math.min(10, Math.max(1, n)), t: jetzt() } }); };
  const stimmenWeg = () => {
    if (!leiten) return;
    const stimmen: BubblesData['stimmen'] = {};
    for (const [k, s] of Object.entries(d.stimmen)) stimmen[k] = { n: 0, t: Math.max(jetzt(), s.t + 1) };
    updateNodeData(id, { stimmen, abstimmung: { ...d.abstimmung, phase: 'aus', t: jetzt() } });
  };
  const allesWeg = () => {
    if (!leiten) return;
    const ideen: BubblesData['ideen'] = {};
    for (const [k, i] of Object.entries(d.ideen)) ideen[k] = { ...i, weg: true, t: Math.max(jetzt(), i.t + 1) };
    updateNodeData(id, { ideen });
    setWahl(null);
  };

  /** Die KI schlägt Gruppen vor (nur mit hinterlegtem KI-Zugang; die Texte gehen dann an diesen Anbieter) */
  const kiGruppen = async () => {
    if (kiLaeuft || blasen.length < 3 || !leiten) return;
    setKiLaeuft(true);
    try {
      const liste = blasen.map((b, i) => `${i + 1}. ${b.text}`).join('\n');
      const antwort = await askAi(`Ordne diese Ideen aus einem Workshop in 2 bis 6 thematische Gruppen. Jede Idee in genau eine Gruppe. Gruppennamen kurz (1–3 Wörter), in der Sprache der Ideen.\n${d.frage ? `Fragestellung: ${d.frage}\n` : ''}\nIdeen:\n${liste}\n\nAntworte NUR mit JSON in dieser Form, ohne Erklärung: [{"name":"…","ideen":[1,2]}]`);
      const roh0 = antwort.slice(antwort.indexOf('['), antwort.lastIndexOf(']') + 1);
      const vorschlag = JSON.parse(roh0) as Array<{ name?: unknown; ideen?: unknown }>;
      const t = jetzt();
      const neueGruppen = { ...d.gruppen };
      for (const [gid, g] of Object.entries(neueGruppen)) if (!g.weg) neueGruppen[gid] = { ...g, weg: true, t };
      const ideen = { ...d.ideen };
      let n = 0;
      for (const v of vorschlag) {
        if (typeof v.name !== 'string' || !Array.isArray(v.ideen)) continue;
        const gid = uid();
        neueGruppen[gid] = { name: v.name.trim().slice(0, 40) || 'Gruppe', farbe: n % BUBBLE_FARBEN.length, t: t + n };
        n += 1;
        for (const nr of v.ideen) {
          const b = blasen[Number(nr) - 1];
          if (b) for (const i of b.ids) if (ideen[i]) ideen[i] = { ...ideen[i], g: gid, t };
        }
      }
      if (!n) throw new Error('leer');
      updateNodeData(id, { gruppen: neueGruppen, ideen });
    } catch {
      showToast('Die KI hat keine brauchbaren Gruppen geliefert – bitte noch einmal versuchen oder von Hand gruppieren.');
    } finally { setKiLaeuft(false); }
  };

  // ───── Physik ─────
  const buehne = useRef<HTMLDivElement | null>(null);
  const koerper = useRef(new Map<string, Koerper>());
  const knoten = useRef(new Map<string, HTMLElement>());
  const ringe = useRef(new Map<string, HTMLElement>());
  const namen = useRef(new Map<string, HTMLElement>());
  const mass = useRef({ w: 600, h: 360 });
  const zug = useRef<{ id: string; dx: number; dy: number; bewegt: boolean; vx: number; vy: number; px: number; py: number; pt: number } | null>(null);
  /** M378: Gruppen, die ich auf DIESEM Gerät von Hand verschoben habe (Board-unabhängig, nicht geteilt) */
  const versatz = useRef(new Map<string, { x: number; y: number }>());
  /** gibt es freie Blasen neben Gruppen? Dann bekommen sie ein eigenes Feld im Raster */
  const freiRef = useRef(false);
  /** worüber die gezogene Blase gerade schwebt (nur Anzeige: Ziel hervorheben) */
  const zielEl = useRef<HTMLElement | null>(null);
  const lauf = useRef<number | null>(null);
  const ruhe = useRef(0);
  const gruppenRef = useRef<string[]>([]);
  gruppenRef.current = gruppen.map(([g]) => g);
  const ruhig = useMemo(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches, []);

  /**
   * Wo eine Blase hingehört. Ohne Gruppen: die Mitte. Mit Gruppen bekommt jede ein eigenes Feld der Bühne — so
   * groß, wie ihre Blasen Platz brauchen — und, wenn es freie Ideen gibt, auch diese eines (felderLegen). Der
   * Anker ist die Mitte des Felds. Eine von Hand verschobene Gruppe bleibt, wo man sie hingelegt hat.
   */
  const felder = useRef(new Map<string, { x: number; y: number }>());
  const anker = useCallback((g: string | null): { x: number; y: number } => {
    const { w, h } = mass.current;
    if (g) { const v = versatz.current.get(g); if (v) return { x: Math.min(Math.max(v.x, 30), w - 30), y: Math.min(Math.max(v.y, 30), h - 30) }; }
    return felder.current.get(g ?? '') ?? { x: w / 2, y: h / 2 };
  }, []);
  /**
   * Die Bühne in Felder teilen: Die Felder werden nach Gewicht (Fläche der Blasen) in zwei etwa gleich schwere
   * Hälften geteilt, das Rechteck entlang seiner längeren Seite im selben Verhältnis — und so weiter, bis jedes
   * Feld allein steht. Große Gruppen bekommen viel Platz, kleine wenig, und alle Felder bleiben annähernd
   * quadratisch. (Ein Raster gleich großer Felder ließe eine große Gruppe über ihre Nachbarn quellen.)
   */
  const felderLegen = useCallback(() => {
    const { w, h } = mass.current;
    felder.current.clear();
    const gs = gruppenRef.current;
    if (!gs.length) return;
    const mitglieder = new Map<string, number[]>();
    for (const g of gs) mitglieder.set(g, []);
    const freie: number[] = [];
    for (const k of koerper.current.values()) { if (k.g && mitglieder.has(k.g)) mitglieder.get(k.g)!.push(k.ziel); else freie.push(k.ziel); }
    // Gewicht = die Fläche des Kreises, den die Gruppe braucht (nicht die ihrer Blasen)
    const zonen: Array<{ k: string; m: number }> = gs.map((g) => ({ k: g, m: feldRadius(mitglieder.get(g)!) ** 2 }));
    if (freiRef.current) zonen.push({ k: '', m: feldRadius(freie) ** 2 });
    const teilen = (liste: Array<{ k: string; m: number }>, x: number, y: number, bw: number, bh: number): void => {
      if (liste.length === 1) { felder.current.set(liste[0].k, { x: x + bw / 2, y: y + bh / 2 }); return; }
      const summe = liste.reduce((s0, z) => s0 + z.m, 0);
      // Reihenfolge der Gruppen bleibt (links/oben die ersten): an der Stelle teilen, die den Hälften am nächsten kommt
      let bis = 1; let links = liste[0].m; let beste = Math.abs(summe / 2 - links);
      for (let i = 1, lauf0 = links; i < liste.length - 1; i++) { lauf0 += liste[i].m; const ab = Math.abs(summe / 2 - lauf0); if (ab < beste) { beste = ab; bis = i + 1; links = lauf0; } }
      const anteil = Math.min(0.8, Math.max(0.2, links / summe));
      if (bw >= bh) { teilen(liste.slice(0, bis), x, y, bw * anteil, bh); teilen(liste.slice(bis), x + bw * anteil, y, bw * (1 - anteil), bh); }
      else { teilen(liste.slice(0, bis), x, y, bw, bh * anteil); teilen(liste.slice(bis), x, y + bh * anteil, bw, bh * (1 - anteil)); }
    };
    teilen(zonen, 0, 0, w, h);
  }, []);

  /** Die Gruppe als Scheibe: Mitte ihrer Blasen und der Radius bis zur äußersten (mit etwas Luft) — oder null, wenn leer */
  const scheibe = useCallback((gid: string, ohne?: string): { x: number; y: number; r: number } => {
    // Mitte nach Fläche gewichtet: Eine große Blase zieht die Mitte zu sich — so bleibt der Ring eng um die Gruppe
    let n = 0; let sx = 0; let sy = 0;
    for (const [kid, k] of koerper.current) if (k.g === gid && kid !== ohne) { const m = k.r * k.r; n += m; sx += k.x * m; sy += k.y * m; }
    if (!n) { const a = anker(gid); return { x: a.x, y: a.y, r: 30 }; }   // leere Gruppe: ein Platz zum Hineinziehen
    const x = sx / n; const y = sy / n;
    let r = 0;
    for (const [kid, k] of koerper.current) if (k.g === gid && kid !== ohne) r = Math.max(r, Math.hypot(k.x - x, k.y - y) + k.r);
    return { x, y, r: r + 12 };
  }, [anker]);

  const zeichnen = useCallback(() => {
    for (const [bid, k] of koerper.current) {
      const el = knoten.current.get(bid);
      if (!el) continue;
      el.style.transform = `translate(${(k.x - k.r).toFixed(1)}px, ${(k.y - k.r).toFixed(1)}px)`;
      const dm = `${(k.r * 2).toFixed(1)}px`;
      if (el.style.width !== dm) {
        el.style.width = dm; el.style.height = dm;
        // Schrift so groß, dass der Text in die Blase passt: das längste Wort in die Breite, alles zusammen in die Höhe
        const fs = Math.min(gross ? 26 : 16, k.r * Math.sqrt(1.4 / Math.max(4, k.len)), (k.r * 1.56) / (Math.max(4, k.wort) * 0.6));
        el.style.fontSize = `${Math.max(7.5, fs).toFixed(1)}px`;
      }
    }
    // Ringe um die Gruppen: Mitte der Mitglieder, Radius bis zur äußersten Blase. Der Name sitzt am oberen Rand
    // des Rings — aber immer in der Bühne, auch wenn der Ring oben hinausragt.
    const { w, h } = mass.current;
    for (const gid of gruppenRef.current) {
      const el = ringe.current.get(gid); const nm = namen.current.get(gid);
      const s0 = scheibe(gid, zug.current?.bewegt ? zug.current.id : undefined);
      if (el) {
        el.style.opacity = '1';
        el.style.transform = `translate(${(s0.x - s0.r).toFixed(1)}px, ${(s0.y - s0.r).toFixed(1)}px)`;
        el.style.width = `${(s0.r * 2).toFixed(1)}px`; el.style.height = `${(s0.r * 2).toFixed(1)}px`;
      }
      if (nm) {
        nm.style.opacity = '1';
        const halb = nm.offsetWidth / 2;
        // oben am Ring; ragt der Ring oben hinaus, unten — und wenn auch das nicht passt, oben an der Kante der Bühne
        const oben = s0.y - s0.r - 9; const unten = s0.y + s0.r - 9;
        const y = oben >= 3 ? oben : unten <= h - 22 ? unten : 3;
        nm.style.transform = `translate(${Math.min(Math.max(s0.x - halb, 4), Math.max(4, w - nm.offsetWidth - 4)).toFixed(1)}px, ${y.toFixed(1)}px)`;
      }
    }
  }, [gross, scheibe]);

  const schritt = useCallback((): number => {
    const { w, h } = mass.current;
    const ks = [...koerper.current.entries()];
    const gezogen = zug.current?.id;
    // 1) Kräfte: jede Blase zu ihrem Anker — große etwas stärker (sie sammeln sich in der Mitte, kleine legen sich
    //    außen an); Gruppen als Ganzes auseinander, in sich zusammen; freie aus den Feldern der Gruppen
    let rMax = 1;
    for (const [, k] of ks) if (k.ziel > rMax) rMax = k.ziel;
    for (const [bid, k] of ks) {
      k.r += (k.ziel - k.r) * 0.18;
      if (bid === gezogen) { k.vx = 0; k.vy = 0; continue; }
      const a = anker(k.g);
      const zugkraft = 0.0045 + 0.004 * (k.ziel / rMax);
      k.vx += (a.x - k.x) * zugkraft; k.vy += (a.y - k.y) * zugkraft;
    }
    const gs = gruppenRef.current;
    if (gs.length) {
      const sch = gs.map((g) => ({ g, s: scheibe(g, zug.current?.bewegt ? zug.current.id : undefined) }));
      for (let i = 0; i < sch.length; i++) {
        for (let j = i + 1; j < sch.length; j++) {
          const a = sch[i].s; const b = sch[j].s;
          let dx = b.x - a.x; let dy = b.y - a.y; let dist = Math.hypot(dx, dy);
          const tiefe = a.r + b.r + 8 - dist;
          if (tiefe <= 0) continue;
          if (dist < 0.01) { dx = 1; dy = 0; dist = 1; }
          const sx = (dx / dist) * tiefe * 0.11; const sy = (dy / dist) * tiefe * 0.11;
          for (const [bid, k] of ks) {
            if (bid === gezogen) continue;
            if (k.g === sch[i].g) { k.vx -= sx; k.vy -= sy; } else if (k.g === sch[j].g) { k.vx += sx; k.vy += sy; }
          }
        }
      }
      for (const { g, s: c } of sch) {
        // … und als Ganzes in die Bühne: Ragt der Ring über einen Rand, rückt die ganze Gruppe herein
        const rx = c.x - c.r < 3 ? 3 - (c.x - c.r) : c.x + c.r > w - 3 ? (w - 3) - (c.x + c.r) : 0;
        const ry = c.y - c.r < 3 ? 3 - (c.y - c.r) : c.y + c.r > h - 3 ? (h - 3) - (c.y + c.r) : 0;
        for (const [bid, k] of ks) if (k.g === g && bid !== gezogen) { k.vx += (c.x - k.x) * 0.012 + rx * 0.05; k.vy += (c.y - k.y) * 0.012 + ry * 0.05; }
      }
      for (const [bid, k] of ks) {
        if (k.g || bid === gezogen) continue;
        // Freie Blasen gehören in ihr eigenes Feld: aus den Feldern der Gruppen hinaus — und dabei nicht nur von
        // deren Mitte weg, sondern auch auf das eigene Feld zu (sonst bliebe eine zwischen zwei Gruppen stecken)
        const a = anker(null); const ax = a.x - k.x; const ay = a.y - k.y; const an = Math.hypot(ax, ay) || 1;
        for (const { s: c } of sch) {
          const dx = k.x - c.x; const dy = k.y - c.y; const dist = Math.hypot(dx, dy) || 1;
          const tiefe = c.r + k.r + 4 - dist;
          if (tiefe > 0) { k.vx += (dx / dist) * tiefe * 0.05 + (ax / an) * Math.min(tiefe, 40) * 0.05; k.vy += (dy / dist) * tiefe * 0.05 + (ay / an) * Math.min(tiefe, 40) * 0.05; }
        }
      }
    }
    // 2) Bewegen (gedämpft)
    let energie = 0;
    for (const [bid, k] of ks) {
      if (bid !== gezogen) {
        k.vx *= 0.86; k.vy *= 0.86;
        // nie schneller als gut ein Radius je Bild (sonst spränge eine geworfene Blase durch andere hindurch)
        const v = Math.hypot(k.vx, k.vy); const vMax = Math.max(18, k.r * 1.2);
        if (v > vMax) { k.vx *= vMax / v; k.vy *= vMax / v; }
        k.x += k.vx; k.y += k.vy;
      }
      energie += k.vx * k.vx + k.vy * k.vy + Math.abs(k.ziel - k.r) * 0.05;
    }
    // 3) Überlappungen auflösen — als Letztes und zweimal, damit im Ruhezustand wirklich keine bleibt —, dann die
    //    Wände. Jede Blase weicht im umgekehrten Verhältnis ihrer Masse (Fläche): Eine große schiebt eine kleine
    //    beiseite und rührt sich selbst kaum. Die gezogene Blase schwebt über den anderen — sie soll irgendwo
    //    fallen gelassen werden können (auf eine Gruppe, auf eine andere Blase), statt alles vor sich herzuschieben.
    for (let runde = 0; runde < 2; runde++) {
      for (let i = 0; i < ks.length; i++) {
        if (ks[i][0] === gezogen) continue;
        for (let j = i + 1; j < ks.length; j++) {
          if (ks[j][0] === gezogen) continue;
          const a = ks[i][1]; const b = ks[j][1];
          let dx = b.x - a.x; let dy = b.y - a.y; let dist = Math.hypot(dx, dy);
          const soll = a.r + b.r + (a.g === b.g ? 4 : 12);
          if (dist >= soll) continue;
          if (dist < 0.01) { dx = zahlAus(ks[i][0]) - 0.5; dy = zahlAus(ks[j][0]) - 0.5; dist = Math.hypot(dx, dy) || 1; }
          const nx = dx / dist; const ny = dy / dist; const tiefe = soll - dist;
          const ma = a.r * a.r; const mb = b.r * b.r;
          const ta = mb / (ma + mb);          // Anteil, den a weicht
          a.x -= nx * tiefe * ta; a.y -= ny * tiefe * ta;
          b.x += nx * tiefe * (1 - ta); b.y += ny * tiefe * (1 - ta);
          // was aufeinander zuläuft, tauscht Schwung (nach Masse) und verliert dabei etwas — sonst federten die Blasen ewig
          const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (rel < 0) { const st = rel * 0.9; a.vx += nx * st * ta; a.vy += ny * st * ta; b.vx -= nx * st * (1 - ta); b.vy -= ny * st * (1 - ta); }
        }
      }
      for (const [bid, k] of ks) {
        if (bid === gezogen) continue;
        const xMin = k.r + 4; const xMax = Math.max(xMin, w - k.r - 4); const yMin = k.r + 4; const yMax = Math.max(yMin, h - k.r - 4);
        // weich von der Wand zurück
        if (k.x < xMin) { k.x = xMin; if (k.vx < 0) k.vx *= -0.35; } else if (k.x > xMax) { k.x = xMax; if (k.vx > 0) k.vx *= -0.35; }
        if (k.y < yMin) { k.y = yMin; if (k.vy < 0) k.vy *= -0.35; } else if (k.y > yMax) { k.y = yMax; if (k.vy > 0) k.vy *= -0.35; }
      }
    }
    return ks.length ? energie / ks.length : 0;
  }, [anker, scheibe]);

  const wecken = useCallback(() => {
    ruhe.current = 0;
    if (ruhig) { for (let i = 0; i < 400; i++) if (schritt() < 0.002 && i > 30) break; zeichnen(); return; }
    if (lauf.current != null) return;
    const bild = () => {
      const e = schritt();
      zeichnen();
      ruhe.current = e < 0.004 && !zug.current ? ruhe.current + 1 : 0;
      if (ruhe.current > 45) { lauf.current = null; return; }   // alles ruht: Schluss mit Rechnen
      lauf.current = requestAnimationFrame(bild);
    };
    lauf.current = requestAnimationFrame(bild);
  }, [ruhig, schritt, zeichnen]);
  useEffect(() => () => { if (lauf.current != null) cancelAnimationFrame(lauf.current); }, []);

  /**
   * Radien an den Platz anpassen: Die Blasen sollen die Bühne gut füllen, aber nie überfüllen — zusammen höchstens
   * gut ein Drittel der Fläche (bei Gruppen etwas weniger, die Ringe brauchen Luft). Wenige Blasen auf einer
   * großen Bühne (Folie) dürfen wachsen.
   */
  const blasenRef = useRef(blasen);
  blasenRef.current = blasen;
  const radienSetzen = useCallback(() => {
    const { w, h } = mass.current;
    const bs = blasenRef.current;
    const roh = bs.map((b) => blasenRadius(b, bs.length, 1));
    const flaeche = roh.reduce((s, r) => s + Math.PI * r * r, 0);
    const voll = flaeche / Math.max(1, w * h);
    freiRef.current = gruppenRef.current.length > 0 && bs.some((b) => !b.gruppe);
    const anzahlFelder = gruppenRef.current.length + (freiRef.current ? 1 : 0);
    const ziel = anzahlFelder > 1 ? 0.3 : 0.38;
    let f = voll > ziel ? Math.sqrt(ziel / voll) : gross ? Math.min(1.7, Math.sqrt(ziel / Math.max(voll, 0.01))) : 1;
    // keine Blase breiter als die halbe kurze Seite
    const groesste = Math.max(0, ...roh) * f;
    if (groesste > Math.min(w, h) * 0.3) f *= (Math.min(w, h) * 0.3) / groesste;
    // Mit Gruppen zählt nicht die Fläche der Blasen, sondern die der FELDER: Jede Gruppe braucht den Kreis um ihre
    // Blasen (zwei Blasen nebeneinander füllen ihn nur zur Hälfte). Alle Felder zusammen sollen gut die halbe
    // Bühne belegen — dann stehen sie nebeneinander, ohne über den Rand oder ineinander zu ragen.
    if (anzahlFelder > 1) {
      const zonen = new Map<string, number[]>();
      for (const g of gruppenRef.current) zonen.set(g, []);
      bs.forEach((b, i) => { const k = b.gruppe && zonen.has(b.gruppe) ? b.gruppe : ''; if (!zonen.has(k)) zonen.set(k, []); zonen.get(k)!.push(roh[i]); });
      const belegt = (ff: number): number => { let a = 0; for (const rs of zonen.values()) { const r = feldRadius(rs.map((x) => x * ff)); a += Math.PI * r * r; } return a; };
      const platz = w * h * 0.5;
      if (belegt(f) > platz) {
        let lo = f * 0.25; let hi = f;
        for (let i = 0; i < 14; i++) { const m = (lo + hi) / 2; if (belegt(m) > platz) hi = m; else lo = m; }
        f = lo;
      }
    }
    const da = new Set(bs.map((b) => b.id));
    for (const k of [...koerper.current.keys()]) if (!da.has(k)) koerper.current.delete(k);
    bs.forEach((b, i) => {
      const len = b.text.length; const wort = Math.max(...b.text.split(/[\s-]+/).map((x) => x.length));
      // nie so klein, dass das längste Wort nicht mehr lesbar hineinpasst
      const zielR = Math.max(14, roh[i] * f, Math.min(wort, 16) * 2.9);
      const k = koerper.current.get(b.id);
      if (k) { k.ziel = zielR; k.g = b.gruppe; k.len = len; k.wort = wort; return; }
      // Neue fliegen vom Rand herein — von einer Stelle, die aus ihrer Kennung folgt (auf jedem Gerät dieselbe)
      const winkel = zahlAus(b.id) * Math.PI * 2;
      koerper.current.set(b.id, { x: w / 2 + Math.cos(winkel) * w * 0.42, y: h / 2 + Math.sin(winkel) * h * 0.42, vx: 0, vy: 0, r: zielR * 0.4, ziel: zielR, g: b.gruppe, len, wort });
    });
    felderLegen();
    wecken();
  }, [gross, wecken, felderLegen]);

  // Größe der Bühne (Layout-Maß, unabhängig vom Zoom des Boards)
  useEffect(() => {
    const el = buehne.current;
    if (!el) return;
    const messen = () => {
      const w = el.offsetWidth || 600; const h = el.offsetHeight || 360;
      if (w !== mass.current.w || h !== mass.current.h) { mass.current = { w, h }; versatz.current.clear(); radienSetzen(); }
    };
    messen();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(messen);
    ro.observe(el);
    return () => ro.disconnect();
  }, [radienSetzen]);

  // Blasen ↔ Körper abgleichen: Verschwundene fallen weg, Radius und Gruppe folgen
  useEffect(() => { radienSetzen(); }, [blasen, radienSetzen, gruppen.length]);

  // Ziehen: die Blase folgt dem Zeiger; losgelassen über einer anderen Gruppe wechselt sie dorthin
  const punkt = (e: { clientX: number; clientY: number }) => {
    const el = buehne.current!; const r = el.getBoundingClientRect();
    const s = r.width / (el.offsetWidth || 1) || 1;
    return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s };
  };
  /** Was liegt an dieser Stelle der Bühne? Eine andere Blase, sonst eine Gruppe, sonst nichts (das Freie) */
  const zielAn = (p: { x: number; y: number }, ausser: string): { blase?: string; gruppe?: string } => {
    let beste: string | undefined; let ab = Infinity;
    for (const [kid, k] of koerper.current) {
      if (kid === ausser) continue;
      const a = Math.hypot(p.x - k.x, p.y - k.y);
      if (a < k.r && a < ab) { ab = a; beste = kid; }
    }
    if (beste) return { blase: beste };
    let gBeste: string | undefined; ab = Infinity;
    for (const gid of gruppenRef.current) {
      const c = scheibe(gid, ausser);     // ohne die gezogene selbst — sonst zöge sie den Ring ihrer Gruppe einfach mit
      const a = Math.hypot(p.x - c.x, p.y - c.y);
      if (a < c.r + 8 && a < ab) { ab = a; gBeste = gid; }
    }
    return gBeste ? { gruppe: gBeste } : {};
  };
  const zielZeigen = (z: { blase?: string; gruppe?: string }) => {
    const el = z.blase ? knoten.current.get(z.blase) : z.gruppe ? ringe.current.get(z.gruppe) : null;
    if (el === zielEl.current) return;
    zielEl.current?.classList.remove('ziel');
    zielEl.current = el ?? null;
    el?.classList.add('ziel');
  };
  const ziehStart = (e: React.PointerEvent, b: Blase) => {
    if (e.button !== 0) return;
    const k = koerper.current.get(b.id); if (!k) return;
    const p = punkt(e);
    zug.current = { id: b.id, dx: k.x - p.x, dy: k.y - p.y, bewegt: false, vx: 0, vy: 0, px: p.x, py: p.y, pt: performance.now() };
    const start = { x: e.clientX, y: e.clientY };
    const el = knoten.current.get(b.id);
    const bewegen = (ev: PointerEvent) => {
      const z = zug.current; if (!z) return;
      if (!z.bewegt && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5) return;
      if (!z.bewegt) { z.bewegt = true; el?.classList.add('zieht'); }
      const q = punkt(ev); const kk = koerper.current.get(z.id);
      if (kk) { kk.x = q.x + z.dx; kk.y = q.y + z.dy; }
      // Schwung mitschreiben (geglättet) — beim Loslassen fliegt die Blase weiter
      const jetzt0 = performance.now(); const dt = Math.max(8, jetzt0 - z.pt);
      z.vx = z.vx * 0.6 + ((q.x - z.px) / dt) * 16 * 0.4; z.vy = z.vy * 0.6 + ((q.y - z.py) / dt) * 16 * 0.4;
      z.px = q.x; z.py = q.y; z.pt = jetzt0;
      if (!fest) zielZeigen(zielAn(q, z.id));
      wecken();
    };
    const ende = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', bewegen); window.removeEventListener('pointerup', ende); window.removeEventListener('pointercancel', ende);
      const z = zug.current; zug.current = null;
      el?.classList.remove('zieht'); zielZeigen({});
      if (!z) return;
      if (!z.bewegt) { tippen(b); return; }
      const kk = koerper.current.get(z.id);
      // Wurf: nur, wenn der Zeiger bis zuletzt in Bewegung war
      if (kk && performance.now() - z.pt < 90) { kk.vx = Math.max(-32, Math.min(32, z.vx * 1.3)); kk.vy = Math.max(-32, Math.min(32, z.vy * 1.3)); }
      if (kk && !fest && ev.type !== 'pointercancel') {
        const ziel = zielAn(punkt(ev), z.id);
        if (ziel.blase) {
          const andere = blasenRef.current.find((x) => x.id === ziel.blase);
          if (andere?.gruppe) { if (andere.gruppe !== b.gruppe) inGruppe(b, andere.gruppe); }
          else if (andere) setFallen({ was: b.id, auf: andere.id });    // zwei freie Ideen: nachfragen, was gemeint ist
        } else if (ziel.gruppe) { if (ziel.gruppe !== b.gruppe) inGruppe(b, ziel.gruppe); }
        else if (b.gruppe) inGruppe(b, null);                           // ins Freie gezogen: heraus aus der Gruppe
      }
      wecken();
    };
    window.addEventListener('pointermove', bewegen); window.addEventListener('pointerup', ende); window.addEventListener('pointercancel', ende);
  };
  /** Eine Gruppe an ihrem Namen fassen und verschieben (nur auf diesem Gerät); ein Tipp öffnet ihre Möglichkeiten */
  const gruppeZiehen = (e: React.PointerEvent, gid: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const start = { x: e.clientX, y: e.clientY };
    const c0 = scheibe(gid); const p0 = punkt(e);
    let bewegt = false;
    const bewegen = (ev: PointerEvent) => {
      if (!bewegt && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5) return;
      bewegt = true;
      const q = punkt(ev);
      versatz.current.set(gid, { x: c0.x + (q.x - p0.x), y: c0.y + (q.y - p0.y) });
      wecken();
    };
    const ende = () => {
      window.removeEventListener('pointermove', bewegen); window.removeEventListener('pointerup', ende); window.removeEventListener('pointercancel', ende);
      if (!bewegt) { setGWahl((g) => (g === gid ? null : gid)); setWahl(null); setMenue(false); setFallen(null); }
    };
    window.addEventListener('pointermove', bewegen); window.addEventListener('pointerup', ende); window.addEventListener('pointercancel', ende);
  };
  const tippen = (b: Blase) => {
    if (phase === 'offen' && !fest) { stimme(b, 1); return; }
    if (zu(b)) { showToast('Diese Idee ist noch verdeckt – sie wird sichtbar, sobald die Sammlung endet.'); return; }
    setWahl((w) => (w === b.id ? null : b.id)); setMenue(false); setBearbeite(null); setGWahl(null); setFallen(null);
  };
  // Verschwundenes vergessen
  // (Eine eben angelegte Gruppe kommt erst mit dem nächsten Durchlauf in den Daten an — darum wird die Wahl hier
  //  nicht „aufgeräumt": gGewaehlt ist einfach leer, solange es die Gruppe nicht gibt.)
  useEffect(() => { if (fallen && !(blasen.some((b) => b.id === fallen.was) && blasen.some((b) => b.id === fallen.auf))) setFallen(null); }, [fallen, blasen]);
  // Eine Idee wurde ein weiteres Mal genannt (oder hat Punkte bekommen): Die Blase gibt einen kurzen Puls ab
  const gewicht = useRef(new Map<string, number>());
  useEffect(() => {
    for (const b of blasen) {
      const neu = b.mal * 1000 + b.punkte; const alt = gewicht.current.get(b.id);
      gewicht.current.set(b.id, neu);
      if (alt !== undefined && neu > alt && !ruhig) {
        knoten.current.get(b.id)?.animate?.([{ boxShadow: '0 0 0 0 rgba(255,255,255,.95)' }, { boxShadow: '0 0 0 16px rgba(255,255,255,0)' }], { duration: 620, easing: 'ease-out' });
      }
    }
  }, [blasen, ruhig]);
  const fallenWas = fallen ? blasen.find((b) => b.id === fallen.was) ?? null : null;
  const fallenAuf = fallen ? blasen.find((b) => b.id === fallen.auf) ?? null : null;
  const gGewaehlt = gWahl ? gruppen.find(([g]) => g === gWahl) ?? null : null;
  /** Für die Liste: Gruppen der Reihe nach, darin die Ideen nach Punkten, zuletzt die freien */
  const abschnitte = useMemo(() => {
    if (!liste) return [];
    const sortiert = rangfolge(blasen);
    const aus = gruppen.map(([gid, g]) => ({ gid: gid as string | null, name: g.name, farbe: BUBBLE_FARBEN[g.farbe % BUBBLE_FARBEN.length], ideen: sortiert.filter((b) => b.gruppe === gid) }));
    const frei = sortiert.filter((b) => !b.gruppe);
    if (frei.length || !aus.length) aus.push({ gid: null, name: gruppen.length ? 'Ohne Gruppe' : '', farbe: '#7b8494', ideen: frei });
    return aus;
  }, [liste, blasen, gruppen]);

  const farbeVon = (b: Blase, i: number): string => {
    const g = b.gruppe ? d.gruppen[b.gruppe] : null;
    // Gibt es Gruppen, sagt die Farbe „gehört zu …" — eine freie Blase ist dann neutral
    if (!g && gruppen.length) return '#7b8494';
    return BUBBLE_FARBEN[(g ? g.farbe : i) % BUBBLE_FARBEN.length];
  };

  return (
    <div className={`bub ${gross ? 'gross' : ''}`} data-ohne-sperre="" data-taste="bubbles">
      <div className="bub-frage">
        <input
          className="bub-frage-feld nodrag" value={d.frage ?? ''} disabled={fest} placeholder="Worum geht es? Frage hier eintragen …" translate="no"
          onChange={(e) => updateNodeData(id, { frage: e.target.value.slice(0, 160) })} data-taste="bub-frage"
          enterKeyHint="done" onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        />
        <span className="bub-zahl" data-taste="bub-zahl">{blasen.length} {blasen.length === 1 ? 'Idee' : 'Ideen'}{personen > 1 ? ` · ${personen} Personen` : ''}</span>
        <button className={`bub-ansicht nodrag${liste ? ' an' : ''}`} onClick={() => { setListe((l) => !l); setWahl(null); setGWahl(null); setFallen(null); }} aria-pressed={liste}
          title={liste ? 'Zurück zu den Blasen' : 'Als Liste zeigen – nach Gruppen und Punkten geordnet'} data-taste="bub-ansicht">{liste ? <IBubbles size={15} /> : '☰'}</button>
      </div>
      {/* M378: Wo steht die Runde? Für alle sichtbar; wer leitet, schaltet weiter */}
      <div className="bub-schritte nodrag" role="group" aria-label="Ablauf" data-taste="bub-schritte">
        {SCHRITTE.map(([k, name, hinweis], i) => (
          <button key={k} className={`bub-schritt${k === schritt0 ? ' jetzt' : ''}${SCHRITTE.findIndex(([x]) => x === schritt0) > i ? ' war' : ''}`} disabled={!leiten}
            aria-current={k === schritt0 ? 'step' : undefined} title={leiten ? `${hinweis} – hierhin schalten` : hinweis} data-taste="bub-schritt" data-schritt={k}
            onClick={() => schrittSetzen(k)}><i>{i + 1}</i>{name}</button>
        ))}
        {(regeln.verdeckt || regeln.anonym || regeln.still) && (
          <span className="bub-regeln" data-taste="bub-regeln" title="So ist diese Runde eingestellt (⋯)">
            {[regeln.verdeckt ? 'verdeckt' : '', regeln.anonym ? 'anonym' : '', regeln.still ? 'Stand verborgen' : ''].filter(Boolean).join(' · ')}
          </span>
        )}
      </div>
      <div className="bub-buehne nodrag nopan" ref={buehne} onPointerDown={(e) => { if (e.target === e.currentTarget) { setWahl(null); setMenue(false); setGWahl(null); setFallen(null); } }}>
        {gruppen.map(([gid, g]) => (
          <div key={gid} className={`bub-ring${gWahl === gid ? ' gewaehlt' : ''}`} ref={(el) => { if (el) ringe.current.set(gid, el); else ringe.current.delete(gid); }}
            style={{ borderColor: BUBBLE_FARBEN[g.farbe % BUBBLE_FARBEN.length], background: `color-mix(in srgb, ${BUBBLE_FARBEN[g.farbe % BUBBLE_FARBEN.length]} 9%, transparent)` }} data-taste="bub-ring" data-gruppe={gid} />
        ))}
        {blasen.map((b, i) => (
          <div
            key={b.id} className={`bub-blase ${wahl === b.id ? 'gewaehlt' : ''} ${(platz.get(b.id) ?? 9) <= 3 ? 'vorn' : ''}${zu(b) ? ' verdeckt' : ''}`}
            ref={(el) => { if (el) knoten.current.set(b.id, el); else knoten.current.delete(b.id); }}
            style={{ background: farbeVon(b, i) }} role="button" tabIndex={0} data-taste="bub-blase" data-id={b.id} data-punkte={b.punkte} data-mal={b.mal}
            title={zu(b) ? 'Idee von jemand anderem – noch verdeckt' : b.namen.length && !regeln.anonym ? `${b.text} – von ${b.namen.join(', ')}` : b.text}
            data-verdeckt={zu(b) ? '' : undefined}
            onPointerDown={(e) => ziehStart(e, b)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tippen(b); } }}
          >
            <span className="bub-text" translate="no">{zu(b) ? '•••' : b.text}</span>
            {b.mal > 1 && <span className="bub-mal" title={`${b.mal}-mal genannt`}>×{b.mal}</span>}
            {/* Beim Abstimmen: die Punkte, als Punkte kenntlich. Nach dem Auswerten: der Platz groß, die Punkte darunter. */}
            {b.punkte > 0 && phase !== 'fertig' && <span className="bub-punkte" data-taste="bub-punkte" title={punkteText(b.punkte)}><i aria-hidden="true">●</i>{b.punkte}</span>}
            {phase === 'fertig' && platz.has(b.id) && (
              <>
                <span className={`bub-platz p${Math.min(platz.get(b.id)!, 4)}`} data-taste="bub-platz" data-platz={platz.get(b.id)} title={`${platz.get(b.id)}. Platz – ${punkteText(b.punkte)}`}>{platz.get(b.id)}.</span>
                <span className="bub-punkte unten" data-taste="bub-punkte">{punkteText(b.punkte)}</span>
              </>
            )}
            {phase === 'offen' && b.meine > 0 && (
              <button className="bub-meine" title="Einen meiner Punkte zurücknehmen" data-taste="bub-zurueck"
                onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); stimme(b, -1); }}>
                {'●'.repeat(Math.min(b.meine, 5))}{b.meine > 5 ? `+${b.meine - 5}` : ''}
              </button>
            )}
          </div>
        ))}
        {gruppen.map(([gid, g]) => (
          <span key={gid} className={`bub-ring-name${gWahl === gid ? ' gewaehlt' : ''}`} translate="no" ref={(el) => { if (el) namen.current.set(gid, el); else namen.current.delete(gid); }}
            style={{ color: BUBBLE_FARBEN[g.farbe % BUBBLE_FARBEN.length] }} data-taste="bub-ring-name" data-gruppe={gid}
            title="Ziehen verschiebt die Gruppe · Tippen: umbenennen, auflösen" onPointerDown={(e) => gruppeZiehen(e, gid)}>{g.name}</span>
        ))}
        {blasen.length === 0 && (
          <div className="bub-leer">
            <b>Noch keine Ideen</b>
            <span>Unten eintragen und Enter drücken. Gleiche Ideen verschmelzen und wachsen – in einem gemeinsamen Board können alle gleichzeitig beitragen.</span>
          </div>
        )}
        {!fest && phase === 'aus' && blasen.length > 0 && !gewaehlt && !gGewaehlt && !fallen && (
          <button className="bub-gruppe-neu" data-taste="bub-gruppe-neu" title="Leere Gruppe anlegen – Ideen hineinziehen"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => { const gid = gruppeAnlegen(`Gruppe ${gruppen.length + 1}`); if (gid) { setGWahl(gid); setWahl(null); } }}>＋ Gruppe</button>
        )}
        {fallenWas && fallenAuf && (
          <Pille taste="bub-fallen">
            <span className="bub-pille-text" translate="no">„{fallenWas.text}" auf „{fallenAuf.text}"</span>
            <button className="an" data-taste="bub-fallen-gruppe" onClick={() => {
              const gid = gruppeAnlegen(`Gruppe ${gruppen.length + 1}`, fallenAuf);
              if (gid) { inGruppeMit(fallenWas, fallenAuf, gid); setGWahl(gid); }
              setFallen(null);
            }}>＋ Gruppe aus beiden</button>
            <button data-taste="bub-fallen-eins" title="Beide meinen dasselbe: zu einer Idee machen (sie zählt dann doppelt)" onClick={() => { verschmelzen(fallenWas, fallenAuf); setFallen(null); }}>⛓ Verschmelzen</button>
            <button onClick={() => setFallen(null)} aria-label="Abbrechen">✕</button>
          </Pille>
        )}
        {gGewaehlt && !fallen && (
          <Pille taste="bub-gruppen-pille">
            <span className="bub-pille-punkt" style={{ background: BUBBLE_FARBEN[gGewaehlt[1].farbe % BUBBLE_FARBEN.length] }} />
            <input key={gGewaehlt[0]} className="bub-pille-feld" defaultValue={gGewaehlt[1].name} disabled={fest} maxLength={40} translate="no" aria-label="Name der Gruppe" data-taste="bub-gruppe-name"
              autoFocus onFocus={(e) => e.target.select()} enterKeyHint="done"
              onBlur={(e) => gruppeUmbenennen(gGewaehlt[0], e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { gruppeUmbenennen(gGewaehlt[0], (e.target as HTMLInputElement).value); setGWahl(null); } if (e.key === 'Escape') setGWahl(null); }} />
            <span className="bub-pille-zahl">{blasen.filter((b) => b.gruppe === gGewaehlt[0]).length} Ideen</span>
            {leiten && <button onClick={() => gruppeWeg(gGewaehlt[0])} title="Gruppe auflösen – die Ideen bleiben, frei" data-taste="bub-gruppe-weg">Auflösen</button>}
            <button onClick={() => setGWahl(null)} aria-label="Schließen">✕</button>
          </Pille>
        )}
        {liste && (
          <div className="bub-liste" data-taste="bub-liste" onPointerDown={(e) => e.stopPropagation()}>
            {abschnitte.map((a) => (
              <section key={a.gid ?? 'frei'}>
                {a.name && <h5 style={{ color: a.farbe }} translate={a.gid ? 'no' : undefined}><span className="bub-pille-punkt" style={{ background: a.farbe }} />{a.name} <i>{a.ideen.length}</i></h5>}
                {a.ideen.map((b) => (
                  <button key={b.id} className={`bub-zeile${wahl === b.id ? ' gewaehlt' : ''}`} data-taste="bub-zeile" data-id={b.id} onClick={() => tippen(b)}>
                    <span className="bub-zeile-text" translate="no">{zu(b) ? '••• (noch verdeckt)' : b.text}</span>
                    {b.mal > 1 && <span className="bub-zeile-mal">×{b.mal}</span>}
                    {!regeln.anonym && !zu(b) && b.namen.length > 0 && <span className="bub-zeile-von" translate="no">{b.namen.slice(0, 2).join(', ')}{b.namen.length > 2 ? ` +${b.namen.length - 2}` : ''}</span>}
                    {b.punkte > 0 && <span className="bub-zeile-punkte">{phase === 'fertig' && platz.has(b.id) ? <b className={`bub-platz klein p${Math.min(platz.get(b.id)!, 4)}`}>{platz.get(b.id)}.</b> : null}{punkteText(b.punkte)}</span>}
                  </button>
                ))}
                {a.ideen.length === 0 && <div className="bub-zeile-leer">keine Ideen</div>}
              </section>
            ))}
          </div>
        )}
        {gewaehlt && phase !== 'offen' && !fallen && (
          <Pille taste="bub-pille">
            {bearbeite === gewaehlt.id ? (
              <IdeeFeld text={gewaehlt.text} onFertig={(neu) => {
                const t = (neu ?? '').trim().slice(0, 140);
                if (neu !== null && t && t !== gewaehlt.text) ideenAendern(gewaehlt.ids, () => ({ text: t }));
                setBearbeite(null);
              }} />
            ) : (
              <>
                <span className="bub-pille-text" translate="no">{gewaehlt.text}</span>
                {!fest && gruppen.map(([gid, g]) => (
                  <button key={gid} className={gewaehlt.gruppe === gid ? 'an' : ''} style={{ borderColor: BUBBLE_FARBEN[g.farbe % BUBBLE_FARBEN.length] }}
                    onClick={() => inGruppe(gewaehlt, gewaehlt.gruppe === gid ? null : gid)} translate="no" data-taste="bub-in-gruppe">{g.name}</button>
                ))}
                {!fest && (
                  <input className="bub-pille-feld kurz" placeholder="＋ Neue Gruppe" value={neuGruppe} onChange={(e) => setNeuGruppe(e.target.value)} data-taste="bub-neue-gruppe"
                    enterKeyHint="done" maxLength={40}
                    onKeyDown={(e) => { if (e.key === 'Enter' && neuGruppe.trim()) { gruppeAnlegen(neuGruppe, gewaehlt); setNeuGruppe(''); } }} />
                )}
                {/* M386: ohne Enter-Taste (Telefon) legt dieser Knopf die Gruppe an */}
                {!fest && neuGruppe.trim() && <button className="bub-pille-ok" onClick={() => { gruppeAnlegen(neuGruppe, gewaehlt); setNeuGruppe(''); }} title="Gruppe anlegen" aria-label="Gruppe anlegen" data-taste="bub-neue-gruppe-ok">✓</button>}
                {darfAendern(gewaehlt) && <button onClick={() => setBearbeite(gewaehlt.id)} title="Text ändern" aria-label="Text ändern" data-taste="bub-idee-aendern">✎</button>}
                {darfAendern(gewaehlt) && <button onClick={() => loeschen(gewaehlt)} title="Idee löschen" data-taste="bub-loeschen"><ITrash size={14} /></button>}
              </>
            )}
          </Pille>
        )}
      </div>
      {phase === 'fertig' && rang.length > 0 && (
        <div className="bub-ergebnis" data-taste="bub-ergebnis">
          {rang.slice(0, 5).map((b) => (
            <span key={b.id} data-platz={platz.get(b.id)}><b className={`bub-platz klein p${Math.min(platz.get(b.id) ?? 4, 4)}`}>{platz.get(b.id)}.</b> <span translate="no">{b.text}</span> <i>{punkteText(b.punkte)}</i></span>
          ))}
        </div>
      )}
      <div className="bub-leiste nodrag">
        <input
          className="bub-eingabe" value={eingabe} disabled={fest || (!!regeln.zu && !leiten)} maxLength={140} translate="no" data-taste="bub-eingabe"
          placeholder={fest ? 'Diese Karte gehört jemand anderem – du kannst sie nur ansehen.' : regeln.zu && !leiten ? 'Die Sammlung ist geschlossen.' : verdeckt ? 'Idee eintragen und Enter … (die anderen sehen sie erst später)' : 'Idee eintragen und Enter …'}
          enterKeyHint="send"
          onChange={(e) => setEingabe(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); ideeDazu(); } }}
        />
        <button className="bub-dazu" onClick={ideeDazu} disabled={fest || !eingabe.trim() || (!!regeln.zu && !leiten)} title="Idee hinzufügen" data-taste="bub-dazu">＋</button>
        {phase === 'offen' && <span className="bub-rest" data-taste="bub-rest">{uebrig} von {d.abstimmung.punkte} Punkten übrig – auf Blasen tippen</span>}
        {leiten && phase === 'aus' && <button className="bub-knopf" onClick={() => phaseSetzen('offen')} disabled={blasen.length < 2} title={`Punkte-Abstimmung: jede Person vergibt ${d.abstimmung.punkte} Punkte`} data-taste="bub-abstimmen">Abstimmen</button>}
        {leiten && phase === 'offen' && <button className="bub-knopf an" onClick={() => phaseSetzen('fertig')} data-taste="bub-auswerten">✓ Auswerten</button>}
        {leiten && phase === 'fertig' && <button className="bub-knopf" onClick={() => phaseSetzen('offen')} title="Abstimmung wieder öffnen" data-taste="bub-weiter">↺ Weiter abstimmen</button>}
        {leiten && (
          <div className="bub-mehr">
            <button className="bub-knopf" onClick={() => setMenue((m) => !m)} aria-label="Weitere Funktionen" title="Weitere Funktionen" data-taste="bub-mehr">⋯</button>
            {menue && (
              <div className="bub-menue" data-taste="bub-menue">
                <label>Punkte je Person
                  <span className="bub-stufen">
                    <button onClick={() => punkteSetzen(d.abstimmung.punkte - 1)} aria-label="Weniger Punkte">−</button>
                    <b data-taste="bub-punktzahl">{d.abstimmung.punkte}</b>
                    <button onClick={() => punkteSetzen(d.abstimmung.punkte + 1)} aria-label="Mehr Punkte">＋</button>
                  </span>
                </label>
                <label className="bub-schalter"><input type="checkbox" checked={!!regeln.verdeckt} onChange={(e) => regelnSetzen({ verdeckt: e.target.checked })} data-taste="bub-regel-verdeckt" /> Verdeckt sammeln <small>jeder sieht zuerst nur Eigenes</small></label>
                <label className="bub-schalter"><input type="checkbox" checked={!!regeln.anonym} onChange={(e) => regelnSetzen({ anonym: e.target.checked })} data-taste="bub-regel-anonym" /> Namen ausblenden <small>neue Ideen ohne Namen</small></label>
                <label className="bub-schalter"><input type="checkbox" checked={!!regeln.still} onChange={(e) => regelnSetzen({ still: e.target.checked })} data-taste="bub-regel-still" /> Zwischenstand verbergen <small>Punkte erst beim Auswerten</small></label>
                {liveAuf(boardId) && (
                  <span className="bub-timer" data-taste="bub-timer">Timer für alle
                    {[1, 3, 5].map((m) => <button key={m} onClick={() => { setMenue(false); timerStart(boardId, m); }} data-min={m}>{m} min</button>)}
                  </span>
                )}
                <button onClick={() => { setMenue(false); alsNotiz(); }} disabled={!blasen.length} data-taste="bub-als-notiz">Ergebnis als Notiz ablegen</button>
                {aiReady(ai) && <button onClick={() => { setMenue(false); void kiGruppen(); }} disabled={kiLaeuft || blasen.length < 3} title="Die Texte der Ideen gehen dafür an den hinterlegten KI-Anbieter"><IWand size={14} /> {kiLaeuft ? 'KI gruppiert …' : 'Mit KI gruppieren'}</button>}
                {gruppen.map(([gid, g]) => <button key={gid} onClick={() => gruppeWeg(gid)}>Gruppe „<span translate="no">{g.name}</span>" auflösen</button>)}
                <button onClick={() => { setMenue(false); stimmenWeg(); }} disabled={!Object.keys(d.stimmen).length} data-taste="bub-stimmen-weg">Alle Punkte zurücksetzen</button>
                <button onClick={() => { setMenue(false); if (window.confirm('Alle Ideen dieser Karte löschen?')) allesWeg(); }} disabled={!blasen.length}>Alle Ideen löschen</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}


/** Schmaler Bildschirm (Telefon)? */
function useSchmal(): boolean {
  const [schmal, setSchmal] = useState(() => typeof matchMedia === 'function' && matchMedia('(max-width: 720px)').matches);
  useEffect(() => {
    const m = matchMedia('(max-width: 720px)');
    const auf = () => setSchmal(m.matches);
    m.addEventListener('change', auf);
    return () => m.removeEventListener('change', auf);
  }, []);
  return schmal;
}
/**
 * Die Leiste zu einer gewählten Blase oder Gruppe. Am Rechner liegt sie unten in der Karte. Am Telefon (M386)
 * reicht die Karte oft über den Bildschirm hinaus oder ist verkleinert — die Knöpfe lägen außerhalb oder wären
 * winzig. Dort steht die Leiste darum fest am unteren Bildschirmrand, in voller Größe, über der Tastatur.
 */
function Pille({ taste, children }: { taste: string; children: ReactNode }) {
  const schmal = useSchmal();
  const el = (
    <div className={`bub-pille${schmal ? ' am-schirm' : ''}`} data-taste={taste} onPointerDown={(e) => e.stopPropagation()}>{children}</div>
  );
  return schmal ? createPortal(el, document.body) : el;
}

/**
 * M386: Den Text einer Idee ändern. Übernommen wird mit Enter, mit ✓ und beim Verlassen des Felds; ✕ und Esc
 * verwerfen. Vorher zählte nur die Enter-Taste — am Telefon gibt es die oft nicht (die Tastatur bietet „Weiter",
 * das nur ins nächste Feld springt), und ohne Knopf ließ sich die Änderung dort gar nicht abschließen.
 */
function IdeeFeld({ text, onFertig }: { text: string; onFertig: (neu: string | null) => void }) {
  const feld = useRef<HTMLInputElement | null>(null);
  const erledigt = useRef(false);
  const fertig = (neu: string | null) => { if (erledigt.current) return; erledigt.current = true; onFertig(neu); };
  // Die Knöpfe nehmen dem Feld den Fokus nicht weg — sonst gälte schon das als „Feld verlassen" und ✕ übernähme
  const haltFokus = (e: { preventDefault: () => void }) => e.preventDefault();
  return (
    <>
      <input ref={feld} autoFocus className="bub-pille-feld" defaultValue={text} maxLength={140} translate="no" enterKeyHint="done"
        aria-label="Text der Idee" data-taste="bub-idee-feld"
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); fertig(e.currentTarget.value); }
          else if (e.key === 'Escape') { e.stopPropagation(); fertig(null); }
        }}
        onBlur={(e) => fertig(e.currentTarget.value)} />
      <button className="bub-pille-ok" onPointerDown={haltFokus} onMouseDown={haltFokus} onClick={() => fertig(feld.current?.value ?? null)}
        title="Übernehmen" aria-label="Text übernehmen" data-taste="bub-idee-ok">✓</button>
      <button onPointerDown={haltFokus} onMouseDown={haltFokus} onClick={() => fertig(null)} title="Abbrechen" aria-label="Abbrechen" data-taste="bub-idee-abbruch">✕</button>
    </>
  );
}
export function BubblesCard({ id, data, selected }: NodeProps<BubblesNode>) {
  const updateNodeData = useBoard((s) => s.updateNodeData);
  return (
    <CardShell id={id} selected={selected} minWidth={360} minHeight={320} className="bubbles-card">
      <div className="bub-kopf">
        <IBubbles size={16} aria-hidden="true" />
        <DragTitle className="bub-titel" value={data.title ?? ''} onChange={(v) => updateNodeData(id, { title: v })} placeholder="Ideen" />
      </div>
      <BubblesBody id={id} data={data} />
    </CardShell>
  );
}
