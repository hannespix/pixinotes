# M516 — „Als App installieren" in der App, mit Diagnose
PR: #… · Prüfreihe: `pruefungen/m516-app-installieren.mjs` (Port 5516) · Datum: 2026-11-24

## Warum
Nutzer: „Auf meinem Mobile kann ich die PWA installieren. Im Chrome-Browser unter Windows wird es mir nicht mehr
angeboten … warum?" Die Live-Seite ist technisch installierbar (CDP `Page.getInstallabilityErrors` leer bis auf
`in-incognito` des Tests, Manifest fehlerfrei, Service Worker kontrolliert). Ein Bildschirmfoto des Nutzers zeigt im
Menü ⋮ → „Speichern und teilen" nur „Seite speichern unter …", „Verknüpfung erstellen …", „Link kopieren", „An mein
Gerät senden", „QR-Code erstellen" — **kein „Seite als App installieren"** — und unten **„Von deiner Organisation
verwaltet"**. Bis dahin hatte PixiNotes keinen eigenen Weg zum Installieren und keine Erklärung, warum es fehlt.

### Mögliche Ursachen (Chrome/Edge am Computer)
1. **Verwalteter Browser mit Richtlinie** (beim Nutzer am wahrscheinlichsten): Chrome blendet „Seite als App
   installieren" aus, wenn die IT das Installieren abgeschaltet hat — Richtlinie `WebAppInstallByUserEnabled = false`
   (Chrome ab 145 unter Windows; Registry `HKLM\Software\Policies\Google\Chrome\WebAppInstallByUserEnabled = 0`).
   Prüfen unter `chrome://policy`. `WebAppInstallForceList` installiert dagegen nur zwangsweise; `WebAppSettings`
   regelt Verhalten installierter Apps (z. B. `run_on_os_login`), sperrt aber nicht. Ein Policy-Name
   `DefaultWebAppInstallSetting` existiert nach unserer Recherche nicht.
2. **Schon installiert** auf diesem Profil: Chrome zeigt dann „PixiNotes öffnen" / „In App öffnen" statt
   „Installieren" (alle Apps: `chrome://apps`, Edge `edge://apps`). Auch eine Installation unter einer anderen
   Kennung zählt nicht doppelt — siehe `id` unten.
3. **Symbol in der Adressleiste ausgeblendet**: Der Weg über das Menü geht trotzdem.
4. **Früher abgelehnt**: Chrome wartet nach Wegklicken eine Weile mit dem Angebot (`beforeinstallprompt`).
5. **Privates Fenster** (Inkognito/InPrivate): keine Installation möglich.
6. **Portable Datei** (`file://`): ohne Manifest-/SW-Wirkung, nicht installierbar.

## Was
- **⋯ der Leiste unten → „Als App installieren …"** und **Strg+K „Als App installieren"** (kein neuer dauerhafter
  Knopf). Hat der Browser die Installation angeboten, öffnet sein Dialog (`prompt()`); sonst ein Fenster mit
  Diagnose in Klartext:
  - **„PixiNotes läuft bereits als App."** (`display-mode` standalone / window-controls-overlay / minimal-ui /
    fullscreen oder `navigator.standalone`),
  - **„… ist auf diesem Browser schon installiert."** (`navigator.getInstalledRelatedApps()` meldet `webapp`),
  - portable Datei, unsichere Adresse,
  - sonst Anleitung je Browser (Chrome, Edge, Safari Mac, iPhone/iPad, Android, Samsung Internet, Firefox) und
    mögliche Gründe — zuerst der **verwaltete Browser** mit `WebAppInstallByUserEnabled` und `chrome://policy`
    bzw. `edge://policy`, dann „schon installiert", „Symbol ausgeblendet", „früher weggeklickt / eben
    abgelehnt", „privates Fenster", ggf. „noch nicht fertig geladen" (kein SW-Controller).
  - Nach 8 s ohne Angebot: „Seit dem Öffnen dieser Seite hat der Browser keine Installation angeboten."
  - **Ausweg** am Computer: „Speichern und teilen" (Edge: „Weitere Tools") → „Verknüpfung erstellen …" mit Häkchen
    „Als Fenster öffnen" — PixiNotes startet dann im eigenen Fenster vom Schreibtisch.
  - Kommt das Angebot, während das Fenster offen ist, erscheint „Jetzt installieren".
