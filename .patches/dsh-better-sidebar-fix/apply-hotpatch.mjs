#!/usr/bin/env node
/**
 * dsh-better-sidebar 热补丁施加器（产品侧维护，见 profile-patches.ts）。
 *
 * 对 lib/client.js 与 lib/client-registry.js（两文件除头部约 47 字节模块
 * 名外逐字节相同）做同样的六处替换，产出修复版快照，再由 git diff 生成
 * profiles/web/patches/dsh-better-sidebar@<version>.patch。
 *
 * 六处改动 = 两个功能热补丁：
 *  1. 文件预览面板（EditorHost）对 git 修改文件显示「Diff +N −M」pill，
 *     点击打开该文件的 diff tab（复用插件既有 openDiffTab 链）；
 *  2. git 面板（GitView）header 显示项目当前整体 +N −M 行数统计
 *     （staged + unstaged 两份全仓 diff 各自解析后求和；untracked 不计行）。
 *
 * 每处锚点先断言「恰好出现一次」，任何失配立即失败退出——绝不盲改。
 * 插件升级后重跑本脚本重新生成修复版；锚点漂移则按 diff 手工适配。
 * （重跑前先从原版快照 .patches/dsh-better-sidebar/ 重置本目录 lib/*.js）
 *
 * v2：pill 点击改为在预览面板内切换内联 diff 视图（复用插件 DiffView），
 * 不再经 props.onOpenDiff——editor tab descriptor 是解构白名单
 * （不透传 onOpenDiff），v1 的跳转链路注定静默无效。
 */
import { readFileSync, writeFileSync } from 'node:fs'

const T = (n) => '\t'.repeat(n)

// ---------- 锚点（原版 0.14.0 产物逐字节，缩进以字节 dump 为准） ----------
const A1 = T(2) + '/** Strip the `a/` / `b/` prefix git puts on diff paths (not on /dev/null). */'

const A2 = T(3) + 'const [logLoadingMore, setLogLoadingMore] = (0, react.useState)(false);'

const A3 = [
  T(5) + 'const [statusResult, branchResult, logResult] = await Promise.all([',
  T(6) + 'api.gitStatus(scope),',
  T(6) + 'api.gitBranch(scope).catch(() => ({',
  T(7) + 'current: "",',
  T(7) + 'names: []',
  T(6) + '})),',
  T(6) + 'api.gitLog(scope, LOG_BATCH, 0).catch(() => [])',
  T(5) + ']);',
  T(5) + 'setStatus(statusResult);',
].join('\n')

const A4 = [
  T(7) + '}, name))]',
  T(6) + '}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {',
  T(7) + 'type: "button",',
  T(7) + 'className: sidebar_module_css_default.iconButton,',
  T(7) + '"aria-label": t("refresh"),',
].join('\n')

const A5 = [
  T(3) + 'const [toolbar, setToolbar] = (0, react.useState)(null);',
  T(3) + 'const controlsRef = (0, react.useRef)(null);',
].join('\n')

const A6 = [
  T(5) + '/* @__PURE__ */ (0, react_jsx_runtime.jsx)(EditorPathInput, {',
  T(7) + 'path,',
  T(7) + 'cwd: scope.cwd,',
  T(7) + 'onOpen: openFile',
  T(6) + '}, path),',
  T(6) + 'toolbar?.modes === true && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {',
].join('\n')

// ready viewer createElement 的收尾（editorMain children 末项）
const A7 = [
  T(8) + 'toolbar: "host",',
  T(8) + 'onToolbarState,',
  T(8) + 'onToolbarControls',
  T(7) + '})',
  T(6) + ']',
].join('\n')

// css$3 内 editorMain 规则（overlay 的 position 锚）
const A8 = '.nArs4W_editorMain{flex-direction:column;flex:1;min-width:0;min-height:0;display:flex}'

