/**
 * 内置插件的开箱物化与 profile 自愈（**2026-10-09 起预置表为空**）。
 *
 * `PRESET_PLUGINS` 如今是空表：唯一一条正式声明（dsh-coding-sidebar）随
 * 「右侧工作台交回上游原生」的产品决策退役（docs/ARCHITECTURE.md §12
 * 铁律 1 于 2026-10-09 翻转）。本模块**保留**——它承载的不只是预置安装，
 * 还有四件仍然必需的工作：profile 骨架预写、pnpm 构建门、退役包三清
 * （deps / bundles 层叠 / 实体）、bundles 层叠对账；预置安装与 spec 漂移
 * 对账在空表下自动空转（`needInstall` 只剩退役命中一路输入）。
 *
 * 历史（止于 2026-10-04）：官方可选组合包 dsh-experimental-schedule-bundle 曾
 * 借道本表走「装进 profile deps + 自动声明进 bundles 层叠」这条通道；它随
 * dsh 0.2.1-alpha.1 被上游**整体删除**、调度改为 Web 内置，故本条已摘除并
 * 转入 RETIRED_PRESETS 三清——本表自此不再承载任何官方组合包。
 * （另见下方各自条目的历史记录段。）
 *
 * 预置插件是 KCoder 发行物的一部分：Windows 全新安装后 profile 是
 * 上游空模板（只有 dsh-base / dsh-web-app 内置层），第三方插件不会自动
 * 出现（mac 开发机上它们存在于用户 profile，属用户数据不随包分发）。
 * 预置表非空时，本模块在 dsh 启动前幂等物化：
 *
 * - profile 清单（package.json）不存在时预写完整骨架（对齐上游
 *   initProfile 模板：package.json + pnpm-workspace.yaml + cordis.patch.yml；
 *   上游只在清单缺失时写模板，预写不会被覆盖）
 * - dependencies 补写缺失条目（可先行——dsh 只消费 bundles 层叠，不查
 *   dependencies）
 * - 安装经 dsh-contract.runPnpm（vendor 实体优先，普通用户机器无 pnpm）
 *
 * 原子性（v0.1.7 Windows 引擎起不来的教训）：dsh 启动对
 * dsh.profile.bundles 逐项 resolveBundleDir，声明了而 node_modules 缺包
 * 即崩溃。因此 bundles 声明严格跟随安装实态对账——装上才补声明，
 * 装不上摘除幽灵声明（含旧版写入的坏状态自愈），dsh 裸起（无预置
 * 插件但不崩），下次启动幂等重试。
 *
 * 版本策略：预置 spec 锁定开箱已验证 patch 兼容的版本线（^ 对 0.x 仅
 * patch 级跟随，minor 升级不自动跟进）；用户主动“更新”经插件管理
 * update --latest 升线。破坏性敏感的包装层插件用锁定形态
 * （github tag / pinned 版本；现存预置均为 semver 形态）。
 *
 * 预置冻结（2026-08-30）：第三方插件不再新增预置——用户按需经插件
 * 管理页自装（github 源一键安装）。现有清单维持现状（含缺陷补丁与
 * 版本锁）；退役走 RETIRED_PRESETS 三清自愈（见 dsh-vision-router、
 * dsh-better-sidebar、@tt-a1i/archify-dsh、dsh-context）。
 *
 * dsh-context（2026-08-20 起随首批预置 → 2026-10-02 整线退役，本段为
 *   历史记录）：上下文统计视图插件——conversation.view slot 注册
 *   「上下文」tab（StatsBoard 统计板/构成趋势/上下文浏览器等，比
 *   /context modal 多五个统计维度），GUI 入口见 context-button.ts
 *   （已随之拆除）。宿主曾带两条常驻修复补丁（RO 回路冷却 / 轮尾
 *   jump 走会话内 tab，见 profile-patches.ts 文件头）。退役理由：
 *   产品层上下文可见性收归自有链路，插件视图不再预置（按需可经
 *   插件管理页自装）；整线退役——预置清单摘除 + RETIRED_PRESETS
 *   三清 + 补丁链回收（RETIRED_PATCH_PKGS）+ context-button.ts
 *   一并拆除。
 *
 * dsh-coding-sidebar（2026-08-20 以 dsh-better-sidebar 预置 → 2026-09-01
 *   切换自立包 → **2026-10-09 退役**，本段为历史记录）：侧边栏工作台底座
 *   （文件树/CM6 编辑器/图片·MD 预览/终端/Git/子代理，服务化扩展点）。fork
 *   自 DSH-better-sidebar 0.17.2 的独立发布线（1.0.0 起，底面板源码级移除，
 *   版本常量构建期注入），收编线的上游版本漂移病（0.17.1 settingsNamespace
 *   坏版启动崩）随之终结；实体由 bundle/dsh-coding-sidebar 物化覆盖为终态
 *   （见 kcoder-skills-bundle.ts）——本清单的声明仅牵引依赖树
 *   （codemirror/ws/node-pty 等 hoist 到 profile 顶层）。它是本表**唯一**
 *   一条正式声明，退役即本表清空；随之拆除的宿主面三处：
 * - pnpm 构建脚本门保留（`dangerouslyAllowAllBuilds`，见
 *   ensurePnpmBuildsAllowed——白名单收编路线早已证伪，dsh-ssh-remote 等
 *   其它内置 bundle 同样需要放行）；
 * - profile cordis.patch.yml 的标题栏避让补写随插件删除
 *   （ensureSidebarCompatPatch 整段退役）——那是为插件面板顶部让位 KCoder
 *   自绘状态栏而写，插件没了，行本身也会被退役清理摘掉；
 * - 开关簇状态栏代理（sidebar-cluster.ts）整模块退役：原生右栏接回后入口
 *   回到上游会话头角位的展开按钮。
 *
 * @tt-a1i/archify-dsh（2026-08-20 预置 → 2026-09-01 退役）：架构图
 * agent skill——把代码库/系统描述变成自包含交互 HTML 技术图（架构/
 * 工作流/时序/数据流/生命周期五型）。退役理由：架构图能力已由自有
 * 插件 dsh-super-ppts 覆盖，后续 dsh-animation 插件同样具备该能力，
 * 第三方重复能力不再预置（按需可经插件管理页自装，纯技能包装零
 * 迁移）。
 *
 * @dsh-external/dsh-drag-to-attachment（2026-08-20 预置 → 2026-09-01
 *   退役）：附件插件——「附件仅引用真实路径、不随消息携带图片数据」
 * 模式（拖拽/粘贴落盘 .drops 定位 → 发送时 wrap sendSession 把附件
 * 改写为 [附件] 路径行），输入框 📎 按钮亦由它注入。宿主曾深度改造
 * （attach-picker 按钮拦截 + rc.8 漏 return 补丁三层链 + alpha.1/3
 * 适配）。退役理由：上游原生附件链已完备（composer 原生
 * draftImages/imageIds，粘贴图片随消息携带真实图片数据直达多模态），
 * 插件的路径引用模式反而是「带图发送丢图」的现场根因；整线退役
 * （预置清单摘除 + RETIRED_PRESETS 三清 + 补丁链回收，
 * attach-picker.ts 一并拆除）。
 *
 * dsh-vision-router（2026-08-30 退役）：预置清单摘除并自愈清理。
 * 工具式识图与多模态主模型的原生视觉能力抢调用——模型优先走插件
 * 识图工具，效果反而一般；多模态已成主流，原生能力优先，退役不再
 * 预置（历史锁定 2.0.1 keyed slot 契约适配版）。
 *
 * @module desktop/main/preset-plugins
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { WEB_PROFILE, dshHome, runPnpm } from './dsh-contract'
import { ensureProfilePatches, healLog } from './profile-patches'

/**
 * 预置第三方插件表：bundle 名 → 依赖 spec（键顺序即层叠顺序，对齐 mac 开发机）。
 * **2026-10-09 起为空表**——唯一成员 dsh-coding-sidebar 已退役（见下方历史段）。
 * 表本身保留：它是「开箱即用 + 牵引依赖树」这条通道的唯一入口，`plugins.ts`
 * 的内置清单与 `needInstall` 触发条件都挂在它上面，空表下两者自动空转。
 * 恢复预置时的既有约定（历史现场沉淀）：spec 变化由 ensurePresetPlugins 的漂移
 * 对账推送到已装 profile（只升不降）；semver 下界可提取的 spec（含 github tag
 * 形态 github:…#v1.0.3）参与对账，link: 等无版本形态不参与；spec 只能指向
 * **已发布**版本（未发布版本会让 pnpm install 在启动期解析失败），且必须与
 * bundle/ 物化版本同线（见 docs/plugin-dev-checklist.md §2/§4）。
 */
