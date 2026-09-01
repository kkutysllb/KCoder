---
name: comic
description: 知识漫画创作器——将知识、教育、传记、教程类文本内容转化为多页叙事型漫画。支持 5 种艺术风格 × 7 种色调 × 7 种布局的自由组合，自动根据内容信号选择最佳视觉方案。触发词：知识漫画、教育漫画、传记漫画、教程漫画、科普漫画、Logicomix 风格、baoyu-comic、把这段内容画成漫画。
---

> **KCoder 桌面端**：本技能依赖的多模态模型凭据（API Key / Base URL /
> 模型名）由桌面端统一配置并注入进程环境——在「设置 → 技能 → 多媒体
> 模型」分区填写即可，无需手动 export。脚本按内置优先级选择已配置
> 的 provider；均未配置时按各脚本自带的默认值与报错引导处理。
# 知识漫画创作器 (Knowledge Comic Creator)

将知识/教育/传记/教程类文本转化为多页叙事型漫画。自动分析内容、设计角色、规划分镜、生成图像、组装输出。

## 触发条件

当用户请求以下任一场景时激活本技能：
- 「知识漫画」「教育漫画」「科普漫画」「传记漫画」「教程漫画」
- 「把这段内容画成漫画」「帮我做一个知识漫画」
- 「baoyu-comic」「Logicomix 风格」
- 用户提供知识/教育/历史/传记类长文，并要求可视化

## 视觉选项

### 艺术风格 (Art Styles) — 5 种

| 风格 | 名称 | 视觉特征 | 适用场景 |
|------|------|---------|---------|
| `ligne-claire` | 清线风格 | 清晰均匀的黑色线条，纯色填充，扁平透视，无阴影。欧洲漫画传统。 | 百科全书、历史事件、技术说明 |
| `manga` | 日式漫画 | 大面积网点/排线阴影，动态速度线，夸张表情，多变的画框形状。 | 人物传记、冒险故事、情感叙事 |
| `realistic` | 写实风格 | 真实比例的人体结构，自然光影渲染，细节丰富的纹理和材质，电影级构图。 | 专业传记、商业故事、饮食文化 |
| `ink-brush` | 水墨风格 | 毛笔笔触的线条变化，墨色干湿浓淡渐变，大面积留白，散点透视。中式美学。 | 中国历史、武侠、古典文学 |
| `chalk` | 粉笔/黑板风格 | 模拟粉笔在黑/绿板上的笔触，手写字体风格，简笔画感，教育场景感。 | 教程、讲座、课堂内容 |

### 色调 (Tones) — 7 种

| 色调 | 名称 | 配色策略 |
|------|------|---------|
| `neutral` | 中性 | 自然灰度 + 柔和原色，克制、客观 |
| `warm` | 温暖 | 暖黄/橙/赭石为主，亲切、人文 |
| `dramatic` | 戏剧 | 高对比明暗，深色背景 + 聚光色，张力 |
| `romantic` | 浪漫 | 柔粉/薰衣草/淡蓝，柔和过渡，抒情 |
| `energetic` | 活力 | 高饱和红/黄/蓝，鲜艳、年轻、动感 |
| `vintage` | 复古 | 泛黄纸底 + 褪色彩印色，怀旧质感 |
| `action` | 动作 | 高对比、动态模糊、爆炸色（橙/红/白），冲击力 |

### 布局 (Layouts) — 7 种

| 布局 | 名称 | 每页格数 | 节奏特点 |
|------|------|---------|---------|
| `standard` | 标准 | 5-7 格 | 方正网格，信息密度适中，阅读节奏平稳 |
| `cinematic` | 电影 | 3-5 格 | 大面积跨格/出血，强调场景氛围，慢节奏 |
| `dense` | 密集 | 8-12 格 | 信息量大，适合教程步骤、时间线展开 |
| `splash` | 冲击 | 1-3 格 | 大幅跨页画面，强调关键瞬间，适合高潮段落 |
| `mixed` | 混合 | 3-6 格 | 大小格自由组合，叙事节奏灵活 |
| `webtoon` | 条漫 | 垂直滚动 | 适合手机阅读，连续纵向叙事流 |
| `four-panel` | 四格 | 4 格 | 起承转合结构，适合幽默/短篇/结论 |

### 宽高比 (Aspect Ratio)

