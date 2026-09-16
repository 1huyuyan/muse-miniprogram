// pages/settings/settings.js
Page({
  data: {
    cfg: {
      base_url: '',
      api_key: '',
      vision_model: 'glm-4v-flash',
      text_model: 'glm-4-flash'
    }
  },

  onLoad() {
    this.setData({ cfg: wx.getStorageSync('muse_config') || this.data.cfg });
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`cfg.${field}`]: e.detail.value });
  },

  save() {
    const c = this.data.cfg;
    if (!c.base_url.trim() || !c.api_key.trim()) {
      wx.showToast({ title: '接口地址和 Key 必填', icon: 'none' });
      return;
    }
    wx.setStorageSync('muse_config', c);
    wx.showToast({ title: '已保存', icon: 'success' });
  },

  clear() {
    wx.showModal({
      title: '清除配置',
      content: '将清空本地保存的接口地址和 Key',
      success: r => {
        if (r.confirm) {
          wx.removeStorageSync('muse_config');
          this.setData({ cfg: { base_url: '', api_key: '', vision_model: 'glm-4v-flash', text_model: 'glm-4-flash' } });
          wx.showToast({ title: '已清除', icon: 'success' });
        }
      }
    });
  }
});