// ---------- 替换内容（缩进对齐 bundle 层级：模块级 2 tabs / 组件体 3 tabs） ----------
const R1 = [
  '/** kcoderc: count added/deleted lines across unified diff text(s). */',
  'function kcodercCountDiff(...texts) {',
  T(1) + 'let add = 0;',
  T(1) + 'let del = 0;',
  T(1) + 'for (const text of texts) for (const file of parseUnifiedDiff(text).files) {',
  T(2) + 'if (file.binary) continue;',
  T(2) + 'for (const hunk of file.hunks) for (const line of hunk.lines) {',
  T(3) + 'if (line.kind === "add") add += 1;',
  T(3) + 'else if (line.kind === "del") del += 1;',
  T(2) + '}',
  T(1) + '}',
  T(1) + 'return { add, del };',
  '}',
  '/** kcoderc: line count of a text file body (untracked-file additions). */',
  'function kcodercCountLines(text) {',
  T(1) + 'const body = text.endsWith("\\n") ? text.slice(0, -1) : text;',
  T(1) + 'return body === "" ? 0 : body.split("\\n").length;',
  '}',
  '',
].map((r) => (r === '' ? r : T(2) + r)).join('\n') + '\n' + A1

const R2 = A2 + '\n' + [
  '/** kcoderc: whole-repo +N/−M totals from the staged + unstaged diffs. */',
  'const [kcodercStatTotal, setKcodercStatTotal] = (0, react.useState)(null);',
].map((r) => T(3) + r).join('\n')

const R3 = [
  T(5) + 'const [statusResult, branchResult, logResult, kcodercUnstaged, kcodercStaged] = await Promise.all([',
  T(6) + 'api.gitStatus(scope),',
  T(6) + 'api.gitBranch(scope).catch(() => ({',
  T(7) + 'current: "",',
  T(7) + 'names: []',
  T(6) + '})),',
  T(6) + 'api.gitLog(scope, LOG_BATCH, 0).catch(() => []),',
  T(6) + 'api.gitDiff(scope).catch(() => ({ diff: "" })),',
  T(6) + 'api.gitDiff(scope, void 0, true).catch(() => ({ diff: "" }))',
  T(5) + ']);',
  T(5) + 'setStatus(statusResult);',
  T(5) + 'setKcodercStatTotal(kcodercCountDiff(kcodercUnstaged.diff, kcodercStaged.diff));',
].join('\n')

const R4 = [
  T(7) + '}, name))]',
  T(6) + '}), kcodercStatTotal !== null && kcodercStatTotal.add + kcodercStatTotal.del > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {',
  T(7) + 'style: {',
  T(8) + 'display: "inline-flex",',
  T(8) + 'alignItems: "center",',
  T(8) + 'gap: "6px",',
  T(8) + 'flex: "none",',
  T(8) + 'font: "var(--dsw-font-xxxs-11)"',
  T(7) + '},',
  T(7) + 'children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {',
  T(8) + 'style: { color: "var(--dsw-alias-state-success-primary)" },',
  T(8) + 'children: ["+", kcodercStatTotal.add]',
  T(7) + '}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {',
  T(8) + 'style: { color: "var(--dsw-alias-state-error-primary)" },',
  T(8) + 'children: ["−", kcodercStatTotal.del]',
  T(7) + '})]',
  T(6) + '}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {',
  T(7) + 'type: "button",',
  T(7) + 'className: sidebar_module_css_default.iconButton,',
  T(7) + '"aria-label": t("refresh"),',
].join('\n')

