// pages/result/result.js
Page({
  data: {
    persona: null,
    ip: null,
    rank: [],
    avoid: [],
    talk: '',
    showAvoid: false
  },

  onLoad() {
    const data = getApp().globalData.lastAnalyze;
    if (!data) {
      wx.showToast({ title: '暂无分析结果', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 600);
      return;
    }
    this.setData(data);
  },

  toggleAvoid() {
    this.setData({ showAvoid: !this.data.showAvoid });
  },

  goDetail(e) {
    const idx = e.currentTarget.dataset.idx;
    const item = this.data.rank[idx];
    if (!item) return;
    wx.navigateTo({ url: '/pages/detail/detail?good_id=' + item.id + '&reason=' + encodeURIComponent(item.reason || '') });
  },

  reAnalyze() {
    wx.navigateBack();
  }
});
