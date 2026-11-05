/* Letter Planets: the alphabet of the chosen language, four letters at a time.
   Each group: meet the letters, trace them, pop the bubbles, match pictures. Two spelling bosses. 30 levels. */

const ALPHA = {
  en: [
    ["A", "ay", "apple", "🍎"], ["B", "bee", "banana", "🍌"], ["C", "see", "cat", "🐱"], ["D", "dee", "dog", "🐶"],
    ["E", "ee", "egg", "🥚"], ["F", "ef", "fish", "🐟"], ["G", "jee", "grapes", "🍇"], ["H", "aych", "hat", "🎩"],
    ["I", "eye", "ice cream", "🍦"], ["J", "jay", "juice", "🧃"], ["K", "kay", "kite", "🪁"], ["L", "el", "lion", "🦁"],
    ["M", "em", "moon", "🌙"], ["N", "en", "nose", "👃"], ["O", "oh", "orange", "🍊"], ["P", "pee", "pig", "🐷"],
    ["Q", "cue", "queen", "👸"], ["R", "ar", "rocket", "🚀"], ["S", "ess", "sun", "☀️"], ["T", "tee", "tree", "🌳"],
    ["U", "you", "umbrella", "☂️"], ["V", "vee", "violin", "🎻"], ["W", "double-you", "whale", "🐋"], ["X", "ex", "fox", "🦊", true],
    ["Y", "why", "yo-yo", "🪀"], ["Z", "zee", "zebra", "🦓"],
  ],
  ar: [
    ["أ", "ألف", "أرنب", "🐰"], ["ب", "باء", "بطة", "🦆"], ["ت", "تاء", "تفاحة", "🍎"], ["ث", "ثاء", "ثعلب", "🦊"],
    ["ج", "جيم", "جمل", "🐫"], ["ح", "حاء", "حصان", "🐴"], ["خ", "خاء", "خروف", "🐑"], ["د", "دال", "دب", "🐻"],
    ["ذ", "ذال", "ذرة", "🌽"], ["ر", "راء", "روبوت", "🤖"], ["ز", "زاي", "زرافة", "🦒"], ["س", "سين", "سمكة", "🐟"],
    ["ش", "شين", "شمس", "☀️"], ["ص", "صاد", "صاروخ", "🚀"], ["ض", "ضاد", "ضفدع", "🐸"], ["ط", "طاء", "طائرة", "✈️"],
    ["ظ", "ظاء", "ظرف", "✉️"], ["ع", "عين", "عنب", "🍇"], ["غ", "غين", "غيمة", "☁️"], ["ف", "فاء", "فيل", "🐘"],
    ["ق", "قاف", "قطة", "🐱"], ["ك", "كاف", "كلب", "🐶"], ["ل", "لام", "ليمون", "🍋"], ["م", "ميم", "موز", "🍌"],
    ["ن", "نون", "نحلة", "🐝"], ["ه", "هاء", "هلال", "🌙"], ["و", "واو", "وردة", "🌹"], ["ي", "ياء", "يد", "✋"],
  ],
};
const EXTRA_NAMES = { "ة": "تاء مربوطة" };
const WORDS = {
  en: [["CAT", "🐱"], ["DOG", "🐶"], ["SUN", "☀️"], ["BUS", "🚌"], ["CUP", "🥤"], ["HAT", "🎩"], ["PIG", "🐷"], ["BED", "🛏️"], ["FOX", "🦊"], ["BEE", "🐝"], ["EGG", "🥚"], ["OWL", "🦉"], ["ANT", "🐜"], ["BAT", "🦇"], ["COW", "🐮"]],
  ar: [["قطة", "🐱"], ["كلب", "🐶"], ["شمس", "☀️"], ["بيت", "🏠"], ["سمك", "🐟"], ["فيل", "🐘"], ["موز", "🍌"], ["باب", "🚪"], ["قمر", "🌙"], ["ورد", "🌹"], ["جمل", "🐫"], ["عنب", "🍇"]],
};
const SPOKEN_WORD = { en: { CAT: "cat", DOG: "dog", SUN: "sun", BUS: "bus", CUP: "cup", HAT: "hat", PIG: "pig", BED: "bed", FOX: "fox", BEE: "bee", EGG: "egg", OWL: "owl", ANT: "ant", BAT: "bat", COW: "cow" }, ar: {} };
const L_ = r => ({ ch: r[0], name: r[1], word: r[2], pic: r[3], end: !!r[4] });
const letterName = ch => { const r = ALPHA[lang].find(a => a[0] === ch); return r ? r[1] : EXTRA_NAMES[ch] || ch; };
const showCh = ch => lang === "en" ? ch + " " + ch.toLowerCase() : ch;

