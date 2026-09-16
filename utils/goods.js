// utils/goods.js - 内置商品库（MVP mock 数据，后续替换为联盟 API）
// 每个商品带 style_tag（风格标签），供 AI 匹配与推荐
const GOODS = [
  { id: 'g01', name: '机械键盘', brand: 'Keychron', tags: ['游戏', '数码', '工作', '桌搭'], price: '399-599元', desc: '红轴静音，适合办公与游戏兼顾', image: '/assets/goods/g01.png' },
  { id: 'g02', name: '无线降噪耳机', brand: 'Sony', tags: ['数码', '通勤', '音乐', '简约'], price: '1499-1999元', desc: '降噪旗舰，通勤利器', image: '/assets/goods/g02.png' },
  { id: 'g03', name: '手冲咖啡器具套装', brand: 'Hario', tags: ['咖啡', '居家', '文艺', '仪式感'], price: '200-400元', desc: '精品咖啡入门全套', image: '/assets/goods/g03.png' },
  { id: 'g04', name: '香薰加湿器', brand: 'MUJI', tags: ['居家', '简约', '日系', '解压'], price: '150-300元', desc: '氛围感与实用性兼备', image: '/assets/goods/g04.png' },
  { id: 'g05', name: '斯凯奇运动鞋', brand: 'Skechers', tags: ['运动', '休闲', '舒适', '日常'], price: '400-700元', desc: '舒适百搭，日常通勤', image: '/assets/goods/g05.png' },
  { id: 'g06', name: '手办/潮玩盲盒', brand: '泡泡玛特', tags: ['二次元', '潮玩', '收藏', '可爱'], price: '59-299元', desc: '契合二次元审美的收藏单品', image: '/assets/goods/g06.png', kind: 'ip' },
  { id: 'g07', name: '电子手账本', brand: '华为', tags: ['数码', '学习', '效率', '极简'], price: '2000-4000元', desc: '无纸化学习/日程管理', image: '/assets/goods/g07.png' },
  { id: 'g08', name: '黑胶唱片机', brand: '梵尼诗', tags: ['音乐', '复古', '文艺', '氛围'], price: '800-2000元', desc: '复古音质与摆件属性兼备', image: '/assets/goods/g08.png' },
  { id: 'g09', name: '电竞椅', brand: '傲风', tags: ['游戏', '桌搭', '宅家', '舒适'], price: '800-2000元', desc: '游戏宅家的主力装备', image: '/assets/goods/g09.png' },
  { id: 'g10', name: '真丝睡眠眼罩套装', brand: 'Manito', tags: ['居家', '睡眠', '精致', '温柔'], price: '200-500元', desc: '生活品质细节的关怀', image: '/assets/goods/g10.png' },
  { id: 'g11', name: '单反/拍立得相机', brand: '富士', tags: ['摄影', '文艺', '街拍', '复古'], price: '800-3000元', desc: '记录生活瞬间的礼物', image: '/assets/goods/g11.png' },
  { id: 'g12', name: '智能手表', brand: 'Apple', tags: ['数码', '运动', '通勤', '科技'], price: '2000-4000元', desc: '健康与便利的科技礼物', image: '/assets/goods/g12.png' },
  { id: 'g13', name: '汉服/和风服饰周边', brand: '十三余', tags: ['二次元', '国风', '穿搭', '文艺'], price: '200-800元', desc: '契合国风穿搭审美的单品', image: '/assets/goods/g13.png', kind: 'ip' },
  { id: 'g14', name: '漫画/设定集', brand: '鹰角', tags: ['二次元', '收藏', '游戏', '文艺'], price: '100-300元', desc: '二次元用户的心头好', image: '/assets/goods/g14.png', kind: 'ip' },
  { id: 'g15', name: '桌面氛围灯', brand: 'Yeelight', tags: ['桌搭', '氛围', '极简', '居家'], price: '150-400元', desc: '赛博桌面氛围担当', image: '/assets/goods/g15.png' },
  { id: 'g16', name: '瑜伽垫', brand: 'Keep', tags: ['运动', '健康', '居家', '自律'], price: '100-300元', desc: '自律人群的运动装备', image: '/assets/goods/g16.png' },
  { id: 'g17', name: '原神 角色手办/立牌', brand: '米哈游', tags: ['二次元', '游戏', '收藏', '桌搭'], price: '100-300元', desc: '可莉/钟离/胡桃等热门角色正比例手办或立牌，二次元桌面陈列首选', image: '/assets/goods/g17.png', ipNames: ['原神', 'genshin', '可莉', '钟离', '胡桃'], kind: 'ip' },
  { id: 'g18', name: '火影忍者 忍者手办摆件', brand: '百联', tags: ['二次元', '收藏', '动漫'], price: '100-300元', desc: '鸣人/佐助忍者手办摆件，火影迷的收藏佳品', image: '/assets/goods/g18.png', ipNames: ['火影忍者', '火影', '鸣人', '佐助'], kind: 'ip' },
  { id: 'g19', name: '海贼王 路飞草帽周边手办', brand: '万代', tags: ['二次元', '收藏', '动漫'], price: '150-400元', desc: '路飞草帽造型手办，海贼王人气周边', image: '/assets/goods/g19.png', ipNames: ['海贼王', '海贼', '路飞'], kind: 'ip' },
  { id: 'g20', name: '鬼灭之刃 祢豆子手办', brand: '万代', tags: ['二次元', '收藏', '动漫'], price: '150-350元', desc: '祢豆子/炭治郎造型手办，鬼灭之刃粉丝收藏款', image: '/assets/goods/g20.png', ipNames: ['鬼灭之刃', '鬼灭', '祢豆子', '炭治郎'], kind: 'ip' },
  { id: 'g21', name: '明日方舟 干员立牌', brand: '鹰角', tags: ['二次元', '游戏', '收藏', '桌搭'], price: '80-200元', desc: '阿米娅等干员亚克力立牌，桌面桌搭装饰佳品', image: '/assets/goods/g21.png', ipNames: ['明日方舟', '舟游', '阿米娅'], kind: 'ip' },
  { id: 'g22', name: '宝可梦 精灵球收藏摆件', brand: 'TOMY', tags: ['二次元', '收藏', '可爱'], price: '100-300元', desc: '皮卡丘主题精灵球收藏摆件，可爱又值得收藏', image: '/assets/goods/g22.png', ipNames: ['宝可梦', '精灵宝可梦', '皮卡丘', 'pokemon'], kind: 'ip' }
];

