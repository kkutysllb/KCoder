# profile-patches 分发目录（唯一事实源）

本目录是**插件缺陷热补丁**的仓库侧分发源：electron-builder 以目录级映射
随包分发（`extraResources: from: profiles/web/patches → to: profile-patches`），
app 启动时由 `desktop/main/profile-patches.ts` 幂等物化进用户 profile
（`$DSH_HOME/profiles/web/patches/`），声明与回收由自愈链负责；发版侧
`scripts/update-profile-plugins.mjs`（--check / --release-gate）与
`scripts/release.sh` 的包内对账在此清单上做断供闸。

文件命名：`<pkg>@<version>.patch`（scoped 包用 pnpm 惯例 `@scope__name`），
清单由目录扫描得出——**新增/退役补丁都不需要改任何清单代码**。

补丁生命期（常驻 / 随版本 / 退役）与登记样板见
`desktop/main/profile-patches.ts` 文件头。本 README 兼作目录占位：
git 不跟踪空目录，零常驻补丁的稳态下靠它保住打包映射的目录锚点。

## 当前状态（2026-10-02）

**零常驻补丁**。唯一一条补丁线 `dsh-context`（RO 回路冷却 / 轮尾跳转走
会话内 tab，最后分发于 `dsh-context@0.62.2.patch`）已随插件整线退役而
摘除，包名转入 `RETIRED_PATCH_PKGS`（现场残留 patch 文件与声明由自愈链
在下次启动回收）。历史补丁线的退役记录见上属文件头注释。

## 新增常驻补丁的登记清单（四件套 + 两处同步）

1. patch 文件落本目录（对实装产物逐 hunk 取证，精确版本键命名）；
2. `desktop/main/profile-patches.ts`：PATCH_MARKS 登记 marks +
   PATCH_FALLBACKS 登记等价锄点（文件头「补丁生命期」）；
3. `scripts/update-profile-plugins.mjs`：PATCH_MARKS 同步登记（与 2 保持
   一致是发版闸的前置）；
4. 跑 `node scripts/update-profile-plugins.mjs --check` 确认 marks 在位、
   零版本键漂移；`--release-gate` 过闸后再发版。
