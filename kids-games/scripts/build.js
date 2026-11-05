/* Builds each kids' game into one self-contained HTML file in out/, from the shared kit and the game's own script.
   Run: node kids-games/scripts/build.js   (then copy into an app with that app's  npm run game) */
const fs = require("fs"), path = require("path");
const src = p => fs.readFileSync(path.join(__dirname, "../src", p), "utf8");
const GAMES = [
  { file: "number-galaxy.html", title: "Number Galaxy", script: "numbers.js" },
  { file: "letter-planets.html", title: "Letter Planets", script: "letters.js" },
];
const css = src("style.css"), kit = src("kit.js");
fs.mkdirSync(path.join(__dirname, "../out"), { recursive: true });
for (const g of GAMES) {
  const html = `<title>${g.title}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;700;800&family=Baloo+Bhaijaan+2:wght@500;700;800&display=swap">
<style>
${css}</style>

<canvas id="sky" aria-hidden="true"></canvas>
<div class="app">
  <header class="top">
    <button class="round" id="back" type="button" hidden><svg class="back-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>
    <h1 id="title"></h1>
    <button class="round" id="lang" type="button"></button>
  </header>
  <main class="stage" id="stage"></main>
</div>
<canvas id="fx" aria-hidden="true"></canvas>

<script>
(function () {
"use strict";
${kit}
${src(g.script)}
})();
</script>
`;
  fs.writeFileSync(path.join(__dirname, "../out", g.file), html);
  console.log(g.file, html.length, "characters");
}
