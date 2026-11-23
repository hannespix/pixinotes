# M457 — Kontakt aus der Mail-Signatur
PR: siehe Merge-Commit · Prüfreihe: `pruefungen/m457-kontakt-aus-mail.mjs` (Port 5457) · Datum: 2026-11-23

## Warum
Offen aus M450/M454 (KONZEPT §3.7): Ansprechpartner stehen im Büroalltag fast immer in Mail-Signaturen. Bisher musste
man Name, Rufnummern und Anschrift von Hand in eine Kontakt-Karte abtippen.

## Was
- E-Mail markieren → ⋯ (oder Rechtsklick) → **„Absender als Kontakt“**. Kein neuer Dauer-Knopf an der Mail.
- Neben der Mail entsteht eine Kontakt-Karte mit Pfeil Mail → Kontakt „Kontakt“: Name und E-Mail aus dem Absender-Kopf
  („Berg, Anna“ wird „Anna Berg“), Funktion, Firma, Rufnummern mit Art (Dienstlich/Mobil/Fax), Anschrift (Straße,
  PLZ + Ort DE/AT/CH, Land) und Webseite aus der Signatur.
- Ohne KI per Heuristik; ist eine KI eingerichtet, prüft und verfeinert sie das Ergebnis (Meldung „von der KI geprüft“).
  Ist die KI nicht erreichbar, bleibt das Ergebnis der Heuristik und die Meldung sagt es.
- Zitierter Verlauf, Rechtshinweise, Handelsregister, „Gesendet von meinem …“ zählen nicht.
- Steht schon ein Kontakt mit derselben E-Mail (Groß-/Kleinschreibung egal) auf dem Board, wird er **ergänzt**: nur
  leere Felder (Rufnummern/E-Mails nur, wenn die Liste leer ist); die Meldung nennt, was ergänzt wurde. Fehlt der Pfeil,
  kommt er dazu. Ist nichts zu ergänzen, ändert sich nichts (und die Meldung bietet kein Rückgängig an).
- Anlegen bzw. Ergänzen samt Pfeil ist **ein** Schritt im Verlauf.

## Wie (Architektur)
- `src/lib/kontaktAusMail.ts` (nachgeladen aus `SelectionToolbar.tsx`, `data-taste="absender-kontakt"`):
  - `ohneZitat` schneidet ab dem ersten Zitat (`>`, „-----Ursprüngliche Nachricht“, „Am … schrieb:“, „On … wrote:“,
    „Von:/From:“, Unterstrich-Linie).
  - `signaturBlock`: nach der LETZTEN Grußformel (`GRUSS_RE`, deutsch und englisch) bzw. dem Trenner „-- “, bis zum
    ersten Disclaimer (`DISCLAIMER_RE`), höchstens 16 Zeilen; ohne Grußformel die letzten Zeilen.
  - `signaturLesen`: Zeilen in Teile (`|`, `·`, `•`) zerlegen; zuerst Anschrift (`PLZ_ORT_RE`, Straße davor über
    `STRASSE_RE` oder per Komma im selben Teil, Land danach über `LAND_RE`), dann E-Mail, Webseite und Rufnummern
    (`findPhoneNumbersInText` wie `lib/entities.tsx`, Art aus der Bezeichnung davor `TEL_ART`, Rückfall Ziffernmuster
    bei benannter Nummer), dann Textzeilen: Namenszeile (Wort aus dem Kopf-Namen), Firma (`FIRMA_RE`: Rechtsformen,
    Behörden), sonst erst Funktion, dann Firma. `absenderName` dreht „Nachname, Vorname“.
  - `kiVerfeinern`: `askJson` (wie `mailDestillat.ts`) mit Kopf, Signatur und dem Vorschlag der Heuristik; die
    KI-Felder ersetzen die Heuristik nur, wo sie (geprüft) etwas liefert; die Kopf-Adresse bleibt immer.
  - `kontaktErgaenzen` (nur leere Felder), `absenderAlsKontakt(mailId)` → `{ text, geaendert }`.
- `src/lib/sicher.ts`: `kontaktVonAussen(roh)` – Eingang für Heuristik UND KI: nur Text, gekürzt, ohne Steuer- und
  Richtungszeichen, E-Mail nur in Adressform, Rufnummer nur als Ziffernmuster, Webseite nur http(s) (über
  `fremdeWebAdresse`), kein Foto.
- Lage über `findFreeSpot` rechts neben der Mail; `makeKontakt` + `addLabeledEdge` in `mutedHistory`.

## Grenzen / offen
- Das Destillat (M451) bietet „Absender als Kontakt“ nicht zusätzlich an – der Weg über das ⋯ der Mail reicht.
- Ein vorhandener Kontakt wird nur über die E-Mail-Adresse erkannt, nicht über den Namen (gleichnamige Personen).
- Anschriften außerhalb von DE/AT/CH (z. B. britische Postleitzahlen) erkennt nur die KI.
- Weitere Personen im Verlauf (zitierte Signaturen) werden bewusst nicht als Kontakt angeboten.
