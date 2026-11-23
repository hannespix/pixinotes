# M442 — Google einfacher verknüpfen: E-Mail statt technischer Felder
PR: #119 · Prüfreihe: `pruefungen/m442-google-einfach.mjs` · Datum: 2026-11-23

## Warum
Nutzerwunsch: „Kann man den Google Account einfacher verknüpfen, einfach mit E-Mail-Adresse? Momentan ist es zu kompliziert."

## Was
- Einstellungen → Dienste → Konten → Google zeigt nur noch „Google-Konto" (E-Mail, optional) und „Mit Google verbinden".
  Google wählt mit der Adresse das Konto vor; man bestätigt nur noch die Freigabe.
- Ohne eingerichtete Client-ID steht ein klarer Satz statt des Knopfs; die technische Einrichtung liegt eingeklappt unter
  „Für Betreiber" – nur, wenn der Build keine ID mitbringt.
- Die Konto-Anmeldung (Daten → Konto → „Mit Google anmelden") nimmt die eingetippte E-Mail ebenfalls als Vorauswahl.

## Wie (Architektur)
- `lib/calAccounts.ts`: `login_hint` im Typ von `initTokenClient`; `googleTokenFuer(clientId, scope, still, hint?)`,
  `connectGoogle(clientId, hint?)`.
- `lib/kontoSync.ts`: `kontoAnmelden(…, hint?)`.
- `components/Settings.tsx`: Zustand `gMail`; `gClientId` aus `acc.google?.clientId || bekannteClientId('google')`;
  Tasten `google-mail`, `google-verbinden`, `google-nicht-eingerichtet`, `google-betreiber`
  (nur wenn `!vorgabeClientId('google')`).
- m314 D2 zählt die eingeklappten Bereiche nur im Gehirn-Abschnitt.

## Grenzen / offen
Der Live-Build braucht eine Google-OAuth-Client-ID (Web-Anwendung, JavaScript-Quelle `https://hannespix.github.io`) als
Repository-Variable `VITE_GOOGLE_CLIENT_ID`. Ohne sie zeigt die App „noch nicht eingerichtet".
