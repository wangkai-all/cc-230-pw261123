/* ============================================================================
 * metrics.js — 交付指标计算引擎（纯函数，无 DOM 依赖）
 *
 * 口径定义（与页面"口径说明"一致）：
 *  - 准时判定：签收时间换算到【订单时区】后的日历日期 ≤ 承诺日期。
 *  - 最初承诺口径：与第一张承诺单的日期比较。
 *  - 当时有效承诺口径：与【该签收时刻已生效】的最后一次承诺比较
 *    （晚于签收的改期不算数，避免用最后一次改期掩盖原始延期）。
 *  - 数量口径：按有效数量加权；订单口径：一单全部有效数量按时签收才算准时。
 *  - 有效数量 = 订购 − 取消 + 恢复；全部取消的订单不计入分母；
 *    未到期（最终承诺日 ≥ 数据截止日 且未交齐）的订单不计入分母。
 *  - 归因：把"签收日 − 最初承诺日"的总延期天数拆成若干段——
 *    每次改期的位移归因于该改期记录的原因；最后一段（签收日 − 当时承诺日）
 *    归因于签收/发货记录的原因。任何一段没有记录依据都计为"未解释"，
 *    绝不自动猜测。各段之和恒等于总延期（可负，表示提前）。
 * ========================================================================== */
