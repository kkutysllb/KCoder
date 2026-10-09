#!/usr/bin/env bash
# KCoder 首次引导：克隆上游 fork（若缺）→ 切集成分支 → 安装依赖（复用既有
# store）→ 构建。
#
# 上游锚定 = 自有 fork（kkutysllb/deepseek-harness），消费工作树在仓外单一路径，
# 上游修复以提交落集成分支 ${UPSTREAM_BRANCH}（= 基线 + 修复分支的 merge），
# 不再用 upstream/*.patch 归档应用。桌面端零修改复用其 Web UI、API 网关与插件生态。
#
# 用法：bash scripts/setup.sh [--skip-clone]

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# 上游路径解析（与 desktop/main/dsh-contract.ts 同链）：环境变量 > 仓内指针 > 历史默认。
# 指针由本脚本成功后落盘 ⇒ 同一台机器上 pnpm dev/preview 免设 KCODER_UPSTREAM_DIR。
UPSTREAM_POINTER="$ROOT/.upstream-dir"
DEFAULT_UPSTREAM="/Users/libing/kk_Projects/deepseek-harness"
if [[ -n "${KCODER_UPSTREAM_DIR:-}" ]]; then
  UPSTREAM="$KCODER_UPSTREAM_DIR"
elif [[ -f "$UPSTREAM_POINTER" ]]; then
  UPSTREAM="$(tr -d '[:space:]' < "$UPSTREAM_POINTER")"
else
  UPSTREAM="$DEFAULT_UPSTREAM"
fi
UPSTREAM_REPO="${KCODER_UPSTREAM_REPO:-git@github.com:kkutysllb/deepseek-harness.git}"
# 集成分支名在下方（等 die 定义之后再读，报错口径统一）
UPSTREAM_BRANCH=""

say() { printf '\033[1;34m[setup]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[setup] 错误：\033[0m %s\n' "$*" >&2; exit 1; }
warn() { printf '\033[1;33m[setup] 警告：\033[0m %s\n' "$*" >&2; }

# 集成分支名的唯一来源：仓内 upstream/BRANCH（release.sh / dsh-contract.ts 同读一份）。
# 此前三处各写一遍字面量，改基线时漏改一处就会「克隆到 A、断言 B」。
[[ -f "$ROOT/upstream/BRANCH" ]] || die "缺少 upstream/BRANCH（集成分支名的唯一来源）"
UPSTREAM_BRANCH="$(tr -d '[:space:]' < "$ROOT/upstream/BRANCH")"
[[ -n "$UPSTREAM_BRANCH" ]] || die "upstream/BRANCH 为空"

command -v git >/dev/null 2>&1 || die "需要 git"
command -v node >/dev/null 2>&1 || die "需要 Node.js（上游要求 ^22.19.0 || >=24.0.0）"
command -v pnpm >/dev/null 2>&1 || die "需要 pnpm 11（可运行：corepack enable && corepack prepare pnpm@11 --activate，或 npm install -g pnpm@11）"
# 主版本软校验：与上游 packageManager 及内置运行时 vendored pnpm 同主版
# 本（store 大版本不一致 → ERR_PNPM_UNEXPECTED_STORE）；不 die，交由
# 后续 install 的硬错误兜底
if [[ "$(pnpm --version 2>/dev/null | cut -d. -f1)" != "11" ]]; then
  warn "当前 pnpm $(pnpm --version) 主版本非 11，与上游/vendored 不一致，"
  warn "依赖安装可能报 ERR_PNPM_UNEXPECTED_STORE / PATCH_FAILED，建议对齐"
fi

if [[ ! -d "$UPSTREAM/.git" && "${1:-}" != "--skip-clone" ]]; then
  say "克隆上游 fork deepseek-harness（分支 ${UPSTREAM_BRANCH}）…"
  git clone -b "$UPSTREAM_BRANCH" "$UPSTREAM_REPO" "$UPSTREAM"
fi
[[ -d "$UPSTREAM/.git" ]] || die "上游克隆不存在：${UPSTREAM}（重试不带 --skip-clone，或设 KCODER_UPSTREAM_DIR）"

cd "$UPSTREAM"

# 上游 pin 的 pnpm（package.json 的 packageManager）——本机构建必须与 CI 同**精确版本**，
# 不只是同主版本。2026-10-10 实测：全局 11.7.0 + 干净树 ⇒ build:lib 失败，且报错是
#   [@deepseek-ai/dsh-root] Cannot find entry: ["lib/types/{index,startup}.js"]
# 这种**误导性**形态（那批 lib/types 垫片既不在版本控制、构建链也不生成）；同一棵树
# 换 11.28.5 全绿。故此后 install/build 一律走 pin 版。
UPSTREAM_PNPM_PIN="$(node -e "try{const p=require(process.argv[1]).packageManager||'';process.stdout.write(p.startsWith('pnpm@')?p.slice(5):'')}catch{}" "$UPSTREAM/package.json")"
LOCAL_PNPM="$(pnpm --version 2>/dev/null || echo '未知')"
say "pnpm：本机 ${LOCAL_PNPM}　上游 pin ${UPSTREAM_PNPM_PIN:-（未声明）}"
if [[ -n "$UPSTREAM_PNPM_PIN" && "$LOCAL_PNPM" != "$UPSTREAM_PNPM_PIN" ]]; then
  if command -v npx >/dev/null 2>&1; then
    warn "本机 pnpm 与上游 pin 不一致 ⇒ 后续改用 npx pnpm@${UPSTREAM_PNPM_PIN}（与 CI 对齐）"
  else
    warn "本机 pnpm ${LOCAL_PNPM} ≠ 上游 pin ${UPSTREAM_PNPM_PIN}，且无 npx：构建可能与 CI 不一致"
  fi
