// utils/tags.js - 全链路词条统一清洗（风格/性格/兴趣/禁忌/画像）
// 模型常把 style/interests/forbidden 输出成 "轻奢/正装/格调" 这类斜杠分隔字符串，
// 前端 wx:for 遍历字符串会按单字渲染（"风格·轻""风格·/"乱码）。
// 所有页面/模块一律通过本文件清洗词条，避免逻辑分叉（此前首页/结果页各写一份）。
// 统一规则：拆分隔符 → 去单字/空/纯符号 → 去重 → 按上限截断（每类默认 ≤8）。

const TAG_LIMITS = { style: 8, personality: 8, interests: 8, forbidden: 8 };

function cleanTags(v, max) {
  if (v == null) return [];
  let arr = Array.isArray(v) ? v.slice() : String(v);
  if (!Array.isArray(arr)) {
    arr = arr.split(/[/、，,;；\s]+/);
  }
  const out = [];
  for (const raw of arr) {
    const s = String(raw == null ? '' : raw).trim().replace(/^["'[\]]+|["'[\]]+$/g, '');
    if (!s) continue;
    if (s.length < 2) continue;                        // 丢弃单字
    if (!/[\u4e00-\u9fa5A-Za-z0-9]/.test(s)) continue; // 丢弃纯符号
    if (out.indexOf(s) >= 0) continue;                 // 去重
    out.push(s);
    if (max && out.length >= max) break;
  }
  return out;
}

// 清洗画像对象：style/personality/interests/forbidden 四类统一清洗并按上限截断
function cleanPersona(persona, limits) {
  if (!persona) return persona;
  const lim = Object.assign({}, TAG_LIMITS, limits || {});
  const p = Object.assign({}, persona);
  p.style = cleanTags(p.style, lim.style);
  p.personality = cleanTags(p.personality, lim.personality);
  p.interests = cleanTags(p.interests, lim.interests);
  p.forbidden = cleanTags(p.forbidden, lim.forbidden);
  return p;
}

module.exports = { cleanTags, cleanPersona, TAG_LIMITS };
