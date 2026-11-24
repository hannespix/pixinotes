// M413: Die EINE Reihenfolge der Karten – für das Blättern im Fokus und für die Folien des Vortrags.
//
// Bisher gab es zwei: Der Fokus blätterte nach der Lage (Zeile für Zeile), als gäbe es keine Pfeile; der Vortrag
// folgte den Pfeilen, lief dabei aber jeden Ast bis zum Ende, bevor er zum Nachbarn zurückkehrte – ein Schritt, in
// den zwei Pfeile münden, kam so VOR einem seiner Vorgänger. Jetzt gilt für beide:
//
//   1  Was verbunden ist, gehört zusammen. Eine Gruppe verbundener Karten wird am Stück gezeigt.
//   2  In der Gruppe geht es den Pfeilen nach: erst, wovon ein Pfeil ausgeht, dann, wohin er zeigt. Eine Karte, in die
//      mehrere Pfeile münden, kommt erst, wenn alle ihre Vorgänger dran waren. Nach einer Karte geht es bei IHREN
//      Nachfolgern weiter (man bleibt auf dem Weg), erst danach bei offenen Abzweigungen.
//   3  Linien ohne Spitze und Verweise aus Tickets halten zusammen, geben aber keine Richtung vor.
//   4  Ein Rahmen ist ein Abschnitt: erst der Rahmen, dann sein Inhalt, dann der nächste.
//   5  Wo nichts davon gilt: Lesefolge – Zeile für Zeile von oben, in der Zeile von links.
//
// Gerechnet wird über ALLE Karten (auch Formen eines Ablaufs, die im Fokus übersprungen werden) – wer danach nur
// einen Teil zeigt, filtert das Ergebnis: Die Reihenfolge der übrigen stimmt dann trotzdem.
import type { Edge } from '@xyflow/react';
import type { AppNode } from '../types';

const mass = (n: AppNode) => ({ w: n.measured?.width ?? n.width ?? 260, h: n.measured?.height ?? n.height ?? 120 });

/**
 * Lesefolge: Zeile für Zeile von oben, in der Zeile von links. Eine Zeile bilden Karten, die sich in der Höhe
 * überdecken (mindestens zur Hälfte der kleineren) – eine hohe Karte neben zwei kurzen steht mit der oberen in
 * einer Zeile. Feste Raster (alle 160 oder 260 Punkte eine Zeile) trennten Karten, die nebeneinander lagen, sobald
 * eine Rastergrenze zwischen ihren Mitten verlief.
 */
export function leseFolge<T extends AppNode>(ns: T[]): T[] {
  type K = { n: T; oben: number; unten: number; h: number; x: number };
  const deckt = (a: K, b: K) => Math.min(a.unten, b.unten) - Math.max(a.oben, b.oben) >= 0.5 * Math.min(a.h, b.h);
  const zeilen = (ks: K[]): K[][] => {
    const sortiert = [...ks].sort((a, b) => (a.oben - b.oben) || (a.x - b.x));
    const grob: K[][] = [];
    for (const k of sortiert) {
      const z = grob[grob.length - 1];
      if (z && deckt(z[0], k)) z.push(k); else grob.push([k]);
    }
    const aus: K[][] = [];
    for (const z of grob) {
      const [erste, ...rest] = z;
      // Liegen neben einer hohen Karte mehrere übereinander, sind das eigene Zeilen: Die hohe gehört zur obersten
      if (rest.length > 1 && rest.some((a) => rest.some((b) => a !== b && !deckt(a, b)))) {
        const unter = zeilen(rest);
        unter[0] = [...unter[0], erste];
        aus.push(...unter);
      } else aus.push(z);
    }
    return aus.map((z) => [...z].sort((a, b) => (a.x - b.x) || (a.oben - b.oben)));
  };
  return zeilen(ns.map((n) => { const m = mass(n); return { n, oben: n.position.y, unten: n.position.y + m.h, h: m.h, x: n.position.x }; })).flat().map((k) => k.n);
}

/** Zeigt die Verbindung in eine Richtung? `null`: nein (keine oder zwei Spitzen) */
function richtung(e: Edge): { von: string; nach: string } | null {
  const d = (e.data ?? {}) as { kind?: string; head?: boolean; headStart?: boolean };
  const vorn = typeof d.head === 'boolean' ? d.head : d.kind !== 'line';
  const hinten = d.headStart === true;
  if (vorn === hinten) return null;
  return vorn ? { von: e.source, nach: e.target } : { von: e.target, nach: e.source };
}

