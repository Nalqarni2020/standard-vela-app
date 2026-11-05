/* Number Galaxy: counting, number lines, more and fewer, patterns, adding, taking away, missing numbers,
   making an amount, shapes and bubble-pop bosses. 30 levels in three worlds: 1-5, 1-10, 1-20. */

const FRIENDS = ["👽", "👾", "🤖", "🐙", "🦑", "🐲", "🦄", "🐸", "🐵", "🦖", "🐳", "🦉", "🐝", "🦋", "🐞", "🐢", "🦀", "🐬", "🦕", "🐼", "🦊", "🐯", "🐨", "🐰", "🐧", "🦜", "🐌", "🐠", "🦩", "🐉"];
const THINGS = ["⭐", "🪐", "🚀", "👽", "🌙", "🛸", "☄️", "🌟", "🛰️", "🌍"];
const PAT = [["🔴", "🔵", "🟡", "🟢"], ["⭐", "🌙", "🪐", "☄️"], ["🚀", "🛸", "👽", "🌍"], ["🟥", "🟦", "🟨", "🟩"]];

const APP = {
  key: "ng", heroIcon: "🚀", freeIcon: "🎲", rankIcons: ["🧑‍🚀", "🛸", "🌟", "👑"],
  sky: ["#0b1033", "#10234a", "#0f3d4a"],
  W: {
    en: {
      title: "Number Galaxy", homeHint: "Hi! I'm Nova. Let's play with numbers in space!", freeHint: "Pick any game. Play as much as you like!",
      friends: "Space friends", friendsHint: "Finish a level to meet a new space friend!", newFriend: "New space friend!",
      w1: "Moon Base · 1 to 5", w2: "Star Field · 1 to 10", w3: "Galaxy Core · 1 to 20",
      rank0: "Number Cadet", rank1: "Number Pilot", rank2: "Number Captain", rank3: "Number Commander",
      gCount: "Count", gLine: "Number line", gCompare: "More or less", gPattern: "Patterns", gAdd: "Add", gSub: "Take away", gMissing: "Missing number", gFeed: "Feed the alien", gShapes: "Shapes", gBubbles: "Bubble pop",
      countHint: "Tap each one to count. Then pick the number!", countAsk: "How many?",
      lineHint: n => "Fly the rocket to " + n + "!",
      more: "Which side has more?", fewer: "Which side has fewer?", bigger: "Which number is bigger?", smaller: "Which number is smaller?",
      patternHint: "What comes next?", addHint: "Put them together. How many now?", subHint: n => n + " fly away. How many are left?",
      missingHint: "Which number is missing?", feedHint: n => "The alien wants " + n + " energy. Tap to give it, then press Feed!",
      feed: "Feed!", tooMany: "Too many! Tap one in the basket to take it back.", needMore: "The alien is still hungry. Add more!",
      shapeFind: s => "Tap the " + s + "!", shapeCount: s => "How many " + s + "s?",
      bubblesHint: "Pop the bubbles in order: 1, 2, 3…", bubblesTwos: "Pop them counting by twos: 2, 4, 6…", bubblesDown: n => "Count down! Start at " + n + ".",
      shapes: { circle: "circle", square: "square", triangle: "triangle", star: "star", heart: "heart", diamond: "diamond", rectangle: "rectangle", hexagon: "hexagon" },
    },
    ar: {
      title: "مجرة الأرقام", homeHint: "مرحبًا! أنا نوفا. هيا نلعب بالأرقام في الفضاء!", freeHint: "اختر أي لعبة والعب كما تحب!",
      friends: "أصدقاء الفضاء", friendsHint: "أنهِ مرحلة لتقابل صديقًا فضائيًا جديدًا!", newFriend: "صديق فضائي جديد!",
      w1: "قاعدة القمر · ١ إلى ٥", w2: "حقل النجوم · ١ إلى ١٠", w3: "قلب المجرة · ١ إلى ٢٠",
      rank0: "متدرب الأرقام", rank1: "طيار الأرقام", rank2: "قبطان الأرقام", rank3: "قائد الأرقام",
      gCount: "العدّ", gLine: "خط الأعداد", gCompare: "أكثر أو أقل", gPattern: "الأنماط", gAdd: "الجمع", gSub: "الطرح", gMissing: "الرقم الناقص", gFeed: "أطعم الفضائي", gShapes: "الأشكال", gBubbles: "فقاعات الأرقام",
      countHint: "اضغط على كل واحد لتعدّه، ثم اختر الرقم!", countAsk: "كم عددها؟",
      lineHint: n => "طِر بالصاروخ إلى " + n + "!",
      more: "أي جهة فيها أكثر؟", fewer: "أي جهة فيها أقل؟", bigger: "أي رقم أكبر؟", smaller: "أي رقم أصغر؟",
      patternHint: "ماذا يأتي بعد ذلك؟", addHint: "اجمعها معًا. كم صار العدد؟", subHint: n => "طار " + n + ". كم بقي؟",
      missingHint: "ما الرقم الناقص؟", feedHint: n => "الفضائي يريد " + n + " طاقة. اضغط لتعطيه، ثم اضغط أطعم!",
      feed: "أطعم!", tooMany: "كثير! اضغط على واحدة في السلة لترجعها.", needMore: "الفضائي ما زال جائعًا. أضف أكثر!",
      shapeFind: s => "اضغط على " + s + "!", shapeCount: s => "كم " + s + " ترى؟",
      bubblesHint: "فرقع الفقاعات بالترتيب: ١، ٢، ٣…", bubblesTwos: "فرقعها بالعدّ اثنين اثنين: ٢، ٤، ٦…", bubblesDown: n => "عُدّ تنازليًا! ابدأ من " + n + ".",
      shapes: { circle: "الدائرة", square: "المربع", triangle: "المثلث", star: "النجمة", heart: "القلب", diamond: "المعيّن", rectangle: "المستطيل", hexagon: "الشكل السداسي" },
    },
  },
  facts: {
    en: [
      "Earth has 1 moon.", "Mars has 2 tiny moons, called Phobos and Deimos.", "There are 8 planets going around the Sun.",
      "12 astronauts have walked on the Moon.", "Sunlight takes about 8 minutes to reach Earth.", "Jupiter is so wide that 11 Earths could line up across it.",
      "Astronauts on the space station see about 16 sunrises every day.", "About a million Earths could fit inside the Sun.", "A triangle has 3 sides and 3 corners.",
      "A square has 4 sides, and they are all the same length.", "A hexagon has 6 sides. Bees build honeycombs with hexagons!", "Saturn has more than 100 moons!",
      "Neptune takes about 165 years to go once around the Sun.", "Our galaxy, the Milky Way, has more than 100 billion stars.", "Venus spins so slowly that one day there is longer than its whole year.",
      "Earth takes 365 days to go once around the Sun. That is one year!", "The Moon is almost 4 times smaller across than Earth.", "Uranus spins on its side, like a rolling ball.",
      "A rocket must fly about 11 kilometres every second to escape Earth.", "Mars is the 4th planet from the Sun.",
    ],
    ar: [
      "للأرض قمر واحد.", "للمريخ قمران صغيران اسمهما فوبوس وديموس.", "تدور حول الشمس ٨ كواكب.",
      "مشى ١٢ رائد فضاء على القمر.", "يصل ضوء الشمس إلى الأرض في نحو ٨ دقائق.", "المشتري عريض جدًا، يمكن أن تصطف ١١ أرضًا على عرضه.",
      "يرى رواد محطة الفضاء نحو ١٦ شروقًا كل يوم.", "يمكن أن تتسع الشمس لنحو مليون أرض.", "للمثلث ٣ أضلاع و٣ زوايا.",
      "للمربع ٤ أضلاع كلها بالطول نفسه.", "للشكل السداسي ٦ أضلاع. النحل يبني خلاياه على شكل سداسي!", "لزحل أكثر من ١٠٠ قمر!",
      "يحتاج نبتون نحو ١٦٥ سنة ليدور مرة واحدة حول الشمس.", "في مجرتنا، درب التبانة، أكثر من ١٠٠ مليار نجم.", "يدور الزهرة ببطء شديد، فيومه أطول من سنته كلها.",
      "تحتاج الأرض ٣٦٥ يومًا لتدور مرة حول الشمس. هذه سنة كاملة!", "القمر أصغر من الأرض بنحو ٤ مرات في العرض.", "يدور أورانوس على جنبه مثل كرة تتدحرج.",
      "يجب أن يطير الصاروخ نحو ١١ كيلومترًا كل ثانية ليفلت من جاذبية الأرض.", "المريخ هو الكوكب الرابع من الشمس.",
    ],
  },
  gameName: g => t({ count: "gCount", line: "gLine", compare: "gCompare", pattern: "gPattern", add: "gAdd", sub: "gSub", missing: "gMissing", feed: "gFeed", shapes: "gShapes", bubbles: "gBubbles" }[g]),
  homeTiles: [["friends", "c3", "🐙"]],
  screens: { friends },
  onReset() { store.set("friends", []); },
  onLevelDone(i) {
    const got = store.get("friends", []);
    if (!got.includes(i)) { got.push(i); store.set("friends", got); later(() => toast(FRIENDS[i % FRIENDS.length] + " " + t("newFriend"), 2400), 2600); }
  },
  worlds: [["w1", "🌙", 0, 10, "#1d2a5e"], ["w2", "⭐", 10, 20, "#1f3a4f"], ["w3", "🌌", 20, 30, "#3a1f55"]],
  levels: () => LEVELS,
  free: () => [
    ["count", 1, "⭐", { min: 2, max: 10, choices: 3, rounds: 5 }], ["line", 2, "🚀", { lo: 0, hi: 10, labels: "all", rounds: 5 }],
    ["compare", 3, "⚖️", { max: 10, ask: "both", rounds: 5 }], ["pattern", 4, "🔴", { kinds: ["AB", "ABC", "AABB"], rounds: 5 }],
    ["add", 5, "➕", { max: 10, pics: true, rounds: 5 }], ["sub", 6, "➖", { max: 10, pics: true, rounds: 5 }],
    ["missing", 7, "❓", { lo: 1, hi: 10, step: 1, pos: "any", rounds: 5 }], ["feed", 8, "👽", { max: 10, rounds: 4 }],
    ["shapes", 9, "🔺", { mode: "mix", k: 4, rounds: 5 }], ["bubbles", 1, "🫧", { waves: [[1, 10, 1]], rounds: 1 }],
  ],
};

