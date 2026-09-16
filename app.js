// app.js
// 引入本地内置配置（utils/config.local.js，内含用户提供的智谱 Key）
// 该文件不提交公开仓库；如需改为纯运行时填写，删除 config.local.js 即可回退
const localCfg = require('./utils/config.local');

App({
  globalData: {
    // 会话期间缓存的分析结果，避免结果页重复请求
    lastAnalyze: null
  },
  onLaunch() {
    // 初始化配置默认值：默认值来自本地内置配置，其次保留用户设置页已保存内容
    const saved = wx.getStorageSync('muse_config');
    const defaults = Object.assign(
      {
        base_url: '',
        api_key: '',
        vision_model: 'glm-4v-flash',
        text_model: 'glm-4-flash'
      },
      localCfg || {}
    );
    // 字段级合并：用户显式保存过且非空的字段优先，其余回退到内置默认值
    // 避免 storage 残留空字段时把内置 Key 覆盖为空
    const merged = Object.assign({}, defaults);
    if (saved && typeof saved === 'object') {
      Object.keys(defaults).forEach((k) => {
        if (saved[k] !== undefined && saved[k] !== null && saved[k] !== '') {
          merged[k] = saved[k];
        }
      });
    }
    wx.setStorageSync('muse_config', merged);
  }
});
