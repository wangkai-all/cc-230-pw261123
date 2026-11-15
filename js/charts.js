/* ============================================================================
 * charts.js — 轻量 SVG 图表（无第三方依赖）
 * 规范：细标记、发丝网格线、分段间隙用表面色、图例常备、悬浮提示不门控信息、
 *       文本一律 textContent（数据不可信）、颜色取自 CSS 变量（跟随主题）。
 * ========================================================================== */
const ODCharts = (() => {
  'use strict';

  const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const NS = 'http://www.w3.org/2000/svg';

  function svgEl(tag, attrs = {}) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  }
  function svgText(x, y, str, attrs = {}) {
    const t = svgEl('text', { x, y, class: 'axis-text', ...attrs });
    t.textContent = str;
    return t;
  }

  /* ---- 共享提示框 ---- */
  function tipEl() { return document.getElementById('tooltip'); }
  function showTip(x, y, title, rows) {
    const tip = tipEl();
    tip.textContent = '';
    if (title) {
      const t = document.createElement('div');
      t.className = 'tt-title'; t.textContent = title;
      tip.appendChild(t);
    }
    for (const r of rows) {
      const row = document.createElement('div');
      row.className = 'tt-row';
      if (r.color) {
        const k = document.createElement('span');
        k.className = 'tt-key'; k.style.background = r.color;
        row.appendChild(k);
      }
      const lab = document.createElement('span');
      lab.textContent = r.label;
      row.appendChild(lab);
      const val = document.createElement('span');
      val.className = 'tt-val'; val.textContent = r.value;
      row.appendChild(val);
      tip.appendChild(row);
    }
    tip.hidden = false;
    moveTip(x, y);
  }
  function moveTip(x, y) {
    const tip = tipEl();
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.min(x + 14, window.innerWidth - w - 10) + 'px';
    tip.style.top = Math.min(y + 14, window.innerHeight - h - 10) + 'px';
  }
  function hideTip() { tipEl().hidden = true; }

  /* ---- 刻度 ---- */
  function niceTicks(max, count = 4) {
    if (max <= 0) return [0, 1];
    const raw = max / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
    const ticks = [];
    for (let v = 0; v <= max + step * 0.5; v += step) ticks.push(v);
    return ticks;
  }

  /* 顶部两角圆角、底部贴基线的柱形路径 */
  function barPath(x, y, w, h, r = 4) {
    const rr = Math.min(r, w / 2, h);
    if (h <= 0) return '';
    return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} ` +
           `L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
  }

  /* ====================================================================
   * 分组柱状图（纵向）：categories × series
   * opts: { categories:[{key,label}], series:[{key,label,color}],
   *         data: {catKey: {seriesKey: value|null}}, yFmt, yMax, height, onDrill(catKey) }
   * ================================================================== */
  function groupedBars(container, opts) {
    container.textContent = '';
    const W = 720, H = opts.height || 260;
    const padL = 46, padR = 10, padT = 12, padB = 30;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });

    const allVals = [];
    for (const c of opts.categories) {
      const row = opts.data[c.key] || {};
      for (const s of opts.series) if (row[s.key] !== null && row[s.key] !== undefined) allVals.push(row[s.key]);
    }
    const yMax = opts.yMax !== undefined ? opts.yMax : (allVals.length ? Math.max(...allVals) : 1);
    const ticks = niceTicks(yMax);
    const top = ticks[ticks.length - 1];
    const y = v => padT + plotH - (v / top) * plotH;

    for (const t of ticks) {
      svg.appendChild(svgEl('line', { x1: padL, x2: W - padR, y1: y(t), y2: y(t), class: 'gridline' }));
      svg.appendChild(svgText(padL - 6, y(t) + 4, opts.yFmt(t), { 'text-anchor': 'end' }));
    }
    svg.appendChild(svgEl('line', { x1: padL, x2: W - padR, y1: y(0), y2: y(0), class: 'baseline' }));

    const slotW = plotW / Math.max(1, opts.categories.length);
    const barW = Math.min(24, (slotW * 0.7) / opts.series.length);

    opts.categories.forEach((c, ci) => {
      const cx = padL + slotW * ci + slotW / 2;
      const row = opts.data[c.key] || {};
      const groupW = barW * opts.series.length + 2 * (opts.series.length - 1);
      opts.series.forEach((s, si) => {
        const v = row[s.key];
        if (v === null || v === undefined) return;
        const bx = cx - groupW / 2 + si * (barW + 2);
        const by = y(v), bh = y(0) - y(v);
        const mark = svgEl('path', { d: barPath(bx, by, barW, Math.max(bh, 1)), fill: s.color, class: 'chart-mark', tabindex: '0' });
        const attach = el => {
          el.addEventListener('pointerenter', ev => showTip(ev.clientX, ev.clientY, c.label,
            opts.series.map(ss => ({ color: ss.color, label: ss.label, value: opts.yFmt((row[ss.key] === null || row[ss.key] === undefined) ? 0 : row[ss.key]) }))));
          el.addEventListener('pointermove', ev => moveTip(ev.clientX, ev.clientY));
          el.addEventListener('pointerleave', hideTip);
          el.addEventListener('focus', () => { const r = el.getBoundingClientRect(); showTip(r.left + r.width / 2, r.top, c.label, opts.series.map(ss => ({ color: ss.color, label: ss.label, value: opts.yFmt((row[ss.key] === null || row[ss.key] === undefined) ? 0 : row[ss.key]) }))); });
          el.addEventListener('blur', hideTip);
        };
        attach(mark);
        if (opts.onDrill) {
          mark.style.cursor = 'pointer';
          mark.addEventListener('click', () => opts.onDrill(c.key));
        }
        svg.appendChild(mark);
        // 加宽命中区
        const hit = svgEl('rect', { x: bx - 4, y: padT, width: barW + 8, height: plotH, fill: 'transparent' });
        attach(hit);
        if (opts.onDrill) { hit.style.cursor = 'pointer'; hit.addEventListener('click', () => opts.onDrill(c.key)); }
        svg.appendChild(hit);
      });
      svg.appendChild(svgText(cx, H - padB + 16, c.label, { 'text-anchor': 'middle' }));
    });

    container.appendChild(svg);
    return svg;
  }

  /* ====================================================================
   * 分组条形图（横向）：用于团队/物料对比，条端带数值标签
   * opts: { rows:[{key,label}], series:[{key,label,color}], data:{rowKey:{seriesKey:v|null}},
   *         xFmt, xMax, onDrill(rowKey) }
   * ================================================================== */
  function groupedBarsH(container, opts) {
    container.textContent = '';
    const rowH = 46, barH = 14;
    const W = 720, padL = 110, padR = 64, padT = 8, padB = 26;
    const H = padT + padB + opts.rows.length * rowH;
    const plotW = W - padL - padR;
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });

    const allVals = [];
    for (const r of opts.rows) for (const s of opts.series) {
      const v = (opts.data[r.key] || {})[s.key];
      if (v !== null && v !== undefined) allVals.push(v);
    }
    const xMax = opts.xMax !== undefined ? opts.xMax : (allVals.length ? Math.max(...allVals) : 1);
    const ticks = niceTicks(xMax);
    const top = ticks[ticks.length - 1];
    const x = v => padL + (v / top) * plotW;

    for (const t of ticks) {
      svg.appendChild(svgEl('line', { y1: padT, y2: H - padB, x1: x(t), x2: x(t), class: 'gridline' }));
      svg.appendChild(svgText(x(t), H - padB + 15, opts.xFmt(t), { 'text-anchor': 'middle' }));
    }
    svg.appendChild(svgEl('line', { y1: padT, y2: H - padB, x1: x(0), x2: x(0), class: 'baseline' }));

    opts.rows.forEach((r, ri) => {
      const cy = padT + rowH * ri + rowH / 2;
      svg.appendChild(svgText(padL - 8, cy + 4, r.label, { 'text-anchor': 'end' }));
      const row = opts.data[r.key] || {};
      opts.series.forEach((s, si) => {
        const v = row[s.key];
        if (v === null || v === undefined) return;
        const by = cy - barH - 2 + si * (barH + 4) + (opts.series.length === 1 ? barH / 2 + 1 : 0);
        const bw = Math.max(1, x(v) - x(0));
        const mark = svgEl('path', {
          d: `M${x(0)},${by} L${x(0) + bw - 3},${by} Q${x(0) + bw},${by} ${x(0) + bw},${by + 3} L${x(0) + bw},${by + barH - 3} Q${x(0) + bw},${by + barH} ${x(0) + bw - 3},${by + barH} L${x(0)},${by + barH} Z`,
          fill: s.color, class: 'chart-mark', tabindex: '0',
        });
        const rows2 = opts.series.map(ss => ({ color: ss.color, label: ss.label, value: opts.xFmt((row[ss.key] === null || row[ss.key] === undefined) ? 0 : row[ss.key]) }));
        mark.addEventListener('pointerenter', ev => showTip(ev.clientX, ev.clientY, r.label, rows2));
        mark.addEventListener('pointermove', ev => moveTip(ev.clientX, ev.clientY));
        mark.addEventListener('pointerleave', hideTip);
        mark.addEventListener('focus', () => { const b = mark.getBoundingClientRect(); showTip(b.left + b.width / 2, b.top, r.label, rows2); });
        mark.addEventListener('blur', hideTip);
        if (opts.onDrill) { mark.style.cursor = 'pointer'; mark.addEventListener('click', () => opts.onDrill(r.key)); }
        svg.appendChild(mark);
        // 条端数值标签（文本用墨色，不用系列色）
        svg.appendChild(svgText(x(0) + bw + 6, by + barH - 3, opts.xFmt(v), { class: 'axis-text', 'font-size': '11' }));
      });
    });

    container.appendChild(svg);
    return svg;
  }

  /* ====================================================================
   * 高分段条（tall segmented bar）：一个整体拆成 ≤6 部分
   * parts: [{key,label,value,color,darkText}]，标签放不下则不画（表格视图兜底）
   * ================================================================== */
  function segmentedBar(container, parts, opts = {}) {
    container.textContent = '';
    const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0);
    const bar = document.createElement('div');
    bar.className = 'segbar';
    bar.setAttribute('role', 'img');
    const segs = [];
    if (total > 0) {
      for (const p of parts) {
        const v = Math.max(0, p.value);
        if (v <= 0) continue;
        const seg = document.createElement('div');
        seg.className = 'seg' + (p.darkText ? ' dark-text' : '');
        seg.style.width = (v / total * 100) + '%';
        seg.style.background = p.color;
        seg.tabIndex = 0;
        const label = document.createElement('span');
        label.textContent = `${p.label} ${opts.fmt ? opts.fmt(p.value) : p.value}`;
        seg.appendChild(label);
        const tipRows = [
          { label: '延期数量·天', value: opts.fmt ? opts.fmt(p.value) : String(p.value) },
          { label: '占比', value: (v / total * 100).toFixed(1) + '%' },
        ];
        seg.addEventListener('pointerenter', ev => showTip(ev.clientX, ev.clientY, p.label, tipRows));
        seg.addEventListener('pointermove', ev => moveTip(ev.clientX, ev.clientY));
        seg.addEventListener('pointerleave', hideTip);
        seg.addEventListener('focus', () => { const b = seg.getBoundingClientRect(); showTip(b.left + b.width / 2, b.top, p.label, tipRows); });
        seg.addEventListener('blur', hideTip);
        if (opts.onDrill) { seg.style.cursor = 'pointer'; seg.addEventListener('click', () => opts.onDrill(p.key)); }
        bar.appendChild(seg);
        segs.push({ seg, label });
      }
    }
    container.appendChild(bar);
    // 量不到就不画内嵌标签（不裁剪、不溢出）
    requestAnimationFrame(() => {
      for (const { seg, label } of segs) {
        if (label.scrollWidth + 18 > seg.clientWidth) label.style.display = 'none';
      }
    });
    return bar;
  }

  /* ====================================================================
   * 订单承诺时间线：承诺漂移 + 发货/签收/取消事件
   * ================================================================== */
  function orderTimeline(container, analysis, asOf, M) {
    container.textContent = '';
    const o = analysis.order;
    const W = 720, H = 190, padL = 64, padR = 16, padT = 14, padB = 26;
    const plotW = W - padL - padR;
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });

    const DAY = 86400000;
    const promiseTs = analysis.chain.map(c => Date.parse(c.date + 'T00:00:00Z'));
    const eventTs = o.events.map(e => e.ts);
    let t0 = Math.min(...promiseTs, ...eventTs) - 2 * DAY;
    let t1 = Math.max(...promiseTs, ...eventTs, asOf.ts) + 2 * DAY;
    if (t1 <= t0) t1 = t0 + DAY;
    const x = ts => padL + (ts - t0) / (t1 - t0) * plotW;

    const lanes = [
      { key: 'promise', label: '承诺', y: padT + 22 },
      { key: 'shipment', label: '发货', y: padT + 62 },
      { key: 'receipt', label: '签收', y: padT + 102 },
      { key: 'cancel', label: '取消/恢复', y: padT + 142 },
    ];
    for (const l of lanes) {
      svg.appendChild(svgText(padL - 8, l.y + 4, l.label, { 'text-anchor': 'end' }));
      svg.appendChild(svgEl('line', { x1: padL, x2: W - padR, y1: l.y, y2: l.y, class: 'gridline' }));
    }

    // X 轴日期刻度（订单时区）
    const nTicks = 5;
    for (let i = 0; i <= nTicks; i++) {
      const ts = t0 + (t1 - t0) * i / nTicks;
      const d = M.dateInZone(new Date(ts).toISOString(), o.tz);
      svg.appendChild(svgText(x(ts), H - 8, d.slice(5), { 'text-anchor': 'middle' }));
      svg.appendChild(svgEl('line', { x1: x(ts), x2: x(ts), y1: padT, y2: H - padB, class: 'gridline' }));
    }
    // 数据截止线
    if (asOf.ts >= t0 && asOf.ts <= t1) {
      const ax = x(asOf.ts);
      svg.appendChild(svgEl('line', { x1: ax, x2: ax, y1: padT, y2: H - padB, stroke: cssVar('--muted'), 'stroke-width': 1 }));
      svg.appendChild(svgText(ax + 3, padT + 8, '数据截止', { 'font-size': '10' }));
    }

    const cBlue = cssVar('--series-1'), cOrange = cssVar('--series-2');
    const cGood = cssVar('--good'), cCrit = cssVar('--critical');
    const cMuted = cssVar('--muted'), cAqua = cssVar('--series-3'), cWarn = cssVar('--warning');
    const surface = cssVar('--surface-1');

    function attachTip(el, title, rows) {
      el.addEventListener('pointerenter', ev => showTip(ev.clientX, ev.clientY, title, rows));
      el.addEventListener('pointermove', ev => moveTip(ev.clientX, ev.clientY));
      el.addEventListener('pointerleave', hideTip);
      el.addEventListener('focus', () => { const b = el.getBoundingClientRect(); showTip(b.left + b.width / 2, b.top, title, rows); });
      el.addEventListener('blur', hideTip);
    }

    // 承诺链：菱形 + 连线（向右漂移 = 改期推迟）
    const py = lanes[0].y;
    let prev = null;
    analysis.chain.forEach((c, i) => {
      const cx = x(Date.parse(c.date + 'T00:00:00Z'));
      if (prev) svg.appendChild(svgEl('line', { x1: prev.x, y1: py, x2: cx, y2: py, stroke: cOrange, 'stroke-width': 2 }));
      const color = i === 0 ? cBlue : cOrange;
      const d = 6;
      const mark = svgEl('path', {
        d: `M${cx},${py - d} L${cx + d},${py} L${cx},${py + d} L${cx - d},${py} Z`,
        fill: color, stroke: surface, 'stroke-width': 2, class: 'chart-mark', tabindex: '0',
      });
      const rows = [
        { label: i === 0 ? '最初承诺' : '改期承诺', value: c.date },
        { label: '登记时间', value: M.fmtDateTimeInZone(c.at, o.tz) },
      ];
      if (c.reason) rows.push({ label: '记录原因', value: (M.REASON_LABEL[c.reason.category] || c.reason.category) + (c.reason.detail ? '：' + c.reason.detail : '') });
      else if (i > 0) rows.push({ label: '记录原因', value: '无（计入未解释）' });
      if (c.note) rows.push({ label: '备注', value: c.note });
      attachTip(mark, (i === 0 ? '最初承诺 ' : '改期 ') + c.date, rows);
      svg.appendChild(mark);
      prev = { x: cx };
    });

    // 事件标记
    for (const e of o.events) {
      if (e.type === 'shipment') {
        const m = svgEl('rect', { x: x(e.ts) - 4.5, y: lanes[1].y - 4.5, width: 9, height: 9, fill: cMuted, stroke: surface, 'stroke-width': 2, class: 'chart-mark', tabindex: '0' });
        attachTip(m, '发货 ' + e.qty + ' ' + o.unit, [
          { label: '时间', value: M.fmtDateTimeInZone(e.at, o.tz) },
          ...(e.reason ? [{ label: '记录原因', value: M.REASON_LABEL[e.reason.category] || e.reason.category }] : []),
          ...(e.note ? [{ label: '备注', value: e.note }] : []),
        ]);
        svg.appendChild(m);
      } else if (e.type === 'receipt') {
        const rec = analysis.receipts.find(r => r.ref === e);
        const onTime = rec ? rec.onTimeInitial : true;
        const m = svgEl('circle', { cx: x(e.ts), cy: lanes[2].y, r: 5.5, fill: onTime ? cGood : cCrit, stroke: surface, 'stroke-width': 2, class: 'chart-mark', tabindex: '0' });
        const rows = [
          { label: '签收数量', value: e.qty + ' ' + o.unit },
          { label: '原始时间', value: e.at },
          { label: `订单时区(${o.tz})`, value: M.fmtDateTimeInZone(e.at, o.tz) + ' → 计 ' + (rec ? rec.dateInTz : '') },
          { label: '最初承诺口径', value: rec ? (rec.onTimeInitial ? '准时' : `迟到 ${rec.delayDaysInitial} 天`) : '-' },
          { label: '当时有效承诺口径', value: rec ? (rec.onTimeEffective ? '准时' : `迟到 ${rec.lateDaysEffective} 天`) : '-' },
        ];
        if (e.backfilled) rows.push({ label: '来源', value: '补录签收' });
        if (rec && rec.overQty > 0) rows.push({ label: '超收', value: rec.overQty + ' ' + o.unit + '（不计入）' });
        attachTip(m, '签收 ' + e.qty + ' ' + o.unit, rows);
        svg.appendChild(m);
      } else if (e.type === 'cancel' || e.type === 'restore') {
        const isCancel = e.type === 'cancel';
        const m = svgEl('path', {
          d: isCancel
            ? `M${x(e.ts) - 4.5},${lanes[3].y - 4.5} L${x(e.ts) + 4.5},${lanes[3].y + 4.5} M${x(e.ts) + 4.5},${lanes[3].y - 4.5} L${x(e.ts) - 4.5},${lanes[3].y + 4.5}`
            : `M${x(e.ts) - 5},${lanes[3].y} A5,5 0 1,1 ${x(e.ts) + 5},${lanes[3].y}`,
          stroke: isCancel ? cWarn : cAqua, 'stroke-width': 2.5, fill: 'none', class: 'chart-mark', tabindex: '0',
        });
        attachTip(m, (isCancel ? '取消 ' : '恢复 ') + e.qty + ' ' + o.unit, [
          { label: '时间', value: M.fmtDateTimeInZone(e.at, o.tz) },
          ...(e.reason ? [{ label: '记录原因', value: (M.REASON_LABEL[e.reason.category] || e.reason.category) + (e.reason.detail ? '：' + e.reason.detail : '') }] : []),
          ...(e.note ? [{ label: '备注', value: e.note }] : []),
        ]);
        svg.appendChild(m);
      }
    }

    container.appendChild(svg);
    return svg;
  }

  return { groupedBars, groupedBarsH, segmentedBar, orderTimeline, cssVar, showTip, moveTip, hideTip };
})();
