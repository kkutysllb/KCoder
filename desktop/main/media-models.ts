/**
 * 多媒体技能的多模态模型凭据：字段定义、env 读写与 dsh 注入。
 *
 * 内置 multimedia 技能（image/video/music/podcast-generation，bundle
 * kcoder-skills 整资源分发）的生成脚本通过环境变量读取各 provider
 * 凭据（os.getenv）。桌面端在「设置 → 技能 → 多媒体模型」分区统一
 * 收集用户配置：
 *
 * - 存储：`$DSH_HOME/media-models.env`（KEY=VALUE 行式，dotenv 兼容；
 *   只写已知字段与非空值，密钥明文存储与 ~/.aws/credentials 同级敏感度）
 * - 注入：dsh-manager spawn dsh 侧车时合并进子进程 env（mediaSpawnEnv），
 *   agent 的 bash/python 工具进程继承后 os.getenv 即可读到；dsh 存活
 *   期间不重读——面板保存后需重启引擎生效
 * - 字段表（MEDIA_MODEL_GROUPS）同时驱动面板渲染与写端白名单，单一
 *   事实源；脚本侧默认值只作 placeholder 提示不落盘
 *
 * @module desktop/main/media-models
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dshHome } from './dsh-contract'

/** 凭据型输入框（面板 type=password）。 */
export interface MediaModelField {
  /** 环境变量名（写端白名单键）。 */
  readonly key: string
  /** 面板标签。 */
  readonly label: string
  /** 占位提示（脚本内置默认值或示例；空 = 无默认、必填才生效）。 */
  readonly placeholder: string
  /** 密钥型（password 输入框）。 */
  readonly secret?: boolean
}

/** 面板分组（按 provider 维度，跨技能共享凭据）。 */
export interface MediaModelGroup {
  readonly id: string
  readonly title: string
  /** 用途说明（哪些技能消费）。 */
  readonly note: string
  readonly fields: readonly MediaModelField[]
}

/** 多媒体模型字段表（6 组 / 21 字段——与 KSkills 脚本 os.getenv 清单对齐）。 */
export const MEDIA_MODEL_GROUPS: readonly MediaModelGroup[] = [
  {
    id: 'image-seedream',
    title: '图像生成 · Seedream / OpenAI 兼容',
    note: 'image-generation 技能的优先 provider（火山方舟 doubao-seedream 等 OpenAI images 兼容端点）',
    fields: [
      { key: 'GEMINI_API_KEY', label: 'API Key', placeholder: '', secret: true },
      { key: 'GEMINI_BASE_URL', label: 'Base URL', placeholder: 'https://ark.cn-beijing.volces.com/api/v3' },
      { key: 'GEMINI_MODEL', label: '模型', placeholder: 'doubao-seedream-5-0-260128' },
    ],
  },
  {
    id: 'image-gpt',
    title: '图像生成 · GPT-Image2（备用）',
    note: 'image-generation 技能的回退 provider（OpenAI gpt-image 系兼容端点）',
    fields: [
      { key: 'GPT_IMAGE2_API_KEY', label: 'API Key', placeholder: '', secret: true },
      { key: 'GPT_IMAGE2_BASE_URL', label: 'Base URL', placeholder: 'https://api.openai.com/v1' },
      { key: 'GPT_IMAGE2_MODEL', label: '模型', placeholder: 'gpt-image-2' },
    ],
  },
  {
    id: 'video-veo',
    title: '视频生成 · Veo',
    note: 'video-generation 技能（Gemini API 根端点或 /v1beta 代理）',
    fields: [
      { key: 'GEMINI_VIDEO_API_KEY', label: 'API Key', placeholder: '', secret: true },
      { key: 'GEMINI_VIDEO_BASE_URL', label: 'Base URL', placeholder: 'https://generativelanguage.googleapis.com' },
      { key: 'GEMINI_VIDEO_MODEL', label: '模型', placeholder: 'veo-3.1-generate-001' },
      { key: 'GEMINI_VIDEO_FAST_MODEL', label: '快速模型', placeholder: 'veo-3.1-fast-generate-001' },
    ],
  },
  {
    id: 'video-kling',
    title: '视频生成 · 可灵（备用）',
    note: 'video-generation 技能；API Key（代理 Bearer）或 Access/Secret（官方 JWT）二选一',
    fields: [
      { key: 'KLING_API_KEY', label: 'API Key（代理）', placeholder: '', secret: true },
      { key: 'KLING_ACCESS_KEY', label: 'Access Key（官方）', placeholder: '', secret: true },
      { key: 'KLING_SECRET_KEY', label: 'Secret Key（官方）', placeholder: '', secret: true },
      { key: 'KLING_BASE_URL', label: 'Base URL', placeholder: 'https://api-beijing.klingai.com' },
      { key: 'KLING_MODEL', label: '模型', placeholder: 'kling-v2-6' },
    ],
  },
  {
    id: 'music-minimax',
    title: '音乐生成 · MiniMax',
    note: 'music-generation 技能（Music-2.6 / Cover / Lyrics API）',
    fields: [
      { key: 'MINIMAX_API_KEY', label: 'API Key', placeholder: '', secret: true },
      { key: 'MINIMAX_BASE_URL', label: 'Base URL', placeholder: 'https://api.minimaxi.com' },
    ],
  },
  {
    id: 'podcast-tts',
    title: '播客语音 · 火山 TTS',
    note: 'podcast-generation 技能（豆包 TTS 双人播客合成）',
    fields: [
      { key: 'TTS_APPID', label: 'App ID', placeholder: '' },
      { key: 'TTS_ACCESS_TOKEN', label: 'Access Token', placeholder: '', secret: true },
      { key: 'TTS_API_URL', label: 'API URL', placeholder: 'https://openspeech.bytedance.com/api/v1/tts' },
      { key: 'TTS_CLUSTER', label: '集群', placeholder: 'default' },
    ],
  },
]