| 宽高比 | 适用场景 |
|--------|---------|
| `3:4` | 竖版（默认），适合手机阅读、条漫 |
| `4:3` | 横版，适合桌面阅读、电影布局 |
| `16:9` | 宽屏，适合演示、cinematic 布局 |

**宽高比在整个漫画中保持一致。**

## 自动选择规则

根据内容信号自动匹配最佳视觉方案。**匹配规则从上到下依次检查，以第一个匹配的规则为准。**

| 优先级 | 内容信号 | 风格 | 色调 | 布局 |
|-------|---------|------|------|------|
| P0 | 用户明确指定 | 用户指定 | 用户指定 | 用户指定 |
| P1 | 武侠、仙侠、中国历史 | `ink-brush` | `dramatic` | `splash` |
| P2 | 计算机、AI、编程 | `ligne-claire` | `neutral` | `dense` |
| P3 | 1950年前历史事件 | `ink-brush` | `vintage` | `cinematic` |
| P4 | 冲突、突破、革命 | `realistic` | `dramatic` | `splash` |
| P5 | 美食、商业、生活方式 | `realistic` | `warm` | `cinematic` |
| P6 | 校园、青春、情感 | `manga` | `romantic` | `standard` |
| P7 | 个人故事、导师叙事 | `manga` | `warm` | `standard` |
| P8 | 教程、入门、操作指南 | `chalk` | `neutral` | `dense` |
| P9 | 传记（均衡型） | `ligne-claire` | `neutral` | `mixed` |
| P10 | 科普、百科 | `ligne-claire` | `warm` | `webtoon` |

P0 最高优先（用户覆盖一切）。P1-P10 按顺序匹配，先匹配到的规则生效。

| 内容信号 | 风格 | 色调 | 布局 |
|---------|------|------|------|
| 教程、入门、操作指南 | `chalk` | `neutral` | `dense` |
| 计算机、AI、编程 | `ligne-claire` | `neutral` | `dense` |
| 1950年前历史事件 | `ink-brush` | `vintage` | `cinematic` |
| 个人故事、导师叙事 | `manga` | `warm` | `standard` |
| 冲突、突破、革命 | `realistic` | `dramatic` | `splash` |
| 美食、商业、生活方式 | `realistic` | `warm` | `cinematic` |
| 武侠、仙侠、中国历史 | `ink-brush` | `dramatic` | `splash` |
| 校园、青春、情感 | `manga` | `romantic` | `standard` |
| 传记（均衡型） | `ligne-claire` | `neutral` | `mixed` |
| 科普、百科 | `ligne-claire` | `warm` | `webtoon` |

用户可以随时覆盖自动选择，混合搭配任意风格 × 色调 × 布局。

## 文件结构

每次会话在 `./` 下创建独立目录：

```
comic/{topic-slug}/
├── source.md                      # 源内容（用户提供或粘贴）
├── analysis.md                    # 深度分析结果
├── storyboard.md                  # 选定分镜脚本
├── characters.md                  # 角色设定文档
├── prompts/                       # 每页的生成 prompt
│   ├── 00-cover.md
│   ├── 01-page.md
│   ├── 02-page.md
│   └── ...
├── images/                        # 生成的漫画页面
│   ├── 00-cover.png
│   ├── 01-page.png
│   ├── 02-page.png
│   └── ...
└── {topic-slug}-comic.pdf         # 合并后的 PDF（可选）
```

**Slug 生成规则**：从主题提取 2-4 个关键词，kebab-case。如 "Alan Turing's Life" → `alan-turing-life`

**冲突处理**：目标目录已存在时追加时间戳 `{slug}-YYYYMMDD-HHMMSS`

## 工作流

### Step 1：内容分析 → `analysis.md`

**目标**：深度理解源内容，提取漫画化的关键要素。

**操作步骤**：
1. **保存源内容**：
   - 用户提供文件路径 → 直接读取
   - 用户粘贴文本 → 保存到 `source.md`
2. **深度分析**：
   - 目标受众定位（谁来读？）
   - 读者价值主张（为什么读？）
   - 核心主题和叙事潜力（讲什么故事？）
   - 关键人物及角色弧（谁在行动？）
   - 戏剧冲突与高潮点（转折在哪里？）
   - 视觉化机会点（哪些场景最「画面感」？）
3. **输出** `analysis.md`（Markdown 格式，包含分析结论和漫画化建议）

### Step 2：角色设计 → `characters.md`

