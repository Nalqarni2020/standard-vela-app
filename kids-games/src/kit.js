/* Shared kit for the kids' games: storage, voice, sound, drawing, the screen router, the level map,
   the rounds engine (progress dots, mistakes to stars, boss timer) and the level-complete screen.
   Each game file defines APP and GAMES, then calls boot(). */

const BASE = {
  en: {
    back: "Back", langBtn: "ع", langName: "العربية", journey: "Journey", free: "Free play", level: "Level",
    next: "Next level", toMap: "Map", again: "Play again", didYouKnow: "Did you know?", levelDone: "Level complete!", allDone: "You finished the whole journey!",
    mapHint: "Pick a level. Each one opens the next!", rankUp: "New rank!", of: "of", boss: "Boss",
    reset: "Start everything again", resetSure: "Tap again to clear all stars",
    praise: ["Great job!", "Super!", "You got it!", "Amazing!", "Well done!", "Fantastic!"],
    retry: ["Almost! Try again.", "Oops! Try another one.", "Not that one. You can do it!"],
    combo: n => n + " in a row!", beatComet: "Beat the comet for three stars!", fast: "So fast!",
  },
  ar: {
    back: "رجوع", langBtn: "EN", langName: "English", journey: "الرحلة", free: "لعب حر", level: "المرحلة",
    next: "المرحلة التالية", toMap: "الخريطة", again: "العب مرة أخرى", didYouKnow: "هل تعلم؟", levelDone: "أنهيت المرحلة!", allDone: "أكملت الرحلة كلها!",
    mapHint: "اختر مرحلة. كل مرحلة تفتح التي بعدها!", rankUp: "رتبة جديدة!", of: "من", boss: "التحدي",
    reset: "ابدأ كل شيء من جديد", resetSure: "اضغط مرة أخرى لمسح كل النجوم",
    praise: ["أحسنت!", "رائع!", "ممتاز!", "برافو!", "عمل رائع!", "مدهش!"],
    retry: ["قريب! حاول مرة أخرى.", "جرّب واحدة أخرى!", "ليست هذه. أنت تستطيع!"],
    combo: n => n.toLocaleString("ar-SA") + " على التوالي!", beatComet: "اسبق المذنّب لتربح ثلاث نجوم!", fast: "سريع جدًا!",
  },
};

/* ================= state ================= */
const store = {
  get(k, d) { try { const v = localStorage.getItem(APP.key + ":" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(APP.key + ":" + k, JSON.stringify(v)); } catch (e) {} },
};
let lang = "en", prog = {}, factSeen = 0;
const progKey = () => APP.progressPerLanguage ? "progress-" + lang : "progress";
function loadProgress() { prog = store.get(progKey(), {}); factSeen = store.get("factSeen", 0); }
function t(k) { const a = APP.W[lang][k]; return a !== undefined ? a : BASE[lang][k]; }
const num = n => Number(n).toLocaleString(lang === "ar" ? "ar-SA" : "en-US", { useGrouping: false });
const pick = a => a[Math.floor(Math.random() * a.length)];
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const levels = () => APP.levels();
const totalStars = () => Object.values(prog).reduce((s, v) => s + v, 0);
const RANKS = [0, 20, 45, 70];
const rankOf = s => RANKS.reduce((r, min, i) => s >= min ? i : r, 0);
const unlocked = i => i === 0 || prog[i - 1] > 0;

/* ================= voice and sound ================= */
function say(text, forceLang) {
  try {
    if (!("speechSynthesis" in window) || !text) return;
    const L = forceLang || lang;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text));
    u.lang = L === "ar" ? "ar-SA" : "en-US"; u.rate = .9; u.pitch = 1.1;
    const v = (speechSynthesis.getVoices() || []).find(x => x.lang && x.lang.toLowerCase().startsWith(L));
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  } catch (e) {}
}
let ac = null;
function audio() { if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ac = null; } } if (ac && ac.state === "suspended") ac.resume(); return ac; }
function tone(f, d, type, vol, delay) {
  const a = audio(); if (!a) return;
  const o = a.createOscillator(), g = a.createGain(), s = a.currentTime + (delay || 0);
  o.type = type || "sine"; o.frequency.setValueAtTime(f, s);
  g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(vol || .15, s + .02); g.gain.exponentialRampToValueAtTime(.0001, s + d);
  o.connect(g); g.connect(a.destination); o.start(s); o.stop(s + d + .05);
}
const sfx = {
  ding() { tone(1046, .25, "triangle", .16); tone(1568, .3, "sine", .1, .06); },
  pop() { tone(660, .12, "square", .06); tone(990, .16, "sine", .1, .05); },
  bonk() { tone(140, .22, "sawtooth", .07); },
  tick(i) { tone(523 * Math.pow(2, (i % 12) / 12), .2, "triangle", .14); },
  whoosh() { const a = audio(); if (!a) return; const o = a.createOscillator(), g = a.createGain(); o.type = "sawtooth"; o.frequency.setValueAtTime(120, a.currentTime); o.frequency.exponentialRampToValueAtTime(900, a.currentTime + .7); g.gain.setValueAtTime(.05, a.currentTime); g.gain.exponentialRampToValueAtTime(.0001, a.currentTime + .8); o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + .85); },
  yay() { [523, 659, 784, 1046].forEach((f, i) => tone(f, .35, "triangle", .14, i * .12)); },
  combo() { [784, 988, 1175, 1568].forEach((f, i) => tone(f, .18, "square", .05, i * .06)); },
};
document.addEventListener("pointerdown", () => audio(), { once: true });

