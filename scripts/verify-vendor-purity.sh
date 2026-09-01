#!/usr/bin/env bash
# 上游 vendor/ 纯净守卫：物化/手工 deploy 的残留目录（空壳 + 孤儿 symlink、
# 无 package.json）会被上游 tsdown 的 workspace glob vendor/* 当成成员，
# entry 全 miss 即以根包名义报 Cannot find entry 炸掉整个上游构建
# （rc.5/alpha.2/alpha.3 三次复发，写入者未定罪；v0.5.0 期 dev 环境因它
# 吃不到 alpha.3 新 UI）。发现非白名单条目即非零退出——发版链
# （release.sh build）与引导链（setup.sh）在构建上游前调用，亦可单独手动跑。
#
# 用法：bash scripts/verify-vendor-purity.sh（KCODER_UPSTREAM_DIR 可覆盖上游路径）

set -euo pipefail
shopt -s nullglob

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPSTREAM="${KCODER_UPSTREAM_DIR:-/Users/libing/kk_Projects/deepseek-harness}"

say() { printf '\033[1;34m[vendor]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[vendor] 错误：\033[0m %s\n' "$*" >&2; exit 1; }

VEND="$UPSTREAM/vendor"
[[ -d "$VEND" ]] || { say "上游无 vendor/ 目录，跳过（$VEND）"; exit 0; }

# 白名单 = 上游 vendored 框架包（tsdown/pnpm workspace 成员）+ 仓内文档。
# 上游新增 vendored 包时需有意识地在此登记——守卫的价值就是强制过目。
WHITELIST="AGENTS.md CLAUDE.md README.md cordis cosmokit group hmr include loader logger-console schemastery timer"

bad=""
for entry in "$VEND"/*; do
  name="$(basename "$entry")"
  [[ "$name" == .* ]] && continue  # 隐藏文件不进 tsdown glob（.DS_Store 等）
  case " $WHITELIST " in
    *" $name "*) ;;
    *) bad="$bad $name" ;;
  esac
done

[[ -z "$bad" ]] || die "上游 vendor/ 混入非白名单条目：$bad
  残留会以 tsdown 假项目炸掉 build:lib（Cannot find entry @ @deepseek-ai/dsh-root）。
  排查：DEBUG='tsdown*' pnpm --dir \"$UPSTREAM\" exec tsdown --env.DSH_BUILD_FACE host 看成员列表；
  确认非在用物后删除（自底向上 find <残留> -depth -type d -exec rmdir {} +，非空即拒删）。"
say "纯净：vendor/ 全部条目在白名单内"
