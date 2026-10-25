# CueGFX

Live-Grafik-App für Streams, Events und Broadcast. Bauchbinden, Ticker, Spielstände, Timer, Songtexte, Umfragen und eigene Grafiken lassen sich in einer Desktop-App steuern. Die Ausgabe läuft über Browser-Quellen (OBS, vMix), Vollbild auf Monitor/Beamer oder direkt über **Blackmagic DeckLink- und UltraStudio-Karten mit Fill + Key**.

Läuft als Desktop-App mit voller Oberfläche auf **macOS, Windows und Linux**. Zusätzlich lässt sich die Steuerung von jedem Rechner im Netzwerk per Browser bedienen.

---

## Funktionen

**Grafiktypen** (alle enthalten, keine Lizenzstufen)

| Bereich | Grafiken |
|---|---|
| Text | Bauchbinde (5 Stile) · Animierte Bauchbinde (Reveal, Balken, Gestaffelt, Glow, 3D-Flip) · Nachricht · Ticker (Laufband oder Blättern) · Social/Chat · Abspann · Songtexte |
| Medien | Bild · Video (MP4/WebM, Schleife, Trimmen, Auto-Ausblenden) · Audio (MP3/WAV, Trimmen, Einblenden) |
| Sport | Spielstand mit Logos, Farben, Spieluhr, Punkte-Animation |
| Zeit | Timer · Großer Timer (Warn-/Kritisch-Farben, Fortschritt) · Jetzt/Gleich/Danach |
| Utility | Sprecher-Timer für Bühnenmonitore · Uhrzeit (Zeitzonen) · Testbilder (SMPTE, EBU, Raster, Safe Areas, Alpha-Test, 1-kHz-Ton) · QR-Code |
| Effekte | Konfetti, Feuerwerk, Emoji-Regen, Konfetti-Kanonen · Animierte Hintergründe (Blasen, Verlauf, Wellen, Partikel, Raster) |
| Interaktion | Q&A live (Fragen-Wand mit mehreren Fragen + neuester Frage oder einzelne Frage mit Rotation) · einzelne Publikumsfrage · Umfrage-Ergebnisse (Auswahl, Mehrfachauswahl, Wortwolke, Sterne-Bewertung) |
| Builder | Eigene Grafiken per Drag & Drop aus Text-, Flächen-, Kreis- und Bildebenen mit eigener Ein-Animation |

**Bedienung**
- Vorschau (PVW) und Sendung (LIVE) mit **TAKE**, beide Monitore direkt in der Oberfläche
- Beliebig viele **Grafik-Ausgänge** (z. B. Sendung, Bühnenmonitor, Leinwand), jede Grafik frei zuordenbar
- **Projekte**: mehrere Projekte, duplizieren, **Export/Import als ZIP inklusive Medien und Schriften**
- **Theme-Editor** mit 6 Vorlagen, Farben, Schriften (auch eigene TTF/OTF/WOFF), Radius, Schatten, Animation, sicherer Rand, eigenes CSS, zusätzlich CSS pro Grafik
- **Variablen** `{{name}}` in allen Texten, **Listen** zum Durchschalten, eingebaute Werte (`{{time}}`, `{{date}}` …), Fallback `{{name|Standard}}`
- **Google Sheets**: freigegebene Tabellen werden regelmäßig abgefragt, Zellen als `{{tabelle.B2}}` oder Schlüssel/Wert als `{{tabelle.Heimteam}}`
- **Publikums-Seite nach Slido-Vorbild** im Netzwerk (QR-Code): Fragen stellen und liken, Sortierung beliebt/neu, „Wird geprüft“-Status für eigene Fragen, Umfragen als Auswahl, Mehrfachauswahl, Wortwolke und Sterne-Bewertung, Ergebnisse optional fürs Publikum
- **Q&A-Moderation**: Freigabe vor dem Fragenpool, **Sperrwörter** (zurückhalten, ablehnen oder zensieren, erkennt auch „1d10t“), Fragen **aktiv** (hervorgehoben) oder **gelöst** (ausgeblendet) markieren, „Nächste Frage“ per Klick oder Companion, Fragen bearbeiten
- **Twitch-Chat** anonym mitlesen und Nachrichten per Klick einblenden
- **HTTP-API** (GET/POST) und WebSocket, dazu ein eigenes **Bitfocus-Companion-Modul**
- Zugriffs-PIN für Steuerung und API, Tastenkürzel (`Strg/⌘+Enter` = Take, `Strg/⌘+⌫` = alles aus)

