/**
 * M236: Die Kopfleiste vermisst sich selbst.
 *
 * Bisher stand im Stylesheet, wo die Tab-Leiste anfangen darf: `left: 394px`,
 * gültig zwischen 861 und 1360 Bildpunkten. Diese Zahlen waren eine Schätzung
 * der Aktionsleisten-Breite zum Zeitpunkt von M89 — und Schätzungen altern:
 *
 *   · Der Text-Zoom (A− / A+, M224) vergrößert Logo und Knöpfe. Die 394 bleiben.
 *     Ergebnis: Die Tab-Leiste schiebt sich UNTER die Aktionsleiste, die Lupe
 *     verschwindet dahinter (User-Screenshot).
 *   · „Gut lesbare Schrift" macht dasselbe im Kleinen.
 *   · Jeder neue Knopf in der Aktionsleiste verschiebt die Grenze wieder.
 *
 * Also messen statt raten: Ein ResizeObserver liest die tatsächliche rechte
 * Kante der Kopfleiste und schreibt sie als `--kopf-links` in den Wurzelknoten.
 * Das Stylesheet rechnet damit — bei jeder Zoomstufe richtig, ohne Zahlenpflege.
 *
 * Warum eine CSS-Variable und kein Inline-Style am Element: Die Tab-Leiste
 * braucht den Wert an drei Stellen (left, max-width, und der Navigator-Baum
 * richtet sich danach aus). Eine Variable hält die drei automatisch synchron.
 */

/** Luft zwischen Aktionsleiste und Tab-Leiste — dieselbe wie das gap der Topbar */
const LUFT = 14;

export function initKopfmass(): () => void {
  const root = document.documentElement;
  let ro: ResizeObserver | null = null;

  /**
   * Gemessen wird mit `offsetLeft/offsetWidth`, NICHT mit
   * `getBoundingClientRect()`.
   *
   * Das ist der Kern der Sache: Die Anzeigegröße (A− / A+, M224) arbeitet mit
   * CSS `zoom` auf der Wurzel. Damit gibt es zwei Koordinatensysteme —
   * `getBoundingClientRect` liefert die Maße auf dem SCHIRM (bei 175 % endet
   * die Kopfleiste bei 621), `offsetLeft/offsetWidth` liefern sie im
   * LAYOUT (dort endet sie bei 355). CSS-Längen rechnen im Layout-System.
   * Wer den Schirm-Wert in eine CSS-Länge schreibt, multipliziert den Zoom
   * ein zweites Mal hinein: Die Tab-Leiste stand dann mit 490 Punkten Abstand
   * neben der Kopfleiste und schoss rechts weit aus dem Fenster.
   *
   * Aus demselben Grund darf für die Restbreite kein `vw` benutzt werden:
   * `vw` bleibt vom Zoom unberührt (1920 statt 1097) und verspricht Platz,
   * den es nicht gibt. `document.body.offsetWidth` ist die ehrliche Zahl.
   */
  const messen = () => {
    const bar = document.querySelector('.topbar') as HTMLElement | null;
    if (!bar) return;
    const links = Math.round(bar.offsetLeft + bar.offsetWidth + LUFT);
    const voll = document.body.offsetWidth;
    root.style.setProperty('--kopf-links', `${links}px`);
    root.style.setProperty('--kopf-voll', `${Math.max(160, voll - 24)}px`);
    root.style.setProperty('--kopf-rest', `${Math.max(160, voll - links - 12)}px`);
    /**
     * Und die Entscheidung „eine Zeile oder zwei" ebenfalls gemessen.
     *
     * Bisher hing sie an `@media (max-width: 860px)`. Media-Queries sehen
     * aber die Fensterbreite OHNE den Zoom der Wurzel: Ein 900 Punkte
     * breites Fenster gilt bei 175 % weiter als „Desktop", obwohl fürs
     * Layout nur noch 514 Punkte übrig sind — davon frisst die
     * Aktionsleiste 369. Die Tab-Leiste bekam dann 145 Punkte und schoss
     * aus dem Fenster. 260 Punkte sind die Grenze, unter der eine Reihe
     * Board-Namen nichts mehr taugt; darunter geht sie in die zweite Zeile.
     */
    root.dataset.kopfEng = voll - links < 260 ? 'an' : 'aus';
  };

  // Erst messen, wenn die Kopfleiste im DOM steht (React rendert nach dem Start)
  const start = () => {
    const bar = document.querySelector('.topbar');
    if (!bar) { requestAnimationFrame(start); return; }
    messen();
    ro = new ResizeObserver(messen);
    ro.observe(bar);
    // Der Zoom ändert die Fenstermaße, ohne dass die Leiste ihre Größe meldet
    window.addEventListener('resize', messen);
  };
  start();

  return () => {
    ro?.disconnect();
    window.removeEventListener('resize', messen);
  };
}