/* ================= drawing ================= */
const RM = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
function fit(cv) {
  const dpr = Math.min(3, window.devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const x = cv.getContext("2d"); x.setTransform(dpr, 0, 0, dpr, 0, 0); return { x, w, h };
}
function star(x, cx, cy, r, col, edge) {
  x.save(); x.fillStyle = col || "#ffd23f"; x.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * .45 : r; x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
  x.closePath(); x.fill(); x.lineWidth = Math.max(1.5, r * .12); x.strokeStyle = edge || "#fff6c8"; x.stroke(); x.restore();
}
function rocket(x, cx, cy, s, ang, flame) {
  x.save(); x.translate(cx, cy); x.rotate(ang || 0); x.scale(s / 100, s / 100);
  if (flame) { const f = 30 + Math.random() * 18; const g = x.createLinearGradient(0, 40, 0, 40 + f); g.addColorStop(0, "#fff3a0"); g.addColorStop(.5, "#ffa23a"); g.addColorStop(1, "rgba(255,60,40,0)"); x.fillStyle = g; x.beginPath(); x.moveTo(-14, 38); x.quadraticCurveTo(0, 40 + f * 1.4, 14, 38); x.fill(); }
  x.fillStyle = "#e8434f"; x.beginPath(); x.moveTo(-18, 18); x.lineTo(-34, 44); x.lineTo(-16, 40); x.fill(); x.beginPath(); x.moveTo(18, 18); x.lineTo(34, 44); x.lineTo(16, 40); x.fill();
  x.fillStyle = "#f6f3ea"; x.beginPath(); x.moveTo(0, -50); x.bezierCurveTo(26, -28, 22, 20, 18, 42); x.lineTo(-18, 42); x.bezierCurveTo(-22, 20, -26, -28, 0, -50); x.fill();
  x.fillStyle = "#e8434f"; x.beginPath(); x.moveTo(0, -50); x.bezierCurveTo(12, -40, 16, -30, 17, -24); x.lineTo(-17, -24); x.bezierCurveTo(-16, -30, -12, -40, 0, -50); x.fill();
  x.fillStyle = "#2b3a8f"; x.beginPath(); x.arc(0, -4, 11, 0, 7); x.fill(); x.fillStyle = "#8fd6ff"; x.beginPath(); x.arc(0, -4, 7.5, 0, 7); x.fill();
  x.fillStyle = "#fff"; x.beginPath(); x.arc(-2.5, -6.5, 2.5, 0, 7); x.fill();
  x.restore();
}
function nova(x, cx, cy, r, blink) {   // Nova, the helper astronaut
  x.save();
  x.fillStyle = "#f6f3ea"; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill();
  x.fillStyle = "#2b3a8f"; x.beginPath(); x.ellipse(cx, cy + r * .05, r * .72, r * .58, 0, 0, 7); x.fill();
  x.fillStyle = "#ffcf9e"; x.beginPath(); x.ellipse(cx, cy + r * .1, r * .55, r * .45, 0, 0, 7); x.fill();
  x.fillStyle = "#2b1a00";
  if (blink) { x.fillRect(cx - r * .28, cy + r * .02, r * .16, r * .04); x.fillRect(cx + r * .12, cy + r * .02, r * .16, r * .04); }
  else { x.beginPath(); x.arc(cx - r * .2, cy + r * .04, r * .07, 0, 7); x.arc(cx + r * .2, cy + r * .04, r * .07, 0, 7); x.fill(); }
  x.strokeStyle = "#2b1a00"; x.lineWidth = r * .06; x.beginPath(); x.arc(cx, cy + r * .18, r * .16, .2, Math.PI - .2); x.stroke();
  x.fillStyle = "rgba(255,255,255,.55)"; x.beginPath(); x.ellipse(cx - r * .38, cy - r * .3, r * .14, r * .08, -.6, 0, 7); x.fill();
  x.fillStyle = "#e8434f"; x.beginPath(); x.arc(cx + r * .75, cy - r * .55, r * .14, 0, 7); x.fill();
  x.restore();
}
function canvasOf(size, draw) { const cv = document.createElement("canvas"); cv.style.width = size + "px"; cv.style.height = size + "px"; requestAnimationFrame(() => { const { x, w, h } = fit(cv); draw(x, w, h); }); return cv; }
const starCanvas = (size, on) => canvasOf(size, (x, w, h) => star(x, w / 2, h / 2, Math.min(w, h) * .45, on ? "#ffd23f" : "rgba(170,179,232,.25)", on ? "#fff6c8" : "rgba(170,179,232,.6)"));
const rocketCanvas = size => canvasOf(size, (x, w, h) => rocket(x, w / 2, h / 2, Math.min(w, h) * .8, .5, true));
function emo(text, size) { const s = document.createElement("span"); s.className = "glyph"; s.textContent = text; if (size) s.style.fontSize = size + "px"; s.setAttribute("aria-hidden", "true"); return s; }

/* sky */
const sky = document.getElementById("sky"); let skyStars = [];
function drawSky(time) {
  const { x, w, h } = fit(sky);
  if (skyStars.length === 0 || skyStars.w !== w) { skyStars = Array.from({ length: Math.round(w * h / 2600) }, () => ({ x: Math.random() * w, y: Math.random() * h, r: Math.random() * 1.6 + .3, p: Math.random() * 6 })); skyStars.w = w; }
  const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, APP.sky[0]); g.addColorStop(.6, APP.sky[1]); g.addColorStop(1, APP.sky[2]); x.fillStyle = g; x.fillRect(0, 0, w, h);
  for (const s of skyStars) { x.globalAlpha = RM ? .8 : .45 + .45 * Math.sin(time / 900 + s.p); x.fillStyle = "#fff4c2"; x.beginPath(); x.arc(s.x, s.y, s.r, 0, 7); x.fill(); }
  x.globalAlpha = 1;
}
function startSky() { (function skyLoop(time) { drawSky(time || 0); if (!RM) requestAnimationFrame(skyLoop); })(); window.addEventListener("resize", () => { skyStars = []; if (RM) drawSky(0); }); }

