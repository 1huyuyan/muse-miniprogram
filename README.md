# Muse — AI 送礼推荐微信小程序

拍照识别照片中的明星 / 动漫 IP，结合预算与喜好，推荐联名周边礼物。给"选择困难症"一份有依据的礼物答案。

## 功能特性

- **拍照上传**：从相册选择或直接拍摄朋友的照片，一次最多上传 9 张
- **多图自动拼接**：多张照片本地拼合为一张组合图（等比缩放、不裁切信息），适配视觉模型单图请求限制（`utils/image.js`）
- **AI 人物画像**：多模态视觉模型逐张分析照片，识别穿搭、风格、物品、元素，输出结构化 JSON 画像（风格 / 性格 / 兴趣 / 禁忌 / 依据 / 50 字总结）
- **IP / 人物识别**：检测照片中的真实明星、动漫角色、游戏角色、影视 IP 等，规范化输出 `{name, work, type}`（`pages/index/index.js` 的 `normalizeIp`）
- **礼物推荐**：本地商品库按风格标签打分匹配，识别到 IP 时优先加权周边 / 联名 / 收藏类商品，IP 名称精确命中高权重入选（`utils/goods.js` 的 `matchGoods`）
- **预算筛选**：可选最低 / 最高价格区间，仅推荐落在预算内的商品
- **推荐榜 + 避雷榜**：文本模型从候选中生成 Top3 推荐与 2 个避雷项，并校验每条理由与商品自身特征一致，避免"张冠李戴"；识别到 IP 时自动将 IP 周边置顶（榜单守护）
- **送礼话术**：模型生成一句高情商送礼开场白
- **电子贺卡**：详情页可一键生成并复制贺卡文案（`pages/detail/detail.js` 的 `genCard`）
- **配置灵活**：内置配置（`config.local.js`）或设置页运行时填写接口信息均可

## 项目结构

```
muse-miniprogram/
├── app.js                 # 入口：config.local.js 默认值与 storage 字段级合并
├── app.json               # 全局配置与页面注册（splash/index/result/detail/settings）
├── app.wxss               # 全局样式
├── project.config.json    # 微信开发者工具项目配置（appid、编译设置）
├── .gitignore             # 排除含 API Key 的 config.local.js 等敏感文件
├── utils/
│   ├── config.local.js    # 本地内置配置（含真实 API Key，不入库）
│   ├── config.local.example.js  # 配置模板（入库，供复制填写）
│   ├── api.js             # OpenAI 兼容大模型调用封装（chat / 图片转 base64 / JSON 抽取）
│   ├── goods.js           # 内置商品库 GOODS 与匹配逻辑 matchGoods / parsePrice
│   ├── rag.js             # IP 知识库检索：云端云函数优先，本地 ip_kb.js 回退
│   └── image.js           # 多图拼接组合图工具
├── data/
│   └── ip_kb.js           # IP 知识库（本地回退版，与云端 json 双端同步）
├── cloudfunctions/
│   ├── ipSearch/          # 微信云开发云函数：IP 知识库云端检索
│   │   ├── index.js       # 云函数入口（wx.cloud.callFunction 调用）
│   │   ├── ip_kb.json     # 云端知识库（与 data/ip_kb.js 双端同步）
│   │   └── package.json
│   ├── goodsSearch/       # 微信云开发云函数：礼物商品库云端检索/全量拉取
│   │   ├── index.js       # 云函数入口（wx.cloud.callFunction 调用）
│   │   ├── goods.json     # 云端商品库（与 utils/goods.js 双端同步）
│   │   └── package.json
│   └── faceSearch/        # 微信云开发云函数：百度人脸识别 V3 转发（搜索/注册/组管理）
│       ├── index.js       # 云函数入口（仅原生 https，零第三方依赖）
│       ├── config.js      # 百度 Key（含真实密钥，已被 .gitignore 排除）
│       ├── config.example.js  # 配置模板（可入库）
│       └── package.json
├── scripts/
│   ├── add_ip.js          # 【贡献工具】新增 IP 条目，自动同步双端
│   ├── validate_ip_kb.js  # 【校验工具】检查双端数据一致性与字段完整性
│   ├── add_good.js        # 【贡献工具】新增商品，自动分配 gXX 编号并同步双端
│   ├── validate_goods.js  # 【校验工具】检查商品双端数据一致性与字段完整性
│   └── register_faces.py  # 【人脸库工具】百度人脸批量注册/搜索（Python，无需 Node）
├── pages/
│   ├── splash/            # 启动页
│   ├── index/             # 首页：选图、预算、标签、发起分析（核心逻辑所在）
│   ├── result/            # 结果页：画像、推荐榜、避雷榜、话术
│   ├── detail/            # 详情页：商品详情、复制话术、AI 生成贺卡
│   └── settings/          # 设置页：运行时填写接口地址 / Key / 模型
└── assets/goods/          # 22 款商品占位图（g01.png ~ g22.png）
```

