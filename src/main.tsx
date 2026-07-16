import React from 'react';
import ReactDOM from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import '@blocknote/mantine/style.css';
import './index.css';
import App from './App';
import { handleOAuthRedirect } from './lib/calAccounts';

// OAuth-Popup-Rücksprung (Kalender-Konten): Diese Seite dient dann nur als
// Redirect-Ziel — Code ans Hauptfenster melden, App gar nicht erst rendern.
if (!handleOAuthRedirect()) {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
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
