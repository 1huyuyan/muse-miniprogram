// pages/index/index.js
const api = require('../../utils/api');
const { matchGoods } = require('../../utils/goods');
const { combineImages } = require('../../utils/image');

// 统一 IP 输出结构：string → {name,work,type}；空/无意义 → null
function normalizeIp(ip) {
  if (!ip) return null;
  if (typeof ip === 'string') {
    const s = ip.trim();
    if (!s || /^null$|^none$|^无$|^没有$/i.test(s)) return null;
    return { name: s, work: '', type: '' };
  }
  if (typeof ip === 'object') {
    const name = String(ip.name || '').trim();
    if (!name || /^null$|^none$|^无$|^没有$/i.test(name)) return null;
    return {
      name,
      work: String(ip.work || '').trim(),
      type: String(ip.type || '').trim()
    };
  }
  return null;
}

const PRESET_TAGS = [
  '平时喜欢打游戏',
  '最近刚换了工作',
  '不喜欢太花哨的东西',
  '想要实用派礼物',
  '喜欢二次元/动漫',
  '注重穿搭/潮流',
  '喜欢宅家文艺',
  '经常运动健身'
];

Page({
  data: {
    images: [],        // 本地图片路径
    input: '',         // 输入框内容
    minPrice: '',      // 预算最低价（可选）
    maxPrice: '',      // 预算最高价（可选）
    tags: PRESET_TAGS.map(t => ({ text: t, checked: false })),
    loading: false,
    latestIndex: 0
  },

  onLoad() {
    // 校验配置
    const cfg = api.getConfig();
    if (!cfg.base_url || !cfg.api_key) {
      wx.showToast({ title: '请先到设置页填写接口配置', icon: 'none' });
    }
  },

  // 选择图片（最多9张）
  chooseImages() {
    if (this.data.loading) return;
    const remain = 9 - this.data.images.length;
    if (remain <= 0) {
      wx.showToast({ title: '最多上传9张图片', icon: 'none' });
      return;
    }
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: res => {
        let paths = res.tempFiles.map(f => f.tempFilePath);
        // 兜底保护：合并后仍不能超过 9 张，超出则截断并提示
        const total = this.data.images.length + paths.length;
        if (total > 9) {
          paths = paths.slice(0, 9 - this.data.images.length);
          wx.showToast({ title: '最多可上传9张照片', icon: 'none' });
        }
        this.setData({ images: this.data.images.concat(paths) });
      }
    });
  },

  removeImage(e) {
    const idx = e.currentTarget.dataset.idx;
    const images = this.data.images.slice();
    images.splice(idx, 1);
    this.setData({ images });
  },

  onInput(e) {
    this.setData({ input: e.detail.value });
  },

  onPriceInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [field]: e.detail.value });
  },

  // 解析预算区间为 { min, max }，未填的一端不限；都没填返回 null
  getPriceRange() {
    const min = parseFloat(this.data.minPrice);
    const max = parseFloat(this.data.maxPrice);
    if (isNaN(min) && isNaN(max)) return null;
    return { min: isNaN(min) ? 0 : min, max: isNaN(max) ? Infinity : max };
  },

  toggleTag(e) {
    const idx = e.currentTarget.dataset.idx;
    this.setData({ [`tags[${idx}].checked`]: !this.data.tags[idx].checked });
  },

  // 核心：分析并推荐
  async analyze() {
    if (this.data.loading) return;
    if (!this.data.images.length) {
      wx.showToast({ title: '请先上传朋友的照片', icon: 'none' });
      return;
    }
    const cfg = api.getConfig();
    if (!cfg.base_url || !cfg.api_key) {
      wx.showToast({ title: '请先到设置页填写接口配置', icon: 'none' });
      return;
    }
    this.setData({ loading: true });
    try {
      // 1. 多图先本地拼接为一张组合图（GLM-4V 单次请求仅支持 1 张图片，否则 1210 参数错误），再转 base64
      const combined = await combineImages(this.data.images);
      const b64s = [];
      if (combined) {
        b64s.push(await api.imageToBase64(combined));
      } else {
        // 拼接异常时的兜底：退回逐张发送（多图场景仍可能被接口拒绝）
        for (const p of this.data.images) {
          b64s.push(await api.imageToBase64(p));
        }
      }
      // 2. 收集线索
      const checkedTags = this.data.tags.filter(t => t.checked).map(t => t.text);
      const clueText = this.data.input.trim();
      // 3. 多模态分析：识别图片元素+风格，输出结构化 JSON
      const visionMsg = this.buildVisionContent(b64s, clueText, checkedTags);
      const analysisRaw = await api.chat({
        model: cfg.vision_model,
        messages: [
          { role: 'system', content: '你是资深送礼顾问，擅长从照片中识别对方的风格偏好。只输出 JSON，不要多余文字。' },
          { role: 'user', content: visionMsg }
        ]
      });
      const analysis = api.extractJson(analysisRaw) || {
        style: [], personality: [], interests: [], forbidden: [], summary: '未能解析模型结果', ip: null
      };
      // 无论模型输出何种 ip 形态，统一规范为 {name,work,type} 或 null，避免"识别到但结构不对导致不生效"
      analysis.ip = normalizeIp(analysis.ip);
      // 3.5 预算区间
      const priceRange = this.getPriceRange();
      // 4. 本地商品库匹配（支持按预算过滤；识别到明星/动漫 IP 时优先周边/联名）
      const styleTags = (analysis.style || []).concat(analysis.interests || []);
      const matches = matchGoods(styleTags, 8, priceRange, analysis.ip);
      // 5. 文本模型生成推荐理由 + 排行 + 避雷（把候选商品给模型排序与写理由）
      const final = await this.buildRecommendations(analysis, matches, checkedTags, clueText, priceRange);

      // 缓存结果，跳转结果页
      getApp().globalData.lastAnalyze = final;
      wx.navigateTo({ url: '/pages/result/result' });
    } catch (e) {
      wx.showToast({ title: (e && e.msg) || '分析失败，请重试', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  // 构造多模态消息（图片 + 文字线索）
  buildVisionContent(b64s, clueText, checkedTags) {
    const contentPart = [];
    b64s.forEach(b => {
      contentPart.push({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + b } });
    });
    const textPart = [
      '请逐个仔细分析这些照片：1) 识别图中的具体元素（如动漫海报、穿搭风格、颜色、物品），指出每个元素可能来自哪个作品/风格/品牌；',
      '2) IP 识别（重要）：请逐张核查照片，只要出现任何可辨识的真实明星、动漫人物/角色、游戏角色、影视 IP、知名品牌角色形象（如明星照片、角色海报、手办立牌、卡通形象等），就必须识别其确切名称与所属作品，填入 ip 字段；多个 IP 只填最明显的一个；只有确认图中没有任何可辨识人物/IP 角色时才填 null，不要漏报；',
      '3) 根据照片与以下线索，推测照片主人的性格、兴趣、审美偏好；',
      '4) 输出 JSON 格式：{"style":["风格关键词数组"],"personality":["性格"],"interests":["兴趣"],"forbidden":["可能不喜欢的类型"],"evidence":{"元素":"推断来源"},"summary":"50字内整体画像","ip":{"name":"人物/角色名","work":"所属作品/领域","type":"明星|动漫|影视|游戏|其他"}}。未识别到 IP 时 ip 填 null'
    ];
    if (checkedTags.length) textPart.push('用户补充线索：' + checkedTags.join('、'));
    if (clueText) textPart.push('用户补充描述：' + clueText);
    contentPart.push({ type: 'text', text: textPart.join('\n') });
    return contentPart;
  },

  // 用文本模型生成最终推荐（排行/避雷/理由），并给出送礼话术
  // priceRange: { min, max } 可选预算区间，用于约束推荐结果
  async buildRecommendations(analysis, matches, checkedTags, clueText, priceRange) {
    const cfg = api.getConfig();
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
    // 识别到明星/动漫/etc IP 时，引导模型优先其周边/联名/代言
    const ip = analysis && analysis.ip && (analysis.ip.name || '').trim() ? analysis.ip : null;
    let ipText = '';
    if (ip) {
      ipText = `\n收礼人明显喜欢以下 IP/角色：「${ip.name}」(${ip.work || ''}，类型：${ip.type || '其他'})。请优先把与「${ip.name}」相关的周边、联名、代言、收藏类商品排上推荐，并在推荐理由中点名该 IP 及图中依据；显得更有个人化心意。`;
    }
    const prompt = `以下是候选商品清单：\n${goodsBrief}\n\n收礼人画像：${JSON.stringify(guide)}${ipText}\n请从清单中选择最合适的 3 个作为推荐榜（Top1-3）${budgetText}，选 2 个作为避雷榜。给每个推荐商品写一段 60 字内的"推荐理由"，必须满足：① 理由描述的就是该商品本身（引用上面清单"特点"栏，如写"机械键盘"就讲机械键盘自身的特性，禁止写另一个商品的特征）；② 引述图中的具体证据（如"照片出现某海报/穿搭风格"）建立信任感。只输出 JSON（good_id 必须使用候选清单里的编号，如 g01；每条 reason 必须与同一 good_id 的商品对应）：{"rank":[{"good_id":"","reason":""}...],"avoid":[{"good_id":"","reason":""}...],"talk":"一句高情商送礼开场话术"}`;
    const raw = await api.chat({
      model: cfg.text_model,
      messages: [{ role: 'user', content: prompt }]
    });
    const parsed = api.extractJson(raw);
    // good_id 容错匹配：先按原始 id 精确匹配，再尝试 "1"/"g1"/商品名/序号等多种写法
    const resolveGood = (id, matches) => {
      if (!id) return null;
      const s = String(id).trim();
      const exact = matches.find(m => m.id === s || m.id === s.replace(/^g0/i, 'g'));
      if (exact) return exact;
      const num = (s.match(/^g?(\d+)$/i) || [])[1];
      const byNum = num ? matches.find(m => m.id === 'g' + String(parseInt(num, 10)).padStart(2, '0')) : null;
      if (byNum) return byNum;
      return matches.find(m => m.name === s) || null;
    };
    // 理由-商品一致性校验（问题1核心修复）：
    // 模型的 reason 必须与该商品自身特征（名称/品牌/标签/desc 片段）相关，
    // 否则判定为模型张冠李戴（错配），回退为该商品自身特征生成的确定性理由，
    // 保证"每条推荐理由描述的就是对应商品本身"。
    const ensureReason = (g, reason) => {
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
    };
    const build = (g, reason) => ({ ...g, good_id: g.id, reason: ensureReason(g, reason) });
    const parsedRank = (parsed && parsed.rank || []).map(r => {
      const g = resolveGood(r.good_id, matches);
      return g ? build(g, r.reason) : null;
    }).filter(Boolean);
    // IP 榜单守护（问题2修复）：识别到 IP 时，若模型选出的榜单里没有该 IP 的周边/联名商品，
    // 则把匹配阶段命中该 IP 的周边商品（ipMatch 精确命中，或兜底首个 kind==='ip' 商品）强制置顶，
    // 确保识别到 IP 就一定有联名/周边推荐；IP 商品即便被模型选中也排在首位。
    const rank = [];
    if (ip) {
      const ipGood = matches.find(m => m.ipMatch === true) || matches.find(m => m.kind === 'ip');
      if (ipGood) {
        const existed = parsedRank.find(x => x.id === ipGood.id);
        rank.push(existed || build(ipGood,
          `图中识别出「${ip.name}」${ip.work ? '(' + ip.work + ')' : ''}，本品正是其官方周边/联名款，投其所好更显心意`));
      }
    }
    rank.push(...parsedRank.filter(g => !rank.some(f => f.id === g.id)));
    const mergedRank = rank.slice(0, 3);
    // 兜底：榜单仍不足 3 个时，按匹配分数从高到低补齐（reason 经 ensureReason 保证描述自身）
    for (const g of matches) {
      if (mergedRank.length >= 3) break;
      if (!mergedRank.some(f => f.id === g.id)) mergedRank.push(build(g, ''));
    }
    const avoid = (parsed && parsed.avoid || []).map(r => {
      const g = resolveGood(r.good_id, matches);
      return g ? build(g, r.reason) : null;
    }).filter(Boolean);
    return {
      persona: guide,
      ip,
      rank: mergedRank.slice(0, 3),
      avoid: avoid.length ? avoid.slice(0, 2) : [],
      talk: (parsed && parsed.talk) || '这份礼物想了好久，觉得特别适合你，希望你喜欢。'
    };
  },

  goSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' });
  }
});
