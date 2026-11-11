// M344: Die Fanglinien beim Ziehen — in Board-Koordinaten, Strichstärke in Bildschirm-Größe.
import { useSyncExternalStore } from 'react';
import { fangAbo, fangLinien } from '../lib/fang';

export function Fanglinien() {
  const linien = useSyncExternalStore(fangAbo, fangLinien);
  return (
    <>
      {linien.map((f, i) => (
        <div
          key={`${f.art}${i}`}
          className={`fanglinie ${f.art}`}
          style={f.art === 'v' ? { left: f.pos, top: f.von, height: f.bis - f.von } : { top: f.pos, left: f.von, width: f.bis - f.von }}
        />
      ))}
    </>
  );
}
