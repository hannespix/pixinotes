/**
 * M217: Ist das der allererste Start?
 *
 * Die Frage muss beantwortet werden, BEVOR der Board-Speicher angelegt wird —
 * zustand/persist schreibt seinen Schlüssel gleich beim Initialisieren, danach
 * sieht jeder Start „benutzt" aus. Darum diese Prüfung in einem eigenen Modul,
 * das store.ts ganz oben importiert: Der Wert steht fest, bevor irgendwer
 * etwas speichert.
 *
 * „Erster Start" heißt: kein gespeicherter Board-Zustand UND kein Merker. Wer
 * über Sync, Import oder einen geteilten Link einsteigt, bringt bereits einen
 * Zustand mit und wird nicht begrüßt — dort wäre die Einführung auch fehl am
 * Platz, weil schon Inhalte da sind.
 */
export const isFirstRun: boolean = (() => {
  try {
    return !localStorage.getItem('pixinotes-board')
      && !localStorage.getItem('pixinotes-onboarded');
  } catch {
    return false; // privates Fenster ohne Speicher: lieber nicht stören
  }
})();
