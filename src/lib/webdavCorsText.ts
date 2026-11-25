// WebDAV: die fertige Bitte an die IT, CORS freizuschalten.
// M522: unverändert aus lib/webdav.ts herausgelöst — den Text brauchen nur die Einstellungen (nachgeladen), webdav.ts
// aber lädt mit dem Start (Auto-Sync). So bleibt Platz im Start-Paket.
import { sprache } from './sprache';
import type { WebdavConfig } from './webdav';

/**
 * Fertiger Text für die IT — nennt die konkrete Herkunft dieser Installation
 * und exakt die Header, die der Server für PixiNotes liefern muss. Bewusst
 * OHNE Zugangsdaten: Benutzername und App-Passwort haben in so einer Mail
 * nichts verloren und stehen deshalb auch nicht drin.
 */
export function corsRequestText(cfg: WebdavConfig | null): string {
  // M381: Läuft die Oberfläche englisch, geht die Bitte an die IT englisch hinaus (eigene Fassung statt Zeile für Zeile)
  if (sprache() === 'en') {
    const h = cfg?.url ? cfg.url.replace(/^https?:\/\//, '').split('/')[0] : 'our Nextcloud';
    return [
      'Subject: CORS for WebDAV (browser access to ' + h + ')',
      '',
      'Hello,',
      '',
      `I use the web application PixiNotes and would like to store my notes via WebDAV in our Nextcloud (${h}).`,
      'The browser aborts the connection because the server sends no CORS headers for /remote.php/dav.',
      'The application runs entirely in the browser; no additional server is involved and no data is passed on to third parties.',
      '',
      `Origin that would need to be allowed: ${location.origin}`,
      '',
      'The following response headers are needed for /remote.php/dav:',
      `  Access-Control-Allow-Origin: ${location.origin}`,
      '  Access-Control-Allow-Methods: GET, PUT, OPTIONS',
      '  Access-Control-Allow-Headers: Authorization, Content-Type, If-Match',
    '  Access-Control-Expose-Headers: ETag',
      '  Access-Control-Max-Age: 600',
      'The OPTIONS request (preflight) must be answered with 200/204 without authentication —',
      'otherwise it fails before the credentials are sent at all.',
      '',
      'In Nextcloud this can also be done without touching the server configuration, using the app',
      '“WebAppPassword”: the origin above is entered there.',
      '',
      'PixiNotes only uses GET and PUT on a single JSON file in the given folder and signs in with an',
      'app password (not the account password). No cookies are set.',
      '',
      'Thank you!',
    ].join('\n');
  }
  const host = cfg?.url ? cfg.url.replace(/^https?:\/\//, '').split('/')[0] : 'unsere Nextcloud';
  return [
    'Betreff: CORS-Freigabe für WebDAV (Browser-Zugriff auf ' + host + ')',
    '',
    'Hallo zusammen,',
    '',
    'ich nutze die Web-Anwendung PixiNotes und möchte meine Notizen per WebDAV in',
    `unserer Nextcloud (${host}) ablegen. Der Browser bricht die Verbindung ab, weil der`,
    'Server keine CORS-Header für /remote.php/dav liefert. Die Anwendung läuft rein im',
    'Browser, es ist kein zusätzlicher Server beteiligt und es werden keine Daten an',
    'Dritte übertragen.',
    '',
    `Herkunft (Origin), die freigegeben werden müsste: ${location.origin}`,
    '',
    'Benötigt werden für /remote.php/dav folgende Antwort-Header:',
    `  Access-Control-Allow-Origin: ${location.origin}`,
    '  Access-Control-Allow-Methods: GET, PUT, OPTIONS',
    '  Access-Control-Allow-Headers: Authorization, Content-Type',
    '  Access-Control-Max-Age: 600',
    'Die OPTIONS-Anfrage (Preflight) muss dabei ohne Anmeldung mit 200/204 beantwortet',
    'werden, sonst schlägt sie fehl, bevor die Anmeldedaten überhaupt gesendet werden.',
    '',
    'In Nextcloud lässt sich das auch ohne Eingriff in die Server-Konfiguration über die',
    'App „WebAppPassword" erledigen: dort wird die oben genannte Herkunft eingetragen.',
    '',
    'PixiNotes verwendet nur GET und PUT auf eine einzelne JSON-Datei im angegebenen',
    'Ordner und meldet sich mit einem App-Passwort an (nicht mit dem Kennwort des',
    'Kontos). Es werden keine Cookies gesetzt.',
    '',
    'Vielen Dank!',
  ].join('\n');
}
