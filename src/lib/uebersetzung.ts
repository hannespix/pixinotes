// M368: Die Seite verträgt die Übersetzung des Browsers.
//
// PixiNotes ist auf Deutsch geschrieben. Wer eine andere Sprache spricht, lässt die Seite vom Browser
// übersetzen (Chrome, Edge, Safari, Firefox bieten das von selbst an, weil die Seite sich als deutsch
// ausweist). Zwei Dinge müssen dafür stimmen:
//
//   1. Die Inhalte der Nutzer bleiben, wie sie sind. Karten, Namen, Kommentare tragen translate="no" (im
//      Markup der Komponenten; der Editor von sich aus) — übersetzt wird die Oberfläche, nicht das Geschriebene.
//
//   2. Die Oberfläche bleibt heil. Übersetzer wie der von Chrome ersetzen Textknoten durch <font>-Elemente.
//      React merkt davon nichts: Es hält weiter die alten Textknoten in der Hand. Will es einen davon entfernen
//      oder etwas davor einfügen, wirft der Browser („The node to be removed is not a child of this node") und
//      der Bereich stürzt ab; ändert es nur den Text, schreibt es in einen Knoten, der gar nicht mehr im
//      Dokument hängt — die Anzeige bleibt auf dem alten Stand stehen. Bekanntes Leiden aller React-Seiten.
//
// Hier wird das an der Wurzel behoben, nicht Stelle für Stelle: Es wird mitgeschrieben, welcher Textknoten
// wodurch ersetzt wurde. Meint React den alten Knoten, bekommt es dessen Stellvertreter; ändert React den
// Text, kommt der Knoten zurück an seinen Platz (und der Übersetzer übersetzt den neuen Text wie jeden
// anderen neuen Inhalt). Ohne Übersetzung kostet das einen Vergleich je Aufruf.

/** Textknoten (wie React ihn kennt) → was heute an seiner Stelle steht */
const ersatz = new WeakMap<Node, Node>();
/** Umkehrung: Stellvertreter → der Textknoten, für den er steht */
const urbild = new WeakMap<Node, Node>();
/** Wurde überhaupt je etwas ersetzt? Vorher gibt es nichts nachzuschlagen. */
let ersetzt = false;
let bereit = false;

const merken = (text: Node, statt: Node) => { ersatz.set(text, statt); urbild.set(statt, text); ersetzt = true; };
const loesen = (text: Node) => { const r = ersatz.get(text); if (r) urbild.delete(r); ersatz.delete(text); };

const istFont = (n: Node | null | undefined): n is Element => !!n && n.nodeType === 1 && (n as Element).tagName === 'FONT';

/** Der Knoten unter `eltern`, der heute für `kind` steht — oder null */
function stellvertreter(eltern: Node, kind: Node): Node | null {
  // a) verpackt: Der Knoten hängt noch im Dokument, aber in <font>-Hüllen
  let n: Node = kind;
  while (n.parentNode && n.parentNode !== eltern && istFont(n.parentNode)) n = n.parentNode;
  if (n !== kind && n.parentNode === eltern) return n;
  // b) ersetzt: Der Knoten ist draußen, an seiner Stelle steht etwas anderes
  let r: Node | undefined = ersatz.get(kind);
  if (!r) return null;
  while (r.parentNode && r.parentNode !== eltern && istFont(r.parentNode)) r = r.parentNode;
  return r.parentNode === eltern ? r : null;
}

/** Zeigt die Seite gerade eine Übersetzung? (Chrome/Edge kennzeichnen die Wurzel, sonst: Es wurde ersetzt) */
export function istUebersetzt(): boolean {
  const w = document.documentElement;
  return ersetzt || /\btranslated-(ltr|rtl)\b/.test(w.className) || (!!w.lang && !/^de\b/i.test(w.lang));
}

