# 内置插件开发清单（KCoder）

> **这份清单只收「已经用实机测试换来」的坑。** 每条都给：症状 → 根因 → 正确做法 → 判据。
> 适用 `dsh-coding-sidebar` / `dsh-file-review-kcoder` / `dsh-terminal` / `dsh-skills-bundle` / `dsh-shell-prefs`，以及任何随包分发的插件。
> 出处见文末——三条是一次功能迭代里连着踩出来的，**每一次静态检查都是全绿的**。

## 执行点（2026-09-25 起已自动化，不必靠人记）

| 规则 | 断言命令 | 挂在哪 |
|---|---|---|
| §1 可选面只能走 `ctx.get` / `ctx.inject` | `pnpm check:contract`（dsh-coding-sidebar 仓） | `pnpm test` · `prepack`（发布必过）· CI `Contract` |
| §2 插件改动必须 bump 版本 | `node scripts/check-bundle-version-line.mjs`（KCoder 仓） | `release.sh prepush`（发版必过）· CI `Plugin Contract` |
| §3 `openTab` 要看得见就带 `meta` | 同 §1 的 `check:contract` | 同 §1 |
| §4 声明只指向已发布版本、且与物化同线 | 同 §2 的脚本（规则①：声明下界 == bundle 版本） | 同 §2 |

两支断言都做过**判别力自检**（注入违规必须 FAIL、还原必须 PASS）：§2 的脚本不会因为
「只改了文档 / 源码注释 / sourcemap」就叫你 bump 版本（开发面豁免：`src/**`、`scripts/**`、
`tests/**`、`docs/**`、`*.md`、`LICENSE`、`*.map`，以及 `package.json` 里只动
`scripts` / `devDependencies` / `files` / `packageManager` 的情况）——运行时面是
**`lib/**` + `cordis.patch.yml` + package.json 的运行时字段**。

---

## 1. 可选面（服务 / remote 面）只能走 `ctx.get` 或 `ctx.inject`

> **已自动化**：插件仓 `pnpm check:contract`（AST 级，注释与字符串里的 `ctx.remote.x` 是文档、不误报）。

**症状**（两种，都是运行时才现）
- 渲染时报 `读取任务失败: cannot get property "remote.schedule" without inject`；
- 或者反过来：插件在**缺少某个可选插件**的载具上**整体不挂载**（用户看见功能整块消失）。

**根因**
- `ctx.remote` 是**可追踪服务代理**：深层路径（`remote.<face>`）会被**整体**校验 inject，**直接读属性即抛**——不是返回 `undefined`。
- Cordis 的 inject 是 **all-required**：把一个**可选**面写进 `export const inject`，等于声明「没有它我不活」。

**正确做法**
```ts
// ① 同步探针（服务层；可选面首选）。ctx.get 对缺失服务返回 undefined，不抛。
const workspaces = ctx.get('workspaces') as OpenPathService | undefined

// ② 深层 remote 面：延迟装配。回调收到**派生 ctx**，在里面才能读那个面；
//    面就绪即回调（已在则同步触发），永不出现则回调不触发。
const fiber = ctx.inject(['remote.schedule'], (scoped) => {
  const face = (scoped as unknown as { remote?: { schedule?: ScheduleFace } }).remote?.schedule
  void load(face)
})
// 清理：Fiber 的 dispose() 是 async（本仓 cordis 无可调用的 disposer 返回值）
return () => { void (fiber as { dispose?: () => Promise<void> }).dispose?.() }
```

**先例（照抄这两个就对了）**
- 本仓：`dsh-coding-sidebar/src/client/intercept.tsx`（`sidebarRight` / `workspaces`）、`src/client/index.tsx` 顶部注释（为什么 `remote.session` 在 inject 里）
- 引擎：`deepseek-harness/packages/experimental/client-ui-voice-input/src/client/mount.ts:62`（`ctx.inject(['remote.speech', …], registerUi)`）