## 运行步骤

1. **导入项目**：打开微信开发者工具 → 导入项目 → 选择本目录（`muse-miniprogram`），填入自己的小程序 AppID 或使用测试号
2. **配置 API Key**：复制 `utils/config.local.example.js` 为 `utils/config.local.js`，填写你自己的火山方舟 API Key：
   - `api_key`：火山方舟 API Key
   - `vision_model`：多模态视觉模型名或接入点 ID（如 `ep-xxxxxxxx`）
   - `text_model`：文本模型名
   - 也可不改文件，直接在 App 内"设置"页运行时填写（保存在本地 storage）
3. **编译运行**：点击编译，进入首页上传照片即可体验

> 说明：`utils/config.local.js` 包含真实密钥，已被 `.gitignore` 排除，**不会提交到仓库**；仓库中仅保留 `config.local.example.js` 模板。

## 技术栈

- **微信小程序原生**：WXML / WXSS / JavaScript（ES6+），无第三方依赖
- **火山方舟（Volces Ark）**：OpenAI 兼容 `/chat/completions` 接口（`utils/api.js` 封装）
  - 多模态视觉模型：分析照片、识别 IP、生成画像
  - 文本模型：推荐排序、理由生成、避雷建议、贺卡文案

## IP 知识库（RAG）

IP 知识库存储明星 / 动漫 / 游戏 / 潮玩等 IP 条目，供识别后检索匹配，支撑"IP 周边优先"推荐逻辑。

- **云端优先**：`utils/rag.js` 的 `retrieveCloud` 优先调用微信云开发云函数 `ipSearch`（`wx.cloud.callFunction`），超时 / 失败 / 未命中时自动回退本地 `data/ip_kb.js`
- **双端同步**：云端 `cloudfunctions/ipSearch/ip_kb.json` 与本地 `data/ip_kb.js` 内容保持一致，二者由 `scripts/` 工具统一维护
- **检索打分**：`matchGood` 按作品关联 +40 / 品牌关联 +30 / 品类偏好 +15 / 风格匹配 +8 加权；`hasCollab` 命中商品 `collab` 或 IP 条目 `collabs` 非空即视为联名

每条 IP 含以下字段：

| 字段 | 必填 | 说明 |
|------|------|------|
| `key` | ✅ | 英文唯一标识，下划线分词，如 `Zhou_Jielun` |
| `name` | ✅ | 中文名 / 显示名 |
| `aliases` | 建议 | 别名 / 英文名，用于检索命中 |
| `type` | ✅ | `明星` / `anime` / `game` / `政要` / `运动员` / `toy` / `学者` |
| `works` | ✅ | 代表作，用于作品关联打分 |
| `styleTags` | 可选 | 风格标签 |
| `brands` | 可选 | 公开代言 / 合作品牌（**不确定请留空，勿编造**） |
| `collabs` | 可选 | 已确证的联名商品 / 周边（**不确定请留空，勿编造**） |
| `categoryPrefs` | 可选 | 偏好商品品类关键词 |
| `fanPrefs` | 可选 | 粉丝常购 / 周边品类关键词 |

