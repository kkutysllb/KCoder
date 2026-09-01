#!/usr/bin/env bash
# KCoder 首次引导：克隆上游 fork（若缺）→ 切集成分支 → 安装依赖 → 构建。
#
# 上游锚定 = 自有 fork（kkutysllb/deepseek-harness），消费工作树在仓外单一路径，
# 上游修复以提交落集成分支 ${UPSTREAM_BRANCH}（= 基线 + 修复分支的 merge），
# 不再用 upstream/*.patch 归档应用。桌面端零修改复用其 Web UI、API 网关与插件生态。
#
# 用法：bash scripts/setup.sh [--skip-clone]

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPSTREAM="${KCODER_UPSTREAM_DIR:-/Users/libing/kk_Projects/deepseek-harness}"
UPSTREAM_REPO="${KCODER_UPSTREAM_REPO:-git@github.com:kkutysllb/deepseek-harness.git}"
UPSTREAM_BRANCH="kcoder/alpha.3"

say() { printf '\033[1;34m[setup]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[setup] 错误：\033[0m %s\n' "$*" >&2; exit 1; }
warn() { printf '\033[1;33m[setup] 警告：\033[0m %s\n' "$*" >&2; }

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

# 上游修复已在集成分支中以提交存在（六修复分支的 merge），无需再 apply。
# upstream/*.patch 仅留作历史参照；旧克隆带应用态残留时用 git checkout 恢复。

# vendor/ 纯净守卫：物化残留会被 tsdown workspace 当假成员（Cannot find
# entry 炸 build）——构建前强制过闸（rc.5/alpha.2/alpha.3 三次复发）
bash "$ROOT/scripts/verify-vendor-purity.sh"

say "安装依赖（pnpm install）…"
pnpm install

say "构建上游（pnpm run build，含 Host/Client/Web 三阶段）…"
pnpm run build

say "完成。启动桌面端：cd $ROOT && pnpm dev（开发）或 pnpm start（生产预览）"
