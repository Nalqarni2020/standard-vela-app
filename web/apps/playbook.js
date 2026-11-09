/* Playbook: when to trade (the market gate and the daily loss limit), how much (risk-based size), what is live
   (swing and day setups with entries, stops and sizes), whether the setups have paid (an honest backtest with a
   deflated Sharpe ratio), and what your own trades say. Read-only: it never places an order. */
(function () {
  "use strict";
  const D = window.Desk, A = window.Analytics, P = window.Playbook, E = D.E;
  const { esc, px, pct, int, money, call } = D;
  const DEF = { riskPct: 1, lossPct: 3, capPct: 25, costBps: 5, hold: 10, acctOverride: "", minPrice: 5, minDvM: 5, maxSpread: 0.5 };
  let cfg = Object.assign({}, DEF, D.load("pbCfg", {}));
  const saveCfg = () => D.save("pbCfg", cfg);
  const TABS = [["today", "Today"], ["scan", "Scanner"], ["movers", "Movers"], ["quality", "Quality"], ["size", "Size a trade"], ["manage", "Manage"], ["edge", "My edge"], ["evidence", "Evidence"]];
  let root, tab = D.load("pbTab", "today");
  // shared state
  let acct = null, acctValue = null, today = null, gateRes = null, sets = null, setsKey = "", ev = null, evKey = "";
  const mask = n => "••••" + String(n).slice(-4);
  const R = v => v == null || !isFinite(v) ? "—" : (v >= 0 ? "+" : "") + v.toFixed(2) + "R";
  const p0 = v => v == null || !isFinite(v) ? "—" : (v * 100).toFixed(0) + "%";
  const VERD = { go: ["Go", "pass", "Full size."], half: ["Half size", "", "Trade smaller: the market is mixed."], aside: ["Stand aside", "fail", "No new longs: the market is against them."] };
  const SHORTV = { holds: ["Held up", "pass"], maybe: ["Unproven", ""], no: ["Did not pay", "fail"], thin: ["Too few", ""] };
  const nyNow = () => E.ny(Date.now());
  const sessionNow = () => { const n = nyNow(); return !["Sat", "Sun"].includes(n.wd) && n.min >= 570 && n.min < 960; };

  /* ---------- data ---------- */
  async function vixBars() {
    const d = await call("get_indexes", { symbols: "VIX" }, 86400000);
    const ix = ((d && d.indexes) || []).find(x => x.symbol === "VIX"); if (!ix) return [];
    const h = await call("get_index_historicals", { instrument_ids: [ix.id], start_time: D.iso(Date.now() - 1100 * D.DAY), interval: "day" }, 3600000);
    const row = ((h && h.results) || []).find(r => r.instrument_id === ix.id);
    return ((row && row.bars) || []).filter(b => !b.interpolated).map(b => ({ t: Date.parse(b.begins_at), d: b.begins_at.slice(0, 10), o: +b.open_value, h: +b.high_value, l: +b.low_value, c: +b.close_value, v: 0 })).filter(b => isFinite(b.c) && b.c > 0);
  }
  let spyB = null, qqqB = null, vixB = null;
  async function macro() { if (!spyB) { const [s, v] = await Promise.all([D.dailyBars(["SPY", "QQQ"], 1100), vixBars().catch(() => [])]); spyB = s.SPY || []; qqqB = s.QQQ || []; vixB = v; } return { spy: spyB, qqq: qqqB, vix: vixB }; }
  async function listSets(msg) {
    const id = cfg.listId; if (!id) return [];
    const key = id; if (sets && setsKey === key) return sets;
    const syms = [...new Set(await D.listSymbols(id))].slice(0, 60);
    const bars = await D.dailyBars(syms, 1100, (i, n) => msg && msg(`Reading history ${i} of ${n}…`));
    sets = syms.map(sym => ({ sym, bars: bars[sym] || [] })).filter(s => s.bars.length >= 60).map(s => Object.assign(s, { x: P.prep(s.bars) }));
    // earnings history for the drift setup
    for (let i = 0; i < sets.length; i += 6) {
      msg && msg(`Reading earnings history ${Math.min(i + 6, sets.length)} of ${sets.length}…`);
      await Promise.all(sets.slice(i, i + 6).map(async z => { const res = await earnRes(z.sym); z.x.earn = res ? P.earnEvents(z.bars, res) : []; }));
    }
    setsKey = key; ev = null; return sets;
  }
  const liq = () => ({ minPrice: +cfg.minPrice || 0, minDollarVol: (+cfg.minDvM || 0) * 1e6 });
  function getEvidence() {
    const k = setsKey + "|" + cfg.hold + "|" + cfg.costBps + "|" + cfg.minPrice + "|" + cfg.minDvM;
    if (ev && evKey === k) return ev;
    const tr = D.load("pbTrials", { keys: [], srs: [] });
    ev = P.evidence(sets, { hold: +cfg.hold, cost: cfg.costBps / 10000, liq: liq(), trials: Math.max(P.SETUPS.length, tr.keys.length * P.SETUPS.length), priorSrs: tr.srs });
    if (!tr.keys.includes(k)) { tr.keys.push(k); ev.rows.forEach(r => { if (r.sr != null) tr.srs.push(+r.sr.toFixed(4)); }); tr.srs = tr.srs.slice(-400); D.save("pbTrials", tr); ev.trials = Math.max(P.SETUPS.length, tr.keys.length * P.SETUPS.length); ev.rows.forEach(r => { r.deflated = P.deflatedSharpe({ sr: r.sr, n: r.n, skew: r.skew, kurt: r.kurt, trials: ev.trials, srVar: P.variance(tr.srs) }); }); }
    evKey = k; return ev;
  }
  let wbAcct = null, wbBal = null, wbTried = false;
  async function webull() {
    if (wbTried) return; wbTried = true;
    try { wbAcct = await D.wb.account(); if (wbAcct) wbBal = await D.wb.balance(wbAcct.account_id); } catch (e) { wbAcct = null; wbBal = null; }
  }
  async function account() {
    webull().catch(() => {});
    if (acct && acctValue != null) return;
    const d = await call("get_accounts", {}, 600000);
    const list = ((d && d.accounts) || []).filter(a => a.state === "active" && !a.deactivated).sort((a, b) => (b.is_default ? 1 : 0) - (a.is_default ? 1 : 0));
    const saved = D.load("bookAcct", null); const a = list.find(x => x.account_number === saved) || list[0];
    if (!a) return; acct = a.account_number;
    const pf = await call("get_portfolio", { account_number: acct }, 30000); acctValue = +pf.total_value || null;
  }
  /* Saved plans live in this page's private database (only you can read your rows); without it, in this browser. */
  const Plans = {
    db: null, uid: null, ready: null,
    init() {
      if (!this.ready) this.ready = (async () => { try { const c = window.claude; if (!c || !c.use) return; const [db, user] = await Promise.all([c.use("db"), c.use("user")]); if (db && user) { const id = await user.id(); if (id) { this.db = db; this.uid = id; } } } catch (e) { this.db = null; } })();
      return this.ready;
    },
    col() { return this.db.collection("data/users/" + this.uid); },
    where() { return this.db ? "your private Playbook database" : "this browser only"; },
    async all() {
      await this.init();
      if (this.db) { try { const q = await this.col().get(); return q.docs.map(d => Object.assign({}, d.data(), { id: d.id })).filter(p => p.kind === "plan"); } catch (e) { /* fall through */ } }
      return D.load("pbPlans", []);
    },
    async add(p) {
      await this.init(); const rec = Object.assign({ kind: "plan", status: "open", created: new Date().toISOString() }, p);
      if (this.db) { const ref = await this.col().add(rec); return ref.id; }
      const all = D.load("pbPlans", []); rec.id = "p" + Date.now(); all.push(rec); D.save("pbPlans", all); return rec.id;
    },
    async update(id, patch) {
      await this.init();
      if (this.db) return this.col().doc(id).update(patch);
      D.save("pbPlans", D.load("pbPlans", []).map(p => p.id === id ? Object.assign({}, p, patch) : p));
    },
    async remove(id) {
      await this.init();
      if (this.db) return this.col().doc(id).delete();
      D.save("pbPlans", D.load("pbPlans", []).filter(p => p.id !== id));
    },
  };
  /* Next earnings report per symbol, from Robinhood's per-symbol earnings (cached for the page's life). */
  const repCache = new Map(), earnCache = new Map();
  /* Robinhood's last 8 quarters of earnings for one symbol (estimate, actual, report date and timing), cached. */
  function earnRes(sym) { if (!earnCache.has(sym)) earnCache.set(sym, call("get_earnings_results", { symbol: sym }, 6 * 3600000).then(d => (d && d.results) || []).catch(() => null)); return earnCache.get(sym); }
  async function nextRep(sym) {
    if (!repCache.has(sym)) repCache.set(sym, (async () => {
      const res = await earnRes(sym); if (!res) return undefined; const n = nyNow();
      return P.nextReport(res.map(r => ({ date: r.report && r.report.date, timing: r.report && r.report.timing })), n.date, n.min);
    })());
    return repCache.get(sym);
  }
  /* Realized sales on Robinhood over the last 3 months (for the wash-sale check), cached for the page's life. */
  let salesP = null;
  function recentSales() {
    if (!salesP) salesP = (async () => { await account().catch(() => {}); if (!acct) return []; let out = [], cursor = null, pages = 0;
      do { const d = await call("get_pnl_trade_history", Object.assign({ account_number: acct, span: "3month" }, cursor ? { cursor } : {}), 600000).catch(() => null); out = out.concat((d && d.trades) || []); cursor = d && d.next_cursor ? d.next_cursor : null; pages++; } while (cursor && pages < 10);
      return out; })();
    return salesP;
  }
  /* Signals log and decisions: this page's database. Every Scanner run (and the daily report) saves its setups here, and
     the Evidence tab follows each one forward. */
  let sdbP = null; const sigDb = () => sdbP || (sdbP = (async () => { try { const c = window.claude; return c && c.use ? await c.use("db") : null; } catch (e) { return null; } })());
  async function logSignals(hits) {
    const db = await sigDb(); if (!db) return null; let n = 0;
    for (const h of hits) {
      const id = `${h.d}_${h.sym}_${h.id}`.replace(/[^A-Za-z0-9_.\-]/g, "-"), ref = db.collection("signals").doc(id);
      try { const cur = await ref.get(); if (cur.exists) continue; const S = P.SETUPS.find(z => z.id === h.id);
        await ref.set({ sym: h.sym, setup: h.id, date: h.d, entry: +h.entry.toFixed(2), stop: +h.stop.toFixed(2), target: isFinite(h.target) ? +h.target.toFixed(2) : null, hold: S.trend ? S.maxHold : S.hold || +cfg.hold, gate: gateRes ? gateRes.verdict : null, logged: new Date().toISOString(), source: "desk" }); n++; } catch (e) { /* skip */ }
    }
    return n;
  }
  const repText = r => r === undefined ? "unknown" : r === null ? "none listed" : `${r.date} ${r.timing === "am" ? "before the open" : r.timing === "pm" ? "after the close" : ""}`.trim();
  const repCell = r => r === undefined ? '<span class="muted">?</span>' : r === null ? '<span class="muted">—</span>' : P.earningsInside(r, +cfg.hold) ? `<span class="pill fail" title="${esc(repText(r))}">In ${r.gapIn} session${r.gapIn === 1 ? "" : "s"}</span>` : `<span class="muted" title="${esc(repText(r))}">${esc(r.date.slice(5))}</span>`;
  async function positions() {
    let out = [], cursor = null, pages = 0;
    if (acct)
    do { const d = await call("get_equity_positions", Object.assign({ account_number: acct }, cursor ? { cursor } : {}), 30000); out = out.concat((d && d.positions) || []); cursor = d && d.next ? d.next : null; pages++; } while (cursor && pages < 10);
    const rh = out.filter(p => +p.quantity > 0 && (!p.type || p.type === "long")).map(p => ({ sym: p.symbol, qty: +p.quantity, avg: p.average_buy_price != null ? +p.average_buy_price : null, broker: "rh" }));
    await webull();
    const w = wbAcct ? await D.wb.positions(wbAcct.account_id).catch(() => null) : null;
    return rh.concat(w || []);
  }
  const BROKER = { rh: "Robinhood", wb: "Webull" };
  /* Holdings whose last 60 daily returns moved with the candidate at 0.7 or more. */
  async function concentration(sym, addValue) {
    const pos = (await positions()).filter(p => p.sym !== sym); if (!pos.length) return { pos: [], hits: [] };
    const syms = pos.map(p => p.sym), bars = await D.dailyBars(syms.concat([sym]), 120), q = await D.quotes(syms);
    const eq = sizingValue() || 1, out = [];
    for (const p of pos) {
      if (!(bars[p.sym] || []).length || !(bars[sym] || []).length) continue;
      const al = A.alignedReturns([bars[sym], bars[p.sym]], 60); if (al.dates.length < 30) continue;
      const c = A.correlation(al.rows[0], al.rows[1]), val = (D.lastPrice(q[p.sym]) || 0) * p.qty;
      if (c != null && c >= 0.7) out.push({ sym: p.sym, c, val });
    }
    out.sort((a, b) => b.c - a.c);
    return { pos, hits: out, together: (out.reduce((s, h) => s + h.val, 0) + (addValue || 0)) / eq };
  }
  // Which accounts sizing and the daily loss limit use: Robinhood, Webull or both together.
  const useRh = () => cfg.sizeFrom !== "wb", useWb = () => cfg.sizeFrom === "wb" || cfg.sizeFrom === "both";
  const sizingValue = () => +cfg.acctOverride > 0 ? +cfg.acctOverride : ((useRh() ? acctValue || 0 : 0) + (useWb() && wbBal ? wbBal.value || 0 : 0)) || null;
  // Robinhood counts closed sales only; Webull's day P&L includes open positions, so it can lock earlier, never later.
  const dayLoss = () => (useRh() && today ? today.realized : 0) + (useWb() && wbBal && wbBal.dayPL != null ? wbBal.dayPL : 0);
  async function todayStats() {
    const n = nyNow(); let realized = 0, sales = 0, buys = 0, cursor = null, pages = 0;
    do {
      const d = await call("get_pnl_trade_history", Object.assign({ account_number: acct, span: "month" }, cursor ? { cursor } : {}), 60000);
      ((d && d.trades) || []).forEach(t => { const ms = Date.parse(t.timestamp); if (t.realized_gain != null && isFinite(ms) && E.ny(ms).date === n.date) { realized += +t.realized_gain; sales++; } });
      cursor = d && d.next_cursor ? d.next_cursor : null; pages++;
    } while (cursor && pages < 10);
    const o = await call("get_equity_orders", { account_number: acct, state: "filled", created_at_gte: n.date }, 60000).catch(() => null);
    ((o && o.orders) || []).forEach(x => { const ex = (x.executions || []).map(z => Date.parse(z.timestamp)).filter(isFinite); const t = ex.length ? Math.max(...ex) : Date.parse(x.last_transaction_at || x.created_at); if (x.side === "buy" && isFinite(t) && E.ny(t).date === n.date) buys++; });
    return { date: n.date, realized, sales, buys };
  }
  const locked = () => !!((today || (useWb() && wbBal)) && sizingValue() && dayLoss() <= -cfg.lossPct / 100 * sizingValue());
  async function ensureGate(msg) {
    const m = await macro();
    let pct50 = null;
    if (cfg.listId) { const st = await listSets(msg); const ok = st.filter(s => s.x.s50[s.bars.length - 1] != null); pct50 = ok.length >= 10 ? ok.filter(s => s.bars[s.bars.length - 1].c > s.x.s50[s.bars.length - 1]).length / ok.length : null; }
    gateRes = P.gate(m.spy, m.vix, pct50); gateRes.pct50 = pct50; gateRes.asOf = m.spy.length ? m.spy[m.spy.length - 1].d : "";
    return gateRes;
  }
  // The gate is about longs; a short keeps only the volatility scaling (and the daily loss lock).
  const mult = short => locked() ? 0 : !gateRes ? 0.5 : short ? gateRes.volScale : gateRes.sizeMult;
  const plan = (entry, stop) => P.sizePlan({ account: sizingValue() || 0, riskPct: cfg.riskPct / 100, mult: mult(stop > entry), entry, stop, capPct: cfg.capPct / 100 });
  const sharesCell = s => !sizingValue() ? '<span class="muted">Set an account value</span>' : locked() ? '<span class="pill fail">Locked</span>' : s.shares === 0 ? `<span class="muted">${s.limitedBy === "gate" ? "Stand aside" : "Under 1 share"}</span>` : `<b>${int(s.shares)}</b>`;

  /* ---------- shell ---------- */
  function shell() {
    root.innerHTML = `
      <div class="app-h"><h1>Playbook</h1><p>When to trade, how much to risk, which setups are live, whether they have paid, and what your own trades say. Read-only: it never places an order.</p></div>
      <div class="tools" style="margin-bottom:14px;flex-wrap:wrap;gap:8px">
        <div class="seg" role="group" aria-label="Playbook sections" id="pbTabs" style="flex-wrap:wrap;max-width:100%">${TABS.map(([k, l]) => `<button type="button" data-t="${k}" aria-pressed="${k === tab}" style="white-space:nowrap">${l}</button>`).join("")}</div>
        <span class="muted" style="font-size:13px">List</span><select id="pbList" class="btn small" aria-label="List for breadth, scanner and evidence"></select>
      </div>
      ${TABS.map(([k]) => `<div data-pb="${k}" ${k === tab ? "" : "hidden"}></div>`).join("")}`;
    root.querySelector("#pbTabs").onclick = e => { const b = e.target.closest("button[data-t]"); if (!b) return; tab = b.dataset.t; D.save("pbTab", tab); root.querySelectorAll("#pbTabs button").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.t === tab))); root.querySelectorAll("[data-pb]").forEach(x => x.hidden = x.dataset.pb !== tab); show(); };
    root.querySelector("#pbList").onchange = e => { cfg.listId = e.target.value; saveCfg(); sets = null; ev = null; gateRes = null; drawn = {}; show(); };
    root.addEventListener("click", e => { if (e.target.closest("button, a, input, select")) return; const tr = e.target.closest("tr[data-sym]"); if (tr) D.openSymbol(tr.dataset.sym); });
  }
  let drawn = {};
  function show() { const box = root.querySelector(`[data-pb="${tab}"]`); if (drawn[tab]) return; drawn[tab] = true; ({ today: drawToday, scan: drawScan, movers: drawMovers, quality: drawQuality, size: drawSize, manage: drawManage, edge: drawEdge, evidence: drawEvidence })[tab](box); }
  const busy = (box, t) => { box.innerHTML = `<p class="muted">${esc(t)}</p>`; };
  const fail = (box, e) => { box.innerHTML = '<div class="banner bad">' + esc(e.message || String(e)) + "</div>"; };
  const field = (id, label, val, step, extra) => `<label class="field"><span>${esc(label)}</span><input id="${id}" type="number" inputmode="decimal" step="${step}" value="${esc(String(val))}" ${extra || ""}></label>`;

  /* ---------- Today ---------- */
  async function drawToday(box) {
    box.innerHTML = `
      <div id="pbGate"><p class="muted">Reading the market…</p></div>
      <div id="pbBottom" style="margin-top:18px"></div>
      <div class="grid2" style="margin-top:18px">
        <div class="panel"><div class="ph"><h2>Your limits</h2><span class="eyebrow">Kept on this device</span></div>
          <div class="pb"><div class="form">
            ${field("pbRisk", "Risk per trade (% of account)", cfg.riskPct, "0.1", 'min="0.1" max="5"')}
            ${field("pbLoss", "Daily loss limit (% of account)", cfg.lossPct, "0.5", 'min="0.5" max="20"')}
            ${field("pbCap", "Largest position (% of account)", cfg.capPct, "1", 'min="1" max="100"')}
            ${field("pbCost", "Cost per side, for tests (basis points)", cfg.costBps, "1", 'min="0" max="100"')}
            <label class="field"><span>Size from</span><select id="pbFrom"><option value="rh">Robinhood account</option><option value="wb">Webull account</option><option value="both">Both together</option></select></label>
            ${field("pbAcct", "Account value for sizing (blank = from the brokers)", cfg.acctOverride, "100", 'min="0" placeholder="From your brokers"')}
            ${field("pbMinPx", "Skip stocks under this price ($)", cfg.minPrice, "1", 'min="0"')}
            ${field("pbMinDv", "Skip under this daily dollar volume ($ millions, 20-day)", cfg.minDvM, "1", 'min="0"')}
            ${field("pbSpread", "Flag a bid-ask spread wider than (%)", cfg.maxSpread, "0.1", 'min="0"')}
          </div>
          <p class="muted" style="font-size:12px;margin:10px 0 0">Risking about 1% a trade is a common professional limit: ten losses in a row cost about 10%, which is recoverable. Full Kelly sizing is too aggressive when the edge is estimated from a few dozen trades. Thin stocks are skipped because spreads and slippage eat a small edge.</p></div></div>
        <div class="panel"><div class="ph"><h2>Today's account</h2><span class="eyebrow" id="pbDay"></span></div><div id="pbAcctBox" class="pb"><p class="muted" style="margin:0">Reading the account…</p></div></div>
      </div>`;
    const bind = (id, key) => { box.querySelector("#" + id).onchange = e => { cfg[key] = e.target.value === "" ? "" : +e.target.value; saveCfg(); drawn = { today: true }; renderAcct(box); renderGate(box); }; };
    bind("pbRisk", "riskPct"); bind("pbLoss", "lossPct"); bind("pbCap", "capPct"); bind("pbCost", "costBps"); bind("pbAcct", "acctOverride"); box.querySelector("#pbFrom").value = cfg.sizeFrom || "rh"; box.querySelector("#pbFrom").onchange = e => { cfg.sizeFrom = e.target.value; saveCfg(); drawn = { today: true }; renderAcct(box); }; bind("pbMinPx", "minPrice"); bind("pbMinDv", "minDvM"); bind("pbSpread", "maxSpread");
    try { await account(); await webull(); today = await todayStats().catch(() => null); } catch (e) { box.querySelector("#pbAcctBox").innerHTML = '<div class="banner bad">' + esc(e.message) + "</div>"; }
    renderAcct(box);
    try { await ensureGate(t => { const g = box.querySelector("#pbGate"); if (g) busy(g, t); }); renderGate(box); renderBottom(box); } catch (e) { fail(box.querySelector("#pbGate"), e); }
  }
  function renderAcct(box) {
    const el = box.querySelector("#pbAcctBox"); if (!el) return;
    const v = sizingValue(), limit = v ? cfg.lossPct / 100 * v : null;
    box.querySelector("#pbDay").textContent = today ? "New York " + today.date : "";
    const lk = locked();
    el.innerHTML = (lk ? `<div class="banner bad" style="margin-bottom:10px"><b>Daily loss limit reached.</b> Loss today ${esc(money(dayLoss()))}, past your limit of ${esc(money(-limit))}. Sizes are set to zero for the rest of the day. Stopping after a set loss keeps one bad day from becoming a bad month.</div>` : "") +
      `<div class="kv four">${D.kv([["Account value", money(v)], ["Account", acct ? mask(acct) : "—"], ["Realized today (Robinhood)", today ? money(today.realized) : "—"], ["Loss limit left", limit != null ? money(Math.max(0, limit + Math.min(0, dayLoss()))) : "—"], ["Risk per trade", v ? money(v * cfg.riskPct / 100) : "—"], ["Buys today", today ? String(today.buys) : "—"]])}</div>` +
      (today && today.buys >= 5 ? `<p style="margin:10px 0 0;font-size:13px"><b>${today.buys} buys today.</b> In large studies of brokerage accounts the most active traders earned the least after costs (Barber and Odean, 2000). Check the My edge tab for how your busy days went.</p>` : "") +
      (wbAcct ? `<div class="kv four" style="margin-top:10px">${D.kv([["Webull account", wbBal ? money(wbBal.value) : "—"], ["Webull cash", wbBal ? money(wbBal.cash) : "—"], ["Webull day P&L", wbBal ? money(wbBal.dayPL) : "—"], ["Webull unrealized", wbBal ? money(wbBal.unrealized) : "—"]])}</div>` : `<p class="muted" style="font-size:12px;margin:10px 0 0">${esc(D.wb.state === "off" ? D.wb.why() + " Robinhood only." : "Webull: not read yet.")}</p>`) +
      '<p class="muted" style="font-size:12px;margin:10px 0 0">Sizing uses ' + (cfg.sizeFrom === "wb" ? "the Webull account" : cfg.sizeFrom === "both" ? "Robinhood and Webull together" : "the Robinhood account") + '. Robinhood\'s figure counts closed sales only; Webull\'s day P&amp;L also counts open positions, so with Webull included the lock can come earlier, never later. Options and crypto are not included.</p>';
  }
  /* Bottom watch: the five signs of a market bottom on SPY and QQQ, scored the same way every day. */
  function renderBottom(box) {
    const el = box.querySelector("#pbBottom"); if (!el || !spyB) return;
    const leaders = (sets || []).map(z => ({ bars: z.bars }));
    const W = [["SPY", P.bottomWatch(spyB, vixB || [], leaders)], ["QQQ", P.bottomWatch(qqqB || [], vixB || [], leaders)]];
    const mark = v => v ? '<span class="pill pass">Yes</span>' : '<span class="pill">Not yet</span>';
    const cell = (w, k) => {
      if (!w || !w.capitulation) return k === 0 ? '<span class="muted">No capitulation day in 25 sessions</span>' : "—";
      if (k === 0) return mark(true) + ` <span class="muted">${esc(w.capitulation.d)} · ${pct(w.capitulation.ret)} on ${w.capitulation.volX.toFixed(1)}× volume</span>`;
      if (k === 1) return mark(w.signs[1]) + (w.fear ? ` <span class="muted">VIX ${px(w.fear.from)} → ${px(w.fear.peak)} (${pct(w.fear.chg)})</span>` : "");
      if (k === 2) return w.slows ? mark(w.signs[2]) + ` <span class="muted">range ${(w.slows.rangeRatio * 100).toFixed(0)}%, volume ${(w.slows.volRatio * 100).toFixed(0)}% of that day</span>` : '<span class="muted">Needs 3 sessions after it</span>';
      if (k === 3) return w.leaders ? mark(w.signs[3]) + ` <span class="muted">${w.leaders.held} of ${w.leaders.n} list leaders above their low</span>` : '<span class="muted">Choose a list</span>';
      const r = w.rally;
      return r.ftd ? mark(true) + ` <span class="muted">${esc(r.ftd.d)}, day ${r.ftd.day}, ${pct(r.ftd.ret)}</span>` : mark(false) + ` <span class="muted">${r.day1 ? `rally day ${r.dayCount}${r.earliestFtdIn ? `; earliest in ${r.earliestFtdIn} session${r.earliestFtdIn === 1 ? "" : "s"}` : ""}` : "no up close since the low"}; restarts below ${px(r.low)}</span>`;
    };
    const STATE = { none: ["No bottom process", ""], early: ["Early", ""], forming: ["A bottom may be forming", ""], confirmed: ["Confirmed", "pass"] };
    el.innerHTML = `<div class="panel"><div class="ph"><h2>Bottom watch</h2><span class="eyebrow">You don't predict bottoms, you confirm them</span></div>
      <div class="scroll"><table class="dt"><thead><tr><th>Sign</th>${W.map(([s0, w]) => `<th style="text-align:start">${s0} <span class="pill ${w ? STATE[w.state][1] : ""}">${esc(w ? STATE[w.state][0] : "—")}</span></th>`).join("")}</tr></thead><tbody>
      ${["1. Capitulation volume", "2. Fear spike", "3. Selling slows", "4. Leaders hold up", "5. Follow-through day"].map((lbl, k) => `<tr><td><b>${lbl}</b></td>${W.map(([, w]) => `<td style="white-space:normal;text-align:start">${cell(w, k)}</td>`).join("")}</tr>`).join("")}
      </tbody></table></div>
      <div class="pb muted" style="font-size:12px">Capitulation: a day down 2.5% or more on twice the 50-day volume, in the last 25 sessions. Fear: the VIX up 40% or more around it. Selling slows: the last 3 sessions' range at most 60% and volume at most 70% of that day's. Leaders: the list's top third by 3-month strength before it, 60% of them still above their low from that day. Follow-through (O'Neil): day 4 or later of a rally attempt, up 1.25% or more on higher volume than the day before; a trade below the low starts the count again. Signs 1 to 4 say a bottom may be forming; only sign 5 confirms, and even then many follow-through days fail, so start small. Closed bars only.</div></div>`;
  }
  function renderGate(box) {
    const g = gateRes, el = box.querySelector("#pbGate"); if (!g || !el) return;
    const [name, cls, line] = VERD[g.verdict];
    el.innerHTML = `
      <p class="verdict-line"><span class="pill ${cls}" style="font-size:13px;vertical-align:middle">${esc(name)}</span> ${esc(line + ` Size multiplier ${g.sizeMult.toFixed(2)}×` + (g.volScale < 1 ? ` (${(g.mult).toFixed(1)}× from the gate, ${g.volScale.toFixed(2)}× because the VIX is above its one-year median of ${g.vixMedian.toFixed(1)}).` : "."))}</p>
      <div class="panel"><div class="ph"><h2>The market gate</h2><span class="eyebrow">S&amp;P and VIX closes to ${esc(g.asOf)}</span></div>
        <div class="scroll"><table class="xt"><tbody>${g.parts.map(p => `<tr><td><b>${esc(p.label)}</b><span class="note">${esc(p.how)}</span></td><td class="v">${esc(p.id === "trend" ? (p.value === "—" ? "—" : pct(p.value) + " vs 200-day") : p.id === "breadth" ? (p.value == null ? "Choose a list" : p0(p.value)) : p.id === "vix" ? (p.value == null ? "—" : px(p.value) + " vs " + px(p.v20)) : p.id === "stress" ? (p.value == null ? "—" : px(p.value)) : String(p.value))}</td><td><span class="pill ${p.pts > 0 ? "pass" : p.pts < 0 ? "fail" : ""}">${p.pts > 0 ? "+1" : p.pts < 0 ? "−1" : "0"}</span></td></tr>`).join("")}</tbody></table></div>
        <div class="pb muted" style="font-size:12px">Score ${g.score > 0 ? "+" : ""}${g.score}. Go needs +2 or better with the S&amp;P above its 200-day and the VIX at 30 or lower. Stand aside at −1 or worse, or with the VIX above 35. Anything else is half size. The gate is for long trades. It also feeds every size on the Scanner and Size a trade tabs.</div></div>`;
  }

  /* ---------- Scanner ---------- */
  async function drawScan(box) {
    box.innerHTML = `<div class="tools" style="margin-bottom:12px"><button class="btn small primary" id="pbScanRun" type="button">Scan the list</button><span class="muted" style="font-size:13px" id="pbScanNote"></span></div><div id="pbScanOut"><p class="muted">Scanning…</p></div>`;
    box.querySelector("#pbScanRun").onclick = () => scan(box);
    scan(box);
  }
  let scanHits = [];
  // Robinhood consensus: share of Buy ratings and the average target against the entry.
  const insCell = c => !c ? '<span class="muted">—</span>' : c.latest && Date.now() - Date.parse(c.latest.end) < 120 * 864e5 ? `<span class="pill pass" title="${esc(c.latest.insiders + " insiders, about " + money(c.latest.value) + ", " + c.latest.d + (c.latest.end !== c.latest.d ? " to " + c.latest.end : ""))}">Cluster ${esc(c.latest.end.slice(5))}</span>` : c.buys ? `<span class="muted">${c.buys} buy${c.buys === 1 ? "" : "s"}</span>` : '<span class="muted">none</span>';
  const anCell = (a, px0) => !a || !a.n ? '<span class="muted">—</span>' : `<span title="${esc(a.buy + " buy, " + a.hold + " hold, " + a.sell + " sell; targets " + (a.low ?? "—") + " to " + (a.high ?? "—"))}">${Math.round(a.buy / a.n * 100)}% buy${a.mean ? ` · <span class="chg ${a.mean >= px0 ? "up" : "down"}">${pct(a.mean / px0 - 1)}</span>` : ""}</span>`;
  async function scan(box) {
    const out = box.querySelector("#pbScanOut"), btn = box.querySelector("#pbScanRun"); btn.disabled = true;
    try {
      if (!cfg.listId) { out.innerHTML = '<p class="muted">Choose a list above.</p>'; btn.disabled = false; return; }
      await account().catch(() => {}); if (!today && acct) today = await todayStats().catch(() => null);
      await ensureGate(t => busy(out, t));
      const st = await listSets(t => busy(out, t)); busy(out, "Testing the setups on the list's history…");
      await new Promise(r => setTimeout(r, 0));
      const evd = getEvidence();
      const rowsEv = Object.fromEntries(evd.rows.map(r => [r.id, r]));
      const hits = [], thin = st.filter(s => !P.liquid(s.bars, s.x, s.bars.length - 1, liq())).map(s => s.sym);
      st.forEach(s => { const i = s.bars.length - 1; P.setupsAt(s.bars, s.x, i, liq()).forEach(h => { const mine = (evd.bySym[s.sym] || []).filter(t => t.id === h.id); hits.push(Object.assign(h, { sym: s.sym, last: s.bars[i].c, d: s.bars[i].d, atr: s.x.atr[i], volUp: s.x.v20[i] != null && s.x.v20[i - 20] != null ? s.x.v20[i] > s.x.v20[i - 20] : null, plan: plan(h.entry, h.stop), list: rowsEv[h.id], mine: mine.length ? P.rSummary(mine) : null })); }); });
      hits.sort((a, b) => ((b.list && b.list.expR) || -9) - ((a.list && a.list.expR) || -9) || (b.rr || 0) - (a.rr || 0));
      busy(out, "Checking earnings dates and spreads…");
      const hs = [...new Set(hits.map(x => x.sym))].slice(0, 30), reps = {}; await Promise.all(hs.map(async sy => { reps[sy] = await nextRep(sy); }));
      const qs = sessionNow() && hs.length ? await D.quotes(hs).catch(() => ({})) : {};
      const an = await D.rhAnalyst(hs).catch(() => ({}));
      busy(out, "Checking insider buying and recent sales…");
      const rs = P.rsRanks(st), ins = {}, sales = await recentSales().catch(() => []);
      for (let i = 0; i < hs.length; i += 4) await Promise.all(hs.slice(i, i + 4).map(async sy => { const t = await D.wb.insiders(sy).catch(() => null); ins[sy] = t ? P.insiderClusters(t) : null; }));
      const nowMs = Date.now();
      hits.forEach(x => { x.an = an[x.sym]; x.rep = reps[x.sym]; const q = qs[x.sym]; x.spread = q && q.bid > 0 && q.ask > q.bid ? (q.ask - q.bid) / ((q.ask + q.bid) / 2) : null;
        x.rs = rs[x.sym]; x.ins = ins[x.sym]; x.wash = P.washSale(sales, x.sym, nowMs); });
      scanHits = hits;
      const [gname, gcls] = VERD[gateRes.verdict];
      let h = `<p class="verdict-line" style="font-size:18px"><span class="pill ${gcls}" style="vertical-align:middle">${esc(gname)}</span> ${esc(`${hits.length} swing setup${hits.length === 1 ? "" : "s"} on ${st.length} names, from closes to ${st[0] ? st[0].bars[st[0].bars.length - 1].d : "—"}. ` + (locked() ? "Sizes are zero: the daily loss limit is reached." : `Sizes use ${mult().toFixed(2)}× of your ${cfg.riskPct}% risk.`))}</p>`;
      h += `<div class="panel"><div class="ph"><h2>Swing setups</h2><span class="eyebrow">Buy-stop orders for the next session</span></div>
        <div class="scroll"><table class="dt"><thead><tr><th>Symbol</th><th>Setup</th><th>Last close</th><th>Buy above</th><th>Stop</th><th>Target</th><th>Reward : risk</th><th>Shares</th><th>Risk</th><th>Setup on the list</th><th>On this name</th><th>Volume trend</th><th>RS rank</th><th>Insiders</th><th>Earnings</th><th>Analysts</th><th></th></tr></thead><tbody>
        ${hits.length ? hits.map(x => `<tr class="clickable" tabindex="0" data-sym="${esc(x.sym)}"><td><b>${esc(x.sym)}</b></td><td>${esc(P.SETUPS.find(s => s.id === x.id).short)}</td><td>${px(x.last)}</td><td>${px(x.entry)}</td><td>${px(x.stop)} <span class="muted">${(x.risk / x.atr).toFixed(1)} ATR</span></td><td>${x.trend ? '<span class="muted">Trend exit</span>' : px(x.target)}</td><td>${x.rr == null ? '<span class="muted">open</span>' : x.rr.toFixed(1)}</td><td>${sharesCell(x.plan)}</td><td>${x.plan.shares ? money(x.plan.riskDollars) : "—"}</td>
          <td>${x.list && x.list.n ? `<span class="chg ${x.list.expR >= 0 ? "up" : "down"}">${R(x.list.expR)}</span> <span class="muted">${x.list.n}</span> <span class="pill ${SHORTV[x.list.verdict.key][1]}" title="${esc(x.list.verdict.text)}">${SHORTV[x.list.verdict.key][0]}</span>` : "—"}</td><td>${x.mine ? `<span class="chg ${x.mine.expR >= 0 ? "up" : "down"}">${R(x.mine.expR)}</span> <span class="muted">${x.mine.n}</span>` : '<span class="muted">none</span>'}</td><td>${x.volUp == null ? "—" : x.volUp ? '<span class="chg up" title="20-day average volume above its level 20 sessions ago">Rising</span>' : '<span class="chg down" title="20-day average volume below its level 20 sessions ago">Falling</span>'}</td><td>${x.rs ? `<span class="chg ${x.rs.rank >= 70 ? "up" : x.rs.rank <= 30 ? "down" : ""}" title="12-month return skipping the last month: ${esc(pct(x.rs.m))}">${x.rs.rank}</span>` : "—"}</td><td>${insCell(x.ins)}</td><td>${repCell(x.rep)}${x.wash && x.wash.risk ? ` <span class="pill fail" title="Sold at a loss on ${esc(x.wash.lastSale)} (${esc(money(x.wash.loss))}). Buying again before ${esc(x.wash.clearAfter)} defers that loss for taxes.">Wash sale until ${esc(x.wash.clearAfter.slice(5))}</span>` : ""}${x.spread != null && x.spread * 100 > cfg.maxSpread ? ` <span class="pill fail" title="Bid-ask spread now">Spread ${(x.spread * 100).toFixed(1)}%</span>` : ""}</td><td>${anCell(x.an, x.entry)}</td><td><button class="btn small" type="button" data-plan="${hits.indexOf(x)}">Save plan</button></td></tr>`).join("") : '<tr><td colspan="17" class="muted">No setups on the last close.</td></tr>'}
        </tbody></table></div>
        <div class="pb muted" style="font-size:12px">${P.SETUPS.map(s => `<b>${esc(s.short)}:</b> ${esc(s.rule)}`).join(" ")} Stops are held between 0.75 and 2.5 ATR from the entry. Names under $${esc(String(cfg.minPrice))} or trading under $${esc(String(cfg.minDvM))} million a day are skipped${thin.length ? " (" + esc(thin.join(", ")) + ")" : ""}. RS rank: the 12-month return skipping the last month, ranked 1 to 99 across the list (momentum; Jegadeesh and Titman, 1993). Insiders: two or more different insiders buying on the open market within 30 days (grants and option awards excluded; Cohen, Malloy and Pomorski, 2012). A wash-sale pill means you sold this stock at a loss on Robinhood in the last 30 days: buying it back before the date shown defers that loss for US taxes (two funds on the same stock may also count; ask a tax adviser). Every setup shown is saved to the signals log and followed forward on the Evidence tab. Volume trend: the 20-day average volume against its level 20 sessions earlier; on your list, setups taken with rising volume have done better (see Evidence). Analysts: Robinhood's share of Buy ratings and the average price target against the entry; context, not a rule. A red earnings pill means a report lands within the ${cfg.hold}-session hold: a gap can jump the stop, so the real loss can be several R. "On the list" is this exact rule's backtest on the list (${cfg.hold}-day time exit, ${cfg.costBps} bp a side); see Evidence. An order not filled next session is cancelled.</div></div>`;
      out.innerHTML = h + '<div id="pbDayBox" style="margin-top:18px"></div>';
      out.querySelectorAll("button[data-plan]").forEach(b => b.onclick = async () => {
        const x = scanHits[+b.dataset.plan]; b.disabled = true;
        try { await Plans.add({ sym: x.sym, side: "long", entry: +x.entry.toFixed(2), stop: +x.stop.toFixed(2), target: isFinite(x.target) ? +x.target.toFixed(2) : null, shares: x.plan.shares, setup: x.id, gate: gateRes.verdict, date: nyNow().date, hold: +cfg.hold }); b.textContent = "Saved"; D.toast && D.toast("Plan saved for " + x.sym); }
        catch (e) { b.disabled = false; b.textContent = "Not saved"; }
      });
      btn.disabled = false;
      logSignals(hits).then(nn => { const el = box.querySelector("#pbScanNote"); if (el && nn != null) el.textContent = nn ? `${nn} new signal${nn === 1 ? "" : "s"} saved to the forward record` : "Signals already in the forward record"; }).catch(() => {});
      dayScan(out.querySelector("#pbDayBox"), st.map(s => s.sym));
    } catch (e) { fail(out, e); btn.disabled = false; }
  }
  async function bars5Today(sym) {
    const n = nyNow(); const d = await call("get_equity_historicals", { symbols: [sym], start_time: n.date + "T13:00:00Z", interval: "5minute", bounds: "regular", adjustment_type: "split" }, 60000);
    return E.parseBars((((d && d.results) || []).find(x => x.symbol === sym) || {}).bars).filter(b => E.ny(b.t).date === n.date && b.t + 300000 <= Date.now());
  }
  async function dayScan(box, syms) {
    const head = '<div class="panel"><div class="ph"><h2>Day setups</h2><span class="eyebrow">Live session only</span></div>';
    if (!sessionNow()) { box.innerHTML = head + '<div class="pb muted">Day setups show during the regular session, 9:35 to 16:00 New York time. They are: the 5-minute opening-range breakout on stocks in play (Zarattini, Barbon and Aziz, 2024) and the last-half-hour momentum signal for SPY and QQQ (Gao, Han, Li and Zhou, 2018).</div></div>'; return; }
    box.innerHTML = head + '<div class="pb muted">Reading today\'s volume…</div></div>';
    try {
      const n = nyNow(), all = syms.concat(["SPY", "QQQ"]);
      const q = await D.quotes(all), funds = {};
      for (let i = 0; i < syms.length; i += 10) { try { const f = await call("get_equity_fundamentals", { symbols: syms.slice(i, i + 10) }, 60000); ((f && f.results) || []).forEach(x => { funds[x.symbol] = x; }); } catch (e) {} }
      const rows = syms.map(s => { const qq = q[s], f = funds[s]; if (!qq || !f) return null; const gap = qq.prev ? qq.last / qq.prev - 1 : null; const rv = P.projRvol(+f.volume, +f.average_volume_2_weeks, n.min); return { sym: s, last: qq.last, gap, rv }; }).filter(r => r && r.rv != null && r.gap != null);
      const okLiq = new Set((sets || []).filter(s => P.liquid(s.bars, s.x, s.bars.length - 1, liq())).map(s => s.sym));
      rows.forEach(r => { const qq = q[r.sym]; r.spread = qq && qq.bid > 0 && qq.ask > qq.bid ? (qq.ask - qq.bid) / ((qq.ask + qq.bid) / 2) : null; });
      const play = rows.filter(r => r.rv >= 2 && Math.abs(r.gap) >= 0.03 && okLiq.has(r.sym) && !(r.spread != null && r.spread * 100 > cfg.maxSpread)).sort((a, b) => b.rv - a.rv).slice(0, 8);
      for (const r of play) { try { r.orb = P.orbPlan(await bars5Today(r.sym), n.min); if (r.orb.entry) r.plan = plan(r.orb.entry, r.orb.stop); } catch (e) { r.orb = { state: "nodata" }; } }
      const idx = [];
      for (const s of ["SPY", "QQQ"]) { try { const b = await bars5Today(s); idx.push({ s, hh: P.halfHour(b, q[s] && q[s].prev, n.min) }); } catch (e) {} }
      const ST = { forming: "First bar forming", nodata: "No bars yet", flat: "First bar flat: no trade", waiting: "Waiting for the break", triggered: "Triggered", stopped: "Stopped out" };
      box.innerHTML = head + `<div class="scroll"><table class="dt"><thead><tr><th>Symbol</th><th>Change</th><th>Relative volume (projected)</th><th>Side</th><th>Entry</th><th>Stop</th><th>Shares</th><th>Risk</th><th>Status</th></tr></thead><tbody>
        ${play.length ? play.map(r => `<tr class="clickable" tabindex="0" data-sym="${esc(r.sym)}"><td><b>${esc(r.sym)}</b></td><td class="chg ${r.gap >= 0 ? "up" : "down"}">${pct(r.gap)}</td><td>${r.rv.toFixed(1)}×</td><td>${r.orb && r.orb.dir ? (r.orb.dir > 0 ? "Long" : "Short") : "—"}</td><td>${px(r.orb && r.orb.entry)}</td><td>${px(r.orb && r.orb.stop)}</td><td>${r.plan ? sharesCell(r.plan) : "—"}</td><td>${r.plan && r.plan.shares ? money(r.plan.riskDollars) : "—"}</td><td>${esc(ST[r.orb ? r.orb.state : "nodata"] || "—")}</td></tr>`).join("") : '<tr><td colspan="9" class="muted">No stock on the list is in play right now (projected relative volume 2× or more, a move of 3% or more, liquid enough and a spread within your limit).</td></tr>'}
        </tbody></table></div>
        <div class="pb" style="font-size:13px">${idx.map(x => `<b>${x.s} last half hour:</b> ${esc(x.hh.state === "forming" ? "the signal is set at 10:00." : (x.hh.dir > 0 ? "lean long" : x.hh.dir < 0 ? "lean short" : "no lean") + ` (${pct(x.hh.r)} from yesterday's close to 10:00); ` + (x.hh.state === "waiting" ? "the window is 15:30 to 16:00." : x.hh.state === "window" ? "the window is open now, to the close." : "today's window has closed."))}`).join("<br>")}</div>
        <div class="pb muted" style="font-size:12px">Opening range: the first 5-minute bar's direction sets the side; the entry is a cent beyond its far end and the stop a cent beyond the other end; exit at the stop or the close. Shorts are shown for completeness; the market gate covers longs only. Relative volume is projected to a full day from a typical U-shaped volume curve, so it is approximate. Test both setups on your names in Vela, Edge lab, part 4.</div></div>`;
    } catch (e) { box.innerHTML = head + '<div class="pb"><div class="banner bad">' + esc(e.message) + "</div></div></div>"; }
  }

  /* ---------- Movers: Webull's market-wide rankings, checked and graded ---------- */
  const BOARDS = [
    ["g1", "Today's gainers", { kind: "move", rank: "DAY_1", dir: "DESC" }, 1],
    ["l1", "Today's losers", { kind: "move", rank: "DAY_1", dir: "ASC" }, 1],
    ["g5", "5-day gainers", { kind: "move", rank: "DAY_5", dir: "DESC" }, 5],
    ["l5", "5-day losers", { kind: "move", rank: "DAY_5", dir: "ASC" }, 5],
    ["gm", "1-month gainers", { kind: "move", rank: "MONTH_1", dir: "DESC" }, 21],
    ["lm", "1-month losers", { kind: "move", rank: "MONTH_1", dir: "ASC" }, 21],
    ["vd", "Volume leaders (dollars traded)", { kind: "active", rank: "TURNOVER" }, 1],
    ["vr", "Unusual volume (vs 10-day average)", { kind: "active", rank: "RELATIVE_VOLUME_10D" }, 1],
    ["gu", "Gap up", { kind: "gap", dir: 1 }, 1],
    ["gd", "Gap down", { kind: "gap", dir: -1 }, 1],
  ];
  const STUDY_OF = { g5: "g5", l5: "l5", gu: "gu", gd: "gd", vd: null, vr: null };
  let mvStudy = null, mvStudyKey = "";
  const preMarket = () => { const n = nyNow(); return !["Sat", "Sun"].includes(n.wd) && n.min >= 240 && n.min < 570; };
  const sessionStarted = () => { const n = nyNow(); return !["Sat", "Sun"].includes(n.wd) && n.min >= 570; };
  async function boardRows(id) {
    const B = BOARDS.find(z => z[0] === id), q = B[2];
    if (q.kind !== "gap") return { rows: await D.wb.ranking(q.kind, q.rank, q.dir), note: "" };
    if (preMarket()) {
      const r = await D.wb.ranking("move", "PRE_MARKET", q.dir > 0 ? "DESC" : "ASC");
      return { rows: r && r.map(x => Object.assign(x, { gap: x.chg, indicated: true })), note: "Before the open: the gap is the pre-market price against yesterday's close, so it can change by 9:30." };
    }
    const lists = await Promise.all([D.wb.ranking("move", "DAY_1", "DESC"), D.wb.ranking("move", "DAY_1", "ASC"), D.wb.ranking("active", "TURNOVER"), D.wb.ranking("active", "RELATIVE_VOLUME_10D")]);
    if (lists.every(l => !l)) return { rows: null, note: "" };
    const seen = new Map(); lists.forEach(l => (l || []).forEach(r => { if (!seen.has(r.sym)) seen.set(r.sym, r); }));
    const rows = [...seen.values()].filter(r => r.open > 0 && r.prev > 0).map(r => Object.assign(r, { gap: r.open / r.prev - 1 })).filter(r => q.dir > 0 ? r.gap >= 0.02 : r.gap <= -0.02).sort((a, b) => q.dir > 0 ? b.gap - a.gap : a.gap - b.gap);
    return { rows, note: "Gaps are found among the day's top 100 gainers, losers, dollar-volume and relative-volume names: the open against yesterday's close, 2% or more." };
  }
  function drawMovers(box) {
    const cur = D.load("pbBoard", "g5");
    box.innerHTML = `<div class="tools" style="margin-bottom:12px;flex-wrap:wrap;gap:8px">
        <label class="muted" style="font-size:13px" for="pbBoard">Board</label><select id="pbBoard" class="btn small">${BOARDS.map(([k, l]) => `<option value="${k}" ${k === cur ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
        <button class="btn small primary" id="pbMvRun" type="button">Refresh</button>
        <label style="font-size:13px;display:inline-flex;gap:6px;align-items:center"><input type="checkbox" id="pbMvAll"> Show what was filtered out</label>
        <span class="muted" style="font-size:13px" id="pbMvNote"></span></div>
      <div id="pbMvOut"><p class="muted">Reading Webull's rankings…</p></div>
      <div id="pbMvStudy" style="margin-top:18px"></div>`;
    const go = () => movers(box, box.querySelector("#pbBoard").value);
    box.querySelector("#pbBoard").onchange = e => { D.save("pbBoard", e.target.value); go(); };
    box.querySelector("#pbMvRun").onclick = go;
    box.querySelector("#pbMvAll").onchange = () => { const t = box.querySelector("#pbMvOut table"); if (t) t.querySelectorAll("tr.rej").forEach(r => r.hidden = !box.querySelector("#pbMvAll").checked); };
    go();
  }
  let mvSeq = 0;
  async function movers(box, id) {
    const out = box.querySelector("#pbMvOut"), seq = ++mvSeq, B = BOARDS.find(z => z[0] === id), k = B[3], isGap = B[2].kind === "gap";
    busy(out, "Reading Webull's rankings…");
    try {
      const { rows, note } = await boardRows(id);
      if (seq !== mvSeq) return;
      if (!rows) { out.innerHTML = `<div class="banner">${esc(D.wb.why())} The Movers boards come from Webull's market rankings: allow the Webull connector for this page (its Permissions menu), then press Refresh.</div>`; return; }
      const minPx = +cfg.minPrice || 0, n0 = nyNow();
      rows.forEach(r => { r.why = []; if (r.price != null && r.price < minPx) r.why.push("under $" + minPx); });
      const cand = rows.filter(r => !r.why.length).slice(0, 30);
      busy(out, `Checking ${cand.length} names against Robinhood's price history…`);
      const bars = cand.length ? await D.dailyBars(cand.map(r => r.sym), 420) : {};
      if (seq !== mvSeq) return;
      await account().catch(() => {});
      const qs = sessionNow() && cand.length ? await D.quotes(cand.map(r => r.sym)).catch(() => ({})) : {};
      cand.forEach(r => {
        const b = bars[r.sym] || [];
        if (b.length < 30) { r.why.push("no price history"); return; }
        const x = P.prep(b), i = b.length - 1, todayIn = b[i].d === n0.date || !sessionStarted();
        r.check = P.checkMove(b, r.price, r.chg, k, todayIn);
        if (r.check.ok === false) r.why.push(`reported ${pct(r.chg)}, price history says ${pct(r.check.hist)}: a split, ticker change or bad data`);
        r.dv20 = x.dv20[i]; r.atr = x.atr[i]; r.v50 = x.v50[i];
        r.rv = r.rvol != null ? r.rvol : r.vol && r.v50 ? r.vol / r.v50 : null;
        r.trend = x.s200[i] != null ? (b[i].c > x.s50[i] ? 1 : 0) + (b[i].c > x.s200[i] ? 1 : 0) : null;
        r.volUp = x.v20[i] != null && x.v20[i - 20] != null ? x.v20[i] > x.v20[i - 20] : null;
        r.setups = P.setupsAt(b, x, i, liq()).map(h => P.SETUPS.find(z => z.id === h.id).short);
        r.barsD = b[i].d;
        const q = qs[r.sym]; r.spread = q && q.bid > 0 && q.ask > q.bid ? (q.ask - q.bid) / ((q.ask + q.bid) / 2) : null;
        const sp = r.atr ? P.sizePlan({ account: sizingValue() || 0, riskPct: cfg.riskPct / 100, mult: 1, entry: r.price, stop: r.price - 1.5 * r.atr, capPct: cfg.capPct / 100 }) : null;
        r.posVal = sp && sp.shares ? sp.shares * r.price : null;
        r.liq = P.liquidityGrade({ price: r.price, dv20: r.dv20, spread: r.spread, minPrice: minPx, minDollarVol: (+cfg.minDvM || 0) * 1e6, maxSpread: cfg.maxSpread / 100, position: r.posVal });
        if (r.liq.key === "no") r.why.push(...r.liq.why.filter(w => !r.why.includes(w)));
      });
      rows.slice(30).forEach(r => { if (!r.why.length) r.why.push("beyond the first 30 checked"); });
      const keep = rows.filter(r => !r.why.length), rej = rows.filter(r => r.why.length);
      busy(out, "Checking earnings dates…");
      const reps = {}; await Promise.all(keep.slice(0, 20).map(async r => { reps[r.sym] = await nextRep(r.sym); }));
      if (seq !== mvSeq) return;
      const LQ = { deep: "pass", good: "pass", thin: "", no: "fail" };
      const tr = { 2: '<span class="chg up">Above 50 &amp; 200-day</span>', 1: '<span class="muted">Mixed</span>', 0: '<span class="chg down">Below both</span>' };
      const moveCell = r => isGap ? `<span class="chg ${r.gap >= 0 ? "up" : "down"}">${pct(r.gap)}</span>${r.indicated ? ' <span class="muted">indicated</span>' : ""}` : `<span class="chg ${r.chg >= 0 ? "up" : "down"}">${pct(r.chg)}</span>`;
      const sinceOpen = r => { if (r.indicated || !(r.open > 0) || r.price == null) return "—"; const so = r.price / r.open - 1; const held = isGap ? (B[2].dir > 0 ? so >= 0 : so <= 0) : null; const filled = isGap && r.prev ? (B[2].dir > 0 ? r.low <= r.prev : r.high >= r.prev) : false; return `<span class="chg ${so >= 0 ? "up" : "down"}">${pct(so)}</span>${held == null ? "" : held ? ' <span class="pill pass">Held</span>' : ' <span class="pill">Faded</span>'}${filled ? ' <span class="pill fail" title="Traded back to yesterday\'s close">Filled</span>' : ""}`; };
      const row = (r, rj) => `<tr class="clickable${rj ? " rej" : ""}" tabindex="0" data-sym="${esc(r.sym)}" ${rj ? "hidden" : ""}><td><b>${esc(r.sym)}</b> <span class="muted" style="font-size:12px">${esc((r.name || "").slice(0, 22))}</span></td><td>${moveCell(r)}</td><td>${px(r.price)}</td><td>${sinceOpen(r)}</td><td>${r.rv != null ? r.rv.toFixed(1) + "×" : "—"}</td><td>${r.dv20 != null ? "$" + D.big(r.dv20) : "—"}</td><td>${r.spread != null ? (r.spread * 100).toFixed(2) + "%" : '<span class="muted">—</span>'}</td>
        <td>${rj ? `<span class="pill fail">Out</span> <span class="muted" style="white-space:normal;display:inline-block;min-width:200px">${esc(r.why.join("; "))}</span>` : `<span class="pill ${LQ[r.liq.key]}" title="${esc(r.liq.why.join("; ") || "Within your limits")}">${esc(r.liq.label)}</span>${r.liq.share != null ? ` <span class="muted">${(r.liq.share * 100).toFixed(2)}% of a day</span>` : ""}`}</td>
        <td>${r.trend == null ? "—" : tr[r.trend]}</td><td>${r.volUp == null ? "—" : r.volUp ? '<span class="chg up">Rising</span>' : '<span class="chg down">Falling</span>'}</td><td>${r.setups && r.setups.length ? esc(r.setups.join(", ")) : '<span class="muted">none</span>'}</td><td>${rj ? "" : repCell(reps[r.sym])}</td></tr>`;
      out.innerHTML = `<p class="verdict-line" style="font-size:18px">${esc(`${keep.length} of ${rows.length} names on ${B[1].toLowerCase()} are tradable by your rules.`)}</p>
        <div class="panel"><div class="ph"><h2>${esc(B[1])}</h2><span class="eyebrow">Webull ranking, checked against Robinhood</span></div>
        <div class="scroll"><table class="dt"><thead><tr><th>Symbol</th><th>${isGap ? "Gap" : k === 1 ? "Today" : k === 5 ? "5 days" : "1 month"}</th><th>Price</th><th>Since the open</th><th>Relative volume</th><th>Dollar volume (20-day)</th><th>Spread</th><th>Liquidity</th><th>Trend</th><th>Volume trend</th><th>Setup on last close</th><th>Earnings</th></tr></thead><tbody>
        ${keep.length ? keep.map(r => row(r, false)).join("") : '<tr><td colspan="12" class="muted">Nothing on this board passes your price, volume and spread limits.</td></tr>'}${rej.map(r => row(r, true)).join("")}
        </tbody></table></div>
        <div class="pb muted" style="font-size:12px">${esc(note)} Every name is checked against Robinhood's split-adjusted daily history: when the reported move doesn't match the price history (a reverse split, a ticker change, a new listing or bad data) it's filtered out. Liquidity: Deep means $100 million or more traded a day and a spread of 0.1% or less; Good, $20 million and 0.3%; Thin passes your limits but costs more to trade; Out fails them (under $${esc(String(cfg.minPrice))}, under $${esc(String(cfg.minDvM))} million a day, a spread over ${esc(String(cfg.maxSpread))}%, or your position over 1% of a day's trading). "% of a day" is a ${esc(String(cfg.riskPct))}%-risk position with a 1.5 ATR stop against the 20-day dollar volume. Spreads are read live during the session only. Relative volume is Webull's 10-day figure where given, else today's volume against the 50-day average. Earnings in red land within your ${esc(String(cfg.hold))}-session hold. A board is a list of what already moved, not a buy list: see what such moves did next below.</div></div>`;
      box.querySelector("#pbMvNote").textContent = `${rows.length} ranked, ${rej.length} filtered out` + (cand[0] && cand[0].barsD ? `; history to ${cand[0].barsD}` : "");
      if (box.querySelector("#pbMvAll").checked) out.querySelectorAll("tr.rej").forEach(r => r.hidden = false);
    } catch (e) { if (seq === mvSeq) fail(out, e); }
    studyPanel(box.querySelector("#pbMvStudy"), STUDY_OF[id]);
  }
  async function studyPanel(el, hi) {
    if (!el) return;
    if (!cfg.listId) { el.innerHTML = '<p class="muted">Choose a list above to test what these moves did next on its history.</p>'; return; }
    try {
      busy(el, "Testing what such moves did next…");
      const st = await listSets(t => busy(el, t));
      const key = setsKey + "|" + cfg.costBps + "|" + cfg.minPrice + "|" + cfg.minDvM;
      if (!mvStudy || mvStudyKey !== key) { await new Promise(r => setTimeout(r, 0)); mvStudy = P.moverStudy(st, { cost: cfg.costBps / 10000, liq: liq() }); mvStudyKey = key; }
      const S0 = mvStudy, VK = { cont: ["Kept going", "pass"], rev: ["Reversed", "fail"], none: ["No edge", ""], thin: ["Too few", ""] };
      const cellH = h => h.n ? `<span class="chg ${h.mean >= 0 ? "up" : "down"}">${pct(h.mean)}</span>` : "—";
      const spl = z => z.n ? `${esc(z.label)}: <span class="chg ${z.excess5 >= 0 ? "up" : "down"}">${pct(z.excess5)}</span> <span class="muted">(${z.n})</span>` : `<span class="muted">${esc(z.label)}: none</span>`;
      el.innerHTML = `<div class="panel"><div class="ph"><h2>What such moves did next</h2><span class="eyebrow">${S0.names} names on your list, about 3 years</span></div>
        <div class="scroll"><table class="dt"><thead><tr><th>Move</th><th>Cases</th><th>Next day</th><th>Next 5 days</th><th>Next 10 days</th><th>5 days vs a normal week</th><th>Split (5 days vs normal)</th><th>Verdict</th></tr></thead><tbody>
        ${S0.rows.map(r => `<tr${r.id === hi ? ' style="background:var(--hl, rgba(0,128,128,.08))"' : ""}><td><b>${esc(r.label)}</b></td><td>${r.n}</td><td>${cellH(r.h[1])}</td><td>${cellH(r.h[5])} <span class="muted">${r.h[5].win != null ? p0(r.h[5].win) + " up" : ""}</span></td><td>${cellH(r.h[10])}</td><td>${r.excess5 == null ? "—" : `<span class="chg ${r.excess5 >= 0 ? "up" : "down"}">${pct(r.excess5)}</span> <span class="muted">t ${r.t == null ? "—" : r.t.toFixed(1)}</span>`}</td><td style="white-space:normal;min-width:240px">${spl(r.split[0])}<br>${spl(r.split[1])}</td><td><span class="pill ${VK[r.verdict.key][1]}" title="${esc(r.verdict.text)}">${VK[r.verdict.key][0]}</span></td></tr>`).join("")}
        </tbody></table></div>
        <div class="pb muted" style="font-size:12px">Each move on a liquid day on your list (counted at most once a week per stock), bought at the next open and sold at the close 1, 5 or 10 sessions later, ${esc(String(cfg.costBps))} bp a side. "vs a normal week" subtracts the same stocks' average 5-day return over all liquid days (${pct(S0.base)}), so a positive number means the move was followed by a better week than usual. Kept going or Reversed needs at least 30 cases, a t-statistic of 2 or more and half a percent or more; anything less is No edge. Studies of US stocks find last week's biggest winners and losers tend to partly reverse the next week (Jegadeesh 1990; Lehmann 1990), more so in small, thin stocks and less when the move came on heavy volume (Gervais, Kaniel and Mingelgrin 2001). This tests that on your own list; a list of large companies has few 15% weeks, so pick a broad list for more cases.</div></div>`;
    } catch (e) { fail(el, e); }
  }

  /* ---------- Quality: quality and value from quarterly reports, with a point-in-time test ---------- */
  const QL = window.Quality;
  let qlData = null, qlKey = "";
  async function drawQuality(box) {
    box.innerHTML = `<div class="tools" style="margin-bottom:12px"><button class="btn small primary" id="pbQlRun" type="button">Refresh</button><span class="muted" style="font-size:13px" id="pbQlNote"></span></div><div id="pbQlOut"><p class="muted">Reading reports…</p></div><div id="pbQlStudy" style="margin-top:18px"></div>`;
    box.querySelector("#pbQlRun").onclick = () => { qlData = null; quality(box); };
    quality(box);
  }
  async function quality(box) {
    const out = box.querySelector("#pbQlOut"), st = box.querySelector("#pbQlStudy");
    if (!cfg.listId) { out.innerHTML = '<p class="muted">Choose a list above.</p>'; return; }
    try {
      const syms = [...new Set(await D.listSymbols(cfg.listId))].slice(0, 40);
      if (!qlData || qlKey !== cfg.listId) {
        busy(out, "Reading quarterly financials from Robinhood…");
        const fin = {};
        for (let i = 0; i < syms.length; i += 20) { const chunk = syms.slice(i, i + 20); const d = await call("get_financials", { symbols: chunk, period: "quarterly", limit: 24 }, 6 * 3600000).catch(() => null); ((d && d.results) || []).forEach((r, k) => { if (r) fin[r.symbol || chunk[k]] = r.financials || []; }); }
        const ind = {}; let wbOk = true;
        for (let i = 0; i < syms.length; i += 4) {
          busy(out, `Reading ratios from Webull: ${Math.min(i + 4, syms.length)} of ${syms.length}…`);
          const got = await Promise.all(syms.slice(i, i + 4).map(s0 => D.wb.indicators(s0).catch(() => null)));
          got.forEach((v, k) => { if (v) ind[syms[i + k]] = v; });
          if (D.wb.state === "off") { wbOk = false; break; }
        }
        busy(out, "Reading five years of prices…");
        const bars = await D.dailyBars(syms, 1900, (a, b) => busy(out, `Reading five years of prices: ${a} of ${b}…`));
        qlData = { syms, fin, ind, bars, wbOk }; qlKey = cfg.listId;
      }
      const { fin, ind, bars, wbOk } = qlData;
      const items = qlData.syms.map(s0 => ({ sym: s0, qs: QL.merge(fin[s0] || [], ind[s0] || null), bars: bars[s0] || [] }));
      const rows = items.map(it => {
        const b = it.bars, j = b.length - 1; if (j < 0 || !it.qs.length) return { sym: it.sym, s: null };
        const i = it.qs.length - 1, s = QL.scoreAt(it.qs, i, b[j].c), t = QL.trendAt(b, j);
        // P/E against the stock's own last five years, measured on each report's known date
        let pePct = null;
        if (s && s.pe) { const hist = []; for (let k = 3; k < it.qs.length; k++) { const jj = b.findIndex(x => x.d >= it.qs[k].avail); if (jj < 0) continue; const z = QL.scoreAt(it.qs, k, b[jj].c); if (z && z.pe) hist.push(z.pe); } if (hist.length >= 6) pePct = hist.filter(v => v < s.pe).length / hist.length; }
        return { sym: it.sym, s, t, dec: QL.decision(s, t), last: b[j].c, pePct, d: b[j].d };
      }).sort((a, c) => ((c.s && c.s.quality) ?? -1) - ((a.s && a.s.quality) ?? -1));
      const reps = {}; await Promise.all(rows.filter(r => r.s).slice(0, 25).map(async r => { reps[r.sym] = await nextRep(r.sym); }));
      const DC = { cand: "pass", watch: "", trap: "fail", avoid: "fail", neutral: "", na: "" };
      const sc = v => v == null ? '<span class="muted">—</span>' : `<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:44px;height:8px;background:var(--rule);display:inline-block;position:relative"><span style="position:absolute;left:0;top:0;bottom:0;width:${v}%;background:var(${v >= 70 ? "--up" : v < 40 ? "--down" : "--amber"})"></span></span><b>${v}</b></span>`;
      const p1 = v => v == null ? "—" : (v * 100).toFixed(0) + "%";
      const TR = { up: '<span class="chg up">Up</span>', down: '<span class="chg down">Down</span>', mixed: '<span class="muted">Mixed</span>' };
      out.innerHTML = `<div class="panel"><div class="ph"><h2>Quality and value</h2><span class="eyebrow">Latest reported quarter, price to ${esc(rows.find(r => r.d) ? rows.find(r => r.d).d : "—")}</span></div>
        ${wbOk ? "" : `<div class="pb"><div class="banner">${esc(D.wb.why())} Webull supplies ROE, debt, earnings per share and book value; without it only margins, growth and consistency are scored and value can't be.</div></div>`}
        <div class="scroll"><table class="dt"><thead><tr><th>Symbol</th><th>Quality</th><th>Value</th><th>Trend</th><th>Read</th><th>ROE</th><th>Gross margin</th><th>Revenue growth</th><th>Profitable quarters</th><th>Liabilities / assets</th><th>Cash / earnings</th><th>P/E</th><th>P/E vs its 5 years</th><th>P/B</th><th>Graham value</th><th>Earnings</th></tr></thead><tbody>
        ${rows.map(r => { const s = r.s; if (!s) return `<tr><td><b>${esc(r.sym)}</b></td><td colspan="15" class="muted">No reports came back (funds and new listings have none).</td></tr>`; const m = s.m;
          return `<tr class="clickable" tabindex="0" data-sym="${esc(r.sym)}"><td><b>${esc(r.sym)}</b></td><td>${sc(s.quality)}</td><td>${sc(s.value)}</td><td>${r.t ? TR[r.t] : "—"}</td><td><span class="pill ${DC[r.dec.key]}">${esc(r.dec.label)}</span></td><td>${p1(m.roe)}</td><td>${p1(m.gm)}</td><td>${m.growth == null ? "—" : `<span class="chg ${m.growth >= 0 ? "up" : "down"}">${pct(m.growth)}</span>`}</td><td>${m.consistency == null ? "—" : Math.round(m.consistency * 8) + " of 8"}</td><td>${m.dta == null ? "—" : m.dta.toFixed(2)}</td><td>${m.cash == null ? "—" : m.cash.toFixed(2) + "×"}</td><td>${s.pe ? s.pe.toFixed(1) : '<span class="muted">loss</span>'}</td><td>${r.pePct == null ? "—" : r.pePct <= 0.25 ? '<span class="chg up">Cheaper than usual</span>' : r.pePct >= 0.75 ? '<span class="chg down">Pricier than usual</span>' : '<span class="muted">Typical</span>'}</td><td>${s.pb ? s.pb.toFixed(1) : "—"}</td><td>${s.graham ? px(s.graham * 0.75) + "–" + px(s.graham * 1.25) : "—"}</td><td>${repCell(reps[r.sym])}</td></tr>`; }).join("")}
        </tbody></table></div>
        <div class="pb muted" style="font-size:12px">Quality, 0 to 100, averages seven parts over the last four quarters: return on equity (25%+ scores full), return on assets (12%+), gross margin (60%+), revenue growth against a year earlier (+20%+), profitable quarters out of the last eight, liabilities to assets (0.3 or less scores full, 0.9 or more zero; banks and insurers always look indebted on this), and operating cash flow against earnings (1× or more). Value averages the earnings yield (8%+ scores full) and price to book (1× full, 15× zero). Read: Candidate = quality 70+ with the trend up; Watch = quality 70+ waiting for the trend; Cheap but weak = value 60+ with quality under 40, the classic value trap; Avoid = quality under 40 in a downtrend. Graham value = √(22.5 × earnings per share × book value per share), shown as a ±25% range because it is a rough, old rule that undervalues growth companies. Research: profitable, safe companies have earned more over long periods (Novy-Marx 2013; Asness, Frazzini and Pedersen 2019); cheapness alone has been weak since about 2007 and works better with quality. Reports: Robinhood (income) and Webull (ratios). Context, not a buy list.</div></div>`;
      box.querySelector("#pbQlNote").textContent = `${rows.filter(r => r.s).length} of ${rows.length} names scored`;
      // the test
      busy(st, "Testing the scores on the list's last five years…");
      await new Promise(r => setTimeout(r, 0));
      const S0 = QL.study(items, { liq: { minPrice: +cfg.minPrice || 0 } });
      const cell = h => h && h.excess != null ? `<span class="chg ${h.excess >= 0 ? "up" : "down"}">${pct(h.excess)}</span> <span class="muted">t ${h.t == null ? "—" : h.t.toFixed(1)}</span>` : "—";
      st.innerHTML = `<div class="panel"><div class="ph"><h2>Did the scores work on this list?</h2><span class="eyebrow">${S0.obs} stock-quarters, ${S0.names} names, ${esc(S0.from || "—")} to ${esc(S0.to || "—")}</span></div>
        <div class="scroll"><table class="dt"><thead><tr><th>Group</th><th>Cases</th><th>Next 3 months, average</th><th>vs the list (3 months)</th><th>Next 12 months, average</th><th>vs the list (12 months)</th><th>Up after 12 months</th></tr></thead><tbody>
        ${S0.rows.map(r => `<tr><td><b>${esc(r.label)}</b></td><td>${r.n}</td><td>${r.h[63].avg == null ? "—" : pct(r.h[63].avg)}</td><td>${r.id === "all" ? "—" : cell(r.h[63])}</td><td>${r.h[252].avg == null ? "—" : pct(r.h[252].avg)}</td><td>${r.id === "all" ? "—" : cell(r.h[252])}</td><td>${r.h[252].win == null ? "—" : p0(r.h[252].win)}</td></tr>`).join("")}
        </tbody></table></div>
        <div class="pb" style="border-bottom:1px solid var(--rule)"><button class="btn small" type="button" id="pbInsTest">Test insider buying clusters on this list</button> <span class="muted" id="pbInsOut" style="font-size:13px"></span></div>
        <div class="pb muted" style="font-size:12px">Each time a quarter became public (45 days after it ended, 75 for the fiscal year), the stock was scored at that day's close and held from the next open for 3 or 12 months. "vs the list" compares each group with the average of all the list's stocks scored on the same dates, then averages across dates; the 12-month t-statistic is cut for overlapping windows. Read it with care: about five years and one list is a small sample, and a list chosen today holds companies that did well enough to be on it (survivorship), which flatters every group. A t-statistic under about 2 is not evidence either way.</div></div>`;
      const ib = st.querySelector("#pbInsTest");
      if (ib) ib.onclick = async () => {
        ib.disabled = true; const o2 = st.querySelector("#pbInsOut");
        try {
          const syms = qlData.syms, cl = {};
          for (let i = 0; i < syms.length; i += 4) { o2.textContent = `Reading insider trades ${Math.min(i + 4, syms.length)} of ${syms.length}…`; await Promise.all(syms.slice(i, i + 4).map(async s0 => { const t = await D.wb.insiders(s0).catch(() => null); cl[s0] = t ? P.insiderClusters(t).clusters : []; })); }
          const spy = (await D.dailyBars(["SPY"], 1900)).SPY || [];
          const r = P.insiderStudy(syms.map(s0 => ({ sym: s0, clusters: cl[s0], bars: qlData.bars[s0] || [] })), spy);
          const f = h => h.n ? `${pct(h.excess)} vs SPY on average, ${p0(h.beat)} beat it${h.t != null ? `, t ${h.t.toFixed(1)}` : ""}` : "no completed windows";
          o2.innerHTML = r.events.length ? esc(`${r.events.length} clusters (${r.events.slice(0, 5).map(z => z.sym + " " + z.d).join(", ")}${r.events.length > 5 ? "…" : ""}). After 3 months: ${f(r.h63)}. After 6 months: ${f(r.h126)}.`) + ` <span class="muted">Webull keeps about two years of insider trades, so expect few cases; under 20 says little.</span>` : esc("No insider buying clusters (2+ insiders buying on the open market within 30 days) on this list in Webull's history.");
        } catch (e) { o2.textContent = "The insider test failed: " + (e.message || e); ib.disabled = false; }
      };
    } catch (e) { fail(out, e); }
  }

  /* ---------- Size a trade ---------- */
  function drawSize(box) {
    const sym = (D.S && D.S.sym) || "";
    box.innerHTML = `<div class="panel"><div class="pb"><form class="form" id="pbSizeForm" autocomplete="off">
        <label class="field"><span>Symbol</span><input id="pbSym" maxlength="10" value="${esc(sym)}" style="text-transform:uppercase"></label>
        <label class="field"><span>Side</span><select id="pbSide"><option value="long">Long</option><option value="short">Short</option></select></label>
        <label class="field"><span>Entry (blank = last price)</span><input id="pbEntry" type="number" step="0.01" min="0" inputmode="decimal"></label>
        <label class="field"><span>Stop</span><select id="pbStopM"><option value="atr15">1.5 × ATR from the entry</option><option value="atr2">2 × ATR from the entry</option><option value="lo5">Beyond the 5-day low or high</option><option value="manual">My own price</option></select></label>
        <label class="field"><span>Stop price (for my own)</span><input id="pbStopPx" type="number" step="0.01" min="0" inputmode="decimal"></label>
        <div class="field" style="justify-content:flex-end"><button class="btn primary" type="submit">Size it</button></div>
      </form></div><div class="pb" id="pbSizeOut" style="border-top:1px solid var(--rule)"><p class="muted" style="margin:0;font-size:13px">Size = (account × risk per trade × the market gate) ÷ (entry − stop), capped at your largest-position limit.</p></div></div>`;
    box.insertAdjacentHTML("beforeend", `<div class="panel" style="margin-top:18px"><div class="ph"><h2>Saved plans</h2><span class="eyebrow" id="pbPlansWhere"></span></div><div id="pbPlans" class="pb"><p class="muted" style="margin:0">Reading…</p></div></div>`);
    box.querySelector("#pbSizeForm").onsubmit = e => { e.preventDefault(); sizeIt(box); };
    renderPlans(box);
    if (sym) sizeIt(box);
  }
  async function sizeIt(box) {
    const out = box.querySelector("#pbSizeOut"), sym = box.querySelector("#pbSym").value.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(sym)) { out.innerHTML = '<p class="muted">Enter a ticker.</p>'; return; }
    busy(out, "Reading " + sym + "…");
    try {
      await account().catch(() => {}); if (!today && acct) today = await todayStats().catch(() => null);
      if (!gateRes) await ensureGate();
      const [bm, qm] = await Promise.all([D.dailyBars([sym], 430), D.quotes([sym])]);
      const b = bm[sym] || []; if (b.length < 30) throw new Error("Not enough daily history for " + sym + ".");
      const x = P.prep(b), i = b.length - 1, a = x.atr[i], last = D.lastPrice(qm[sym]) || b[i].c, side = box.querySelector("#pbSide").value;
      const entry = +box.querySelector("#pbEntry").value || last, m = box.querySelector("#pbStopM").value, dir = side === "long" ? 1 : -1;
      let stop = m === "atr15" ? entry - dir * 1.5 * a : m === "atr2" ? entry - dir * 2 * a : m === "lo5" ? (dir > 0 ? Math.min(...b.slice(-5).map(z => z.l)) - 0.01 : Math.max(...b.slice(-5).map(z => z.h)) + 0.01) : +box.querySelector("#pbStopPx").value;
      if (!(stop > 0) || (dir > 0 ? stop >= entry : stop <= entry)) throw new Error(side === "long" ? "For a long, the stop must be under the entry." : "For a short, the stop must be above the entry.");
      const s = plan(entry, stop), per = Math.abs(entry - stop);
      const room = lvl => lvl == null ? "—" : ((dir > 0 ? lvl - entry : entry - lvl) / per).toFixed(1) + "R";
      const hi20 = x.hi20[i], hi252 = x.hi252[i] != null ? x.hi252[i] : Math.max(...b.map(z => z.h));
      const lo20 = Math.min(...b.slice(-20).map(z => z.l));
      const live = b.length > 260 ? P.setupsAt(b, x, i, liq()) : [];
      const [rep, conc, research, qual, insT, sales] = await Promise.all([nextRep(sym), dir > 0 ? concentration(sym, s.value).catch(() => null) : null, researchFor(sym, b, x, last).catch(() => null), qualityOne(sym, b).catch(() => null), D.wb.insiders(sym).catch(() => null), recentSales().catch(() => [])]);
      const thinNow = !P.liquid(b, x, i, liq());
      const ck = checklist({ sym, dir, b, x, i, s, rep, conc, qual, ins: insT ? P.insiderClusters(insT) : null, wash: P.washSale(sales, sym, Date.now()), live, thinNow });
      const [gname, gcls] = VERD[gateRes.verdict];
      out.innerHTML = `
        ${locked() ? '<div class="banner bad" style="margin-bottom:10px">Daily loss limit reached: the size is zero for the rest of today.</div>' : ""}
        ${ck.html}
        <p class="verdict-line" style="font-size:19px">${s.shares ? esc(`${side === "long" ? "Buy" : "Sell short"} ${int(s.shares)} ${sym} at ${px(entry)}, stop ${px(stop)}: ${money(s.riskDollars)} at risk.`) : esc(locked() ? "No size today." : gateRes.verdict === "aside" && dir > 0 ? "The market gate says stand aside, so the size is zero." : !sizingValue() ? "Set an account value on the Today tab." : "The stop is too far for one share at this risk.")}</p>
        <div class="kv six">${D.kv([["Market gate", dir > 0 ? gname + " · " + mult(false).toFixed(2) + "×" : "Longs only · " + mult(true).toFixed(2) + "× for volatility"], ["Position value", money(s.value)], ["Share of account", s.pctOfAccount != null ? (s.pctOfAccount * 100).toFixed(1) + "%" : "—"], ["Stop distance", (per / entry * 100).toFixed(2) + "% · " + (per / a).toFixed(1) + " ATR"], ["Sized by", s.limitedBy === "cap" ? "Largest-position cap" : s.limitedBy === "risk" ? "Risk per trade" : s.limitedBy === "gate" ? "Market gate" : "—"], ["ATR 14", px(a)]])}</div>
        <div class="scroll" style="margin-top:12px"><table class="dt"><thead><tr><th>Level</th><th>Price</th><th>Result on this size</th></tr></thead><tbody>
          ${[["Stop (−1R)", stop, -1], ["1R", s.t1, 1], ["2R", s.t2, 2], ["3R", s.t3, 3]].map(([l, p, k]) => `<tr><td>${l}</td><td>${px(p)}</td><td class="chg ${k > 0 ? "up" : "down"}">${money(k * per * s.shares)}</td></tr>`).join("")}
        </tbody></table></div>
        <p style="font-size:13px;margin:12px 0 0">${esc(dir > 0 ? `Room to the 20-day high: ${room(hi20)}. To the 52-week high: ${room(hi252)}.` : `Room to the 20-day low: ${room(lo20)}.`)} ${esc(live.length ? "Setups on the last close: " + live.map(z => z.label).join(", ") + "." : "None of the Playbook setups is on the last close.")} Gate: <span class="pill ${gcls}">${esc(gname)}</span></p>
        ${rep && P.earningsInside(rep, +cfg.hold) ? `<div class="banner bad" style="margin-top:12px"><b>Earnings ${esc(repText(rep))}</b>, ${rep.gapIn} session${rep.gapIn === 1 ? "" : "s"} away. A report can gap the price straight through the stop, so the loss can be several times ${s.shares ? esc(money(s.riskDollars)) : "the planned risk"}. Size down, wait for the report, or plan to exit before it.</div>` : `<p style="font-size:13px;margin:12px 0 0">Next earnings: ${esc(repText(rep))}.</p>`}
        ${thinNow ? `<div class="banner" style="margin-top:12px">${esc(sym)} is under your liquidity limits ($${esc(String(cfg.minPrice))} and $${esc(String(cfg.minDvM))} million a day). Expect wider spreads and slippage.</div>` : ""}
        ${conc && conc.hits.length ? `<div class="banner" style="margin-top:12px"><b>This would add to a bet you already hold.</b> Over 60 sessions ${esc(sym)} moved with ${esc(conc.hits.map(h => h.sym + " (" + h.c.toFixed(2) + ")").join(", "))}. Together with this trade that is ${(conc.together * 100).toFixed(0)}% of the account, acting more like one position than several.</div>` : conc ? `<p class="muted" style="font-size:12px;margin:8px 0 0">None of your ${conc.pos.length} holdings moved closely with ${esc(sym)} (correlation under 0.70 over 60 sessions).</p>` : ""}
        ${research ? researchHtml(research, last) : ""}
        <div class="row" style="margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button class="btn small primary" type="button" id="pbSave" ${s.shares ? "" : "disabled"}>Save this plan</button><span class="muted" style="font-size:12px">Saved plans let Manage track the trade and My edge check whether you kept the stop.</span></div>
        <p class="muted" style="font-size:12px;margin:8px 0 0">A stop under 1 ATR is often hit by ordinary noise. Less than 2R of room to a recent high leaves little reward for the risk.</p>`;
      const gb = out.querySelector("#pbCkGamma");
      if (gb) gb.onclick = async () => { gb.disabled = true; gb.textContent = "Reading the option chain…"; try { const g = D.gammaApp ? await D.gammaApp.quick(sym, last) : null; const el = out.querySelector("#pbCkGammaOut"); el.innerHTML = g ? `<span class="pill ${g.regime === "positive" ? "pass" : "fail"}">${g.regime === "positive" ? "Positive gamma" : "Negative gamma"}</span> ${esc(`this week: ${g.regime === "positive" ? "moves tend to be damped" : "moves tend to extend"}; King ${px(g.king)}, call wall ${px(g.callWall)}, put wall ${px(g.putWall)}${g.flip ? ", zero gamma " + px(g.flip) : ""}.`)}` : '<span class="muted">No options with open interest.</span>'; gb.remove(); } catch (e) { gb.disabled = false; gb.textContent = "Gamma failed: try again"; } };
      const sv = out.querySelector("#pbSave");
      if (sv) sv.onclick = async () => { sv.disabled = true; try { await Plans.add({ sym, side, entry: +entry.toFixed(2), stop: +stop.toFixed(2), target: +s.t2.toFixed(2), shares: s.shares, setup: live.length ? live[0].id : null, gate: gateRes.verdict, date: nyNow().date, hold: +cfg.hold, check: ck.verdict, checkWhy: ck.reasons.filter(r => r.mark !== "ok").map(r => r.text).slice(0, 6) }); sv.textContent = "Saved"; renderPlans(box); } catch (e) { sv.disabled = false; sv.textContent = "Could not save: " + (e.message || e.code || "error"); } };
    } catch (e) { fail(out, e); }
  }

  /* Quality for one symbol: Robinhood's quarterly financials and Webull's indicators, scored on the latest quarter. */
  async function qualityOne(sym, b) {
    const [f, ind] = await Promise.all([call("get_financials", { symbols: [sym], period: "quarterly", limit: 24 }, 6 * 3600000).catch(() => null), D.wb.indicators(sym).catch(() => null)]);
    const fin = f && f.results && f.results[0] ? f.results[0].financials || [] : []; if (!fin.length) return null;
    const qs = window.Quality.merge(fin, ind), j = b.length - 1; if (!qs.length || j < 0) return null;
    const sc = window.Quality.scoreAt(qs, qs.length - 1, b[j].c); return sc ? Object.assign(sc, { trend: window.Quality.trendAt(b, j) }) : null;
  }
  /* The pre-trade checklist: everything the desk knows about one trade, ending in Go, Wait or No. */
  function checklist(o) {
    const R0 = [], add = (mark, text) => R0.push({ mark, text });
    const g = gateRes, long = o.dir > 0;
    if (locked()) add("no", "Daily loss limit reached.");
    if (long && g) add(g.verdict === "go" ? "ok" : g.verdict === "half" ? "warn" : "no", `Market gate: ${VERD[g.verdict][0]}.`);
    if (long && spyB && spyB.length > 60) { const w = P.bottomWatch(spyB, vixB || [], (sets || []).map(z => ({ bars: z.bars }))); if (w && w.state !== "none") add(w.state === "confirmed" ? "ok" : "warn", `Bottom watch on SPY: ${w.state === "confirmed" ? "confirmed by a follow-through day" : w.state === "forming" ? "a bottom may be forming, not confirmed" : "early"}.`); }
    const evRows = ev ? Object.fromEntries(ev.rows.map(r => [r.id, r])) : {};
    if (o.live.length) o.live.forEach(h => { const r = evRows[h.id]; add(r && r.n >= 10 ? (r.expR > 0.05 ? "ok" : r.expR < 0 ? "no" : "warn") : "warn", `Setup live: ${h.label}${r && r.n ? ` (on the list ${R(r.expR)} over ${r.n} trades)` : " (no record on the list yet)"}.`); });
    else add("warn", "No Playbook setup on the last close: an entry here is your own idea, not a tested rule.");
    if (o.rep && P.earningsInside(o.rep, +cfg.hold)) add("no", `Earnings in ${o.rep.gapIn} session${o.rep.gapIn === 1 ? "" : "s"}: a gap can jump the stop.`); else if (o.rep) add("ok", "No earnings inside the hold.");
    add(o.thinNow ? "no" : "ok", o.thinNow ? "Under your liquidity limits." : "Liquid enough by your limits.");
    if (o.conc && o.conc.hits && o.conc.hits.length) add("warn", `Moves with what you hold (${o.conc.hits.map(h => h.sym).join(", ")}).`);
    if (o.qual && o.qual.quality != null) add(o.qual.quality >= 70 ? "ok" : o.qual.quality < 40 ? (long ? "warn" : "ok") : "ok", `Quality ${o.qual.quality}, value ${o.qual.value == null ? "—" : o.qual.value}${o.qual.pe ? `, P/E ${o.qual.pe.toFixed(1)}` : ""}.`);
    const tr = o.qual && o.qual.trend; if (tr && long) add(tr === "up" ? "ok" : tr === "down" ? "warn" : "warn", `Trend: ${tr === "up" ? "above a rising 200-day" : tr === "down" ? "below the 200-day" : "mixed"}.`);
    const m = P.momentum12_1(o.b), rk = sets ? P.rsRanks(sets.concat(sets.some(z => z.sym === o.sym) ? [] : [{ sym: o.sym, bars: o.b }]))[o.sym] : null;
    if (m != null) add(long ? (m > 0 ? "ok" : "warn") : "ok", `12-month momentum ${pct(m)}${rk ? `, rank ${rk.rank} of 99 on the list` : ""}.`);
    if (o.ins && o.ins.latest && Date.now() - Date.parse(o.ins.latest.end) < 120 * 864e5) add("ok", `Insider buying cluster: ${o.ins.latest.insiders} insiders, ${o.ins.latest.d}${o.ins.latest.end !== o.ins.latest.d ? " to " + o.ins.latest.end : ""}.`);
    if (o.wash && o.wash.risk) add("warn", `Wash sale: sold at a loss on ${o.wash.lastSale} (${money(o.wash.loss)}); buying before ${o.wash.clearAfter} defers that loss for taxes.`);
    if (o.s && !o.s.shares) add("no", "The size comes out at zero.");
    const no = R0.some(r => r.mark === "no"), setupOk = R0.some(r => r.mark === "ok" && r.text.startsWith("Setup live"));
    const warns = R0.filter(r => r.mark === "warn").length;
    const verdict = no ? "no" : setupOk && warns <= 2 ? "go" : "wait";
    const V = { go: ["Go", "pass", "The checklist is clear enough to take the planned trade."], wait: ["Wait", "", "Not a clean setup yet: wait for a tested setup, or for the warnings to clear."], no: ["No", "fail", "Something on the list rules this trade out today."] };
    const icon = { ok: '<span class="chg up">✓</span>', warn: '<span style="color:var(--amber)">!</span>', no: '<span class="chg down">✗</span>' };
    const html = `<div class="panel" style="margin-bottom:12px"><div class="ph"><h2>Pre-trade checklist</h2><span class="pill ${V[verdict][1]}" style="font-size:13px">${V[verdict][0]}</span></div>
      <div class="pb"><p style="margin:0 0 8px;font-size:14px">${esc(V[verdict][2])}</p><ul style="margin:0;padding-inline-start:18px;font-size:13px;line-height:1.6">${R0.map(r => `<li style="list-style:none;margin-inline-start:-18px">${icon[r.mark]} ${esc(r.text)}</li>`).join("")}<li style="list-style:none;margin-inline-start:-18px"><span class="muted">·</span> <span id="pbCkGammaOut"><button class="btn small" type="button" id="pbCkGamma">Add the gamma read</button></span></li></ul>
      <p class="muted" style="font-size:12px;margin:8px 0 0">Go needs a live setup with a positive record on your list, nothing ruled out, and at most two warnings. Saving the plan saves this verdict with it, so My edge can later compare your decisions with how the trades went. A checklist, not a recommendation.</p></div></div>`;
    return { verdict, reasons: R0, html };
  }

  /* Research for one symbol from both brokers: analyst ratings and targets, Webull's large-order money flow and unusual
     activity, and Robinhood's own ATR on the same closed bar as a check of the desk's arithmetic. Context, not rules. */
  async function researchFor(sym, b, x, last) {
    const lastD = b[b.length - 1].d;
    const [rh, w, flow, un, rAtr] = await Promise.all([
      D.rhAnalyst([sym]).then(m => m[sym]).catch(() => null), D.wb.analyst(sym).catch(() => null), D.wb.capitalFlow(sym, 5).catch(() => null),
      D.wb.unusual(sym, 8).catch(() => null), D.rhIndicator(sym, "atr", 14, lastD).catch(() => null)]);
    return { sym, rh, w, flow, un, atr: { desk: x.atr[b.length - 1], rh: rAtr, date: lastD } };
  }
  const bigMoney = v => v == null ? "—" : (v < 0 ? "−$" : "+$") + (Math.abs(v) >= 1e9 ? (Math.abs(v) / 1e9).toFixed(2) + "B" : Math.abs(v) >= 1e6 ? (Math.abs(v) / 1e6).toFixed(1) + "M" : Math.abs(v) >= 1e3 ? (Math.abs(v) / 1e3).toFixed(0) + "K" : Math.abs(v).toFixed(0));
  const ALERT = t => String(t || "").toLowerCase().replace(/_/g, " ").replace(/^./, c => c.toUpperCase());
  function researchHtml(r, last) {
    const an = (name, a) => !a || !(a.n > 0) && a.mean == null ? `<tr><td>${name}</td><td colspan="4" class="muted">No coverage</td></tr>` :
      `<tr><td>${name}${a.asOf ? ` <span class="muted">${esc(a.asOf)}</span>` : ""}</td><td>${a.n != null ? a.n : "—"}</td><td>${a.n ? Math.round(a.buy / a.n * 100) + "% buy · " + a.hold + " hold · " + a.sell + " sell" : "—"}</td><td>${px(a.mean)}${a.median != null ? ` <span class="muted">median ${px(a.median)}</span>` : ""}</td><td>${a.mean ? `<span class="chg ${a.mean >= last ? "up" : "down"}">${pct(a.mean / last - 1)}</span> <span class="muted">range ${px(a.low)}–${px(a.high)}</span>` : "—"}</td></tr>`;
    const f = r.flow, share = f && f.total ? f.large / (f.total / 2) : null;
    const atrOk = r.atr.rh != null && r.atr.desk != null ? Math.abs(r.atr.rh / r.atr.desk - 1) : null;
    return `<div class="panel" style="margin-top:12px"><div class="ph"><h2 style="font-size:15px">Research on ${esc(r.sym)}</h2><span class="eyebrow">Robinhood and Webull · context, not rules</span></div>
      <div class="scroll"><table class="dt"><thead><tr><th>Analysts</th><th>Ratings</th><th>Split</th><th>Average target</th><th>Vs price now</th></tr></thead><tbody>${an("Robinhood", r.rh)}${D.wb.state === "off" ? `<tr><td>Webull</td><td colspan="4" class="muted">${esc(D.wb.why())}</td></tr>` : an("Webull", r.w)}</tbody></table></div>
      <div class="pb" style="font-size:13px">
        ${f ? `<p style="margin:0 0 6px"><b>Large-order money flow, last ${f.days} sessions (Webull):</b> <span class="chg ${f.large >= 0 ? "up" : "down"}">${bigMoney(f.large)}</span> net${share != null ? ` (${(Math.abs(share) * 100).toFixed(1)}% of the dollar volume)` : ""}; medium orders ${bigMoney(f.medium)}, small ${bigMoney(f.small)}. By day: ${f.daily.map(d => `<span class="chg ${d.large >= 0 ? "up" : "down"}">${bigMoney(d.large)}</span>`).join(" · ")}.</p>` : ""}
        ${r.un && r.un.length ? `<p style="margin:0 0 6px"><b>Unusual activity (Webull, newest first):</b> ${r.un.slice(0, 6).map(u => esc(ALERT(u.type)) + ` <span class="muted">${esc(E.ny(u.t).date.slice(5))}</span>`).join(" · ")}.</p>` : r.un ? '<p class="muted" style="margin:0 0 6px">No unusual-activity alerts from Webull in the last 90 days.</p>' : ""}
        <p class="muted" style="margin:0">Arithmetic check: ATR 14 on ${esc(r.atr.date)} is ${px(r.atr.desk)} here and ${px(r.atr.rh)} from Robinhood's own indicator${atrOk == null ? "." : atrOk < 0.01 ? ": they agree." : ` (${(atrOk * 100).toFixed(1)}% apart; check for a missing or placeholder bar).`} Money flow sorts trades by size into large, medium and small; it is Webull's estimate and is not used by any rule. Analyst targets lag the price and are often revised after it moves.</p>
      </div></div>`;
  }
  async function renderPlans(box) {
    const el = box.querySelector("#pbPlans"); if (!el) return;
    const all = (await Plans.all()).sort((a, b) => (a.date < b.date ? 1 : -1));
    const w = box.querySelector("#pbPlansWhere"); if (w) w.textContent = "Kept in " + Plans.where();
    el.innerHTML = all.length ? `<div class="scroll"><table class="dt"><thead><tr><th>Saved</th><th>Symbol</th><th>Side</th><th>Entry</th><th>Stop</th><th>Target</th><th>Shares</th><th>Setup</th><th>Gate</th><th>Status</th><th></th></tr></thead><tbody>
      ${all.map(p => `<tr><td>${esc(p.date)}</td><td><b>${esc(p.sym)}</b></td><td>${p.side === "short" ? "Short" : "Long"}</td><td>${px(p.entry)}</td><td>${px(p.stop)}</td><td>${px(p.target)}</td><td>${p.shares != null ? int(p.shares) : "—"}</td><td>${esc(p.setup ? (P.SETUPS.find(z => z.id === p.setup) || {}).short || p.setup : "—")}</td><td>${esc(p.gate ? VERD[p.gate] ? VERD[p.gate][0] : p.gate : "—")}</td><td>${esc(p.status === "closed" ? "Closed" : p.halfTaken ? "Open, half taken" : "Open")}</td><td style="white-space:nowrap">${p.status !== "closed" ? `<button class="btn small" type="button" data-close="${esc(p.id)}">Close</button> ` : ""}<button class="btn small" type="button" data-del="${esc(p.id)}">Delete</button></td></tr>`).join("")}
      </tbody></table></div>` : '<p class="muted" style="margin:0;font-size:13px">No saved plans yet. Size a trade, or press Save plan on a Scanner row.</p>';
    el.querySelectorAll("button[data-del]").forEach(b => b.onclick = async () => { b.disabled = true; await Plans.remove(b.dataset.del).catch(() => {}); renderPlans(box); });
    el.querySelectorAll("button[data-close]").forEach(b => b.onclick = async () => { b.disabled = true; await Plans.update(b.dataset.close, { status: "closed" }).catch(() => {}); renderPlans(box); });
  }

  /* ---------- Manage ---------- */
  function drawManage(box) {
    box.innerHTML = `<div class="tools" style="margin-bottom:12px"><button class="btn small primary" id="pbMgRun" type="button">Check my positions</button></div><div id="pbMgOut"><p class="muted">Reading positions…</p></div>`;
    box.querySelector("#pbMgRun").onclick = () => manageRun(box);
    manageRun(box);
  }
  async function manageRun(box) {
    const out = box.querySelector("#pbMgOut");
    try {
      await account(); await webull(); if (!acct && !wbAcct) throw new Error("No active brokerage account came back.");
      const pos = await positions();
      if (!pos.length) { out.innerHTML = '<p class="muted">No open long stock positions.</p>'; return; }
      busy(out, "Reading history and plans…");
      const syms = pos.map(p => p.sym);
      const [bars, q, plans] = await Promise.all([D.dailyBars(syms, 400), D.quotes(syms), Plans.all()]);
      // entry day from the open purchase lots (first in, first out) when there is no saved plan
      const since = new Date(Date.now() - 730 * 86400000).toISOString().slice(0, 10); let raw = [], cursor = null, pages = 0;
      do { const d = await call("get_equity_orders", Object.assign({ account_number: acct, state: "filled", created_at_gte: since }, cursor ? { cursor } : {}), 120000); raw = raw.concat((d && d.orders) || []); cursor = d && d.next ? d.next : null; pages++; } while (cursor && pages < 40);
      const orders = raw.filter(o => o.symbol && +o.cumulative_quantity > 0 && +o.average_price > 0).map(o => { const ex = (o.executions || []).map(x => Date.parse(x.timestamp)).filter(isFinite); const t = ex.length ? Math.max(...ex) : Date.parse(o.last_transaction_at || o.created_at); return { symbol: o.symbol, side: o.side, qty: +o.cumulative_quantity, price: +o.average_price, t }; }).filter(o => isFinite(o.t));
      const openLots = A.roundTrips(orders).open.map(l => Object.assign(l, { broker: "rh" }));
      if (wbAcct && pos.some(p => p.broker === "wb")) { const wo = await D.wb.orders(wbAcct.account_id, Date.now() - 730 * 86400000).catch(() => []); A.roundTrips(wo).open.forEach(l => openLots.push(Object.assign(l, { broker: "wb" }))); }
      const reps = {}; await Promise.all(syms.map(async sy => { reps[sy] = await nextRep(sy); }));
      const n = nyNow(), rows = [], noHist = [];
      for (const p of pos) {
        const b = bars[p.sym] || [], last = D.lastPrice(q[p.sym]) || p.last || (b.length ? b[b.length - 1].c : null); if (!b.length || last == null) { noHist.push(p.sym + " (" + (BROKER[p.broker] || "") + ")"); continue; }
        const pl = plans.filter(z => z.sym === p.sym && z.status !== "closed" && (z.side || "long") === "long").sort((a, c) => a.date < c.date ? 1 : -1)[0];
        const lots = openLots.filter(l => l.symbol === p.sym && l.broker === p.broker).sort((a, c) => a.t - c.t);
        const date = pl ? pl.date : lots.length ? E.ny(lots[0].t).date : b[Math.max(0, b.length - 20)].d;
        const A14 = E.atr(b, 14), a = A14[A14.length - 1];
        const entry = pl ? pl.entry : p.avg, stop = pl ? pl.stop : (entry != null && a != null ? entry - 2 * a : null);
        const m = entry != null && stop != null ? P.manage({ entry, stop, date, hold: pl ? pl.hold : null, halfTaken: !!(pl && pl.halfTaken) }, b, last, n.date) : null;
        const rep = reps[p.sym];
        if (m && rep && P.earningsInside(rep, 5)) m.todo.push({ k: "earn", text: `Earnings ${repText(rep)}: decide before the report whether to hold through it` });
        if (m && !pl) m.todo.push({ k: "noplan", text: "No saved plan: stop assumed at 2 ATR under your cost" });
        const rhLast = D.lastPrice(q[p.sym]);
        if (m && p.broker === "wb" && p.last && rhLast && Math.abs(rhLast / p.last - 1) > 0.1) m.todo.push({ k: "mismatch", text: `Webull shows ${px(p.last)} but Robinhood ${px(rhLast)} for ${p.sym}: check it is the same company before trusting this row` });
        rows.push({ p, pl, last, entry, stop, m, date, rep, value: last * p.qty });
      }
      rows.sort((a, c) => (c.m ? c.m.todo.filter(t => t.k !== "noplan").length : 0) - (a.m ? a.m.todo.filter(t => t.k !== "noplan").length : 0) || c.value - a.value);
      const urgent = rows.filter(r => r.m && r.m.todo.some(t => t.k === "exit")).length, halves = rows.filter(r => r.m && r.m.todo.some(t => t.k === "half")).length;
      out.innerHTML = `
        <p class="verdict-line" style="font-size:19px">${esc(`${rows.length} positions. ${urgent ? urgent + " at or under the trailing stop. " : "None at its stop. "}${halves ? halves + " up 1R or more with half still on." : ""}`)}</p>
        <div class="scroll"><table class="dt"><thead><tr><th>Symbol</th><th>Shares</th><th>Entry</th><th>Last</th><th>Now</th><th>Starting stop</th><th>Trailing stop</th><th>Stop in R</th><th>Held</th><th>Earnings</th><th>What to do</th><th></th></tr></thead><tbody>
        ${rows.map((r, k) => `<tr class="clickable" tabindex="0" data-sym="${esc(r.p.sym)}"><td><b>${esc(r.p.sym)}</b>${r.pl ? "" : ' <span class="muted" title="No saved plan">*</span>'}<span class="note" style="display:block;font-size:11px;color:var(--ink-3)">${BROKER[r.p.broker] || ""}</span></td><td>${r.p.qty % 1 ? r.p.qty.toFixed(4) : int(r.p.qty)}</td><td>${px(r.entry)}</td><td>${px(r.last)}</td><td class="chg ${r.m && r.m.R >= 0 ? "up" : "down"}">${r.m ? R(r.m.R) : "—"}</td><td>${px(r.stop)}</td><td>${r.m ? px(r.m.stop) : "—"}</td><td class="chg ${r.m && r.m.stopR >= 0 ? "up" : "down"}">${r.m ? R(r.m.stopR) : "—"}</td><td>${r.m && r.m.held != null ? r.m.held + (r.pl && r.pl.hold ? " / " + r.pl.hold : "") : "—"}</td><td>${repCell(r.rep)}</td>
          <td style="white-space:normal;min-width:220px;text-align:start">${r.m && r.m.todo.length ? r.m.todo.map(t => `<div class="${t.k === "exit" ? "chg down" : t.k === "noplan" ? "muted" : ""}" style="font-size:13px">${esc(t.text)}</div>`).join("") : '<span class="muted">Hold; nothing due</span>'}</td>
          <td style="white-space:nowrap">${r.pl ? (r.pl.halfTaken ? "" : `<button class="btn small" type="button" data-half="${esc(r.pl.id)}">Half taken</button>`) : `<button class="btn small" type="button" data-mkplan="${k}">Save plan</button>`}</td></tr>`).join("")}
        </tbody></table></div>
        <div class="pb muted" style="font-size:12px;padding-inline:0">Now and Stop in R are in R (a stop at +0.50R locks in half the risk as profit): 1R is the distance from entry to the starting stop. The trailing stop is the highest high since entry minus 3 ATR, never under the starting stop, and at least break-even once half is taken. That is the "half off at 1R, trail the rest" exit from Edge lab part 1, which you can test on your own names. A star marks a holding without a saved plan: its entry is your average cost and its starting stop is assumed. Long stock positions only, from Robinhood${wbAcct ? " and Webull" : ""}.${noHist.length ? " Not shown, because Robinhood has no daily history for them: " + esc(noHist.join(", ")) + "." : ""}</div>`;
      out.querySelectorAll("button[data-half]").forEach(bt => bt.onclick = async () => { bt.disabled = true; await Plans.update(bt.dataset.half, { halfTaken: true }).catch(() => {}); manageRun(box); });
      out.querySelectorAll("button[data-mkplan]").forEach(bt => bt.onclick = async () => { const r = rows[+bt.dataset.mkplan]; bt.disabled = true; try { await Plans.add({ sym: r.p.sym, side: "long", entry: +(+r.entry).toFixed(2), stop: +(+r.stop).toFixed(2), target: +(r.entry + 2 * (r.entry - r.stop)).toFixed(2), shares: r.p.qty, setup: null, gate: null, date: r.date, hold: +cfg.hold }); manageRun(box); } catch (e) { bt.textContent = "Not saved"; } });
    } catch (e) { fail(out, e); }
  }

  /* ---------- My edge ---------- */
  function drawEdge(box) {
    box.innerHTML = `<div class="tools" style="margin-bottom:12px"><select id="pbSpan" class="btn small" aria-label="Period"><option value="92">3 months</option><option value="183">6 months</option><option value="366">1 year</option><option value="731">2 years</option></select><button class="btn small primary" id="pbEdgeRun" type="button">Measure my edge</button></div>
      <div id="pbEdgeOut"><p class="muted" style="font-size:13px">Rebuilds every completed round trip from your filled orders (first in, first out), then tags each one: when you bought, how long you held, the market gate that day, which setup (if any) was on the close before, and whether it came right after a loss. It then shows where your profit really comes from.</p></div>`;
    box.querySelector("#pbSpan").value = String(D.load("pbSpan", 183));
    box.querySelector("#pbEdgeRun").onclick = () => edge(box);
  }
  async function edge(box) {
    const out = box.querySelector("#pbEdgeOut"), btn = box.querySelector("#pbEdgeRun"), days = +box.querySelector("#pbSpan").value; D.save("pbSpan", days); btn.disabled = true;
    try {
      busy(out, "Reading filled orders…"); await account(); if (!acct) throw new Error("No active brokerage account came back.");
      const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10); let raw = [], cursor = null, pages = 0;
      do { const d = await call("get_equity_orders", Object.assign({ account_number: acct, state: "filled", created_at_gte: since }, cursor ? { cursor } : {}), 120000); raw = raw.concat((d && d.orders) || []); cursor = d && d.next ? d.next : null; pages++; } while (cursor && pages < 40);
      const orders = raw.filter(o => o.symbol && +o.cumulative_quantity > 0 && +o.average_price > 0 && ((o.executions || []).some(x => isFinite(Date.parse(x.timestamp))) || isFinite(Date.parse(o.last_transaction_at || o.created_at)))).map(o => { const ex = (o.executions || []).map(x => Date.parse(x.timestamp)).filter(isFinite); const t = ex.length ? Math.max(...ex) : Date.parse(o.last_transaction_at || o.created_at); const n = E.ny(t); return { symbol: o.symbol, side: o.side, qty: +o.cumulative_quantity, price: +o.average_price, fees: +o.fees || 0, t, ext: n.min < 570 || n.min >= 960 }; });
      const rhR = A.roundTrips(orders); rhR.trips.forEach(t => { t.broker = "rh"; });
      await webull();
      let wbR = { trips: [], unmatched: [], open: [] };
      if (wbAcct) { busy(out, "Reading Webull orders…"); const wo = await D.wb.orders(wbAcct.account_id, Date.now() - days * 86400000).catch(() => []); wbR = A.roundTrips(wo); wbR.trips.forEach(t => { t.broker = "wb"; }); }
      const trips = rhR.trips.concat(wbR.trips), unmatched = rhR.unmatched.concat(wbR.unmatched), open = rhR.open.concat(wbR.open);
      if (!trips.length) { out.innerHTML = '<p class="muted">No completed round trips in this period.</p>'; btn.disabled = false; return; }
      const m = await macro(); const syms = [...new Set(trips.map(t => t.symbol))];
      const bars = await D.dailyBars(syms, days + 420, (i, n) => busy(out, `Reading history ${i} of ${n}…`));
      busy(out, "Tagging each trade…"); await new Promise(r => setTimeout(r, 0));
      const prepped = {}; syms.forEach(s => { if ((bars[s] || []).length > 260) prepped[s] = P.prep(bars[s]); });
      for (const t of trips) {
        const day = E.ny(t.entryT).date; t.entryDay = day; t.entryMin = E.ny(t.entryT).min;
        const sp = m.spy.filter(x => x.d < day), vx = m.vix.filter(x => x.d < day);
        t.gate = sp.length > 200 ? P.gate(sp, vx, null).verdict : null;
        const b = bars[t.symbol] || [], x = prepped[t.symbol];
        let i = -1; for (let k = b.length - 1; k >= 0; k--) if (b[k].d < day) { i = k; break; }
        t.setups = x && i >= 252 ? P.setupsAt(b, x, i).map(s => s.id) : null;
      }
      const pm = P.matchPlans(trips, await Plans.all().catch(() => []));
      const r = P.edgeReport(trips);
      const g = r.all, money0 = v => money(v);
      out.innerHTML = `
        <p class="verdict-line">${esc(`${g.n} round trips: ${(g.win * 100).toFixed(0)}% winners, ${money0(g.exp)} per trade on average, ${money0(g.pnl)} in total.`)}</p>
        <div class="kv six">${D.kv([["Average win", money0(g.avgWin)], ["Average loss", money0(g.avgLoss)], ["Win ÷ loss size", g.avgWin != null && g.avgLoss ? (g.avgWin / -g.avgLoss).toFixed(2) : "—"], ["Profit factor", g.pf == null ? "—" : g.pf === Infinity ? "no losses" : g.pf.toFixed(2)], ["Deepest drop", money0(-r.maxDD)], ["Longest losing run", String(r.worstStreak)]])}</div>
        ${pm.n ? `<div class="panel" style="margin-top:14px"><div class="ph"><h2 style="font-size:15px">Trades with a saved plan</h2><span class="eyebrow">${pm.n} matched</span></div><div class="kv six">${D.kv([["Average", R(pm.expR)], ["Win rate", p0(pm.win)], ["Worst", R(pm.worstR)], ["Stop broken", pm.brokeStop + " of " + pm.n], ["Held past plan", pm.overHold + " of " + pm.n], ["Entry vs plan", pct(pm.avgSlip)]])}</div><div class="pb muted" style="font-size:12px">Stop broken: sold more than a quarter of the risk below the planned stop. Results are in R on the plan's own risk. A trade is matched to a long plan for the same stock saved up to 7 days before the purchase.${pm.byCheck && Object.keys(pm.byCheck).length ? ` By the checklist's verdict when you saved the plan: ${["go", "wait", "no"].filter(k => pm.byCheck[k]).map(k => `${{ go: "Go", wait: "Wait", no: "No" }[k]} ${R(pm.byCheck[k].expR)} over ${pm.byCheck[k].n} (${p0(pm.byCheck[k].win)} won)`).join("; ")}.` : ""}</div></div>` : '<p class="muted" style="font-size:13px">No trades match a saved plan yet. Save plans from Size a trade or the Scanner, and this will show your results in R and whether you kept your stops.</p>'}
        ${r.lessons.length ? '<h3 style="font-family:var(--font-display);font-size:16px;margin:16px 0 6px">What your trades say</h3><ul style="margin:0 0 6px;padding-inline-start:20px;max-width:80ch">' + r.lessons.slice(0, 6).map(l => `<li style="margin-block:5px">${esc(l)}</li>`).join("") + "</ul>" : '<p class="muted">Each comparison needs at least 5 trades on both sides, so there are no lessons yet. A longer period helps.</p>'}
        <div class="legend" style="margin-top:12px"><span><i style="background:var(--teal)"></i>Running total of closed trades</span></div>
        <div class="chart-box" style="height:200px"><canvas id="pbCurve" role="img" aria-label="Running total of closed trades"></canvas></div>
        <div class="grid2" style="margin-top:12px">${r.groups.map(gr => `<div class="panel"><div class="ph"><h2 style="font-size:15px">${esc(gr.title)}</h2></div><div class="scroll"><table class="dt"><thead><tr><th>Group</th><th>Trades</th><th>Win rate</th><th>Per trade</th><th>Total</th></tr></thead><tbody>${gr.rows.map(x => x.s ? `<tr><td>${esc(x.label)}</td><td>${x.s.n}</td><td>${(x.s.win * 100).toFixed(0)}%</td><td class="chg ${x.s.exp >= 0 ? "up" : "down"}">${money0(x.s.exp)}</td><td class="chg ${x.s.pnl >= 0 ? "up" : "down"}">${money0(x.s.pnl)}</td></tr>` : `<tr><td>${esc(x.label)}</td><td>0</td><td colspan="3" class="muted">None</td></tr>`).join("")}</tbody></table></div></div>`).join("")}</div>
        <div class="pb muted" style="font-size:12px;padding-inline:0">Groups with fewer than 10 trades swing a lot; read them as hints. The market gate here is rebuilt from S&amp;P and VIX closes before each purchase, without breadth. ${unmatched.length ? unmatched.length + " sells were of shares bought before the period and are left out. " : ""}${open.length ? open.length + " purchase lots are still open. " : ""}Book has the same trades scored against the Standard.</div>`;
      D.lineChart(out.querySelector("#pbCurve"), { series: [{ vals: [0].concat(r.curve.map(c => c.v)), color: D.tok("--teal") }], guides: [{ y: 0, color: D.tok("--ink-3"), label: "0" }], labels: [""].concat(r.curve.map(c => c.d.slice(5))), fmt: v => "$" + Math.round(v).toLocaleString("en-US") });
    } catch (e) { fail(out, e); }
    btn.disabled = false;
  }

  /* ---------- Evidence ---------- */
  function drawEvidence(box) {
    box.innerHTML = `<div class="tools" style="margin-bottom:12px;flex-wrap:wrap"><select id="pbHold" class="btn small" aria-label="Time exit"><option value="5">Exit after 5 days</option><option value="10">Exit after 10 days</option><option value="20">Exit after 20 days</option></select><button class="btn small primary" id="pbEvRun" type="button">Test the setups</button><button class="btn small" id="pbEvReset" type="button">Reset the trial count</button></div>
      <div id="pbEvOut"><p class="muted" style="font-size:13px">Backtests exactly the rules the Scanner uses, on about three years of the list's daily bars, with your cost per side. Results are in R: 1R is the planned loss from entry to stop.</p></div>`;
    box.querySelector("#pbHold").value = String(cfg.hold);
    box.querySelector("#pbHold").onchange = e => { cfg.hold = +e.target.value; saveCfg(); };
    box.querySelector("#pbEvRun").onclick = () => evid(box);
    box.querySelector("#pbEvReset").onclick = () => { D.save("pbTrials", { keys: [], srs: [] }); evKey = ""; D.toast && D.toast("Trial count reset"); evid(box); };
    evid(box);
  }
  async function evid(box) {
    const out = box.querySelector("#pbEvOut");
    try {
      if (!cfg.listId) { out.innerHTML = '<p class="muted">Choose a list above.</p>'; return; }
      const st = await listSets(t => busy(out, t)); busy(out, "Testing…"); await new Promise(r => setTimeout(r, 0));
      const e = getEvidence();
      const cls = k => k === "holds" ? "pass" : k === "no" ? "fail" : "";
      out.innerHTML = `
        <p class="verdict-line" style="font-size:18px">${esc(`${e.names} names, ${e.trades.length} trades. Trials so far: ${e.trials} (every setting you test counts, because the best of many tries looks good by luck).`)}</p>
        <div class="scroll"><table class="dt"><thead><tr><th>Setup</th><th>Trades</th><th>Win rate</th><th>Average</th><th>Profit factor</th><th>Days held</th><th>First 70%</th><th>Last 30%</th><th>Rising volume</th><th>Falling volume</th><th>Deflated Sharpe</th><th>Verdict</th></tr></thead><tbody>
        ${e.rows.map(r => `<tr><td style="white-space:normal;min-width:180px"><b>${esc(r.label)}</b><span class="note" style="display:block;font-size:11px;color:var(--ink-3)">${esc(r.cite)}</span></td><td>${r.n}</td><td>${p0(r.win)}</td><td class="chg ${r.expR >= 0 ? "up" : "down"}">${R(r.expR)}</td><td>${r.pf == null ? "—" : r.pf === Infinity ? "no losses" : r.pf.toFixed(2)}</td><td>${r.avgBars == null ? "—" : r.avgBars.toFixed(1)}</td><td>${R(r.train.expR)} <span class="muted">${r.train.n}</span></td><td class="chg ${r.test.expR >= 0 ? "up" : "down"}">${R(r.test.expR)} <span class="muted">${r.test.n}</span></td><td class="chg ${r.volUp.expR >= 0 ? "up" : "down"}">${R(r.volUp.expR)} <span class="muted">${r.volUp.n}</span></td><td class="chg ${r.volDown.expR >= 0 ? "up" : "down"}">${R(r.volDown.expR)} <span class="muted">${r.volDown.n}</span></td><td>${r.deflated ? p0(r.deflated.dsr) : "—"}</td><td><span class="pill ${cls(r.verdict.key)}">${esc(r.verdict.text)}</span></td></tr>`).join("")}
        </tbody></table></div>
        <div class="pb muted" style="font-size:12px;padding-inline:0">
          <b>How to read it.</b> Rising and Falling volume split each setup's trades by whether the 20-day average volume was higher or lower than 20 sessions earlier when the signal fired: the "trend supported by volume" idea, tested. Average is the profit per trade in R after costs; above +0.1R is useful. First 70% and Last 30% split the trades by entry date at ${esc(e.split || "—")}; an edge that only shows up in the first part was probably fitted to it. The deflated Sharpe (Bailey and López de Prado, 2014) is the chance the true edge is above zero after allowing for the number of settings tried, the trade count and fat tails; 95% or more is strong. "Held up" needs a positive average in both parts, at least 10 later trades and a deflated Sharpe of 95%.
          <br><b>Earnings drift</b> uses Robinhood's last 8 quarters of reported and estimated earnings per share, so it covers only about two years and will show few trades for a while; it holds up to 40 sessions with no target.
          <br><b>How it trades.</b> A setup on a close places a buy-stop for the next session only. It fills at the entry, or at the open when the stock gaps above it. Inside a day the price is assumed to go open, low, high, close on an up day and open, high, low, close on a down day. Exit at the stop (at the open on a gap through it), the target, or the close after ${cfg.hold} days; the HP trend setup has no target and leaves at the next open after its averages cross back down, or after 60 sessions. One open trade per setup per name. Trades overlap in time across names, so the statistics are a little optimistic. The list is today's list, which favours names that survived. This is a test of the past, not a forecast.</div><div id="pbFwd" style="margin-top:18px"></div>`;
      renderForward(out.querySelector("#pbFwd"));
    } catch (e) { fail(out, e); }
  }
  /* Forward record: every logged signal followed on the sessions after it was logged. The only test on data the rules
     never saw. */
  async function renderForward(el) {
    if (!el) return;
    const db = await sigDb(); if (!db) { el.innerHTML = '<p class="muted" style="font-size:12px">The forward record needs this page\'s database, which this view cannot reach.</p>'; return; }
    busy(el, "Reading the forward record…");
    try {
      const q = await db.collection("signals").get(), sigs = q.docs.map(d => d.data()).filter(z => z && z.sym && z.date);
      const head = '<div class="panel"><div class="ph"><h2>Forward record</h2><span class="eyebrow">Signals followed after they were logged</span></div>';
      if (!sigs.length) { el.innerHTML = head + '<div class="pb muted" style="font-size:13px">No signals logged yet. Every Scanner run, and the daily report, saves the setups it shows here; each is then followed on the sessions after it: was the buy-stop filled the next session, then did it reach the stop, the target or the time limit. After a few months this shows which setups work on days the rules have never seen.</div></div>'; return; }
      const syms = [...new Set(sigs.map(z => z.sym))], first = sigs.map(z => z.date).sort()[0];
      const days = Math.max(60, Math.ceil((Date.now() - Date.parse(first + "T12:00:00Z")) / D.DAY) + 30);
      const bars = await D.dailyBars(syms, days, (a, b) => busy(el, `Reading prices ${a} of ${b}…`));
      const res = sigs.map(z => Object.assign({}, z, P.resolveSignal(bars[z.sym] || [], z))).sort((a, b) => a.date < b.date ? 1 : -1);
      const rows = P.SETUPS.map(S => { const r = res.filter(z => z.setup === S.id), closed = r.filter(z => z.status === "closed"); return { S, n: r.length, notFilled: r.filter(z => z.status === "not filled").length, open: r.filter(z => z.status === "open").length, pending: r.filter(z => z.status === "pending").length, closed: closed.length, sum: closed.length ? P.rSummary(closed) : null }; }).filter(r => r.n);
      const allClosed = res.filter(z => z.status === "closed"), tot = allClosed.length ? P.rSummary(allClosed) : null;
      const ST = { pending: "Waiting", "not filled": "Not filled", open: "Open", closed: "Closed", "bad stop": "—" };
      el.innerHTML = head + `<div class="pb" style="padding-bottom:0"><p style="margin:0;font-size:14px">${esc(`${res.length} signals since ${first}: ${allClosed.length} closed${tot ? `, average ${R(tot.expR)}, ${p0(tot.win)} winners` : ""}; ${res.filter(z => z.status === "open").length} open; ${res.filter(z => z.status === "not filled").length} never filled.`)}</p></div>
        <div class="scroll"><table class="dt"><thead><tr><th>Setup</th><th>Signals</th><th>Not filled</th><th>Open</th><th>Closed</th><th>Average (closed)</th><th>Win rate</th></tr></thead><tbody>
        ${rows.map(r => `<tr><td><b>${esc(r.S.short)}</b></td><td>${r.n}</td><td>${r.notFilled}</td><td>${r.open}</td><td>${r.closed}</td><td>${r.sum ? `<span class="chg ${r.sum.expR >= 0 ? "up" : "down"}">${R(r.sum.expR)}</span>` : "—"}</td><td>${r.sum ? p0(r.sum.win) : "—"}</td></tr>`).join("")}
        </tbody></table></div>
        <h3 style="margin:14px 16px 6px;font-size:14px">Latest signals</h3>
        <div class="scroll"><table class="dt"><thead><tr><th>Signal date</th><th>Symbol</th><th>Setup</th><th>Buy above</th><th>Stop</th><th>Status</th><th>Result</th></tr></thead><tbody>
        ${res.slice(0, 20).map(z => `<tr class="clickable" tabindex="0" data-sym="${esc(z.sym)}"><td>${esc(z.date)}</td><td><b>${esc(z.sym)}</b></td><td>${esc((P.SETUPS.find(S => S.id === z.setup) || {}).short || z.setup)}</td><td>${px(z.entry)}</td><td>${px(z.stop)}</td><td>${esc(ST[z.status] || z.status)}${z.why && z.status !== "open" ? ` <span class="muted">${esc(z.why)}</span>` : ""}</td><td>${z.R != null ? `<span class="chg ${z.R >= 0 ? "up" : "down"}">${R(z.R)}</span>${z.status === "open" ? ' <span class="muted">so far</span>' : ""}` : "—"}</td></tr>`).join("")}
        </tbody></table></div>
        <div class="pb muted" style="font-size:12px">Same trading rules as the backtest: a buy-stop good for the next session only, then the stop, the target or the time limit (the HP trend setup is followed to its 60-session limit here, without its trend exit). Results are before costs. A few weeks of signals mean little; judge a setup after 30 or more closed trades.</div></div>`;
    } catch (e) { fail(el, e); }
  }

  D.register("playbook", {
    async mount(r) {
      root = r; if (D.needsLive(root)) return; shell();
      try {
        await D.loadLists(); const sel = root.querySelector("#pbList"); D.fillLists(sel); await D.addListSources(sel).catch(() => {});
        if (cfg.listId && [...sel.options].some(o => o.value === cfg.listId)) sel.value = cfg.listId; else { const first = [...sel.options].find(o => /^first list$/i.test(o.textContent)) || sel.options[0]; if (first) sel.value = first.value; cfg.listId = sel.value; saveCfg(); }
      } catch (e) {}
      show();
    },
  });
})();
