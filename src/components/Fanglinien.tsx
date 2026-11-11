// M344: Die Fanglinien beim Ziehen — in Board-Koordinaten, Strichstärke in Bildschirm-Größe.
// M349: dazu Abstandsmarken (Mitte zwischen zwei Karten, gleiche Abstände) mit Maß.
import { useSyncExternalStore } from 'react';
import { fangAbo, fangStand } from '../lib/fang';

export function Fanglinien() {
  const { linien, abstaende } = useSyncExternalStore(fangAbo, fangStand);
  return (
    <>
      {linien.map((f, i) => (
        <div
          key={`${f.art}${i}`}
          className={`fanglinie ${f.art}`}
          style={f.art === 'v' ? { left: f.pos, top: f.von, height: f.bis - f.von } : { top: f.pos, left: f.von, width: f.bis - f.von }}
        />
      ))}
      {abstaende.map((a, i) => (
        <div
          key={`a${a.art}${i}`}
          className={`fang-abstand ${a.art}`}
          style={a.art === 'h' ? { left: a.von, top: a.quer, width: a.bis - a.von } : { top: a.von, left: a.quer, height: a.bis - a.von }}
        >
          <span className="fang-mass">{Math.round(a.bis - a.von)}</span>
        </div>
      ))}
    </>
  );
}