const R5 = [
  '/** kcoderc: git change hint for the open file (inline diff overlay). */',
  'const [kcodercGitHint, setKcodercGitHint] = (0, react.useState)(null);',
  'const [kcodercDiffOpen, setKcodercDiffOpen] = (0, react.useState)(false);',
  '(0, react.useEffect)(() => {',
  T(1) + 'let cancelled = false;',
  T(1) + 'setKcodercGitHint(null);',
  T(1) + 'setKcodercDiffOpen(false);',
  T(1) + 'if (path === "") return;',
  T(1) + 'const kcodercRelOf = (absolute) => {',
  T(2) + 'const base = (scope.cwd ?? "").replace(/[\\\\/]+$/, "");',
  T(2) + 'return base !== "" && absolute.startsWith(base + "/") ? absolute.slice(base.length + 1) : absolute;',
  T(1) + '};',
  T(1) + 'const kcodercRel = kcodercRelOf(path);',
  T(1) + '(async () => {',
  T(2) + 'try {',
  T(3) + 'const kcodercStatus = await api.gitStatus(scope);',
  T(3) + 'if (cancelled || kcodercStatus.isRepo !== true) return;',
  T(3) + 'const kcodercEntry = (kcodercStatus.entries ?? []).find((candidate) => candidate.path === kcodercRel);',
  T(3) + 'if (kcodercEntry === void 0) return;',
  T(3) + 'if (kcodercEntry.xy === "??") {',
  T(4) + 'const kcodercText = await api.fsRead(scope, kcodercEntry.path);',
  T(4) + 'if (cancelled || kcodercText.kind !== "text") return;',
  T(4) + 'setKcodercGitHint({ add: kcodercCountLines(kcodercText.content), del: 0, diffText: "", untracked: true, untrackedContent: kcodercText.content, path: kcodercEntry.path });',
  T(4) + 'return;',
  T(3) + '}',
  T(3) + 'const kcodercUnstaged = kcodercEntry.xy[1] !== void 0 && kcodercEntry.xy[1] !== " " && kcodercEntry.xy[1] !== "?";',
  T(3) + 'let kcodercUseStaged = !kcodercUnstaged;',
  T(3) + 'let kcodercResult = await api.gitDiff(scope, kcodercEntry.path, kcodercUseStaged);',
  T(3) + 'if (cancelled) return;',
  T(3) + 'if (kcodercResult.diff === "") {',
  T(4) + 'const kcodercOther = await api.gitDiff(scope, kcodercEntry.path, !kcodercUseStaged);',
  T(4) + 'if (cancelled) return;',
  T(4) + 'if (kcodercOther.diff !== "") { kcodercResult = kcodercOther; kcodercUseStaged = !kcodercUseStaged; }',
  T(3) + '}',
  T(3) + 'if (cancelled) return;',
  T(3) + 'const kcodercCounts = kcodercCountDiff(kcodercResult.diff);',
  T(3) + 'if (kcodercCounts.add + kcodercCounts.del === 0) return;',
  T(3) + 'setKcodercGitHint({ add: kcodercCounts.add, del: kcodercCounts.del, diffText: kcodercResult.diff, untracked: false, untrackedContent: void 0, path: kcodercEntry.path });',
  T(2) + '} catch {}',
  T(1) + '})();',
  T(1) + 'return () => {',
  T(2) + 'cancelled = true;',
  T(1) + '};',
  '}, [path, scope.sessionId, scope.cwd]);',
  '',
].map((r) => (r === '' ? r : T(3) + r)).join('\n') + '\n' + A5

const R6 = [
  T(5) + '/* @__PURE__ */ (0, react_jsx_runtime.jsx)(EditorPathInput, {',
  T(7) + 'path,',
  T(7) + 'cwd: scope.cwd,',
  T(7) + 'onOpen: openFile',
  T(6) + '}, path), kcodercGitHint !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {',
  T(7) + 'type: "button",',
  T(7) + 'style: {',
  T(8) + 'flex: "none",',
  T(8) + 'display: "inline-flex",',
  T(8) + 'alignItems: "center",',
  T(8) + 'gap: "4px",',
  T(8) + 'font: "var(--dsw-font-xxxs-11)",',
  T(8) + 'color: "var(--dsw-alias-label-secondary)",',
  T(8) + 'background: kcodercDiffOpen ? "var(--dsw-alias-interactive-bg-active)" : "transparent",',
  T(8) + 'border: "1px solid var(--dsw-alias-border-l2)",',
  T(8) + 'borderRadius: "999px",',
  T(8) + 'padding: "1px 8px",',
  T(8) + 'cursor: "pointer"',
  T(7) + '},',
  T(7) + 'title: kcodercGitHint.path,',
  T(7) + 'onClick: () => {',
  T(8) + 'setKcodercDiffOpen((value) => !value);',
  T(7) + '},',
  T(7) + 'children: ["Diff", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {',
  T(8) + 'style: { color: "var(--dsw-alias-state-success-primary)" },',
  T(8) + 'children: ["+", kcodercGitHint.add]',
  T(7) + '}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {',
  T(8) + 'style: { color: "var(--dsw-alias-state-error-primary)" },',
  T(8) + 'children: ["−", kcodercGitHint.del]',
  T(7) + '})]',
  T(6) + '}), toolbar?.modes === true && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {',
].join('\n')

