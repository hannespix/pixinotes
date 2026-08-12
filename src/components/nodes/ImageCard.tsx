import { useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { useBoard } from '../../store';
import { triggerDownload } from '../../lib/download';
import type { ImageNode } from '../../types';
import { CardShell } from './CardShell';
import { DragTitle } from './DragTitle';
import { BildLupe } from './BildLupe';

/**
 * Screenshot / Bild als Karte (per Strg+V, Drag&Drop oder aus E-Mail-Anhang).
 *
 * M263: Mit eigenem Titel. „Bildschirmfoto 2026-08-12 um 10.14.32.png" ist
 * kein Name, sondern ein Zeitstempel — die Karte lässt sich per Doppelklick
 * benennen. Die Zeile erscheint, sobald es etwas zu zeigen gibt oder die Karte
 * ausgewählt ist; ein unbenannter Screenshot bleibt sonst ein reines Bild.
 *
 * M264: Und sie lässt sich groß ansehen. ⤢ öffnet die Lupe — bewusst ein
 * eigener Knopf statt „Klick aufs Bild": Ein Klick wählt die Karte aus und
 * fliegt sie (M74) an; das darf eine Vorschau nicht kapern.
 */
export function ImageCard({ id, data, selected }: NodeProps<ImageNode>) {
  const img = data;
  const titel = img.titel?.trim() || img.name || '';
  const [lupe, setLupe] = useState(false);
  return (
    <CardShell id={id} selected={selected} minWidth={120} minHeight={90} className="image-card">
      <img src={img.src} alt={titel || 'Bild'} draggable={false} />
      <button
        className="bild-lupe-auf nodrag"
        title="Groß ansehen und zoomen"
        aria-label="Bild groß ansehen"
        onClick={(e) => { e.stopPropagation(); setLupe(true); }}
      >⤢</button>
      {(titel || selected) && (
        <div className="meta img-name">
          🖼️
          <DragTitle
            className="img-titel"
            value={titel}
            placeholder="Bild benennen"
            onChange={(v) => {
              const neu = v.trim();
              useBoard.getState().updateNodeData(id, { titel: neu && neu !== img.name ? neu : undefined });
            }}
          />
        </div>
      )}
      {lupe && (
        <BildLupe
          quelle={img.src}
          name={titel || 'Bild'}
          onClose={() => setLupe(false)}
          onDownload={() => triggerDownload(img.src, img.name || `${titel || 'bild'}.png`)}
        />
      )}
    </CardShell>
  );
}