export const PRESET_PLUGINS: Record<string, string> = {
  // @deepseek-ai/dsh-experimental-schedule-bundle（2026-10-04 整线退役，本段为
  // 历史记录）：曾用于启用上游 0.2.0-rc.1/rc.2 的调度与时间上下文——上游当时把
  // time-context / schedule / ui-schedule 三行**从 web-app 组合整段迁出**，改由
  // 这个官方**可选** bundle 的 cordis.patch.yml 以 `- insert:` 插入（包名已登记进
  // app-boot 的 OPTIONAL_BUNDLES，随安装提供但默认不选中）。
  // 因此启用方式从「产品策略层 id 定向覆写三行」改为「在 profile 的
  // dsh.profile.bundles 里选中本 bundle」——旧的覆写写法在 0.2.0-rc.1 上是
  // 「id 不存在 → warn 后跳过」的静默失效（升级现场），见 product-policy.ts。
  // 它不是第三方插件而是官方组合包，放进本表只是为了借「装进 profile deps +
  // 自动声明进 bundles 层叠」这条既有通道；版本随引擎基线同线。
  // 2026-09-30 平移：0.2.0-rc.1 → 0.2.0-rc.2。**调度家族必须与引擎逐版本
  // 同线（精确钉）**：上游 dsh-schedule 系包的 peer 全部精确钉引擎版本
  // （如 `0.2.0-rc.2`），跨线混装（引擎 rc.2 + 调度 rc.1）会让兼容闸门
  // 禁行 dsh-schedule / dsh-time-context，而 dsh-client-ui-schedule（peer
  // 仅 cordis）漏网存活并等待被禁服务 → Loader 永不结算 → ready 行不打印
  // → KCoder 60s 启动超时（2026-09-30 dev 现场实证 + overlay 二分定位，
  // 见 docs/upstream-0.2.0-rc.2-analysis.md §5）。这也是本表对调度线用
  // 精确钉而非范围钉的原因：上游 peer 本就精确钉，范围钉引入 ERESOLVE。
  // **2026-10-04 退役（随 dsh 0.2.1-alpha.1）**：上游把该组合包**整体删除**
  // （连目录 packages/experimental/schedule-bundle），调度改为 **Web 内置**
  // ——新包 schedule/tool-schedule 随 dsh-web-app 提供，无需再选中任何行。
  // 上游同时引入 RETIRED_BUNDLES 机制（boot/app-boot/src/profile.ts 的
  // dropRetiredBundles，在 loadProfileDirectory 第一步执行）：**每次加载都把
  // 该名从 profile 的 dsh.profile.bundles 删掉并回写 manifest**。若本表继续
  // 声明该行，宿主每次启动写回、引擎每次加载摘除 → 启动震荡 + 持续安装一个
  // 已停产的包（其 cordis.patch.yml 会插入精确钉旧引擎的 dsh-schedule 行，
  // 上面那条 60s 超时随即复发）。官方升级指南亦明确「由其他工具写入的
  // profile 目录需自行删除该条目」，KCoder 正是那个工具。
  // 退役后由 RETIRED_PRESETS 三清自愈（老 profile 的 deps 声明、bundles
  // 层叠声明与 node_modules 实体在下次启动全部回收）。
  // dsh-context（2026-10-02 整线退役，本段为历史记录）：曾随首批预置
  // （^0.55.0 锁线，与补丁线同线）。注意：该包曾挂两条常驻修复补丁
  // （RO 回路冷却 / 轮尾 jump 走会话内 tab，见 profile-patches.ts 文件头
  // 「补丁生命期」），升本 spec 或 pnpm update 之后必须跑一次
  // `node scripts/update-profile-plugins.mjs --check`——精确版本键随即
  // 失效、修复改由锄点注入兜底，verify 会报出「重出 patch 到新版本键」
  // 的发版待办；这是它升版的固定收尾动作（补丁线已随退役整线摘除，
  // 此流程随之作废，留作后续常驻补丁插件的流程样板）。
  // 退役后由 RETIRED_PRESETS 三清自愈（老 profile 的 deps 声明、bundles
  // 层叠声明与 node_modules 实体在下次启动全部回收）。
  // dsh-coding-sidebar（2026-09-19 un-retire @1.0.18 → **2026-10-09 退役**，
  // 本段为历史记录）：侧边栏工作台自立包（真源 kkutysllb/dsh-coding-sidebar），
  // 本表**唯一**一条正式声明。逐版本平移记录（^1.0.23 → ^1.0.40，每条均附
  // npmjs / npmmirror 双源发布核验）见 git 历史与 plans/retire-coding-sidebar.md。
  // 退役理由：上游新版本的原生右侧栏已覆盖产品所需能力，产品负责人拍板把右侧
  // 工作台交回上游（docs/ARCHITECTURE.md §12 铁律 1 于 2026-10-09 翻转）。
  // 退役自愈由本文件的 RETIRED_PRESETS 三清承担（deps 声明、bundles 层叠声明、
  // node_modules 实体），物化源与层叠项由 kcoder-skills-bundle 的 RETIRED_PLUGINS
  // 同批清理——双账本缺一即互搏，见该清单的 ⚠️ 教训。
  // dsh-file-review-kcoder（2026-09-19 un-retire @1.0.5 → **2026-10-04 退役**，
  // 本段为历史记录）：coding-sidebar 的衍生插件（增强审查卡 + 侧边栏审查 tab），
  // 末版本线 ^1.0.11（1.0.11 = peer 口径改 `>=0.1.7-rc.2 <1.0.0`）。
  // ⚠️ 本表是「反向复活」的唯一入口：只摘 BUNDLES 而不摘本表声明，插件会被
  // 插件页当「预置第三方插件」列出并由 pnpm 从 registry 装回来（与退役相反）
  // ——退役必须双账本同批，本条的两例（coding-sidebar / file-review）都这么走。
}

