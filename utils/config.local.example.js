// utils/config.local.example.js - 配置模板（安全，可提交仓库）
// 用法：请复制本文件为 utils/config.local.js 并填写你自己的 API Key：
//   Windows: copy config.local.example.js config.local.js
//   macOS/Linux: cp config.local.example.js config.local.js
// 注意：utils/config.local.js 含真实密钥，已被 .gitignore 排除，严禁提交到公开仓库。
module.exports = {
  base_url: 'https://ark.cn-beijing.volces.com/api/v3',
  api_key: '',
  // 填写你自己的视觉模型名或火山方舟接入点 ID（ep-xxx）
  vision_model: '',
  text_model: 'doubao-seed-2-0-mini-260428'
};
