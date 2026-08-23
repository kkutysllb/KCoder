#!/usr/bin/env bash
# KCoder 首次引导：克隆上游 deepseek-harness（若缺）→ 安装依赖 → 构建。
#
# 上游克隆位于 ./deepseek-harness（.gitignore 排除，绝不提交），
# 桌面端零修改复用其 Web UI、API 网关与插件生态。
#
# 用法：bash scripts/setup.sh [--skip-clone]

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPSTREAM="$ROOT/deepseek-harness"
UPSTREAM_REPO="https://github.com/deepseek-ai/deepseek-harness.git"

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
  say "克隆上游 deepseek-harness …"
  git clone "$UPSTREAM_REPO" "$UPSTREAM"
fi
[[ -d "$UPSTREAM/.git" ]] || die "上游克隆不存在：$UPSTREAM（重试不带 --skip-clone）"

cd "$UPSTREAM"

# 基线钉版：克隆/构建必须落在 upstream/BASELINE 指定的提交上。
# 不钉版的教训：CI 浮动克隆 master，上游发 rc.7 当天（slot 契约
# list→keyed 破坏性变化）就混进了打包运行时，第三方插件启动即挂。
# 升级基线 = 改 BASELINE 文件后重跑本脚本（详见该文件头注释）。
BASELINE_SHA="$(grep -vE '^[[:space:]]*(#|$)' "$ROOT/upstream/BASELINE" | head -1 | tr -d '[:space:]')"
[[ -n "$BASELINE_SHA" ]] || die "upstream/BASELINE 缺少提交 SHA"
git cat-file -e "${BASELINE_SHA}^{commit}" 2>/dev/null || {
  say "本地缺失基线对象，fetch ${BASELINE_SHA:0:7} …"
  git fetch origin "$BASELINE_SHA" || die "拉取基线提交失败（检查 upstream/BASELINE 是否写错）"
}
if [[ "$(git rev-parse HEAD)" != "$BASELINE_SHA" ]]; then
  [[ -z "$(git status --porcelain)" ]] || die "上游工作树不干净，无法钉版（先恢复 pristine，见 upstream/README.md）"
  say "钉版到基线 ${BASELINE_SHA:0:7}（当前 HEAD $(git rev-parse --short HEAD)）…"
  git reset --hard "$BASELINE_SHA"
fi

# 基线钉版后：应用上游补丁存档（upstream/*.patch，如 markdown-sanitize /
# projection-cache-isolate）。补丁 = 已本地验证但暂未推上游的修复；CI 与
# 本地构建共用本脚本，保证运行时产物含修复。不可应用（基线已含/上下文
# 漂移）时跳过并警告——不静默失败，后续运行时冒烟会兜底验证。
for p in "$ROOT"/upstream/*.patch; do
  [[ -f "$p" ]] || continue
  if git apply --check "$p" 2>/dev/null; then
    say "应用上游补丁 $(basename "$p") …"
    git apply "$p"
  else
    warn "跳过上游补丁 $(basename "$p")（不可应用：基线已含修复或上下文漂移）"
  fi
done

say "安装依赖（pnpm install）…"
pnpm install

say "构建上游（pnpm run build，含 Host/Client/Web 三阶段）…"
pnpm run build

say "完成。启动桌面端：cd $ROOT && pnpm dev（开发）或 pnpm start（生产预览）"
