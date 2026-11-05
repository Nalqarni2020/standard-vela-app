/* Book: risk on the account right now, and a journal of past round trips scored against the Standard. Read-only. */
(function () {
  "use strict";
  const D = window.Desk, A = window.Analytics, E = D.E;
  const { esc, px, pct, int, money, call } = D;
  const mask = n => "••••" + String(n).slice(-4);
  const SPANS = { "1m": { label: "1 month", days: 31, pnl: "month" }, "3m": { label: "3 months", days: 92, pnl: "3month" }, "6m": { label: "6 months", days: 183, pnl: "all" }, "1y": { label: "1 year", days: 366, pnl: "all" } };

  let root, acct = null, accounts = [], span = D.load("bookSpan", "3m");

  function shell() {
    root.innerHTML = `
      <div class="app-h"><h1>Book</h1><p>Your real account, read-only: what it can lose today, and what your past trades say about your habits.</p></div>
      <div class="tools" style="margin-bottom:12px;flex-wrap:wrap">
        <select id="bkAcct" class="btn small" aria-label="Account"></select>
        <button class="btn small primary" id="bkLoad" type="button">Refresh</button>
      </div>
      <div id="bkRisk"></div>
      <div class="panel" style="margin-top:18px">
        <div class="ph"><h2>Journal</h2>
          <div class="tools"><select id="bkSpan" class="btn small" aria-label="Period">${Object.entries(SPANS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("")}</select>
          <button class="btn small primary" id="bkJournal" type="button">Score my trades</button></div></div>
        <div class="pb" id="bkJOut"><p class="muted" style="margin:0;font-size:13px">Rebuilds every round trip from your filled orders (first in, first out), then checks what the Standard said on the close before each purchase. It shows which habits made or lost you money.</p></div>
      </div>`;
    root.querySelector("#bkSpan").value = span;
    root.querySelector("#bkLoad").onclick = loadRisk;
    root.querySelector("#bkJournal").onclick = journal;
    root.querySelector("#bkSpan").onchange = e => { span = e.target.value; D.save("bookSpan", span); };
    root.querySelector("#bkAcct").onchange = e => { acct = e.target.value; D.save("bookAcct", acct); loadRisk(); };
    root.addEventListener("click", e => { const tr = e.target.closest("tr[data-sym]"); if (tr) D.openSymbol(tr.dataset.sym); });
  }

  async function loadAccounts() {
    const d = await call("get_accounts", {}, 600000);
    accounts = ((d && d.accounts) || []).filter(a => a.state === "active" && !a.deactivated);
    accounts.sort((a, b) => (b.is_default ? 1 : 0) - (a.is_default ? 1 : 0));
    const saved = D.load("bookAcct", null);
    acct = accounts.some(a => a.account_number === saved) ? saved : accounts[0] && accounts[0].account_number;
    root.querySelector("#bkAcct").innerHTML = accounts.map(a => `<option value="${esc(a.account_number)}">${esc((a.nickname || a.brokerage_account_type || "Account") + " · " + a.type + " · " + mask(a.account_number))}</option>`).join("");
    if (acct) root.querySelector("#bkAcct").value = acct;
  }

  async function positions() {
    let out = [], cursor = null, pages = 0;
    do { const d = await call("get_equity_positions", Object.assign({ account_number: acct }, cursor ? { cursor } : {}), 30000); out = out.concat((d && d.positions) || []); cursor = d && d.next ? d.next : null; pages++; } while (cursor && pages < 10);
    return out.filter(p => +p.quantity > 0).map(p => ({ sym: p.symbol, qty: +p.quantity, avg: p.average_buy_price != null ? +p.average_buy_price : null, short: p.type && p.type !== "long" }));
  }

  async function loadRisk() {
    const box = root.querySelector("#bkRisk");
    box.innerHTML = '<p class="muted">Reading the account…</p>';
    try {
      if (!acct) await loadAccounts();
      if (!acct) { box.innerHTML = '<div class="banner">No active brokerage account came back.</div>'; return; }
      const [pf, pos] = await Promise.all([call("get_portfolio", { account_number: acct }, 30000), positions()]);
      const total = +pf.total_value || 0, cash = +pf.cash || 0, bp = pf.buying_power ? +pf.buying_power.buying_power : null;
      if (!pos.length) { box.innerHTML = '<div class="panel"><div class="kv four">' + D.kv([["Account value", money(total)], ["Cash", money(cash)], ["Buying power", money(bp)], ["Stock positions", "0"]]) + '</div><div class="pb muted">No open stock positions, so there is no stock risk to measure. Options and crypto are not covered here.</div></div>'; return; }
      const syms = pos.map(p => p.sym);
      const [q, bars] = await Promise.all([D.quotes(syms.concat(["SPY"])), D.dailyBars(syms.concat(["SPY"]), 430)]);
      const spy = bars.SPY || [], now = Date.now();
      const rows = pos.map(p => {
        const last = D.lastPrice(q[p.sym]), b = bars[p.sym] || [];
        const value = last != null ? last * p.qty : null;
        const a = b.length > 15 ? E.atr(b, 14) : null, atr = a ? a[a.length - 1] : null;
        let r = null, cb = null;
        if (b.length >= 30) {
          r = E.evaluate({ daily: b, spy, nowMs: now, live: null, mode: "day", intraday: [], account: Math.max(total, 1), bucket: "core", capPct: 1, allowShelfException: false });
          const c = E.candleBreak(b), bt = E.backtest(b, c, {});
          cb = { inTrade: !!bt.open, exit: c.nextBullLow, buyAt: c.nextBearHigh, sigToday: c.sig[c.sig.length - 1] };
        }
        const stop = r && r.stop != null && last != null && r.stop < last ? r.stop : null;
        return { ...p, last, value, unreal: last != null && p.avg != null ? (last - p.avg) * p.qty : null, unrealPct: last != null && p.avg ? last / p.avg - 1 : null,
          atr, atrRisk: atr != null ? atr * p.qty : null, stop, toStop: stop != null ? (last - stop) * p.qty : null, r, cb };
      }).sort((a, b) => (b.value || 0) - (a.value || 0));
      const eq = total || rows.reduce((s, x) => s + (x.value || 0), 0) + cash;
      const withBars = rows.filter(x => (bars[x.sym] || []).length > 30 && x.value != null);
      const risk = A.portfolioRisk(withBars.map(x => x.value / eq), withBars.map(x => bars[x.sym]), 60);
      const invested = rows.reduce((s, x) => s + (x.value || 0), 0);
      const biggest = rows[0];
      const reg = E.regime(spy);
      const varD = risk.var95 != null ? risk.var95 * eq : null;
      const corr = risk.corrPairs.filter(c => c.c >= 0.7);
      let line = varD != null ? `On a bad day (1 in 20) this account could lose about ${money(varD)}, or ${(risk.var95 * 100).toFixed(2)}% of it. ` : "";
      if (biggest && biggest.value != null) line += `${biggest.sym} is ${(biggest.value / eq * 100).toFixed(0)}% of the account. `;
      line += `The S&P tape is ${reg.state}.`;
      box.innerHTML = `
        <p class="verdict-line">${esc(line)}</p>
        <div class="panel"><div class="kv six">${D.kv([["Account value", money(eq)], ["Cash", money(cash)], ["Invested", (invested / eq * 100).toFixed(0) + "%"], ["Bad-day loss (95%)", varD != null ? money(varD) : "—"], ["Daily volatility", risk.sigma != null ? (risk.sigma * 100).toFixed(2) + "%" : "—"], ["Positions", String(rows.length)]])}</div>
        <div class="scroll"><table class="dt"><thead><tr><th>Symbol</th><th>Qty</th><th>Avg cost</th><th>Last</th><th>Value</th><th>Weight</th><th>Unrealized</th><th>1 ATR move</th><th>Standard stop</th><th>Loss to stop</th><th>Standard today</th><th>Candle break</th></tr></thead><tbody>
        ${rows.map(x => `<tr class="clickable" tabindex="0" data-sym="${esc(x.sym)}"><td><b>${esc(x.sym)}</b>${x.short ? " (short)" : ""}</td><td>${int(x.qty) === "0" ? x.qty.toFixed(4) : (x.qty % 1 ? x.qty.toFixed(4) : int(x.qty))}</td><td>${px(x.avg)}</td><td>${px(x.last)}</td><td>${money(x.value)}</td><td>${x.value != null ? (x.value / eq * 100).toFixed(1) + "%" : "—"}</td>
          <td class="chg ${x.unreal >= 0 ? "up" : "down"}">${money(x.unreal)} <span class="muted">${pct(x.unrealPct)}</span></td><td>${money(x.atrRisk)}</td><td>${px(x.stop)}</td><td>${money(x.toStop != null ? -x.toStop : null)}</td>
          <td>${x.r ? `<span class="pill ${x.r.verdict === "BUY" ? "pass" : "fail"}">${x.r.verdict === "BUY" ? "Pass" : "No"}</span>` : "—"}</td>
          <td>${x.cb ? (x.cb.sigToday === -1 ? '<span class="pill fail">Sell signal</span>' : x.cb.inTrade ? "Long · exit under " + px(x.cb.exit) : "Flat · buy over " + px(x.cb.buyAt)) : "—"}</td></tr>`).join("")}
        </tbody></table></div>
        <div class="pb muted" style="font-size:12px">Bad-day loss: 1.645 × the account's daily volatility over the last ${risk.n} sessions, from how these positions moved together (normal approximation; real crashes are worse). 1 ATR move: a typical day's range in dollars for the position. Standard stop: two cents under the shelf when one exists below the price. Tap a row to open it on Standard.</div></div>
        <div class="panel" style="margin-top:18px"><div class="ph"><h2>Positions that move together</h2><span class="eyebrow">Correlation of daily returns, 60 sessions</span></div>
          <div class="pb">${corr.length ? "<ul style='margin:0;padding-inline-start:20px'>" + corr.slice(0, 8).map(c => `<li><b>${esc(withBars[c.i].sym)}</b> and <b>${esc(withBars[c.j].sym)}</b>: ${c.c.toFixed(2)}. Together ${((withBars[c.i].value + withBars[c.j].value) / eq * 100).toFixed(0)}% of the account, so they act more like one bet than two.</li>`).join("") + "</ul>" : '<p class="muted" style="margin:0">No pair of positions moved together above 0.70. Diversification is working.</p>'}</div></div>`;
    } catch (e) { box.innerHTML = '<div class="banner bad">' + esc(e.message) + "</div>"; }
  }

  async function filledOrders(sinceIso) {
    let out = [], cursor = null, pages = 0;
    do {
      const d = await call("get_equity_orders", Object.assign({ account_number: acct, state: "filled", created_at_gte: sinceIso }, cursor ? { cursor } : {}), 120000);
      out = out.concat((d && d.orders) || []); cursor = d && d.next ? d.next : null; pages++;
    } while (cursor && pages < 30);
    return out;
  }
  async function realizedTotal(spanKey, sinceMs) {
    let total = 0, n = 0, cursor = null, pages = 0;
    do {
      const d = await call("get_pnl_trade_history", Object.assign({ account_number: acct, span: SPANS[spanKey].pnl }, cursor ? { cursor } : {}), 120000);
      ((d && d.trades) || []).forEach(t => { if (Date.parse(t.timestamp) >= sinceMs && t.realized_gain != null) { total += +t.realized_gain; n++; } });
      cursor = d && d.next_cursor ? d.next_cursor : null; pages++;
    } while (cursor && pages < 30);
    return { total, n };
  }

  async function journal() {
    const out = root.querySelector("#bkJOut"), btn = root.querySelector("#bkJournal");
    btn.disabled = true; out.innerHTML = '<p class="muted">Reading filled orders…</p>';
    try {
      if (!acct) await loadAccounts();
      const sinceMs = Date.now() - SPANS[span].days * 86400000, sinceIso = new Date(sinceMs).toISOString().slice(0, 10);
      const raw = await filledOrders(sinceIso);
      const orders = raw.filter(o => o.symbol && +o.cumulative_quantity > 0 && +o.average_price > 0).map(o => {
        const ex = (o.executions || []).map(x => Date.parse(x.timestamp)).filter(isFinite);
        const t = ex.length ? Math.max(...ex) : Date.parse(o.last_transaction_at || o.created_at);
        const n = E.ny(t);
        return { symbol: o.symbol, side: o.side, qty: +o.cumulative_quantity, price: +o.average_price, fees: +o.fees || 0, t, ext: n.min < 570 || n.min >= 960, midday: n.min >= 660 && n.min < 840 };
      });
      const midday = new Map(orders.map(o => [o.symbol + ":" + o.t, o.midday]));
      const { trips, unmatched, open } = A.roundTrips(orders);
      if (!trips.length) { out.innerHTML = '<p class="muted">No completed round trips in this period' + (unmatched.length ? ` (${unmatched.length} sells were of shares bought before it)` : "") + ".</p>"; btn.disabled = false; return; }
      out.innerHTML = '<p class="muted">Checking each entry against the Standard…</p>';
      const syms = [...new Set(trips.map(t => t.symbol))];
      const bars = await D.dailyBars(syms.concat(["SPY"]), SPANS[span].days + 200, (i, n) => { out.innerHTML = `<p class="muted">Reading history ${i} of ${n}…</p>`; });
      const spy = bars.SPY || [];
      for (const t of trips) {
        const day = E.ny(t.entryT).date, b = (bars[t.symbol] || []).filter(x => x.d < day), sp = spy.filter(x => x.d < day);
        t.entryDay = day; t.exitDay = E.ny(t.exitT).date; t.midday = !!midday.get(t.symbol + ":" + t.entryT);
        if (b.length >= 30 && sp.length >= 30) {
          const r = E.evaluate({ daily: b, spy: sp, nowMs: Date.parse(b[b.length - 1].d + "T23:00:00Z"), live: null, mode: "day", intraday: [], account: 100000, bucket: "core", capPct: 1, allowShelfException: false });
          t.std = r.checks && r.checks.length ? r.checks.every(c => c.pass) : null; t.stdFail = r.failed && r.failed[0] ? r.failed[0].id : null;
          t.tape = r.regime ? r.regime.state : null;
          const s20 = E.sma(b.map(x => x.c), 20); t.chase = s20[s20.length - 1] ? t.entryPx / s20[s20.length - 1] - 1 : null;
          const c = E.candleBreak(b), bt = E.backtest(b, c, {}); t.cbLong = !!bt.open || c.sig[c.sig.length - 1] === 1;
        }
      }
      const rh = await realizedTotal(span, sinceMs).catch(() => null);
      render(out, trips, unmatched, open, rh);
    } catch (e) { out.innerHTML = '<div class="banner bad">' + esc(e.message) + "</div>"; }
    btn.disabled = false;
  }

  function render(out, trips, unmatched, open, rh) {
    const all = A.groupStats(trips);
    const groups = [
      ["All round trips", trips],
      ["Standard table passed at entry", trips.filter(t => t.std === true)],
      ["Standard table failed at entry", trips.filter(t => t.std === false)],
      ["Bought in a Green S&P tape", trips.filter(t => t.tape === "Green")],
      ["Bought in a Yellow or Red tape", trips.filter(t => t.tape && t.tape !== "Green")],
      ["Bought more than 5% above the 20-day", trips.filter(t => t.chase != null && t.chase > 0.05)],
      ["Bought within 5% of the 20-day or below", trips.filter(t => t.chase != null && t.chase <= 0.05)],
      ["Candle break was long at entry", trips.filter(t => t.cbLong === true)],
      ["Candle break was flat at entry", trips.filter(t => t.cbLong === false)],
      ["Bought in extended hours", trips.filter(t => t.entryExt)],
      ["Bought in regular hours", trips.filter(t => !t.entryExt)],
      ["Bought between 11:00 and 14:00", trips.filter(t => t.midday)],
    ].map(([l, g]) => [l, A.groupStats(g)]);
    const lessons = [];
    const cmp = (a, b, good, bad) => { const x = groups.find(g => g[0] === a)[1], y = groups.find(g => g[0] === b)[1]; if (x && y && x.n >= 3 && y.n >= 3) { const d = x.avgRet - y.avgRet; if (Math.abs(d) >= 0.01) lessons.push({ w: Math.abs(d), text: d > 0 ? good(x, y) : bad(x, y) }); } };
    cmp("Standard table passed at entry", "Standard table failed at entry", (x, y) => `Entries that passed the Standard averaged ${pct(x.avgRet)} against ${pct(y.avgRet)} for the ones that failed it.`, (x, y) => `On your trades the Standard did not help yet: passes averaged ${pct(x.avgRet)}, fails ${pct(y.avgRet)}. Small samples swing; keep scoring.`);
    cmp("Bought in a Green S&P tape", "Bought in a Yellow or Red tape", (x, y) => `Buying in a Green tape averaged ${pct(x.avgRet)}; buying against it averaged ${pct(y.avgRet)}.`, (x, y) => `Your Yellow and Red tape buys did better (${pct(y.avgRet)}) than Green ones (${pct(x.avgRet)}) in this period.`);
    cmp("Bought within 5% of the 20-day or below", "Bought more than 5% above the 20-day", (x, y) => `Chasing cost you: buys stretched more than 5% above the 20-day averaged ${pct(y.avgRet)}, against ${pct(x.avgRet)} for the rest.`, (x, y) => `Your stretched buys did better (${pct(y.avgRet)}) than the rest (${pct(x.avgRet)}) this period.`);
    cmp("Bought in regular hours", "Bought in extended hours", (x, y) => `Extended-hours buys averaged ${pct(y.avgRet)}, regular-hours ${pct(x.avgRet)}. Thin books cost money.`, (x, y) => `Extended-hours buys averaged ${pct(y.avgRet)}, better than regular hours (${pct(x.avgRet)}).`);
    lessons.sort((a, b) => b.w - a.w);
    if (all.holdLoss != null && all.holdWin != null && all.holdLoss > all.holdWin * 1.5 && all.holdLoss - all.holdWin >= 1)
      lessons.unshift({ text: `You held losers ${all.holdLoss.toFixed(1)} days on average and winners ${all.holdWin.toFixed(1)}. Holding losers longer than winners is the disposition effect (Shefrin and Statman, 1985; Odean, 1998); a stop set at entry fixes it.` });
    const sumPnl = trips.reduce((s, t) => s + t.pnl, 0);
    out.innerHTML = `
      <p class="verdict-line">${esc(`${all.n} round trips: ${(all.win * 100).toFixed(0)}% winners, ${money(all.pnl)} in total, profit factor ${all.pf == null ? "—" : all.pf === Infinity ? "no losses" : all.pf.toFixed(2)}.`)}</p>
      ${lessons.length ? '<ul style="margin:0 0 14px;padding-inline-start:20px;max-width:80ch">' + lessons.slice(0, 4).map(l => `<li style="margin-block:5px">${esc(l.text)}</li>`).join("") + "</ul>" : '<p class="muted">Not enough trades in each group to compare habits yet. Groups need at least 3 trades each.</p>'}
      <div class="scroll"><table class="dt"><thead><tr><th>Group</th><th>Trades</th><th>Win rate</th><th>Average</th><th>Total P&amp;L</th><th>Profit factor</th><th>Days held, winners</th><th>Days held, losers</th></tr></thead><tbody>
      ${groups.map(([l, g]) => !g ? `<tr><td>${esc(l)}</td><td>0</td><td colspan="6" class="muted">None</td></tr>` : `<tr><td>${esc(l)}</td><td>${g.n}</td><td>${(g.win * 100).toFixed(0)}%</td><td class="chg ${g.avgRet >= 0 ? "up" : "down"}">${pct(g.avgRet)}</td><td class="chg ${g.pnl >= 0 ? "up" : "down"}">${money(g.pnl)}</td><td>${g.pf == null ? "—" : g.pf === Infinity ? "no losses" : g.pf.toFixed(2)}</td><td>${g.holdWin == null ? "—" : g.holdWin.toFixed(1)}</td><td>${g.holdLoss == null ? "—" : g.holdLoss.toFixed(1)}</td></tr>`).join("")}
      </tbody></table></div>
      <h3 style="font-family:var(--font-display);font-size:16px;margin:16px 0 6px">Every round trip</h3>
      <div class="scroll"><table class="dt"><thead><tr><th>Symbol</th><th>Bought</th><th>Sold</th><th>Qty</th><th>Entry</th><th>Exit</th><th>P&amp;L</th><th>Return</th><th>Days</th><th>Standard at entry</th><th>Tape</th><th>Above 20-day</th><th>Session</th></tr></thead><tbody>
      ${trips.slice().sort((a, b) => b.exitT - a.exitT).map(t => `<tr class="clickable" tabindex="0" data-sym="${esc(t.symbol)}"><td><b>${esc(t.symbol)}</b></td><td>${esc(t.entryDay)}</td><td>${esc(t.exitDay)}</td><td>${t.qty % 1 ? t.qty.toFixed(4) : int(t.qty)}</td><td>${px(t.entryPx)}</td><td>${px(t.exitPx)}</td><td class="chg ${t.pnl >= 0 ? "up" : "down"}">${money(t.pnl)}</td><td class="chg ${t.ret >= 0 ? "up" : "down"}">${pct(t.ret)}</td><td>${t.holdDays.toFixed(1)}</td><td>${t.std == null ? "—" : t.std ? '<span class="pill pass">Pass</span>' : '<span class="pill fail">' + esc(D.LABEL ? (D.LABEL[t.stdFail] || t.stdFail) : t.stdFail) + "</span>"}</td><td>${esc(t.tape || "—")}</td><td>${t.chase == null ? "—" : pct(t.chase)}</td><td>${t.entryExt ? "Extended" : t.midday ? "Midday" : "Regular"}</td></tr>`).join("")}
      </tbody></table></div>
      <div class="pb muted" style="font-size:12px;padding-inline:0">Rebuilt total: ${money(sumPnl)}. ${rh ? `Robinhood's own realized total for the period: ${money(rh.total)} on ${rh.n} sales. Differences come from shares bought before the period (${unmatched.length} sell${unmatched.length === 1 ? "" : "s"} could not be matched and are left out) and from Robinhood's own lot method.` : "Robinhood's realized total could not be read for comparison."} ${open.length ? open.length + " purchase lots are still open and are not scored." : ""} The Standard is read on the close before each purchase, so it uses only what was known then. Figures are informational, not a tax record.</div>`;
  }

  D.register("book", {
    mount(r) { root = r; if (D.needsLive(root)) return; shell(); loadAccounts().then(loadRisk).catch(e => { root.querySelector("#bkRisk").innerHTML = '<div class="banner bad">' + esc(e.message) + "</div>"; }); },
    onShow() {},
  });
})();
