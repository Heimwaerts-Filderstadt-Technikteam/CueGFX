# CueGFX

Steuert die Live-Grafik-App **CueGFX** – Bauchbinden, Ticker, Timer, Spielstände, Songtexte, Umfragen und mehr. Das Modul hält eine dauerhafte WebSocket-Verbindung, dadurch zeigen die Tasten den Status sofort an (rot = auf Sendung, grün = in der Vorschau).

## Einrichtung
1. CueGFX starten (Desktop-App oder Server). Standard-Port: **4001**.
2. In Companion eine Verbindung „CueGFX“ anlegen, IP-Adresse des CueGFX-Rechners und Port eintragen.
3. Falls in CueGFX unter *Einstellungen → Zugriffs-PIN* eine PIN gesetzt ist, hier ebenfalls eintragen.

## Presets
Für jede Grafik des aktiven Projekts entstehen automatisch fertige Tasten:
- **Grafiken: Live** – Live ein/aus, rot wenn auf Sendung, dunkelgrün wenn in der Vorschau
- **Grafiken: Vorschau** – Vorschau ein/aus, zusammen mit **TAKE** für Vorschau→Sendung
- **Timer** – Start/Pause mit Zeitanzeige, Reset, ±1 Minute
- **Spielstand** – Punkte für Team A/B mit Live-Anzeige
- **Songtexte & Programm** – Weiter/Zurück mit Vorschau auf die nächste Folie
- **Listen** und **Umfragen**

Wird in CueGFX eine Grafik angelegt, umbenannt oder das Projekt gewechselt, aktualisieren sich Auswahllisten, Variablen und Presets automatisch.

## Aktionen
Grafik ein/aus/umschalten · Vorschau · Nur diese Grafik in Vorschau · TAKE · Alles ausblenden (optional pro Ausgang) · Vorschau leeren · Grafik-Feld ändern · Timer steuern/setzen/±Zeit/Modus · Spielstand Punkte/setzen/0/tauschen · Songtext/Programm weiter/zurück/Position · Variable setzen · Liste weiter/zurück/Position · Nächste Publikumsfrage · Umfrage öffnen/schließen/zurücksetzen · Projekt wechseln · Experte: beliebiger Befehl.

Grafiken können im Auswahlfeld gewählt oder per **eigenem Wert** (Grafik-ID oder exakter Name, auch mit Companion-Variablen) angesprochen werden.

## Variablen (Auszug)
- `$(cuegfx:live_names)`, `$(cuegfx:live_count)`, `$(cuegfx:preview_count)`, `$(cuegfx:project)`, `$(cuegfx:questions_new)`
- je Grafik `g_<name>_live`, `g_<name>_state`, bei Timern `g_<name>_timer`, bei Spielständen `g_<name>_score_a` usw.
- alle CueGFX-Textvariablen als `var_<name>`, Listen als `list_<name>`

## Feedbacks
Grafik auf Sendung · Grafik in Vorschau · Take möglich · Timer läuft · Timer unter Schwelle · Team führt · Umfrage offen · Liste auf Position · Neue Publikumsfragen.
