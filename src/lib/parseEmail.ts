// E-Mail-Parsing komplett im Browser — keine Daten verlassen den Rechner.
// .eml über postal-mime (postalsys), .msg über @kenjiuno/msgreader (Apache-2.0).
import PostalMime from 'postal-mime';
import type { EmailData, ParsedAttachment } from '../types';

/** Anhänge nur bis zu dieser Größe als data:-URL einbetten (localStorage-Budget!) */
const MAX_EMBED_BYTES = 1_500_000;

function bytesToDataUrl(bytes: Uint8Array, mime = 'application/octet-stream'): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

export async function parseEml(buffer: ArrayBuffer): Promise<EmailData> {
  const email = await PostalMime.parse(buffer);

  const attachments: ParsedAttachment[] = (email.attachments ?? []).map((a) => {
    const content = a.content instanceof ArrayBuffer ? new Uint8Array(a.content) : undefined;
    const size = content?.byteLength ?? 0;
    return {
      name: a.filename || 'Anhang',
      mime: a.mimeType,
      size,
      dataUrl:
        content && size > 0 && size <= MAX_EMBED_BYTES
          ? bytesToDataUrl(content, a.mimeType)
          : undefined,
    };
  });

  return {
    subject: email.subject || '(kein Betreff)',
    fromName: email.from?.name || email.from?.address || 'Unbekannt',
    fromAddress: email.from?.address,
    date: email.date,
    text: (email.text || stripHtml(email.html || '')).trim(),
    attachments,
  };
}

export async function parseMsg(buffer: ArrayBuffer): Promise<EmailData> {
  // Lazy-Import: msgreader (+iconv-lite) nur laden, wenn wirklich eine .msg-Datei kommt
  const { default: MsgReader } = await import('@kenjiuno/msgreader');
  const reader = new MsgReader(buffer);
  // Deutsche Umlaute in ANSI-kodierten Outlook-Mails korrekt dekodieren (M7)
  (reader as { parserConfig?: { ansiEncoding?: string } }).parserConfig = { ansiEncoding: 'windows-1252' };
  const data = reader.getFileData();

  const attachments: ParsedAttachment[] = (data.attachments ?? []).map((att) => {
    let dataUrl: string | undefined;
    let size = att.contentLength ?? 0;
    try {
      const file = reader.getAttachment(att);
      if (file?.content) {
        size = file.content.byteLength;
        if (size <= MAX_EMBED_BYTES) {
          dataUrl = bytesToDataUrl(file.content, guessMime(att.fileName ?? ''));
        }
      }
    } catch {
      // Anhang nicht extrahierbar — nur Metadaten anzeigen
    }
    return { name: att.fileName || att.name || 'Anhang', mime: guessMime(att.fileName ?? ''), size, dataUrl };
  });

  return {
    subject: data.subject || '(kein Betreff)',
    fromName: data.senderName || data.senderEmail || 'Unbekannt',
    fromAddress: data.senderEmail,
    date: data.messageDeliveryTime,
    text: (data.body || stripHtml((data as { bodyHtml?: string }).bodyHtml || '')).trim(),
    attachments,
  };
}

function stripHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body.textContent || '';
}

export function guessMime(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls: 'application/vnd.ms-excel',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc: 'application/msword',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain',
    csv: 'text/csv',
    zip: 'application/zip',
    eml: 'message/rfc822',
  };
  return map[ext] || 'application/octet-stream';
}

export function isImageMime(mime?: string): boolean {
  return !!mime && mime.startsWith('image/');
}

export function formatBytes(size: number): string {
  if (!size) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
