import React, { useState } from "react";
import { View, Text, LayoutChangeEvent } from "react-native";
import Svg, { Line, Rect, Polyline, Polygon, Text as SvgText } from "react-native-svg";
import { Bar } from "./api";
import { Theme, px } from "./theme";

export type Series = { vals: (number | null)[]; color: string; dash?: string };
export type Level = { y: number | null | undefined; color: string; label: string; dash?: string };
export type Mark = { i: number; dir: 1 | -1 };

/* Candles with moving lines, horizontal levels, an optional entry band and buy/sell marks.
   Every mark is placed with the same price and index scale. */
export function Chart({ bars, lines = [], levels = [], band, marks = [], count = 90, height = 300, theme }:
  { bars: Bar[]; lines?: Series[]; levels?: Level[]; band?: { lo: number; hi: number } | null; marks?: Mark[]; count?: number; height?: number; theme: Theme }) {
  const [w, setW] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);
  const n = Math.min(count, bars.length), off = bars.length - n, vis = bars.slice(off);
  if (!n) return <View style={{ height }} onLayout={onLayout}><Text style={{ color: theme.ink3, padding: 12 }}>No bars to draw.</Text></View>;

  const padR = 54, padT = 8, volH = 46, mainH = height - padT - volH - 6;
  let lo = Infinity, hi = -Infinity;
  vis.forEach(b => { lo = Math.min(lo, b.l); hi = Math.max(hi, b.h); });
  lines.forEach(l => l.vals.slice(off).forEach(v => { if (v != null && isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }));
  levels.forEach(l => { if (l.y != null && isFinite(l.y)) { lo = Math.min(lo, l.y); hi = Math.max(hi, l.y); } });
  if (band) { lo = Math.min(lo, band.lo); hi = Math.max(hi, band.hi); }
  const pad = (hi - lo) * 0.06 || hi * 0.01 || 1; lo -= pad; hi += pad;
  const cw = Math.max(1, (w - padR) / n);
  const X = (i: number) => i * cw + cw / 2;
  const Y = (v: number) => padT + (hi - v) / (hi - lo) * mainH;
  const bw = Math.max(1, Math.min(10, cw * 0.66));
  const vmax = Math.max(...vis.map(b => b.v)) || 1;

  // de-overlap level labels
  const labels = levels.filter(l => l.y != null && isFinite(l.y as number)).map(l => ({ y: Y(l.y as number), text: l.label, color: l.color })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 13) labels[i].y = labels[i - 1].y + 13;

  return (
    <View style={{ height }} onLayout={onLayout}>
      {w > 0 && (
        <Svg width={w} height={height}>
          {[0.2, 0.5, 0.8].map(f => { const v = hi - f * (hi - lo); return (
            <React.Fragment key={f}>
              <Line x1={0} x2={w - padR} y1={Y(v)} y2={Y(v)} stroke={theme.rule} strokeWidth={1} />
              <SvgText x={w - padR + 4} y={Y(v) + 4} fontSize={10} fill={theme.ink3}>{px(v)}</SvgText>
            </React.Fragment>); })}
          {band && <Rect x={0} y={Y(band.hi)} width={w - padR} height={Math.max(2, Y(band.lo) - Y(band.hi))} fill={theme.tealWash} />}
          {vis.map((b, i) => {
            const up = b.c >= b.o, col = up ? theme.up : theme.down, top = Math.min(Y(b.o), Y(b.c)), h = Math.max(1, Math.abs(Y(b.c) - Y(b.o)));
            return (
              <React.Fragment key={b.t}>
                <Line x1={X(i)} x2={X(i)} y1={Y(b.h)} y2={Y(b.l)} stroke={col} strokeWidth={1} opacity={b.provisional ? 0.45 : 1} />
                <Rect x={X(i) - bw / 2} y={top} width={bw} height={h} fill={up ? theme.sheet : col} stroke={col} strokeWidth={1} opacity={b.provisional ? 0.45 : 1} />
                <Rect x={X(i) - bw / 2} y={height - (b.v / vmax) * volH} width={bw} height={(b.v / vmax) * volH} fill={col} opacity={0.35} />
              </React.Fragment>);
          })}
          {lines.map((l, k) => {
            const pts: string[] = [];
            l.vals.slice(off).forEach((v, i) => { if (v != null && isFinite(v)) pts.push(X(i).toFixed(1) + "," + Y(v).toFixed(1)); });
            return <Polyline key={k} points={pts.join(" ")} fill="none" stroke={l.color} strokeWidth={1.4} strokeDasharray={l.dash} />;
          })}
          {levels.map((l, k) => l.y == null || !isFinite(l.y) ? null :
            <Line key={k} x1={0} x2={w - padR} y1={Y(l.y)} y2={Y(l.y)} stroke={l.color} strokeWidth={1.2} strokeDasharray={l.dash} />)}
          {labels.map((l, k) => <SvgText key={k} x={w - padR - 4} y={l.y - 3} fontSize={10} fontWeight="600" fill={l.color} textAnchor="end">{l.text}</SvgText>)}
          {marks.map((m, k) => {
            const j = m.i - off; if (j < 0 || j >= n) return null;
            const b = vis[j], s = 5, x = X(j);
            const p = m.dir > 0 ? [x, Y(b.l) + 4, x - s, Y(b.l) + 4 + s * 1.4, x + s, Y(b.l) + 4 + s * 1.4] : [x, Y(b.h) - 4, x - s, Y(b.h) - 4 - s * 1.4, x + s, Y(b.h) - 4 - s * 1.4];
            return <Polygon key={k} points={p.join(",")} fill={m.dir > 0 ? theme.up : theme.down} />;
          })}
          <Rect x={w - padR + 1} y={Y(vis[n - 1].c) - 8} width={padR - 2} height={16} fill={vis[n - 1].c >= vis[n - 1].o ? theme.up : theme.down} />
          <SvgText x={w - padR + 4} y={Y(vis[n - 1].c) + 4} fontSize={10.5} fontWeight="600" fill={theme.sheet}>{px(vis[n - 1].c)}</SvgText>
        </Svg>
      )}
    </View>
  );
}
