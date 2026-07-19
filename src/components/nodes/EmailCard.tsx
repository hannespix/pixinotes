import { useMemo, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { mutedHistory, useBoard } from '../../store';
import type { EmailNode, ParsedAttachment } from '../../types';
import { enrichText } from '../../lib/entities';
import { formatBytes, isImageMime } from '../../lib/parseEmail';
import { makeImage, makeNote } from '../../lib/nodes';
import { triggerDownload } from '../../lib/download';
import { aiReady, askAi, textToBlocks } from '../../lib/ai';
import { CardShell } from './CardShell';
import { DueChips } from './DueChips';
import { IMail, IWand } from '../Icons';

const PREVIEW_CHARS = 420;

/** E-Mail als lebendige Karte: Absender, Text mit klickbaren Entities, Anhänge als Chips. */
export function EmailCard({ id, data, selected, positionAbsoluteX, positionAbsoluteY }: NodeProps<EmailNode>) {
  const email = data;
  const [expanded, setExpanded] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const showToast = useBoard((s) => s.showToast);
  const ai = useBoard((s) => s.ai);

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
  // Entity-Erkennung (libphonenumber etc.) nicht bei jedem Render neu (Audit PERF-2)
  const enriched = useMemo(() => enrichText(text), [text]);

  /** Abgeleitetes Modul anlegen UND mit der E-Mail verbinden (M131) — ein History-Eintrag */
  const addDerived = (node: ReturnType<typeof makeNote>, label: string) => {
    const st = useBoard.getState();
    st.pushHistory();
    mutedHistory(() => {
      st.addNode(node);
      st.addLabeledEdge(id, node.id, label);
    });
  };

  const openAttachment = (att: ParsedAttachment) => {
    if (att.dataUrl && isImageMime(att.mime)) {
      // Bild-Anhang wird eine eigene Bild-Karte neben der E-Mail
      addDerived(makeImage({ x: positionAbsoluteX + 340, y: positionAbsoluteY + 40 }, att.dataUrl, att.name), 'Anhang');
      showToast(`🖼️ „${att.name}" als eigene Karte herausgelöst`);
    } else if (att.dataUrl) {
      triggerDownload(att.dataUrl, att.name);
    } else {
      showToast('Anhang zu groß zum Einbetten — nur Metadaten gespeichert.');
    }
  };

  const summarize = async () => {
    setAiBusy(true);
    try {
      const answer = await askAi(
        `Fasse diese E-Mail in 3-5 kurzen Stichpunkten auf Deutsch zusammen. Nenne konkrete Aufgaben und Fristen zuerst. Antworte NUR mit den Stichpunkten (mit "- " beginnend).\n\nBetreff: ${email.subject}\n\n${email.text.slice(0, 6000)}`,
      );
      addDerived(makeNote(
        { x: positionAbsoluteX + 340, y: positionAbsoluteY },
        { color: 'yellow', blocks: textToBlocks('✨ Zusammenfassung', answer) },
      ), 'Zusammenfassung');
      showToast('✨ Zusammenfassung als Notiz daneben gelegt');
    } catch (e) {
      showToast(`⚠️ KI-Fehler: ${(e as Error).message}`);
    } finally {
      setAiBusy(false);
    }
  };

  const reply = () => {
    // Nur echte Adressen durchlassen — präparierte From-Header könnten sonst
    // mailto-Parameter injizieren (?bcc=…&body=…) (Audit SEC-2)
    const raw = email.fromAddress ?? '';
    const to = /^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(raw) ? raw : '';
    const subject = encodeURIComponent(`Re: ${email.subject}`);
    window.open(`mailto:${encodeURIComponent(to)}?subject=${subject}`, '_self');
  };

  return (
    <CardShell id={id} selected={selected} minWidth={240} minHeight={140} className="email-card">
      <h3><IMail size={14} /> {email.subject}</h3>
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
        {enriched}
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
        {aiReady(ai) && (
          <button className="nodrag ai-btn" onClick={summarize} disabled={aiBusy} title="KI fasst die Mail als Notiz zusammen">
            {aiBusy ? '…' : <><IWand size={13} /> Zusammenfassen</>}
          </button>
        )}
      </div>
    </CardShell>
  );
}
