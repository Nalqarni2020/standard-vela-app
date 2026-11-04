const E=require('../app/src/engine/engine.js'),assert=require('assert');
// monte carlo: all same returns -> no variance
// identical trades: every redraw is the same, so no spread
let m=E.monteCarlo([0.1,0.1,0.1],500); assert(Math.abs(m.retP5-m.retP95)<1e-12 && Math.abs(m.retP50-(1.1**3-1))<1e-12 && m.ddP95===0);
// mixed trades: redraws must spread, and the middle must sit between the tails
m=E.monteCarlo([0.1,0.1,-0.05,0.02,-0.03],1000); assert(m.retP5<m.retP50 && m.retP50<m.retP95 && m.lossOdds>0 && m.lossOdds<1);
// synthetic data
let seed=3; const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;
function gen(n,p0,vol){const out=[];let p=p0;const t0=Date.parse('2021-11-01');for(let i=0;i<n;i++){const o=p;const c=o*(1+(rnd()-.5)*vol);p=c;const t=t0+i*864e5;out.push({t,d:new Date(t).toISOString().slice(0,10),o,h:Math.max(o,c)*(1+rnd()*vol/3),l:Math.min(o,c)*(1-rnd()*vol/3),c,v:1e6*(.5+rnd())});}return out;}
const spy=gen(1250,400,0.015);
const sets=[];for(let k=0;k<40;k++){const bars=gen(1250,10+k,0.05);sets.push({sym:'S'+k,bars,pass:null});}
let t=Date.now(); let cells=0;
for(const b of E.GRID_BODIES) for(const sw of E.GRID_SWITCHES){E.gridCell(sets,b,sw,0.0005,'2024-11-01');cells++;}
console.log('grid',cells,'cells',Date.now()-t,'ms');
// filters
t=Date.now(); const f=E.makeFilter(sets[0].bars,spy,'standard'); const cb=E.applyFilter(E.candleBreak(sets[0].bars),f);
console.log('std filter ms',Date.now()-t,'filtered',cb.filtered,'buys left',cb.sig.filter(x=>x===1).length);
const g=E.makeFilter(sets[0].bars,spy,'green'); const cb2=E.applyFilter(E.candleBreak(sets[0].bars),g); console.log('green filtered',cb2.filtered);
// check filter no-lookahead: regime at bar i equals regime() on spy slice
const reg=E.regimeSeries(spy); for(const i of [50,300,900,1249]) assert.strictEqual(reg[i],E.regime(spy.slice(0,i+1)).state);
console.log('ok');
