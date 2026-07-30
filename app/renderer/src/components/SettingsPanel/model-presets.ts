/**
 * 模型供应商预设 —— 单一事实来源。
 *
 * 派生自 vendor/qilin/config.example.yaml @ QiLin v1.0.0。
 * 升级 QiLin 引擎时，对照 config.example.yaml 的 models: 段落更新本文件，
 * 并在 VENDOR_VERSION 更新后 grep 本注释定位此处。
 *
 * 核心设计：每个预设的 `use`（class path）决定引擎路由到补丁版 provider
 * 还是裸 langchain class。国内模型几乎都走补丁版（修复多轮 reasoning_content
 * 丢失、name 字段剥离、thought_signature 保留等问题），用户无需理解差异，
 * 选一个 provider 后只需填 apiKey 即可。
 *
 * 补丁原因速查（详见 vendor/qilin/qilin/models/patched_*.py 文档字符串）：
 *   - PatchedChatDeepSeek: 多轮对话 reasoning_content 回放
 *   - PatchedChatMiMo:     MiMo reasoning_content 回放
 *   - PatchedChatMiniMax:  reasoning 映射 + name 字段剥离（否则 2013 错误）
 *   - PatchedChatStepFun:  deepseek-style reasoning 回放
 *   - PatchedChatOpenAI:   Gemini 网关 thought_signature 保留
 *   - VllmChatModel:       vLLM Qwen reasoning 保留 + chat_template_kwargs 切换
 *   - MindIEChatModel:     昇腾 mock-streaming 适配
 *   - ClaudeChatModel:     Claude Code OAuth 凭证加载
 *   - CodexChatModel:      ChatGPT Codex Responses API
 */

export type ModelPresetCategory = '国内·补丁' | '国外·通用' | '本地部署'

export interface ModelPreset {
  /** 唯一 id，同时作为 user-data.json 里 model profile 的 name */
  id: string
  /** UI 显示名 */
  displayName: string
  /** 分类（左侧分组） */
  category: ModelPresetCategory
  /**
   * 引擎 class path（module:Class）。核心字段 —— 决定路由到补丁版还是裸
   * langchain class。写入 user-data.json 后由引擎注入环节消费。
   */
  use: string
  /** 预填 baseUrl；本地部署 / 网关类可编辑 */
  defaultBaseUrl: string
  /** baseUrl 是否可编辑（vllm/ollama/mindie/gemini-gw 为 true） */
  baseUrlEditable: boolean
  /** apiKey 是否必填（ollama/vllm 本地部署可 false） */
  apiKeyRequired: boolean
  /** apiKey 输入框 placeholder，提示对应的环境变量名 */
  apiKeyEnvHint: string
  /** 默认是否支持深度思考 */
  supportsThinkingDefault: boolean
  /** 默认是否支持视觉理解 */
  supportsVisionDefault: boolean
  /** 默认是否支持 reasoning_effort */
  supportsReasoningEffortDefault: boolean
  /**
   * 思考模式开启时的参数模板（从 config.example.yaml 提取）。
   * 用户在 UI 只看到一个「深度思考」开关，开则写入此模板。
   */
  whenThinkingEnabled?: Record<string, unknown>
  /** 思考模式关闭时的参数模板 */
  whenThinkingDisabled?: Record<string, unknown>
  /** 常见模型 id 列表，作为快捷选择 chips 展示 */
  commonModels: string[]
  /** 来自 config.example.yaml 的注释要点（补丁原因、注意事项） */
  notes?: string
}

/**
 * 16 个权威预设。顺序即 UI 显示顺序，按 category 分组渲染。
 */
