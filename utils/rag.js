// utils/rag.js - 最小可用 RAG 检索模块（明星 IP → 商品候选；动漫/游戏/潮玩 IP 云端优先）
// 分层设计（对齐调研结论：商品量小无需向量库）：
//   第 0 层：IP 知识获取「云端优先」——先请求微信云开发云函数 ipSearch（云端部署、不占本机）
//           取最新 IP 条目（含真实联名 collabs），未开通云开发/未命中时回退本地 data/ip_kb.js；
//           另保留旧本机 HTTP 服务（muse_ip:8789）兜底兼容。
//   第 1 层：识别出的 IP 名 → 命中 IP 知识库条目
//   第 2 层：用 IP 特征（作品/关联品牌+真实联名/品类偏好/风格标签）在 goods.js 商品库做关键词/模糊匹配
//   第 3 层：输出「候选商品 + 关联依据 + 是否真联名」供推荐模块注入 prompt 与展示
// 本模块只读商品库、只做打分排序，不新增/修改任何商品，也不编造联名关系。
//
// 关联依据类型（relation）：
//   作品相关   商品与 IP 代表作/角色名直接相关（真正的周边/联名信号）
//   品牌关联   商品品牌命中 IP 关联/代言品牌，或命中 IP 真实联名中的品牌（collabs）
//   品类偏好   商品名称/描述命中 IP 偏好品类
//   风格匹配   商品风格标签与 IP 风格标签重合
// collab=true 仅在"作品相关"或商品直呼 IP 名时成立；IP 知识库含真实联名（collabs 非空）时
// hasCollab=true（推荐理由可引用该 IP 的公开联名信息），无任何联名证据时调用方必须走降级并显式标注。

const { IP_KB, findIpEntry } = require('../data/ip_kb');
const { GOODS } = require('./goods');

// 云端 IP 知识服务地址（可配置；默认本机 muse_ip 服务，端口 8789 避开 8787）
const IP_SERVER = 'http://127.0.0.1:8789';
const CLOUD_TIMEOUT_MS = 3000;

const COLLAB_RELATIONS = ['作品相关'];

// 平台自适应 HTTP GET（小程序 wx.request / Node fetch）
function cloudRequest(url) {
  return new Promise((resolve, reject) => {
    if (typeof wx !== 'undefined' && wx.request) {
      wx.request({
        url, method: 'GET', timeout: CLOUD_TIMEOUT_MS,
        success: r => resolve(r.data),
        fail: e => reject(e)
      });
    } else if (typeof fetch === 'function') {
      const timer = setTimeout(() => reject(new Error('cloud timeout')), CLOUD_TIMEOUT_MS);
      fetch(url).then(r => r.json()).then(d => { clearTimeout(timer); resolve(d); }).catch(e => { clearTimeout(timer); reject(e); });
    } else {
      reject(new Error('no http client available'));
    }
  });
}

// 云端检索：①微信云开发云函数 ipSearch（云端优先）→ ②旧本机 HTTP 服务（兼容）→ 未命中/异常返回 null
async function fetchIpFromCloud(ip) {
  const name = (ip && (ip.name || ip.key || ip)) || '';
  if (!String(name).trim()) return null;
  // ① 微信云开发云函数优先：云端部署、不占本机内存，真机/模拟器均可直接调用
  if (typeof wx !== 'undefined' && wx.cloud && wx.cloud.callFunction) {
    try {
      const cloudRes = await wx.cloud.callFunction({ name: 'ipSearch', data: { name } });
      const r = cloudRes && cloudRes.result;
      if (r && r.ok && r.hit && r.entry) return r.entry;
    } catch (e) {
      // 云函数不可用（未开通云开发/未部署）→ 继续尝试旧 HTTP 兜底
    }
  }
  // ② 兼容旧本机 HTTP 服务（muse_ip:8789，云端迁移后已停用则自然跳过）
  let res;
  try {
    res = await cloudRequest(IP_SERVER + '/api/ip/search?name=' + encodeURIComponent(name));
  } catch (e) {
    return null; // 云端不可用 → 调用方回退本地
  }
  if (res && res.ok && res.hit && res.entry) return res.entry;
  return null; // 云端未命中 → 调用方回退本地
}

// 云端商品库：调用 goodsSearch 云函数拉取全量商品列表（云端优先，新增商品无需改小程序代码），
// 失败/超时/未部署返回 null → 调用方回退本地 utils/goods.js 的 GOODS。
async function fetchGoodsFromCloud() {
  if (typeof wx !== 'undefined' && wx.cloud && wx.cloud.callFunction) {
    try {
      const cloudRes = await wx.cloud.callFunction({ name: 'goodsSearch', data: { action: 'all' } });
      const r = cloudRes && cloudRes.result;
      if (r && r.ok && Array.isArray(r.data) && r.data.length) return r.data;
    } catch (e) {
      // 云函数不可用（未开通云开发/未部署）→ 回退本地 goods.js
    }
  }
  return null;
}