// 在 matchGoods 中命中 IP 时给"周边/联名"类商品加成
const IP_BOOST = 6;

// 解析商品价格字符串（如 "399-599元" / "150-300元"）为数值范围 [min, max]
function parsePrice(str) {
  const m = String(str || '').match(/(\d+(?:\.\d+)?)\s*[-~]\s*(\d+(?:\.\d+)?)/);
  if (m) return [parseFloat(m[1]), parseFloat(m[2])];
  const n = String(str || '').match(/(\d+(?:\.\d+)?)/);
  if (n) return [parseFloat(n[1]), parseFloat(n[1])];
  return null;
}

// 基于风格标签匹配商品；styleTags 来自 AI 识别出的风格关键词
// priceRange: { min, max } 可选，过滤商品价格区间（与预算有交集才保留，无约束则全量）
// ip: 可选，识别到的明星/动漫/角色 IP（字符串或 {name,type}），命中时给"周边/联名/收藏"类商品加权
function matchGoods(styleTags, targetCount = 8, priceRange, ip) {
  const tags = (styleTags || []).map(t => String(t).toLowerCase());
  const ipName = ip ? (typeof ip === 'string' ? ip : (ip.name || '')) : '';
  const ipType = ip && typeof ip === 'object' ? (ip.type || '') : '';
  const ipHit = ipName.trim();
  let scored = GOODS.map(g => {
    let score = 0;
    g.tags.forEach(t => {
      if (tags.includes(String(t).toLowerCase())) score += 2;
      // 部分匹配（如"游戏"与"二次元"）
      if (tags.some(s => s.includes(String(t).toLowerCase()) || String(t).toLowerCase().includes(s))) score += 1;
    });
    // IP 命中：优先"周边/联名/收藏"类商品（kind==='ip'），且 IP 名/类型命中该商品标签
    if (ipHit) {
      const gTags = g.tags.map(x => String(x).toLowerCase()).join('/');
      if (g.kind === 'ip') score += IP_BOOST;
      // 如动漫/明星与"二次元/潮玩/收藏"类相互印证，额外加成
      if ((/二次元|动漫|明星|爱豆|影视/.test(ipType + ipHit)) && /二次元|潮玩|收藏|国风|周边/.test(gTags)) score += 2;
    }
    // IP 名称精确命中：ip 为对象 {name, work, type} 时，其 name 或 work 与商品 ipNames 中任一别名做大小写不敏感的双向子串匹配，命中给高权重（确保进入 Top 8）
    const ipWork = ip && typeof ip === 'object' ? (ip.work || '') : '';
    const ipHitL = ipHit ? ipHit.toLowerCase() : '';
    const ipWorkL = ipWork ? String(ipWork).toLowerCase() : '';
    let ipMatch = false;
    if ((ipHitL || ipWorkL) && Array.isArray(g.ipNames) && g.ipNames.length) {
      ipMatch = g.ipNames.some(alias => {
        const a = String(alias).toLowerCase();
        return (ipHitL && (a.includes(ipHitL) || ipHitL.includes(a))) ||
               (ipWorkL && (a.includes(ipWorkL) || ipWorkL.includes(a)));
      });
      if (ipMatch) score += 30;
    }
    // ipMatch 为内部布尔标记（不含任何名称），供调用方识别"本次精确命中的 IP 周边商品"以做榜单守护
    return ipMatch ? { ...g, score, ipMatch: true } : { ...g, score };
  });

  // 价格约束过滤：商品价格区间与预算区间有交集才保留
  if (priceRange && (priceRange.min != null || priceRange.max != null)) {
    const min = priceRange.min != null ? Number(priceRange.min) : 0;
    const max = priceRange.max != null ? Number(priceRange.max) : Infinity;
    const inBudget = g => {
      const pr = parsePrice(g.price);
      if (!pr) return true; // 无价格数据不误杀
      return pr[0] <= max && pr[1] >= min;
    };
    scored = scored.filter(inBudget);
    // 若按风格+价格过滤后不足目标数，从全库按价格区间补齐候选（风格分较低）
    if (scored.length < Math.min(targetCount, 3)) {
      const fallback = GOODS.filter(g => !scored.some(s => s.id === g.id) && inBudget(g))
        .map(g => ({ ...g, score: 0 }));
      scored = scored.concat(fallback);
    }
  }

  scored.sort((a, b) => b.score - a.score);
  // 剔除内部字段 ipNames，避免传给前端推荐逻辑
  return scored.slice(0, targetCount).map(({ ipNames, ...rest }) => rest);
}

module.exports = { GOODS, matchGoods, parsePrice };
