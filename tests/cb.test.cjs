const E=require('../app/src/engine/engine.js'),assert=require('assert');
const B=(o,h,l,c,v=100)=>({o,h,l,c,v,t:0,d:''});
// i0 strong bear (H=10.5), i1 strong bull (L=9.0)
// i2 close 10.0 (<=10.5), i3 close 10.8 > BearHigh 10.5, prev 10.0 <= 10.5 -> BuyBreak. LastDirection null -> no signal (MetaStock undefined)
// i4 close 10.3 < BrokenBearHigh 10.5, prev 10.8>=10.5, MainDir=1 -> FalseBuyBreak; LastDir=1 -> SellSignal
// i5 close 10.7 > BearHigh(10.5) prev 10.3 -> BuyBreak; LastDir=-1 -> BuySignal
// i6 close 8.8 < BullLow 9.0? prev 10.7>=9 -> SellBreak, LastDir=1 -> SellSignal
const bars=[B(11,10.5,9.5,9.6),B(9.1,10,9.0,9.9),B(9.9,10.1,9.8,10.0),B(10,10.9,9.95,10.8),B(10.8,10.85,10.25,10.3),B(10.3,10.75,10.28,10.7),B(10.7,10.72,8.7,8.8)];
// note i3 bar: body .8/.95=.84 bull -> BullLow from i4 on = 9.95; i5 body .4/.47=.85 bull -> BullLow i6 = 10.28
const r=E.candleBreak(bars);
console.log('sig',r.sig.join(','),'bull',r.bullLow.join(','),'bear',r.bearHigh.join(','));
// backtest: buy signal at i1 -> enter i2 open 10, sell signal at i3 -> exit i4 open 12; cost 0
const bars2=[B(1,1,1,1),B(1,1,1,1),B(10,11,9.5,10.5),B(10.5,12,10,11),B(12,12,11,11.5),B(11.5,12,11,11.8)];
const cb={sig:[0,1,0,-1,0,0],bullLow:[null,9.6,null,null,null,null]};
let t=E.backtest(bars2,cb,{cost:0}); console.log(t.trades.map(x=>[x.entryPx,x.exitPx,x.ret.toFixed(4),x.reason]), 'total',t.total.toFixed(4),'dd',t.maxDD.toFixed(4),'exp',t.exposure);
assert(Math.abs(t.total-0.2)<1e-9);
// with stop 9.6: bar2 low 9.5 -> stopped at 9.6
t=E.backtest(bars2,cb,{cost:0,stop:true}); console.log(t.trades.map(x=>[x.entryPx,x.exitPx,x.ret.toFixed(4),x.reason]));
assert(t.trades[0].exitPx===9.6 && t.trades[0].reason==='Stop'); const b3=bars2.map(b=>({...b})); b3[2].o=9.5; t=E.backtest(b3,cb,{cost:0,stop:true}); assert(t.skipped===1 && t.trades.length===0);
console.log('ok');