/* confetti burst from a point (or the middle of an element) */
const fx = document.getElementById("fx"); let parts = [], fxOn = false;
function burst(at, n) {
  if (RM) return;
  let px = innerWidth / 2, py = innerHeight / 2;
  if (at && at.getBoundingClientRect) { const b = at.getBoundingClientRect(); px = b.left + b.width / 2; py = b.top + b.height / 2; }
  const cols = ["#ffd23f", "#6ff0c4", "#ff7ab8", "#8fd6ff", "#fff4c2"];
  for (let i = 0; i < (n || 26); i++) { const a = Math.random() * 7, v = 3 + Math.random() * 6; parts.push({ x: px, y: py, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 3, life: 1, r: 4 + Math.random() * 6, c: pick(cols), s: Math.random() < .5 }); }
  if (!fxOn) { fxOn = true; requestAnimationFrame(fxLoop); }
}
function fxLoop() {
  const { x, w, h } = fit(fx); x.clearRect(0, 0, w, h);
  parts = parts.filter(p => p.life > 0);
  for (const p of parts) { p.x += p.vx; p.y += p.vy; p.vy += .25; p.life -= .02; x.globalAlpha = Math.max(0, p.life); if (p.s) star(x, p.x, p.y, p.r, p.c, p.c); else { x.fillStyle = p.c; x.beginPath(); x.arc(p.x, p.y, p.r * .6, 0, 7); x.fill(); } }
  x.globalAlpha = 1;
  if (parts.length) requestAnimationFrame(fxLoop); else { fxOn = false; x.clearRect(0, 0, w, h); }
}

