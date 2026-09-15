#!/usr/bin/env bash
# 上游 vendor/ 纯净守卫：物化/手工 deploy 的残留目录（空壳 + 孤儿 symlink、
# 无 package.json）会被上游 tsdown 的 workspace glob vendor/* 当成成员，
# entry 全 miss 即以根包名义报 Cannot find entry 炸掉整个上游构建
# （rc.5/alpha.2/alpha.3 三次复发，写入者未定罪；v0.5.0 期 dev 环境因它
# 吃不到 alpha.3 新 UI；2026-09-15 第四次：release.sh build 的 deploy 步骤
# 自己造出 vendor/KCoder，炸掉随后的 fork 侧 pre-push pnpm run typecheck）。
#
# 用法：bash scripts/verify-vendor-purity.sh [--clean]
#   （无参数）只检：发现非白名单条目即非零退出——CI/引导链的严格门。
#   --clean   先回收再检：自底向上 rmdir 空目录壳、删孤儿 symlink；
#             非空目录拒删，最终仍以非零退出。发版链在 pnpm deploy **之后**
#             用它——残留正是 deploy 自己造的，只拦不清会让 fork 每轮发版后
#             带雷，下一次任何上游构建（含 fork 侧 pre-push）即炸。
#   KCODER_UPSTREAM_DIR 可覆盖上游路径

set -euo pipefail
shopt -s nullglob

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPSTREAM="${KCODER_UPSTREAM_DIR:-/Users/libing/kk_Projects/deepseek-harness}"

CLEAN=0
[[ "${1:-}" == "--clean" ]] && CLEAN=1

say()  { printf '\033[1;34m[vendor]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[vendor]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[vendor] 错误：\033[0m %s\n' "$*" >&2; exit 1; }

VEND="$UPSTREAM/vendor"
[[ -d "$VEND" ]] || { say "上游无 vendor/ 目录，跳过（$VEND）"; exit 0; }

# 白名单 = 上游 vendored 框架包（tsdown/pnpm workspace 成员）+ 仓内文档。
# 上游新增 vendored 包时需有意识地在此登记——守卫的价值就是强制过目。
WHITELIST="AGENTS.md CLAUDE.md README.md cordis cosmokit group hmr include loader logger-console schemastery timer"

# 扫描非白名单条目（每次调用前清空 bad，供回收后复查复用）。
scan() {
  bad=""
  for entry in "$VEND"/*; do
    name="$(basename "$entry")"
    [[ "$name" == .* ]] && continue  # 隐藏文件不进 tsdown glob（.DS_Store 等）
    case " $WHITELIST " in
      *" $name "*) ;;
      *) bad="$bad $name" ;;
    esac
  done
}

scan

if [[ -n "$bad" && "$CLEAN" == "1" ]]; then
  say "回收非白名单条目：$bad"
  for name in $bad; do
    target="$VEND/$name"
    if [[ -L "$target" ]]; then
      rm -f "$target"                                  # 孤儿 symlink：只删链接本身
    elif [[ -d "$target" ]]; then
      find "$target" -depth -type d -exec rmdir {} + 2>/dev/null || true
    elif [[ -e "$target" ]]; then
      rm -f "$target"
    fi
    if [[ -e "$target" || -L "$target" ]]; then
      warn "未能回收（非空目录？）：$name"
    else
      say "已回收：$name"
    fi
  done
  scan
  [[ -z "$bad" ]] || die "回收后 vendor/ 仍含非白名单条目：$bad
  含真实文件（rmdir 拒删），需人工确认后再删——绝不盲删可能是在用内容。"
  say "回收完成：vendor/ 已回纯净"
  exit 0
fi

[[ -z "$bad" ]] || die "上游 vendor/ 混入非白名单条目：$bad
  残留会以 tsdown 假项目炸掉 build:lib（Cannot find entry @ @deepseek-ai/dsh-root）。
  排查：DEBUG='tsdown*' pnpm --dir \"$UPSTREAM\" exec tsdown --env.DSH_BUILD_FACE host 看成员列表；
  回收：bash scripts/verify-vendor-purity.sh --clean（非空目录会拒删并报出）。"
say "纯净：vendor/ 全部条目在白名单内"
