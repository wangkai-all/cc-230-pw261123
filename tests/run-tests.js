/* tests/run-tests.js — 计算引擎单元测试：node tests/run-tests.js */
'use strict';
const M = require('../js/model.js');
const X = require('../js/metrics.js');

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`  ok  ${name}`); }
  else { failed++; console.error(`FAIL  ${name}\n      期望 ${e}\n      实际 ${a}`); }
}
function ok(cond, name) { eq(!!cond, true, name); }

function mkOrder(id, events, extra = {}) {
  const raw = { orders: [{ id, customer: 'C', team: 'T', material: 'M', qty: 100, tz: 'Asia/Shanghai', events, ...extra }] };
  const ds = M.normalizeDataset(raw);
  if (ds.warnings.length) console.log(`  (warnings ${id}: ${ds.warnings.join('；')})`);
  return ds.orders[0];
}
const asOf = { ts: Date.parse('2026-04-05T18:00:00+08:00'), at: '2026-04-05T18:00:00+08:00', inferred: false };

/* 1. 归因分解望远镜恒等：各段之和 = 总延期天数 */
{
  const o = mkOrder('T1', [
    { type: 'promise', at: '2026-01-01T09:00:00+08:00', promiseDate: '2026-02-01' },
    { type: 'reschedule', at: '2026-01-10T09:00:00+08:00', promiseDate: '2026-02-05', reason: { category: 'customer_reschedule' } },
    { type: 'reschedule', at: '2026-01-20T09:00:00+08:00', promiseDate: '2026-02-12', reason: { category: 'material_shortage' } },
    { type: 'receipt', at: '2026-02-15T10:00:00+08:00', qty: 100 },
  ]);
  const a = X.analyzeOrder(o);
  const r = a.receipts[0];
  eq(r.delayDaysInitial, 14, 'T1 总延期 14 天');
  eq(r.segments.reduce((s, g) => s + g.days, 0), 14, 'T1 分段之和 = 总延期');
  eq(r.segments.map(s => s.days), [4, 7, 3], 'T1 分段 4+7+3');
  eq(r.segments[2].reason, null, 'T1 残差无记录 → 未解释');
  eq(r.onTimeInitial, false, 'T1 初诺口径迟到');
  eq(r.onTimeEffective, false, 'T1 现诺口径迟到（晚 3 天）');
}

/* 2. 当时有效承诺：签收之后才登记的改期不得生效 */
{
  const o = mkOrder('T2', [
    { type: 'promise', at: '2026-01-01T09:00:00+08:00', promiseDate: '2026-02-01' },
    { type: 'receipt', at: '2026-02-03T10:00:00+08:00', qty: 100 },
    { type: 'reschedule', at: '2026-02-04T09:00:00+08:00', promiseDate: '2026-02-10', reason: { category: 'other_recorded' } },
  ]);
  const a = X.analyzeOrder(o);
  eq(a.receipts[0].onTimeEffective, false, 'T2 签收后改期不影响当时有效承诺');
  eq(a.receipts[0].effDate, '2026-02-01', 'T2 签收时有效承诺仍是最初承诺');
}

/* 3. 取消后恢复：有效数量 = 订购 − 取消 + 恢复 */
{
  const o = mkOrder('T3', [
    { type: 'promise', at: '2026-01-01T09:00:00+08:00', promiseDate: '2026-02-01' },
    { type: 'cancel', at: '2026-01-10T09:00:00+08:00', qty: 40 },
    { type: 'restore', at: '2026-01-15T09:00:00+08:00', qty: 40 },
    { type: 'receipt', at: '2026-02-01T10:00:00+08:00', qty: 100 },
  ]);
  const a = X.analyzeOrder(o);
  eq(a.effectiveQty, 100, 'T3 取消后恢复，有效数量回到 100');
  eq(a.status, 'fulfilled', 'T3 已交齐');
}

