# skills 模块（skills module）

> QiLin engine · skills subsystem · 双语 / Bilingual

---

## 中文版

### 职责

`qilin.skills` 是 QiLin 的"技能市场"。技能是结构化的 Markdown 包 + 描述 + 可选脚本，可被 LLM 加载到系统 prompt 中，并在运行时通过 `skill_manage_tool` 进行 CRUD。其安全是 QiLin 最重要的设计点之一。

- **技能目录（catalog）**：`catalog.py` 维护用户/全局两层技能索引
- **描述生成**：`describe.py` 自动从 `SKILL.md` 生成机器可读的 metadata
- **解析**：`parser.py` 解析 frontmatter + Markdown 正文
- **安装**：`installer.py` / `package_paths.py` 把外部 zip / git 仓库落入 `skills_storage`
- **存储**：`storage/`（`SkillStorage` ABC + `LocalSkillStorage` + `UserScopedSkillStorage`）
- **安全扫描**：
  - `security_static_scanner.py`：纯 Python 静态 AST 检测（命令注入 / 路径穿越 / 不安全 import 等）
  - `security_scanner.py`：编排动态 + 静态扫描
  - `skillscan/orchestrator.py`：把 LLM 评审与静态扫描结合
- **技能审核**：`review/` 子模块提供 CLI、可视化评分、Eval Schema、Reader / Analyzer / Renderer
- **斜杠命令**：`slash.py` 注册 `/skill-name` 形式的快捷命令
- **路径权限**：`permissions.py` + `tool_policy.py` 控制 LLM 读 / 写技能产物的合法路径

### 关键文件

| 文件 | 作用 |
|------|------|
| `skills/catalog.py` | 技能目录与索引 |
| `skills/parser.py` | SKILL.md 解析 |
| `skills/frontmatter.py` | YAML frontmatter 解析 |
| `skills/installer.py` | 技能安装 |
| `skills/security_static_scanner.py` | 静态 AST 扫描 |
| `skills/security_scanner.py` | 编排扫描器 |
| `skills/skillscan/orchestrator.py` | LLM + 静态联合评审 |
| `skills/types.py` | `Skill` / `SKILL_MD_FILE` 类型定义 |
| `skills/permissions.py` | 路径权限表 |
| `skills/tool_policy.py` | 工具调用白/黑名单 |
| `skills/storage/` | 存储适配层 |
| `skills/review/` | 技能评分与评审 |

### 设计要点

1. **双层签名**：每个技能入库前必须经过静态扫描通过 + LLM 评审通过；缺一不可。
2. **权限分层**：`path_patterns` 把技能可操作目录映射到 RBAC 中的角色，保证"技能不能写 `/etc`"。
3. **跨用户隔离**：`UserScopedSkillStorage` 把每个用户的能力限定在其作用域。
4. **可观察评审**：`review/cli.py` 提供 CLI、`review/renderer.py` 提供可视化卡片，便于人工 judge。
5. **Inventoried 技能才被 LLM 看到**：未通过审核的技能即使落入存储，也不会出现在 LLM 的工具/system prompt 里。

### 数据流

```
外部源 (zip/git) → installer → SkillStorage
                              ↓
                   security_static_scanner
                              ↓
                   skillscan.orchestrator (LLM review)
                              ↓
                   Inventory (可被 LLM 加载)
```

### 关联模块

- **上游**：`config/skills_config.py`、`config/skill_scan_config.py`、`config/skill_evolution_config.py`
- **调用方**：`agents/lead_agent/prompt.py` 加载已审核技能；`tools/skill_manage_tool.py` 提供 CRUD

---

## English Version

### Responsibility

`qilin.skills` is QiLin's "skill marketplace". A skill is a structured Markdown bundle + descriptor + optional scripts; it can be loaded into the LLM system prompt and managed at runtime via `skill_manage_tool`. Skill safety is among QiLin's most important design concerns.

- **Catalog** — `catalog.py` indexes global + per-user skills
- **Descriptor** — `describe.py` generates machine-readable metadata from `SKILL.md`
- **Parser** — `parser.py` parses frontmatter + Markdown body
- **Installer** — `installer.py` / `package_paths.py` bring external zip / git repos into `skills_storage`
- **Storage** — `storage/` (ABC + LocalSkillStorage + UserScopedSkillStorage)
- **Security scanning**:
  - `security_static_scanner.py` — Python AST-based detection (cmd-injection, path traversal, unsafe imports)
  - `security_scanner.py` — Orchestrates dynamic + static scans
  - `skillscan/orchestrator.py` — Combines LLM review with static scanning
- **Review pipeline** — `review/` provides CLI, visual scoring, eval schemas, readers/analyzers/renderers
- **Slash commands** — `slash.py` registers `/skill-name` shortcuts
- **Path permissions** — `permissions.py` + `tool_policy.py` govern where skill artifacts may be read / written

### Key Files

| File | Purpose |
|------|---------|
| `skills/catalog.py` | Skill catalog and indices |
| `skills/parser.py` | SKILL.md parser |
| `skills/frontmatter.py` | YAML frontmatter parser |
| `skills/installer.py` | Skill installer |
| `skills/security_static_scanner.py` | Static AST scanner |
| `skills/security_scanner.py` | Scanner orchestration |
| `skills/skillscan/orchestrator.py` | LLM + static joint review |
| `skills/types.py` | `Skill` / `SKILL_MD_FILE` definitions |
| `skills/permissions.py` | Path permission table |
| `skills/tool_policy.py` | Tool allow / deny lists |
| `skills/storage/` | Storage adapters |
| `skills/review/` | Skill scoring and review |

### Design Highlights

1. **Dual-layer review** — Each skill must pass BOTH static scanner AND LLM reviewer.
2. **Layered permissions** — `path_patterns` map skill-writable paths onto RBAC roles.
3. **Per-user isolation** — `UserScopedSkillStorage` confines each user to their own scope.
4. **Observable review** — `review/cli.py` and `review/renderer.py` provide CLI and visual cards for human judges.
5. **Inventory gating** — Skills not yet inventoried never appear in the LLM system prompt.

### Data Flow

```
External source (zip/git) → installer → SkillStorage
                                          ↓
                              security_static_scanner
                                          ↓
                              skillscan.orchestrator (LLM review)
                                          ↓
                              Inventory (visible to LLM)
```

### Related Modules

- **Upstream** — `config/skills_config.py`, `config/skill_scan_config.py`, `config/skill_evolution_config.py`
- **Consumers** — `agents/lead_agent/prompt.py` loads inventoried skills; `tools/skill_manage_tool.py` exposes CRUD
