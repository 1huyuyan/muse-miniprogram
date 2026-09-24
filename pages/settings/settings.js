// pages/settings/settings.js

// 设置页默认值（也是"清除配置"后的状态）
const DEFAULT_CFG = {
  base_url: '',
  api_key: '',
  vision_model: 'glm-4v-flash',
  text_model: 'glm-4-flash',
  // 以下为新增配置项：本页不提供输入框，改在 utils/config.local.js 里改。
  // 这里保留默认值，是为了从本页保存时不把已有配置抹掉。
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
};

Page({
  data: {
    cfg: Object.assign({}, DEFAULT_CFG)
  },

  onLoad() {
    const saved = wx.getStorageSync('muse_config');
    // 与默认值合并，避免旧版本存的配置缺字段导致页面显示 undefined
    this.setData({ cfg: Object.assign({}, DEFAULT_CFG, saved || {}) });
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`cfg.${field}`]: e.detail.value });
  },

  save() {
    const c = this.data.cfg;
    if (!String(c.base_url || '').trim() || !String(c.api_key || '').trim()) {
      wx.showToast({ title: '接口地址和 Key 必填', icon: 'none' });
      return;
    }
    // 与已有缓存合并后再写，避免本页未渲染的字段（如 IP 复核配置）被覆盖丢失
    const merged = Object.assign({}, wx.getStorageSync('muse_config') || {}, c);
    wx.setStorageSync('muse_config', merged);
    this.setData({ cfg: merged });
    wx.showToast({ title: '已保存', icon: 'success' });
  },

  clear() {
    wx.showModal({
      title: '清除配置',
      content: '将清空本地保存的接口地址和 Key',
      success: r => {
        if (r.confirm) {
          wx.removeStorageSync('muse_config');
          this.setData({ cfg: Object.assign({}, DEFAULT_CFG) });
          wx.showToast({ title: '已清除', icon: 'success' });
        }
      }
    });
  }
});