export const MODEL_PRESETS: ModelPreset[] = [
  // ============ 国内·补丁（8 个）============
  {
    id: 'deepseek',
    displayName: 'DeepSeek',
    category: '国内·补丁',
    use: 'qilin.models.patched_deepseek:PatchedChatDeepSeek',
    defaultBaseUrl: 'https://api.deepseek.com',
    baseUrlEditable: false,
    apiKeyRequired: true,
    apiKeyEnvHint: '$DEEPSEEK_API_KEY',
    supportsThinkingDefault: true,
    supportsVisionDefault: false,
    supportsReasoningEffortDefault: true,
    whenThinkingEnabled: { extra_body: { thinking: { type: 'enabled' } } },
    whenThinkingDisabled: { extra_body: { thinking: { type: 'disabled' } } },
    commonModels: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-v4-pro'],
    notes: 'PatchedChatDeepSeek 修复多轮对话 reasoning_content 丢失问题',
  },
  {
    id: 'kimi',
    displayName: 'Kimi（月之暗面）',
    category: '国内·补丁',
    use: 'qilin.models.patched_deepseek:PatchedChatDeepSeek',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    baseUrlEditable: false,
    apiKeyRequired: true,
    apiKeyEnvHint: '$MOONSHOT_API_KEY',
    supportsThinkingDefault: true,
    supportsVisionDefault: true,
    supportsReasoningEffortDefault: false,
    whenThinkingEnabled: { extra_body: { thinking: { type: 'enabled' } } },
    whenThinkingDisabled: { extra_body: { thinking: { type: 'disabled' } } },
    commonModels: ['kimi-k2.5', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    notes: '复用 PatchedChatDeepSeek（OpenAI 兼容 + reasoning 回放）',
  },
  {
    id: 'doubao',
    displayName: '豆包（火山引擎）',
    category: '国内·补丁',
    use: 'qilin.models.patched_deepseek:PatchedChatDeepSeek',
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    baseUrlEditable: false,
    apiKeyRequired: true,
    apiKeyEnvHint: '$VOLCENGINE_API_KEY',
    supportsThinkingDefault: true,
    supportsVisionDefault: true,
    supportsReasoningEffortDefault: true,
    whenThinkingEnabled: { extra_body: { thinking: { type: 'enabled' } } },
    whenThinkingDisabled: { extra_body: { thinking: { type: 'disabled' } } },
    commonModels: ['doubao-seed-1-8-251228', 'doubao-pro-4k', 'doubao-pro-32k'],
    notes: 'PatchedChatDeepSeek 适配火山 Ark OpenAI 兼容端点',
  },
  {
    id: 'volcengine-cp',
    displayName: '火山 Coding Plan',
    category: '国内·补丁',
    use: 'qilin.models.patched_deepseek:PatchedChatDeepSeek',
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
    baseUrlEditable: false,
    apiKeyRequired: true,
    apiKeyEnvHint: '$VOLCENGINE_API_KEY',
    supportsThinkingDefault: true,
    supportsVisionDefault: false,
    supportsReasoningEffortDefault: true,
    whenThinkingEnabled: { extra_body: { thinking: { type: 'enabled' } } },
    whenThinkingDisabled: { extra_body: { thinking: { type: 'disabled' } } },
    commonModels: ['glm-5.2', 'deepseek-v4-pro', 'kimi-k2.5', 'MiniMax-M3'],
    notes: '一个 key 访问多模型网关（豆包/GLM/DeepSeek/Kimi/MiniMax）',
  },
  {
    id: 'mimo',
    displayName: '小米 MiMo',
    category: '国内·补丁',
    use: 'qilin.models.patched_mimo:PatchedChatMiMo',
    defaultBaseUrl: 'https://api.xiaomimimo.com/v1',
    baseUrlEditable: false,
    apiKeyRequired: true,
    apiKeyEnvHint: '$MIMO_API_KEY',
    supportsThinkingDefault: true,
    supportsVisionDefault: false,
    supportsReasoningEffortDefault: false,
    whenThinkingEnabled: { extra_body: { thinking: { type: 'enabled' } } },
    whenThinkingDisabled: { extra_body: { thinking: { type: 'disabled' } } },
    commonModels: ['mimo-v2.5-pro', 'mimo-v2.5', 'mimo-v2-pro', 'mimo-v2-flash'],
    notes: 'PatchedChatMiMo 是 model-id 无关的，所有 MiMo thinking 模型都用它',
  },
  {
    id: 'minimax-cn',
    displayName: 'MiniMax（国内）',
    category: '国内·补丁',
    use: 'qilin.models.patched_minimax:PatchedChatMiniMax',
    defaultBaseUrl: 'https://api.minimaxi.com/v1',
    baseUrlEditable: false,
    apiKeyRequired: true,
    apiKeyEnvHint: '$MINIMAX_API_KEY',
    supportsThinkingDefault: true,
    supportsVisionDefault: true,
    supportsReasoningEffortDefault: false,
    whenThinkingEnabled: { extra_body: { thinking: { type: 'adaptive' } } },
    whenThinkingDisabled: { extra_body: { thinking: { type: 'disabled' } } },
    commonModels: ['MiniMax-M3', 'MiniMax-M2.7', 'MiniMax-M2.7-highspeed'],
    notes: 'PatchedChatMiniMax 剥离 name 字段（否则 2013 错误）+ reasoning 映射',
  },
  {
    id: 'minimax-intl',
    displayName: 'MiniMax（国际）',
    category: '国内·补丁',
    use: 'qilin.models.patched_minimax:PatchedChatMiniMax',
    defaultBaseUrl: 'https://api.minimax.io/v1',
    baseUrlEditable: false,
    apiKeyRequired: true,
    apiKeyEnvHint: '$MINIMAX_API_KEY',
    supportsThinkingDefault: true,
    supportsVisionDefault: true,
    supportsReasoningEffortDefault: false,
    whenThinkingEnabled: { extra_body: { thinking: { type: 'adaptive' } } },
    whenThinkingDisabled: { extra_body: { thinking: { type: 'disabled' } } },
    commonModels: ['MiniMax-M3', 'MiniMax-M2.7'],
    notes: '国际版端点，适配逻辑同国内版',
  },
  {
    id: 'stepfun',
    displayName: '阶跃星辰 StepFun',
    category: '国内·补丁',
    use: 'qilin.models.patched_stepfun:PatchedChatStepFun',
    defaultBaseUrl: 'https://api.stepfun.com/v1',
    baseUrlEditable: false,
    apiKeyRequired: true,
    apiKeyEnvHint: '$STEPFUN_API_KEY',
    supportsThinkingDefault: true,
    supportsVisionDefault: true,
    supportsReasoningEffortDefault: true,
    whenThinkingEnabled: { extra_body: { reasoning_format: 'deepseek-style' } },
    whenThinkingDisabled: { extra_body: { reasoning_format: 'deepseek-style' } },
    commonModels: ['step-3.7-flash', 'step-2-16k', 'step-1v-32k'],
    notes: 'PatchedChatStepFun 用 deepseek-style reasoning 格式回放',
  },

  // ============ 国外·通用（6 个）============
  {
    id: 'openai',
    displayName: 'OpenAI',
    category: '国外·通用',
    use: 'langchain_openai:ChatOpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    baseUrlEditable: false,
    apiKeyRequired: true,
    apiKeyEnvHint: '$OPENAI_API_KEY',
    supportsThinkingDefault: false,
    supportsVisionDefault: true,
    supportsReasoningEffortDefault: false,
    commonModels: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-5'],
    notes: '通用 OpenAI 兼容；GPT-5 可开 use_responses_api',
  },
  {
    id: 'claude',
    displayName: 'Claude（Anthropic）',
    category: '国外·通用',
    use: 'langchain_anthropic:ChatAnthropic',
    defaultBaseUrl: 'https://api.anthropic.com',
    baseUrlEditable: false,
    apiKeyRequired: true,
    apiKeyEnvHint: '$ANTHROPIC_API_KEY',
    supportsThinkingDefault: true,
    supportsVisionDefault: true,
    supportsReasoningEffortDefault: false,
    whenThinkingEnabled: { thinking: { type: 'enabled', budget_tokens: 4096 } },
    whenThinkingDisabled: { thinking: { type: 'disabled' } },
    commonModels: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-3-5-sonnet-20241022'],
    notes: 'budget_tokens 必填（min 1024，须 < max_tokens）',
  },
  {
    id: 'gemini',
    displayName: 'Gemini（原生）',
    category: '国外·通用',
    use: 'langchain_google_genai:ChatGoogleGenerativeAI',
    defaultBaseUrl: '',
    baseUrlEditable: false,
    apiKeyRequired: true,
    apiKeyEnvHint: '$GEMINI_API_KEY',
    supportsThinkingDefault: false,
    supportsVisionDefault: true,
    supportsReasoningEffortDefault: false,
    commonModels: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
    notes: '原生 SDK 不支持 thinking；需 thinking 请用 Gemini（网关）预设',
  },
  {
    id: 'gemini-gw',
    displayName: 'Gemini（OpenAI 网关）',
    category: '国外·通用',
    use: 'qilin.models.patched_openai:PatchedChatOpenAI',
    defaultBaseUrl: '',
    baseUrlEditable: true,
    apiKeyRequired: true,
    apiKeyEnvHint: '$GEMINI_API_KEY',
    supportsThinkingDefault: true,
    supportsVisionDefault: true,
    supportsReasoningEffortDefault: false,
    whenThinkingEnabled: { extra_body: { thinking: { type: 'enabled' } } },
    whenThinkingDisabled: { extra_body: { thinking: { type: 'disabled' } } },
    commonModels: ['google/gemini-2.5-pro-preview', 'google/gemini-2.5-flash-preview'],
    notes: 'PatchedChatOpenAI 保留 tool-call thought_signature（Gemini thinking 必需）',
  },
  {
    id: 'novita',
    displayName: 'Novita AI',
    category: '国外·通用',
    use: 'langchain_openai:ChatOpenAI',
    defaultBaseUrl: 'https://api.novita.ai/openai',
    baseUrlEditable: false,
    apiKeyRequired: true,
    apiKeyEnvHint: '$NOVITA_API_KEY',
    supportsThinkingDefault: true,
    supportsVisionDefault: true,
    supportsReasoningEffortDefault: false,
    whenThinkingEnabled: { extra_body: { thinking: { type: 'enabled' } } },
    whenThinkingDisabled: { extra_body: { thinking: { type: 'disabled' } } },
    commonModels: ['deepseek/deepseek-v3.2', 'deepseek/deepseek-r1'],
    notes: 'OpenAI 兼容 API',
  },
  {
    id: 'openrouter',
    displayName: 'OpenRouter',
    category: '国外·通用',
    use: 'langchain_openai:ChatOpenAI',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    baseUrlEditable: false,
    apiKeyRequired: true,
    apiKeyEnvHint: '$OPENROUTER_API_KEY',
    supportsThinkingDefault: false,
    supportsVisionDefault: false,
    supportsReasoningEffortDefault: false,
    commonModels: ['google/gemini-2.5-flash-preview', 'anthropic/claude-3.5-sonnet', 'openai/gpt-4o'],
    notes: 'OpenAI 兼容多模型网关',
  },

  // ============ 本地部署（3 个）============
  {
    id: 'ollama',
    displayName: 'Ollama',
    category: '本地部署',
    use: 'langchain_ollama:ChatOllama',
    defaultBaseUrl: 'http://localhost:11434',
    baseUrlEditable: true,
    apiKeyRequired: false,
    apiKeyEnvHint: '（本地部署无需 apiKey）',
    supportsThinkingDefault: true,
    supportsVisionDefault: false,
    supportsReasoningEffortDefault: false,
    commonModels: ['qwen3:32b', 'llama3.3:70b', 'gemma2:27b'],
    notes: 'baseUrl 不带 /v1（用原生 /api/chat 保留 thinking）',
  },
  {
    id: 'vllm',
    displayName: 'vLLM',
    category: '本地部署',
    use: 'qilin.models.vllm_provider:VllmChatModel',
    defaultBaseUrl: 'http://localhost:8000/v1',
    baseUrlEditable: true,
    apiKeyRequired: false,
    apiKeyEnvHint: '（本地部署无需 apiKey）',
    supportsThinkingDefault: true,
    supportsVisionDefault: false,
    supportsReasoningEffortDefault: false,
    whenThinkingEnabled: { extra_body: { chat_template_kwargs: { enable_thinking: true } } },
    whenThinkingDisabled: { extra_body: { chat_template_kwargs: { enable_thinking: false } } },
    commonModels: ['Qwen/Qwen3-32B', 'Qwen/Qwen2.5-72B-Instruct'],
    notes: 'VllmChatModel 保留 Qwen reasoning；服务端需 --reasoning-parser',
  },
  {
    id: 'mindie',
    displayName: 'MindIE（华为昇腾）',
    category: '本地部署',
    use: 'qilin.models.mindie_provider:MindIEChatModel',
    defaultBaseUrl: 'http://localhost:8989/v1',
    baseUrlEditable: true,
    apiKeyRequired: false,
    apiKeyEnvHint: '$OPENAI_API_KEY（可选）',
    supportsThinkingDefault: false,
    supportsVisionDefault: false,
    supportsReasoningEffortDefault: false,
    commonModels: ['Qwen3-Coder-480B-A35B-Instruct-Client'],
    notes: 'MindIEChatModel mock-streaming 适配，需配置 read_timeout 等',
  },
]

/** 按 id 索引的 map，O(1) 查找 */
export const MODEL_PRESET_BY_ID: Record<string, ModelPreset> = Object.fromEntries(
  MODEL_PRESETS.map((p) => [p.id, p])
)

/** 判断一个 preset 是否为补丁版（use 以 qilin.models 开头） */
export function isPatchedProvider(preset: ModelPreset): boolean {
  return preset.use.startsWith('qilin.models.')
}

/** 三类分组的顺序，用于 UI 渲染 */
export const PRESET_CATEGORY_ORDER: ModelPresetCategory[] = ['国内·补丁', '国外·通用', '本地部署']
