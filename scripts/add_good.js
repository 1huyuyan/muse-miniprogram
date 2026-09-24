#!/usr/bin/env node
/**
 * scripts/add_good.js - muse 小程序商品库「新增商品」工具
 *
 * 用途：任何人（包括 GitHub 贡献者）都可以用本工具往商品库添加新商品，
 *      脚本会自动：
 *       1. 自动分配下一个 gXX 编号（如当前最大 g22 → 新增 g23）
 *       2. 校验字段完整性（name/brand/tags/price/desc/image 必填）
 *       3. 查重：id / name 与现有商品重复时拒绝
 *       4. 同步更新两份文件：
 *          - cloudfunctions/goodsSearch/goods.json（云端云函数使用）
 *          - utils/goods.js（小程序本地回退使用）
 *       5. 输出更新后的统计
 *
 * 用法（交互式，推荐）：
 *   node scripts/add_good.js
 *
 * 用法（命令行一次性传入，适合脚本/CI）：
 *   node scripts/add_good.js --name "原神 角色手办" --brand "米哈游" ^
 *     --tags "二次元,游戏,收藏" --price "100-300元" ^
 *     --desc "可莉/钟离等热门角色手办" --image "/assets/goods/g23.png" ^
 *     --kind ip --ipNames "原神,可莉,钟离"
 *
 * 字段说明：
 *   id      唯一编号（自动分配，形如 g01 / g23，无需手动传）
 *   name    商品名称（必填）
 *   brand   品牌名（必填）
 *   tags    风格/品类标签，逗号分隔（必填，用于风格匹配打分）
 *   price   参考价区间字符串，如 399-599元（必填）
 *   desc    一句话特点描述（必填，供推荐理由引用）
 *   image   占位图路径，如 /assets/goods/g23.png（必填；交互式可回车用默认）
 *   kind    可选，ip 表示 IP 周边/联名类商品（推荐加权）
 *   ipNames 关联 IP 别名，逗号分隔（可选，用于 IP 精确匹配）
 *
 * 注意：kind=ip 的联名/周边商品必须基于真实可核实的公开代言或联名信息，
 *       严禁编造联名/代言关系，否则会导致推荐榜"不搭边"问题。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GOODS_JSON = path.join(ROOT, 'cloudfunctions', 'goodsSearch', 'goods.json');
const GOODS_JS = path.join(ROOT, 'utils', 'goods.js');

const REQUIRED = ['name', 'brand', 'tags', 'price', 'desc', 'image'];

// ---------- 参数解析 ----------
function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const m = /^--([\w-]+)=(.*)$/.exec(argv[i]) || /^--([\w-]+)$/.exec(argv[i]);
    if (!m) continue;
    const key = m[1];
    const val = m[2] !== undefined ? m[2] : argv[i + 1];
    if (m[2] === undefined) i++; // 消费下一个作为值
    args[key] = val;
  }
  return args;
}

function splitList(s) {
  if (!s) return [];
  return s.split(/[,，]/).map(x => x.trim()).filter(Boolean);
}

function norm(s) {
  return String(s || '').toLowerCase().replace(/[\s·・.。()（）]/g, '');
}

// ---------- 交互式输入 ----------
function prompt(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', (data) => resolve(data.trim()));
  });
}

async function interactive() {
  console.log('===== muse 商品库 · 新增商品 =====');
  const e = {};
  e.name = await prompt('name（商品名称）：');
  e.brand = await prompt('brand（品牌名）：');
  e.tags = splitList(await prompt('tags（风格/品类标签，逗号分隔）：'));
  e.price = await prompt('price（参考价区间，如 399-599元）：');
  e.desc = await prompt('desc（一句话特点描述）：');
  e.image = await prompt('image（占位图路径，回车默认 /assets/goods/gXX.png）：');
  e.kind = await prompt('kind（可选，ip 表示 IP 周边/联名类商品，可空）：');
  e.ipNames = splitList(await prompt('ipNames（可选，关联 IP 别名，逗号分隔，不确定留空）：'));
  process.stdin.pause();
  return e;
}

// ---------- 校验 ----------
function validate(e) {
  const errs = [];
  for (const k of REQUIRED) {
    const v = e[k];
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) {
      errs.push(`缺少必填字段: ${k}`);
    }
  }
  if (e.kind && e.kind !== 'ip') errs.push('kind 只能是 ip 或留空');
  if (e.ipNames && !Array.isArray(e.ipNames)) errs.push('ipNames 必须是数组');
  return errs;
}

// ---------- 读/写 ----------
function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

function nextId(map) {
  let max = 0;
  for (const k of Object.keys(map)) {
    const m = /^g(\d+)$/.exec(k);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return 'g' + String(max + 1).padStart(2, '0');
}

function checkDuplicate(map, e) {
  const n = norm(e.name);
  for (const k of Object.keys(map)) {
    if (norm(map[k].name) === n) {
      return `name 重复：${map[k].name} (${k}) 已存在，请换一个商品名`;
    }
  }
  return null;
}

function toJsEntry(g) {
  const q = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  const J = (arr) => '[' + (arr || []).map(x => q(x)).join(', ') + ']';
  let s = `  { id: ${q(g.id)}, name: ${q(g.name)}, brand: ${q(g.brand)}, tags: ${J(g.tags)}, price: ${q(g.price)}, desc: ${q(g.desc)}, image: ${q(g.image)}`;
  if (g.kind) s += `, kind: ${q(g.kind)}`;
  if (g.ipNames && g.ipNames.length) s += `, ipNames: ${J(g.ipNames)}`;
  s += ` }`;
  return s;
}

// ---------- 主流程 ----------
async function main() {
  const argv = process.argv.slice(2);
  const isCli = argv.some(a => a.startsWith('--'));
  let e = isCli ? (() => {
    const a = parseArgs(argv);
    return {
      name: a.name || '', brand: a.brand || '',
      tags: splitList(a.tags), price: a.price || '',
      desc: a.desc || '', image: a.image || '',
      kind: a.kind || '', ipNames: splitList(a.ipNames),
    };
  })() : await interactive();

  const errs = validate(e);
  if (errs.length) {
    console.error('校验失败：');
    errs.forEach(x => console.error('  - ' + x));
    process.exit(1);
  }

  // 读取云端商品库并查重
  const map = readJson(GOODS_JSON);
  const dup = checkDuplicate(map, e);
  if (dup) {
    console.error(`查重失败：${dup}`);
    process.exit(1);
  }

  // 自动分配 id 并写入 goods.json（新增放最后）
  const id = nextId(map);
  e.id = id;
  if (!e.image) e.image = '/assets/goods/' + id + '.png';
  const entry = {
    id: id, name: e.name, brand: e.brand, tags: e.tags,
    price: e.price, desc: e.desc, image: e.image,
  };
  if (e.kind) entry.kind = e.kind;
  if (e.ipNames && e.ipNames.length) entry.ipNames = e.ipNames;
  map[id] = entry;
  fs.writeFileSync(GOODS_JSON, JSON.stringify(map, null, 2) + '\n', 'utf8');

  // 写入 goods.js（插入到 const GOODS = [ 之后）
  const txt = fs.readFileSync(GOODS_JS, 'utf8');
  const marker = 'const GOODS = [\n';
  const idx = txt.indexOf(marker);
  if (idx < 0) throw new Error('goods.js 未找到插入锚点');
  const newTxt = txt.slice(0, idx + marker.length) + toJsEntry(e) + ',\n' + txt.slice(idx + marker.length);
  fs.writeFileSync(GOODS_JS, newTxt, 'utf8');

  console.log(`\n✅ 已添加 ${e.name} (${id})`);
  console.log(`   云端 goods.json：共 ${Object.keys(map).length} 件商品`);
  console.log(`   本地 goods.js  ：已同步`);
  console.log('\n下一步：');
  console.log('  1. 本地检查无误后，在微信开发者工具中重新「上传并部署」云函数 goodsSearch（云端安装依赖）');
  console.log('  2. 若在 GitHub 贡献，提交本次改动并发 Pull Request 即可');
}

main().catch(err => { console.error(err); process.exit(1); });