const ODMetrics = (() => {
  'use strict';
  const M = (typeof module !== 'undefined') ? require('./model.js') : ODModel;

  /* ---- 单订单分析 ---- */
  function analyzeOrder(o) {
    const evs = o.events;
    const chain = evs
      .filter(e => e.type === 'promise' || e.type === 'reschedule')
      .map((e, i) => ({
        ts: e.ts, at: e.at, date: e.promiseDate,
        reason: e.reason || null, note: e.note || '',
        kind: i === 0 ? 'initial' : 'reschedule',
      }));
    const initial = chain[0];
    const finalPromiseDate = chain[chain.length - 1].date;

    let canceled = 0, restored = 0, shipped = 0;
    const receiptEvs = [];
    for (const e of evs) {
      if (e.type === 'cancel') canceled += e.qty;
      else if (e.type === 'restore') restored += e.qty;
      else if (e.type === 'shipment') shipped += e.qty;
      else if (e.type === 'receipt') receiptEvs.push(e);
    }
    const netCanceled = Math.max(0, canceled - restored);
    const effectiveQty = Math.max(0, o.qty - netCanceled);

    /* 签收分析：逐张签收单判定两种口径，并做归因分解 */
    let cum = 0;
    const receipts = receiptEvs.map(r => {
      const dateInTz = M.dateInZone(r.at, o.tz);
      const chainSoFar = chain.filter(c => c.ts <= r.ts);
      const effDate = chainSoFar.length ? chainSoFar[chainSoFar.length - 1].date : initial.date;
      const dInit = M.dayDiff(initial.date, dateInTz);   // >0 表示相对最初承诺晚
      const dEff = M.dayDiff(effDate, dateInTz);         // >0 表示相对当时有效承诺晚

      // 归因分解：相对最初承诺的总延期 = Σ改期位移 + 签收残差（望远镜求和，恒等）
      const segments = [];
      for (let i = 1; i < chainSoFar.length; i++) {
        segments.push({
          kind: 'reschedule',
          days: M.dayDiff(chainSoFar[i - 1].date, chainSoFar[i].date),
          from: chainSoFar[i - 1].date, to: chainSoFar[i].date,
          reason: chainSoFar[i].reason, at: chainSoFar[i].at,
        });
      }
      const lastPromiseDate = chainSoFar.length ? chainSoFar[chainSoFar.length - 1].date : initial.date;
      let delReason = r.reason || null;
      if (!delReason && r.shipId) {
        const sh = evs.find(e => e.type === 'shipment' && e.shipId === r.shipId && e.ts <= r.ts);
        if (sh && sh.reason) delReason = sh.reason;
      }
      segments.push({
        kind: 'delivery',
        days: M.dayDiff(lastPromiseDate, dateInTz),
        from: lastPromiseDate, to: dateInTz,
        reason: delReason, at: r.at,
      });

      const start = cum; cum += r.qty;
      const countedQty = Math.max(0, Math.min(cum, effectiveQty) - Math.min(start, effectiveQty));
      return {
        ref: r, at: r.at, ts: r.ts, qty: r.qty, countedQty, overQty: r.qty - countedQty,
        dateInTz, effDate,
        delayDaysInitial: Math.max(0, dInit), lateDaysEffective: Math.max(0, dEff),
        onTimeInitial: dInit <= 0, onTimeEffective: dEff <= 0,
        segments, backfilled: !!r.backfilled,
      };
    });

    /* 交齐点：累计计入有效数量的签收达到有效数量的那张签收单 */
    let cumCounted = 0, completing = null;
    for (const r of receipts) {
      cumCounted += r.countedQty;
      if (!completing && effectiveQty > 0 && cumCounted >= effectiveQty) completing = r;
    }
    const receivedCounted = receipts.reduce((s, r) => s + r.countedQty, 0);
    const receivedTotal = receipts.reduce((s, r) => s + r.qty, 0);

    const status =
      effectiveQty === 0 ? 'canceled' :
      completing ? 'fulfilled' :
      receivedCounted > 0 ? 'partial' : 'open';

    return {
      order: o, chain, initial, finalPromiseDate,
      qty: o.qty, canceledQty: canceled, restoredQty: restored,
      netCanceled, effectiveQty, shippedQty: shipped,
      receipts, receivedCounted, receivedTotal,
      completing, status,
      onTimeOrderInitial: completing ? completing.onTimeInitial : null,
      onTimeOrderEffective: completing ? completing.onTimeEffective : null,
    };
  }

  /* 数据截止时间：优先 meta.asOf，否则取全数据最新事件时刻 */
  function datasetAsOf(meta, orders) {
    if (meta && meta.asOf && M.tsOf(meta.asOf) !== null) return { ts: M.tsOf(meta.asOf), at: meta.asOf, inferred: false };
    let max = null, at = null;
    for (const o of orders) for (const e of o.events) {
      if (max === null || e.ts > max) { max = e.ts; at = e.at; }
    }
    return { ts: max, at, inferred: true };
  }

  /* 逾期未交付部分的归因分解（相对最初承诺，截至数据截止日） */
  function overdueSegments(a, asOfDateInTz) {
    const segs = [];
    for (let i = 1; i < a.chain.length; i++) {
      segs.push({
        kind: 'reschedule',
        days: M.dayDiff(a.chain[i - 1].date, a.chain[i].date),
        from: a.chain[i - 1].date, to: a.chain[i].date,
        reason: a.chain[i].reason, at: a.chain[i].at,
      });
    }
    segs.push({
      kind: 'overdue',
      days: M.dayDiff(a.finalPromiseDate, asOfDateInTz),
      from: a.finalPromiseDate, to: asOfDateInTz,
      reason: null, // 逾期未交付没有交付记录，残差一律未解释
    });
    return segs;
  }

  /* ---- 汇总：传入 analyzeOrder 结果数组 ---- */
  function summarize(analyses, asOf) {
    const S = {
      asOf,
      orders: { total: analyses.length, due: 0, notDue: 0, canceled: 0, fulfilled: 0, partial: 0, open: 0 },
      qty: {
        ordered: 0, effective: 0, dueEffective: 0, received: 0,
        onTimeInitial: 0, onTimeEffective: 0, lateInitial: 0, overdueOpen: 0, canceled: 0,
      },
      otr: { qtyInitial: null, qtyEffective: null, orderInitial: null, orderEffective: null },
      orderOnTime: { initial: 0, effective: 0 },
    };
    for (const a of analyses) {
      S.qty.ordered += a.qty;
      S.qty.effective += a.effectiveQty;
      S.qty.canceled += a.netCanceled;
      S.qty.received += a.receivedCounted;
      S.orders[a.status === 'canceled' ? 'canceled' : a.status] =
        (S.orders[a.status === 'canceled' ? 'canceled' : a.status] || 0) + 1;

      if (a.status === 'canceled') continue;
      const asOfDate = M.dateInZone(asOf.at, a.order.tz);
      const due = a.completing || M.dayDiff(a.finalPromiseDate, asOfDate) > 0;
      if (!due) { S.orders.notDue++; continue; }
      S.orders.due++;
      S.qty.dueEffective += a.effectiveQty;

      for (const r of a.receipts) {
        if (r.onTimeInitial) S.qty.onTimeInitial += r.countedQty;
        if (r.onTimeEffective) S.qty.onTimeEffective += r.countedQty;
        if (!r.onTimeInitial) S.qty.lateInitial += r.countedQty;
      }
      if (!a.completing) S.qty.overdueOpen += (a.effectiveQty - a.receivedCounted);
      if (a.onTimeOrderInitial) S.orderOnTime.initial++;
      if (a.onTimeOrderEffective) S.orderOnTime.effective++;
    }
    const q = S.qty, d = S.orders.due;
    S.otr.qtyInitial = q.dueEffective ? q.onTimeInitial / q.dueEffective : null;
    S.otr.qtyEffective = q.dueEffective ? q.onTimeEffective / q.dueEffective : null;
    S.otr.orderInitial = d ? S.orderOnTime.initial / d : null;
    S.otr.orderEffective = d ? S.orderOnTime.effective / d : null;
    return S;
  }

  /* ---- 归因汇总：延期数量·天 按原因分类（含逾期未交付部分） ---- */
  function attribute(analyses, asOf) {
    const cats = new Map(); // key -> {key,label,qtyDays,orders:Set,details:[]}
    const ensure = key => {
      if (!cats.has(key)) cats.set(key, {
        key, label: key === M.UNEXPLAINED_KEY ? M.UNEXPLAINED_LABEL : (M.REASON_LABEL[key] || key),
        qtyDays: 0, orders: new Set(), details: [],
      });
      return cats.get(key);
    };
    const push = (a, seg, qty, context) => {
      if (!seg.days || qty <= 0) return;
      const key = seg.reason ? seg.reason.category : M.UNEXPLAINED_KEY;
      const c = ensure(key);
      c.qtyDays += seg.days * qty;
      c.orders.add(a.order.id);
      c.details.push({
        orderId: a.order.id, team: a.order.team, material: a.order.material,
        qty, days: seg.days, kind: seg.kind, from: seg.from, to: seg.to,
        reason: seg.reason || null, context,
      });
    };

    for (const a of analyses) {
      if (a.status === 'canceled') continue;
      // 已交付但相对最初承诺迟到的签收
      for (const r of a.receipts) {
        if (r.delayDaysInitial > 0 && r.countedQty > 0) {
          for (const seg of r.segments) push(a, seg, r.countedQty, `签收 ${r.dateInTz}`);
        }
      }
      // 到期仍未交齐的数量（延期仍在累积，残差无交付记录 → 未解释）
      const asOfDate = M.dateInZone(asOf.at, a.order.tz);
      const remaining = a.effectiveQty - a.receivedCounted;
      if (!a.completing && remaining > 0 && M.dayDiff(a.initial.date, asOfDate) > 0) {
        for (const seg of overdueSegments(a, asOfDate)) push(a, seg, remaining, `逾期未交付（截至 ${asOfDate}）`);
      }
    }
    const rows = [...cats.values()].map(c => ({
      key: c.key, label: c.label, qtyDays: c.qtyDays,
      orderCount: c.orders.size, details: c.details,
    }));
    rows.sort((x, y) => Math.abs(y.qtyDays) - Math.abs(x.qtyDays));
    return rows;
  }

  /* ---- 按月签收准时率（数量口径，两套承诺） ---- */
  function monthly(analyses) {
    const buckets = new Map();
    for (const a of analyses) {
      for (const r of a.receipts) {
        if (r.countedQty <= 0) continue;
        const key = r.dateInTz.slice(0, 7);
        if (!buckets.has(key)) buckets.set(key, { month: key, total: 0, onTimeInitial: 0, onTimeEffective: 0 });
        const b = buckets.get(key);
        b.total += r.countedQty;
        if (r.onTimeInitial) b.onTimeInitial += r.countedQty;
        if (r.onTimeEffective) b.onTimeEffective += r.countedQty;
      }
    }
    return [...buckets.values()].sort((x, y) => x.month < y.month ? -1 : 1);
  }

  /* ---- 分组对比（团队 / 物料） ---- */
  function byGroup(analyses, key, asOf) {
    const groups = new Map();
    for (const a of analyses) {
      const g = a.order[key] || '（未填）';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(a);
    }
    return [...groups.entries()]
      .map(([name, list]) => ({ name, summary: summarize(list, asOf), analyses: list }))
      .sort((x, y) => y.summary.qty.dueEffective - x.summary.qty.dueEffective);
  }

  /* ---- 两次重算快照的差异（口径/数据变化带来的差额） ---- */
  function diffSummaries(a, b) {
    const rows = [];
    const pct = v => v === null || v === undefined ? null : v;
    const add = (label, va, vb, fmt) => {
      const d = (va === null || vb === null || va === undefined || vb === undefined) ? null : vb - va;
      rows.push({ metric: label, a: va, b: vb, delta: d, fmt: fmt || 'num' });
    };
    add('准时率 · 数量口径 · 最初承诺', pct(a.otr.qtyInitial), pct(b.otr.qtyInitial), 'pct');
    add('准时率 · 数量口径 · 当时有效承诺', pct(a.otr.qtyEffective), pct(b.otr.qtyEffective), 'pct');
    add('准时率 · 订单口径 · 最初承诺', pct(a.otr.orderInitial), pct(b.otr.orderInitial), 'pct');
    add('准时率 · 订单口径 · 当时有效承诺', pct(a.otr.orderEffective), pct(b.otr.orderEffective), 'pct');
    add('到期订单数', a.orders.due, b.orders.due);
    add('到期有效数量', a.qty.dueEffective, b.qty.dueEffective);
    add('按时签收数量（最初承诺）', a.qty.onTimeInitial, b.qty.onTimeInitial);
    add('按时签收数量（当时有效承诺）', a.qty.onTimeEffective, b.qty.onTimeEffective);
    add('逾期未交付数量', a.qty.overdueOpen, b.qty.overdueOpen);
    add('已签收数量', a.qty.received, b.qty.received);
    return rows;
  }

  return { analyzeOrder, datasetAsOf, summarize, attribute, monthly, byGroup, diffSummaries, overdueSegments };
})();
if (typeof module !== 'undefined') module.exports = ODMetrics;
