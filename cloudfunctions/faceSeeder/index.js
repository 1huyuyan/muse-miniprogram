/**
 * faceSeeder 云函数：维基/Wikidata 公开头像抓取 + 百度人脸库批量注册（云端灌库）
 * 纯 Node 原生 https 实现，零第三方依赖；批次内逐个串行，尽量在 60s 内跑完。
 *
 * 调用方式：
 *   wx.cloud.callFunction({ name: 'faceSeeder', data: { batch: 0, batchSize: 12 } })
 *   默认 batch=0, batchSize=12
 *
 * 返回：
 *   { ok: true, total: N, success: [{name, index, user_id}], failed: [{name, index, error}] }
 */
'use strict';

const https = require('https');

// ========== 百度人脸库常量（与 faceSearch 保持一致，勿改） ==========
const API_KEY = process.env.FACE_API_KEY;
const SECRET_KEY = process.env.FACE_SECRET_KEY;
const GROUP_ID = 'muse_stars';

// 图片下载上限 3MB；仅接受 JPEG/PNG
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png'];

// 百度人脸注册：已存在相关错误码一律视为成功
const ALREADY_EXISTS_CODES = [223102, 223105, 223106];
// 图片质量差：换 LOW 质量控制重试一次
const QUALITY_LOW_CODE = 222202;

let cachedToken = null;
let cachedTokenAt = 0;

// ---------------- 基础 https 工具 ----------------

function httpsGet(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err) => { if (!settled) { settled = true; reject(err); } };
    let req;
    try {
      req = https.get(url, { timeout: timeoutMs || 10000 }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return fail(new Error('HTTP ' + res.statusCode));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch (e) {
            fail(new Error('响应非 JSON: ' + e.message));
          }
        });
      });
      req.on('timeout', () => req.destroy(new Error('请求超时')));
      req.on('error', fail);
    } catch (e) {
      fail(e);
    }
  });
}

function httpsPostJson(url, jsonBody, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err) => { if (!settled) { settled = true; reject(err); } };
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      return fail(new Error('非法 URL'));
    }
    const body = Buffer.from(JSON.stringify(jsonBody || {}), 'utf8');
    let req;
    try {
      req = https.request({
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': body.length
        }
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch (e) {
            return fail(new Error('百度响应非 JSON'));
          }
          resolve(parsed);
        });
      });
      req.on('timeout', () => req.destroy(new Error('请求超时')));
      req.on('error', fail);
      req.write(body);
      req.end();
    } catch (e) {
      fail(e);
    }
  });
}

// ---------------- 抓图：维基优先，Wikidata 回退 ----------------

async function getImageUrl(name) {
  // 1) 中文维基 rest_v1 summary → originalimage.source
  try {
    const url = 'https://zh.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(name);
    const data = await httpsGet(url, 8000);
    if (data && data.originalimage && data.originalimage.source) {
      return data.originalimage.source;
    }
  } catch (e) { /* 回退 Wikidata */ }

  // 2) Wikidata wbsearchentities 查 QID
  let qid = null;
  try {
    const searchUrl = 'https://www.wikidata.org/w/api.php?action=wbsearchentities&search=' +
      encodeURIComponent(name) + '&language=zh&format=json';
    const data = await httpsGet(searchUrl, 8000);
    if (data && data.search && data.search.length > 0 && data.search[0].id) {
      qid = data.search[0].id;
    }
  } catch (e) { /* 继续 */ }
  if (!qid) {
    throw new Error('未找到 Wikidata 条目');
  }

  // 3) EntityData → P18 图片文件名
  let p18 = null;
  try {
    const entUrl = 'https://www.wikidata.org/wiki/Special:EntityData/' + qid + '.json';
    const data = await httpsGet(entUrl, 10000);
    const entity = data && data.entities && data.entities[qid];
    if (entity && entity.claims && entity.claims.P18 && entity.claims.P18[0]) {
      const val = entity.claims.P18[0].mainsnak && entity.claims.P18[0].mainsnak.datavalue;
      if (val && val.value) {
        p18 = val.value;
      }
    }
  } catch (e) { /* 继续 */ }
  if (!p18) {
    throw new Error('Wikidata 无 P18 图片');
  }

  // 4) commons Special:FilePath?width=800
  return 'https://commons.wikimedia.org/wiki/Special:FilePath/' +
    encodeURIComponent(p18) + '?width=800';
}

// ---------------- 下载图片 → base64（限 3MB，仅 jpeg/png） ----------------

