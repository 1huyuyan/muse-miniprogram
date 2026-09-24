// utils/recommend.js - 推荐生成公共模块
// 分工边界（核心）：
//   视觉分析只产出用户画像（对象/风格/场合/预算），不产出商品；
//   礼物候选一律由 utils/goods.js 的 matchGoods 从内置商品库选出；
//   文本模型只负责从候选中排序、写推荐理由并做一致性校验（ensureReason），
//   禁止凭空编造清单外的商品。
// 首页首次分析 与 结果页"不满意"重生成 共用本模块，保证逻辑唯一不漂移。

const api = require('./api');
const { retrieveCloud: ragRetrieveCloud } = require('./rag');

// 场景预设：切换后影响「分析 prompt」与「推荐 prompt」的偏好指导
const SCENES = [
  { key: 'general', label: '通用' },
  { key: 'boyfriend', label: '送男友' },
  { key: 'girlfriend', label: '送女友' },
  { key: 'elder', label: '送长辈' },
  { key: 'colleague', label: '送同事' }
];

const SCENE_GUIDE = {
  general: '',
  boyfriend: '收礼对象为男性（男友/男性朋友）：优先考虑数码、游戏、运动、实用装备类；避免过于女性化或暧昧的礼物。',
  girlfriend: '收礼对象为女性（女友/女性朋友）：优先考虑穿搭、美妆护肤、居家氛围、可爱精致类；礼物需体现用心与仪式感。',
  elder: '收礼对象为长辈（父母/老人）：优先考虑实用、健康养生、舒适保暖、品质居家类；避免潮流酷炫、二次元或过于花哨的品类。',
  colleague: '收礼对象为同事：优先考虑得体、大众化、不越界的商务/办公/生活类礼品，价位适中；避免过于私密或个人化的品类。'
};

function getSceneGuide(scene) {
  return SCENE_GUIDE[scene] || SCENE_GUIDE.general;
}

// good_id 容错匹配：先按原始 id 精确匹配，再尝试 "1"/"g1"/商品名/序号等多种写法
function resolveGood(id, matches) {
  if (!id) return null;
  const s = String(id).trim();
  const exact = matches.find(m => m.id === s || m.id === s.replace(/^g0/i, 'g'));
  if (exact) return exact;
  const num = (s.match(/^g?(\d+)$/i) || [])[1];
  const byNum = num ? matches.find(m => m.id === 'g' + String(parseInt(num, 10)).padStart(2, '0')) : null;
  if (byNum) return byNum;
  return matches.find(m => m.name === s) || null;
}

// 理由-商品一致性校验（核心修复）：
// 模型的 reason 必须与该商品自身特征（名称/品牌/标签/desc 片段）相关，
// 否则判定为模型张冠李戴（错配），回退为该商品自身特征生成的确定性理由，
// 保证"每条推荐理由描述的就是对应商品本身"。
function ensureReason(g, reason) {
  const r = String(reason || '').trim();
  const rl = r.toLowerCase();
  const tk = [g.name, g.brand].concat(g.tags || []).filter(Boolean);
  const descFrag = (g.desc || '').slice(0, 8);
  const relevant = !!r && (
    tk.some(t => rl.includes(String(t).toLowerCase())) ||
    (descFrag && rl.includes(descFrag.toLowerCase()))
  );
  if (!r || !relevant) {
    const tagTxt = (g.tags || []).slice(0, 2).join('、');
    return `偏好「${tagTxt}」，${g.desc}，与收礼人画像高度契合`;
  }
  return r;
}

function build(g, reason) {
  return Object.assign({}, g, { good_id: g.id, reason: ensureReason(g, reason) });
}

/**
 * 生成最终推荐（排行/理由/话术）。
 * 参数（opts 对象字段）：
 *   analysis    视觉分析产出的画像 { style, personality, interests, forbidden, summary, evidence, ip }
 *   matches     goods.js matchGoods 产出的候选商品数组（必须来自内置商品库）
 *   checkedTags 用户勾选线索
 *   clueText    用户补充描述
 *   priceRange  { min, max } 可选预算区间
 *   scene       场景预设 key（general/boyfriend/girlfriend/elder/colleague）
 *   feedback    用户"不满意"补充要求（可选，携带时在 prompt 中引导重选）
 * @returns {Promise<{persona,ip,rank,talk}>}
 */
