const P = require('../app/src/engine/phone.js');
const A = require('../app/src/engine/analytics.js');
const assert = require('assert');

// CSV: quotes, doubled quotes, commas and line breaks inside fields, BOM, CRLF
const rows = P.parseCsv('﻿a,b,c\r\n"x, y","he said ""hi""","line1\nline2"\r\n\r\n1,2,3');
assert.deepEqual(rows, [['a', 'b', 'c'], ['x, y', 'he said "hi"', 'line1\nline2'], ['1', '2', '3']]);

// Robinhood activity report (newest first), with a multi-line description, a dividend and a malformed row
const csv = [
  '"Activity Date","Process Date","Settle Date","Instrument","Description","Trans Code","Quantity","Price","Amount"',
  '"10/23/2026","10/23/2026","10/24/2026","IRE","Some Fund\nCUSIP: 123","Sell","95","$3.07","$291.65"',
  '"10/23/2026","10/23/2026","10/24/2026","IRE","Some Fund","Buy","95","$3.20","($304.00)"',
  '"10/20/2026","10/20/2026","10/21/2026","CIFR","Cipher","CDIV","","","$1.00"',
  '"10/14/2026","10/14/2026","10/15/2026","CIFR","Cipher","Sell","10","$10.50","$105.00"',
  '"10/01/2026","10/01/2026","10/02/2026","CIFR","Cipher","Buy","10","$9.00","($90.00)"',
  '"10/01/2026","10/01/2026","10/02/2026","","","Buy","x","",""',
  '',
  '"The data provided is for informational purposes only."',
].join('\n');
const r = P.robinhoodActivity(csv);
assert.equal(r.ok, true);
assert.equal(r.orders.length, 4);
assert.deepEqual(r.skipped, { cdiv: 1, unreadable: 1 });
assert.equal(r.from, '2026-10-01'); assert.equal(r.to, '2026-10-23');
// Same-day buy then sell keeps order (file is newest first)
const ire = r.orders.filter(o => o.symbol === 'IRE');
assert.equal(ire[0].side, 'buy'); assert.equal(ire[1].side, 'sell'); assert(ire[0].t < ire[1].t);
const trips = A.roundTrips(r.orders).trips;
assert.equal(trips.length, 2);
const c = trips.find(t => t.symbol === 'CIFR'); assert.equal(c.pnl, 15); assert.equal(c.entryPx, 9);
const i = trips.find(t => t.symbol === 'IRE'); assert(Math.abs(i.pnl - (3.07 - 3.2) * 95) < 1e-9);
assert.equal(P.robinhoodActivity('a,b\n1,2').ok, false);
assert.equal(P.num('($1,304.50)'), -1304.5); assert.equal(P.num('12S'), 12);

// Filing window: close before the date to close of the next session
const bars = ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08'].map((d, k) => ({ d, c: [10, 11, 12, 13][k] }));
const spy = bars.map(b => ({ d: b.d, c: 100 }));
const w = P.filingWindow(bars, spy, '2026-01-06', 1);
assert.equal(w.from, '2026-01-05'); assert.equal(w.to, '2026-01-07');
assert(Math.abs(w.reaction - 0.2) < 1e-12); assert(Math.abs(w.driftEx - (13 / 12 - 1)) < 1e-12);
assert.equal(P.filingWindow(bars, spy, '2026-01-08', 1), null);
console.log('phone helpers ok');