function norm(s) {
  return String(s || '').toLowerCase().replace(/[\s·・.。()（）]/g, '');
}

// 单商品 × 单 IP 特征的打分与关联依据提取
function matchGood(ipEntry, good) {
  const relations = [];
  let score = 0;
  // 检索文本：商品名 + 品牌 + 标签 + 描述（覆盖关键词/模糊匹配场景）
  const hay = [good.name, good.brand]
    .concat(good.tags || [])
    .concat([good.desc || ''])
    .join(' ').toLowerCase();
  const has = kw => !!kw && hay.indexOf(String(kw).toLowerCase()) >= 0;
  const hasTag = kw => (good.tags || []).some(t => String(t).toLowerCase() === String(kw).toLowerCase());

  // 1) 作品相关（真联名最强信号）：商品文本直呼 IP 名/别名/代表作/角色名
  //    - 过短英文/数字词（如单曲"I"）不参与作品词匹配，避免子串撞词误判
  //    - 仅命中作品词而商品未直呼 IP 名/别名时，不作为关联依据（防止"雏菊"等撞词把无关商品推成联名）
  const workHit = (ipEntry.works || []).find(w => {
    const wl = String(w || '').trim();
    if (!wl) return false;
    const alnumLen = String(wl).replace(/[^a-zA-Z0-9]/g, '').length;
    if (alnumLen > 0 && alnumLen < 3) return false;
    return has(wl);
  });
  const ipNameHit = has(ipEntry.name) || (ipEntry.aliases || []).some(a => {
    const al = String(a || '').trim();
    if (!al) return false;
    const alnumLen = String(al).replace(/[^a-zA-Z0-9]/g, '').length;
    if (alnumLen > 0 && alnumLen < 3) return false; // 过短英文/数字别名（如"V"）不参与，避免撞词误判
    return has(al);
  });
  if (ipNameHit) {
    relations.push({ type: '作品相关', detail: workHit || ipEntry.name });
    score += 40;
  }

  // 2) 品牌关联：商品品牌命中 IP 关联/代言品牌，或命中 IP 真实联名中的品牌（collabs）
  const brandCands = (ipEntry.brands || []).concat(ipEntry.collabs || []);
  const brandHit = brandCands.find(b => has(b));
  if (brandHit) {
    relations.push({ type: '品牌关联', detail: brandHit });
    score += 30;
  }

  // 3) 品类偏好：商品名/描述命中 IP 偏好品类（取前 2 个）
  const catHits = (ipEntry.categoryPrefs || []).filter(c => has(c)).slice(0, 2);
  if (catHits.length) {
    relations.push({ type: '品类偏好', detail: catHits.join('/') });
    score += 15 * catHits.length;
  }

  // 4) 风格匹配：商品风格标签与 IP 风格标签重合（取前 3 个）
  const styleHits = (ipEntry.styleTags || []).filter(s => hasTag(s)).slice(0, 3);
  if (styleHits.length) {
    relations.push({ type: '风格匹配', detail: styleHits.join('/') });
    score += 8 * styleHits.length;
  }

  if (!relations.length) return null;
  const collab = relations.some(r => COLLAB_RELATIONS.indexOf(r.type) >= 0);
  return {
    score,
    relations,
    collab,
    // 主依据：按重要程度取第一条（作品相关 > 品牌关联 > 品类偏好 > 风格匹配）
    primary: relations[0]
  };
}

// 生成注入推荐 prompt 的 IP 知识片段文本
function buildBrief(e) {
  const lines = [
    '「' + e.name + '」' + (e.type ? '(' + e.type + ')' : ''),
    '代表作品/身份：' + ((e.works || []).join('、') || '—'),
    '风格标签：' + ((e.styleTags || []).join('、') || '—'),
    '关联品牌：' + ((e.brands || []).join('、') || '无公开代言品牌'),
    '偏好品类：' + ((e.categoryPrefs || []).join('、') || '—'),
    '粉丝偏好：' + ((e.fanPrefs || []).join('、') || '—')
  ];
  // 真实联名（云端知识库新增字段）：推荐理由可引用"该IP与XX有联名周边"
  const collabs = e.collabs || [];
  if (collabs.length) {
    lines.splice(4, 0, '真实联名周边：' + collabs.join('、'));
  }
  return lines.join('；');
}