/* 4. 跨时区签收：按订单时区的日历日期判定 */
{
  const o = mkOrder('T4', [
    { type: 'promise', at: '2026-01-01T09:00:00+08:00', promiseDate: '2026-02-10' },
    { type: 'receipt', at: '2026-02-10T17:30:00-08:00', qty: 100 }, // 北京 2/11 09:30
  ]);
  const a = X.analyzeOrder(o);
  eq(a.receipts[0].dateInTz, '2026-02-11', 'T4 洛杉矶 2/10 17:30 = 上海 2/11');
  eq(a.receipts[0].onTimeInitial, false, 'T4 按订单时区判定为迟到 1 天');

  const o2 = mkOrder('T4b', [
    { type: 'promise', at: '2026-01-01T08:00:00-08:00', promiseDate: '2026-02-12' },
    { type: 'receipt', at: '2026-02-12T23:30:00+08:00', qty: 100 }, // 洛杉矶 2/12 07:30
  ], { tz: 'America/Los_Angeles' });
  const a2 = X.analyzeOrder(o2);
  eq(a2.receipts[0].dateInTz, '2026-02-12', 'T4b 北京 2/12 23:30 = 洛杉矶 2/12');
  eq(a2.receipts[0].onTimeInitial, true, 'T4b 按订单时区判定为准时');
}

/* 5. 拆单：母单全取消不计入分母，子单独立考核 */
{
  const parent = mkOrder('T5', [
    { type: 'promise', at: '2026-01-01T09:00:00+08:00', promiseDate: '2026-02-20' },
    { type: 'cancel', at: '2026-02-05T09:00:00+08:00', qty: 300, reason: { category: 'other_recorded' } },
  ], { qty: 300, splitInto: ['T5A'] });
  const child = mkOrder('T5A', [
    { type: 'promise', at: '2026-02-05T15:30:00+08:00', promiseDate: '2026-02-20' },
    { type: 'receipt', at: '2026-02-21T10:00:00+08:00', qty: 150 },
  ], { qty: 150, splitFrom: 'T5' });
  const aP = X.analyzeOrder(parent), aC = X.analyzeOrder(child);
  eq(aP.status, 'canceled', 'T5 母单状态=已取消');
  eq(aP.effectiveQty, 0, 'T5 母单有效数量 0');
  const s = X.summarize([aP, aC], asOf);
  eq(s.orders.due, 1, 'T5 只有子单进入分母');
  eq(s.qty.dueEffective, 150, 'T5 到期有效数量 150');
  eq(s.otr.qtyInitial, 0, 'T5 子单迟到 → 初诺口径 0');
}

/* 6. 订单口径：交齐那张签收单决定整单是否准时（分批场景） */
{
  const o = mkOrder('T6', [
    { type: 'promise', at: '2026-01-01T09:00:00+08:00', promiseDate: '2026-02-01' },
    { type: 'receipt', at: '2026-01-30T10:00:00+08:00', qty: 60 },
    { type: 'receipt', at: '2026-02-03T10:00:00+08:00', qty: 40 },
  ]);
  const a = X.analyzeOrder(o);
  eq(a.completing.qty, 40, 'T6 第二批交齐');
  eq(a.onTimeOrderInitial, false, 'T6 订单口径（初诺）不准时');
  const s = X.summarize([a], asOf);
  eq(s.qty.onTimeInitial, 60, 'T6 数量口径（初诺）只有 60 按时');
  eq(s.otr.qtyInitial, 0.6, 'T6 数量口径准时率 60%');
  eq(s.otr.orderInitial, 0, 'T6 订单口径准时率 0%');
}

/* 7. 超收封顶：超出有效数量的签收不计入分子 */
{
  const o = mkOrder('T7', [
    { type: 'promise', at: '2026-01-01T09:00:00+08:00', promiseDate: '2026-02-01' },
    { type: 'cancel', at: '2026-01-10T09:00:00+08:00', qty: 30 },
    { type: 'receipt', at: '2026-02-01T10:00:00+08:00', qty: 100 }, // 有效 70，超收 30
  ]);
  const a = X.analyzeOrder(o);
  eq(a.effectiveQty, 70, 'T7 有效数量 70');
  eq(a.receipts[0].countedQty, 70, 'T7 计入 70');
  eq(a.receipts[0].overQty, 30, 'T7 超收 30');
  const s = X.summarize([a], asOf);
  eq(s.otr.qtyInitial, 1, 'T7 准时率按 70/70 = 100%');
}