/* ================= shell ================= */
const stage = document.getElementById("stage"), backBtn = document.getElementById("back"), titleEl = document.getElementById("title"), langBtn = document.getElementById("lang");
let screen = { name: "home" }, cleanup = [];
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function button(cls, text, onClick) { const b = el("button", cls, text); b.type = "button"; b.onclick = onClick; return b; }
function onCleanup(f) { cleanup.push(f); }
function later(f, ms) { const id = setTimeout(f, ms); onCleanup(() => clearTimeout(id)); return id; }
function setLang(l) {
  lang = l; store.set("lang", l); document.documentElement.lang = l; document.documentElement.dir = l === "ar" ? "rtl" : "ltr";
  loadProgress();
  const n = screen.name === "level" && !unlocked(screen.arg) ? "map" : screen.name;
  go(n, n === screen.name ? screen.arg : undefined);
}
function go(name, arg) {
  cleanup.forEach(f => { try { f(); } catch (e) {} }); cleanup = [];
  try { speechSynthesis.cancel(); } catch (e) {}
  const parents = Object.assign({ level: "map", freegame: "free" }, APP.parents || {});
  screen = { name, arg, parent: parents[name] || "home" };
  try { const hsh = name === "home" || name === "freegame" ? "" : name === "level" ? "level-" + (arg + 1) : name; if (location.hash.slice(1) !== hsh) history.replaceState(null, "", hsh ? "#" + hsh : location.pathname + location.search); } catch (e) {}
  stage.innerHTML = ""; backBtn.hidden = name === "home"; backBtn.setAttribute("aria-label", t("back"));
  langBtn.textContent = t("langBtn"); langBtn.setAttribute("aria-label", t("langName"));
  const screens = Object.assign({ home, map, free, level: playLevel, freegame: playFree }, APP.screens || {});
  (screens[name] || home)(arg);
}
function helper(text, speak) {
  const h = el("div", "helper"); const cv = el("canvas"); h.appendChild(cv);
  const b = el("div", "bubble", text); h.appendChild(b);
  let raf = 0, t0 = performance.now(), spoken = text;
  (function loop(now) { const f = fit(cv); f.x.clearRect(0, 0, f.w, f.h); const bob = RM ? 0 : Math.sin((now - t0) / 500) * 2; nova(f.x, f.w / 2, f.h / 2 + bob, Math.min(f.w, f.h) * .38, !RM && (now % 3200) < 140); raf = requestAnimationFrame(loop); })(t0);
  onCleanup(() => cancelAnimationFrame(raf));
  h.onclick = () => say(spoken);
  if (speak !== false) later(() => say(text), 250);
  return { el: h, set(txt, sp, voice) { b.textContent = txt; spoken = voice || txt; if (sp !== false) say(spoken); } };
}
function toast(text, ms) { const e = el("div", "toast", text); e.setAttribute("role", "status"); stage.appendChild(e); setTimeout(() => e.remove(), ms || 1600); }
function nextFact() { const all = APP.facts[lang]; const f = all[factSeen % all.length]; factSeen++; store.set("factSeen", factSeen); return f; }

