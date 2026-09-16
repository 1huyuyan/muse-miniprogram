# 缪斯 Muse — AI 送礼推荐微信小程序

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
│   └── image.js           # 多图拼接组合图工具
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

## 商品库说明

内置 22 款商品（`g01` ~ `g22`，`utils/goods.js`），每款含名称、品牌、风格标签、参考价、特点描述与占位图：

- 常规商品（g01~g16）：机械键盘、降噪耳机、咖啡器具、运动鞋、手账本、唱片机、电竞椅、眼罩、相机、智能手表、瑜伽垫等
- IP 周边商品（g17~g22）：原神手办 / 立牌、火影忍者手办、海贼王路飞周边、鬼灭之刃祢豆子手办、明日方舟干员立牌、宝可梦精灵球摆件，均配置 `ipNames` 别名用于 IP 精确匹配；g06 / g13 / g14 亦标记为 IP 类商品

## 免责与许可

- 本项目仅供学习交流使用，不构成任何商业承诺
- 商品数据为 MVP mock 数据，商品图片均为占位图，后续可替换为真实商品 API 与素材
- IP 周边商品仅作功能演示，与相关版权方无任何关联