/**
 * 已迁回「随引擎分发」的 provider 包（2026-09-30）。这 4 个是内置 bundle
 * `dsh-ssh-remote` 把执行世界换成远端主机时、引擎要**按名字**解析的提供者；
 * 它们**不是 dsh 插件**（没有 `dsh.bundle` 元数据）。
 *
 * 它们曾按 profile 依赖安装（旧 `PRESET_RUNTIME_DEPS`），代价有两条
 * （2026-09-30 现场实证）：
 * 1. dsh 插件管理页把 profile 的 dependencies 一律当「用户安装的插件」列入
 *    「已安装」组——provider 是内置能力的运行前提，出现在那里是错误表述；
 * 2. 用户 registry 拿不到钉的版本时（npmmirror 对 0.2.0-rc.2 滞后），声明悬空
 *    ⇒ 宿主 `resolveBundleDir` 抛错记 operation-error（页面「异常」红字），
 *    且整棵 pnpm 依赖图解析失败，连无关插件的更新都 exit=1。
 *
 * 现在由 `scripts/materialize-peers.mjs` 的供给块随引擎分发（版本自引擎线
 * 推导，见 PROVIDER_PACKAGES）；本清单只用于**自愈**：把旧 profile 里的声明、
 * 实体与层叠污染三清干净。清实体是必须的——profile 解析优先于安装锚点，
 * 残留的旧副本会遮蔽随包实体，造成版本与引擎漂移。
 */
export const RUNTIME_PROVIDED_PACKAGES = [
  '@deepseek-ai/dsh-ssh',
  '@deepseek-ai/dsh-fs-ssh',
  '@deepseek-ai/dsh-subprocess-ssh',
  '@deepseek-ai/dsh-sandbox-ssh',
]

