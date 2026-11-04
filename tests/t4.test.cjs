const E=require('../app/src/engine/engine.js'),assert=require('assert');
const B=(o,h,l,c,i)=>({o,h,l,c,v:100,t:i*864e5,d:'2026-01-'+String(i+1).padStart(2,'0')});
// 16 flat bars to seed ATR (range 1), then signal at 15, entry at 16 open=10, stop(bullLow)=9 -> risk 1
const bars=[];for(let i=0;i<16;i++)bars.push(B(10,10.5,9.5,10,i));
bars.push(B(10,10.6,9.8,10.5,16)); // entry bar
bars.push(B(10.5,11.2,10.4,11.1,17)); // hits 1R=11 (scale), not 2R
bars.push(B(11.1,12.3,11,12.2,18)); // hits 2R=12
bars.push(B(12.2,12.4,10.9,11,19));
for(let i=20;i<32;i++)bars.push(B(11,11.2,10.8,11,i));
const sig=bars.map((_,i)=>i===15?1:0), bullLow=bars.map((_,i)=>i===15?9:null);
const r=E.exitLab(bars,{sig,bullLow},{cost:0});
for(const k in r.res) console.log(k, JSON.stringify(r.res[k].map(t=>[+t.R.toFixed(3),t.why,t.bars])));
assert(r.res.t2r[0].R===2 && r.res.t2r[0].why==='Target 2R');
assert(r.res.time[0].why==='10 bars' && r.res.time[0].R===1);
// scale: half at 11 (+1R*0.5), stop->10 ; trail: hi 12.4, atr ~1 => 12.4-3 =9.4.. stop stays max(10,..). Rest exits?
// ORB synthetic: one full session with bullish first bar then rally
const day=[];const t0=Date.parse('2026-11-02T14:30:00Z');for(let m=0;m<78;m++){const o=10+m*0.01;day.push({t:t0+m*300000,o,h:o+0.02,l:m===0?9.9:o-0.005,c:o+0.01,v:1000});}
const ds=E.dayStudies(day,0); console.log(JSON.stringify(ds.orb)); assert(ds.orb.length===1&&ds.orb[0].dir===1&&ds.orb[0].why==='Close');
// night/day
console.log(E.nightDay([B(10,10,10,10,0),B(11,12,10,12,1)])); // overnight +10%, intraday +9.09%
console.log('ok');