/**
 * RAG 检索入口（同步、纯本地）。
 * @param {string|{name,work,type}} ip  识别出的 IP（人脸库键名/中文名/别名均可）
 * @param {object} opts { topN=6, goods=GOODS }
 * @returns {null | {
 *   ipEntry, ipBrief,
 *   hitGoods: [{ good, score, relation, detail, collab }],
 *   hasCollab,   // 是否存在真联名商品（决定是否可写"联名/周边"）
 *   degraded     // !hasCollab：需降级为风格推荐并显式标注"暂无联名"
 * }}
 */
function retrieve(ip, opts) {
  const ipEntry = findIpEntry(ip);
  if (!ipEntry) return null; // 知识库未覆盖（如动漫 IP）→ 调用方回退旧逻辑
  const topN = (opts && opts.topN) || 6;
  const goods = (opts && opts.goods) || GOODS;
  const scored = [];
  for (let i = 0; i < goods.length; i++) {
    const r = matchGood(ipEntry, goods[i]);
    if (r) scored.push({ good: goods[i], score: r.score, collab: r.collab, primary: r.primary });
  }
  scored.sort((a, b) => b.score - a.score || (a.collab ? -1 : 1) - (b.collab ? -1 : 1));
  const hitGoods = scored.slice(0, topN).map(h => ({
    good: h.good,
    score: h.score,
    relation: h.primary.type,
    detail: h.primary.detail,
    collab: h.collab
  }));
  // hasCollab：仅以商品库命中真联名商品为准（collab=true 需商品文本直呼 IP 名/代表作）；
  // IP 知识库 collabs 只作为品牌关联与推荐理由素材，不得单独判定存在联名，避免无关商品被推为联名。
  const hasCollab = hitGoods.some(h => h.collab);
  return {
    ipEntry,
    ipBrief: buildBrief(ipEntry),
    hitGoods,
    hasCollab,
    degraded: !hasCollab,
    collabBrief: (ipEntry.collabs || []).join('；')
  };
}

/**
 * RAG 检索入口（异步、云端优先）。
 * IP 知识获取顺序：云端 IP 知识服务（http://127.0.0.1:8789）→ 失败/未命中回退本地 data/ip_kb.js。
 * 命中后统一走本地打分管线（matchGood / buildBrief），打分与 grounded 逻辑与 retrieve 完全一致。
 * @param {string|{name,work,type}} ip  识别出的 IP（人脸库键名/中文名/别名均可）
 * @param {object} opts { topN=6, goods=GOODS }
 * @returns {Promise<null | {ipEntry, ipBrief, hitGoods, hasCollab, degraded, collabBrief, source}>}
 */
async function retrieveCloud(ip, opts) {
  const cloudEntry = await fetchIpFromCloud(ip);
  const ipEntry = cloudEntry || findIpEntry(ip);
  if (!ipEntry) return null; // 云端与本地均未覆盖 → 调用方回退旧逻辑
  const topN = (opts && opts.topN) || 6;
  // 商品库云端优先：未显式注入 opts.goods（测试注入）时，先尝试 goodsSearch 云函数拉取全量，
  // 失败/未部署回退本地 GOODS；打分逻辑与 retrieve 完全一致。
  let goods = (opts && opts.goods) || GOODS;
  if (!(opts && opts.goods)) {
    const cloudGoods = await fetchGoodsFromCloud();
    if (cloudGoods && cloudGoods.length) goods = cloudGoods;
  }
  const scored = [];
  for (let i = 0; i < goods.length; i++) {
    const r = matchGood(ipEntry, goods[i]);
    if (r) scored.push({ good: goods[i], score: r.score, collab: r.collab, primary: r.primary });
  }
  scored.sort((a, b) => b.score - a.score || (a.collab ? -1 : 1) - (b.collab ? -1 : 1));
  const hitGoods = scored.slice(0, topN).map(h => ({
    good: h.good,
    score: h.score,
    relation: h.primary.type,
    detail: h.primary.detail,
    collab: h.collab
  }));
  const hasCollab = hitGoods.some(h => h.collab);
  return {
    ipEntry,
    ipBrief: buildBrief(ipEntry),
    hitGoods,
    hasCollab,
    degraded: !hasCollab,
    collabBrief: (ipEntry.collabs || []).join('；'),
    source: cloudEntry ? 'cloud' : 'local'
  };
}

module.exports = { retrieve, retrieveCloud, fetchIpFromCloud, fetchGoodsFromCloud, findIpEntry, matchGood, IP_KB, IP_SERVER };
