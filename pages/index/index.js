// pages/index/index.js
const api = require('../../utils/api');
const face = require('../../utils/face');
const { matchGoods } = require('../../utils/goods');
const { combineImages, compressImages } = require('../../utils/image');
const { cleanTags } = require('../../utils/tags');
const { generateRecommendations, SCENES, getSceneGuide } = require('../../utils/recommend');

// 统一 IP 输出结构：string → {name,work,type}；空/无意义 → null
function normalizeIp(ip) {
  if (!ip) return null;
  if (typeof ip === 'string') {
    const s = ip.trim();
    if (!s || /^null$|^none$|^无$|^没有$|^不确定$|^无法识别$/.test(s)) return null;
    return { name: s, work: '', type: '' };
  }
  if (typeof ip === 'object') {
    const name = String(ip.name || '').trim();
    if (!name || /^null$|^none$|^无$|^没有$|^不确定$|^无法识别$/.test(name)) return null;
    return {
      name,
      work: String(ip.work || '').trim(),
      type: String(ip.type || '').trim()
    };
  }
  return null;
}

// 置信度容错：模型可能返回 0.85 / "0.85" / 85 / "85%" / 缺失
function normalizeConf(v, def) {
  if (v === undefined || v === null || v === '') return def == null ? 0 : def;
  if (typeof v === 'string') {
    const s = v.trim().replace('%', '');
    const n = parseFloat(s);
    if (isNaN(n)) return def == null ? 0 : def;
    return s.indexOf('%') >= 0 ? n / 100 : (n > 1 ? n / 100 : n);
  }
  if (typeof v === 'number') return v > 1 ? v / 100 : v;
  return def == null ? 0 : def;
}

// 词条统一清洗已收敛到 utils/tags.js（cleanTags），全链路共用同一份逻辑，
// 避免首页/结果页各写一份导致行为漂移。见 utils/tags.js 顶部注释。

// 粗粒度判同名（去空格、去括号后缀、忽略「老师/先生」等）
function sameName(a, b) {
  const norm = s => String(s || '').replace(/[\s·・.。()（）]/g, '').replace(/(老师|先生|女士|小姐)$/,'').toLowerCase();
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  return x === y || x.indexOf(y) >= 0 || y.indexOf(x) >= 0;
}

/**
 * 决定最终采用哪个 IP —— 宁缺毋滥，宁可说"没认出来"，也不认错人。
 *
 * 【实测依据 2026-09-23】拿 4 张明星图跑火山方舟这套模型：
 *   · 中国演员能认对且稳定（章若楠 0.98、张凌赫 0.8）；
 *   · 但同一张韩国偶像的图，三次跑出三个不同名字 —— 它在编。
 * 结论：两路回答一致最可信；单路只有高置信度时才可采信。
 *
 * 【2026-09-24 放宽（用户确认）】此前 strict=true 时"只有一路有名"一律弃用，
 * 导致识别出的 IP 常被误杀、推荐退化为纯画像（用户反馈"跟明星 IP 零关联"）。
 * 现改为：单路有值且置信度 ≥ minConf 即可采信；仍保留"两路不同名必弃"的防编造底线。
 *
 * strict（已合并，保留参数以兼容配置）：
 *   1. 两路同名            → 采用（最可信）
 *   2. 两路都有名但不同名   → 判定为"有人在编"，一律弃用（不管置信度多高）
 *   3. 只有一路有名且过阈值 → 采用那一路（置信度由 minConf 把关，默认 0.8）
 *   4. 都没名 / 不过阈值    → null
 */