const LEVELS = [
  // Moon Base, 1 to 5
  { g: "count", min: 1, max: 3, choices: 2, rounds: 4 },
  { g: "count", min: 2, max: 5, choices: 3 },
  { g: "line", lo: 0, hi: 5, labels: "all" },
  { g: "compare", max: 5, ask: "more" },
  { g: "pattern", kinds: ["AB"], len: 4 },
  { g: "add", max: 5, pics: true },
  { g: "shapes", mode: "find", k: 3, set: ["circle", "square", "triangle", "star"] },
  { g: "feed", max: 5, rounds: 4 },
  { g: "missing", lo: 1, hi: 5, step: 1, pos: "end", len: 4 },
  { g: "bubbles", boss: true, waves: [[1, 10, 1]], rounds: 1, timer: 45 },
  // Star Field, 1 to 10
  { g: "count", min: 4, max: 10, choices: 3 },
  { g: "line", lo: 0, hi: 10, labels: "all" },
  { g: "compare", max: 10, ask: "both" },
  { g: "pattern", kinds: ["ABC", "AB"], len: 5 },
  { g: "add", max: 10, pics: true },
  { g: "sub", max: 10, pics: true },
  { g: "shapes", mode: "count", k: 4 },
  { g: "feed", max: 10, rounds: 4 },
  { g: "missing", lo: 1, hi: 10, step: 1, pos: "any", len: 5 },
  { g: "bubbles", boss: true, waves: [[1, 15, 1]], rounds: 1, timer: 60 },
  // Galaxy Core, 1 to 20
  { g: "count", min: 8, max: 15, choices: 4, rounds: 4 },
  { g: "line", lo: 10, hi: 20, labels: "some" },
  { g: "compare", max: 20, ask: "both", digits: true, rounds: 6 },
  { g: "pattern", kinds: ["AABB", "ABB", "ABC"], len: 6 },
  { g: "add", max: 15, pics: false, choices: 4, rounds: 6 },
  { g: "sub", max: 10, pics: false, choices: 4, rounds: 6 },
  { g: "line", lo: 0, hi: 10, labels: "ends", rounds: 6 },
  { g: "feed", max: 20, five: true, rounds: 4 },
  { g: "missing", lo: 2, hi: 20, step: 2, pos: "any", len: 5, choices: 4, rounds: 6 },
  { g: "bubbles", boss: true, waves: [[2, 20, 2], [10, 1, -1], [1, 20, 1]], rounds: 3, timer: 120 },
];

