#!/usr/bin/env node
/**
 * scripts/validate_ip_kb.js - IP 知识库完整性校验
 *
 * 用途：检查 ip_kb.json 与 ip_kb.js 两份文件是否：
 *   1. 条目数量一致
 *   2. 每个条目字段完整（key/name/type/works 必填，type 合法）
 *   3. key 全局唯一且格式合法
 *   4. 云端文件与本地回退文件数据一致（防止只改了一边）
 *
 * 用法：
 *   node scripts/validate_ip_kb.js
 *
 * 适合接入 GitHub Actions / pre-commit hook，贡献者提交前跑一遍。
 * 退出码：0=通过，1=失败。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const KB_JSON = path.join(ROOT, 'cloudfunctions', 'ipSearch', 'ip_kb.json');
const KB_JS = path.join(ROOT, 'data', 'ip_kb.js');
const TYPE_SET = new Set(['明星', 'anime', 'game', '政要', '运动员', 'toy', '学者']);
const REQUIRED = ['key', 'name', 'type', 'works'];

let errors = [];
let warnings = [];

function readJsonEntries() {
  const kb = JSON.parse(fs.readFileSync(KB_JSON, 'utf8'));
  const map = {};
  for (const [k, v] of Object.entries(kb)) {
    map[k] = Object.assign({}, v, { key: v.key || k });
  }
  return map;
}

function readJsEntries() {
  const txt = fs.readFileSync(KB_JS, 'utf8');
  const m = txt.match(/const IP_KB = \{([\s\S]*?)\n\};/);
  if (!m) throw new Error('ip_kb.js 格式异常：未找到 const IP_KB');
  const body = m[1];
  // 用对象字面量求值获得条目（只取数据，避免执行其它逻辑）
  const sandbox = {};
  // 简单解析：按顶层 key: { ... } 切分
  const entries = {};
  const re = /^\s{2}([A-Za-z0-9_]+): \{([\s\S]*?)\n  \},/gm;
  let match;
  while ((match = re.exec(body)) !== null) {
    const key = match[1];
    const inner = match[2];
    const get = (field) => {
      // 仅当整个值是单引号字符串时才替换为双引号，避免破坏字符串内的撇号（如 Don't / Levi's）
      const fm = inner.match(new RegExp(`^\\s{4}${field}: (\\[[\\s\\S]*?\\]|"[^"]*"|'[^']*'),?$`, 'm'));
      if (!fm) return undefined;
      let raw = fm[1].trim();
      if (raw.startsWith("'")) raw = raw.replace(/'/g, '"');
      try { return JSON.parse(raw); } catch (e) { return undefined; }
    };
    const entry = {
      key: key,
      name: get('name') || '',
      aliases: get('aliases') || [],
      type: get('type') || '',
      works: get('works') || [],
      styleTags: get('styleTags') || [],
      brands: get('brands') || [],
      collabs: get('collabs') || [],
      categoryPrefs: get('categoryPrefs') || [],
      fanPrefs: get('fanPrefs') || [],
    };
    entries[key] = entry;
  }
  return entries;
}

function checkEntry(k, v, src) {
  for (const f of REQUIRED) {
    const val = v[f];
    if (val === undefined || val === null || val === '' || (Array.isArray(val) && val.length === 0)) {
      errors.push(`[${src}] ${k} 缺少必填字段: ${f}`);
    }
  }
  if (!/^[A-Za-z0-9_]+$/.test(k)) errors.push(`[${src}] ${k} key 格式非法`);
  if (!TYPE_SET.has(v.type)) errors.push(`[${src}] ${k} type 非法: ${v.type}`);
  // collabs/brands 不允许出现空对象外的异常值
  for (const f of ['brands', 'collabs', 'works']) {
    if (v[f] !== undefined && !Array.isArray(v[f])) errors.push(`[${src}] ${k} ${f} 必须是数组`);
  }
}

function main() {
  let jsonMap, jsMap;
  try { jsonMap = readJsonEntries(); } catch (e) { errors.push('ip_kb.json 读取失败: ' + e.message); }
  try { jsMap = readJsEntries(); } catch (e) { errors.push('ip_kb.js 读取失败: ' + e.message); }
  if (!jsonMap || !jsMap) return finish();

  // 数量一致
  if (Object.keys(jsonMap).length !== Object.keys(jsMap).length) {
    errors.push(`条目数不一致：ip_kb.json=${Object.keys(jsonMap).length}，ip_kb.js=${Object.keys(jsMap).length}`);
  }

  // 字段校验
  for (const [k, v] of Object.entries(jsonMap)) checkEntry(k, v, 'json');
  for (const [k, v] of Object.entries(jsMap)) checkEntry(k, v, 'js');

  // key 集合一致
  const jk = new Set(Object.keys(jsonMap));
  const sk = new Set(Object.keys(jsMap));
  for (const k of jk) if (!sk.has(k)) errors.push(`key ${k} 只在 ip_kb.json 中，ip_kb.js 缺失`);
  for (const k of sk) if (!jk.has(k)) errors.push(`key ${k} 只在 ip_kb.js 中，ip_kb.json 缺失`);

  // 关键字段一致性（name/type/works/collabs/brands）
  for (const k of jk) {
    if (!sk.has(k)) continue;
    for (const f of ['name', 'type', 'works', 'brands', 'collabs']) {
      const a = JSON.stringify(jsonMap[k][f]);
      const b = JSON.stringify(jsMap[k][f]);
      if (a !== b) errors.push(`key ${k} 字段 ${f} 双端不一致：json=${a} js=${b}`);
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
  const stars = Object.values(readJsonEntries()).filter(v => v.type === '明星').length;
  console.log(`✅ IP 知识库校验通过：共 ${total} 条（明星 ${stars} 位），双端数据一致`);
  if (warnings.length) {
    console.warn('警告：');
    warnings.forEach(w => console.warn('  - ' + w));
  }
  process.exit(0);
}

main();
