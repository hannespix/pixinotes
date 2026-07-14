import type { NodeProps } from '@xyflow/react';
import type { FileData } from '../../types';
import { formatBytes } from '../../lib/parseEmail';
import { CardShell } from './CardShell';

const ICONS: Record<string, string> = {
  pdf: '📕',
  xlsx: '📊',
  xls: '📊',
  csv: '📊',
  docx: '📄',
  doc: '📄',
  pptx: '📽️',
  zip: '🗜️',
};

/** Beliebige Datei als Karte mit Icon, Name und Größe. */
export function FileCard({ id, data }: NodeProps) {
  const file = data as unknown as FileData;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const icon = ICONS[ext] ?? '📎';

  const download = () => {
    if (!file.dataUrl) return;
    const a = document.createElement('a');
    a.href = file.dataUrl;
    a.download = file.name;
    a.click();
  };

  return (
    <CardShell id={id} className="file-card">
      <button className="file-body nodrag" onClick={download} title={file.dataUrl ? 'Herunterladen' : undefined}>
        <span className="file-icon">{icon}</span>
        <span>
          <b>{file.name}</b>
          <span className="meta"> {formatBytes(file.size)}</span>
        </span>
      </button>
    </CardShell>
  );
}