const APP = {
  key: "lp", heroIcon: "🪐", freeIcon: "🎈", rankIcons: ["🧑‍🚀", "📖", "🌟", "👑"], progressPerLanguage: true,
  sky: ["#0b1033", "#1d1250", "#3a0f45"],
  W: {
    en: {
      title: "Letter Planets", homeHint: "Hi! I'm Nova. Let's visit the letter planets!", freeHint: "Pick any game. Play as much as you like!",
      alphabet: "My letters", alphabetHint: "Tap a letter to hear it. Bright letters are the ones you have met!",
      w1: "Planet A to L", w2: "Planet M to X", w3: "Planet Y and Z",
      rank0: "Letter Cadet", rank1: "Letter Pilot", rank2: "Letter Captain", rank3: "Letter Commander",
      gMeet: "Meet", gTrace: "Trace", gPop: "Pop", gMatch: "Match", gSpell: "Spell",
      meetSay: l => "This is " + l.ch + ". " + l.ch + (l.end ? " is in " : " is for ") + l.word + "!",
      meetVoice: l => "This is " + l.name + ". " + l.name + (l.end ? ", is in " : ", is for ") + l.word + "!",
      find: l => "Find " + l.ch + "!", findVoice: l => "Find " + l.name + "!",
      traceHint: l => "Trace " + l.ch + " with your finger!", traceVoice: l => "Trace " + l.name + " with your finger!", inside: "Stay inside the letter!", clear: "Clear",
      popHint: l => "Pop every " + l.ch + "!", popVoice: l => "Pop every " + l.name + "!",
      startsWith: l => "Which letter does " + l.word + " start with?", picFor: l => (l.end ? "Which one has " : "Which one starts with ") + l.ch + "?", picVoice: l => (l.end ? "Which one has " : "Which one starts with ") + l.name + "?",
      spellHint: "Spell the word! Tap the letters in order.", spellWord: w => "Spell " + w + "!",
    },
    ar: {
      title: "كواكب الحروف", homeHint: "مرحبًا! أنا نوفا. هيا نزور كواكب الحروف!", freeHint: "اختر أي لعبة والعب كما تحب!",
      alphabet: "حروفي", alphabetHint: "اضغط على حرف لتسمعه. الحروف المضيئة هي التي تعرفت عليها!",
      w1: "كوكب أ إلى س", w2: "كوكب ش إلى م", w3: "كوكب ن إلى ي",
      rank0: "متدرب الحروف", rank1: "طيار الحروف", rank2: "قبطان الحروف", rank3: "قائد الحروف",
      gMeet: "تعرّف", gTrace: "اكتب", gPop: "فرقع", gMatch: "طابق", gSpell: "تهجَّ",
      meetSay: l => "هذا حرف " + l.ch + ". " + l.ch + " مثل " + l.word + "!",
      meetVoice: l => "هذا حرف " + l.name + ". " + l.name + "، مثل " + l.word + "!",
      find: l => "أين حرف " + l.ch + "؟", findVoice: l => "أين حرف " + l.name + "؟",
      traceHint: l => "اكتب حرف " + l.ch + " بإصبعك!", traceVoice: l => "اكتب حرف " + l.name + " بإصبعك!", inside: "ابقَ داخل الحرف!", clear: "امسح",
      popHint: l => "فرقع كل حرف " + l.ch + "!", popVoice: l => "فرقع كل حرف " + l.name + "!",
      startsWith: l => "بأي حرف تبدأ كلمة " + l.word + "؟", picFor: l => "ما الذي يبدأ بحرف " + l.ch + "؟", picVoice: l => "ما الذي يبدأ بحرف " + l.name + "؟",
      spellHint: "تهجَّ الكلمة! اضغط على الحروف بالترتيب.", spellWord: w => "اكتب كلمة " + w + "!",
    },
  },
  facts: {
    en: [
      "A banana is a kind of berry!", "Cats sleep for about 12 to 16 hours a day.", "A giraffe's tongue is about as long as your arm.",
      "Blue whales are the biggest animals that ever lived.", "Owls can turn their heads very far around.", "Every zebra has its own stripe pattern.",
      "Camels store fat in their humps, not water.", "A group of lions is called a pride.", "Dogs can smell thousands of times better than people.",
      "Ants can carry things much heavier than themselves.", "Horses can sleep standing up.", "Ducks have feathers that keep the water out.",
      "Bees visit flowers to make honey.", "A fox wraps its bushy tail around itself like a warm blanket.", "The Moon has no air, so astronauts wear space suits.",
      "Grapes grow in bunches on vines.", "Elephants use their trunks to drink, smell and even say hello.", "Frogs can drink water through their skin.",
      "The English alphabet has 26 letters.", "The Arabic alphabet has 28 letters.",
    ],
    ar: [
      "الموز نوع من التوت!", "تنام القطط من ١٢ إلى ١٦ ساعة في اليوم.", "لسان الزرافة طويل مثل ذراعك تقريبًا.",
      "الحوت الأزرق أكبر حيوان عاش على الأرض.", "تستطيع البومة أن تدير رأسها بعيدًا جدًا.", "لكل حمار وحشي خطوط تختلف عن غيره.",
      "يخزّن الجمل الدهون في سنامه، لا الماء.", "مجموعة الأسود تُسمّى زمرة.", "يشمّ الكلب أفضل من الإنسان آلاف المرات.",
      "يستطيع النمل حمل أشياء أثقل منه بكثير.", "تستطيع الخيول أن تنام وهي واقفة.", "ريش البط لا يدخله الماء.",
      "يزور النحل الأزهار ليصنع العسل.", "يلفّ الثعلب ذيله حول جسمه مثل بطانية دافئة.", "لا يوجد هواء على القمر، لذلك يلبس الرواد بدلات الفضاء.",
      "ينمو العنب في عناقيد على الكرمة.", "يستخدم الفيل خرطومه ليشرب ويشمّ ويُسلّم أيضًا.", "تشرب الضفادع الماء من جلدها.",
      "في الأبجدية العربية ٢٨ حرفًا.", "في الأبجدية الإنجليزية ٢٦ حرفًا.",
    ],
  },
  gameName: g => t({ meet: "gMeet", trace: "gTrace", pop: "gPop", match: "gMatch", spell: "gSpell" }[g]),
  homeTiles: [["alphabet", "c5", "🔤"]],
  screens: { alphabet },
  worlds: [["w1", "🪐", 0, 13, "#1d2a5e"], ["w2", "🌍", 13, 25, "#3a1f55"], ["w3", "🌟", 25, 30, "#4a2a1f"]],
  levels: buildLevels,
  free: () => {
    const all = ALPHA[lang].map(L_);
    return [
      ["meet", 1, "👋", { letters: shuffle(all).slice(0, 4), pool: all }], ["trace", 2, "✍️", { letters: shuffle(all).slice(0, 3), cover: .55 }],
      ["pop", 3, "🫧", { letters: shuffle(all).slice(0, 3), pool: all }], ["match", 5, "🧩", { letters: shuffle(all).slice(0, 5), pool: all }],
      ["spell", 6, "🔠", { rounds: 4 }],
    ];
  },
};

