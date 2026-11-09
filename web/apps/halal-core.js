/* Shariah screen for US stocks, following AAOIFI Shariah Standard No. 21 (financial papers), the most widely used.
   1 Business: the core activity must be permissible (no conventional banking, insurance or lending, alcohol, pork,
     gambling, tobacco, adult entertainment, cannabis; some activities scholars differ on are "doubtful").
   2 Finances (against market value): interest-bearing debt under 30%; cash plus interest-bearing investments under 30%;
     income from non-permissible sources under 5% of revenue.
   3 Purification: the non-permissible share of income, to give away from dividends and gains.
   A screen from public data, not a fatwa. Pure functions, shared with tests. */
(function (root) {
  "use strict";
  const FAIL = [
    [/\b(banks?|banking|savings (and|&) loans?|thrifts?|mortgage|consumer (finance|lending)|credit (cards?|services)|lending|lender|pawn|payday)\b/i, "Conventional banking or lending"],
    [/\b(insurance|insurer|reinsurance|underwrit)/i, "Conventional insurance"],
    [/\b(brewers?|breweries|brewing|distillers?|distiller(y|ies)|wineries|winery|wine|beer|spirits|alcoholic)\b/i, "Alcohol"],
    [/\b(casinos?|gambling|betting|wagering|lotter(y|ies)|sportsbook)\b/i, "Gambling"],
    [/\b(tobacco|cigarettes?|cigars?|vap(e|ing))\b/i, "Tobacco"],
    [/\b(pork|swine|hog)\b/i, "Pork"],
    [/\b(adult entertainment|pornograph)/i, "Adult entertainment"],
    [/\b(cannabis|marijuana)\b/i, "Cannabis"],
    [/\bmortgage reit|mortgage real estate investment\b/i, "Interest-based real estate finance"],
  ];
  const DOUBT = [
    [/\b(bitcoin|crypto|cryptocurrency|blockchain|digital asset)/i, "Crypto: scholars differ on bitcoin mining and crypto"],
    [/\b(defen[cs]e|weapons?|firearms?|ammunition|munitions)\b/i, "Weapons and defense: some standards exclude them"],
    [/\b(music|movies?|film|broadcast(ing)?|streaming entertainment|record(ed)? music)\b/i, "Entertainment and media: scholars differ"],
    [/\b(asset management|investment bank|brokerage|capital markets|stock exchange)\b/i, "Financial services: depends on how the firm earns"],
    [/\b(hotels?|resorts?|cruise)\b/i, "Hospitality: often sells alcohol; check the share of revenue"],
  ];
  const FUND = /\b(ETF|exchange[- ]traded (fund|product|note)s?|leveraged (ETF|fund)|inverse (ETF|fund)|daily (2X|3X)|2X long|2X short)\b/i;
  const CRYPTO = /\b(bitcoin mining|mines? bitcoin|cryptocurrency mining|digital asset mining|crypto(currency)? (exchange|trading platform))\b/i;
  const num = v => v == null || v === "" || !isFinite(+v) ? null : +v;

  /* o: {industry (industry and sector names), description, name}. The prohibited lists check the industry only, so a
     word in a long description ("gaming" chips, a music service) doesn't condemn a company; the description is used for
     funds and crypto mining. */
  function business(o) {
    if (typeof o === "string") o = { industry: o };
    const ind = String(o.industry || ""), desc = String(o.description || ""), name = String(o.name || "");
    if (FUND.test(name + " " + desc) || o.isFund) return { key: "fund", reason: "A fund, not a company: screen its holdings. Leveraged and inverse funds use swaps and borrowing and are generally not compliant." };
    for (const [re, why] of FAIL) if (re.test(ind)) return { key: "fail", reason: why };
    if (CRYPTO.test(desc)) return { key: "doubt", reason: "Crypto: scholars differ on bitcoin mining and crypto" };
    for (const [re, why] of DOUBT) if (re.test(ind)) return { key: "doubt", reason: why };
    return { key: "ok", reason: "No prohibited core activity in the company's industry classification." };
  }

  /* bs: Webull balance sheet row; is: Webull annual income statement row; price: share price. */
  function ratios(bs, is, price) {
    if (!bs || !(price > 0)) return null;
    const shares = num(bs.common_shares_out), mcap = shares > 0 ? shares * price : null;
    const debt = num(bs.total_debt) ?? ((num(bs.notes_st_debt) || 0) + (num(bs.cur_lt_debt_lease) || 0) + (num(bs.total_lt_debt) || 0));
    const cash = (num(bs.cash) || 0) + (num(bs.cash_equiv) || 0) + (num(bs.st_invest) || 0);
    const invest = cash + (num(bs.lt_invest) || 0);
    const rev = is ? num(is.total_revenue) ?? num(is.revenue) : null;
    // Webull gives net non-operating interest only; take a positive figure as interest earned, capped at 6% of
    // cash and investments (a plausible yield), so one-off gains booked on that line don't masquerade as interest.
    const netInt = is ? num(is.inter_inc_expse_net_non_oper) : null;
    const intInc = netInt != null && netInt > 0 ? Math.min(netInt, 0.06 * invest) : netInt != null ? 0 : null;
    const r = {
      mcap, debt, cash: invest,
      debtRatio: mcap ? debt / mcap : null,
      cashRatio: mcap ? invest / mcap : null,
      impure: rev > 0 && intInc != null ? intInc / rev : null,
      asOf: bs.end_date || null, revAsOf: is ? is.end_date || null : null,
    };
    return r;
  }

  function screen(o) {
    const b = business(o.biz || o.text), r = ratios(o.bs, o.is, o.price), why = [];
    if (b.key === "fund") return { key: "fund", label: "Fund: check holdings", business: b, ratios: null, why: [b.reason] };
    if (b.key === "fail") why.push(b.reason);
    if (r) {
      if (r.debtRatio != null && r.debtRatio >= 0.3) why.push(`Interest-bearing debt is ${(r.debtRatio * 100).toFixed(0)}% of market value (limit 30%)`);
      if (r.cashRatio != null && r.cashRatio >= 0.3) why.push(`Cash and interest-bearing investments are ${(r.cashRatio * 100).toFixed(0)}% of market value (limit 30%)`);
      if (r.impure != null && r.impure >= 0.05) why.push(`Estimated interest income is ${(r.impure * 100).toFixed(1)}% of revenue (limit 5%)`);
    }
    const missing = !r || r.debtRatio == null || r.cashRatio == null;
    let key = why.length ? "fail" : b.key === "doubt" ? "doubt" : missing ? "unknown" : "pass";
    if (key === "doubt") why.push(b.reason);
    if (key === "unknown") why.push("Not enough financial data to run the ratio tests.");
    const label = { pass: "Compliant", fail: "Not compliant", doubt: "Doubtful", unknown: "Not enough data" }[key];
    return { key, label, business: b, ratios: r, why, purify: r && r.impure != null ? Math.max(0, r.impure) : null };
  }
  const H = { business, ratios, screen };
  if (typeof module !== "undefined" && module.exports) module.exports = H; else root.Halal = H;
})(typeof self !== "undefined" ? self : globalThis);
