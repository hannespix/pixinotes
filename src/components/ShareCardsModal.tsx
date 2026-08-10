// M202: Teilen-Dialog für einzelne Karten — ein Ort für alle Ausgabewege:
// Übernahme-Link (PixiNotes), WhatsApp, E-Mail, Drucken/PDF-Dialog, PDF-Datei,
// formatiertes Kopieren. Große Ziele (min. 44px), Esc/Außenklick schließt.
import { useMemo, useState } from 'react';
import { selectActiveBoard, useBoard } from '../store';
import { nodesToHtml, nodesToText } from '../lib/serialize';
import { cardsShareUrl, cardsToBoardDoc, cardsToPdf, printCards, whatsappUrl } from '../lib/shareCards';
import { ICopy, IDownload, IFolder, IMail, IX } from './Icons';

const MAILTO_LIMIT = 1800;

export function ShareCardsModal() {
  const ids = useBoard((s) => s.shareCards);
  const setShareCards = useBoard((s) => s.setShareCards);
  const showToast = useBoard((s) => s.showToast);
  const board = useBoard(selectActiveBoard);
  const [busy, setBusy] = useState('');
  const nodes = useMemo(
    () => (ids ? board.nodes.filter((n) => ids.includes(n.id)) : []),
    [ids, board.nodes],
  );
  if (!ids) return null;
  const close = () => setShareCards(null);
  if (nodes.length === 0) { close(); return null; }
  const title = `${nodes.length} Karte${nodes.length > 1 ? 'n' : ''}`;

  const copyLink = async () => {
    setBusy('link');
    try {
      const doc = cardsToBoardDoc(nodes, board, `Karten aus „${board.name}"`);
      const url = await cardsShareUrl(doc);
      if (!url) {
        showToast('Zu groß für einen Link (Bilder?) — stattdessen als .pixiboard.json heruntergeladen. Die Datei einfach aufs Board des Empfängers ziehen.');
      } else {
        await navigator.clipboard.writeText(url);
        showToast('🔗 Übernahme-Link kopiert — wer ihn öffnet, bekommt die Karten als eigenes Board in PixiNotes angeboten.');
      }
    } catch {
      showToast('Link konnte nicht kopiert werden.');
    } finally { setBusy(''); }
  };

  const mail = () => {
    let text = nodesToText(nodes);
    if (text.length > MAILTO_LIMIT) text = `${text.slice(0, MAILTO_LIMIT)}\n… (gekürzt — vollständigen Inhalt per „Kopieren" einfügen)`;
    const subject = encodeURIComponent(`Notizen aus PixiNotes (${title})`);
    window.open(`mailto:?subject=${subject}&body=${encodeURIComponent(text)}`, '_self');
  };

  const copyHtml = async () => {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([nodesToHtml(nodes)], { type: 'text/html' }),
        'text/plain': new Blob([nodesToText(nodes)], { type: 'text/plain' }),
      })]);
      showToast('📋 Formatiert kopiert — direkt in Outlook/Word einfügbar.');
    } catch {
      await navigator.clipboard.writeText(nodesToText(nodes));
      showToast('📋 Als Text kopiert.');
    }
  };

  const pdf = async () => {
    setBusy('pdf');
    try {
      await cardsToPdf(nodes, `pixinotes-${board.name.replace(/[^\p{L}\d\-_ ]/gu, '').trim().slice(0, 30) || 'karten'}`);
      showToast('📄 PDF-Datei erstellt (Downloads).');
    } catch (e) {
      // M244: Der Grund gehört dazu. Vorher meldete der Export auch dann
      // Erfolg, wenn die Seite leer blieb — das kostet mehr Zeit als ein
      // ehrlicher Fehler, weil man den Fehler erst im PDF-Betrachter sieht.
      const grund = e instanceof Error && e.message ? ` (${e.message})` : '';
      showToast(`PDF fehlgeschlagen${grund} — der Druck-Weg („Drucken" → als PDF sichern) funktioniert immer.`);
    } finally { setBusy(''); }
  };

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal share-cards-modal" role="dialog" aria-modal="true" aria-label="Karten teilen" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Teilen &amp; Export — {title}</h2>
          <button className="modal-x" onClick={close} aria-label="Schließen"><IX size={14} /></button>
        </div>
        <div className="share-cards-grid">
          <button onClick={() => void copyLink()} disabled={busy === 'link'} title="Serverloser Link: die Karten stecken komplett im Link — wer ihn in PixiNotes öffnet, übernimmt sie als eigenes Board">
            <IFolder size={18} />
            <b>Übernahme-Link</b>
            <span>für andere PixiNotes-Nutzer</span>
          </button>
          <button
            onClick={() => { window.open(whatsappUrl(nodes), '_blank', 'noopener'); }}
            title="Inhalt als Text über WhatsApp teilen (öffnet WhatsApp bzw. WhatsApp Web)"
          >
            <span className="share-emoji" aria-hidden>💬</span>
            <b>WhatsApp</b>
            <span>Inhalt als Nachricht</span>
          </button>
          <button onClick={mail} title="Inhalt als E-Mail-Entwurf im Mail-Programm öffnen">
            <IMail size={18} />
            <b>E-Mail</b>
            <span>als Entwurf öffnen</span>
          </button>
          <button
            onClick={() => { if (!printCards(nodes, `PixiNotes — ${board.name}`)) showToast('Pop-up blockiert — bitte Pop-ups für diese Seite erlauben.'); }}
            title={'Druckansicht öffnen — dort bietet der Browser auch „Als PDF sichern" an'}
          >
            <span className="share-emoji" aria-hidden>🖨️</span>
            <b>Drucken</b>
            <span>auch „als PDF sichern"</span>
          </button>
          <button onClick={() => void pdf()} disabled={busy === 'pdf'} title="Fertige PDF-Datei erzeugen und herunterladen (komplett im Browser, ohne Server)">
            <IDownload size={18} />
            <b>PDF-Datei</b>
            <span>{busy === 'pdf' ? 'wird erstellt …' : 'direkt herunterladen'}</span>
          </button>
          <button onClick={() => void copyHtml()} title="Formatiert in die Zwischenablage — direkt in Outlook/Word/Teams einfügbar">
            <ICopy size={18} />
            <b>Kopieren</b>
            <span>formatiert (Outlook/Word)</span>
          </button>
        </div>
        <div className="share-cards-foot">
          Der Übernahme-Link enthält die Karten selbst (serverlos, nichts wird hochgeladen).
          KI-Schlüssel und Zugangsdaten sind nie Teil geteilter Inhalte.
        </div>
      </div>
    </div>
  );
}
