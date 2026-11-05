/* Congress: disclosed trades by members of Congress, and a test of copying them after disclosure. */
(function () {
  "use strict";
  const D = window.Desk, A = window.Analytics;
  const { esc, pct, call } = D;
  const money0 = v => "$" + Math.round(+v).toLocaleString("en-US");
  let root, mode = D.load("cgMode", "stock");

  function shell() {
    root.innerHTML = `
      <div class="app-h"><h1>Congress</h1><p>Trades members of Congress disclosed under the STOCK Act, and what copying them after disclosure would have earned.</p></div>
      <form class="tools" id="cgForm" style="margin-bottom:12px;flex-wrap:wrap" autocomplete="off">
        <select id="cgMode" class="btn small" aria-label="Search by"><option value="stock">By stock</option><option value="person">By member</option><option value="list">Across a watchlist</option></select>
        <input id="cgQ" class="btn small" style="min-width:12em;cursor:text" aria-label="Stock or member name">
        <select id="cgList" class="btn small" aria-label="Watchlist" hidden></select>
        <button class="btn small primary" type="submit">Search</button>
      </form>
      <div id="cgOut"></div>
      <p class="muted" style="font-size:12px">Source: Tip Ranks, via Robinhood. Disclosures arrive up to 45 days after the trade, and amounts are reported as ranges, never exact. This is historical information, not a signal or a recommendation.</p>`;
    const f = root.querySelector("#cgForm"), m = root.querySelector("#cgMode");
    m.value = mode; sync();
    m.onchange = () => { mode = m.value; D.save("cgMode", mode); sync(); };
    f.onsubmit = e => { e.preventDefault(); run(); };
    root.addEventListener("click", e => { const b = e.target.closest("[data-sym]"); if (b) D.openSymbol(b.dataset.sym); const p = e.target.closest("[data-person]"); if (p) { mode = "person"; root.querySelector("#cgMode").value = "person"; sync(); root.querySelector("#cgQ").value = p.dataset.person; run(); } });
  }
  function sync() {
    const q = root.querySelector("#cgQ"), l = root.querySelector("#cgList");
    q.hidden = mode === "list"; l.hidden = mode !== "list";
    q.placeholder = mode === "stock" ? "NVDA" : "Nancy Pelosi";
    if (mode === "stock" && !q.value) q.value = D.S.sym && D.S.sym !== "EXAMPLE" ? D.S.sym : "NVDA";
    if (mode === "list" && !l.options.length) D.loadLists().then(() => D.fillLists(l)).catch(() => {});
  }

  async function fetchTrades() {
    if (mode === "stock") { const s = root.querySelector("#cgQ").value.trim().toUpperCase().replace(/^\$/, ""); if (!/^[A-Z][A-Z0-9.]{0,9}$/.test(s)) throw new Error("Type a US ticker such as NVDA."); const d = await call("get_politician_trades", { equity_symbol: s }, 3600000); return (d && d.trades) || []; }
    if (mode === "person") { const n = root.querySelector("#cgQ").value.trim(); if (n.length < 3) throw new Error("Type at least three letters of a member's name."); const d = await call("get_politician_trades", { politician_name: n }, 3600000); return (d && d.trades) || []; }
    const id = root.querySelector("#cgList").value; if (!id) throw new Error("Choose a watchlist.");
    const it = await call("get_watchlist_items", { list_id: id }, 600000);
    const syms = ((it && it.items) || []).filter(i => i.object_type === "instrument" && i.symbol).map(i => i.symbol).slice(0, 40);
    let all = [];
    for (let i = 0; i < syms.length; i++) {
      root.querySelector("#cgOut").innerHTML = `<p class="muted">Reading disclosures ${i + 1} of ${syms.length}…</p>`;
      try { const d = await call("get_politician_trades", { equity_symbol: syms[i] }, 3600000); all = all.concat((d && d.trades) || []); } catch (e) { if (e.code !== "tool_error") throw e; }
    }
    return all;
  }

  async function run() {
    const out = root.querySelector("#cgOut"); out.innerHTML = '<p class="muted">Reading disclosures…</p>';
    try {
      const raw = await fetchTrades();
      const trades = raw.filter(t => t.symbol && (t.asset_type || "EQUITY") === "EQUITY" && /^\d{4}-\d{2}-\d{2}$/.test(t.disclosure_date || "") && /^\d{4}-\d{2}-\d{2}$/.test(t.transaction_date || ""))
        .map(t => ({ ...t, side: /buy|purchase/i.test(t.transaction_type) ? "BUY" : /sell|sale/i.test(t.transaction_type) ? "SELL" : t.transaction_type, lag: Math.round((Date.parse(t.disclosure_date) - Date.parse(t.transaction_date)) / 86400000) }))
        .sort((a, b) => b.disclosure_date.localeCompare(a.disclosure_date));
      if (!trades.length) { out.innerHTML = '<p class="muted">No disclosed stock trades came back for this search.</p>'; return; }
      const earliest = trades.reduce((m, t) => t.transaction_date < m ? t.transaction_date : m, "9999");
      const days = Math.min(1830, Math.ceil((Date.now() - Date.parse(earliest)) / 86400000) + 120);
      const syms = [...new Set(trades.map(t => t.symbol))].slice(0, 60);
      const bars = await D.dailyBars(syms.concat(["SPY"]), days, (i, n) => { out.innerHTML = `<p class="muted">Reading prices ${i} of ${n}…</p>`; });
      const spy = bars.SPY || [];
      const H = [20, 60];
      trades.forEach(t => { const b = bars[t.symbol]; if (!b || !b.length) return; t.ev = {}; t.evTrade = {}; H.forEach(h => { t.ev[h] = A.eventReturn(b, spy, t.disclosure_date, h); t.evTrade[h] = A.eventReturn(b, spy, t.transaction_date, h); }); });
      const row = (side, h, key) => { const xs = trades.filter(t => t.side === side && t[key] && t[key][h]).map(t => t[key][h].excess); return A.summarize(side === "SELL" ? xs.map(x => -x) : xs); };
      const buys = trades.filter(t => t.side === "BUY").length, sells = trades.filter(t => t.side === "SELL").length;
      const avgLag = A.mean(trades.map(t => t.lag));
      const b20 = row("BUY", 20, "ev"), b20t = row("BUY", 20, "evTrade");
      let line = `${trades.length} disclosed trades: ${buys} buys, ${sells} sells, disclosed ${avgLag.toFixed(0)} days after the trade on average. `;
      if (b20.n >= 5) line += `Copying the buys at the first open after disclosure beat SPY by ${pct(b20.mean)} on average over 20 sessions (${b20.n} trades, ${(b20.hit * 100).toFixed(0)}% beat it).`;
      else line += "Too few completed buys to test copying them.";
      const people = new Map(); trades.forEach(t => { const k = t.politician_name; if (!people.has(k)) people.set(k, { name: k, party: t.party, pos: t.position, b: 0, s: 0 }); const p = people.get(k); t.side === "BUY" ? p.b++ : p.s++; });
      const sumRow = (label, s) => s.n ? `<tr><td>${esc(label)}</td><td>${s.n}</td><td class="chg ${s.mean >= 0 ? "up" : "down"}">${pct(s.mean)}</td><td>${pct(s.median)}</td><td>${(s.hit * 100).toFixed(0)}%</td><td>${s.t == null ? "—" : s.t.toFixed(1)}</td></tr>` : `<tr><td>${esc(label)}</td><td>0</td><td colspan="4" class="muted">Not enough completed windows</td></tr>`;
      out.innerHTML = `
        <p class="verdict-line">${esc(line)}</p>
        <div class="panel"><div class="ph"><h2>Would copying have worked?</h2><span class="eyebrow">Return beyond SPY over the same days</span></div>
          <div class="scroll"><table class="dt"><thead><tr><th>Copy</th><th>Trades</th><th>Average vs SPY</th><th>Median</th><th>Beat SPY</th><th>t</th></tr></thead><tbody>
          ${sumRow("Buys, from disclosure, 20 sessions", b20)}${sumRow("Buys, from disclosure, 60 sessions", row("BUY", 60, "ev"))}
          ${sumRow("Sells (stock lagging SPY), from disclosure, 20 sessions", row("SELL", 20, "ev"))}${sumRow("Sells, from disclosure, 60 sessions", row("SELL", 60, "ev"))}
          ${sumRow("Buys, from the trade date (not possible in practice), 20 sessions", b20t)}
          </tbody></table></div>
          <div class="pb muted" style="font-size:12px">For sells, a positive number means the stock lagged SPY after the sale. The trade-date row shows what the disclosure delay costs: you only learn of a trade weeks later. Research is mixed: Senate trades beat the market in the 1990s (Ziobrowski and others, 2004); House portfolios lagged it in 2004 to 2008 (Eggers and Hainmueller, 2013).</div></div>
        <div class="panel" style="margin-top:18px"><div class="ph"><h2>Members</h2></div>
          <div class="scroll"><table class="dt"><thead><tr><th>Member</th><th>Party</th><th>Chamber</th><th>Buys</th><th>Sells</th></tr></thead><tbody>
          ${[...people.values()].sort((a, b) => (b.b + b.s) - (a.b + a.s)).slice(0, 25).map(p => `<tr class="clickable" tabindex="0" data-person="${esc(p.name)}"><td><b>${esc(p.name)}</b></td><td>${esc(p.party || "—")}</td><td>${esc(p.pos || "—")}</td><td>${p.b}</td><td>${p.s}</td></tr>`).join("")}
          </tbody></table></div></div>
        <div class="panel" style="margin-top:18px"><div class="ph"><h2>Disclosures</h2><span class="eyebrow">Newest first</span></div>
          <div class="scroll"><table class="dt"><thead><tr><th>Symbol</th><th>Member</th><th>Side</th><th>Amount range</th><th>Traded</th><th>Disclosed</th><th>Days late</th><th>Since disclosure vs SPY, 20 sessions</th></tr></thead><tbody>
          ${trades.slice(0, 150).map(t => { const e = t.ev && t.ev[20]; return `<tr><td><button class="btn small" type="button" data-sym="${esc(t.symbol)}">${esc(t.symbol)}</button></td><td>${esc(t.politician_name)}</td><td><span class="pill ${t.side === "BUY" ? "pass" : "fail"}">${esc(t.side)}</span></td><td>${t.amount_range ? money0(t.amount_range.min) + " – " + money0(t.amount_range.max) : "—"}</td><td>${esc(t.transaction_date)}</td><td>${esc(t.disclosure_date)}</td><td>${t.lag}</td><td class="chg ${e && e.excess >= 0 ? "up" : "down"}">${e && e.excess != null ? pct(e.excess) : "—"}</td></tr>`; }).join("")}
          </tbody></table></div></div>`;
    } catch (e) { out.innerHTML = '<div class="banner bad">' + esc(e.message) + "</div>"; }
  }

  D.register("congress", { mount(r) { root = r; if (D.needsLive(root)) return; shell(); if (mode === "stock") run(); } });
})();