/* numbers near n for answer choices */
function near(n, k, lo, hi) {
  const s = new Set([n]); let d = 1;
  while (s.size < k && d < 30) { for (const c of shuffle([n - d, n + d])) if (s.size < k && c >= lo && c <= hi) s.add(c); d++; }
  return shuffle([...s]);
}
function objRow(n, thing, size) { const o = el("div", "objs"); o.style.setProperty("--s", size + "px"); for (let k = 0; k < n; k++) o.appendChild(el("span", "obj", thing)); return o; }
const sizeFor = n => n <= 5 ? 58 : n <= 10 ? 46 : n <= 15 ? 38 : 32;

const GAMES = {};

/* ---- count: tap each one (it gets a number), then choose how many ---- */
GAMES.count = function (s, cfg, done) {
  let last = -1;
  rounds(s, cfg, done, t("countHint"), (area, r, api) => {
    let n; do { n = rand(cfg.min, cfg.max); } while (n === last && cfg.max > cfg.min); last = n;
    const thing = pick(THINGS), qa = el("div", "qa"), o = el("div", "objs"); o.style.setProperty("--s", sizeFor(n) + "px");
    let counted = 0, shown = false;
    for (let k = 0; k < n; k++) {
      const b = button("obj", thing, () => {
        if (b.classList.contains("lit")) return;
        counted++; b.classList.add("lit"); const tag = el("span", "n", num(counted)); b.appendChild(tag); sfx.tick(counted); say(num(counted));
        if (counted === n) show();
      });
      b.setAttribute("aria-label", String(k + 1)); o.appendChild(b);
    }
    qa.appendChild(o); area.appendChild(qa);
    function show() { if (shown) return; shown = true; later(() => { api.say(t("countAsk")); answers(area, near(n, cfg.choices || 3, 1, 20), v => v === n, api); }, 500); }
    if (r > 0 || cfg.max > 10) later(show, 6000);   // after a while the answers appear anyway
  });
};

