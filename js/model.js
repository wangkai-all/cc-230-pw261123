/* ============================================================================
 * model.js — 数据模型、校验与时区工具（纯函数，无 DOM 依赖）
 * 浏览器：作为经典脚本加载，定义全局常量 ODModel
 * Node：module.exports（供测试与引擎使用）
 * ========================================================================== */
const ODModel = (() => {
  'use strict';

  /* ---- 原因分类（固定集合；只有这些 + 无记录=未解释，绝不自动猜测） ---- */
  const REASON_CATEGORIES = [
    { key: 'material_shortage',   label: '缺料' },
    { key: 'customer_reschedule', label: '客户改约' },
    { key: 'transport_exception', label: '运输异常' },
    { key: 'capacity_shortage',   label: '产能不足' },
    { key: 'quality_hold',        label: '质量暂扣' },
    { key: 'other_recorded',      label: '其他（有记录）' },
  ];
  const REASON_LABEL = Object.fromEntries(REASON_CATEGORIES.map(r => [r.key, r.label]));
  const UNEXPLAINED_KEY = 'unexplained';
  const UNEXPLAINED_LABEL = '未解释';

  const EVENT_TYPES = ['promise', 'reschedule', 'shipment', 'receipt', 'cancel', 'restore'];
  const EVENT_TYPE_LABEL = {
    promise: '最初承诺', reschedule: '改期', shipment: '发货',
    receipt: '签收', cancel: '取消', restore: '恢复',
  };

  /* ---- 时区工具 ---- */
  function isValidTz(tz) {
    if (!tz || typeof tz !== 'string') return false;
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; }
    catch (e) { return false; }
  }

  /* 返回某 ISO 时间戳在指定时区里的日历日期 'YYYY-MM-DD'（准时判定的基准） */
  function dateInZone(iso, tz) {
    const d = new Date(iso);
    if (isNaN(d)) return null;
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(d);
    const get = t => (parts.find(p => p.type === t) || {}).value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  }

  /* 返回 ISO 时间戳在指定时区的可读日期时间，如 2026-02-11 09:30 (GMT+8) */
  function fmtDateTimeInZone(iso, tz) {
    const d = new Date(iso);
    if (isNaN(d)) return String(iso);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'shortOffset',
    }).formatToParts(d);
    const get = t => (parts.find(p => p.type === t) || {}).value;
    const tzName = get('timeZoneName') || '';
    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')} ${tzName}`;
  }

  /* 两个 'YYYY-MM-DD' 之间的天数差（b - a） */
  function dayDiff(a, b) {
    const pa = a.split('-').map(Number), pb = b.split('-').map(Number);
    return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
  }

  function tsOf(iso) {
    const t = Date.parse(iso);
    return isNaN(t) ? null : t;
  }

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  function validReason(r) {
    return r && typeof r === 'object' && typeof r.category === 'string' &&
      Object.prototype.hasOwnProperty.call(REASON_LABEL, r.category);
  }

  /* ---- 数据校验与规范化 ----
   * 输入：原始 JSON 对象 { meta?, orders: [...] }
   * 输出：{ meta, orders, warnings } —— 不抛异常，问题全部进 warnings，页面展示 */
  function normalizeDataset(raw) {
    const warnings = [];
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.orders)) {
      return { meta: {}, orders: [], warnings: ['数据格式错误：缺少 orders 数组'] };
    }
    const meta = raw.meta || {};
    const seen = new Set();
    const orders = [];

    raw.orders.forEach((o, idx) => {
      const tag = `订单[${idx}]${o && o.id ? ' ' + o.id : ''}`;
      if (!o || typeof o !== 'object') { warnings.push(`${tag}：不是对象，已跳过`); return; }
      if (!o.id) { warnings.push(`${tag}：缺少 id，已跳过`); return; }
      if (seen.has(o.id)) { warnings.push(`${tag}：id 重复，已跳过`); return; }
      seen.add(o.id);

      const qty = Number(o.qty);
      if (!(qty > 0)) { warnings.push(`${tag}：qty 缺失或不为正数，已跳过`); return; }

      let tz = o.tz;
      if (!isValidTz(tz)) {
        warnings.push(`${tag}：时区 "${o.tz || '(缺失)'}" 无效，已按 Asia/Shanghai 处理`);
        tz = 'Asia/Shanghai';
      }
      if (!Array.isArray(o.events) || o.events.length === 0) {
        warnings.push(`${tag}：没有事件，已跳过`); return;
      }

      const events = [];
      o.events.forEach((e, ei) => {
        const etag = `${tag} 事件[${ei}]`;
        if (!e || !EVENT_TYPES.includes(e.type)) { warnings.push(`${etag}：未知类型 "${e && e.type}"，已忽略`); return; }
        const ts = tsOf(e.at);
        if (ts === null) { warnings.push(`${etag}(${e.type})：时间 "${e.at}" 无法解析，已忽略`); return; }
        const ev = { type: e.type, at: e.at, ts, note: e.note || '' };
        if (e.type === 'promise' || e.type === 'reschedule') {
          if (!DATE_RE.test(e.promiseDate || '')) { warnings.push(`${etag}(${e.type})：promiseDate "${e.promiseDate}" 应为 YYYY-MM-DD，已忽略`); return; }
          ev.promiseDate = e.promiseDate;
        }
        if (['shipment', 'receipt', 'cancel', 'restore'].includes(e.type)) {
          const q = Number(e.qty);
          if (!(q > 0)) { warnings.push(`${etag}(${e.type})：qty 缺失或不为正数，已忽略`); return; }
          ev.qty = q;
        }
        if (e.shipId) ev.shipId = String(e.shipId);
        if (e.reason) {
          if (validReason(e.reason)) {
            ev.reason = { category: e.reason.category, detail: e.reason.detail || '', evidence: e.reason.evidence || '' };
          } else {
            warnings.push(`${etag}(${e.type})：原因分类 "${e.reason.category}" 不在已知集合内，该原因已丢弃（计入未解释）`);
          }
        }
        if (e.backfilled) ev.backfilled = true;
        if (e.uid) ev.uid = String(e.uid);
        events.push(ev);
      });

      events.sort((a, b) => a.ts - b.ts); // V8 稳定排序，同刻事件保持录入顺序

      if (!events.some(e => e.type === 'promise')) {
        warnings.push(`${tag}：缺少最初承诺(promise)事件，已跳过`); return;
      }

      // 数量一致性检查
      let canceled = 0, restored = 0, received = 0;
      for (const e of events) {
        if (e.type === 'cancel') canceled += e.qty;
        if (e.type === 'restore') {
          restored += e.qty;
          if (restored > canceled) warnings.push(`${tag}：恢复数量超过此前取消数量（${e.at}）`);
        }
        if (e.type === 'receipt') received += e.qty;
      }
      const netCanceled = Math.max(0, canceled - restored);
      if (netCanceled > qty) warnings.push(`${tag}：净取消数量 ${netCanceled} 超过订购数量 ${qty}`);
      const effective = Math.max(0, qty - netCanceled);
      if (received > effective) warnings.push(`${tag}：累计签收 ${received} 超过有效数量 ${effective}（超出部分按超收处理，不计入准时率）`);

      orders.push({
        id: String(o.id),
        customer: o.customer || '（未填客户）',
        team: o.team || '（未分团队）',
        material: o.material || '（未填物料）',
        qty, unit: o.unit || '件', tz,
        splitFrom: o.splitFrom ? String(o.splitFrom) : null,
        splitInto: Array.isArray(o.splitInto) ? o.splitInto.map(String) : [],
        events,
      });
    });

    // 拆单引用检查
    const byId = new Map(orders.map(o => [o.id, o]));
    for (const o of orders) {
      if (o.splitFrom && !byId.has(o.splitFrom)) warnings.push(`订单 ${o.id}：splitFrom 指向不存在的订单 ${o.splitFrom}`);
      if (o.splitInto.length) {
        const childQty = o.splitInto.reduce((s, cid) => s + (byId.has(cid) ? byId.get(cid).qty : 0), 0);
        if (childQty > o.qty) warnings.push(`订单 ${o.id}：拆单子单数量合计 ${childQty} 超过母单 ${o.qty}`);
      }
    }

    return { meta, orders, warnings };
  }

  return {
    REASON_CATEGORIES, REASON_LABEL, UNEXPLAINED_KEY, UNEXPLAINED_LABEL,
    EVENT_TYPES, EVENT_TYPE_LABEL,
    isValidTz, dateInZone, fmtDateTimeInZone, dayDiff, tsOf, normalizeDataset,
  };
})();
if (typeof module !== 'undefined') module.exports = ODModel;
