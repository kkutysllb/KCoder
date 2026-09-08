# 修复完全权限下的重复沙箱升级

## Goal
让已处于 danger-full-access 的 agent 调用不再因重复携带同级 sandbox_permissions 而失败，同时保留工作区内修改的正常执行和受限模式的严格提权规则。

## Task List
- [x] 在当前工作区记录可复现的运行时契约和上游改动载体
- [x] 先写并运行回归测试，验证完全权限下重复提权不会阻断命令
- [x] 添加最小维护补丁，覆盖 bash 以及同契约的文件/PowerShell 工具
- [x] 运行定向测试、构建或静态校验
- [x] 复核工作区差异并记录交付限制

## Findings
- 当前工作区是 /Users/libing/kk_Projects/KCoder，git 工作树初始干净。
- 实际 DSH 源码 checkout 在 /Users/libing/kk_Projects/deepseek-harness，当前分支为 kcoder/0.1.3-alpha.2；它不属于本次工作区，不能把未提交源码改动作为交付。
- dsh-tool-bash、dsh-tool-pwsh 和 dsh-tool-fs 在插件加载时静态公开 sandbox_permissions；执行时把请求与每次调用的 effectiveMode 交给 dsh-sandbox 的严格升级检查。
- 当 effectiveMode 已是 danger-full-access、请求仍为 danger-full-access 时，当前实现会报“not strictly wider”，命令在审批和执行前被拦截。
- danger-full-access 执行器本身会绕过约束并允许文件修改；问题是重复升级请求，不是工作区写入权限不足。
- 当前源码的静态 schema 无法按每个 session 单独变化，因此只隐藏 defaultMode 的字段不能覆盖所有会话覆盖场景。

## Progress Log
- 2026-09-08：完成工作区、runtime 包、上游源码和权限调用链勘察。
- 2026-09-08：先运行红测确认实现缺口，再加入 build-time runtime hotfix；2 个 Node 回归用例、脚本语法检查、真实 staging 产物锚点检查均通过。
- 2026-09-08：桌面端在内置 runtime 解压/复用前执行同一幂等修复，Electron 构建产物已确认包含自愈逻辑。
- 2026-09-08：未修改仓外 DSH checkout 或 OpenKylin；维护层只在 runtime 归档 staging 和桌面端启动自愈路径接入补丁。

## Errors
- glob/grep 工具的 ripgrep provider 多次启动失败，改用 git ls-files、git grep 和定向 read；一次统计用 find 的括号未转义导致 shell 语法错误，未影响源码分析。

## Decision
采用局部幂等处理：只有 requested mode 与当前 effective mode 完全相同且属于已授予的可写模式（workspace-write 或 danger-full-access）时，工具跳过升级审批并沿用当前策略；workspace-write -> danger-full-access 仍走原有审批，full-access 下请求更窄模式仍拒绝。这样不扩大权限，并保持共享升级守卫对真正非加宽请求的拒绝。
