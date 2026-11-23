// M344: Die Fanglinien beim Ziehen — in Board-Koordinaten, Strichstärke in Bildschirm-Größe.
// M349: dazu Abstandsmarken (Mitte zwischen zwei Karten, gleiche Abstände) mit Maß.
import { useRef, useSyncExternalStore, type CSSProperties } from 'react';
import { FANG_ENDE, fangAbo, fangStand, type Abstand, type Fanglinie } from '../lib/fang';

/**
 * M491: Plätze statt Ein- und Aushängen. Jedes Element, das mitten im Zug ins DOM kommt oder geht, lässt Chromium alle
 * `:has()`-Regeln mit Subjekt an Wurzel, Body und Fläche neu prüfen (`html:has(.app.focus-mode) .toast`,
 * `.react-flow:has(.react-flow__connectionline) …`) — und weil dahinter Nachfahren-Selektoren stehen, rechnete er
 * den Stil des GANZEN Dokuments neu: 7 000–8 400 Elemente, gut 40 ms, bei jeder neuen oder verschwindenden Linie
 * (im Trace 36 Mal auf 50 Mausbewegungen). Die Plätze bleiben deshalb hängen, bis der Zug vorbei ist (nur so viele,
 * wie je gleichzeitig gebraucht wurden), und werden nur über Inline-Stil gezeigt oder versteckt — das prüft kein
 * `:has()` (die Klasse wechselt auf `fang-platz`, die in keinem `:has()` vorkommt). Je Art (v/h) ein eigener Vorrat.
 */
const AUS: CSSProperties = { display: 'none' };

function usePlaetze(n: number, frei: boolean): number {
  const max = useRef(0);
  // nach dem Zug (und nur dann) gibt es die Plätze wieder her — mitten im Zug bleiben sie
  if (frei) max.current = 0;
  else if (n > max.current) max.current = n;
  return max.current;
}

export function Fanglinien() {
  const stand = useSyncExternalStore(fangAbo, fangStand);
  const { linien, abstaende } = stand; const frei = stand === FANG_ENDE;
  const lv = linien.filter((f) => f.art === 'v'); const lh = linien.filter((f) => f.art === 'h');
  const av = abstaende.filter((a) => a.art === 'v'); const ah = abstaende.filter((a) => a.art === 'h');
  const nLv = usePlaetze(lv.length, frei); const nLh = usePlaetze(lh.length, frei);
  const nAv = usePlaetze(av.length, frei); const nAh = usePlaetze(ah.length, frei);
  const linie = (art: 'v' | 'h', liste: Fanglinie[], n: number) => Array.from({ length: n }, (_, i) => {
    const f = liste[i];
    return (
      <div
        key={`${art}${i}`}
        className={f ? `fanglinie ${art}` : `fang-platz ${art}`}
        style={!f ? AUS : art === 'v' ? { left: f.pos, top: f.von, height: f.bis - f.von } : { top: f.pos, left: f.von, width: f.bis - f.von }}
      />
    );
  });
  const abstand = (art: 'v' | 'h', liste: Abstand[], n: number) => Array.from({ length: n }, (_, i) => {
    const a = liste[i];
    return (
      <div
        key={`a${art}${i}`}
        className={a ? `fang-abstand ${art}` : `fang-platz ${art}`}
        style={!a ? AUS : art === 'h' ? { left: a.von, top: a.quer, width: a.bis - a.von } : { top: a.von, left: a.quer, height: a.bis - a.von }}
      >
        <span className="fang-mass">{a ? Math.round(a.bis - a.von) : 0}</span>
      </div>
    );
  });
  return (
    <>
      {linie('v', lv, nLv)}
      {linie('h', lh, nLh)}
      {abstand('h', ah, nAh)}
      {abstand('v', av, nAv)}
    </>
  );
}
