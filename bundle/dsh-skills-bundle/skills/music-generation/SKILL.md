---
name: music-generation
description: Generate music and songs using MiniMax Music-2.6, Music-Cover, and Lyrics Generation APIs. Supports text-to-music, cover/remix, lyrics writing, and full song creation.
---

> **KCoder 桌面端**：本技能依赖的多模态模型凭据（API Key / Base URL /
> 模型名）由桌面端统一配置并注入进程环境——在「设置 → 技能 → 多媒体
> 模型」分区填写即可，无需手动 export。脚本按内置优先级选择已配置
> 的 provider；均未配置时按各脚本自带的默认值与报错引导处理。
# Music Generation Skill

## Overview

This skill generates music using MiniMax's three music models:

| 模型 | API | 功能 | Token Plan 配额 |
|------|-----|------|----------------|
| **Music-2.6** | `/v1/music_generation` | 文字生成音乐（支持纯器乐/带歌词） | 100 首/天 |
| **Music-Cover** | `/v1/music_generation` | 基于参考音频生成翻唱/混音 | — |
| **Lyrics Generation** | `/v1/lyrics_generation` | 根据主题描述生成结构化歌词 | 不限 |

## Core Capabilities

- **Text-to-Music**: 用文字描述风格/情绪，生成音乐（纯器乐或带人声均可）
- **Full Song Creation**: 先自动生成歌词，再用歌词生成完整歌曲
- **Cover/Remix**: 给定一段参考音频，翻唱为不同风格
- **Lyrics Writing**: 单独生成歌词，可编辑、续写
- 所有模式均通过 `generate.py` 脚本一键调用

## Workflow

### Step 1: Understand Requirements

当用户请求音乐生成时，判断他的需求属于哪种模式：

| 用户说 | 对应模式 | `--mode` |
|--------|---------|----------|
| "生成一首轻快的流行歌曲" | 文字生成音乐 | `text2music` |
| "帮我写一首关于夏天的歌" | 完整创作（歌词+音乐） | `full` |
| "把这首歌翻唱成爵士风格" | 翻唱/混音 | `cover` |
| "写一段歌词" | 仅生成歌词 | `lyrics` |

### Step 2: Create Prompt

- 文字生成音乐：写一段描述风格/情绪/场景的文字（1-2000 字符）
- 翻唱模式：描述目标翻唱风格（10-300 字符）
- 歌词模式：描述歌曲主题

将 prompt 保存为 `./{descriptive-name}-music-prompt.txt`

### Step 3: Execute Generation

#### 模式 1：文字生成音乐（Music-2.6）

```bash
# 纯器乐（无歌词）
python $DSH_HOME/profiles/web/node_modules/dsh-skills-bundle/skills/music-generation/scripts/generate.py \
  --mode text2music \
  --prompt-file ./prompt.txt \
  --is-instrumental \
  --output-file ./outputs/music.mp3

# 带歌词
python $DSH_HOME/profiles/web/node_modules/dsh-skills-bundle/skills/music-generation/scripts/generate.py \
  --mode text2music \
  --prompt-file ./prompt.txt \
  --lyrics-file ./lyrics.txt \
  --output-file ./outputs/song.mp3

# 自动生成歌词
python $DSH_HOME/profiles/web/node_modules/dsh-skills-bundle/skills/music-generation/scripts/generate.py \
  --mode text2music \
  --prompt "流行音乐, 欢快, 适合夏日开车" \
  --auto-lyrics \
  --output-file ./outputs/song.mp3
```

#### 模式 2：完整创作（Lyrics Generation → Music-2.6）

自动先写歌词，再生成音乐：

```bash
python $DSH_HOME/profiles/web/node_modules/dsh-skills-bundle/skills/music-generation/scripts/generate.py \
  --mode full \
  --prompt "一首关于夏日海边的轻快情歌" \
  --output-file ./outputs/summer-song.mp3
```

#### 模式 3：翻唱/混音（Music-Cover）

```bash
python $DSH_HOME/profiles/web/node_modules/dsh-skills-bundle/skills/music-generation/scripts/generate.py \
  --mode cover \
  --prompt "Jazz style, slow tempo, saxophone, lounge vibe" \
  --reference-audio /path/to/original.mp3 \
  --output-file ./outputs/cover.mp3
```

#### 模式 4：仅生成歌词（Lyrics Generation）

```bash
python $DSH_HOME/profiles/web/node_modules/dsh-skills-bundle/skills/music-generation/scripts/generate.py \
  --mode lyrics \
  --prompt "一首关于星空和思念的民谣" \
  --output-file ./outputs/lyrics_output.json
```

