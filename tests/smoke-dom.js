/* tests/smoke-dom.js — 最小 DOM 桩上跑通 app.js 的全部渲染路径
 * 目的：在无浏览器环境下捕捉渲染期运行时错误（未定义变量、空引用等）。
 * 运行：node tests/smoke-dom.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

/* ---------- 最小 DOM 桩 ---------- */
function makeEl(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    children: [], _text: '', attributes: {}, listeners: {},
    style: {}, dataset: {}, hidden: false, _value: undefined, _cls: new Set(),
    clientWidth: 100, clientHeight: 20, scrollWidth: 50, offsetWidth: 100, offsetHeight: 20,
  };
  el.classList = {
    add: c => el._cls.add(c),
    remove: c => el._cls.delete(c),
    toggle: (c, force) => { const on = force === undefined ? !el._cls.has(c) : force; on ? el._cls.add(c) : el._cls.delete(c); return on; },
    contains: c => el._cls.has(c),
  };
  Object.defineProperty(el, 'className', { get: () => [...el._cls].join(' '), set: v => { el._cls = new Set(String(v).split(/\s+/).filter(Boolean)); } });
  Object.defineProperty(el, 'textContent', {
    get: () => el._text + el.children.map(c => (c.nodeType === 3 ? c.text : (c.textContent !== undefined ? c.textContent : ''))).join(''),
    set: v => { el.children = []; el._text = String(v); },
  });
  if (el.tagName === 'SELECT') {
    Object.defineProperty(el, 'value', {
      get: () => el._value !== undefined ? el._value : (el.children[0] ? el.children[0].attributes.value : ''),
      set: v => { el._value = v; },
    });
  } else {
    Object.defineProperty(el, 'value', { get: () => el._value, set: v => { el._value = v; } });
  }
  el.setAttribute = (k, v) => { el.attributes[k] = String(v); };
  el.getAttribute = k => el.attributes[k];
  el.addEventListener = (t, fn) => { (el.listeners[t] = el.listeners[t] || []).push(fn); };
  el.appendChild = c => { el.children.push(c); return c; };
  el.remove = () => {};
  el.click = () => (el.listeners.click || []).forEach(fn => fn({ target: el }));
  el.submit = () => (el.listeners.submit || []).forEach(fn => fn({ preventDefault: () => {} }));
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 20 });
  return el;
}

const ids = ['dataset-name', 'filter-team', 'filter-material', 'filter-status', 'drill-chip', 'asof-badge',
  'warnings-badge', 'view-overview', 'view-orders', 'view-compare', 'view-attribution', 'view-log',
  'tooltip', 'toast', 'file-input', 'btn-import', 'btn-sample', 'btn-export-detail', 'btn-export-metrics',
  'btn-export-json', 'btn-theme', 'warnings-panel', 'warnings-list', 'warnings-close'];
const byId = {};
for (const id of ids) {
  const tag = id.startsWith('filter-') && id !== 'filter-status' ? 'select' : id === 'filter-status' ? 'select' : 'div';
  byId[id] = makeEl(tag);
}
const tabEls = ['overview', 'orders', 'compare', 'attribution', 'log'].map(t => {
  const el = makeEl('button');
  el.dataset.tab = t;
  el._cls.add('tab');
  return el;
});

global.document = {
  getElementById: id => byId[id] || (byId[id] = makeEl('div')),
  createElement: tag => makeEl(tag),
  createElementNS: (ns, tag) => makeEl(tag),
  createTextNode: t => ({ nodeType: 3, text: String(t) }),
  querySelectorAll: sel => (sel === '.tab' ? tabEls : []),
  documentElement: makeEl('html'),
  body: makeEl('body'),
};
global.window = { innerWidth: 1280, innerHeight: 800 };
global.getComputedStyle = () => ({ getPropertyValue: () => '#2a78d6' });
global.requestAnimationFrame = fn => fn();

/* ---------- 加载应用脚本（浏览器顺序，屏蔽 module 走浏览器分支） ---------- */
const files = ['js/model.js', 'js/metrics.js', 'js/sample-data.js', 'js/charts.js', 'js/app.js'];
const code = files.map(f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')).join('\n;\n');
eval(`(function(module, exports){\n${code}\n})(undefined, undefined)`);

/* ---------- 断言工具 ---------- */
let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failed++; console.error('FAIL  ' + name); }
}
function walk(el, out = []) {
  if (!el || !el.children) return out;
  for (const c of el.children) { out.push(c); walk(c, out); }
  return out;
}
const viewText = id => byId[id].textContent;