**判据**
```bash
# ① 可选面不得出现在 inject 清单里（inject 是 all-required：写进去＝没有它就不挂载）
grep -n "export const inject" -A 3 src/client/index.tsx
# ② 列出所有「直接读点分路径」的位置，逐个与 inject 清单对照：
#    在清单里 = 合法；不在（可选面）= 必须改写成 ctx.get / ctx.inject
grep -rn "ctx\.remote\." src/
# ③ 产物级：改写后该面只应出现在 inject 的依赖表里
grep -c "remote\.schedule" lib/client.js
```

---

## 2. 插件改动**必须 bump 版本**（否则「改了没生效」，且所有静态检查全绿）

> **已自动化**：KCoder 仓 `node scripts/check-bundle-version-line.mjs`，挂在 `release.sh prepush` 与 CI。
> 它比对「上一个发布 tag」与当前工作树，**运行时而**有变更却版本未动即失败，并把变更文件列出来。

**症状**：代码改了、`typecheck` / 单测 / `check:artifacts` 全绿、bundle 里也确实有新代码——**实机就是不生效**（表现为「还是旧行为」）。

**根因**：KCoder 的随包物化是**版本驱动**的。`desktop/main/kcoder-skills-bundle.ts` 的 `materialize()`：

```ts
const staleTarget = !intact
  || valid(dstVersion) === null
  || (valid(srcVersion) !== null && gt(srcVersion, dstVersion))   // ← 严格大于
```

版本相同 ⇒ **跳过拷贝** ⇒ profile 里那份实体还是旧构建。**代码在 `bundle/` 里，不在 profile 里。**

**正确做法（发布链，单向前进）**
```bash
cd ~/kk_Projects/dsh-coding-sidebar
npm version patch --no-git-tag-version        # bump（未发布时可复用同一号，见下）
pnpm build && pnpm check:artifacts            # lib 重建 + 产物可复现
pnpm sync:mirror                              # → dsh-plugins 镜像
cd ~/kk_Projects/KCoder && node scripts/sync-bundles.mjs   # → bundle/
# 重启 app：ensureKcoderBundles 会在启动时物化
```

**版本号未发布时的惯例**：整批修复可以**共用一个待发版本号**（如 `1.0.33`），不必每修一处就占一个号；但**本机必须强制重拷**（版本没变 ⇒ `gt()` 不触发），走 `!intact` 分支：

```bash
rm -rf ~/.kcoder-dev/profiles/web/node_modules/<pkg>   # 物化器判 stale 时自己也是 rm+cp
```

**判据（产物级，唯一可信）**
```bash
# ① 新符号真的进了【profile 实体】——不是只进了 bundle
grep -c '<新符号>' ~/.kcoder-dev/profiles/web/node_modules/<pkg>/lib/client.js   # 期望 > 0
# ② 启动日志出现物化行
#    [kcoder-bundle] 物化 <pkg> <version>: <path>
```
**四份拷贝逐一验存**：源仓 `lib/` → `dsh-plugins` 镜像 → KCoder `bundle/` → profile 实体。

---

## 3. `openTab` 的内容型判据：要「点了能看见」就必须带 `meta`

> **已自动化**：插件仓 `pnpm check:contract` 枚举每个 `openTab` 调用点——内容型打 ✓、
> 有就地标注的 type-only 打 ○、既非内容型又无标注即失败（逼作者对每个调用点做一次显式决定）。

**症状**：程序化打开一个 tab 后**界面毫无变化**（用户报「点了没反应」）——tab 确实开了，但开在**收起的面板**里。

**根因**：`dsh-coding-sidebar/src/client/service.ts` 的 `openTab` 只把**内容型** open 判为需要落在可见处：

```ts
if (!targetsInactiveSession && typeof window !== 'undefined'
    && (seed.path !== undefined || seed.url !== undefined || seed.meta !== undefined)) {
  if (!landed.panelOpen) return togglePanel(landed)
}
```

