/** Datei-Download per Anker — eine Quelle statt mehrerer Kopien (Audit M1). */
export function triggerDownload(href: string, filename: string): void {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
