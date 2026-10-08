/**
 * dsh-skills-bundle Web Client Extension（可选技能设置分区）。
 *
 * BUILD NOTE: 与 dsh-animations / dsh-super-ppts 同款 HAND-MAINTAINED
 * 形态：必须经 `window.__ModuleLoader__.load({ id, factory })` 自注册、
 * 经 `exports.apply` 暴露扩展并 `return module.exports`；裸 ESM `export`
 * 不会注册，触发 "bundle .../client.js loaded without registering" 错误。
 *
 * 设置页「可选技能」分区（settings.section 插槽，QiLin 设置壳的 nav 行
 * 由 winner cells 投影，见 ui-settings-general）：
 * - 数据面走宿主插件自挂的 fenced JSON API（/kcoder-skills/api，Host
 *   回环信任边界，与 /api 网关同款）——DSH/QiLin 的 settings RPC 不服务
 *   第三方命名空间（KCoder dsh-coding-sidebar 同款结论），所以开关读写
 *   走插件自有路由而非 settings 远程；
 * - GET catalog 列 core + optional 两批与启用态；POST set-enabled 提交
 *   新启用集，宿主就地重注册（dispose 旧 optional → 注册新集合），即时
 *   生效、持久化在 $QILIN_HOME/kcoder-skills.json（0600）；
 * - 软探测：宿主无 settings.section 插槽或 slots 服务缺位时静默跳过
 *   （console 诊断），宿主侧技能注册不受影响。
 *
 * inject 声明（exports.inject）是 cordis 服务名；package.json →
 * dsh.client.inject 声明对应引擎包（信息性装载边），两处缺一即抛
 * "cannot get property ... without inject"。
 */
	window.__ModuleLoader__.load({
	id: "dsh-skills-bundle",
	factory: function (require) {
		var module = { exports: {} };
		var exports = module.exports;
		var React = require("react");

		var NS = "kcoderSkills";
		var SECTION_ID = "kcoder-optional-skills";

		/* ── 双语文案（zh / en）──────────────────────────────── */

		var zh = {
			nav: "可选技能",
			title: "可选技能",
			intro: "随包分发的长尾技能批，默认不注册——打开开关即对当前引擎的所有会话生效（模型可按 description 匹配加载，或 /技能名 显式调用）。选择持久化在本机 QILIN_HOME。",
			coreTitle: "核心技能",
			coreIntro: "随插件激活即注册，不可关闭。",
			optionalTitle: "长尾技能",
			coreBadge: "核心",
			countSuffix: "项已启用",
			loading: "技能目录加载中…",
			loadFailed: "技能目录加载失败：请确认引擎已启动后重试。",
			retry: "重试",
			saving: "保存中…",
			saveFailed: "保存失败：已回退开关，请稍后重试。",
		};
		var en = {
			nav: "Optional Skills",
			title: "Optional Skills",
			intro: "Long-tail skill packs shipped with the bundle but not registered by default — flip a switch to expose it to every session on this engine (model-matched by description, or invoked as /name). Choices persist in the local QILIN_HOME.",
			coreTitle: "Core skills",
			coreIntro: "Registered on plugin activation; always on.",
			optionalTitle: "Long-tail skills",
			coreBadge: "core",
			countSuffix: "enabled",
			loading: "Loading skill catalog…",
			loadFailed: "Failed to load the skill catalog: make sure the engine is running, then retry.",
			retry: "Retry",
			saving: "Saving…",
			saveFailed: "Failed to save: the switch was reverted, please retry shortly.",
		};

		function t(key) {
			var lang = typeof navigator !== "undefined" && navigator.language && navigator.language.toLowerCase().indexOf("zh") === 0 ? zh : en;
			return lang[key] || key;
		}

		/* ── 样式（作用域前缀 kcs-，随插件 fiber 卸载移除）──────── */

		function ensureStyles() {
			if (document.getElementById("kcs-styles") !== null) return null;
			var style = document.createElement("style");
			style.id = "kcs-styles";
			style.textContent = [
				".kcs-intro{margin:0 0 18px;font-size:13px;line-height:1.7;opacity:.66;max-width:64em}",
				".kcs-group{margin:0 0 22px}",
				".kcs-group-title{margin:0 0 4px;font-size:15px;font-weight:600}",
				".kcs-group-intro{margin:0 0 12px;font-size:12px;opacity:.55}",
				".kcs-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px}",
				".kcs-card{display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border-radius:12px;border:1px solid color-mix(in srgb,currentColor 12%,transparent);background:transparent;text-align:left;cursor:pointer;font:inherit;color:inherit;transition:border-color .12s ease,background .12s ease}",
				".kcs-card:hover{border-color:color-mix(in srgb,currentColor 26%,transparent)}",
				".kcs-card[data-on=true]{border-color:color-mix(in srgb,currentColor 42%,transparent);background:color-mix(in srgb,currentColor 7%,transparent)}",
				".kcs-card-body{flex:1;min-width:0}",
				".kcs-card-name{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}",
				".kcs-badge{flex:none;font-size:10px;font-weight:500;padding:1px 7px;border-radius:99px;background:color-mix(in srgb,currentColor 12%,transparent);font-family:inherit}",
				".kcs-card-desc{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;margin-top:4px;font-size:12px;line-height:1.6;opacity:.72}",
				".kcs-switch{flex:none;margin-top:2px;width:34px;height:20px;border-radius:99px;border:none;padding:0;position:relative;cursor:pointer;background:color-mix(in srgb,currentColor 18%,transparent);transition:background .15s ease}",
				".kcs-switch::after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .15s ease}",
				".kcs-switch[data-on=true]{background:var(--qilin-specific-brand-seal-fill,#B7352C)}",
				".kcs-switch[data-on=true]::after{transform:translateX(14px)}",
				".kcs-state{margin:0 0 14px;font-size:12px;opacity:.6}",
				".kcs-state[data-kind=error]{color:var(--qilin-specific-brand-seal-fill,#B7352C);opacity:1}",
				".kcs-retry{border:1px solid color-mix(in srgb,currentColor 24%,transparent);background:transparent;color:inherit;border-radius:8px;padding:4px 14px;font-size:12px;cursor:pointer;font-family:inherit}",
			].join("\n");
			document.head.append(style);
			return function () { style.remove(); };
		}

		/* ── 数据面（宿主 fenced JSON API）──────────────────────── */

		function fetchCatalog() {
			return fetch("/kcoder-skills/api/catalog", { headers: { accept: "application/json" } })
				.then(function (res) { if (!res.ok) throw new Error("HTTP " + res.status); return res.json(); })
				.then(function (payload) {
					if (payload && payload.ok) return payload;
					throw new Error(payload && payload.error ? payload.error.message : "bad payload");
				});
		}

		function postEnabled(enabled) {
			return fetch("/kcoder-skills/api/set-enabled", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ enabled: enabled }),
			}).then(function (res) {
				if (!res.ok) throw new Error("HTTP " + res.status);
				return res.json();
			}).then(function (payload) {
				if (payload && payload.ok) return payload;
				throw new Error(payload && payload.error ? payload.error.message : "bad payload");
			});
		}

		/* ── 分区组件（开关卡片网格）────────────────────────────── */

		function Switch(props) {
			return React.createElement("button", {
				type: "button",
				className: "kcs-switch",
				"data-on": props.on ? "true" : "false",
				role: "switch",
				"aria-checked": props.on ? "true" : "false",
				"aria-label": props.label,
				disabled: props.disabled === true,
				onClick: props.onToggle,
			});
		}

		function SkillCard(props) {
			var skill = props.skill;
			var on = skill.enabled === true;
			return React.createElement("div", {
				className: "kcs-card",
				"data-on": on ? "true" : "false",
				role: "group",
			},
				React.createElement("div", { className: "kcs-card-body" },
					React.createElement("span", { className: "kcs-card-name" },
						skill.name,
						props.core === true ? React.createElement("span", { className: "kcs-badge" }, t("coreBadge")) : null,
					),
					React.createElement("div", { className: "kcs-card-desc", title: skill.description }, skill.description),
				),
				props.core === true
					? null
					: React.createElement(Switch, {
						on: on,
						label: skill.name,
						disabled: props.busy === true,
						onToggle: function () { props.onToggle(skill.name); },
					}),
			);
		}

		function makeOptionalSkillsSection() {
			var Section = function () {
				var state = React.useState({ status: "loading", core: [], optional: [], error: null, busy: false });
				var snapshot = state[0], setState = state[1];

				var load = React.useCallback(function () {
					setState(function (s) { return Object.assign({}, s, { status: "loading", error: null }); });
					fetchCatalog().then(function (payload) {
						setState(function (s) { return Object.assign({}, s, { status: "ready", core: payload.core || [], optional: payload.optional || [] }); });
					}).catch(function (error) {
						setState(function (s) { return Object.assign({}, s, { status: "error", error: error && error.message ? error.message : String(error) }); });
					});
				}, []);
				React.useEffect(function () { load(); }, [load]);

				var onToggle = React.useCallback(function (name) {
					setState(function (s) {
						if (s.busy) return s;
						var next = s.optional.map(function (skill) {
							return skill.name === name ? Object.assign({}, skill, { enabled: !skill.enabled }) : skill;
						});
						var enabled = next.filter(function (skill) { return skill.enabled; }).map(function (skill) { return skill.name; });
						postEnabled(enabled).then(function () {
							setState(function (cur) { return Object.assign({}, cur, { optional: next, busy: false }); });
						}).catch(function () {
							// 保存失败：回退到开关前的清单
							setState(function (cur) { return Object.assign({}, cur, { busy: false, error: t("saveFailed") }); });
							load();
						});
						return Object.assign({}, s, { optional: next, busy: true, error: null });
					});
				}, []);

				var enabledCount = snapshot.optional.filter(function (skill) { return skill.enabled; }).length;

				if (snapshot.status === "loading" && snapshot.optional.length === 0) {
					return React.createElement("div", null,
						React.createElement("p", { className: "kcs-state" }, t("loading")));
				}
				if (snapshot.status === "error" && snapshot.optional.length === 0) {
					return React.createElement("div", null,
						React.createElement("p", { className: "kcs-state", "data-kind": "error" }, t("loadFailed")),
						React.createElement("button", { type: "button", className: "kcs-retry", onClick: load }, t("retry")));
				}
				return React.createElement("div", null,
					React.createElement("p", { className: "kcs-intro" }, t("intro")),
					snapshot.error !== null ? React.createElement("p", { className: "kcs-state", "data-kind": "error" }, t("saveFailed")) : null,
					React.createElement("div", { className: "kcs-group" },
						React.createElement("h3", { className: "kcs-group-title" }, t("optionalTitle")),
						React.createElement("p", { className: "kcs-group-intro" },
							enabledCount + " / " + snapshot.optional.length + " " + t("countSuffix")),
						React.createElement("div", { className: "kcs-grid" },
							snapshot.optional.map(function (skill) {
								return React.createElement(SkillCard, {
									key: skill.name, skill: skill, busy: snapshot.busy, onToggle: onToggle,
								});
							}),
						),
					),
					React.createElement("div", { className: "kcs-group" },
						React.createElement("h3", { className: "kcs-group-title" }, t("coreTitle")),
						React.createElement("p", { className: "kcs-group-intro" }, t("coreIntro")),
						React.createElement("div", { className: "kcs-grid" },
							snapshot.core.map(function (skill) {
								return React.createElement(SkillCard, { key: skill.name, skill: skill, core: true });
							}),
						),
					),
				);
			};
			Section.displayName = "KcoderOptionalSkillsSection";
			return Section;
		}

		/* ── cordis client 插件体 ───────────────────────────────── */

		var inject = ["slots"];

		function apply(ctx) {
			var removeStyles = ensureStyles();
			if (removeStyles !== null && typeof ctx.effect === "function") {
				ctx.effect(function () { return removeStyles; }, "dsh-skills-bundle: section styles");
			}
			if (!ctx.slots || typeof ctx.slots.inject !== "function") return;

			// 设置壳的动态分区：nav 行与内容列都从 settings.section 插槽投影。
			// 软探测：宿主无该插槽时静默跳过（宿主侧技能注册不受影响）。
			try {
				ctx.slots.inject("settings.section", function () {
					return ctx.slots.register({
						name: "settings.section",
						id: SECTION_ID,
						order: 60,
						label: t("nav"),
					}, makeOptionalSkillsSection());
				});
			} catch (error) {
				console.warn("[dsh-skills-bundle] 宿主无 settings.section 插槽，跳过设置分区，宿主侧注册不受影响:", error && error.message);
			}
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