/**
 * {@link ensurePresetPlugins} 实际安装与对账的清单。**只含真插件**：provider
 * 类运行前提不再走这条路（见 {@link RUNTIME_PROVIDED_PACKAGES}）；消费方
 * （`plugins.ts` 的内置清单）只认 PRESET_PLUGINS，两者因此互不污染。
 *
 * 注意：第 3 步的安装触发条件只看 `PRESET_PLUGINS`（`needInstall`）——往本表
 * 加**非插件**条目会让「声明了却没装」永远不被触发重装（2026-09-27 现场：
 * 4 个 provider 补写进 deps 后没人装，悬空三天后集中爆在插件页）。要加一个
 * 非插件依赖，先确认它该不该走 profile 通道。
 * （2026-10-04 补充：`needInstall` 另有一路输入——第 1.8 步退役/迁移清理命中
 * 时置位的 `retiredTouched`，见该处注释；它不改变上面这条「非插件条目不会
 * 被触发重装」的结论，只覆盖退役场景。）
 */
const MANAGED_PROFILE_DEPS: Record<string, string> = { ...PRESET_PLUGINS }

/**
 * 退役预置插件：不再预置，也不留在用户 profile——dependencies 声明、
 * bundles 层叠声明与 node_modules 实体三处自愈移除（见
 * ensurePresetPlugins 的退役清理步骤；摘 deps + 删实体后由 pnpm
 * install 重放按新依赖图收敛，图与磁盘一致不漂移——不走
 * kcoder-skills-bundle RETIRED_PLUGINS 的纯 rm 路径，那会让 pnpm 图
 * 与磁盘漂移，后续 install 报错）。
 *
 * - dsh-vision-router（2026-08-30）：原生视觉优先，识图插件退役。
 * - dsh-better-sidebar（2026-09-01）：消费源切换自立包
 *   dsh-coding-sidebar（见 PRESET_PLUGINS），旧收编线整线退役——
 *   含历史 git+ssh 子目录引用形态的 deps 声明（值形态不限，摘键即
 *   清）。退役后衍生插件重装时其 peer `dsh-better-sidebar@^0.6.0`
 *   会从 npm 拉上游真包实体：该实体不进 bundles 层叠不会被加载
 *   （无双跑），仅作 peer 满足与类型来源。
 * - @tt-a1i/archify-dsh（2026-09-01）：架构图能力由自有插件
 *   dsh-super-ppts 覆盖（后续 dsh-animation 亦具备），第三方重复
 *   能力不再预置；纯技能包装，摘键即清无迁移。
 * - @dsh-external/dsh-drag-to-attachment（2026-09-01）：上游原生附件
 *   链已完备（粘贴图片随消息携带真实数据），插件的路径引用模式退役
 *   （详见文件头）；连带补丁链回收（RETIRED_PATCH_PKGS）与
 *   attach-picker.ts 拆除。
 * - dsh-context（2026-10-02）：上下文统计视图插件整线退役（详见文件
 *   头）；连带补丁链回收（RETIRED_PATCH_PKGS）与 context-button.ts
 *   拆除。用户 profile 若有自装同款亦被三清——退役意图是产品级不再
 *   提供该插件（重装请走插件管理页，三清只在下次启动再执行一遍）。
 * - dsh-coding-sidebar（2026-10-09）：本表**唯一**一条正式预置声明退役
 *   （预置表自此清空），右侧工作台交回上游原生右侧栏——铁律 1 翻转，
 *   见下方条目与 docs/ARCHITECTURE.md §12。
 */
const RETIRED_PRESETS = [
  // dsh-coding-sidebar 的历史两跳留档（本清单条目在下方）：2026-09-18 曾按
  // 「右侧栏回归原生」首次退役（D1a 决策翻转），09-19 因差异化功能（git 面板/
  // GitHub、Office·视频预览、QiLin 通道接管、任务计划）无原生替代而 un-retire；
  // **2026-10-09 由产品负责人再次拍板退役并落地**（本轮连铁律 1 一并翻转）。
  'dsh-vision-router',
  'dsh-better-sidebar',
  '@tt-a1i/archify-dsh',
  '@dsh-external/dsh-drag-to-attachment',
  'dsh-context',
  // @deepseek-ai/dsh-experimental-schedule-bundle（2026-10-04）：随 dsh
  // 0.2.1-alpha.1 退役——上游整包删除并改为 Web 内置（schedule/tool-schedule
  // 随 dsh-web-app 提供，无需选中）。**必须与本表上方正式声明的摘除同批**：
  // 只摘声明而不入本清单，老 profile 的 deps 声明、bundles 层叠声明与
  // node_modules 实体会原样留着，而引擎的 RETIRED_BUNDLES 只摘 bundles 行、
  // 不清 deps 与实体 ⇒ 停产包继续被安装（其 cordis.patch.yml 插入精确钉旧
  // 引擎的 dsh-schedule 行，60s 启动超时复发）。详见上方历史记录段。
  '@deepseek-ai/dsh-experimental-schedule-bundle',
  // dsh-file-review-kcoder（2026-10-04）：dsh-coding-sidebar 的衍生插件整线
  // 退役（宿主侧栏保留；依赖方向单向——侧栏不反向依赖它，见
  // kcoder-skills-bundle 的 RETIRED_PLUGINS 注释）。三清覆盖老 profile 的 deps
  // 声明、bundles 层叠声明与实体；用户自装同款同样被洗（产品级不再提供，
  // 同 dsh-context）。配套两处同批：上方正式声明段摘除 + product-policy 把
  // 原生 changed-files 尾卡恢复（本插件曾同时认领 produced 与 presented 两张
  // 脸，不恢复则带 changes 公告的回合行与 present 交付卡一起消失）。
  'dsh-file-review-kcoder',
  // dsh-coding-sidebar（2026-10-09）：右侧工作台交回**上游原生右侧栏**
  // （上游新版的 files / documentpreview / terminal / browser tab 已覆盖产品
  // 所需能力），产品负责人拍板翻转「铁律 1」（docs/ARCHITECTURE.md §12）。
  // 退役面比 file-review 宽——除本清单的 deps 三清外，宿主侧铁律执行族同批
  // 拆除：style-overlay 的 NATIVE_SIDEBAR_CSS 压制、sidebar-toggle 的第三轨
  // 归零、sidebar-cluster 代理（整模块）、panel-buttons 的让位项、product-policy
  // 的原生终端 tab 禁用行；四名单（electron-builder extraResources /
  // sync-bundles 映射 / remote-server PROFILE_BUNDLES / remote-connections
  // REMOTE_BUNDLES）与 kcoder-skills-bundle 的 RETIRED_PLUGINS 同批。真源仓
  // kkutysllb/dsh-coding-sidebar 与 npm 包保留（它同时是 QiLin 的第一方内置
  // 工作台），用户自装同款同样被本清单三清（产品级不再提供）。
  'dsh-coding-sidebar',
]

