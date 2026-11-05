# Kids' games: shared source

Two learning games for ages 4 to 6, in Arabic and English, built from one shared kit. Nova, the helper astronaut, speaks every instruction, so no reading is needed. Nobody loses: a wrong tap shakes and Nova says "try again". Each level gives 1 to 3 stars.

```
src/style.css    look and layout, shared
src/kit.js       voice, sound, confetti, screens, level map, rounds engine, star screen, ranks
src/numbers.js   Number Galaxy
src/letters.js   Letter Planets
scripts/build.js builds out/number-galaxy.html and out/letter-planets.html
```

## Number Galaxy (مجرة الأرقام)
30 levels in three worlds: Moon Base (1 to 5), Star Field (1 to 10), Galaxy Core (1 to 20).
Ten kinds of play: count (tap each one, then pick the number), number line (fly the rocket), more or less, patterns, adding, taking away, missing number, feed the alien (build an amount, with packs of 5 later), shapes (find, then count), and bubble-pop boss levels: in order, by twos, and counting down.
Every finished level adds a space friend to the collection. Twenty space-and-numbers facts.

## Letter Planets (كواكب الحروف)
The Arabic alphabet (28 letters) or the English alphabet (26 letters), whichever language is on. Each language keeps its own progress.
Four letters at a time: meet them (letter, picture, word), trace them with a finger, pop the letter bubbles, and match pictures to letters. Two spelling bosses. 30 levels.
Tracing is checked: the letter must be mostly covered, and a scribble over the whole screen does not count.
"My letters" shows the whole alphabet; tapping a letter says it and its word.

## Challenges
Levels step up gently: bigger numbers, more choices, fewer labels on the number line, harder patterns, more bubbles and decoys.
Boss levels have a comet timer: beating it is needed for three stars, but the level is always finished.
Three right answers in a row shows a streak. Ranks go from Cadet to Commander.

## Build
```bash
node kids-games/scripts/build.js
```
Then repack each app:
```bash
cd kids-numbers && npm run game
```
```bash
cd kids-letters && npm run game
```
