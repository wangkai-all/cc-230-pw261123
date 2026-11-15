/* ============================================================================
 * app.js — 页面应用：状态、渲染、交互、导入导出、补录重算、快照差额
 * ========================================================================== */
(() => {
  'use strict';
  const M = ODModel, X = ODMetrics, C = ODCharts;

  /* ---------- DOM 工具 ---------- */
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    for (const c of children) {
      if (c === null || c === undefined) continue;
      el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
    return el;
  }
  const $ = id => document.getElementById(id);

  /* ---------- 格式化 ---------- */
  const fmtPct = v => (v === null || v === undefined) ? '—' : (v * 100).toFixed(1) + '%';
  const fmtNum = v => (v === null || v === undefined) ? '—' : Number(v).toLocaleString('zh-CN');
  const fmtPp = d => (d === null || d === undefined) ? '—' : (d > 0 ? '+' : '') + (d * 100).toFixed(1) + 'pp';
  const fmtSigned = d => (d > 0 ? '+' : '') + fmtNum(d);

  /* ---------- 原因 → 颜色（固定映射，颜色跟随实体） ---------- */
  const REASON_COLOR_VAR = {
    material_shortage: '--series-1', customer_reschedule: '--series-2',
    transport_exception: '--series-3', capacity_shortage: '--series-4',
    quality_hold: '--series-5', other_recorded: '--series-6',
    unexplained: '--unexplained',
  };
  const reasonColor = key => C.cssVar(REASON_COLOR_VAR[key] || '--muted');
  const CALIBER_COLORS = { initial: () => C.cssVar('--series-1'), effective: () => C.cssVar('--series-2') };

  /* ---------- 状态 ---------- */
  const state = {
    raw: null,            // 原始数据（含补录事件，可导出回填）
    dataset: null,        // 规范化后
    analyses: [],
    asOf: null,
    summary: null,        // 全量汇总（快照用）
    snapshots: [],        // {label, at, summary}
    filters: { team: '', material: '', status: '' },
    drill: null,          // {label, ids:Set}
    tab: 'overview',
    compareDim: 'team',
    expanded: new Set(),
  };

  /* ---------- 数据管线 ---------- */
  function loadDataset(raw, label) {
    state.raw = raw;
    state.dataset = M.normalizeDataset(raw);
    recompute(label);
  }
  function recompute(label) {
    state.analyses = state.dataset.orders.map(X.analyzeOrder);
    state.asOf = X.datasetAsOf(state.dataset.meta, state.dataset.orders);
    state.summary = X.summarize(state.analyses, state.asOf);
    state.snapshots.push({ label, at: new Date().toISOString(), summary: state.summary });
    render();
  }
  function filteredAnalyses() {
    return state.analyses.filter(a => {
      const f = state.filters;
      if (f.team && a.order.team !== f.team) return false;
      if (f.material && a.order.material !== f.material) return false;
      if (f.status && a.status !== f.status) return false;
      if (state.drill && !state.drill.ids.has(a.order.id)) return false;
      return true;
    });
  }

  /* 单订单延期合计（数量·天，按原因分类） */
  function orderDelayTotals(a) {
    const totals = new Map();
    const add = (cat, v) => { if (v) totals.set(cat, (totals.get(cat) || 0) + v); };
    for (const r of a.receipts) {
      if (r.delayDaysInitial > 0 && r.countedQty > 0) {
        for (const s of r.segments) add(s.reason ? s.reason.category : M.UNEXPLAINED_KEY, s.days * r.countedQty);
      }
    }
    const asOfDate = M.dateInZone(state.asOf.at, a.order.tz);
    const remaining = a.effectiveQty - a.receivedCounted;
    if (!a.completing && remaining > 0 && M.dayDiff(a.initial.date, asOfDate) > 0) {
      for (const s of X.overdueSegments(a, asOfDate)) add(s.reason ? s.reason.category : M.UNEXPLAINED_KEY, s.days * remaining);
    }
    return totals;
  }

  /* ---------- 提示 ---------- */
  let toastTimer = null;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 5000);
  }

  /* ====================================================================
   * 渲染
   * ================================================================== */
  function render() {
    renderFilterRow();
    for (const v of ['overview', 'orders', 'compare', 'attribution', 'log']) {
      $('view-' + v).classList.toggle('active', state.tab === v);
    }
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === state.tab));
    if (state.tab === 'overview') renderOverview();
    else if (state.tab === 'orders') renderOrders();
    else if (state.tab === 'compare') renderCompare();
    else if (state.tab === 'attribution') renderAttribution();
    else if (state.tab === 'log') renderLog();
  }

  function renderFilterRow() {
    const ds = state.dataset;
    $('dataset-name').textContent = ds ? (ds.meta.name || `已加载 ${ds.orders.length} 单`) : '未加载数据';
    if (!ds) return;
    const fill = (id, values) => {
      const sel = $(id);
      const cur = sel.value;
      sel.textContent = '';
      sel.appendChild(h('option', { value: '' }, '全部'));
      for (const v of values) sel.appendChild(h('option', { value: v }, v));
      sel.value = cur;
    };
    fill('filter-team', [...new Set(ds.orders.map(o => o.team))].sort());
    fill('filter-material', [...new Set(ds.orders.map(o => o.material))].sort());

    const chip = $('drill-chip');
    if (state.drill) {
      chip.hidden = false;
      chip.textContent = '钻取：' + state.drill.label + ' ';
      const x = h('button', { onclick: () => { state.drill = null; render(); } }, '✕');
      chip.appendChild(x);
    } else chip.hidden = true;

    $('asof-badge').textContent = '数据截止 ' + state.asOf.at + (state.asOf.inferred ? '（由最新事件推断）' : '');
    const wb = $('warnings-badge');
    if (ds.warnings.length) {
      wb.hidden = false;
      wb.textContent = `⚠ ${ds.warnings.length} 条校验警告`;
    } else wb.hidden = true;
  }

  /* ---------- 总览 ---------- */
  function kpiTile(label, value, delta, note, onClick) {
    const tile = h('div', { class: 'kpi' + (onClick ? ' clickable' : '') },
      h('div', { class: 'kpi-label' }, label),
      h('div', { class: 'kpi-value' }, value),
      delta ? h('div', { class: 'kpi-delta ' + delta.cls }, delta.text) : null,
      note ? h('div', { class: 'kpi-note' }, note) : null,
    );
    if (onClick) tile.addEventListener('click', onClick);
    return tile;
  }

  function renderOverview() {
    const el = $('view-overview');
    el.textContent = '';
    const analyses = filteredAnalyses();
    const s = X.summarize(analyses, state.asOf);
    const att = X.attribute(analyses, state.asOf);
    const totalQtyDays = att.reduce((sum, r) => sum + r.qtyDays, 0);
    const unx = att.find(r => r.key === M.UNEXPLAINED_KEY);
    const unxShare = totalQtyDays ? (unx ? unx.qtyDays : 0) / totalQtyDays : null;

    const drillTo = (label, ids) => () => { state.drill = { label, ids: new Set(ids) }; state.tab = 'orders'; render(); };
    const lateOrderIds = analyses.filter(a =>
      a.receipts.some(r => !r.onTimeInitial && r.countedQty > 0) ||
      (!a.completing && a.status !== 'canceled' && a.effectiveQty > a.receivedCounted &&
        M.dayDiff(a.finalPromiseDate, M.dateInZone(state.asOf.at, a.order.tz)) > 0)
    ).map(a => a.order.id);
    const overdueIds = analyses.filter(a => !a.completing && a.status !== 'canceled' &&
      a.effectiveQty > a.receivedCounted &&
      M.dayDiff(a.finalPromiseDate, M.dateInZone(state.asOf.at, a.order.tz)) > 0).map(a => a.order.id);
    const unxIds = unx ? [...new Set(unx.details.map(d => d.orderId))] : [];

    /* KPI 行 */
    const row = h('div', { class: 'kpi-row' });
    const hero = h('div', { class: 'kpi hero clickable' },
      h('div', { class: 'kpi-label' }, '准时率 · 数量口径 · 最初承诺'),
      h('div', { class: 'kpi-value' }, fmtPct(s.otr.qtyInitial)),
      h('div', { class: 'kpi-note' }, `按时 ${fmtNum(s.qty.onTimeInitial)} / 到期有效 ${fmtNum(s.qty.dueEffective)}`),
      h('div', { class: 'kpi-note' }, '点击钻取初诺口径下逾期的订单'),
    );
    hero.addEventListener('click', drillTo('初诺口径逾期订单', lateOrderIds));
    row.appendChild(hero);
    row.appendChild(kpiTile('准时率 · 数量口径 · 当时有效承诺', fmtPct(s.otr.qtyEffective),
      { text: `较初诺 ${fmtPp(s.otr.qtyEffective !== null && s.otr.qtyInitial !== null ? s.otr.qtyEffective - s.otr.qtyInitial : null)}（改期掩盖幅度）`, cls: 'neutral' },
      `按时 ${fmtNum(s.qty.onTimeEffective)} / ${fmtNum(s.qty.dueEffective)}`));
    row.appendChild(kpiTile('准时率 · 订单口径 · 最初承诺', fmtPct(s.otr.orderInitial),
      null, `准时 ${fmtNum(s.orderOnTime.initial)} / 到期 ${fmtNum(s.orders.due)} 单`));
    row.appendChild(kpiTile('准时率 · 订单口径 · 当时有效承诺', fmtPct(s.otr.orderEffective),
      { text: `较初诺 ${fmtPp(s.otr.orderEffective !== null && s.otr.orderInitial !== null ? s.otr.orderEffective - s.otr.orderInitial : null)}`, cls: 'neutral' },
      `准时 ${fmtNum(s.orderOnTime.effective)} / ${fmtNum(s.orders.due)} 单`));
    row.appendChild(kpiTile('逾期未交付数量', fmtNum(s.qty.overdueOpen),
      null, '到期仍未交齐的有效数量',
      overdueIds.length ? drillTo('逾期未交付订单', overdueIds) : null));
    row.appendChild(kpiTile('未解释延期占比', fmtPct(unxShare),
      { text: '仅统计有记录原因之外的延期', cls: 'neutral' },
      `未解释 ${fmtNum(unx ? unx.qtyDays : 0)} / 共 ${fmtNum(totalQtyDays)} 数量·天`,
      unxIds.length ? drillTo('含未解释延期的订单', unxIds) : null));
    el.appendChild(row);

    /* 口径对照矩阵 */
    const matrix = h('div', { class: 'card' },
      h('h2', null, '口径对照', h('span', { class: 'h2-note' }, '差额 = 改期对准时率的掩盖幅度，两种口径并列、不用最后一次改期掩盖原始延期')),
      (() => {
        const t = h('table', { class: 'data' },
          h('tr', null, h('th', null, '口径'), h('th', { class: 'num' }, '最初承诺'), h('th', { class: 'num' }, '当时有效承诺'), h('th', { class: 'num' }, '差额')),
          h('tr', null, h('td', null, '数量口径（按有效数量加权）'),
            h('td', { class: 'num' }, fmtPct(s.otr.qtyInitial)),
            h('td', { class: 'num' }, fmtPct(s.otr.qtyEffective)),
            h('td', { class: 'num' }, fmtPp(s.otr.qtyEffective !== null && s.otr.qtyInitial !== null ? s.otr.qtyEffective - s.otr.qtyInitial : null))),
          h('tr', null, h('td', null, '订单口径（整单交齐才算）'),
            h('td', { class: 'num' }, fmtPct(s.otr.orderInitial)),
            h('td', { class: 'num' }, fmtPct(s.otr.orderEffective)),
            h('td', { class: 'num' }, fmtPp(s.otr.orderEffective !== null && s.otr.orderInitial !== null ? s.otr.orderEffective - s.otr.orderInitial : null))),
        );
        return t;
      })(),
      h('div', { class: 'caliber-note' },
        `到期订单 ${fmtNum(s.orders.due)} 单 / 未到期 ${fmtNum(s.orders.notDue)} 单 / 已取消 ${fmtNum(s.orders.canceled)} 单（均不计入分母）；` +
        `部分交付同时按数量与订单两套口径展示，见上表两行。`),
    );
    el.appendChild(matrix);

    /* 按月签收准时率 */
    const months = X.monthly(analyses);
    const monthCard = h('div', { class: 'card' }, h('h2', null, '按月签收准时率（数量口径）'));
    if (months.length) {
      const data = {};
      for (const m of months) {
        data[m.month] = {
          initial: m.total ? m.onTimeInitial / m.total : null,
          effective: m.total ? m.onTimeEffective / m.total : null,
        };
      }
      const chartBox = h('div', { class: 'chart' });
      monthCard.appendChild(chartBox);
      monthCard.appendChild(h('div', { class: 'legend' },
        h('span', { class: 'legend-item' }, h('span', { class: 'swatch', style: 'background:' + CALIBER_COLORS.initial() }), '最初承诺'),
        h('span', { class: 'legend-item' }, h('span', { class: 'swatch', style: 'background:' + CALIBER_COLORS.effective() }), '当时有效承诺'),
      ));
      const tbl = h('table', { class: 'data' },
        h('tr', null, h('th', null, '月份'), h('th', { class: 'num' }, '签收数量'), h('th', { class: 'num' }, '最初承诺'), h('th', { class: 'num' }, '当时有效承诺')));
      for (const m of months) {
        tbl.appendChild(h('tr', null,
          h('td', null, m.month),
          h('td', { class: 'num' }, fmtNum(m.total)),
          h('td', { class: 'num' }, fmtPct(m.total ? m.onTimeInitial / m.total : null)),
          h('td', { class: 'num' }, fmtPct(m.total ? m.onTimeEffective / m.total : null))));
      }
      monthCard.appendChild(h('details', { class: 'table-toggle' }, h('summary', null, '表格视图'), tbl));
      el.appendChild(monthCard);
      C.groupedBars(chartBox, {
        categories: months.map(m => ({ key: m.month, label: m.month.slice(2) })),
        series: [
          { key: 'initial', label: '最初承诺', color: CALIBER_COLORS.initial() },
          { key: 'effective', label: '当时有效承诺', color: CALIBER_COLORS.effective() },
        ],
        data, yFmt: fmtPct, yMax: 1,
      });
    } else {
      monthCard.appendChild(h('div', { class: 'empty-state' }, '当前筛选下没有签收记录'));
      el.appendChild(monthCard);
    }
  }

  /* ---------- 订单明细 ---------- */
  const STATUS_META = {
    fulfilled: { label: '已交齐', cls: 'st-good', icon: '✓' },
    partial: { label: '部分交付', cls: 'st-warn', icon: '◐' },
    open: { label: '未交付', cls: 'st-muted', icon: '○' },
    canceled: { label: '已取消', cls: 'st-critical', icon: '✕' },
  };
  function statusBadge(a) {
    const meta = STATUS_META[a.status];
    let cls = meta.cls, label = meta.label, icon = meta.icon;
    if (a.status !== 'canceled' && !a.completing && a.effectiveQty > a.receivedCounted &&
        M.dayDiff(a.finalPromiseDate, M.dateInZone(state.asOf.at, a.order.tz)) > 0) {
      cls = 'st-serious'; label += '·逾期'; icon = '⚠';
    }
    return h('span', { class: 'status-badge ' + cls }, h('span', { class: 'dot' }), `${icon} ${label}`);
  }
  function onTimeCell(v) {
    if (v === null || v === undefined) return h('td', null, h('span', { class: 'cell-sub' }, '未交齐'));
    return h('td', null, h('span', { class: 'status-badge ' + (v ? 'st-good' : 'st-critical') },
      h('span', { class: 'dot' }), v ? '✓ 准时' : '✗ 迟到'));
  }

  function renderOrders() {
    const el = $('view-orders');
    el.textContent = '';
    const analyses = filteredAnalyses();
    const card = h('div', { class: 'card' },
      h('h2', null, `订单明细（${analyses.length} 单）`, h('span', { class: 'h2-note' }, '点击行尾"展开"查看承诺时间线、归因分解与补录签收')));
    const table = h('table', { class: 'data' },
      h('tr', null,
        h('th', null, '订单'), h('th', null, '客户'), h('th', null, '团队'), h('th', null, '物料'),
        h('th', { class: 'num' }, '有效数量'), h('th', { class: 'num' }, '已签收'),
        h('th', null, '最初承诺'), h('th', null, '现承诺'), h('th', null, '状态'),
        h('th', null, '初诺口径'), h('th', null, '现诺口径'),
        h('th', { class: 'num' }, '延期数量·天'), h('th', null, '')));
    for (const a of analyses) {
      const o = a.order;
      const totals = orderDelayTotals(a);
      const totalDays = [...totals.values()].reduce((x, y) => x + y, 0);
      const unxDays = totals.get(M.UNEXPLAINED_KEY) || 0;
      const tr = h('tr', null,
        h('td', null, o.id, o.splitFrom ? h('div', { class: 'cell-sub' }, `拆自 ${o.splitFrom}`) : null,
          o.splitInto.length ? h('div', { class: 'cell-sub' }, `拆出 ${o.splitInto.join('、')}`) : null),
        h('td', null, o.customer),
        h('td', null, o.team),
        h('td', null, o.material),
        h('td', { class: 'num' }, `${fmtNum(a.effectiveQty)}`, h('div', { class: 'cell-sub' }, `订 ${fmtNum(a.qty)}${a.netCanceled ? ` −${fmtNum(a.netCanceled)}` : ''}`)),
        h('td', { class: 'num' }, fmtNum(a.receivedCounted), a.receivedTotal > a.receivedCounted ? h('div', { class: 'cell-sub' }, `超收 ${fmtNum(a.receivedTotal - a.receivedCounted)}`) : null),
        h('td', null, a.initial.date),
        h('td', null, a.finalPromiseDate, a.finalPromiseDate !== a.initial.date ? h('div', { class: 'cell-sub' }, `改期 ${a.chain.length - 1} 次`) : null),
        h('td', null, statusBadge(a)),
        a.status === 'canceled' ? h('td', { colspan: 2 }, h('span', { class: 'cell-sub' }, '不计入')) : null,
        a.status !== 'canceled' ? onTimeCell(a.onTimeOrderInitial) : null,
        a.status !== 'canceled' ? onTimeCell(a.onTimeOrderEffective) : null,
        h('td', { class: 'num' }, totalDays ? fmtNum(totalDays) : '0',
          unxDays ? h('div', { class: 'cell-sub' }, `未解释 ${fmtNum(unxDays)}`) : null),
        h('td', null, (() => {
          const btn = h('button', { class: 'btn' }, state.expanded.has(o.id) ? '收起' : '展开');
          btn.addEventListener('click', () => {
            if (state.expanded.has(o.id)) state.expanded.delete(o.id); else state.expanded.add(o.id);
            render();
          });
          return btn;
        })()),
      );
      table.appendChild(tr);
      if (state.expanded.has(o.id)) {
        tr.classList.add('row-expanded');
        const td = h('td', { colspan: 13 });
        td.appendChild(renderOrderDetail(a));
        table.appendChild(h('tr', null, td));
      }
    }
    card.appendChild(table);
    if (!analyses.length) card.appendChild(h('div', { class: 'empty-state' }, '当前筛选/钻取下没有订单'));
    el.appendChild(card);
  }

  function renderOrderDetail(a) {
    const o = a.order;
    const box = h('div', { class: 'order-detail' });

    /* 概要条 */
    box.appendChild(h('div', { class: 'cell-sub', style: 'margin-bottom:10px' },
      `订购 ${fmtNum(a.qty)} ${o.unit} ＝ 有效 ${fmtNum(a.effectiveQty)}（取消 ${fmtNum(a.canceledQty)} − 恢复 ${fmtNum(a.restoredQty)}）· ` +
      `已签收 ${fmtNum(a.receivedCounted)}${a.receivedTotal > a.receivedCounted ? `（超收 ${fmtNum(a.receivedTotal - a.receivedCounted)}）` : ''} · ` +
      `订单时区 ${o.tz}`));

    /* 时间线图 */
    const tlCard = h('div', null, h('h3', { style: 'font-size:13px;margin:0 0 6px' }, '承诺时间线'));
    const tlBox = h('div', { class: 'chart' });
    tlCard.appendChild(tlBox);
    tlCard.appendChild(h('div', { class: 'legend' },
      h('span', { class: 'legend-item' }, h('span', { class: 'swatch', style: 'background:' + C.cssVar('--series-1') }), '最初承诺'),
      h('span', { class: 'legend-item' }, h('span', { class: 'swatch', style: 'background:' + C.cssVar('--series-2') }), '改期'),
      h('span', { class: 'legend-item' }, h('span', { class: 'swatch', style: 'background:' + C.cssVar('--muted') }), '发货'),
      h('span', { class: 'legend-item' }, h('span', { class: 'swatch', style: 'background:' + C.cssVar('--good') }), '准时签收（初诺）'),
      h('span', { class: 'legend-item' }, h('span', { class: 'swatch', style: 'background:' + C.cssVar('--critical') }), '迟到签收（初诺）'),
    ));
    box.appendChild(tlCard);
    C.orderTimeline(tlBox, a, state.asOf, M);

    const grid = h('div', { class: 'detail-grid', style: 'margin-top:12px' });

    /* 承诺链 */
    const chainUl = h('ul', { class: 'promise-chain' });
    a.chain.forEach((c, i) => {
      chainUl.appendChild(h('li', null,
        h('span', { class: 'pc-date' }, c.date),
        h('span', { class: 'pc-kind' }, i === 0 ? '最初承诺' : `改期 #${i}`),
        h('span', null, c.reason
          ? h('span', { class: 'pc-reason' }, `${M.REASON_LABEL[c.reason.category] || c.reason.category}${c.reason.detail ? '：' + c.reason.detail : ''}${c.reason.evidence ? `（证据：${c.reason.evidence}）` : ''}`)
          : (i === 0 ? '' : h('span', { class: 'pc-unexplained' }, '无记录原因 → 计入未解释'))),
        h('span', { class: 'cell-sub' }, `登记于 ${M.fmtDateTimeInZone(c.at, o.tz)}`),
      ));
    });
    grid.appendChild(h('div', { class: 'detail-block' }, h('h3', null, '承诺时间线（含记录原因）'), chainUl));

    /* 归因分解 */
    const attrBox = h('div', { class: 'detail-block' }, h('h3', null, '归因分解（相对最初承诺）'));
    let hasDelay = false;
    for (const r of a.receipts) {
      if (r.delayDaysInitial <= 0 || r.countedQty <= 0) continue;
      hasDelay = true;
      attrBox.appendChild(h('div', { style: 'font-size:12px;margin-top:6px' },
        `签收 ${r.dateInTz} · ${fmtNum(r.countedQty)} ${o.unit} · 总延期 ${r.delayDaysInitial} 天`));
      attrBox.appendChild(segmentList(r.segments, r.countedQty, o));
    }
    const asOfDate = M.dateInZone(state.asOf.at, o.tz);
    const remaining = a.effectiveQty - a.receivedCounted;
    if (!a.completing && remaining > 0 && M.dayDiff(a.initial.date, asOfDate) > 0) {
      hasDelay = true;
      attrBox.appendChild(h('div', { style: 'font-size:12px;margin-top:6px' },
        `逾期未交付 ${fmtNum(remaining)} ${o.unit} · 截至 ${asOfDate} 已延期 ${M.dayDiff(a.initial.date, asOfDate)} 天`));
      attrBox.appendChild(segmentList(X.overdueSegments(a, asOfDate), remaining, o));
    }
    if (!hasDelay) attrBox.appendChild(h('div', { class: 'cell-sub' }, '相对最初承诺没有延期，无需归因。'));
    grid.appendChild(attrBox);
    box.appendChild(grid);

    /* 事件表 */
    const evTable = h('table', { class: 'data', style: 'margin-top:12px' },
      h('tr', null, h('th', null, '事件'), h('th', null, '时间（订单时区）'), h('th', { class: 'num' }, '数量'),
        h('th', null, '承诺日期'), h('th', null, '记录原因 / 证据'), h('th', null, '备注'), h('th', null, '')));
    for (const e of o.events) {
      const isBackfilled = e.type === 'receipt' && e.backfilled;
      evTable.appendChild(h('tr', null,
        h('td', null, M.EVENT_TYPE_LABEL[e.type] + (isBackfilled ? '（补录）' : '')),
        h('td', null, M.fmtDateTimeInZone(e.at, o.tz),
          h('div', { class: 'cell-sub' }, `原始记录 ${e.at}`)),
        h('td', { class: 'num' }, e.qty !== undefined ? fmtNum(e.qty) : ''),
        h('td', null, e.promiseDate || ''),
        h('td', null, e.reason
          ? `${M.REASON_LABEL[e.reason.category] || e.reason.category}${e.reason.detail ? '：' + e.reason.detail : ''}${e.reason.evidence ? `（${e.reason.evidence}）` : ''}`
          : ''),
        h('td', null, e.note || ''),
        h('td', null, isBackfilled ? (() => {
          const btn = h('button', { class: 'btn btn-danger' }, '删除');
          btn.addEventListener('click', () => deleteBackfill(o.id, e.uid));
          return btn;
        })() : null),
      ));
    }
    box.appendChild(evTable);

    /* 补录签收 */
    if (a.status !== 'canceled') box.appendChild(renderBackfillForm(a));
    return box;
  }

  function segmentList(segments, qty, o) {
    const ul = h('ul', { class: 'seg-list' });
    for (const s of segments) {
      if (!s.days) continue;
      const key = s.reason ? s.reason.category : M.UNEXPLAINED_KEY;
      ul.appendChild(h('li', null,
        h('span', { class: 'seg-swatch', style: 'background:' + reasonColor(key) }),
        h('span', { class: 'seg-days' }, fmtSigned(s.days) + ' 天'),
        h('span', { class: 'seg-range' }, `${s.from} → ${s.to}`),
        h('span', { class: 'seg-reason' }, s.reason
          ? (M.REASON_LABEL[key] || key) + (s.reason.detail ? '：' + s.reason.detail : '')
          : (s.kind === 'overdue' ? '未解释（逾期未交付，无交付记录）' : '未解释（无记录原因）')),
        s.reason && s.reason.evidence ? h('span', { class: 'seg-evidence' }, `证据：${s.reason.evidence}`) : null,
        h('span', { class: 'cell-sub' }, `${fmtSigned(s.days * qty)} 数量·天`),
      ));
    }
    return ul;
  }

  /* ---------- 补录签收 ---------- */
  const COMMON_TZ = ['Asia/Shanghai', 'Asia/Tokyo', 'Asia/Singapore', 'Europe/Berlin', 'Europe/London',
    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'UTC'];

  function tzOffsetMinutes(date, tz) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(date);
    const g = t => Number((parts.find(p => p.type === t) || {}).value);
    const asUTC = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second'));
    return Math.round((asUTC - date.getTime()) / 60000);
  }
  function zonedLocalToIso(localStr, tz) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(localStr);
    if (!m) return null;
    const [, ys, mos, ds, hs, mms] = m;
    const [y, mo, d, hh, mm] = [ys, mos, ds, hs, mms].map(Number);
    let utcMs = Date.UTC(y, mo - 1, d, hh, mm);
    for (let i = 0; i < 3; i++) {
      const off = tzOffsetMinutes(new Date(utcMs), tz);
      const next = Date.UTC(y, mo - 1, d, hh, mm) - off * 60000;
      if (next === utcMs) break;
      utcMs = next;
    }
    const off = tzOffsetMinutes(new Date(utcMs), tz);
    const sign = off >= 0 ? '+' : '-';
    const ao = Math.abs(off);
    const p2 = n => String(n).padStart(2, '0');
    return `${ys}-${mos}-${ds}T${hs}:${mms}:00${sign}${p2(Math.floor(ao / 60))}:${p2(ao % 60)}`;
  }

  function renderBackfillForm(a) {
    const o = a.order;
    const tzOptions = [...new Set([o.tz, ...COMMON_TZ])];
    const dtInput = h('input', { type: 'datetime-local', required: 'required' });
    const tzSel = h('select', null, ...tzOptions.map(t => h('option', { value: t, ...(t === o.tz ? { selected: 'selected' } : {}) }, t)));
    const qtyInput = h('input', { type: 'number', min: '1', value: String(Math.max(1, a.effectiveQty - a.receivedCounted)), required: 'required', style: 'width:90px' });
    const reasonSel = h('select', null,
      h('option', { value: '' }, '无（计入未解释）'),
      ...M.REASON_CATEGORIES.map(r => h('option', { value: r.key }, r.label)));
    const detailInput = h('input', { type: 'text', placeholder: '原因说明 / 证据（可选）', style: 'width:220px' });
    const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, '补录签收并重算');

    const form = h('form', { class: 'backfill-form', style: 'margin-top:12px' },
      h('label', null, '签收时间', dtInput),
      h('label', null, '时区', tzSel),
      h('label', null, `数量（${o.unit}）`, qtyInput),
      h('label', null, '原因（可选）', reasonSel),
      h('label', null, '说明 / 证据', detailInput),
      submit,
    );
    form.addEventListener('submit', ev => {
      ev.preventDefault();
      const iso = zonedLocalToIso(dtInput.value, tzSel.value);
      const qty = Number(qtyInput.value);
      if (!iso) { toast('签收时间格式无效'); return; }
      if (!(qty > 0)) { toast('数量必须为正数'); return; }
      const rawOrder = state.raw.orders.find(x => x.id === o.id);
      if (!rawOrder) { toast('找不到原始订单数据'); return; }
      const newEv = {
        type: 'receipt', at: iso, qty, backfilled: true,
        uid: 'bf-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
      };
      let warn = '';
      if (reasonSel.value) newEv.reason = { category: reasonSel.value, detail: detailInput.value || '', evidence: '' };
      else if (detailInput.value) {
        newEv.note = detailInput.value; // 仅作备注保留，不构成归因依据
        warn = '未选择原因分类：说明文字已存为备注，仍计未解释';
      }
      rawOrder.events.push(newEv);
      state.expanded.add(o.id);
      loadDataset(state.raw, `补录签收 ${o.id} +${qty}${o.unit}`);
      toastDiff(warn);
    });
    return h('div', null,
      h('h3', { style: 'font-size:13px;margin:12px 0 6px' }, '补录迟到签收（补入后全量重算，差额见"重算记录"）'),
      form);
  }

  function deleteBackfill(orderId, uid) {
    const rawOrder = state.raw.orders.find(x => x.id === orderId);
    if (!rawOrder) return;
    const idx = rawOrder.events.findIndex(e => e.uid === uid);
    if (idx < 0) return;
    rawOrder.events.splice(idx, 1);
    state.expanded.add(orderId);
    loadDataset(state.raw, `删除补录签收 ${orderId}`);
    toastDiff();
  }

  function toastDiff(extra) {
    const n = state.snapshots.length;
    if (n < 2) return;
    const diffs = X.diffSummaries(state.snapshots[n - 2].summary, state.snapshots[n - 1].summary);
    const parts = diffs.filter(d => d.fmt === 'pct' && d.delta !== null && d.delta !== 0)
      .map(d => `${d.metric.replace('准时率 · ', '')} ${fmtPp(d.delta)}`);
    const base = parts.length ? '重算差额：' + parts.join('；') : '已重算：四项准时率均无变化';
    toast(base + (extra ? '。' + extra : ''));
  }

  /* ---------- 对比 ---------- */
  function renderCompare() {
    const el = $('view-compare');
    el.textContent = '';
    const dim = state.compareDim;
    const analyses = filteredAnalyses();
    const groups = X.byGroup(analyses, dim, state.asOf);

    const switcher = h('div', { style: 'margin-bottom:10px' },
      h('span', { style: 'font-size:13px;color:var(--text-secondary);margin-right:8px' }, '对比维度：'),
      ...[['team', '按团队'], ['material', '按物料']].map(([k, label]) =>
        h('button', { class: 'btn' + (dim === k ? ' btn-primary' : ''), onclick: () => { state.compareDim = k; render(); } }, label)));
    el.appendChild(switcher);

    /* 条形图：两组系列（初诺/现诺，数量口径） */
    const card = h('div', { class: 'card' }, h('h2', null, `各${dim === 'team' ? '团队' : '物料'}准时率对比（数量口径）`));
    const dueGroups = groups.filter(g => g.summary.qty.dueEffective > 0);
    if (dueGroups.length) {
      const chartBox = h('div', { class: 'chart' });
      card.appendChild(chartBox);
      card.appendChild(h('div', { class: 'legend' },
        h('span', { class: 'legend-item' }, h('span', { class: 'swatch', style: 'background:' + CALIBER_COLORS.initial() }), '最初承诺'),
        h('span', { class: 'legend-item' }, h('span', { class: 'swatch', style: 'background:' + CALIBER_COLORS.effective() }), '当时有效承诺'),
      ));
      el.appendChild(card);
      const data = {};
      for (const g of dueGroups) {
        data[g.name] = { initial: g.summary.otr.qtyInitial, effective: g.summary.otr.qtyEffective };
      }
      C.groupedBarsH(chartBox, {
        rows: dueGroups.map(g => ({ key: g.name, label: g.name })),
        series: [
          { key: 'initial', label: '最初承诺', color: CALIBER_COLORS.initial() },
          { key: 'effective', label: '当时有效承诺', color: CALIBER_COLORS.effective() },
        ],
        data, xFmt: fmtPct, xMax: 1,
        onDrill: name => {
          if (dim === 'team') state.filters.team = name; else state.filters.material = name;
          state.tab = 'orders'; render();
        },
      });
    } else {
      card.appendChild(h('div', { class: 'empty-state' }, '当前筛选下没有到期数据'));
      el.appendChild(card);
    }

    /* 全指标表 */
    const tbl = h('table', { class: 'data' },
      h('tr', null,
        h('th', null, dim === 'team' ? '团队' : '物料'),
        h('th', { class: 'num' }, '到期单数'), h('th', { class: 'num' }, '到期有效数量'),
        h('th', { class: 'num' }, '数量·初诺'), h('th', { class: 'num' }, '数量·现诺'), h('th', { class: 'num' }, '差额'),
        h('th', { class: 'num' }, '订单·初诺'), h('th', { class: 'num' }, '订单·现诺'),
        h('th', { class: 'num' }, '逾期未交付'), h('th', { class: 'num' }, '未解释占比')));
    for (const g of groups) {
      const s = g.summary;
      const att = X.attribute(g.analyses, state.asOf);
      const tot = att.reduce((sum, r) => sum + r.qtyDays, 0);
      const unx = att.find(r => r.key === M.UNEXPLAINED_KEY);
      const tr = h('tr', { class: 'clickable' },
        h('td', null, g.name),
        h('td', { class: 'num' }, fmtNum(s.orders.due)),
        h('td', { class: 'num' }, fmtNum(s.qty.dueEffective)),
        h('td', { class: 'num' }, fmtPct(s.otr.qtyInitial)),
        h('td', { class: 'num' }, fmtPct(s.otr.qtyEffective)),
        h('td', { class: 'num' }, fmtPp(s.otr.qtyEffective !== null && s.otr.qtyInitial !== null ? s.otr.qtyEffective - s.otr.qtyInitial : null)),
        h('td', { class: 'num' }, fmtPct(s.otr.orderInitial)),
        h('td', { class: 'num' }, fmtPct(s.otr.orderEffective)),
        h('td', { class: 'num' }, fmtNum(s.qty.overdueOpen)),
        h('td', { class: 'num' }, tot ? fmtPct((unx ? unx.qtyDays : 0) / tot) : '—'));
      tr.addEventListener('click', () => {
        if (dim === 'team') state.filters.team = g.name; else state.filters.material = g.name;
        state.tab = 'orders'; render();
      });
      tbl.appendChild(tr);
    }
    el.appendChild(h('div', { class: 'card' }, h('h2', null, '全指标对照表', h('span', { class: 'h2-note' }, '点击行钻取到该组订单')), tbl));
  }

  /* ---------- 归因 ---------- */
  function renderAttribution() {
    const el = $('view-attribution');
    el.textContent = '';
    const analyses = filteredAnalyses();
    const att = X.attribute(analyses, state.asOf);
    const total = att.reduce((s, r) => s + r.qtyDays, 0);
    const posTotal = att.reduce((s, r) => s + Math.max(0, r.qtyDays), 0);

    /* 分段条 */
    const card = h('div', { class: 'card' },
      h('h2', null, '延期归因构成（数量·天，相对最初承诺）',
        h('span', { class: 'h2-note' }, '仅使用记录中的原因；无记录依据的部分一律"未解释"，不自动猜测')));
    if (posTotal > 0) {
      const order = [...M.REASON_CATEGORIES.map(r => r.key), M.UNEXPLAINED_KEY];
      const parts = order
        .map(k => att.find(r => r.key === k))
        .filter(Boolean)
        .map(r => ({
          key: r.key, label: r.label, value: r.qtyDays,
          color: reasonColor(r.key),
          darkText: r.key === 'capacity_shortage',
        }));
      const barBox = h('div');
      card.appendChild(barBox);
      card.appendChild(h('div', { class: 'legend' },
        ...parts.map(p => h('span', { class: 'legend-item' },
          h('span', { class: 'swatch', style: 'background:' + p.color }), p.label))));
      const negDetails = att.flatMap(r => r.details.filter(d => d.days * d.qty < 0));
      if (negDetails.length) {
        const negSum = negDetails.reduce((sum, d) => sum + d.days * d.qty, 0);
        card.appendChild(h('div', { class: 'caliber-note' },
          `注：存在提前交付的负向段（合计 ${fmtNum(negSum)} 数量·天），分段条仅展示正向延期，表格与明细中为带符号值。`));
      }
      el.appendChild(card);
      C.segmentedBar(barBox, parts, {
        fmt: fmtNum,
        onDrill: key => drillAttribution(key, att),
      });
    } else {
      card.appendChild(h('div', { class: 'empty-state' }, '当前筛选下没有延期需要归因'));
      el.appendChild(card);
    }

    /* 分类表 */
    const tbl = h('table', { class: 'data' },
      h('tr', null, h('th', null, '原因分类'), h('th', { class: 'num' }, '延期数量·天'),
        h('th', { class: 'num' }, '占比'), h('th', { class: 'num' }, '涉及订单'), h('th', null, '')));
    for (const r of att) {
      const isUnx = r.key === M.UNEXPLAINED_KEY;
      const tr = h('tr', isUnx ? { class: 'row-warn' } : {},
        h('td', null, h('span', { class: 'status-badge' },
          h('span', { class: 'dot', style: 'background:' + reasonColor(r.key) }),
          r.label + (isUnx ? '（无记录依据）' : ''))),
        h('td', { class: 'num' }, fmtNum(r.qtyDays)),
        h('td', { class: 'num' }, total ? fmtPct(r.qtyDays / total) : '—'),
        h('td', { class: 'num' }, fmtNum(r.orderCount)),
        h('td', null, (() => {
          const btn = h('button', { class: 'btn' }, '钻取订单');
          btn.addEventListener('click', () => drillAttribution(r.key, att));
          return btn;
        })()));
      tbl.appendChild(tr);
    }
    el.appendChild(h('div', { class: 'card' }, h('h2', null, '归因分类表'), tbl));

    /* 明细表 */
    const details = att.flatMap(r => r.details.map(d => ({ ...d, catKey: r.key, catLabel: r.label })))
      .sort((a, b) => Math.abs(b.days * b.qty) - Math.abs(a.days * a.qty));
    const dtbl = h('table', { class: 'data' },
      h('tr', null, h('th', null, '订单'), h('th', null, '团队'), h('th', null, '物料'),
        h('th', null, '环节'), h('th', null, '区间'), h('th', { class: 'num' }, '数量'),
        h('th', { class: 'num' }, '天数'), h('th', { class: 'num' }, '数量·天'), h('th', null, '归因')));
    for (const d of details.slice(0, 100)) {
      dtbl.appendChild(h('tr', null,
        h('td', null, d.orderId),
        h('td', null, d.team),
        h('td', null, d.material),
        h('td', null, d.context),
        h('td', null, `${d.from} → ${d.to}`),
        h('td', { class: 'num' }, fmtNum(d.qty)),
        h('td', { class: 'num' }, fmtSigned(d.days)),
        h('td', { class: 'num' }, fmtSigned(d.days * d.qty)),
        h('td', null, h('span', { class: 'status-badge' },
          h('span', { class: 'dot', style: 'background:' + reasonColor(d.catKey) }), d.catLabel)),
      ));
    }
    el.appendChild(h('div', { class: 'card' },
      h('h2', null, `归因明细（${details.length} 条）`, h('span', { class: 'h2-note' }, '每一段延期及其依据；可随"导出 → 明细 CSV"一并导出口径结果')),
      dtbl));
  }

  function drillAttribution(key, att) {
    const row = att.find(r => r.key === key);
    if (!row) return;
    state.drill = { label: `归因：${row.label}`, ids: new Set(row.details.map(d => d.orderId)) };
    state.tab = 'orders';
    render();
  }

  /* ---------- 重算记录 ---------- */
  function renderLog() {
    const el = $('view-log');
    el.textContent = '';
    el.appendChild(h('div', { class: 'card' },
      h('h2', null, '重算记录', h('span', { class: 'h2-note' }, '每次导入 / 补录 / 删除后的全量重算快照，差额 = 与上一次快照相比'))));
    const list = h('div');
    const snaps = state.snapshots;
    for (let i = snaps.length - 1; i >= 0; i--) {
      const cur = snaps[i];
      const prev = i > 0 ? snaps[i - 1] : null;
      const diffs = prev ? X.diffSummaries(prev.summary, cur.summary) : null;
      const chips = h('span', { style: 'display:inline-flex;gap:6px;flex-wrap:wrap' });
      if (diffs) {
        for (const d of diffs.filter(x => x.fmt === 'pct')) {
          const cls = d.delta === null || d.delta === 0 ? 'zero' : (d.delta > 0 ? 'pos' : 'neg');
          chips.appendChild(h('span', { class: 'delta-chip ' + cls },
            `${d.metric.replace('准时率 · ', '')} ${d.delta === null ? '—' : fmtPp(d.delta)}`));
        }
        const od = diffs.find(x => x.metric === '逾期未交付数量');
        if (od && od.delta !== null) {
          chips.appendChild(h('span', { class: 'delta-chip ' + (od.delta === 0 ? 'zero' : od.delta > 0 ? 'neg' : 'pos') },
            `逾期未交付 ${fmtSigned(od.delta)}`));
        }
      } else {
        chips.appendChild(h('span', { class: 'delta-chip zero' }, '基线快照'));
      }
      const head = h('div', { class: 'snap-head' },
        h('span', { class: 'snap-label' }, cur.label),
        h('span', { class: 'snap-time' }, new Date(cur.at).toLocaleString('zh-CN')),
        chips);
      const box = h('div', { class: 'snapshot' }, head);
      if (diffs) {
        const detail = h('div', { style: 'display:none;margin-top:8px' });
        const t = h('table', { class: 'data' },
          h('tr', null, h('th', null, '指标'), h('th', { class: 'num' }, '上次'), h('th', { class: 'num' }, '本次'), h('th', { class: 'num' }, '差额')));
        for (const d of diffs) {
          const fmt = d.fmt === 'pct' ? fmtPct : fmtNum;
          const fd = d.fmt === 'pct' ? fmtPp : fmtSigned;
          t.appendChild(h('tr', null,
            h('td', null, d.metric),
            h('td', { class: 'num' }, fmt(d.a)),
            h('td', { class: 'num' }, fmt(d.b)),
            h('td', { class: 'num' }, d.delta === null ? '—' : fd(d.delta))));
        }
        detail.appendChild(t);
        head.style.cursor = 'pointer';
        head.addEventListener('click', () => {
          detail.style.display = detail.style.display === 'none' ? 'block' : 'none';
        });
        head.appendChild(h('span', { class: 'cell-sub' }, '（点击展开全部差额）'));
        box.appendChild(detail);
      }
      list.appendChild(box);
    }
    el.appendChild(list);
  }

  /* ---------- 导出 ---------- */
  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const a = h('a', { href: URL.createObjectURL(blob), download: filename });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 100);
  }
  function csvCell(v) {
    const s = String(v === null || v === undefined ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(rows) {
    return '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\n');
  }
  const ON_TIME_TXT = { true: '准时', false: '迟到' };

  function exportDetail() {
    const analyses = filteredAnalyses();
    const rows = [[
      '订单', '客户', '团队', '物料', '订购数量', '取消', '恢复', '有效数量', '已签收', '超收',
      '最初承诺', '现承诺', '改期次数', '状态', '订单口径·初诺', '订单口径·现诺',
      '延期数量·天', '其中未解释', '单位', '订单时区',
    ]];
    for (const a of analyses) {
      const o = a.order;
      const totals = orderDelayTotals(a);
      const total = [...totals.values()].reduce((x, y) => x + y, 0);
      const ot = v => a.status === 'canceled' ? '不计入' : (v === null ? '未交齐' : ON_TIME_TXT[v]);
      rows.push([
        o.id, o.customer, o.team, o.material, a.qty, a.canceledQty, a.restoredQty, a.effectiveQty,
        a.receivedCounted, a.receivedTotal - a.receivedCounted,
        a.initial.date, a.finalPromiseDate, a.chain.length - 1, STATUS_META[a.status].label,
        ot(a.onTimeOrderInitial), ot(a.onTimeOrderEffective),
        total, totals.get(M.UNEXPLAINED_KEY) || 0, o.unit, o.tz,
      ]);
    }
    download('交付明细.csv', toCsv(rows), 'text/csv;charset=utf-8');
    toast(`已导出 ${analyses.length} 单明细（当前筛选/钻取范围）`);
  }

  function exportMetrics() {
    const s = X.summarize(filteredAnalyses(), state.asOf);
    const rows = [
      ['指标', '口径', '数值'],
      ['准时率', '数量·最初承诺', fmtPct(s.otr.qtyInitial)],
      ['准时率', '数量·当时有效承诺', fmtPct(s.otr.qtyEffective)],
      ['准时率', '订单·最初承诺', fmtPct(s.otr.orderInitial)],
      ['准时率', '订单·当时有效承诺', fmtPct(s.otr.orderEffective)],
      ['差额（掩盖幅度）', '数量口径', fmtPp(s.otr.qtyEffective !== null && s.otr.qtyInitial !== null ? s.otr.qtyEffective - s.otr.qtyInitial : null)],
      ['差额（掩盖幅度）', '订单口径', fmtPp(s.otr.orderEffective !== null && s.otr.orderInitial !== null ? s.otr.orderEffective - s.otr.orderInitial : null)],
      ['到期订单数', '', s.orders.due],
      ['到期有效数量', '', s.qty.dueEffective],
      ['按时签收数量', '最初承诺', s.qty.onTimeInitial],
      ['按时签收数量', '当时有效承诺', s.qty.onTimeEffective],
      ['逾期未交付数量', '', s.qty.overdueOpen],
      [],
      ['归因分类', '延期数量·天', '涉及订单数'],
    ];
    for (const r of X.attribute(filteredAnalyses(), state.asOf)) {
      rows.push([r.label, r.qtyDays, r.orderCount]);
    }
    rows.push([]);
    rows.push(['分组（团队）', '数量·初诺', '数量·现诺', '订单·初诺', '订单·现诺']);
    for (const g of X.byGroup(filteredAnalyses(), 'team', state.asOf)) {
      rows.push([g.name, fmtPct(g.summary.otr.qtyInitial), fmtPct(g.summary.otr.qtyEffective),
        fmtPct(g.summary.otr.orderInitial), fmtPct(g.summary.otr.orderEffective)]);
    }
    download('交付指标.csv', toCsv(rows), 'text/csv;charset=utf-8');
    toast('已导出指标汇总（当前筛选/钻取范围）');
  }

  function exportJson() {
    download('交付数据.json', JSON.stringify(state.raw, null, 2), 'application/json');
    toast('已导出全量数据 JSON（含补录记录，可直接再导入）');
  }

  /* ---------- 事件绑定 ---------- */
  function bind() {
    $('btn-import').addEventListener('click', () => $('file-input').click());
    $('file-input').addEventListener('change', ev => {
      const f = ev.target.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const raw = JSON.parse(reader.result);
          state.drill = null;
          loadDataset(raw, `导入 ${f.name}`);
          toast(`已导入 ${state.dataset.orders.length} 单` + (state.dataset.warnings.length ? `，${state.dataset.warnings.length} 条校验警告` : ''));
        } catch (e) {
          toast('导入失败：JSON 解析错误 — ' + e.message);
        }
        ev.target.value = '';
      };
      reader.readAsText(f);
    });
    $('btn-sample').addEventListener('click', () => {
      state.drill = null;
      loadDataset(JSON.parse(JSON.stringify(OD_SAMPLE_DATA)), '载入示例数据');
      toast('已载入虚构示例数据');
    });
    $('btn-export-detail').addEventListener('click', exportDetail);
    $('btn-export-metrics').addEventListener('click', exportMetrics);
    $('btn-export-json').addEventListener('click', exportJson);
    $('btn-theme').addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme');
      document.documentElement.setAttribute('data-theme', cur === 'dark' ? 'light' : 'dark');
      render();
    });
    $('filter-team').addEventListener('change', ev => { state.filters.team = ev.target.value; render(); });
    $('filter-material').addEventListener('change', ev => { state.filters.material = ev.target.value; render(); });
    $('filter-status').addEventListener('change', ev => { state.filters.status = ev.target.value; render(); });
    document.querySelectorAll('.tab').forEach(b =>
      b.addEventListener('click', () => { state.tab = b.dataset.tab; render(); }));
    $('warnings-badge').addEventListener('click', () => {
      const ul = $('warnings-list');
      ul.textContent = '';
      for (const w of state.dataset.warnings) ul.appendChild(h('li', null, w));
      $('warnings-panel').hidden = false;
    });
    $('warnings-close').addEventListener('click', () => { $('warnings-panel').hidden = true; });
    $('warnings-panel').addEventListener('click', ev => {
      if (ev.target === $('warnings-panel')) $('warnings-panel').hidden = true;
    });
  }

  /* ---------- 启动 ---------- */
  bind();
  loadDataset(JSON.parse(JSON.stringify(OD_SAMPLE_DATA)), '初始加载（示例数据）');
})();