/* ================= home, map, free play ================= */
function home() {
  titleEl.textContent = t("title");
  const s = el("section", "screen");
  s.appendChild(helper(t("homeHint")).el);
  const sc = el("div", "scroll"); const tiles = el("div", "tiles");
  const L = levels(), doneCount = Object.keys(prog).length;
  const hero = button("tile hero", null, () => { sfx.pop(); go("map"); });
  hero.appendChild(emo(APP.heroIcon, 74)); const hl = el("span"); hl.appendChild(el("div", null, t("journey"))); hl.appendChild(el("small", null, num(doneCount) + " / " + num(L.length) + " · " + num(totalStars()) + " ★")); hero.appendChild(hl);
  tiles.appendChild(hero);
  const fr = button("tile c2", null, () => { sfx.pop(); say(t("free")); go("free"); }); fr.appendChild(emo(APP.freeIcon)); fr.appendChild(el("span", null, t("free"))); tiles.appendChild(fr);
  (APP.homeTiles || []).forEach(([k, c, ic]) => { const b = button("tile " + c, null, () => { sfx.pop(); say(t(k)); go(k); }); b.appendChild(emo(ic)); b.appendChild(el("span", null, t(k))); tiles.appendChild(b); });
  const rk = button("tile c4", null, () => say(t("rank" + rankOf(totalStars())))); rk.appendChild(emo(APP.rankIcons[rankOf(totalStars())])); rk.appendChild(el("span", null, t("rank" + rankOf(totalStars())))); tiles.appendChild(rk);
  sc.appendChild(tiles);
  const par = el("p", "parent"); let armed = false;
  const rb = button(null, t("reset"), () => { if (!armed) { armed = true; rb.textContent = t("resetSure"); later(() => { armed = false; rb.textContent = t("reset"); }, 4000); return; } prog = {}; factSeen = 0; store.set(progKey(), {}); store.set("factSeen", 0); if (APP.onReset) APP.onReset(); go("home"); });
  par.appendChild(rb); sc.appendChild(par);
  s.appendChild(sc); stage.appendChild(s);
}
function map() {
  titleEl.textContent = t("journey");
  const L = levels();
  const s = el("section", "screen"); s.appendChild(helper(t("mapHint")).el);
  const sc = el("div", "scroll"); const m = el("div", "map");
  const rank = el("div", "rank"); rank.appendChild(starCanvas(28, true)); rank.appendChild(el("span", null, num(totalStars()) + " / " + num(L.length * 3) + " · " + t("rank" + rankOf(totalStars())))); m.appendChild(rank);
  const firstOpen = L.findIndex((_, i) => !prog[i] && unlocked(i));
  APP.worlds.forEach(([wk, ic, a, b, tint]) => {
    const wd = el("div", "world"); wd.style.background = tint;
    const h2 = el("h2"); h2.appendChild(emo(ic, 36)); h2.appendChild(el("span", null, t(wk))); wd.appendChild(h2);
    const g = el("div", "lvls");
    for (let i = a; i < Math.min(b, L.length); i++) {
      const open = unlocked(i), lv = button("lvl" + (i === firstOpen ? " next" : "") + (L[i].boss ? " boss" : ""), null, () => { if (!open) return; sfx.pop(); go("level", i); });
      lv.disabled = !open; lv.setAttribute("aria-label", t("level") + " " + (i + 1));
      lv.appendChild(el("span", null, L[i].boss ? "👾" : num(i + 1)));
      const st = el("div", "st"); for (let k = 0; k < 3; k++) st.appendChild(starCanvas(20, (prog[i] || 0) > k)); lv.appendChild(st);
      lv.appendChild(el("small", null, L[i].label || APP.gameName(L[i].g)));
      g.appendChild(lv);
    }
    wd.appendChild(g); m.appendChild(wd);
  });
  sc.appendChild(m); s.appendChild(sc); stage.appendChild(s);
  if (firstOpen >= 0) requestAnimationFrame(() => { const n = s.querySelector(".lvl.next"); if (n && n.scrollIntoView) n.scrollIntoView({ block: "center" }); });
}
function free() {
  titleEl.textContent = t("free");
  const s = el("section", "screen"); s.appendChild(helper(t("freeHint")).el);
  const sc = el("div", "scroll"); const tiles = el("div", "tiles");
  APP.free().forEach(([k, c, ic], i) => { const b = button("tile c" + c, null, () => { sfx.pop(); say(APP.gameName(k)); go("freegame", i); }); b.appendChild(emo(ic)); b.appendChild(el("span", null, APP.gameName(k))); tiles.appendChild(b); });
  sc.appendChild(tiles); s.appendChild(sc); stage.appendChild(s);
}