/** 所有已知字段键（写端白名单）。 */
const KNOWN_KEYS = new Set(MEDIA_MODEL_GROUPS.flatMap((g) => g.fields.map((f) => f.key)))

/** env 文件路径（$DSH_HOME/media-models.env）。 */
export function mediaModelEnvPath(): string {
  return join(dshHome(), 'media-models.env')
}

/**
 * 读取已存配置：行式 KEY=VALUE，忽略 # 注释与空行，剥成对单/双引号。
 * 未知键与格式异常行静默跳过（读端宽松——手工编辑不致命）。
 */
export function readMediaModelEnv(): Record<string, string> {
  let raw = ''
  try {
    raw = readFileSync(mediaModelEnvPath(), 'utf8')
  } catch {
    return {}
  }
  const out: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (key !== '') out[key] = value
  }
  return out
}

/**
 * 保存配置：只落已知字段（写端白名单——防止面板伪造注入任意 env，
 * 如 LD_PRELOAD 类注入面）且非空值；按分组写注释头。原子性依赖同
 * 目录小文件单次 writeFileSync（与 profile 清单同策略）。
 */
export function writeMediaModelEnv(values: Record<string, string>): void {
  const lines: string[] = [
    '# KCoder 多媒体技能模型凭据（设置 → 技能 → 多媒体模型维护）',
    '# dsh 引擎启动时读取注入进程环境；修改后需重启引擎生效。',
    '',
  ]
  for (const group of MEDIA_MODEL_GROUPS) {
    const kept = group.fields.filter((f) => {
      const v = values[f.key]
      return typeof v === 'string' && v.trim() !== ''
    })
    if (kept.length === 0) continue
    lines.push(`# ${group.title}`)
    for (const field of kept) {
      lines.push(`${field.key}=${values[field.key].trim()}`)
    }
    lines.push('')
  }
  writeFileSync(mediaModelEnvPath(), `${lines.join('\n')}\n`)
}

/**
 * dsh 侧车进程的 env 增量：读端结果过滤已知键（存量的手工键不透传）。
 * 文件缺失/解析失败返回空对象（引擎照常启动，技能侧走脚本默认值）。
 */
export function mediaSpawnEnv(): Record<string, string> {
  const stored = readMediaModelEnv()
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(stored)) {
    if (KNOWN_KEYS.has(key) && value !== '') out[key] = value
  }
  return out
}
