// M373: Entscheidungs-Bubbles — die Karte. Daten und das verlustfreie Vereinigen stehen in lib/bubbles.ts.
//
// Die Blasen bewegen sich wie im Vorbild (pix-el.de/interactive) mit einer kleinen Physik: Jede zieht es zu
// ihrem Anker (die Mitte, oder der Platz ihrer Gruppe), keine zwei überlappen. Gerechnet wird direkt auf den
// DOM-Elementen — 60-mal je Sekunde durch React zu gehen, wäre für fünfzig Blasen zu teuer —, und sobald alles
// ruht, hört die Rechnung auf (kein Dauerlauf im Hintergrund). Die Lage der Blasen gehört dem Gerät: Geteilt
// werden Ideen, Stimmen und Gruppen, nicht Koordinaten.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { gruppeVon, GRUPPE_EREIGNIS, useBoard, useKarteFest } from '../../store';
import type { BubblesNode } from '../../types';
import { uid } from '../../types';
import { ich, meineKennung } from '../../lib/gastSync';
import { aiReady, askAi } from '../../lib/ai';
import { blasenRadius, blasenVon, BUBBLE_FARBEN, bubblesDaten, geordnet, meinePunkte, rangfolge, type Blase, type BubblesData } from '../../lib/bubbles';
import { CardShell } from './CardShell';
import { DragTitle } from './DragTitle';