export function kartenFolge(karten: AppNode[], edges: Edge[]): AppNode[] {
  const rahmen = karten.filter((n) => n.type === 'frame');
  // Rahmen umspannen ihre Karten und stünden in der Lesefolge mit allem „in einer Zeile" – sie werden unten einsortiert
  const teil = leseFolge(karten.filter((n) => n.type !== 'portal' && n.type !== 'frame'));
  const nr = new Map(teil.map((n, i) => [n.id, i]));          // Platz in der Lesefolge
  const vonId = new Map([...teil, ...rahmen].map((n) => [n.id, n]));
  const nachLesen = (a: string, b: string) => nr.get(a)! - nr.get(b)!;

  // ── Verbindungen: gerichtete (Pfeile) und bloßer Zusammenhalt (Linien, Verweise aus Tickets) ──
  const nachfolger = new Map<string, Set<string>>();
  const offen = new Map<string, number>();                    // noch nicht gezeigte Vorgänger
  const nachbarn = new Map<string, Set<string>>();
  const dazu = (m: Map<string, Set<string>>, a: string, b: string) => { if (!m.has(a)) m.set(a, new Set()); m.get(a)!.add(b); };
  const halten = (a: string, b: string) => { if (a === b || !nr.has(a) || !nr.has(b)) return false; dazu(nachbarn, a, b); dazu(nachbarn, b, a); return true; };
  for (const e of edges) {
    if (!halten(e.source, e.target)) continue;
    const r = richtung(e);
    if (r && !nachfolger.get(r.von)?.has(r.nach)) { dazu(nachfolger, r.von, r.nach); offen.set(r.nach, (offen.get(r.nach) ?? 0) + 1); }
  }
  for (const n of teil) {
    if (n.type !== 'kanban') continue;
    for (const it of (n.data.items ?? [])) {
      for (const l of [it.link, ...(it.links ?? [])]) if (l?.nodeId) halten(n.id, l.nodeId);
    }
  }
  // Gegenläufige Pfeile (A → B und B → A) heben sich als Reihenfolge auf – übrig bleibt der Zusammenhalt
  for (const [a, ziele] of nachfolger) for (const b of [...ziele]) {
    if (nachfolger.get(b)?.has(a)) { ziele.delete(b); nachfolger.get(b)!.delete(a); offen.set(b, (offen.get(b) ?? 1) - 1); offen.set(a, (offen.get(a) ?? 1) - 1); }
  }

  // ── Rahmen: Welche Karte liegt in welchem? (der kleinste, der ihre Mitte enthält) ──
  const rahmenVon = new Map<string, string>();
  const flaeche = (f: AppNode) => { const m = mass(f); return m.w * m.h; };
  for (const n of teil) {
    const m = mass(n); const mx = n.position.x + m.w / 2; const my = n.position.y + m.h / 2;
    const drin = rahmen.filter((f) => { const fm = mass(f); return mx >= f.position.x && mx <= f.position.x + fm.w && my >= f.position.y && my <= f.position.y + fm.h; })
      .sort((a, b) => flaeche(a) - flaeche(b))[0];
    if (drin) rahmenVon.set(n.id, drin.id);
  }

  // ── Gruppen: was über Verbindungen zusammenhängt ──
  const gruppeVon = new Map<string, number>();
  const gruppen: string[][] = [];
  for (const n of teil) {
    if (gruppeVon.has(n.id)) continue;
    const g: string[] = []; const stapel = [n.id]; gruppeVon.set(n.id, gruppen.length);
    while (stapel.length) {
      const id = stapel.pop()!; g.push(id);
      for (const nb of nachbarn.get(id) ?? []) if (!gruppeVon.has(nb)) { gruppeVon.set(nb, gruppen.length); stapel.push(nb); }
    }
    gruppen.push(g.sort(nachLesen));
  }

  // ── In der Gruppe: den Pfeilen nach ──
  const ordne = (g: string[]): string[] => {
    if (g.length === 1) return g;
    const fertig = new Set<string>(); const aus: string[] = [];
    const rest = new Map(g.map((id) => [id, offen.get(id) ?? 0]));
    const stapel: string[] = [];                               // was als Nächstes dran ist – oben liegt das Nächste
    const lege = (ids: string[]) => { for (const id of [...ids].sort(nachLesen).reverse()) stapel.push(id); };
    lege(g.filter((id) => (rest.get(id) ?? 0) <= 0 && (nachfolger.get(id)?.size ?? 0) > 0));   // Anfänge: nur ausgehende Pfeile
    while (aus.length < g.length) {
      let id = stapel.pop();
      if (id === undefined) {
        // Kein Weg mehr offen (Kreis, oder nur über Linien erreichbar): am nächsten liegt, was an schon Gezeigtes grenzt
        const frei = g.filter((x) => !fertig.has(x));
        id = frei.find((x) => (rest.get(x) ?? 0) <= 0 && [...(nachbarn.get(x) ?? [])].some((y) => fertig.has(y)))
          ?? frei.find((x) => (rest.get(x) ?? 0) <= 0) ?? frei.find((x) => [...(nachbarn.get(x) ?? [])].some((y) => fertig.has(y))) ?? frei[0];
      }
      if (fertig.has(id)) continue;
      // Wartet die Karte noch auf einen Vorgänger, kommt sie später (sobald der letzte gezeigt ist)
      if ((rest.get(id) ?? 0) > 0 && g.some((x) => !fertig.has(x) && x !== id && (rest.get(x) ?? 0) <= 0)) continue;
      fertig.add(id); aus.push(id);
      const weiter: string[] = []; const daneben: string[] = [];
      for (const z of nachfolger.get(id) ?? []) { rest.set(z, (rest.get(z) ?? 1) - 1); if (!fertig.has(z) && (rest.get(z) ?? 0) <= 0) weiter.push(z); }
      for (const z of nachbarn.get(id) ?? []) if (!fertig.has(z) && !nachfolger.get(id)?.has(z) && !nachfolger.get(z)?.has(id) && (rest.get(z) ?? 0) <= 0) daneben.push(z);
      // Erst, was mit einer bloßen Linie an DIESER Karte hängt (eine Anmerkung zu ihr), dann den Pfeilen nach
      lege(weiter); lege(daneben);
    }
    return aus;
  };

  // ── Abschnitte: Rahmen samt Inhalt, Gruppen, einzelne Karten – in der Lesefolge ihres ersten Stücks ──
  const gezeigt = new Set<string>(); const aus: AppNode[] = [];
  const zeige = (ids: string[]) => { for (const id of ids) if (!gezeigt.has(id)) { gezeigt.add(id); aus.push(vonId.get(id)!); } };
  /** Eine Karte zeigen – mit allem, was an ihr hängt */
  const mitGruppe = (id: string) => zeige(ordne(gruppen[gruppeVon.get(id)!]));
  // leere Rahmen: vor der ersten Karte, die unter ihrer Oberkante beginnt
  const leer = rahmen.filter((f) => ![...rahmenVon.values()].includes(f.id)).sort((a, b) => (a.position.y - b.position.y) || (a.position.x - b.position.x));
  for (const n of teil) {
    while (leer.length && leer[0].position.y <= n.position.y) zeige([leer.shift()!.id]);
    if (gezeigt.has(n.id)) continue;
    const f = rahmenVon.get(n.id);
    if (!f) { mitGruppe(n.id); continue; }
    // Abschnitt: der Rahmen, dann sein Inhalt in der Folge seiner Gruppen
    zeige([f]);
    for (const k of teil) if (rahmenVon.get(k.id) === f && !gezeigt.has(k.id)) mitGruppe(k.id);
  }
  zeige(leer.map((f) => f.id));
  return aus;
}

