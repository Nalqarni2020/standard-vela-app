/**
 * SEC EDGAR, read directly from the SEC's free public API.
 * The SEC requires every client to identify itself in the User-Agent header
 * (a name and a contact address): set it with `npx wrangler secret put SEC_USER_AGENT`.
 */

const TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
const SUBMISSIONS = cik => "https://data.sec.gov/submissions/CIK" + cik + ".json";
const FACTS = cik => "https://data.sec.gov/api/xbrl/companyfacts/CIK" + cik + ".json";

let tickerMap = null, tickerAt = 0;

export async function cikFor(symbol, ua, fetchImpl) {
  if (!tickerMap || Date.now() - tickerAt > 86400000) {
    const r = await fetchImpl(TICKERS_URL, { headers: { "User-Agent": ua, Accept: "application/json" } });
    if (!r.ok) throw new SecError(r.status);
    const d = await r.json();
    tickerMap = new Map();
    for (const k of Object.keys(d)) { const x = d[k]; tickerMap.set(String(x.ticker).toUpperCase(), String(x.cik_str).padStart(10, "0")); }
    tickerAt = Date.now();
  }
  // SEC writes share classes with a hyphen (BRK-B); brokers use a dot (BRK.B).
  return tickerMap.get(symbol) || tickerMap.get(symbol.replace(".", "-")) || null;
}

export class SecError extends Error { constructor(status) { super("SEC answered " + status); this.status = status; } }

/* Filings from the last `days` days: form, date, 8-K item numbers, and a link to the document. */
export async function filings(symbol, ua, fetchImpl, days = 730, now = Date.now()) {
  const cik = await cikFor(symbol, ua, fetchImpl);
  if (!cik) return null;
  const r = await fetchImpl(SUBMISSIONS(cik), { headers: { "User-Agent": ua, Accept: "application/json" } });
  if (!r.ok) throw new SecError(r.status);
  const d = await r.json(), rc = (d.filings && d.filings.recent) || {};
  const since = new Date(now - days * 86400000).toISOString().slice(0, 10), out = [];
  const n = (rc.form || []).length;
  for (let i = 0; i < n; i++) {
    if (rc.filingDate[i] < since) continue;
    const acc = rc.accessionNumber[i];
    out.push({ form: rc.form[i], date: rc.filingDate[i], items: rc.items && rc.items[i] ? String(rc.items[i]).split(",").map(s => s.trim()).filter(Boolean) : [],
      url: "https://www.sec.gov/Archives/edgar/data/" + Number(cik) + "/" + acc.replace(/-/g, "") + "/" + (rc.primaryDocument[i] || "") });
  }
  return { cik, name: d.name, filings: out };
}

const CONCEPTS = [
  ["us-gaap", "Revenues", "Revenue"],
  ["us-gaap", "RevenueFromContractWithCustomerExcludingAssessedTax", "Revenue"],
  ["us-gaap", "NetIncomeLoss", "Net income"],
  ["us-gaap", "OperatingIncomeLoss", "Operating income"],
  ["us-gaap", "CashAndCashEquivalentsAtCarryingValue", "Cash"],
  ["us-gaap", "WeightedAverageNumberOfDilutedSharesOutstanding", "Diluted shares"],
  ["dei", "EntityCommonStockSharesOutstanding", "Shares outstanding"],
];

/* Latest quarter (80 to 100 day periods) against the same quarter a year earlier; balance-sheet points against
   the point closest to a year earlier. Duplicate periods keep the most recently filed value. */
export function summarizeFact(entries) {
  if (!entries || !entries.length) return null;
  const byPeriod = new Map();
  for (const e of entries) { const k = (e.start || "") + "|" + e.end; const p = byPeriod.get(k); if (!p || e.filed > p.filed) byPeriod.set(k, e); }
  const all = [...byPeriod.values()];
  const dur = e => e.start ? (Date.parse(e.end) - Date.parse(e.start)) / 86400000 : 0;
  const q = all.filter(e => e.start && dur(e) >= 80 && dur(e) <= 100), inst = all.filter(e => !e.start);
  const pool = (q.length ? q : inst).sort((a, b) => b.end.localeCompare(a.end));
  if (!pool.length) return null;
  const latest = pool[0], target = Date.parse(latest.end) - 365 * 86400000;
  let prior = null, best = Infinity;
  for (const e of pool.slice(1)) { const d = Math.abs(Date.parse(e.end) - target); if (d < best && d <= 45 * 86400000) { best = d; prior = e; } }
  return { latest: latest.val, latestEnd: latest.end, latestForm: latest.form, prior: prior ? prior.val : null, priorEnd: prior ? prior.end : null, quarterly: q.length > 0 };
}

export async function facts(symbol, ua, fetchImpl) {
  const cik = await cikFor(symbol, ua, fetchImpl);
  if (!cik) return null;
  const r = await fetchImpl(FACTS(cik), { headers: { "User-Agent": ua, Accept: "application/json" } });
  if (r.status === 404) return { cik, items: [] };
  if (!r.ok) throw new SecError(r.status);
  const d = await r.json(), out = [], seen = new Set();
  for (const [ns, concept, label] of CONCEPTS) {
    if (seen.has(label)) continue;
    const node = d.facts && d.facts[ns] && d.facts[ns][concept];
    if (!node || !node.units) continue;
    const unit = Object.keys(node.units)[0];
    const s = summarizeFact(node.units[unit]);
    if (s) { out.push({ label, concept, unit, ...s }); seen.add(label); }
  }
  return { cik, name: d.entityName, items: out };
}