/** 上游 web 模板的 bundles 前缀（预写骨架时对齐官方层叠顺序）。 */
const TEMPLATE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']

/** 对齐上游 initProfile 的 pnpm-workspace.yaml（nodeLinker 锚点依赖它）。 */
const PROFILE_PNPM_WORKSPACE = `packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false
`

/** 对齐上游 initProfile 的 cordis.patch.yml（空用户补丁层）。 */
const PROFILE_PATCH_TEMPLATE = `# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; \`!!js\` expressions allowed).
[]
`

/** 读取 JSON；失败返回 null（调用方决定重建）。 */
function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * 幂等放开 pnpm 构建脚本门（dangerouslyAllowAllBuilds: true）。
 * 白名单逐包收编路线已证伪：pnpm 11 对 git 源要求带 commit hash
 * 的完整 id key，插件每次更新换 hash 即失效，且插件生态随时带进新
 * 构建型依赖（esbuild/protobufjs/ssh2/cpu-features 四连撞门，
 * 2026-08-25 实证穷举不彻底）；pnpm 失败时还会在 yaml 留
 * "set this to true or false" 占位键污染现场。放行一切构建脚本
 * 等同 npm/yarn 十几年的默认行为（pnpm 10 才收紧），信任边界前移到
 * 插件市场点安装那一刻的用户决策。已放行则不动；键在但非 true
 * （用户/上游显式收紧）尊重不覆盖。须在 pnpm install 前就位，
 * 否则首装后需重装才生效。
 */