/**
 * Wohin geht es von dieser Karte aus weiter (bzw. zurück)? Für die Blätter-Knöpfe: Die Nachbarin in der Folge –
 * und ob ein Pfeil dorthin führt (dann nennt der Knopf sie beim Namen).
 */
export function folgeNachbar(folge: AppNode[], edges: Edge[], id: string, vor: boolean): { karte: AppNode; perPfeil: boolean } | null {
  const i = folge.findIndex((n) => n.id === id);
  if (i < 0 || folge.length < 2) return null;
  const karte = folge[(i + (vor ? 1 : -1) + folge.length) % folge.length];
  const perPfeil = edges.some((e) => { const r = richtung(e); return !!r && (vor ? r.von === id && r.nach === karte.id : r.von === karte.id && r.nach === id); });
  return { karte, perPfeil };
}

/**
 * M503: An welcher Folie beginnt eine Präsentation, die „ab dieser Karte" gewünscht ist? `folge` ist die volle
 * Kartenfolge, `folien` der Teil, der gezeigt wird (leere statische Karten fallen weg). Ist die Karte selbst keine
 * Folie, geht es an der nächsten Folie hinter ihr weiter (sonst an der letzten davor) – nicht wieder bei Folie 1,
 * wie bisher, wenn die gewählte Karte aus der Folienliste fiel. Ein Rahmen ist selbst eine (Abschnitts-)Folie.
 * −1 = keine Startkarte (von vorn).
 */
export function folieAb(folge: AppNode[], folien: AppNode[], id: string | null): number {
  if (!id) return -1;
  const direkt = folien.findIndex((n) => n.id === id);
  if (direkt >= 0) return direkt;
  const j = folge.findIndex((n) => n.id === id);
  if (j < 0) return -1;
  const platz = new Map(folien.map((n, i) => [n.id, i]));
  for (let k = j; k < folge.length; k += 1) { const i = platz.get(folge[k].id); if (i !== undefined) return i; }
  for (let k = j - 1; k >= 0; k -= 1) { const i = platz.get(folge[k].id); if (i !== undefined) return i; }
  return -1;
}
