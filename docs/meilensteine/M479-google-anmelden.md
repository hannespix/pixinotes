# M479 — Mit Google anmelden (PixiNotes-Konto)
PR: #165 · Prüfreihe: `pruefungen/m479-google-anmelden.mjs` · Datum: 2026-11-23

## Warum
Nutzerwunsch: „google anmeldung fehlt noch! (per email adresse)". Die Google-Verknüpfung aus M317/M442
(`calAccounts.ts` `googleTokenFuer`, Konto-Sync in Google Drive) braucht eine Google-Client-ID im Build
(`VITE_GOOGLE_CLIENT_ID`). Im Live-Build fehlt sie, dort steht „noch nicht eingerichtet". Das PixiNotes-Konto
(Supabase, M328) läuft dagegen ohne Build-Variable. Supabase kann Google selbst als Anmeldeweg anbieten.

## Was
- Einstellungen → Daten → Synchronisation → Konto: unter „Anmelde-Link per E-Mail" steht gleichrangig
  **„Mit Google anmelden"**. Die eingetippte E-Mail-Adresse geht als `login_hint` mit, Google wählt damit das
  Konto vor. Nach der Bestätigung kehrt die App zurück, ist am PixiNotes-Konto angemeldet und gleicht ab
  (Daten pro Nutzer wie bisher, RLS unverändert).
- **„Mit Microsoft anmelden"** (Supabase-Anbieter `azure`) erscheint nur, wenn das Projekt ihn eingeschaltet hat.
- Ist Google im Supabase-Projekt aus, kommt ein klarer Satz („Google-Anmeldung ist beim Betreiber noch nicht
  eingeschaltet – bis dahin mit E-Mail-Link anmelden.") samt eingeklapptem „Für Betreiber", keine Weiterleitung.
- Abbruch bei Google → Hinweis „Anmeldung abgebrochen – nichts geändert."
- Die Drive-/OneDrive-Knöpfe (M317) bleiben und heißen bei eingerichtetem Konto-Backend „Stand in Google Drive"
  bzw. „Stand in OneDrive". Sonst stünde „Mit Google anmelden" zweimal da.
- In der Einzeldatei (`file://`) fehlt der Knopf, der bestehende Hinweis erklärt das.

## Wie (Architektur)
- `lib/kontoSupabase.ts`:
  - `sbAnbieterAn()` liest `GET /auth/v1/settings` (öffentlich, `external.google|azure`).
  - `sbOAuthStarten(anbieter, hint)` prüft vorab den Anbieter. Ist er aus, gibt es `AnbieterAusFehler`, denn
    authorize würde mit einer nackten 400-JSON-Seite „Unsupported provider" antworten. Danach erzeugt die Funktion
    PKCE (Verifier in `localStorage` `pixinotes-sb-pkce`, 1 h gültig), setzt das M388-Merkzeichen `linkErwartet()`
    und leitet weiter an `/auth/v1/authorize?provider=…&redirect_to=<App>&code_challenge=…&code_challenge_method=s256&login_hint=…`
    (azure zusätzlich `scopes=email`). Supabase reicht unbekannte Parameter wie `login_hint` an den Anbieter durch.
  - `sbRueckkehrCode()` liest `?code=` bzw. `?error=` nur, wenn ein PKCE-Merkzeichen da ist. Das Microsoft-Popup
    (M184) und fremde Adressen bleiben deshalb unberührt. Die Funktion räumt die Adresse auf.
  - `sbCodeTauschen()` ruft `POST /auth/v1/token?grant_type=pkce` `{auth_code, code_verifier}` auf.
  - `sbRueckkehrLesen()` nimmt den impliziten Ablauf (`#access_token=…`) wie beim E-Mail-Link und versteht jetzt
    auch ein `#error=…`, aber nur bei laufender Anbieter-Anmeldung. `fehlerText` und `oauthFehlerText` übersetzen
    „provider is not enabled", „access_denied" und abgelaufene Codes.
- `lib/kontoSync.ts` `initKontoSync`: Rückkehr per Fragment **oder** Code. Ein Code gilt immer als selbst
  angefordert, weil nur der hier gemerkte Verifier ihn tauscht. Die M388-Rückfrage bleibt für fremde Links und für
  den Wechsel auf ein anderes Konto.
- `lib/syncStart.ts` `syncNoetig`: ein Ausdruck über `location.href` (`[#?&](access_token|error|code)=`) lädt den Abgleich sofort (M459); kürzer als vorher, die Start-JS-Grenze (m459) lag nach M478 nur noch 35 Byte entfernt.
- `components/Settings.tsx`: Zustand `sbWege` (stilles `sbAnbieterAn` beim Öffnen des Konto-Wegs) und `sbAus`,
  Handler `kontoOAuth`. Tasten `konto-sb-google`, `konto-sb-ms`, `konto-google-aus`, `konto-google-betreiber`.

## Für den Betreiber (einmalig)
Stand 2026-11-23 im Projekt `dckzqvbrffmemdzamtqr` (nur gelesen über `/auth/v1/settings`): `email: true`,
**`google: false`**, `azure: false`. Bis Schritt 1–4 erledigt sind, zeigt die App den Hinweis-Satz.
1. Google Cloud Console → APIs & Dienste → OAuth-Zustimmungsbildschirm einrichten (Typ „Extern", App-Name
   PixiNotes, Bereiche `openid`, `email`, `profile`; die gelten als nicht sensibel).
2. Google Cloud Console → Anmeldedaten → **OAuth-Client-ID „Webanwendung"** anlegen. Als **autorisierte
   Weiterleitungs-URI** eintragen: `https://dckzqvbrffmemdzamtqr.supabase.co/auth/v1/callback`.
   Client-ID und Client-Secret kopieren.
3. Supabase-Dashboard → **Authentication → Sign In / Providers → Google** einschalten, Client-ID und Secret
   eintragen, speichern.
4. Supabase-Dashboard → **Authentication → URL Configuration**: Site URL `https://hannespix.github.io/pixinotes/`,
   unter **Redirect URLs** dieselbe Adresse erlauben (`https://hannespix.github.io/pixinotes/**`).
5. Optional für Microsoft: Entra → App-Registrierung (Web, Umleitungs-URI wie in Schritt 2), dann in Supabase
   Provider **Azure** einschalten. Der Knopf „Mit Microsoft anmelden" erscheint danach von selbst.

## Grenzen / offen
- Die Einzeldatei kann keine Weiterleitung. Dort bleiben E-Mail mit Passwort, Ordner, WebDAV und Datei.
- Hat jemand schon ein E-Mail-Konto mit derselben Adresse, verknüpft Supabase die Google-Identität mit diesem
  Konto. Voraussetzung: die E-Mail ist bestätigt (Supabase-Standard „automatic linking"). Die Daten bleiben dann
  dieselben.
- Die Drive-Verknüpfung (Sync-Ziel im eigenen Google Drive) braucht weiter `VITE_GOOGLE_CLIENT_ID`.
