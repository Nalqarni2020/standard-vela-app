/* Second broker and extra research sources, read-only.
   Webull (through the Webull connector): accounts, balances, positions, filled orders, watchlists, analyst ratings and
   price targets, capital flow by order size, unusual-activity alerts.
   Robinhood extras: analyst ratings and targets, saved screeners, technical indicators.
   Everything here is optional: when a connector is not allowed for this page, the helpers return null and the desks
   carry on without it. Nothing here places, changes or cancels an order or edits a watchlist. */
(function () {
  "use strict";
  const D = window.Desk, E = D.E;
  const WB = "Webull";

  /* Payload is the connector's structured content, or the parsed first text block. A list may arrive bare or wrapped in
     an object with one array field. */
  function unwrap(p) {
    if (p && !Array.isArray(p) && typeof p === "object") { const ks = Object.keys(p); if (ks.length === 1 && Array.isArray(p[ks[0]])) return p[ks[0]]; }
    return p;
  }
  let wbState = "unknown";   // "ok" | "off" | "unknown"
  async function wbCall(tool, input, staleMs, retried) {
    if (wbState === "off") return null;
    const mcp = D.S.mcp; if (!mcp) { wbState = "off"; return null; }
    try {
      const r = await mcp.callTool(WB, tool, input || {}, { cache: { staleTime: staleMs || 0, gcTime: Math.max(300000, staleMs || 0) } });
      let p = r.payload;
      if (p === undefined) { try { const t = r.content && r.content[0] && r.content[0].text; p = t ? JSON.parse(t) : null; } catch (e) { p = null; } }
      wbState = "ok"; return unwrap(p);
    } catch (e) {
      const code = e && e.code;
      if (["not_in_manifest", "server_not_connected", "not_granted", "blocked_by_policy", "approval_required", "selection_required"].includes(code)) { wbState = code === "approval_required" || code === "selection_required" ? "unknown" : "off"; wbLastErr = code; return null; }
      if (e && e.retryable && !retried) { await new Promise(r => setTimeout(r, Math.min(e.retryAfterMs || 0, 8000) + 800)); return wbCall(tool, input, staleMs, true); }
      throw new Error("Webull: " + ((e && e.result && e.result.content && e.result.content[0] && e.result.content[0].text) || (e && e.message) || code || "error").slice(0, 200));
    }
  }
  let wbLastErr = null;
  const num = v => v == null || v === "" ? null : +v;
  const isStock = i => i && i.symbol && /^[A-Z][A-Z0-9.]{0,9}$/.test(i.symbol) && !/^(CCC|DJ|INDEX)/.test(i.exchange_code || "") && !/USD$/.test(i.symbol);

  const wb = {
    get state() { return wbState; }, get lastError() { return wbLastErr; },
    why() { return wbLastErr === "server_not_connected" ? "Webull is not connected to your Claude account." : wbLastErr === "not_in_manifest" ? "Webull access is turned off for this page." : wbLastErr ? "Webull is not available here (" + wbLastErr + ")." : "Webull is not available here."; },
    async accounts() { const a = await wbCall("get_account_list", {}, 600000); return Array.isArray(a) ? a : null; },
    async account() { const a = await wb.accounts(); return a && a.length ? a[0] : null; },
    async balance(id) {
      const b = await wbCall("get_account_balance", { account_id: id }, 30000); if (!b) return null;
      return { value: num(b.total_net_liquidation_value), cash: num(b.total_cash_balance), dayPL: num(b.total_day_profit_loss), unrealized: num(b.total_unrealized_profit_loss), buyingPower: b.account_currency_assets && b.account_currency_assets[0] ? num(b.account_currency_assets[0].day_buying_power) : null };
    },
    async positions(id) {
      const p = await wbCall("get_account_positions", { account_id: id }, 30000); if (!Array.isArray(p)) return null;
      return p.filter(x => x.instrument_type === "EQUITY" && +x.quantity > 0).map(x => ({ sym: x.symbol, qty: +x.quantity, avg: num(x.cost_price), last: num(x.last_price), value: num(x.market_value), dayPL: num(x.day_profit_loss), broker: "wb" }));
    },
    /* Filled stock orders, newest first, paged by the last order id, back to sinceMs. */
    async orders(id, sinceMs, maxPages) {
      const out = []; let last = null;
      for (let page = 0; page < (maxPages || 30); page++) {
        const d = await wbCall("get_order_history", Object.assign({ account_id: id, page_size: "100" }, last ? { last_client_order_id: last } : {}), 120000);
        if (!Array.isArray(d) || !d.length) break;
        let older = false;
        for (const combo of d) {
          for (const o of (combo.orders || [])) {
            const q = +o.filled_quantity, px = +o.filled_price, t = +o.filled_time || Date.parse(o.filled_time_at || o.place_time_at);
            if (o.instrument_type !== "EQUITY" || !(q > 0) || !(px > 0) || !isFinite(t)) continue;
            if (t < sinceMs) { older = true; continue; }
            const n = E.ny(t);
            out.push({ symbol: o.symbol, side: String(o.side).toLowerCase() === "sell" ? "sell" : "buy", qty: q, price: px, fees: 0, t, ext: n.min < 570 || n.min >= 960, broker: "wb" });
          }
        }
        last = d[d.length - 1].client_order_id;
        if (older || d.length < 10 || !last) break;
      }
      return out;
    },
    async watchlists() { const w = await wbCall("get_watchlists", {}, 600000); return Array.isArray(w) ? w.filter(x => !/^(Crypto|Events|My Bonds|CN|HK)$/i.test(x.name)) : null; },
    async listSymbols(id) { const d = await wbCall("get_watchlist_instruments", { watchlist_id: id }, 600000); const ins = d && (d.instruments || (Array.isArray(d) ? d : [])); return (ins || []).filter(isStock).map(i => i.symbol); },
    async analyst(sym) {
      const [r, t] = await Promise.all([wbCall("get_analyst_rating", { symbol: sym, category: "US_STOCK" }, 6 * 3600000).catch(() => null), wbCall("get_analyst_target_price", { symbol: sym, category: "US_STOCK" }, 6 * 3600000).catch(() => null)]);
      if (!r && !t) return null;
      const buy = r ? (num(r.strong_buy) || 0) + (num(r.buy) || 0) : null, hold = r ? num(r.hold) || 0 : null, sell = r ? (num(r.under_perform) || 0) + (num(r.sell) || 0) : null;
      return { n: r ? num(r.number) : null, buy, hold, sell, strongBuy: r ? num(r.strong_buy) : null, mean: t ? num(t.mean) : null, median: t ? num(t.median) : null, low: t ? num(t.low) : null, high: t ? num(t.high) : null, asOf: (r && r.effective_start_date || t && t.effective_start_date || "").slice(0, 10) };
    },
    /* Net flow by order size over the last `days` sessions (inflow minus outflow, in dollars). */
    async capitalFlow(sym, days) {
      const d = await wbCall("get_stock_capital_flow", { symbol: sym, category: "US_STOCK", count: days || 5 }, 3600000); if (!Array.isArray(d) || !d.length) return null;
      const net = k => d.reduce((s, x) => s + (num(x[k + "_in"]) || 0) - (num(x[k + "_out"]) || 0), 0);
      const tot = d.reduce((s, x) => s + ["large", "medium", "small"].reduce((a, k) => a + (num(x[k + "_in"]) || 0) + (num(x[k + "_out"]) || 0), 0), 0);
      return { days: d.length, from: d[0].date, to: d[d.length - 1].date, large: net("large"), medium: net("medium"), small: net("small"), total: tot,
        daily: d.map(x => ({ d: x.date, large: (num(x.large_in) || 0) - (num(x.large_out) || 0) })) };
    },
    async unusual(sym, count) { const d = await wbCall("get_stock_unusual_activities", { symbol: sym, count: count || 10 }, 900000); return Array.isArray(d) ? d.map(x => ({ t: Date.parse(x.time), type: x.alert_type, vol: num(x.volume) })).filter(x => isFinite(x.t)) : null; },
  };

  /* ---------- Robinhood extras ---------- */
  async function rhAnalyst(symbols) {
    const out = {}, uniq = [...new Set(symbols)];
    for (let i = 0; i < uniq.length; i += 75) {
      const chunk = uniq.slice(i, i + 75);
      const d = await D.call("get_equity_analyst_ratings", { symbols: chunk }, 6 * 3600000).catch(() => null);
      ((d && d.results) || []).forEach((r, k) => {
        const sym = r.symbol || chunk[k], g = r.ratings; if (!g) { out[sym] = null; return; }
        out[sym] = { buy: g.num_buy_ratings, hold: g.num_hold_ratings, sell: g.num_sell_ratings, n: (g.num_buy_ratings || 0) + (g.num_hold_ratings || 0) + (g.num_sell_ratings || 0), mean: num(g.mean_price_target), low: num(g.low_price_target), high: num(g.high_price_target), asOf: (g.updated_at || "").slice(0, 10) };
      });
    }
    return out;
  }
  async function rhScans() { const d = await D.call("get_scans", {}, 600000).catch(() => null); return ((d && d.scans) || []).map(s => ({ id: s.scan_id, title: s.title })); }
  async function rhScanSymbols(id) {
    const d = await D.call("run_scan", { scan_id: id }, 120000);
    const res = d && d.result ? d.result : d;
    return ((res && res.results) || []).filter(r => r.instrument_type === "EQUITY" && /^[A-Z][A-Z0-9.]{0,9}$/.test(r.ticker || "")).map(r => r.ticker);
  }
  /* Robinhood's own indicator value on the bar dated `lastDate` (the series ends before tomorrow 00:00 UTC). */
  async function rhIndicator(sym, type, period, lastDate) {
    const end = new Date(Date.parse(lastDate + "T00:00:00Z") + 86400000).toISOString().replace(/\.\d+Z$/, "Z");
    const start = new Date(Date.parse(lastDate + "T00:00:00Z") - 400 * 86400000).toISOString().replace(/\.\d+Z$/, "Z");
    const d = await D.call("get_equity_technical_indicators", { symbols: [sym], type, interval: "day", period, start_time: start, end_time: end, output: "last:3" }, 3600000);
    const r = ((d && d.results) || [])[0], s = r && r.indicators && r.indicators[0] && r.indicators[0].series;
    const pt = (s || []).filter(x => x.begins_at && x.begins_at.slice(0, 10) === lastDate).pop();
    return pt ? +pt.value : null;
  }

  /* Lists for any desk: Robinhood lists (filled by D.fillLists), then Webull watchlists, then Robinhood screeners.
     Values: plain id = Robinhood list, "wb:<id>" = Webull watchlist, "scan:<id>" = Robinhood screener (run live). */
  async function addListSources(sel) {
    const [w, sc] = await Promise.all([wb.watchlists().catch(() => null), rhScans().catch(() => [])]);
    const esc = D.esc;
    if (w && w.length) sel.insertAdjacentHTML("beforeend", '<optgroup label="Webull watchlists">' + w.map(x => `<option value="wb:${esc(x.watchlist_id)}">${esc(x.name)} (Webull)</option>`).join("") + "</optgroup>");
    if (sc && sc.length) sel.insertAdjacentHTML("beforeend", '<optgroup label="Your Robinhood screeners (run live)">' + sc.map(x => `<option value="scan:${esc(x.id)}">${esc(x.title)} (screener)</option>`).join("") + "</optgroup>");
  }
  async function listSymbols(id) {
    if (id.startsWith("wb:")) return wb.listSymbols(id.slice(3));
    if (id.startsWith("scan:")) return rhScanSymbols(id.slice(5));
    const items = await D.call("get_watchlist_items", { list_id: id }, 600000);
    return ((items && items.items) || []).filter(i => i.object_type === "instrument" && i.symbol).map(i => i.symbol);
  }

  Object.assign(D, { wb, rhAnalyst, rhScans, rhScanSymbols, rhIndicator, addListSources, listSymbols });
})();
