/* Filings: SEC filings for one stock or a whole watchlist, the latest reported figures, and what each filing type did next. */
(function () {
  "use strict";
  const D = window.Desk, A = window.Analytics;
  const { esc, pct, big, call } = D;
  const KIND = f => { const t = String(f || "").toUpperCase();
    if (/^(S-1|S-3|F-1|F-3)|^424B/.test(t)) return "offering";
    if (/13D/.test(t)) return "activist"; if (/13G/.test(t)) return "passive";
    if (t === "4" || t === "4/A") return "insider"; if (/^8-K/.test(t)) return "event";
    if (/^10-Q/.test(t)) return "quarterly"; if (/^10-K/.test(t)) return "annual"; return "other"; };
  const LABEL = { offering: "Share offering or shelf (S-1, S-3, 424B)", activist: "Activist stake (13D)", passive: "Passive 5% stake (13G)", insider: "Insider transaction (Form 4)", event: "Material event (8-K)", quarterly: "Quarterly report (10-Q)", annual: "Annual report (10-K)", other: "Other" };
  const FACTS = [["Revenues", "Revenue"], ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenue (contracts)"], ["NetIncomeLoss", "Net income"], ["OperatingIncomeLoss", "Operating income"], ["CashAndCashEquivalentsAtCarryingValue", "Cash"], ["WeightedAverageNumberOfDilutedSharesOutstanding", "Diluted shares"]];
  let root, mode = D.load("flMode", "stock");

  async function index(sym, since) {
    let out = [], cursor = null, pages = 0;
    do { const d = await call("get_sec_filing_index", Object.assign({ symbol: sym, since }, cursor ? { cursor } : {}), 3600000); out = out.concat((d && d.filings) || []); cursor = d && d.next ? d.next : null; pages++; } while (cursor && pages < 8);
    return out.map(f => ({ ...f, kind: KIND(f.form_type) }));
  }
  async function facts(filing) {
    const d = await call("get_sec_filing_facts", { filing_ids: [filing.filing_id], concepts: FACTS.map(f => f[0]) }, 86400000);
    const fs = (d && d.facts) || [];
    const out = FACTS.map(([c, l]) => ({ c, l, v: A.pickFact(fs, c) })).filter(x => x.v);
    // keep one revenue line
    if (out.some(x => x.c === "Revenues")) return out.filter(x => x.c !== "RevenueFromContractWithCustomerExcludingAssessedTax");
    return out;
  }
  D.filingsSummary = async function (sym) {
    const fl = await index(sym, new Date(Date.now() - 400 * D.DAY).toISOString().slice(0, 10));
    const recent = fl.filter(f => f.date_filed >= new Date(Date.now() - 90 * D.DAY).toISOString().slice(0, 10));
    const counts = {}; recent.forEach(f => { counts[LABEL[f.kind]] = (counts[LABEL[f.kind]] || 0) + 1; });
    const rep = fl.find(f => f.kind === "quarterly" || f.kind === "annual");
    let figures = null;
    if (rep) { try { figures = (await facts(rep)).map(x => ({ item: x.l, latest: x.v.latest, periodEnd: x.v.latestEnd, yearEarlier: x.v.prior, change: x.v.prior ? x.v.latest / x.v.prior - 1 : null })); } catch (e) { figures = null; } }
    return { source: "SEC filings via Robinhood" + (rep ? "; figures from the " + rep.form_type + " filed " + rep.date_filed : ""), symbol: sym, last90DaysByType: counts, latest: fl.slice(0, 10).map(f => ({ form: f.form_type, filed: f.date_filed, what: f.description })), reportedFigures: figures };
  };
  (D.extraAnalystTools = D.extraAnalystTools || []).push({ name: "sec_filings", label: "SEC filings", description: "SEC filings for one stock: counts by type over the last 90 days (offerings, activist stakes, insider Form 4s, 8-K events), the latest 10 filings, and key figures from the latest 10-Q or 10-K versus a year earlier (revenue, net income, cash, diluted shares).", inputSchema: { type: "object", properties: { symbol: { type: "string" } }, required: ["symbol"] }, fn: sym => D.filingsSummary(sym) });

  function shell() {
    root.innerHTML = `
      <div class="app-h"><h1>Filings</h1><p>What companies told the SEC: share offerings that dilute you, activist stakes, insider filings and material events, plus the latest reported figures.</p></div>
      <form class="tools" id="flForm" style="margin-bottom:12px;flex-wrap:wrap" autocomplete="off">
        <select id="flMode" class="btn small" aria-label="Mode"><option value="stock">One stock</option><option value="list">Radar across a watchlist</option></select>
        <input id="flSym" class="btn small" style="width:8em;cursor:text;text-transform:uppercase" aria-label="Ticker">
        <select id="flList" class="btn small" aria-label="Watchlist" hidden></select>
        <button class="btn small primary" type="submit">Read filings</button>
      </form>
      <div id="flOut"></div>
      <p class="muted" style="font-size:12px">Source: SEC EDGAR filings via Robinhood. Form 4 covers insider buys and sells alike; the filing list does not say which. Research on insider buying: Lakonishok and Lee (2001); Cohen, Malloy and Pomorski (2012). On activist 13D stakes: Brav, Jiang, Partnoy and Thomas (2008).</p>`;
    const m = root.querySelector("#flMode"); m.value = mode;
    root.querySelector("#flSym").value = D.S.sym && D.S.sym !== "EXAMPLE" ? D.S.sym : "CIFR";
    const sync = () => { root.querySelector("#flSym").hidden = mode !== "stock"; root.querySelector("#flList").hidden = mode !== "list"; if (mode === "list") D.loadLists().then(() => { const l = root.querySelector("#flList"); if (!l.options.length) D.fillLists(l); }).catch(() => {}); };
    sync();
    m.onchange = () => { mode = m.value; D.save("flMode", mode); sync(); };
    root.querySelector("#flForm").onsubmit = e => { e.preventDefault(); mode === "stock" ? stock() : radar(); };
    root.addEventListener("click", e => { const b = e.target.closest("[data-sym]"); if (b) D.openSymbol(b.dataset.sym); });
  }

  async function stock() {
    const out = root.querySelector("#flOut");
    const sym = root.querySelector("#flSym").value.trim().toUpperCase().replace(/^\$/, "");
    if (!/^[A-Z][A-Z0-9.]{0,9}$/.test(sym)) { out.innerHTML = '<p class="muted">Type a US ticker.</p>'; return; }
    out.innerHTML = '<p class="muted">Reading filings…</p>';
    try {
      const since = new Date(Date.now() - 730 * D.DAY).toISOString().slice(0, 10);
      const fl = await index(sym, since);
      if (!fl.length) { out.innerHTML = '<p class="muted">No SEC filings came back for ' + esc(sym) + ". Funds and foreign listings often file differently.</p>"; return; }
      const cut90 = new Date(Date.now() - 90 * D.DAY).toISOString().slice(0, 10);
      const recent = fl.filter(f => f.date_filed >= cut90);
      const n = k => recent.filter(f => f.kind === k).length;
      const rep = fl.find(f => f.kind === "quarterly" || f.kind === "annual");
      const [fx, bars] = await Promise.all([rep ? facts(rep).catch(() => []) : Promise.resolve([]), D.dailyBars([sym, "SPY"], 760)]);
      const b = bars[sym] || [], spy = bars.SPY || [];
      const groups = {};
      fl.forEach(f => { const e5 = A.eventReturn(b, spy, f.date_filed, 5), e20 = A.eventReturn(b, spy, f.date_filed, 20); (groups[f.kind] = groups[f.kind] || { e5: [], e20: [] }); if (e5) groups[f.kind].e5.push(e5.excess); if (e20) groups[f.kind].e20.push(e20.excess); });
      const sh = fx.find(x => x.c === "WeightedAverageNumberOfDilutedSharesOutstanding");
      const dil = sh && sh.v.prior ? sh.v.latest / sh.v.prior - 1 : null;
      let line = `${sym}: ${recent.length} filings in the last 90 days.`;
      if (n("offering")) line += ` ${n("offering")} offering or shelf filing${n("offering") > 1 ? "s" : ""}, which can mean new shares.`;
      if (n("activist")) line += ` An activist 13D stake was filed.`;
      if (n("insider")) line += ` ${n("insider")} insider Form 4 filing${n("insider") > 1 ? "s" : ""}.`;
      if (dil != null) line += ` Diluted share count ${dil >= 0 ? "up" : "down"} ${pct(Math.abs(dil)).replace("+", "")} from a year earlier.`;
      out.innerHTML = `
        <p class="verdict-line">${esc(line)}</p>
        <div class="grid2">
          <div class="panel"><div class="ph"><h2>Reported figures</h2><span class="eyebrow">${rep ? esc(rep.form_type + " filed " + rep.date_filed) : "No 10-Q or 10-K found"}</span></div>
            ${fx.length ? `<div class="scroll"><table class="dt"><thead><tr><th>Item</th><th>Latest</th><th>Period end</th><th>Year earlier</th><th>Change</th></tr></thead><tbody>${fx.map(x => `<tr><td>${esc(x.l)}</td><td>${x.c.includes("Shares") ? big(x.v.latest) : "$" + big(x.v.latest)}</td><td>${esc(x.v.latestEnd)}</td><td>${x.v.prior == null ? "—" : (x.c.includes("Shares") ? big(x.v.prior) : "$" + big(x.v.prior))}</td><td class="chg ${x.v.prior && x.v.latest / x.v.prior >= 1 ? "up" : "down"}">${x.v.prior ? pct(x.v.latest / x.v.prior - 1) : "—"}</td></tr>`).join("")}</tbody></table></div>
            <div class="pb muted" style="font-size:12px">Company-wide figures for the latest quarter against the same quarter a year earlier; balance-sheet items against the comparison date in the filing. Rising diluted shares means each share owns less of the company.</div>` : '<div class="pb muted">No standard figures were tagged in the latest report.</div>'}</div>
          <div class="panel"><div class="ph"><h2>What each filing type did next</h2><span class="eyebrow">${esc(sym)} vs SPY, 2 years</span></div>
            <div class="scroll"><table class="dt"><thead><tr><th>Filing type</th><th>Count</th><th>Next 5 sessions</th><th>Next 20 sessions</th></tr></thead><tbody>
            ${Object.entries(groups).sort((a, b) => b[1].e5.length - a[1].e5.length).map(([k, g]) => { const s5 = A.summarize(g.e5), s20 = A.summarize(g.e20); return `<tr><td>${esc(LABEL[k])}</td><td>${g.e5.length}</td><td class="chg ${s5.mean >= 0 ? "up" : "down"}">${s5.n ? pct(s5.mean) : "—"}</td><td class="chg ${s20.mean >= 0 ? "up" : "down"}">${s20.n ? pct(s20.mean) : "—"}</td></tr>`; }).join("")}
            </tbody></table></div>
            <div class="pb muted" style="font-size:12px">Average return beyond SPY from the first open after the filing date. One stock gives small samples; treat as a description of this company, not a rule.</div></div>
        </div>
        <div class="panel" style="margin-top:18px"><div class="ph"><h2>Filings</h2><span class="eyebrow">Newest first, 2 years</span></div>
          <div class="scroll"><table class="dt"><thead><tr><th>Filed</th><th>Form</th><th>Type</th><th>Description</th></tr></thead><tbody>
          ${fl.slice(0, 120).map(f => `<tr><td>${esc(f.date_filed)}</td><td><b>${esc(f.form_type)}</b></td><td>${f.kind === "offering" ? '<span class="pill fail">Dilution risk</span>' : f.kind === "activist" ? '<span class="pill pass">Activist</span>' : esc(LABEL[f.kind])}</td><td style="white-space:normal">${esc(f.description || "")}</td></tr>`).join("")}
          </tbody></table></div></div>`;
    } catch (e) { out.innerHTML = '<div class="banner bad">' + esc(e.message) + "</div>"; }
  }

  async function radar() {
    const out = root.querySelector("#flOut"), id = root.querySelector("#flList").value;
    if (!id) { out.innerHTML = '<p class="muted">Choose a watchlist.</p>'; return; }
    try {
      const it = await call("get_watchlist_items", { list_id: id }, 600000);
      const syms = ((it && it.items) || []).filter(i => i.object_type === "instrument" && i.symbol).map(i => i.symbol).slice(0, 40);
      const since = new Date(Date.now() - 30 * D.DAY).toISOString().slice(0, 10), rows = [];
      for (let i = 0; i < syms.length; i++) {
        out.innerHTML = `<p class="muted">Reading filings ${i + 1} of ${syms.length}…</p>`;
        try { const fl = await index(syms[i], since); rows.push({ sym: syms[i], fl }); } catch (e) { if (e.code !== "tool_error") throw e; rows.push({ sym: syms[i], fl: [], err: true }); }
      }
      const c = (r, k) => r.fl.filter(f => f.kind === k).length;
      rows.sort((a, b) => (c(b, "offering") * 100 + c(b, "activist") * 50 + b.fl.length) - (c(a, "offering") * 100 + c(a, "activist") * 50 + a.fl.length));
      const off = rows.filter(r => c(r, "offering")), act = rows.filter(r => c(r, "activist"));
      out.innerHTML = `
        <p class="verdict-line">${esc(`Last 30 days across ${rows.length} names: ${off.length ? off.map(r => r.sym).join(", ") + " filed for possible new shares" : "no offering filings"}; ${act.length ? act.map(r => r.sym).join(", ") + " had an activist 13D" : "no activist stakes"}.`)}</p>
        <div class="panel"><div class="scroll"><table class="dt"><thead><tr><th>Symbol</th><th>Filings</th><th>Offerings</th><th>Activist</th><th>Insider Form 4</th><th>8-K events</th><th>Latest</th></tr></thead><tbody>
        ${rows.map(r => `<tr class="clickable" tabindex="0" data-sym="${esc(r.sym)}"><td><b>${esc(r.sym)}</b></td><td>${r.err ? "—" : r.fl.length}</td><td>${c(r, "offering") ? '<span class="pill fail">' + c(r, "offering") + "</span>" : "0"}</td><td>${c(r, "activist") ? '<span class="pill pass">' + c(r, "activist") + "</span>" : "0"}</td><td>${c(r, "insider")}</td><td>${c(r, "event")}</td><td>${r.fl[0] ? esc(r.fl[0].form_type + " · " + r.fl[0].date_filed) : "—"}</td></tr>`).join("")}
        </tbody></table></div><div class="pb muted" style="font-size:12px">Sorted with offerings and activist stakes first. Tap a row to open it on Standard; switch to One stock for the detail.</div></div>`;
    } catch (e) { out.innerHTML = '<div class="banner bad">' + esc(e.message) + "</div>"; }
  }

  D.register("filings", { mount(r) { root = r; if (D.needsLive(root)) return; shell(); if (mode === "stock") stock(); } });
})();
