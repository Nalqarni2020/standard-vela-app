/* Market: regime, breadth, sector rotation and volatility in one read. */
(function () {
  "use strict";
  const D = window.Desk, A = window.Analytics, E = D.E;
  const { esc, px, pct, call } = D;
  const INDEXES = [["SPY", "S&P 500"], ["QQQ", "Nasdaq 100"], ["IWM", "Russell 2000"], ["DIA", "Dow 30"]];
  const SECTORS = [["XLK", "Technology"], ["XLC", "Communication"], ["XLY", "Consumer discretionary"], ["XLF", "Financials"], ["XLI", "Industrials"], ["XLE", "Energy"], ["XLB", "Materials"], ["XLV", "Health care"], ["XLP", "Consumer staples"], ["XLU", "Utilities"], ["XLRE", "Real estate"]];
  let root;

  const ret = (b, n) => b.length > n ? b[b.length - 1].c / b[b.length - 1 - n].c - 1 : null;
  const above = (b, n) => { if (b.length < n) return null; const s = E.sma(b.map(x => x.c), n); return b[b.length - 1].c > s[s.length - 1]; };

  function shell() {
    root.innerHTML = `
      <div class="app-h"><h1>Market</h1><p>Is the tape helping or hurting? Regime, breadth, sector rotation and volatility, read the same way every day.</p></div>
      <div class="tools" style="margin-bottom:12px;flex-wrap:wrap"><span class="muted" style="font-size:13px">Breadth universe</span><select id="mkList" class="btn small" aria-label="Breadth universe"></select><button class="btn small primary" id="mkRun" type="button">Read the market</button></div>
      <div id="mkOut"><p class="muted">Reading…</p></div>`;
    root.querySelector("#mkRun").onclick = run;
    root.querySelector("#mkList").onchange = e => D.save("mkList", e.target.value);
  }

  async function vixBars() {
    const d = await call("get_indexes", { symbols: "VIX" }, 86400000);
    const ix = ((d && d.indexes) || []).find(x => x.symbol === "VIX");
    if (!ix) return [];
    const h = await call("get_index_historicals", { instrument_ids: [ix.id], start_time: D.iso(Date.now() - 400 * D.DAY), interval: "day" }, 3600000);
    const row = ((h && h.results) || []).find(r => r.instrument_id === ix.id);
    // Index bars carry *_value fields and no volume; gap-fill bars are dropped.
    return ((row && row.bars) || []).filter(b => !b.interpolated).map(b => ({ t: Date.parse(b.begins_at), d: b.begins_at.slice(0, 10), o: +b.open_value, h: +b.high_value, l: +b.low_value, c: +b.close_value, v: 0 })).filter(b => isFinite(b.c) && b.c > 0);
  }

  async function run() {
    const out = root.querySelector("#mkOut"), btn = root.querySelector("#mkRun"); btn.disabled = true;
    out.innerHTML = '<p class="muted">Reading indexes and sectors…</p>';
    try {
      const etfs = INDEXES.concat(SECTORS).map(x => x[0]);
      const listId = root.querySelector("#mkList").value;
      const [eb, vix, items] = await Promise.all([
        D.dailyBars(etfs, 430),
        vixBars().catch(() => []),
        listId ? call("get_watchlist_items", { list_id: listId }, 600000).catch(() => null) : Promise.resolve(null),
      ]);
      const uni = ((items && items.items) || []).filter(i => i.object_type === "instrument" && i.symbol).map(i => i.symbol).slice(0, 120);
      out.innerHTML = '<p class="muted">Reading breadth for ' + uni.length + " stocks…</p>";
      const ub = uni.length ? await D.dailyBars(uni, 430, (i, n) => { out.innerHTML = `<p class="muted">Reading breadth ${i} of ${n}…</p>`; }) : {};
      const spy = eb.SPY || [], reg = spy.length ? E.regime(spy) : { state: "Unknown" };
      const br = A.breadth(ub, 120);
      const pct50 = br.now.n ? br.now.a50 / br.now.n : null;
      const vNow = vix.length ? vix[vix.length - 1].c : null, v20 = vix.length >= 20 ? E.sma(vix.map(x => x.c), 20).pop() : null;
      const vPctile = vix.length > 200 ? vix.slice(-252).filter(x => x.c <= vNow).length / Math.min(252, vix.length) : null;
      const parts = [
        ["S&P regime", reg.state, reg.state === "Green" ? 1 : reg.state === "Red" ? -1 : 0, "SPY above a rising 8 and 20-day, 8 over 20 = +1; Red = −1."],
        ["Stocks above their 50-day", pct50 == null ? "—" : (pct50 * 100).toFixed(0) + "%", pct50 == null ? 0 : pct50 > 0.6 ? 1 : pct50 < 0.4 ? -1 : 0, "Above 60% = +1; under 40% = −1."],
        ["New 52-week highs vs lows", br.now.n252 ? br.now.hi + " vs " + br.now.lo : "—", br.now.hi > br.now.lo ? 1 : br.now.lo > br.now.hi ? -1 : 0, "More highs = +1; more lows = −1."],
        ["VIX vs its 20-day", vNow == null ? "—" : px(vNow) + " vs " + px(v20), vNow == null || v20 == null ? 0 : vNow < v20 && vNow < 20 ? 1 : vNow > v20 && vNow > 25 ? -1 : 0, "Under its average and under 20 = +1; over its average and over 25 = −1."],
      ];
      const score = parts.reduce((s, p) => s + p[2], 0);
      const verdict = score >= 2 ? "Risk-on" : score <= -2 ? "Risk-off" : "Mixed";
      const vClass = score >= 2 ? "pass" : score <= -2 ? "fail" : "";
      const sect = SECTORS.map(([s, n]) => { const b = eb[s] || []; const r3 = ret(b, 63), s3 = ret(spy, 63); return { s, n, w: ret(b, 5), m: ret(b, 21), q: r3, rs: r3 != null && s3 != null ? r3 - s3 : null, a50: above(b, 50), reg: b.length > 30 ? E.regime(b).state : "—" }; }).sort((a, b) => (b.rs ?? -9) - (a.rs ?? -9));
      const lead = sect.slice(0, 3).map(x => x.n).join(", "), lag = sect.slice(-3).map(x => x.n).join(", ");
      const defensive = ["XLP", "XLU", "XLV"].filter(s => sect.slice(0, 4).some(x => x.s === s)).length;
      out.innerHTML = `
        <p class="verdict-line"><span class="pill ${vClass}" style="font-size:13px;vertical-align:middle">${verdict}</span> ${esc(`Score ${score > 0 ? "+" : ""}${score} of ±4. Leaders over 3 months: ${lead}. Laggards: ${lag}.` + (defensive >= 2 ? " Defensive sectors are leading, which usually means caution." : ""))}</p>
        <div class="grid2">
          <div class="panel"><div class="ph"><h2>How the verdict is scored</h2></div>
            <div class="scroll"><table class="xt"><tbody>${parts.map(p => `<tr><td><b>${esc(p[0])}</b><span class="note">${esc(p[3])}</span></td><td class="v">${esc(p[1])}</td><td><span class="pill ${p[2] > 0 ? "pass" : p[2] < 0 ? "fail" : ""}">${p[2] > 0 ? "+1" : p[2] < 0 ? "−1" : "0"}</span></td></tr>`).join("")}</tbody></table></div></div>
          <div class="panel"><div class="ph"><h2>Indexes</h2></div>
            <div class="scroll"><table class="dt"><thead><tr><th>Index</th><th>Last close</th><th>1 week</th><th>1 month</th><th>3 months</th><th>Regime</th></tr></thead><tbody>
            ${INDEXES.map(([s, n]) => { const b = eb[s] || []; const rg = b.length > 30 ? E.regime(b).state : "Unknown"; return `<tr><td><b>${esc(s)}</b> <span class="muted">${esc(n)}</span></td><td>${px(b.length ? b[b.length - 1].c : null)}</td>${[5, 21, 63].map(k => { const r = ret(b, k); return `<td class="chg ${r >= 0 ? "up" : "down"}">${pct(r)}</td>`; }).join("")}<td><span class="pill ${rg}">${esc(rg)}</span></td></tr>`; }).join("")}
            </tbody></table></div></div>
        </div>
        <div class="panel" style="margin-top:18px"><div class="ph"><h2>Breadth</h2><span class="eyebrow">${br.now.n} stocks from the chosen list</span></div>
          <div class="kv six">${D.kv([["Above 20-day", br.now.n ? (br.now.a20 / br.now.n * 100).toFixed(0) + "%" : "—"], ["Above 50-day", pct50 == null ? "—" : (pct50 * 100).toFixed(0) + "%"], ["Above 200-day", br.now.n200 ? (br.now.a200 / br.now.n200 * 100).toFixed(0) + "%" : "—"], ["New 52-week highs", br.now.n252 ? String(br.now.hi) : "—"], ["New 52-week lows", br.now.n252 ? String(br.now.lo) : "—"], ["Up / down last session", br.now.adv + " / " + br.now.dec]])}</div>
          <div class="legend"><span><i style="background:var(--teal)"></i>Share of stocks above their 50-day average, last 120 sessions</span></div>
          <div class="chart-box" style="height:220px"><canvas id="mkBr" role="img" aria-label="Breadth over time"></canvas></div></div>
        <div class="panel" style="margin-top:18px"><div class="ph"><h2>Sector rotation</h2><span class="eyebrow">Sorted by 3-month return minus SPY's</span></div>
          <div class="scroll"><table class="dt"><thead><tr><th>Sector</th><th>1 week</th><th>1 month</th><th>3 months</th><th>Versus SPY, 3 months</th><th>Above 50-day</th><th>Regime</th></tr></thead><tbody>
          ${sect.map(x => `<tr class="clickable" tabindex="0" data-sym="${x.s}"><td><b>${x.s}</b> <span class="muted">${esc(x.n)}</span></td>${[x.w, x.m, x.q].map(r => `<td class="chg ${r >= 0 ? "up" : "down"}">${pct(r)}</td>`).join("")}<td class="chg ${x.rs >= 0 ? "up" : "down"}">${pct(x.rs)}</td><td>${x.a50 == null ? "—" : x.a50 ? "Yes" : "No"}</td><td><span class="pill ${x.reg}">${esc(x.reg)}</span></td></tr>`).join("")}
          </tbody></table></div></div>
        <div class="panel" style="margin-top:18px"><div class="ph"><h2>Volatility</h2><span class="eyebrow">VIX, the market's expected 30-day volatility</span></div>
          <div class="kv four">${D.kv([["VIX", px(vNow)], ["20-day average", px(v20)], ["Higher than", vPctile == null ? "—" : (vPctile * 100).toFixed(0) + "% of the last year"], ["Rule of thumb", vNow == null ? "—" : vNow < 15 ? "Calm" : vNow < 20 ? "Normal" : vNow < 30 ? "Elevated" : "Stressed"]])}</div>
          <div class="chart-box" style="height:200px"><canvas id="mkVix" role="img" aria-label="VIX over the last year"></canvas></div></div>
        <p class="muted" style="font-size:12px">Breadth uses only the list you chose, so it describes that list, not the whole market. Sector funds are the SPDR Select Sector ETFs. Closes are confirmed cash closes. Tap a sector to open it on Standard.</p>`;
      D.lineChart(out.querySelector("#mkBr"), { series: [{ vals: br.series.map(v => v == null ? null : v * 100), color: D.tok("--teal") }], guides: [{ y: 60, color: D.tok("--up"), label: "60%" }, { y: 40, color: D.tok("--down"), label: "40%" }], labels: br.dates.map(d => d.slice(5)), fmt: v => v.toFixed(0) + "%" });
      if (vix.length) { const vv = vix.slice(-252); D.lineChart(out.querySelector("#mkVix"), { series: [{ vals: vv.map(x => x.c), color: D.tok("--amber") }, { vals: E.sma(vix.map(x => x.c), 20).slice(-252), color: D.tok("--ink-3"), dash: [4, 3] }], guides: [{ y: 20, color: D.tok("--ink-3"), label: "20" }], labels: vv.map(x => x.d.slice(5)) }); }
    } catch (e) { out.innerHTML = '<div class="banner bad">' + esc(e.message) + "</div>"; }
    btn.disabled = false;
  }

  D.register("market", {
    async mount(r) {
      root = r; if (D.needsLive(root)) return; shell();
      root.addEventListener("click", e => { const tr = e.target.closest("tr[data-sym]"); if (tr) D.openSymbol(tr.dataset.sym); });
      try {
        await D.loadLists();
        const sel = root.querySelector("#mkList"); D.fillLists(sel);
        const pop = [...sel.options].find(o => /100 most popular/i.test(o.textContent)), saved = D.load("mkList", null);
        if (saved && [...sel.options].some(o => o.value === saved)) sel.value = saved; else if (pop) sel.value = pop.value;
      } catch (e) {}
      run();
    },
  });
})();
