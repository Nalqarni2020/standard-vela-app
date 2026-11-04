/* Phone-only helpers: CSV import of a Robinhood activity report, and earnings windows from SEC filing dates. */
(function (root) {
  "use strict";

  /* RFC 4180 CSV: quoted fields may hold commas, doubled quotes and line breaks. */
  function parseCsv(text) {
    const rows = []; let row = [], f = "", q = false, i = 0;
    text = String(text || "").replace(/^﻿/, "");
    while (i < text.length) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i += 2; continue; } q = false; i++; continue; } f += c; i++; continue; }
      if (c === '"') { q = true; i++; continue; }
      if (c === ",") { row.push(f); f = ""; i++; continue; }
      if (c === "\r") { i++; continue; }
      if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; i++; continue; }
      f += c; i++;
    }
    if (f !== "" || row.length) { row.push(f); rows.push(row); }
    return rows.filter(r => r.some(x => x.trim() !== ""));
  }

  const num = s => { if (s == null) return NaN; let t = String(s).trim(); const neg = /^\(.*\)$/.test(t) || t.startsWith("-"); t = t.replace(/[()$,\s-]/g, "").replace(/[A-Za-z]+$/, ""); const v = parseFloat(t); return isFinite(v) ? (neg ? -v : v) : NaN; };
  /* M/D/YYYY or YYYY-MM-DD -> YYYY-MM-DD */
  function isoDate(s) {
    s = String(s || "").trim();
    let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (m) return m[3] + "-" + m[1].padStart(2, "0") + "-" + m[2].padStart(2, "0");
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[1] + "-" + m[2] + "-" + m[3];
    return null;
  }

  /* Robinhood account activity CSV -> filled stock orders. Header names are matched loosely; rows other than
     Buy and Sell (dividends, transfers, fees, options) are counted and skipped. The file lists newest first and
     gives no times, so trades on one day keep the file's order, reversed. */
  function robinhoodActivity(text) {
    const rows = parseCsv(text);
    const hi = rows.findIndex(r => r.some(x => /trans\s*code/i.test(x)) && r.some(x => /instrument|symbol/i.test(x)));
    if (hi < 0) return { ok: false, reason: "This file has no Trans Code and Instrument columns. Export Account activity from Robinhood as CSV." };
    const h = rows[hi].map(x => x.trim().toLowerCase());
    const col = (...names) => h.findIndex(x => names.some(n => x === n || x.replace(/\s+/g, " ") === n));
    const cDate = col("activity date", "date"), cSym = col("instrument", "symbol"), cCode = col("trans code", "transaction code"), cQty = col("quantity", "qty"), cPx = col("price");
    if ([cDate, cSym, cCode, cQty, cPx].some(i => i < 0)) return { ok: false, reason: "Missing one of: Activity Date, Instrument, Trans Code, Quantity, Price." };
    const orders = [], skipped = {};
    const body = rows.slice(hi + 1);
    body.forEach((r, k) => {
      const code = String(r[cCode] || "").trim().toLowerCase();
      if (code !== "buy" && code !== "sell") { if (code) skipped[code] = (skipped[code] || 0) + 1; return; }
      const d = isoDate(r[cDate]), sym = String(r[cSym] || "").trim().toUpperCase(), qty = Math.abs(num(r[cQty])), px = Math.abs(num(r[cPx]));
      if (!d || !/^[A-Z][A-Z0-9.]{0,9}$/.test(sym) || !(qty > 0) || !(px > 0)) { skipped.unreadable = (skipped.unreadable || 0) + 1; return; }
      orders.push({ symbol: sym, side: code, qty, price: px, day: d, seq: body.length - k });
    });
    orders.sort((a, b) => a.day < b.day ? -1 : a.day > b.day ? 1 : a.seq - b.seq);
    // A synthetic time keeps same-day order: noon New York plus one second per row.
    orders.forEach((o, i) => { o.t = Date.parse(o.day + "T16:00:00Z") + i * 1000; o.ext = false; });
    return { ok: true, orders, skipped, from: orders.length ? orders[0].day : null, to: orders.length ? orders[orders.length - 1].day : null };
  }

  /* Earnings window from a filing date when the time of day is unknown: close of the last session before the date
     to the close of the first session after it, so a before-open or an after-close release is both inside it. */
  function filingWindow(bars, spy, date, h) {
    h = h || 20;
    let i0 = -1; for (let i = 0; i < bars.length; i++) { if (bars[i].d < date) i0 = i; else break; }
    const i1 = bars.findIndex(b => b.d > date);
    if (i0 < 0 || i1 < 0) return null;
    const reaction = bars[i1].c / bars[i0].c - 1;
    let drift = null, driftEx = null;
    if (i1 + h < bars.length) {
      drift = bars[i1 + h].c / bars[i1].c - 1;
      const s0 = spy.findIndex(b => b.d === bars[i1].d), s1 = spy.findIndex(b => b.d === bars[i1 + h].d);
      if (s0 >= 0 && s1 >= 0) driftEx = drift - (spy[s1].c / spy[s0].c - 1);
    }
    return { date, from: bars[i0].d, to: bars[i1].d, reaction, drift, driftEx };
  }

  const P = { parseCsv, robinhoodActivity, filingWindow, isoDate, num };
  if (typeof module !== "undefined" && module.exports) module.exports = P; else root.Phone = P;
})(typeof self !== "undefined" ? self : this);
