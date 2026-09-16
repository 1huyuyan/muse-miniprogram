// utils/api.js - OpenAI 兼容大模型调用封装
// 配置在设置页运行时填写（base_url / api_key / model），存本地，不写死源码

function getConfig() {
  return wx.getStorageSync('muse_config') || {};
}

/**
 * 图片转 base64（压缩后）
 */
function imageToBase64(filePath) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      encoding: 'base64',
      success: res => resolve(res.data),
      fail: err => reject(err)
    });
  });
}

/**
 * 多模态对话：传文字 + 可选图片 base64 列表
 * payload: { messages: [{role, content: 字符串 或 [{type,text|image_url,...}]}], model }
 */
function chat(payload) {
  const cfg = getConfig();
  if (!cfg.base_url || !cfg.api_key) {
    return Promise.reject({ code: 'NO_CONFIG', msg: '请先到设置页填写接口地址和 Key' });
  }
  const url = cfg.base_url.replace(/\/+$/, '') + '/chat/completions';
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: 'POST',
      timeout: 60000,
      header: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.api_key },
      data: {
        model: payload.model || cfg.text_model || 'glm-4-flash',
        messages: payload.messages,
        temperature: payload.temperature != null ? payload.temperature : 0.7,
        stream: false
      },
      success: res => {
        if (res.statusCode === 200 && res.data && res.data.choices && res.data.choices.length) {
          resolve(res.data.choices[0].message.content);
        } else {
          reject({ code: 'API_ERR', msg: '接口返回异常: ' + (res.data && res.data.error ? JSON.stringify(res.data.error) : res.statusCode) });
        }
      },
      fail: err => reject({ code: 'NET_ERR', msg: '网络请求失败: ' + (err.errMsg || '') })
    });
  });
}

/**
 * 从文本中抽取 JSON（兼容模型输出前后带 ```json 或解释文字）
 * 解析失败时做轻量修复：去除尾逗号、修复单引号/裸键，提高成功率
 */
function extractJson(text) {
  if (!text) return null;
  let t = text.trim();
  const m = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (m) t = m[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  let slice = null;
  if (start >= 0 && end > start) {
    slice = t.slice(start, end + 1);
  } else {
    slice = t;
  }
  // 依次尝试：原样 → 去尾逗号 → 修复常见非法字符
  const attempts = [slice];
  attempts.push(slice.replace(/,\s*([}\]])/g, '$1'));             // 去尾逗号
  attempts.push(slice.replace(/\}\s*$/g, '}'));                    // 去结尾残留
  attempts.push(slice.replace(/'/g, '"'));                         // 单引号转双引号（粗修）
  attempts.push(slice.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":')); // 裸键加引号
  for (const s of attempts) {
    if (!s) continue;
    try { return JSON.parse(s); } catch (e) { /* continue */ }
  }
  return null;
}

module.exports = { getConfig, imageToBase64, chat, extractJson };
