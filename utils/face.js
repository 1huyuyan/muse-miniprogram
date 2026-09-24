// utils/face.js - 人脸库识别（调服务端，比视觉大模型认人可靠得多）
//
// 为什么要单开这条路：
//   实测视觉大模型认明星极不稳定（同一张脸三次给出三个不同名字），
//   而人脸特征向量比对是「有数字、有阈值、认不出会说认不出」的确定性方案。
//   实测留出验证：同一个人 0.513 ✅ / 不同人 0.173 ⛔（阈值 0.32）。
//
// 配置（utils/config.local.js）：
//   face_mode      : 'cloud'（默认）= 经云函数 faceSearch 转发百度人脸 API；
//                    'http'（备用）= 直连 face_api_base 原识别服务（仅本机调试）
//   face_function  : 云函数名，默认 'faceSearch'
//   face_match_threshold : 百度相似度阈值 0-100，默认 80（config.local.js）
//   face_api_base  : 仅 face_mode='http' 备用模式使用，如 'http://127.0.0.1:8787'
//   face_threshold : 仅 face_mode='http' 备用模式使用，默认 0.32
//
// 重要：本模块【永不 reject】。人脸服务挂了不能影响主流程，
//       识别不了顶多是少个加分项，不该让整个推荐失败。

const api = require('./api');

function recognize(b64, opts) {
  if (!b64) return Promise.resolve(null);
  const cfg = api.getConfig();
  const mode = cfg.face_mode || 'cloud';

  // 云端模式（默认）：wx.cloud.callFunction → faceSearch 云函数 → 百度人脸 API
  if (mode === 'cloud') {
    const fn = cfg.face_function || 'faceSearch';
    return new Promise(resolve => {
      wx.cloud.callFunction({
        name: fn,
        data: { action: 'search', image: b64, top: (opts && opts.top) || 3 }
      }).then(res => {
        const r = res && res.result;
        if (r && r.ok) {
          resolve(r);   // {ok, hit, name, user_id, score, sim, margin} 原样返回
        } else {
          console.warn('[muse] 人脸云函数返回异常：', r);
          resolve(null);
        }
      }).catch(err => {
        console.warn('[muse] 人脸云函数调用失败：', err && err.errMsg);
        resolve(null);
      });
    });
  }

  // http 备用模式（face_mode='http'）：直连原识别服务，仅本机调试用
  const baseUrl = (opts && opts.base_url) || cfg.face_api_base;
  if (!baseUrl) return Promise.resolve(null);   // 没配就静默跳过

  const url = String(baseUrl).replace(/\/+$/, '') + '/recognize';
  return new Promise(resolve => {
    wx.request({
      url,
      method: 'POST',
      timeout: 30000,   // 首次请求服务端要加载模型，给宽一点
      header: { 'Content-Type': 'application/json' },
      data: {
        image_base64: b64,                       // 纯 base64，不带 data: 前缀
        top: (opts && opts.top) || 3,
        threshold: cfg.face_threshold != null ? cfg.face_threshold : 0.32
      },
      success: res => {
        if (res.statusCode === 200 && res.data && res.data.ok) {
          resolve(res.data);
        } else {
          console.warn('[muse] 人脸识别返回异常：', res.statusCode, res.data);
          resolve(null);
        }
      },
      fail: err => {
        console.warn('[muse] 人脸识别请求失败：', err && err.errMsg);
        resolve(null);
      }
    });
  });
}

/**
 * 把服务端返回的结构转成 App 内部统一的 ip 结构 {name, work, type}
 * 没命中返回 null
 */
function toIp(result) {
  if (!result || !result.ok || !result.hit || !result.name) return null;
  return {
    name: String(result.name).trim(),
    work: '',
    type: '明星'
  };
}

module.exports = { recognize, toIp };
