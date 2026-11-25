// Team-Sync (M145): Einladung per E-Mail — bewusst OHNE Passwörter/Zugangsdaten.
// M522: aus lib/projectSync.ts herausgelöst (unverändert): Den Text brauchen nur die Einstellungen, projectSync.ts
// aber lädt mit dem Start (Auto-Sync der Team-Projekte) — so bleibt Platz im Start-Paket.
import { t } from './sprache';

export function buildInviteText(projectName: string, folderName: string): string {
  const appUrl = window.location.href.split('#')[0];
  return [
    'Hallo,',
    '',
    `ich lade dich ein, an unserem PixiNotes-Projekt „${projectName}" mitzuarbeiten. So trittst du bei:`,
    '',
    `1) Nimm die Ordner-Freigabe an: [HIER den Freigabe-Link zum Ordner „${folderName}" einfügen – z. B. in Nextcloud über „Teilen"]`,
    '2) Lass den freigegebenen Ordner von deinem Sync-Client (Nextcloud/OneDrive/Dropbox) auf deinen Rechner synchronisieren.',
    `3) Öffne PixiNotes: ${appUrl}`,
    '4) Dort: Einstellungen (Zahnrad) → Synchronisation → „Projekt beitreten…" → wähle den synchronisierten Ordner aus.',
    '',
    'PixiNotes findet darin das Projekt-Paket, richtet den automatischen Abgleich ein und zeigt dir das Projekt neben deinen eigenen.',
    'Wer mitarbeiten darf, regelt allein die Ordner-Freigabe – diese E-Mail enthält keine Passwörter oder Zugangsdaten.',
  ].map((z) => t(z)).join('\n');   // M381: auf Englisch geht die Einladung englisch hinaus
}

export function buildInviteMailto(projectName: string, folderName: string): string {
  const subject = t(`Einladung zum PixiNotes-Projekt „${projectName}"`);
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(buildInviteText(projectName, folderName))}`;
}