let LV = null, LVlang = null;
function buildLevels() {
  if (LV && LVlang === lang) return LV;
  const all = ALPHA[lang].map(L_), L = [];
  for (let g = 0; g * 4 < all.length; g++) {
    const grp = all.slice(g * 4, g * 4 + 4), seen = all.slice(0, g * 4 + 4), label = grp.map(l => l.ch).join(" ");
    L.push({ g: "meet", letters: grp, pool: seen, label: "👋 " + label, rounds: 4 });
    L.push({ g: "trace", letters: grp, label: "✍️ " + label, cover: Math.min(.65, .55 + g * .02), rounds: Math.min(4, grp.length * 2) });
    L.push({ g: "pop", letters: grp, pool: seen, label: "🫧 " + label, rounds: 3, targets: 3 + Math.min(2, Math.floor(g / 2)), bubbles: 8 + Math.min(4, g) });
    L.push({ g: "match", letters: grp, pool: seen, label: "🧩 " + label, rounds: 5, k: g < 2 ? 3 : 4 });
    if (g === 2) L.push({ g: "spell", boss: true, rounds: 4, label: t("gSpell") });
  }
  L.push({ g: "spell", boss: true, rounds: 5, extra: 1, timer: 150, label: t("gSpell") });
  LV = L; LVlang = lang; return L;
}
const others = (pool, l, k) => shuffle(pool.filter(o => o.ch !== l.ch)).slice(0, k);