function ensurePnpmBuildsAllowed(workspacePath: string): void {
  try {
    if (!existsSync(workspacePath)) return
    let yaml = readFileSync(workspacePath, 'utf8')
    if (!yaml.endsWith('\n')) yaml += '\n'
    if (/^dangerouslyAllowAllBuilds:[ \t]*true[ \t]*(?:#.*)?$/m.test(yaml)) return
    if (/^dangerouslyAllowAllBuilds:/m.test(yaml)) {
      healLog('[preset] dangerouslyAllowAllBuilds 非 true（显式收紧），尊重不覆盖')
      return
    }
    yaml += 'dangerouslyAllowAllBuilds: true\n'
    writeFileSync(workspacePath, yaml)
    console.log('[preset-plugins] 已写 dangerouslyAllowAllBuilds: true（构建门放开）')
    healLog('[preset] 已写 dangerouslyAllowAllBuilds: true（构建门放开）')
  } catch (error) {
    console.error('[preset-plugins] 构建门配置失败:', error)
    healLog(`[preset] 构建门配置异常：${String(error)}`)
  }
}

/**
 * 已退役（2026-10-09）：本模块曾在此维护一段「coding-sidebar 标题栏避让」的
 * profile patch 补写（`titleBarCompat` / `titleBarStripPx` 两键，行 id
 * `better-sidebar`，另回收早期按包名寻址的死行）。它随 dsh-coding-sidebar
 * 整线退役而删除——避让是给插件面板顶部让位 KCoder 自绘状态栏用的；插件没了，
 * 那条 patch 行也随退役三清摘除（引擎对不存在的行只打一行 not found 警告，
 * 不报错、不阻塞启动）。
 *
 * 留档的两条通用教训（后续再写 profile 补丁层时复用）：
 * - **行 id ≠ 包名**：补丁行按 `id` 寻址，而 bundle 的 cordis.patch.yml 插的是
 *   `id: better-sidebar` / `name: dsh-coding-sidebar`；按包名写会指向一个不存在
 *   的行，引擎只打一行 `patch: entry "..." not found` 就跳过，写在里面的 config
 *   永远不生效（2026-09-24 现场：mac 新装用户因此缺标题栏避让）。
 * - **写用户 profile 补丁层要带形状判据**：只回收自己写下的形状（键仅 id /
 *   config，且 config 键不超出已知集合），用户手写的同名行不动。
 */

/** profile package.json 的 dsh.profile.bundles（缺失段视为空数组）。 */
function bundlesOf(manifest: Record<string, unknown>): string[] {
  const dsh = manifest['dsh'] as { profile?: { bundles?: unknown } } | undefined
  const list = dsh?.profile?.bundles
  return Array.isArray(list) ? (list as string[]) : []
}

/**
 * spec/版本共用的 semver 三元组提取：`^0.38.5`/`0.1.0`/`github:…#v1.0.3`
 * （tag 版本）→ [0,38,5]/[1,0,3]；link: 等无版本形态 → null。预置 spec
 * 与实装版本同一解析，漂移对账口径一致。
 */
function specMinVer(spec: string): [number, number, number] | null {
  const m = /[~^]?(\d+)\.(\d+)\.(\d+)/.exec(spec)
  return m === null ? null : [Number(m[1]), Number(m[2]), Number(m[3])]
}

/** 三元组序比较：a<b → -1，a=b → 0，a>b → 1。 */
function cmpVer(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
  }
  return 0
}

/** node_modules 实体的 version（缺失/损坏返回 null）。 */
function installedVersionOf(profileDir: string, name: string): string | null {
  try {
    const pkg = JSON.parse(
      readFileSync(join(profileDir, 'node_modules', name, 'package.json'), 'utf8'),
    ) as { version?: unknown }
    return typeof pkg.version === 'string' ? pkg.version : null
  } catch {
    return null
  }
}

/**
 * 幂等物化 + 注册（dsh 启动前调用）。任何失败只记日志不抛——预置插件
 * 缺席时 dsh 裸起仍可用，下次启动幂等重试。
 */
export function ensurePresetPlugins(): void {
  try {
    const profileDir = join(dshHome(), 'profiles', WEB_PROFILE)
    const manifestPath = join(profileDir, 'package.json')
    const workspacePath = join(profileDir, 'pnpm-workspace.yaml')
    const patchLayerPath = join(profileDir, 'cordis.patch.yml')
    const installed = (p: string): boolean => existsSync(join(profileDir, 'node_modules', p))
    // 安装语义：插件 + 运行时依赖都必须装进 profile（deps 声明）。
    const managedNames = Object.keys(MANAGED_PROFILE_DEPS)
    // 层叠语义：只有真插件能进 `dsh.profile.bundles`——那是补丁层清单，
    // 运行时依赖没有 dsh.bundle.patch，塞进去就是让 loader 加载一个空层。
    const presetNames = Object.keys(PRESET_PLUGINS)

    // 1) 骨架：清单不存在 → 预写完整模板（上游 initProfile 只在缺失时写，
    //    预写不会被模板覆盖）。bundles 只含模板内置层——预置插件的声明
    //    严格后置于安装成功（见第 4 步对账，防“声明了但没装上”让 dsh 崩）
    let manifest = readJson(manifestPath)
    const fresh = manifest === null
    if (fresh) {
      mkdirSync(profileDir, { recursive: true })
      manifest = {
        name: `dsh-profile-${WEB_PROFILE}`,
        private: true,
        dependencies: { ...MANAGED_PROFILE_DEPS },
        dsh: { profile: { bundles: [...TEMPLATE_BUNDLES] } },
      }
      writeFileSync(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`)
      if (!existsSync(workspacePath)) writeFileSync(workspacePath, PROFILE_PNPM_WORKSPACE)
      if (!existsSync(patchLayerPath)) writeFileSync(patchLayerPath, PROFILE_PATCH_TEMPLATE)
      console.log('[preset-plugins] 预写 profile 骨架并预置插件清单')
      healLog('[preset] 预写 profile 骨架并预置插件清单')
    }
    // 骨架分支已重建清单，此后 manifest 必非 null
    const m = manifest as Record<string, unknown>

    // 1.5) 非 fresh 但 pnpm-workspace.yaml 丢失（手动清理/部分删除的
    //      非常规态）：幂等补写上游同款模板。不补则三处连锁卡死——
    //      ensureProfilePatches 以它判 profile 已初始化（早退连锄点
    //      兜底都跳过，2026-08-20 实测现场）、ensureProfilePeerRules
    //      同判、ensurePnpmBuildsAllowed 同判；且丢失态下 pnpm 按
    //      默认 symlink 布局安装，偏离上游 hoisted 模板。上游
    //      initProfile 本就是缺失才补的同款幂等设计，此处对非 fresh
    //      路径补齐同一行为
    if (!fresh && !existsSync(workspacePath)) {
      writeFileSync(workspacePath, PROFILE_PNPM_WORKSPACE)
      console.log('[preset-plugins] pnpm-workspace.yaml 丢失，已补写上游同款模板')
      healLog('[preset] pnpm-workspace.yaml 丢失，已补写上游同款模板')
    }

    // 1.8) 退役预置清理（幂等，先于补写/对账）：老 profile 里已装的
    //      退役包三处摘除——dependencies 声明（不摘则 pnpm install 反复
    //      重装）、bundles 声明（dsh 唯一消费口，不摘则 loader 继续加
    //      载）、node_modules 实体（hoisted 顶层真目录，删除断解析）。
    //      对照 kcoder-skills-bundle 的 RETIRED_PLUGINS 模式
    //
    //      ⚠️ 收敛安装（2026-10-04 dev 现场）：上述摘除只改 manifest 与磁盘，
    //      **改不动 pnpm 图**——lock 里退役包及其**传递依赖**原样留着（hoisted
    //      顶层实体删了，下一次 install 还会按 lock 装回来）。而新版 web-app
    //      组合的 `@deepseek-ai/dsh-schedule` 行是**无版本解析**，会命中残留的
    //      rc.2 实体 ⇒ 引擎启动逐行 `disabling profile plugin row`（实测 5 条：
    //      schedule ×2 + time-context ×3，任务计划等于关闭）。故清理一旦命中
    //      即置位，强制第 3 步走一次 pnpm 收敛——本清单文档头「摘 deps + 删
    //      实体后由 pnpm install 重放按新依赖图收敛」正是这个意思。
    let retiredTouched = false
    const preBundles = bundlesOf(m)
    const keptBundles = preBundles.filter((p) => !RETIRED_PRESETS.includes(p))
    const depsMap = (m['dependencies'] ?? {}) as Record<string, unknown>
    // 退役预置 + 迁回随引擎分发的 provider：两者在 profile 侧的残留（依赖声明、
    // node_modules 实体）都要清；provider 的实体不清会遮蔽随包版本（见
    // RUNTIME_PROVIDED_PACKAGES）。
    const removedDeps = [...RETIRED_PRESETS, ...RUNTIME_PROVIDED_PACKAGES].filter((r) => r in depsMap)
    if (keptBundles.length !== preBundles.length || removedDeps.length > 0) {
      if (keptBundles.length !== preBundles.length) {
        const dshSec = (m['dsh'] ?? {}) as { profile?: Record<string, unknown> }
        const profileSec = (dshSec.profile ?? {}) as Record<string, unknown>
        m['dsh'] = { ...dshSec, profile: { ...profileSec, bundles: keptBundles } }
      }
      if (removedDeps.length > 0) {
        for (const r of removedDeps) delete depsMap[r]
        m['dependencies'] = depsMap
      }
      writeFileSync(manifestPath, `${JSON.stringify(m, undefined, 2)}\n`)
      retiredTouched = true
      const cleaned = [...new Set([...removedDeps, ...preBundles.filter((p) => RETIRED_PRESETS.includes(p))])]
      console.log(`[preset-plugins] 退役/迁移声明已清理: ${cleaned.join(', ')}`)
      healLog(`[preset] 退役/迁移声明已清理: ${cleaned.join(', ')}`)
    }
    for (const r of [...RETIRED_PRESETS, ...RUNTIME_PROVIDED_PACKAGES]) {
      const dir = join(profileDir, 'node_modules', r)
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true })
        retiredTouched = true
        console.log(`[preset-plugins] 已删除退役/迁移包实体: ${r}`)
        healLog(`[preset] 已删除退役/迁移包实体: ${r}`)
      }
      // @scope/name 形态：包删除后空 scope 壳目录一并清（pnpm 图收敛
      // 不管空壳，残留会误导排查）
      if (r.includes('/')) {
        const scopeDir = join(profileDir, 'node_modules', r.split('/')[0])
        try {
          if (existsSync(scopeDir) && readdirSync(scopeDir).length === 0) {
            rmSync(scopeDir, { recursive: true, force: true })
            console.log(`[preset-plugins] 已清理空 scope 目录: ${r.split('/')[0]}`)
            healLog(`[preset] 已清理空 scope 目录: ${r.split('/')[0]}`)
          }
        } catch { /* 目录并发变动时跳过，下次幂等重试 */ }
      }
    }

    // 2) 补写 dependencies 缺项（可先行——dsh 不查 dependencies，
    //    只查 bundles 层叠解析）
    const deps = (m['dependencies'] as Record<string, unknown> | undefined) ?? ({} as Record<string, unknown>)
    const missingDeps = managedNames.filter((p) => !(p in deps))
    if (missingDeps.length > 0) {
      for (const p of missingDeps) deps[p] = MANAGED_PROFILE_DEPS[p]
      m['dependencies'] = deps
      writeFileSync(manifestPath, `${JSON.stringify(m, undefined, 2)}\n`)
      console.log(`[preset-plugins] 已补写依赖声明: ${missingDeps.join(', ')}`)
      healLog(`[preset] 已补写依赖声明: ${missingDeps.join(', ')}`)
    }

    // 2.5) spec 漂移对账（只升不降）：实体版本低于预置 spec 下界时，
    //      改写 deps spec 为预置值并摘除旧实体，交第 3 步重装。这是
    //      「预置 spec 升级推不到已装用户」的机制补丁——0.4.9 实证：
    //      alpha.2 引擎移除 dsh-settings 的 settingsNamespace 导出，
    //      升级用户 profile 里的 dsh-context 0.37.x 仍 import 该导出，
    //      启动即 SyntaxError 全局崩。实体版本满足下界则不动（用户
    //      update --latest 升线、mac git 源收编 0.17.2 均不被降级覆写）。
    //      精确钉（无 ^/~ 前缀）额外按**版本字符串全等**判过旧：三元组
    //      比较看不见预发布标签（0.2.0-rc.1 与 0.2.0-rc.2 同为 [0,2,0]），
    //      调度家族/SSH 这类「必须与引擎逐版本同线」的精确钉若只看
    //      三元组，rc.1→rc.2 升级现场会留下混装（引擎 rc.2 + 调度 rc.1
    //      → peer 闸门禁行 + 启动卡死，2026-09-30 实证，见
    //      docs/upstream-0.2.0-rc.2-analysis.md §5）。
    for (const p of managedNames) {
      const spec = MANAGED_PROFILE_DEPS[p]
      const min = specMinVer(spec)
      if (min === null) continue
      const installedVer = installedVersionOf(profileDir, p)
      const cur = specMinVer(installedVer ?? '')
      const entityDir = join(profileDir, 'node_modules', p)
      const exactPin = !/^[~^]/.test(spec)
      const staleEntity = existsSync(entityDir)
        && (cur === null || cmpVer(cur, min) < 0 || (exactPin && installedVer !== spec))
      if (!staleEntity && cur !== null) continue
      if (deps[p] !== MANAGED_PROFILE_DEPS[p]) {
        deps[p] = MANAGED_PROFILE_DEPS[p]
        writeFileSync(manifestPath, `${JSON.stringify(m, undefined, 2)}\n`)
        console.log(`[preset-plugins] 预置 spec 已对齐: ${p} → ${MANAGED_PROFILE_DEPS[p]}`)
        healLog(`[preset] 预置 spec 已对齐: ${p} → ${MANAGED_PROFILE_DEPS[p]}`)
      }
      if (staleEntity) {
        rmSync(entityDir, { recursive: true, force: true })
        console.log(`[preset-plugins] 已摘除过旧实体（版本低于预置下界）: ${p}`)
        healLog(`[preset] 已摘除过旧实体（版本低于预置下界）: ${p}`)
      }
    }

    // 3) 安装：任何预置包缺席 → pnpm install（先确保 patch 声明与
    //    原生模块构建许可就位——name-only 补丁在安装时自动应用，
    //    构建许可不在 install 前写入则首装后需重装才生效）。含幽灵态
    //    自愈：旧版本声明了 bundles 但装包失败，这里重装后由第 4 步
    //    对账落地声明。install 成功后二调 ensureProfilePatches：补丁
    //    未生效时（如 v0.1.9 Windows CRLF patch 现场）重装应用 + 锄点
    //    注入兑底。退役/迁移清理命中时（第 1.8 步置位 retiredTouched）同样
    //    强制一次：只有 pnpm 重放能让**声明之外的**传递依赖与 lock 收敛。
    const needInstall = retiredTouched || presetNames.some((p) => !installed(p))
    ensurePnpmBuildsAllowed(workspacePath)
    if (needInstall) {
      ensureProfilePatches()
      console.log('[preset-plugins] 预置插件缺失，执行 pnpm install …')
      healLog(`[preset] 预置插件缺失（${presetNames.filter((p) => !installed(p)).join(', ')}），执行 pnpm install …`)
      const r = runPnpm(['install'], profileDir, 600_000)
      healLog(
        `[preset] pnpm install exit=${String(r.status)}` +
          (r.status !== 0 ? ` stderr=${(r.stderr ?? '').slice(0, 800)}` : ''),
      )
      if (r.status !== 0) {
        console.error('[preset-plugins] pnpm install 失败（下次启动重试）:', r.stderr?.slice(0, 2000) ?? r.error)
      } else {
        ensureProfilePatches()
      }
    } else {
      healLog('[preset] 预置插件均已安装')
    }

    // 4) bundles 声明对账（dsh 启动的唯一消费口）：已装未声明 → 补
    //    （锚点 dsh-web-app / dsh-skills-bundle 之后，与 mac 开发机
    //    层叠一致）；已声明未装（install 失败/半装）→ 摘除，防 dsh 启动
    //    崩溃，下次启动重试重装
    const bundles = bundlesOf(m)
    const ghost = presetNames.filter((p) => bundles.includes(p) && !installed(p))
    const undeclared = presetNames.filter((p) => !bundles.includes(p) && installed(p))
    // 污染自愈：provider 包曾被错当插件写进层叠（2026-09-26 首版内置化的缺陷：
    // 它们既不该进层叠，2026-09-30 起也不再进 deps）。不摘除则 loader 每轮都
    // 尝试把 provider 当补丁层加载。
    const polluted = RUNTIME_PROVIDED_PACKAGES.filter((p) => bundles.includes(p))
    if (ghost.length > 0 || undeclared.length > 0 || polluted.length > 0) {
      const kept = bundles.filter((p) => !ghost.includes(p) && !polluted.includes(p))
      let anchor = kept.indexOf('dsh-skills-bundle')
      if (anchor === -1) anchor = kept.indexOf(TEMPLATE_BUNDLES[1])
      let offset = 0
      for (const p of undeclared) {
        kept.splice(anchor + 1 + offset, 0, p)
        offset += 1
      }
      const dsh = (m['dsh'] ?? {}) as { profile?: Record<string, unknown> }
      const profile = (dsh.profile ?? {}) as Record<string, unknown>
      m['dsh'] = { ...dsh, profile: { ...profile, bundles: kept } }
      writeFileSync(manifestPath, `${JSON.stringify(m, undefined, 2)}\n`)
      console.log(
        `[preset-plugins] bundles 对账（补声明: ${undeclared.join(', ') || '无'}，摘除未装: ${ghost.join(', ') || '无'}，摘除非插件依赖: ${polluted.join(', ') || '无'}）`,
      )
      healLog(
        `[preset] bundles 对账（补声明: ${undeclared.join(', ') || '无'}，摘除未装: ${ghost.join(', ') || '无'}，摘除非插件依赖: ${polluted.join(', ') || '无'}）`,
      )
    }
  } catch (error) {
    console.error('[preset-plugins] 物化失败:', error)
    healLog(`[preset] 物化异常：${String(error)}`)
  }
}
