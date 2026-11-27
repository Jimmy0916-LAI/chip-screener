// Inputs are observations on their actual source dates. Missing weeks break lines.
function holdingChart(weeks, bars, bands, sessions, showPrice) {
  if (!weeks.length) return '<p>此期間缺少集保觀測。</p>';
  const from = weeks[0][0], to = weeks.at(-1)[0];
  const candles = showPrice ? bars.filter(v => v[0] >= from && v[0] <= to) : [];
  const dates = [...new Set([...sessions.filter(d => d >= from && d <= to),
    ...weeks.map(w => w[0]), ...candles.map(b => b[0])])].sort();
  const byDay = new Map(dates.map((d,i) => [d,i]));
  const x = d => 64 + 640 * (dates.length === 1 ? .5 : byDay.get(d)/(dates.length-1));
  const levels = ['200','400','600','1000'];
  const colors = ['#60a5fa','#34d399','#f59e0b','#a78bfa'];
  const pct = (row, i) => row ? 100*row[2+i]/row[0] : null;
  const values = weeks.flatMap(([,r]) => bands.map(b => pct(r,levels.indexOf(b))).filter(Number.isFinite));
  if (!values.length) return '<p>所選級距缺少有效觀測。</p>';
  const lo = Math.min(...values)-.3, hi = Math.max(...values)+.3;
  const y = value => 175-148*(value-lo)/(hi-lo);
  const low = Math.min(...candles.map(b=>b[3])), high = Math.max(...candles.map(b=>b[2]));
  const py = v => high === low ? 101 : 175-148*(v-low)/(high-low);
  const summaries = new Map(weeks.map(([d,r])=>[d,bands.map(b=>{
    const value=pct(r,levels.indexOf(b));
    return b+' 張 '+(value===null?'缺觀測':value.toFixed(4)+'%');
  }).join(' · ')]));
  const marks = [];
  for (const fraction of [0,.5,1]) {
    const height = 175-148*fraction;
    marks.push('<text x="4" y="'+height+'">'+(lo+(hi-lo)*fraction).toFixed(2)+'%</text>');
    if (candles.length) marks.push('<text x="712" y="'+height+'">'+(low+(high-low)*fraction).toFixed(2)+'</text>');
  }
  const priceLabel = new Map();
  for (const [d,o,h,l,c] of candles) {
    const label = '開 '+o+' 高 '+h+' 低 '+l+' 收 '+c;
    priceLabel.set(d,label);
    const color = c>=o?'#f87171':'#34d399';
    const width = Math.min(8,320/dates.length);
    marks.push(`<g fill="${color}" stroke="${color}"><title>${d} ${label} · ${summaries.get(d)||'無當日集保觀測'}</title><line x1="${x(d)}" x2="${x(d)}" y1="${py(l)}" y2="${py(h)}"/><rect x="${x(d)-width/2}" y="${Math.min(py(o),py(c))}" width="${width}" height="${Math.max(1,Math.abs(py(c)-py(o)))}"/></g>`);
  }
  for (const band of bands) {
    const i = levels.indexOf(band);
    let last;
    for (const [day,row] of weeks) {
      const value = pct(row,i);
      if (value === null) { last = null; continue; }
      const weekIndex = Math.floor((Date.parse(day)/86400000+3)/7);
      if (last && weekIndex-last.week === 1)
        marks.push(`<line x1="${last.x}" x2="${x(day)}" y1="${last.y}" y2="${y(value)}" stroke="${colors[i]}"/>`);
      marks.push(`<circle cx="${x(day)}" cy="${y(value)}" r="4" fill="${colors[i]}"><title>${day} · ${summaries.get(day)} · ${priceLabel.get(day)||'無當日 K 棒'}</title></circle>`);
      last = {x:x(day),y:y(value),week:weekIndex};
    }
  }
  return `<svg role="img" aria-label="集保持股與日 K" viewBox="0 0 780 208" style="width:100%;fill:currentColor;font:12px sans-serif"><text x="4" y="14">持股 %</text>${candles.length?'<text x="712" y="14">股價 元</text>':''}${marks.join('')}<text x="64" y="200">${from}</text><text x="704" y="200" text-anchor="end">${to}</text></svg>${showPrice&&!candles.length?'<p>所選區間尚無日行情。</p>':''}`;
}
