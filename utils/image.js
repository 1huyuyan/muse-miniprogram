// utils/image.js - 图片处理工具
// 背景：GLM-4V 系列（glm-4v-flash 等）单次请求只支持一张图片，
// 多张照片须先本地拼接为一张组合图，再交给视觉模型分析。

function getImageInfo(filePath) {
  return new Promise((resolve, reject) => {
    wx.getImageInfo({ src: filePath, success: resolve, fail: reject });
  });
}

/**
 * 将多张本地图片拼接为一张组合图（等比缩放放入网格，不裁切信息）
 * @param {string[]} filePaths 本地图片路径
 * @param {number} maxSide 拼接图单边最大像素（默认 900，控制体积）
 * @returns {Promise<string|null>} 拼接后临时文件路径；失败或仅一张时返回原路径
 */
async function combineImages(filePaths, maxSide = 900) {
  const list = Array.isArray(filePaths) ? filePaths.filter(Boolean) : [];
  if (list.length <= 1) return list[0] || null;
  try {
    const infos = await Promise.all(list.map(p => getImageInfo(p).catch(() => null)));
    const valid = infos.filter(Boolean);
    if (!valid.length) return null;
    if (valid.length === 1) return valid[0].path;

    const cols = Math.ceil(Math.sqrt(valid.length));
    const rows = Math.ceil(valid.length / cols);
    const cellW = Math.floor(maxSide / cols);
    const cellH = Math.floor(maxSide / rows);

    const canvas = wx.createOffscreenCanvas({ type: '2d', width: cellW * cols, height: cellH * rows });
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const loadImage = p => new Promise(res => {
      const img = canvas.createImage();
      img.onload = () => res(img);
      img.onerror = () => res(null);
      img.src = p;
    });

    const imgs = await Promise.all(valid.map(v => loadImage(v.path)));
    valid.forEach((v, i) => {
      const img = imgs[i];
      if (!img || !img.width || !img.height) return;
      const gx = i % cols;
      const gy = Math.floor(i / cols);
      // contain：等比缩放置中，避免裁切丢失画面信息
      const scale = Math.min(cellW / img.width, cellH / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      ctx.drawImage(img, gx * cellW + (cellW - dw) / 2, gy * cellH + (cellH - dh) / 2, dw, dh);
    });

    const tempPath = await new Promise((resolve, reject) => {
      wx.canvasToTempFilePath({ canvas, success: r => resolve(r.tempFilePath), fail: reject });
    });
    return tempPath || null;
  } catch (e) {
    console.error('combineImages failed', e);
    return null;
  }
}

module.exports = { combineImages, getImageInfo };
