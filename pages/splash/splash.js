// pages/splash/splash.js
Page({
  data: {
    show: false,
    dot: 0
  },

  onReady() {
    this.setData({ show: true });
    // 等待画面停留 2.5 秒后进入首页
    setTimeout(() => {
      wx.redirectTo({ url: '/pages/index/index' });
    }, 2500);
  }
});
