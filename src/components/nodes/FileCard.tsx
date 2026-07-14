import type { NodeProps } from '@xyflow/react';
import type { FileNode } from '../../types';
import { formatBytes } from '../../lib/parseEmail';
import { triggerDownload } from '../../lib/download';
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
export function FileCard({ id, data, selected }: NodeProps<FileNode>) {
  const file = data;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const icon = ICONS[ext] ?? '📎';

  const download = () => {
    if (file.dataUrl) triggerDownload(file.dataUrl, file.name);
  };

  return (
    <CardShell id={id} selected={selected} minWidth={170} minHeight={50} className="file-card">
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