/* ---- number line: fly the rocket to a number ---- */
GAMES.line = function (s, cfg, done) {
  let last = -1;
  rounds(s, cfg, done, t("lineHint")(num(cfg.lo + 1)), (area, r, api) => {
    let n; do { n = rand(cfg.lo + 1, cfg.hi); } while (n === last); last = n;
    api.say(t("lineHint")(num(n)));
    const qa = el("div", "qa"); qa.appendChild(el("div", "huge", num(n)));
    const line = el("div", "line"); line.appendChild(el("div", "track"));
    const count = cfg.hi - cfg.lo, pos = k => 4 + (92 * k / count);
    const ship = canvasOf(64, (x, w, h) => rocket(x, w / 2, h / 2 + 4, Math.min(w, h) * .62, 0, true)); ship.className = "ship"; ship.style.left = pos(0) + "%"; line.appendChild(ship);
    for (let k = 0; k <= count; k++) {
      const v = cfg.lo + k, showLabel = cfg.labels === "all" || k === 0 || k === count || (cfg.labels === "some" && v % 5 === 0);
      const b = button("stop" + (count <= 6 ? " big" : ""), showLabel ? num(v) : "", () => {
        if (api.locked) return;
        ship.style.left = pos(k) + "%"; sfx.whoosh();
        if (v === n) { b.textContent = num(v); api.right(b); }
        else { const old = b.textContent; b.textContent = num(v); later(() => { b.textContent = old; ship.style.left = pos(0) + "%"; }, 1100); api.wrong(); }
      });
      b.style.left = pos(k) + "%"; if (count > 10) b.style.width = "30px", b.style.marginLeft = "-15px"; b.setAttribute("aria-label", String(v));
      line.appendChild(b);
    }
    qa.appendChild(line); area.appendChild(qa);
  });
};

