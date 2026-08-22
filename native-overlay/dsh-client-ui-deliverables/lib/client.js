window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-client-ui-deliverables",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");
		//#region lib/types/client/turn-deliverables.js
		/**
		 * Paths a call view reports having created or changed, by render intent rather
		 * than tool name: a diff card, or a generic card whose kind is `edit` (the
		 * shape `str_replace_editor`'s insert presents). Every other card produces
		 * nothing to open — a read looked, a delete removed, a terminal ran. Only
		 * root call views enter this Turn accumulator; nested Code Mode dispatches
		 * preserve the pre-assembly behavior and do not contribute independently.
		 */
		function producedPaths(view) {
			if (view === null) return [];
			if (view.card === "diff") return (view.locations ?? []).map((location) => location.path);
			if (view.card === "generic" && view.kind === "edit") return (view.locations ?? []).map((location) => location.path);
			return [];
		}
		/* === KCoder native-overlay begin (mark: kcoderc:deliverables-card) ===
		 * KCoder 交付审查增强：在原生产物推导之上保留 diff hunk 文本
		 * （oldText/newText）与 +N/−N 行统计，并累积 assistant/message 的
		 * text 块作为纯审计轮（无文件产出但跑过工具）的结论交付。 */
		/**
		 * Produced hunks with texts, same render-intent gate as `producedPaths`:
		 * diff cards carry `diffs: [{path, oldText, newText}]`; generic edit
		 * cards only name paths (no reviewable text).
		 */
		function producedHunks(view) {
			if (view === null) return [];
			if (view.card === "diff") {
				const diffs = Array.isArray(view.diffs) ? view.diffs : [];
				const hunks = [];
				for (const diff of diffs) {
					if (diff === null || typeof diff !== "object") continue;
					if (typeof diff.path !== "string" || typeof diff.newText !== "string") continue;
					hunks.push({
						path: diff.path,
						oldText: typeof diff.oldText === "string" ? diff.oldText : null,
						newText: diff.newText
					});
				}
				return hunks;
			}
			if (view.card === "generic" && view.kind === "edit") {
				return (view.locations ?? []).map((location) => ({
					path: location.path,
					oldText: null,
					newText: null
				}));
			}
			return [];
		}
		/** Added/removed line counts: trim common head/tail, then LCS (bounded). */
		function countChanges(oldText, newText) {
			const oldLines = oldText === null ? [] : oldText.split("\n");
			const newLines = newText.split("\n");
			let head = 0;
			while (head < oldLines.length && head < newLines.length && oldLines[head] === newLines[head]) head++;
			let tail = 0;
			while (tail < oldLines.length - head && tail < newLines.length - head && oldLines[oldLines.length - 1 - tail] === newLines[newLines.length - 1 - tail]) tail++;
			const a = oldLines.slice(head, oldLines.length - tail);
			const b = newLines.slice(head, newLines.length - tail);
			if (a.length === 0 || b.length === 0) return { added: b.length, removed: a.length };
			if (a.length * b.length > 4e6) return { added: b.length, removed: a.length };
			let prev = new Uint32Array(b.length + 1);
			let curr = new Uint32Array(b.length + 1);
			for (let i = 1; i <= a.length; i++) {
				for (let j = 1; j <= b.length; j++) curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1]);
				const swap = prev;
				prev = curr;
				curr = swap;
				curr.fill(0);
			}
			const common = prev[b.length];
			return { added: b.length - common, removed: a.length - common };
		}
		/** Joined `text` blocks of an assistant/message event; null when none. */
		function messageText(event) {
			const data = event.data ?? {};
			const message = data.message;
			if (message === null || typeof message !== "object" || !Array.isArray(message.content)) return null;
			const parts = [];
			for (const block of message.content) if (block !== null && typeof block === "object" && block.type === "text" && typeof block.text === "string" && block.text !== "") parts.push(block.text);
			return parts.length === 0 ? null : parts.join("\n\n");
		}
		/* === KCoder native-overlay end === */
		/**
		 * Files produced by one Turn data value.
		 *
		 * The source is the mutation tools' own follow-along `locations`, not the
		 * closing prose: a produced file must be listed whether or not the model
		 * remembered to name it. A mutation is recognized by render intent, not by
		 * tool name — a diff card, or a generic card whose `kind` is `edit` (the shape
		 * `str_replace_editor`'s insert presents) — so a new mutation tool joins by
		 * declaring what it does. Reads contribute nothing (looking at a file does not
		 * produce it), and neither do deletes (there is nothing left to open) or
		 * failed calls. Paths keep first-seen order and appear once, so a file written
		 * and then edited in the same turn is one entry.
		 *
		 * The Conversation Location index owns turn membership before this function
		 * runs, so paths cannot spill across turns and this derivation does not infer
		 * boundaries from neighboring presentation Nodes.
		 * @param data - engine-published Deliverables data for one Turn.
		 * @param seq - closing Assistant seq; later Tool settlements are excluded.
		 * @returns Produced paths in first-seen order; empty when the turn wrote nothing.
		 */
		function producedForClosing(data, seq = Number.POSITIVE_INFINITY) {
			if (data === void 0) return [];
			const paths = [];
			const seen = /* @__PURE__ */ new Set();
			for (const produced of data.produced) {
				if (produced.seq > seq || seen.has(produced.path)) continue;
				seen.add(produced.path);
				paths.push(produced.path);
			}
			return paths;
		}
		/**
		 * Claim the turn-tail chain when its closing turn produced files — or, as
		 * the KCoder overlay extends it, when a pure-audit turn (tools ran, no
		 * mutations) left a closing text worth delivering.
		 * @param owner - Turn-tail owner currency for the closing assistant.
		 * @returns `{ paths, files, closingText }` for the component's match, or null
		 * to decline before mount.
		 */
		function selectProducedFiles(owner) {
			const data = owner.turn.data.get("deliverables");
			if (data === void 0) return null;
			const paths = producedForClosing(data, owner.seq);
			/* KCoder: aggregate per-file hunks and +N/−N counts for the review body. */
			const files = [];
			const byPath = /* @__PURE__ */ new Map();
			for (const produced of data.produced) {
				if (produced.seq > owner.seq) continue;
				let entry = byPath.get(produced.path);
				if (entry === void 0) {
					entry = { path: produced.path, added: 0, removed: 0, hunks: [] };
					byPath.set(produced.path, entry);
					files.push(entry);
				}
				if (typeof produced.newText === "string") {
					const counts = countChanges(typeof produced.oldText === "string" ? produced.oldText : null, produced.newText);
					entry.added += counts.added;
					entry.removed += counts.removed;
					entry.hunks.push({ oldText: produced.oldText, newText: produced.newText });
				}
			}
			let closingText = "";
			if (Array.isArray(data.messages)) for (const message of data.messages) if (message.seq <= owner.seq && message.text !== "") closingText = message.text;
			if (paths.length > 0) return { paths, files, closingText: "" };
			if ((data.callsRan ?? 0) > 0 && closingText !== "") return { paths: [], files: [], closingText };
			return null;
		}
		/** Turn-local successful mutation accumulator; it publishes no view Node. */
		const deliverablesDefinition = {
			kind: "deliverables",
			match: (event) => {
				if (event.type === "turn/start") return {
					id: String(event.data.turn),
					role: "start"
				};
				if (event.type === "tool/call") return {
					id: String(event.data.turn),
					role: "update"
				};
				if (event.type === "tool/result" && (0, _deepseek_ai_dsh_client_runtime_client.isAppendSurfaceEvent)(event)) return {
					id: String(event.data.turn),
					role: "update"
				};
				/* KCoder: closing prose feeds the pure-audit deliverable card. */
				if (event.type === "assistant/message") return {
					id: String(event.data.turn),
					role: "update"
				};
				return null;
			},
			start: (_context, match) => {
				if (match.event.type !== "turn/start") throw new Error("deliverables start requires turn/start");
				return {
					turn: match.event.data.turn,
					calls: /* @__PURE__ */ new Map(),
					produced: []
				};
			},
			update: (context, match) => {
				if (match.event.type === "tool/call") {
					const calls = new Map(context.state.calls);
					calls.set(String(match.event.data.callId), match.view?.for === "call" ? match.view.view : null);
					return {
						...context.state,
						calls
					};
				}
				/* KCoder: remember the closing text blocks (reasoning excluded). */
				if (match.event.type === "assistant/message") {
					const text = messageText(match.event);
					if (text === null) return context.state;
					return {
						...context.state,
						messages: [...(context.state.messages ?? []), { seq: match.event.seq, text }]
					};
				}
				if (match.event.type !== "tool/result") return context.state;
				if (match.event.data.message.content[0].isError === true) return context.state;
				const callId = String(match.event.data.message.source.callId);
				/* KCoder: keep hunk texts alongside paths (same render-intent gate). */
				const additions = producedHunks(context.state.calls.get(callId) ?? null).map((hunk) => ({
					seq: match.event.seq,
					path: hunk.path,
					oldText: hunk.oldText,
					newText: hunk.newText
				}));
				return additions.length === 0 ? context.state : {
					...context.state,
					produced: [...context.state.produced, ...additions]
				};
			},
			buildLocationData: (context, scope) => scope !== "turn" || context.state === void 0 ? null : {
				kind: "turn",
				turn: context.state.turn,
				key: "deliverables",
				value: {
					produced: context.state.produced,
					messages: context.state.messages ?? [],
					callsRan: context.state.calls.size
				}
			}
		};
		/**
		 * Trailing path segment, the part that identifies the file at a glance.
		 * @param path - Slash- or backslash-separated path.
		 * @returns The final segment, or the whole string when separator-free.
		 */
		function basename(path) {
			const at = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
			return at === -1 ? path : path.slice(at + 1);
		}
		/**
		 * File-mention vocabulary over one turn's produced paths, for the closing
		 * message's prose: an inline-code token opens the file it names. A token
		 * resolves by exact path, or by being exactly the basename of exactly one
		 * produced path — a basename two paths share stays inert rather than
		 * guessing, so a mention link can never open the wrong file or 404.
		 * @param paths - The turn's produced paths (tool order, already deduped).
		 * @param openFile - The chat view's file opener.
		 * @param label - Localizes the accessible open-label for a resolved path.
		 * @returns The resolver MarkdownText consumes; the full path rides `title`,
		 * the same disambiguator the row's chips carry.
		 */
		function producedFileMentions(paths, openFile, label) {
			return { resolve(value) {
				const path = paths.includes(value) ? value : onlyPathWithBasename(paths, value);
				if (path === void 0) return void 0;
				return {
					open: () => {
						openFile(path);
					},
					label: label(path),
					title: path
				};
			} };
		}
		/** The single produced path whose basename is exactly `value`, else undefined. */
		function onlyPathWithBasename(paths, value) {
			const matches = paths.filter((path) => basename(path) === value);
			return matches.length === 1 ? matches[0] : void 0;
		}
		//#endregion
		//#region \0dsh-css:/home/runner/work/deepseek-harness/deepseek-harness/packages/client/ui-deliverables/src/client/ProducedFiles.module.css.mjs
		const css = ".brpKHq_root{grid-template-columns:max-content minmax(0,1fr);align-items:center;gap:6px 8px;margin-top:16px;font-size:13px;line-height:22px;display:grid;position:relative}.brpKHq_label{color:var(--dsw-alias-label-tertiary);grid-area:1/1}.brpKHq_row{flex-wrap:nowrap;grid-area:1/2;align-items:center;gap:8px;min-width:0;display:flex;overflow:hidden}.brpKHq_file{text-overflow:ellipsis;white-space:nowrap;background:var(--dsw-alias-interactive-bg-hover);max-width:320px;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;border:none;border-radius:6px;flex:none;margin:0;padding:0 8px;overflow:hidden}.brpKHq_file:hover{color:var(--dsw-alias-label-primary);text-decoration:underline}.brpKHq_file:focus-visible,.brpKHq_showFolder:focus-visible{box-shadow:inset 0 0 0 2px var(--dsw-alias-border-l3);outline:none}.brpKHq_more{white-space:nowrap;color:var(--dsw-alias-label-tertiary);flex:none}.brpKHq_showFolder{color:var(--dsw-alias-label-tertiary);font:inherit;cursor:pointer;background:0 0;border:none;border-radius:4px;grid-area:2/2;justify-self:start;margin:0;padding:0 2px;line-height:20px}.brpKHq_showFolder:hover{color:var(--dsw-alias-label-secondary);text-decoration:underline}.brpKHq_measure{visibility:hidden;pointer-events:none;contain:strict;width:0;height:0;position:absolute;overflow:hidden}.brpKHq_probe{width:max-content;position:absolute;inset:0 auto auto 0}";
		const tagId = "@deepseek-ai/dsh-client-ui-deliverables/ProducedFiles.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-deliverables";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var ProducedFiles_module_css_default = {
			"file": "brpKHq_file",
			"label": "brpKHq_label",
			"measure": "brpKHq_measure",
			"more": "brpKHq_more",
			"probe": "brpKHq_probe",
			"root": "brpKHq_root",
			"row": "brpKHq_row",
			"showFolder": "brpKHq_showFolder"
		};
		/* === KCoder native-overlay: review/audit styles (own tag, kcdlv-*) === */
		const kcdlvCss = ".kcdlv-card{grid-column:1 / -1;margin-top:6px;border:1px solid var(--dsw-alias-border-l2,#EBEEF1);border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-layer-1)}body[data-ds-dark-theme] .kcdlv-card{border-color:#2E3035}.kcdlv-head{display:flex;align-items:center;gap:10px;padding:9px 14px;border-bottom:1px solid var(--dsw-alias-border-l1,#F0F2F5)}body[data-ds-dark-theme] .kcdlv-head{border-bottom-color:#2A2B2F}.kcdlv-ico{flex:none;width:26px;height:26px;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}.kcdlv-ico svg{display:block}.kcdlv-title{color:var(--dsw-alias-label-primary);font-size:12.5px;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.kcdlv-stats{flex:none;display:inline-flex;gap:8px;font:600 11px/1 ui-monospace,Menlo,monospace;font-variant-numeric:tabular-nums}.kcdlv-stats i{font-style:normal}.kcdlv-stats .a{color:#1A7F37}.kcdlv-stats .d{color:#CF222E}body[data-ds-dark-theme] .kcdlv-stats .a{color:#52B788}body[data-ds-dark-theme] .kcdlv-stats .d{color:#F85149}.kcdlv-actions{margin-left:auto;flex:none;display:inline-flex;align-items:center;gap:8px}.kcdlv-btn{color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1;cursor:pointer;background:transparent;border:1px solid var(--dsw-alias-border-l2,#D8DCE1);border-radius:6px;padding:4px 10px;white-space:nowrap}.kcdlv-btn:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}body[data-ds-dark-theme] .kcdlv-btn{border-color:#3A3D44}.kcdlv-lnk{color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;line-height:1;cursor:pointer;background:transparent;border:none;border-radius:6px;padding:4px 6px;white-space:nowrap}.kcdlv-lnk:hover{color:var(--dsw-alias-label-secondary);text-decoration:underline}.kcdlv-btn:focus-visible,.kcdlv-lnk:focus-visible,.kcdlv-foot:focus-visible,.kcdlv-frow:focus-visible{box-shadow:inset 0 0 0 2px var(--dsw-alias-border-l3);outline:none}.kcdlv-list{max-height:420px;overflow-y:auto}.kcdlv-frow{display:flex;align-items:center;gap:8px;padding:6px 14px;cursor:pointer}.kcdlv-frow:hover{background:var(--dsw-alias-interactive-bg-hover)}.kcdlv-chev{flex:none;width:10px;color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:1}.kcdlv-fpath{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font:11.5px/1.6 ui-monospace,Menlo,monospace}.kcdlv-frow:hover .kcdlv-fpath{color:var(--dsw-alias-label-primary)}.kcdlv-open{flex:none;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border:none;border-radius:5px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;padding:0}.kcdlv-open:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}.kcdlv-open:focus-visible{box-shadow:inset 0 0 0 2px var(--dsw-alias-border-l3);outline:none}.kcdlv-delta{margin-left:auto;flex:none;display:inline-flex;gap:6px;font:600 10.5px/1 ui-monospace,Menlo,monospace;font-variant-numeric:tabular-nums}.kcdlv-delta i{font-style:normal}.kcdlv-delta .a{color:#1A7F37}.kcdlv-delta .d{color:#CF222E}body[data-ds-dark-theme] .kcdlv-delta .a{color:#52B788}body[data-ds-dark-theme] .kcdlv-delta .d{color:#F85149}.kcdlv-foot{display:flex;width:100%;align-items:center;gap:6px;padding:5px 14px;background:transparent;border:none;border-top:1px solid var(--dsw-alias-border-l1,#F0F2F5);color:var(--dsw-alias-label-tertiary);font:inherit;font-size:11.5px;cursor:pointer;text-align:left}body[data-ds-dark-theme] .kcdlv-foot{border-top-color:#2A2B2F}.kcdlv-foot:hover{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover)}.kcdlv-ln{display:flex;font:10.5px/1.5 ui-monospace,Menlo,monospace;white-space:pre}.kcdlv-ln i{flex:none;width:22px;text-align:center;font-style:normal;user-select:none;opacity:.7}.kcdlv-ln pre{margin:0;padding:0 10px 0 4px;flex:1;min-width:0;overflow-x:auto;font:inherit}.kcdlv-ln.del{background:rgba(207,34,46,.07)}.kcdlv-ln.del i{color:#CF222E}.kcdlv-ln.add{background:rgba(26,127,55,.07)}.kcdlv-ln.add i{color:#1A7F37}body[data-ds-dark-theme] .kcdlv-ln.del{background:rgba(248,81,73,.12)}body[data-ds-dark-theme] .kcdlv-ln.del i{color:#F85149}body[data-ds-dark-theme] .kcdlv-ln.add{background:rgba(82,183,136,.12)}body[data-ds-dark-theme] .kcdlv-ln.add i{color:#52B788}.kcdlv-more{padding:2px 10px;font-size:10px;color:var(--dsw-alias-label-tertiary)}.kcdlv-note{padding:10px 14px;max-height:320px;overflow-y:auto;white-space:pre-wrap;word-break:break-word;font-size:12.5px;line-height:1.7;color:var(--dsw-alias-label-primary)}";
		const kcdlvTagId = "@kcoder/native-overlay/deliverables.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(kcdlvTagId) + "]") === null) {
			const kcdlvTag = document.createElement("style");
			kcdlvTag.dataset.plugin = "@kcoder/native-overlay";
			kcdlvTag.dataset.pluginCss = kcdlvTagId;
			kcdlvTag.textContent = kcdlvCss;
			document.head.appendChild(kcdlvTag);
		}
		//#endregion
		//#region lib/types/client/ProducedFiles.js
		/* === KCoder native-overlay: GitHub 风格摘要卡（mark: kcoderc:deliverables-card） ===
		 * 参考图（PR Files-changed 摘要卡）重构：圆角卡片 = 头部（图标 + 标题
		 * 「已产出 N 个文件」+ 总计 +N/−N + 右侧动作按钮）+ 分隔线 + 等宽
		 * 文件路径行（行尾 +N/−N 右对齐、hover 高亮）+ 底部「再显示 N 个
		 * 文件」折叠行。纯审计轮（无文件产出）同卡片形态：标题「分析结论」
		 * + 字数 + 复制/展开按钮，正文为结论文本。文件行点击即展开/收起该文件的红删绿增 hunk（原
		 * 交付组件的 diff 面板交互，不再经由头部审查开关）；行尾 ↗ 图标
		 * 承接原 chips 的 openFile（打开文件预览）。 */
		/** 列表默认展示的文件行数；其余折进「再显示」行（审查模式全量）。 */
		const KCDLV_PREVIEW = 3;
		/** At most this many diff lines render per file; the rest stays counted. */
		const KCDLV_LINE_LIMIT = 400;
		/** Header diff glyph（三横线 + 加号，currentColor）。 */
		const DiffIcon = () => (0, react_jsx_runtime.jsxs)("svg", { width: 14, height: 14, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", "strokeWidth": 1.5, "strokeLinecap": "round", "aria-hidden": true, children: [
			(0, react_jsx_runtime.jsx)("path", { d: "M2.5 4h7" }),
			(0, react_jsx_runtime.jsx)("path", { d: "M2.5 8h5" }),
			(0, react_jsx_runtime.jsx)("path", { d: "M2.5 12h3" }),
			(0, react_jsx_runtime.jsx)("path", { d: "M12 5.75v4.5" }),
			(0, react_jsx_runtime.jsx)("path", { d: "M9.75 8h4.5" })
		] });
		/** Header note glyph（文本行）。 */
		const NoteIcon = () => (0, react_jsx_runtime.jsxs)("svg", { width: 14, height: 14, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", "strokeWidth": 1.5, "strokeLinecap": "round", "aria-hidden": true, children: [
			(0, react_jsx_runtime.jsx)("path", { d: "M3 4h10" }),
			(0, react_jsx_runtime.jsx)("path", { d: "M3 8h10" }),
			(0, react_jsx_runtime.jsx)("path", { d: "M3 12h6" })
		] });
		/** Diff rows for one file's hunks: old lines red, new lines green, bounded. */
		function reviewFileRows(file, t) {
			const rows = [];
			let hidden = 0;
			if (file.hunks.length === 0 || file.hunks.every((hunk) => hunk.newText === null)) return {
				rows: [(0, react_jsx_runtime.jsx)("div", { className: "kcdlv-more", children: t("review.noDiff") }, "nodiff")],
				hidden: 0
			};
			for (const [hunkIndex, hunk] of file.hunks.entries()) {
				if (hunk.newText === null) continue;
				const oldLines = hunk.oldText === null ? [] : hunk.oldText.split("\n");
				const newLines = hunk.newText.split("\n");
				if (oldLines.length > 0 && oldLines[oldLines.length - 1] === "") oldLines.pop();
				if (newLines.length > 0 && newLines[newLines.length - 1] === "") newLines.pop();
				const all = oldLines.map((text) => ["-", text]).concat(newLines.map((text) => ["+", text]));
				for (const [sign, text] of all) {
					if (rows.length >= KCDLV_LINE_LIMIT) {
						hidden += all.length - rows.length;
						break;
					}
					rows.push((0, react_jsx_runtime.jsxs)("div", { className: `kcdlv-ln ${sign === "+" ? "add" : "del"}`, children: [(0, react_jsx_runtime.jsx)("i", { children: sign }), (0, react_jsx_runtime.jsx)("pre", { children: text })] }, `${hunkIndex}-${rows.length}`));
				}
				if (rows.length >= KCDLV_LINE_LIMIT) break;
			}
			return { rows, hidden };
		}
		/** One file row：等宽路径 + 行尾 +N/−N；审查模式下带 chevron 并可展开 hunk。 */
		function FileRow({ file, diffOpen, onToggle, onOpen, t }) {
			const review = diffOpen ? reviewFileRows(file, t) : null;
			return (0, react_jsx_runtime.jsxs)("div", { className: "kcdlv-file", children: [
				(0, react_jsx_runtime.jsxs)("div", { className: "kcdlv-frow", onClick: onToggle, role: "button", tabIndex: 0, "aria-expanded": diffOpen, onKeyDown: (event) => {
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						onToggle();
					}
				}, children: [
					(0, react_jsx_runtime.jsx)("span", { className: "kcdlv-chev", children: diffOpen ? "▾" : "▸" }),
					(0, react_jsx_runtime.jsx)("span", { className: "kcdlv-fpath", title: file.path, children: file.path }),
					(0, react_jsx_runtime.jsxs)("span", { className: "kcdlv-delta", children: [
						(0, react_jsx_runtime.jsx)("i", { className: "a", children: "+" + file.added }),
						(0, react_jsx_runtime.jsx)("i", { className: "d", children: "−" + file.removed })
					] }),
					(0, react_jsx_runtime.jsx)("button", { type: "button", className: "kcdlv-open", title: t("produced.open", { name: file.path }), "aria-label": t("produced.open", { name: file.path }), onClick: (event) => {
						event.stopPropagation();
						onOpen();
					}, children: (0, react_jsx_runtime.jsxs)("svg", { width: 12, height: 12, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, children: [
						(0, react_jsx_runtime.jsx)("path", { d: "M6 3H4.5A1.5 1.5 0 0 0 3 4.5v7A1.5 1.5 0 0 0 4.5 13h7a1.5 1.5 0 0 0 1.5-1.5V10" }),
						(0, react_jsx_runtime.jsx)("path", { d: "M9 3h4v4" }),
						(0, react_jsx_runtime.jsx)("path", { d: "M13 3 7.5 8.5" })
					] }) }, "open")
				] }, "row"),
				review !== null ? review.rows : null,
				review !== null && review.hidden > 0 ? (0, react_jsx_runtime.jsx)("div", { className: "kcdlv-more", children: t("review.more", { count: String(review.hidden) }) }) : null
			] });
		}
		/**
		 * Render one turn's produced files as a GitHub-style summary card（头部
		 * 标题/总计/动作 + 文件行 + 再显示折叠行），审查模式展开 per-file
		 * 红删绿增 hunk；纯审计轮为「分析结论」卡（复制 + 展开）。
		 * @param props - selector-matched `{paths, files, closingText}`, the chat
		 * view's file opener, and the locale seat.
		 * @returns The summary card.
		 */
		function ProducedFiles({ matched, openFile, isLoopback, useHostDescription, t }) {
			const { files, closingText } = matched;
			const hostCanOpenPath = useHostDescription((description) => description?.canOpenPath === true);
			const canOpenPath = isLoopback && hostCanOpenPath;
			const [expanded, setExpanded] = (0, react.useState)(false);
			const [reviewOpen, setReviewOpen] = (0, react.useState)(false);
			const [openDiff, setOpenDiff] = (0, react.useState)(null);
			const [copied, setCopied] = (0, react.useState)(false);
			const produced = files.length > 0;
			let added = 0;
			let removed = 0;
			for (const file of files) {
				added += file.added;
				removed += file.removed;
			}
			const previewCount = Math.min(files.length, KCDLV_PREVIEW);
			const visible = expanded ? files : files.slice(0, previewCount);
			const hidden = files.length - visible.length;
			const onCopy = () => {
				if (closingText === "") return;
				try {
					navigator.clipboard.writeText(closingText).then(() => {
						setCopied(true);
						setTimeout(() => setCopied(false), 900);
					}, () => {});
				} catch {}
			};
			const headButtons = produced ? [
				canOpenPath ? (0, react_jsx_runtime.jsx)("button", { type: "button", className: "kcdlv-lnk", onClick: () => {
					openFile(".");
				}, children: t("produced.showInFolder") }, "folder") : null
			].filter(Boolean) : [
				(0, react_jsx_runtime.jsx)("button", { type: "button", className: "kcdlv-btn", onClick: onCopy, children: copied ? t("audit.copied") : t("audit.copy") }, "copy"),
				(0, react_jsx_runtime.jsx)("button", { type: "button", className: "kcdlv-btn", onClick: () => {
					setReviewOpen(!reviewOpen);
				}, children: [reviewOpen ? t("review.close") : t("audit.expand"), " ", reviewOpen ? "▴" : "▾"] }, "note")
			];
			return (0, react_jsx_runtime.jsx)("div", { className: "kcdlv-card", children: [
				(0, react_jsx_runtime.jsxs)("div", { className: "kcdlv-head", children: [
					(0, react_jsx_runtime.jsx)("span", { className: "kcdlv-ico", children: produced ? (0, react_jsx_runtime.jsx)(DiffIcon, {}) : (0, react_jsx_runtime.jsx)(NoteIcon, {}) }, "ico"),
					(0, react_jsx_runtime.jsx)("span", { className: "kcdlv-title", children: produced ? t("produced.cardTitle", { count: String(files.length) }) : t("audit.label") }, "title"),
					produced && (added > 0 || removed > 0) ? (0, react_jsx_runtime.jsxs)("span", { className: "kcdlv-stats", children: [
						(0, react_jsx_runtime.jsx)("i", { className: "a", children: "+" + added }),
						(0, react_jsx_runtime.jsx)("i", { className: "d", children: "−" + removed })
					] }, "stats") : null,
					headButtons.length > 0 ? (0, react_jsx_runtime.jsx)("div", { className: "kcdlv-actions", children: headButtons }, "actions") : null
				] }, "head"),
				produced ? (0, react_jsx_runtime.jsxs)("div", { className: "kcdlv-list", children: [
					visible.map((file) => (0, react_jsx_runtime.jsx)(FileRow, {
						file,
						diffOpen: openDiff === file.path,
						onToggle: () => {
							setOpenDiff(openDiff === file.path ? null : file.path);
						},
						onOpen: () => {
							openFile(file.path);
						},
						t
					}, file.path)),
					hidden > 0 ? (0, react_jsx_runtime.jsxs)("button", { type: "button", className: "kcdlv-foot", onClick: () => {
						setExpanded(!expanded);
					}, children: [
						(0, react_jsx_runtime.jsx)("span", { className: "kcdlv-chev", children: "▾" }),
						expanded ? t("review.close") : t("produced.expandMore", { count: String(hidden) })
					] }, "more") : null
				] }, "list") : reviewOpen ? (0, react_jsx_runtime.jsx)("div", { className: "kcdlv-note", children: closingText }, "note") : null
			] });
		}
				//#endregion
		//#region lib/types/client/locales.js
		/** `deliverables` namespace dictionaries. */
		/** Dictionary namespace owned by this plugin. */
		const NS = "deliverables";
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"produced.label": "产物",
			"produced.moreOne": "+ 1 个文件",
			"produced.more": "+ {count} 个文件",
			"produced.open": "打开 {name}",
			"produced.showInFolder": "在文件夹中显示",
			"produced.cardTitle": "已产出 {count} 个文件",
			"produced.expandMore": "再显示 {count} 个文件",
			"review.label": "审查变更",
			"review.close": "收起",
			"review.noDiff": "（该文件无 diff 详情）",
			"review.more": "… 还有 {count} 行未展示",
			"audit.label": "分析结论",
			"audit.words": "字",
			"audit.expand": "展开",
			"audit.copy": "复制",
			"audit.copied": "已复制"
		};
		/** English dictionary (same key set). */
		const en = {
			"produced.label": "Produced",
			"produced.moreOne": "+ 1 file",
			"produced.more": "+ {count} files",
			"produced.open": "Open {name}",
			"produced.showInFolder": "Show in folder",
			"produced.cardTitle": "Produced {count} files",
			"produced.expandMore": "Show {count} more files",
			"review.label": "Review changes",
			"review.close": "Collapse",
			"review.noDiff": "(no diff details for this file)",
			"review.more": "… {count} more lines not shown",
			"audit.label": "Findings",
			"audit.words": "chars",
			"audit.expand": "Expand",
			"audit.copy": "Copy",
			"audit.copied": "Copied"
		};
		//#endregion
		//#region lib/types/client/index.js
		/** Required services for the tail-slot registration and its dictionaries. */
		const inject = [
			"slots",
			"locale",
			"conversationEvents",
			"connection"
		];
		/**
		 * Client plugin body: register the dictionaries and the turn-tail entry.
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			const connection = ctx.get("connection");
			ctx.conversationEvents.register(deliverablesDefinition);
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "ui-deliverables: dictionaries");
			ctx.slots.inject("conversation.chat.turnTail", () => ctx.slots.register({
				name: "conversation.chat.turnTail",
				select: selectProducedFiles,
				locale: NS,
				inject: () => ({
					isLoopback: connection.isLoopback,
					hooks: { hostDescription: connection.hostDescription }
				})
			}, ProducedFiles));
			const t = ctx.locale.bind(NS);
			ctx.provide("chatFileMentions", { forClosing(owner) {
				const match = selectProducedFiles(owner);
				if (match === null || match.paths.length === 0) return void 0;
				return producedFileMentions(match.paths, owner.openFile, (path) => t("produced.open", { name: path }));
			} });
		}
		//#endregion
		exports.ProducedFiles = ProducedFiles;
		exports.apply = apply;
		exports.inject = inject;
		exports.producedForClosing = producedForClosing;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map
