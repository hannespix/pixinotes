/**
 * M211: Tastatur-Bewusstsein.
 *
 * Ohne die visualViewport-Schnittstelle rechnet eine Web-App weiter mit der
 * VOLLEN Fensterhöhe, auch wenn die Bildschirmtastatur die Hälfte davon
 * verdeckt. Alles, was per `position: fixed; bottom: …` schwebt — Dock,
 * Auswahl-Leiste, Rechtliches-Fuß — landet dann unter der Tastatur, und vom
 * eigentlichen Inhalt bleibt ein Streifen (User-Screenshot vom Android-Gerät).
 *
 * Wir spiegeln die Tastaturhöhe deshalb in die CSS-Variable `--kb` und setzen
 * `data-keyboard="on"` am <html>. Den Rest erledigt das Stylesheet — so bleibt
 * die Logik an EINER Stelle statt in jeder schwebenden Komponente.
 */

/** Unter dieser Höhe ist es keine Tastatur, sondern die ein-/ausfahrende
 *  Browser-Adressleiste (Android ~56px, iOS ~90px). */
const KEYBOARD_MIN = 120;

export function initViewportInsets(): () => void {
  const vv = window.visualViewport;
  const root = document.documentElement;
  if (!vv) {
    // Desktop-Browser ohne visualViewport: Variable trotzdem definieren, damit
    // calc(… + var(--kb)) überall rechnen kann
    root.style.setProperty('--kb', '0px');
    root.dataset.keyboard = 'off';
    return () => {};
  }
  const apply = () => {
    // offsetTop zählt mit: iOS scrollt das Layout-Viewport hoch, statt es zu
    // verkleinern — ohne diesen Term wäre die Tastatur dort scheinbar 0 hoch
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    const on = kb > KEYBOARD_MIN;
    root.style.setProperty('--kb', `${on ? Math.round(kb) : 0}px`);
    root.dataset.keyboard = on ? 'on' : 'off';
  };
  apply();
  vv.addEventListener('resize', apply);
  vv.addEventListener('scroll', apply);
  return () => {
    vv.removeEventListener('resize', apply);
    vv.removeEventListener('scroll', apply);
  };
}