**目标**：定义漫画中出现的所有角色，确保跨页面一致性。

**操作步骤**：
1. 从分析结果中提取所有出场人物
2. 为每个角色创建设定档案：

```markdown
## 角色名

- **年龄**：约 30 岁
- **性别**：男
- **体型**：中等身材，略显消瘦
- **面容**：方脸，戴圆形眼镜，深色短发略微凌乱
- **上衣**：深灰色西装外套 + 白色衬衫（不系领带）
- **下装**：深灰色西裤
- **鞋子**：黑色皮鞋
- **标志性特征**：右手常拿烟斗
- **惯用表情**：思考时皱眉，讲解时微微前倾
```

3. 角色数量控制在 3-8 个主要角色
4. 输出 `characters.md`

**角色一致性机制**：通过文字描述驱动角色一致性。每一页的 image-generation prompt 中必须包含完整的角色描述对象（从 `characters.md` 提取），确保同一角色在不同页面中外观一致。

### Step 3：分镜规划 → `storyboard.md`

**目标**：将内容分解为漫画页面序列，每页确定核心画面和叙事节奏。

**操作步骤**：
1. 确定总页数（建议 5-20 页，取决于内容量）
2. 页面节奏规划：
   - 封面（Page 0）：标题 + 核心视觉
   - 引入（1-2 页）：场景设定、角色出场
   - 展开（主体）：每页 1-2 个关键信息点
   - 高潮（1-2 页）：核心冲突/突破
   - 收尾（1 页）：总结、展望或启示
3. 每页包含：
   - 页面编号和标题
   - 该页的核心信息/知识点
   - 场景描述（地点、时间、氛围）
   - 出场的角色
   - 布局类型（从 7 种中选）
   - **建议格数**（dense=8-12, standard=5-7, cinematic=3-5, splash=1-3, mixed=3-6, webtoon=连续, four-panel=4）
   - **每格简述**（一句话描述该格核心内容，dense 布局至少列出 6 格以上）
   - 对话/旁白要点
   - 视觉重点（画面焦点）

```markdown
## Page 03：破译密码的夜晚

- **核心信息**：图灵发现 Enigma 的弱点——每天早上的天气报告格式固定
- **场景**：布莱切利园小屋，深夜，窗外暴雨
- **角色**：图灵（主）、琼·克拉克
- **布局**：cinematic
- **对话要点**：
  - 琼：「你还不休息？」
  - 图灵（盯着电报）：「等等……每天早上的开头，都是一样的……」
- **视觉焦点**：图灵突然抬头，眼睛发亮——灵感闪现的瞬间
```

4. 输出 `storyboard.md`

### Step 4：生成 Prompt → `prompts/`

**目标**：为每一页漫画生成结构化的 image-generation prompt JSON 文件。

**操作步骤**：
1. 根据分镜脚本，为每一页创建 JSON prompt 文件
2. 每个 prompt 文件包含：

```json
{
  "page_number": 3,
  "page_title": "破译密码的夜晚",
  "characters_in_page": ["图灵", "琼·克拉克"],
  "art_style": "ligne-claire",
  "tone": "dramatic",
  "layout_type": "cinematic",
  "aspect_ratio": "3:4",
  "scene_description": "1940年代的英国乡村小屋内部，深夜。窗外暴风雨，屋内烛光摇曳。木桌上有成堆的电报和笔记。图灵坐在桌前，琼站在门口。",
  "prompt": "1940s British countryside cottage interior, late night, storm visible through window, candlelit room, wooden desk covered with telegraphs and notes. Alan Turing (man, mid-30s, lean build, round glasses, messy dark hair, grey suit jacket, white shirt no tie, pipe in hand) seated at desk, sudden expression of epiphany — eyes wide, leaning forward. Joan Clarke (woman, late-20s, conservative dress, focused expression) standing at doorway. Ligne-claire comic style — clean uniform black outlines, flat color fills, no shading. Dramatic tone — high contrast, warm candle glow against dark stormy background. Single large cinematic panel spanning the page, dramatic low-angle composition emphasizing Turing's moment of insight. Comic page layout, speech bubble from Joan: 'You're still not resting?'",
  "negative_prompt": "photorealistic rendering, 3D CGI, complex gradients, soft shading, anime style, manga screentones",
  "characters_detail": {
    "图灵": "mid-30s man, lean build, squarish face, round wire-rimmed glasses, messy short dark hair, grey suit jacket, white shirt, no tie, often holding pipe, furrowed brow when thinking",
    "琼·克拉克": "late-20s woman, conservative 1940s dress, brown hair in neat waves, focused intelligent expression"
  }
}
```

