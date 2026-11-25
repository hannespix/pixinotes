import { fensterDarueber } from './overlay';

/**
 * M534: Esc-Stapel auch für die übrigen Dialoge (Vorlagen, Versionen, Sicherung, App installieren, Ebene löschen,
 * Themen, Eingang, QR). Sie hörten in der Capture-Phase auf Esc und schlossen sich — auch wenn darüber noch die Hilfe
 * (Alt+H), die Einstellungen (Alt+E) oder die Suche (Strg+K) lag: Ein Druck schloss dann das Fenster darunter, das
 * obere blieb stehen. Jetzt fragen sie zuerst, ob über ihnen etwas liegt (M523, `fensterDarueber`); dann gehört der
 * Druck dem oberen Fenster.
 *
 * `el` ist irgendein Element im eigenen Fenster (der Schließen-Knopf, die Kachel), `sel` die Hülle des Fensters.
 * Eigenes Modul, damit das Start-Paket nichts davon trägt — es laden nur die (nachgeladenen) Dialoge.
 */
export function escDarueber(el: Element | null | undefined, e: Event, sel = '.modal-backdrop'): boolean {
  const fenster = el?.closest(sel);
  return !!fenster && fensterDarueber(fenster, e);
}