/* 8. 未解释：无原因改期 + 无原因残差都进未解释，不猜测 */
{
  const o = mkOrder('T8', [
    { type: 'promise', at: '2026-01-01T09:00:00+08:00', promiseDate: '2026-02-08' },
    { type: 'reschedule', at: '2026-02-03T09:00:00+08:00', promiseDate: '2026-02-15' }, // 无原因
    { type: 'receipt', at: '2026-02-16T10:00:00+08:00', qty: 100 },
  ]);
  const a = X.analyzeOrder(o);
  const att = X.attribute([a], asOf);
  eq(att.length, 1, 'T8 只有未解释一类');
  eq(att[0].key, M.UNEXPLAINED_KEY, 'T8 全部未解释');
  eq(att[0].qtyDays, 800, 'T8 8 天 × 100 = 800 数量·天');
}

/* 9. 逾期未交付：未交齐数量按截止日计延期，残差未解释 */
{
  const o = mkOrder('T9', [
    { type: 'promise', at: '2026-01-01T09:00:00+08:00', promiseDate: '2026-03-01' },
    { type: 'reschedule', at: '2026-02-25T09:00:00+08:00', promiseDate: '2026-03-10', reason: { category: 'capacity_shortage' } },
  ], { qty: 60 });
  const a = X.analyzeOrder(o);
  const att = X.attribute([a], asOf);
  const cap = att.find(r => r.key === 'capacity_shortage');
  const unx = att.find(r => r.key === M.UNEXPLAINED_KEY);
  eq(cap.qtyDays, 9 * 60, 'T9 产能不足段 9 天 × 60');
  eq(unx.qtyDays, 26 * 60, 'T9 未解释残差 26 天 × 60（3/10→4/5）');
  const s = X.summarize([a], asOf);
  eq(s.qty.overdueOpen, 60, 'T9 逾期未交付 60');
}

/* 10. 未到期订单不进分母 */
{
  const o = mkOrder('T10', [
    { type: 'promise', at: '2026-03-20T09:00:00+08:00', promiseDate: '2026-04-20' },
    { type: 'shipment', at: '2026-04-02T10:00:00+08:00', qty: 20 },
  ], { qty: 50 });
  const a = X.analyzeOrder(o);
  const s = X.summarize([a], asOf);
  eq(s.orders.due, 0, 'T10 未到期不计入');
  eq(s.otr.qtyInitial, null, 'T10 分母为 0 → 准时率为空');
}

/* 11. 示例数据整体冒烟 + 关键数字核对 */
{
  const SAMPLE = require('../js/sample-data.js');
  const ds = M.normalizeDataset(SAMPLE);
  eq(ds.orders.length, 14, 'S11 示例数据 14 单');
  const analyses = ds.orders.map(X.analyzeOrder);
  const asOfS = X.datasetAsOf(ds.meta, ds.orders);
  eq(asOfS.at, '2026-04-05T18:00:00+08:00', 'S11 使用 meta.asOf');
  const s = X.summarize(analyses, asOfS);
  eq(s.orders.due, 11, 'S11 到期订单 11（不含取消 2、未到期 1）');
  eq(s.qty.dueEffective, 1900, 'S11 到期有效数量 1900');
  eq(s.qty.onTimeInitial, 560, 'S11 初诺按时数量 560');
  eq(s.qty.onTimeEffective, 770, 'S11 现诺按时数量 770');
  ok(Math.abs(s.otr.qtyInitial - 560 / 1900) < 1e-9, 'S11 初诺数量口径 ≈ 29.5%');
  ok(Math.abs(s.otr.qtyEffective - 770 / 1900) < 1e-9, 'S11 现诺数量口径 ≈ 40.5%');
  eq(s.orderOnTime.initial, 2, 'S11 初诺订单口径 2 单准时');
  eq(s.orderOnTime.effective, 4, 'S11 现诺订单口径 4 单准时');
  const att = X.attribute(analyses, asOfS);
  const get = k => (att.find(r => r.key === k) || { qtyDays: 0 }).qtyDays;
  eq(get('material_shortage'), 3280, 'S11 缺料 3280 数量·天');
  eq(get('customer_reschedule'), 800, 'S11 客户改约 800');
  eq(get('transport_exception'), 200, 'S11 运输异常 200');
  eq(get('capacity_shortage'), 540, 'S11 产能不足 540');
  eq(get(M.UNEXPLAINED_KEY), 4990, 'S11 未解释 4990');
  eq(att.reduce((sum, r) => sum + r.qtyDays, 0), 9810, 'S11 归因合计 9810');
}

console.log(`\n${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
