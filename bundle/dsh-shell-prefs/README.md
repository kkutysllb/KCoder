# dsh-shell-prefs

KCoder 内置 dsh bundle：把本部署的 **locale** 与 **theme** 两个 client 服务，
以窄接口（get / set / subscribe）暴露给桌面壳注入的账号菜单。

## 解决什么问题

KCoder 的账号菜单是**桌面壳注入的自绘 DOM**（`desktop/main/account-chip.ts`），
它要让「语言 / 主题」菜单项真正切到上游偏好。但注入脚本跑在页面里，而上游
**没有 window 级服务桥**——脚本触达不到 `ctx.locale.setLocale` 与
`ctx.theme.setTheme`。

早前的做法是"打开设置面板 → 模拟点击通用区控件"，于是每一步都在猜锚点，
并真实踩中过：行标题被产品自己注入的「回答语言」抢中（`indexOf('语言')` 命中
`回答语言`）、菜单项点错控件却返回成功、设置面板结构变动即静默失效。

本 bundle 的 client 半直接在 client 插件上下文里 `inject: ['locale', 'theme']`，
因此偏好写入走上游**唯一入口**——与用户在设置页里点的是同一条路径。不存在
第二条事实源，也不需要模拟点击。

## 形态

与 `dsh-terminal` 同构的 out-of-tree bundle（`type: module`，零构建步骤）：

| 文件 | 作用 |
|---|---|
| `package.json` | `dsh.bundle.patch` 指向本层补丁；`dsh.client.{inject,platform}` 声明 client 半 |
| `cordis.patch.yml` | 注册 `kcoder-shell-prefs` 行（宿主侧空壳） |
| `entry.js` | 宿主侧 `apply()` 无操作（本 bundle 没有 host 能力，留壳以保持 bundle 形态） |
| `client.js` | **真正的交付**：CommonJS `exports.apply`，注入服务并发布桥 |

桥发布在 `window.__kcoderShellPrefs`：

```js
getLocale()  // → { id, label, options: [{id,label}] } | null
setLocale(id) // → boolean（转发上游唯一写入口）
subscribeLocale(fn) // → off()
getTheme()   // → { id, options: [{id,label}] } | null
setTheme(id)  // → boolean
subscribeTheme(fn)  // → off()
```

> 为什么用 window 全局：注入脚本与 client 插件同在页面同一 realm，但它们之间
> 没有上游提供的公共通道；桌面壳此前已有同类先例（`window.__dshStyleSync`、
> `window.__dshHomeMigration`、`window.__dshThemeSync`）。接口刻意收窄成
> get/set/subscribe，不泄露 ctx 本体；插件卸载时撤桥。

## 降级行为

任一侧服务缺席（该部署未启用对应插件）或上游契约变化时：对应方法返回
`null` / `false` / 空订阅，菜单项显示"桥不可用"提示，**不抛错、不影响启动**。