## Parameters Reference

| 参数 | 说明 | 适用模式 |
|------|------|---------|
| `--mode` | `text2music` / `cover` / `lyrics` / `full` | 全部 |
| `--prompt` | 直接传入提示词文本 | 全部 |
| `--prompt-file` | 提示词文件路径（与 --prompt 二选一） | 全部 |
| `--lyrics` | 直接传入歌词文本 | text2music, cover |
| `--lyrics-file` | 歌词文件路径 | text2music, cover |
| `--auto-lyrics` | 自动从 prompt 生成歌词 | text2music |
| `--is-instrumental` | 仅生成器乐（无人声） | text2music, full |
| `--reference-audio` | 参考音频文件路径（6s-6min, <50MB） | cover |
| `--output-file` | 输出文件绝对路径（必填） | 全部 |
| `--format` | 音频格式：`mp3` / `wav` / `flac`（默认 mp3） | text2music, cover, full |

## Lyrics Format

Lyrics support 14 section tags for structured songs:

```
[Intro], [Verse], [Pre-Chorus], [Chorus], [Hook], [Drop],
[Bridge], [Solo], [Build-up], [Instrumental], [Breakdown],
[Break], [Interlude], [Outro]
```

Example:
```
[Intro]
(Ooh-ooh-ooh)

[Verse 1]
夏日微风吹过海面
浪花轻轻拍打岸边

[Chorus]
这一刻，只有你和我
阳光下的约定永不褪色
```

Use `\n` as the line separator when passing lyrics via `--lyrics`.

## Music Generation Example

用户请求："帮我创作一首关于城市夜晚的电子音乐，要有未来感"

### 完整创作流程（推荐 `full` 模式）

**Step 1**: 直接用 `--mode full` 一键完成

```bash
python $DSH_HOME/profiles/web/node_modules/dsh-skills-bundle/skills/music-generation/scripts/generate.py \
  --mode full \
  --prompt "电子音乐，未来感，城市夜晚的霓虹灯光，迷幻氛围，中速节奏" \
  --output-file ./outputs/city-night-electronic.mp3
```

脚本将自动：
1. 调用 Lyrics Generation API 生成歌词（含歌名、风格标签、分段歌词）
2. 将歌词送入 Music-2.6 生成完整歌曲

### 手动分步流程

**Step 1**: 先生成歌词
```bash
python $DSH_HOME/profiles/web/node_modules/dsh-skills-bundle/skills/music-generation/scripts/generate.py \
  --mode lyrics \
  --prompt "电子音乐，未来感，城市夜晚的霓虹灯光" \
  --output-file ./outputs/lyrics.json
```

**Step 2**: 用歌词生成音乐
```bash
python $DSH_HOME/profiles/web/node_modules/dsh-skills-bundle/skills/music-generation/scripts/generate.py \
  --mode text2music \
  --prompt "Electronic, Futuristic, City Night, Neon Lights, Psychedelic, Mid-tempo" \
  --lyrics-file ./outputs/lyrics.json \
  --output-file ./outputs/city-night-electronic.mp3
```

> Do NOT read the python file, just call it with the parameters.

## Cover Example

用户请求："把这首《月亮代表我的心》翻唱成摇滚风格"

```bash
python $DSH_HOME/profiles/web/node_modules/dsh-skills-bundle/skills/music-generation/scripts/generate.py \
  --mode cover \
  --prompt "Rock style, electric guitar, heavy drums, energetic" \
  --reference-audio ./uploads/moon-represents-my-heart.mp3 \
  --output-file ./outputs/moon-rock-cover.mp3
```

> 参考音频要求：时长 6 秒至 6 分钟，大小 ≤ 50MB，格式支持 mp3/wav/flac。

## Output Handling

- 音乐文件默认保存为 MP3，输出到 `./outputs/`
- `lyrics` 模式额外生成 `*_lyrics.json` 文件，包含歌名、风格标签、歌词
- 歌词可以和音乐文件一起展示

## Notes

- Always use English for music style prompts (e.g., "Pop, Upbeat, Female Vocals")
- Use Chinese for lyrics when the target language is Chinese
- Music-2.6 in Token Plan has a **100 songs/day** quota — use wisely
- The `auto-lyrics` mode calls the Lyrics Generation API internally and may have additional latency
- For `cover` mode, the original audio's lyrics will be auto-extracted via ASR if `--lyrics` is not provided