function downloadImage(url) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err) => { if (!settled) { settled = true; reject(err); } };
    let req;
    try {
      req = https.get(url, { timeout: 15000 }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return fail(new Error('下载 HTTP ' + res.statusCode));
        }
        const ct = (res.headers['content-type'] || '').toLowerCase().split(';')[0].trim();
        if (!ALLOWED_IMAGE_TYPES.includes(ct)) {
          res.resume();
          return fail(new Error('不支持的图片类型 ' + ct));
        }
        const len = parseInt(res.headers['content-length'] || '0', 10);
        if (len > MAX_IMAGE_BYTES) {
          res.resume();
          return fail(new Error('图片超过 3MB'));
        }
        const chunks = [];
        let total = 0;
        res.on('data', (c) => {
          total += c.length;
          if (total > MAX_IMAGE_BYTES) {
            req.destroy();
            return fail(new Error('图片超过 3MB'));
          }
          chunks.push(c);
        });
        res.on('end', () => {
          if (settled) return;
          settled = true;
          resolve({ base64: Buffer.concat(chunks).toString('base64'), contentType: ct });
        });
      });
      req.on('timeout', () => req.destroy(new Error('下载超时')));
      req.on('error', fail);
    } catch (e) {
      fail(e);
    }
  });
}

// ---------------- 百度人脸注册 ----------------

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now - cachedTokenAt < 25 * 60 * 1000) {
    return cachedToken;
  }
  const url = 'https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=' +
    API_KEY + '&client_secret=' + SECRET_KEY;
  const data = await httpsPostJson(url, {}, 10000);
  if (!data || !data.access_token) {
    throw new Error('获取 access_token 失败: ' + ((data && data.error_description) || JSON.stringify(data)));
  }
  cachedToken = data.access_token;
  cachedTokenAt = now;
  return cachedToken;
}

async function registerFace(base64, userId, name, qualityControl) {
  const token = await getAccessToken();
  const url = 'https://aip.baidubce.com/rest/2.0/face/v3/faceset/user/add?access_token=' + token;
  const body = {
    image: base64,
    image_type: 'BASE64',
    group_id: GROUP_ID,
    user_id: userId,
    user_info: name,
    quality_control: qualityControl || 'NORMAL',
    liveness_control: 'NONE'
  };
  const data = await httpsPostJson(url, body, 15000);
  return data || {};
}

// ---------------- 单人名处理（串行） ----------------

async function processOne(item) {
  const index = item.index;
  const name = item.name;
  const userId = 'star_' + String(index).padStart(3, '0');
  try {
    let imgUrl = null;
    try {
      imgUrl = await getImageUrl(name);
    } catch (e) {
      imgUrl = null;
    }
    if (!imgUrl) {
      throw new Error('抓图失败: 未找到图源');
    }

    let image = null;
    try {
      image = await downloadImage(imgUrl);
    } catch (e) {
      throw new Error('下载失败: ' + e.message);
    }

    // 注册：成功或"已存在"均算成功；222202 质量差 → LOW 重试一次
    let resp = await registerFace(image.base64, userId, name, 'NORMAL');
    if (resp.error_code === QUALITY_LOW_CODE) {
      resp = await registerFace(image.base64, userId, name, 'LOW');
    }
    const code = resp.error_code;
    if (code === 0 || (code !== undefined && ALREADY_EXISTS_CODES.indexOf(code) >= 0)) {
      return { name: name, index: index, user_id: userId };
    }
    throw new Error('注册失败 errno=' + code + ' ' + (resp.error_msg || ''));
  } catch (e) {
    return { name: name, index: index, error: e.message };
  }
}

// ---------------- 入口 ----------------

const namesList = require('./names.json');

exports.main = async (event) => {
  event = event || {};
  const batch = typeof event.batch === 'number' ? event.batch : 0;
  const batchSize = (typeof event.batchSize === 'number' && event.batchSize > 0) ? event.batchSize : 12;

  const start = batch * batchSize;
  const slice = namesList.slice(start, start + batchSize);
  if (slice.length === 0) {
    return { ok: true, total: 0, success: [], failed: [], message: '该批次无数据' };
  }

  const success = [];
  const failed = [];
  for (let i = 0; i < slice.length; i++) {
    const r = await processOne(slice[i]);
    if (r.error) {
      failed.push(r);
    } else {
      success.push(r);
    }
  }

  return { ok: true, total: slice.length, success: success, failed: failed };
};
