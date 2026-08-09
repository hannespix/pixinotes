import React from 'react';
import ReactDOM from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import '@blocknote/mantine/style.css';
// M200: „Sehr gut lesbar" — Atkinson Hyperlegible (für Sehschwäche entworfen),
// eingebettet wie Kalam, damit die Ein-Datei-App offline bleibt
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import './index.css';
import App from './App';
import { handleOAuthRedirect } from './lib/calAccounts';
import { initViewportInsets } from './lib/viewport';
import { ErrorBoundary } from './components/ErrorBoundary';

// OAuth-Popup-Rücksprung (Kalender-Konten): Diese Seite dient dann nur als
// Redirect-Ziel — Code ans Hauptfenster melden, App gar nicht erst rendern.
if (!handleOAuthRedirect()) {
  // M211: Tastaturhöhe als CSS-Variable — VOR dem Rendern, damit die
  // schwebenden Leisten schon beim ersten Frame richtig sitzen
  initViewportInsets();
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      {/* M213: letzte Rettungsleine — was hier ankommt, hätte sonst eine
          weiße Seite ergeben */}
      <ErrorBoundary what="PixiNotes" full>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );
}

// PWA: Service Worker nur im Prod-Build und über http(s) registrieren —
// die portable Single-HTML (file://) und der Dev-Server bleiben außen vor.
if (import.meta.env.PROD && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* z. B. privates Fenster */ });
  });
}
