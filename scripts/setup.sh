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

command -v git >/dev/null 2>&1 || die "需要 git"
command -v node >/dev/null 2>&1 || die "需要 Node.js（上游要求 ^22.19.0 || >=24.0.0）"
command -v pnpm >/dev/null 2>&1 || die "需要 pnpm（可运行：corepack enable && corepack prepare pnpm@latest --activate）"

if [[ ! -d "$UPSTREAM/.git" && "${1:-}" != "--skip-clone" ]]; then
  say "克隆上游 deepseek-harness …"
  git clone "$UPSTREAM_REPO" "$UPSTREAM"
fi
[[ -d "$UPSTREAM/.git" ]] || die "上游克隆不存在：$UPSTREAM（重试不带 --skip-clone）"

cd "$UPSTREAM"
say "安装依赖（pnpm install）…"
pnpm install

say "构建上游（pnpm run build，含 Host/Client/Web 三阶段）…"
pnpm run build

say "完成。启动桌面端：cd $ROOT && pnpm dev（开发）或 pnpm start（生产预览）"
