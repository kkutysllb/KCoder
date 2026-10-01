#!/usr/bin/env bash
#
# 远端 arm64 原生包应急补齐（临时手段，不改 KCoder 代码）。
#
# ## 为什么存在
#
# 2026-10-01 现场：`desktop/main/remote-runtime.ts` 的 `localAddonSpecs()` 把要补到远端的
# 原生包**硬编码成 linux-x64 命名族**（谓词 `/-linux-x64(-gnu)?$/`）。目标机 aarch64 时
# 7 条规格全部被 npm 以 `EBADPLATFORM` 整单拒绝，而安装脚本既不 `set -e` 也不查退出码、
# 末尾无条件 `echo ADDONS_OK`，于是**失败被吞掉**并写下 `.engine-fingerprint`：
#
#     npm error notsup Unsupported platform for @deepseek-ai/node-addon-system-linux-x64@0.1.2
#       wanted {"os":"linux","cpu":"x64"} (current: {"os":"linux","cpu":"arm64"})
#
# 此后每次连接都命中「引擎已就位 → 跳过」分支（指纹一致），坏状态**永久粘滞**：
# 远端 `dsh` 起不来（`No usable native binding found for
# node-addon-require-builtin-linux-arm64-gnu`），端口不监听，桌面端等 180s 后报
# 「远端服务等待就绪超时」（日志字节 8226 / 入口存在 是 / 监听 0）。
#
# 本脚本是在**代码修复落地之前**把这台机器救活的手段；架构自适应见
# `plans/remote-arch-adaptation.md`。
#
# ## 它做什么
#
#   1 从 `~/.kcoder-remote/addon-specs.txt`（App 自己写的 x64 清单）派生 arm64 规格
#   2 远端 npm 装这些包（查退出码，不再靠哨兵字符串）
#   3 逐个 `rm -rf` 后拷进 `~/.kcoder-remote/runtime/node_modules/`
#   4 **结果校验**：真 require 一次 + 校验 ELF 架构 + 校验 prebuilds.json 的 platform
#
# ## 它刻意不做什么
#
#   * **不删 `.engine-fingerprint`**。删了会让 App 重跑引擎步骤：重新 tar 覆盖
#     `node_modules`（tar 不删多余文件，包能活）**并重跑那段必然失败的 x64 安装**，
#     徒增一轮噪声。保留指纹 = 走「跳过」分支，与本脚本的目标一致。
#   * **不杀远端服务**。那是 App 的生命周期；运行中替换文件在 Linux 上安全
#     （已打开的文件由 inode 兜底），但建议完成后重连一次。
#
# ## 适用范围（**只适用于 arm64 + glibc**）
#
#   目标机必须是 Linux aarch64 且 glibc（Ubuntu/Debian/RHEL…）。musl（Alpine）**明确拒绝**：
#   `node-addon-require-builtin` 的 musl 变体名是 `…-linux-arm64-musl`，而非 `…-gnu`，
#   且本地 runtime 树的 optionalDependencies **根本没声明任何 musl 变体**——没有可信的判据，
#   不做猜测。x64 机器不要跑本脚本（App 现有逻辑对 x64 是正确的）。
#
# ## 用法
#
#   # 本机（KCoder 仓库）→ 远端：
#   ssh_push 本文件到远端，或在远端编辑器里粘贴；然后：
#   bash fix-remote-arm64-addons.sh            # 真跑
#   bash fix-remote-arm64-addons.sh --dry-run  # 只派生并打印规格，不动任何东西
#
# 退出码：0 = 全部就位且校验通过；1 = 失败（原因在 stdout，细节在同目录 arm64-fix.log）。

set -u

R="${KCODER_REMOTE_ROOT:-$HOME/.kcoder-remote}"
LOG="$R/arm64-fix.log"
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1
[ "${1:-}" = "--help" ] && { sed -n '2,60p' "$0"; exit 0; }

say() { printf '%s\n' "$*"; }

# 2026-10-01 实机验证过的清单（addon-specs.txt 缺失时的兜底）。
FALLBACK_SPECS=(
  "@deepseek-ai/node-addon-system-linux-arm64@0.1.2"
  "@img/sharp-libvips-linux-arm64@1.3.2"
  "@img/sharp-linux-arm64@0.35.3"
  "@koromix/koffi-linux-arm64@3.1.1"
  "@vscode/ripgrep-linux-arm64@1.18.0"
  "node-addon-require-builtin-linux-arm64-gnu@0.1.6"
  "sherpa-onnx-linux-arm64@1.13.8"
)

