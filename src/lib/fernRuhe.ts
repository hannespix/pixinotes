// M338: Fern-Ruhe — Karten weit außerhalb des Bildes kosten nichts mehr.
//
// Gemessen: Beim Schwenken und Zoomen zeichnet der Browser jeden Schritt neu,
// und der Aufwand wächst mit ALLEN Karten des Boards, nicht nur mit den
// sichtbaren (10 ms je Bild bei 300 Karten, auch wenn nur vier zu sehen sind).
// Blendet man den Karteninhalt aus, bleiben 10 % davon übrig.
//
// Darum bekommt der Inhalt jeder Karte, die mehr als einen halben Schirm
// außerhalb liegt, `content-visibility: hidden`: Der Browser überspringt Stil,
// Layout und Zeichnen, DOM und Zustand bleiben aber vollständig erhalten
// (laufende Apps, PDF-Seite, Editor-Verlauf). Die Größe der Karte bleibt über
// die gemerkten Innenmaße exakt, damit Verbindungen, Einpassen und Anordnen
// weiter stimmen. Kommt die Karte in die Nähe des Bildes, ist sie wieder da,
// bevor man sie sieht. Ausgewählte, gezogene und fokussierte Karten sowie
// Karten mit dem Cursor darin ruhen nie; Export und Druck zeigen alles.
let beobachter: IntersectionObserver | null = null;

function schalten(eintraege: IntersectionObserverEntry[]): void {
  // Erst ALLES lesen, dann ALLES schreiben — sonst erzwingt jede Karte ein eigenes Layout
  const wecken: HTMLElement[] = [];
  const ruhen: Array<{ shell: HTMLElement; w: number; h: number }> = [];
  for (const e of eintraege) {
    const shell = e.target as HTMLElement;
    if (e.isIntersecting) {
      if (shell.hasAttribute('data-fern')) wecken.push(shell);
      continue;
    }
    if (shell.hasAttribute('data-fern')) continue;
    const knoten = shell.parentElement;
    if (!knoten || knoten.classList.contains('selected') || knoten.classList.contains('dragging') || knoten.classList.contains('pn-focused')) continue;
    if (shell.contains(document.activeElement)) continue;
    const body = shell.querySelector(':scope > .card-body') as HTMLElement | null;
    if (!body || body.offsetWidth < 2 || body.offsetHeight < 2) continue;
    // Innenmaße (ohne Polster und Rand): Sie ersetzen den Inhalt, solange er nicht gerechnet wird
    const cs = getComputedStyle(body);
    const px = (v: string) => parseFloat(v) || 0;
    ruhen.push({
      shell,
      w: Math.max(0, body.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight)),
      h: Math.max(0, body.clientHeight - px(cs.paddingTop) - px(cs.paddingBottom)),
    });
  }
  for (const shell of wecken) shell.removeAttribute('data-fern');
  for (const r of ruhen) {
    r.shell.style.setProperty('--fern-w', `${r.w}px`);
    r.shell.style.setProperty('--fern-h', `${r.h}px`);
    r.shell.setAttribute('data-fern', '');
  }
}

/** Karte anmelden; die Rückgabe meldet sie wieder ab */
export function fernBeobachten(shell: HTMLElement): () => void {
  if (typeof IntersectionObserver === 'undefined' || !CSS.supports?.('content-visibility', 'hidden')) return () => {};
  if (!beobachter) beobachter = new IntersectionObserver(schalten, { root: null, rootMargin: '50% 50% 50% 50%' });
  beobachter.observe(shell);
  return () => { beobachter?.unobserve(shell); shell.removeAttribute('data-fern'); };
}

/** Für Export und Druck: alles zeigen, bis `ende()` aufgerufen wird (wartet zwei Bilder, bis der Inhalt steht) */
export async function allesZeigen(): Promise<() => void> {
  document.documentElement.setAttribute('data-alles-zeigen', '');
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  return () => document.documentElement.removeAttribute('data-alles-zeigen');
}
