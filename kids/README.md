# Little Astronaut

A space game for ages 4 to 6, in Arabic and English: visit the planets, build a space station, catch stars and fly to the Moon, with a sticker book. Every instruction is spoken, so no reading is needed.

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