/* ---------- 冒烟流程 ---------- */
ok(viewText('view-overview').includes('准时率'), '总览渲染：KPI 出现');
ok(viewText('view-overview').includes('29.5%'), '总览渲染：初诺数量口径 29.5%（示例数据）');
ok(viewText('view-overview').includes('40.5%'), '总览渲染：现诺数量口径 40.5%');
ok(viewText('view-overview').includes('未解释'), '总览渲染：未解释占比出现');
ok(byId['asof-badge'].textContent.includes('2026-04-05'), '数据截止徽标显示 meta.asOf');

tabEls[1].click();
ok(viewText('view-orders').includes('SO-1001'), '订单页渲染：列出 SO-1001');
ok(viewText('view-orders').includes('拆自 SO-1006'), '订单页渲染：拆单子单标注');

// 展开 SO-1007（跨时区签收，第 9 行）
const expandBtns = walk(byId['view-orders']).filter(e => e.tagName === 'BUTTON' && e.textContent === '展开');
ok(expandBtns.length === 14, '订单页渲染：14 行均有展开按钮');
expandBtns[8].click(); // SO-1007
const afterExpand = walk(byId['view-orders']);
ok(viewText('view-orders').includes('承诺时间线（含记录原因）'), '订单详情：承诺时间线渲染');
ok(viewText('view-orders').includes('归因分解'), '订单详情：归因分解渲染');
ok(viewText('view-orders').includes('洛杉矶仓签收'), '订单详情：跨时区签收记录显示');
ok(afterExpand.some(e => e.tagName === 'svg' || e.tagName === 'SVG'), '订单详情：时间线 SVG 渲染');

// 补录签收：SO-1005（逾期未交付 60 台），在有效承诺前签收 → 现诺口径应 +3.2pp
const expandBtns2 = walk(byId['view-orders']).filter(e => e.tagName === 'BUTTON' && e.textContent === '展开');
expandBtns2[4].click(); // SO-1005
const forms = walk(byId['view-orders']).filter(e => e.tagName === 'FORM');
ok(forms.length >= 1, '补录表单渲染');
const form = forms[0]; // SO-1005 的详情行在 SO-1007 之前，其补录表单为第一个
const dtInput = walk(form).find(e => e.attributes && e.attributes.type === 'datetime-local');
const qtyInput = walk(form).find(e => e.attributes && e.attributes.type === 'number');
dtInput.value = '2026-03-08T10:30';
qtyInput.value = '60';
form.submit();
ok(!byId['toast'].hidden, '补录后 toast 提示出现');
ok(byId['toast'].textContent.includes('重算差额'), '补录后 toast 含重算差额：' + byId['toast'].textContent);
ok(byId['toast'].textContent.includes('+3.2pp'), '现诺数量口径 +3.2pp（60/1900）');

tabEls[2].click();
ok(viewText('view-compare').includes('华东一组'), '对比页渲染：团队分组出现');
ok(viewText('view-compare').includes('未解释占比'), '对比页渲染：全指标表出现');

tabEls[3].click();
ok(viewText('view-attribution').includes('缺料'), '归因页渲染：缺料分类出现');
ok(viewText('view-attribution').includes('未解释（无记录依据）'), '归因页渲染：未解释标注出现');
// 补录 SO-1005 后：未解释 4990 − 1560(逾期残差消失) − 120(提前于现诺的负段) = 3310
ok(viewText('view-attribution').includes('3,310'), '归因页渲染：补录后未解释 3310 数量·天');
ok(viewText('view-attribution').includes('提前交付'), '归因页渲染：负向段（提前）注记出现');

tabEls[4].click();
ok(viewText('view-log').includes('初始加载'), '重算记录：基线快照存在');
ok(viewText('view-log').includes('补录签收 SO-1005'), '重算记录：补录快照存在');

// 主题切换不报错
byId['btn-theme'].click();
ok(true, '主题切换无异常');

console.log(`\n${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