export function initUebersetzung(): void {
  if (bereit || typeof Node === 'undefined' || typeof MutationObserver === 'undefined') return;
  // Nur für die Prüfung (m368): der Gegenversuch ohne Schutz
  if ((window as unknown as { __pnOhneUebersetzungsschutz?: boolean }).__pnOhneUebersetzungsschutz) return;
  bereit = true;
  const proto = Node.prototype;
  const entfernen = proto.removeChild;
  const einfuegen = proto.insertBefore;
  const anhaengen = proto.appendChild;

  /** Ein ersetzter Textknoten wird wieder gebraucht: Stellvertreter raus, damit er nicht doppelt dasteht */
  const stellvertreterWeg = (n: Node) => {
    if (!ersetzt || n.nodeType !== 3 || n.parentNode) return;
    const r = ersatz.get(n);
    loesen(n);
    if (r?.parentNode) entfernen.call(r.parentNode, r);
  };

  proto.removeChild = function <T extends Node>(this: Node, kind: T): T {
    if (kind && kind.parentNode !== this) {
      const s = ersetzt ? stellvertreter(this, kind) : null;
      if (s) { loesen(kind); entfernen.call(this, s); return kind; }
      // Nichts zu finden: Was nicht mehr hier hängt, ist schon weg — kein Grund, den Bereich abstürzen zu lassen
      if (ersetzt) return kind;
    }
    return entfernen.call(this, kind) as T;
  };

  proto.insertBefore = function <T extends Node>(this: Node, neu: T, vor: Node | null): T {
    stellvertreterWeg(neu);
    if (vor && vor.parentNode !== this && ersetzt) {
      return einfuegen.call(this, neu, stellvertreter(this, vor)) as T;
    }
    return einfuegen.call(this, neu, vor) as T;
  };

  proto.appendChild = function <T extends Node>(this: Node, neu: T): T {
    stellvertreterWeg(neu);
    return anhaengen.call(this, neu) as T;
  };

  // React ändert Text über nodeValue. Hängt der Knoten nicht mehr im Dokument, käme davon nichts an:
  // zurück an seinen Platz mit ihm.
  const wert = Object.getOwnPropertyDescriptor(proto, 'nodeValue');
  if (wert?.set && wert.get) {
    const setzen = wert.set;
    Object.defineProperty(proto, 'nodeValue', {
      configurable: true,
      enumerable: wert.enumerable,
      get: wert.get,
      set(this: Node, v: string | null) {
        setzen.call(this, v);
        if (!ersetzt || this.nodeType !== 3 || this.parentNode) return;
        const r = ersatz.get(this);
        if (r?.parentNode) {
          const eltern = r.parentNode;
          loesen(this);
          einfuegen.call(eltern, this, r);
          entfernen.call(eltern, r);
        }
      },
    });
  }

  // Mitschreiben, was der Übersetzer tut. Sein Kennzeichen ist das <font>-Element (die App selbst benutzt
  // keines): Ein Textknoten geht, ein <font> kommt an dieselbe Stelle. Später kann auch der Stellvertreter
  // wieder ersetzt werden — andere Sprache gewählt, „Original anzeigen".
  new MutationObserver((liste) => {
    let neu: Set<Node> | null = null;
    let fonts = false;
    for (const m of liste) {
      for (const n of m.addedNodes) {
        if (istFont(n)) fonts = true;
        else if (!ersetzt) continue;
        (neu ??= new Set()).add(n);
      }
    }
    if (!fonts && !ersetzt) return;
    for (const m of liste) {
      for (const weg of m.removedNodes) {
        const text = urbild.get(weg) ?? (weg.nodeType === 3 ? weg : null);
        if (!text || text.parentNode) {
          // verpackt statt ersetzt (der Knoten hängt jetzt in einem <font>): ab hier nachschlagen
          if (weg.nodeType === 3 && istFont(weg.parentNode)) ersetzt = true;
          continue;
        }
        const warStellvertreter = text !== weg;
        if (warStellvertreter && ersatz.get(text) !== weg) continue;
        const passt = (n: Node | null): n is Node => !!n && n !== text && !!neu?.has(n) && n.parentNode === m.target
          && (istFont(n) || (warStellvertreter && n.nodeType === 3 && !urbild.has(n)));
        let r: Node | null = null;
        for (const n of m.addedNodes) if (passt(n)) { r = n; break; }
        if (!r && passt(m.previousSibling)) r = m.previousSibling;
        if (!r && passt(m.nextSibling)) r = m.nextSibling;
        if (r && !urbild.has(r)) { if (warStellvertreter) urbild.delete(weg); merken(text, r); }
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
}
