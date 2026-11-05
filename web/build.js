/* Builds web/index.html (the published desk page) from page.src.html with engine.js inlined.
   The files in apps/ are published next to it. Run: node web/build.js */
const fs = require("fs"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "page.src.html"), "utf8"), eng = fs.readFileSync(path.join(__dirname, "engine.js"), "utf8");
if (!src.includes("/*ENGINE*/")) throw new Error("page.src.html has no /*ENGINE*/ marker");
fs.writeFileSync(path.join(__dirname, "index.html"), src.replace("/*ENGINE*/", () => eng));
console.log("web/index.html written");
