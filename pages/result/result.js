// pages/result/result.js
const api = require('../../utils/api');
const { cleanTags } = require('../../utils/tags');
const { generateRecommendations } = require('../../utils/recommend');

Page({
  // 词条清洗统一使用 utils/tags.js 的 cleanTags（全链路同一份逻辑）
  data: {
    persona: null,
    ip: null,
    rag: null,
    rank: [],
    talk: '',
    feedback: '',            // "不满意"补充要求输入
    feedbackLoading: false,  // 重生成中
    feedbackProgress: ''     // 重生成进度文案
  },

  onLoad() {
    const data = getApp().globalData.lastAnalyze;
    if (!data) {
      wx.showToast({ title: '暂无分析结果', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 600);
      return;
    }
    if (data.persona) {
      const p = data.persona;
      data.persona = Object.assign({}, p, {
        style: cleanTags(p.style, 8),
        interests: cleanTags(p.interests, 8),
        forbidden: cleanTags(p.forbidden, 6)
      });
    }
    // 保存完整上下文（候选商品/画像/预算/线索/场景），供"不满意"重生成复用
    this._last = data;
    this.setData(data);
  },

  goDetail(e) {
    const idx = e.currentTarget.dataset.idx;
    const item = this.data.rank[idx];
    if (!item) return;
    wx.navigateTo({ url: '/pages/detail/detail?good_id=' + item.id + '&reason=' + encodeURIComponent(item.reason || '') });
  },

  reAnalyze() {
    wx.navigateBack();
  },

  onFeedbackInput(e) {
    this.setData({ feedback: e.detail.value });
  },

  // "不满意"反馈：携带补充要求 + 上次分析上下文，重新生成一版精修推荐
  async submitFeedback() {
    if (this.data.feedbackLoading) return;
    const fb = (this.data.feedback || '').trim();
    if (!fb) {
      wx.showToast({ title: '请先输入补充要求', icon: 'none' });
      return;
    }
    const last = this._last;
    if (!last || !last.matches || !last.matches.length) {
      wx.showToast({ title: '缺少候选商品数据，请重新分析', icon: 'none' });
      return;
    }
    const cfg = api.getConfig();
    if (!cfg.base_url || !cfg.api_key) {
      wx.showToast({ title: '请先到设置页填写接口配置', icon: 'none' });
      return;
    }
    this.setData({ feedbackLoading: true, feedbackProgress: '正在按新要求重新生成…' });
    try {
      const analysis = last.analysis || {
        style: (last.persona && last.persona.style) || [],
        interests: (last.persona && last.persona.interests) || [],
        forbidden: (last.persona && last.persona.forbidden) || [],
        summary: (last.persona && last.persona.persona) || '',
        evidence: {},
        ip: last.ip
      };
      const final = await generateRecommendations({
        analysis,
        matches: last.matches,
        checkedTags: last.checkedTags || [],
        clueText: last.clueText || '',
        priceRange: last.priceRange || null,
        scene: last.scene || 'general',
        feedback: fb
      });
      // 同步刷新结果与上下文（二次反馈基于最新一版）
      final.matches = last.matches;
      final.priceRange = last.priceRange || null;
      final.checkedTags = last.checkedTags || [];
      final.clueText = last.clueText || '';
      final.scene = last.scene || 'general';
      final.analysis = analysis;
      this._last = final;
      getApp().globalData.lastAnalyze = final;
      this.setData({
        persona: final.persona,
        ip: final.ip,
        rag: final.rag || null,
        rank: final.rank,
        talk: final.talk,
        feedback: ''
      });
      wx.showToast({ title: '已按新要求重新生成', icon: 'success' });
    } catch (e) {
      wx.showToast({ title: (e && e.msg) || '重新生成失败，请重试', icon: 'none' });
    } finally {
      this.setData({ feedbackLoading: false, feedbackProgress: '' });
    }
  }
});
