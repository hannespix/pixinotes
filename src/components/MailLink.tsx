import { useState } from 'react';

// Bot-Schutz: Die Adresse steht NIRGENDS als zusammenhängender String im
// Quelltext oder Bundle — sie wird erst zur Laufzeit aus Teilen gebaut.
// Zusätzlich bekommt der Link sein mailto: erst bei Hover/Fokus/Klick;
// statische Crawler (HTML/Bundle-Grep) finden weder Adresse noch mailto-Ziel.
const USER = 'info';
const DOMAIN = ['pix', 'el'].join('-') + String.fromCharCode(46) + 'de';
const addr = () => USER + String.fromCharCode(64) + DOMAIN;

/** Kontakt-Mail als crawler-sicherer Link (Impressum/Datenschutz) */
export function MailLink() {
  const [href, setHref] = useState('#');
  const arm = () => setHref(`mailto:${addr()}`);
  return (
    <a
      className="ent-link"
      href={href}
      onMouseEnter={arm}
      onFocus={arm}
      onTouchStart={arm}
      onClick={(e) => {
        if (href === '#') {
          e.preventDefault();
          window.location.href = `mailto:${addr()}`;
        }
      }}
    >
      {USER}
      <span aria-hidden="true">{String.fromCharCode(64)}</span>
      {DOMAIN}
    </a>
  );
}
