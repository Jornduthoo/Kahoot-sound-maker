# Sound Recorder

Chrome-extensie (Manifest V3) die:

1. het geluid van het actieve tabblad opneemt;
2. de opname opslaat als **mp3**;
3. de audio naar **Gemini** stuurt om er een quiz (vragen + juiste antwoorden) van te maken;
4. daar een **PDF** van maakt die je meteen in **Karrewiet** kan importeren.

## Status

Skelet. Opnemen van tab-audio werkt (als `.webm`); mp3-conversie, Gemini-koppeling en PDF-export volgen.

## Installeren (ontwikkelmodus)

1. Open `chrome://extensions`.
2. Zet **Ontwikkelaarsmodus** aan.
3. Klik **Uitgepakte extensie laden** en kies deze map.

## Structuur

| Bestand | Rol |
| --- | --- |
| `manifest.json` | Manifest V3, rechten `tabCapture`, `offscreen`, `storage`, `downloads` |
| `src/background.js` | Service worker: haalt de stream-id van het tabblad op en stuurt het offscreen-document aan |
| `src/offscreen.html/.js` | Neemt de audio op met `MediaRecorder` (service workers kunnen dat niet) |
| `src/popup.html/.js` | Start/stop-knop |
| `src/options.html/.js` | Gemini API-sleutel instellen |

## Volgende stappen

- [ ] mp3-encoding (bv. met `lamejs`) in het offscreen-document
- [ ] Audio naar de Gemini API sturen met een prompt voor vragen + antwoorden
- [ ] PDF genereren (bv. `jsPDF`) in het formaat dat Karrewiet verwacht