3. 每页 prompt 的关键元素：
   - `prompt`：完整的英文生成提示词，包含场景、角色、风格、色调
   - `negative_prompt`：排除不希望出现的元素
   - `characters_detail`：从 `characters.md` 提取当前页面的角色描述
   - `characters`：角色对象数组（供 image-generation 技能使用）
4. 保存到 `prompts/` 目录下，按 `NN-page.md` 命名

### Step 5：生成图像

**目标**：使用 image-generation 技能逐页生成漫画图像。

**操作步骤**：
1. 对每一页，调用 image-generation 技能：

```bash
python $DSH_HOME/profiles/web/node_modules/dsh-skills-bundle/skills/image-generation/scripts/generate.py \
  --prompt-file ./comic/{topic-slug}/prompts/03-page.md \
  --output-file ./outputs/comic/{topic-slug}/03-page.png \
  --aspect-ratio 3:4
```

2. **生成顺序**：建议先生成封面以定调，再按页码顺序生成
3. **迭代优化**：如果某页效果不佳，调整 prompt 重新生成
4. **批量提示**：告知用户当前进度（如「正在生成第 5/12 页...」）
5. **时间预估**：生成前告知用户预计总时间（每页约 30-60 秒，N 页约 N×45 秒）

**批量生成**：对于 10 页以上的项目，建议分批生成（每批 3-5 页），每批之间留出时间检查效果。可用以下模式：

```bash
# 批量循环生成（在 bash 中逐页执行）
for i in $(seq 0 12); do
  page_num=$(printf "%02d" $i)
  echo "🖼️  正在生成第 ${page_num} 页..."
  python $DSH_HOME/profiles/web/node_modules/dsh-skills-bundle/skills/image-generation/scripts/generate.py \
    --prompt-file ./comic/{topic-slug}/prompts/${page_num}-page.json \
    --output-file ./outputs/comic/{topic-slug}/${page_num}-page.png \
    --aspect-ratio 3:4
done
```

### Step 6：组装输出

**目标**：将生成的图像交付用户。

**操作步骤**：
1. 将所有生成的 PNG 页面复制到 `./outputs/comic/{topic-slug}/`
3. 提供摘要：总页数、使用的风格/色调/布局、每页简述
4. （如果用户要求 PDF）：使用 Python PIL 或 img2pdf 合并为 PDF

## 自定义样式

用户可以用自然语言描述自定义风格，例如：
- 「画成宫崎骏风格」
- 「像丁丁历险记那种」
- 「用像素艺术风格」
- 「赛博朋克视觉效果」

直接提取用户描述中的关键词，合并到 prompt 中的 `art_style` 字段。

## 参考图片

用户可以上传参考图片来指导视觉风格：
1. 使用 `view_image` 工具查看参考图片
2. 提取视觉特征（风格、调色板、构图偏好）
3. 将视觉特征转化为文字描述合并到 prompt 中
4. **不直接将参考图片传给 image-generation 的 reference-images**（除非用户明确要求）

## 内容缺失处理

当用户只提供主题或标题（无长文内容）时，按以下方式处理：

1. **先用 web_search 获取知识**：搜索主题的百科资料、核心概念、关键时间线
2. **保存搜索结果到 source.md**：整理 500-2000 字的源材料
3. **标注「搜索生成」**：在 source.md 和 analysis.md 中标注信息来源于网络搜索
4. **提示用户审核**：在生成漫画前，展示源材料让用户确认或补充
5. **如用户拒绝网络搜索或搜索无结果**：回应「我需要更多内容来创作漫画。请提供一段文字、一个链接或一个文件，我会把它变成漫画。」

## 语言

- **自动检测**用户输入语言（中文/英文/日文等）
- **漫画文字**（对话、旁白）使用与源内容相同的语言
- **Prompt**（生成提示词）始终使用英文

## 注意事项

- 每页生成需要 30-60 秒，大项目请先预估时间
- 生成失败时自动重试（最多 3 次），调整 prompt 措辞
- 跨页角色一致性依赖文字描述，character_detail 越详细越好
- 建议首次使用先创建一个 3-5 页的短篇熟悉效果
- 生成的图像建议保存，未来可用作参考图片
