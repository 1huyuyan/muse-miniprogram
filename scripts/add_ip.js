#!/usr/bin/env node
/**
 * scripts/add_ip.js - muse 小程序 IP 知识库「新增条目」工具
 *
 * 用途：任何人（包括 GitHub 贡献者）都可以用本工具往知识库添加新的 IP 条目
 *      （明星 / 动漫 / 游戏 / 潮玩），脚本会自动：
 *       1. 校验字段完整性（key/name/type/works 必填，aliases 建议填）
 *       2. 检查 key 是否与现有条目冲突
 *       3. 同步更新两份文件：
 *          - cloudfunctions/ipSearch/ip_kb.json（云端云函数使用）
 *          - data/ip_kb.js（小程序本地回退使用）
 *       4. 输出更新后的统计
 *
 * 用法（交互式，推荐）：
 *   node scripts/add_ip.js
 *
 * 用法（命令行一次性传入，适合脚本/CI）：
 *   node scripts/add_ip.js --key Liu_Dehua --name "刘德华" --type 明星 ^
 *     --aliases "华仔,Andy Lau" --works "无间道,天若有情" ^
 *     --styleTags "港风,成熟" --brands "" --collabs "" ^
 *     --categoryPrefs "腕表,配饰" --fanPrefs "港乐CD,黑胶唱片"
 *
 * 字段说明：
 *   key           唯一英文标识（必填，用下划线分词，如 Zhou_Jielun）
 *   name          中文名/显示名（必填）
 *   type          类型（必填）：明星 / anime / game / 政要 / 运动员 / toy / 学者
 *   aliases       别名/英文名，逗号分隔（建议填，用于检索命中）
 *   works         代表作，逗号分隔（必填，用于推荐打分 matchGood 的作品关联）
 *   styleTags     风格标签，逗号分隔
 *   brands        公开代言/合作品牌，逗号分隔（不确定请留空，勿编造）
 *   collabs       已确证的联名商品/周边，逗号分隔（不确定请留空，勿编造）
 *   categoryPrefs 该 IP 偏好的商品品类关键词，逗号分隔
 *   fanPrefs      粉丝常购/周边品类关键词，逗号分隔
 *
 * 注意：brands / collabs 必须基于真实公开信息填写，严禁编造联名，
 *       否则会导致推荐榜"不搭边"问题。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const KB_JSON = path.join(ROOT, 'cloudfunctions', 'ipSearch', 'ip_kb.json');
const KB_JS = path.join(ROOT, 'data', 'ip_kb.js');

const REQUIRED = ['key', 'name', 'type', 'works'];
const TYPE_SET = new Set(['明星', 'anime', 'game', '政要', '运动员', 'toy', '学者']);

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
  console.log('===== muse IP 知识库 · 新增条目 =====');
  const e = {};
  e.key = await prompt('key（英文唯一标识，下划线分词，如 Zhou_Jielun）：');
  e.name = await prompt('name（中文名/显示名）：');
  e.type = await prompt('type（明星/anime/game/政要/运动员/toy/学者）：');
  e.aliases = splitList(await prompt('aliases（别名/英文名，逗号分隔，可空）：'));
  e.works = splitList(await prompt('works（代表作，逗号分隔）：'));
  e.styleTags = splitList(await prompt('styleTags（风格标签，逗号分隔，可空）：'));
  e.brands = splitList(await prompt('brands（公开代言品牌，逗号分隔，不确定留空）：'));
  e.collabs = splitList(await prompt('collabs（确证联名周边，逗号分隔，不确定留空）：'));
  e.categoryPrefs = splitList(await prompt('categoryPrefs（偏好品类关键词，逗号分隔，可空）：'));
  e.fanPrefs = splitList(await prompt('fanPrefs（粉丝常购品类，逗号分隔，可空）：'));
  process.stdin.pause();
  return e;
}

// ---------- 校验 ----------
function validate(e) {
  const errs = [];
  for (const k of REQUIRED) {
    if (!e[k] || (Array.isArray(e[k]) && e[k].length === 0)) errs.push(`缺少必填字段: ${k}`);
  }
  if (!/^[A-Za-z0-9_]+$/.test(e.key)) errs.push('key 只能包含字母/数字/下划线');
  if (!TYPE_SET.has(e.type)) errs.push(`type 必须是: ${[...TYPE_SET].join('/')}`);
  return errs;
}

// ---------- 读/写 ----------
function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

function readJsEntries(p) {
  const txt = fs.readFileSync(p, 'utf8');
  const m = txt.match(/const IP_KB = \{([\s\S]*?)\n\};/);
  if (!m) throw new Error('ip_kb.js 格式异常：未找到 const IP_KB');
  return { txt, body: m[1] };
}

function toJsEntry(e) {
  const J = (arr) => JSON.stringify(arr || []);
  return `  ${e.key}: {
    key: "${e.key}",
    name: "${e.name}",
    aliases: ${J(e.aliases)},
    type: "${e.type}",
    works: ${J(e.works)},
    styleTags: ${J(e.styleTags)},
    brands: ${J(e.brands)},
    collabs: ${J(e.collabs)},
    categoryPrefs: ${J(e.categoryPrefs)},
    fanPrefs: ${J(e.fanPrefs)}
  },`;
}

// ---------- 主流程 ----------
async function main() {
  const argv = process.argv.slice(2);
  const isCli = argv.some(a => a.startsWith('--'));
  const e = isCli ? (() => {
    const a = parseArgs(argv);
    return {
      key: a.key || '', name: a.name || '', type: a.type || '',
      aliases: splitList(a.aliases), works: splitList(a.works),
      styleTags: splitList(a.styleTags), brands: splitList(a.brands),
      collabs: splitList(a.collabs), categoryPrefs: splitList(a.categoryPrefs),
      fanPrefs: splitList(a.fanPrefs),
    };
  })() : await interactive();

  const errs = validate(e);
  if (errs.length) {
    console.error('校验失败：');
    errs.forEach(x => console.error('  - ' + x));
    process.exit(1);
  }

  // 检查云端 key 冲突
  const kb = readJson(KB_JSON);
  if (kb[e.key]) {
    console.error(`key 冲突：${e.key} 已存在于 ip_kb.json，请换一个 key 或先删除旧条目`);
    process.exit(1);
  }

  // 写入 ip_kb.json（保持对象顺序：新增放最后）
  kb[e.key] = {
    key: e.key, name: e.name, aliases: e.aliases, type: e.type,
    works: e.works, styleTags: e.styleTags, brands: e.brands,
    collabs: e.collabs, categoryPrefs: e.categoryPrefs, fanPrefs: e.fanPrefs,
  };
  fs.writeFileSync(KB_JSON, JSON.stringify(kb, null, 2) + '\n', 'utf8');

  // 写入 ip_kb.js（插入到 const IP_KB = { 之后）
  const { txt, body } = readJsEntries(KB_JS);
  const entryJs = toJsEntry(e);
  const marker = 'const IP_KB = {\n';
  const idx = txt.indexOf(marker);
  if (idx < 0) throw new Error('ip_kb.js 未找到插入锚点');
  const newTxt = txt.slice(0, idx + marker.length) + entryJs + ',\n' + txt.slice(idx + marker.length);
  fs.writeFileSync(KB_JS, newTxt, 'utf8');

  const stars = Object.values(kb).filter(v => v.type === '明星').length;
  console.log(`\n✅ 已添加 ${e.name} (${e.key})`);
  console.log(`   云端 ip_kb.json：共 ${Object.keys(kb).length} 条（明星 ${stars} 位）`);
  console.log(`   本地 ip_kb.js  ：已同步`);
  console.log('\n下一步：');
  console.log('  1. 本地检查无误后，在微信开发者工具中重新「上传并部署」云函数 ipSearch');
  console.log('  2. 若在 GitHub 贡献，提交本次改动并发 Pull Request 即可');
}

main().catch(err => { console.error(err); process.exit(1); });