# 必须到位的包：缺任一即判失败（它们正是本次事故里缺失的那两个绑定）。
REQUIRED=(
  "node-addon-require-builtin-linux-arm64-gnu"
  "@deepseek-ai/node-addon-system-linux-arm64"
)

# ---------------------------------------------------------------- 前置自检

[ "$(uname -s)" = "Linux" ] || { say "!! 只支持 Linux 远端（实测 $(uname -s)）"; exit 1; }
case "$(uname -m)" in
  aarch64|arm64) ;;
  *) say "!! 本脚本只适用于 arm64 远端（实测 $(uname -m)）——x64 机器请勿运行"; exit 1 ;;
esac
if ls /lib/ld-musl-* >/dev/null 2>&1; then
  say "!! 目标是 musl（Alpine）远端，本脚本不支持："
  say "   node-addon-require-builtin 的 musl 变体名与 glibc 不同，且本地 runtime 树未声明任何 musl 变体，"
  say "   没有可信判据。请先在 plans/remote-arch-adaptation.md 的 musl 议题下补齐事实。"
  exit 1
fi

NODE_BIN="${KCODER_REMOTE_NODE:-$HOME/.dsh-remote/node/bin}"
if [ -x "$NODE_BIN/node" ]; then
  export PATH="$NODE_BIN:$PATH"
else
  say "!! 未找到远端 Node（$NODE_BIN/node）。它由 SSH 引导流程安装，路径记在 worlds.json 的 node 字段。"
  exit 1
fi
[ -f "$R/runtime/lib/bin.js" ] || { say "!! 远端 runtime 不存在（$R/runtime/lib/bin.js）——先让 App 连一次以完成引擎投放"; exit 1; }

# ---------------------------------------------------------------- 派生规格

UNMAPPED=()
derive_specs() {
  local src="$R/addon-specs.txt" line
  if [ ! -f "$src" ]; then
    printf '%s\n' "${FALLBACK_SPECS[@]}"
    return
  fi
  # App 写的是 x64 清单：把命名族整体换成 arm64（`-linux-x64-gnu` → `-linux-arm64-gnu` 同时成立）。
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    case "$line" in
      *-linux-x64*) printf '%s\n' "${line/-linux-x64/-linux-arm64}" ;;
      # 带架构标记但不是 linux-x64：本脚本不知道它的 arm64 对应名。**不猜**，交给上层报错。
      *-darwin-*|*-win32-*|*-linux-*|*linuxmusl*|*-musl*) UNMAPPED+=("$line") ;;
      *) printf '%s\n' "$line" ;;   # 无架构标记 = 平台无关，原样保留
    esac
  done < "$src"
}

SPECS=()
while IFS= read -r line; do
  [ -n "$line" ] && SPECS+=("$line")
done < <(derive_specs)

if [ "${#UNMAPPED[@]}" -gt 0 ]; then
  say "!! addon-specs.txt 里有本脚本无法映射到 arm64 的条目："
  printf '     %s\n' "${UNMAPPED[@]}"
  say "   （命名族变了。要么补映射规则，要么走 plans/remote-arch-adaptation.md 的代码修复。）"
  exit 1
fi

if [ "${#SPECS[@]}" -eq 0 ]; then
  say "!! 派生出的 arm64 规格为空 —— addon-specs.txt 里没有任何 -linux-x64 条目？"
  say "   该文件内容："; sed -n '1,20p' "$R/addon-specs.txt" 2>/dev/null || say "   （不存在）"
  exit 1
fi

say "远端 root      : $R"
say "Node           : $(node -v)（$(command -v node)）"
say "目标           : linux/arm64/glibc"
say "派生规格（$((${#SPECS[@]})) 条，来源 $([ -f "$R/addon-specs.txt" ] && echo addon-specs.txt || echo 内置兜底)）："
printf '  %s\n' "${SPECS[@]}"

