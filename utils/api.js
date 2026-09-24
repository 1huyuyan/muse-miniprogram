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
 * 按厂商规则拼装图片 URL
 *
 * 这是切换视觉模型时最容易踩的坑，各家的要求是相反的：
 *   'data' → data:image/jpeg;base64,xxxx   火山方舟 / 硅基流动 / NVIDIA / Cloudflare
 *   'raw'  → xxxx                          智谱 GLM-4V / GLM-4.6V 系列（独有，加了前缀就 400）
 *
 * @param {string} b64        纯 base64 字符串（不带前缀）
 * @param {string} prefixMode 'data' | 'raw'，默认 'data'
 * @param {string} mime       图片类型，默认 jpeg
 */
function buildImageUrl(b64, prefixMode, mime) {
  const raw = String(b64 || '');
  if (!raw) return '';
  if (prefixMode === 'raw') return raw;
  return 'data:image/' + (mime || 'jpeg') + ';base64,' + raw;
}

/**
 * 多模态对话：传文字 + 可选图片 base64 列表
 * payload: { messages: [{role, content: 字符串 或 [{type,text|image_url,...}]}], model }
 * override: 可选，{ base_url, api_key, model } —— 用于临时切到另一路模型（如 IP 识别专用模型）
 */
function chat(payload, override) {
  const cfg = getConfig();
  const baseUrl = (override && override.base_url) || cfg.base_url;
  const apiKey = (override && override.api_key) || cfg.api_key;
  const model = (override && override.model) || payload.model || cfg.text_model || 'glm-4-flash';
  if (!baseUrl || !apiKey) {
    return Promise.reject({ code: 'NO_CONFIG', msg: '请先到设置页填写接口地址和 Key' });
  }
  const url = baseUrl.replace(/\/+$/, '') + '/chat/completions';
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: 'POST',
      timeout: 60000,
      header: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      data: {
        model,
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
      fail: err => {
        const em = String((err && err.errMsg) || '');
        const isTimeout = /timeout/i.test(em) || /超时/.test(em);
        reject({
          code: isTimeout ? 'TIMEOUT' : 'NET_ERR',
          msg: isTimeout ? '分析超时（已等待 60 秒），请检查网络后重试' : '网络请求失败，请检查网络连接后重试'
        });
      }
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

module.exports = { getConfig, imageToBase64, buildImageUrl, chat, extractJson };
