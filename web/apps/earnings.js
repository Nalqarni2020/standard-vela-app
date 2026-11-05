/* Earnings: who reports soon, how a stock has reacted before, whether it drifted after, and what options price in now. */
(function () {
  "use strict";
  const D = window.Desk, A = window.Analytics;
  const { esc, px, pct, call } = D;
  let root;

  async function results(sym) {
    const d = await call("get_earnings_results", { symbol: sym }, 3600000);
    return ((d && d.results) || []).map(r => ({ year: r.year, quarter: r.quarter, est: r.eps && r.eps.estimate != null ? +r.eps.estimate : null, act: r.eps && r.eps.actual != null ? +r.eps.actual : null, date: r.report && r.report.date, timing: r.report && r.report.timing, verified: !!(r.report && r.report.verified) })).filter(r => r.date);
  }
  /* Implied move: at-the-money call + put mid price over spot, for the first expiry on or after the reaction session. */
  async function impliedMove(sym, afterDate) {
    const ch = await call("get_option_chains", { underlying_symbol: sym }, 3600000);
    const chain = ((ch && ch.chains) || []).find(c => c.symbol === sym) || ((ch && ch.chains) || [])[0];
    if (!chain) return null;
    const exp = chain.expiration_dates.find(x => x >= afterDate); if (!exp) return null;
    const q = await D.quotes([sym]); const spot = D.lastPrice(q[sym]); if (!spot) return null;
    let inst = [], cursor = null, pages = 0;
    do { const d = await call("get_option_instruments", Object.assign({ chain_id: chain.id, expiration_dates: exp }, cursor ? { cursor } : {}), 600000); inst = inst.concat((d && d.instruments) || []); cursor = d && d.next; pages++; } while (cursor && pages < 5);
    const strikes = [...new Set(inst.map(x => +x.strike_price))].sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot));
    const k = strikes[0]; if (k == null) return null;
    const pair = inst.filter(x => +x.strike_price === k);
    const d = await call("get_option_quotes", { instrument_ids: pair.map(x => x.id) }, 60000);
    const marks = {}; ((d && d.results) || []).forEach(r => { const o = pair.find(x => x.id === (r.quote || {}).instrument_id); if (o) marks[o.type] = +r.quote.mark_price; });
    if (!(marks.call >= 0 && marks.put >= 0)) return null;
    return { exp, strike: k, spot, move: (marks.call + marks.put) / spot };
  }
  D.earningsSummary = async function (sym) {
    const rs = await results(sym), bars = await D.dailyBars([sym, "SPY"], 900);
    const re = A.earningsReactions(bars[sym] || [], bars.SPY || [], rs, 20);
    const next = rs.find(r => r.act == null);
    return { source: "Robinhood earnings results and daily bars", symbol: sym, nextReport: next ? { date: next.date, timing: next.timing, confirmed: next.verified, epsEstimate: next.est } : null,
      past: re.map(x => ({ reported: x.date, epsEstimate: x.est, epsActual: x.act, surprisePct: x.surprisePct, reactionDay: x.reaction, next20SessionsVsSpy: x.driftEx })),
      avgAbsoluteReaction: re.length ? A.mean(re.map(x => Math.abs(x.reaction))) : null };
  };
  (D.extraAnalystTools = D.extraAnalystTools || []).push({ name: "earnings_history", label: "earnings history", description: "Earnings for one stock: the next report date and EPS estimate, and for up to 8 past quarters the EPS estimate, actual, surprise, the reaction-day move and the following 20 sessions versus SPY.", inputSchema: { type: "object", properties: { symbol: { type: "string" } }, required: ["symbol"] }, fn: sym => D.earningsSummary(sym) });

  function shell() {
    root.innerHTML = `
      <div class="app-h"><h1>Earnings</h1><p>Who reports soon, how a stock has reacted to past reports, whether it kept drifting after, and how big a move the options market is pricing in now.</p></div>
      <div class="panel"><div class="ph"><h2>Upcoming in your watchlist</h2><div class="tools"><select id="erList" class="btn small" aria-label="Watchlist"></select><button class="btn small primary" id="erUp" type="button">Check dates</button></div></div>
        <div class="pb" id="erUpOut"><p class="muted" style="margin:0;font-size:13px">Lists each name's next report, how much it moved on report days before, and on request what options price in.</p></div></div>
      <div class="panel" style="margin-top:18px"><div class="ph"><h2>One stock</h2><form class="tools" id="erForm" autocomplete="off"><input id="erSym" class="btn small" style="width:8em;cursor:text;text-transform:uppercase" aria-label="Ticker"><button class="btn small primary" type="submit">Read history</button></form></div>
        <div class="pb" id="erOut"></div></div>
      <p class="muted" style="font-size:12px">Reaction: close of the first session that could trade on the news against the close before it (report day for morning reports, next day for evening ones). Drift: the next 20 sessions against SPY. Post-earnings drift, prices continuing in the surprise's direction, was documented by Bernard and Thomas (1989). Implied move: at-the-money call plus put, over the stock price, for the first expiry after the report. Dates marked tentative are not confirmed by the company.</p>`;
    root.querySelector("#erSym").value = D.S.sym && D.S.sym !== "EXAMPLE" ? D.S.sym : "CIFR";
    root.querySelector("#erForm").onsubmit = e => { e.preventDefault(); one(); };
    root.querySelector("#erUp").onclick = upcoming;
    root.addEventListener("click", async e => {
      const s = e.target.closest("[data-sym]"); if (s) { D.openSymbol(s.dataset.sym); return; }
      const im = e.target.closest("[data-im]"); if (im) { im.disabled = true; im.textContent = "…"; try { const r = await impliedMove(im.dataset.im, im.dataset.after); im.outerHTML = r ? `<span>${pct(r.move).replace("+", "±")} <span class="muted">to ${esc(r.exp)}</span></span>` : '<span class="muted">No options</span>'; } catch (x) { im.outerHTML = '<span class="muted">' + esc(x.message) + "</span>"; } }
    });
  }

  async function upcoming() {
    const out = root.querySelector("#erUpOut"), id = root.querySelector("#erList").value;
    if (!id) { out.innerHTML = '<p class="muted">Choose a watchlist.</p>'; return; }
    try {
      const it = await call("get_watchlist_items", { list_id: id }, 600000);
      const syms = ((it && it.items) || []).filter(i => i.object_type === "instrument" && i.symbol).map(i => i.symbol).slice(0, 40);
      const rows = [], today = new Date().toISOString().slice(0, 10);
      for (let i = 0; i < syms.length; i++) { out.innerHTML = `<p class="muted">Reading earnings ${i + 1} of ${syms.length}…</p>`; try { rows.push({ sym: syms[i], rs: await results(syms[i]) }); } catch (e) { if (e.code !== "tool_error") throw e; rows.push({ sym: syms[i], rs: [] }); } }
      out.innerHTML = '<p class="muted">Measuring past reactions…</p>';
      const bars = await D.dailyBars(syms.concat(["SPY"]), 760);
      rows.forEach(r => { r.next = r.rs.find(x => x.act == null && x.date >= today); const re = A.earningsReactions(bars[r.sym] || [], bars.SPY || [], r.rs, 20); r.avgMove = re.length ? A.mean(re.map(x => Math.abs(x.reaction))) : null; r.nQ = re.length; });
      rows.sort((a, b) => (a.next ? a.next.date : "9999").localeCompare(b.next ? b.next.date : "9999"));
      const soon = rows.filter(r => r.next && (Date.parse(r.next.date) - Date.now()) / 86400000 <= 14);
      out.innerHTML = `<p class="verdict-line">${esc(soon.length ? soon.length + " of your names report in the next 14 days: " + soon.map(r => r.sym + " " + r.next.date.slice(5)).join(", ") + "." : "None of these names reports in the next 14 days.")}</p>
        <div class="scroll"><table class="dt"><thead><tr><th>Symbol</th><th>Next report</th><th>When</th><th>Days away</th><th>EPS estimate</th><th>Average report-day move</th><th>Options price in</th></tr></thead><tbody>
        ${rows.map(r => { const n = r.next, days = n ? Math.round((Date.parse(n.date) - Date.parse(today)) / 86400000) : null; const after = n ? (n.timing === "am" ? n.date : new Date(Date.parse(n.date) + 86400000).toISOString().slice(0, 10)) : null;
          return `<tr><td><button class="btn small" type="button" data-sym="${esc(r.sym)}">${esc(r.sym)}</button></td><td>${n ? esc(n.date) + (n.verified ? "" : ' <span class="muted">tentative</span>') : "—"}</td><td>${n ? (n.timing === "am" ? "Before open" : n.timing === "pm" ? "After close" : esc(n.timing || "—")) : "—"}</td><td>${days == null ? "—" : days}</td><td>${n && n.est != null ? px(n.est) : "—"}</td><td>${r.avgMove == null ? "—" : "±" + (r.avgMove * 100).toFixed(1) + "% <span class='muted'>(" + r.nQ + " reports)</span>"}</td><td>${n && days != null && days <= 45 ? `<button class="btn small" type="button" data-im="${esc(r.sym)}" data-after="${after}">Check</button>` : "—"}</td></tr>`; }).join("")}
        </tbody></table></div>
        <p class="muted" style="font-size:12px;margin:8px 0 0">If options price in a bigger move than the stock usually makes, the market expects an unusual report, or options are expensive. Smaller than usual means the opposite.</p>`;
    } catch (e) { out.innerHTML = '<div class="banner bad">' + esc(e.message) + "</div>"; }
  }

  async function one() {
    const out = root.querySelector("#erOut"), sym = root.querySelector("#erSym").value.trim().toUpperCase().replace(/^\$/, "");
    if (!/^[A-Z][A-Z0-9.]{0,9}$/.test(sym)) { out.innerHTML = '<p class="muted">Type a US ticker.</p>'; return; }
    out.innerHTML = '<p class="muted">Reading earnings…</p>';
    try {
      const rs = await results(sym);
      if (!rs.length) { out.innerHTML = '<p class="muted">No earnings history came back for ' + esc(sym) + ".</p>"; return; }
      const bars = await D.dailyBars([sym, "SPY"], 900);
      const re = A.earningsReactions(bars[sym] || [], bars.SPY || [], rs, 20);
      const next = rs.find(r => r.act == null);
      const beats = re.filter(x => x.surprise > 0), misses = re.filter(x => x.surprise < 0);
      const avgAbs = re.length ? A.mean(re.map(x => Math.abs(x.reaction))) : null;
      const drB = A.summarize(beats.map(x => x.driftEx)), drM = A.summarize(misses.map(x => x.driftEx));
      let line = `${sym} beat the EPS estimate in ${beats.length} of the last ${re.length} reports and moved ${avgAbs == null ? "—" : "±" + (avgAbs * 100).toFixed(1) + "%"} on the average report day.`;
      if (drB.n && drM.n) line += ` After beats it went on to ${pct(drB.mean)} against SPY over 20 sessions; after misses ${pct(drM.mean)}.`;
      out.innerHTML = `<p class="verdict-line">${esc(line)}</p>
        ${next ? `<div class="kv four">${D.kv([["Next report", next.date + (next.verified ? "" : " (tentative)")], ["When", next.timing === "am" ? "Before open" : next.timing === "pm" ? "After close" : (next.timing || "—")], ["EPS estimate", next.est == null ? "—" : px(next.est)], ["Options price in", "…"]])}</div>` : ""}
        <div class="scroll"><table class="dt"><thead><tr><th>Reported</th><th>Quarter</th><th>EPS estimate</th><th>EPS actual</th><th>Surprise</th><th>Reaction day</th><th>Gap at open</th><th>Next 20 sessions vs SPY</th></tr></thead><tbody>
        ${re.slice().reverse().map(x => `<tr><td>${esc(x.date)} <span class="muted">${x.timing === "am" ? "am" : "pm"}</span></td><td>${(rs.find(r => r.date === x.date) || {}).year || ""} Q${(rs.find(r => r.date === x.date) || {}).quarter || ""}</td><td>${px(x.est)}</td><td>${px(x.act)}</td><td class="chg ${x.surprise >= 0 ? "up" : "down"}">${x.surprise == null ? "—" : (x.surprise >= 0 ? "Beat " : "Miss ") + (x.surprisePct == null ? "" : pct(x.surprisePct))}</td><td class="chg ${x.reaction >= 0 ? "up" : "down"}">${pct(x.reaction)}</td><td>${pct(x.gap)}</td><td class="chg ${x.driftEx >= 0 ? "up" : "down"}">${x.driftEx == null ? "—" : pct(x.driftEx)}</td></tr>`).join("")}
        </tbody></table></div>`;
      if (next) {
        const after = next.timing === "am" ? next.date : new Date(Date.parse(next.date) + 86400000).toISOString().slice(0, 10);
        impliedMove(sym, after).then(r => { const n = out.querySelectorAll(".kv .n")[3]; if (n) n.textContent = r ? pct(r.move).replace("+", "±") + " to " + r.exp + (avgAbs ? (r.move > avgAbs * 1.2 ? " · above its usual move" : r.move < avgAbs * 0.8 ? " · below its usual move" : " · near its usual move") : "") : "No options"; }).catch(() => { const n = out.querySelectorAll(".kv .n")[3]; if (n) n.textContent = "Not available"; });
      }
    } catch (e) { out.innerHTML = '<div class="banner bad">' + esc(e.message) + "</div>"; }
  }

  D.register("earnings", { async mount(r) { root = r; if (D.needsLive(root)) return; shell(); one(); try { await D.loadLists(); D.fillLists(root.querySelector("#erList")); } catch (e) {} } });
})();
