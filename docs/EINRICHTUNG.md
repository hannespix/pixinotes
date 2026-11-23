# Einrichtung für den Betreiber (einmalig)

Damit **„Mit Google anmelden"** (PixiNotes-Konto, M479), die **Google-Verknüpfung**
(Kalender/Drive, M442) und **Outlook live** (M466) funktionieren, braucht es je einen
OAuth-Client bei Google und Microsoft. Alle Werte unten sind fertig zum Kopieren.
Nach Teil C einmal neu veröffentlichen (Teil D).

## A. Google

1. Zustimmungsbildschirm: <https://console.cloud.google.com/auth/branding>
   (Projekt anlegen, falls gefragt; App-Name `PixiNotes`, deine E-Mail als Support-Adresse)
2. Zielgruppe „Extern", dich als Testnutzer eintragen: <https://console.cloud.google.com/auth/audience>
3. Client anlegen: <https://console.cloud.google.com/auth/clients/create>
   - Anwendungstyp: **Webanwendung**, Name: `PixiNotes`
   - Autorisierte JavaScript-Quellen:
     ```
     https://hannespix.github.io
     ```
   - Autorisierte Weiterleitungs-URIs:
     ```
     https://dckzqvbrffmemdzamtqr.supabase.co/auth/v1/callback
     ```
   - Client-ID und Clientschlüssel notieren.
4. Supabase → Google einschalten: <https://supabase.com/dashboard/project/dckzqvbrffmemdzamtqr/auth/providers>
   → „Google" → Enable, Client-ID und Client Secret aus Schritt 3 einfügen → Save.
5. Supabase → Weiterleitungen: <https://supabase.com/dashboard/project/dckzqvbrffmemdzamtqr/auth/url-configuration>
   - Site URL:
     ```
     https://hannespix.github.io/pixinotes/
     ```
   - Redirect URLs → „Add URL":
     ```
     https://hannespix.github.io/pixinotes/**
     ```

Hinweis: Kalender (`calendar.readonly`) und Drive (`drive.appdata`) sind bei Google „sensible"
Bereiche. Im Modus „Testing" funktionieren sie für eingetragene Testnutzer (bis 100) ohne
Prüfung durch Google. „Mit Google anmelden" braucht nur E-Mail/Profil.

## B. Microsoft (Outlook, Kalender, OneDrive)

1. App registrieren: <https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/CreateApplicationBlade>
   - Name: `PixiNotes`
   - Kontotypen: **Konten in einem beliebigen Organisationsverzeichnis und persönliche Microsoft-Konten**
   - Umleitungs-URI: Plattform **Single-Page-Anwendung (SPA)**:
     ```
     https://hannespix.github.io/pixinotes/
     ```
   - Registrieren → **Anwendungs-ID (Client-ID)** kopieren.
2. Weitere Umleitungs-URI (gleiche App → Authentifizierung → SPA → URI hinzufügen):
   ```
   https://hannespix.github.io/pixinotes/index.html
   ```
3. API-Berechtigungen → Berechtigung hinzufügen → Microsoft Graph → **Delegiert**:
   ```
   User.Read
   Mail.Read
   Calendars.Read
   Notes.Read
   Files.ReadWrite.AppFolder
   offline_access
   ```

## C. Werte ins Repository

Neue Variable anlegen: <https://github.com/hannespix/pixinotes/settings/variables/actions/new>

| Name | Wert |
|---|---|
| `VITE_GOOGLE_CLIENT_ID` | Client-ID aus A3 (endet auf `.apps.googleusercontent.com`) |
| `VITE_MS_CLIENT_ID` | Anwendungs-ID aus B1 |
| `VITE_MS_TENANT` | `common` |

(Das Client Secret von Google gehört **nur** nach Supabase, nie ins Repository.)

## D. Neu veröffentlichen

<https://github.com/hannespix/pixinotes/actions/workflows/pages.yml> → „Run workflow" →
Branch `claude/notes-whiteboard-design-bnwvxj` → „Run workflow". Nach ~2 Minuten ist
<https://hannespix.github.io/pixinotes/> mit den neuen Werten online (Seite einmal neu laden).
