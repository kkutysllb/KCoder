/**
 * dsh-shell-prefs — host 半：本 bundle 在本部署里**没有 host 侧能力**。
 *
 * 这个文件只为一件事存在：bundle 要被 profile 加载并让 dsh 认识它，
 * 需要 package.json 的 `main` 可解析（与 dsh-terminal / dsh-skills-bundle
 * 同款 out-of-tree bundle 形态）。真正干活的是 client 半
 * （exports["./client"] → client.js），它由 dsh client-modules 自动集成到
 * shell 页面，在那里注入上游 locale / theme 服务并把窄接口发布到
 * `window.__kcoderShellPrefs`。
 *
 * 宿主侧刻意**不注册任何行 / RPC / 服务**：偏好写入必须走上游唯一入口
 * （client 侧的 ctx.locale / ctx.theme），在这里重做一套只会造出第二条
 * 事实源——那正是本插件要消灭的东西。
 *
 * @module dsh-shell-prefs
 */

/** Stable Cordis plugin name（与 cordis.patch.yml 的行 id 对齐）。 */
export const name = 'kcoder-shell-prefs'

/**
 * 宿主侧激活：无操作。
 *
 * 保留为空实现而非删除插件，是因为 cordis.patch.yml 需要一个可加载的行；
 * 去掉该行则 bundle 仍会注册（dsh.profile.bundles），但 dsh 是否继续为其
 * 加载 client 半未经验证——保持与本仓另两个 bundle 同构最稳。
 */
export function apply() {}