const R7 = [
  T(8) + 'toolbar: "host",',
  T(8) + 'onToolbarState,',
  T(8) + 'onToolbarControls',
  T(7) + '}),',
  T(6) + '!showEmpty && kcodercDiffOpen && kcodercGitHint !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {',
  T(7) + 'style: {',
  T(8) + 'position: "absolute",',
  T(8) + 'inset: "0",',
  T(8) + 'zIndex: 5,',
  T(8) + 'background: "var(--dsw-alias-bg-layer-1)",',
  T(8) + 'display: "flex",',
  T(8) + 'flexDirection: "column"',
  T(7) + '},',
  T(7) + 'children: [',
  T(8) + '/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {',
  T(9) + 'style: {',
  T(10) + 'flex: "none",',
  T(10) + 'display: "flex",',
  T(10) + 'alignItems: "center",',
  T(10) + 'gap: "8px",',
  T(10) + 'padding: "4px 8px",',
  T(10) + 'borderBottom: "1px solid var(--dsw-alias-border-l1)"',
  T(9) + '},',
  T(9) + 'children: [',
  T(10) + '/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {',
  T(11) + 'style: { font: "var(--dsw-font-xxxs-strong-11)", color: "var(--dsw-alias-label-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: "1", minWidth: "0" },',
  T(11) + 'children: kcodercGitHint.path',
  T(10) + '}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {',
  T(11) + 'type: "button",',
  T(11) + 'style: { flex: "none", font: "var(--dsw-font-xxxs-11)", color: "var(--dsw-alias-brand-primary)", background: "transparent", border: "none", cursor: "pointer", padding: "2px 6px" },',
  T(11) + 'onClick: () => {',
  T(12) + 'setKcodercDiffOpen(false);',
  T(11) + '},',
  T(11) + 'children: t("diffCollapse")',
  T(10) + '})]',
  T(9) + '}),',
  T(8) + '/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {',
  T(9) + 'style: { flex: "1", minHeight: "0", overflow: "auto" },',
  T(9) + 'children: kcodercGitHint.untracked === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DiffView, {',
  T(10) + 'diff: "",',
  T(10) + 'untrackedPath: kcodercGitHint.path,',
  T(10) + 'untrackedContent: kcodercGitHint.untrackedContent ?? ""',
  T(9) + '}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DiffView, { diff: kcodercGitHint.diffText })',
  T(8) + '})',
  T(7) + ']',
  T(6) + '}),',
  T(6) + ']',
].join('\n')

const R8 = '.nArs4W_editorMain{flex-direction:column;flex:1;min-width:0;min-height:0;display:flex;position:relative}'

// ---------- 施加（锚点唯一性断言，任何失配不写盘） ----------
const RULES = [
  { name: 'helper-kcodercCountDiff', anchor: A1, next: R1 },
  { name: 'GitView-statTotal-state', anchor: A2, next: R2 },
  { name: 'GitView-refresh-diffs', anchor: A3, next: R3 },
  { name: 'GitView-header-totals', anchor: A4, next: R4 },
  { name: 'EditorHost-git-hint', anchor: A5, next: R5 },
  { name: 'EditorHost-diff-pill', anchor: A6, next: R6 },
  { name: 'EditorHost-diff-overlay', anchor: A7, next: R7 },
  { name: 'css-editorMain-position', anchor: A8, next: R8 },
]

let failed = false
for (const file of process.argv.slice(2)) {
  let text = readFileSync(file, 'utf8')
  if (text.includes('kcodercCountDiff')) {
    console.log(`=== ${file}: 已施加过（kcoderc 标记在位），跳过`)
    continue
  }
  console.log(`=== ${file} ===`)
  let fileOk = true
  for (const rule of RULES) {
    const hits = text.split(rule.anchor).length - 1
    if (hits !== 1) {
      console.error(`  [FAIL] ${rule.name}: 锚点命中 ${hits} 处（须为 1）`)
      failed = true
      fileOk = false
      continue
    }
    text = text.replace(rule.anchor, rule.next)
    console.log(`  [ok] ${rule.name}`)
  }
  if (fileOk) writeFileSync(file, text)
}
if (failed) {
  console.error('\n存在失配，失败文件未写盘（成功文件已写）。')
  process.exit(1)
}
console.log('\n全部施加完成。')