### 如何贡献一个新 IP（开放接口）

任何人都可以参与扩充知识库，无需改代码逻辑：

```bash
# 交互式添加（推荐）
node scripts/add_ip.js

# 或命令行一次性传入（适合脚本 / CI）
node scripts/add_ip.js --key Liu_Dehua --name "刘德华" --type 明星 \
  --aliases "华仔,Andy Lau" --works "无间道,天若有情" \
  --styleTags "港风,成熟" --brands "" --collabs "" \
  --categoryPrefs "腕表,配饰" --fanPrefs "港乐CD,黑胶唱片"
```

脚本会自动：

1. 校验字段完整性（`key` / `name` / `type` / `works` 必填，`type` 合法）
2. 检查 `key` 是否与现有条目冲突
3. **同步更新**云端 `ip_kb.json` 与本地 `ip_kb.js` 两份文件
4. 输出更新后的条目统计

提交前跑一遍完整性校验（也可接入 GitHub Actions / pre-commit）：

```bash
node scripts/validate_ip_kb.js
```

> **贡献守则**
> - `brands` / `collabs` 必须基于真实公开信息填写，**严禁编造联名**，否则会导致推荐榜"不搭边"
> - 不收录人脸照片 / 肖像权图片，仅维护文字条目
> - 知识库改动随代码一起提交，维护者重新「上传并部署」云函数 `ipSearch` 后云端即生效

## 商品库说明

内置 22 款商品（`g01` ~ `g22`，`utils/goods.js`），每款含名称、品牌、风格标签、参考价、特点描述与占位图：

- 常规商品（g01~g16）：机械键盘、降噪耳机、咖啡器具、运动鞋、手账本、唱片机、电竞椅、眼罩、相机、智能手表、瑜伽垫等
- IP 周边商品（g17~g22）：原神手办 / 立牌、火影忍者手办、海贼王路飞周边、鬼灭之刃祢豆子手办、明日方舟干员立牌、宝可梦精灵球摆件，均配置 `ipNames` 别名用于 IP 精确匹配；g06 / g13 / g14 亦标记为 IP 类商品

### 商品库云端化与开放贡献

商品库已对齐 IP 知识库做「云端优先」改造：`utils/rag.js` 的 `retrieveCloud` 会先调用云函数 `goodsSearch` 拉取云端全量商品，失败 / 未部署时自动回退本地 `utils/goods.js`，再走原有 `matchGood` 打分与推荐逻辑（`recommend.js` 榜单守护、降级标注均不变）。

- **云端优先**：新增商品后无需改小程序代码即可进入 RAG 推荐池（`rag.hitGoods` 并入推荐榜候选）
- **双端同步**：云端 `cloudfunctions/goodsSearch/goods.json` 与本地 `utils/goods.js` 内容保持一致，由 `scripts/` 工具统一维护

每条商品含以下字段：

| 字段 | 必填 | 说明 |
|------|------|------|
| `id` | ✅ | 唯一编号，形如 `g01` / `g23`，由脚本自动分配 |
| `name` | ✅ | 商品名称 |
| `brand` | ✅ | 品牌名 |
| `tags` | ✅ | 风格 / 品类标签数组（用于风格匹配打分） |
| `price` | ✅ | 参考价区间字符串，如 `399-599元` |
| `desc` | ✅ | 一句话特点描述（供推荐理由引用） |
| `image` | ✅ | 占位图路径 `/assets/goods/gXX.png` |
| `kind` | 可选 | `ip` 表示 IP 周边 / 联名类商品（推荐加权） |
| `ipNames` | 可选 | 关联 IP 别名数组（如 `['原神','可莉']`，用于 IP 精确匹配） |

#### 如何贡献一个新商品（开放接口）

任何人都可以参与扩充商品库，无需改代码逻辑：

