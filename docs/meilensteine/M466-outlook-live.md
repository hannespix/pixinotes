# M466 — Outlook live: Mails und Termine aus Microsoft 365 (nur lesen)
PR: siehe Merge-Commit · Prüfreihe: `pruefungen/m466-outlook-live.mjs` (Port 5466) · Datum: 2026-11-23

## Warum
Roadmap `docs/KONZEPT.md` Phase 4 „MS-Graph-Sync" (Backlog-Idee „Microsoft-Graph-Anbindung"): Mails sollten nicht
erst in Outlook als `.eml` gespeichert und aufs Board gezogen werden müssen, und Outlook-Termine gehören in den
Kalender – ohne PixiNotes-Server.

## Was
- **Ein Einstieg:** Strg+K „Outlook" oder ＋ → Einfügen → **Outlook**. Das Fenster zeigt die letzten 25 Mails des
  Posteingangs (ungelesene fett, Büroklammer bei Anhängen) oder die Treffer einer Suche über das ganze Postfach.
- **„Aufs Board"** legt die Mail als **E-Mail-Karte** in die Mitte des Ausschnitts – dasselbe Datenformat wie eine
  abgelegte `.eml`: Destillat (M451) und Kontakt aus der Mail (M457) funktionieren sofort. Häkchen „Anhänge
  mitholen" bettet Dateianhänge bis 1,5 MB ein (größere bleiben Chip mit Name und Größe, wie beim .eml-Import);
  Inline-Bilder der Signatur werden übersprungen. Liegt eine Mail schon auf einem Board, heißt der Knopf „Noch einmal".
- **Termine:** dieselbe Anmeldung liefert die Outlook-Termine in die Kalender-Karte (vorhandener Weg über
  `fetchAccountEvents`, Graph `/me/calendarview`).
- **Anmelden:** „Mit Microsoft anmelden" (E-Mail optional als Vorauswahl) – ein Popup, Konto bestätigen, Lesen von
  Mails und Kalender erlauben. Wer schon für Kalender/OneNote verbunden ist, sieht „Postfach freischalten".
- **Abmelden** löscht Token, Refresh-Token und Kontonamen auf diesem Gerät (auch Kalender/OneNote hängen an
  derselben Verbindung); nur die App-ID bleibt, damit man sich wieder anmelden kann.
- Ohne App-ID im Build: klarer Satz („noch nicht eingerichtet, bis dahin .eml/.msg ziehen"); die technische
  Einrichtung liegt eingeklappt unter „Für Betreiber" (nur wenn der Build keine ID mitbringt, wie bei Google M442).
- Einstellungen → Dienste → Microsoft 365 zeigt zusätzlich „· Postfach ✓/—".

## Wie (Architektur)
- `src/lib/outlook.ts` (nur aus dem Fenster geladen): `outlookStand()` (`ohne-id` · `ohne-web` · `abgemeldet` ·
  `ohne-postfach` · `bereit`), `outlookAnmelden(hint?)`, `outlookAbmelden()`, `outlookListe(suche)` (Posteingang
  `/me/mailFolders/inbox/messages?$orderby=receivedDateTime desc`, Suche `/me/messages?$search="…"` – ohne
  `$orderby`, Graph erlaubt beides nicht zusammen), `outlookMail(id, mitAnhaengen)` → `EmailData` mit Merker
  `outlookId`, Anhänge über `/attachments?$select=…` und je Datei `/attachments/{id}/$value` (Bytes, kein base64-JSON).
  Wiederholversuch bei 429/503 mit `Retry-After`.
- `src/lib/calAccounts.ts`: `msHasMail()`, `msScope(notes, mail)`; `connectMicrosoft(…, withNotes, { mail, hint })`
  behält, was dieselbe App schon darf (OneNote freischalten nimmt das Postfach nicht weg und umgekehrt);
  `msAnmeldung(…, hint)` setzt `login_hint`. Ohne Postfach bleibt der Berechtigungs-Satz exakt der alte, damit
  bestehende Verbindungen weiter still erneuern. Postfach-Satz: `Calendars.Read [Notes.Read] Mail.Read User.Read offline_access`.
- `src/lib/sicher.ts`: `mailTextVonAussen(html|text)` – HTML nur in ein träges `DOMParser`-Dokument (keine Skripte,
  keine Ereignisse, kein Nachladen), script/style/head/iframe/svg/form fallen weg, Blöcke werden Zeilen, dann
  `textVonAussen`. Betreff, Absender, Vorschau, Anhangnamen laufen durch `textVonAussen`; die Karte zusätzlich durch
  `karteEntschaerfen`. `parseEmail.ts` exportiert dafür `safeMime`/`bytesToDataUrl`.
- `src/components/OutlookFenster.tsx`: das Fenster; Lage der Karte aus der Transformation von
  `.react-flow__viewport` + `findFreeSpot`. Eingehängt in `App.tsx` (`<Outlook />`, lazy, Ereignis
  `pixinotes:outlook`) – nicht im Start-Bundle (m446). Auslöser: `SearchOverlay.tsx` (Befehl „Outlook"),
  `Dock.tsx` (Kachel `data-modul="outlook"`; m296/m316 zählen jetzt eine Kachel mehr).
- Token-Speicher: unverändert `localStorage['pixinotes-cal-accounts']` – nie im Board, Sync, Link oder Export.

## Betreiber: Einrichtung in Microsoft Entra ID (Azure)
1. Entra ID → App-Registrierungen → **Neue Registrierung**; unterstützte Kontotypen nach Bedarf (nur eigene
   Organisation = Tenant-ID als `VITE_MS_TENANT`, sonst `common`).
2. Plattform **„Single-Page-Anwendung"** (nicht „Web" – sonst verlangt der Token-Tausch ein Client-Secret) mit den
   Umleitungs-URIs der Pages-Adresse, genau so wie die App läuft: `https://hannespix.github.io/pixinotes/` (und ggf.
   `…/index.html`, eigene Domains). Die App ist ihre eigene Umleitungsseite (`handleOAuthRedirect`).
3. API-Berechtigungen (delegiert, Microsoft Graph): **Mail.Read, Calendars.Read, User.Read, offline_access**; für
   OneNote zusätzlich Notes.Read, für den Konto-Sync Files.ReadWrite.AppFolder. In Organisationen ggf.
   Administrator-Zustimmung erteilen.
4. Die Anwendungs-(Client-)ID als Repository-Variable **`VITE_MS_CLIENT_ID`** (und `VITE_MS_TENANT`) hinterlegen –
   `pages.yml` und `release.yml` reichen sie schon in den Build. Dann sieht kein Nutzer die Betreiber-Felder.

**file://-Grenze:** Die portable `pixinotes.html` hat keine Web-Herkunft, Microsoft kann nicht dorthin umleiten.
Dort sagt das Fenster, dass das Anmelden die gehostete App braucht; der Weg bleibt `.eml`/`.msg` ziehen.

## Grenzen / offen
- Nur lesen, nur auf Abruf: kein Abo/Delta-Abgleich, nur Posteingang und Suche (keine Ordnerauswahl), kein Antworten
  oder Markieren über Graph.
- Konto-Termine stehen wie bisher in der Kalender-Karte, nicht in der Aufgaben-Zentrale (die zeigt Aufgaben, keine
  Termine).
- Ohne `VITE_MS_CLIENT_ID` im Live-Build zeigt die App „noch nicht eingerichtet".