const GAMES = {};

/* ---- meet: big letter, picture and word, then find it ---- */
GAMES.meet = function (s, cfg, done) {
  const seq = Array.from({ length: cfg.rounds || 4 }, (_, k) => cfg.letters[k % cfg.letters.length]);
  rounds(s, cfg, done, t("meetSay")(seq[0]), (area, r, api) => {
    const l = seq[r];
    api.say(t("meetSay")(l), t("meetVoice")(l));
    const qa = el("div", "qa");
    const card = button("tile", null, () => { say(t("meetVoice")(l)); burst(card, 10); });
    card.style.cssText = "padding:8px 22px;background:rgba(11,16,51,.5)";
    const big = el("div", "huge", showCh(l.ch)); big.style.fontSize = "clamp(80px, 26vw, 150px)"; card.appendChild(big);
    const row = el("div", "row"); row.style.alignItems = "center"; row.appendChild(el("span", "pic", l.pic)); row.lastChild.style.fontSize = "clamp(48px, 14vw, 80px)"; row.appendChild(el("span", "word", l.word)); card.appendChild(row);
    qa.appendChild(card); area.appendChild(qa);
    later(() => {
      api.help.set(t("find")(l), false, t("findVoice")(l));
      let live = true;
      later(() => { if (live) say(t("findVoice")(l)); }, 2600);
      const opts = shuffle([l].concat(others(cfg.pool.length > 1 ? cfg.pool : ALPHA[lang].map(L_), l, 2)));
      answers(area, opts, o => o.ch === l.ch, { get locked() { return api.locked; }, right(b) { live = false; api.right(b); }, wrong: api.wrong }, o => o.ch);
    }, 300);
  });
};

