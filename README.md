# Kahoot Sound Maker

Chrome-extensie (Manifest V3) die van een aflevering van **Karrewiet** (het jeugdjournaal van Ketnet/VRT) een quiz maakt voor **Kahoot**:

1. je speelt Karrewiet af in een tabblad en de extensie neemt het geluid op;
2. de opname wordt een **mp3** (wordt ook gedownload);
3. de mp3 gaat naar **Gemini**, die 10 meerkeuzevragen met het juiste antwoord maakt;
4. je krijgt een **antwoordsleutel** in dezelfde opmaak als de voorbeelden, die je als **PDF** bewaart en in Kahoot importeert (Kahoot haalt de vragen uit de PDF).

## Installeren (ontwikkelmodus)

1. Open `chrome://extensions`.
2. Zet **Ontwikkelaarsmodus** aan.
3. Klik **Uitgepakte extensie laden** en kies deze map.
4. Open de **Instellingen** (link onderaan de popup) en vul je Gemini API-sleutel in (gratis aan te maken op [aistudio.google.com/apikey](https://aistudio.google.com/apikey)).
5. Klik **Test API-sleutel** om te controleren of de sleutel en het model werken. Bij een onbekend model toont de test welke modellen je sleutel wel kan gebruiken.

## Instellingen

| Instelling | Standaard | Uitleg |
| --- | --- | --- |
| Tabblad dempen tijdens de opname | uit | Je hoort zelf niets, de opname gaat gewoon door |
| Automatisch stoppen na (minuten) | 0 (uit) | De popup toont hoe lang de opname nog loopt |
| mp3 downloaden | aan | |
| Kwaliteit | Normaal (128 kbps, 44,1 kHz) | Laag 64 kbps, Hoog 192 kbps, Maximaal 320 kbps / 48 kHz |
| Stereo | uit (mono) | |
| Aantal vragen | 10 | |
| Leerjaar | 6 | Bepaalt de moeilijkheid en de voettekst ("Klas 6") |
| Gemini-model | `gemini-2.5-flash` | |

De kwaliteit geldt enkel voor de gedownloade mp3. Gemini krijgt altijd een compacte spraakversie (32 kbps, 16 kHz mono), zodat ook lange opnames onder de limiet van 20 MB blijven.

## Gebruik

1. Open Karrewiet (bv. op VRT MAX) in een tabblad.
2. Klik op het extensie-icoon → **Start opname** en speel de aflevering af.
3. Klik op het einde **Stop opname**, of laat hem automatisch stoppen. De mp3 wordt gedownload, en na een halve minuut opent de antwoordsleutel in een nieuw tabblad.
4. Controleer de vragen. Je kan elke tekst aanklikken om hem te verbeteren, en op een bolletje klikken om het juiste antwoord te wijzigen.
5. Klik **Download als PDF** en kies in het printvenster **Opslaan als PDF**.
6. Importeer de PDF in Kahoot.

## Structuur

| Bestand | Rol |
| --- | --- |
| `manifest.json` | Manifest V3, rechten `tabCapture`, `offscreen`, `storage`, `downloads` |
| `src/background.js` | Service worker: start/stopt de opname, downloadt de mp3, bewaart de quiz en opent de antwoordsleutel |
| `src/offscreen.js` | Neemt op met `MediaRecorder`, zet om naar mp3 (16 kHz mono) en vraagt Gemini om de quiz |
| `src/popup.*` | Start/stop-knop, status en aftelling |
| `src/options.*` | Instellingenpagina |
| `src/settings.js` | Standaardinstellingen en kwaliteitspresets |
| `src/quiz.*` | Antwoordsleutel (A4, twee kolommen), bewerkbaar en printbaar als PDF |
| `src/vendor/lame.min.js` | [lamejs](https://github.com/zhuker/lamejs) 1.2.1 voor de mp3-encoding (LGPL-3.0) |
