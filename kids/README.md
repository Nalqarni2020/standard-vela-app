# Little Astronaut

A space game for ages 4 to 6, in Arabic and English. Every instruction is spoken by Nova, the helper astronaut, so no reading is needed.

- **Space Journey:** 25 levels in four worlds (Moon, Mars, Jupiter, Saturn). Each unlocks the next and earns 1 to 3 stars; nobody loses.
- **Six kinds of play:** catch stars, build a station, launch the rocket, planet quiz, count the stars, connect constellations. Each step asks a little more.
- **Space Book:** about 50 short, true facts in both languages: every planet, the Sun and Moon, Pluto, comets, the Milky Way, the Space Station and four constellations.
- **Ranks and stickers:** Space Cadet, Space Pilot, Captain and Mission Commander; 27 stickers.

The game itself is one HTML file, `game/little-astronaut.html`. This Expo app shows it full screen and sends its spoken lines to the phone's voice (expo-speech), because Android's in-app web view has no built-in voice. The Android back button returns to the home screen, then leaves the app.

## Run it on your phone
```bash
cd kids
npm install
npx expo start --tunnel ngrok
```
Scan the QR code with Expo Go.

## After editing the game
```bash
cd kids && npm run game
```
This repacks `game/little-astronaut.html` into `src/game.ts`.

## Arabic voice
The Arabic voice is the phone's own. If it is silent or wrong on Android: Settings → System → Languages → Text-to-speech output → Google → install the Arabic voice data.