function decideIp(ipMain, confMain, ipVerify, confVerify, minConf, strict) {
  const has = x => x && x.name;
  const agree = has(ipMain) && has(ipVerify) && sameName(ipMain.name, ipVerify.name);
  if (agree) {
    return {
      ip: confVerify >= confMain ? ipVerify : ipMain,
      conf: Math.max(confMain, confVerify),
      via: 'both'
    };
  }
  // 两路都报了名字却对不上 → 一定有一路在编，全部弃用（不管置信度多高）
  if (has(ipMain) && has(ipVerify)) return { ip: null, conf: 0, via: 'conflict' };
  // 单路有值且过阈值 → 采信（strict / non-strict 同逻辑，阈值由调用方控制）
  if (has(ipVerify) && confVerify >= minConf) return { ip: ipVerify, conf: confVerify, via: 'verify' };
  if (has(ipMain) && confMain >= minConf) return { ip: ipMain, conf: confMain, via: 'main' };
  return { ip: null, conf: 0, via: 'none' };
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
    scenes: SCENES,
    scene: 'general',   // 场景预设：general/boyfriend/girlfriend/elder/colleague
    loading: false,
    progressText: '',   // 分析中的分阶段进度文案（替代空白等待）
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
        // 选图后立即压缩（目标：最长边 ≤2000px、体积 ≤1MB），失败自动回退原图
        wx.showLoading({ title: '压缩图片中…', mask: true });
        compressImages(paths).then(cpaths => {
          wx.hideLoading();
          this.setData({ images: this.data.images.concat(cpaths) });
        });
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
    this.setData({ loading: true, progressText: '正在压缩图片…' });
    try {
      // 1. 多图先本地拼接为一张组合图（视觉模型单次请求通常只支持 1 张图），再转 base64
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
      //    同时并行发起「人脸库识别」——它比视觉模型认人可靠得多（有阈值、有数字、可解释）
      this.setData({ progressText: '正在识别图片内容…' });
      const facePromise = face.recognize(b64s[0]);   // 内部永不 reject，没配则立即返回 null
      const visionMsg = this.buildVisionContent(b64s, clueText, checkedTags, cfg, this.data.scene);
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
      // 词条规范化（关键修复）：模型可能返回斜杠分隔字符串，wx:for 会按单字渲染；
      // 这里统一清洗为 2-4 字中文词组数组，并砍掉一半数量（每类最多 8 个）
      analysis.style = cleanTags(analysis.style, 8);
      analysis.personality = cleanTags(analysis.personality, 8);
      analysis.interests = cleanTags(analysis.interests, 8);
      analysis.forbidden = cleanTags(analysis.forbidden, 6);
      // 无论模型输出何种 ip 形态，统一规范为 {name,work,type} 或 null
      const ipMain = normalizeIp(analysis.ip);
      const confMain = normalizeConf(analysis.ip_confidence, 0.5);

      // 3.05 人脸库识别结果（最可靠的一路，优先级最高）
      //      实测：同一人 0.513 ✅ / 不同人 0.173 ⛔（阈值 0.32），分界干净。
      this.setData({ progressText: '正在比对人物库…' });
      const faceResult = await facePromise;
      const faceIp = face.toIp(faceResult);

      // 3.2 IP 二次复核
      //     主模型那个 Prompt 一次要干 4 件事，IP 只是其中一个字段，容易被忽略；
      //     这里用「专做认人」的聚焦提问再来一次。
      //     ⚠️ 人脸库已经命中时直接跳过 —— 它更可信，没必要再花钱问模型。
      let ipVerify = null, confVerify = 0;
      if (!faceIp && cfg.ip_verify) {
        try {
          const v = await this.verifyIp(b64s, cfg, clueText);
          ipVerify = normalizeIp(v);
          confVerify = normalizeConf(v && v.confidence, 0);
        } catch (e) {
          console.warn('[muse] IP 复核请求失败，跳过：', e && e.msg);
        }
      }

      const ipStrict = cfg.ip_strict !== false; // 默认严格模式：两路一致才采信
      const ipMinConf = cfg.ip_min_confidence != null ? cfg.ip_min_confidence : 0.8;
      const ipDecision = decideIp(ipMain, confMain, ipVerify, confVerify, ipMinConf, ipStrict);
      // 最终优先级：人脸库命中 > 视觉模型两路判定
      analysis.ip = faceIp || ipDecision.ip;

      // 把中间过程留着，便于在控制台排查"为什么没认出人"
      analysis.__ipDebug = {
        face: faceResult ? { hit: faceResult.hit, name: faceResult.name,
                             sim: faceResult.sim, margin: faceResult.margin } : '未启用',
        main: ipMain, mainConf: confMain,
        verify: ipVerify, verifyConf: confVerify,
        strict: ipStrict, minConf: ipMinConf,
        via: faceIp ? 'face' : ipDecision.via
      };
      console.log('[muse] IP 判定：', JSON.stringify(analysis.__ipDebug));

      // 3.5 预算区间
      const priceRange = this.getPriceRange();
      // 4. 本地商品库匹配（支持按预算过滤；识别到明星/动漫 IP 时优先周边/联名）
      const styleTags = (analysis.style || []).concat(analysis.interests || []);
      const matches = matchGoods(styleTags, 8, priceRange, analysis.ip);
      // 5. 文本模型生成推荐理由 + 排行（把候选商品给模型排序与写理由）
      this.setData({ progressText: '正在生成推荐理由…' });
      const final = await this.buildRecommendations(analysis, matches, checkedTags, clueText, priceRange);

      // 缓存结果 + 上下文（供结果页"不满意"重生成复用：候选商品/画像/预算/线索/场景）
      final.matches = matches;
      final.priceRange = priceRange;
      final.checkedTags = checkedTags;
      final.clueText = clueText;
      final.scene = this.data.scene;
      final.analysis = {
        style: analysis.style,
        personality: analysis.personality,
        interests: analysis.interests,
        forbidden: analysis.forbidden,
        summary: analysis.summary,
        evidence: analysis.evidence,
        ip: analysis.ip
      };
      getApp().globalData.lastAnalyze = final;
      wx.navigateTo({ url: '/pages/result/result' });
    } catch (e) {
      wx.showToast({ title: (e && e.msg) || '分析失败，请重试', icon: 'none' });
    } finally {
      this.setData({ loading: false, progressText: '' });
    }
  },

  /**
   * IP 专用复核：只问一件事——照片里有没有可辨识的公众人物 / 角色？
   * 有 → 给名字 + 所属作品 + 置信度；没有或不确定 → 明确返回 null。
   * 配了第二路模型（vision_model_2）就用它，否则复用主模型。
   */
  async verifyIp(b64s, cfg, clueText) {
    const useSecond = !!(cfg.vision_base_url_2 && cfg.vision_api_key_2 && cfg.vision_model_2);
    const prefix = useSecond ? (cfg.image_prefix_2 || 'data') : (cfg.image_prefix || 'data');
    const contentPart = b64s.map(b => ({
      type: 'image_url',
      image_url: { url: api.buildImageUrl(b, prefix) }
    }));
    // 【重要，2026-09-23 实测】这段问法必须保持"中性"。
    // 之前写过一版「不确定就填 null / 不要猜」的强约束版，结果模型被吓住，
    // 4 张明星图全部返回 null；换成下面这种中性问法后，
    // 章若楠拿到 0.98、张凌赫拿到 0.8。措辞太保守会直接废掉这个功能。
    const ask = [
      '这张照片里的主体人物是谁？',
      '如果认出是公众人物（明星/艺人/偶像/运动员/企业家）或知名虚拟角色（动漫/游戏/影视 IP），请直接说出姓名和所属领域；不要因为谨慎而回避回答。',
      '如果确实认不出、或只是普通人，name 填 null，不要编造。',
      '忽略图片上的水印、字幕、账号 ID 等文字信息，只看人脸和人物本身。',
      clueText ? '用户补充线索：' + clueText : '',
      '只输出 JSON：{"name":"姓名或null","work":"所属作品/领域","type":"明星|动漫|影视|游戏|其他","confidence":0到1之间的小数}'
    ].filter(Boolean).join('\n');
    contentPart.push({ type: 'text', text: ask });

    const raw = await api.chat(
      {
        model: useSecond ? cfg.vision_model_2 : cfg.vision_model,
        temperature: 0.1,
        messages: [
          { role: 'system', content: '你是人物识别助手，只输出 JSON。不确定时必须返回 null，绝不编造姓名。' },
          { role: 'user', content: contentPart }
        ]
      },
      useSecond ? { base_url: cfg.vision_base_url_2, api_key: cfg.vision_api_key_2, model: cfg.vision_model_2 } : null
    );
    return api.extractJson(raw);
  },

  // 构造多模态消息（图片 + 文字线索）
  buildVisionContent(b64s, clueText, checkedTags, cfg, scene) {
    const prefix = (cfg && cfg.image_prefix) || 'data';
    const contentPart = [];
    b64s.forEach(b => {
      contentPart.push({ type: 'image_url', image_url: { url: api.buildImageUrl(b, prefix) } });
    });
    const textPart = [
      '请逐个仔细分析这些照片：1) 识别图中的具体元素（如动漫海报、穿搭风格、颜色、物品），指出每个元素可能来自哪个作品/风格/品牌；',
      '2) IP 识别（重要）：请逐张核查照片，只要出现任何可辨识的真实明星、动漫人物/角色、游戏角色、影视 IP、知名品牌角色形象（如明星照片、角色海报、手办立牌、卡通形象等），就必须识别其确切名称与所属作品，填入 ip 字段；多个 IP 只填最明显的一个；只有确认图中没有任何可辨识人物/IP 角色时才填 null，不要漏报；',
      '3) 根据照片与以下线索，推测照片主人的性格、兴趣、审美偏好；',
      '4) 忽略图片上的水印、字幕、账号 ID 等文字信息，只看画面内容本身；',
      '5) 输出 JSON 格式：{"style":["风格关键词数组"],"personality":["性格"],"interests":["兴趣"],"forbidden":["可能不喜欢的类型"],"evidence":{"元素":"推断来源"},"summary":"50字内整体画像","ip":{"name":"人物/角色名","work":"所属作品/领域","type":"明星|动漫|影视|游戏|其他"},"ip_confidence":0到1之间的小数}。未识别到 IP 时 ip 填 null',
      '6) 词条书写规范（重要）：style 最多 6 个、personality 最多 4 个、interests 最多 6 个、forbidden 最多 3 个；每个词条必须是 2-4 字的完整中文词组（如"轻奢""正装""动漫周边"），严禁输出单个汉字，严禁用 / 、 等符号把多个词拼成一个字符串——每个词独立作为数组的一个元素。宁缺毋滥，写最有代表性的。',
      '注意：认得出就直接填，不要因为过度谨慎而留空；但认不出时也不要硬凑一个名字。'
    ];
    const sceneText = getSceneGuide(scene);
    if (sceneText) textPart.push('场景设定：' + sceneText + '；在推测性格、兴趣与后续推荐时请贴合该场景。');
    if (checkedTags.length) textPart.push('用户补充线索：' + checkedTags.join('、'));
    if (clueText) textPart.push('用户补充描述：' + clueText);
    contentPart.push({ type: 'text', text: textPart.join('\n') });
    return contentPart;
  },

  // 用文本模型生成最终推荐（排行/理由），并给出送礼话术
  // 逻辑已收敛到 utils/recommend.js（generateRecommendations），
  // 首页首次分析与结果页"不满意"重生成共用同一份实现，避免漂移。
  async buildRecommendations(analysis, matches, checkedTags, clueText, priceRange) {
    return generateRecommendations({
      analysis, matches, checkedTags, clueText, priceRange,
      scene: this.data.scene
    });
  },

  // 场景预设快捷切换（送男友/送女友/送长辈/送同事/通用）
  onSceneTap(e) {
    if (this.data.loading) return;
    const key = e.currentTarget.dataset.key;
    this.setData({ scene: key });
  },

  goSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' });
  }
});
