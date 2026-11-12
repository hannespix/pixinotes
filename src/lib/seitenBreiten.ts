// M355: Einmalige Reparatur für Seitenstriche, die zwischen M354 und M355 zu dick gespeichert wurden.
//
// M354 speichert die Breite eines Strichs auf einer PDF-/Word-Seite in Seitenpunkten. Beim Weiterschreiben
// wurde die Gruppe neu geankert und die Breite dabei NOCH EINMAL umgerechnet — jeder Strich, der schon da
// war, wurde mit jedem Absetzen dicker. Der Fehler ist behoben (strokeAnchor.ts `brett`); was schon
// gespeichert ist, bleibt aber dick. Das Muster ist erkennbar: gleiche Karte, gleiche Seite, gleiches
// Werkzeug, gleiche Farbe — und viele verschiedene Breiten, die dünnste ist die richtige (der zuletzt
// geschriebene Strich wurde nur einmal umgerechnet). Solche Gruppen (ab drei verschiedenen Breiten) werden
// einmal je Gerät auf die dünnste gesetzt; Punkte (i-Punkte) und Gruppen mit ein, zwei Breiten bleiben.
import { mutedHistory, useBoard, type Stroke } from '../store';

const KEY = 'pixinotes-m355-breiten';

export function seitenBreitenReparieren(): number {
  try { if (localStorage.getItem(KEY)) return 0; } catch { return 0; }
  let geaendert = 0;
  const boards = useBoard.getState().boards.map((b) => {
    const gruppen = new Map<string, Stroke[]>();
    for (const s of b.drawings ?? []) {
      if (!s.seitenBreite || !s.anchor || s.seite == null || s.points.length <= 2) continue;
      const k = `${s.anchor}|${s.seite}|${s.tool}|${s.color}`;
      const g = gruppen.get(k);
      if (g) g.push(s); else gruppen.set(k, [s]);
    }
    const neu = new Map<string, number>();
    for (const g of gruppen.values()) {
      if (new Set(g.map((s) => Math.round(s.width * 10))).size < 3) continue;
      const min = Math.min(...g.map((s) => s.width));
      for (const s of g) if (s.width > min * 1.05) neu.set(s.id, min);
    }
    if (neu.size === 0) return b;
    geaendert += neu.size;
    return { ...b, drawings: (b.drawings ?? []).map((s) => (neu.has(s.id) ? { ...s, width: neu.get(s.id)! } : s)) };
  });
  if (geaendert > 0) mutedHistory(() => useBoard.setState({ boards }));
  try { localStorage.setItem(KEY, '1'); } catch { /* dann beim nächsten Start noch einmal — unschädlich */ }
  return geaendert;
}