/* ---- trace: draw over the letter; checked against a mask of the glyph ---- */
function glyphFont(px) { return "800 " + px + "px " + (lang === "ar" ? '"Baloo Bhaijaan 2", Tahoma, sans-serif' : '"Baloo 2", "Trebuchet MS", sans-serif'); }
function placeGlyph(x, ch, w, h, frac) {
  x.font = glyphFont(100); x.textAlign = "left"; x.textBaseline = "alphabetic";
  let m = x.measureText(ch); const bw = m.actualBoundingBoxLeft + m.actualBoundingBoxRight, bh = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  const px = Math.max(20, Math.floor(100 * Math.min(w * frac / (bw || 60), h * frac / (bh || 70))));
  x.font = glyphFont(px); m = x.measureText(ch);
  return { px, gx: w / 2 + (m.actualBoundingBoxLeft - m.actualBoundingBoxRight) / 2, gy: h / 2 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2 };
}
GAMES.trace = function (s, cfg, done) {
  const seq = Array.from({ length: cfg.rounds || 4 }, (_, k) => cfg.letters[k % cfg.letters.length]);
  rounds(s, cfg, done, t("traceHint")(seq[0]), (area, r, api) => {
    const l = seq[r];
    api.say(t("traceHint")(l), t("traceVoice")(l));
    const box = el("div", "tracebox"), cv = el("canvas"); box.appendChild(cv); area.appendChild(box);
    const tools = el("div", "row"); const clr = button("big alt", "🧽 " + t("clear"), () => { if (!api.locked) { reset(); sfx.pop(); } }); tools.appendChild(clr); area.appendChild(tools);
    const SC = 4;   // the check runs on a grid 4 times coarser than the screen
    let G = null, mask = null, wide = null, maskN = 0, ink = null, inkX = null, drawing = false, lastP = null, strokes = 0, warned = false, won = false;
    function setup() {
      const { x, w, h } = fit(cv); if (!w || !h) return;
      G = placeGlyph(x, l.ch, w, h, .78);
      const mw = Math.ceil(w / SC), mh = Math.ceil(h / SC);
      const off = document.createElement("canvas"); off.width = mw; off.height = mh; const ox = off.getContext("2d");
      ox.scale(1 / SC, 1 / SC); ox.font = glyphFont(G.px); ox.textBaseline = "alphabetic"; ox.textAlign = "left"; ox.fillStyle = "#000"; ox.fillText(l.ch, G.gx, G.gy);
      const core = ox.getImageData(0, 0, mw, mh).data;
      ox.lineWidth = G.px * .22; ox.lineJoin = "round"; ox.strokeStyle = "#000"; ox.strokeText(l.ch, G.gx, G.gy);
      const fat = ox.getImageData(0, 0, mw, mh).data;
      mask = new Uint8Array(mw * mh); wide = new Uint8Array(mw * mh); maskN = 0;
      for (let k = 0; k < mw * mh; k++) { if (core[k * 4 + 3] > 100) { mask[k] = 1; maskN++; } if (fat[k * 4 + 3] > 40) wide[k] = 1; }
      inkX = document.createElement("canvas"); inkX.width = mw; inkX.height = mh; ink = inkX.getContext("2d"); ink.scale(1 / SC, 1 / SC);
      ink.lineCap = "round"; ink.lineJoin = "round"; ink.strokeStyle = "#000"; ink.lineWidth = G.px * .16;
      inkX.mw = mw; inkX.mh = mh;
      paint();
    }
    let trail = [];
    function paint(gold) {
      const { x, w, h } = fit(cv); x.clearRect(0, 0, w, h);
      x.font = glyphFont(G.px); x.textAlign = "left"; x.textBaseline = "alphabetic";
      x.fillStyle = gold ? "#ffd23f" : "rgba(255,244,194,.16)"; x.fillText(l.ch, G.gx, G.gy);
      if (!gold) { x.setLineDash([10, 10]); x.lineWidth = 3; x.strokeStyle = "rgba(255,244,194,.7)"; x.strokeText(l.ch, G.gx, G.gy); x.setLineDash([]); }
      x.lineCap = "round"; x.lineJoin = "round"; x.lineWidth = G.px * .16; x.strokeStyle = gold ? "rgba(255,255,255,.0)" : "#6ff0c4";
      for (const st of trail) { x.beginPath(); st.forEach((p, k) => k ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1])); if (st.length === 1) x.lineTo(st[0][0] + .1, st[0][1]); x.stroke(); }
    }
    function reset() { trail = []; strokes = 0; if (ink) ink.clearRect(0, 0, inkX.width * SC, inkX.height * SC); if (G) paint(); }
    const P = e => { const b = cv.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
    cv.addEventListener("pointerdown", e => { if (api.locked || won || !G) return; e.preventDefault(); try { cv.setPointerCapture(e.pointerId); } catch (_) {} drawing = true; lastP = P(e); trail.push([lastP]); ink.beginPath(); ink.moveTo(lastP[0], lastP[1]); ink.lineTo(lastP[0] + .1, lastP[1]); ink.stroke(); paint(); });
    cv.addEventListener("pointermove", e => { if (!drawing) return; const p = P(e); trail[trail.length - 1].push(p); ink.beginPath(); ink.moveTo(lastP[0], lastP[1]); ink.lineTo(p[0], p[1]); ink.stroke(); lastP = p; paint(); });
    const up = () => { if (!drawing) return; drawing = false; strokes++; check(); };
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
    function check() {
      const d = ink.getImageData(0, 0, inkX.mw, inkX.mh).data; let cov = 0, inkN = 0, inside = 0;
      for (let k = 0; k < mask.length; k++) { if (d[k * 4 + 3] > 60) { inkN++; if (wide[k]) inside++; if (mask[k]) cov++; } }
      const coverage = maskN ? cov / maskN : 0, accuracy = inkN ? inside / inkN : 0;
      // pass: enough of the letter covered, most ink on the letter, and not far more ink than letter (a scribble over everything fails)
      if (coverage >= cfg.cover && accuracy >= .6 && inkN <= maskN * 2.2) { won = true; paint(true); sfx.yay(); api.right(box, true); say(t("meetVoice")(l)); return; }
      if (inkN > maskN * 2.2 || (inkN > maskN * .9 && accuracy < .5)) { if (!warned) { warned = true; api.wrong(box); } api.say(t("inside")); later(reset, 600); }
    }
    const ro = new ResizeObserver(() => { if (!won) { trail = []; setup(); } }); ro.observe(box); onCleanup(() => ro.disconnect());
    const ready = document.fonts && document.fonts.load ? document.fonts.load(glyphFont(80), l.ch).catch(() => {}) : Promise.resolve();
    ready.then(() => requestAnimationFrame(setup));
  });
};

