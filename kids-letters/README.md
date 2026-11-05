# Letter Planets (كواكب الحروف)

A learning game for ages 4 to 6, in Arabic and English. The Arabic or English alphabet, four letters at a time: meet, trace with a finger, pop and match, with two spelling bosses. 30 levels. Nova speaks every instruction; nobody loses.

The game is built from the shared source in `kids-games/` (see its README). This Expo app shows it full screen, sends its spoken lines to the phone's voice (expo-speech), and makes the Android back button go back a screen, then leave the app.

Android app ID: `com.nalqarni2020.letterplanets`

## Run it on your phone
```bash
cd kids-letters
npm install
npx expo start --tunnel ngrok
```
Scan the QR code with Expo Go.

## Build an APK
```bash
npx eas-cli@latest login
```
```bash
npx eas-cli@latest build -p android --profile preview
```
When it finishes, open the link on the phone and install the APK. Commit the `projectId` that EAS adds to `app.json`.

## After editing the game
```bash
node ../kids-games/scripts/build.js && npm run game
```

## Arabic voice
The Arabic voice is the phone's own. If it is silent on Android: Settings → System → Languages → Text-to-speech output → Google → install the Arabic voice data.