fi

# 统一出入口：有 pin 就 npx 取 pin 版，否则回落本机 pnpm（无 pin 的上游/离线场景）
run_pnpm() {
  if [[ -n "$UPSTREAM_PNPM_PIN" ]] && command -v npx >/dev/null 2>&1; then
    npx --yes "pnpm@$UPSTREAM_PNPM_PIN" "$@"
  else
    pnpm "$@"
  fi
}

# 基线钉版（fork 锚定形态）：消费态 = 集成分支 $UPSTREAM_BRANCH，其历史必须包含
# upstream/BASELINE 指定的基线提交。不钉版的教训：CI 浮动克隆 master，上游发
# rc.7 当天（slot 契约 list→keyed 破坏性变化）就混进了打包运行时。
# 升级基线 = 改 BASELINE 文件 + 在 fork 上重建集成分支后重跑本脚本。
BASELINE_SHA="$(grep -vE '^[[:space:]]*(#|$)' "$ROOT/upstream/BASELINE" | head -1 | tr -d '[:space:]')"
[[ -n "$BASELINE_SHA" ]] || die "upstream/BASELINE 缺少提交 SHA"
git cat-file -e "${BASELINE_SHA}^{commit}" 2>/dev/null || {
  say "本地缺失基线对象，fetch 远端 …"
  git fetch origin "+refs/heads/*:refs/remotes/origin/*" || die "拉取基线提交失败（检查 upstream/BASELINE 是否写错）"
}
if [[ "$(git branch --show-current)" != "$UPSTREAM_BRANCH" ]]; then
  [[ -z "$(git status --porcelain)" ]] || die "上游工作树不干净，无法切分支（先恢复 pristine）"
  say "切换到集成分支 $UPSTREAM_BRANCH …"
  git checkout "$UPSTREAM_BRANCH"
fi
git merge-base --is-ancestor "$BASELINE_SHA" HEAD \
  || die "集成分支 $UPSTREAM_BRANCH 不含基线 ${BASELINE_SHA:0:7}（在 fork 上重建集成分支或更新 upstream/BASELINE）"

# 落盘上游路径指针（2026-10-10）：dev/preview 与后续 setup 都据此解析落点，
# 免去每台机器 export KCODER_UPSTREAM_DIR——Windows 上默认值是无用的 mac 路径，
# 现场表现是「pnpm dev 只停在 setup 页」（见 dsh-contract 的诊断面）。
# 必须写**平台原生形态**：本脚本在 Git Bash 下 $UPSTREAM 是 /d/... 形态，
# 而读它的是 Electron 主进程（Node 的 join 认不得 msys 路径），故过 cygpath。
POINTER_VALUE="$UPSTREAM"
if command -v cygpath >/dev/null 2>&1; then
  POINTER_VALUE="$(cygpath -w "$UPSTREAM")"
fi
printf '%s\n' "$POINTER_VALUE" > "$UPSTREAM_POINTER"
say "已记录上游路径指针：$UPSTREAM_POINTER → $POINTER_VALUE"

# 上游修复已在集成分支中以提交存在（六修复分支的 merge），无需再 apply。
# upstream/*.patch 仅留作历史参照；旧克隆带应用态残留时用 git checkout 恢复。

# vendor/ 纯净守卫：物化残留会被 tsdown workspace 当假成员（Cannot find
# entry 炸 build）——构建前强制过闸（rc.5/alpha.2/alpha.3 三次复发）
bash "$ROOT/scripts/verify-vendor-purity.sh"

# store 复用：pnpm 要求 store 与既有 node_modules 一致，不一致时非交互环境
# 直接 ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY（本机克隆的 store 在仓内
# .pnpm-store，与 pnpm 全局 store 不同——2026-10-04 实测引导中断）。有既装
# 记录就按记录复用；全新克隆无记录，走 pnpm 默认 store。
STORE_DIR="$(node "$ROOT/scripts/deps-freshness.mjs" --store-dir "$UPSTREAM" 2>/dev/null || true)"
if [[ -n "$STORE_DIR" ]]; then
  say "安装依赖（--store-dir ${STORE_DIR}）…"
  run_pnpm install --store-dir "$STORE_DIR"
else
  say "安装依赖…"
  run_pnpm install
fi

say "构建上游（build，含 Host/Client/Web 三阶段）…"
run_pnpm run build

say "完成。启动桌面端：cd $ROOT && pnpm dev（开发）或 pnpm start（生产预览）"