/* ---- more or fewer, bigger or smaller ---- */
GAMES.compare = function (s, cfg, done) {
  rounds(s, cfg, done, cfg.digits ? t("bigger") : t("more"), (area, r, api) => {
    let a = rand(1, cfg.max), b; do { b = rand(1, cfg.max); } while (b === a || (r < 2 && Math.abs(a - b) < 2 && cfg.max > 5));
    const wantMore = cfg.ask === "more" ? true : r % 2 === 0;
    const q = cfg.digits ? (wantMore ? t("bigger") : t("smaller")) : (wantMore ? t("more") : t("fewer"));
    api.say(q);
    const qa = el("div", "qa"); qa.appendChild(el("p", "hint", q));
    const gs = el("div", "groups"), thing = pick(THINGS);
    [a, b].forEach(v => {
      const g = button("group" + (cfg.digits ? " digit" : ""), null, () => { if (api.locked) return; ((v > (v === a ? b : a)) === wantMore) ? api.right(g) : api.wrong(g); });
      if (cfg.digits) g.textContent = num(v); else { g.style.fontSize = (v > 12 ? 24 : v > 6 ? 30 : 40) + "px"; g.textContent = thing.repeat(v); g.setAttribute("aria-label", num(v)); }
      gs.appendChild(g);
    });
    qa.appendChild(gs); area.appendChild(qa);
  });
};

/* ---- patterns ---- */
const UNITS = { AB: [0, 1], ABC: [0, 1, 2], AABB: [0, 0, 1, 1], ABB: [0, 1, 1] };
GAMES.pattern = function (s, cfg, done) {
  rounds(s, cfg, done, t("patternHint"), (area, r, api) => {
    const kind = cfg.kinds[r % cfg.kinds.length], unit = UNITS[kind], set = shuffle(pick(PAT)).slice(0, 3);
    const len = Math.max(cfg.len || 4, unit.length + 2), seq = Array.from({ length: len + 1 }, (_, k) => unit[k % unit.length]);
    const ans = seq[len];
    const qa = el("div", "qa"), row = el("div", "objs"); row.style.setProperty("--s", Math.min(50, Math.floor(240 / (len + 1))) + "px"); row.style.direction = "ltr"; row.style.flexWrap = "nowrap";
    seq.slice(0, len).forEach(v => row.appendChild(el("span", "obj", set[v])));
    const q = el("span", "obj", "❔"); row.appendChild(q); qa.appendChild(row); area.appendChild(qa);
    answers(area, shuffle([0, 1, 2]), v => v === ans, { get locked() { return api.locked; }, right(b) { q.textContent = set[ans]; api.right(b); }, wrong: api.wrong }, v => set[v]);
  });
};

