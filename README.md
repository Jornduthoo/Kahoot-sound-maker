# Sound Recorder

Chrome-extensie (Manifest V3) om geluid van websites te bewaren als **mp3** of **wav**, op twee manieren:

1. **Opnemen**: neemt het geluid van het huidige tabblad op terwijl het speelt. Werkt overal, ook bij beveiligde video's zoals VRT MAX.
2. **Media op pagina**: haalt de audio rechtstreeks uit video's en audio op de pagina, zonder af te spelen. Werkt voor gewone bestanden (mp3, mp4, …) en onbeveiligde streams (HLS `.m3u8`, DASH `.mpd`). Beveiligde media (DRM of versleuteld) wordt herkend en niet gedownload.

## Installeren (ontwikkelmodus)

1. Open `chrome://extensions` en zet **Ontwikkelaarsmodus** aan.
2. Klik **Uitgepakte extensie laden** en kies deze map (met `manifest.json` erin).
3. Zet het icoon vast via het puzzelstukje in de werkbalk.

Bij een update: vervang de bestanden en klik op het herlaad-icoon bij de extensie in `chrome://extensions`.

## Opnemen

Klik op het icoon en daarna op de rode knop. Tijdens de opname zie je de tijd en een niveaumeter, en kan je **pauzeren** of **stoppen**. Sneltoets: **Alt+Shift+R** (wijzigen via `chrome://extensions/shortcuts`).

Snelle opties in de popup:

| Optie | Wat het doet |
| --- | --- |
| **Snelheid** 1× – 4× | De video speelt versneld af (zonder toonhoogtecorrectie) en de extensie draait dat na de opname exact terug, zodat het normaal klinkt. 2× is bijna verliesvrij, 3× en 4× klinken wat doffer (prima voor spraak). Het tabblad is dan stil. |
| **Tabblad dempen** | Je hoort zelf niets, de opname gaat gewoon door. |
| **Video vanaf het begin** | Zet de video op 0:00 en start hem bij het begin van de opname. |
| **Stoppen als de video eindigt** | De opname stopt vanzelf aan het einde van de video. |

Klaar? Dan wordt het bestand gedownload en bewaard in **Mijn opnames** (icoon rechtsboven), waar je opnames kan beluisteren, hernoemen, downloaden en verwijderen.

## Media op pagina

Het tabblad **Media op pagina** toont wat de pagina laadt: losse audio-/videobestanden en streaming-playlists. Speel de video even af als de lijst leeg is. Per item:

- **mp3** (of wav): downloadt het, haalt het geluid eruit en bewaart het zoals een opname;
- **bestand-icoon**: downloadt het originele bestand (enkel bij losse bestanden).

Items met **Beveiligd** (DRM of AES-versleuteling) of **Live** kunnen niet rechtstreeks; gebruik dan **Opnemen**.

### VRT MAX / Karrewiet

VRT MAX beveiligt zijn video's met DRM. De extensie omzeilt dat niet. Gebruik **Opnemen** met snelheid **2×**, **Video vanaf het begin** en **Stoppen als de video eindigt**: een aflevering van 10 minuten staat dan na ongeveer 5 minuten als normale mp3 klaar. Als de speler van VRT MAX het tempo terugzet, neemt de extensie gewoon op 1× op.

## Instellingen

Formaat (mp3/wav), mp3-kwaliteit (48–320 kbps), stereo/mono, stilte wegknippen, volume gelijktrekken, bestandsnaam (`{titel}`, `{site}`, `{datum}`, `{tijd}`), automatisch stoppen na X minuten, bewaren in Mijn opnames, meteen downloaden en "Opslaan als" vragen.

## Structuur

| Bestand | Rol |
| --- | --- |
| `manifest.json` | Manifest V3 |
| `src/background.js` | Service worker: status, badge, sneltoets, media herkennen (webRequest), versnellen/einde video in de pagina |
| `src/offscreen.js` | Opnemen (`MediaRecorder`), niveaumeter, media downloaden en verwerken |
| `src/audio.js` | Terugdraaien van versnelde opnames, stilte knippen, normaliseren, mp3/wav maken |
| `src/media.js` | Bestanden, HLS (TS/fMP4/AAC) en DASH downloaden; herkent beveiliging en livestreams |
| `src/db.js` | "Mijn opnames" in IndexedDB |
| `src/popup.*` | Popup met Opnemen en Media op pagina |
| `src/library.*` | Mijn opnames |
| `src/options.*` | Instellingen |
| `src/settings.js` | Standaardinstellingen en hulpfuncties |
| `src/icons.js`, `src/ui.css`, `icons/` | Iconen en opmaak (licht en donker thema) |
| `src/vendor/lame.min.js` | [lamejs](https://github.com/zhuker/lamejs) 1.2.1 voor de mp3-codering (LGPL-3.0) |