/* ================= playing ================= */
function playLevel(i) {
  const L = levels(), cfg = L[i];
  if (!cfg || !unlocked(i)) return go("map");
  titleEl.textContent = (cfg.boss ? t("boss") + " · " : "") + t("level") + " " + num(i + 1);
  const s = el("section", "screen"); stage.appendChild(s);
  GAMES[cfg.g](s, cfg, starsWon => finishLevel(s, i, starsWon));
}
function finishLevel(s, i, starsWon) {
  const L = levels(), beforeRank = rankOf(totalStars());
  prog[i] = Math.max(prog[i] || 0, starsWon); store.set(progKey(), prog);
  const afterRank = rankOf(totalStars());
  if (APP.onLevelDone) APP.onLevelDone(i, starsWon);
  later(() => {
    sfx.yay(); burst(null, 60);
    const d = el("div", "done");
    d.appendChild(el("h2", null, i === L.length - 1 ? t("allDone") : t("levelDone")));
    const st = el("div", "stars"); for (let k = 0; k < 3; k++) st.appendChild(starCanvas(72, k < starsWon)); d.appendChild(st);
    const ftext = nextFact(); const f = el("button", "fact"); f.type = "button"; f.style.border = "0"; f.style.color = "inherit"; f.style.font = "inherit"; f.style.fontWeight = "700";
    f.appendChild(el("b", null, t("didYouKnow"))); f.appendChild(el("span", null, ftext)); d.appendChild(f);
    const r = el("div", "row");
    if (i < L.length - 1) r.appendChild(button("big", t("next"), () => go("level", i + 1)));
    r.appendChild(button("big alt", t("toMap"), () => go("map")));
    d.appendChild(r); s.appendChild(d);
    let line = t("levelDone") + " " + t("didYouKnow") + " " + ftext;
    if (afterRank > beforeRank) { line = t("rankUp") + " " + t("rank" + afterRank) + ". " + line; later(() => toast(t("rankUp") + " " + t("rank" + afterRank), 2600), 600); }
    say(line);
    f.onclick = () => say(ftext);
  }, 900);
}
function playFree(i) {
  const list = APP.free(), item = list[i];
  if (!item) return go("free");
  const [g, , , cfg] = item;
  titleEl.textContent = APP.gameName(g);
  const s = el("section", "screen"); stage.appendChild(s);
  GAMES[g](s, Object.assign({}, cfg), () => {
    sfx.yay(); burst(null, 50);
    later(() => { const r = el("div", "row"); r.appendChild(button("big", t("again"), () => go("freegame", i))); r.appendChild(button("big alt", t("free"), () => go("free"))); s.appendChild(r); }, 900);
  });
}

/* Rounds engine. make(area, index, api) builds one round and calls api.right(el) or api.wrong(el).
   Stars: no mistakes 3, one or two 2, more 1. A boss with cfg.timer must also beat the comet for 3. */
