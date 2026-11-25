# M538 — Schlussrunde: Strg+D im Fokus, Vorbedingung für Gäste, Ablage aufräumen, alte App-Fassung
PR: mehrere kleine PRs „… (M538)" · Prüfreihe: `pruefungen/m538-schlussrunde.mjs` (Port 5538, `M538_PORT`) · Datum: 2026-11-25

## Warum
Letzte offene Punkte der Umsetzungsrunde nach dem Audit (Besitzer: „setz alles um"): Strg+D im Karten-Fokus (offen aus
M530), Vorbedingung in `gast_aendern` (Restfenster aus M533), verwaiste Einträge der Geräte-Ablage und eine alte
App-Fassung, die Verweise statt Bilder sehen könnte (beides offen aus M532), Bilder im Konto über den Datei-Weg
(offen aus M529/M532).

## D — Strg+D im Karten-Fokus
**Vorher:** Strg+D bei geöffneter Karte duplizierte die gewählte Karte — die Kopie lag unsichtbar hinter der offenen
Ansicht (wie Strg+V vor M530). **Jetzt:** ein Hinweis „Die geöffnete Karte wird nicht dupliziert. Esc schließt sie –
dann dupliziert Strg+D die Auswahl.", sonst nichts; die Taste wird geschluckt (kein Lesezeichen des Browsers). Auch mit
dem Schreib-Cursor im Text. Ohne Fokus wie bisher.
- `components/boardTasten.ts`: vor dem Duplizieren `st.focusCard` → `tun(() => showToast(…))`.
- Warum kein „sinnvolles Handeln" wie bei Strg+V: Eine Kopie der offenen Karte gehört aufs Board, nicht in die Karte;
  sie im Fokus anzulegen und dorthin zu springen hieße, die offene Karte ungefragt zu verlassen. Drei-Finger-Wischen
  (FingerGesten) war im Fokus schon gesperrt.
- Prüfreihe D1–D5; gegen den Build davor D1–D3 rot.
