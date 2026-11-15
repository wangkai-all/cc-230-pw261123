/* ============================================================================
 * sample-data.js — 虚构示例数据
 * 覆盖：分批发货、多次改期（含无记录原因）、拆单、取消后恢复、
 *       跨时区签收（双向边界）、全部取消、逾期未交付、未到期订单。
 * 所有时间戳带时区偏移；promiseDate 为订单时区下的日历日期。
 * ========================================================================== */
const OD_SAMPLE_DATA = {
  meta: {
    name: '2026 Q1 交付示例数据（虚构）',
    asOf: '2026-04-05T18:00:00+08:00',
    note: '数据截止时间由 meta.asOf 指定；缺省时取全数据最新事件时刻。',
  },
  orders: [
    {
      id: 'SO-1001', customer: '华辰机械', team: '华东一组', material: '伺服电机',
      qty: 120, unit: '台', tz: 'Asia/Shanghai',
      events: [
        { type: 'promise', at: '2026-01-05T09:00:00+08:00', promiseDate: '2026-02-10', note: '合同签订，最初承诺' },
        { type: 'reschedule', at: '2026-01-28T10:00:00+08:00', promiseDate: '2026-02-18',
          reason: { category: 'material_shortage', detail: '伺服驱动芯片缺货', evidence: '采购单 PO-8842：芯片 2/5 到货' } },
        { type: 'shipment', at: '2026-02-09T15:00:00+08:00', qty: 60, shipId: 'SH-1001-1' },
        { type: 'receipt', at: '2026-02-10T11:20:00+08:00', qty: 60, shipId: 'SH-1001-1' },
        { type: 'shipment', at: '2026-02-17T16:00:00+08:00', qty: 60, shipId: 'SH-1001-2' },
        { type: 'receipt', at: '2026-02-18T10:05:00+08:00', qty: 60, shipId: 'SH-1001-2' },
      ],
    },
    {
      id: 'SO-1002', customer: '北极星自动化', team: '华南二组', material: '控制板',
      qty: 200, unit: '件', tz: 'Asia/Shanghai',
      events: [
        { type: 'promise', at: '2026-01-08T09:30:00+08:00', promiseDate: '2026-02-01' },
        { type: 'reschedule', at: '2026-01-20T14:00:00+08:00', promiseDate: '2026-02-05',
          reason: { category: 'customer_reschedule', detail: '客户产线停机检修，要求推迟', evidence: '客户邮件 1/19' } },
        { type: 'reschedule', at: '2026-02-02T09:00:00+08:00', promiseDate: '2026-02-12',
          reason: { category: 'material_shortage', detail: 'PCB 板供应商延期', evidence: '缺料报告 ML-103' } },
        { type: 'shipment', at: '2026-02-14T10:00:00+08:00', qty: 200, shipId: 'SH-1002-1' },
        { type: 'receipt', at: '2026-02-15T16:40:00+08:00', qty: 200, shipId: 'SH-1002-1' },
      ],
    },
    {
      id: 'SO-1003', customer: '长帆重工', team: '华东一组', material: '减速机',
      qty: 40, unit: '台', tz: 'Asia/Shanghai',
      events: [
        { type: 'promise', at: '2026-01-03T10:00:00+08:00', promiseDate: '2026-01-20' },
        { type: 'shipment', at: '2026-01-18T09:00:00+08:00', qty: 40, shipId: 'SH-1003-1' },
        { type: 'receipt', at: '2026-01-19T15:00:00+08:00', qty: 40, shipId: 'SH-1003-1' },
      ],
    },
    {
      id: 'SO-1004', customer: '明州电子', team: '西南三组', material: '温度传感器',
      qty: 500, unit: '支', tz: 'Asia/Shanghai',
      events: [
        { type: 'promise', at: '2026-01-12T09:00:00+08:00', promiseDate: '2026-02-15' },
        { type: 'cancel', at: '2026-01-25T11:00:00+08:00', qty: 100,
          reason: { category: 'other_recorded', detail: '客户预算冻结，暂缓 100 支', evidence: '客户通知函 1/24' } },
        { type: 'restore', at: '2026-02-01T10:00:00+08:00', qty: 100, note: '客户预算解冻，恢复 100 支' },
        { type: 'shipment', at: '2026-02-14T09:00:00+08:00', qty: 300, shipId: 'SH-1004-1' },
        { type: 'receipt', at: '2026-02-15T12:00:00+08:00', qty: 300, shipId: 'SH-1004-1' },
        { type: 'shipment', at: '2026-02-15T18:00:00+08:00', qty: 200, shipId: 'SH-1004-2',
          reason: { category: 'transport_exception', detail: 'G50 高速封路绕行', evidence: '物流异常单 TR-2210' } },
        { type: 'receipt', at: '2026-02-16T20:30:00+08:00', qty: 200, shipId: 'SH-1004-2' },
      ],
    },
    {
      id: 'SO-1005', customer: '高原食品机械', team: '华南二组', material: '伺服电机',
      qty: 60, unit: '台', tz: 'Asia/Shanghai',
      events: [
        { type: 'promise', at: '2026-01-15T09:00:00+08:00', promiseDate: '2026-03-01' },
        { type: 'reschedule', at: '2026-02-25T10:00:00+08:00', promiseDate: '2026-03-10',
          reason: { category: 'capacity_shortage', detail: '总装产线排产冲突', evidence: '产线排产表 2/24' } },
      ],
    },
    {
      id: 'SO-1006', customer: '华辰机械', team: '华东一组', material: '控制板',
      qty: 300, unit: '件', tz: 'Asia/Shanghai', splitInto: ['SO-1006A', 'SO-1006B'],
      events: [
        { type: 'promise', at: '2026-01-10T09:00:00+08:00', promiseDate: '2026-02-20' },
        { type: 'cancel', at: '2026-02-05T15:00:00+08:00', qty: 300,
          reason: { category: 'other_recorded', detail: '拆单：转为 SO-1006A / SO-1006B 分别交付', evidence: '拆单申请 SP-1006' } },
      ],
    },
    {
      id: 'SO-1006A', customer: '华辰机械', team: '华东一组', material: '控制板',
      qty: 150, unit: '件', tz: 'Asia/Shanghai', splitFrom: 'SO-1006',
      events: [
        { type: 'promise', at: '2026-02-05T15:30:00+08:00', promiseDate: '2026-02-20', note: '拆单继承母单承诺' },
        { type: 'shipment', at: '2026-02-20T09:00:00+08:00', qty: 150, shipId: 'SH-1006A-1' },
        { type: 'receipt', at: '2026-02-21T11:00:00+08:00', qty: 150, shipId: 'SH-1006A-1' },
      ],
    },
    {
      id: 'SO-1006B', customer: '华辰机械', team: '华东一组', material: '控制板',
      qty: 150, unit: '件', tz: 'Asia/Shanghai', splitFrom: 'SO-1006',
      events: [
        { type: 'promise', at: '2026-02-05T15:30:00+08:00', promiseDate: '2026-02-20', note: '拆单继承母单承诺' },
        { type: 'reschedule', at: '2026-02-18T09:00:00+08:00', promiseDate: '2026-02-28',
          reason: { category: 'material_shortage', detail: '芯片到货延迟', evidence: '采购单 PO-8871' } },
        { type: 'shipment', at: '2026-02-27T14:00:00+08:00', qty: 150, shipId: 'SH-1006B-1' },
        { type: 'receipt', at: '2026-02-28T10:30:00+08:00', qty: 150, shipId: 'SH-1006B-1' },
      ],
    },
    {
      id: 'SO-1007', customer: '明州电子', team: '西南三组', material: '伺服电机',
      qty: 80, unit: '台', tz: 'Asia/Shanghai',
      events: [
        { type: 'promise', at: '2026-01-20T09:00:00+08:00', promiseDate: '2026-02-10', note: '交付洛杉矶仓，承诺按北京时间' },
        { type: 'shipment', at: '2026-02-06T10:00:00+08:00', qty: 80, shipId: 'SH-1007-1', note: '海运至洛杉矶仓' },
        { type: 'receipt', at: '2026-02-10T17:30:00-08:00', qty: 80, shipId: 'SH-1007-1', note: '洛杉矶仓签收（当地 2/10 17:30）' },
      ],
    },
    {
      id: 'SO-1008', customer: '长帆重工', team: '海外支持组', material: '减速机',
      qty: 60, unit: '台', tz: 'America/Los_Angeles',
      events: [
        { type: 'promise', at: '2026-01-22T08:00:00-08:00', promiseDate: '2026-02-12', note: '承诺按洛杉矶时间' },
        { type: 'shipment', at: '2026-02-11T09:00:00-08:00', qty: 60, shipId: 'SH-1008-1' },
        { type: 'receipt', at: '2026-02-12T23:30:00+08:00', qty: 60, shipId: 'SH-1008-1', note: '上海仓签收（北京时间 2/12 23:30）' },
      ],
    },
    {
      id: 'SO-1009', customer: '长帆重工', team: '华南二组', material: '减速机',
      qty: 90, unit: '台', tz: 'Asia/Shanghai',
      events: [
        { type: 'promise', at: '2026-01-28T09:00:00+08:00', promiseDate: '2026-03-05' },
        { type: 'cancel', at: '2026-02-20T10:00:00+08:00', qty: 90,
          reason: { category: 'other_recorded', detail: '客户项目取消', evidence: '客户解约函 2/19' } },
      ],
    },
    {
      id: 'SO-1010', customer: '北极星自动化', team: '华东一组', material: '控制板',
      qty: 240, unit: '件', tz: 'Asia/Shanghai',
      events: [
        { type: 'promise', at: '2026-01-06T09:00:00+08:00', promiseDate: '2026-01-31' },
        { type: 'shipment', at: '2026-01-29T10:00:00+08:00', qty: 100, shipId: 'SH-1010-1' },
        { type: 'receipt', at: '2026-01-30T14:00:00+08:00', qty: 100, shipId: 'SH-1010-1' },
        { type: 'shipment', at: '2026-02-01T09:00:00+08:00', qty: 100, shipId: 'SH-1010-2',
          reason: { category: 'material_shortage', detail: '连接器缺料，2/1 齐套', evidence: '缺料报告 ML-108' } },
        { type: 'receipt', at: '2026-02-02T17:00:00+08:00', qty: 100, shipId: 'SH-1010-2' },
        { type: 'shipment', at: '2026-02-04T15:00:00+08:00', qty: 40, shipId: 'SH-1010-3' },
        { type: 'receipt', at: '2026-02-05T12:00:00+08:00', qty: 40, shipId: 'SH-1010-3' },
      ],
    },
    {
      id: 'SO-1011', customer: '高原食品机械', team: '西南三组', material: '温度传感器',
      qty: 300, unit: '支', tz: 'Asia/Shanghai',
      events: [
        { type: 'promise', at: '2026-01-16T09:00:00+08:00', promiseDate: '2026-02-08' },
        { type: 'reschedule', at: '2026-02-03T11:00:00+08:00', promiseDate: '2026-02-15', note: '电话沟通改期，未登记原因' },
        { type: 'shipment', at: '2026-02-15T09:00:00+08:00', qty: 300, shipId: 'SH-1011-1' },
        { type: 'receipt', at: '2026-02-16T13:00:00+08:00', qty: 300, shipId: 'SH-1011-1' },
      ],
    },
    {
      id: 'SO-1012', customer: '华辰机械', team: '华东一组', material: '伺服电机',
      qty: 50, unit: '台', tz: 'Asia/Shanghai',
      events: [
        { type: 'promise', at: '2026-03-20T09:00:00+08:00', promiseDate: '2026-04-20' },
        { type: 'shipment', at: '2026-04-02T10:00:00+08:00', qty: 20, shipId: 'SH-1012-1' },
      ],
    },
  ],
};
if (typeof module !== 'undefined') module.exports = OD_SAMPLE_DATA;