function rounds(s, cfg, done, hint, make) {
  const intro = cfg.boss && cfg.timer ? " " + t("beatComet") : "";
  const help = helper(hint + intro, false); s.appendChild(help.el);
  let said = false;
  const n = cfg.rounds || 5;
  const dots = el("div", "dots"); const dl = []; for (let k = 0; k < n; k++) { const d = el("i"); dots.appendChild(d); dl.push(d); } s.appendChild(dots);
  let bar = null; if (cfg.timer) { const tm = el("div", "timer"); bar = el("div"); tm.appendChild(bar); s.appendChild(tm); }
  const area = el("div", "round-area"); s.appendChild(area);
  let i = 0, miss = 0, streak = 0, locked = false, finished = false, t0 = 0, raf = 0, late = false;
  if (cfg.timer) {
    (function tick(now) { if (!t0) t0 = now; const left = Math.max(0, 1 - (now - t0) / (cfg.timer * 1000)); bar.style.transform = "scaleX(" + left + ")"; if (left <= 0) late = true; if (!finished && left > 0) raf = requestAnimationFrame(tick); })(performance.now());
    onCleanup(() => cancelAnimationFrame(raf));
  }
  const api = {
    help, area,
    say(txt, voice) { said = true; help.set(txt, false, voice); const v = (voice || txt) + (i === 0 ? intro : ""); later(() => say(v), 250); },
    right(at, quiet) {
      if (locked || finished) return; locked = true; streak++;
      sfx.ding(); burst(at);
      dl[i].className = "on";
      if (streak >= 3 && streak % 3 === 0) { later(() => { sfx.combo(); toast("🔥 " + t("combo")(streak)); }, 250); }
      if (!quiet) say(pick(t("praise")));
      i++;
      later(() => { locked = false; step(); }, 1100);
    },
    wrong(at) {
      if (locked || finished) return; miss++; streak = 0; sfx.bonk();
      if (at) { at.classList.remove("shake"); void at.offsetWidth; at.classList.add("shake"); }
      say(pick(t("retry")));
    },
    miss() { miss++; streak = 0; },
    get locked() { return locked; },
  };
  function step() {
    if (i >= n) {
      finished = true;
      let st = miss === 0 ? 3 : miss <= 2 ? 2 : 1;
      if (cfg.timer && late) st = Math.min(st, 2);
      if (cfg.timer && !late && miss <= 2) later(() => toast("☄️ " + t("fast")), 200);
      return done(st);
    }
    dl.forEach((d, k) => d.className = k < i ? "on" : k === i ? "now" : "");
    area.innerHTML = "";
    make(area, i, api);
  }
  step();
  if (!said) later(() => say(hint + intro), 250);
  return api;
}
/* answer buttons: items are values; render(value) returns a label node or text; correct(value) says if it is right */
function answers(parent, items, correct, api, render, cols) {
  const row = el("div", "ans"); row.style.setProperty("--n", cols || items.length);
  items.forEach(v => {
    const b = button("choice", null, () => { if (api.locked || b.classList.contains("no")) return; if (correct(v)) { b.classList.add("ok"); api.right(b); } else { b.classList.add("no"); api.wrong(b); } });
    const r = render ? render(v) : num(v); if (typeof r === "string") b.textContent = r; else b.appendChild(r);
    row.appendChild(b);
  });
  parent.appendChild(row); return row;
}

/* ================= start ================= */
function boot() {
  lang = store.get("lang", (navigator.language || "").toLowerCase().startsWith("ar") ? "ar" : "en");
  document.documentElement.lang = lang; document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  loadProgress();
  langBtn.onclick = () => setLang(lang === "ar" ? "en" : "ar");
  backBtn.onclick = () => go(screen.parent || "home");
  startSky();
  const names = ["map", "free"].concat(Object.keys(APP.screens || {}));
  function fromHash() { const h = location.hash.slice(1); const m = h.match(/^level-(\d+)$/); if (m) { const i = +m[1] - 1; if (i >= 0 && i < levels().length && unlocked(i)) return go("level", i); } go(names.includes(h) ? h : "home"); }
  fromHash();
  window.addEventListener("hashchange", () => { const h = location.hash.slice(1), cur = screen.name === "level" ? "level-" + (screen.arg + 1) : screen.name === "home" ? "" : screen.name; if (h !== cur) fromHash(); });
  try { speechSynthesis.getVoices(); } catch (e) {}
}
