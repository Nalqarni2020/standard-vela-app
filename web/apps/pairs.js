/* Pairs: stocks that move together, tested out of sample, with today's stretch between them. */
(function () {
  "use strict";
  const D = window.Desk, A = window.Analytics;
  const { esc, px, pct } = D;
  let root, last = null, sel = 0;

  function shell() {
    root.innerHTML = `
      <div class="app-h"><h1>Pairs</h1><p>Two stocks that usually move together drift apart, then tend to come back. This finds such pairs in a list and tests whether that held on months it had not seen.</p></div>
      <div class="tools" style="margin-bottom:12px;flex-wrap:wrap">
        <select id="prList" class="btn small" aria-label="List"></select>
        <input id="prSyms" class="btn small" style="min-width:16em;cursor:text" placeholder="or type tickers: KO, PEP, XOM, CVX" aria-label="Tickers">
        <button class="btn small primary" id="prRun" type="button">Find pairs</button>
      </div>
      <div id="prOut"><p class="muted" style="font-size:13px">Uses about 2 years of daily closes. Pairs are ranked by how closely their prices tracked over the 12 months before the last 6 (Gatev, Goetzmann and Rouwenhorst, 2006), then traded on those last 6 months without refitting. Up to 40 names.</p></div>
      <p class="muted" style="font-size:12px">Trading a pair means buying one stock and shorting the other. The paper book does not short, so this desk is for study. Shorting carries borrow costs and unlimited risk.</p>`;
    root.querySelector("#prRun").onclick = run;
    root.querySelector("#prOut").addEventListener("click", e => { const tr = e.target.closest("tr[data-i]"); if (tr) { sel = +tr.dataset.i; drawSel(); } const b = e.target.closest("[data-sym]"); if (b) D.openSymbol(b.dataset.sym); });
  }

  async function symbols() {
    const typed = root.querySelector("#prSyms").value.split(/[,\s]+/).map(s => s.trim().toUpperCase()).filter(s => /^[A-Z][A-Z0-9.]{0,9}$/.test(s));
    if (typed.length >= 2) return [...new Set(typed)].slice(0, 40);
    const id = root.querySelector("#prList").value; if (!id) throw new Error("Choose a list or type at least two tickers.");
    const it = await D.call("get_watchlist_items", { list_id: id }, 600000);
    return ((it && it.items) || []).filter(i => i.object_type === "instrument" && i.symbol).map(i => i.symbol).slice(0, 40);
  }

  async function run() {
    const out = root.querySelector("#prOut"), btn = root.querySelector("#prRun"); btn.disabled = true;
    try {
      const syms = await symbols();
      if (syms.length < 2) throw new Error("Need at least two stocks.");
      const bars = await D.dailyBars(syms, 800, (i, n) => { out.innerHTML = `<p class="muted">Reading prices ${i} of ${n}…</p>`; });
      out.innerHTML = '<p class="muted">Testing ' + (syms.length * (syms.length - 1) / 2) + " pairs…</p>";
      await new Promise(r => setTimeout(r, 0));
      const res = A.scanPairs(bars, { top: 15, form: 252, trade: 126, open: 2, cost: (+(D.load("cb", {}).cost) || 5) / 10000 });
      if (!res.length) { out.innerHTML = '<p class="muted">No pair had the 18 months of shared history the test needs.</p>'; btn.disabled = false; return; }
      last = res; sel = 0;
      const all = res.flatMap(p => p.hist.trades.map(t => t.ret)), st = A.summarize(all);
      const coint = res.filter(p => p.adfT != null && p.adfT < -3.34);
      const live = res.filter(p => Math.abs(p.zNow) >= 2);
      out.innerHTML = `
        <p class="verdict-line">${esc(`${coint.length} of the ${res.length} closest pairs pass the cointegration test. On the last 6 months, untouched by the fitting, the pair trades ${st.n ? `averaged ${pct(st.mean)} each and won ${(st.hit * 100).toFixed(0)}% of the time (${st.n} trades)` : "made no trades"}. ${live.length ? live.length + " pair" + (live.length === 1 ? " is" : "s are") + " stretched 2 deviations or more today." : "No pair is stretched 2 deviations today."}`)}</p>
        <div class="panel"><div class="scroll"><table class="dt"><thead><tr><th>Pair</th><th>Correlation</th><th>Hedge ratio</th><th>Cointegration t</th><th>Half-life</th><th>Test trades</th><th>Test average</th><th>Today's stretch</th><th>Today</th></tr></thead><tbody>
        ${res.map((p, i) => { const s = A.summarize(p.hist.trades.map(t => t.ret)); const z = p.zNow; const act = z >= 2 ? `Short ${p.a}, buy ${p.b}` : z <= -2 ? `Buy ${p.a}, short ${p.b}` : "No trade"; return `<tr class="clickable" tabindex="0" data-i="${i}"><td><b>${esc(p.a)} / ${esc(p.b)}</b></td><td>${p.corr == null ? "—" : p.corr.toFixed(2)}</td><td>${p.beta.toFixed(2)}</td><td class="chg ${p.adfT < -3.34 ? "up" : "down"}">${p.adfT == null ? "—" : p.adfT.toFixed(2)}</td><td>${p.halfLife == null ? "—" : p.halfLife.toFixed(1) + " days"}</td><td>${s.n}</td><td class="chg ${s.mean >= 0 ? "up" : "down"}">${s.n ? pct(s.mean) : "—"}</td><td>${(z >= 0 ? "+" : "") + z.toFixed(2)}σ</td><td>${esc(act)}</td></tr>`; }).join("")}
        </tbody></table></div>
        <div class="pb muted" style="font-size:12px">Correlation of daily returns over the last year. Hedge ratio: how much of the second stock offsets one unit of the first, from a regression of log prices. Cointegration t: the Engle-Granger test on that spread; below −3.34 means the gap has reliably closed (5% level). Half-life: typical days for half the gap to close. Stretch: today's gap in standard deviations of the last year. Test: open at 2 deviations, close when the gap crosses zero or at the end, both legs equal in dollars, costs on all four fills. Tap a row to chart it.</div></div>
        <div class="panel" style="margin-top:18px"><div class="ph"><h2 id="prSelT"></h2><span class="eyebrow">Stretch in standard deviations, last 12 months</span></div>
          <div class="chart-box" style="height:240px"><canvas id="prZ" role="img" aria-label="Spread between the pair over the last year"></canvas></div>
          <div class="pb" id="prSelB"></div></div>`;
      drawSel();
    } catch (e) { out.innerHTML = '<div class="banner bad">' + esc(e.message) + "</div>"; }
    btn.disabled = false;
  }

  function drawSel() {
    if (!last || !last[sel]) return;
    const p = last[sel], cv = root.querySelector("#prZ");
    root.querySelector("#prSelT").textContent = p.a + " / " + p.b;
    D.lineChart(cv, { series: [{ vals: p.zSeries, color: D.tok("--teal") }], guides: [{ y: 2, color: D.tok("--down"), label: "+2" }, { y: -2, color: D.tok("--up"), label: "−2" }, { y: 0, color: D.tok("--ink-3") }], labels: p.dates.slice(-p.zSeries.length).map(d => d.slice(5)), fmt: v => v.toFixed(1) });
    const n = p.pa.length;
    root.querySelector("#prSelB").innerHTML = `<div class="tools" style="flex-wrap:wrap"><button class="btn small" type="button" data-sym="${esc(p.a)}">${esc(p.a)} ${px(p.pa[n - 1])} on Standard</button><button class="btn small" type="button" data-sym="${esc(p.b)}">${esc(p.b)} ${px(p.pb[n - 1])} on Standard</button></div>
      <p class="muted" style="font-size:12px;margin:8px 0 0">Over the last year ${esc(p.a)} returned ${pct(p.pa[n - 1] / p.pa[Math.max(0, n - 252)] - 1)} and ${esc(p.b)} ${pct(p.pb[n - 1] / p.pb[Math.max(0, n - 252)] - 1)}. A pair can stop working when one company's story changes, so check the news before trusting a stretch.</p>`;
  }

  D.register("pairs", {
    async mount(r) { root = r; if (D.needsLive(root)) return; shell(); try { await D.loadLists(); D.fillLists(root.querySelector("#prList")); } catch (e) {} },
  });
})();
