/* Vela → Gamma: options exposure heatmap (GEX, VEX, DEX, charm) by strike and expiration, the King strike, call and put
   walls, the zero-gamma level, the expected move, and a log of each day's levels with a test of whether they held.
   All from Robinhood's option chain (open interest and implied volatility). Read-only. */
(function () {
  "use strict";
  const D = window.Desk, X = window.Exposure;
  const { esc, px, pct, call } = D;
  const big = v => v == null || !isFinite(v) ? "—" : (v < 0 ? "−$" : "$") + D.big(Math.abs(v)).replace(/^-/, "");
  const MEAS = [["gex", "GEX", "Gamma: dealer hedging per 1% move"], ["vex", "VEX", "Vanna: hedging change per 1 point of implied volatility"], ["dex", "DEX", "Delta: dollar delta of the open interest"], ["cex", "Charm", "Charm: change in that delta per day of time passing"]];
  const SCOPES = [["near", "Nearest expiration"], ["week", "This week"], ["month", "Next 30 days"]];
  let host = null, sym = null, chain = null, scope = D.load("gxScope", "week"), meas = D.load("gxMeas", "gex"), last = null, seq = 0;
  const nyNow = () => X.nyParts(Date.now());

  async function getChain(s) {
    const d = await call("get_option_chains", { underlying_symbol: s }, 3600000);
    const cs = (d && d.chains) || [];
    return cs.find(c => c.symbol === s && (c.underlying_instruments || []).length) || cs[0] || null;
  }
  function expsFor(sc, all) {
    const today = nyNow().date, live = all.filter(e => e >= today);
    if (sc === "near") return live.slice(0, 1);
    if (sc === "week") {
      const t = new Date(today + "T12:00:00Z"), wd = t.getUTCDay(), fri = new Date(t.getTime() + ((wd === 6 ? 6 : wd === 0 ? 5 : 5 - wd)) * 864e5).toISOString().slice(0, 10);
      const w = live.filter(e => e <= fri); return w.length ? w : live.slice(0, 1);
    }
    if (sc === "month") { const end = new Date(Date.parse(today + "T12:00:00Z") + 30 * 864e5).toISOString().slice(0, 10); return live.filter(e => e <= end).slice(0, 12); }
    return live.includes(sc) ? [sc] : live.slice(0, 1);
  }
  /* Contracts in the chosen expirations within 20% of the price: instruments arrive sorted by strike, so paging stops
     once a page is entirely above the range. Quotes come 100 to a call. */
  async function contracts(exps, spot, prog) {
    let inst = [], cursor = null, pages = 0;
    do {
      const d = await call("get_option_instruments", Object.assign({ chain_id: chain.id, expiration_dates: exps.join(",") }, cursor ? { cursor } : {}), 600000);
      const got = (d && d.instruments) || []; inst = inst.concat(got); cursor = d && d.next ? d.next : null; pages++;
      prog(`Reading contracts: ${inst.length}…`);
      if (got.length && Math.min(...got.map(i => +i.strike_price)) > spot * 1.2) break;
    } while (cursor && pages < 150);
    inst = inst.filter(i => { const k = +i.strike_price; return k >= spot * 0.8 && k <= spot * 1.2 && exps.includes(i.expiration_date); });
    const byId = new Map(inst.map(i => [i.id, i])), out = [], ids = inst.map(i => i.id), chunks = [];
    for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
    let asOf = null;
    for (let i = 0; i < chunks.length; i += 3) {
      const res = await Promise.all(chunks.slice(i, i + 3).map(ch => call("get_option_quotes", { instrument_ids: ch }, 120000)));
      res.forEach(d => ((d && d.results) || []).forEach(r => { const q = r.quote; if (!q) return; const ins = byId.get(q.instrument_id); if (!ins) return; if (q.updated_at && (!asOf || q.updated_at > asOf)) asOf = q.updated_at;
        out.push({ k: +ins.strike_price, type: ins.type, exp: ins.expiration_date, oi: +q.open_interest || 0, iv: q.implied_volatility == null ? null : +q.implied_volatility, mark: q.mark_price == null ? null : +q.mark_price }); }));
      prog(`Reading quotes: ${out.length} of ${inst.length}…`);
    }
    return { rows: out, asOf };
  }
  function spotNow() {
    const s = D.S.data; if (!s) return null; const q = s.quote;
    return q ? (D.marketOpen(q, Date.now()) ? q.last : (q.close || q.last)) : s.daily[s.daily.length - 1].c;
  }

  /* ---------- the levels log (this page's database; only you can open this page) ---------- */
  let dbP = null; const db = () => dbP || (dbP = (async () => { try { const c = window.claude; return c && c.use ? await c.use("db") : null; } catch (e) { return null; } })());
  async function logLevels(s, sc, x) {
    if (!["near", "week", "month"].includes(sc)) return null;
    const d = await db(); if (!d) return null;
    const n = nyNow(), snap = X.snapshot(x, Date.now(), sc), outside = !(n.wd >= 1 && n.wd <= 5 && n.min >= 570 && n.min < 960);
    const ref = d.collection("gexlog").doc(`${s}_${sc}_${n.date}`);
    try {
      const cur = await ref.get(), body = cur.exists ? Object.assign({}, cur.data()) : { sym: s, scope: sc, date: n.date, first: snap };
      body.last = snap; if (outside) body.pre = snap;
      await ref.set(body); return body;
    } catch (e) { return null; }
  }
  async function readLog(s, sc) {
    const d = await db(); if (!d) return null;
    try { const q = await d.collection("gexlog").where("sym", "==", s).get(); return q.docs.map(z => z.data()).filter(b => b && b.scope === sc).sort((a, b) => a.date < b.date ? -1 : 1); } catch (e) { return null; }
  }

  /* ---------- view ---------- */
  function shell() {
    host.innerHTML = `<div class="ph"><h2>Gamma</h2><span class="eyebrow" id="gxAsOf"></span></div>
      <div class="pb" style="padding-bottom:0"><div class="tools" style="flex-wrap:wrap;gap:8px">
        <select id="gxScope" class="btn small" aria-label="Expirations"></select>
        <div class="seg" role="group" aria-label="Measure" id="gxMeas" style="flex-wrap:wrap">${MEAS.map(([k, l, t]) => `<button type="button" data-m="${k}" title="${esc(t)}" aria-pressed="${k === meas}">${l}</button>`).join("")}</div>
        <button class="btn small primary" id="gxRun" type="button">Build</button><span class="muted" style="font-size:13px" id="gxNote"></span></div></div>
      <div id="gxOut" class="pb"></div><div id="gxLog" class="pb" style="padding-top:0"></div>`;
    host.querySelector("#gxRun").onclick = () => build();
    host.querySelector("#gxScope").onchange = e => { scope = e.target.value; D.save("gxScope", scope); build(); };
    host.querySelector("#gxMeas").onclick = e => { const b = e.target.closest("button[data-m]"); if (!b) return; meas = b.dataset.m; D.save("gxMeas", meas); host.querySelectorAll("#gxMeas button").forEach(z => z.setAttribute("aria-pressed", String(z.dataset.m === meas))); if (last) render(last); };
  }
  async function show(el) {
    if (host !== el || !host.querySelector("#gxOut")) { host = el; shell(); }
    const s = D.S.data && D.S.data.sym;
    if (D.S.example || !s) { host.querySelector("#gxOut").innerHTML = '<p class="muted">Gamma needs the Robinhood connection and a loaded symbol.</p>'; return; }
    if (s === sym && last) return;
    sym = s; last = null; chain = null;
    const out = host.querySelector("#gxOut"); out.innerHTML = '<p class="muted">Reading the option chain…</p>';
    try { chain = await getChain(s); } catch (e) { out.innerHTML = '<div class="banner bad">' + esc(e.message) + "</div>"; return; }
    if (!chain) { out.innerHTML = `<p class="muted">No listed options for ${esc(s)}.</p>`; return; }
    const sel = host.querySelector("#gxScope");
    sel.innerHTML = SCOPES.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("") + '<optgroup label="One expiration">' + chain.expiration_dates.filter(e => e >= nyNow().date).slice(0, 16).map(e => `<option value="${esc(e)}">${esc(e)}</option>`).join("") + "</optgroup>";
    if (![...sel.options].some(o => o.value === scope)) scope = "week"; sel.value = scope;
    build();
  }
  async function build() {
    if (!chain || !sym) return;
    const my = ++seq, out = host.querySelector("#gxOut"), btn = host.querySelector("#gxRun"), spot = spotNow(), s = sym;
    if (!(spot > 0)) { out.innerHTML = '<p class="muted">No price for this symbol.</p>'; return; }
    btn.disabled = true;
    const exps = expsFor(scope, chain.expiration_dates), prog = t => { if (my === seq) out.innerHTML = `<p class="muted">${esc(t)}</p>`; };
    try {
      const { rows, asOf } = await contracts(exps, spot, prog); if (my !== seq) return;
      if (!rows.length) { out.innerHTML = '<p class="muted">No contracts came back for these expirations.</p>'; btn.disabled = false; return; }
      const x = X.exposures(rows, spot, Date.now());
      const logged = await logLevels(s, scope, x).catch(() => null);
      last = { x, exps, asOf, sym: s, scope, logged };
      render(last); renderLog(s, scope);
    } catch (e) { if (my === seq) out.innerHTML = '<div class="banner bad">' + esc(e.message) + "</div>"; }
    btn.disabled = false;
  }
  function render(L) {
    const { x, exps, asOf } = L, out = host.querySelector("#gxOut"), m = meas;
    host.querySelector("#gxAsOf").textContent = asOf ? "Quotes " + new Date(asOf).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
    host.querySelector("#gxNote").textContent = `${x.used} contracts, ${exps.length} expiration${exps.length === 1 ? "" : "s"}` + (x.filled ? `; ${x.filled} without an implied volatility used the nearest strike's` : "");
    const pos = x.regime === "positive";
    const since = L.logged && L.logged.first && L.logged.first.t !== L.logged.last.t ? L.logged.first : null;
    const kv = [["Price", px(x.spot)], ["Net GEX per 1%", big(x.total.gex)], ["King strike", x.king ? px(x.king.k) + (x.contested ? " (contested)" : "") : "—"], ["Call wall", x.callWall ? px(x.callWall.k) : "—"], ["Put wall", x.putWall ? px(x.putWall.k) : "—"], ["Zero gamma", x.flip ? px(x.flip) : "none within 15%"],
      ["Expected move", x.em ? `±${px(x.em.straddle)} to ${x.em.exp.slice(5)}` : "—"], ["One day", x.em && x.em.day ? "±" + px(x.em.day) : "—"], ["Net VEX per vol point", big(x.total.vex)], ["Net DEX", big(x.total.dex)], ["Charm per day", big(x.total.cex)], ["Open interest", D.big(x.total.oi)]];
    // strikes: the 31 nearest the price, plus the King and walls
    const keep = new Set(x.strikes.slice().sort((a, b) => Math.abs(a.k - x.spot) - Math.abs(b.k - x.spot)).slice(0, 31).map(z => z.k));
    [x.king, x.callWall, x.putWall].forEach(z => z && keep.add(z.k));
    const rows = x.strikes.filter(z => keep.has(z.k)).sort((a, b) => b.k - a.k), cols = exps.slice(0, 10);
    let mx = 0; rows.forEach(r => cols.forEach(e => { const c = x.cell[e + "|" + r.k]; if (c) mx = Math.max(mx, Math.abs(c[m])); }));
    const mt = Math.max(...rows.map(r => Math.abs(r[m])), 0) || 1; mx = mx || 1;
    const shade = v => { if (!v) return ""; const a = Math.round(Math.min(1, Math.sqrt(Math.abs(v) / mx)) * 70); return `background:color-mix(in srgb, var(${v > 0 ? "--up" : "--down"}) ${a}%, transparent)`; };
    const tag = (t, title, st) => `<span class="pill" title="${title}" style="font-size:10px;padding:0 5px${st || ""}">${t}</span>`;
    const tags = r => [x.king && r.k === x.king.k ? tag("King", "Largest net GEX", ";border-color:var(--amber);color:var(--amber)") : "", x.callWall && r.k === x.callWall.k ? tag("CW", "Call wall: most call gamma") : "", x.putWall && r.k === x.putWall.k ? tag("PW", "Put wall: most put gamma") : ""].join(" ");
    let spotDone = false, flipDone = !x.flip;
    const line = (txt, col) => `<tr><td colspan="${cols.length + 2}" style="padding:2px 8px;font-size:11px;color:${col};border-top:1px dashed ${col};border-bottom:0;text-align:start">${txt}</td></tr>`;
    const body = rows.map(r => {
      let pre = "";
      if (!flipDone && r.k < x.flip) { pre += line("Zero gamma " + px(x.flip), "var(--amber)"); flipDone = true; }
      if (!spotDone && r.k < x.spot) { pre += line("Price " + px(x.spot), "var(--ink)"); spotDone = true; }
      const kingCell = x.king && r.k === x.king.k ? ";box-shadow:inset 0 0 0 2px var(--amber)" : "";
      return pre + `<tr><td style="text-align:start;white-space:nowrap"><b>${px(r.k)}</b> ${tags(r)}</td>${cols.map(e => { const c = x.cell[e + "|" + r.k]; return `<td style="${c ? shade(c[m]) : ""}${kingCell}">${c && Math.abs(c[m]) >= 0.5 ? esc(D.big(c[m])) : '<span class="muted">·</span>'}</td>`; }).join("")}
        <td style="min-width:150px;text-align:start"><div style="display:flex;align-items:center;gap:6px"><div style="flex:1;height:10px;position:relative;background:var(--rule)"><div style="position:absolute;top:0;bottom:0;${r[m] >= 0 ? "left:50%" : "right:50%"};width:${(Math.abs(r[m]) / mt * 50).toFixed(1)}%;background:var(${r[m] >= 0 ? "--up" : "--down"})"></div></div><span style="font-variant-numeric:tabular-nums;min-width:58px;text-align:end">${esc(D.big(r[m]))}</span></div></td></tr>`;
    }).join("") + (spotDone ? "" : line("Price " + px(x.spot), "var(--ink)"));
    const MN = MEAS.find(z => z[0] === m);
    out.innerHTML = `<p class="verdict-line" style="font-size:18px"><span class="pill ${pos ? "pass" : "fail"}" style="vertical-align:middle">${pos ? "Positive gamma" : "Negative gamma"}</span> ${esc(pos ? "On this model, dealer hedging leans against moves: days tend to be calmer and price can stick near big strikes." : "On this model, dealer hedging chases moves: days tend to swing wider and late-day moves tend to carry on.")}${x.flip ? esc(` The zero-gamma level is ${px(x.flip)}, ${pct(x.flip / x.spot - 1)} from the price.`) : ""}</p>
      ${since ? `<p class="muted" style="font-size:13px;margin:0 0 10px">Since ${esc(new Date(since.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))} today: net GEX ${esc(big(since.net))} → ${esc(big(x.total.gex))}; King ${esc(px(since.king))} → ${esc(x.king ? px(x.king.k) : "—")}; price ${esc(px(since.spot))} → ${esc(px(x.spot))}.</p>` : ""}
      <div class="kv four">${D.kv(kv)}</div>
      <h3 style="margin:16px 0 6px;font-size:15px">${esc(MN[2])}, by strike and expiration</h3>
      <div class="scroll"><table class="dt" style="font-size:12px"><thead><tr><th style="text-align:start">Strike</th>${cols.map(e => `<th>${esc(e.slice(5))}</th>`).join("")}<th style="text-align:start">Total (${esc(MN[1])})</th></tr></thead><tbody>${body}</tbody></table></div>
      ${exps.length > cols.length ? `<p class="muted" style="font-size:12px">The table shows the first ${cols.length} of ${exps.length} expirations; the totals and levels use all of them.</p>` : ""}
      <p class="muted" style="font-size:12px;margin-top:10px">Built from open interest (updated once a day, before the open) and each contract's implied volatility, with Black-Scholes greeks. GEX = gamma × open interest × 100 × price² × 1%, calls positive and puts negative: the common assumption that dealers are long the calls and short the puts customers trade. Nobody can see the real dealer book, so the colors can be backwards for a given stock. VEX is the hedge change per 1 point of implied volatility; DEX is the open interest's dollar delta; charm is how that delta drifts per day with no price move. King: the strike with the largest net GEX ("contested" when the next is within 10%). Walls (CW, PW): the strikes with the most call and put gamma. Zero gamma: where total GEX would change sign if the price moved there. Expected move: the nearest expiration's at-the-money straddle; one day: the price × that implied volatility ÷ √252. Evidence: dealer gamma is linked to calmer or wilder index days and to late-day momentum (Baltussen, Da, Lammers and Martens, 2021), and single stocks tend to pin to big strikes on expiration day (Ni, Pearson and Poteshman, 2005). The King and walls as everyday support, resistance or magnets are not well tested, which is why the levels are logged below and checked.</p>`;
  }
  async function renderLog(s, sc) {
    const el = host.querySelector("#gxLog"); if (!el) return;
    if (!["near", "week", "month"].includes(sc)) { el.innerHTML = '<p class="muted" style="font-size:12px">Levels are logged for the three standard views (nearest, this week, next 30 days), not single expirations.</p>'; return; }
    const log = await readLog(s, sc);
    if (!log) { el.innerHTML = '<p class="muted" style="font-size:12px">The levels log needs this page\'s database, which this view cannot reach.</p>'; return; }
    const snaps = log.map(b => b.pre).filter(Boolean);
    let res = null;
    if (snaps.length) { try { const bars = (await D.dailyBars([s], 120))[s] || []; res = X.levelTest(snaps, bars); } catch (e) { res = null; } }
    const p0 = v => v == null ? "—" : Math.round(v * 100) + "%", r2 = v => v == null ? "—" : v.toFixed(2) + "×";
    const enough = res && res.n >= 20;
    el.innerHTML = `<div class="panel" style="margin-top:6px"><div class="ph"><h2>Do the levels hold?</h2><span class="eyebrow">${esc(s)} · ${esc((SCOPES.find(z => z[0] === sc) || [, sc])[1])} · ${log.length} day${log.length === 1 ? "" : "s"} logged</span></div>
      <div class="pb">${res && res.n ? `<div class="kv four">${D.kv([["Sessions tested", String(res.n)], ["Range vs expected, positive gamma", r2(res.range.pos) + " (" + res.range.posN + ")"], ["Range vs expected, negative gamma", r2(res.range.neg) + " (" + res.range.negN + ")"], ["Closed inside the 1-day move", p0(res.insideEm)], ["Call wall: reached and closed back under", p0(res.callWall.heldShare) + " of " + res.callWall.touched], ["Put wall: reached and closed back over", p0(res.putWall.heldShare) + " of " + res.putWall.touched], ["Closed nearer the King", p0(res.king.towardShare) + " of " + res.king.n + " (chance ≈ 50%)"]])}</div>` : ""}
      <p class="muted" style="font-size:12px;margin:${res && res.n ? "10px" : "0"} 0 0">${enough ? "Read the numbers against chance: about half of closes land nearer any given strike, and a wall that is rarely reached says little." : `Not enough yet: ${res ? res.n : 0} session${res && res.n === 1 ? "" : "s"} tested; a verdict needs 20 or more.`} Each build is saved to this page's database (only you can open this page). Builds made outside market hours, before 9:30 or after 4:00 New York time, are tested against the next session: its range against the expected one-day move in positive and negative gamma, whether the walls turned price back, and whether price closed nearer the King. Open interest history can't be downloaded, so this record starts now: build SPY and QQQ after the close on most days to fill it.</p></div></div>`;
  }
  D.gammaApp = { show, build };
})();
