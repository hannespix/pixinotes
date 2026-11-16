/** Datei-Download per Anker — eine Quelle statt mehrerer Kopien (Audit M1). */
export function triggerDownload(href: string, filename: string): void {
  /**
   * M340: `data:`-Adressen gehen als Blob hinaus. Ein großes Board-Bild ist als data:-Adresse
   * schnell zehn Megabyte lang — Safari und mancher Chrome brechen solche Downloads still ab
   * (es passiert einfach nichts). Ein Blob hat diese Grenze nicht.
   */
  /* M388: Die Adresse kann aus einem Board stammen, das andere gefüllt haben. Einen Anker mit einer
     javascript:-Adresse führt der Browser beim Klick aus — im Namen von PixiNotes. Heruntergeladen wird darum
     nur Eingebettetes (data:, blob:); eine Webadresse öffnet sich in einem neuen Tab, alles andere bleibt liegen. */
  if (typeof href !== 'string' || !href) return;
  if (!/^(data:|blob:)/i.test(href)) {
    let u: URL;
    try { u = new URL(href, window.location.href); } catch { return; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
    if (u.origin !== window.location.origin) { window.open(u.href, '_blank', 'noopener'); return; }
  }
  let ziel = href;
  let frei: string | null = null;
  if (href.startsWith('data:')) {
    const blob = dataUrlZuBlob(href);
    if (blob) { ziel = URL.createObjectURL(blob); frei = ziel; }
  }
  const a = document.createElement('a');
  a.href = ziel;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (frei) { const u = frei; setTimeout(() => URL.revokeObjectURL(u), 30000); }
}

export function dataUrlZuBlob(dataUrl: string): Blob | null {
  const komma = dataUrl.indexOf(',');
  if (komma < 0) return null;
  const kopf = dataUrl.slice(5, komma);
  const typ = kopf.split(';')[0] || 'application/octet-stream';
  const rest = dataUrl.slice(komma + 1);
  try {
    if (/;base64/i.test(kopf)) {
      const bin = atob(rest);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: typ });
    }
    return new Blob([decodeURIComponent(rest)], { type: /charset=/i.test(kopf) ? kopf : `${typ};charset=utf-8` });
  } catch {
    return null;
  }
}