interface Koerper { x: number; y: number; vx: number; vy: number; r: number; ziel: number; g: string | null; len: number; wort: number }

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

  const blasen = useMemo(() => blasenVon(d, wer), [d, wer]);
  const gruppen = useMemo(() => Object.entries(d.gruppen).filter(([, g]) => g && !g.weg).sort((a, b) => a[1].t - b[1].t || a[0].localeCompare(b[0])), [d.gruppen]);
  const phase = d.abstimmung.phase;
  const vergeben = useMemo(() => meinePunkte(d, wer), [d, wer]);
  const uebrig = Math.max(0, d.abstimmung.punkte - vergeben);
  const rang = useMemo(() => (phase === 'fertig' ? rangfolge(blasen).filter((b) => b.punkte > 0) : []), [blasen, phase]);
  const platz = useMemo(() => new Map(rang.slice(0, 3).map((b, i) => [b.id, i])), [rang]);

  const [eingabe, setEingabe] = useState('');
  const [wahl, setWahl] = useState<string | null>(null);
  const [menue, setMenue] = useState(false);
  const [neuGruppe, setNeuGruppe] = useState('');
  const [bearbeite, setBearbeite] = useState<string | null>(null);
  const [kiLaeuft, setKiLaeuft] = useState(false);
  const gewaehlt = wahl ? blasen.find((b) => b.id === wahl) ?? null : null;
  useEffect(() => { if (wahl && !blasen.some((b) => b.id === wahl)) setWahl(null); }, [wahl, blasen]);

  // ───── Ändern: immer nur die betroffenen Einträge, mit frischem Zeitstempel ─────
  const jetzt = () => Date.now();
  const ideeDazu = () => {
    const text = eingabe.trim().slice(0, 140);
    if (!text || fest) return;
    updateNodeData(id, { ideen: { ...d.ideen, [uid()]: { text, von: wer, name: ich().name, t: jetzt() } } });
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
  const gruppeWeg = (gid: string) => { if (leiten && d.gruppen[gid]) updateNodeData(id, { gruppen: { ...d.gruppen, [gid]: { ...d.gruppen[gid], weg: true, t: jetzt() } } }); };
  const stimme = (b: Blase, dazu: 1 | -1) => {
    if (fest || phase !== 'offen') return;
    if (dazu === 1 && uebrig <= 0) { showToast(`Alle ${d.abstimmung.punkte} Punkte sind vergeben — tippe auf deine Punkte an einer Blase, um einen zurückzunehmen.`); return; }
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
      showToast('Die KI hat keine brauchbaren Gruppen geliefert — bitte noch einmal versuchen oder von Hand gruppieren.');
    } finally { setKiLaeuft(false); }
  };

  // ───── Physik ─────
  const buehne = useRef<HTMLDivElement | null>(null);
  const koerper = useRef(new Map<string, Koerper>());
  const knoten = useRef(new Map<string, HTMLElement>());
  const ringe = useRef(new Map<string, HTMLElement>());
  const namen = useRef(new Map<string, HTMLElement>());
  const mass = useRef({ w: 600, h: 360 });
  const zug = useRef<{ id: string; dx: number; dy: number; bewegt: boolean } | null>(null);
  const lauf = useRef<number | null>(null);
  const ruhe = useRef(0);
  const gruppenRef = useRef<string[]>([]);
  gruppenRef.current = gruppen.map(([g]) => g);
  const ruhig = useMemo(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches, []);

  const anker = useCallback((g: string | null): { x: number; y: number } => {
    const { w, h } = mass.current;
    const gs = gruppenRef.current;
    const i = g ? gs.indexOf(g) : -1;
    if (i < 0 || !gs.length) return { x: w / 2, y: h / 2 };
    if (gs.length === 1) return { x: w / 2, y: h / 2 };
    // Gruppen auf einer Ellipse — nutzt beide Achsen, damit breite Karten sich auch in der Breite füllen
    // die erste Gruppe links (breite Bühne) bzw. oben (hohe) — zwei Gruppen stehen so nebeneinander, wo Platz ist
    const winkel = (i / gs.length) * Math.PI * 2 + (w >= h ? Math.PI : -Math.PI / 2);
    return { x: w / 2 + Math.cos(winkel) * w * 0.3, y: h / 2 + Math.sin(winkel) * h * 0.28 };
  }, []);

  /** Die Gruppe als Scheibe: Mitte ihrer Blasen und der Radius bis zur äußersten (mit etwas Luft) — oder null, wenn leer */
  const scheibe = useCallback((gid: string): { x: number; y: number; r: number } | null => {
    // Mitte nach Fläche gewichtet: Eine große Blase zieht die Mitte zu sich — so bleibt der Ring eng um die Gruppe
    let n = 0; let sx = 0; let sy = 0;
    for (const k of koerper.current.values()) if (k.g === gid) { const m = k.r * k.r; n += m; sx += k.x * m; sy += k.y * m; }
    if (!n) return null;
    const x = sx / n; const y = sy / n;
    let r = 0;
    for (const k of koerper.current.values()) if (k.g === gid) r = Math.max(r, Math.hypot(k.x - x, k.y - y) + k.r);
    return { x, y, r: r + 12 };
  }, []);

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
      const s0 = scheibe(gid);
      if (!s0) { if (el) el.style.opacity = '0'; if (nm) nm.style.opacity = '0'; continue; }
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
    // 1) Kräfte: jede Blase zu ihrem Anker; Gruppen als Ganzes auseinander, in sich zusammen; freie aus den Ringen
    for (const [bid, k] of ks) {
      k.r += (k.ziel - k.r) * 0.18;
      if (bid === gezogen) { k.vx = 0; k.vy = 0; continue; }
      const a = anker(k.g);
      k.vx += (a.x - k.x) * 0.006; k.vy += (a.y - k.y) * 0.006;
    }
    const gs = gruppenRef.current;
    if (gs.length) {
      const sch = gs.map((g) => ({ g, s: scheibe(g) })).filter((x): x is { g: string; s: { x: number; y: number; r: number } } => !!x.s);
      for (let i = 0; i < sch.length; i++) {
        for (let j = i + 1; j < sch.length; j++) {
          const a = sch[i].s; const b = sch[j].s;
          let dx = b.x - a.x; let dy = b.y - a.y; let dist = Math.hypot(dx, dy);
          const tiefe = a.r + b.r + 6 - dist;
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
        for (const [bid, k] of ks) if (k.g === g && bid !== gezogen) { k.vx += (c.x - k.x) * 0.012; k.vy += (c.y - k.y) * 0.012; }
      }
      for (const [bid, k] of ks) {
        if (k.g || bid === gezogen) continue;
        for (const { s: c } of sch) {
          const dx = k.x - c.x; const dy = k.y - c.y; const dist = Math.hypot(dx, dy) || 1;
          const tiefe = c.r + k.r + 4 - dist;
          if (tiefe > 0) { k.vx += (dx / dist) * tiefe * 0.08; k.vy += (dy / dist) * tiefe * 0.08; }
        }
      }
    }
    // 2) Bewegen (gedämpft)
    let energie = 0;
    for (const [bid, k] of ks) {
      if (bid !== gezogen) { k.vx *= 0.84; k.vy *= 0.84; k.x += k.vx; k.y += k.vy; }
      energie += k.vx * k.vx + k.vy * k.vy + Math.abs(k.ziel - k.r) * 0.05;
    }
    // 3) Überlappungen auflösen — als Letztes und zweimal, damit im Ruhezustand wirklich keine bleibt —, dann die Wände
    for (let runde = 0; runde < 2; runde++) {
      for (let i = 0; i < ks.length; i++) {
        for (let j = i + 1; j < ks.length; j++) {
          const a = ks[i][1]; const b = ks[j][1];
          let dx = b.x - a.x; let dy = b.y - a.y; let dist = Math.hypot(dx, dy);
          const soll = a.r + b.r + (a.g === b.g ? 4 : 12);
          if (dist >= soll) continue;
          if (dist < 0.01) { dx = zahlAus(ks[i][0]) - 0.5; dy = zahlAus(ks[j][0]) - 0.5; dist = Math.hypot(dx, dy) || 1; }
          const nx = dx / dist; const ny = dy / dist; const tiefe = soll - dist;
          const ta = ks[j][0] === gezogen ? 1 : ks[i][0] === gezogen ? 0 : 0.5;
          a.x -= nx * tiefe * ta; a.y -= ny * tiefe * ta;
          b.x += nx * tiefe * (1 - ta); b.y += ny * tiefe * (1 - ta);
          // was aufeinander zuläuft, wird gebremst (sonst federn die Blasen ewig)
          const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (rel < 0) { a.vx += nx * rel * 0.5 * (ta ? 1 : 0); a.vy += ny * rel * 0.5 * (ta ? 1 : 0); b.vx -= nx * rel * 0.5 * (ta < 1 ? 1 : 0); b.vy -= ny * rel * 0.5 * (ta < 1 ? 1 : 0); }
        }
      }
      for (const [, k] of ks) {
        k.x = Math.min(Math.max(k.x, k.r + 4), Math.max(k.r + 4, w - k.r - 4));
        k.y = Math.min(Math.max(k.y, k.r + 4), Math.max(k.r + 4, h - k.r - 4));
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
    const ziel = gruppenRef.current.length > 1 ? 0.2 : 0.38;
    let f = voll > ziel ? Math.sqrt(ziel / voll) : gross ? Math.min(1.7, Math.sqrt(ziel / Math.max(voll, 0.01))) : 1;
    // keine Blase breiter als die halbe kurze Seite
    const groesste = Math.max(0, ...roh) * f;
    if (groesste > Math.min(w, h) * 0.3) f *= (Math.min(w, h) * 0.3) / groesste;
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
    wecken();
  }, [gross, wecken]);

  // Größe der Bühne (Layout-Maß, unabhängig vom Zoom des Boards)
  useEffect(() => {
    const el = buehne.current;
    if (!el) return;
    const messen = () => {
      const w = el.offsetWidth || 600; const h = el.offsetHeight || 360;
      if (w !== mass.current.w || h !== mass.current.h) { mass.current = { w, h }; radienSetzen(); }
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
  const ziehStart = (e: React.PointerEvent, b: Blase) => {
    if (e.button !== 0) return;
    const k = koerper.current.get(b.id); if (!k) return;
    const p = punkt(e);
    zug.current = { id: b.id, dx: k.x - p.x, dy: k.y - p.y, bewegt: false };
    const start = { x: e.clientX, y: e.clientY };
    const bewegen = (ev: PointerEvent) => {
      const z = zug.current; if (!z) return;
      if (!z.bewegt && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5) return;
      z.bewegt = true;
      const q = punkt(ev); const kk = koerper.current.get(z.id);
      if (kk) { kk.x = q.x + z.dx; kk.y = q.y + z.dy; }
      wecken();
    };
    const ende = () => {
      window.removeEventListener('pointermove', bewegen); window.removeEventListener('pointerup', ende); window.removeEventListener('pointercancel', ende);
      const z = zug.current; zug.current = null;
      if (!z) return;
      if (!z.bewegt) { tippen(b); return; }
      const kk = koerper.current.get(z.id);
      // über welcher Gruppe liegt sie jetzt? (die nächste Gruppenmitte, wenn sie nah genug ist)
      if (kk && gruppenRef.current.length && !fest) {
        let ziel: string | null = null; let best = Infinity;
        for (const gid of gruppenRef.current) {
          const m = [...koerper.current.entries()].filter(([kid, x]) => x.g === gid && kid !== z.id).map(([, x]) => x);
          const c = m.length ? { x: m.reduce((s, x) => s + x.x, 0) / m.length, y: m.reduce((s, x) => s + x.y, 0) / m.length } : anker(gid);
          const reich = m.length ? Math.max(...m.map((x) => Math.hypot(x.x - c.x, x.y - c.y) + x.r)) + 20 : 70;
          const ab = Math.hypot(kk.x - c.x, kk.y - c.y);
          if (ab < reich && ab < best) { best = ab; ziel = gid; }
        }
        if (ziel !== b.gruppe && (ziel || b.gruppe)) inGruppe(b, ziel);
      }
      wecken();
    };
    window.addEventListener('pointermove', bewegen); window.addEventListener('pointerup', ende); window.addEventListener('pointercancel', ende);
  };
  const tippen = (b: Blase) => {
    if (phase === 'offen' && !fest) { stimme(b, 1); return; }
    setWahl((w) => (w === b.id ? null : b.id)); setMenue(false); setBearbeite(null);
  };

  const farbeVon = (b: Blase, i: number): string => {
    const g = b.gruppe ? d.gruppen[b.gruppe] : null;
    // Gibt es Gruppen, sagt die Farbe „gehört zu …" — eine freie Blase ist dann neutral
    if (!g && gruppen.length) return '#7b8494';
    return BUBBLE_FARBEN[(g ? g.farbe : i) % BUBBLE_FARBEN.length];
  };
  const medaille = ['🥇', '🥈', '🥉'];

  return (
    <div className={`bub ${gross ? 'gross' : ''}`} data-ohne-sperre="" data-taste="bubbles">
      <div className="bub-frage">
        <input
          className="bub-frage-feld nodrag" value={d.frage ?? ''} disabled={fest} placeholder="Worum geht es? Frage hier eintragen …" translate="no"
          onChange={(e) => updateNodeData(id, { frage: e.target.value.slice(0, 160) })} data-taste="bub-frage"
        />
        <span className="bub-zahl" data-taste="bub-zahl">{blasen.length} {blasen.length === 1 ? 'Idee' : 'Ideen'}</span>
      </div>
      <div className="bub-buehne nodrag nopan" ref={buehne} onPointerDown={(e) => { if (e.target === e.currentTarget) { setWahl(null); setMenue(false); } }}>
        {gruppen.map(([gid, g]) => (
          <div key={gid} className="bub-ring" ref={(el) => { if (el) ringe.current.set(gid, el); else ringe.current.delete(gid); }}
            style={{ borderColor: BUBBLE_FARBEN[g.farbe % BUBBLE_FARBEN.length] }} data-taste="bub-ring" data-gruppe={gid} />
        ))}
        {blasen.map((b, i) => (
          <div
            key={b.id} className={`bub-blase ${wahl === b.id ? 'gewaehlt' : ''} ${platz.has(b.id) ? 'vorn' : ''}`}
            ref={(el) => { if (el) knoten.current.set(b.id, el); else knoten.current.delete(b.id); }}
            style={{ background: farbeVon(b, i) }} role="button" tabIndex={0} data-taste="bub-blase" data-id={b.id} data-punkte={b.punkte} data-mal={b.mal}
            title={b.namen.length ? `${b.text} — von ${b.namen.join(', ')}` : b.text}
            onPointerDown={(e) => ziehStart(e, b)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tippen(b); } }}
          >
            <span className="bub-text" translate="no">{b.text}</span>
            {b.mal > 1 && <span className="bub-mal" title={`${b.mal}-mal genannt`}>×{b.mal}</span>}
            {b.punkte > 0 && <span className="bub-punkte" data-taste="bub-punkte">{platz.has(b.id) ? `${medaille[platz.get(b.id)!]} ` : ''}{b.punkte}</span>}
            {phase === 'offen' && b.meine > 0 && (
              <button className="bub-meine" title="Einen meiner Punkte zurücknehmen" data-taste="bub-zurueck"
                onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); stimme(b, -1); }}>
                {'●'.repeat(Math.min(b.meine, 5))}{b.meine > 5 ? `+${b.meine - 5}` : ''}
              </button>
            )}
          </div>
        ))}
        {gruppen.map(([gid, g]) => (
          <span key={gid} className="bub-ring-name" translate="no" ref={(el) => { if (el) namen.current.set(gid, el); else namen.current.delete(gid); }}
            style={{ color: BUBBLE_FARBEN[g.farbe % BUBBLE_FARBEN.length] }}>{g.name}</span>
        ))}
        {blasen.length === 0 && (
          <div className="bub-leer">
            <b>Noch keine Ideen</b>
            <span>Unten eintragen und Enter drücken. Gleiche Ideen verschmelzen und wachsen — in einem gemeinsamen Board können alle gleichzeitig beitragen.</span>
          </div>
        )}
        {gewaehlt && phase !== 'offen' && (
          <div className="bub-pille" data-taste="bub-pille" onPointerDown={(e) => e.stopPropagation()}>
            {bearbeite === gewaehlt.id ? (
              <input autoFocus className="bub-pille-feld" defaultValue={gewaehlt.text} translate="no"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { const t = (e.target as HTMLInputElement).value.trim().slice(0, 140); if (t) ideenAendern(gewaehlt.ids, () => ({ text: t })); setBearbeite(null); }
                  if (e.key === 'Escape') setBearbeite(null);
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
                    onKeyDown={(e) => { if (e.key === 'Enter' && neuGruppe.trim()) { gruppeAnlegen(neuGruppe, gewaehlt); setNeuGruppe(''); } }} />
                )}
                {darfAendern(gewaehlt) && <button onClick={() => setBearbeite(gewaehlt.id)} title="Text ändern">✎</button>}
                {darfAendern(gewaehlt) && <button onClick={() => loeschen(gewaehlt)} title="Idee löschen" data-taste="bub-loeschen">🗑</button>}
              </>
            )}
          </div>
        )}
      </div>
      {phase === 'fertig' && rang.length > 0 && (
        <div className="bub-ergebnis" data-taste="bub-ergebnis">
          {rang.slice(0, 5).map((b, i) => (
            <span key={b.id}><b>{i < 3 ? medaille[i] : `${i + 1}.`}</b> <span translate="no">{b.text}</span> <i>{b.punkte}</i></span>
          ))}
        </div>
      )}
      <div className="bub-leiste nodrag">
        <input
          className="bub-eingabe" value={eingabe} disabled={fest} maxLength={140} translate="no" data-taste="bub-eingabe"
          placeholder={fest ? 'Diese Karte gehört jemand anderem — du kannst sie nur ansehen.' : 'Idee eintragen und Enter …'}
          onChange={(e) => setEingabe(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); ideeDazu(); } }}
        />
        <button className="bub-dazu" onClick={ideeDazu} disabled={fest || !eingabe.trim()} title="Idee hinzufügen" data-taste="bub-dazu">＋</button>
        {phase === 'offen' && <span className="bub-rest" data-taste="bub-rest">{uebrig} von {d.abstimmung.punkte} Punkten übrig — auf Blasen tippen</span>}
        {leiten && phase === 'aus' && <button className="bub-knopf" onClick={() => phaseSetzen('offen')} disabled={blasen.length < 2} title={`Punkte-Abstimmung: jede Person vergibt ${d.abstimmung.punkte} Punkte`} data-taste="bub-abstimmen">🗳 Abstimmen</button>}
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
                {aiReady(ai) && <button onClick={() => { setMenue(false); void kiGruppen(); }} disabled={kiLaeuft || blasen.length < 3} title="Die Texte der Ideen gehen dafür an den hinterlegten KI-Anbieter">✨ {kiLaeuft ? 'KI gruppiert …' : 'Mit KI gruppieren'}</button>}
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

export function BubblesCard({ id, data, selected }: NodeProps<BubblesNode>) {
  const updateNodeData = useBoard((s) => s.updateNodeData);
  return (
    <CardShell id={id} selected={selected} minWidth={360} minHeight={320} className="bubbles-card">
      <div className="bub-kopf">
        <span aria-hidden="true">🫧</span>
        <DragTitle className="bub-titel" value={data.title ?? ''} onChange={(v) => updateNodeData(id, { title: v })} placeholder="Ideen" />
      </div>
      <BubblesBody id={id} data={data} />
    </CardShell>
  );
}
