#!/usr/bin/env bash
# KCoder 本地打包发布脚本（手动操作，一切可控）。
#
# 打包产物开箱即用的核心：上游运行时（pnpm deploy 物化的生产依赖
# 闭包，约 330MB）经 electron-builder extraResources 随包分发，
# 安装后无需克隆/构建上游。
#
# 签名与公证（macOS）：
# - 签名：本地钥匙串的 Developer ID 证书自动发现（无需配置）；
# - 公证：设置环境变量后自动启用（三者缺一即跳过，仅签名）：
#     export APPLE_ID=<apple id>
#     export APPLE_APP_SPECIFIC_PASSWORD=<应用专用密码>
#     export APPLE_TEAM_ID=<团队 id>
#
# 常用流程（一键，KStock 同款）：
#   先写发布说明（约定见 release/README.md，ship 会强制校验）：
#     新建 release/v0.2.0.md（模板在 release/README.md）
#   bash scripts/release.sh ship 0.2.0   # bump+提交+tag+推送，CI 全自动三平台发布
#
# 本地调试/应急（可选）：
#   bash scripts/release.sh build        # 本地打包 + 校验（含公证，需凭据）
#   bash scripts/release.sh release create v0.2.0 --publish  # 手动上传发布
#
# 出问题时：
#   bash scripts/release.sh status            # 全局状态总览
#   bash scripts/release.sh release delete v0.2.0 --with-tag
#
# 用法：bash scripts/release.sh <命令>（help 查看全部）

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPSTREAM="${KCODER_UPSTREAM_DIR:-/Users/libing/kk_Projects/deepseek-harness}"
STAGING="$ROOT/staging/kcoder-runtime"
DIST="$ROOT/dist"
APP_NAME="KCoder.app"

say()  { printf '\033[1;34m[release]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[release]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[release]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[release] 错误：\033[0m %s\n' "$*" >&2; exit 1; }

# 当前 package.json 版本。
app_version() { node -p 'require(process.argv[1]).version' "$ROOT/package.json"; }

