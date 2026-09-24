// app.js
// 引入本地内置配置（utils/config.local.js）
// 该文件不提交公开仓库；如需改为纯运行时填写，删除 config.local.js 即可回退
const localCfg = require('./utils/config.local');

App({
  globalData: {
    // 会话期间缓存的分析结果，避免结果页重复请求
    lastAnalyze: null
  },

  onLaunch() {
    // 初始化微信云开发：IP 知识库检索走云函数 ipSearch（云端优先+本地回退）
    // env 不指定时使用默认环境；若账号下存在多个环境，可在 config.local.js 配置 cloud_env
    if (wx.cloud) {
      const env = (localCfg && localCfg.cloud_env) || undefined;
      wx.cloud.init(env ? { env, traceUser: true } : { traceUser: true });
    }
    // 初始化配置：默认值来自本地内置配置，其次保留用户设置页已保存内容
    const defaults = Object.assign(
      {
        base_url: '',
        api_key: '',
        vision_model: 'glm-4v-flash',
        text_model: 'glm-4-flash',
        image_prefix: 'data',
        vision_base_url_2: '',
        vision_api_key_2: '',
        vision_model_2: '',
        image_prefix_2: 'data',
        ip_strict: true,
        ip_min_confidence: 0.8,
        ip_verify: true,
        face_api_base: '',
        face_threshold: 0.32
      },
      localCfg || {}
    );

    const saved = wx.getStorageSync('muse_config');
    const localVer = (localCfg && localCfg.config_version) || 0;
    const savedVer = saved && typeof saved === 'object' ? saved.__config_version : undefined;

    // 【关键修复】内置配置的版本号变了 → 以 config.local.js 为准，强制覆盖旧缓存。
    // 否则会出现「明明改了 config.local.js 却怎么都不生效」的假故障：
    // 因为老逻辑是「缓存里非空字段优先」，而缓存里存着上次从内置配置写进去的旧值。
    const forceLocal = !!saved && savedVer !== localVer;

    const merged = Object.assign({}, defaults);
    if (saved && typeof saved === 'object' && !forceLocal) {
      // 字段级合并：用户显式保存过且非空的字段优先，其余回退到内置默认值
      // 避免 storage 残留空字段时把内置 Key 覆盖为空
      Object.keys(defaults).forEach((k) => {
        if (saved[k] !== undefined && saved[k] !== null && saved[k] !== '') {
          merged[k] = saved[k];
        }
      });
    }

    merged.__config_version = localVer;
    wx.setStorageSync('muse_config', merged);

    if (forceLocal) {
      console.log('[muse] 检测到内置配置版本更新（' + savedVer + ' → ' + localVer + '），已用 config.local.js 覆盖本地缓存');
    }
  }
});