async function generateRecommendations(opts) {
  const analysis = opts.analysis || {};
  let matches = opts.matches || [];
  const checkedTags = opts.checkedTags || [];
  const clueText = opts.clueText || '';
  const priceRange = opts.priceRange || null;
  const scene = opts.scene || 'general';
  const feedback = (opts.feedback || '').trim();

  const cfg = api.getConfig();

  // ===== RAG：识别到 IP 时，先用 IP 知识库检索商品候选（异步：云端优先→失败回退本地，不新增商品）=====
  const ip = analysis && analysis.ip && (analysis.ip.name || '').trim() ? analysis.ip : null;
  let rag = null;
  if (ip) {
    rag = await ragRetrieveCloud(ip);
    if (rag && rag.hitGoods && rag.hitGoods.length) {
      const known = {};
      const merged = [];
      for (let i = 0; i < matches.length; i++) {
        const m = matches[i];
        const hit = rag.hitGoods.find(h => h.good.id === m.id);
        merged.push(hit
          ? Object.assign({}, m, { _ragRelation: hit.relation, _ragDetail: hit.detail, _ragCollab: hit.collab })
          : m);
        known[m.id] = true;
      }
      // RAG 命中的商品若不在原候选里，一并并入（保证 IP 关联候选进入推荐池）
      for (let j = 0; j < rag.hitGoods.length; j++) {
        const h = rag.hitGoods[j];
        if (!known[h.good.id]) {
          merged.push(Object.assign({}, h.good, { score: h.score, _ragRelation: h.relation, _ragDetail: h.detail, _ragCollab: h.collab }));
        }
      }
      // 排序：真联名 > 有 RAG 关联依据 > 原匹配分数；仍截断 8 条
      merged.sort((a, b) =>
        (b._ragCollab ? 1 : 0) - (a._ragCollab ? 1 : 0) ||
        (b._ragRelation ? 1 : 0) - (a._ragRelation ? 1 : 0) ||
        ((b.score || 0) - (a.score || 0))
      );
      matches = merged.slice(0, 8);
    }
  }

  // RAG 知识片段 + 命中清单（注入推荐 prompt，强制 grounded）
  let ragPrompt = '';
  if (rag) {
    const hitBrief = rag.hitGoods.map((h, i) =>
      `${i + 1}.${h.good.name}(${h.good.brand}) 关联依据：${h.relation}${h.detail ? '(' + h.detail + ')' : ''}`
    ).join('\n');
    ragPrompt = `\nIP 知识片段（RAG 检索，供写理由时引用，禁止编造联名）：\n${rag.ipBrief}` +
      (hitBrief ? `\nRAG 检索命中的关联商品：\n${hitBrief}` : '') +
      (rag.degraded
        ? `\n注意：商品库暂无「${ip.name}」的联名/周边商品，本次只能按该 IP 的风格/偏好降级推荐。推荐理由必须明确标注「暂无${ip.name}联名，已按风格推荐」，禁止编造任何联名、周边、代言关系；优先把关联品牌/偏好品类的商品排前面。`
        : '\n注意：RAG 已命中该 IP 的联名/周边商品，可点名作品相关依据（如电影/角色），但同样禁止编造清单外的联名关系。');
  }

  // 候选清单补充每件商品的"特点(desc)"供模型写理由时引用，避免模型信息不足而张冠李戴
  const goodsBrief = matches.map((g, i) =>
    `${i + 1}.${g.name}(${g.brand}) 风格[${g.tags.join('/')}] 参考价${g.price}；特点：${g.desc || '—'}`
  ).join('\n');
  const guide = {
    persona: analysis.summary || '',
    style: (analysis.style || []).join('/'),
    interests: (analysis.interests || []).join('/'),
    forbidden: (analysis.forbidden || []).join('/'),
    evidence: JSON.stringify(analysis.evidence || {})
  };
  let budgetText = '';
  if (priceRange) {
    const lo = priceRange.min === 0 ? '' : priceRange.min;
    const hi = priceRange.max === Infinity ? '' : priceRange.max;
    budgetText = `，用户预算为${lo}~${hi}元，只允许推荐参考价落在该预算区间内的商品`;
  }
  // IP 引导文案：RAG 已命中时只做总体引导（知识片段与降级标注已注入 ragPrompt）；
  // 知识库未覆盖（如动漫 IP）时沿用原"周边/联名优先"引导。
  let ipText = '';
  if (ip) {
    if (rag) {
      ipText = `\n收礼人明显喜欢 IP「${ip.name}」(${ip.work || ''}，类型：${ip.type || '其他'})。请结合上面的 IP 知识片段与 RAG 命中清单组织推荐，优先把 RAG 命中（有明确关联依据）的商品排进榜单；推荐理由必须与命中商品的关联依据一致，不得张冠李戴。`;
    } else {
      ipText = `\n收礼人明显喜欢以下 IP/角色：「${ip.name}」(${ip.work || ''}，类型：${ip.type || '其他'})。请优先把与「${ip.name}」相关的周边、联名、代言、收藏类商品排上推荐，并在推荐理由中点名该 IP 及图中依据；显得更有个人化心意。`;
    }
  }
  const sceneText = getSceneGuide(scene);
  let scenePrompt = '';
  if (sceneText) {
    scenePrompt = `\n场景偏好：${sceneText}`;
  }
  let feedbackPrompt = '';
  if (feedback) {
    feedbackPrompt = `\n用户对上一版推荐不满意，补充要求：${feedback}。请基于上面的候选清单重新挑选：可调整 Top3 的组成与顺序（也可以保持），但商品必须仍来自清单，禁止编造清单外的商品；推荐理由按补充要求重写得更贴合。`;
  }
  const prompt = `以下是候选商品清单：\n${goodsBrief}\n\n收礼人画像：${JSON.stringify(guide)}${ragPrompt}${ipText}${scenePrompt}${feedbackPrompt}\n请从清单中选择最合适的 3 个作为推荐榜（Top1-3）${budgetText}。给每个推荐商品写一段 60 字内的"推荐理由"，必须满足：① 理由描述的就是该商品本身（引用上面清单"特点"栏，如写"机械键盘"就讲机械键盘自身的特性，禁止写另一个商品的特征）；② 引述图中的具体证据（如"照片出现某海报/穿搭风格"）建立信任感。只输出 JSON（good_id 必须使用候选清单里的编号，如 g01；每条 reason 必须与同一 good_id 的商品对应）：{"rank":[{"good_id":"","reason":""}...],"talk":"一句高情商送礼开场话术"}`;
  const raw = await api.chat({
    model: cfg.text_model,
    messages: [{ role: 'user', content: prompt }]
  });
  const parsed = api.extractJson(raw);
  const parsedRank = (parsed && parsed.rank || []).map(r => {
    const g = resolveGood(r.good_id, matches);
    return g ? build(g, r.reason) : null;
  }).filter(Boolean);
  // IP 榜单守护：识别到 IP 时，若模型榜单里没有该 IP 的周边/联名商品，
  // 把匹配阶段命中的 IP 周边（ipMatch 精确命中，或兜底首个 kind==='ip'）强制置顶，
  // 确保识别到 IP 就一定有联名/周边推荐。
  const rank = [];
  if (ip) {
    // 榜单守护（RAG 感知）：
    //   1) rag.hasCollab=true（真联名命中）→ 只置顶带 _ragCollab 标记的商品，理由点明作品相关；
    //   2) rag=null（知识库未覆盖的动漫 IP 等）→ 沿用旧逻辑：ipMatch 精确命中或首个 kind==='ip' 置顶；
    //   3) rag 命中但 hasCollab=false（明星 IP 无联名商品）→ 不置顶任何商品，
    //      避免把泡泡玛特盲盒等无关商品硬说成"该明星官方联名款"（本次任务核心修复）。
    const useRagGuard = !!(rag && rag.hasCollab);
    const ipGood = useRagGuard
      ? matches.find(m => m._ragCollab === true)
      : rag ? null : (matches.find(m => m.ipMatch === true) || matches.find(m => m.kind === 'ip'));
    if (ipGood) {
      const existed = parsedRank.find(x => x.id === ipGood.id);
      rank.push(existed || build(ipGood,
        useRagGuard
          ? `图中识别出「${ip.name}」${ip.work ? '(' + ip.work + ')' : ''}，本品与 TA 的作品/IP 直接相关（RAG 检索命中），投其所好更显心意`
          : `图中识别出「${ip.name}」${ip.work ? '(' + ip.work + ')' : ''}，本品正是其官方周边/联名款，投其所好更显心意`));
    }
  }
  rank.push(...parsedRank.filter(g => !rank.some(f => f.id === g.id)));
  const mergedRank = rank.slice(0, 3);
  // 兜底：榜单仍不足 3 个时，按匹配分数从高到低补齐（reason 经 ensureReason 保证描述自身）
  for (const g of matches) {
    if (mergedRank.length >= 3) break;
    if (!mergedRank.some(f => f.id === g.id)) mergedRank.push(build(g, ''));
  }
  // 结果页"推荐关联依据"：为每条推荐补 ipRelation 文案（关联点/降级标注）
  const withIpRelation = function (item) {
    if (!ip) return item;
    const out = Object.assign({}, item);
    let relTxt = '';
    if (item._ragCollab) {
      relTxt = '联名/作品相关（RAG 命中）';
    } else if (item._ragRelation) {
      relTxt = item._ragRelation + (item._ragDetail ? '：' + item._ragDetail : '');
    } else {
      relTxt = '风格相近';
    }
    out.ipRelation = (item._ragRelation || item._ragCollab)
      ? `与「${ip.name}」关联点：${relTxt}`
      : `暂无「${ip.name}」联名，已按风格推荐`;
    delete out._ragRelation;
    delete out._ragDetail;
    delete out._ragCollab;
    return out;
  };

  return {
    persona: guide,
    ip,
    rank: mergedRank.slice(0, 3).map(withIpRelation),
    talk: (parsed && parsed.talk) || '这份礼物想了好久，觉得特别适合你，希望你喜欢。',
    rag: rag ? { degraded: rag.degraded, hasCollab: rag.hasCollab, ipName: rag.ipEntry.name } : null
  };
}

module.exports = { generateRecommendations, SCENES, getSceneGuide };