/* ---- adding and taking away ---- */
function sumRound(area, api, cfg, sub) {
  let a, b, c;
  if (sub) { a = rand(2, cfg.max); b = rand(1, a - 1); c = a - b; } else { c = rand(2, cfg.max); a = rand(1, c - 1); b = c - a; }
  const qa = el("div", "qa"), thing = pick(THINGS);
  if (cfg.pics) {
    if (sub) {
      const o = el("div", "objs"); o.style.setProperty("--s", sizeFor(a) + "px");
      for (let k = 0; k < a; k++) { const sp = el("span", "obj", thing); if (k >= c) { sp.style.opacity = ".25"; sp.style.textDecoration = "line-through"; } o.appendChild(sp); }
      qa.appendChild(o); later(() => sfx.whoosh(), 300);
    } else {
      const eq = el("div", "objs"); eq.style.setProperty("--s", sizeFor(c) + "px"); eq.style.direction = "ltr";
      for (let k = 0; k < a; k++) eq.appendChild(el("span", "obj", thing));
      eq.appendChild(el("span", "obj", "➕"));
      for (let k = 0; k < b; k++) eq.appendChild(el("span", "obj", thing));
      qa.appendChild(eq);
    }
  }
  const eq = el("div", "eq"); eq.appendChild(el("span", null, num(a))); eq.appendChild(el("span", null, sub ? "−" : "+")); eq.appendChild(el("span", null, num(b))); eq.appendChild(el("span", null, "=")); const q = el("span", "q", "?"); eq.appendChild(q);
  qa.appendChild(eq); area.appendChild(qa);
  if (sub) api.say(t("subHint")(num(b)), num(a) + " − " + num(b) + ". " + t("subHint")(num(b)));
  answers(area, near(c, cfg.choices || 3, 0, 20), v => v === c, { get locked() { return api.locked; }, right(bt) { q.textContent = num(c); api.right(bt); }, wrong: api.wrong });
}
GAMES.add = (s, cfg, done) => rounds(s, cfg, done, t("addHint"), (area, r, api) => sumRound(area, api, cfg, false));
GAMES.sub = (s, cfg, done) => rounds(s, cfg, done, t("subHint")(num(1)), (area, r, api) => sumRound(area, api, cfg, true));

/* ---- missing number in a counting row ---- */
GAMES.missing = function (s, cfg, done) {
  rounds(s, cfg, done, t("missingHint"), (area, r, api) => {
    const len = cfg.len || 4, step = cfg.step || 1, top = cfg.hi - step * (len - 1);
    const start = cfg.lo + step * rand(0, Math.max(0, Math.floor((top - cfg.lo) / step)));
    const seq = Array.from({ length: len }, (_, k) => start + k * step);
    const hole = cfg.pos === "end" ? len - 1 : rand(1, len - 1), ans = seq[hole];
    const qa = el("div", "qa"), eq = el("div", "eq");
    seq.forEach((v, k) => { const sp = el("span", k === hole ? "q" : null, k === hole ? "?" : num(v)); eq.appendChild(sp); });
    qa.appendChild(eq); area.appendChild(qa);
    const opts = step === 1 ? near(ans, cfg.choices || 3, 0, 20) : shuffle([...new Set([ans, ans - step, ans + step, ans + 1].filter(v => v >= 0))]).slice(0, cfg.choices || 3);
    if (!opts.includes(ans)) opts[0] = ans;
    answers(area, shuffle(opts), v => v === ans, { get locked() { return api.locked; }, right(bt) { eq.children[hole].textContent = num(ans); api.right(bt); }, wrong: api.wrong });
  });
};

