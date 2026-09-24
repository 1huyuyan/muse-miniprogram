// 云函数：ipSearch —— IP 知识库检索（国内外明星 / 动漫 / 游戏 / 潮玩）
// 数据源：ip_kb.json（与本地 data/ip_kb.js 同步维护，89 条）
// 响应格式对齐原 HTTP 服务：{ ok, hit, entry }，小程序 rag.js 改动最小。
const cloud = require('wx-server-sdk');
const kb = require('./ip_kb.json');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

function norm(s) {
  return String(s || '').toLowerCase().replace(/[\s·・.。()（）]/g, '');
}

function findIpEntry(name) {
  if (!name) return null;
  const n = norm(name);
  if (!n) return null;
  const keys = Object.keys(kb);
  for (let i = 0; i < keys.length; i++) {
    const e = kb[keys[i]];
    const cands = [e.key, e.name].concat(e.aliases || []);
    for (let j = 0; j < cands.length; j++) {
      const c = norm(cands[j]);
      if (c && (c === n || c.indexOf(n) >= 0 || n.indexOf(c) >= 0)) return e;
    }
  }
  return null;
}

exports.main = async (event) => {
  const name = event && (event.name || event.ip || '');
  const entry = findIpEntry(name);
  if (!entry) return { ok: true, hit: false };
  return { ok: true, hit: true, entry };
};
