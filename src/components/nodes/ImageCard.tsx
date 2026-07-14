import type { NodeProps } from '@xyflow/react';
import type { ImageNode } from '../../types';
import { CardShell } from './CardShell';

/** Screenshot / Bild als Karte (per Strg+V, Drag&Drop oder aus E-Mail-Anhang). */
export function ImageCard({ id, data, selected }: NodeProps<ImageNode>) {
  const img = data;
  return (
    <CardShell id={id} selected={selected} minWidth={120} minHeight={90} className="image-card">
      <img src={img.src} alt={img.name ?? 'Bild'} draggable={false} />
      {img.name && <div className="meta img-name">🖼️ {img.name}</div>}
    </CardShell>
  );
}