```bash
# 交互式添加（推荐）
node scripts/add_good.js

# 或命令行一次性传入（适合脚本 / CI）
node scripts/add_good.js --name "塞尔达 林克手办" --brand "任天堂" \
  --tags "二次元,游戏,收藏" --price "150-400元" \
  --desc "旷野之息林克角色手办，塞尔达粉丝收藏款" \
  --image "/assets/goods/g23.png" --kind ip --ipNames "塞尔达,林克"
```

脚本会自动：

1. 自动分配下一个 `gXX` 编号（如当前最大 `g22` → 新增 `g23`）
2. 校验字段完整性（`name` / `brand` / `tags` / `price` / `desc` / `image` 必填）
3. 查重：`id` / `name` 与现有商品重复时拒绝
4. **同步更新**云端 `goods.json` 与本地 `utils/goods.js` 两份文件
5. 输出更新后的统计

提交前跑一遍完整性校验（也可接入 GitHub Actions / pre-commit）：

```bash
node scripts/validate_goods.js
```

#### 云端部署步骤

在微信开发者工具中对云函数 `goodsSearch` 执行：

> **上传并部署：云端安装依赖**

（右键 `cloudfunctions/goodsSearch` → 上传并部署：云端安装依赖，与 `ipSearch` 一致；依赖 `wx-server-sdk` 由云端安装，无需本地 `npm install`）

> **贡献守则**
> - `kind: 'ip'` 的联名 / 周边商品必须基于**真实可核实的公开代言或联名信息**（官方联名公告、品牌官网、授权新闻等），**严禁编造联名 / 代言关系**，否则会导致推荐榜"不搭边"问题
> - 不确定的 `ipNames` 请留空，避免误导 IP 精确匹配
> - 商品改动随代码一起提交，维护者重新「上传并部署」云函数 `goodsSearch` 后云端即生效

## 人脸识别（百度智能云 faceSearch）

认人走「百度智能云人脸识别 V3」免费额度（QPS 2，每月免费调用量以百度官方控制台为准），由云函数 `cloudfunctions/faceSearch` 转发，小程序端不直连百度（避免在端上暴露 AK/SK）：

- **搜索**：`utils/face.js` 默认 `face_mode='cloud'`，通过 `wx.cloud.callFunction('faceSearch', { action: 'search', image })` 识别照片命中哪位明星，score ≥ 80 判定命中（阈值可在 `utils/config.local.js` 的 `face_match_threshold` 调整）
- **注册**：将明星照片批量注册进百度人脸组 `muse_stars`（`user_info` 存中文名，搜索命中后经 `name` 字段回传）

### 部署步骤

1. 在 `cloudfunctions/faceSearch/config.js` 填入你自己的百度智能云 API Key / Secret Key（`config.example.js` 为模板；`config.js` 含真实密钥，已被 `.gitignore` 排除，不会提交）
2. 微信开发者工具中右键 `cloudfunctions/faceSearch` → 「上传并部署：云端安装依赖」（零第三方依赖，仅原生 https 模块）
3. 确认 `utils/config.local.js` 中 `face_mode: 'cloud'`、`face_function: 'faceSearch'`（默认即此）

### 注册明星照片（本机 Python 脚本，无需 Node）

照片按「一个明星一个文件夹」整理：文件夹名 = 明星中文名，内含该明星的清晰正脸照（jpg/png，取第一张注册）：

```bash
pip install requests
python scripts/register_faces.py --register-dir ./stars
```

其他用法：

```bash
# 注册单张照片
python scripts/register_faces.py --register-one ./zhang.jpg star_001 "张xx"

# 搜索单张照片命中哪位明星（验证库）
python scripts/register_faces.py --search ./test.jpg

# 仅确保人脸组存在
python scripts/register_faces.py --create-group
```

> 说明：`face_mode='http'` 为旧本机识别服务的备用模式（直连 `face_api_base + '/recognize'`），仅供调试。

## 免责与许可

- 本项目仅供学习交流使用，不构成任何商业承诺
- 商品数据为 MVP mock 数据，商品图片均为占位图，后续可替换为真实商品 API 与素材
- IP 周边商品仅作功能演示，与相关版权方无任何关联