/* ---- feed the alien: build an amount with 1s (and 5-packs) ---- */
GAMES.feed = function (s, cfg, done) {
  rounds(s, cfg, done, t("feedHint")(num(3)), (area, r, api) => {
    const n = rand(Math.max(2, Math.ceil(cfg.max / 3)), cfg.max), friend = pick(["👽", "🐙", "👾", "🤖"]);
    api.say(t("feedHint")(num(n)));
    const qa = el("div", "qa");
    const who = el("div", "eq"); who.appendChild(el("span", "pic", friend)); who.appendChild(el("span", "q", num(n))); qa.appendChild(who);
    const basket = el("div", "basket"); qa.appendChild(basket); area.appendChild(qa);
    let have = 0;
    function draw() { basket.innerHTML = ""; for (let k = 0; k < have; k++) { const e = button("obj", "⚡", () => { if (api.locked) return; have--; sfx.pop(); draw(); }); e.style.setProperty("--s", "30px"); e.style.fontSize = (have > 12 ? 24 : 32) + "px"; basket.appendChild(e); } }
    const row = el("div", "ans"); row.style.setProperty("--n", cfg.five ? 3 : 2);
    const add = k => () => { if (api.locked) return; if (have + k > 25) return; have += k; sfx.tick(have); say(num(have)); draw(); };
    const one = button("choice", "+⚡", add(1)); row.appendChild(one);
    if (cfg.five) { const five = button("choice", null, add(5)); five.appendChild(el("span", null, "+⚡×" + num(5))); five.style.fontSize = "26px"; row.appendChild(five); }
    const go2 = button("choice", t("feed"), () => {
      if (api.locked) return;
      if (have === n) { sfx.yay(); api.right(go2); }
      else { api.wrong(go2); later(() => api.say(have > n ? t("tooMany") : t("needMore")), 700); }
    });
    go2.style.background = "var(--sun)"; go2.style.color = "#2b1a00"; go2.style.fontSize = "28px"; row.appendChild(go2);
    area.appendChild(row);
  });
};

/* ---- shapes: find one, or count one kind ---- */
const SHAPES = ["circle", "square", "triangle", "star", "heart", "diamond", "rectangle", "hexagon"];
const SCOL = ["#ffd23f", "#6ff0c4", "#ff7ab8", "#8fd6ff", "#ff9f43", "#c3a6ff"];
function shapeSvg(kind, color, size) {
  const P = {
    circle: '<circle cx="50" cy="50" r="40"/>', square: '<rect x="12" y="12" width="76" height="76" rx="6"/>',
    triangle: '<path d="M50 8 L92 88 L8 88 Z"/>', rectangle: '<rect x="4" y="26" width="92" height="48" rx="6"/>',
    diamond: '<path d="M50 4 L88 50 L50 96 L12 50 Z"/>', hexagon: '<path d="M28 10 L72 10 L94 50 L72 90 L28 90 L6 50 Z"/>',
    heart: '<path d="M50 88 C10 60 4 34 22 20 C36 9 48 18 50 28 C52 18 64 9 78 20 C96 34 90 60 50 88 Z"/>',
    star: '<path d="M50 6 L61 38 L95 38 L67 58 L78 92 L50 71 L22 92 L33 58 L5 38 L39 38 Z"/>',
  };
  const w = el("span"); w.innerHTML = '<svg viewBox="0 0 100 100" width="' + size + '" height="' + size + '" aria-hidden="true" fill="' + color + '" stroke="#fff4c2" stroke-width="4" stroke-linejoin="round">' + P[kind] + "</svg>";
  return w.firstChild;
}
GAMES.shapes = function (s, cfg, done) {
  rounds(s, cfg, done, t("shapeFind")(t("shapes").circle), (area, r, api) => {
    const set = cfg.set || SHAPES, mode = cfg.mode === "mix" ? (r % 2 ? "count" : "find") : cfg.mode;
    const target = pick(set), qa = el("div", "qa");
    if (mode === "find") {
      api.say(t("shapeFind")(t("shapes")[target]));
      qa.appendChild(el("p", "hint", t("shapeFind")(t("shapes")[target]))); area.appendChild(qa);
      const opts = shuffle([target].concat(shuffle(set.filter(k => k !== target)).slice(0, (cfg.k || 3) - 1)));
      const row = answers(area, opts, v => v === target, api, v => shapeSvg(v, pick(SCOL), 64), opts.length > 3 ? 2 : opts.length);
      row.querySelectorAll(".choice").forEach(b => b.style.minHeight = "96px");
    } else {
      const n = rand(1, 5), others = shuffle(set.filter(k => k !== target)).slice(0, 3);
      const items = shuffle(Array.from({ length: n }, () => target).concat(Array.from({ length: rand(3, 6) }, () => pick(others))));
      const word = t("shapes")[target];
      api.say(t("shapeCount")(word));
      qa.appendChild(el("p", "hint", t("shapeCount")(word)));
      const o = el("div", "objs"); items.forEach(k => { const sp = el("span", "obj"); sp.appendChild(shapeSvg(k, pick(SCOL), 46)); o.appendChild(sp); });
      qa.appendChild(o); area.appendChild(qa);
      answers(area, near(n, cfg.k || 3, 1, 9), v => v === n, api);
    }
  });
};