if [ "$DRY_RUN" = "1" ]; then
  say ""
  say "--dry-run：不做任何改动。"
  for pkg in "${REQUIRED[@]}"; do
    if printf '%s\n' "${SPECS[@]}" | grep -q "^${pkg}@"; then say "  必需包已在清单：$pkg"; else say "  必需包缺失！$pkg"; exit 1; fi
  done
  exit 0
fi

# ---------------------------------------------------------------- 安装

exec > >(tee "$LOG") 2>&1
say ""
say "== 安装（细节见 $LOG）"

rm -rf "$R/addons-arm64"
mkdir -p "$R/addons-arm64"
cd "$R/addons-arm64" || exit 1
printf '{"name":"kcoder-addons-arm64","private":true,"version":"1.0.0"}\n' > package.json

if ! npm i --no-audit --no-fund --ignore-scripts=false --loglevel=error "${SPECS[@]}"; then
  say "!! npm install 失败（退出码非 0）——不再像旧安装脚本那样写哨兵了事。"
  exit 1
fi
[ -d node_modules ] || { say "!! npm 报成功但没有 node_modules"; exit 1; }

# 回收：只搬清单里点名的包（不搬它们的传递依赖，避免覆盖 runtime 里既有版本）。
for spec in "${SPECS[@]}"; do
  name="${spec%@*}"
  src="$R/addons-arm64/node_modules/$name"
  dest="$R/runtime/node_modules/$name"
  if [ ! -d "$src" ]; then say "!! npm 未装出 $name（可选依赖被平台跳过？）"; exit 1; fi
  rm -rf "$dest"
  mkdir -p "$(dirname "$dest")"
  cp -R "$src" "$dest"
  say "   就位 $name"
done

# ---------------------------------------------------------------- 结果校验
# 判据是「事实」而不是「字符串」：真加载一次绑定 + 校验二进制架构。

say ""
say "== 结果校验"

FAIL=0
for pkg in "${REQUIRED[@]}"; do
  [ -d "$R/runtime/node_modules/$pkg" ] || { say "!! 必需包不在位：$pkg"; FAIL=1; }
done

cd "$R/runtime" || exit 1
if node -e "require('./node_modules/node-addon-require-builtin/lib/index.js')" 2>&1; then
  say "   require-builtin 加载通过"
else
  say "!! require-builtin 加载失败（本次事故的直接症状）"; FAIL=1
fi

# ELF e_machine（偏移 18-19，小端）= 0xB7 即 AArch64。
elf_is_aarch64() { [ "$(od -An -tx1 -j18 -N2 "$1" 2>/dev/null | tr -d ' \n')" = "b700" ]; }
SYS_PKG="$R/runtime/node_modules/@deepseek-ai/node-addon-system-linux-arm64"
for libc in glibc musl; do
  bin="$SYS_PKG/bin/$libc/system.node"
  if [ ! -f "$bin" ]; then say "!! 缺 $bin"; FAIL=1
  elif elf_is_aarch64 "$bin"; then say "   $libc/system.node 是 aarch64 ELF"
  else say "!! $libc/system.node 不是 aarch64 ELF（架构不符）"; FAIL=1; fi
done

# 每个包的 prebuilds.json 自带 platform 字段，与目标不符就是装错了。
for pkg in "${SPECS[@]}"; do
  name="${pkg%@*}"
  pj="$R/runtime/node_modules/$name/prebuilds.json"
  [ -f "$pj" ] || continue
  plat=$(sed -n 's/.*"platform"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$pj" | head -1)
  case "$plat" in
    *linux-arm64*) say "   $name platform=$plat" ;;
    *) say "!! $name platform=$plat（期望 linux-arm64*）"; FAIL=1 ;;
  esac
done

say ""
if [ "$FAIL" = "0" ]; then
  say "== 补齐完成且校验通过。"
  say "   下一步：在 KCoder 里重连该主机 —— 端口已在监听时走「复用」分支，秒开。"
  say "   **不要**删除 runtime/.engine-fingerprint：保留它才会走「引擎已就位→跳过」，"
  say "   否则 App 会重跑那段必然失败的 x64 安装。"
  say "   本脚本是临时手段；代码修复见 plans/remote-arch-adaptation.md。"
  exit 0
else
  say "!! 校验未通过，见上面的 !! 行；完整输出在 $LOG"
  exit 1
fi
