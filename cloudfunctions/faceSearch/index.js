// 云函数：faceSearch —— 百度智能云人脸识别 V3 转发（搜索 / 注册 / 组管理）
// 用途：小程序端不直连百度（避免暴露 AK/SK），统一走本云函数转发。
// 依赖：仅原生 https 模块，零第三方依赖；config.js 需自行填百度 Key。
// 说明：access_token 在云函数实例内存中缓存（百度有效期约 30 天），
//       实例复用时免重复换取；实例回收后会自动重新获取。
const https = require('https');
const CFG = require('./config');

const BAIDU_TOKEN_URL = 'https://aip.baidubce.com/oauth/2.0/token';
const BAIDU_FACE_API = 'https://aip.baidubce.com/rest/2.0/face/v3';

// access_token 模块级缓存：{ token, expiresAt }
let tokenCache = null;

function httpsPost(url, form) {
  const body = Object.keys(form || {})
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(form[k]))
    .join('&');
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let raw = '';
      res.on('data', c => (raw += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          reject(new Error('百度接口返回非 JSON: ' + raw.slice(0, 200)));
        }
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function getToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60000) {
    return tokenCache.token;
  }
  const qs = 'grant_type=client_credentials' +
    '&client_id=' + encodeURIComponent(CFG.API_KEY) +
    '&client_secret=' + encodeURIComponent(CFG.SECRET_KEY);
  const data = await httpsPost(BAIDU_TOKEN_URL + '?' + qs, {});
  if (!data || !data.access_token) {
    const msg = (data && (data.error_description || data.error)) || '未知错误';
    throw new Error('获取 access_token 失败: ' + msg);
  }
  const expiresIn = (data.expires_in || 2592000) * 1000;
  tokenCache = { token: data.access_token, expiresAt: Date.now() + expiresIn };
  return data.access_token;
}

function errOf(data) {
  return String(data.error_code) + ': ' + (data.error_msg || '');
}

// action='search'：人脸搜索 V3
// 入参 image(base64 纯串)、top(可选，默认 1)；命中判定 score >= MATCH_THRESHOLD(80)
async function doSearch(event) {
  const image = event.image;
  if (!image) return { ok: false, error: '缺少 image(base64)' };
  const token = await getToken();
  const data = await httpsPost(BAIDU_FACE_API + '/search?access_token=' + encodeURIComponent(token), {
    image: image,
    image_type: 'BASE64',
    group_id_list: JSON.stringify([CFG.GROUP_ID]),
    quality_control: 'NORMAL',
    liveness_control: 'NONE',
    max_face_num: 1,
    match_threshold: CFG.MATCH_THRESHOLD
  });
  if (data.error_code) return { ok: false, error: errOf(data) };
  const faceList = (data.result && data.result.face_list) || [];
  const userList = (faceList[0] && faceList[0].user_list) || [];
  const best = userList[0];
  if (!best || !best.user_id) return { ok: true, hit: false };
  const score = best.score || 0;
  return {
    ok: true,
    hit: score >= CFG.MATCH_THRESHOLD,
    name: best.user_info || '',
    user_id: best.user_id,
    score: score,
    sim: score / 100,
    margin: (score - CFG.MATCH_THRESHOLD) / 100
  };
}

// action='register'：人脸注册 V3
// 入参 image(base64)、user_id、name(中文名，存 user_info，搜索命中后回传)
async function doRegister(event) {
  const image = event.image;
  const userId = event.user_id;
  const name = event.name;
  if (!image || !userId || !name) return { ok: false, error: '缺少 image / user_id / name' };
  const token = await getToken();
  const data = await httpsPost(BAIDU_FACE_API + '/faceset/user/add?access_token=' + encodeURIComponent(token), {
    image: image,
    image_type: 'BASE64',
    group_id: CFG.GROUP_ID,
    user_id: userId,
    user_info: name,
    quality_control: 'NORMAL',
    liveness_control: 'NONE'
  });
  if (data.error_code) return { ok: false, error: errOf(data) };
  return { ok: true, face_token: data.result && data.result.face_token };
}

// action='group_create'：创建人脸组（223101=已存在，视为成功）
async function doGroupCreate() {
  const token = await getToken();
  const data = await httpsPost(BAIDU_FACE_API + '/faceset/group/add?access_token=' + encodeURIComponent(token), {
    group_id: CFG.GROUP_ID
  });
  if (data.error_code && data.error_code !== 223101) return { ok: false, error: errOf(data) };
  return { ok: true, exists: data.error_code === 223101 };
}

// action='group_list'：人脸组列表
async function doGroupList() {
  const token = await getToken();
  const data = await httpsPost(BAIDU_FACE_API + '/faceset/group/getlist?access_token=' + encodeURIComponent(token), {
    start: 0,
    length: 100
  });
  if (data.error_code) return { ok: false, error: errOf(data) };
  return { ok: true, group_id_list: data.result && data.result.group_id_list };
}

// action='user_list'：组内用户列表（入参 start/length 分页）
async function doUserList(event) {
  const token = await getToken();
  const data = await httpsPost(BAIDU_FACE_API + '/faceset/user/getlist?access_token=' + encodeURIComponent(token), {
    group_id: CFG.GROUP_ID,
    start: event.start != null ? event.start : 0,
    length: event.length != null ? event.length : 50
  });
  if (data.error_code) return { ok: false, error: errOf(data) };
  return { ok: true, user_id_list: data.result && data.result.user_id_list };
}

// action='user_delete'：删除组内用户（入参 user_id）
async function doUserDelete(event) {
  if (!event.user_id) return { ok: false, error: '缺少 user_id' };
  const token = await getToken();
  const data = await httpsPost(BAIDU_FACE_API + '/faceset/user/delete?access_token=' + encodeURIComponent(token), {
    group_id: CFG.GROUP_ID,
    user_id: event.user_id
  });
  if (data.error_code) return { ok: false, error: errOf(data) };
  return { ok: true };
}

exports.main = async (event) => {
  try {
    const action = event && event.action;
    switch (action) {
      case 'search': return await doSearch(event);
      case 'register': return await doRegister(event);
      case 'group_create': return await doGroupCreate();
      case 'group_list': return await doGroupList();
      case 'user_list': return await doUserList(event);
      case 'user_delete': return await doUserDelete(event);
      default: return { ok: false, error: '未知 action: ' + action };
    }
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
};