/* ---- bubble pop boss: tap numbers in order (waves: [from, to, step]) ---- */
GAMES.bubbles = function (s, cfg, done) {
  const waves = cfg.waves, hintOf = w => w[2] === 2 ? t("bubblesTwos") : w[2] < 0 ? t("bubblesDown")(num(w[0])) : t("bubblesHint");
  cfg = Object.assign({}, cfg, { rounds: waves.length });
  rounds(s, cfg, done, hintOf(waves[0]), (area, r, api) => {
    const [a, b, st] = waves[r], seq = []; for (let v = a; st > 0 ? v <= b : v >= b; v += st) seq.push(v);
    if (r > 0) api.say(hintOf(waves[r]));
    area.style.padding = "0";
    const box = el("div"); box.style.cssText = "position:absolute;inset:0"; area.appendChild(box);
    const cols = seq.length > 12 ? 4 : 3, rows = Math.ceil(seq.length / cols), cells = shuffle(Array.from({ length: cols * rows }, (_, k) => k)).slice(0, seq.length);
    let at = 0;
    seq.forEach((v, k) => {
      const c = cells[k], cx = (c % cols + .5) / cols * 100, cy = (Math.floor(c / cols) + .5) / rows * 100;
      const bb = button("choice", num(v), () => {
        if (api.locked || bb.hidden) return;
        if (v === seq[at]) { at++; sfx.tick(at); say(num(v)); burst(bb, 12); bb.hidden = true; if (at === seq.length) api.right(null, false); }
        else api.wrong(bb);
      });
      const size = seq.length > 12 ? 64 : 76;
      bb.style.cssText = "position:absolute;width:" + size + "px;height:" + size + "px;min-height:0;border-radius:50%;padding:0;font-size:" + (size * .42) + "px;left:calc(" + cx + "% - " + size / 2 + "px);top:calc(" + cy + "% - " + size / 2 + "px);background:radial-gradient(circle at 30% 30%, rgba(255,255,255,.45), rgba(143,214,255,.25) 40%, rgba(111,240,196,.18));box-shadow:inset 0 0 0 3px rgba(255,244,194,.6)";
      if (!RM) bb.animate([{ transform: "translateY(-4px)" }, { transform: "translateY(4px)" }], { duration: 1400 + k * 90, direction: "alternate", iterations: Infinity, easing: "ease-in-out" });
      box.appendChild(bb);
    });
  });
};

/* ---- space friends collection ---- */
function friends() {
  titleEl.textContent = t("friends");
  const got = store.get("friends", []);
  const s = el("section", "screen"); s.appendChild(helper(t("friendsHint")).el);
  s.appendChild(el("p", "hint", num(got.length) + " " + t("of") + " " + num(LEVELS.length)));
  const sc = el("div", "scroll"); const g = el("div", "grid");
  LEVELS.forEach((_, i) => {
    const has = got.includes(i), c = button("card" + (has ? "" : " no"), has ? FRIENDS[i % FRIENDS.length] : "❔", () => { if (has) { sfx.pop(); burst(c, 14); say(t("level") + " " + num(i + 1)); } });
    c.appendChild(el("small", null, num(i + 1))); g.appendChild(c);
  });
  sc.appendChild(g); s.appendChild(sc); stage.appendChild(s);
}

boot();