/* ---- pop: pop every bubble with the target letter ---- */
GAMES.pop = function (s, cfg, done) {
  const seq = Array.from({ length: cfg.rounds || 3 }, (_, k) => cfg.letters[k % cfg.letters.length]);
  rounds(s, cfg, done, t("popHint")(seq[0]), (area, r, api) => {
    const l = seq[r], n = cfg.bubbles || 8, k = Math.min(cfg.targets || 3, n - 2);
    api.say(t("popHint")(l), t("popVoice")(l));
    const pool = (cfg.pool || []).filter(o => o.ch !== l.ch); const fill = pool.length ? pool : ALPHA[lang].map(L_).filter(o => o.ch !== l.ch);
    const items = shuffle(Array.from({ length: k }, () => l).concat(Array.from({ length: n - k }, () => pick(fill))));
    area.style.padding = "0";
    const box = el("div"); box.style.cssText = "position:absolute;inset:0"; area.appendChild(box);
    const cols = n > 9 ? 4 : 3, rows = Math.ceil(n / cols), cells = shuffle(Array.from({ length: cols * rows }, (_, q) => q)).slice(0, n);
    let left = k;
    items.forEach((o, q) => {
      const c = cells[q], cx = (c % cols + .5) / cols * 100, cy = (Math.floor(c / cols) + .5) / rows * 100, size = n > 9 ? 70 : 80;
      const bb = button("choice", o.ch, () => {
        if (api.locked || bb.hidden) return;
        if (o.ch === l.ch) { left--; sfx.pop(); burst(bb, 14); bb.hidden = true; say(l.name); if (left === 0) api.right(null); }
        else api.wrong(bb);
      });
      bb.style.cssText = "position:absolute;width:" + size + "px;height:" + size + "px;min-height:0;border-radius:50%;padding:0;font-size:" + (size * .48) + "px;left:calc(" + cx + "% - " + size / 2 + "px);top:calc(" + cy + "% - " + size / 2 + "px);background:radial-gradient(circle at 30% 30%, rgba(255,255,255,.45), rgba(255,122,184,.25) 40%, rgba(143,214,255,.2));box-shadow:inset 0 0 0 3px rgba(255,244,194,.6)";
      if (!RM) bb.animate([{ transform: "translateY(-5px)" }, { transform: "translateY(5px)" }], { duration: 1300 + q * 110, direction: "alternate", iterations: Infinity, easing: "ease-in-out" });
      box.appendChild(bb);
    });
  });
};

