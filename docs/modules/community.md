# community 模块（community module）

> QiLin engine · community subsystem · 双语 / Bilingual

---

## 中文版

### 职责

`qilin.community` 汇集了 QiLin 内置的第三方生态集成 —— 搜索、爬虫、浏览器自动化、沙箱等。任何一个具体的第三方服务都是"可选 import"，避免不必要的依赖被强制安装。

### 内置集成

#### 搜索（Search）
- `brave/tools.py`：Brave Search
- `serper/tools.py`：Serper（Google SERP API）
- `tavily/tools.py`：Tavily（LLM-friendly 搜索）
- `exa/tools.py`：Exa（语义搜索）
- `ddg_search/tools.py`：DuckDuckGo 搜索
- `searxng/`：自托管 SearXNG 客户端
- `jina_ai/`：Jina Reader
- `infoquest/`：InfoQuest
- `groundroute/tools.py`：GroundRoute 路由搜索
- `image_search/tools.py`：图像搜索

#### 爬虫与浏览器
- `crawl4ai/`：Crawl4AI 客户端
- `firecrawl/tools.py`：Firecrawl
- `fastcrw/tools.py`：FastCrawler
- `browserless/`：Browserless 客户端
- `browser_automation/session.py`：浏览器自动化 session 管理
- `url_safety.py`：URL 安全校验

#### 沙箱 provider
- `aio_sandbox/`：本地 Docker 异步沙箱（含所有权管理）
- `e2b_sandbox/`：E2B 云沙箱
- `boxlite/`：BoxLite 内核级沙箱
- `tenki/`：Tenki 商业云沙箱

#### 工具供给预热
- `warm_pool_lifecycle.py`：沙箱预热生命周期

### 设计要点

1. **可选 import**：每个 provider 都是单文件 README，optional extra 安装后才可用
2. **统一工具接口**：所有搜索工具都被注册到 `tools.tools`，LLM 看到的就是普通 `BaseTool`
3. **沙箱治理**：所有 aio/e2b/boxlite 都通过 `community/<name>/<name>_provider.py` 实现 `SandboxProvider`
4. **URL 安全**：`url_safety.py` 在每个 fetch 类工具前调用，阻止 SSRF 目标

### 关联模块

- **横切**：`tools/tools.py`、`sandbox/`、`config/`
- **下游**：被 `agents/lead_agent/agent.py` 装配到 LangGraph 运行时

---

## English Version

### Responsibility

`qilin.community` bundles QiLin's third-party ecosystem integrations — search, crawl, browser automation, sandbox providers. Each third-party service is "optional import" so unused providers don't pull unnecessary deps.

### Bundled Integrations

#### Search
- `brave/tools.py` — Brave Search
- `serper/tools.py` — Serper (Google SERP API)
- `tavily/tools.py` — Tavily (LLM-friendly)
- `exa/tools.py` — Exa (semantic)
- `ddg_search/tools.py` — DuckDuckGo
- `searxng/` — Self-hosted SearXNG client
- `jina_ai/` — Jina Reader
- `infoquest/` — InfoQuest
- `groundroute/tools.py` — GroundRoute
- `image_search/tools.py` — Image search

#### Crawl & Browser
- `crawl4ai/` — Crawl4AI client
- `firecrawl/tools.py` — Firecrawl
- `fastcrw/tools.py` — FastCrawler
- `browserless/` — Browserless client
- `browser_automation/session.py` — Browser session manager
- `url_safety.py` — URL safety check

#### Sandbox Providers
- `aio_sandbox/` — Local Docker async sandbox (with ownership)
- `e2b_sandbox/` — E2B cloud sandbox
- `boxlite/` — BoxLite kernel-level sandbox
- `tenki/` — Tenki commercial sandbox

#### Warm Pool
- `warm_pool_lifecycle.py` — Sandbox warm-up lifecycle

### Design Highlights

1. **Optional imports** — Each provider is a single file; optional extras gate installation.
2. **Unified tool interface** — All search tools are registered to `tools.tools`.
3. **Sandbox governance** — All aio/e2b/boxlite implement `SandboxProvider` under `community/<name>/<name>_provider.py`.
4. **URL safety** — `url_safety.py` is called before every fetch tool to block SSRF.

### Related Modules

- **Cross-cutting** — `tools/tools.py`, `sandbox/`, `config/`
- **Downstream** — Assembled into LangGraph runtime via `agents/lead_agent/agent.py`
