// 云函数：goodsSearch —— 礼物商品库检索（全量列表 / 关键词 / 品牌 / IP 检索）
// 数据源：goods.json（与本地 utils/goods.js 同步维护，初始 22 件）
// 响应格式对齐 ipSearch 云函数风格：{ ok, hit, data }，data 为商品数组；
// 小程序 rag.js 拉取全量（action:'all'）后走本地打分，改动最小。
const cloud = require('wx-server-sdk');
const GOODS = require('./goods.json');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

function norm(s) {
  return String(s || '').toLowerCase().replace(/[\s·・.。()（）]/g, '');
}

function listAll() {
  return Object.keys(GOODS).sort().map(k => GOODS[k]);
}

// 关键词检索：命中 name/brand/tags/desc/ipNames 任一字段即视为命中
function search(keyword, brand, ip) {
  const kw = norm(keyword);
  const br = norm(brand);
  const ipn = norm(ip);
  if (!kw && !br && !ipn) return listAll();
  const items = [];
  const keys = Object.keys(GOODS).sort();
  for (let i = 0; i < keys.length; i++) {
    const g = GOODS[keys[i]];
    if (kw) {
      const hay = norm([g.id, g.name, g.brand].concat(g.tags || []).concat([g.desc || '']).concat(g.ipNames || []).join(' '));
      if (hay.indexOf(kw) < 0) continue;
    }
    if (br && norm(g.brand || '').indexOf(br) < 0) continue;
    if (ipn) {
      const ipHay = norm((g.ipNames || []).join(' '));
      if (ipHay.indexOf(ipn) < 0) continue;
    }
    items.push(g);
  }
  return items;
}

exports.main = async (event) => {
  try {
    const e = event || {};
    // 无检索条件或显式 action:'all' → 返回全量商品列表（rag.js 云端拉取走此分支）
    const keyword = e.keyword;
    const brand = e.brand;
    const ip = e.ip;
    if (e.action === 'all' || (!keyword && !brand && !ip)) {
      return { ok: true, hit: true, data: listAll() };
    }
    const data = search(keyword, brand, ip);
    return { ok: true, hit: data.length > 0, data };
  } catch (err) {
    return { ok: false, hit: false, error: String((err && err.message) || err) };
  }
};
