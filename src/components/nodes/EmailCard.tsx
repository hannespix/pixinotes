import { useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { useReactFlow } from '@xyflow/react';
import { useBoard } from '../../store';
import type { EmailData } from '../../types';
import { enrichText } from '../../lib/entities';
import { formatBytes, isImageMime } from '../../lib/parseEmail';
import { uid } from '../../types';
import { CardShell } from './CardShell';
import { DueChips } from './DueChips';

const PREVIEW_CHARS = 420;

/** E-Mail als lebendige Karte: Absender, Text mit klickbaren Entities, Anhänge als Chips. */
export function EmailCard({ id, data, selected, positionAbsoluteX, positionAbsoluteY }: NodeProps) {
  const email = data as unknown as EmailData;
  const [expanded, setExpanded] = useState(false);
  const addNode = useBoard((s) => s.addNode);
  const showToast = useBoard((s) => s.showToast);
  useReactFlow(); // hält die Karte im Flow-Kontext

  const initials = email.fromName
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const parsedDate = email.date ? new Date(email.date) : null;
  const dateLabel = parsedDate && !Number.isNaN(parsedDate.getTime())
    ? parsedDate.toLocaleString('de-DE', {
        weekday: 'short',
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

  const text = expanded ? email.text : email.text.slice(0, PREVIEW_CHARS);
  const truncated = email.text.length > PREVIEW_CHARS;

  const openAttachment = (att: EmailData['attachments'][number]) => {
    if (att.dataUrl && isImageMime(att.mime)) {
      // Bild-Anhang wird eine eigene Bild-Karte neben der E-Mail
      addNode({
        id: uid(),
        type: 'image',
        width: 260,
        position: { x: positionAbsoluteX + 340, y: positionAbsoluteY + 40 },
        data: { src: att.dataUrl, name: att.name },
      });
      showToast(`🖼️ „${att.name}" als eigene Karte herausgelöst`);
    } else if (att.dataUrl) {
      const a = document.createElement('a');
      a.href = att.dataUrl;
      a.download = att.name;
      a.click();
    } else {
      showToast('Anhang zu groß zum Einbetten — nur Metadaten gespeichert.');
    }
  };

  const reply = () => {
    const to = email.fromAddress ?? '';
    const subject = encodeURIComponent(`Re: ${email.subject}`);
    window.open(`mailto:${to}?subject=${subject}`, '_self');
  };

  return (
    <CardShell id={id} selected={selected} minWidth={240} minHeight={140} className="email-card">
      <h3>📧 {email.subject}</h3>
      <div className="email-from">
        <div className="avatar">{initials}</div>
        <div>
          <b>{email.fromName}</b>
          <div className="meta">
            {dateLabel}
            {email.fromAddress ? ` · ${email.fromAddress}` : ''}
          </div>
        </div>
      </div>
      <p className="email-body nodrag">
        {enrichText(text)}
        {truncated && !expanded ? '… ' : ' '}
        {truncated && (
          <button className="link-btn nodrag" onClick={() => setExpanded(!expanded)}>
            {expanded ? 'weniger' : 'mehr'}
          </button>
        )}
      </p>
      {email.attachments.length > 0 && (
        <div className="chips">
          {email.attachments.map((att, i) => (
            <button
              key={i}
              className="chip nodrag"
              title={
                isImageMime(att.mime)
                  ? 'Als eigene Karte aufs Board legen'
                  : att.dataUrl
                    ? 'Herunterladen'
                    : 'Anhang (Metadaten)'
              }
              onClick={() => openAttachment(att)}
            >
              📎 {att.name}
              {att.size ? <span className="chip-size">{formatBytes(att.size)}</span> : null}
            </button>
          ))}
        </div>
      )}
      <DueChips text={email.text} context={email.subject} />
      <div className="card-actions">
        <button className="nodrag" onClick={reply}>↩ Antworten</button>
      </div>
    </CardShell>
  );
}
