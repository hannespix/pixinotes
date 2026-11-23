import { initTelefonTastatur } from './lib/telefonTastatur';
import React from 'react';
import ReactDOM from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import '@blocknote/mantine/style.css';
// M200: „Sehr gut lesbar" — Atkinson Hyperlegible (für Sehschwäche entworfen),
// eingebettet wie Kalam, damit die Ein-Datei-App offline bleibt
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
// M416/M420: Zwei Schriften für das ganze Tool — Geist (klar und ruhig, für Bedienung und Text) und Newsreader (eine
// zeitlose Serife mit optischen Größen für die großen Stellen). Beide frei (SIL Open Font License) und hier
// eingebunden: Es geht nichts an einen Schriften-Dienst, und das Tool sieht offline und als Einzeldatei genauso aus.
// Geist selbst wird in src/styles/70-kopfleiste-schrift-netz.css eingebunden (eigene Fassung mit angepassten Zeilenmaßen).
import '@fontsource-variable/newsreader/opsz.css';
import './index.css';
import App from './App';
import { handleOAuthRedirect } from './lib/calAccounts';
import { initViewportInsets } from './lib/viewport';
import { initAnzeige } from './lib/anzeige';
import { initEinstellungen } from './lib/einstellungen';
import { initKopfmass } from './lib/kopfmass';
import { ErrorBoundary } from './components/ErrorBoundary';
import { initUebersetzung } from './lib/uebersetzung';
import { initSprache, sprache } from './lib/sprache';
import { alteNamenOhneEmoji, startNamenAufEnglisch } from './store';
import { fensterFokusStarten } from './lib/fensterFokus';

// OAuth-Popup-Rücksprung (Kalender-Konten): Diese Seite dient dann nur als
// Redirect-Ziel — Code ans Hauptfenster melden, App gar nicht erst rendern.
// M321: Die App kommt in Teilen — Diagramme, PDF, Tabellen, E-Mail-Parser
// laden erst bei Bedarf. Nach einem Deploy tragen diese Teile neue Namen; eine
// Sitzung, die noch die alte Seite offen hat, bekäme beim ersten Bedarf ein
// „Failed to fetch dynamically imported module". Dann EINMAL neu laden (der
// Stand liegt im Speicher), nicht in Schleife: Stempel merken.
window.addEventListener('vite:preloadError', () => {
  try {
    const k = 'pixinotes-neu-geladen';
    if (sessionStorage.getItem(k) === __BUILD_STAMP__) return;
    sessionStorage.setItem(k, __BUILD_STAMP__);
  } catch { /* privates Fenster o. ä. — trotzdem einmal versuchen */ }
  location.reload();
});

if (!handleOAuthRedirect()) {
  // M389: Fokus-Führung für alle Fenster (hinein beim Öffnen, Tab im Kreis, zurück beim Schließen)
  fensterFokusStarten();
  // M211: Tastaturhöhe als CSS-Variable — VOR dem Rendern, damit die
  // schwebenden Leisten schon beim ersten Frame richtig sitzen
  initViewportInsets();
  /**
   * M247: Vorlieben aus ihrem eigenen Speicher holen — VOR initAnzeige, sonst
   * würde die Anzeigegröße noch mit dem Stand aus dem Hauptspeicher gesetzt
   * und gleich darauf korrigiert (sichtbares Springen). Und vor dem Rendern,
   * weil ein zweites Fenster sonst kurz im falschen Design aufblitzt.
   */
  initEinstellungen();
  // M224: Anzeigegröße/Kontrast ebenfalls VOR dem ersten Frame — sonst
  // springt die Oberfläche beim Start sichtbar auf die eingestellte Größe
  initAnzeige();
  // M236: Die Kopfleiste vermisst sich selbst, statt dass das Stylesheet
  // ihre Breite errät — sonst wandert die Tab-Leiste beim Text-Zoom unter
  // die Aktionsleiste (User-Screenshot)
  initKopfmass();
  // M368: Die Übersetzung des Browsers darf die Oberfläche nicht zum Absturz bringen — vor dem ersten
  // Rendern, damit jeder Knoten, den React anlegt, schon unter dem Schutz steht
  initUebersetzung();
  // M386: „Fertig" statt „Weiter" auf der Telefon-Tastatur — Felder, die mit Enter abschließen, bekommen ihr Enter
  initTelefonTastatur();
  // M381: Ist Englisch gewählt, wird vor dem ersten Rendern das Wörterbuch geladen — sonst blitzte die
  // Oberfläche kurz deutsch auf. Deutsch wartet auf nichts.
  const starten = () => ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      {/* M213: letzte Rettungsleine — was hier ankommt, hätte sonst eine
          weiße Seite ergeben */}
      <ErrorBoundary what="PixiNotes" full>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );
  alteNamenOhneEmoji();
  void initSprache().then(() => { if (sprache() === 'en') startNamenAufEnglisch(); }).then(starten, starten);
}

// PWA: Service Worker nur im Prod-Build und über http(s) registrieren —
// die portable Single-HTML (file://) und der Dev-Server bleiben außen vor.
if (import.meta.env.PROD && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* z. B. privates Fenster */ });
  });
}