- `appinstalled` → Hinweis „PixiNotes ist installiert …".
- Manifest: feste `id`, `purpose: "any"` an den Symbolen, `screenshots` (wide 1280×800, narrow 450×800, WebP,
  zusammen ≈ 47 KB) für den reicheren Installations-Dialog am Computer, `categories`, `related_applications`.
- Hilfe DE/EN: „Was ist neu" und neuer Unterabschnitt **„Als App installieren"** unter „Speichern, Sync & Teilen"
  (ersetzt die alte Zeile „PWA: …").

## Wie (Architektur)
- `src/lib/appInstallieren.ts` (Start-Paket, winzig): `appInstallierenStarten()` aus `main.tsx` vor dem ersten
  Rendern hört auf `beforeinstallprompt` (hebt das Ereignis auf) und `appinstalled`. **Bewusst kein
  `preventDefault()`** — sonst verschwände am Telefon die Installations-Leiste, die dort heute von selbst kommt;
  `prompt()` geht trotzdem. `appInstallieren()` ruft `prompt()` (einmal je Ereignis, danach verbraucht) oder sendet
  `APP_INSTALLIEREN_EREIGNIS` (`pixinotes:app-installieren`). `installStand()` für die Diagnose.
- `src/components/AppInstallierenFenster.tsx` (nachgeladen, eigenes Teil-Paket): `umgebungErkennen(ua, touch)`,
  `laeuftAlsApp()`, `anleitung(os, browser)`; Lage als `data-lage` (`app|datei|unsicher|installiert|bereit|nicht`),
  Gründe als `data-grund`. Host `AppInstallieren` in `App.tsx` (wie `SicherungEinspielen`).
- Einstiege: `components/Dock.tsx` (`data-taste="dock-app-installieren"`, Symbol `IInstallieren` in `Icons.tsx`),
  `components/SearchOverlay.tsx` (Befehl).
- CSS: `src/styles/32-dialoge-pdf.css` (`.app-installieren*`).
- **Manifest-`id` = `"/pixinotes/"`:** Ohne `id` leitet Chrome die Kennung aus `start_url` ab — auf GitHub Pages
  `https://hannespix.github.io/pixinotes/`. Chromium löst `id` gegen den **Ursprung** von `start_url` auf; ein
  relatives `"./"` ergäbe `https://hannespix.github.io/` → neue Kennung → bestehende Installationen hießen anders
  (Doppel-Installation). `"/pixinotes/"` ergibt in beiden Lesarten (Ursprung wie neue Spezifikation) dieselbe
  Kennung wie bisher. Prüfreihe B4/B5: `Page.getAppId` mit und ohne `id` (abgefangenes Manifest) = Start-Adresse,
  `recommendedId` = `/pixinotes/`. Unter einer eigenen Adresse im Wurzelverzeichnis wäre die Kennung
  `…/pixinotes/` (harmlos, gleicher Ursprung).
- `related_applications` nennt das eigene Manifest (`platform: "webapp"`, absolute URL) — Voraussetzung für
  `getInstalledRelatedApps()`; `prefer_related_applications: false` hält die Installation offen.
- Kein `display_override` mit `window-controls-overlay`: Die Kopfleiste rechnet nicht mit dem
  Titelleisten-Bereich (`env(titlebar-area-*)`); das wäre ein eigener Meilenstein.
- Bildschirmfotos in `public/screenshots/` (Übersicht mit Beispiel-Boards; erzeugt aus `dist` mit playwright,
  WebP q78).

## Grenzen / offen
- Ob der Browser verwaltet ist, lässt sich aus einer Webseite nicht erkennen — die Diagnose nennt die Richtlinie
  deshalb als ersten möglichen Grund am Computer, mit dem sichtbaren Merkmal („Von deiner Organisation verwaltet").
  Ob „Verknüpfung erstellen … / Als Fenster öffnen" unter derselben Richtlinie geht, hängt von der Chrome-Fassung
  ab; der Text sagt, was passiert, wenn das Häkchen fehlt.
- `getInstalledRelatedApps()` erkennt die Installation nur auf `hannespix.github.io` und je nach Plattform/Fassung;
  „nicht erkannt" heißt nicht „nicht installiert" — darum bleibt „schon installiert" in der Gründe-Liste.
- Firefox am Computer: keine Installation; neuere Windows-Fassungen mit „Zur Taskleiste hinzufügen" nicht erfasst.
- `display-mode` lässt sich in Chromium per CDP nicht emulieren; die Reihe stellt `matchMedia` nach.
