#!/usr/bin/env bash
# 上游同步：fetch → 脏检查 → ff-only pull → pnpm install → pnpm build。
# 与桌面端“同步上游”面板同一套流程（面板额外会自动重启 dsh 侧车）。
#
# 工作树不干净时拒绝执行——保持上游克隆 pristine 是随时跟进 upstream 的前提。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPSTREAM="$ROOT/deepseek-harness"

say() { printf '\033[1;34m[sync]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[sync] 错误：\033[0m %s\n' "$*" >&2; exit 1; }

[[ -d "$UPSTREAM/.git" ]] || die "上游克隆不存在，请先运行 scripts/setup.sh"

cd "$UPSTREAM"

if [[ -n "$(git status --porcelain)" ]]; then
  die "工作树有本地改动，拒绝同步。请 git stash / git checkout 恢复 pristine 后重试。"
fi

say "git fetch origin …"
git fetch origin --prune

BEHIND="$(git rev-list --count HEAD..@{upstream} 2>/dev/null || echo 0)"
if [[ "$BEHIND" -gt 0 ]]; then
  say "落后 $BEHIND 个提交，执行 git pull --ff-only …"
  git pull --ff-only
else
  say "已是最新（仍将重新构建）"
fi

say "pnpm install …"
pnpm install

say "pnpm run build …"
pnpm run build

say "同步完成：$(git rev-parse --short HEAD)。重启 KCoder 即可加载新构建。"
