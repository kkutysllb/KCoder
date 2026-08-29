# FORK-NOTES — @kcoder/flowglass

## 来源

- 上游：https://github.com/Iwctwbh/dsh-flowglass （流镜，实时会话流程图）
- 收编基线：**0.4.1**（npm `dsh-flowglass@0.4.1`，2026-08-30 收编）
- 上游仓库只发布构建产物（`flowglass/lib/*.js`），无 TypeScript 源码；本目录的
  `flowglass/lib` 即上游产物本体 + 下列 KCoder 补丁。作者更新缓慢，此后由
  KCoder 自行维护（产物级补丁，补丁以 `FORK-NOTES.md` + git diff 为准）。

## 与上游 0.4.1 的差异（全部在 `flowglass/lib/index.js`）

1. **补全 host `inject` 声明**（KCoder 补丁，上游 bug）：

   ```diff
   - export const inject = ["fs","sessionQuery","timer"]
   + export const inject = ["fs","sessionQuery","timer","sessions","agents",
   +   "sessionPersistence","sandboxPolicy","subprocess","llm","agentDefaultModel"]
   ```

   代码实际 `ctx.get(...)` 消费 10 个服务，但作者只声明了 3 个。rc.2 的
   cordis 宽松解析能蒙混过关；alpha.1 严格化后，未声明的属性访问直接抛
   `cannot get property "sessions" without inject`，整个 loader entry 拒载、
   引擎启动失败页显示「Failed to load plugins: dsh-flowglass」。
   补全的服务名均与上游 dsh 自带插件的 `export const inject` 用法逐一对照
   （headless：sessions/agents/agentDefaultModel；schedule：sessionPersistence；
   llm-*：llm；terminal-bash/bash-sandbox：sandboxPolicy/subprocess）。

2. 外层 `package.json`：包名 `dsh-flowglass` → `@kcoder/flowglass`，版本
   `0.4.1` → `0.4.1-kcoder.1`。插件内部标识（cordis `name: "dsh-flowglass"`、
   patch id `toolbox-bundle-flow`、toolbox 前缀、manifest.json）一律保留上游
   原值——这些字符串被内部逻辑与 patch 层引用，改名风险大于收益。

## 物化与旧包清理

- 物化门（`desktop/main/kcoder-skills-bundle.ts`）把本目录作为
  `@kcoder/flowglass` 注册进 profile `dsh.profile.bundles` 层叠。
- 用户此前从 registry 安装的 `dsh-flowglass`（dependencies + bundles 里的
  残留）由物化门的收编清理自愈拔除，避免新旧两份同时被 loader 加载。

## 上游更新方法

```sh
git clone --depth 1 https://github.com/Iwctwbh/dsh-flowglass.git /tmp/dsh-flowglass-up
# 覆盖 flowglass/（保留 FORK-NOTES 列出的补丁：对照本文件逐条重放）
# 外层 package.json 维持 @kcoder 命名空间与 -kcoder.N 版本号
```

重放补丁后 bump `-kcoder.N` 尾版本触发物化门重拷。
