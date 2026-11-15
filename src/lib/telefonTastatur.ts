// M386: Die Eingabe-Taste der Telefon-Tastatur.
//
// Viele Felder hier schließen mit Enter ab (Idee eintragen, Ticket anlegen, umbenennen …). Am Telefon gibt es die
// Taste aber nicht immer: Steht ein Feld nicht in einem Formular und folgt ihm ein weiteres, zeigt die Tastatur
// „Weiter" — das springt nur ins nächste Feld, ein Enter kommt nie an. Mit dem Hinweis „done" bietet sie
// stattdessen „Fertig" und meldet Enter. Gesetzt wird er beim Hineintippen, für jedes einzeilige Feld, das selbst
// keinen Hinweis trägt und in keinem Formular steht (dort schickt die Taste ohnehin ab).
const EINZEILIG = /^(text|search|url|email|tel|number|password|)$/i;

let gestartet = false;
export function initTelefonTastatur(): void {
  if (gestartet || typeof document === 'undefined') return;
  gestartet = true;
  document.addEventListener('focusin', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || t.form || t.hasAttribute('enterkeyhint') || !EINZEILIG.test(t.getAttribute('type') ?? '')) return;
    t.setAttribute('enterkeyhint', 'done');
  }, true);
}
