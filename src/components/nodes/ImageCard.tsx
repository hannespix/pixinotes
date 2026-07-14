import type { NodeProps } from '@xyflow/react';
import type { ImageData } from '../../types';
import { CardShell } from './CardShell';

/** Screenshot / Bild als Karte (per Strg+V, Drag&Drop oder aus E-Mail-Anhang). */
export function ImageCard({ id, data }: NodeProps) {
  const img = data as unknown as ImageData;
  return (
    <CardShell id={id} className="image-card">
      <img src={img.src} alt={img.name ?? 'Bild'} draggable={false} />
      {img.name && <div className="meta img-name">🖼️ {img.name}</div>}
    </CardShell>
  );
}