**Ausgabe**
- Browser-Quelle für OBS, vMix, Wirecast usw. mit transparentem Hintergrund oder Grün/Blau/Schwarz für Chroma-/Luma-Key
- Vollbild auf beliebigen Bildschirmen (HDMI, DisplayPort, Beamer), automatische Wiederherstellung beim Start
- **NDI®** – jeder Grafik-Ausgang als eigene NDI-Quelle, mit Alphakanal, Auflösung und Bildrate wählbar (siehe unten)
- **Blackmagic DeckLink / UltraStudio** (siehe unten)

---

## NDI

Unter **Ausgänge → NDI-Ausgänge** lässt sich jeder Grafik-Ausgang als NDI-Quelle senden: frei wählbarer Name, 720p/1080p/4K oder Hochformat, 25 bis 60 fps, **transparent mit Alphakanal** (Key in vMix, OBS/DistroAV, TriCaster automatisch) oder deckend. Angezeigt werden die Zahl der Empfänger und Tally (PGM/PVW).

Zum **Bauen** braucht es kein NDI SDK. Auf dem Rechner, auf dem CueGFX läuft, muss nur die **NDI-Laufzeit** installiert sein, am einfachsten über die kostenlosen **NDI Tools** (https://ndi.video/tools/). Unter Linux die NDI-Laufzeit bzw. `libndi.so.6` installieren. Ein eigener Pfad ist über die Umgebungsvariable `CUEGFX_NDI_LIB` möglich.

NDI® ist eine eingetragene Marke von Vizrt NDI AB.

## Blackmagic DeckLink & UltraStudio

| Modus | Beschreibung |
|---|---|
| **Fill + Key** | Füllsignal auf SDI 1, Key (Alpha) auf SDI 2 – z. B. in den Upstream- oder Downstream-Keyer eines ATEM. Key-Level einstellbar. |
| **Interner Keyer** | Die Karte legt die Grafik in Hardware über das Signal an ihrem eigenen SDI-Eingang (gleiches Videoformat nötig). |
| **Live-Eingang als Hintergrund** | Ein beliebiger DeckLink-Eingang wird eingelesen und die Grafik in Software darübergelegt. Formaterkennung und Skalierung erfolgen automatisch, auch über zwei verschiedene Karten. |
| **Nur Fill** | Grafik über dem Hintergrund des Ausgangs (z. B. Schwarz für Luma-Key). |
| **Mehrere Karten** | Beliebig viele Ausgaben parallel, jede mit eigenem Grafik-Ausgang, Format und Keying. |

Weitere Optionen: Alpha **vormultipliert** (Standard, im ATEM „Pre Multiplied Key“ einschalten) oder **gerade**, Pixelformat BGRA/ARGB/YUV, Rot/Blau-Tausch, Ton über die Computer-Lautsprecher. Status mit Bildrate, verspäteten/verworfenen Frames und Eingangssignal wird live angezeigt.

Technik: Jeder DeckLink-Ausgang wird in einem unsichtbaren Offscreen-Fenster gerendert und per **Scheduled Playback** (Hardware-getaktet, mit automatischem Aufholen bei Verzögerung) an die Karte übergeben. Das native Modul nutzt die ABI-stabile Node-API und ist kompatibel mit SDK-Versionen vor und ab 14.3 (neues `IDeckLinkVideoBuffer`).

---

## Installation (Entwicklung)

Voraussetzungen: **Node.js 20 oder neuer**.

```bash
npm install
npm start            # startet die Desktop-App
npm test             # Schnelltest von Server und API
```

Die Steuerung öffnet sich als App-Fenster. Im Netzwerk ist sie zusätzlich unter `http://<IP>:4001/control` erreichbar. Ist der Port belegt, wird automatisch der nächste freie genommen.

### Native Module bauen (NDI & DeckLink)

```bash
npm run build:native     # baut NDI (immer) und DeckLink (wenn das SDK vorhanden ist)
npm run build:ndi        # nur NDI
npm run build:decklink   # nur DeckLink
```

### DeckLink-Unterstützung bauen

1. **Blackmagic Desktop Video** (Treiber) installieren und die Karte einmal im *Desktop Video Setup* prüfen.
2. Das kostenlose **Desktop Video SDK** von https://www.blackmagicdesign.com/developer laden und entpacken.
3. Compiler bereitstellen:
   - **macOS:** `xcode-select --install`
   - **Windows:** *Visual Studio 2022 Build Tools* mit der Workload „Desktopentwicklung mit C++“ (MIDL ist enthalten)
   - **Linux:** `sudo apt install build-essential python3`
4. Bauen:

```bash
# macOS / Linux
DECKLINK_SDK_DIR="/pfad/zum/Blackmagic DeckLink SDK 15.x" npm run build:decklink

# Windows (PowerShell)
$env:DECKLINK_SDK_DIR="C:\SDK\Blackmagic DeckLink SDK 15.x"; npm run build:decklink
```

Alternativ das SDK nach `./sdk/decklink` legen, dann ist keine Variable nötig. Das Skript übersetzt unter Windows automatisch die IDL-Dateien, baut das Modul und listet anschließend die gefundenen Karten auf.

### Installationspakete erstellen

```bash
npm run dist:mac      # .dmg und .zip (auf einem Mac bauen)
npm run dist:win      # Installer und portable .exe (auf Windows bauen)
npm run dist:linux    # AppImage und .deb (auf Linux bauen)
```

Die `dist`-Befehle bauen zuerst die nativen Module (NDI immer, DeckLink wenn das SDK vorhanden ist). Ohne DeckLink-SDK entsteht trotzdem eine voll funktionsfähige App, nur ohne DeckLink-Ausgabe. Auf dem Mac ohne Apple-Entwicklerzertifikat: `npm run dist:mac:local` (Ad-hoc-Signatur). Pakete müssen auf dem jeweiligen Betriebssystem erstellt werden, weil das native Modul plattformspezifisch ist.

---

## Bitfocus Companion

Das Modul liegt im Ordner `companion-module/` (für Companion 3.x und 4.x, API 1.x).

```bash
cd companion-module
npm install
npm run package       # erzeugt cuegfx-1.0.0.tgz
```

In Companion auf der Seite **Modules** die `.tgz` als Modulpaket importieren. Alternativ im Companion-Launcher einen *Developer modules path* auf einen Ordner setzen, der `companion-module` enthält. Danach eine Verbindung „CueGFX“ anlegen und IP/Port (Standard 4001) eintragen.

Das Modul bietet 27 Aktionen, 9 Feedbacks, Live-Variablen (Timer, Spielstände, Live-Status je Grafik) und **automatisch erzeugte Presets für jede Grafik**. Die Tasten leuchten rot bei LIVE und grün in der Vorschau. Details stehen in `companion-module/companion/HELP.md`.

---

## HTTP-API (Kurzfassung)

Alle Aufrufe gehen per GET oder POST. `:g` ist die Grafik-ID oder der Grafikname.

```
/api/graphics                              Liste
/api/graphics/:g/show | hide | toggle | preview
/api/graphics/:g/update?title=Neu          Felder ändern (rename=… benennt die Grafik um, outputs=1,2)
/api/graphics/:g/timer-start | timer-pause | timer-toggle | timer-reset
/api/graphics/:g/timer-set?seconds=5:00    /api/graphics/:g/timer-add?seconds=30
/api/graphics/:g/score?team=a&delta=1      /api/graphics/:g/next | prev | goto?index=2
/api/take   /api/hide-all   /api/clear-preview
POST /api/cmd {"cmd":"qa.activeNext"}   qa.resolveActive · qa.approveAll · qa.approve/reject/active/resolve {"id":…}
/api/variables/:name?value=…               /api/lists/:name/next | prev | select?index=0
/api/projects   /api/projects/:id/switch   /api/export   POST /api/import
POST /api/cmd  {"cmd":"graphic.show","args":{"id":"…"}}
WebSocket ws://host:4001/ws?role=control   Live-Status
```

Ist eine PIN gesetzt, senden andere Rechner sie als Header `X-Cue-Pin` oder Parameter `?pin=`. Grafik-Ausgänge und Anfragen vom lokalen Rechner brauchen keine PIN.

---

## Ausgabe-URLs

| URL | Zweck |
|---|---|
| `/output/1`, `/output/2` … | Grafik-Ausgänge (1920×1080, skaliert auf jede Größe) |
| `/output/preview` | Vorschau |
| `?transparent=1` · `?bg=%2300ff00` · `?audio=0` · `?guides=1` | Hintergrund erzwingen, Ton aus, Safe-Area-Hilfslinien |
| `/audience` | Publikums-Seite für Fragen und Umfragen |

---

## Projektstruktur

```
src/main/          Electron-Hauptprozess (Fenster, Bildschirm-Ausgänge, Menü)
src/server/        HTTP-/WebSocket-Server ohne Fremdabhängigkeiten, API, Speicher, ZIP, QR, Sheets, Twitch
src/decklink/      DeckLink-Manager (Offscreen-Rendering → natives Modul)
src/main/ndi.js    NDI-Manager · native/ndi/ NDI-Modul (lädt die NDI-Laufzeit dynamisch)
src/server/audience.js  Q&A, Moderation, Sperrwörter, Umfragen
native/decklink/   C++-Modul (Node-API) für DeckLink/UltraStudio
public/control/    Steuer-Oberfläche inkl. Builder
public/output/     Grafik-Engine und Renderer aller Grafiktypen
public/audience/   Publikums-Seite
companion-module/  Bitfocus-Companion-Modul
scripts/           Build- und Testskripte
```

Daten (Projekte, Medien, Einstellungen) liegen im Benutzerordner der App, erreichbar über **Datei → Datenordner anzeigen**.

---

## Fehlerbehebung

- **„DeckLink-Modul ist nicht gebaut“**: `npm run build:decklink` mit SDK ausführen (siehe oben).
- **„Desktop Video ist nicht installiert“**: Blackmagic-Treiber installieren, unter macOS die Systemerweiterung erlauben und neu starten.
- **„Gerät unterstützt kein externes Keying“**: Bei Karten mit Profilen (z. B. DeckLink Duo 2, 8K Pro) im *Desktop Video Setup* ein Profil mit Keying wählen. Manche Mini-Karten haben keinen Keyer, dann „Nur Fill“ oder „Live-Eingang“ nutzen.
- **Farben vertauscht**: in der DeckLink-Ausgabe „Rot/Blau tauschen“ aktivieren.
- **Dunkle Ränder an weichen Kanten im ATEM**: Alpha auf „Premultiplied“ lassen und im ATEM „Pre Multiplied Key“ einschalten, oder Alpha auf „Straight“ stellen und Pre Multiplied ausschalten.
- **Google-Tabelle lädt nicht**: Freigabe „Jeder mit dem Link“ oder „Im Web veröffentlichen“ nutzen.
- **Video startet im Browser ohne Ton**: Browser blockieren Autoplay mit Ton. In der Desktop-App, in OBS und vMix tritt das nicht auf.

---

Eigenständige Software. Nicht mit H2R Graphics, Here to Record, Slido, Vizrt/NDI oder Blackmagic Design verbunden. „DeckLink“, „UltraStudio“ und „ATEM“ sind Marken von Blackmagic Design.

## Versionierung

Jeder Build auf GitHub bekommt automatisch eine eigene Versionsnummer (`scripts/set-version.js`):

| Start | Version |
|---|---|
| „Run workflow“ ohne Eingabe | Haupt- und Nebenversion aus `package.json` + Build-Nummer, z. B. **1.1.27** |
| „Run workflow“ mit Eingabe | genau die eingegebene Version, z. B. `1.2.0` oder `1.3.0-beta.1` |
| Tag `v1.2.0` pushen | **1.2.0** |

Jeder erfolgreiche Build erscheint mit allen Installern unter **Releases** im Repo. Automatisch nummerierte Builds werden als *Pre-release* markiert, Builds mit eingegebener Version oder Tag als reguläres Release (*Latest*).

Für einen neuen Versionssprung (z. B. auf 1.2) einfach `"version"` in `package.json` auf `1.2.0` setzen.
Die Version samt Build-Nummer und Commit steht in der App unter *Einstellungen → Über*, im Fenstertitel und im Menü *Hilfe → Über CueGFX*.
Lokal gebaute Apps zeigen „lokal gebaut“.

### Companion-Modul

Das Modul in `companion-module/` hat einen eigenen Workflow (*Actions → Companion-Modul*). Er läuft automatisch bei jeder Änderung im Ordner und veröffentlicht ein Release **„Companion-Modul <Version>“** mit der Datei `cuegfx-companion-<Version>.tgz`.
Versionierung wie bei der App: Haupt- und Nebenversion aus `companion-module/package.json` + Build-Nummer, eine Eingabe beim manuellen Start oder ein Tag `companion-v1.2.0`.
Installation in Companion (ab 4.0): *Modules → Import module package*.

## Live-Chats (Reiter „Chat“)

Beliebig viele Chat-Quellen gleichzeitig; alle Nachrichten laufen in einer gemeinsamen Liste zusammen und lassen sich mit **PVW/LIVE** in die Grafik „Social / Chat“ übernehmen (inkl. Avatar, Plattform-Symbol und Spendenbetrag). Aktivierte Quellen verbinden sich beim Start automatisch und warten, bis ihr live geht. Zugangsschlüssel bleiben in `config.json` dieses Rechners und werden nicht mit dem Projekt exportiert.

| Plattform | Wie | Was ihr braucht |
|---|---|---|
| **Twitch** | öffentlicher Chat, anonym | nur den Kanalnamen |
| **YouTube** | öffentlicher Live-Chat wie im Browser – oder offizielle API | `@kanal` bzw. Kanal-/Video-Link; optional API-Schlüssel (Tageskontingent reicht ca. 3 Std.) |
| **Facebook** | offizielle Meta Graph API | eigene Meta-App + Seiten-Token mit `pages_read_engagement`, `pages_read_user_content` |
| **Instagram** | offizielle Meta Graph API | Business-/Creator-Konto; Token mit `instagram_basic`, `instagram_manage_comments` (oder Instagram-Login-Token „IG…“) |
| **TikTok** | über [Social Stream Ninja](https://socialstream.ninja) | Social Stream Ninja (Browser-Erweiterung/App) mit Sitzungs-ID; dort *Global settings → Mechanics*: „Enable remote API control“ und „Send chat messages to API server“ einschalten |
| **Social Stream Ninja (alle)** | wie TikTok, ohne Filter | bringt zusätzlich Kick, Rumble, X u. v. m. – optional per Plattform-Filter einschränken |

TikTok bietet keine offizielle Schnittstelle für Live-Kommentare; Social Stream Ninja liest den Chat im Browser mit und reicht ihn an CueGFX weiter.
