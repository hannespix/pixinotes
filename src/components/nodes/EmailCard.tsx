import { useMemo, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { mutedHistory, selectActiveBoard, useBoard } from '../../store';
import type { EmailNode, ParsedAttachment } from '../../types';
import { enrichText } from '../../lib/entities';
import { formatBytes, isImageMime } from '../../lib/parseEmail';
import { makeImage, makeNote } from '../../lib/nodes';
import { triggerDownload } from '../../lib/download';
import { aiReady } from '../../lib/ai';
import { CardShell } from './CardShell';
import { DueChips } from './DueChips';
import { ICheck, IKanban, IMail, IWand, IPaperclip } from '../Icons';

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
      showToast(`„${att.name}" als eigene Karte herausgelöst`);
    } else if (att.dataUrl) {
      triggerDownload(att.dataUrl, att.name);
    } else {
      showToast('Anhang zu groß zum Einbetten – nur Metadaten gespeichert.');
    }
  };

  // M451: Destillat statt Zusammenfassung — Kernaussage, offene Fragen, Aufgaben mit Frist und Person, Termine und
  // Zahlen als gegliederte Notiz daneben (lib/mailDestillat.ts, nachgeladen). Die Mail bleibt unverändert.
  const destillieren = async () => {
    setAiBusy(true);
    try {
      const { mailDestillieren } = await import('../../lib/mailDestillat');
      showToast(await mailDestillieren(id), false, 5000);
    } catch (e) {
      showToast(`KI-Fehler: ${(e as Error).message}`);
    } finally {
      setAiBusy(false);
    }
  };

  // M451: Die erkannten Aufgaben mit einem Klick übernehmen — als Checkliste in der Notiz oder als Kanban-Tickets
  const stand = email.destillat as { notizId: string; aufgaben: unknown[]; uebernommen?: string } | undefined;
  const notizDa = useBoard((s) => !!stand && selectActiveBoard(s).nodes.some((n) => n.id === stand.notizId));
  const aufgabenOffen = !!stand && !stand.uebernommen && stand.aufgaben.length > 0 && notizDa;
  const uebernehmen = async (wie: 'checkliste' | 'kanban') => {
    const { alsCheckliste, alsKanban } = await import('../../lib/mailDestillat');
    showToast(wie === 'checkliste' ? alsCheckliste(id) : alsKanban(id), true, 6000);
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
      <h3 translate="no"><IMail size={14} /> {email.subject}</h3>
      <div className="email-from">
        <div className="avatar" translate="no">{initials}</div>
        <div>
          <b translate="no">{email.fromName}</b>
          <div className="meta">
            {dateLabel}
            {email.fromAddress ? <> · <span translate="no">{email.fromAddress}</span></> : ''}
          </div>
        </div>
      </div>
      <p className="email-body nodrag">
        <span translate="no">{enriched}</span>
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
              translate="no"
              title={
                isImageMime(att.mime)
                  ? 'Als eigene Karte aufs Board legen'
                  : att.dataUrl
                    ? 'Herunterladen'
                    : 'Anhang (Metadaten)'
              }
              onClick={() => openAttachment(att)}
            >
              <IPaperclip size={12} /> {att.name}
              {att.size ? <span className="chip-size">{formatBytes(att.size)}</span> : null}
            </button>
          ))}
        </div>
      )}
      <DueChips text={email.text} context={email.subject} />
      <div className="card-actions">
        <button className="nodrag" onClick={reply}>↩ Antworten</button>
        {aiReady(ai) && (
          <button className="nodrag ai-btn" onClick={destillieren} disabled={aiBusy} title="KI destilliert den Verlauf: Kernaussage, offene Fragen, Aufgaben, Termine und Zahlen – als Notiz daneben">
            {aiBusy ? '…' : <><IWand size={13} /> Destillat</>}
          </button>
        )}
      </div>
      {aufgabenOffen && (
        <div className="card-actions email-aufgaben">
          <span className="email-aufgaben-label">Aufgaben übernehmen:</span>
          <button className="nodrag" data-taste="destillat-checkliste" onClick={() => void uebernehmen('checkliste')} title="Die Aufgaben-Punkte im Destillat werden abhakbar">
            <ICheck size={13} /> Als Checkliste
          </button>
          <button className="nodrag" data-taste="destillat-kanban" onClick={() => void uebernehmen('kanban')} title="Neue Kanban-Karte mit je einem Ticket samt Frist und Person">
            <IKanban size={13} /> Als Tickets
          </button>
        </div>
      )}
    </CardShell>
  );
}
