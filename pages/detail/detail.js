// pages/detail/detail.js
const api = require('../../utils/api');

Page({
  data: {
    good: null,
    reason: '',
    talk: '',
    cardText: '',
    loadingCard: false
  },

  onLoad(options) {
    const data = getApp().globalData.lastAnalyze;
    const goodId = options.good_id;
    const reason = decodeURIComponent(options.reason || '');
    const good = (data && data.rank || []).find(g => g.id === goodId)
      || (data && data.rank || [])[0]
      || null;
    this.setData({
      good,
      reason,
      talk: (data && data.talk) || '',
      persona: (data && data.persona) || null
    });
  },

  // 商品图加载失败：隐藏图片，切换为占位块（显示商品名/编号）
  onGoodImgError() {
    if (!this.data.good) return;
    this.setData({ 'good.imgFailed': true });
  },

  // 一键复制送礼话术
  copyTalk() {
    const text = this.data.talk || this.data.reason;
    if (!text) return;
    wx.setClipboardData({ data: text });
  },

  // AI 生成电子贺卡文案
  async genCard() {
    const cfg = api.getConfig();
    if (!cfg.base_url || !cfg.api_key) {
      wx.showToast({ title: '请先到设置页填配置', icon: 'none' });
      return;
    }
    if (!this.data.good) return;
    this.setData({ loadingCard: true });
    try {
      const p = this.data.persona || {};
      const g = this.data.good;
      const prompt = `请根据收礼人画像${JSON.stringify(p)}和礼物"${g.name}(${g.brand})"，生成一张电子贺卡的文案，风格符合收礼人审美，字数80字内，含1-2句高情商祝福。只输出贺卡文案正文，不要标题。`;
      const text = await api.chat({ model: cfg.text_model, messages: [{ role: 'user', content: prompt }] });
      this.setData({ cardText: text.replace(/^[\"'【\[\]]+|[\"'】\]\]]+$/g, '') });
    } catch (e) {
      wx.showToast({ title: (e && e.msg) || '生成失败', icon: 'none' });
    } finally {
      this.setData({ loadingCard: false });
    }
  },

  copyCard() {
    if (!this.data.cardText) return;
    wx.setClipboardData({ data: this.data.cardText });
  }
});
