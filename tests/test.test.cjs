const E = require('../app/src/engine/engine.js');
const assert = require('assert');
// sma/ema
assert.deepStrictEqual(E.sma([1,2,3,4,5],3),[null,null,2,3,4]);
const e = E.ema([1,2,3,4,5,6],3); assert(Math.abs(e[2]-2)<1e-12 && Math.abs(e[3]-3)<1e-12);
// RSI all up = 100
assert.strictEqual(E.rsi([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16],14)[15],100);
// Build scenario: uptrending SPY, stock with downtrend, swing low, then holds in band with volume
const day = 86400000; let t0 = Date.parse('2026-06-01T00:00:00Z');
const mk=(arr)=>arr.map((x,i)=>({t:t0+i*day,d:new Date(t0+i*day).toISOString().slice(0,10),o:x[0],h:x[1],l:x[2],c:x[3],v:x[4]}));
const spy = mk(Array.from({length:60},(_,i)=>{const c=500+i; return [c-0.5,c+1,c-1,c,1e6];}));
const reg = E.regime(spy); assert.strictEqual(reg.state,'Green', JSON.stringify(reg));
const spyDown = mk(Array.from({length:60},(_,i)=>{const c=560-i; return [c+0.5,c+1,c-1,c,1e6];}));
assert.strictEqual(E.regime(spyDown).state,'Red');
// stock: declines from 20 to 10 over 45 bars, swing low at 9.80, then 3 bars: closes 9.95, 9.93, 9.97 (band 9.898-9.996)
let px=[]; for(let i=0;i<45;i++){const c=20-i*(10/44); px.push([c+0.1,c+0.2,c-0.15,c,1e6]);}
px.push([10,10.05,9.80,9.90,1.2e6]);  // swing low 9.80
px.push([9.9,10.0,9.85,9.95,1e6]);
px.push([9.95,10.0,9.88,9.93,1e6]);
let sh = E.findShelf(mk(px)); assert(sh && sh.level===9.80 && sh.held===true, JSON.stringify(sh));
// trigger bar: close above 8sma? 8sma will be ~10.5 > 9.97 -> trigger fails. Expect NO with trigger fail.
px.push([9.93,10.0,9.90,9.97,2e6]);
const now = Date.parse('2026-08-10T21:00:00Z');
let r = E.evaluate({daily:mk(px),spy,nowMs:now,live:null,mode:'day',intraday:[],account:10000,bucket:'core',capPct:0.25,allowShelfException:false});
console.log(r.verdict, r.checks.map(c=>c.id+':'+c.pass+' '+c.note).join('\n'));
console.log('band',r.band,'stop',r.stop,'t1',r.t1,'rr',r.rr,'size',r.size);
// Alert parse
console.log(E.parseAlert('VIP | $CIFR up 12% rvol 3.4', Date.parse('2026-11-03T15:00:00Z')));
console.log(E.parseAlert('T1 Energy press release', Date.parse('2026-11-03T17:00:00Z')));
console.log(E.parseAlert('   ', 0));
// gamma
console.log(E.gammaProfile([{strike:7,type:'call',gamma:0.2,oi:9000},{strike:6,type:'put',gamma:0.15,oi:12000},{strike:8,type:'call',gamma:0.1,oi:5000}],7.5));
// aggregate 5m -> 15m
const b5=[]; const base=Date.parse('2026-11-03T14:30:00Z'); for(let i=0;i<6;i++) b5.push({t:base+i*300000,d:'2026-11-03',o:i,h:i+1,l:i-1,c:i+.5,v:10});
console.log(E.aggregate(b5,15));
