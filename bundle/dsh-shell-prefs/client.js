/**
 * dsh-shell-prefs — client 半：把上游 locale / theme 两个服务暴露给桌面壳。
 *
 * ## 为什么需要它
 *
 * KCoder 的账号菜单是**桌面壳注入**的自绘 DOM（desktop/main/account-chip.ts），
 * 它要让「语言 / 主题」菜单项真正切到上游偏好。但注入脚本跑在页面里，而上游
 * **没有任何 window 级服务桥**——脚本够不到 ctx.locale.setLocale 与
 * ctx.theme.setTheme。此前几轮的做法是"打开设置面板 → 模拟点击通用区控件"，
 * 每一步都在猜锚点（行标题被产品注入的「回答语言」抢中、命中却静默失败），
 * 脆弱且难排查。
 *
 * 本插件就是那座桥：它是真正的 client 插件，能直接注入上游服务，于是
 * **偏好写入走上游唯一入口**（与设置页里点的是同一条路径），不存在第二条
 * 事实源，也不需要模拟点击。
 *
 * ## 模块形态（实测踩过两次）
 *
 * 外置 bundle 的 client 交付物走 `window.__ModuleLoader__.load({ id, factory })`
 * 协议（与内置 @kkutysllb/dsh-terminal/client.js 同款）：工厂返回 exports，
 * 加载器读 `exports.inject` / `exports.apply`。
 * - 顶层 ESM `export` → 加载器不认；
 * - 裸 CommonJS → 顶层标识符与其它 client 模块相撞（实测报
 *   "Identifier 'name' has already been declared"，整个 client 装配失败）。
 * 因此所有实现都收在 factory 作用域内，只经 exports 暴露两个字段。
 *
 * ## 桥的形态
 *
 * window.__kcoderShellPrefs 上一个收窄接口：
 *   getLocale() / setLocale(id) / subscribeLocale(fn)
 *   getTheme() / setTheme(id) / subscribeTheme(fn)
 *
 * 为什么用 window 全局：注入脚本与 client 插件同在页面同一 realm，但两者之间
 * 没有上游提供的公共通道；桌面壳已有同类先例（window.__dshStyleSync、
 * window.__dshHomeMigration、window.__dshThemeSync）。接口刻意不泄露 ctx 本体。
 *
 * ## 上游契约（0.1.6-alpha.2 实测）
 *
 * - locale：getSnapshot() → { active, locales: [{id,label}] }、subscribe(fn)、
 *   setLocale(id)；
 * - theme：getSnapshot() → { preference, themes }、subscribe(fn)、setTheme(id)，
 *   id 取 'system' | 'light' | 'dark'。
 *
 * 任一侧服务缺席（该部署未启用对应插件）→ 对应方法返回 null / false / 空订阅，
 * 菜单据此降级提示，不抛错、不影响启动。
 *
 * @module dsh-shell-prefs/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-shell-prefs',
  factory: () => {
    const exports = {}

    /** 需要注入的两个服务（提供方为本部署内的上游插件）。 */
    exports.inject = ['locale', 'theme']

    /** 账号菜单读取的全局句柄名（桌面壳注入脚本侧同名字面量）。 */
    const BRIDGE = '__kcoderShellPrefs'

    /**
     * 读取服务当前快照；任何异常都降级为 null（服务未就绪 / 契约变化时菜单
     * 只是显示不出当前值，不该把插件激活拖挂）。
     * @param service - 上游服务对象。
     * @param pick - 从快照里取需要的那部分。
     * @returns 取到的值，或 null。
     */
    const snapshotOf = (service, pick, method) => {
      try {
        if (service === undefined || service === null) return null
        const read = service[method === undefined ? 'getSnapshot' : method]
        if (typeof read !== 'function') return null
        const snapshot = read.call(service)
        if (snapshot === undefined || snapshot === null) return null
        return pick(snapshot)
      } catch {
        return null
      }
    }

    /**
     * 订阅服务变化；服务缺席或契约变化时退化为空订阅。
     * @param service - 上游服务对象。
     * @param listener - 回调（无参）。
     * @returns 取消订阅函数（始终可调用）。
     */
    const subscribe = (service, listener) => {
      try {
        if (service === undefined || service === null || typeof service.subscribe !== 'function') return () => {}
        const off = service.subscribe(listener)
        return typeof off === 'function' ? off : () => {}
      } catch {
        return () => {}
      }
    }

    /**
     * Client 插件体：发布窄接口，写入一律转发到上游服务。
     * @param ctx - client cordis 上下文。
     */
    exports.apply = function apply(ctx) {
      if (window.__kcoderShellPrefsWired) return
      window.__kcoderShellPrefsWired = true

      const locale = ctx.locale
      const theme = ctx.theme

      /** 当前语言：{ id, label, options }；服务缺席时 null。 */
      const getLocale = () => {
        const snap = snapshotOf(locale, (s) => ({
          active: s.active,
          locales: Array.isArray(s.locales) ? s.locales : [],
        }))
        if (snap === null) return null
        const options = snap.locales
          .filter((l) => l !== null && typeof l === 'object')
          .map((l) => ({ id: String(l.id), label: String(l.label) }))
        const active = String(snap.active)
        const hit = options.find((o) => o.id === active)
        return { id: active, label: hit === undefined ? active : hit.label, options }
      }

      /** 切换语言（转发上游唯一写入口）；上游拒绝未知 id 时 false。 */
      const setLocale = (id) => {
        if (locale === undefined || locale === null || typeof locale.setLocale !== 'function') return false
        try {
          locale.setLocale(id)
          return true
        } catch {
          return false
        }
      }

      /**
       * 当前主题偏好档：{ id, options }；服务缺席时 null。
       *
       * 注意两面服务的读法**不同名**（实测）：locale 是 getSnapshot()，
       * theme 是 getTheme()。两者都返回同形状快照（preference + 注册表）。
       */
      const getTheme = () => {
        const snap = snapshotOf(theme, (s) => ({
          preference: s.preference,
          themes: Array.isArray(s.themes) ? s.themes : [],
        }), 'getTheme')
        if (snap === null) return null
        const options = snap.themes
          .filter((t) => t !== null && typeof t === 'object')
          .map((t) => ({ id: String(t.id), label: String(t.label === undefined ? t.id : t.label) }))
        return { id: String(snap.preference), options }
      }

      /** 切换主题（转发上游唯一写入口）。 */
      const setTheme = (id) => {
        if (theme === undefined || theme === null || typeof theme.setTheme !== 'function') return false
        try {
          theme.setTheme(id)
          return true
        } catch {
          return false
        }
      }

      window[BRIDGE] = {
        getLocale,
        setLocale,
        subscribeLocale: (fn) => subscribe(locale, fn),
        getTheme,
        setTheme,
        subscribeTheme: (fn) => subscribe(theme, fn),
      }

      /* ---- 卸载收口（运行时停用/HMR：撤桥 + Wired 守卫复位以便重挂载）。
       * 桥闭包引用本 fiber 的 ctx.locale/ctx.theme，旧桥残留会让桌面壳
       * 调到已 dispose 的服务实例；重挂载守卫不复位则新 apply 直接
       * early-return，桥永远指向旧 mount。订阅退订由持有方（注入脚本）
       * 调用 off，桥撤下后新订阅自然不再受理。 ---- */
      const teardown = () => {
        delete window[BRIDGE]
        delete window.__kcoderShellPrefsWired
      }
      if (typeof ctx.effect === 'function') {
        // client-modules 工厂 ctx：停用/热替换时随 fiber 调用 disposer。
        ctx.effect(() => teardown, 'dsh-shell-prefs: shell prefs bridge')
      }
    }

    return exports
  },
})
