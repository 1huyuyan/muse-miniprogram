#!/usr/bin/env node
/**
 * scripts/validate_goods.js - 商品库完整性校验
 *
 * 用途：检查 goods.json 与 goods.js 两份文件是否：
 *   1. 商品数量一致
 *   2. 每个商品字段完整（id/name/brand/tags/price/desc/image 必填）
 *   3. id 全局唯一且格式合法（形如 gXX）
 *   4. tags/ipNames 必须为数组，kind 若存在必须为 ip
 *   5. 云端文件与本地回退文件数据一致（防止只改了一边）
 *
 * 用法：
 *   node scripts/validate_goods.js
 *
 * 适合接入 GitHub Actions / pre-commit hook，贡献者提交前跑一遍。
 * 退出码：0=通过，1=失败。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GOODS_JSON = path.join(ROOT, 'cloudfunctions', 'goodsSearch', 'goods.json');
const GOODS_JS = path.join(ROOT, 'utils', 'goods.js');
const REQUIRED = ['id', 'name', 'brand', 'tags', 'price', 'desc', 'image'];

let errors = [];

function readJsonEntries() {
  const map = JSON.parse(fs.readFileSync(GOODS_JSON, 'utf8'));
  const out = {};
  for (const [k, v] of Object.entries(map)) {
    out[k] = Object.assign({}, v, { id: v.id || k });
  }
  return out;
}

function readJsEntries() {
  const txt = fs.readFileSync(GOODS_JS, 'utf8');
  const m = txt.match(/const GOODS = \[([\s\S]*?)\n\];/);
  if (!m) throw new Error('goods.js 格式异常：未找到 const GOODS');
  const body = m[1];
  const entries = [];
  // 按条目切分：每行一条 `{ ... },` 或末尾 `{ ... }`
  const re = /^\s*\{\s*([\s\S]*?)\s*\},?$/gm;
  let match;
  while ((match = re.exec(body)) !== null) {
    const inner = match[1];
    // 逐字段提取：仅当整个值为单引号字符串或单引号数组时做安全转换，
    // 避免破坏字符串内撇号（如 Don't / Levi's，JS 源码中写作 \'）。
    const get = (field) => {
      const fm = inner.match(new RegExp(`(?:^|,\\s*)${field}:\\s*(\\[[\\s\\S]*?\\]|"[^"]*"|'[^']*')(?=,|$)`, 'm'));
      if (!fm) return undefined;
      let raw = fm[1].trim();
      if (raw.startsWith("'")) {
        // 单引号字符串：剥掉首尾引号并还原转义
        return raw.slice(1, -1).replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      }
      if (raw.startsWith('[')) {
        // 单引号数组：保护转义撇号后整体替换为双引号再 JSON.parse
        const protectedRaw = raw.replace(/\\'/g, '\u0000');
        const quoted = protectedRaw.replace(/'/g, '"');
        const restored = quoted.replace(/\u0000/g, "'");
        return JSON.parse(restored);
      }
      return JSON.parse(raw); // 双引号字符串
    };
    const entry = {
      id: get('id') || '',
      name: get('name') || '',
      brand: get('brand') || '',
      tags: get('tags') || [],
      price: get('price') || '',
      desc: get('desc') || '',
      image: get('image') || '',
      kind: get('kind') || '',
      ipNames: get('ipNames') || [],
    };
    entries.push(entry);
  }
  // 按 id 组织为 map，便于与云端比较
  const out = {};
  for (const e of entries) out[e.id] = e;
  return out;
}

function checkEntry(k, v, src) {
  for (const f of REQUIRED) {
    const val = v[f];
    if (val === undefined || val === null || val === '' || (Array.isArray(val) && val.length === 0)) {
      errors.push(`[${src}] ${k} 缺少必填字段: ${f}`);
    }
  }
  if (!/^g\d{2,}$/.test(k)) errors.push(`[${src}] ${k} id 格式非法（应为 gXX，如 g01）`);
  if (!Array.isArray(v.tags)) errors.push(`[${src}] ${k} tags 必须是数组`);
  if (v.kind && v.kind !== 'ip') errors.push(`[${src}] ${k} kind 只能是 ip 或留空`);
  if (v.ipNames && !Array.isArray(v.ipNames)) errors.push(`[${src}] ${k} ipNames 必须是数组`);
}

function main() {
  let jsonMap, jsMap;
  try { jsonMap = readJsonEntries(); } catch (e) { errors.push('goods.json 读取失败: ' + e.message); }
  try { jsMap = readJsEntries(); } catch (e) { errors.push('goods.js 读取失败: ' + e.message); }
  if (!jsonMap || !jsMap) return finish();

  // 数量一致
  if (Object.keys(jsonMap).length !== Object.keys(jsMap).length) {
    errors.push(`商品数不一致：goods.json=${Object.keys(jsonMap).length}，goods.js=${Object.keys(jsMap).length}`);
  }

  // 字段校验（id 唯一性：对象 key 天然唯一，但 js 侧可能重复覆盖，检查 id 集合数量）
  for (const [k, v] of Object.entries(jsonMap)) checkEntry(k, v, 'json');
  for (const [k, v] of Object.entries(jsMap)) checkEntry(k, v, 'js');

  // id 集合一致
  const jk = new Set(Object.keys(jsonMap));
  const sk = new Set(Object.keys(jsMap));
  for (const k of jk) if (!sk.has(k)) errors.push(`id ${k} 只在 goods.json 中，goods.js 缺失`);
  for (const k of sk) if (!jk.has(k)) errors.push(`id ${k} 只在 goods.js 中，goods.json 缺失`);

  // 关键字段一致性（name/brand/tags/price/desc/image/kind/ipNames）
  // 空值归一化：undefined / null / '' / [] 视为同一空值，避免双端空值表示差异误报
  const normEmpty = v => (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) ? null : v;
  for (const k of jk) {
    if (!sk.has(k)) continue;
    for (const f of ['name', 'brand', 'tags', 'price', 'desc', 'image', 'kind', 'ipNames']) {
      const a = JSON.stringify(normEmpty(jsonMap[k][f]));
      const b = JSON.stringify(normEmpty(jsMap[k][f]));
      if (a !== b) errors.push(`id ${k} 字段 ${f} 双端不一致：json=${a} js=${b}`);
    }
  }

  finish();
}

function finish() {
  if (errors.length) {
    console.error(`❌ 校验失败，共 ${errors.length} 个问题：`);
    errors.forEach(e => console.error('  - ' + e));
    process.exit(1);
  }
  const total = Object.keys(readJsonEntries()).length;
  const ipGoods = Object.values(readJsonEntries()).filter(v => v.kind === 'ip').length;
  console.log(`✅ 商品库校验通过：共 ${total} 件商品（IP 周边 ${ipGoods} 件），双端数据一致`);
  process.exit(0);
}

main();