/* ---- match: picture to first letter, or letter to picture ---- */
GAMES.match = function (s, cfg, done) {
  const seq = shuffle(Array.from({ length: cfg.rounds || 5 }, (_, k) => cfg.letters[k % cfg.letters.length]));
  const pool = cfg.pool && cfg.pool.length >= 4 ? cfg.pool : ALPHA[lang].map(L_);
  rounds(s, cfg, done, t("startsWith")(seq[0]), (area, r, api) => {
    const l = seq[r], k = cfg.k || 3, qa = el("div", "qa");
    const picMode = l.end || r % 2 === 1;
    if (!picMode) {
      api.say(t("startsWith")(l));
      const p = button("tile", null, () => say(l.word)); p.style.background = "transparent"; p.style.boxShadow = "none"; p.appendChild(el("span", "pic", l.pic)); qa.appendChild(p); area.appendChild(qa);
      answers(area, shuffle([l].concat(others(pool.filter(o => o.ch !== l.ch), l, k - 1))), o => o.ch === l.ch, api, o => o.ch, k > 3 ? 2 : 3);
    } else {
      api.say(t("picFor")(l), t("picVoice")(l));
      const big = el("div", "huge", l.ch); qa.appendChild(big); area.appendChild(qa);
      const opts = shuffle([l].concat(others(pool.filter(o => o.pic !== l.pic && o.word[0] !== l.word[0]), l, k - 1)));
      const row = answers(area, opts, o => o.ch === l.ch, api, o => { const sp = el("span", null, o.pic); sp.style.fontSize = "46px"; return sp; }, k > 3 ? 2 : 3);
      row.querySelectorAll(".choice").forEach((b, q) => { const o = opts[q]; b.addEventListener("click", () => { if (o.ch !== l.ch) say(o.word); }); });
    }
  });
};

/* ---- spell boss: tap the letters of a word in order ---- */
GAMES.spell = function (s, cfg, done) {
  const words = shuffle(WORDS[lang]).slice(0, cfg.rounds || 4);
  const letters = ALPHA[lang].map(a => a[0]);
  rounds(s, cfg, done, t("spellHint"), (area, r, api) => {
    const [word, pic] = words[r], chars = Array.from(word), spoken = SPOKEN_WORD[lang][word] || word;
    api.say(t("spellWord")(spoken));
    const qa = el("div", "qa");
    const pb = button("tile", null, () => say(spoken)); pb.style.background = "transparent"; pb.style.boxShadow = "none"; pb.appendChild(el("span", "pic", pic)); qa.appendChild(pb);
    const built = el("div", "built", ""); qa.appendChild(built);
    const slots = el("div", "slots" + (lang === "ar" ? " rtl" : "")); const sl = chars.map(() => { const d = el("div", "slot"); slots.appendChild(d); return d; }); qa.appendChild(slots);
    area.appendChild(qa);
    let at = 0;
    const tiles = chars.slice(); for (let e = 0; e < (cfg.extra || 0); e++) tiles.push(pick(letters.filter(c => !chars.includes(c))));
    const row = el("div", "ans"); row.style.setProperty("--n", Math.min(4, tiles.length));
    shuffle(tiles).forEach(c => {
      const b = button("choice", c, () => {
        if (api.locked || b.classList.contains("no")) return;
        if (c === chars[at]) {
          b.classList.add("no"); b.style.opacity = ".15"; sl[at].textContent = c; sl[at].classList.add("full"); at++; built.textContent = chars.slice(0, at).join(""); sfx.tick(at); say(lang === "en" ? letterName(c) : letterName(c));
          if (at === chars.length) { later(() => say(spoken), 400); api.right(built, true); }
        } else api.wrong(b);
      });
      row.appendChild(b);
    });
    area.appendChild(row);
  });
};

/* ---- my letters ---- */
function alphabet() {
  titleEl.textContent = t("alphabet");
  const L = buildLevels(), met = new Set();
  L.forEach((lv, i) => { if (lv.g === "meet" && prog[i]) lv.letters.forEach(l => met.add(l.ch)); });
  const s = el("section", "screen"); s.appendChild(helper(t("alphabetHint")).el);
  s.appendChild(el("p", "hint", num(met.size) + " " + t("of") + " " + num(ALPHA[lang].length)));
  const sc = el("div", "scroll"); const g = el("div", "grid");
  ALPHA[lang].map(L_).forEach(l => {
    const has = met.has(l.ch), c = button("card" + (has ? "" : " no"), l.ch, () => { sfx.pop(); burst(c, 12); say(t("meetVoice")(l)); });
    c.appendChild(el("small", null, has ? l.pic + " " + l.word : "")); g.appendChild(c);
  });
  sc.appendChild(g); s.appendChild(sc); stage.appendChild(s);
}

boot();