# 规范化 tag：接受 v0.2.0 或 0.2.0，统一输出 v0.2.0。
norm_tag() {
  local t="${1#v}"
  [[ "$t" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || die "非法版本号：${1}（示例：0.2.0）"
  echo "v$t"
}

# 从 tag 提取裸版本（v0.2.0 → 0.2.0）。
bare_version() { echo "${1#v}"; }

# ─────────────────────────── status ───────────────────────────

cmd_status() {
  say "应用版本：$(app_version)"
  if [[ -d "$UPSTREAM/.git" ]]; then
    local bin="$UPSTREAM/apps/cli/lib/bin.js"
    say "上游克隆：$([[ -f "$bin" ]] && echo "已构建" || echo "未构建（缺 ${bin}）") @ $(git -C "$UPSTREAM" rev-parse --short HEAD)"
  else
    say "上游克隆：缺失（开发态需要，打包前会自动准备）"
  fi
  say "运行时物化：$([[ -f "$STAGING/lib/bin.js" ]] && echo "就绪（$(du -sh "$STAGING" 2>/dev/null | cut -f1)）" || echo "未物化")"
  if [[ -d "$DIST" && -n "$(ls -A "$DIST" 2>/dev/null)" ]]; then
    say "打包产物（dist/）："
    ls -lh "$DIST" | tail -n +2 | awk '{printf "    %s  %s\n", $5, $9}'
  else
    say "打包产物：无"
  fi
  say "本地 tag：$(git -C "$ROOT" tag -l | tr '\n' ' ')"
  say "远程 tag：$(git -C "$ROOT" ls-remote --tags origin | awk -F/ '{print $NF}' | grep -v '\^{}' | tr '\n' ' ')"
  if command -v gh >/dev/null 2>&1; then
    say "GitHub Releases："
    gh release list -R kkutysllb/KCoder 2>/dev/null | sed 's/^/    /' || warn "（无法读取，检查 gh 登录）"
  fi
}

# ─────────────────────────── build ───────────────────────────

cmd_build() {
  command -v node >/dev/null 2>&1 || die "需要 node"
  command -v pnpm >/dev/null 2>&1 || die "需要 pnpm"

  # 0) 上游 vendor/ 纯净 preflight：物化/手工 deploy 的残留目录会被 tsdown
  #    workspace glob vendor/* 当成假成员，以根包名义报 Cannot find entry
  #    炸掉上游构建（rc.5/alpha.2/alpha.3 三次复发）。无条件过闸——上游
  #    「已构建」时残留同样可能出现（v0.5.0 期：bin.js 01:13 在、残留 01:19 来）
  bash "$ROOT/scripts/verify-vendor-purity.sh"

  # 1) 上游就绪（克隆 + 构建；已就绪则跳过）
  if [[ ! -f "$UPSTREAM/apps/cli/lib/bin.js" ]]; then
    say "上游未构建，执行 setup（克隆 + install + build）…"
    bash "$ROOT/scripts/setup.sh"
  else
    ok "上游已构建，跳过 setup"
  fi

  # 2) 桌面端编译
  say "编译桌面端（typecheck + build）…"
  (cd "$ROOT" && pnpm install --frozen-lockfile && pnpm typecheck && pnpm build)

  # 3) 物化上游运行时（开箱即用的核心）：pnpm deploy 生产闭包
  #    + peer/平台二进制补齐（materialize-peers，deploy 的盲区）
  #    基线断言（fork 锚定）：消费态 = 集成分支 kcoder/alpha.3，历史必须含
  #    钉版基线（upstream/BASELINE）——手动改集成分支忘同步基线文件时在
  #    此拦下，未验证代码不进产物。
  BASELINE_SHA="$(grep -vE '^[[:space:]]*(#|$)' "$ROOT/upstream/BASELINE" | head -1 | tr -d '[:space:]')"
  [[ "$(git -C "$UPSTREAM" branch --show-current)" == "kcoder/alpha.3" ]] \
    || die "上游克隆不在集成分支 kcoder/alpha.3 上（先 bash scripts/setup.sh，或更新 upstream/BASELINE）"
  git -C "$UPSTREAM" merge-base --is-ancestor "$BASELINE_SHA" HEAD \
    || die "集成分支不含基线 ${BASELINE_SHA:0:7}（在 fork 上重建集成分支或更新 upstream/BASELINE）"
  say "物化上游运行时（deploy --prod + peer 补齐）→ staging/kcoder-runtime …"
  rm -rf "$STAGING"
  pnpm --dir "$UPSTREAM" --filter=@deepseek-ai/dsh deploy --prod --legacy "$STAGING"
  [[ -f "$STAGING/lib/bin.js" ]] || die "物化失败：缺 lib/bin.js"
  node "$ROOT/scripts/materialize-peers.mjs"
  [[ -f "$ROOT/staging/kcoder-runtime.tar.gz" ]] || die "物化失败：缺 staging/kcoder-runtime.tar.gz"
  ok "运行时就绪（$(du -sh "$STAGING" | cut -f1) → tar.gz $(du -h "$ROOT/staging/kcoder-runtime.tar.gz" | cut -f1)）"

  # 3.5) 品牌断言（fork 锚定第二道闸）：文案修复必须真实在产物里
  #      （0.4.5 现场：发布物构建早于 fork push，b11bd42095 未进打包
  #      机克隆态，dev 现象与发布物脱节；与 CI release.yml 共用脚本）
  say "品牌断言（chat.deepDiving 终值）…"
  node "$ROOT/scripts/brand-assert.mjs" "$ROOT/staging/kcoder-runtime.tar.gz" || die "品牌断言未通过"

  # 4) 运行时冒烟：真实起 Web 服务（就绪行 + 首页 200），
  #    不过全关的检查绝不进入下一步
  say "运行时冒烟（真实起服）…"
  node "$ROOT/scripts/smoke-runtime.mjs" --dir "$STAGING"

  # 5) electron-builder（本地签名自动发现；公证凭据齐则自动公证）
  if [[ -n "${APPLE_ID:-}" && -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" && -n "${APPLE_TEAM_ID:-}" ]]; then
    say "公证凭据齐全，构建将自动签名 + 公证"
  else
    die "公证凭据不全（需 APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID 环境变量）。未公证的包会被用户机器的 Gatekeeper 拦截，禁止打包：
    export APPLE_ID=<apple id>
    export APPLE_APP_SPECIFIC_PASSWORD=<应用专用密码>
    export APPLE_TEAM_ID=DHV5D72JNF"
  fi
  say "electron-builder 打包…"
  # 内置运行时 node_modules 文件数上万，macOS 默认 256 句柄会在签名阶段撞
  # EMFILE: too many open files
  ulimit -n 65536 2>/dev/null || true
  rm -rf "$DIST"
  (cd "$ROOT" && pnpm exec electron-vite build && pnpm exec electron-builder --publish never)

  # 6) 产物校验（不过全关的检查绝不放出包）
  cmd_verify
  ok "打包完成：$DIST"
}

# ─────────────────────────── verify ───────────────────────────

cmd_verify() {
  local app
  app="$(find "$DIST" -maxdepth 2 -name "$APP_NAME" -type d | head -1)"
  [[ -n "$app" ]] || die "校验失败：dist 下未找到 $APP_NAME"

  local res="$app/Contents/Resources"
  local tarball="$res/kcoder-runtime.tar.gz"

  # 1) 开箱即用核心：运行时归档存在（单文件分发，首启解压到 userData）
  [[ -f "$tarball" ]] || die "校验失败：包内缺 kcoder-runtime.tar.gz（开箱即用被破坏）"
  ok "内置运行时：kcoder-runtime.tar.gz（$(du -h "$tarball" | cut -f1)）"

  # 1.5) 插件热补丁（extraResources 目录映射 profile-patches）：与仓库
  #      profiles/web/patches 逐文件对账——缺任一即自愈链断供（Windows
  #      无 launchd，随包分发是补丁的唯一通道；新增补丁忘了提交/映射
  #      漂移都在此拦下）
  local pdir="$res/profile-patches" pmiss=0 pf
  [[ -d "$pdir" ]] || die "校验失败：包内缺 profile-patches/（插件热补丁断供）"
  for pf in "$ROOT"/profiles/web/patches/*.patch; do
    [[ -f "$pdir/$(basename "$pf")" ]] || { warn "包内缺补丁 $(basename "$pf")"; pmiss=1; }
  done
  [[ $pmiss -eq 0 ]] || die "校验失败：profile-patches 与仓库补丁清单不一致"
  ok "插件热补丁：$(ls "$pdir"/*.patch | wc -l | tr -d ' ') 个 patch 全部在位"

  # 1.6) 内置插件 bundle 对账：bundle/ 是 dsh-plugins 仓（唯一真源，
  #      2026-08-30 迁址）的同步副本，改动未 sync 就打包则发布物带旧
  #      插件（同 fork-push 时序教训）。真源仓在位必须零差异；不在位
  #      （纯 CI 场景）脚本内警告放行
  node "$ROOT/scripts/sync-bundles.mjs" --check \
    || die "校验失败：bundle/ 与 dsh-plugins 真源不一致（先跑 sync-bundles.mjs 同步再发版）"
  ok "内置插件 bundle 对账：与 dsh-plugins 真源一致"

  # 1.7) 包内 bundle 目录在位（extraResources 目录映射漂移拦截）：
  #      kcoder-skills-bundle 物化门按 resources/<dir> 判源存在，漏配
  #      映射会让物化静默跳过——coding-sidebar 退回 npm 实体（不再被
  #      纠偏覆盖），dsh-* 自有系列功能整块消失
  local bd bcount=0
  for bd in "$ROOT"/bundle/*/; do
    bd="$(basename "$bd")"
    [[ -d "$res/$bd" ]] || die "校验失败：包内缺 $bd/（extraResources 映射断供）"
    bcount=$((bcount + 1))
  done
  [[ $bcount -gt 0 ]] || die "校验失败：仓库 bundle/ 目录为空（同步链异常）"
  ok "内置 bundle 目录：$bcount 个全部随包在位"

  # 2) 解压 + 真实起服冒烟（模拟首启解压，包内运行时全链路验收）；
  #    macOS 上另跑 Electron node 形态——真机 GUI 启动时 PATH 无系统
  #    node，回退 Electron 内置 node（v0.1.0 曾挂：HMR 需 internal
  #    loader），系统 node 冒烟覆盖不到该路径
  local xdir; xdir="$(mktemp -d)"
  tar -xzf "$tarball" -C "$xdir" \
    || { rm -rf "$xdir"; die "校验失败：归档损坏无法解压"; }
  [[ -f "$xdir/lib/bin.js" ]] \
    || { rm -rf "$xdir"; die "校验失败：归档解压后缺 lib/bin.js"; }
  node "$ROOT/scripts/smoke-runtime.mjs" --dir "$xdir" \
    || { rm -rf "$xdir"; die "校验失败：包内运行时无法起服"; }
  if [[ "$(uname)" == "Darwin" ]]; then
    local bin="$app/Contents/MacOS/${APP_NAME%.app}"
    [[ -x "$bin" ]] \
      || { rm -rf "$xdir"; die "校验失败：app 内无主二进制（${bin}）"; }
    node "$ROOT/scripts/smoke-runtime.mjs" --dir "$xdir" --exec "$bin" \
      || { rm -rf "$xdir"; die "校验失败：Electron node 形态无法起服"; }
    ok "Electron node 形态冒烟通过（真机启动路径）"
  fi
  rm -rf "$xdir"

  # 3) macOS 签名（必须 Developer ID，拒绝 adhoc 坏包）
  if [[ "$(uname)" == "Darwin" ]]; then
    local sig
    sig="$(codesign -dv --verbose=4 "$app" 2>&1 || true)"
    if grep -q "Signature=adhoc" <<<"$sig"; then
      die "校验失败：产物是 adhoc 签名（钥匙串无 Developer ID 证书？）"
    fi
    grep -q "TeamIdentifier" <<<"$sig" || die "校验失败：产物无 TeamIdentifier"
    ok "签名：$(grep -m1 'Authority=' <<<"$sig" | sed 's/.*Authority=//')"
    # 4) 公证票据（notarize: true 后必有票据，缺即坏包）
    if [[ "$(uname)" == "Darwin" ]]; then
      xcrun stapler validate "$app" >/dev/null 2>&1 \
        || die "校验失败：产物未公证（stapler 无票据）"
      ok "公证：票据有效"
    fi
  fi

  # 5) 自动更新元数据（mac 需 zip + blockmap + latest-mac.yml）
  local miss=0
  for f in latest-mac.yml; do
    [[ -f "$DIST/$f" ]] || { warn "缺 $DIST/${f}（自动更新发现入口）"; miss=1; }
  done
  if ls "$DIST"/*.zip >/dev/null 2>&1 && ls "$DIST"/*.blockmap >/dev/null 2>&1; then
    ok "更新元数据：zip + blockmap 齐全"
  else
    warn "缺 zip/blockmap（自动更新增量包）"; miss=1
  fi
  [[ $miss -eq 0 ]] || warn "存在缺失项——若需自动更新请先解决"
  ok "校验通过：$app"
}

# ─────────────────────────── bump ───────────────────────────

cmd_bump() {
  [[ $# -eq 1 ]] || die "用法：release.sh bump <version>（例：0.2.0）"
  local v; v="$(bare_version "$(norm_tag "$1")")"
  node -e '
    const fs = require("fs")
    const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
    p.version = process.argv[2]
    fs.writeFileSync(process.argv[1], JSON.stringify(p, null, 2) + "\n")
  ' "$ROOT/package.json" "$v"
  ok "版本已更新为 ${v}（记得提交：git add package.json && git commit）"
}

# ─────────────────────────── ship（一键发布） ───────────────────────────

cmd_ship() {
  [[ $# -eq 1 ]] || die "用法：release.sh ship <version>（例：0.1.0）"
  local t; t="$(norm_tag "$1")"; local v; v="$(bare_version "$t")"

  # 发布说明前置检查（约定见 release/README.md）：说明文件随 release 提交
  # 一并入库，CI 发布时作为 GitHub Release 正文——缺失即拒绝发布。
  [[ -f "$ROOT/release/$t.md" ]] \
    || die "缺发布说明 release/$t.md（约定与模板见 release/README.md：先写好说明再 ship）"

  # 前置检查：不覆盖已有 tag；本地不落后远程
  if git -C "$ROOT" rev-parse -q --verify "refs/tags/$t" >/dev/null; then
    die "本地 tag $t 已存在（先 release.sh tag delete $v 或换版本号）"
  fi
  git -C "$ROOT" fetch origin --tags --quiet
  if git -C "$ROOT" ls-remote --tags origin | grep -q "refs/tags/$t$"; then
    die "远程 tag $t 已存在"
  fi
  git -C "$ROOT" fetch origin main --quiet
  local behind
  behind="$(git -C "$ROOT" rev-list --count HEAD..origin/main 2>/dev/null || echo 0)"
  [[ "$behind" == "0" ]] || die "本地落后 origin/main ${behind} 个提交，先 git pull 再发布"

  # 1) bump 版本
  cmd_bump "$v" >/dev/null

  # 2) 提交（版本号 + 工作区其他改动一并随发）
  git -C "$ROOT" add -A
  if git -C "$ROOT" diff --cached --quiet; then
    warn "工作区无改动，仅打 tag（版本号未变？确认是否重复发布）"
  else
    git -C "$ROOT" commit -m "release: $v"
    ok "已提交 release: $v"
  fi

  # 3) tag + 推送（tag 推送即触发 CI 三平台全自动构建发布）
  git -C "$ROOT" tag "$t"
  git -C "$ROOT" push origin main
  git -C "$ROOT" push origin "$t"
  ok "已推送 main + $t"
  say "CI 正在三平台构建并自动发布（约 30-40 分钟）："
  say "  进度：gh run list -R kkutysllb/KCoder --workflow=Release"
  say "  页面：https://github.com/kkutysllb/KCoder/actions"
  say "  发布：https://github.com/kkutysllb/KCoder/releases/tag/$t"
}

# ─────────────────────────── tag ───────────────────────────

cmd_tag() {
  [[ $# -ge 1 ]] || die "用法：release.sh tag <create|push|list|delete> ..."
  local sub="$1"; shift
  case "$sub" in
    create)
      [[ $# -eq 1 ]] || die "用法：release.sh tag create <version>"
      local t; t="$(norm_tag "$1")"
      git -C "$ROOT" rev-parse -q --verify "refs/tags/$t" >/dev/null \
        && die "本地 tag $t 已存在"
      git -C "$ROOT" tag "$t"
      ok "已创建本地 tag ${t}（HEAD $(git -C "$ROOT" rev-parse --short HEAD)）"
      ;;
    push)
      local t
      if [[ $# -eq 1 ]]; then t="$(norm_tag "$1")";
      else t="$(git -C "$ROOT" describe --tags --abbrev=0 2>/dev/null)" || die "无本地 tag"; fi
      git -C "$ROOT" push origin "$t"
      ok "已推送 ${t}（如需触发 CI 三平台构建即生效；不需要 CI 可忽略）"
      ;;
    list)
      say "本地：$(git -C "$ROOT" tag -l | tr '\n' ' ')"
      say "远程：$(git -C "$ROOT" ls-remote --tags origin | awk -F/ '{print $NF}' | grep -v '\^{}' | tr '\n' ' ')"
      ;;
    delete)
      [[ $# -ge 1 ]] || die "用法：release.sh tag delete <version> [...]（本地+远程）"
      for arg in "$@"; do
        local t; t="$(norm_tag "$arg")"
        git -C "$ROOT" tag -d "$t" 2>/dev/null && ok "已删本地 $t" || warn "本地无 $t"
        git -C "$ROOT" push origin ":refs/tags/$t" 2>/dev/null && ok "已删远程 $t" || warn "远程无 $t"
      done
      ;;
    *)
      die "未知 tag 子命令：${sub}（create|push|list|delete）"
      ;;
  esac
}

# ─────────────────────────── release ───────────────────────────

cmd_release() {
  command -v gh >/dev/null 2>&1 || die "release 子命令需要 gh（brew install gh && gh auth login）"
  [[ $# -ge 1 ]] || die "用法：release.sh release <create|list|publish|delete> ..."
  local sub="$1"; shift
  case "$sub" in
    create)
      [[ $# -ge 1 ]] || die "用法：release.sh release create <version> [--publish]"
      local t; t="$(norm_tag "$1")"; local publish="${2:-}"
      # 版本一致性：package.json 必须 == tag（防版本错位的事故重演）
      local pv; pv="$(app_version)"
      [[ "$pv" == "$(bare_version "$t")" ]] \
        || die "版本错位：package.json=${pv}，tag=${t}。先 bash scripts/release.sh bump $(bare_version "$t") 并提交"
      # tag 必须存在并指向已推送的提交
      git -C "$ROOT" rev-parse -q --verify "refs/tags/$t" >/dev/null \
        || die "本地无 ${t}，先：release.sh tag create $(bare_version "$t")"
      git -C "$ROOT" ls-remote --tags origin | grep -q "refs/tags/$t$" \
        || die "远程无 ${t}，先：release.sh tag push $t"
      # 产物必须存在且新鲜（当天构建）
      [[ -f "$DIST/latest-mac.yml" ]] || die "dist 无产物，先：release.sh build"
      say "上传产物到 $t …"
      # 正文优先取仓内发布说明（与 CI 发布同口径）；缺失才回退自动摘要。
      local notes_args=(--generate-notes)
      if [[ -f "$ROOT/release/$t.md" ]]; then
        notes_args=(--notes-file "$ROOT/release/$t.md")
      else
        warn "缺 release/$t.md，回退自动摘要（约定见 release/README.md）"
      fi
      local args=(--draft --title "$t" "${notes_args[@]}")
      [[ "$publish" == "--publish" ]] && args=(--title "$t" "${notes_args[@]}")
      (cd "$DIST" && gh release create "$t" -R kkutysllb/KCoder \
        ./*.dmg ./*.zip ./*.blockmap ./latest*.yml "${args[@]}")
      if [[ "$publish" == "--publish" ]]; then
        ok "已正式发布 $t"
      else
        ok "已创建 draft ${t}（检查无误后：release.sh release publish ${t}）"
      fi
      ;;
    list)
      gh release list -R kkutysllb/KCoder
      ;;
    publish)
      [[ $# -eq 1 ]] || die "用法：release.sh release publish <version>"
      local t; t="$(norm_tag "$1")"
      gh release edit "$t" -R kkutysllb/KCoder --draft=false
      ok "$t 已正式发布"
      ;;
    delete)
      [[ $# -ge 1 ]] || die "用法：release.sh release delete <version> [--with-tag]"
      local t with_tag="${2:-}"
      t="$(norm_tag "$1")"
      if gh release view "$t" -R kkutysllb/KCoder >/dev/null 2>&1; then
        if [[ "$with_tag" == "--with-tag" ]]; then
          gh release delete "$t" -R kkutysllb/KCoder --yes --cleanup-tag
          git -C "$ROOT" tag -d "$t" 2>/dev/null || true
          ok "已删除 Release + 远程/本地 tag：$t"
        else
          gh release delete "$t" -R kkutysllb/KCoder --yes
          ok "已删除 Release：${t}（tag 保留）"
        fi
      else
        warn "Release $t 不存在"
        [[ "$with_tag" == "--with-tag" ]] && cmd_tag delete "$t"
      fi
      ;;
    *)
      die "未知 release 子命令：${sub}（create|list|publish|delete）"
      ;;
  esac
}

# ─────────────────────────── 入口 ───────────────────────────

main() {
  [[ $# -ge 1 ]] || { sed -n '2,30p' "${BASH_SOURCE[0]}"; exit 1; }
  local cmd="$1"; shift
  case "$cmd" in
    status)  cmd_status "$@" ;;
    ship)    cmd_ship "$@" ;;
    build)   cmd_build "$@" ;;
    verify)  cmd_verify "$@" ;;
    bump)    cmd_bump "$@" ;;
    tag)     cmd_tag "$@" ;;
    release) cmd_release "$@" ;;
    help|-h|--help) sed -n '2,30p' "${BASH_SOURCE[0]}" ;;
    *) die "未知命令：${cmd}（可用：status ship build verify bump tag release help）" ;;
  esac
}

main "$@"