只给 `type`（可选 `id`/`title`）的 open 是 **type-only**：+ 菜单、agent 终端自动开 tab 属于这一类，**故意不展开**（面板行为由调用方负责）。`activateTab` **也不展开**，`togglePanel` **不是公开 API** ⇒ 调用方无别的补法。

**正确做法**：要让用户看见，就把「要显示什么」以 `meta` 交给 tab（内容型 ⇒ 自动展开）；纯 type 的 open 是**静默落位**，只在「本来就在面板内」的场合用（如 + 菜单）。

**判据**
```bash
# 每个 openTab 调用点都要回答一句：用户应该看见它吗？要 ⇒ 带 meta
grep -rn "openTab({" src/ -A 4
```

---

## 4. 预置声明（`preset-plugins.ts` 的 spec）只指向**已发布**版本，且平移在 publish **之后**

> **半自动化**：`check-bundle-version-line.mjs` 的规则①会断言「声明下界 == bundle 实体版本」，
> 不同线即失败；「该版本是否已在 npm 可见」仍需人工核（指定版本端点双源 200）。

**症状**：新装用户 `pnpm install` 解析失败；或声明落后于 bundle 物化 ⇒ 新装用户先拿到 registry 旧版（再由物化覆盖）。

**根因**：spec 参与**依赖树解析**（不是「仅记录」），未发布版本会让 install 失败；而 bundle 侧走物化，两者不同步时窗口期内会出现「声明旧版 + 实体新版」。

**正确做法（顺序不可换）**
1. 测试通过 → **publish**（`npm publish`，双源核验）
2. **再**平移 spec（`^1.0.32` → `^1.0.33`）
3. `node scripts/sync-bundles.mjs --check` 零差异

**判据**
```bash
# 用【指定版本端点】核验，不要信 packument 的 CDN 缓存
curl -s https://registry.npmjs.org/<pkg>/<version> | head -c 200
```
**未 publish 之前只改 bundle、不动 spec** —— 此时声明保持旧号是安全的（新版实体由物化覆盖，用户不会拿到半成品）。

---

## 附：一轮改动的标准动作（照抄）

```bash
# 1) 改代码（可选面走 ctx.get / ctx.inject；openTab 要带 meta 就带）
cd ~/kk_Projects/dsh-coding-sidebar
pnpm typecheck && pnpm test && pnpm build && pnpm check:artifacts

# 2) 版本与分发（见 §2）
npm version patch --no-git-tag-version
pnpm build && pnpm sync:mirror
cd ~/kk_Projects/KCoder && node scripts/sync-bundles.mjs
rm -rf ~/.kcoder-dev/profiles/web/node_modules/<pkg>      # 版本号未变时

# 3) 产物级验存（四份拷贝，见 §2 判据）
grep -c '<新符号>' <源仓>/lib/client.js <镜像>/lib/client.js <bundle>/lib/client.js \
                   ~/.kcoder-dev/profiles/web/node_modules/<pkg>/lib/client.js

# 4) 重启 app，确认启动日志的物化行 + 实机行为
```

---

## 出处（这三条不是推演出来的）

| # | 现场 | 表象 | 真因 |
|---|---|---|---|
| 1 | 2026-09-25 定时任务预览 | `cannot get property "remote.schedule" without inject` | 直接读 `ctx.remote.<可选面>`（提交 `2221aa0`） |
| 2 | 2026-09-25 同一功能 | bundle 有新代码，实机无预览 | 版本未 bump ⇒ 物化跳过（提交 `d80eb11`） |
| 3 | 2026-09-25 同一功能 | 点「打开」看不到任何变化 | 纯 type 的 open 被判 type-only ⇒ 落在收起的面板里（提交 `8f09811`） |

**共同点**：三次都不是逻辑写错，而是**跨层契约的默认语义**没先核对（注入校验 / 物化判据 / open 分类）。
**推论**：动插件之前先问「这条链上还有哪些默认语义我没核？」，并把答案写进提交信息——比事后补测便宜得多。
