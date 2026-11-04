const E=require('../app/src/engine/engine.js');
const f=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23",weekday:"short"});
let bad=0, n=0;
for(let ms=Date.UTC(2008,0,1); ms<Date.UTC(2035,0,1); ms+=3600000*1.37){ n++;
 const p={};for(const x of f.formatToParts(new Date(ms)))p[x.type]=x.value;
 const a={date:`${p.year}-${p.month}-${p.day}`,min:+p.hour*60+ +p.minute,wd:p.weekday}, b=E.ny(ms);
 if(a.date!==b.date||a.min!==b.min||a.wd!==b.wd){ if(bad<5)console.log(new Date(ms).toISOString(),a,b); bad++; } }
// exact switch instants
for (const iso of ['2026-03-08T06:59:00Z','2026-03-08T07:00:00Z','2026-11-01T05:59:00Z','2026-11-01T06:00:00Z']){ const ms=Date.parse(iso); const p={};for(const x of f.formatToParts(new Date(ms)))p[x.type]=x.value; const b=E.ny(ms); if(+p.hour*60+ +p.minute!==b.min){bad++;console.log('switch',iso,p.hour,p.minute,b)} n++; }
console.log('checked',n,'mismatches',bad);
