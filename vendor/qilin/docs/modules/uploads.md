# uploads 模块（uploads module）

> QiLin engine · uploads subsystem · 双语 / Bilingual

---

## 中文版

### 职责

`qilin.uploads` 集中管理"用户上传的文件"。它解决一个朴素但琐碎的问题：在多 workspace / 多会话 / 多 sandbox 隔离的环境中，文件到底是什么"路径"？

- **虚拟路径**：用户上传的文件以 `/uploads/...` 的虚拟路径暴露给 LLM，屏蔽物理存储位置
- **生命周期**：上传 → 暂存 → 配额检查 → 关联 thread → 清理
- **元数据**：mime / size / sha256 / 来源 / 用途（agent / human）
- **关联**：file ↔ thread ↔ run ↔ agent，确保可达性
- **隔离**：不同用户的文件互相不可见

### 关键文件

| 文件 | 作用 |
|------|------|
| `uploads/manager.py` | 上传生命周期管理（纯业务逻辑，无 HTTP 依赖） |

### 设计要点

1. **虚拟路径**：LLM 永远看到 `/uploads/xxx.png`，绝对路径不外泄
2. **去重**：相同 sha256 在同一 thread 内去重
3. **配额**：每个 thread / user 有 max_bytes 上限
4. **可见性**：与 `SKILL_INJECTION_PATH` 类似，遵循 `sandbox/path_patterns.py` 的权限
5. **关联**：upload_id ↔ thread_id ↔ run_id，可在 `tools/builtins/view_image_tool.py` 等地方被引用

### 关联模块

- **上游**：`config/paths.py`（uploads 目录路径映射）、`runtime/runs/manager.py`（关联）
- **下游**：被 `tools/builtins/view_image_tool.py`、`present_file_tool.py`、`list_uploaded_files_tool.py` 使用

---

## English Version

### Responsibility

`qilin.uploads` centralizes "user-uploaded files". Solves a simple problem with non-trivial surface area: what "path" is a file in a multi-workspace / multi-session / multi-sandbox environment?

- **Virtual paths** — Uploaded files are exposed to LLM as `/uploads/...`, hiding physical storage
- **Lifecycle** — Upload → staging → quota check → thread association → cleanup
- **Metadata** — mime / size / sha256 / source / purpose (agent/human)
- **Linking** — file ↔ thread ↔ run ↔ agent
- **Isolation** — Different users' files invisible to each other

### Key Files

| File | Purpose |
|------|---------|
| `uploads/manager.py` | Upload lifecycle (pure business logic, no HTTP deps) |

### Design Highlights

1. **Virtual paths** — LLM only sees `/uploads/xxx.png`; absolute paths never leak.
2. **Deduplication** — Same sha256 deduped within a thread.
3. **Quotas** — Per-thread / per-user max_bytes caps.
4. **Visibility** — Respects `sandbox/path_patterns.py` permissions.
5. **Linking** — upload_id ↔ thread_id ↔ run_id, used by `tools/builtins/view_image_tool.py` etc.

### Related Modules

- **Upstream** — `config/paths.py` (uploads path mapping); `runtime/runs/manager.py`
- **Downstream** — `tools/builtins/view_image_tool.py`, `present_file_tool.py`, `list_uploaded_files_tool.py`
