window.__ModuleLoader__.load({
	id: "dsh-file-review-kcoder",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/core/util.js
		function getEnumValues(entries) {
			const numericValues = Object.values(entries).filter((v) => typeof v === "number");
			return Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
		}
		function joinValues(array, separator = "|") {
			return array.map((val) => stringifyPrimitive(val)).join(separator);
		}
		function jsonStringifyReplacer(_, value) {
			if (typeof value === "bigint") return value.toString();
			return value;
		}
		var Cached = class {
			constructor(getter) {
				this._getter = getter;
				this._value = void 0;
			}
			get value() {
				const getter = this._getter;
				if (getter !== void 0) {
					this._value = getter();
					this._getter = void 0;
				}
				return this._value;
			}
		};
		function cached(getter) {
			return new Cached(getter);
		}
		function nullish(input) {
			return input === null || input === void 0;
		}
		function cleanRegex(source) {
			const start = source.startsWith("^") ? 1 : 0;
			const end = source.endsWith("$") ? source.length - 1 : source.length;
			return source.slice(start, end);
		}
		function floatSafeRemainder(val, step) {
			const ratio = val / step;
			const roundedRatio = Math.round(ratio);
			const tolerance = 4 * Number.EPSILON * Math.max(Math.abs(ratio), 1);
			if (Math.abs(ratio - roundedRatio) < tolerance) return 0;
			return ratio - roundedRatio;
		}
		function assignProp(target, prop, value) {
			Object.defineProperty(target, prop, {
				value,
				writable: true,
				enumerable: true,
				configurable: true
			});
		}
		/**
		* Whichever object a def's `shape` currently answers from: the one the caller passed until the first read, the frozen copy after it.
		*
		* Its keys and descriptors read without invoking anything, which is what lets a discriminated union check its discriminator, and the cycle walk read a shape, without resolving a getter that references the schema being constructed. A def that answers `shape` from an accessor of its own has none.
		*/
		function rawShape(def) {
			const desc = Object.getOwnPropertyDescriptor(def, "shape");
			return desc?.get ? desc.get.raw : desc?.value;
		}
		function sourceShape(schema) {
			return rawShape(schema._zod.def) ?? schema._zod.def.shape;
		}
		function deferProp(target, key, getter) {
			Object.defineProperty(target, key, {
				get() {
					const value = getter();
					assignProp(this, key, value);
					return value;
				},
				enumerable: true,
				configurable: true
			});
		}
		function putProp(target, key, value) {
			if (key in target) assignProp(target, key, value);
			else target[key] = value;
		}
		/**
		* Copies `keys` of `source`'s shape onto `target`, each value passed through `wrap`.
		*
		* A key the source has resolved is copied through now, so the derived shape states it outright and nothing has to resolve it to learn what it holds. A key the source still defers stays deferred, and reads back through the source's own `shape`, so it resolves once and both shapes get that one schema.
		*/
		function mirrorShape(target, source, keys, wrap) {
			const raw = sourceShape(source);
			for (const key of keys) {
				const desc = Object.getOwnPropertyDescriptor(raw, key);
				if (!desc.enumerable) continue;
				if (desc.get) deferProp(target, key, () => {
					const value = source._zod.def.shape[key];
					return wrap ? wrap(value, key) : value;
				});
				else putProp(target, key, wrap ? wrap(desc.value, key) : desc.value);
			}
		}
		function mirrorProps(target, source) {
			for (const key of Reflect.ownKeys(source)) {
				const desc = Object.getOwnPropertyDescriptor(source, key);
				if (!desc.enumerable) continue;
				if (desc.get) deferProp(target, key, () => source[key]);
				else putProp(target, key, desc.value);
			}
		}
		function mergeDefs(...defs) {
			const mergedDescriptors = {};
			for (const def of defs) {
				const descriptors = Object.getOwnPropertyDescriptors(def);
				Object.assign(mergedDescriptors, descriptors);
			}
			return Object.defineProperties({}, mergedDescriptors);
		}
		function esc(str) {
			return JSON.stringify(str);
		}
		function slugify(input) {
			return input.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
		}
		const captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {};
		function isObject(data) {
			return typeof data === "object" && data !== null && !Array.isArray(data);
		}
		const allowsEval = /* @__PURE__*/ cached(() => {
			if (globalConfig.jitless) return false;
			if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare")) return false;
			try {
				new Function("");
				return true;
			} catch (_) {
				return false;
			}
		});
		function isPlainObject(o) {
			if (isObject(o) === false) return false;
			const ctor = o.constructor;
			if (ctor === void 0) return true;
			if (typeof ctor !== "function") return true;
			const prot = ctor.prototype;
			if (isObject(prot) === false) return false;
			if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) return false;
			return true;
		}
		function shallowClone(o) {
			if (isPlainObject(o)) return { ...o };
			if (Array.isArray(o)) return [...o];
			if (o instanceof Map) return new Map(o);
			if (o instanceof Set) return new Set(o);
			return o;
		}
		const propertyKeyTypes = /* @__PURE__*/ new Set([
			"string",
			"number",
			"symbol"
		]);
		function escapeRegex(str) {
			return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		}
		function clone(inst, def, params) {
			const cl = new inst._zod.constr(def ?? inst._zod.def);
			if (!def || params?.parent) cl._zod.parent = inst;
			return cl;
		}
		function normalizeParams(_params) {
			const params = _params;
			if (!params) return {};
			if (typeof params === "string") return { error: () => params };
			if (params?.message !== void 0) {
				if (params?.error !== void 0) throw new Error("Cannot specify both `message` and `error` params");
				params.error = params.message;
			}
			delete params.message;
			if (typeof params.error === "string") return {
				...params,
				error: () => params.error
			};
			return params;
		}
		function stringifyPrimitive(value) {
			if (typeof value === "bigint") return value.toString() + "n";
			if (typeof value === "string") return `"${value}"`;
			return `${value}`;
		}
		function optionalKeys(shape) {
			return Object.keys(shape).filter((k) => {
				return shape[k]._zod.optin !== void 0 && shape[k]._zod.optout === "optional";
			});
		}
		const NUMBER_FORMAT_RANGES = /*@__PURE__*/ (() => ({
			safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
			int32: [-2147483648, 2147483647],
			uint32: [0, 4294967295],
			float32: [-34028234663852886e22, 34028234663852886e22],
			float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
		}))();
		const BIGINT_FORMAT_RANGES = {
			int64: [/* @__PURE__*/ BigInt("-9223372036854775808"), /* @__PURE__*/ BigInt("9223372036854775807")],
			uint64: [/* @__PURE__*/ BigInt(0), /* @__PURE__*/ BigInt("18446744073709551615")]
		};
		function pick(schema, mask) {
			const currDef = schema._zod.def;
			const checks = currDef.checks;
			if (checks && checks.length > 0) throw new Error(".pick() cannot be used on object schemas containing refinements");
			const newShape = {};
			mirrorShape(newShape, schema, maskedKeys(schema, mask));
			return clone(schema, mergeDefs(currDef, {
				shape: newShape,
				checks: []
			}));
		}
		function maskedKeys(schema, mask) {
			const raw = sourceShape(schema);
			const keys = [];
			for (const key of Reflect.ownKeys(mask)) {
				if (!Object.getOwnPropertyDescriptor(raw, key)?.enumerable) throw new Error(`Unrecognized key: "${String(key)}"`);
				if (mask[key]) keys.push(key);
			}
			return keys;
		}
		function omit(schema, mask) {
			const currDef = schema._zod.def;
			const checks = currDef.checks;
			if (checks && checks.length > 0) throw new Error(".omit() cannot be used on object schemas containing refinements");
			const omitted = new Set(maskedKeys(schema, mask));
			const newShape = {};
			mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)).filter((key) => !omitted.has(key)));
			return clone(schema, mergeDefs(currDef, {
				shape: newShape,
				checks: []
			}));
		}
		function extend(schema, shape) {
			if (!isPlainObject(shape)) throw new Error("Invalid input to extend: expected a plain object");
			const checks = schema._zod.def.checks;
			if (checks && checks.length > 0) {
				const existingShape = sourceShape(schema);
				for (const key of Reflect.ownKeys(shape)) if (Object.getOwnPropertyDescriptor(existingShape, key) !== void 0) throw new Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
			}
			return clone(schema, mergeDefs(schema._zod.def, { shape: extended(schema, shape) }));
		}
		function extended(schema, shape) {
			const newShape = {};
			mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)));
			mirrorProps(newShape, shape);
			return newShape;
		}
		function safeExtend(schema, shape) {
			if (!isPlainObject(shape)) throw new Error("Invalid input to safeExtend: expected a plain object");
			return clone(schema, mergeDefs(schema._zod.def, { shape: extended(schema, shape) }));
		}
		function merge(a, b) {
			if (!b?._zod?.def) throw new Error("Invalid input to merge: expected an object schema. To merge a plain shape, use `.extend()`.");
			if (a._zod.def.checks?.length) throw new Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
			const newShape = {};
			mirrorShape(newShape, a, Reflect.ownKeys(sourceShape(a)));
			mirrorShape(newShape, b, Reflect.ownKeys(sourceShape(b)));
			return clone(a, mergeDefs(a._zod.def, {
				shape: newShape,
				get catchall() {
					return b._zod.def.catchall;
				},
				checks: b._zod.def.checks ?? []
			}));
		}
		function partial(Class, schema, mask, name = "partial") {
			const checks = schema._zod.def.checks;
			if (checks && checks.length > 0) throw new Error(`.${name}() cannot be used on object schemas containing refinements`);
			const selected = mask ? new Set(maskedKeys(schema, mask)) : void 0;
			const newShape = {};
			mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)), Class && ((value, key) => selected && !selected.has(key) ? value : new Class({
				type: "optional",
				innerType: value
			})));
			return clone(schema, mergeDefs(schema._zod.def, {
				shape: newShape,
				checks: []
			}));
		}
		function required(Class, schema, mask) {
			const selected = mask ? new Set(maskedKeys(schema, mask)) : void 0;
			const newShape = {};
			mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)), (value, key) => selected && !selected.has(key) ? value : new Class({
				type: "nonoptional",
				innerType: value
			}));
			return clone(schema, mergeDefs(schema._zod.def, { shape: newShape }));
		}
		function aborted(x, startIndex = 0) {
			if (x.aborted === true) return true;
			for (let i = startIndex; i < x.issues.length; i++) if (x.issues[i]?.continue !== true) return true;
			return false;
		}
		function explicitlyAborted(x, startIndex = 0) {
			if (x.aborted === true) return true;
			for (let i = startIndex; i < x.issues.length; i++) if (x.issues[i]?.continue === false) return true;
			return false;
		}
		function prefixIssues(path, issues) {
			return issues.map((iss) => {
				var _a;
				(_a = iss).path ?? (_a.path = []);
				iss.path.unshift(path);
				return iss;
			});
		}
		function unwrapMessage(message) {
			return typeof message === "string" ? message : message?.message;
		}
		function attachSchema(issues, start, inst) {
			var _a;
			for (let i = start; i < issues.length; i++) (_a = issues[i]).schema ?? (_a.schema = inst);
		}
		function finalizeIssue(iss, ctx, config) {
			var _a;
			const traits = iss.inst?._zod?.traits;
			if (traits?.has("$ZodType")) {
				if (traits.has("$ZodCheck")) (_a = iss).schema ?? (_a.schema = iss.inst);
				else iss.schema = iss.inst;
			}
			const schemaError = iss.schema !== iss.inst ? iss.schema?._zod.def?.error : void 0;
			const message = iss.message ? iss.message : unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(schemaError?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config.customError?.(iss)) ?? unwrapMessage(config.localeError?.(iss)) ?? "Invalid input";
			const full = {};
			for (const k of Object.keys(iss)) {
				if (k === "inst" || k === "schema" || k === "continue" || k === "input" || k === "__proto__") continue;
				full[k] = iss[k];
			}
			full.path ?? (full.path = []);
			full.message = message;
			if (ctx?.reportInput) full.input = iss.input;
			return full;
		}
		const highSurrogate = /[\uD800-\uDBFF]/;
		function codePointLength(str) {
			const units = str.length;
			if (!highSurrogate.test(str)) return units;
			let count = units;
			for (let i = 0; i < units - 1; i++) if ((str.charCodeAt(i) & 64512) === 55296 && (str.charCodeAt(i + 1) & 64512) === 56320) {
				count--;
				i++;
			}
			return count;
		}
		function getLengthableOrigin(input) {
			if (Array.isArray(input)) return "array";
			if (typeof input === "string") return "string";
			return "unknown";
		}
		function parsedType(data) {
			const t = typeof data;
			switch (t) {
				case "number": return Number.isNaN(data) ? "nan" : "number";
				case "object": {
					if (data === null) return "null";
					if (Array.isArray(data)) return "array";
					const obj = data;
					if (obj && Object.getPrototypeOf(obj) !== Object.prototype && "constructor" in obj && obj.constructor) return obj.constructor.name;
				}
			}
			return t;
		}
		function issue(...args) {
			const [iss, input, inst] = args;
			if (typeof iss === "string") return {
				message: iss,
				code: "custom",
				input,
				inst
			};
			return { ...iss };
		}
		/**
		* Installs a trait's members on its prototype. Each value builds that member for the instance on first read; the built value shadows the accessor as an own property, so a detached `const { parse } = schema` keeps working.
		*
		* Call this from a `proto` initializer, which runs once per prototype — never per instance.
		*/
		function members(proto, table) {
			for (const key in table) {
				const desc = Object.getOwnPropertyDescriptor(table, key);
				if (desc.get) Object.defineProperty(proto, key, {
					...desc,
					enumerable: false
				});
				else defineBound(proto, key, desc.value);
			}
		}
		/** Shadows a prototype member with an own value, so a getter that builds from the instance runs once. */
		function own(inst, key, value, enumerable = true) {
			Object.defineProperty(inst, key, {
				configurable: true,
				writable: true,
				enumerable,
				value
			});
			return value;
		}
		/** Like {@link own}, for a member that was never an own data property and has to stay out of `Object.keys`. */
		function hide(inst, key, value) {
			return own(inst, key, value, false);
		}
		/** Adds members a table derives from the instance: each builds on first read and shadows as own data, and assignment shadows the same way, as when these were own properties. */
		function derived(computes, table) {
			for (const key in computes) {
				const compute = computes[key];
				Object.defineProperty(table, key, {
					configurable: true,
					enumerable: true,
					get() {
						return own(this, key, compute(this));
					},
					set(value) {
						own(this, key, value);
					}
				});
			}
			return table;
		}
		function defineBound(proto, key, fn) {
			Object.defineProperty(proto, key, {
				configurable: true,
				get() {
					return this == null ? fn : own(this, key, fn.bind(this));
				},
				set(value) {
					own(this, key, value);
				}
			});
		}
		/** Returns the prototype to install on, or `undefined` if this group is already installed on it. */
		function claim(inst, sentinel) {
			const proto = Object.getPrototypeOf(inst);
			return sentinel in proto ? void 0 : proto;
		}
		let installing;
		let broke = false;
		const breaker = {
			configurable: true,
			get() {
				broke = true;
			}
		};
		/**
		* Installs a lazily-derived internal on the `_zod` prototype of `inst`'s
		* constructor, computed from the internals object itself and cached there on
		* first read. One accessor per constructor rather than one per instance.
		*/
		function defineLazyInternal(inst, key, compute) {
			const proto = Object.getPrototypeOf(inst._zod);
			if (key in proto && installing !== inst._zod) {
				installing = void 0;
				return;
			}
			installing = inst._zod;
			Object.defineProperty(proto, key, {
				configurable: true,
				get() {
					Object.defineProperty(this, key, breaker);
					const outer = broke;
					broke = false;
					try {
						const value = compute(this);
						if (broke) delete this[key];
						else Object.defineProperty(this, key, {
							configurable: true,
							writable: true,
							value
						});
						broke = broke || outer;
						return value;
					} catch (err) {
						delete this[key];
						broke = broke || outer;
						throw err;
					}
				},
				set(value) {
					Object.defineProperty(this, key, {
						configurable: true,
						writable: true,
						value
					});
				}
			});
		}
		/**
		* Installs `key` on `inst`'s prototype, computed by `make` on first read and cached there as an own
		* data property. One accessor per constructor rather than one per instance, because an own accessor
		* puts every instance after the first into v8 dictionary mode. The key doubles as the sentinel.
		*/
		function installLazyProp(inst, key, make, enumerable) {
			const proto = claim(inst, key);
			if (!proto) return;
			Object.defineProperty(proto, key, {
				configurable: true,
				get() {
					const desc = {
						configurable: true,
						writable: true,
						enumerable,
						value: void 0
					};
					Object.defineProperty(this, key, desc);
					desc.value = make(this);
					Object.defineProperty(this, key, desc);
					return desc.value;
				},
				set(value) {
					Object.defineProperty(this, key, {
						configurable: true,
						writable: true,
						enumerable,
						value
					});
				}
			});
		}
		/** Marks the thunk `_catch` synthesises for a constant catch value. `Function.length` cannot tell that thunk from a user callback — rest and defaulted parameters both report arity 0 — and a user callback reads `ctx.error`, whose issues only finalize correctly against the caller's per-parse error map. Provenance can say what arity cannot. A plain string key rather than `Symbol.for`, whose call at module scope no bundler can prove pure — the same shape that anchored `urlCanParse` into every build. */
		const CONSTANT_CATCH = "~constantCatch";
		/** Wraps a constant catch value in a thunk tagged with {@link CONSTANT_CATCH}. */
		function constantCatch(value) {
			const fn = () => value;
			fn[CONSTANT_CATCH] = true;
			return fn;
		}
		//#endregion
		//#region node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/core/core.js
		var _a$1;
		const _zodDesc = {
			value: void 0,
			enumerable: false
		};
		let _E = "captureStackTrace" in Error ? Error : null;
		function newError(Definition) {
			const E = _E;
			if (E) {
				const saved = E.stackTraceLimit;
				if (typeof saved === "number") {
					try {
						E.stackTraceLimit = 0;
					} catch {
						_E = null;
						return new Definition();
					}
					try {
						return new Definition();
					} finally {
						E.stackTraceLimit = saved;
					}
				}
			}
			return new Definition();
		}
		function $constructor(name, initializer, proto, params) {
			const zodProto = {};
			function Internals(def) {
				this.def = def;
				this.constr = _;
				this.traits = /* @__PURE__ */ new Set();
			}
			Internals.prototype = zodProto;
			const protoMembers = proto;
			const initialized = protoMembers && /* @__PURE__ */ new WeakSet();
			function init(inst, def) {
				if (!inst._zod) {
					_zodDesc.value = new Internals(def);
					try {
						Object.defineProperty(inst, "_zod", _zodDesc);
					} finally {
						_zodDesc.value = void 0;
					}
				} else if (inst._zod.traits.has(name)) return;
				inst._zod.traits.add(name);
				initializer(inst, def);
				if (initialized) {
					const own = Object.getPrototypeOf(inst);
					const ctorProto = inst._zod.constr.prototype;
					let up = own;
					while (up && up !== ctorProto) up = Object.getPrototypeOf(up);
					const target = up ?? own;
					if (!initialized.has(target)) {
						initialized.add(target);
						members(target, protoMembers);
					}
				}
				const proto = _.prototype;
				for (const k in proto) {
					if (!Object.prototype.hasOwnProperty.call(proto, k)) continue;
					if (!(k in inst)) inst[k] = proto[k].bind(inst);
				}
			}
			const Parent = params?.Parent ?? Object;
			class Definition extends Parent {}
			Object.defineProperty(Definition, "name", { value: name });
			function _(def) {
				const inst = params?.Parent ? newError(Definition) : this;
				init(inst, def);
				const deferred = inst._zod.deferred;
				if (deferred) {
					for (const fn of deferred) fn();
					inst._zod.deferred = void 0;
				}
				const pp = globalThis.__zod_globalConfig?.postProcessor;
				if (pp) pp(inst);
				return inst;
			}
			Object.defineProperty(_, "init", { value: init });
			Object.defineProperty(_, Symbol.hasInstance, { value: (inst) => {
				if (params?.Parent && inst instanceof params.Parent) return true;
				return inst?._zod?.traits?.has(name);
			} });
			Object.defineProperty(_, "name", { value: name });
			return _;
		}
		var $ZodAsyncError = class extends Error {
			constructor() {
				super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
			}
		};
		var $ZodEncodeError = class extends Error {
			constructor(name) {
				super(`Encountered unidirectional transform during encode: ${name}`);
				this.name = "ZodEncodeError";
			}
		};
		(_a$1 = globalThis).__zod_globalConfig ?? (_a$1.__zod_globalConfig = {});
		const globalConfig = globalThis.__zod_globalConfig;
		function config(newConfig) {
			if (newConfig) Object.assign(globalConfig, newConfig);
			return globalConfig;
		}
		//#endregion
		//#region node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/core/errors.js
		function _getMessage() {
			const internals = this._zod;
			internals.message ?? (internals.message = JSON.stringify(internals.def, jsonStringifyReplacer, 2));
			return internals.message;
		}
		function _setMessage(value) {
			this._zod.message = value;
		}
		const _messageDesc = {
			get: _getMessage,
			set: _setMessage,
			enumerable: true,
			configurable: true
		};
		const _issuesDesc = {
			value: void 0,
			enumerable: false
		};
		const _installedToString = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]);
		const initializer$1 = (inst, def) => {
			inst.name = "$ZodError";
			_issuesDesc.value = def;
			Object.defineProperty(inst, "issues", _issuesDesc);
			_issuesDesc.value = void 0;
			Object.defineProperty(inst, "message", _messageDesc);
			const proto = Object.getPrototypeOf(inst);
			if (!_installedToString.has(proto)) {
				_installedToString.add(proto);
				Object.defineProperty(proto, "toString", {
					configurable: true,
					enumerable: false,
					get() {
						const value = () => this.message;
						Object.defineProperty(this, "toString", {
							value,
							configurable: true,
							writable: true
						});
						return value;
					},
					set(value) {
						Object.defineProperty(this, "toString", {
							value,
							configurable: true,
							writable: true
						});
					}
				});
			}
		};
		const $ZodError = $constructor("$ZodError", initializer$1);
		$constructor("$ZodError", initializer$1, void 0, { Parent: Error });
		/** Get-or-create `obj[key]` as an own data property. A path segment naming an inherited member
		* ("toString", "constructor") would otherwise read through to the prototype, and assigning
		* "__proto__" would hit the setter instead of creating a key. */
		function node(obj, key, make) {
			if (!Object.prototype.hasOwnProperty.call(obj, key)) {
				if (key === "__proto__") Object.defineProperty(obj, key, {
					value: make(),
					writable: true,
					enumerable: true,
					configurable: true
				});
				else obj[key] = make();
			}
			return obj[key];
		}
		function flattenError(error, mapper = (issue) => issue.message) {
			const fieldErrors = {};
			const formErrors = [];
			for (const sub of error.issues) if (sub.path.length > 0) node(fieldErrors, sub.path[0], () => []).push(mapper(sub));
			else formErrors.push(mapper(sub));
			return {
				formErrors,
				fieldErrors
			};
		}
		function formatError(error, mapper = (issue) => issue.message) {
			const fieldErrors = { _errors: [] };
			const processError = (error, path = []) => {
				for (const issue of error.issues) if (issue.code === "invalid_union" && issue.errors.length) issue.errors.map((issues) => processError({ issues }, [...path, ...issue.path]));
				else if (issue.code === "invalid_key") processError({ issues: issue.issues }, [...path, ...issue.path]);
				else if (issue.code === "invalid_element") processError({ issues: issue.issues }, [...path, ...issue.path]);
				else {
					const fullpath = [...path, ...issue.path];
					if (fullpath.length === 0) fieldErrors._errors.push(mapper(issue));
					else {
						let curr = fieldErrors;
						let i = 0;
						while (i < fullpath.length) {
							const el = fullpath[i];
							const terminal = i === fullpath.length - 1;
							if (el === "_errors") {
								if (terminal) curr._errors.push(mapper(issue));
								i++;
								continue;
							}
							if (!Object.prototype.hasOwnProperty.call(curr, el)) Object.defineProperty(curr, el, {
								value: { _errors: [] },
								enumerable: true,
								writable: true,
								configurable: true
							});
							const node = curr[el];
							if (terminal) node._errors.push(mapper(issue));
							curr = node;
							i++;
						}
					}
				}
			};
			processError(error);
			return fieldErrors;
		}
		//#endregion
		//#region node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/core/parse.js
		function finalizeParams(callee, params) {
			return {
				callee: params?.callee ?? callee,
				Err: params?.Err
			};
		}
		const _parse = (_Err) => {
			const fn = (schema, value, _ctx, _params) => {
				const ctx = _ctx ? {
					..._ctx,
					async: false
				} : { async: false };
				const result = schema._zod.run({
					value,
					issues: []
				}, ctx);
				if (result instanceof Promise) throw new $ZodAsyncError();
				if (result.issues.length) {
					const e = new ((_params?.Err) ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
					captureStackTrace(e, _params?.callee ?? fn);
					throw e;
				}
				return result.value;
			};
			return fn;
		};
		const _parseAsync = (_Err) => {
			const fn = async (schema, value, _ctx, params) => {
				const ctx = _ctx ? {
					..._ctx,
					async: true
				} : { async: true };
				let result = schema._zod.run({
					value,
					issues: []
				}, ctx);
				if (result instanceof Promise) result = await result;
				if (result.issues.length) {
					const e = new ((params?.Err) ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
					captureStackTrace(e, params?.callee ?? fn);
					throw e;
				}
				return result.value;
			};
			return fn;
		};
		const _safeParse = (_Err) => (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				async: false
			} : { async: false };
			const result = schema._zod.run({
				value,
				issues: []
			}, ctx);
			if (result instanceof Promise) throw new $ZodAsyncError();
			return result.issues.length ? failure(_Err, result.issues, ctx) : {
				success: true,
				data: result.value
			};
		};
		function failure(Err, issues, ctx) {
			let error;
			return {
				success: false,
				get error() {
					if (!error) {
						error = new Err(issues.map((iss) => finalizeIssue(iss, ctx, config())));
						issues = void 0;
						ctx = void 0;
					}
					return error;
				},
				set error(e) {
					error = e;
					issues = void 0;
					ctx = void 0;
				}
			};
		}
		const _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				async: true
			} : { async: true };
			let result = schema._zod.run({
				value,
				issues: []
			}, ctx);
			if (result instanceof Promise) result = await result;
			return result.issues.length ? failure(_Err, result.issues, ctx) : {
				success: true,
				data: result.value
			};
		};
		const COMPILE_INVALID = /* @__PURE__ */ Symbol.for("zod.compile.invalid");
		const COMPILE_FALLBACK = /* @__PURE__ */ Symbol.for("zod.compile.fallback");
		const validate = ((schema, value, _ctx) => {
			const validator = schema._zod.bag.validator;
			if (validator !== void 0) {
				if (validator(value) !== COMPILE_INVALID) return true;
				if (validator.definite === true && _ctx === void 0) return false;
			}
			return validateFallback(schema, value, _ctx);
		});
		function validateFallback(schema, value, _ctx) {
			const ctx = _ctx ? {
				..._ctx,
				async: false,
				abortEarly: true
			} : {
				async: false,
				abortEarly: true
			};
			const fallbackRun = schema._zod.bag.fallbackRun;
			let result;
			if (fallbackRun) {
				ctx[COMPILE_FALLBACK] = true;
				result = fallbackRun({
					value,
					issues: []
				}, ctx);
			} else result = schema._zod.run({
				value,
				issues: []
			}, ctx);
			if (result instanceof Promise) throw new $ZodAsyncError();
			return result.issues.length === 0;
		}
		const validateAsync$1 = async (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				async: true,
				abortEarly: true
			} : {
				async: true,
				abortEarly: true
			};
			let result = schema._zod.run({
				value,
				issues: []
			}, ctx);
			if (result instanceof Promise) result = await result;
			return result.issues.length === 0;
		};
		const _encode = (_Err) => {
			const parse = _parse(_Err);
			const fn = (schema, value, _ctx, _params) => {
				const ctx = _ctx ? {
					..._ctx,
					direction: "backward"
				} : { direction: "backward" };
				return parse(schema, value, ctx, finalizeParams(fn, _params));
			};
			return fn;
		};
		const _decode = (_Err) => {
			const parse = _parse(_Err);
			const fn = (schema, value, _ctx, _params) => {
				return parse(schema, value, _ctx, finalizeParams(fn, _params));
			};
			return fn;
		};
		const _encodeAsync = (_Err) => {
			const parseAsync = _parseAsync(_Err);
			const fn = async (schema, value, _ctx, _params) => {
				const ctx = _ctx ? {
					..._ctx,
					direction: "backward"
				} : { direction: "backward" };
				return await parseAsync(schema, value, ctx, finalizeParams(fn, _params));
			};
			return fn;
		};
		const _decodeAsync = (_Err) => {
			const parseAsync = _parseAsync(_Err);
			const fn = async (schema, value, _ctx, _params) => {
				return await parseAsync(schema, value, _ctx, finalizeParams(fn, _params));
			};
			return fn;
		};
		const _safeEncode = (_Err) => (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				direction: "backward"
			} : { direction: "backward" };
			return _safeParse(_Err)(schema, value, ctx);
		};
		const _safeDecode = (_Err) => (schema, value, _ctx) => {
			return _safeParse(_Err)(schema, value, _ctx);
		};
		const _safeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				direction: "backward"
			} : { direction: "backward" };
			return _safeParseAsync(_Err)(schema, value, ctx);
		};
		const _safeDecodeAsync = (_Err) => async (schema, value, _ctx) => {
			return _safeParseAsync(_Err)(schema, value, _ctx);
		};
		//#endregion
		//#region node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/core/regexes.js
		/**
		* @deprecated CUID v1 is deprecated by its authors due to information leakage
		* (timestamps embedded in the id). Use {@link cuid2} instead.
		* See https://github.com/paralleldrive/cuid.
		*/
		const cuid = /^[cC][0-9a-z]{6,}$/;
		const cuid2 = /^[0-9a-z]+$/;
		const ulid = /^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$/;
		const xid = /^[0-9a-vA-V]{20}$/;
		const ksuid = /^[A-Za-z0-9]{27}$/;
		const nanoid = /^[a-zA-Z0-9_-]{21}$/;
		function nanoidOfLength(length) {
			return new RegExp(`^[a-zA-Z0-9_-]{${length}}$`);
		}
		/** ISO 8601-1 duration regex. Does not support the 8601-2 extensions like negative durations or fractional/negative components. */
		const duration = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
		/** A regex for any UUID-like identifier: 8-4-4-4-12 hex pattern */
		const guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
		/** Returns a regex for validating an RFC 9562/4122 UUID.
		*
		* @param version Optionally specify a version 1-8. If no version is specified, all versions are supported. */
		const uuid = (version) => {
			if (!version) return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
			return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
		};
		/** Practical email validation */
		const email = /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
		const _emoji$1 = `^(?=[\\s\\S]*[\\p{Extended_Pictographic}\\p{Regional_Indicator}\\u20E3])[\\p{Extended_Pictographic}\\p{Emoji_Component}]+$`;
		function emoji() {
			return new RegExp(_emoji$1, "u");
		}
		const ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
		const ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
		const cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
		const cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
		const base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
		const base64url = /^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-]{2,3})?$/;
		const httpProtocol = /^https?$/;
		const e164 = /^\+[1-9]\d{6,14}$/;
		const dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
		/** Anchors a pattern source. The interpolation lives here rather than at the call site because
		* esbuild will not drop a `@__PURE__` call whose own argument interpolates a variable, but it
		* will drop `anchor(dateSource)`. Keeping it inline pinned `date` into every bundle. */
		function anchor(source) {
			return new RegExp(`^${source}$`);
		}
		const date = /*@__PURE__*/ anchor(dateSource);
		function timeSource(args) {
			const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
			return typeof args.precision === "number" ? args.precision === -1 ? `${hhmm}` : args.precision === 0 ? `${hhmm}:[0-5]\\d` : `${hhmm}:[0-5]\\d\\.\\d{${args.precision}}` : args.seconds ? `${hhmm}:[0-5]\\d(?:\\.\\d+)?` : `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
		}
		function time(args) {
			return new RegExp(`^${timeSource(args)}$`);
		}
		function datetime(args) {
			const opts = ["Z"];
			if (args.offset) opts.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
			const qualified = `${timeSource({
				precision: args.precision,
				seconds: true
			})}(?:${opts.join("|")})`;
			const timeRegex = args.local ? `${qualified}|${timeSource({ precision: args.precision })}` : qualified;
			return new RegExp(`^${dateSource}T(?:${timeRegex})$`);
		}
		const anyString = /^[\s\S]{0,}$/;
		const number$1 = /^-?\d+(?:\.\d+)?$/;
		const boolean$1 = /^(?:true|false)$/i;
		const lowercase = /^[^A-Z]*$/;
		const uppercase = /^[^a-z]*$/;
		//#endregion
		//#region node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/core/checks.js
		const $ZodCheck = /*@__PURE__*/ $constructor("$ZodCheck", (inst, def) => {
			var _a;
			inst._zod ?? (inst._zod = {});
			inst._zod.def = def;
			(_a = inst._zod).onattach ?? (_a.onattach = []);
		});
		/** Default `when` for length-based checks: run only on non-nullish values with a `length`. */
		const _whenHasLength = (payload) => {
			const val = payload.value;
			return !nullish(val) && val.length !== void 0;
		};
		const numericOriginMap = {
			number: "number",
			bigint: "bigint",
			object: "date"
		};
		const $ZodCheckLessThan = /*@__PURE__*/ $constructor("$ZodCheckLessThan", (inst, def) => {
			$ZodCheck.init(inst, def);
			const origin = numericOriginMap[typeof def.value];
			inst._zod.check = (payload) => {
				if (def.inclusive ? payload.value <= def.value : payload.value < def.value) return;
				payload.issues.push({
					origin: numericOriginMap[typeof payload.value] ?? origin,
					code: "too_big",
					maximum: typeof def.value === "object" ? def.value.getTime() : def.value,
					input: payload.value,
					inclusive: def.inclusive,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckGreaterThan = /*@__PURE__*/ $constructor("$ZodCheckGreaterThan", (inst, def) => {
			$ZodCheck.init(inst, def);
			const origin = numericOriginMap[typeof def.value];
			inst._zod.check = (payload) => {
				if (def.inclusive ? payload.value >= def.value : payload.value > def.value) return;
				payload.issues.push({
					origin: numericOriginMap[typeof payload.value] ?? origin,
					code: "too_small",
					minimum: typeof def.value === "object" ? def.value.getTime() : def.value,
					input: payload.value,
					inclusive: def.inclusive,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckMultipleOf = /*@__PURE__*/ $constructor("$ZodCheckMultipleOf", (inst, def) => {
			$ZodCheck.init(inst, def);
			inst._zod.check = (payload) => {
				if (typeof payload.value !== typeof def.value) throw new Error("Cannot mix number and bigint in multiple_of check.");
				if (typeof payload.value === "bigint" ? def.value !== BigInt(0) && payload.value % def.value === BigInt(0) : floatSafeRemainder(payload.value, def.value) === 0) return;
				payload.issues.push({
					origin: typeof payload.value,
					code: "not_multiple_of",
					divisor: def.value,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckNumberFormat = /*@__PURE__*/ $constructor("$ZodCheckNumberFormat", (inst, def) => {
			$ZodCheck.init(inst, def);
			def.format = def.format || "float64";
			const isInt = def.format?.includes("int");
			const origin = isInt ? "int" : "number";
			const [minimum, maximum] = NUMBER_FORMAT_RANGES[def.format];
			inst._zod.check = (payload) => {
				const input = payload.value;
				if (isInt) {
					if (!Number.isInteger(input)) {
						payload.issues.push({
							expected: origin,
							format: def.format,
							code: "invalid_type",
							continue: false,
							input,
							inst
						});
						return;
					}
					if (!Number.isSafeInteger(input)) {
						if (input > 0) payload.issues.push({
							input,
							code: "too_big",
							maximum: Number.MAX_SAFE_INTEGER,
							note: "Integers must be within the safe integer range.",
							inst,
							origin,
							inclusive: true,
							continue: !def.abort
						});
						else payload.issues.push({
							input,
							code: "too_small",
							minimum: Number.MIN_SAFE_INTEGER,
							note: "Integers must be within the safe integer range.",
							inst,
							origin,
							inclusive: true,
							continue: !def.abort
						});
						return;
					}
				}
				if (input < minimum) payload.issues.push({
					origin: "number",
					input,
					code: "too_small",
					minimum,
					inclusive: true,
					inst,
					continue: !def.abort
				});
				if (input > maximum) payload.issues.push({
					origin: "number",
					input,
					code: "too_big",
					maximum,
					inclusive: true,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckMaxLength = /*@__PURE__*/ $constructor("$ZodCheckMaxLength", (inst, def) => {
			var _a;
			$ZodCheck.init(inst, def);
			(_a = inst._zod.def).when ?? (_a.when = _whenHasLength);
			inst._zod.check = (payload) => {
				const input = payload.value;
				const units = input.length;
				if ((typeof input === "string" && units > def.maximum ? codePointLength(input) : units) <= def.maximum) return;
				const origin = getLengthableOrigin(input);
				payload.issues.push({
					origin,
					code: "too_big",
					maximum: def.maximum,
					inclusive: true,
					input,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckMinLength = /*@__PURE__*/ $constructor("$ZodCheckMinLength", (inst, def) => {
			var _a;
			$ZodCheck.init(inst, def);
			(_a = inst._zod.def).when ?? (_a.when = _whenHasLength);
			inst._zod.check = (payload) => {
				const input = payload.value;
				const units = input.length;
				if ((typeof input === "string" && units >= def.minimum && units < def.minimum * 2 ? codePointLength(input) : units) >= def.minimum) return;
				const origin = getLengthableOrigin(input);
				payload.issues.push({
					origin,
					code: "too_small",
					minimum: def.minimum,
					inclusive: true,
					input,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckLengthEquals = /*@__PURE__*/ $constructor("$ZodCheckLengthEquals", (inst, def) => {
			var _a;
			$ZodCheck.init(inst, def);
			(_a = inst._zod.def).when ?? (_a.when = _whenHasLength);
			inst._zod.check = (payload) => {
				const input = payload.value;
				const units = input.length;
				const length = typeof input === "string" && units >= def.length && units <= def.length * 2 ? codePointLength(input) : units;
				if (length === def.length) return;
				const origin = getLengthableOrigin(input);
				const tooBig = length > def.length;
				payload.issues.push({
					origin,
					...tooBig ? {
						code: "too_big",
						maximum: def.length
					} : {
						code: "too_small",
						minimum: def.length
					},
					inclusive: true,
					exact: true,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckStringFormat = /*@__PURE__*/ $constructor("$ZodCheckStringFormat", (inst, def) => {
			var _a, _b;
			$ZodCheck.init(inst, def);
			if (def.pattern) (_a = inst._zod).check ?? (_a.check = (payload) => {
				def.pattern.lastIndex = 0;
				if (def.pattern.test(payload.value)) return;
				payload.issues.push({
					origin: "string",
					code: "invalid_format",
					format: def.format,
					input: payload.value,
					...def.pattern ? { pattern: def.pattern.toString() } : {},
					inst,
					continue: !def.abort
				});
			});
			else (_b = inst._zod).check ?? (_b.check = () => {});
		});
		const $ZodCheckRegex = /*@__PURE__*/ $constructor("$ZodCheckRegex", (inst, def) => {
			$ZodCheckStringFormat.init(inst, def);
			inst._zod.check = (payload) => {
				def.pattern.lastIndex = 0;
				if (def.pattern.test(payload.value)) return;
				payload.issues.push({
					origin: "string",
					code: "invalid_format",
					format: "regex",
					input: payload.value,
					pattern: def.pattern.toString(),
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckLowerCase = /*@__PURE__*/ $constructor("$ZodCheckLowerCase", (inst, def) => {
			def.pattern ?? (def.pattern = lowercase);
			$ZodCheckStringFormat.init(inst, def);
		});
		const $ZodCheckUpperCase = /*@__PURE__*/ $constructor("$ZodCheckUpperCase", (inst, def) => {
			def.pattern ?? (def.pattern = uppercase);
			$ZodCheckStringFormat.init(inst, def);
		});
		const $ZodCheckIncludes = /*@__PURE__*/ $constructor("$ZodCheckIncludes", (inst, def) => {
			$ZodCheck.init(inst, def);
			const escapedRegex = escapeRegex(def.includes);
			def.pattern = new RegExp(typeof def.position === "number" ? `^.{${def.position},}${escapedRegex}` : escapedRegex);
			inst._zod.check = (payload) => {
				if (payload.value.includes(def.includes, def.position)) return;
				payload.issues.push({
					origin: "string",
					code: "invalid_format",
					format: "includes",
					includes: def.includes,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckStartsWith = /*@__PURE__*/ $constructor("$ZodCheckStartsWith", (inst, def) => {
			$ZodCheck.init(inst, def);
			const pattern = new RegExp(`^${escapeRegex(def.prefix)}.*`);
			def.pattern ?? (def.pattern = pattern);
			inst._zod.check = (payload) => {
				if (payload.value.startsWith(def.prefix)) return;
				payload.issues.push({
					origin: "string",
					code: "invalid_format",
					format: "starts_with",
					prefix: def.prefix,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckEndsWith = /*@__PURE__*/ $constructor("$ZodCheckEndsWith", (inst, def) => {
			$ZodCheck.init(inst, def);
			const pattern = new RegExp(`.*${escapeRegex(def.suffix)}$`);
			def.pattern ?? (def.pattern = pattern);
			inst._zod.check = (payload) => {
				if (payload.value.endsWith(def.suffix)) return;
				payload.issues.push({
					origin: "string",
					code: "invalid_format",
					format: "ends_with",
					suffix: def.suffix,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckOverwrite = /*@__PURE__*/ $constructor("$ZodCheckOverwrite", (inst, def) => {
			$ZodCheck.init(inst, def);
			inst._zod.check = (payload) => {
				payload.value = def.tx(payload.value);
			};
		});
		//#endregion
		//#region node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/core/doc.js
		var Doc = class {
			constructor(args = [], closed = {}) {
				this.content = [];
				this.indent = 0;
				this.args = args;
				this.closed = closed;
			}
			indented(fn) {
				this.indent += 1;
				try {
					fn(this);
				} finally {
					this.indent -= 1;
				}
			}
			write(arg) {
				if (typeof arg === "function") {
					arg(this, { execution: "sync" });
					arg(this, { execution: "async" });
					return;
				}
				const lines = arg.split("\n").filter((x) => x);
				const minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length));
				const dedented = lines.map((x) => x.slice(minIndent)).map((x) => " ".repeat(this.indent * 2) + x);
				for (const line of dedented) this.content.push(line);
			}
			compile() {
				const F = Function;
				const content = this?.content ?? [``];
				return new F(...Object.keys(this.closed), `return function (${this.args.join(", ")}) {\n${content.join("\n")}\n};`)(...Object.values(this.closed));
			}
		};
		//#endregion
		//#region node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/core/versions.js
		const version = {
			major: 4,
			minor: 6,
			patch: 5
		};
		//#endregion
		//#region node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/core/schemas.js
		const $ZodType = /*@__PURE__*/ $constructor("$ZodType", (inst, def) => {
			var _a;
			inst ?? (inst = {});
			inst._zod.def = def;
			inst._zod.bag = inst._zod.bag || {};
			inst._zod.version = version;
			const defChecks = inst._zod.def.checks;
			const checks = inst._zod.traits.has("$ZodCheck") ? [inst, ...defChecks ?? []] : defChecks?.length ? [...defChecks] : [];
			for (const ch of checks) for (const fn of ch._zod.onattach) fn(inst);
			if (checks.length === 0) {
				(_a = inst._zod).deferred ?? (_a.deferred = []);
				inst._zod.deferred?.push(() => {
					inst._zod.run = inst._zod.parse;
				});
			} else {
				const runChecks = (payload, checks, ctx) => {
					if (payload.memo) return payload;
					let isAborted = aborted(payload);
					let asyncResult;
					for (const ch of checks) {
						if (ch._zod.def.when) {
							if (explicitlyAborted(payload)) continue;
							if (!ch._zod.def.when(payload)) continue;
						} else if (isAborted) continue;
						const currLen = payload.issues.length;
						const _ = ch._zod.check(payload);
						if (_ instanceof Promise && ctx?.async === false) throw new $ZodAsyncError();
						if (asyncResult || _ instanceof Promise) asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
							await _;
							if (payload.issues.length === currLen) return;
							attachSchema(payload.issues, currLen, inst);
							if (!isAborted) isAborted = aborted(payload, currLen);
						});
						else {
							if (payload.issues.length === currLen) continue;
							attachSchema(payload.issues, currLen, inst);
							if (!isAborted) isAborted = aborted(payload, currLen);
						}
					}
					if (asyncResult) return asyncResult.then(() => {
						return payload;
					});
					return payload;
				};
				const handleCanaryResult = (canary, payload, ctx) => {
					if (aborted(canary)) {
						canary.aborted = true;
						return canary;
					}
					const checkResult = runChecks(payload, checks, ctx);
					if (checkResult instanceof Promise) {
						if (ctx.async === false) throw new $ZodAsyncError();
						return checkResult.then((checkResult) => inst._zod.parse(checkResult, ctx));
					}
					return inst._zod.parse(checkResult, ctx);
				};
				inst._zod.run = (payload, ctx) => {
					if (ctx.skipChecks) return inst._zod.parse(payload, ctx);
					if (ctx.direction === "backward") {
						const canary = inst._zod.parse({
							value: payload.value,
							issues: []
						}, {
							...ctx,
							skipChecks: true
						});
						if (canary instanceof Promise) return canary.then((canary) => {
							return handleCanaryResult(canary, payload, ctx);
						});
						return handleCanaryResult(canary, payload, ctx);
					}
					const result = inst._zod.parse(payload, ctx);
					if (result instanceof Promise) {
						if (ctx.async === false) throw new $ZodAsyncError();
						return result.then((result) => runChecks(result, checks, ctx));
					}
					return runChecks(result, checks, ctx);
				};
			}
		}, {
			get "~standard"() {
				return hide(this, "~standard", standardProps(this));
			},
			set "~standard"(value) {
				own(this, "~standard", value);
			}
		});
		/** The Standard Schema surface for `inst`. Shared so wrappers can extend it without forcing it. */
		const toStandardResult = (r, ctx) => r.issues.length ? { issues: r.issues.map((iss) => finalizeIssue(iss, ctx, config())) } : { value: r.value };
		async function validateAsync(inst, value) {
			const ctx = { async: true };
			return toStandardResult(await inst._zod.run({
				value,
				issues: []
			}, ctx), ctx);
		}
		function standardProps(inst) {
			return {
				validate: (value) => {
					const ctx = { async: false };
					try {
						const r = inst._zod.run({
							value,
							issues: []
						}, ctx);
						if (!(r instanceof Promise)) return toStandardResult(r, ctx);
					} catch (_) {}
					return validateAsync(inst, value);
				},
				vendor: "zod",
				version: 1
			};
		}
		const $ZodString = /*@__PURE__*/ $constructor("$ZodString", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.pattern = def.pattern ?? anyString;
			inst._zod.parse = (payload, _) => {
				if (def.coerce) try {
					payload.value = String(payload.value);
				} catch (_) {}
				if (typeof payload.value === "string") return payload;
				payload.issues.push({
					expected: "string",
					code: "invalid_type",
					input: payload.value,
					inst
				});
				return payload;
			};
		});
		const $ZodStringFormat = /*@__PURE__*/ $constructor("$ZodStringFormat", (inst, def) => {
			$ZodCheckStringFormat.init(inst, def);
			$ZodString.init(inst, def);
		});
		const $ZodGUID = /*@__PURE__*/ $constructor("$ZodGUID", (inst, def) => {
			def.pattern ?? (def.pattern = guid);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodUUID = /*@__PURE__*/ $constructor("$ZodUUID", (inst, def) => {
			if (def.version) {
				const v = {
					v1: 1,
					v2: 2,
					v3: 3,
					v4: 4,
					v5: 5,
					v6: 6,
					v7: 7,
					v8: 8
				}[def.version];
				if (v === void 0) throw new Error(`Invalid UUID version: "${def.version}"`);
				def.pattern ?? (def.pattern = uuid(v));
			} else def.pattern ?? (def.pattern = uuid());
			$ZodStringFormat.init(inst, def);
		});
		const $ZodEmail = /*@__PURE__*/ $constructor("$ZodEmail", (inst, def) => {
			def.pattern ?? (def.pattern = email);
			$ZodStringFormat.init(inst, def);
		});
		function canParseURL(input) {
			try {
				if (typeof URL !== "undefined" && typeof URL.canParse === "function") return URL.canParse(input);
				new URL(input);
				return true;
			} catch {
				return false;
			}
		}
		function validateURL(trimmed, def) {
			if (!("normalize" in def) && !("hostname" in def) && !("protocol" in def)) return canParseURL(trimmed) || 2;
			return parseURLObject(trimmed, def);
		}
		/** Parses a URL while preserving the non-normalizing HTTP guard. */
		function parseURLObject(trimmed, def) {
			if (!def.normalize && def.protocol?.source === httpProtocol.source && !/^https?:\/\//i.test(trimmed)) return 1;
			try {
				if (typeof URL !== "undefined") {
					const URLStatic = URL;
					if (typeof URLStatic.parse === "function") return URLStatic.parse(trimmed) ?? 2;
				}
				return new URL(trimmed);
			} catch {
				return 2;
			}
		}
		const asciiTabOrNewline = /[\t\n\r]/g;
		/** The URL parser deletes every ASCII tab, LF and CR from its input before it parses, so `new URL("https://exa\nmple.com")` reports on `example.com`. Applying the same deletion to the returned value closes the half of that divergence which can move the host; the parser's other rewrite, stripping C0 controls at the edges, cannot. */
		function stripTabAndNewline(value) {
			return value.replace(asciiTabOrNewline, "");
		}
		function urlHostnameOk(url, hostname) {
			hostname.lastIndex = 0;
			return hostname.test(url.hostname);
		}
		function urlProtocolOk(url, protocol) {
			protocol.lastIndex = 0;
			return protocol.test(url.protocol.endsWith(":") ? url.protocol.slice(0, -1) : url.protocol);
		}
		const $ZodURL = /*@__PURE__*/ $constructor("$ZodURL", (inst, def) => {
			$ZodStringFormat.init(inst, def);
			inst._zod.check = (payload) => {
				try {
					const trimmed = payload.value.trim();
					const url = validateURL(trimmed, def);
					if (url === 1) {
						payload.issues.push({
							code: "invalid_format",
							format: "url",
							note: "Invalid URL format",
							input: payload.value,
							inst,
							continue: !def.abort
						});
						return;
					}
					if (url === 2) {
						payload.issues.push({
							code: "invalid_format",
							format: "url",
							input: payload.value,
							inst,
							continue: !def.abort
						});
						return;
					}
					if (url === true) {
						payload.value = stripTabAndNewline(trimmed);
						return;
					}
					if (def.hostname && !urlHostnameOk(url, def.hostname)) payload.issues.push({
						code: "invalid_format",
						format: "url",
						note: "Invalid hostname",
						pattern: def.hostname.source,
						input: payload.value,
						inst,
						continue: !def.abort
					});
					if (def.protocol && !urlProtocolOk(url, def.protocol)) payload.issues.push({
						code: "invalid_format",
						format: "url",
						note: "Invalid protocol",
						pattern: def.protocol.source,
						input: payload.value,
						inst,
						continue: !def.abort
					});
					payload.value = def.normalize ? url.href : stripTabAndNewline(trimmed);
					return;
				} catch (_) {
					payload.issues.push({
						code: "invalid_format",
						format: "url",
						input: payload.value,
						inst,
						continue: !def.abort
					});
				}
			};
		});
		const $ZodEmoji = /*@__PURE__*/ $constructor("$ZodEmoji", (inst, def) => {
			def.pattern ?? (def.pattern = emoji());
			$ZodStringFormat.init(inst, def);
		});
		const $ZodNanoID = /*@__PURE__*/ $constructor("$ZodNanoID", (inst, def) => {
			if (def.length !== void 0 && (!Number.isInteger(def.length) || def.length < 1)) throw new Error(`Invalid nanoid length: ${def.length}`);
			def.pattern ?? (def.pattern = def.length === void 0 ? nanoid : nanoidOfLength(def.length));
			$ZodStringFormat.init(inst, def);
		});
		/**
		* @deprecated CUID v1 is deprecated by its authors due to information leakage
		* (timestamps embedded in the id). Use {@link $ZodCUID2} instead.
		* See https://github.com/paralleldrive/cuid.
		*/
		const $ZodCUID = /*@__PURE__*/ $constructor("$ZodCUID", (inst, def) => {
			def.pattern ?? (def.pattern = cuid);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodCUID2 = /*@__PURE__*/ $constructor("$ZodCUID2", (inst, def) => {
			def.pattern ?? (def.pattern = cuid2);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodULID = /*@__PURE__*/ $constructor("$ZodULID", (inst, def) => {
			def.pattern ?? (def.pattern = ulid);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodXID = /*@__PURE__*/ $constructor("$ZodXID", (inst, def) => {
			def.pattern ?? (def.pattern = xid);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodKSUID = /*@__PURE__*/ $constructor("$ZodKSUID", (inst, def) => {
			def.pattern ?? (def.pattern = ksuid);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodISODateTime = /*@__PURE__*/ $constructor("$ZodISODateTime", (inst, def) => {
			def.pattern ?? (def.pattern = datetime(def));
			$ZodStringFormat.init(inst, def);
		});
		const $ZodISODate = /*@__PURE__*/ $constructor("$ZodISODate", (inst, def) => {
			def.pattern ?? (def.pattern = date);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodISOTime = /*@__PURE__*/ $constructor("$ZodISOTime", (inst, def) => {
			def.pattern ?? (def.pattern = time(def));
			$ZodStringFormat.init(inst, def);
		});
		const $ZodISODuration = /*@__PURE__*/ $constructor("$ZodISODuration", (inst, def) => {
			def.pattern ?? (def.pattern = duration);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodIPv4 = /*@__PURE__*/ $constructor("$ZodIPv4", (inst, def) => {
			def.pattern ?? (def.pattern = ipv4);
			$ZodStringFormat.init(inst, def);
		});
		/** An IPv6 address is written with hex digits, colons and dots, and nothing else. The guard is what makes the check below an IPv6 check: `new URL("http://[...]")` parses an authority, not an address, so `@` and `\` re-delimit it and `"::@1\\"` validates against the host `0.0.0.1`. The URL parser also deletes ASCII tab, LF and CR rather than failing, which is how `"::1\n"` validated as `::1`. */
		const ipv6Alphabet = /^[0-9a-fA-F:.]+$/;
		function isValidIPv6(value) {
			if (!ipv6Alphabet.test(value)) return false;
			return canParseURL(`http://[${value}]`);
		}
		const $ZodIPv6 = /*@__PURE__*/ $constructor("$ZodIPv6", (inst, def) => {
			def.pattern ?? (def.pattern = ipv6);
			$ZodStringFormat.init(inst, def);
			inst._zod.check = (payload) => {
				if (!isValidIPv6(payload.value)) payload.issues.push({
					code: "invalid_format",
					format: "ipv6",
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCIDRv4 = /*@__PURE__*/ $constructor("$ZodCIDRv4", (inst, def) => {
			def.pattern ?? (def.pattern = cidrv4);
			$ZodStringFormat.init(inst, def);
		});
		function isValidCIDRv6(value) {
			const parts = value.split("/");
			if (parts.length !== 2) return false;
			const [address, prefix] = parts;
			if (!prefix) return false;
			const prefixNum = Number(prefix);
			if (`${prefixNum}` !== prefix) return false;
			if (prefixNum < 0 || prefixNum > 128) return false;
			return isValidIPv6(address);
		}
		const $ZodCIDRv6 = /*@__PURE__*/ $constructor("$ZodCIDRv6", (inst, def) => {
			def.pattern ?? (def.pattern = cidrv6);
			$ZodStringFormat.init(inst, def);
			inst._zod.check = (payload) => {
				if (!isValidCIDRv6(payload.value)) payload.issues.push({
					code: "invalid_format",
					format: "cidrv6",
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		function isValidBase64(data) {
			if (data === "") return true;
			if (/\s/.test(data)) return false;
			if (data.length % 4 !== 0) return false;
			try {
				atob(data);
				return true;
			} catch {
				return false;
			}
		}
		const base64Charset = /^[0-9a-zA-Z+/]*={0,2}$/;
		const $ZodBase64 = /*@__PURE__*/ $constructor("$ZodBase64", (inst, def) => {
			def.pattern ?? (def.pattern = base64Charset);
			$ZodStringFormat.init(inst, def);
			inst._zod.check = (payload) => {
				if (isValidBase64(payload.value)) return;
				payload.issues.push({
					code: "invalid_format",
					format: "base64",
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const base64urlCharset = /^[A-Za-z0-9_-]*$/;
		function isValidBase64URL(data) {
			if (!base64urlCharset.test(data)) return false;
			const base64 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
			return isValidBase64(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
		}
		const $ZodBase64URL = /*@__PURE__*/ $constructor("$ZodBase64URL", (inst, def) => {
			def.pattern ?? (def.pattern = base64urlCharset);
			$ZodStringFormat.init(inst, def);
			inst._zod.check = (payload) => {
				if (isValidBase64URL(payload.value)) return;
				payload.issues.push({
					code: "invalid_format",
					format: "base64url",
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodE164 = /*@__PURE__*/ $constructor("$ZodE164", (inst, def) => {
			def.pattern ?? (def.pattern = e164);
			$ZodStringFormat.init(inst, def);
		});
		function isValidJWT(token, algorithm = null) {
			try {
				const tokensParts = token.split(".");
				if (tokensParts.length !== 3) return false;
				const [header] = tokensParts;
				if (!header) return false;
				const parsedHeader = JSON.parse(atob(header));
				if ("typ" in parsedHeader && parsedHeader?.typ !== "JWT") return false;
				if (!parsedHeader.alg) return false;
				if (algorithm && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm)) return false;
				return true;
			} catch {
				return false;
			}
		}
		const $ZodJWT = /*@__PURE__*/ $constructor("$ZodJWT", (inst, def) => {
			$ZodStringFormat.init(inst, def);
			inst._zod.check = (payload) => {
				if (isValidJWT(payload.value, def.alg)) return;
				payload.issues.push({
					code: "invalid_format",
					format: "jwt",
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodNumber = /*@__PURE__*/ $constructor("$ZodNumber", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.pattern = number$1;
			inst._zod.parse = (payload, _ctx) => {
				if (def.coerce) try {
					payload.value = Number(payload.value);
				} catch (_) {}
				const input = payload.value;
				if (typeof input === "number" && !Number.isNaN(input) && Number.isFinite(input)) return payload;
				const received = typeof input === "number" ? Number.isNaN(input) ? "NaN" : !Number.isFinite(input) ? String(input) : void 0 : void 0;
				payload.issues.push({
					expected: "number",
					code: "invalid_type",
					input,
					inst,
					...received ? { received } : {}
				});
				return payload;
			};
		});
		const $ZodNumberFormat = /*@__PURE__*/ $constructor("$ZodNumberFormat", (inst, def) => {
			$ZodCheckNumberFormat.init(inst, def);
			$ZodNumber.init(inst, def);
		});
		const $ZodBoolean = /*@__PURE__*/ $constructor("$ZodBoolean", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.pattern = boolean$1;
			inst._zod.parse = (payload, _ctx) => {
				if (def.coerce) try {
					payload.value = Boolean(payload.value);
				} catch (_) {}
				const input = payload.value;
				if (typeof input === "boolean") return payload;
				payload.issues.push({
					expected: "boolean",
					code: "invalid_type",
					input,
					inst
				});
				return payload;
			};
		});
		const $ZodUnknown = /*@__PURE__*/ $constructor("$ZodUnknown", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.parse = (payload) => payload;
		});
		const $ZodNever = /*@__PURE__*/ $constructor("$ZodNever", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.parse = (payload, _ctx) => {
				payload.issues.push({
					expected: "never",
					code: "invalid_type",
					input: payload.value,
					inst
				});
				return payload;
			};
		});
		function handleArrayResult(result, final, index) {
			if (result.issues.length) final.issues.push(...prefixIssues(index, result.issues));
			final.value[index] = result.value;
		}
		const $ZodArray = /*@__PURE__*/ $constructor("$ZodArray", (inst, def) => {
			$ZodType.init(inst, def);
			const memo = globalConfig.memoizer;
			memo?.attach(inst);
			inst._zod.parse = (payload, ctx) => {
				const input = payload.value;
				if (!Array.isArray(input)) {
					payload.issues.push({
						expected: "array",
						code: "invalid_type",
						input,
						inst
					});
					return payload;
				}
				payload.value = memo ? memo.alloc(inst, payload, Array(input.length), ctx) : Array(input.length);
				const proms = [];
				const abortEarly = ctx?.abortEarly;
				for (let i = 0; i < input.length; i++) {
					const item = input[i];
					const result = def.element._zod.run({
						value: item,
						issues: []
					}, ctx);
					if (result instanceof Promise) proms.push(result.then((result) => handleArrayResult(result, payload, i)));
					else {
						handleArrayResult(result, payload, i);
						if (abortEarly && result.issues.length !== 0 && aborted(result)) break;
					}
				}
				if (proms.length) return Promise.all(proms).then(() => payload);
				return payload;
			};
		});
		function handlePropertyResult(result, final, key, input, optin, optout) {
			const isPresent = key in input;
			const isOptionalOut = optout === "optional";
			if (!isPresent && isOptionalOut && optin === "optional") return;
			if (result.issues.length) {
				if (optin !== void 0 && isOptionalOut && !isPresent) return;
				final.issues.push(...prefixIssues(key, result.issues));
			}
			if (!isPresent && optin === void 0) {
				if (!result.issues.length) final.issues.push({
					code: "invalid_type",
					expected: "nonoptional",
					input: void 0,
					path: [key]
				});
				return;
			}
			if (result.value === void 0) {
				if (isPresent || optin === "defaulted" && !isOptionalOut) final.value[key] = void 0;
			} else final.value[key] = result.value;
		}
		const NO_SYMBOL_KEYS = [];
		function normalizeDef(def) {
			const keys = Object.keys(def.shape);
			const ownSymbols = Object.getOwnPropertySymbols(def.shape);
			const symbolKeys = ownSymbols.length ? ownSymbols : NO_SYMBOL_KEYS;
			const allKeys = symbolKeys.length ? [...keys, ...symbolKeys] : keys;
			for (const k of allKeys) if (!def.shape?.[k]?._zod?.traits?.has("$ZodType")) throw new Error(`Invalid element at key "${String(k)}": expected a Zod schema`);
			const okeys = optionalKeys(def.shape);
			return {
				...def,
				allKeys,
				symbolKeys,
				keySet: new Set(keys),
				numKeys: keys.length,
				optionalKeys: new Set(okeys)
			};
		}
		function handleCatchall(proms, input, payload, ctx, def, inst, abortEarly) {
			const unrecognized = [];
			const keySet = def.keySet;
			const _catchall = def.catchall._zod;
			const t = _catchall.def.type;
			const optin = _catchall.optin;
			const optout = _catchall.optout;
			let seen = 0;
			for (const key in input) {
				if (abortEarly && payload.issues.length !== seen) {
					if (aborted(payload, seen)) break;
					seen = payload.issues.length;
				}
				if (keySet.has(key)) continue;
				if (key === "__proto__") {
					if (t === "never") unrecognized.push(key);
					continue;
				}
				if (t === "never") {
					unrecognized.push(key);
					continue;
				}
				const r = _catchall.run({
					value: input[key],
					issues: []
				}, ctx);
				if (r instanceof Promise) proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, optin, optout)));
				else handlePropertyResult(r, payload, key, input, optin, optout);
			}
			if (unrecognized.length) payload.issues.push({
				code: "unrecognized_keys",
				keys: unrecognized,
				input,
				inst,
				continue: true
			});
			if (!proms.length) return payload;
			return Promise.all(proms).then(() => {
				return payload;
			});
		}
		const $ZodObject = /*@__PURE__*/ $constructor("$ZodObject", (inst, def) => {
			$ZodType.init(inst, def);
			const desc = Object.getOwnPropertyDescriptor(def, "shape");
			const sh = desc?.get ? desc.get.raw : def.shape ?? {};
			if (sh) {
				const get = () => {
					const newSh = { ...sh };
					Object.defineProperty(def, "shape", { value: newSh });
					get.raw = newSh;
					return newSh;
				};
				get.raw = sh;
				Object.defineProperty(def, "shape", { get });
			}
			const _normalized = cached(() => normalizeDef(def));
			defineLazyInternal(inst, "propValues", (zod) => {
				const shape = zod.def.shape;
				const propValues = {};
				for (const key in shape) {
					const field = shape[key]._zod;
					if (field.values) {
						if (!Object.prototype.hasOwnProperty.call(propValues, key)) assignProp(propValues, key, /* @__PURE__ */ new Set());
						for (const v of field.values) propValues[key].add(v);
						if (field.optin !== void 0) propValues[key].add(void 0);
					}
				}
				return propValues;
			});
			const isObject$2 = isObject;
			const catchall = def.catchall;
			let value;
			const memo = globalConfig.memoizer;
			memo?.attach(inst);
			inst._zod.parse = (payload, ctx) => {
				value ?? (value = _normalized.value);
				const input = payload.value;
				if (!isObject$2(input)) {
					payload.issues.push({
						expected: "object",
						code: "invalid_type",
						input,
						inst
					});
					return payload;
				}
				payload.value = memo ? memo.alloc(inst, payload, {}, ctx) : {};
				const proms = [];
				const shape = value.shape;
				const abortEarly = ctx?.abortEarly;
				let seen = payload.issues.length;
				for (const key of value.allKeys) {
					if (abortEarly && payload.issues.length !== seen) {
						if (aborted(payload, seen)) break;
						seen = payload.issues.length;
					}
					if (key === "__proto__") continue;
					const el = shape[key];
					const optin = el._zod.optin;
					const optout = el._zod.optout;
					const r = el._zod.run({
						value: input[key],
						issues: []
					}, ctx);
					if (r instanceof Promise) proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, optin, optout)));
					else handlePropertyResult(r, payload, key, input, optin, optout);
				}
				if (!catchall) return proms.length ? Promise.all(proms).then(() => payload) : payload;
				return handleCatchall(proms, input, payload, ctx, _normalized.value, inst, abortEarly === true);
			};
		});
		const $ZodObjectJIT = /*@__PURE__*/ $constructor("$ZodObjectJIT", (inst, def) => {
			$ZodObject.init(inst, def);
			const superParse = inst._zod.parse;
			const _normalized = cached(() => normalizeDef(def));
			const memo = globalConfig.memoizer;
			const generateFastpass = (shape) => {
				const normalized = _normalized.value;
				const syms = normalized.symbolKeys;
				const doc = new Doc(["payload", "ctx"], {
					shape,
					inst,
					memo,
					syms
				});
				const parseStr = (k) => `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
				const prefixStr = (id, k) => `
          let ${id}_ab = false;
          for (let i = 0; i < ${id}.issues.length; i++) {
            const iss = ${id}.issues[i];
            iss.path = iss.path ? [${k}, ...iss.path] : [${k}];
            payload.issues.push(iss);
            if (iss.continue !== true) ${id}_ab = true;
          }
          if (${id}_ab && ctx && ctx.abortEarly) {
            payload.value = newResult;
            return payload;
          }`;
				doc.write(`const input = payload.value;`);
				const ids = Object.create(null);
				let counter = 0;
				for (const key of normalized.allKeys) ids[key] = `key_${counter++}`;
				doc.write(memo ? `const newResult = memo.alloc(inst, payload, {}, ctx);` : `const newResult = {};`);
				for (const key of normalized.allKeys) {
					if (key === "__proto__") continue;
					const id = ids[key];
					const k = typeof key === "symbol" ? `syms[${syms.indexOf(key)}]` : esc(key);
					const isPresent = `${k} in input`;
					const schema = shape[key];
					const optin = schema?._zod?.optin;
					const isOptionalIn = optin !== void 0;
					const isOptionalOut = schema?._zod?.optout === "optional";
					doc.write(`const ${id} = ${parseStr(k)};`);
					if (isOptionalIn && isOptionalOut) {
						const assign = optin === "optional" ? `${id}_present` : `${id}.value !== undefined || ${id}_present`;
						doc.write(`
        const ${id}_present = ${isPresent};
        if (!${id}.issues.length || ${id}_present) {
          if (${id}.issues.length) {${prefixStr(id, k)}
          }

          if (${assign}) {
            newResult[${k}] = ${id}.value;
          }
        }

      `);
					} else if (!isOptionalIn) doc.write(`
        const ${id}_present = ${isPresent};
        if (${id}.issues.length) {${prefixStr(id, k)}
        }
        if (!${id}_present && !${id}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${k}]
          });
          if (ctx && ctx.abortEarly) {
            payload.value = newResult;
            return payload;
          }
        }

        if (${id}_present) {
          newResult[${k}] = ${id}.value;
        }

      `);
					else {
						doc.write(`
        if (${id}.issues.length) {${prefixStr(id, k)}
        }
      `);
						if (optin === "defaulted") doc.write(`newResult[${k}] = ${id}.value;`);
						else doc.write(`
        if (${id}.value !== undefined || ${isPresent}) {
          newResult[${k}] = ${id}.value;
        }
      `);
					}
				}
				doc.write(`payload.value = newResult;`);
				doc.write(`return payload;`);
				return doc.compile();
			};
			let fastpass;
			const isObject$1 = isObject;
			const jit = !globalConfig.jitless;
			const fastEnabled = jit && allowsEval.value;
			const catchall = def.catchall;
			let value;
			inst._zod.parse = (payload, ctx) => {
				value ?? (value = _normalized.value);
				const input = payload.value;
				if (!isObject$1(input)) {
					payload.issues.push({
						expected: "object",
						code: "invalid_type",
						input,
						inst
					});
					return payload;
				}
				if (jit && fastEnabled && ctx?.async === false && ctx.jitless !== true) {
					if (!fastpass) fastpass = generateFastpass(def.shape);
					payload = fastpass(payload, ctx);
					if (!catchall) return payload;
					return handleCatchall([], input, payload, ctx, value, inst, ctx?.abortEarly === true);
				}
				return superParse(payload, ctx);
			};
		});
		function handleUnionResults(results, final, inst, ctx) {
			for (const result of results) if (result.issues.length === 0) {
				final.value = result.value;
				return final;
			}
			const nonaborted = results.filter((r) => !aborted(r));
			if (nonaborted.length === 1) {
				final.value = nonaborted[0].value;
				return nonaborted[0];
			}
			final.issues.push({
				code: "invalid_union",
				input: final.value,
				inst,
				errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
			});
			return final;
		}
		const $ZodUnion = /*@__PURE__*/ $constructor("$ZodUnion", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazyInternal(inst, "optin", (zod) => zod.def.options.some((o) => o._zod.optin === "defaulted") ? "defaulted" : zod.def.options.some((o) => o._zod.optin !== void 0) ? "optional" : void 0);
			defineLazyInternal(inst, "optout", (zod) => zod.def.options.some((o) => o._zod.optout === "optional") ? "optional" : void 0);
			defineLazyInternal(inst, "values", (zod) => {
				if (zod.def.options.every((o) => o._zod.values)) return new Set(zod.def.options.flatMap((option) => Array.from(option._zod.values)));
			});
			defineLazyInternal(inst, "pattern", (zod) => {
				if (zod.def.options.every((o) => o._zod.pattern)) {
					const patterns = zod.def.options.map((o) => o._zod.pattern);
					return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
				}
			});
			const first = def.options.length === 1 ? def.options[0]._zod.run : null;
			inst._zod.parse = (payload, ctx) => {
				if (first) return first(payload, ctx);
				let async = false;
				const results = [];
				for (const option of def.options) {
					const result = option._zod.run({
						value: payload.value,
						issues: []
					}, ctx);
					if (result instanceof Promise) {
						results.push(result);
						async = true;
					} else {
						if (result.issues.length === 0) return result;
						results.push(result);
					}
				}
				if (!async) return handleUnionResults(results, payload, inst, ctx);
				return Promise.all(results).then((results) => {
					return handleUnionResults(results, payload, inst, ctx);
				});
			};
		});
		const $ZodIntersection = /*@__PURE__*/ $constructor("$ZodIntersection", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.parse = (payload, ctx) => {
				const input = payload.value;
				const left = def.left._zod.run({
					value: input,
					issues: []
				}, ctx);
				const right = def.right._zod.run({
					value: input,
					issues: []
				}, ctx);
				if (left instanceof Promise || right instanceof Promise) return Promise.all([left, right]).then(([left, right]) => {
					return handleIntersectionResults(payload, left, right);
				});
				return handleIntersectionResults(payload, left, right);
			};
		});
		function mergeValues(a, b) {
			if (a === b) return {
				valid: true,
				data: a
			};
			if (a instanceof Date && b instanceof Date && +a === +b) return {
				valid: true,
				data: a
			};
			if (isPlainObject(a) && isPlainObject(b)) {
				const bKeys = Object.keys(b);
				const sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1);
				const newObj = {
					...a,
					...b
				};
				if (Object.prototype.hasOwnProperty.call(newObj, "__proto__")) delete newObj.__proto__;
				for (const key of sharedKeys) {
					if (key === "__proto__") continue;
					const sharedValue = mergeValues(a[key], b[key]);
					if (!sharedValue.valid) return {
						valid: false,
						mergeErrorPath: [key, ...sharedValue.mergeErrorPath]
					};
					newObj[key] = sharedValue.data;
				}
				return {
					valid: true,
					data: newObj
				};
			}
			if (Array.isArray(a) && Array.isArray(b)) {
				if (a.length !== b.length) return {
					valid: false,
					mergeErrorPath: []
				};
				const newArray = [];
				for (let index = 0; index < a.length; index++) {
					const itemA = a[index];
					const itemB = b[index];
					const sharedValue = mergeValues(itemA, itemB);
					if (!sharedValue.valid) return {
						valid: false,
						mergeErrorPath: [index, ...sharedValue.mergeErrorPath]
					};
					newArray.push(sharedValue.data);
				}
				return {
					valid: true,
					data: newArray
				};
			}
			return {
				valid: false,
				mergeErrorPath: []
			};
		}
		function handleIntersectionResults(result, left, right) {
			const unrecKeys = /* @__PURE__ */ new Map();
			let unrecIssue;
			const keyIssues = /* @__PURE__ */ new Map();
			const collect = (iss, side) => {
				let keys;
				if (iss.code === "unrecognized_keys" && !iss.path?.length) {
					unrecIssue ?? (unrecIssue = iss);
					keys = iss.keys;
				} else if (iss.code === "invalid_key" && iss.origin === "record" && iss.path?.length === 1) {
					const k = String(iss.path[0]);
					if (!keyIssues.has(k)) keyIssues.set(k, iss);
					keys = [k];
				} else return false;
				for (const k of keys) {
					if (!unrecKeys.has(k)) unrecKeys.set(k, {});
					unrecKeys.get(k)[side] = true;
				}
				return true;
			};
			for (const iss of left.issues) if (!collect(iss, "l")) result.issues.push(iss);
			for (const iss of right.issues) if (!collect(iss, "r")) result.issues.push(iss);
			const bothKeys = [...unrecKeys].filter(([, f]) => f.l && f.r).map(([k]) => k);
			if (bothKeys.length) {
				const aggregated = unrecIssue ? bothKeys.filter((k) => unrecIssue.keys.includes(k)) : [];
				if (aggregated.length) result.issues.push({
					...unrecIssue,
					keys: aggregated
				});
				for (const k of bothKeys) if (!aggregated.includes(k) && keyIssues.has(k)) result.issues.push(keyIssues.get(k));
			}
			const merged = mergeValues(left.value, right.value);
			if (!merged.valid) {
				if (aborted(result)) return result;
				throw new Error(`Unmergable intersection. Error path: ${JSON.stringify(merged.mergeErrorPath)}`);
			}
			result.value = merged.data;
			return result;
		}
		const $ZodEnum = /*@__PURE__*/ $constructor("$ZodEnum", (inst, def) => {
			$ZodType.init(inst, def);
			const values = getEnumValues(def.entries);
			const valuesSet = new Set(values);
			inst._zod.values = valuesSet;
			defineLazyInternal(inst, "pattern", (zod) => {
				const patternValues = getEnumValues(zod.def.entries).filter((k) => propertyKeyTypes.has(typeof k));
				return new RegExp(patternValues.length ? `^(${patternValues.map((o) => escapeRegex(o.toString())).join("|")})$` : "^[^\\s\\S]$");
			});
			inst._zod.parse = (payload, _ctx) => {
				const input = payload.value;
				if (valuesSet.has(input)) return payload;
				payload.issues.push({
					code: "invalid_value",
					values,
					input,
					inst
				});
				return payload;
			};
		});
		const $ZodTransform = /*@__PURE__*/ $constructor("$ZodTransform", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.optin = "optional";
			globalConfig.memoizer?.guard(inst);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") throw new $ZodEncodeError(inst.constructor.name);
				const _out = def.transform(payload.value, payload);
				if (ctx.async) return (_out instanceof Promise ? _out : Promise.resolve(_out)).then((output) => {
					payload.value = output;
					return payload;
				});
				if (_out instanceof Promise) throw new $ZodAsyncError();
				payload.value = _out;
				return payload;
			};
		});
		function handleOptionalResult(payload, result) {
			payload.value = result.issues.length ? void 0 : result.value;
			return payload;
		}
		const $ZodOptional = /*@__PURE__*/ $constructor("$ZodOptional", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional");
			inst._zod.optout = "optional";
			defineLazyInternal(inst, "values", (zod) => {
				const values = zod.def.innerType._zod.values;
				return values ? /* @__PURE__ */ new Set([...values, void 0]) : void 0;
			});
			defineLazyInternal(inst, "pattern", (zod) => {
				const pattern = zod.def.innerType._zod.pattern;
				return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : void 0;
			});
			inst._zod.parse = (payload, ctx) => {
				if (payload.value === void 0) {
					if (def.innerType._zod.optin !== "defaulted") return payload;
					const result = def.innerType._zod.run({
						value: payload.value,
						issues: []
					}, ctx);
					if (result instanceof Promise) return result.then((result) => handleOptionalResult(payload, result));
					return handleOptionalResult(payload, result);
				}
				return def.innerType._zod.run(payload, ctx);
			};
		});
		const $ZodExactOptional = /*@__PURE__*/ $constructor("$ZodExactOptional", (inst, def) => {
			$ZodOptional.init(inst, def);
			defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
			defineLazyInternal(inst, "pattern", (zod) => zod.def.innerType._zod.pattern);
			inst._zod.parse = (payload, ctx) => {
				return def.innerType._zod.run(payload, ctx);
			};
		});
		const $ZodNullable = /*@__PURE__*/ $constructor("$ZodNullable", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin);
			defineLazyInternal(inst, "optout", (zod) => zod.def.innerType._zod.optout);
			defineLazyInternal(inst, "pattern", (zod) => {
				const pattern = zod.def.innerType._zod.pattern;
				return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : void 0;
			});
			defineLazyInternal(inst, "values", (zod) => {
				return zod.def.innerType._zod.values ? /* @__PURE__ */ new Set([...zod.def.innerType._zod.values, null]) : void 0;
			});
			inst._zod.parse = (payload, ctx) => {
				if (payload.value === null) return payload;
				return def.innerType._zod.run(payload, ctx);
			};
		});
		const $ZodDefault = /*@__PURE__*/ $constructor("$ZodDefault", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.optin = "defaulted";
			defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
				if (payload.value === void 0) {
					payload.value = def.defaultValue;
					/**
					* $ZodDefault returns the default value immediately in forward direction.
					* It doesn't pass the default value into the validator ("prefault"). There's no reason to pass the default value through validation. The validity of the default is enforced by TypeScript statically. Otherwise, it's the responsibility of the user to ensure the default is valid. In the case of pipes with divergent in/out types, you can specify the default on the `in` schema of your ZodPipe to set a "prefault" for the pipe.   */
					return payload;
				}
				const result = def.innerType._zod.run(payload, ctx);
				if (result instanceof Promise) return result.then((result) => handleDefaultResult(result, def));
				return handleDefaultResult(result, def);
			};
		});
		function handleDefaultResult(payload, def) {
			if (payload.value === void 0) payload.value = def.defaultValue;
			return payload;
		}
		const $ZodPrefault = /*@__PURE__*/ $constructor("$ZodPrefault", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.optin = "defaulted";
			defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
				if (payload.value === void 0) payload.value = def.defaultValue;
				return def.innerType._zod.run(payload, ctx);
			};
		});
		const $ZodNonOptional = /*@__PURE__*/ $constructor("$ZodNonOptional", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazyInternal(inst, "values", (zod) => {
				const v = zod.def.innerType._zod.values;
				return v ? new Set([...v].filter((x) => x !== void 0)) : void 0;
			});
			inst._zod.parse = (payload, ctx) => {
				const result = def.innerType._zod.run(payload, ctx);
				if (result instanceof Promise) return result.then((result) => handleNonOptionalResult(result, inst));
				return handleNonOptionalResult(result, inst);
			};
		});
		function handleNonOptionalResult(payload, inst) {
			if (!payload.issues.length && payload.value === void 0) payload.issues.push({
				code: "invalid_type",
				expected: "nonoptional",
				input: payload.value,
				inst
			});
			return payload;
		}
		function handleCatchResult(payload, result, def, ctx) {
			if (!result.issues.length) {
				payload.value = result.value;
				if (result.memo) payload.memo = true;
				return payload;
			}
			payload.value = def.catchValue({
				...result,
				value: payload.value,
				error: { issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config())) },
				input: payload.value
			});
			return payload;
		}
		const $ZodCatch = /*@__PURE__*/ $constructor("$ZodCatch", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional");
			defineLazyInternal(inst, "optout", (zod) => zod.def.innerType._zod.optout);
			defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
				const result = def.innerType._zod.run({
					value: payload.value,
					issues: []
				}, ctx);
				if (result instanceof Promise) return result.then((result) => handleCatchResult(payload, result, def, ctx));
				return handleCatchResult(payload, result, def, ctx);
			};
		});
		const $ZodPipe = /*@__PURE__*/ $constructor("$ZodPipe", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazyInternal(inst, "values", (zod) => zod.def.in._zod.values);
			defineLazyInternal(inst, "optin", (zod) => zod.def.in._zod.optin);
			defineLazyInternal(inst, "optout", (zod) => zod.def.out._zod.optout);
			defineLazyInternal(inst, "propValues", (zod) => zod.def.in._zod.propValues);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") {
					const right = def.out._zod.run(payload, ctx);
					if (right instanceof Promise) return right.then((right) => handlePipeResult(right, def.in, ctx));
					return handlePipeResult(right, def.in, ctx);
				}
				const left = def.in._zod.run(payload, ctx);
				if (left instanceof Promise) return left.then((left) => handlePipeResult(left, def.out, ctx));
				return handlePipeResult(left, def.out, ctx);
			};
		});
		function handlePipeResult(left, next, ctx) {
			if (left.issues.some((iss) => iss.code !== "unrecognized_keys")) {
				left.aborted = true;
				return left;
			}
			return next._zod.run({
				value: left.value,
				issues: left.issues
			}, ctx);
		}
		const $ZodReadonly = /*@__PURE__*/ $constructor("$ZodReadonly", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazyInternal(inst, "propValues", (zod) => zod.def.innerType._zod.propValues);
			defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
			defineLazyInternal(inst, "optin", (zod) => zod.def.innerType?._zod?.optin);
			defineLazyInternal(inst, "optout", (zod) => zod.def.innerType?._zod?.optout);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
				const result = def.innerType._zod.run(payload, ctx);
				if (result instanceof Promise) return result.then(handleReadonlyResult);
				return handleReadonlyResult(result);
			};
		});
		function handleReadonlyResult(payload) {
			if (!payload.memo) payload.value = Object.freeze(payload.value);
			return payload;
		}
		const $ZodCustom = /*@__PURE__*/ $constructor("$ZodCustom", (inst, def) => {
			$ZodCheck.init(inst, def);
			$ZodType.init(inst, def);
			inst._zod.parse = (payload, _) => {
				return payload;
			};
			inst._zod.check = (payload) => {
				const input = payload.value;
				const r = def.fn(input);
				if (r instanceof Promise) return r.then((r) => handleRefineResult(r, payload, input, inst));
				handleRefineResult(r, payload, input, inst);
			};
		});
		function handleRefineResult(result, payload, input, inst) {
			if (!result) {
				const _iss = {
					code: "custom",
					input,
					inst,
					path: [...inst._zod.def.path ?? []],
					continue: !inst._zod.def.abort
				};
				if (inst._zod.def.params) _iss.params = inst._zod.def.params;
				payload.issues.push(issue(_iss));
			}
		}
		//#endregion
		//#region node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/core/memoizer.js
		var $ZodCyclicError = class extends Error {
			constructor() {
				super(`Cannot parse a reference cycle that closes through a transform`);
				this.name = "ZodCyclicError";
			}
		};
		/** Keyed off the context object every schema in one parse call already shares. */
		const STATE = "~memo";
		const NO_ISSUES = [];
		function isRef(value) {
			return value !== null && typeof value === "object";
		}
		function cloneIssues(issues) {
			return issues.map((iss) => iss.path ? {
				...iss,
				path: iss.path.slice()
			} : { ...iss });
		}
		const recursive = /*@__PURE__*/ new WeakMap();
		/** What the walk established, in order of certainty: ordered so the strongest answer among children wins. */
		const NONE = 0;
		const ASSUMED = 1;
		const PROVEN = 2;
		/** Whether this schema's subtree contains a cycle, so one parse can re-enter it. */
		function isRecursive(inst, stack, resolve) {
			const cached = recursive.get(inst);
			if (cached !== void 0) return cached ? PROVEN : NONE;
			if (stack.has(inst)) return PROVEN;
			stack.add(inst);
			let result = NONE;
			const check = (child) => {
				if (result !== PROVEN && child?._zod) {
					const answer = isRecursive(child, stack, resolve);
					if (answer > result) result = answer;
				}
			};
			const shape = (sh, spread) => {
				let answer = NONE;
				for (const key of Reflect.ownKeys(sh)) {
					const desc = Object.getOwnPropertyDescriptor(sh, key);
					if (spread && !desc.enumerable) continue;
					const child = desc.get ? ASSUMED : desc.value?._zod ? isRecursive(desc.value, stack, resolve) : NONE;
					if (child > answer) answer = child;
				}
				return answer;
			};
			const merge = (answer) => {
				if (answer > result) result = answer;
			};
			const def = inst._zod.def;
			switch (def.type) {
				case "object": {
					const raw = rawShape(def);
					merge(raw ? shape(raw, true) : ASSUMED);
					check(def.catchall);
					break;
				}
				case "array":
					check(def.element);
					break;
				case "tuple":
					for (const el of def.items) check(el);
					check(def.rest);
					break;
				case "record":
				case "map":
					check(def.keyType);
					check(def.valueType);
					break;
				case "set":
					check(def.valueType);
					break;
				case "union":
					for (const el of def.options) check(el);
					break;
				case "intersection":
					check(def.left);
					check(def.right);
					break;
				case "optional":
				case "nullable":
				case "default":
				case "prefault":
				case "catch":
				case "readonly":
				case "nonoptional":
				case "promise":
				case "success":
					check(def.innerType);
					break;
				case "pipe":
					check(def.in);
					check(def.out);
					break;
				case "function":
					check(def.input);
					check(def.output);
					break;
				case "lazy": {
					const inner = def._cachedInner ?? (resolve ? inst._zod.innerType : void 0);
					merge(inner ? isRecursive(inner, stack, false) : ASSUMED);
					break;
				}
				case "template_literal":
				case "string":
				case "number":
				case "int":
				case "boolean":
				case "bigint":
				case "symbol":
				case "undefined":
				case "null":
				case "void":
				case "never":
				case "any":
				case "unknown":
				case "date":
				case "nan":
				case "enum":
				case "literal":
				case "file":
				case "transform":
				case "custom": break;
				default: for (const key in def) {
					const desc = Object.getOwnPropertyDescriptor(def, key);
					if (!desc || desc.get) continue;
					const value = desc.value;
					if (!value || typeof value !== "object") continue;
					if (value._zod) check(value);
					else if (Array.isArray(value)) for (const el of value) check(el);
				}
			}
			stack.delete(inst);
			return settle(inst, result);
		}
		/** An assumed answer must not outlive the resolution that settles it, so only a certain one is cached. */
		function settle(inst, answer) {
			if (answer !== ASSUMED) recursive.set(inst, answer === PROVEN);
			return answer;
		}
		function bucketFor(state, inst) {
			let bucket = state.buckets.get(inst);
			if (!bucket) {
				bucket = /* @__PURE__ */ new WeakMap();
				state.buckets.set(inst, bucket);
			}
			return bucket;
		}
		let handoff;
		const open = [];
		const memo = {
			alloc(_inst, payload, empty) {
				const bucket = handoff;
				if (!bucket) return empty;
				handoff = void 0;
				const entry = {
					value: empty,
					issues: null
				};
				bucket.set(payload.value, entry);
				open.push(entry);
				return empty;
			},
			guard(inst) {
				var _a;
				(_a = inst._zod).deferred ?? (_a.deferred = []);
				inst._zod.deferred.push(() => {
					const base = inst._zod.parse;
					const wrapped = (payload, ctx) => {
						if (ctx.direction !== "backward" && isBackEdge(ctx, payload.value)) throw new $ZodCyclicError();
						return base(payload, ctx);
					};
					inst._zod.parse = wrapped;
					if (inst._zod.run === base) inst._zod.run = wrapped;
				});
			},
			attach(inst) {
				var _a;
				let isRecursiveInst;
				let rechecked = false;
				let lastCtx;
				let lastBucket;
				(_a = inst._zod).deferred ?? (_a.deferred = []);
				inst._zod.deferred.push(() => {
					const base = inst._zod.parse;
					const wrapped = (payload, ctx) => {
						if (isRecursiveInst === void 0) {
							const walked = isRecursive(inst, /* @__PURE__ */ new Set(), false);
							if (walked === NONE) {
								inst._zod.parse = base;
								if (inst._zod.run === wrapped) inst._zod.run = base;
								return base(payload, ctx);
							}
							if (walked === PROVEN || rechecked) isRecursiveInst = true;
							else rechecked = true;
						}
						const input = payload.value;
						if (!isRef(input)) return base(payload, ctx);
						let state = ctx[STATE];
						if (!state) {
							state = {
								buckets: /* @__PURE__ */ new WeakMap(),
								backEdges: void 0
							};
							ctx[STATE] = state;
						}
						let bucket;
						if (lastCtx === ctx) bucket = lastBucket;
						else {
							bucket = bucketFor(state, inst);
							lastCtx = ctx;
							lastBucket = bucket;
						}
						const hit = bucket.get(input);
						if (hit) {
							payload.value = hit.value;
							if (hit.issues) {
								if (hit.issues.length) payload.issues.push(...cloneIssues(hit.issues));
							} else {
								payload.memo = true;
								state.backEdges ?? (state.backEdges = /* @__PURE__ */ new WeakSet());
								state.backEdges.add(hit.value);
							}
							return payload;
						}
						handoff = bucket;
						const depth = open.length;
						const result = base(payload, ctx);
						handoff = void 0;
						const entry = open.length > depth ? open.pop() : void 0;
						if (result instanceof Promise) return result.then((r) => {
							if (entry) entry.issues = r.issues.length ? cloneIssues(r.issues) : NO_ISSUES;
							return r;
						});
						if (entry) entry.issues = result.issues.length ? cloneIssues(result.issues) : NO_ISSUES;
						return result;
					};
					inst._zod.parse = wrapped;
					if (inst._zod.run === base) inst._zod.run = wrapped;
				});
			}
		};
		/** The memoizer that gives containers cycle support. `zod` installs it by default; `zod/mini` opts in with `config({ memoizer: memoizer() })`. */
		function memoizer() {
			return memo;
		}
		/** Whether this value is a node a back-edge resolved to before it finished. */
		function isBackEdge(ctx, value) {
			const backEdges = ctx[STATE]?.backEdges;
			return backEdges !== void 0 && isRef(value) && backEdges.has(value);
		}
		//#endregion
		//#region node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/locales/en.js
		const error = () => {
			const Sizable = {
				string: {
					unit: "characters",
					verb: "to have"
				},
				file: {
					unit: "bytes",
					verb: "to have"
				},
				array: {
					unit: "items",
					verb: "to have"
				},
				set: {
					unit: "items",
					verb: "to have"
				},
				map: {
					unit: "entries",
					verb: "to have"
				}
			};
			function getSizing(origin) {
				return Sizable[origin] ?? null;
			}
			const FormatDictionary = {
				regex: "input",
				email: "email address",
				url: "URL",
				emoji: "emoji",
				uuid: "UUID",
				uuidv4: "UUIDv4",
				uuidv6: "UUIDv6",
				nanoid: "nanoid",
				guid: "GUID",
				cuid: "cuid",
				cuid2: "cuid2",
				ulid: "ULID",
				xid: "XID",
				ksuid: "KSUID",
				datetime: "ISO datetime",
				date: "ISO date",
				time: "ISO time",
				duration: "ISO duration",
				ipv4: "IPv4 address",
				ipv6: "IPv6 address",
				mac: "MAC address",
				cidrv4: "IPv4 range",
				cidrv6: "IPv6 range",
				base64: "base64-encoded string",
				base64url: "base64url-encoded string",
				json_string: "JSON string",
				e164: "E.164 number",
				currency_code: "currency code",
				credit_card: "credit card number",
				iban: "IBAN",
				jwt: "JWT",
				template_literal: "input"
			};
			const TypeDictionary = { nan: "NaN" };
			function getTypeName(type, input) {
				if (type === "number" && typeof input === "number" && !Number.isFinite(input)) return String(input);
				return TypeDictionary[type] ?? type;
			}
			return (issue) => {
				switch (issue.code) {
					case "invalid_type": return `Invalid input: expected ${getTypeName(issue.expected)}, received ${getTypeName(parsedType(issue.input), issue.input)}`;
					case "invalid_value":
						if (issue.values.length === 1) return `Invalid input: expected ${stringifyPrimitive(issue.values[0])}`;
						return `Invalid option: expected one of ${joinValues(issue.values, "|")}`;
					case "too_big": {
						const adj = issue.exact ? "exactly " : issue.inclusive ? "<=" : "<";
						const sizing = getSizing(issue.origin);
						if (sizing) return `Too big: expected ${issue.origin ?? "value"} to have ${adj}${issue.maximum.toString()} ${sizing.unit ?? "elements"}`;
						return `Too big: expected ${issue.origin ?? "value"} to be ${adj}${issue.maximum.toString()}`;
					}
					case "too_small": {
						const adj = issue.exact ? "exactly " : issue.inclusive ? ">=" : ">";
						const sizing = getSizing(issue.origin);
						if (sizing) return `Too small: expected ${issue.origin} to have ${adj}${issue.minimum.toString()} ${sizing.unit}`;
						return `Too small: expected ${issue.origin} to be ${adj}${issue.minimum.toString()}`;
					}
					case "invalid_format": {
						const _issue = issue;
						if (_issue.format === "starts_with") return `Invalid string: must start with "${_issue.prefix}"`;
						if (_issue.format === "ends_with") return `Invalid string: must end with "${_issue.suffix}"`;
						if (_issue.format === "includes") return `Invalid string: must include "${_issue.includes}"`;
						if (_issue.format === "regex") return `Invalid string: must match pattern ${_issue.pattern}`;
						return `Invalid ${FormatDictionary[_issue.format] ?? issue.format}`;
					}
					case "not_multiple_of": return `Invalid number: must be a multiple of ${issue.divisor}`;
					case "unrecognized_keys": return `Unrecognized key${issue.keys.length > 1 ? "s" : ""}: ${joinValues(issue.keys, ", ")}`;
					case "invalid_key": return `Invalid key in ${issue.origin}`;
					case "invalid_union":
						if (issue.options && Array.isArray(issue.options) && issue.options.length > 0) return `Invalid discriminator value. Expected ${issue.options.map((o) => `'${o}'`).join(" | ")}`;
						if (issue.inclusive === false) return "Invalid input: more than one option matched";
						return "Invalid input";
					case "invalid_element": return `Invalid value in ${issue.origin}`;
					default: return `Invalid input`;
				}
			};
		};
		function en_default() {
			return { localeError: error() };
		}
		//#endregion
		//#region node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/core/registries.js
		var _a;
		var $ZodRegistry = class {
			constructor() {
				this._map = /* @__PURE__ */ new WeakMap();
				this._idmap = /* @__PURE__ */ new Map();
			}
			add(schema, ..._meta) {
				const meta = _meta[0];
				this._map.set(schema, meta);
				if (meta && typeof meta === "object" && "id" in meta) this._idmap.set(meta.id, schema);
				return this;
			}
			clear() {
				this._map = /* @__PURE__ */ new WeakMap();
				this._idmap = /* @__PURE__ */ new Map();
				return this;
			}
			remove(schema) {
				const meta = this._map.get(schema);
				if (meta && typeof meta === "object" && "id" in meta) this._idmap.delete(meta.id);
				this._map.delete(schema);
				return this;
			}
			get(schema) {
				const p = schema._zod.parent;
				if (p) {
					const pm = { ...this.get(p) ?? {} };
					delete pm.id;
					const f = {
						...pm,
						...this._map.get(schema)
					};
					return Object.keys(f).length ? f : void 0;
				}
				return this._map.get(schema);
			}
			has(schema) {
				return this._map.has(schema);
			}
		};
		function registry() {
			return new $ZodRegistry();
		}
		(_a = globalThis).__zod_globalRegistry ?? (_a.__zod_globalRegistry = registry());
		const globalRegistry = globalThis.__zod_globalRegistry;
		//#endregion
		//#region node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/core/api.js
		function snapshotChecks(def) {
			if (def.checks) def.checks = [...def.checks];
			return def;
		}
		// @__NO_SIDE_EFFECTS__
		function _string(Class, params) {
			return new Class(snapshotChecks({
				type: "string",
				...normalizeParams(params)
			}));
		}
		// @__NO_SIDE_EFFECTS__
		function _email(Class, params) {
			return new Class({
				type: "string",
				format: "email",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _guid(Class, params) {
			return new Class({
				type: "string",
				format: "guid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _uuid(Class, params) {
			return new Class({
				type: "string",
				format: "uuid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _uuidv4(Class, params) {
			return new Class({
				type: "string",
				format: "uuid",
				check: "string_format",
				abort: false,
				version: "v4",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _uuidv6(Class, params) {
			return new Class({
				type: "string",
				format: "uuid",
				check: "string_format",
				abort: false,
				version: "v6",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _uuidv7(Class, params) {
			return new Class({
				type: "string",
				format: "uuid",
				check: "string_format",
				abort: false,
				version: "v7",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _url(Class, params) {
			return new Class({
				type: "string",
				format: "url",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _emoji(Class, params) {
			return new Class({
				type: "string",
				format: "emoji",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _nanoid(Class, params) {
			return new Class({
				type: "string",
				format: "nanoid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		/**
		* @deprecated CUID v1 is deprecated by its authors due to information leakage
		* (timestamps embedded in the id). Use {@link _cuid2} instead.
		* See https://github.com/paralleldrive/cuid.
		*/
		// @__NO_SIDE_EFFECTS__
		function _cuid(Class, params) {
			return new Class({
				type: "string",
				format: "cuid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _cuid2(Class, params) {
			return new Class({
				type: "string",
				format: "cuid2",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _ulid(Class, params) {
			return new Class({
				type: "string",
				format: "ulid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _xid(Class, params) {
			return new Class({
				type: "string",
				format: "xid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _ksuid(Class, params) {
			return new Class({
				type: "string",
				format: "ksuid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _ipv4(Class, params) {
			return new Class({
				type: "string",
				format: "ipv4",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _ipv6(Class, params) {
			return new Class({
				type: "string",
				format: "ipv6",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _cidrv4(Class, params) {
			return new Class({
				type: "string",
				format: "cidrv4",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _cidrv6(Class, params) {
			return new Class({
				type: "string",
				format: "cidrv6",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _base64(Class, params) {
			return new Class({
				type: "string",
				format: "base64",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _base64url(Class, params) {
			return new Class({
				type: "string",
				format: "base64url",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _e164(Class, params) {
			return new Class({
				type: "string",
				format: "e164",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _jwt(Class, params) {
			return new Class({
				type: "string",
				format: "jwt",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _isoDateTime(Class, params) {
			return new Class({
				type: "string",
				format: "datetime",
				check: "string_format",
				offset: false,
				local: false,
				precision: null,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _isoDate(Class, params) {
			return new Class({
				type: "string",
				format: "date",
				check: "string_format",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _isoTime(Class, params) {
			return new Class({
				type: "string",
				format: "time",
				check: "string_format",
				precision: null,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _isoDuration(Class, params) {
			return new Class({
				type: "string",
				format: "duration",
				check: "string_format",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _number(Class, params) {
			return new Class(snapshotChecks({
				type: "number",
				checks: [],
				...normalizeParams(params)
			}));
		}
		// @__NO_SIDE_EFFECTS__
		function _int(Class, params) {
			return new Class({
				type: "number",
				check: "number_format",
				abort: false,
				format: "safeint",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _boolean(Class, params) {
			return new Class({
				type: "boolean",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _unknown(Class) {
			return new Class({ type: "unknown" });
		}
		// @__NO_SIDE_EFFECTS__
		function _never(Class, params) {
			return new Class({
				type: "never",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _lt(value, params) {
			return new $ZodCheckLessThan({
				check: "less_than",
				...normalizeParams(params),
				value,
				inclusive: false
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _lte(value, params) {
			return new $ZodCheckLessThan({
				check: "less_than",
				...normalizeParams(params),
				value,
				inclusive: true
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _gt(value, params) {
			return new $ZodCheckGreaterThan({
				check: "greater_than",
				...normalizeParams(params),
				value,
				inclusive: false
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _gte(value, params) {
			return new $ZodCheckGreaterThan({
				check: "greater_than",
				...normalizeParams(params),
				value,
				inclusive: true
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _multipleOf(value, params) {
			return new $ZodCheckMultipleOf({
				check: "multiple_of",
				...normalizeParams(params),
				value
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _maxLength(maximum, params) {
			return new $ZodCheckMaxLength({
				check: "max_length",
				...normalizeParams(params),
				maximum
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _minLength(minimum, params) {
			return new $ZodCheckMinLength({
				check: "min_length",
				...normalizeParams(params),
				minimum
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _length(length, params) {
			return new $ZodCheckLengthEquals({
				check: "length_equals",
				...normalizeParams(params),
				length
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _regex(pattern, params) {
			return new $ZodCheckRegex({
				check: "string_format",
				format: "regex",
				...normalizeParams(params),
				pattern
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _lowercase(params) {
			return new $ZodCheckLowerCase({
				check: "string_format",
				format: "lowercase",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _uppercase(params) {
			return new $ZodCheckUpperCase({
				check: "string_format",
				format: "uppercase",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _includes(includes, params) {
			return new $ZodCheckIncludes({
				check: "string_format",
				format: "includes",
				...normalizeParams(params),
				includes
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _startsWith(prefix, params) {
			return new $ZodCheckStartsWith({
				check: "string_format",
				format: "starts_with",
				...normalizeParams(params),
				prefix
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _endsWith(suffix, params) {
			return new $ZodCheckEndsWith({
				check: "string_format",
				format: "ends_with",
				...normalizeParams(params),
				suffix
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _overwrite(tx) {
			return new $ZodCheckOverwrite({
				check: "overwrite",
				tx
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _normalize(form) {
			return /* @__PURE__ */ _overwrite((input) => input.normalize(form));
		}
		// @__NO_SIDE_EFFECTS__
		function _trim() {
			return /* @__PURE__ */ _overwrite((input) => input.trim());
		}
		// @__NO_SIDE_EFFECTS__
		function _toLowerCase() {
			return /* @__PURE__ */ _overwrite((input) => input.toLowerCase());
		}
		// @__NO_SIDE_EFFECTS__
		function _toUpperCase() {
			return /* @__PURE__ */ _overwrite((input) => input.toUpperCase());
		}
		// @__NO_SIDE_EFFECTS__
		function _slugify() {
			return /* @__PURE__ */ _overwrite((input) => slugify(input));
		}
		// @__NO_SIDE_EFFECTS__
		function _array(Class, element, params) {
			return new Class({
				type: "array",
				element,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _refine(Class, fn, _params) {
			return new Class({
				type: "custom",
				check: "custom",
				fn,
				...normalizeParams(_params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _superRefine(fn, params) {
			const ch = /* @__PURE__ */ _check((payload) => {
				payload.addIssue = (issue$2) => {
					if (typeof issue$2 === "string") payload.issues.push(issue(issue$2, payload.value, ch._zod.def));
					else {
						const _issue = issue$2;
						if (_issue.fatal) _issue.continue = false;
						_issue.code ?? (_issue.code = "custom");
						if (!("input" in _issue)) _issue.input = payload.value;
						_issue.inst ?? (_issue.inst = ch);
						_issue.continue ?? (_issue.continue = !ch._zod.def.abort);
						payload.issues.push(issue(_issue));
					}
				};
				return fn(payload.value, payload);
			}, params);
			return ch;
		}
		// @__NO_SIDE_EFFECTS__
		function _check(fn, params) {
			const ch = new $ZodCheck({
				check: "custom",
				...normalizeParams(params)
			});
			ch._zod.check = fn;
			return ch;
		}
		//#endregion
		//#region node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/core/to-json-schema.js
		function assignProps(target, ...sources) {
			for (const source of sources) for (const key of Reflect.ownKeys(source)) if (Object.prototype.propertyIsEnumerable.call(source, key)) assignProp(target, key, source[key]);
			return target;
		}
		function initializeContext(params) {
			let target = params?.target ?? "draft-2020-12";
			if (target === "draft-4") target = "draft-04";
			if (target === "draft-7") target = "draft-07";
			return {
				processors: params.processors ?? {},
				metadataRegistry: params?.metadata ?? globalRegistry,
				target,
				unrepresentable: params?.unrepresentable ?? "throw",
				override: params?.override ?? (() => {}),
				io: params?.io ?? "output",
				counter: 0,
				seen: /* @__PURE__ */ new Map(),
				sharedDefsExtractedFor: void 0,
				sharedEmitDoneFor: void 0,
				cycles: params?.cycles ?? "ref",
				reused: params?.reused ?? "inline",
				intersections: [],
				deferred: [],
				external: params?.external ?? void 0
			};
		}
		/**
		* Applies the `unrepresentable` setting at a site that has no JSON Schema equivalent. Throws
		* `message` unless the setting (or the handler's return value) says otherwise. Returns `true` if a
		* custom JSON Schema was written into `json`, in which case the caller must not write its own.
		*/
		function handleUnrepresentable(schema, ctx, json, params, message) {
			const result = typeof ctx.unrepresentable === "function" ? ctx.unrepresentable({
				zodSchema: schema,
				path: params.path,
				message
			}) : ctx.unrepresentable;
			if (result === "any") return false;
			if (result === void 0 || result === "throw") throw new Error(message);
			Object.assign(json, result);
			return true;
		}
		function processSchema(schema, ctx, _params = {
			path: [],
			schemaPath: []
		}) {
			var _a;
			const def = schema._zod.def;
			const seen = ctx.seen.get(schema);
			if (seen) {
				seen.count++;
				if (_params.schemaPath.includes(schema)) seen.cycle = _params.path;
				return seen.schema;
			}
			const result = {
				schema: {},
				count: 1,
				cycle: void 0,
				path: _params.path
			};
			ctx.seen.set(schema, result);
			ctx.sharedDefsExtractedFor = void 0;
			ctx.sharedEmitDoneFor = void 0;
			const overrideSchema = schema._zod.toJSONSchema?.();
			if (overrideSchema) result.schema = overrideSchema;
			else {
				const params = {
					..._params,
					schemaPath: [..._params.schemaPath, schema],
					path: _params.path
				};
				if (schema._zod.processJSONSchema) schema._zod.processJSONSchema(ctx, result.schema, params);
				else {
					const _json = result.schema;
					const processor = ctx.processors[def.type];
					if (!processor) throw new Error(`[toJSONSchema]: Non-representable type encountered: ${def.type}`);
					processor(schema, ctx, _json, params);
				}
				const parent = schema._zod.parent;
				if (parent) {
					if (!result.ref) result.ref = parent;
					processSchema(parent, ctx, params);
					ctx.seen.get(parent).isParent = true;
				}
			}
			const meta = ctx.metadataRegistry.get(schema);
			if (meta) assignProps(result.schema, meta);
			if (ctx.io === "input" && isTransforming(schema)) {
				delete result.schema.examples;
				delete result.schema.default;
			}
			if (ctx.io === "input" && "_prefault" in result.schema) (_a = result.schema).default ?? (_a.default = result.schema._prefault);
			delete result.schema._prefault;
			return ctx.seen.get(schema).schema;
		}
		function encodeJSONPointerSegment(segment) {
			return segment.replace(/~/g, "~0").replace(/\//g, "~1");
		}
		function extractDefs(ctx, schema) {
			const root = ctx.seen.get(schema);
			if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
			if (ctx.external && ctx.sharedDefsExtractedFor === ctx.external) return;
			const idToSchema = /* @__PURE__ */ new Map();
			for (const entry of ctx.seen.entries()) {
				const id = ctx.metadataRegistry.get(entry[0])?.id;
				if (id) {
					const existing = idToSchema.get(id);
					if (existing && existing !== entry[0]) throw new Error(`Duplicate schema id "${id}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
					idToSchema.set(id, entry[0]);
				}
			}
			const makeURI = (entry) => {
				const defsSegment = ctx.target === "draft-2020-12" ? "$defs" : "definitions";
				if (ctx.external) {
					const externalId = ctx.external.registry.get(entry[0])?.id;
					const uriGenerator = ctx.external.uri ?? ((id) => id);
					if (externalId) return { ref: uriGenerator(externalId) };
					const id = entry[1].defId ?? entry[1].schema.id ?? `schema${ctx.counter++}`;
					entry[1].defId = id;
					return {
						defId: id,
						ref: `${uriGenerator("__shared")}#/${defsSegment}/${encodeJSONPointerSegment(id)}`
					};
				}
				const uriPrefix = `#`;
				const defUriPrefix = `${uriPrefix}/${defsSegment}/`;
				if (entry[1] === root && !entry[1].schema.id) return { ref: uriPrefix };
				const defId = entry[1].schema.id ?? `__schema${ctx.counter++}`;
				return {
					defId,
					ref: defUriPrefix + encodeJSONPointerSegment(defId)
				};
			};
			const extractToDef = (entry) => {
				if (entry[1].schema.$ref) return;
				const seen = entry[1];
				const { ref, defId } = makeURI(entry);
				seen.def = { ...seen.schema };
				if (defId) seen.defId = defId;
				const schema = seen.schema;
				for (const key in schema) delete schema[key];
				schema.$ref = ref;
			};
			if (ctx.cycles === "throw") for (const entry of ctx.seen.entries()) {
				const seen = entry[1];
				if (seen.cycle) throw new Error(`Cycle detected: #/${seen.cycle?.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
			}
			for (const entry of ctx.seen.entries()) {
				const seen = entry[1];
				if (schema === entry[0]) {
					extractToDef(entry);
					continue;
				}
				if (ctx.external) {
					const ext = ctx.external.registry.get(entry[0])?.id;
					if (schema !== entry[0] && ext) {
						extractToDef(entry);
						continue;
					}
				}
				if (ctx.metadataRegistry.get(entry[0])?.id) {
					extractToDef(entry);
					continue;
				}
				if (seen.cycle) {
					extractToDef(entry);
					continue;
				}
				if (seen.count > 1) {
					if (ctx.reused === "ref") extractToDef(entry);
				}
			}
			if (ctx.external) ctx.sharedDefsExtractedFor = ctx.external;
		}
		/** Rewrites `anyOf: [{type: "a"}, {type: "b"}]` to `type: ["a", "b"]`, which every JSON Schema draft treats as equivalent and most consumers render far better for the nullable case. Only branches that are a bare type assertion qualify — anything carrying a constraint, `$ref`, `const` or metadata is left alone. Runs after `flattenRef`, so a branch an override decorated or `$defs` extraction turned into a `$ref` is no longer bare and correctly stays in `anyOf`. `oneOf` is excluded: `integer` and `number` overlap, so "exactly one" and "at least one" are not the same there. OpenAPI 3.0 is excluded: its `type` must be a single string. */
		function compactTypeUnion(schema) {
			const options = schema.anyOf;
			if (!Array.isArray(options) || options.length === 0 || schema.type !== void 0) return;
			const types = [];
			for (const option of options) {
				if (!option || typeof option !== "object") return;
				compactTypeUnion(option);
				const keys = Object.keys(option);
				if (keys.length !== 1 || keys[0] !== "type") return;
				const type = option.type;
				for (const member of Array.isArray(type) ? type : [type]) {
					if (typeof member !== "string") return;
					if (!types.includes(member)) types.push(member);
				}
			}
			delete schema.anyOf;
			schema.type = types.length === 1 ? types[0] : types;
		}
		/** Keywords `foldIntersection` knows how to combine. Anything else — `$ref`, `patternProperties`,
		* an annotation like `description` — makes a member unfoldable, so a constraint this does not
		* understand leaves the `allOf` alone instead of being silently dropped or misattributed. */
		const FOLDABLE_KEYS = /* @__PURE__ */ new Set([
			"type",
			"properties",
			"required",
			"additionalProperties"
		]);
		const UNION_KEYS = ["oneOf", "anyOf"];
		/** A member's constraint on a key it does not declare itself. A `catchall` states one; `false`, an absent `additionalProperties`, and the empty schema a loose object emits state nothing. */
		function undeclaredConstraint(member) {
			const extra = member.additionalProperties;
			if (extra === void 0 || extra === false || typeof extra !== "object" || extra === null) return null;
			return Object.keys(extra).length ? extra : null;
		}
		/** Combines object members into the single object they describe together, or returns `null` if any of them carries a keyword outside {@link FOLDABLE_KEYS}. */
		function foldObjects(members) {
			const objects = [];
			for (const member of members) {
				if (typeof member !== "object" || member.type !== "object") return null;
				for (const key in member) if (!FOLDABLE_KEYS.has(key)) return null;
				objects.push(member);
			}
			const properties = {};
			const required = /* @__PURE__ */ new Set();
			for (const object of objects) {
				for (const key in object.properties) {
					if (Object.prototype.hasOwnProperty.call(properties, key)) continue;
					const parts = [];
					for (const other of objects) {
						const part = other.properties?.[key] ?? undeclaredConstraint(other);
						if (part === null || part === void 0) continue;
						if (!parts.some((seen) => JSON.stringify(seen) === JSON.stringify(part))) parts.push(part);
					}
					assignProp(properties, key, parts.length === 1 ? parts[0] : foldObjects(parts) ?? { allOf: parts });
				}
				for (const key of object.required ?? []) required.add(key);
			}
			const folded = {
				type: "object",
				properties
			};
			if (required.size) folded.required = [...required];
			if (objects.every((object) => object.additionalProperties === false)) folded.additionalProperties = false;
			else {
				const constraints = [];
				for (const object of objects) {
					const constraint = undeclaredConstraint(object);
					if (constraint && !constraints.some((seen) => JSON.stringify(seen) === JSON.stringify(constraint))) constraints.push(constraint);
				}
				if (constraints.length === 1) folded.additionalProperties = constraints[0];
				else if (constraints.length > 1) folded.additionalProperties = { allOf: constraints };
			}
			return folded;
		}
		/** `additionalProperties` in an `allOf` member sees only that member's own `properties`, so two
		* closed object members reject each other's keys and the schema validates nothing. Zod's parser
		* pools the key sets instead — `handleIntersectionResults` reports a key as unrecognized only when
		* *every* side rejects it — so the emitted schema has to pool them too, and folding the members
		* into one object is the encoding that says so on every target.
		*
		* This runs from `finalize`, after `extractDefs`, which is what keeps it clear of the `$ref`
		* machinery: a member extracted into `$defs` is already a `$ref` by now and declines to fold, so it
		* keeps its reference and its own closedness rather than being inlined as a stale copy. */
		function foldIntersection(json) {
			const allOf = json.allOf;
			if (!Array.isArray(allOf) || allOf.length < 2) return;
			for (const key of FOLDABLE_KEYS) if (key in json) return;
			const unions = allOf.filter((m) => UNION_KEYS.some((k) => Array.isArray(m[k])));
			let folded = null;
			if (!unions.length) folded = foldObjects(allOf);
			else {
				const union = unions[0];
				const keyword = UNION_KEYS.find((k) => Array.isArray(union[k]));
				if (Object.keys(union).length !== 1) return;
				const rest = allOf.filter((m) => m !== union);
				const branches = union[keyword].map((branch) => foldObjects([...rest, branch]));
				if (branches.some((b) => !b)) return;
				folded = { [keyword]: branches };
			}
			if (!folded) return;
			delete json.allOf;
			assignProps(json, folded);
		}
		function finalize(ctx, schema) {
			const root = ctx.seen.get(schema);
			if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
			const flattenRef = (zodSchema) => {
				const seen = ctx.seen.get(zodSchema);
				if (seen.ref === null) return;
				const schema = seen.def ?? seen.schema;
				const _cached = { ...schema };
				const ref = seen.ref;
				seen.ref = null;
				if (ref) {
					flattenRef(ref);
					const refSeen = ctx.seen.get(ref);
					const refSchema = refSeen.schema;
					if (refSchema.$ref && (ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0")) {
						schema.allOf = schema.allOf ?? [];
						schema.allOf.push(refSchema);
					} else assignProps(schema, refSchema);
					assignProps(schema, _cached);
					if (zodSchema._zod.parent === ref) for (const key in schema) {
						if (key === "$ref" || key === "allOf") continue;
						if (!(key in _cached)) delete schema[key];
					}
					if (refSchema.$ref && refSeen.def) for (const key in schema) {
						if (key === "$ref" || key === "allOf") continue;
						if (key in refSeen.def && JSON.stringify(schema[key]) === JSON.stringify(refSeen.def[key])) delete schema[key];
					}
				}
				const parent = zodSchema._zod.parent;
				if (parent && parent !== ref) {
					flattenRef(parent);
					const parentSeen = ctx.seen.get(parent);
					if (parentSeen?.schema.$ref) {
						schema.$ref = parentSeen.schema.$ref;
						if (parentSeen.def) for (const key in schema) {
							if (key === "$ref" || key === "allOf") continue;
							if (key in parentSeen.def && JSON.stringify(schema[key]) === JSON.stringify(parentSeen.def[key])) delete schema[key];
						}
					}
				}
				ctx.override({
					zodSchema,
					jsonSchema: schema,
					path: seen.path ?? []
				});
			};
			if (!ctx.external || ctx.sharedEmitDoneFor !== ctx.external) {
				for (const entry of [...ctx.seen.entries()].reverse()) flattenRef(entry[0]);
				if (ctx.target !== "openapi-3.0") for (const entry of ctx.seen.entries()) compactTypeUnion(entry[1].def ?? entry[1].schema);
				for (const rewrite of ctx.deferred) rewrite();
				if (ctx.intersections.length) {
					const carriers = /* @__PURE__ */ new Map();
					for (const seen of ctx.seen.values()) for (const json of [seen.schema, seen.def]) {
						const allOf = json?.allOf;
						if (!Array.isArray(allOf)) continue;
						const existing = carriers.get(allOf);
						if (existing) existing.push(json);
						else carriers.set(allOf, [json]);
					}
					for (const allOf of ctx.intersections) for (const json of carriers.get(allOf) ?? []) foldIntersection(json);
				}
			}
			const result = {};
			if (ctx.target === "draft-2020-12") result.$schema = "https://json-schema.org/draft/2020-12/schema";
			else if (ctx.target === "draft-07") result.$schema = "http://json-schema.org/draft-07/schema#";
			else if (ctx.target === "draft-04") result.$schema = "http://json-schema.org/draft-04/schema#";
			else if (ctx.target === "openapi-3.0") {}
			if (ctx.external?.uri) {
				const id = ctx.external.registry.get(schema)?.id;
				if (!id) throw new Error("Schema is missing an `id` property");
				result.$id = ctx.external.uri(id);
			}
			assignProps(result, root.defId ? root.schema : root.def ?? root.schema);
			const rootMetaId = ctx.metadataRegistry.get(schema)?.id;
			if (rootMetaId !== void 0 && result.id === rootMetaId) delete result.id;
			const defs = ctx.external?.defs ?? {};
			if (!ctx.external || ctx.sharedEmitDoneFor !== ctx.external) for (const entry of ctx.seen.entries()) {
				const seen = entry[1];
				if (seen.def && seen.defId) {
					if (seen.def.id === seen.defId) delete seen.def.id;
					assignProp(defs, seen.defId, seen.def);
				}
			}
			if (ctx.external) ctx.sharedEmitDoneFor = ctx.external;
			if (ctx.external) {} else if (Object.keys(defs).length > 0) {
				if (ctx.target === "draft-2020-12") result.$defs = defs;
				else result.definitions = defs;
			}
			try {
				const finalized = JSON.parse(JSON.stringify(result));
				Object.defineProperty(finalized, "~standard", {
					value: {
						...schema["~standard"],
						jsonSchema: {
							input: createStandardJSONSchemaMethod(schema, "input", ctx.processors),
							output: createStandardJSONSchemaMethod(schema, "output", ctx.processors)
						}
					},
					enumerable: false,
					writable: false
				});
				return finalized;
			} catch (_err) {
				throw new Error("Error converting schema to JSON.");
			}
		}
		function isTransforming(_schema, _ctx) {
			const ctx = _ctx ?? { seen: /* @__PURE__ */ new Set() };
			if (ctx.seen.has(_schema)) return false;
			ctx.seen.add(_schema);
			const def = _schema._zod.def;
			if (def.type === "transform") return true;
			if (def.type === "array") return isTransforming(def.element, ctx);
			if (def.type === "set") return isTransforming(def.valueType, ctx);
			if (def.type === "lazy") return isTransforming(def.getter(), ctx);
			if (def.type === "promise" || def.type === "optional" || def.type === "nonoptional" || def.type === "nullable" || def.type === "readonly" || def.type === "default" || def.type === "prefault" || def.type === "catch") return isTransforming(def.innerType, ctx);
			if (def.type === "intersection") return isTransforming(def.left, ctx) || isTransforming(def.right, ctx);
			if (def.type === "record" || def.type === "map") return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
			if (def.type === "pipe") {
				if (_schema._zod.traits.has("$ZodCodec")) return true;
				return isTransforming(def.in, ctx) || isTransforming(def.out, ctx);
			}
			if (def.type === "object") {
				for (const key in def.shape) if (isTransforming(def.shape[key], ctx)) return true;
				return false;
			}
			if (def.type === "union") {
				for (const option of def.options) if (isTransforming(option, ctx)) return true;
				return false;
			}
			if (def.type === "tuple") {
				for (const item of def.items) if (isTransforming(item, ctx)) return true;
				if (def.rest && isTransforming(def.rest, ctx)) return true;
				return false;
			}
			return false;
		}
		/**
		* Creates a toJSONSchema method for a schema instance.
		* This encapsulates the logic of initializing context, processing, extracting defs, and finalizing.
		*/
		const createToJSONSchemaMethod = (schema, processors = {}) => (params) => {
			const ctx = initializeContext({
				...params,
				processors
			});
			processSchema(schema, ctx);
			extractDefs(ctx, schema);
			return finalize(ctx, schema);
		};
		const createStandardJSONSchemaMethod = (schema, io, processors = {}) => (params) => {
			const { libraryOptions, target } = params ?? {};
			const ctx = initializeContext({
				...libraryOptions ?? {},
				target,
				io,
				processors
			});
			processSchema(schema, ctx);
			extractDefs(ctx, schema);
			return finalize(ctx, schema);
		};
		//#endregion
		//#region node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/core/json-schema-processors.js
		const narrowMin = (agg, key, value) => {
			if (agg[key] === void 0 || value > agg[key]) agg[key] = value;
		};
		const narrowMax = (agg, key, value) => {
			if (agg[key] === void 0 || value < agg[key]) agg[key] = value;
		};
		const narrowBoth = (agg, value) => {
			narrowMin(agg, "minimum", value);
			narrowMax(agg, "maximum", value);
		};
		const addDivisor = (agg, value) => {
			agg.multipleOf ?? (agg.multipleOf = []);
			if (!agg.multipleOf.includes(value)) agg.multipleOf.push(value);
		};
		const addPattern = (agg, pattern) => {
			agg.patterns ?? (agg.patterns = /* @__PURE__ */ new Set());
			agg.patterns.add(pattern);
		};
		const intersectMime = (agg, mime) => {
			agg.mime = agg.mime ? agg.mime.filter((m) => mime.includes(m)) : [...mime];
		};
		const setFormat = (agg, format) => {
			agg.format = format;
			if (format.includes("int")) agg.isInt = true;
		};
		const minContributor = (agg, def) => narrowMin(agg, "minimum", def.minimum);
		const maxContributor = (agg, def) => narrowMax(agg, "maximum", def.maximum);
		const formatContributor = (ranges) => (agg, def) => {
			setFormat(agg, def.format);
			const [minimum, maximum] = ranges[def.format];
			narrowMin(agg, "minimum", minimum);
			narrowMax(agg, "maximum", maximum);
		};
		const contributors = {
			greater_than: (agg, def) => narrowMin(agg, def.inclusive ? "minimum" : "exclusiveMinimum", def.value),
			less_than: (agg, def) => narrowMax(agg, def.inclusive ? "maximum" : "exclusiveMaximum", def.value),
			multiple_of: (agg, def) => addDivisor(agg, def.value),
			number_format: formatContributor(NUMBER_FORMAT_RANGES),
			bigint_format: formatContributor(BIGINT_FORMAT_RANGES),
			min_length: minContributor,
			max_length: maxContributor,
			length_equals: (agg, def) => narrowBoth(agg, def.length),
			min_size: minContributor,
			max_size: maxContributor,
			size_equals: (agg, def) => narrowBoth(agg, def.size),
			string_format: (agg, def) => {
				setFormat(agg, def.format);
				if (def.pattern) addPattern(agg, def.pattern);
				if (def.format === "base64" || def.format === "base64url") agg.contentEncoding = def.format;
				if (def.local || def.precision === -1) agg.laxFormat = true;
			},
			mime_type: (agg, def) => intersectMime(agg, def.mime)
		};
		function aggregateChecks(schema) {
			const agg = {};
			const def = schema._zod.def;
			const list = schema._zod.traits.has("$ZodCheck") ? [schema, ...def.checks ?? []] : def.checks ?? [];
			for (const ch of list) contributors[ch._zod.def.check]?.(agg, ch._zod.def);
			const bag = schema._zod.bag;
			if (bag.minimum !== void 0) narrowMin(agg, "minimum", bag.minimum);
			if (bag.exclusiveMinimum !== void 0) narrowMin(agg, "exclusiveMinimum", bag.exclusiveMinimum);
			if (bag.maximum !== void 0) narrowMax(agg, "maximum", bag.maximum);
			if (bag.exclusiveMaximum !== void 0) narrowMax(agg, "exclusiveMaximum", bag.exclusiveMaximum);
			if (bag.multipleOf !== void 0) addDivisor(agg, bag.multipleOf);
			if (bag.format !== void 0) {
				agg.format ?? (agg.format = bag.format);
				if (bag.format.includes("int")) agg.isInt = true;
			}
			if (bag.mime) intersectMime(agg, bag.mime);
			for (const pattern of bag.patterns ?? []) addPattern(agg, pattern);
			return agg;
		}
		const formatMap = {
			guid: "uuid",
			url: "uri",
			datetime: "date-time",
			json_string: "json-string",
			regex: ""
		};
		const exactPatterns = /* @__PURE__ */ new Map([[base64Charset, base64], [base64urlCharset, base64url]]);
		const exactPattern = (p) => exactPatterns.get(p) ?? p;
		const stringProcessor = (schema, ctx, _json, _params) => {
			const json = _json;
			json.type = "string";
			const { minimum, maximum, format, patterns, contentEncoding, laxFormat } = aggregateChecks(schema);
			if (typeof minimum === "number") json.minLength = minimum;
			if (typeof maximum === "number") json.maxLength = maximum;
			if (format) {
				json.format = formatMap[format] ?? format;
				if (json.format === "") delete json.format;
				if (format === "time" || laxFormat) delete json.format;
			}
			if (contentEncoding) json.contentEncoding = contentEncoding;
			if (patterns && patterns.size > 0) {
				const patternList = [...patterns].map(exactPattern);
				if (patternList.length === 1) json.pattern = patternList[0].source;
				else if (patternList.length > 1) json.allOf = [...patternList.map((regex) => ({
					...ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0" ? { type: "string" } : {},
					pattern: regex.source
				}))];
			}
		};
		const numberProcessor = (schema, ctx, _json, params) => {
			const json = _json;
			const { minimum, maximum, multipleOf, exclusiveMaximum, exclusiveMinimum, isInt } = aggregateChecks(schema);
			json.type = isInt ? "integer" : "number";
			const exMin = typeof exclusiveMinimum === "number" && exclusiveMinimum >= (minimum ?? Number.NEGATIVE_INFINITY);
			const exMax = typeof exclusiveMaximum === "number" && exclusiveMaximum <= (maximum ?? Number.POSITIVE_INFINITY);
			const legacy = ctx.target === "draft-04" || ctx.target === "openapi-3.0";
			if (exMin) {
				if (legacy) {
					json.minimum = exclusiveMinimum;
					json.exclusiveMinimum = true;
				} else json.exclusiveMinimum = exclusiveMinimum;
			} else if (typeof minimum === "number") json.minimum = minimum;
			if (exMax) {
				if (legacy) {
					json.maximum = exclusiveMaximum;
					json.exclusiveMaximum = true;
				} else json.exclusiveMaximum = exclusiveMaximum;
			} else if (typeof maximum === "number") json.maximum = maximum;
			if (multipleOf) {
				const divisors = /* @__PURE__ */ new Set();
				for (const divisor of multipleOf) if (Number.isFinite(divisor) && divisor !== 0) divisors.add(Math.abs(divisor));
				else handleUnrepresentable(schema, ctx, json, params, `A multipleOf divisor of ${divisor} cannot be represented in JSON Schema`);
				const [first, ...rest] = divisors;
				if (first !== void 0) json.multipleOf = first;
				if (rest.length) json.allOf = [...json.allOf ?? [], ...rest.map((m) => ({ multipleOf: m }))];
			}
		};
		const booleanProcessor = (_schema, _ctx, json, _params) => {
			json.type = "boolean";
		};
		const neverProcessor = (_schema, _ctx, json, _params) => {
			json.not = {};
		};
		const enumProcessor = (schema, _ctx, json, _params) => {
			const def = schema._zod.def;
			const values = getEnumValues(def.entries);
			if (values.length === 0) {
				json.not = {};
				return;
			}
			if (values.every((v) => typeof v === "number")) json.type = "number";
			if (values.every((v) => typeof v === "string")) json.type = "string";
			json.enum = values;
		};
		const customProcessor = (schema, ctx, json, params) => {
			handleUnrepresentable(schema, ctx, json, params, "Custom types cannot be represented in JSON Schema");
		};
		const transformProcessor = (schema, ctx, json, params) => {
			handleUnrepresentable(schema, ctx, json, params, "Transforms cannot be represented in JSON Schema");
		};
		const arrayProcessor = (schema, ctx, _json, params) => {
			const json = _json;
			const def = schema._zod.def;
			const { minimum, maximum } = aggregateChecks(schema);
			if (typeof minimum === "number") json.minItems = minimum;
			if (typeof maximum === "number") json.maxItems = maximum;
			json.type = "array";
			json.items = processSchema(def.element, ctx, {
				...params,
				path: [...params.path, "items"]
			});
		};
		function inputOptin(schema) {
			const def = schema._zod.def;
			if (def.type === "pipe" && def.in._zod.traits.has("$ZodTransform")) return inputOptin(def.out);
			if (def.type === "catch") return inputOptin(def.innerType);
			return schema._zod.optin;
		}
		const objectProcessor = (schema, ctx, _json, params) => {
			const json = _json;
			const def = schema._zod.def;
			const shape = def.shape;
			if (Object.getOwnPropertySymbols(shape).length && handleUnrepresentable(schema, ctx, json, params, "Symbol keys cannot be represented in JSON Schema")) return;
			json.type = "object";
			json.properties = {};
			for (const key in shape) assignProp(json.properties, key, processSchema(shape[key], ctx, {
				...params,
				path: [
					...params.path,
					"properties",
					key
				]
			}));
			const requiredKeys = [];
			for (const key of Object.keys(shape)) {
				const field = def.shape[key];
				if (ctx.io === "input" ? inputOptin(field) === void 0 : field._zod.optout === void 0) requiredKeys.push(key);
			}
			if (requiredKeys.length > 0) json.required = requiredKeys;
			if (def.catchall?._zod.def.type === "never") json.additionalProperties = false;
			else if (!def.catchall) {
				if (ctx.io === "output") json.additionalProperties = false;
			} else if (def.catchall) json.additionalProperties = processSchema(def.catchall, ctx, {
				...params,
				path: [...params.path, "additionalProperties"]
			});
		};
		const unionProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			const isExclusive = def.inclusive === false;
			const options = def.options.map((x, i) => processSchema(x, ctx, {
				...params,
				path: [
					...params.path,
					isExclusive ? "oneOf" : "anyOf",
					i
				]
			}));
			if (isExclusive) json.oneOf = options;
			else json.anyOf = options;
		};
		const intersectionProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			const a = processSchema(def.left, ctx, {
				...params,
				path: [
					...params.path,
					"allOf",
					0
				]
			});
			const b = processSchema(def.right, ctx, {
				...params,
				path: [
					...params.path,
					"allOf",
					1
				]
			});
			const isSimpleIntersection = (val) => "allOf" in val && Object.keys(val).length === 1;
			const allOf = [...isSimpleIntersection(a) ? a.allOf : [a], ...isSimpleIntersection(b) ? b.allOf : [b]];
			json.allOf = allOf;
			ctx.intersections.push(allOf);
		};
		const nullableProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			const inner = processSchema(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			if (ctx.target === "openapi-3.0") {
				seen.ref = def.innerType;
				json.nullable = true;
			} else json.anyOf = [inner, { type: "null" }];
		};
		const nonoptionalProcessor = (schema, ctx, _json, params) => {
			const def = schema._zod.def;
			processSchema(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
		};
		/** Round-trips a default value through JSON so the emitted schema is guaranteed to be valid JSON.
		* A BigInt has no reliable encoding, so it goes through `unrepresentable` like any other
		* unrepresentable value. Returns a sentinel when the caller must not write a default of its own. */
		const UNREPRESENTABLE_DEFAULT = Symbol();
		function serializeDefaultValue(value, schema, ctx, json, params) {
			let unrepresentable = false;
			const serialized = JSON.stringify(value, (_, val) => {
				if (typeof val !== "bigint") return val;
				unrepresentable = true;
				return null;
			});
			if (!unrepresentable) return JSON.parse(serialized);
			handleUnrepresentable(schema, ctx, json, params, "BigInt defaults cannot be represented in JSON Schema");
			return UNREPRESENTABLE_DEFAULT;
		}
		const defaultProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			processSchema(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
			const value = serializeDefaultValue(def.defaultValue, schema, ctx, json, params);
			if (value !== UNREPRESENTABLE_DEFAULT) json.default = value;
		};
		const prefaultProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			processSchema(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
			if (ctx.io !== "input") return;
			const value = serializeDefaultValue(def.defaultValue, schema, ctx, json, params);
			if (value !== UNREPRESENTABLE_DEFAULT) json._prefault = value;
		};
		const catchProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			processSchema(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
			let catchValue;
			try {
				catchValue = def.catchValue(void 0);
			} catch {
				handleUnrepresentable(schema, ctx, json, params, "Dynamic catch values are not supported in JSON Schema");
				return;
			}
			json.default = catchValue;
		};
		const pipeProcessor = (schema, ctx, _json, params) => {
			const def = schema._zod.def;
			const inIsTransform = def.in._zod.traits.has("$ZodTransform");
			const innerType = ctx.io === "input" ? inIsTransform ? def.out : def.in : def.out;
			processSchema(innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = innerType;
		};
		const readonlyProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			processSchema(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
			json.readOnly = true;
		};
		const optionalProcessor = (schema, ctx, _json, params) => {
			const def = schema._zod.def;
			processSchema(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
		};
		//#endregion
		//#region node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/classic/errors.js
		const _installedErrorProtos = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]);
		function _lazyMethod(proto, key, make) {
			Object.defineProperty(proto, key, {
				configurable: true,
				enumerable: false,
				get() {
					const value = make(this);
					Object.defineProperty(this, key, {
						value,
						configurable: true,
						writable: true
					});
					return value;
				},
				set(value) {
					Object.defineProperty(this, key, {
						value,
						configurable: true,
						writable: true
					});
				}
			});
		}
		const initializer = (inst, issues) => {
			$ZodError.init(inst, issues);
			inst.name = "ZodError";
			const proto = Object.getPrototypeOf(inst);
			if (_installedErrorProtos.has(proto)) return;
			_installedErrorProtos.add(proto);
			_lazyMethod(proto, "format", (self) => (mapper) => formatError(self, mapper));
			_lazyMethod(proto, "flatten", (self) => (mapper) => flattenError(self, mapper));
			_lazyMethod(proto, "addIssue", (self) => (issue) => {
				self.issues.push(issue);
				self.message = JSON.stringify(self.issues, jsonStringifyReplacer, 2);
			});
			_lazyMethod(proto, "addIssues", (self) => (issues) => {
				self.issues.push(...issues);
				self.message = JSON.stringify(self.issues, jsonStringifyReplacer, 2);
			});
			Object.defineProperty(proto, "isEmpty", {
				configurable: true,
				enumerable: false,
				get() {
					return this.issues.length === 0;
				}
			});
		};
		const ZodRealError = /*@__PURE__*/ $constructor("ZodError", initializer, void 0, { Parent: Error });
		//#endregion
		//#region node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/classic/parse.js
		const parse = /* @__PURE__ */ _parse(ZodRealError);
		const parseAsync = /* @__PURE__ */ _parseAsync(ZodRealError);
		const safeParse = /* @__PURE__ */ _safeParse(ZodRealError);
		const safeParseAsync = /* @__PURE__ */ _safeParseAsync(ZodRealError);
		const encode = /* @__PURE__ */ _encode(ZodRealError);
		const decode = /* @__PURE__ */ _decode(ZodRealError);
		const encodeAsync = /* @__PURE__ */ _encodeAsync(ZodRealError);
		const decodeAsync = /* @__PURE__ */ _decodeAsync(ZodRealError);
		const safeEncode = /* @__PURE__ */ _safeEncode(ZodRealError);
		const safeDecode = /* @__PURE__ */ _safeDecode(ZodRealError);
		const safeEncodeAsync = /* @__PURE__ */ _safeEncodeAsync(ZodRealError);
		const safeDecodeAsync = /* @__PURE__ */ _safeDecodeAsync(ZodRealError);
		//#endregion
		//#region node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/classic/schemas.js
		function _ensureDefaultLocale() {
			if (!globalConfig.localeError) config(en_default());
		}
		function _ensureDefaultMemoizer() {
			if (!globalConfig.memoizer) config({ memoizer: memoizer() });
		}
		const ZodType = /*@__PURE__*/ $constructor("ZodType", (inst, def) => {
			_ensureDefaultLocale();
			$ZodType.init(inst, def);
			inst.def = def;
			inst.type = def.type;
			return inst;
		}, {
			check(...chks) {
				const def = this.def;
				return this.clone(mergeDefs(def, { checks: [...def.checks ?? [], ...chks.map((ch) => typeof ch === "function" ? { _zod: {
					check: ch,
					def: { check: "custom" },
					onattach: []
				} } : ch)] }), { parent: true });
			},
			with(...chks) {
				return this.check(...chks);
			},
			clone(def, params) {
				return clone(this, def, params);
			},
			brand() {
				return this;
			},
			register(reg, meta) {
				reg.add(this, meta);
				return this;
			},
			refine(check, params) {
				return this.check(refine(check, params));
			},
			superRefine(refinement, params) {
				return this.check(superRefine(refinement, params));
			},
			overwrite(fn) {
				return this.check(/* @__PURE__ */ _overwrite(fn));
			},
			optional() {
				return optional(this);
			},
			exactOptional() {
				return exactOptional(this);
			},
			nullable() {
				return nullable(this);
			},
			nullish() {
				return optional(nullable(this));
			},
			nonoptional(params) {
				return nonoptional(this, params);
			},
			array() {
				return array(this);
			},
			or(arg) {
				return union([this, arg]);
			},
			and(arg) {
				return intersection(this, arg);
			},
			transform(tx) {
				return pipe(this, transform(tx));
			},
			default(d) {
				return _default(this, d);
			},
			prefault(d) {
				return prefault(this, d);
			},
			catch(params) {
				return _catch(this, params);
			},
			pipe(target) {
				return pipe(this, target);
			},
			readonly() {
				return readonly(this);
			},
			describe(description) {
				const cl = this.clone();
				globalRegistry.add(cl, { description });
				return cl;
			},
			meta(...args) {
				if (args.length === 0) return globalRegistry.get(this);
				const cl = this.clone();
				globalRegistry.add(cl, args[0]);
				return cl;
			},
			isOptional() {
				return this.safeParse(void 0).success;
			},
			isNullable() {
				return this.safeParse(null).success;
			},
			apply(fn, ...args) {
				return args.length === 0 ? fn(this) : fn(this, ...args);
			},
			get "~standard"() {
				return hide(this, "~standard", {
					...standardProps(this),
					jsonSchema: {
						input: createStandardJSONSchemaMethod(this, "input"),
						output: createStandardJSONSchemaMethod(this, "output")
					}
				});
			},
			set "~standard"(value) {
				own(this, "~standard", value);
			},
			parse: function _parse(data, params) {
				return parse(this, data, params, { callee: _parse });
			},
			parseAsync: async function _parseAsync(data, params) {
				return await parseAsync(this, data, params, { callee: _parseAsync });
			},
			safeParse(data, params) {
				return safeParse(this, data, params);
			},
			async safeParseAsync(data, params) {
				return safeParseAsync(this, data, params);
			},
			get spa() {
				return this?.safeParseAsync;
			},
			set spa(value) {
				own(this, "spa", value);
			},
			validate(data, params) {
				return validate(this, data, params);
			},
			validateAsync(data, params) {
				return validateAsync$1(this, data, params);
			},
			encode: function _encode(data, params) {
				return encode(this, data, params, { callee: _encode });
			},
			decode: function _decode(data, params) {
				return decode(this, data, params, { callee: _decode });
			},
			encodeAsync: async function _encodeAsync(data, params) {
				return await encodeAsync(this, data, params, { callee: _encodeAsync });
			},
			decodeAsync: async function _decodeAsync(data, params) {
				return await decodeAsync(this, data, params, { callee: _decodeAsync });
			},
			safeEncode(data, params) {
				return safeEncode(this, data, params);
			},
			safeDecode(data, params) {
				return safeDecode(this, data, params);
			},
			async safeEncodeAsync(data, params) {
				return safeEncodeAsync(this, data, params);
			},
			async safeDecodeAsync(data, params) {
				return safeDecodeAsync(this, data, params);
			},
			toJSONSchema(params) {
				return createToJSONSchemaMethod(this, {})(params);
			},
			get description() {
				return globalRegistry.get(this)?.description;
			},
			get _def() {
				return this._zod.def;
			}
		});
		/** @internal */
		const _ZodString = /*@__PURE__*/ $constructor("_ZodString", (inst, def) => {
			$ZodString.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => stringProcessor(inst, ctx, json, params);
		}, /*@__PURE__*/ derived({
			format: (inst) => aggregateChecks(inst).format ?? null,
			minLength: (inst) => aggregateChecks(inst).minimum ?? null,
			maxLength: (inst) => aggregateChecks(inst).maximum ?? null
		}, {
			regex(...args) {
				return this.check(/* @__PURE__ */ _regex(...args));
			},
			includes(...args) {
				return this.check(/* @__PURE__ */ _includes(...args));
			},
			startsWith(...args) {
				return this.check(/* @__PURE__ */ _startsWith(...args));
			},
			endsWith(...args) {
				return this.check(/* @__PURE__ */ _endsWith(...args));
			},
			min(...args) {
				return this.check(/* @__PURE__ */ _minLength(...args));
			},
			max(...args) {
				return this.check(/* @__PURE__ */ _maxLength(...args));
			},
			length(...args) {
				return this.check(/* @__PURE__ */ _length(...args));
			},
			nonempty(...args) {
				return this.check(/* @__PURE__ */ _minLength(1, ...args));
			},
			lowercase(params) {
				return this.check(/* @__PURE__ */ _lowercase(params));
			},
			uppercase(params) {
				return this.check(/* @__PURE__ */ _uppercase(params));
			},
			trim() {
				return this.check(/* @__PURE__ */ _trim());
			},
			normalize(...args) {
				return this.check(/* @__PURE__ */ _normalize(...args));
			},
			toLowerCase() {
				return this.check(/* @__PURE__ */ _toLowerCase());
			},
			toUpperCase() {
				return this.check(/* @__PURE__ */ _toUpperCase());
			},
			slugify() {
				return this.check(/* @__PURE__ */ _slugify());
			}
		}));
		const ZodString = /*@__PURE__*/ $constructor("ZodString", (inst, def) => {
			$ZodString.init(inst, def);
			_ZodString.init(inst, def);
		}, {
			email(params) {
				return this.check(/* @__PURE__ */ _email(ZodEmail, params));
			},
			url(params) {
				return this.check(/* @__PURE__ */ _url(ZodURL, params));
			},
			jwt(params) {
				return this.check(/* @__PURE__ */ _jwt(ZodJWT, params));
			},
			emoji(params) {
				return this.check(/* @__PURE__ */ _emoji(ZodEmoji, params));
			},
			guid(params) {
				return this.check(/* @__PURE__ */ _guid(ZodGUID, params));
			},
			uuid(params) {
				return this.check(/* @__PURE__ */ _uuid(ZodUUID, params));
			},
			uuidv4(params) {
				return this.check(/* @__PURE__ */ _uuidv4(ZodUUID, params));
			},
			uuidv6(params) {
				return this.check(/* @__PURE__ */ _uuidv6(ZodUUID, params));
			},
			uuidv7(params) {
				return this.check(/* @__PURE__ */ _uuidv7(ZodUUID, params));
			},
			nanoid(params) {
				return this.check(/* @__PURE__ */ _nanoid(ZodNanoID, params));
			},
			cuid(params) {
				return this.check(/* @__PURE__ */ _cuid(ZodCUID, params));
			},
			cuid2(params) {
				return this.check(/* @__PURE__ */ _cuid2(ZodCUID2, params));
			},
			ulid(params) {
				return this.check(/* @__PURE__ */ _ulid(ZodULID, params));
			},
			base64(params) {
				return this.check(/* @__PURE__ */ _base64(ZodBase64, params));
			},
			base64url(params) {
				return this.check(/* @__PURE__ */ _base64url(ZodBase64URL, params));
			},
			xid(params) {
				return this.check(/* @__PURE__ */ _xid(ZodXID, params));
			},
			ksuid(params) {
				return this.check(/* @__PURE__ */ _ksuid(ZodKSUID, params));
			},
			ipv4(params) {
				return this.check(/* @__PURE__ */ _ipv4(ZodIPv4, params));
			},
			ipv6(params) {
				return this.check(/* @__PURE__ */ _ipv6(ZodIPv6, params));
			},
			cidrv4(params) {
				return this.check(/* @__PURE__ */ _cidrv4(ZodCIDRv4, params));
			},
			cidrv6(params) {
				return this.check(/* @__PURE__ */ _cidrv6(ZodCIDRv6, params));
			},
			e164(params) {
				return this.check(/* @__PURE__ */ _e164(ZodE164, params));
			},
			datetime(params) {
				return this.check(/* @__PURE__ */ _isoDateTime(ZodISODateTime, params));
			},
			date(params) {
				return this.check(/* @__PURE__ */ _isoDate(ZodISODate, params));
			},
			time(params) {
				return this.check(/* @__PURE__ */ _isoTime(ZodISOTime, params));
			},
			duration(params) {
				return this.check(/* @__PURE__ */ _isoDuration(ZodISODuration, params));
			}
		});
		function string(params) {
			return /* @__PURE__ */ _string(ZodString, params);
		}
		const ZodStringFormat = /*@__PURE__*/ $constructor("ZodStringFormat", (inst, def) => {
			$ZodStringFormat.init(inst, def);
			_ZodString.init(inst, def);
		});
		const ZodISODateTime = /*@__PURE__*/ $constructor("ZodISODateTime", (inst, def) => {
			$ZodISODateTime.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodISODate = /*@__PURE__*/ $constructor("ZodISODate", (inst, def) => {
			$ZodISODate.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodISOTime = /*@__PURE__*/ $constructor("ZodISOTime", (inst, def) => {
			$ZodISOTime.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodISODuration = /*@__PURE__*/ $constructor("ZodISODuration", (inst, def) => {
			$ZodISODuration.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodEmail = /*@__PURE__*/ $constructor("ZodEmail", (inst, def) => {
			$ZodEmail.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodGUID = /*@__PURE__*/ $constructor("ZodGUID", (inst, def) => {
			$ZodGUID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodUUID = /*@__PURE__*/ $constructor("ZodUUID", (inst, def) => {
			$ZodUUID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodURL = /*@__PURE__*/ $constructor("ZodURL", (inst, def) => {
			$ZodURL.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodEmoji = /*@__PURE__*/ $constructor("ZodEmoji", (inst, def) => {
			$ZodEmoji.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodNanoID = /*@__PURE__*/ $constructor("ZodNanoID", (inst, def) => {
			$ZodNanoID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		/**
		* @deprecated CUID v1 is deprecated by its authors due to information leakage
		* (timestamps embedded in the id). Use {@link ZodCUID2} instead.
		* See https://github.com/paralleldrive/cuid.
		*/
		const ZodCUID = /*@__PURE__*/ $constructor("ZodCUID", (inst, def) => {
			$ZodCUID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodCUID2 = /*@__PURE__*/ $constructor("ZodCUID2", (inst, def) => {
			$ZodCUID2.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodULID = /*@__PURE__*/ $constructor("ZodULID", (inst, def) => {
			$ZodULID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodXID = /*@__PURE__*/ $constructor("ZodXID", (inst, def) => {
			$ZodXID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodKSUID = /*@__PURE__*/ $constructor("ZodKSUID", (inst, def) => {
			$ZodKSUID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodIPv4 = /*@__PURE__*/ $constructor("ZodIPv4", (inst, def) => {
			$ZodIPv4.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodIPv6 = /*@__PURE__*/ $constructor("ZodIPv6", (inst, def) => {
			$ZodIPv6.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodCIDRv4 = /*@__PURE__*/ $constructor("ZodCIDRv4", (inst, def) => {
			$ZodCIDRv4.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodCIDRv6 = /*@__PURE__*/ $constructor("ZodCIDRv6", (inst, def) => {
			$ZodCIDRv6.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodBase64 = /*@__PURE__*/ $constructor("ZodBase64", (inst, def) => {
			$ZodBase64.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodBase64URL = /*@__PURE__*/ $constructor("ZodBase64URL", (inst, def) => {
			$ZodBase64URL.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodE164 = /*@__PURE__*/ $constructor("ZodE164", (inst, def) => {
			$ZodE164.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodJWT = /*@__PURE__*/ $constructor("ZodJWT", (inst, def) => {
			$ZodJWT.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodNumber = /*@__PURE__*/ $constructor("ZodNumber", (inst, def) => {
			$ZodNumber.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => numberProcessor(inst, ctx, json, params);
			inst.isFinite = true;
		}, /*@__PURE__*/ derived({
			minValue: (inst) => {
				const { minimum, exclusiveMinimum } = aggregateChecks(inst);
				return Math.max(minimum ?? Number.NEGATIVE_INFINITY, exclusiveMinimum ?? Number.NEGATIVE_INFINITY);
			},
			maxValue: (inst) => {
				const { maximum, exclusiveMaximum } = aggregateChecks(inst);
				return Math.min(maximum ?? Number.POSITIVE_INFINITY, exclusiveMaximum ?? Number.POSITIVE_INFINITY);
			},
			isInt: (inst) => {
				const { isInt, multipleOf } = aggregateChecks(inst);
				return !!isInt || !!multipleOf?.some(Number.isSafeInteger);
			},
			format: (inst) => aggregateChecks(inst).format ?? null
		}, {
			gt(value, params) {
				return this.check(/* @__PURE__ */ _gt(value, params));
			},
			gte(value, params) {
				return this.check(/* @__PURE__ */ _gte(value, params));
			},
			min(value, params) {
				return this.check(/* @__PURE__ */ _gte(value, params));
			},
			lt(value, params) {
				return this.check(/* @__PURE__ */ _lt(value, params));
			},
			lte(value, params) {
				return this.check(/* @__PURE__ */ _lte(value, params));
			},
			max(value, params) {
				return this.check(/* @__PURE__ */ _lte(value, params));
			},
			int(params) {
				return this.check(int(params));
			},
			safe(params) {
				return this.check(int(params));
			},
			positive(params) {
				return this.check(/* @__PURE__ */ _gt(0, params));
			},
			nonnegative(params) {
				return this.check(/* @__PURE__ */ _gte(0, params));
			},
			negative(params) {
				return this.check(/* @__PURE__ */ _lt(0, params));
			},
			nonpositive(params) {
				return this.check(/* @__PURE__ */ _lte(0, params));
			},
			multipleOf(value, params) {
				return this.check(/* @__PURE__ */ _multipleOf(value, params));
			},
			step(value, params) {
				return this.check(/* @__PURE__ */ _multipleOf(value, params));
			},
			finite() {
				return this;
			}
		}));
		function number(params) {
			return /* @__PURE__ */ _number(ZodNumber, params);
		}
		const ZodNumberFormat = /*@__PURE__*/ $constructor("ZodNumberFormat", (inst, def) => {
			$ZodNumberFormat.init(inst, def);
			ZodNumber.init(inst, def);
		});
		function int(params) {
			return /* @__PURE__ */ _int(ZodNumberFormat, params);
		}
		const ZodBoolean = /*@__PURE__*/ $constructor("ZodBoolean", (inst, def) => {
			$ZodBoolean.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => booleanProcessor(inst, ctx, json, params);
		});
		function boolean(params) {
			return /* @__PURE__ */ _boolean(ZodBoolean, params);
		}
		const ZodUnknown = /*@__PURE__*/ $constructor("ZodUnknown", (inst, def) => {
			$ZodUnknown.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => void 0;
		});
		function unknown() {
			return /* @__PURE__ */ _unknown(ZodUnknown);
		}
		const ZodNever = /*@__PURE__*/ $constructor("ZodNever", (inst, def) => {
			$ZodNever.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => neverProcessor(inst, ctx, json, params);
		});
		function never(params) {
			return /* @__PURE__ */ _never(ZodNever, params);
		}
		const ZodArray = /*@__PURE__*/ $constructor("ZodArray", (inst, def) => {
			_ensureDefaultMemoizer();
			$ZodArray.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => arrayProcessor(inst, ctx, json, params);
			inst.element = def.element;
		}, {
			min(n, params) {
				return this.check(/* @__PURE__ */ _minLength(n, params));
			},
			nonempty(params) {
				return this.check(/* @__PURE__ */ _minLength(1, params));
			},
			max(n, params) {
				return this.check(/* @__PURE__ */ _maxLength(n, params));
			},
			length(n, params) {
				return this.check(/* @__PURE__ */ _length(n, params));
			},
			unwrap() {
				return this.element;
			}
		});
		function array(element, params) {
			return /* @__PURE__ */ _array(ZodArray, element, params);
		}
		const ZodObject = /*@__PURE__*/ $constructor("ZodObject", (inst, def) => {
			_ensureDefaultMemoizer();
			$ZodObjectJIT.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => objectProcessor(inst, ctx, json, params);
			installLazyProp(inst, "shape", (self) => self._zod.def.shape, false);
		}, {
			keyof() {
				return _enum(Object.keys(this._zod.def.shape));
			},
			catchall(catchall) {
				return this.clone(mergeDefs(this._zod.def, { catchall }));
			},
			passthrough() {
				return this.clone(mergeDefs(this._zod.def, { catchall: unknown() }));
			},
			loose() {
				return this.clone(mergeDefs(this._zod.def, { catchall: unknown() }));
			},
			strict() {
				return this.clone(mergeDefs(this._zod.def, { catchall: never() }));
			},
			strip() {
				return this.clone(mergeDefs(this._zod.def, { catchall: void 0 }));
			},
			extend(incoming) {
				return extend(this, incoming);
			},
			safeExtend(incoming) {
				return safeExtend(this, incoming);
			},
			merge(other) {
				return merge(this, other);
			},
			pick(mask) {
				return pick(this, mask);
			},
			omit(mask) {
				return omit(this, mask);
			},
			partial(...args) {
				return partial(ZodOptional, this, args[0]);
			},
			exactPartial(...args) {
				return partial(ZodExactOptional, this, args[0], "exactPartial");
			},
			required(...args) {
				return required(ZodNonOptional, this, args[0]);
			}
		});
		function object(shape, params) {
			const def = {
				type: "object",
				shape: shape ?? {},
				...normalizeParams(params)
			};
			return new ZodObject(def);
		}
		const ZodUnion = /*@__PURE__*/ $constructor("ZodUnion", (inst, def) => {
			$ZodUnion.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => unionProcessor(inst, ctx, json, params);
			inst.options = def.options;
		});
		function union(options, params) {
			return new ZodUnion({
				type: "union",
				options,
				...normalizeParams(params)
			});
		}
		const ZodIntersection = /*@__PURE__*/ $constructor("ZodIntersection", (inst, def) => {
			$ZodIntersection.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => intersectionProcessor(inst, ctx, json, params);
		});
		function intersection(left, right) {
			return new ZodIntersection({
				type: "intersection",
				left,
				right
			});
		}
		const ZodEnum = /*@__PURE__*/ $constructor("ZodEnum", (inst, def) => {
			$ZodEnum.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => enumProcessor(inst, ctx, json, params);
			inst.enum = def.entries;
			inst.options = [...inst._zod.values];
			const keys = new Set(Object.keys(def.entries));
			inst.extract = (values, params) => {
				const newEntries = {};
				for (const value of values) if (keys.has(value)) newEntries[value] = def.entries[value];
				else throw new Error(`Key ${value} not found in enum`);
				return new ZodEnum({
					...def,
					checks: [],
					...normalizeParams(params),
					entries: newEntries
				});
			};
			inst.exclude = (values, params) => {
				const newEntries = { ...def.entries };
				for (const value of values) if (keys.has(value)) delete newEntries[value];
				else throw new Error(`Key ${value} not found in enum`);
				return new ZodEnum({
					...def,
					checks: [],
					...normalizeParams(params),
					entries: newEntries
				});
			};
		});
		function _enum(values, params) {
			const entries = Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values;
			return new ZodEnum({
				type: "enum",
				entries,
				...normalizeParams(params)
			});
		}
		const ZodTransform = /*@__PURE__*/ $constructor("ZodTransform", (inst, def) => {
			_ensureDefaultMemoizer();
			$ZodTransform.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => transformProcessor(inst, ctx, json, params);
			inst._zod.parse = (payload, _ctx) => {
				if (_ctx.direction === "backward") throw new $ZodEncodeError(inst.constructor.name);
				payload.addIssue = (issue$1) => {
					if (typeof issue$1 === "string") payload.issues.push(issue(issue$1, payload.value, def));
					else {
						const _issue = issue$1;
						if (_issue.fatal) _issue.continue = false;
						_issue.code ?? (_issue.code = "custom");
						if (!("input" in _issue)) _issue.input = payload.value;
						_issue.inst ?? (_issue.inst = inst);
						payload.issues.push(issue(_issue));
					}
				};
				const output = def.transform(payload.value, payload);
				if (output instanceof Promise) return output.then((output) => {
					payload.value = output;
					return payload;
				});
				payload.value = output;
				return payload;
			};
		});
		function transform(fn) {
			return new ZodTransform({
				type: "transform",
				transform: fn
			});
		}
		const ZodOptional = /*@__PURE__*/ $constructor("ZodOptional", (inst, def) => {
			$ZodOptional.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function optional(innerType) {
			return new ZodOptional({
				type: "optional",
				innerType
			});
		}
		const ZodExactOptional = /*@__PURE__*/ $constructor("ZodExactOptional", (inst, def) => {
			$ZodExactOptional.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function exactOptional(innerType) {
			return new ZodExactOptional({
				type: "optional",
				innerType
			});
		}
		const ZodNullable = /*@__PURE__*/ $constructor("ZodNullable", (inst, def) => {
			$ZodNullable.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => nullableProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function nullable(innerType) {
			return new ZodNullable({
				type: "nullable",
				innerType
			});
		}
		const ZodDefault = /*@__PURE__*/ $constructor("ZodDefault", (inst, def) => {
			$ZodDefault.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => defaultProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
			inst.removeDefault = inst.unwrap;
		});
		function _default(innerType, defaultValue) {
			return new ZodDefault({
				type: "default",
				innerType,
				get defaultValue() {
					return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
				}
			});
		}
		const ZodPrefault = /*@__PURE__*/ $constructor("ZodPrefault", (inst, def) => {
			$ZodPrefault.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => prefaultProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function prefault(innerType, defaultValue) {
			return new ZodPrefault({
				type: "prefault",
				innerType,
				get defaultValue() {
					return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
				}
			});
		}
		const ZodNonOptional = /*@__PURE__*/ $constructor("ZodNonOptional", (inst, def) => {
			$ZodNonOptional.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => nonoptionalProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function nonoptional(innerType, params) {
			return new ZodNonOptional({
				type: "nonoptional",
				innerType,
				...normalizeParams(params)
			});
		}
		const ZodCatch = /*@__PURE__*/ $constructor("ZodCatch", (inst, def) => {
			$ZodCatch.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => catchProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
			inst.removeCatch = inst.unwrap;
		});
		function _catch(innerType, catchValue) {
			return new ZodCatch({
				type: "catch",
				innerType,
				catchValue: typeof catchValue === "function" ? catchValue : constantCatch(catchValue)
			});
		}
		const ZodPipe = /*@__PURE__*/ $constructor("ZodPipe", (inst, def) => {
			$ZodPipe.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => pipeProcessor(inst, ctx, json, params);
			inst.in = def.in;
			inst.out = def.out;
		});
		function pipe(in_, out) {
			return new ZodPipe({
				type: "pipe",
				in: in_,
				out
			});
		}
		const ZodReadonly = /*@__PURE__*/ $constructor("ZodReadonly", (inst, def) => {
			$ZodReadonly.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => readonlyProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function readonly(innerType) {
			return new ZodReadonly({
				type: "readonly",
				innerType
			});
		}
		const ZodCustom = /*@__PURE__*/ $constructor("ZodCustom", (inst, def) => {
			$ZodCustom.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => customProcessor(inst, ctx, json, params);
		});
		function refine(fn, _params = {}) {
			return /* @__PURE__ */ _refine(ZodCustom, fn, _params);
		}
		function superRefine(fn, params) {
			return /* @__PURE__ */ _superRefine(fn, params);
		}
		//#endregion
		//#region src/typert-descriptors.ts
		/** Strict Typert codecs shared by the Host and browser contribution artifacts.
		*
		* 双字段兼容（2026-09-19，dsh 0.1.6-alpha.2 适配）：alpha.2 的 typert-loader
		* 要求 strict codec 以 create() 工厂懒物化 schema（无 create 过不了注册
		* 校验，且失败连带撤回该 fiber 全部远端定义）；rc/alpha.1 时代的运行时
		* 读饿汉 schema 字段。两代并存期同时提供：新运行时取 create，旧的取
		* schema。对象以 const 持有（非新鲜字面量），旧类型系统不做多余属性
		* 检查，编译两侧兼容。
		*/
		const PACKAGE_NAME = "dsh-file-review-kcoder";
		const diffSchema = object({
			path: string(),
			oldText: string().nullable(),
			newText: string(),
			oldStart: number().int().min(1).optional(),
			newStart: number().int().min(1).optional()
		});
		const requestSchema = object({
			action: _enum(["undo", "redo"]),
			files: array(object({
				path: string(),
				diffs: array(diffSchema)
			}))
		});
		const resultSchema = object({ files: array(object({
			path: string(),
			state: _enum([
				"applied",
				"undone",
				"conflict",
				"unsupported",
				"error"
			]),
			changed: boolean(),
			reason: string().optional()
		})) });
		const agentCodec = {
			mode: "strict",
			typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
			create: () => intersection(string(), unknown()),
			schema: intersection(string(), unknown())
		};
		const requestCodec = {
			mode: "strict",
			typeSymbol: `${PACKAGE_NAME}#FileReviewRequest`,
			create: () => requestSchema,
			schema: requestSchema
		};
		const resultCodec = {
			mode: "strict",
			typeSymbol: `${PACKAGE_NAME}#FileReviewResult`,
			create: () => resultSchema,
			schema: resultSchema
		};
		const recordedMutationSchema = object({
			rootCallId: string(),
			name: string(),
			path: string(),
			before: string().nullable(),
			after: string()
		});
		const recordedRequestSchema = object({ rootCallIds: array(string()) });
		const recordedResultSchema = object({ mutations: array(recordedMutationSchema) });
		const recordedRequestCodec = {
			mode: "strict",
			typeSymbol: `${PACKAGE_NAME}#RecordedRequest`,
			create: () => recordedRequestSchema,
			schema: recordedRequestSchema
		};
		const recordedResultCodec = {
			mode: "strict",
			typeSymbol: `${PACKAGE_NAME}#RecordedResult`,
			create: () => recordedResultSchema,
			schema: recordedResultSchema
		};
		function descriptor(method) {
			return {
				id: `${PACKAGE_NAME}#fileReview/${method}`,
				service: "fileReview",
				namespace: "fileReview",
				method,
				invocation: { kind: "direct" },
				scope: {
					context: "agent",
					wire: "agentId"
				},
				parameters: [{
					name: "agent",
					wire: "agentId",
					source: "lookup",
					lookup: "agent",
					codec: agentCodec
				}, {
					name: "request",
					wire: "request",
					source: "json",
					codec: requestCodec
				}],
				result: resultCodec
			};
		}
		function recordedDescriptor() {
			return {
				id: `${PACKAGE_NAME}#fileReview/recorded`,
				service: "fileReview",
				namespace: "fileReview",
				method: "recorded",
				invocation: { kind: "direct" },
				scope: {
					context: "agent",
					wire: "agentId"
				},
				parameters: [{
					name: "agent",
					wire: "agentId",
					source: "lookup",
					lookup: "agent",
					codec: agentCodec
				}, {
					name: "request",
					wire: "request",
					source: "json",
					codec: recordedRequestCodec
				}],
				result: recordedResultCodec
			};
		}
		//#endregion
		//#region src/remote.ts
		const TYPERT_REMOTE = {
			package: PACKAGE_NAME,
			descriptors: [
				descriptor("status"),
				descriptor("apply"),
				recordedDescriptor()
			]
		};
		//#endregion
		//#region src/client/artifacts.ts
		/** Extensions (lowercase, no dot) per artifact class. */
		const KIND_EXTS = {
			image: [
				"png",
				"jpg",
				"jpeg",
				"gif",
				"webp",
				"svg",
				"bmp",
				"ico",
				"avif",
				"tiff",
				"tif"
			],
			video: [
				"mp4",
				"webm",
				"mov",
				"mkv",
				"avi",
				"m4v",
				"mpg",
				"mpeg",
				"wmv",
				"flv"
			],
			audio: [
				"mp3",
				"wav",
				"m4a",
				"ogg",
				"oga",
				"flac",
				"aac",
				"opus",
				"wma"
			],
			office: [
				"docx",
				"xlsx",
				"pptx",
				"doc",
				"xls",
				"ppt",
				"odt",
				"ods",
				"odp"
			],
			pdf: ["pdf"],
			doc: [
				"md",
				"markdown",
				"html",
				"htm"
			]
		};
		const EXT_TO_KIND = /* @__PURE__ */ new Map();
		for (const [kind, exts] of Object.entries(KIND_EXTS)) for (const ext of exts) EXT_TO_KIND.set(ext, kind);
		/** Trailing path segment after the last dot, lowercased ('' when none). */
		function extensionOf$1(path) {
			const at = path.lastIndexOf(".");
			const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
			if (at === -1 || at < slash) return "";
			return path.slice(at + 1).toLowerCase();
		}
		/**
		* Classify a produced path. Returns 'code' for everything that is not a
		* known artifact extension — the caller keeps the diff-review behavior for
		* 'code' unchanged.
		*/
		function classifyPath(path) {
			return EXT_TO_KIND.get(extensionOf$1(path)) ?? "code";
		}
		/**
		* Shell output targets: one capture group around a quoted or bare token.
		* Quoted tokens may contain spaces (that is what the quotes are for); bare
		* tokens stay shell-delimiter-exclusive. Shared by every indicator pattern
		* so matches decode uniformly.
		*/
		const TARGET = String.raw`("[^"]+"|'[^']+'|[^\s"'><|;&]+)`;
		/** Output indicators worth scanning (global, flag case-insensitive). */
		const INDICATORS = [
			new RegExp(String.raw`(?:^|[\s;|&])(?:\d)?>>?\s*${TARGET}`, "g"),
			new RegExp(String.raw`(?:^|\s)(?:--output(?:=|\s+)|--output-document(?:=|\s+)|-o\s+|-O\s+)${TARGET}`, "gi"),
			new RegExp(String.raw`(?:^|\s)(?:cp|mv)\s[^;|&]*?\s${TARGET}\s*(?=$|[;|&])`, "gi"),
			new RegExp(String.raw`(?:^|\s)tee\s+(?:-a\s+)?${TARGET}`, "g")
		];
		/** Decode the single capture group: strip one layer of quotes. */
		function decodeTarget(match) {
			const raw = match[1] ?? "";
			return raw.length >= 2 && (raw.startsWith("\"") && raw.endsWith("\"") || raw.startsWith("'") && raw.endsWith("'")) ? raw.slice(1, -1) : raw;
		}
		/**
		* Artifact files one mutation-tool call creates, judged from its OWN
		* arguments — the same argument-contract philosophy as mutationDetail, with
		* a much tighter net: the tool must be a shell, and every candidate target
		* must carry a known artifact extension. Order is first-seen; duplicates
		* collapse.
		*/
		function captureArtifacts(name, argsRaw) {
			if (name !== "bash" && name !== "pwsh") return [];
			let args;
			try {
				args = JSON.parse(argsRaw);
			} catch {
				return [];
			}
			if (typeof args !== "object" || args === null || Array.isArray(args)) return [];
			const command = args.command;
			if (typeof command !== "string" || command === "") return [];
			const found = /* @__PURE__ */ new Map();
			for (const pattern of INDICATORS) {
				pattern.lastIndex = 0;
				let match = pattern.exec(command);
				while (match !== null) {
					const target = decodeTarget(match);
					const kind = EXT_TO_KIND.get(extensionOf$1(target));
					if (kind !== void 0 && !found.has(target)) found.set(target, kind);
					match = pattern.exec(command);
				}
			}
			return [...found].map(([path, artifact]) => ({
				path,
				artifact
			}));
		}
		//#endregion
		//#region src/client/conversation-store.ts
		/**
		* Turn-scoped content fingerprint for the turn-tail card's reactive
		* subscription. The session chat source publishes a fresh snapshot reference
		* per streaming event (token flushes, per-event Definition republications —
		* see index.tsx badgeCount), so a subscription keyed on the face reference
		* re-rendered every mounted card non-stop while ANY turn ran, and the card's
		* identity-keyed inspection effect turned that churn into a disabled-state
		* flicker on the 撤销 button (statusPending true → host status RPC → false,
		* per publication). This fingerprint instead moves only when ONE turn's
		* review content moves: the own Definition data signature (paths + hunk
		* counts + deletion flags — the engine APPENDS hunks, definition.ts update(),
		* so counts are monotonic and faithful) plus the built-in deliverables
		* fallback signature (the derive falls back to it when own data has no
		* files, session-changes.deriveTimelineChanges). A string on purpose:
		* recomputation stays Object.is-stable for useSyncExternalStore.
		* @param face - resolved conversation face (null before the view assembles).
		* @param turn - the card's owning turn number.
		* @returns Content signature; equal across content-preserving republications.
		*/
		function turnChangesFingerprint(face, turn) {
			if (face === null) return "none";
			const timeline = face.timeline;
			if (timeline === void 0) {
				let lastEnd = 0;
				for (const endSeq of face.legacy.turnEnds.values()) lastEnd = endSeq;
				return `win:${face.legacy.nodes.length}:${face.legacy.turnEnds.size}:${lastEnd}`;
			}
			const data = timeline.turns.get(turn)?.data;
			const own = data?.get("fileReviewChanges");
			const parts = [];
			if (own?.files !== void 0) for (const file of own.files) parts.push(`${file.path}#${file.diffs.length}${file.deleted === true ? "D" : ""}`);
			const produced = (data?.get("deliverables"))?.produced;
			if (produced !== void 0) parts.push(`dl:${produced.length}:${produced.at(-1)?.seq ?? 0}`);
			return `t${turn}:${parts.join("|")}`;
		}
		/** Read a service without the inject requirement (ctx.get, then reflect). */
		function lookupService(ctx, name) {
			const anyCtx = ctx;
			if (typeof anyCtx.get === "function") return anyCtx.get(name);
			return ctx.reflect.get(name);
		}
		/**
		* Resolve the chat-view snapshot store for one session, or undefined when the
		* carrier provides no uiConversation service (or the session has no binding).
		* The returned store is identity-stable per session, so callers may hold it
		* across renders.
		*/
		function resolveConversationStore(ctx, sessionId) {
			const service = lookupService(ctx, "uiConversation");
			if (service === void 0 || typeof service.binding !== "function") return void 0;
			try {
				const source = service.binding(sessionId)?.target?.("chat");
				if (source === void 0) return void 0;
				let seen = false;
				let cachedSnap;
				let cachedFace = null;
				return {
					getSnapshot: () => {
						const snap = source.getSnapshot();
						if (seen && snap === cachedSnap) return cachedFace;
						let face;
						if (snap === void 0 || snap === null) face = null;
						else if ("legacy" in snap && snap.legacy !== void 0 && snap.legacy !== null) face = {
							legacy: snap.legacy,
							timeline: snap.timeline
						};
						else face = {
							legacy: snap,
							timeline: void 0
						};
						seen = true;
						cachedSnap = snap;
						cachedFace = face;
						return face;
					},
					subscribe: (listener) => source.subscribe(listener)
				};
			} catch {
				return;
			}
		}
		//#endregion
		//#region src/client/deleted-paths.ts
		/**
		* Literal deletion-path extraction from terminal call views (unknown-safe).
		*
		* dsh has no dedicated delete-file tool: agents delete through the Bash/Pwsh
		* terminals, whose call views carry the raw command line in `title`. There is
		* no filesystem snapshot to consult, so this parser is deliberately
		* conservative — it only reports paths that appear VERBATIM as arguments of a
		* known deletion command:
		*
		* - command substitution (`$(…)`, backticks) or process substitution anywhere
		*   in a segment disqualifies that whole segment;
		* - glob characters (`* ? [`) or variable expansion (`$`) in an argument
		*   disqualify that argument (the affected set cannot be enumerated post
		*   hoc);
		* - shell separators (`&&`, `||`, `|`, `;`, newline) split the line so
		*   `rm a && rm b` reports both while `echo rm x` reports nothing.
		*
		* A reported path is display-only vocabulary: the file is gone, so it carries
		* no diff hunks and no undo. Directories deleted with `rm -r` surface as the
		* directory path itself.
		*/
		/** Commands whose literal arguments name deleted paths (POSIX + PowerShell aliases). */
		const DELETERS = /* @__PURE__ */ new Set([
			"rm",
			"rmdir",
			"unlink",
			"shred",
			"trash",
			"remove-item",
			"ri",
			"del",
			"rd",
			"erase"
		]);
		/** PowerShell parameters whose NEXT argument is the path, not an option value. */
		const PATH_PARAMETERS = /^-(path|literalpath)$/i;
		/** Arguments never treated as paths: glob/expansion-bearing or self/parent refs. */
		function isPathlike(token) {
			if (token === "" || token === "." || token === "..") return false;
			return !/[*?\[\]$]/.test(token);
		}
		/**
		* Split one command line on shell separators, honoring quotes so a `;` inside
		* a quoted argument does not split.
		*/
		function splitSegments(command) {
			const segments = [];
			let current = "";
			let quote = null;
			for (let at = 0; at < command.length; at += 1) {
				const char = command[at];
				if (quote !== null) {
					if (char === "\\") {
						const next = command[at + 1];
						if (quote === "\"" && next === "\"") {
							current += char + "\"";
							at += 1;
							continue;
						}
						current += char;
						continue;
					}
					if (char === quote) quote = null;
					current += char;
					continue;
				}
				if (char === "\"" || char === "'") {
					quote = char;
					current += char;
					continue;
				}
				const two = command.slice(at, at + 2);
				if (two === "&&" || two === "||") {
					segments.push(current);
					current = "";
					at += 1;
					continue;
				}
				if (char === "|" || char === ";" || char === "\n") {
					segments.push(current);
					current = "";
					continue;
				}
				current += char;
			}
			segments.push(current);
			return segments;
		}
		/**
		* Shell-like tokenization of one segment, quotes joined into the token.
		* Backslash semantics follow the Windows-relevant reading: inside SINGLE
		* quotes (bash/PowerShell alike) everything is literal, and unquoted
		* backslashes stay literal too (PowerShell paths); only inside DOUBLE quotes
		* does a backslash escape the closing quote or itself (bash). A trailing open
		* quote still yields the tokens gathered so far.
		*/
		function tokenize$1(segment) {
			const tokens = [];
			let current = "";
			let quote = null;
			const flush = () => {
				if (current !== "") tokens.push(current);
				current = "";
			};
			for (let at = 0; at < segment.length; at += 1) {
				const char = segment[at];
				if (char === void 0) break;
				if (quote !== null) {
					if (char === "\\") {
						const next = segment[at + 1];
						if (quote === "\"" && (next === "\"" || next === "\\")) {
							current += next;
							at += 1;
							continue;
						}
						current += char;
						continue;
					}
					if (char === quote) {
						quote = null;
						continue;
					}
					current += char;
					continue;
				}
				if (char === "\"" || char === "'") {
					quote = char;
					continue;
				}
				if (/\s/.test(char)) {
					flush();
					continue;
				}
				current += char;
			}
			flush();
			return tokens;
		}
		/**
		* Deletion paths named literally by one terminal command line, in argument
		* order, deduplicated. `undefined`/non-string titles and non-terminal views
		* report nothing.
		*/
		function deletedPathsFromCommand(command) {
			const paths = [];
			const seen = /* @__PURE__ */ new Set();
			const accept = (raw) => {
				for (const part of raw.split(",")) {
					if (!isPathlike(part) || seen.has(part)) continue;
					seen.add(part);
					paths.push(part);
				}
			};
			for (const segment of splitSegments(command)) {
				if (segment.includes("$(") || segment.includes("`") || segment.includes("<(")) continue;
				const tokens = tokenize$1(segment);
				let at = 0;
				while (at < tokens.length) {
					const head = tokens[at];
					if (head === void 0 || !/^[A-Za-z_][A-Za-z0-9_]*=/.test(head)) break;
					at += 1;
				}
				const commandWord = tokens[at];
				if (commandWord === void 0) continue;
				const basename = commandWord.slice(Math.max(commandWord.lastIndexOf("/"), commandWord.lastIndexOf("\\")) + 1);
				if (!DELETERS.has(basename.toLowerCase())) continue;
				for (let index = at + 1; index < tokens.length; index += 1) {
					const token = tokens[index];
					if (token === void 0) continue;
					if (token.startsWith("-")) {
						if (PATH_PARAMETERS.test(token) && index + 1 < tokens.length) {
							index += 1;
							const named = tokens[index];
							if (named !== void 0) accept(named);
						}
						continue;
					}
					accept(token);
				}
			}
			return paths;
		}
		//#endregion
		//#region node_modules/.pnpm/diff@9.0.0/node_modules/diff/libesm/diff/base.js
		var Diff = class {
			diff(oldStr, newStr, options = {}) {
				let callback;
				if (typeof options === "function") {
					callback = options;
					options = {};
				} else if ("callback" in options) callback = options.callback;
				const oldString = this.castInput(oldStr, options);
				const newString = this.castInput(newStr, options);
				const oldTokens = this.removeEmpty(this.tokenize(oldString, options));
				const newTokens = this.removeEmpty(this.tokenize(newString, options));
				return this.diffWithOptionsObj(oldTokens, newTokens, options, callback);
			}
			diffWithOptionsObj(oldTokens, newTokens, options, callback) {
				var _a;
				const done = (value) => {
					value = this.postProcess(value, options);
					if (callback) {
						setTimeout(function() {
							callback(value);
						}, 0);
						return;
					} else return value;
				};
				const newLen = newTokens.length, oldLen = oldTokens.length;
				let editLength = 1;
				let maxEditLength = newLen + oldLen;
				if (options.maxEditLength != null) maxEditLength = Math.min(maxEditLength, options.maxEditLength);
				const maxExecutionTime = (_a = options.timeout) !== null && _a !== void 0 ? _a : Infinity;
				const abortAfterTimestamp = Date.now() + maxExecutionTime;
				const bestPath = [{
					oldPos: -1,
					lastComponent: void 0
				}];
				let newPos = this.extractCommon(bestPath[0], newTokens, oldTokens, 0, options);
				if (bestPath[0].oldPos + 1 >= oldLen && newPos + 1 >= newLen) return done(this.buildValues(bestPath[0].lastComponent, newTokens, oldTokens));
				let minDiagonalToConsider = -Infinity, maxDiagonalToConsider = Infinity;
				const execEditLength = () => {
					for (let diagonalPath = Math.max(minDiagonalToConsider, -editLength); diagonalPath <= Math.min(maxDiagonalToConsider, editLength); diagonalPath += 2) {
						let basePath;
						const removePath = bestPath[diagonalPath - 1], addPath = bestPath[diagonalPath + 1];
						if (removePath) bestPath[diagonalPath - 1] = void 0;
						let canAdd = false;
						if (addPath) {
							const addPathNewPos = addPath.oldPos - diagonalPath;
							canAdd = addPath && 0 <= addPathNewPos && addPathNewPos < newLen;
						}
						const canRemove = removePath && removePath.oldPos + 1 < oldLen;
						if (!canAdd && !canRemove) {
							bestPath[diagonalPath] = void 0;
							continue;
						}
						if (!canRemove || canAdd && removePath.oldPos < addPath.oldPos) basePath = this.addToPath(addPath, true, false, 0, options);
						else basePath = this.addToPath(removePath, false, true, 1, options);
						newPos = this.extractCommon(basePath, newTokens, oldTokens, diagonalPath, options);
						if (basePath.oldPos + 1 >= oldLen && newPos + 1 >= newLen) return done(this.buildValues(basePath.lastComponent, newTokens, oldTokens)) || true;
						else {
							bestPath[diagonalPath] = basePath;
							if (basePath.oldPos + 1 >= oldLen) maxDiagonalToConsider = Math.min(maxDiagonalToConsider, diagonalPath - 1);
							if (newPos + 1 >= newLen) minDiagonalToConsider = Math.max(minDiagonalToConsider, diagonalPath + 1);
						}
					}
					editLength++;
				};
				if (callback) (function exec() {
					setTimeout(function() {
						if (editLength > maxEditLength || Date.now() > abortAfterTimestamp) return callback(void 0);
						if (!execEditLength()) exec();
					}, 0);
				})();
				else while (editLength <= maxEditLength && Date.now() <= abortAfterTimestamp) {
					const ret = execEditLength();
					if (ret) return ret;
				}
			}
			addToPath(path, added, removed, oldPosInc, options) {
				const last = path.lastComponent;
				if (last && !options.oneChangePerToken && last.added === added && last.removed === removed) return {
					oldPos: path.oldPos + oldPosInc,
					lastComponent: {
						count: last.count + 1,
						added,
						removed,
						previousComponent: last.previousComponent
					}
				};
				else return {
					oldPos: path.oldPos + oldPosInc,
					lastComponent: {
						count: 1,
						added,
						removed,
						previousComponent: last
					}
				};
			}
			extractCommon(basePath, newTokens, oldTokens, diagonalPath, options) {
				const newLen = newTokens.length, oldLen = oldTokens.length;
				let oldPos = basePath.oldPos, newPos = oldPos - diagonalPath, commonCount = 0;
				while (newPos + 1 < newLen && oldPos + 1 < oldLen && this.equals(oldTokens[oldPos + 1], newTokens[newPos + 1], options)) {
					newPos++;
					oldPos++;
					commonCount++;
					if (options.oneChangePerToken) basePath.lastComponent = {
						count: 1,
						previousComponent: basePath.lastComponent,
						added: false,
						removed: false
					};
				}
				if (commonCount && !options.oneChangePerToken) basePath.lastComponent = {
					count: commonCount,
					previousComponent: basePath.lastComponent,
					added: false,
					removed: false
				};
				basePath.oldPos = oldPos;
				return newPos;
			}
			equals(left, right, options) {
				if (options.comparator) return options.comparator(left, right);
				else return left === right || !!options.ignoreCase && left.toLowerCase() === right.toLowerCase();
			}
			removeEmpty(array) {
				const ret = [];
				for (let i = 0; i < array.length; i++) if (array[i]) ret.push(array[i]);
				return ret;
			}
			castInput(value, options) {
				return value;
			}
			tokenize(value, options) {
				return Array.from(value);
			}
			join(chars) {
				return chars.join("");
			}
			postProcess(changeObjects, options) {
				return changeObjects;
			}
			get useLongestToken() {
				return false;
			}
			buildValues(lastComponent, newTokens, oldTokens) {
				const components = [];
				let nextComponent;
				while (lastComponent) {
					components.push(lastComponent);
					nextComponent = lastComponent.previousComponent;
					delete lastComponent.previousComponent;
					lastComponent = nextComponent;
				}
				components.reverse();
				const componentLen = components.length;
				let componentPos = 0, newPos = 0, oldPos = 0;
				for (; componentPos < componentLen; componentPos++) {
					const component = components[componentPos];
					if (!component.removed) {
						if (!component.added && this.useLongestToken) {
							let value = newTokens.slice(newPos, newPos + component.count);
							value = value.map(function(value, i) {
								const oldValue = oldTokens[oldPos + i];
								return oldValue.length > value.length ? oldValue : value;
							});
							component.value = this.join(value);
						} else component.value = this.join(newTokens.slice(newPos, newPos + component.count));
						newPos += component.count;
						if (!component.added) oldPos += component.count;
					} else {
						component.value = this.join(oldTokens.slice(oldPos, oldPos + component.count));
						oldPos += component.count;
					}
				}
				return components;
			}
		};
		//#endregion
		//#region node_modules/.pnpm/diff@9.0.0/node_modules/diff/libesm/diff/character.js
		var CharacterDiff = class extends Diff {};
		new CharacterDiff();
		//#endregion
		//#region node_modules/.pnpm/diff@9.0.0/node_modules/diff/libesm/util/string.js
		function longestCommonPrefix(str1, str2) {
			let i = 0;
			for (; i < str1.length && i < str2.length; i++) if (str1[i] != str2[i]) return str1.slice(0, i);
			return str1.slice(0, i);
		}
		function longestCommonSuffix(str1, str2) {
			let i;
			if (!str1 || !str2 || str1[str1.length - 1] != str2[str2.length - 1]) return "";
			for (i = 0; i < str1.length && i < str2.length; i++) if (str1[str1.length - (i + 1)] != str2[str2.length - (i + 1)]) return str1.slice(-i);
			return str1.slice(-i);
		}
		function replacePrefix(string, oldPrefix, newPrefix) {
			if (string.slice(0, oldPrefix.length) != oldPrefix) throw Error(`string ${JSON.stringify(string)} doesn't start with prefix ${JSON.stringify(oldPrefix)}; this is a bug`);
			return newPrefix + string.slice(oldPrefix.length);
		}
		function replaceSuffix(string, oldSuffix, newSuffix) {
			if (!oldSuffix) return string + newSuffix;
			if (string.slice(-oldSuffix.length) != oldSuffix) throw Error(`string ${JSON.stringify(string)} doesn't end with suffix ${JSON.stringify(oldSuffix)}; this is a bug`);
			return string.slice(0, -oldSuffix.length) + newSuffix;
		}
		function removePrefix(string, oldPrefix) {
			return replacePrefix(string, oldPrefix, "");
		}
		function removeSuffix(string, oldSuffix) {
			return replaceSuffix(string, oldSuffix, "");
		}
		function maximumOverlap(string1, string2) {
			return string2.slice(0, overlapCount(string1, string2));
		}
		function overlapCount(a, b) {
			let startA = 0;
			if (a.length > b.length) startA = a.length - b.length;
			let endB = b.length;
			if (a.length < b.length) endB = a.length;
			const map = Array(endB);
			let k = 0;
			map[0] = 0;
			for (let j = 1; j < endB; j++) {
				if (b[j] == b[k]) map[j] = map[k];
				else map[j] = k;
				while (k > 0 && b[j] != b[k]) k = map[k];
				if (b[j] == b[k]) k++;
			}
			k = 0;
			for (let i = startA; i < a.length; i++) {
				while (k > 0 && a[i] != b[k]) k = map[k];
				if (a[i] == b[k]) k++;
			}
			return k;
		}
		/**
		* Split a string into segments using a word segmenter, merging consecutive
		* segments if they are both whitespace segments. Whitespace segments can
		* appear adjacent to one another for two reasons:
		* - newlines always get their own segment
		* - where a diacritic is attached to a whitespace character in the text, the
		*   segment ends after the diacritic, so e.g. " \u0300 " becomes two segments.
		* This function therefore runs the segmenter's .segment() method and then
		* merges consecutive segments of whitespace into a single part.
		*/
		function segment(string, segmenter) {
			const parts = [];
			for (const segmentObj of Array.from(segmenter.segment(string))) {
				const segment = segmentObj.segment;
				if (parts.length && /\s/.test(parts[parts.length - 1]) && /\s/.test(segment)) parts[parts.length - 1] += segment;
				else parts.push(segment);
			}
			return parts;
		}
		function trailingWs(string, segmenter) {
			if (segmenter) return leadingAndTrailingWs(string, segmenter)[1];
			let i;
			for (i = string.length - 1; i >= 0; i--) if (!string[i].match(/\s/)) break;
			return string.substring(i + 1);
		}
		function leadingWs(string, segmenter) {
			if (segmenter) return leadingAndTrailingWs(string, segmenter)[0];
			const match = string.match(/^\s*/);
			return match ? match[0] : "";
		}
		function leadingAndTrailingWs(string, segmenter) {
			if (!segmenter) return [leadingWs(string), trailingWs(string)];
			if (segmenter.resolvedOptions().granularity != "word") throw new Error("The segmenter passed must have a granularity of \"word\"");
			const segments = segment(string, segmenter);
			const firstSeg = segments[0];
			const lastSeg = segments[segments.length - 1];
			return [/\s/.test(firstSeg) ? firstSeg : "", /\s/.test(lastSeg) ? lastSeg : ""];
		}
		//#endregion
		//#region node_modules/.pnpm/diff@9.0.0/node_modules/diff/libesm/diff/word.js
		const extendedWordChars = "a-zA-Z0-9_\\u{AD}\\u{C0}-\\u{D6}\\u{D8}-\\u{F6}\\u{F8}-\\u{2C6}\\u{2C8}-\\u{2D7}\\u{2DE}-\\u{2FF}\\u{1E00}-\\u{1EFF}";
		const tokenizeIncludingWhitespace = new RegExp(`[${extendedWordChars}]+|\\s+|[^${extendedWordChars}]`, "ug");
		var WordDiff = class extends Diff {
			equals(left, right, options) {
				if (options.ignoreCase) {
					left = left.toLowerCase();
					right = right.toLowerCase();
				}
				return left.trim() === right.trim();
			}
			tokenize(value, options = {}) {
				let parts;
				if (options.intlSegmenter) {
					const segmenter = options.intlSegmenter;
					if (segmenter.resolvedOptions().granularity != "word") throw new Error("The segmenter passed must have a granularity of \"word\"");
					parts = segment(value, segmenter);
				} else parts = value.match(tokenizeIncludingWhitespace) || [];
				const tokens = [];
				let prevPart = null;
				parts.forEach((part) => {
					if (/\s/.test(part)) {
						if (prevPart == null) tokens.push(part);
						else tokens.push(tokens.pop() + part);
					} else if (prevPart != null && /\s/.test(prevPart)) {
						if (tokens[tokens.length - 1] == prevPart) tokens.push(tokens.pop() + part);
						else tokens.push(prevPart + part);
					} else tokens.push(part);
					prevPart = part;
				});
				return tokens;
			}
			join(tokens) {
				return tokens.map((token, i) => {
					if (i == 0) return token;
					else return token.replace(/^\s+/, "");
				}).join("");
			}
			postProcess(changes, options) {
				if (!changes || options.oneChangePerToken) return changes;
				let lastKeep = null;
				let insertion = null;
				let deletion = null;
				changes.forEach((change) => {
					if (change.added) insertion = change;
					else if (change.removed) deletion = change;
					else {
						if (insertion || deletion) dedupeWhitespaceInChangeObjects(lastKeep, deletion, insertion, change, options.intlSegmenter);
						lastKeep = change;
						insertion = null;
						deletion = null;
					}
				});
				if (insertion || deletion) dedupeWhitespaceInChangeObjects(lastKeep, deletion, insertion, null, options.intlSegmenter);
				return changes;
			}
		};
		new WordDiff();
		function dedupeWhitespaceInChangeObjects(startKeep, deletion, insertion, endKeep, segmenter) {
			if (deletion && insertion) {
				const [oldWsPrefix, oldWsSuffix] = leadingAndTrailingWs(deletion.value, segmenter);
				const [newWsPrefix, newWsSuffix] = leadingAndTrailingWs(insertion.value, segmenter);
				if (startKeep) {
					const commonWsPrefix = longestCommonPrefix(oldWsPrefix, newWsPrefix);
					startKeep.value = replaceSuffix(startKeep.value, newWsPrefix, commonWsPrefix);
					deletion.value = removePrefix(deletion.value, commonWsPrefix);
					insertion.value = removePrefix(insertion.value, commonWsPrefix);
				}
				if (endKeep) {
					const commonWsSuffix = longestCommonSuffix(oldWsSuffix, newWsSuffix);
					endKeep.value = replacePrefix(endKeep.value, newWsSuffix, commonWsSuffix);
					deletion.value = removeSuffix(deletion.value, commonWsSuffix);
					insertion.value = removeSuffix(insertion.value, commonWsSuffix);
				}
			} else if (insertion) {
				if (startKeep) {
					const ws = leadingWs(insertion.value, segmenter);
					insertion.value = insertion.value.substring(ws.length);
				}
				if (endKeep) {
					const ws = leadingWs(endKeep.value, segmenter);
					endKeep.value = endKeep.value.substring(ws.length);
				}
			} else if (startKeep && endKeep) {
				const newWsFull = leadingWs(endKeep.value, segmenter), [delWsStart, delWsEnd] = leadingAndTrailingWs(deletion.value, segmenter);
				const newWsStart = longestCommonPrefix(newWsFull, delWsStart);
				deletion.value = removePrefix(deletion.value, newWsStart);
				const newWsEnd = longestCommonSuffix(removePrefix(newWsFull, newWsStart), delWsEnd);
				deletion.value = removeSuffix(deletion.value, newWsEnd);
				endKeep.value = replacePrefix(endKeep.value, newWsFull, newWsEnd);
				startKeep.value = replaceSuffix(startKeep.value, newWsFull, newWsFull.slice(0, newWsFull.length - newWsEnd.length));
			} else if (endKeep) {
				const endKeepWsPrefix = leadingWs(endKeep.value, segmenter);
				const overlap = maximumOverlap(trailingWs(deletion.value, segmenter), endKeepWsPrefix);
				deletion.value = removeSuffix(deletion.value, overlap);
			} else if (startKeep) {
				const overlap = maximumOverlap(trailingWs(startKeep.value, segmenter), leadingWs(deletion.value, segmenter));
				deletion.value = removePrefix(deletion.value, overlap);
			}
		}
		var WordsWithSpaceDiff = class extends Diff {
			tokenize(value) {
				const regex = new RegExp(`(\\r?\\n)|[${extendedWordChars}]+|[^\\S\\n\\r]+|[^${extendedWordChars}]`, "ug");
				return value.match(regex) || [];
			}
		};
		new WordsWithSpaceDiff();
		//#endregion
		//#region node_modules/.pnpm/diff@9.0.0/node_modules/diff/libesm/diff/line.js
		var LineDiff = class extends Diff {
			constructor() {
				super(...arguments);
				this.tokenize = tokenize;
			}
			equals(left, right, options) {
				if (options.ignoreWhitespace) {
					if (!options.newlineIsToken || !left.includes("\n")) left = left.trim();
					if (!options.newlineIsToken || !right.includes("\n")) right = right.trim();
				} else if (options.ignoreNewlineAtEof && !options.newlineIsToken) {
					if (left.endsWith("\n")) left = left.slice(0, -1);
					if (right.endsWith("\n")) right = right.slice(0, -1);
				}
				return super.equals(left, right, options);
			}
		};
		new LineDiff();
		function tokenize(value, options) {
			if (options.stripTrailingCr) value = value.replace(/\r\n/g, "\n");
			const retLines = [], linesAndNewlines = value.split(/(\n|\r\n)/);
			if (!linesAndNewlines[linesAndNewlines.length - 1]) linesAndNewlines.pop();
			for (let i = 0; i < linesAndNewlines.length; i++) {
				const line = linesAndNewlines[i];
				if (i % 2 && !options.newlineIsToken) retLines[retLines.length - 1] += line;
				else retLines.push(line);
			}
			return retLines;
		}
		//#endregion
		//#region node_modules/.pnpm/diff@9.0.0/node_modules/diff/libesm/diff/sentence.js
		function isSentenceEndPunct(char) {
			return char == "." || char == "!" || char == "?";
		}
		var SentenceDiff = class extends Diff {
			tokenize(value) {
				var _a;
				const result = [];
				let tokenStartI = 0;
				for (let i = 0; i < value.length; i++) {
					if (i == value.length - 1) {
						result.push(value.slice(tokenStartI));
						break;
					}
					if (isSentenceEndPunct(value[i]) && value[i + 1].match(/\s/)) {
						result.push(value.slice(tokenStartI, i + 1));
						i = tokenStartI = i + 1;
						while ((_a = value[i + 1]) === null || _a === void 0 ? void 0 : _a.match(/\s/)) i++;
						result.push(value.slice(tokenStartI, i + 1));
						tokenStartI = i + 1;
					}
				}
				return result;
			}
		};
		new SentenceDiff();
		//#endregion
		//#region node_modules/.pnpm/diff@9.0.0/node_modules/diff/libesm/diff/css.js
		var CssDiff = class extends Diff {
			tokenize(value) {
				return value.split(/([{}:;,]|\s+)/);
			}
		};
		new CssDiff();
		//#endregion
		//#region node_modules/.pnpm/diff@9.0.0/node_modules/diff/libesm/diff/json.js
		var JsonDiff = class extends Diff {
			constructor() {
				super(...arguments);
				this.tokenize = tokenize;
			}
			get useLongestToken() {
				return true;
			}
			castInput(value, options) {
				const { undefinedReplacement, stringifyReplacer = (k, v) => typeof v === "undefined" ? undefinedReplacement : v } = options;
				return typeof value === "string" ? value : JSON.stringify(canonicalize(value, null, null, stringifyReplacer), null, "  ");
			}
			equals(left, right, options) {
				return super.equals(left.replace(/,([\r\n])/g, "$1"), right.replace(/,([\r\n])/g, "$1"), options);
			}
		};
		new JsonDiff();
		function canonicalize(obj, stack, replacementStack, replacer, key) {
			stack = stack || [];
			replacementStack = replacementStack || [];
			if (replacer) obj = replacer(key === void 0 ? "" : key, obj);
			let i = 0;
			for (; i < stack.length; i += 1) if (stack[i] === obj) return replacementStack[i];
			let canonicalizedObj;
			if ("[object Array]" === Object.prototype.toString.call(obj)) {
				stack.push(obj);
				canonicalizedObj = new Array(obj.length);
				replacementStack.push(canonicalizedObj);
				for (i = 0; i < obj.length; i += 1) canonicalizedObj[i] = canonicalize(obj[i], stack, replacementStack, replacer, String(i));
				stack.pop();
				replacementStack.pop();
				return canonicalizedObj;
			}
			if (obj && obj.toJSON) obj = obj.toJSON();
			if (typeof obj === "object" && obj !== null) {
				stack.push(obj);
				canonicalizedObj = {};
				replacementStack.push(canonicalizedObj);
				const sortedKeys = [];
				let key;
				for (key in obj)
 /* istanbul ignore else */
				if (Object.prototype.hasOwnProperty.call(obj, key)) sortedKeys.push(key);
				sortedKeys.sort();
				for (i = 0; i < sortedKeys.length; i += 1) {
					key = sortedKeys[i];
					canonicalizedObj[key] = canonicalize(obj[key], stack, replacementStack, replacer, key);
				}
				stack.pop();
				replacementStack.pop();
			} else canonicalizedObj = obj;
			return canonicalizedObj;
		}
		//#endregion
		//#region node_modules/.pnpm/diff@9.0.0/node_modules/diff/libesm/diff/array.js
		var ArrayDiff = class extends Diff {
			tokenize(value) {
				return value.slice();
			}
			join(value) {
				return value;
			}
			removeEmpty(value) {
				return value;
			}
		};
		const arrayDiff = new ArrayDiff();
		function diffArrays(oldArr, newArr, options) {
			return arrayDiff.diff(oldArr, newArr, options);
		}
		//#endregion
		//#region src/client/diff-text.ts
		/**
		* Split one side of a diff into content lines without manufacturing a final
		* empty line for a trailing line terminator.
		* @param text - One diff side's text.
		* @returns Content lines without the terminating newline.
		*/
		function diffContentLines(text) {
			if (text === "") return [];
			return (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n");
		}
		//#endregion
		//#region src/client/recorded-diffs.ts
		/**
		* Reconstruct line-level review hunks from one recorded Code Mode mutation's
		* full before/after content. The wire views that carry reusable hunks only
		* ride model-direct tool/call frames; nested `run_code` dispatches are logged
		* with the raw values instead, so this module rebuilds the same hunk shape
		* (`ProducedFileDiff` with line anchors) the rest of the tab renders and the
		* Host undo service applies.
		*/
		/** Unchanged lines kept around each change run, matching unified-diff taste. */
		const CONTEXT_LINES = 3;
		/** Count identical trailing (context) lines of one hunk. */
		function trailingContext(hunk) {
			let count = 0;
			const max = Math.min(hunk.old.length, hunk.new.length);
			for (let offset = 1; offset <= max; offset += 1) {
				if (hunk.old[hunk.old.length - offset] !== hunk.new[hunk.new.length - offset]) break;
				count += 1;
			}
			return count;
		}
		/**
		* Line-level hunks for one file mutation, or a single whole-file entry when the
		* file was created (`before === null`, mirroring the write tool's null-content
		* card). Returns [] when the mutation did not change the file.
		*/
		function diffsFromBeforeAfter(path, before, after) {
			if (before === null) return after === "" ? [] : [{
				path,
				oldText: null,
				newText: after
			}];
			const oldLines = diffContentLines(before);
			const newLines = diffContentLines(after);
			if (oldLines.length === 0 && newLines.length === 0) return [];
			if (oldLines.join("\n") === newLines.join("\n")) return [];
			const hunks = [];
			const changes = diffArrays(oldLines, newLines);
			let contextBuffer = [];
			let oldCursor = 1;
			let newCursor = 1;
			let hunk = null;
			for (const change of changes) {
				if (!change.removed && !change.added) {
					const run = change.value;
					if (hunk !== null) {
						const beforeLen = hunk.old.length;
						hunk.old.push(...run);
						hunk.new.push(...run);
						oldCursor += run.length;
						newCursor += run.length;
						if (run.length > 6) {
							const target = beforeLen + CONTEXT_LINES;
							hunk.old.length = target;
							hunk.new.length = target;
							contextBuffer = run.slice(-3);
							hunk = null;
						}
					} else {
						contextBuffer.push(...run);
						oldCursor += run.length;
						newCursor += run.length;
						if (contextBuffer.length > CONTEXT_LINES) contextBuffer = contextBuffer.slice(-3);
					}
					continue;
				}
				const removed = change.removed ? change.value : [];
				const added = change.added ? change.value : [];
				if (hunk === null) {
					const leading = contextBuffer;
					hunk = {
						oldStart: oldCursor - leading.length,
						newStart: newCursor - leading.length,
						old: [...leading],
						new: [...leading]
					};
					hunks.push(hunk);
				}
				hunk.old.push(...removed);
				hunk.new.push(...added);
				oldCursor += removed.length;
				newCursor += added.length;
			}
			for (const current of hunks) {
				const extra = Math.max(0, trailingContext(current) - CONTEXT_LINES);
				if (extra > 0) {
					current.old.length -= extra;
					current.new.length -= extra;
				}
			}
			return hunks.filter((hunkEntry) => hunkEntry.old.length > 0 || hunkEntry.new.length > 0).map((hunkEntry) => ({
				path,
				oldText: hunkEntry.old.join("\n"),
				newText: hunkEntry.new.join("\n"),
				oldStart: hunkEntry.oldStart,
				newStart: hunkEntry.newStart
			}));
		}
		//#endregion
		//#region src/client/session-changes.ts
		/**
		* Paths a call reports having created or changed, reconstructed from the
		* call's OWN arguments. Since dsh 0.1.2-alpha.1 the finalized ToolResultNode
		* carries no render-intent views (`callView`/`resultView` are gone — only
		* `call: { name, argsRaw }` remains), and the built-in ui-deliverables
		* vocabulary recognizes mutations by tool-argument contract: `write`,
		* `edit`, and the mutating `str_replace_editor` commands. The hunks below
		* are constructed from those same arguments, which the Host reviewer's
		* locate-and-replace transform consumes unchanged: `edit`/`str_replace`
		* hunks are reversible (unique old-text match), creations render as
		* all-green inserts with no undo (nothing to restore), and `insert` is
		* listed with no hunks (its line-anchor semantics are engine-side).
		*/
		function mutationDetail(name, argsRaw) {
			let args;
			try {
				args = JSON.parse(argsRaw);
			} catch {
				return null;
			}
			if (typeof args !== "object" || args === null || Array.isArray(args)) return null;
			const record = args;
			const path = (value) => typeof value === "string" && value.trim().length > 0 ? value : null;
			switch (name) {
				case "write": {
					const target = path(record.file_path);
					if (target === null || typeof record.content !== "string") return null;
					return {
						path: target,
						diffs: [{
							path: target,
							oldText: null,
							newText: record.content
						}]
					};
				}
				case "edit": {
					const target = path(record.file_path);
					if (target === null) return null;
					if (typeof record.old_string !== "string" || record.old_string.length === 0 || typeof record.new_string !== "string" || record.old_string === record.new_string) return null;
					return {
						path: target,
						diffs: [{
							path: target,
							oldText: record.old_string,
							newText: record.new_string
						}]
					};
				}
				case "str_replace_editor": {
					const target = path(record.path);
					if (target === null) return null;
					switch (record.command) {
						case "create": return typeof record.file_text === "string" ? {
							path: target,
							diffs: [{
								path: target,
								oldText: null,
								newText: record.file_text
							}]
						} : null;
						case "str_replace": return typeof record.old_str === "string" && record.old_str.length > 0 && (record.new_str === void 0 || typeof record.new_str === "string") ? {
							path: target,
							diffs: [{
								path: target,
								oldText: record.old_str,
								newText: typeof record.new_str === "string" ? record.new_str : ""
							}]
						} : null;
						default: return {
							path: target,
							diffs: []
						};
					}
				}
				default: return null;
			}
		}
		/**
		* Terminal deletion records from one call's raw arguments. Deletions happen
		* in the terminals (`bash` / `pwsh`, whose `command` argument carries the
		* literal line); they surface as hunk-less, non-undoable entries.
		*/
		function terminalDeletions(name, argsRaw) {
			if (name !== "bash" && name !== "pwsh") return [];
			let args;
			try {
				args = JSON.parse(argsRaw);
			} catch {
				return [];
			}
			if (typeof args !== "object" || args === null || Array.isArray(args)) return [];
			const command = args.command;
			return typeof command === "string" ? deletedPathsFromCommand(command) : [];
		}
		/**
		* Attribute an event seq to its owning turn. Completed turns own the seq
		* range up to their `turn/end` seq; anything past the last completed end
		* belongs to the live turn (the in-flight `partial` / running call's turn,
		* or the next turn number when nothing live is observable).
		*/
		function turnAttribution(snapshot) {
			const ends = [...snapshot.turnEnds.entries()].sort((a, b) => a[1] - b[1]);
			const liveTurn = snapshot.partial?.turn ?? snapshot.runningCalls[0]?.turn ?? (ends.at(-1)?.[0] ?? 0) + 1;
			return (seq) => {
				for (const [turn, endSeq] of ends) if (endSeq >= seq) return {
					turn,
					live: false
				};
				return {
					turn: liveTurn,
					live: true
				};
			};
		}
		/**
		* Session-wide turns from the timeline Location index: every LOADED turn's
		* Definition-owned change set, in turn order — the windowed snapshot derive
		* only ever sees the assembled window, so a session whose editing happened
		* outside the current window derived zero changes (issue #8). The plugin's
		* own `fileReviewChanges` turn data carries complete hunks; the built-in
		* `deliverables` data (paths only) covers turns this plugin's Definition
		* has not seen; and the windowed legacy derive is the last fallback for
		* carriers without a timeline at all. Memoized per published snapshot
		* reference (the badge re-derives on every tab-bar render).
		*/
		const timelineCache = /* @__PURE__ */ new WeakMap();
		function deriveTimelineChanges(face) {
			if (face === null) return [];
			const timeline = face.timeline;
			if (timeline === void 0) return deriveSessionChanges(face.legacy);
			const hit = timelineCache.get(timeline);
			if (hit !== void 0) return hit;
			const derived = [];
			for (const turn of timeline.turnOrder) {
				const location = timeline.turns.get(turn);
				if (location === void 0) continue;
				const own = location.data.get("fileReviewChanges");
				let files;
				if (own?.files !== void 0 && own.files.length > 0) files = own.files.map((file) => ({
					path: file.path,
					diffs: file.diffs,
					...file.deleted === true ? { deleted: true } : {}
				}));
				else {
					const builtIn = location.data.get("deliverables");
					if (builtIn?.produced === void 0) continue;
					const seen = /* @__PURE__ */ new Set();
					const paths = [];
					for (const produced of builtIn.produced) {
						if (seen.has(produced.path)) continue;
						seen.add(produced.path);
						paths.push(produced.path);
					}
					if (paths.length === 0) continue;
					files = paths.map((path) => ({
						path,
						diffs: []
					}));
				}
				derived.push({
					turn,
					live: location.status === "open",
					files
				});
			}
			timelineCache.set(timeline, derived);
			return derived;
		}
		/** Derive one session's per-turn produced-file changes (uncached core). */
		function derive(snapshot) {
			const attribute = turnAttribution(snapshot);
			const byTurn = /* @__PURE__ */ new Map();
			for (const node of snapshot.nodes) {
				if (node.kind !== "tool-result" || node.isError) continue;
				const call = node.call;
				if (call === null) continue;
				const detail = mutationDetail(call.name, call.argsRaw);
				const deletions = detail === null ? terminalDeletions(call.name, call.argsRaw) : [];
				const artifacts = detail === null && deletions.length === 0 ? captureArtifacts(call.name, call.argsRaw) : [];
				if (detail === null && deletions.length === 0 && artifacts.length === 0) continue;
				const diffs = detail?.diffs ?? [];
				const paths = detail !== null ? [detail.path] : [];
				const { turn, live } = attribute(node.seq);
				let group = byTurn.get(turn);
				if (group === void 0) {
					group = {
						live,
						files: /* @__PURE__ */ new Map()
					};
					byTurn.set(turn, group);
				}
				for (const path of paths) {
					const own = diffs.filter((diff) => diff.path === path);
					const existing = group.files.get(path);
					if (existing === void 0) group.files.set(path, { diffs: [...own] });
					else {
						existing.diffs.push(...own);
						delete existing.deleted;
					}
				}
				for (const captured of artifacts) {
					const existing = group.files.get(captured.path);
					if (existing === void 0) group.files.set(captured.path, { diffs: [] });
					else delete existing.deleted;
				}
				for (const path of deletions) {
					const existing = group.files.get(path);
					if (existing === void 0) group.files.set(path, {
						diffs: [],
						deleted: true
					});
					else existing.deleted = true;
				}
			}
			return [...byTurn.entries()].sort((a, b) => a[0] - b[0]).map(([turn, group]) => ({
				turn,
				live: group.live,
				files: [...group.files.entries()].map(([path, own]) => ({
					path,
					diffs: own.diffs,
					...own.deleted === true ? { deleted: true } : {}
				}))
			}));
		}
		/**
		* Snapshot-identity cache: the sidebar badge runs this derivation on every
		* tab-bar render, so the result is memoized per immutable snapshot reference
		* (the session publishes a fresh reference only when content changes).
		*/
		const cache = /* @__PURE__ */ new WeakMap();
		/** Derive per-turn produced-file changes for one session snapshot. */
		function deriveSessionChanges(snapshot) {
			if (snapshot === null) return [];
			const hit = cache.get(snapshot);
			if (hit !== void 0) return hit;
			const derived = derive(snapshot);
			cache.set(snapshot, derived);
			return derived;
		}
		/** Every `run_code` tool-result node in the window, in node order. */
		function deriveSessionRoots(snapshot) {
			const attribute = turnAttribution(snapshot);
			const roots = [];
			for (const node of snapshot.nodes) {
				if (node.kind !== "tool-result" || node.isError) continue;
				if (node.subCalls.length === 0) continue;
				const { turn, live } = attribute(node.seq);
				roots.push({
					turn,
					live,
					rootCallId: node.callId
				});
			}
			return roots;
		}
		/**
		* Merge Host-recorded Code Mode mutations into the snapshot-derived turns:
		* hunks rebuilt from the full before/after are appended to the owning turn's
		* file groups (same-path entries stay one row, hunks appended in dispatch
		* order), so the tab's diff rendering, status inspection and undo all work on
		* programmatic edits exactly like model-direct ones. All inputs are immutable;
		* the result is a fresh array only when a recorded mutation matched a visible
		* root.
		*/
		function mergeRecordedTurns(turns, roots, recorded) {
			if (recorded.length === 0 || roots.length === 0) return turns;
			const rootTurns = /* @__PURE__ */ new Map();
			for (const root of roots) rootTurns.set(root.rootCallId, {
				turn: root.turn,
				live: root.live
			});
			const byRoot = /* @__PURE__ */ new Map();
			for (const mutation of recorded) {
				const list = byRoot.get(mutation.rootCallId);
				if (list === void 0) byRoot.set(mutation.rootCallId, [mutation]);
				else list.push(mutation);
			}
			let matched = false;
			for (const root of roots) if (byRoot.has(root.rootCallId)) {
				matched = true;
				break;
			}
			if (!matched) return turns;
			const groups = /* @__PURE__ */ new Map();
			for (const turn of turns) {
				const files = /* @__PURE__ */ new Map();
				for (const file of turn.files) files.set(file.path, {
					diffs: [...file.diffs],
					...file.deleted === true ? { deleted: true } : {}
				});
				groups.set(turn.turn, {
					live: turn.live,
					files
				});
			}
			for (const [rootCallId, mutations] of byRoot) {
				const owner = rootTurns.get(rootCallId);
				if (owner === void 0) continue;
				let group = groups.get(owner.turn);
				if (group === void 0) {
					group = {
						live: owner.live,
						files: /* @__PURE__ */ new Map()
					};
					groups.set(owner.turn, group);
				}
				for (const mutation of mutations) {
					const diffs = diffsFromBeforeAfter(mutation.path, mutation.before, mutation.after);
					if (diffs.length === 0) continue;
					const existing = group.files.get(mutation.path);
					if (existing === void 0) group.files.set(mutation.path, { diffs: [...diffs] });
					else existing.diffs.push(...diffs);
				}
			}
			return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([turn, group]) => ({
				turn,
				live: group.live,
				files: [...group.files.entries()].map(([path, own]) => ({
					path,
					diffs: own.diffs,
					...own.deleted === true ? { deleted: true } : {}
				}))
			}));
		}
		/** Count distinct changed paths across every turn (the sidebar badge count). */
		function countChangedFiles(turns) {
			const paths = /* @__PURE__ */ new Set();
			for (const turn of turns) for (const file of turn.files) paths.add(file.path);
			return paths.size;
		}
		/**
		* Debug/demo override for the keep threshold: `?frtArchiveKeep=N` in the app
		* URL forces N (0 archives every completed turn) so the archive UI can be
		* exercised on sessions with few change-bearing turns. Null when absent.
		*/
		function archiveKeepOverride() {
			try {
				const param = new URLSearchParams(window.location.search).get("frtArchiveKeep");
				if (param === null) return null;
				const value = Number(param);
				if (Number.isInteger(value) && value >= 0) return value;
			} catch {}
			return null;
		}
		/** Split turns into the main list and the auto-archived tail (both newest-first). */
		function splitArchivedTurns(turns, keep = 5) {
			const effective = archiveKeepOverride() ?? keep;
			const descending = [...turns].sort((left, right) => right.turn - left.turn);
			const kept = new Set(descending.slice(0, effective).map((turn) => turn.turn));
			const main = [];
			const archived = [];
			for (const turn of descending) if (turn.live || kept.has(turn.turn)) main.push(turn);
			else archived.push(turn);
			return {
				main,
				archived
			};
		}
		/** Trailing path segment, the part that identifies the file at a glance. */
		function basename$1(path) {
			const at = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
			return at === -1 ? path : path.slice(at + 1);
		}
		/** POSIX root, drive-letter, or UNC absolute-path test (separator-agnostic). */
		function isAbsolutePath(path) {
			return path.startsWith("/") || path.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(path);
		}
		/** Resolve a (possibly relative) tool path against the session cwd. */
		function resolveSessionPath(cwd, path) {
			if (isAbsolutePath(path)) return path;
			const base = cwd ?? "";
			if (base === "") return path;
			const separator = base.includes("\\") ? "\\" : "/";
			return `${base.replace(/[\\/]+$/, "")}${separator}${path}`;
		}
		//#endregion
		//#region \0dsh-file-review-kcoder-css:/Users/libing/kk_Projects/dsh-file-review-kcoder/src/client/UnifiedDiff.module.css.mjs
		const css$3 = ".fUbE1W_unifiedBlock{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-markdown-code-block);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;margin:16px 0;position:relative;overflow:hidden}.fUbE1W_unifiedEmbedded{border:0;border-radius:0;margin:0}.fUbE1W_unifiedCopyButton{z-index:2;color:var(--dsw-alias-label-secondary);cursor:pointer;font:var(--dsw-font-xs-13);background:0 0;border:0;padding:0;position:absolute;top:10px;right:12px}.fUbE1W_unifiedFile+.fUbE1W_unifiedFile{border-top:1px solid var(--dsw-alias-border-l2)}.fUbE1W_unifiedHeader{border-bottom:1px solid var(--dsw-alias-border-l2);min-height:38px;font:var(--dsw-font-markdown-code-block);align-items:center;gap:8px;padding:0 72px 0 12px;display:flex}.fUbE1W_unifiedStatus{color:var(--dsw-alias-state-success-primary);font-weight:700}.fUbE1W_unifiedPath{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}.fUbE1W_unifiedAdded{color:var(--dsw-alias-state-success-primary);margin-left:auto}.fUbE1W_unifiedRemoved{color:var(--dsw-alias-state-error-primary)}.fUbE1W_unifiedHunkHeader{border-bottom:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-markdown-code-block);padding:6px 12px}.fUbE1W_unifiedBody{font:var(--dsw-font-markdown-code-block);overflow:auto hidden}.fUbE1W_unifiedLine{white-space:pre;grid-template-columns:48px 24px minmax(max-content,1fr);min-width:max-content;min-height:23px;line-height:23px;display:grid}.fUbE1W_unifiedLineNumber{border-right:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);text-align:right;user-select:none;padding:0 8px}.fUbE1W_unifiedSign{text-align:center;user-select:none}.fUbE1W_unifiedText{padding-right:14px}.fUbE1W_unified_del{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 11%, transparent)}.fUbE1W_unified_add{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 11%, transparent)}.fUbE1W_unified_context{color:var(--dsw-alias-label-primary)}.fUbE1W_unifiedGap{border:0;border-top:1px solid var(--dsw-alias-border-l1);border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-border-l1);width:100%;min-height:32px;color:var(--dsw-alias-label-secondary);cursor:pointer;font:var(--dsw-font-xs-13);text-align:left;padding:0 12px 0 72px;display:block}.fUbE1W_unifiedGap:hover{color:var(--dsw-alias-label-primary)}.fUbE1W_unifiedOmitted{border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-border-l1);min-height:32px;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xs-13);align-items:center;gap:12px;padding:0 12px;display:flex}";
		const styleId$3 = "dsh-file-review-kcoder/UnifiedDiff.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(styleId$3) + "]") === null) {
			const style = document.createElement("style");
			style.dataset.plugin = "dsh-file-review-kcoder";
			style.dataset.pluginCss = styleId$3;
			style.textContent = css$3;
			document.head.appendChild(style);
		}
		var UnifiedDiff_module_css_default = {
			"unifiedOmitted": "fUbE1W_unifiedOmitted",
			"unifiedText": "fUbE1W_unifiedText",
			"unifiedBlock": "fUbE1W_unifiedBlock",
			"unifiedAdded": "fUbE1W_unifiedAdded",
			"unifiedBody": "fUbE1W_unifiedBody",
			"unifiedEmbedded": "fUbE1W_unifiedEmbedded",
			"unified_add": "fUbE1W_unified_add",
			"unified_context": "fUbE1W_unified_context",
			"unifiedStatus": "fUbE1W_unifiedStatus",
			"unifiedHeader": "fUbE1W_unifiedHeader",
			"unifiedSign": "fUbE1W_unifiedSign",
			"unifiedCopyButton": "fUbE1W_unifiedCopyButton",
			"unifiedFile": "fUbE1W_unifiedFile",
			"unifiedPath": "fUbE1W_unifiedPath",
			"unifiedLine": "fUbE1W_unifiedLine",
			"unifiedGap": "fUbE1W_unifiedGap",
			"unifiedHunkHeader": "fUbE1W_unifiedHunkHeader",
			"unifiedRemoved": "fUbE1W_unifiedRemoved",
			"unifiedLineNumber": "fUbE1W_unifiedLineNumber",
			"unified_del": "fUbE1W_unified_del"
		};
		//#endregion
		//#region src/client/UnifiedDiff.tsx
		function hunkLines(diff) {
			const changes = diffArrays(diff.oldText === null ? [] : diffContentLines(diff.oldText), diffContentLines(diff.newText));
			const lines = [];
			let oldNumber = diff.oldStart ?? 1;
			let newNumber = diff.newStart ?? 1;
			for (const change of changes) if (change.removed) for (const text of change.value) {
				lines.push({
					kind: "del",
					oldNumber,
					newNumber: null,
					text
				});
				oldNumber++;
			}
			else if (change.added) for (const text of change.value) {
				lines.push({
					kind: "add",
					oldNumber: null,
					newNumber,
					text
				});
				newNumber++;
			}
			else for (const text of change.value) {
				lines.push({
					kind: "context",
					oldNumber,
					newNumber,
					text
				});
				oldNumber++;
				newNumber++;
			}
			return lines;
		}
		function collapsedRows(lines, contextLines, hunkIndex) {
			const rows = [];
			let cursor = 0;
			let gapIndex = 0;
			while (cursor < lines.length) {
				const current = lines[cursor];
				if (current?.kind !== "context") {
					if (current !== void 0) rows.push(current);
					cursor++;
					continue;
				}
				const start = cursor;
				while (cursor < lines.length && lines[cursor]?.kind === "context") cursor++;
				const run = lines.slice(start, cursor);
				const leading = start === 0;
				const trailing = cursor === lines.length;
				const hiddenStart = leading ? 0 : Math.min(contextLines, run.length);
				const hiddenEnd = trailing ? run.length : Math.max(hiddenStart, run.length - contextLines);
				rows.push(...run.slice(0, hiddenStart));
				const hidden = run.slice(hiddenStart, hiddenEnd);
				if (hidden.length > 0) {
					rows.push({
						kind: "gap",
						id: `${hunkIndex}:${gapIndex}`,
						lines: hidden
					});
					gapIndex++;
				}
				rows.push(...run.slice(hiddenEnd));
			}
			return rows;
		}
		function buildHunks(diffs, contextLines) {
			let previousPath;
			let previousOldEnd = 1;
			let previousNewEnd = 1;
			return diffs.map((diff, index) => {
				const lines = hunkLines(diff);
				const oldCount = lines.filter((line) => line.oldNumber !== null).length;
				const newCount = lines.filter((line) => line.newNumber !== null).length;
				const oldStart = diff.oldStart ?? 1;
				const newStart = diff.newStart ?? 1;
				const unchangedBefore = diff.oldStart !== void 0 && diff.newStart !== void 0 ? Math.max(0, Math.min(oldStart - (diff.path === previousPath ? previousOldEnd : 1), newStart - (diff.path === previousPath ? previousNewEnd : 1))) : 0;
				previousPath = diff.path;
				previousOldEnd = oldStart + oldCount;
				previousNewEnd = newStart + newCount;
				return {
					rows: collapsedRows(lines, contextLines, index),
					added: lines.filter((line) => line.kind === "add").length,
					removed: lines.filter((line) => line.kind === "del").length,
					unchangedBefore
				};
			});
		}
		/** Serialize recorded hunks as one plain-text unified diff. */
		function unifiedDiffText(diffs) {
			let previousPath;
			const output = [];
			for (const diff of diffs) {
				if (diff.path !== previousPath) output.push(diff.path);
				else output.push(`@@ -${diff.oldStart ?? 1} +${diff.newStart ?? 1} @@`);
				previousPath = diff.path;
				for (const line of hunkLines(diff)) {
					const prefix = line.kind === "del" ? "-" : line.kind === "add" ? "+" : " ";
					output.push(`${prefix} ${line.text}`);
				}
			}
			return output.join("\n");
		}
		/** Count added and removed lines using the viewer's exact line-diff algorithm. */
		function summarizeDiffs(diffs) {
			let added = 0;
			let removed = 0;
			for (const diff of diffs) for (const line of hunkLines(diff)) {
				if (line.kind === "add") added++;
				if (line.kind === "del") removed++;
			}
			return {
				added,
				removed
			};
		}
		function lineNumbers(line) {
			return `${line.oldNumber === null ? "" : String(line.oldNumber)}, ${line.newNumber === null ? "" : String(line.newNumber)}`;
		}
		function lineNumber(line) {
			return line.kind === "del" ? line.oldNumber : line.newNumber;
		}
		/**
		* Render line-aligned hunks with a single gutter and expandable context gaps.
		* @param props - Unified diff data, locale labels, and presentation options.
		* @returns The line-numbered unified diff surface.
		*/
		function UnifiedDiff({ diffs, contextLines, labels, className, showCopyButton = true, showFileHeaders = true }) {
			const hunks = (0, react.useMemo)(() => buildHunks(diffs, contextLines), [contextLines, diffs]);
			const [expandedGaps, setExpandedGaps] = (0, react.useState)(() => /* @__PURE__ */ new Set());
			const [copied, setCopied] = (0, react.useState)(false);
			const onCopy = (0, react.useCallback)(() => {
				if (copied) return;
				navigator.clipboard?.writeText(unifiedDiffText(diffs)).then(() => {
					setCopied(true);
					window.setTimeout(() => {
						setCopied(false);
					}, 1e3);
				}).catch(() => {});
			}, [copied, diffs]);
			if (diffs.length === 0) return null;
			const totals = /* @__PURE__ */ new Map();
			for (const [index, diff] of diffs.entries()) {
				const hunk = hunks[index];
				const previous = totals.get(diff.path) ?? {
					added: 0,
					removed: 0
				};
				totals.set(diff.path, {
					added: previous.added + (hunk?.added ?? 0),
					removed: previous.removed + (hunk?.removed ?? 0)
				});
			}
			let previousPath;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: `${UnifiedDiff_module_css_default.unifiedBlock} ${showFileHeaders ? "" : UnifiedDiff_module_css_default.unifiedEmbedded} ${className ?? ""}`,
				"data-diff": "",
				"data-diff-layout": "unified",
				children: [showCopyButton && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: UnifiedDiff_module_css_default.unifiedCopyButton,
					onClick: onCopy,
					children: copied ? labels.copied : labels.copy
				}), diffs.map((diff, hunkIndex) => {
					const firstForPath = diff.path !== previousPath;
					previousPath = diff.path;
					const total = totals.get(diff.path) ?? {
						added: 0,
						removed: 0
					};
					const hunk = hunks[hunkIndex];
					return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: UnifiedDiff_module_css_default.unifiedFile,
						children: [showFileHeaders && firstForPath ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
							className: UnifiedDiff_module_css_default.unifiedHeader,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: UnifiedDiff_module_css_default.unifiedStatus,
									children: "M"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: UnifiedDiff_module_css_default.unifiedPath,
									children: diff.path
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: UnifiedDiff_module_css_default.unifiedAdded,
									children: ["+", total.added]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: UnifiedDiff_module_css_default.unifiedRemoved,
									children: ["-", total.removed]
								})
							]
						}) : !firstForPath && (hunk?.unchangedBefore ?? 0) === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: UnifiedDiff_module_css_default.unifiedHunkHeader,
							children: [
								"@@ -",
								diff.oldStart ?? 1,
								" +",
								diff.newStart ?? 1,
								" @@"
							]
						}) : null, /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: UnifiedDiff_module_css_default.unifiedBody,
							children: [(hunk?.unchangedBefore ?? 0) > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: UnifiedDiff_module_css_default.unifiedOmitted,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									"aria-hidden": "true",
									children: "↕"
								}), labels.showUnchanged(hunk?.unchangedBefore ?? 0)]
							}), (hunk?.rows ?? []).flatMap((row) => {
								if (row.kind !== "gap") {
									const sign = row.kind === "del" ? "-" : row.kind === "add" ? "+" : " ";
									return [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: `${UnifiedDiff_module_css_default.unifiedLine} ${UnifiedDiff_module_css_default[`unified_${row.kind}`] ?? ""}`,
										"data-line-kind": row.kind,
										"data-old-line": row.oldNumber ?? void 0,
										"data-new-line": row.newNumber ?? void 0,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: UnifiedDiff_module_css_default.unifiedLineNumber,
												children: lineNumber(row)
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: UnifiedDiff_module_css_default.unifiedSign,
												children: sign
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: UnifiedDiff_module_css_default.unifiedText,
												children: row.text
											})
										]
									}, `${row.kind}:${row.oldNumber ?? ""}:${row.newNumber ?? ""}`)];
								}
								if (expandedGaps.has(row.id)) return [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: UnifiedDiff_module_css_default.unifiedGap,
									"aria-expanded": "true",
									onClick: () => {
										setExpandedGaps((current) => {
											const next = new Set(current);
											next.delete(row.id);
											return next;
										});
									},
									children: labels.hideUnchanged(row.lines.length)
								}, `${row.id}:control`), ...row.lines.map((line) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: `${UnifiedDiff_module_css_default.unifiedLine} ${UnifiedDiff_module_css_default.unified_context}`,
									"data-line-kind": "context",
									"data-old-line": line.oldNumber ?? void 0,
									"data-new-line": line.newNumber ?? void 0,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: UnifiedDiff_module_css_default.unifiedLineNumber,
											children: lineNumber(line)
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: UnifiedDiff_module_css_default.unifiedSign,
											children: " "
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: UnifiedDiff_module_css_default.unifiedText,
											children: line.text
										})
									]
								}, `${row.id}:${lineNumbers(line)}`))];
								return [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: UnifiedDiff_module_css_default.unifiedGap,
									"aria-expanded": "false",
									onClick: () => {
										setExpandedGaps((current) => /* @__PURE__ */ new Set([...current, row.id]));
									},
									children: labels.showUnchanged(row.lines.length)
								}, row.id)];
							})]
						})]
					}, `${diff.path}:${hunkIndex}`);
				})]
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/**
		* Minimal zh/en copy for the file-review sidebar tab. Follows the DSH i18n
		* system: the client apply attaches the locale service (`ctx.locale`,
		* provided by `@deepseek-ai/dsh-client-locale`) through {@link attachLocale},
		* and `t()` resolves the active locale from it. Without an attached service
		* (standalone/test compositions) the browser language is used. Mirrors the
		* dsh-coding-sidebar locales pattern.
		*/
		/** The dictionary namespace this plugin owns in the DSH locale registry. */
		const LOCALE_NS = "fileReviewTab";
		/** The zh dictionary (the key-set source of truth). */
		const zh$1 = {
			tabTitle: "文件审查",
			empty: "本会话暂无文件改动",
			sessionUnavailable: "会话不可用",
			remoteUnavailable: "文件审查服务不可用",
			turn: "第 {n} 轮",
			turnLive: "进行中",
			files: "{count} 个文件",
			filesOne: "1 个文件",
			undo: "撤销",
			redo: "重新应用",
			undoing: "正在撤销…",
			redoing: "正在重新应用…",
			undoTurn: "撤销本轮",
			redoTurn: "重新应用本轮",
			toggleUnavailable: "没有可安全还原的文件",
			stateUndone: "已撤销",
			stateConflict: "内容冲突",
			stateUnsupported: "不可还原",
			stateError: "错误",
			deleted: "已删除",
			deletedHint: "该文件在本轮中被终端命令删除，内容已不存在，无法查看差异或撤销。",
			kindImage: "图片",
			kindVideo: "视频",
			kindAudio: "音频",
			kindOffice: "Office",
			kindPdf: "PDF",
			kindDoc: "文档",
			archived: "已归档 {n} 轮",
			archivedExpand: "展开已归档轮次",
			archivedCollapse: "收起已归档轮次",
			loadMore: "加载更多（还有 {n} 轮）",
			undoSuccess: "已成功撤销更改",
			redoSuccess: "已成功重新应用更改",
			undoPartial: "部分文件未能撤销",
			redoPartial: "部分文件未能重新应用",
			toggleError: "操作失败",
			openInEditor: "在编辑器中打开",
			open: "打开 {name}",
			copy: "复制差异",
			copied: "已复制",
			showUnchanged: "显示 {count} 行未更改内容",
			hideUnchanged: "隐藏 {count} 行未更改内容",
			stats: "新增 {added} 行，删除 {removed} 行",
			unavailable: "无法为此更改还原可审查的差异。",
			refresh: "刷新状态"
		};
		/** The en dictionary. */
		const en$1 = {
			tabTitle: "File Review",
			empty: "No file changes in this session yet",
			sessionUnavailable: "Session is unavailable",
			remoteUnavailable: "File review service is unavailable",
			turn: "Turn {n}",
			turnLive: "in progress",
			files: "{count} files",
			filesOne: "1 file",
			undo: "Undo",
			redo: "Reapply",
			undoing: "Undoing…",
			redoing: "Reapplying…",
			undoTurn: "Undo turn",
			redoTurn: "Reapply turn",
			toggleUnavailable: "No safely reversible files are available",
			stateUndone: "undone",
			stateConflict: "conflict",
			stateUnsupported: "not reversible",
			stateError: "error",
			deleted: "deleted",
			deletedHint: "This file was deleted by a terminal command in this turn; its content is gone, so no diff or undo is available.",
			kindImage: "Image",
			kindVideo: "Video",
			kindAudio: "Audio",
			kindOffice: "Office",
			kindPdf: "PDF",
			kindDoc: "Doc",
			archived: "Archived turns ({n})",
			archivedExpand: "Expand archived turns",
			archivedCollapse: "Collapse archived turns",
			loadMore: "Load more ({n} more turns)",
			undoSuccess: "Changes undone",
			redoSuccess: "Changes reapplied",
			undoPartial: "Some files could not be undone",
			redoPartial: "Some files could not be reapplied",
			toggleError: "Operation failed",
			openInEditor: "Open in editor",
			open: "Open {name}",
			copy: "Copy diff",
			copied: "Copied",
			showUnchanged: "{count} unchanged lines",
			hideUnchanged: "Hide {count} unchanged lines",
			stats: "{added} lines added, {removed} lines removed",
			unavailable: "No reconstructable diff is available for this change.",
			refresh: "Refresh status"
		};
		/** The DSH locale service attached by the client apply (absent → browser detection). */
		let localeService;
		/** Attach (or detach, with undefined) the DSH locale service. */
		function attachLocale(service) {
			localeService = service;
		}
		/** The active locale id ('zh' | 'en'): the DSH locale service's snapshot when attached. */
		function activeLocale() {
			return localeService?.getSnapshot().active ?? (typeof navigator !== "undefined" ? navigator.language : "") ?? "en";
		}
		/** Translate a copy key; `{name}` placeholders interpolate from `params`. */
		function t(key, params) {
			let text = (activeLocale().toLowerCase().startsWith("zh") ? zh$1 : en$1)[key];
			if (params !== void 0) for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{${name}}`, String(value));
			return text;
		}
		//#endregion
		//#region \0dsh-file-review-kcoder-css:/Users/libing/kk_Projects/dsh-file-review-kcoder/src/client/FileReviewTab.module.css.mjs
		const css$2 = ".ePxjfa_root{height:100%;min-height:0;color:var(--dsw-alias-label-primary);font:var(--dsw-font-xs-13);flex-direction:column;display:flex;container-type:inline-size}.ePxjfa_header{border-bottom:1px solid var(--dsw-alias-border-l2);flex:none;align-items:center;gap:8px;min-height:36px;padding:0 10px;display:flex}.ePxjfa_headerTitle{font-weight:600}.ePxjfa_refreshButton{color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:0;border-radius:6px;margin-left:auto;padding:2px 6px;font-size:13px;line-height:1}.ePxjfa_refreshButton:hover:not(:disabled){background:var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary)}.ePxjfa_refreshButton:disabled{opacity:.5;cursor:default}.ePxjfa_notice{border-radius:8px;flex:none;margin:8px 10px 0;padding:6px 10px;font-size:12px}.ePxjfa_noticeSuccess{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent);border:1px solid color-mix(in srgb, var(--dsw-alias-state-success-primary) 35%, transparent)}.ePxjfa_noticeError{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent);border:1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 35%, transparent)}.ePxjfa_body{flex:1;min-height:0;padding:8px 0 16px;overflow-y:auto}.ePxjfa_empty{color:var(--dsw-alias-label-tertiary);text-align:center;padding:24px 12px}.ePxjfa_turnGroup{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-markdown-code-block);border-radius:10px;margin:0 8px 10px;overflow:hidden}.ePxjfa_turnHeader{border-bottom:1px solid var(--dsw-alias-border-l2);flex-wrap:wrap;align-items:center;gap:4px 8px;min-height:34px;padding:0 8px 0 10px;display:flex}.ePxjfa_turnTitle{white-space:nowrap;font-weight:600}.ePxjfa_liveBadge{color:var(--dsw-alias-state-warning-primary,#d9a13b);background:color-mix(in srgb, var(--dsw-alias-state-warning-primary,#d9a13b) 14%, transparent);white-space:nowrap;border-radius:999px;padding:1px 6px;font-size:11px}.ePxjfa_turnCount{color:var(--dsw-alias-label-tertiary);white-space:nowrap}.ePxjfa_stats{white-space:nowrap;gap:6px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;display:inline-flex}.ePxjfa_added{color:var(--dsw-alias-state-success-primary)}.ePxjfa_removed{color:var(--dsw-alias-state-error-primary)}.ePxjfa_actionButton{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;background:0 0;border-radius:6px;align-items:center;gap:4px;margin-left:auto;padding:3px 8px;font-size:12px;display:inline-flex}.ePxjfa_actionButton:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-border-l1)}.ePxjfa_actionButton:disabled{opacity:.5;cursor:default}.ePxjfa_buttonIcon{fill:none;stroke:currentColor;stroke-width:1.6px;stroke-linecap:round;stroke-linejoin:round;width:13px;height:13px}.ePxjfa_fileList{margin:0;padding:0;list-style:none}.ePxjfa_fileItem+.ePxjfa_fileItem{border-top:1px solid var(--dsw-alias-border-l2)}.ePxjfa_fileRow{cursor:pointer;user-select:none;align-items:center;gap:6px;min-height:32px;padding:0 8px 0 6px;display:flex}.ePxjfa_fileRow:hover{background:color-mix(in srgb, var(--dsw-alias-border-l1) 55%, transparent)}.ePxjfa_chevron{fill:none;width:12px;height:12px;stroke:var(--dsw-alias-label-tertiary);stroke-width:1.8px;stroke-linecap:round;stroke-linejoin:round;flex:none;transition:transform .12s}.ePxjfa_chevronOpen{transform:rotate(90deg)}.ePxjfa_fileName{text-overflow:ellipsis;white-space:nowrap;min-width:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;overflow:hidden}.ePxjfa_stateBadge{white-space:nowrap;border-radius:999px;padding:1px 6px;font-size:11px}.ePxjfa_badgeUndone{color:var(--dsw-alias-state-warning-primary,#d9a13b);background:color-mix(in srgb, var(--dsw-alias-state-warning-primary,#d9a13b) 14%, transparent)}.ePxjfa_badgeMuted{color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-border-l1)}.ePxjfa_badgeError{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent)}.ePxjfa_smallButton{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;background:0 0;border-radius:6px;flex:none;padding:2px 7px;font-size:11px}.ePxjfa_smallButton:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-border-l1)}.ePxjfa_smallButton:disabled{opacity:.5;cursor:default}.ePxjfa_fileRow .ePxjfa_smallButton:first-of-type{margin-left:auto}.ePxjfa_diffWrap{border-top:1px solid var(--dsw-alias-border-l2);overflow-x:auto}.ePxjfa_diffUnavailable{color:var(--dsw-alias-label-tertiary);margin:0;padding:10px 12px;font-size:12px}.ePxjfa_reviewDiff{border:0;border-radius:0;margin:0}.ePxjfa_deletedBadge{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent);white-space:nowrap;border-radius:999px;padding:1px 6px;font-size:11px}.ePxjfa_kindBadge{color:var(--dsw-alias-label-secondary);background:color-mix(in srgb, var(--dsw-alias-label-tertiary) 16%, transparent);white-space:nowrap;border-radius:999px;padding:1px 6px;font-size:11px}@container (width<=430px){.ePxjfa_turnHeader .ePxjfa_stats,.ePxjfa_editorButton{display:none}}.ePxjfa_archiveSection{border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;margin:4px 8px 6px}.ePxjfa_archiveHeader{cursor:pointer;width:100%;min-height:34px;color:var(--dsw-alias-label-secondary);background:0 0;border:0;align-items:center;gap:6px;padding:0 8px 0 10px;display:flex}.ePxjfa_archiveHeader:hover{color:var(--dsw-alias-label-primary)}.ePxjfa_archiveTitle{font-size:12px}.ePxjfa_archiveSection .ePxjfa_turnGroup{margin:0 8px 8px}";
		const styleId$2 = "dsh-file-review-kcoder/FileReviewTab.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(styleId$2) + "]") === null) {
			const style = document.createElement("style");
			style.dataset.plugin = "dsh-file-review-kcoder";
			style.dataset.pluginCss = styleId$2;
			style.textContent = css$2;
			document.head.appendChild(style);
		}
		var FileReviewTab_module_css_default = {
			"removed": "ePxjfa_removed",
			"archiveSection": "ePxjfa_archiveSection",
			"smallButton": "ePxjfa_smallButton",
			"liveBadge": "ePxjfa_liveBadge",
			"root": "ePxjfa_root",
			"noticeError": "ePxjfa_noticeError",
			"stats": "ePxjfa_stats",
			"turnTitle": "ePxjfa_turnTitle",
			"fileRow": "ePxjfa_fileRow",
			"badgeError": "ePxjfa_badgeError",
			"refreshButton": "ePxjfa_refreshButton",
			"archiveTitle": "ePxjfa_archiveTitle",
			"actionButton": "ePxjfa_actionButton",
			"noticeSuccess": "ePxjfa_noticeSuccess",
			"added": "ePxjfa_added",
			"chevronOpen": "ePxjfa_chevronOpen",
			"turnCount": "ePxjfa_turnCount",
			"badgeMuted": "ePxjfa_badgeMuted",
			"reviewDiff": "ePxjfa_reviewDiff",
			"buttonIcon": "ePxjfa_buttonIcon",
			"empty": "ePxjfa_empty",
			"fileList": "ePxjfa_fileList",
			"diffWrap": "ePxjfa_diffWrap",
			"editorButton": "ePxjfa_editorButton",
			"archiveHeader": "ePxjfa_archiveHeader",
			"turnGroup": "ePxjfa_turnGroup",
			"stateBadge": "ePxjfa_stateBadge",
			"notice": "ePxjfa_notice",
			"body": "ePxjfa_body",
			"deletedBadge": "ePxjfa_deletedBadge",
			"fileName": "ePxjfa_fileName",
			"fileItem": "ePxjfa_fileItem",
			"kindBadge": "ePxjfa_kindBadge",
			"headerTitle": "ePxjfa_headerTitle",
			"header": "ePxjfa_header",
			"turnHeader": "ePxjfa_turnHeader",
			"chevron": "ePxjfa_chevron",
			"badgeUndone": "ePxjfa_badgeUndone",
			"diffUnavailable": "ePxjfa_diffUnavailable"
		};
		//#endregion
		//#region src/client/FileReviewTab.tsx
		const SUCCESS_NOTICE_DURATION$1 = 3e3;
		const ERROR_NOTICE_DURATION$1 = 8e3;
		/** Localized badge copy per artifact class (tab namespace keys). */
		const KIND_LABEL$1 = {
			image: "kindImage",
			video: "kindVideo",
			audio: "kindAudio",
			office: "kindOffice",
			pdf: "kindPdf",
			doc: "kindDoc"
		};
		/** State map key for one (turn, file) change group. */
		function stateKey(turn, path) {
			return `${turn}|${path}`;
		}
		/** A change group is reversible only with complete contextual hunks. */
		function isReversible(file) {
			return file.diffs.length > 0 && file.diffs.every((diff) => diff.path === file.path && diff.oldText !== null && diff.oldText !== diff.newText && (diff.oldText !== "" || diff.oldStart !== void 0) && (diff.newText !== "" || diff.newStart !== void 0));
		}
		function addStats$1(left, right) {
			return {
				added: left.added + right.added,
				removed: left.removed + right.removed
			};
		}
		function Stats$1({ stats }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: FileReviewTab_module_css_default.stats,
				"aria-label": t("stats", {
					added: String(stats.added),
					removed: String(stats.removed)
				}),
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: FileReviewTab_module_css_default.added,
					children: ["+", stats.added]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: FileReviewTab_module_css_default.removed,
					children: ["-", stats.removed]
				})]
			});
		}
		function UndoIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				viewBox: "0 0 20 20",
				"aria-hidden": "true",
				className: FileReviewTab_module_css_default.buttonIcon,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M8 5 4 9l4 4M4 9h7a5 5 0 0 1 5 5v1" })
			});
		}
		function RedoIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				viewBox: "0 0 20 20",
				"aria-hidden": "true",
				className: FileReviewTab_module_css_default.buttonIcon,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "m12 5 4 4-4 4M16 9H9a5 5 0 0 0-5 5v1" })
			});
		}
		function Chevron({ open }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				viewBox: "0 0 20 20",
				"aria-hidden": "true",
				className: `${FileReviewTab_module_css_default.chevron} ${open ? FileReviewTab_module_css_default.chevronOpen : ""}`,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "m7 5 5 5-5 5" })
			});
		}
		/** Per-(turn,file) host-inspected state badge; nothing renders for 'applied'. */
		function StateBadge({ state }) {
			if (state === void 0 || state === "applied") return null;
			const label = state === "undone" ? t("stateUndone") : state === "conflict" ? t("stateConflict") : state === "unsupported" ? t("stateUnsupported") : t("stateError");
			const tone = state === "undone" ? FileReviewTab_module_css_default.badgeUndone : state === "unsupported" ? FileReviewTab_module_css_default.badgeMuted : FileReviewTab_module_css_default.badgeError;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: `${FileReviewTab_module_css_default.stateBadge} ${tone}`,
				children: label
			});
		}
		/** Mounts the heavy diff renderer only when the row nears the viewport. */
		function LazyDiff({ children }) {
			const holderRef = (0, react.useRef)(null);
			const [inView, setInView] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				if (inView) return;
				const element = holderRef.current;
				if (element === null) return;
				if (typeof IntersectionObserver === "undefined") {
					setInView(true);
					return;
				}
				const observer = new IntersectionObserver((entries) => {
					if (entries.some((entry) => entry.isIntersecting)) {
						setInView(true);
						observer.disconnect();
					}
				}, { rootMargin: "200px 0px" });
				observer.observe(element);
				return () => {
					observer.disconnect();
				};
			}, [inView]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				ref: holderRef,
				children: inView ? children : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { style: { minHeight: "96px" } })
			});
		}
		/** The sidebar tab body: per-turn change groups with inline diffs and undo. */
		function FileReviewTab({ ctx, sessionId, cwd, visible, tab }) {
			const sessions = ctx.sessions;
			const [states, setStates] = (0, react.useState)(() => /* @__PURE__ */ new Map());
			const [statusPending, setStatusPending] = (0, react.useState)(false);
			const [busyKey, setBusyKey] = (0, react.useState)(null);
			const [expanded, setExpanded] = (0, react.useState)(() => /* @__PURE__ */ new Set());
			const [notice, setNotice] = (0, react.useState)(null);
			const [tick, setTick] = (0, react.useState)(0);
			const noticeSeqRef = (0, react.useRef)(0);
			const noticeTimerRef = (0, react.useRef)(null);
			const store = resolveConversationStore(ctx, sessionId);
			const subscribe = (0, react.useCallback)((listener) => store?.subscribe(listener) ?? (() => {}), [store]);
			const face = (0, react.useSyncExternalStore)(subscribe, () => store?.getSnapshot() ?? null);
			const roots = (0, react.useMemo)(() => face === null ? [] : deriveSessionRoots(face.legacy), [face]);
			const rootsKey = (0, react.useMemo)(() => roots.map((root) => root.rootCallId).join("|"), [roots]);
			const [recorded, setRecorded] = (0, react.useState)(() => []);
			(0, react.useEffect)(() => {
				if (!visible || roots.length === 0) return;
				let active = true;
				const timer = window.setTimeout(() => {
					const scope = sessions.scope(sessionId);
					const remote = scope?.get("remote.fileReview");
					if (scope === void 0 || remote === void 0) {
						active = false;
						return;
					}
					remote.recorded({ rootCallIds: roots.map((root) => root.rootCallId) }).then((result) => {
						if (!result.ok || !active) return;
						setRecorded(result.value.mutations);
					}).catch(() => {});
				}, 200);
				return () => {
					active = false;
					window.clearTimeout(timer);
				};
			}, [
				visible,
				rootsKey,
				tick,
				sessions,
				sessionId
			]);
			const turns = (0, react.useMemo)(() => mergeRecordedTurns(deriveTimelineChanges(face), roots, recorded), [
				face,
				roots,
				recorded
			]);
			const { main: mainTurns, archived: archivedTurns } = (0, react.useMemo)(() => splitArchivedTurns(turns), [turns]);
			const [archiveOpen, setArchiveOpen] = (0, react.useState)(false);
			const [archivePages, setArchivePages] = (0, react.useState)(1);
			(0, react.useEffect)(() => {
				try {
					const raw = window.localStorage.getItem(`dsh-file-review-tab:archive:${sessionId}`);
					const parsed = raw === null ? void 0 : JSON.parse(raw);
					setArchiveOpen(parsed?.open === true);
					setArchivePages(typeof parsed?.pages === "number" && Number.isInteger(parsed.pages) && parsed.pages >= 1 ? parsed.pages : 1);
				} catch {
					setArchiveOpen(false);
					setArchivePages(1);
				}
			}, [sessionId]);
			(0, react.useEffect)(() => {
				try {
					window.localStorage.setItem(`dsh-file-review-tab:archive:${sessionId}`, JSON.stringify({
						open: archiveOpen,
						pages: archivePages
					}));
				} catch {}
			}, [
				sessionId,
				archiveOpen,
				archivePages
			]);
			const archivedVisible = (0, react.useMemo)(() => archiveOpen ? archivedTurns.slice(0, archivePages * 10) : [], [
				archiveOpen,
				archivePages,
				archivedTurns
			]);
			const archivedRemaining = archivedTurns.length - archivedVisible.length;
			const renderedTurns = (0, react.useMemo)(() => [...mainTurns, ...archivedVisible], [mainTurns, archivedVisible]);
			const flat = (0, react.useMemo)(() => renderedTurns.flatMap((turn) => turn.files.map((file) => ({
				turn: turn.turn,
				path: file.path,
				diffs: file.diffs,
				...file.deleted === true ? { deleted: true } : {}
			}))), [renderedTurns]);
			const inspectable = (0, react.useMemo)(() => flat.filter((item) => item.deleted !== true && !(item.diffs.length === 0 && classifyPath(item.path) !== "code")), [flat]);
			const flatKey = (0, react.useMemo)(() => flat.map((item) => `${item.turn}|${item.path}|${item.diffs.length}`).join(";"), [flat]);
			const flatRef = (0, react.useRef)(flat);
			flatRef.current = flat;
			const turnsRef = (0, react.useRef)(turns);
			turnsRef.current = turns;
			const archivedTurnsRef = (0, react.useRef)(archivedTurns);
			archivedTurnsRef.current = archivedTurns;
			const rowRefs = (0, react.useRef)(/* @__PURE__ */ new Map());
			const turnRefs = (0, react.useRef)(/* @__PURE__ */ new Map());
			const bodyRef = (0, react.useRef)(null);
			const lastMetaRef = (0, react.useRef)(void 0);
			const pendingScrollRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				const meta = tab.meta;
				if (meta === lastMetaRef.current) return;
				lastMetaRef.current = meta;
				if (typeof meta !== "object" || meta === null || Array.isArray(meta)) return;
				const raw = meta.expandPaths;
				if (!Array.isArray(raw)) return;
				const paths = raw.filter((value) => typeof value === "string");
				if (paths.length === 0) return;
				const turnNo = meta.turn;
				const targetTurn = typeof turnNo === "number" && Number.isInteger(turnNo) ? turnNo : void 0;
				const ownerTurn = targetTurn !== void 0 ? turnsRef.current.find((turn) => turn.turn === targetTurn) : turnsRef.current.find((turn) => turn.files.some((file) => paths.includes(file.path)));
				if (ownerTurn !== void 0 && ownerTurn.live !== true) {
					const archivedIndex = archivedTurnsRef.current.findIndex((turn) => turn.turn === ownerTurn.turn);
					if (archivedIndex !== -1) {
						setArchiveOpen(true);
						setArchivePages((current) => Math.max(current, Math.ceil((archivedIndex + 1) / 10)));
					}
				}
				const matches = (item) => paths.includes(item.path) && (targetTurn === void 0 || item.turn === targetTurn);
				setExpanded((current) => {
					const next = new Set(current);
					for (const item of flatRef.current) if (matches(item)) next.add(stateKey(item.turn, item.path));
					return next;
				});
				const first = flatRef.current.find((item) => matches(item));
				pendingScrollRef.current = first === void 0 ? null : {
					rowKey: stateKey(first.turn, first.path),
					turn: paths.length > 1 ? first.turn : null
				};
			}, [tab.meta]);
			(0, react.useEffect)(() => {
				if (!visible) return;
				const pending = pendingScrollRef.current;
				if (pending === null) return;
				const element = (pending.turn !== null ? turnRefs.current.get(pending.turn) : void 0) ?? rowRefs.current.get(pending.rowKey);
				if (element === void 0) return;
				pendingScrollRef.current = null;
				const scroll = () => {
					const container = bodyRef.current;
					if (container === null) return;
					const delta = element.getBoundingClientRect().top - container.getBoundingClientRect().top;
					container.scrollTo({
						top: container.scrollTop + delta - 8,
						behavior: "smooth"
					});
				};
				scroll();
				const timer = window.setTimeout(scroll, 150);
				return () => window.clearTimeout(timer);
			}, [
				visible,
				expanded,
				tab.meta,
				flatKey
			]);
			const showNotice = (0, react.useCallback)((tone, text) => {
				noticeSeqRef.current += 1;
				const seq = noticeSeqRef.current;
				if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
				noticeTimerRef.current = window.setTimeout(() => {
					setNotice((current) => current?.seq === seq ? null : current);
				}, tone === "success" ? SUCCESS_NOTICE_DURATION$1 : ERROR_NOTICE_DURATION$1);
				setNotice({
					seq,
					tone,
					text
				});
			}, []);
			(0, react.useEffect)(() => () => {
				if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
			}, []);
			const invoke = (0, react.useCallback)(async (method, request) => {
				const scope = sessions.scope(sessionId);
				if (scope === void 0) throw new Error(t("sessionUnavailable"));
				const remote = scope.get("remote.fileReview");
				if (remote === void 0) throw new Error(t("remoteUnavailable"));
				const result = await remote[method](request);
				if (!result.ok) throw new Error(result.error.message);
				return result.value;
			}, [sessions, sessionId]);
			(0, react.useEffect)(() => {
				if (!visible || flat.length === 0) return;
				let active = true;
				setStatusPending(true);
				const timer = window.setTimeout(() => {
					const request = {
						action: "undo",
						files: inspectable.map((item) => ({
							path: item.path,
							diffs: item.diffs
						}))
					};
					invoke("status", request).then((result) => {
						if (!active) return;
						setStates(() => {
							const next = /* @__PURE__ */ new Map();
							inspectable.forEach((item, index) => {
								const file = result.files[index];
								if (file !== void 0) next.set(stateKey(item.turn, item.path), file.state);
							});
							return next;
						});
					}).catch(() => {}).finally(() => {
						if (active) setStatusPending(false);
					});
				}, 300);
				return () => {
					active = false;
					window.clearTimeout(timer);
				};
			}, [
				visible,
				flatKey,
				tick,
				invoke
			]);
			const mergeResultStates = (0, react.useCallback)((items, result) => {
				setStates((current) => {
					const next = new Map(current);
					items.forEach((item, index) => {
						const file = result.files[index];
						if (file !== void 0) next.set(stateKey(item.turn, item.path), file.state);
					});
					return next;
				});
			}, []);
			/** Toggle one change set (a whole turn, or one file) undo ↔ redo. */
			const runToggle = (0, react.useCallback)((key, items, action) => {
				if (busyKey !== null || items.length === 0) return;
				setBusyKey(key);
				invoke("apply", {
					action,
					files: items.map((item) => ({
						path: item.path,
						diffs: item.diffs
					}))
				}).then((result) => {
					mergeResultStates(items, result);
					const target = action === "undo" ? "undone" : "applied";
					if (result.files.filter((file) => file.state !== target).length === 0) showNotice("success", t(action === "undo" ? "undoSuccess" : "redoSuccess"));
					else showNotice("error", t(action === "undo" ? "undoPartial" : "redoPartial"));
				}).catch((error) => {
					showNotice("error", `${t("toggleError")}: ${error instanceof Error ? error.message : String(error)}`);
				}).finally(() => {
					setBusyKey(null);
				});
			}, [
				busyKey,
				invoke,
				mergeResultStates,
				showNotice
			]);
			const toggleExpanded = (0, react.useCallback)((key) => {
				setExpanded((current) => {
					const next = new Set(current);
					if (next.has(key)) next.delete(key);
					else next.add(key);
					return next;
				});
			}, []);
			const openInEditor = (0, react.useCallback)((path) => {
				const absolute = resolveSessionPath(cwd, path);
				ctx.betterSidebar?.openFile({
					sessionId,
					...cwd !== void 0 ? { cwd } : {}
				}, absolute, basename$1(absolute));
			}, [
				ctx,
				cwd,
				sessionId
			]);
			const totalStats = (0, react.useMemo)(() => flat.reduce((total, item) => addStats$1(total, summarizeDiffs(item.diffs)), {
				added: 0,
				removed: 0
			}), [flat]);
			/** Render one turn group (latest turn first). */
			const renderTurn = (turn) => {
				const turnStats = turn.files.reduce((total, file) => addStats$1(total, summarizeDiffs(file.diffs)), {
					added: 0,
					removed: 0
				});
				const reversible = turn.files.filter(isReversible);
				const turnAction = reversible.length > 0 && reversible.every((file) => states.get(stateKey(turn.turn, file.path)) === "undone") ? "redo" : "undo";
				const turnKey = `turn:${turn.turn}`;
				const turnBusy = busyKey === turnKey;
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
					ref: (element) => {
						if (element === null) turnRefs.current.delete(turn.turn);
						else turnRefs.current.set(turn.turn, element);
					},
					className: FileReviewTab_module_css_default.turnGroup,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: FileReviewTab_module_css_default.turnHeader,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: FileReviewTab_module_css_default.turnTitle,
								children: t("turn", { n: turn.turn })
							}),
							turn.live && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: FileReviewTab_module_css_default.liveBadge,
								children: t("turnLive")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: FileReviewTab_module_css_default.turnCount,
								children: turn.files.length === 1 ? t("filesOne") : t("files", { count: turn.files.length })
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Stats$1, { stats: turnStats }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: FileReviewTab_module_css_default.actionButton,
								disabled: statusPending || busyKey !== null || reversible.length === 0,
								title: reversible.length === 0 ? t("toggleUnavailable") : void 0,
								onClick: () => {
									runToggle(turnKey, turn.files.filter((file) => file.deleted !== true && !(file.diffs.length === 0 && classifyPath(file.path) !== "code")).map((file) => ({
										turn: turn.turn,
										path: file.path,
										diffs: file.diffs
									})), turnAction);
								},
								children: [turnAction === "undo" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(UndoIcon, {}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RedoIcon, {}), turnBusy ? t(turnAction === "undo" ? "undoing" : "redoing") : t(turnAction === "undo" ? "undoTurn" : "redoTurn")]
							})
						]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						className: FileReviewTab_module_css_default.fileList,
						children: turn.files.map((file) => renderFile(turn, file))
					})]
				}, turn.turn);
			};
			/** Render one changed file row plus its inline diff when expanded. */
			const renderFile = (turn, file) => {
				const key = stateKey(turn.turn, file.path);
				const isOpen = expanded.has(key);
				const state = states.get(key);
				const reversible = isReversible(file);
				const fileAction = state === "undone" ? "redo" : "undo";
				const fileBusy = busyKey === key;
				const stats = summarizeDiffs(file.diffs);
				const kind = classifyPath(file.path);
				const previewable = file.deleted !== true && kind !== "code";
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
					className: FileReviewTab_module_css_default.fileItem,
					ref: (element) => {
						if (element === null) rowRefs.current.delete(key);
						else rowRefs.current.set(key, element);
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: FileReviewTab_module_css_default.fileRow,
						role: "button",
						tabIndex: 0,
						title: file.path,
						"aria-expanded": previewable ? void 0 : isOpen,
						onClick: () => {
							if (previewable) openInEditor(file.path);
							else toggleExpanded(key);
						},
						onKeyDown: (event) => {
							if (event.key === "Enter" || event.key === " ") {
								event.preventDefault();
								if (previewable) openInEditor(file.path);
								else toggleExpanded(key);
							}
						},
						children: [
							!previewable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Chevron, { open: isOpen }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: FileReviewTab_module_css_default.fileName,
								children: basename$1(file.path)
							}),
							file.deleted === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: FileReviewTab_module_css_default.deletedBadge,
								children: t("deleted")
							}) : previewable ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: FileReviewTab_module_css_default.kindBadge,
								children: t(KIND_LABEL$1[kind])
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Stats$1, { stats }),
							file.deleted !== true && !previewable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StateBadge, { state }),
							file.deleted !== true && !previewable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: `${FileReviewTab_module_css_default.smallButton} ${FileReviewTab_module_css_default.editorButton}`,
								onClick: (event) => {
									event.stopPropagation();
									openInEditor(file.path);
								},
								children: t("openInEditor")
							}),
							!previewable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: FileReviewTab_module_css_default.smallButton,
								disabled: statusPending || busyKey !== null || !reversible,
								title: file.deleted === true ? t("deletedHint") : !reversible ? t("toggleUnavailable") : void 0,
								onClick: (event) => {
									event.stopPropagation();
									runToggle(key, [{
										turn: turn.turn,
										path: file.path,
										diffs: file.diffs
									}], fileAction);
								},
								children: fileBusy ? t(fileAction === "undo" ? "undoing" : "redoing") : t(fileAction === "undo" ? "undo" : "redo")
							})
						]
					}), isOpen && !previewable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: FileReviewTab_module_css_default.diffWrap,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LazyDiff, { children: file.deleted === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: FileReviewTab_module_css_default.diffUnavailable,
							children: t("deletedHint")
						}) : file.diffs.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: FileReviewTab_module_css_default.diffUnavailable,
							children: t("unavailable")
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(UnifiedDiff, {
							diffs: file.diffs,
							contextLines: 3,
							showCopyButton: true,
							showFileHeaders: false,
							labels: {
								copy: t("copy"),
								copied: t("copied"),
								showUnchanged: (count) => t("showUnchanged", { count }),
								hideUnchanged: (count) => t("hideUnchanged", { count })
							},
							className: FileReviewTab_module_css_default.reviewDiff
						}) })
					})]
				}, file.path);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: FileReviewTab_module_css_default.root,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: FileReviewTab_module_css_default.header,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: FileReviewTab_module_css_default.headerTitle,
								children: t("tabTitle")
							}),
							flat.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Stats$1, { stats: totalStats }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: FileReviewTab_module_css_default.refreshButton,
								disabled: statusPending,
								title: t("refresh"),
								onClick: () => {
									setTick((value) => value + 1);
								},
								children: "⟳"
							})
						]
					}),
					notice !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: `${FileReviewTab_module_css_default.notice} ${notice.tone === "success" ? FileReviewTab_module_css_default.noticeSuccess : FileReviewTab_module_css_default.noticeError}`,
						role: "alert",
						children: notice.text
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: FileReviewTab_module_css_default.body,
						ref: bodyRef,
						children: turns.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: FileReviewTab_module_css_default.empty,
							children: t("empty")
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [mainTurns.map(renderTurn), archivedTurns.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: FileReviewTab_module_css_default.archiveSection,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: FileReviewTab_module_css_default.archiveHeader,
								"aria-expanded": archiveOpen,
								"aria-label": archiveOpen ? t("archivedCollapse") : t("archivedExpand"),
								onClick: () => {
									setArchiveOpen((current) => !current);
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Chevron, { open: archiveOpen }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: FileReviewTab_module_css_default.archiveTitle,
									children: t("archived", { n: String(archivedTurns.length) })
								})]
							}), archiveOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [archivedVisible.map(renderTurn), archivedRemaining > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: FileReviewTab_module_css_default.archiveLoadMore,
								onClick: () => {
									setArchivePages((current) => current + 1);
								},
								children: t("loadMore", { n: String(archivedRemaining) })
							})] })]
						})] })
					})
				]
			});
		}
		//#endregion
		//#region src/client/dsh-contracts.ts
		/**
		* Read the slot registry through the Context service proxy. `slots` is a
		* declared inject of this plugin (index.tsx), so the service is live whenever
		* `apply()` runs; the structural read only stands in for the missing owner
		* package, exactly like the `ISessions` read in index.tsx.
		* @param ctx - client root context.
		* @returns the registry, or undefined on a carrier without the slots service.
		*/
		function slotRegistry(ctx) {
			return ctx.slots;
		}
		/**
		* Mount one Host-for-Client Remote contribution, typed by the owner of the
		* signature instead of by the plugin's untyped `ctx.remote`. `ClientRemote`
		* is declared in `@deepseek-ai/dsh-api-gateway/client` — absent from this type
		* baseline, which silently degrades `ctx.remote` to `any` and erases the
		* `$mount` contract; the signature itself lives in the installed
		* `@deepseek-ai/dsh-typert-protocol`
		* (packages/typert/protocol/src/types.ts:432-438).
		* @param ctx - client root context.
		* @param contribution - the package's generated Remote contribution.
		* @returns the contribution's disposer, once its namespaces are ready.
		*/
		function mountRemoteContribution(ctx, contribution) {
			return ctx.remote.$mount(contribution);
		}
		//#endregion
		//#region src/client/definition.ts
		/**
		* Per-Turn produced-file facts for one loaded turn, published as turn
		* Location data: complete files (paths + reversible hunks + deletion state)
		* keyed `fileReviewChanges`, consumed session-wide by the sidebar tab, the
		* badge and the turn-tail card's reviews.
		*/
		const fileReviewDefinition = {
			kind: "fileReviewChanges",
			match: (event) => {
				if (event.type === "turn/start") return {
					id: String(event.data.turn),
					role: "start"
				};
				if (event.type === "tool/call") return {
					id: String(event.data.turn),
					role: "update"
				};
				if (event.type === "tool/result" && event.surfaceOp === "append") return {
					id: String(event.data.turn),
					role: "update"
				};
				return null;
			},
			start: (_context, match) => {
				if (match.event.type !== "turn/start") throw new Error("fileReviewChanges start requires turn/start");
				return {
					turn: Number(match.event.data.turn),
					calls: /* @__PURE__ */ new Map(),
					files: /* @__PURE__ */ new Map()
				};
			},
			update: (context, match) => {
				const state = context.state;
				if (match.event.type === "tool/call") {
					const name = typeof match.event.data.name === "string" ? match.event.data.name : "";
					const argsRaw = typeof match.event.data.arguments === "string" ? match.event.data.arguments : "";
					const detail = mutationDetail(name, argsRaw);
					let record = null;
					if (detail !== null) record = {
						kind: "mutation",
						path: detail.path,
						hunks: detail.diffs
					};
					else {
						const deletions = terminalDeletions(name, argsRaw);
						if (deletions.length > 0) record = {
							kind: "deletion",
							paths: deletions
						};
						else {
							const artifacts = captureArtifacts(name, argsRaw);
							if (artifacts.length > 0) record = {
								kind: "artifact",
								paths: artifacts.map((entry) => entry.path)
							};
						}
					}
					const calls = new Map(state.calls);
					calls.set(String(match.event.data.callId), record);
					return {
						...state,
						calls
					};
				}
				if (match.event.type !== "tool/result") return state;
				if ((match.event.data.message?.content?.[0])?.isError === true) return state;
				const call = state.calls.get(String(match.event.data.message?.source?.callId));
				if (call === void 0 || call === null) return state;
				const files = new Map(state.files);
				if (call.kind === "mutation") {
					const existing = files.get(call.path);
					files.set(call.path, { diffs: existing === void 0 ? [...call.hunks] : [...existing.diffs, ...call.hunks] });
				} else if (call.kind === "artifact") for (const path of call.paths) {
					const existing = files.get(path);
					files.set(path, { diffs: existing === void 0 ? [] : existing.diffs });
				}
				else for (const path of call.paths) {
					const existing = files.get(path);
					files.set(path, {
						diffs: existing === void 0 ? [] : existing.diffs,
						deleted: true
					});
				}
				return {
					...state,
					files
				};
			},
			buildLocationData: (context, scope) => {
				if (scope !== "turn" || context.state === void 0) return null;
				const files = [...context.state.files.entries()].map(([path, own]) => ({
					path,
					diffs: own.diffs,
					...own.deleted === true ? { deleted: true } : {}
				}));
				return {
					kind: "turn",
					turn: context.state.turn,
					key: "fileReviewChanges",
					value: { files }
				};
			}
		};
		//#endregion
		//#region src/client/turn-deliverables.ts
		/**
		* Files produced by one Turn data value, deduplicated in first-seen order.
		* Mirrors the built-in producedForClosing: the Location index owns turn
		* membership, so paths cannot spill across turns.
		* @param data - engine-published Deliverables data for one Turn.
		* @param seq - closing Assistant seq; later Tool settlements are excluded.
		* @returns Produced paths in first-seen order; empty when the turn wrote nothing.
		*/
		function producedPathsForClosing(data, seq = Number.POSITIVE_INFINITY) {
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
		* One accepted delivery declaration. Validation mirrors the built-in
		* `isPresentedFile` / `isPresentedData` pair — path is a non-blank string,
		* description is a string when present, seq and index are usable integers —
		* so a malformed row is dropped instead of rendered as broken coordinates.
		* @param value - one entry of the published `presented` array.
		* @returns whether the entry can address a native open.
		*/
		function isPresentedPath(value) {
			if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
			const { path, description, seq, index } = value;
			return typeof path === "string" && path.trim().length > 0 && (description === void 0 || typeof description === "string") && typeof seq === "number" && Number.isSafeInteger(seq) && seq >= 0 && typeof index === "number" && Number.isSafeInteger(index) && index >= 0;
		}
		/**
		* Deliveries declared before the closing reply, latest declaration per path.
		* Mirrors the built-in presentedForClosing: a Map keyed by path keeps the
		* first-seen insertion position while a later `present` call replaces the
		* value, so the row's order is stable and its description is the freshest
		* one. Deliveries settled at or after the closing Assistant belong to a later
		* reply and are excluded.
		* @param data - engine-published Deliverables data for one Turn.
		* @param seq - closing Assistant seq.
		* @returns Replayable deliveries in first-seen path order.
		*/
		function presentedForClosing(data, seq = Number.POSITIVE_INFINITY) {
			if (data === void 0 || data.presented === void 0) return [];
			const files = /* @__PURE__ */ new Map();
			for (const file of data.presented) {
				if (!isPresentedPath(file) || file.seq >= seq) continue;
				files.set(file.path, file);
			}
			return [...files.values()];
		}
		/**
		* Claim the turn-tail chain whenever its closing turn produced files OR
		* declared deliveries. Own `fileReviewChanges` turn data comes first (this
		* plugin's Definition: same vocabulary, complete hunks); the built-in
		* `deliverables` data remains the claim input of last resort for a turn the
		* own Definition has not covered.
		*
		* Claiming deliveries-only turns too is required, not cosmetic: the chain
		* elects the FIRST non-null selector, so declining would hand that turn to
		* the built-in `Deliverables` row and the same feature would render two
		* different ways across turns. An elected entry owns the whole row.
		* @param owner - Turn-tail owner currency for the closing assistant.
		* @returns Produced paths and declared deliveries as the component's match,
		*   or null to decline before mount.
		*/
		function selectDeliverables(owner) {
			const data = owner.turn.data;
			const produced = producedFromOwn(data) ?? producedFromBuiltIn(data, owner.seq);
			const presented = presentedForClosing(data.get("deliverables"), owner.seq);
			return produced.length + presented.length === 0 ? null : {
				produced,
				presented
			};
		}
		/**
		* Paths from this plugin's own Definition data, when it has any.
		* `undefined` — not an empty array — means "no opinion", so the built-in data
		* still gets to answer for a turn the own Definition recorded as empty.
		* @param data - keyed turn Location data reader.
		* @returns Produced paths, or undefined when the own data is unavailable.
		*/
		function producedFromOwn(data) {
			const own = data.get("fileReviewChanges");
			if (own?.files === void 0) return void 0;
			const paths = [];
			const seen = /* @__PURE__ */ new Set();
			for (const file of own.files) {
				if (seen.has(file.path)) continue;
				seen.add(file.path);
				paths.push(file.path);
			}
			return paths.length === 0 ? void 0 : paths;
		}
		/**
		* Paths from the built-in `deliverables` data, the fallback claim input.
		* @param data - keyed turn Location data reader.
		* @param seq - closing Assistant seq.
		* @returns Produced paths; empty when the turn wrote nothing.
		*/
		function producedFromBuiltIn(data, seq) {
			return producedPathsForClosing(data.get("deliverables"), seq);
		}
		/** Trailing path segment, the part that identifies the file at a glance. */
		function basename(path) {
			const at = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
			return at === -1 ? path : path.slice(at + 1);
		}
		/**
		* Uppercase extension of a basename, or an empty string when it has none.
		* The card's secondary line when the model supplied no description.
		* @param name - trailing path segment.
		* @returns Extension without its dot, uppercased.
		*/
		function extensionOf(name) {
			const at = name.lastIndexOf(".");
			return at <= 0 || at === name.length - 1 ? "" : name.slice(at + 1).toUpperCase();
		}
		/**
		* Drop a trailing parenthesized aside from a model-supplied description —
		* the built-in card applies the same rule, so the row's renderings agree.
		* @param description - raw description, possibly undefined.
		* @returns Trimmed description, or undefined when nothing is left.
		*/
		function cleanDescription(description) {
			const trimmed = description?.replace(/\s*(?:\([^()]*\)|（[^（）]*）)\s*$/u, "").trim();
			return trimmed === void 0 || trimmed === "" ? void 0 : trimmed;
		}
		//#endregion
		//#region src/client/present-open.ts
		/**
		* Native-open plumbing for declared deliveries.
		*
		* The delivery cards must be able to (a) preview a file in the Sidebar and
		* (b) hand it to the Host desktop (default application / file manager). This
		* plugin owns only (a) through dsh-coding-sidebar; (b) is a Host capability
		* that the built-in ui-deliverables host half already exposes as two
		* authenticated same-origin routes:
		*
		*   GET  /api/present.host                    → desktop availability + file manager
		*   GET  /api/present.open?sessionId&seq&index → that file's registered applications
		*   POST /api/present.open?sessionId&seq&index[&action=reveal][&application=<id>]
		*
		* 0.1.7：同一 open 路由按方法分流（fork packages/client/ui-deliverables/src/
		* present-open.ts:87-102）——GET 回该文件的系统应用清单（共享控制用它填
		* 「用其它应用打开」菜单），POST 执行手势；显式应用选择走 `application`
		* 查询参数，Host 侧原样转给 `sessionController.openWorkspacePath`
		* （:98-100）。本插件的卡片把这条 URL 交给 0.1.7 新增的共享文件动作子槽
		* （本插件声明自有键 dsh-file-review-kcoder.file.actions）当 `actionUrl`，
		* 因此两边必须逐字同源。
		*
		* Those routes are addressed by URL on purpose instead of imported: this
		* plugin's client half deliberately keeps only TYPE imports from the
		* @deepseek-ai UI packages (see index.tsx), because the versions it supports
		* span releases in which the runtime exports of those packages moved. A route
		* is therefore used best-effort and degrades in two steps:
		*
		*   - 404 on the metadata route  → 'absent': the carrier does not ship the
		*     present feature at all, so the native actions are not rendered and the
		*     card keeps the Sidebar preview.
		*   - any other failure / 422    → 'error' / 'nativeUnavailable': the card
		*     shows the retryable state, exactly like the built-in row.
		*/
		/**
		* Authenticated POST route for opening a workspace file on the Host desktop.
		*
		* 0.1.7：上游浏览器侧 app 路由统一改**文档相对**寻址
		* （`PRESENT_HOST_ROUTE = 'api/present.host'`，无前导斜杠）——根部署下与原
		* 绝对路径等价，前缀剥离反代挂载（如 `https://host/tools/dsh/`）下才正确。
		* 见 fork `.agents/notes/implemented/architecture/2026-09-14-web-document-relative-app-routes.md`。
		*/
		const PRESENT_OPEN_PATH = "api/present.open";
		/** Authenticated desktop availability and destination metadata (document-relative, see above). */
		const PRESENT_HOST_PATH = "api/present.host";
		/**
		* Build a snapshot store. `set` replaces the reference and notifies only on a
		* reference change, so a value that did not move never re-renders a card.
		* @param initial - first published value.
		* @returns the store.
		*/
		function createStore(initial) {
			let value = initial;
			const listeners = /* @__PURE__ */ new Set();
			return {
				getSnapshot: () => value,
				subscribe: (listener) => {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
				set: (next) => {
					if (Object.is(next, value)) return;
					value = next;
					for (const listener of [...listeners]) listener();
				}
			};
		}
		/** Validate desktop metadata received over HTTP (mirrors the built-in guard). */
		function isPresentedHost(value) {
			if (typeof value !== "object" || value === null) return false;
			const host = value;
			return typeof host.name === "string" && typeof host.available === "boolean" && (host.fileManager === null || host.fileManager === "finder" || host.fileManager === "explorer" || host.fileManager === "directory");
		}
		/**
		* Same-origin action URL, keyed by the viewed Session's delivery coordinates.
		* Also the card's status key: the same file reached from two surfaces shares
		* one pending/acknowledged phase.
		* @param sessionId - viewed Session.
		* @param seq - durable delivery event sequence.
		* @param index - original file index within that event.
		* @returns the authenticated action URL.
		*/
		function presentedFileUrl(sessionId, seq, index) {
			const params = new URLSearchParams({
				sessionId,
				seq: String(seq),
				index: String(index)
			});
			return `${PRESENT_OPEN_PATH}?${params.toString()}`;
		}
		/**
		* One browser plugin's native-open requests, cancelled when that plugin is
		* disposed. Mirrors the built-in PresentedOpenController's observable shape
		* so the card's status line and pending states behave identically.
		*/
		var PresentedOpenController = class {
			/** File action URLs key the state across Sessions, turns, and both clickable surfaces. */
			state = createStore({});
			/** Native destination metadata, a retryable read failure, or an absent carrier. */
			host = createStore(null);
			loading;
			metadata = new AbortController();
			lifetime = new AbortController();
			pending = /* @__PURE__ */ new Set();
			/**
			* Open a declared file once while a request for the same coordinates is
			* pending. Failures stay visible on the card and a later gesture retries.
			* @param sessionId - viewed Session, including a fork's own identity.
			* @param seq - durable delivery event sequence.
			* @param index - original file index within that event.
			* @param action - default-application open or file-manager reveal.
			* @param application - registered handler identifier for an explicit
			*   application choice (the shared control's menu selection). Adds
			*   `&application=<id>` to the route; omitting it keeps the request
			*   byte-identical to the plugin's historical no-argument call.
			* @returns the failure to announce, or null once the Host acknowledged.
			*/
			async open(sessionId, seq, index, action = "open", application) {
				const url = presentedFileUrl(sessionId, seq, index);
				const phase = this.state.getSnapshot()[url];
				if (this.lifetime.signal.aborted || phase === "opening" || phase === "revealing") return null;
				this.state.set({
					...this.state.getSnapshot(),
					[url]: action === "open" ? "opening" : "revealing"
				});
				const task = this.request(url, action, application);
				this.pending.add(task);
				try {
					return await task;
				} finally {
					this.pending.delete(task);
				}
			}
			/**
			* Read the serving desktop metadata, coalescing concurrent reads.
			* @returns after metadata, a retryable error, or 'absent' is published.
			*/
			async loadHost() {
				if (this.lifetime.signal.aborted) return;
				if (this.loading !== void 0) return this.loading;
				if (this.host.getSnapshot() === "absent") return;
				this.host.set(null);
				const signal = typeof AbortSignal.any === "function" ? AbortSignal.any([this.lifetime.signal, this.metadata.signal]) : this.lifetime.signal;
				const task = this.readHost(signal);
				this.loading = task;
				this.pending.add(task);
				try {
					await task;
				} finally {
					if (this.loading === task) this.loading = void 0;
					this.pending.delete(task);
				}
			}
			/**
			* Invalidate cached metadata after a connection replacement. `'absent'`
			* survives: the composed plugin roster does not change with a reconnect.
			*/
			resetHost() {
				if (this.host.getSnapshot() === "absent") return;
				const wasLoading = this.loading !== void 0;
				this.metadata.abort();
				this.metadata = new AbortController();
				this.loading = void 0;
				this.host.set(null);
				if (wasLoading) this.loadHost();
			}
			/** Cancel outstanding requests and wait until no request can publish state. */
			async dispose() {
				this.lifetime.abort();
				await Promise.all(this.pending);
			}
			async readHost(signal) {
				let host = "error";
				try {
					const response = await fetch(PRESENT_HOST_PATH, { signal });
					if (response.status === 404) host = "absent";
					else if (response.ok) {
						const value = await response.json();
						if (isPresentedHost(value)) host = value;
					}
				} catch {
					if (signal.aborted) return;
					host = "error";
				}
				if (!signal.aborted) this.host.set(host);
			}
			async request(url, action, application) {
				const failure = action === "open" ? "error" : "revealError";
				let phase = action === "open" ? "opened" : "revealed";
				try {
					const target = action === "reveal" ? `${url}&action=reveal` : application === void 0 ? url : `${url}&application=${encodeURIComponent(application)}`;
					const response = await fetch(target, {
						method: "POST",
						signal: this.lifetime.signal
					});
					if (!response.ok) phase = response.status === 422 ? "nativeUnavailable" : failure;
				} catch {
					phase = failure;
				}
				if (!this.lifetime.signal.aborted) this.state.set({
					...this.state.getSnapshot(),
					[url]: phase
				});
				return phase === "opened" || phase === "revealed" ? null : action === "reveal" ? "revealError" : "openError";
			}
		};
		//#endregion
		//#region \0dsh-file-review-kcoder-css:/Users/libing/kk_Projects/dsh-file-review-kcoder/src/client/PresentedFiles.module.css.mjs
		const css$1 = ".aa-r8G_root{flex-direction:column;gap:10px;min-width:0;margin-top:4px;display:flex}.aa-r8G_hostStatus{color:var(--dsw-alias-label-secondary);align-items:center;gap:8px;font-size:12px;line-height:18px;display:flex}.aa-r8G_retry{color:var(--dsw-alias-link,currentColor);cursor:pointer;font:inherit;text-underline-offset:2px;background:0 0;border:0;padding:0;text-decoration:underline}.aa-r8G_retry:focus-visible{box-shadow:inset 0 0 0 2px var(--dsw-alias-border-l3);outline:none}.aa-r8G_grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;min-width:0;display:grid}.aa-r8G_grid[data-single=true]{grid-template-columns:minmax(0,1fr)}.aa-r8G_file{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-container,Canvas);min-width:0;height:60px;color:var(--dsw-alias-label-primary);border-radius:18px;align-items:center;gap:10px;padding:8px 10px;transition:background-color .12s;display:flex;position:relative;overflow:hidden}.aa-r8G_file:hover{background:var(--dsw-alias-interactive-bg-hover)}.aa-r8G_cardPreview{z-index:1;border-radius:inherit;cursor:pointer;background:0 0;border:0;width:100%;padding:0;position:absolute;inset:0}.aa-r8G_cardPreview:focus-visible{box-shadow:inset 0 0 0 2px var(--dsw-alias-border-l3);outline:none}.aa-r8G_fileIcon{z-index:2;box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-interactive-bg-hover);width:40px;height:40px;color:var(--dsw-alias-link,var(--dsw-alias-label-secondary));pointer-events:none;border-radius:10px;flex:none;place-items:center;display:grid;position:relative;overflow:hidden}.aa-r8G_glyph{fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round;stroke-width:1.4px;width:20px;height:20px}.aa-r8G_fileBody{z-index:2;pointer-events:none;flex:auto;justify-content:space-between;align-items:center;gap:12px;min-width:0;display:flex;position:relative}.aa-r8G_details{flex-direction:column;flex:auto;justify-content:center;gap:2px;min-width:0;display:flex}.aa-r8G_actions{pointer-events:auto;flex:none;display:inline-flex}.aa-r8G_fileName{text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:500;line-height:20px;overflow:hidden}.aa-r8G_description{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:10px;font-weight:400;line-height:16px;overflow:hidden}.aa-r8G_description[data-error=true]{color:var(--dsw-alias-state-error-primary)}.aa-r8G_secondaryText{display:inline}.aa-r8G_previewHint,.aa-r8G_file:hover .aa-r8G_secondaryText{display:none}.aa-r8G_file:hover .aa-r8G_previewHint{display:inline}.aa-r8G_split{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-container,Canvas);pointer-events:auto;border-radius:10px;flex:none;align-items:stretch;height:28px;display:inline-flex;position:relative;overflow:visible}.aa-r8G_open,.aa-r8G_chevron{color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;background:0 0;border:0;justify-content:center;align-items:center;display:inline-flex}.aa-r8G_open{border-radius:9px 0 0 9px;padding:4px 8px;font-size:12px;line-height:18px}.aa-r8G_chevron{border-left:.5px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary);border-radius:0 9px 9px 0;padding:4px 5px}.aa-r8G_chevronGlyph{fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round;stroke-width:1.5px;width:11px;height:11px}.aa-r8G_open:hover,.aa-r8G_open:focus-visible,.aa-r8G_chevron:hover:not(:disabled),.aa-r8G_chevron:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}.aa-r8G_open:focus-visible,.aa-r8G_chevron:focus-visible{outline:none}.aa-r8G_chevron:disabled{color:var(--dsw-alias-label-dimmed,var(--dsw-alias-label-tertiary));cursor:not-allowed}.aa-r8G_menu{z-index:20;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-container,Canvas);border-radius:10px;flex-direction:column;min-width:168px;padding:4px;display:flex;position:absolute;top:calc(100% + 4px);right:0;box-shadow:0 8px 24px #00000029}.aa-r8G_menuItem{color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;text-align:left;white-space:nowrap;background:0 0;border:0;border-radius:6px;align-items:center;gap:8px;padding:6px 8px;font-size:12px;line-height:18px;display:flex}.aa-r8G_menuItem:hover,.aa-r8G_menuItem:focus-visible{background:var(--dsw-alias-interactive-bg-hover);outline:none}.aa-r8G_menuIcon{fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round;stroke-width:1.3px;flex:none;width:16px;height:16px}.aa-r8G_toggle{color:var(--dsw-alias-label-tertiary);cursor:pointer;font:inherit;background:0 0;border:0;border-radius:6px;align-self:center;padding:2px 8px;font-size:12px;line-height:18px}.aa-r8G_toggle:hover{color:var(--dsw-alias-label-secondary)}.aa-r8G_toggle:focus-visible{box-shadow:inset 0 0 0 2px var(--dsw-alias-border-l3);outline:none}";
		const styleId$1 = "dsh-file-review-kcoder/PresentedFiles.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(styleId$1) + "]") === null) {
			const style = document.createElement("style");
			style.dataset.plugin = "dsh-file-review-kcoder";
			style.dataset.pluginCss = styleId$1;
			style.textContent = css$1;
			document.head.appendChild(style);
		}
		var PresentedFiles_module_css_default = {
			"cardPreview": "aa-r8G_cardPreview",
			"previewHint": "aa-r8G_previewHint",
			"chevron": "aa-r8G_chevron",
			"file": "aa-r8G_file",
			"chevronGlyph": "aa-r8G_chevronGlyph",
			"open": "aa-r8G_open",
			"retry": "aa-r8G_retry",
			"glyph": "aa-r8G_glyph",
			"fileBody": "aa-r8G_fileBody",
			"menuIcon": "aa-r8G_menuIcon",
			"secondaryText": "aa-r8G_secondaryText",
			"description": "aa-r8G_description",
			"grid": "aa-r8G_grid",
			"menu": "aa-r8G_menu",
			"toggle": "aa-r8G_toggle",
			"root": "aa-r8G_root",
			"split": "aa-r8G_split",
			"menuItem": "aa-r8G_menuItem",
			"details": "aa-r8G_details",
			"actions": "aa-r8G_actions",
			"hostStatus": "aa-r8G_hostStatus",
			"fileIcon": "aa-r8G_fileIcon",
			"fileName": "aa-r8G_fileName"
		};
		//#endregion
		//#region src/client/PresentedFiles.tsx
		/** A list longer than this starts collapsed behind an expand control. */
		const COLLAPSED_COUNT = 4;
		/** useSyncExternalStore fallbacks for the controller-less (older) carriers. */
		const subscribeNever$1 = () => () => {};
		const NO_STATES = {};
		const getNoStates = () => NO_STATES;
		const getNoHost = () => "absent";
		/**
		* Resolve a (possibly relative) delivery path against the Session cwd for the
		* card's title and the Host-side stat. Mirrors the Sidebar's own resolver:
		* POSIX roots, drive letters, and UNC shares must not be joined onto the cwd.
		*/
		function resolvePresentedPath(cwd, path) {
			if (/^(?:[\\/]|[A-Za-z]:[\\/]|\\\\)/.test(path)) return path;
			if (cwd === void 0 || cwd === "") return path;
			const separator = cwd.includes("\\") ? "\\" : "/";
			return `${cwd.replace(/[\\/]+$/, "")}${separator}${path}`;
		}
		/** The card's secondary line: the phase status, or the description it replaces. */
		function statusOf(phase, reveal, file, name, t) {
			if (phase !== void 0) {
				const directory = reveal === "directory";
				if (directory && phase === "revealed") return t("presented.directoryOpened");
				if (directory && phase === "revealing") return t("presented.directoryOpening");
				if (directory && phase === "revealError") return t("presented.directoryError");
				return t(`presented.${phase}`);
			}
			const described = cleanDescription(file.description);
			if (described !== void 0) return described;
			const extension = extensionOf(name);
			return extension === "" ? t("presented.file") : extension;
		}
		/** A modest document glyph; no shared icon package is imported on purpose. */
		function FileGlyph() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				className: PresentedFiles_module_css_default.glyph,
				viewBox: "0 0 20 20",
				"aria-hidden": "true",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M5.25 2.75h6l3.5 3.5v10a1 1 0 0 1-1 1h-8.5a1 1 0 0 1-1-1V3.75a1 1 0 0 1 1-1Z" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M11.25 2.75v3.5h3.5" })]
			});
		}
		/**
		* This plugin's own native-open control: the split primary + application /
		* reveal menu the card has always rendered, with its own gesture latch.
		*
		* It is the FALLBACK BODY of this plugin's own file-actions child slot (see
		* PresentedCard): when the shared contribution is absent — a carrier without
		* ui-open-in-app, or any dsh before 0.1.7 — the action position keeps exactly
		* this control. Owning the menu state here (rather than in the card) keeps a
		* menu from surviving a swap between this control and the contributed one.
		*/
		function PresentedNativeControl({ file, phase, writable, reveal, onPreview, onAction, t }) {
			const [menuOpen, setMenuOpen] = (0, react.useState)(false);
			const splitRef = (0, react.useRef)(null);
			const previewRef = (0, react.useRef)(null);
			const menuDisabled = phase === "opening" || phase === "revealing" || !writable;
			if (menuDisabled && menuOpen) setMenuOpen(false);
			(0, react.useEffect)(() => {
				if (!menuOpen) return void 0;
				const onPointerDown = (event) => {
					if (splitRef.current?.contains(event.target) === true) return;
					setMenuOpen(false);
				};
				const onKeyDown = (event) => {
					if (event.key !== "Escape") return;
					setMenuOpen(false);
					previewRef.current?.focus();
				};
				document.addEventListener("pointerdown", onPointerDown);
				document.addEventListener("keydown", onKeyDown);
				return () => {
					document.removeEventListener("pointerdown", onPointerDown);
					document.removeEventListener("keydown", onKeyDown);
				};
			}, [menuOpen]);
			const act = (action) => {
				setMenuOpen(false);
				previewRef.current?.focus();
				onAction(action).catch(() => {});
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: PresentedFiles_module_css_default.split,
				ref: splitRef,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						ref: previewRef,
						type: "button",
						className: PresentedFiles_module_css_default.open,
						"aria-label": t("presented.previewButton", { name: file.path }),
						onClick: onPreview,
						children: t("presented.action")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: PresentedFiles_module_css_default.chevron,
						disabled: menuDisabled,
						"aria-haspopup": "menu",
						"aria-expanded": menuOpen && !menuDisabled,
						"aria-label": t("presented.more", { name: file.path }),
						onClick: () => {
							setMenuOpen((value) => !value);
						},
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
							className: PresentedFiles_module_css_default.chevronGlyph,
							viewBox: "0 0 14 14",
							"aria-hidden": "true",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M3.5 5.25 7 8.75l3.5-3.5" })
						})
					}),
					menuOpen && !menuDisabled && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: PresentedFiles_module_css_default.menu,
						role: "menu",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							role: "menuitem",
							className: PresentedFiles_module_css_default.menuItem,
							onClick: () => {
								act("open");
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
								className: PresentedFiles_module_css_default.menuIcon,
								viewBox: "0 0 16 16",
								"aria-hidden": "true",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M6 3.5h6.5V10M12.5 3.5 6.5 9.5M11 9.5v3H3.5v-7.5H7" })
							}), t("presented.defaultApp")]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							role: "menuitem",
							className: PresentedFiles_module_css_default.menuItem,
							onClick: () => {
								act("reveal");
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
								className: PresentedFiles_module_css_default.menuIcon,
								viewBox: "0 0 16 16",
								"aria-hidden": "true",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M1.75 4.25h4l1.25 1.5h7.25v6.5a1 1 0 0 1-1 1h-10.5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z" })
							}), t(`presented.${reveal}`)]
						})]
					})
				]
			});
		}
		/** One delivery card: Sidebar preview under the contributed or fallback action control. */
		function PresentedCard({ file, sessionId, cwd, phase, host, renderSlot, onPreview, onAction, t }) {
			const pending = phase === "opening" || phase === "revealing";
			const writable = host !== null && host !== "error" && host !== "absent" && host.available;
			const reveal = host !== null && host !== "error" && host !== "absent" ? host.fileManager ?? "directory" : "directory";
			const name = basename(file.path);
			const status = statusOf(phase, reveal, file, name, t);
			const failed = phase === "error" || phase === "revealError" || phase === "nativeUnavailable";
			const actionUrl = presentedFileUrl(sessionId, file.seq, file.index);
			const fallback = /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PresentedNativeControl, {
				file,
				phase,
				writable,
				reveal,
				onPreview,
				onAction,
				t
			});
			const actions = renderSlot === void 0 ? fallback : renderSlot("dsh-file-review-kcoder.file.actions", {
				actionUrl,
				available: writable,
				pending,
				onAction
			}, { fallback });
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: PresentedFiles_module_css_default.file,
				"data-presented-file": true,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: PresentedFiles_module_css_default.cardPreview,
						title: resolvePresentedPath(cwd, file.path),
						"aria-label": t("presented.previewCard", { name: file.path }),
						onClick: onPreview
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: PresentedFiles_module_css_default.fileIcon,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FileGlyph, {})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: PresentedFiles_module_css_default.fileBody,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: PresentedFiles_module_css_default.details,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: PresentedFiles_module_css_default.fileName,
								children: name
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: PresentedFiles_module_css_default.description,
								role: phase === void 0 ? void 0 : "status",
								"data-error": failed || void 0,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: PresentedFiles_module_css_default.secondaryText,
									children: status
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: PresentedFiles_module_css_default.previewHint,
									children: t("presented.preview")
								})]
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: PresentedFiles_module_css_default.actions,
							children: actions
						})]
					})
				]
			});
		}
		/**
		* The closing turn's explicit deliveries.
		* @param props - deliveries, Session scope, preview route, and native controller.
		* @returns the delivery section, or null when the turn declared none.
		*/
		function PresentedFiles({ files, sessionId, projectRoot, onPreview, controller, renderSlot, t }) {
			const [expanded, setExpanded] = (0, react.useState)(false);
			const states = (0, react.useSyncExternalStore)(controller?.state.subscribe ?? subscribeNever$1, controller?.state.getSnapshot ?? getNoStates);
			const host = (0, react.useSyncExternalStore)(controller?.host.subscribe ?? subscribeNever$1, controller?.host.getSnapshot ?? getNoHost);
			const readableHost = host === "error" || host === "absent" ? null : host;
			(0, react.useEffect)(() => {
				if (controller === void 0 || files.length === 0 || host !== null) return;
				controller.loadHost();
			}, [
				controller,
				files.length,
				host
			]);
			if (files.length === 0) return null;
			const collapsible = files.length > COLLAPSED_COUNT;
			const shown = collapsible && !expanded ? files.slice(0, COLLAPSED_COUNT) : files;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: PresentedFiles_module_css_default.root,
				"aria-label": t("presented.summary"),
				children: [
					host === "error" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: PresentedFiles_module_css_default.hostStatus,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("presented.hostError") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: PresentedFiles_module_css_default.retry,
							onClick: () => {
								controller?.loadHost();
							},
							children: t("presented.retry")
						})]
					}),
					readableHost !== null && !readableHost.available && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: PresentedFiles_module_css_default.hostStatus,
						children: t("presented.unavailable")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: PresentedFiles_module_css_default.grid,
						"data-presented-files-row": true,
						"data-single": files.length === 1 || void 0,
						children: shown.map((file) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PresentedCard, {
							file,
							sessionId,
							cwd: projectRoot,
							phase: states[presentedFileUrl(sessionId, file.seq, file.index)],
							host,
							renderSlot,
							onPreview: () => {
								onPreview(file.path);
							},
							onAction: (action, application) => controller === void 0 ? Promise.resolve(null) : controller.open(sessionId, file.seq, file.index, action, application),
							t
						}, `${file.seq}:${file.index}:${file.path}`))
					}),
					collapsible && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: PresentedFiles_module_css_default.toggle,
						"aria-expanded": expanded,
						"aria-label": t(expanded ? "presented.collapseAria" : "presented.expandAria", { count: String(files.length) }),
						onClick: () => {
							setExpanded((value) => !value);
						},
						children: expanded ? t("presented.collapse") : t("presented.all", { count: String(files.length) })
					})
				]
			});
		}
		//#endregion
		//#region \0dsh-file-review-kcoder-css:/Users/libing/kk_Projects/dsh-file-review-kcoder/src/client/ProducedFiles.module.css.mjs
		const css = "._xmB4G_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-container,Canvas);color:var(--dsw-alias-label-primary);border-radius:12px;margin-top:16px;font-size:13px;overflow:hidden}._xmB4G_cardHeader{align-items:center;gap:10px;min-height:56px;padding:0 12px;display:flex}._xmB4G_fileIconWrap{background:var(--dsw-alias-interactive-bg-hover);width:30px;height:30px;color:var(--dsw-alias-label-secondary);border-radius:8px;flex:none;place-items:center;display:grid}._xmB4G_icon,._xmB4G_buttonIcon,._xmB4G_closeIcon{fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round;stroke-width:1.4px}._xmB4G_icon{width:18px;height:18px}._xmB4G_buttonIcon{width:16px;height:16px}._xmB4G_closeIcon{width:20px;height:20px}._xmB4G_cardTitleBlock{flex:auto;align-items:baseline;gap:10px;min-width:0;display:flex}._xmB4G_cardTitle{text-overflow:ellipsis;white-space:nowrap;font-weight:600;overflow:hidden}._xmB4G_stats{font-variant-numeric:tabular-nums;white-space:nowrap;flex:none;gap:5px;display:inline-flex}._xmB4G_added{color:var(--dsw-alias-state-success-primary)}._xmB4G_removed{color:var(--dsw-alias-state-error-primary)}._xmB4G_reviewButton,._xmB4G_toggleButton,._xmB4G_toolbarButton,._xmB4G_openButton,._xmB4G_closeButton{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-container,Canvas);color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit}._xmB4G_reviewButton,._xmB4G_toggleButton,._xmB4G_toolbarButton{border-radius:8px;flex:none;align-items:center;gap:6px;min-height:30px;padding:0 10px;display:inline-flex}._xmB4G_reviewButton:hover,._xmB4G_toggleButton:hover:not(:disabled),._xmB4G_toolbarButton:hover:not(:disabled),._xmB4G_openButton:hover,._xmB4G_closeButton:hover{background:var(--dsw-alias-interactive-bg-hover)}._xmB4G_reviewButton:focus-visible,._xmB4G_toggleButton:focus-visible,._xmB4G_toolbarButton:focus-visible,._xmB4G_openButton:focus-visible,._xmB4G_closeButton:focus-visible,._xmB4G_fileRow:focus-visible{box-shadow:inset 0 0 0 2px var(--dsw-alias-border-l3);outline:none}._xmB4G_fileList{border-top:1px solid var(--dsw-alias-border-l1)}._xmB4G_fileRow{border:0;border-bottom:1px solid var(--dsw-alias-border-l1);width:100%;min-height:38px;color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;text-align:left;background:0 0;align-items:center;gap:12px;margin:0;padding:0 12px;display:flex}._xmB4G_fileRow:hover{background:var(--dsw-alias-interactive-bg-hover)}._xmB4G_fileName{text-overflow:ellipsis;white-space:nowrap;flex:auto;min-width:0;overflow:hidden}._xmB4G_moreFiles{width:100%;min-height:34px;color:var(--dsw-alias-label-tertiary);font:inherit;text-align:left;cursor:pointer;background:0 0;border:0;padding:0 12px;line-height:34px;display:block}._xmB4G_moreFiles:hover{color:var(--dsw-alias-label-secondary)}._xmB4G_moreFiles:focus-visible{box-shadow:inset 0 0 0 2px var(--dsw-alias-border-l3);outline:none}._xmB4G_drawer{z-index:1000;width:var(--review-drawer-width,36vw);border-left:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-container,Canvas);max-width:100vw;color:var(--dsw-alias-label-primary);flex-direction:column;display:flex;position:fixed;inset:0 0 0 auto;box-shadow:-12px 0 32px #0000001f}._xmB4G_drawerSplit{z-index:1;box-shadow:none}._xmB4G_drawerResizing,._xmB4G_drawerResizing *{cursor:col-resize;user-select:none}._xmB4G_resizeHandle{z-index:5;cursor:col-resize;touch-action:none;background:0 0;border:0;width:12px;margin:0;padding:0;position:absolute;inset:0 auto 0 -6px}._xmB4G_resizeHandle:after{content:\"\";background:0 0;width:2px;transition:background .12s;position:absolute;inset:0 auto 0 5px}._xmB4G_resizeHandle:hover:after,._xmB4G_resizeHandle:focus-visible:after,._xmB4G_drawerResizing ._xmB4G_resizeHandle:after{background:var(--dsw-alias-border-l3)}._xmB4G_resizeHandle:focus-visible{outline:none}._xmB4G_drawerHeader{border-bottom:1px solid var(--dsw-alias-border-l2);flex:none;align-items:center;gap:12px;min-height:64px;padding:0 14px 0 18px;display:flex}._xmB4G_drawerHeading{flex-direction:column;flex:auto;gap:2px;min-width:0;display:flex}._xmB4G_drawerTitle{font-size:15px;font-weight:600;line-height:20px}._xmB4G_drawerSubtitle{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:16px;overflow:hidden}._xmB4G_toolbarButton:disabled,._xmB4G_toggleButton:disabled{cursor:default;opacity:.45}._xmB4G_toast{z-index:1200;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-container,Canvas);width:min(430px,100vw - 32px);color:var(--dsw-alias-label-primary);border-radius:14px;padding:14px;position:fixed;top:120px;left:50%;transform:translate(-50%);box-shadow:0 8px 24px #00000029}._xmB4G_toastSuccess{border-color:color-mix(in srgb, var(--dsw-alias-state-success-primary) 28%, transparent);width:auto;min-width:220px;max-width:min(430px,100vw - 32px);padding:8px 10px}._xmB4G_toastError{border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 28%, transparent)}._xmB4G_toastHeader{align-items:flex-start;gap:10px;display:flex}._xmB4G_noticeIcon{border-radius:9px;flex:none;place-items:center;width:30px;height:30px;display:grid}._xmB4G_toastSuccess ._xmB4G_noticeIcon{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent);color:var(--dsw-alias-state-success-primary)}._xmB4G_toastError ._xmB4G_noticeIcon{background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);color:var(--dsw-alias-state-error-primary)}._xmB4G_noticeIconSvg{fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round;stroke-width:1.7px;width:18px;height:18px}._xmB4G_toastCopy{flex-direction:column;flex:auto;gap:3px;min-width:0;padding-top:3px;display:flex}._xmB4G_toastTitle{font-size:14px;font-weight:600;line-height:20px}._xmB4G_toastDescription{overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}._xmB4G_toastCloseButton{width:28px;height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:0;border-radius:7px;flex:none;place-items:center;padding:0;display:grid}._xmB4G_toastCloseButton:hover,._xmB4G_toastCloseButton:focus-visible,._xmB4G_noticeFileButton:hover,._xmB4G_noticeFileButton:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}._xmB4G_toastCloseButton:focus-visible,._xmB4G_noticeFileButton:focus-visible{box-shadow:inset 0 0 0 2px var(--dsw-alias-border-l3);outline:none}._xmB4G_noticeFiles{margin:12px 0 0 40px}._xmB4G_noticeFileListLabel{color:var(--dsw-alias-label-secondary);margin:0 8px 4px;font-size:12px;line-height:18px;display:block}._xmB4G_noticeFileList{flex-direction:column;gap:2px;max-height:220px;margin:0;padding:0;list-style:none;display:flex;overflow:auto}._xmB4G_noticeFileButton{width:100%;min-height:34px;color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;text-align:left;background:0 0;border:0;border-radius:7px;align-items:center;gap:12px;padding:5px 8px;display:flex}._xmB4G_noticeFilePath{min-width:0;font:var(--dsw-font-markdown-code-block);text-overflow:ellipsis;white-space:nowrap;flex:auto;overflow:hidden}._xmB4G_noticeFileArrow{color:var(--dsw-alias-label-secondary);white-space:nowrap;flex:none;font-size:14px}._xmB4G_noticeDismissButton{background:var(--dsw-alias-label-primary);width:100%;min-height:34px;color:var(--dsw-alias-bg-container,Canvas);cursor:pointer;font:inherit;border:0;border-radius:8px;margin-top:12px;padding:0 12px;font-weight:600}._xmB4G_noticeDismissButton:hover{opacity:.9}._xmB4G_noticeDismissButton:focus-visible{outline:2px solid var(--dsw-alias-border-l3);outline-offset:2px}._xmB4G_closeButton{background:0 0;border-color:#0000;border-radius:8px;flex:none;place-items:center;width:32px;height:32px;padding:0;display:grid}._xmB4G_drawerBody{flex:auto;min-height:0;overflow:auto}._xmB4G_reviewFile+._xmB4G_reviewFile{border-top:8px solid var(--dsw-alias-border-l1)}._xmB4G_reviewFileHeader{z-index:2;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-container,Canvas);min-height:44px;font:var(--dsw-font-markdown-code-block);align-items:center;gap:8px;padding:0 12px;display:flex;position:sticky;top:0}._xmB4G_reviewStatus{color:var(--dsw-alias-state-success-primary);font-weight:700}._xmB4G_reviewPath{text-overflow:ellipsis;white-space:nowrap;flex:auto;min-width:0;overflow:hidden}._xmB4G_openButton{min-height:28px;font:var(--dsw-font-xs-13);border-radius:7px;flex:none;padding:0 9px}._xmB4G_reviewDiff{color:var(--dsw-alias-label-primary)}._xmB4G_reviewUnavailable{background:var(--dsw-alias-markdown-code-block);color:var(--dsw-alias-label-secondary);margin:0;padding:22px 16px;font-size:13px;line-height:20px}@media (width<=760px){._xmB4G_cardHeader{flex-wrap:wrap;padding-block:10px}._xmB4G_cardTitleBlock{flex-direction:column;gap:1px}._xmB4G_drawer{border-left:0;width:100vw}._xmB4G_resizeHandle{display:none}._xmB4G_drawerHeader{gap:8px;padding-left:12px}._xmB4G_toolbarButton{color:#0000;justify-content:center;width:32px;padding:0;overflow:hidden}._xmB4G_toolbarButton ._xmB4G_buttonIcon{color:var(--dsw-alias-label-primary)}._xmB4G_reviewFileHeader{flex-wrap:wrap;padding-block:8px}._xmB4G_reviewPath{flex-basis:calc(100% - 30px)}._xmB4G_openButton{margin-left:auto}}@media (prefers-reduced-motion:no-preference){._xmB4G_drawer{animation:.16s ease-out _xmB4G_drawer-enter}}@keyframes _xmB4G_drawer-enter{0%{opacity:0;transform:translate(20px)}to{opacity:1;transform:translate(0)}}._xmB4G_deletedBadge{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent);white-space:nowrap;border-radius:999px;padding:1px 6px;font-size:11px}._xmB4G_kindBadge{color:var(--dsw-alias-label-secondary);background:color-mix(in srgb, var(--dsw-alias-label-tertiary) 16%, transparent);white-space:nowrap;border-radius:999px;padding:1px 6px;font-size:11px}";
		const styleId = "dsh-file-review-kcoder/ProducedFiles.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(styleId) + "]") === null) {
			const style = document.createElement("style");
			style.dataset.plugin = "dsh-file-review-kcoder";
			style.dataset.pluginCss = styleId;
			style.textContent = css;
			document.head.appendChild(style);
		}
		var ProducedFiles_module_css_default = {
			"noticeFiles": "_xmB4G_noticeFiles",
			"noticeFilePath": "_xmB4G_noticeFilePath",
			"drawerSubtitle": "_xmB4G_drawerSubtitle",
			"noticeFileListLabel": "_xmB4G_noticeFileListLabel",
			"icon": "_xmB4G_icon",
			"drawerHeader": "_xmB4G_drawerHeader",
			"noticeDismissButton": "_xmB4G_noticeDismissButton",
			"reviewFile": "_xmB4G_reviewFile",
			"kindBadge": "_xmB4G_kindBadge",
			"deletedBadge": "_xmB4G_deletedBadge",
			"card": "_xmB4G_card",
			"drawer": "_xmB4G_drawer",
			"drawerBody": "_xmB4G_drawerBody",
			"toggleButton": "_xmB4G_toggleButton",
			"drawer-enter": "_xmB4G_drawer-enter",
			"reviewUnavailable": "_xmB4G_reviewUnavailable",
			"toastCopy": "_xmB4G_toastCopy",
			"closeIcon": "_xmB4G_closeIcon",
			"fileIconWrap": "_xmB4G_fileIconWrap",
			"resizeHandle": "_xmB4G_resizeHandle",
			"fileName": "_xmB4G_fileName",
			"toastError": "_xmB4G_toastError",
			"noticeFileButton": "_xmB4G_noticeFileButton",
			"noticeFileList": "_xmB4G_noticeFileList",
			"fileList": "_xmB4G_fileList",
			"stats": "_xmB4G_stats",
			"toastSuccess": "_xmB4G_toastSuccess",
			"toastCloseButton": "_xmB4G_toastCloseButton",
			"reviewFileHeader": "_xmB4G_reviewFileHeader",
			"reviewPath": "_xmB4G_reviewPath",
			"reviewButton": "_xmB4G_reviewButton",
			"toast": "_xmB4G_toast",
			"noticeIconSvg": "_xmB4G_noticeIconSvg",
			"removed": "_xmB4G_removed",
			"drawerHeading": "_xmB4G_drawerHeading",
			"cardTitleBlock": "_xmB4G_cardTitleBlock",
			"toastTitle": "_xmB4G_toastTitle",
			"added": "_xmB4G_added",
			"buttonIcon": "_xmB4G_buttonIcon",
			"toastHeader": "_xmB4G_toastHeader",
			"noticeIcon": "_xmB4G_noticeIcon",
			"reviewStatus": "_xmB4G_reviewStatus",
			"moreFiles": "_xmB4G_moreFiles",
			"reviewDiff": "_xmB4G_reviewDiff",
			"openButton": "_xmB4G_openButton",
			"cardTitle": "_xmB4G_cardTitle",
			"closeButton": "_xmB4G_closeButton",
			"drawerResizing": "_xmB4G_drawerResizing",
			"noticeFileArrow": "_xmB4G_noticeFileArrow",
			"drawerTitle": "_xmB4G_drawerTitle",
			"toolbarButton": "_xmB4G_toolbarButton",
			"fileRow": "_xmB4G_fileRow",
			"toastDescription": "_xmB4G_toastDescription",
			"cardHeader": "_xmB4G_cardHeader",
			"drawerSplit": "_xmB4G_drawerSplit"
		};
		//#endregion
		//#region src/client/ProducedFiles.tsx
		/** Keep the turn-tail card compact; the sidebar tab always lists every file. */
		const SHOWN_LIMIT = 6;
		/** useSyncExternalStore fallbacks for carriers without a changes store. */
		const subscribeNever = () => () => {};
		const getNullSnapshot = () => null;
		const SUCCESS_NOTICE_DURATION = 2e3;
		const ERROR_NOTICE_DURATION = 5e3;
		/** Localized badge copy per artifact class (chat namespace keys). */
		const KIND_LABEL = {
			image: "produced.kindImage",
			video: "produced.kindVideo",
			audio: "produced.kindAudio",
			office: "produced.kindOffice",
			pdf: "produced.kindPdf",
			doc: "produced.kindDoc"
		};
		const unavailableChanges = async (request) => ({ files: request.files.map((file) => ({
			path: file.path,
			state: "unsupported",
			changed: false,
			reason: "Host file toggle is unavailable"
		})) });
		function FileIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				viewBox: "0 0 20 20",
				"aria-hidden": "true",
				className: ProducedFiles_module_css_default.icon,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M5.25 2.75h6l3.5 3.5v10a1 1 0 0 1-1 1h-8.5a1 1 0 0 1-1-1V3.75a1 1 0 0 1 1-1Z" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M11.25 2.75v3.5h3.5M7 10h5M7 13h5" })]
			});
		}
		function ReviewIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				viewBox: "0 0 20 20",
				"aria-hidden": "true",
				className: ProducedFiles_module_css_default.buttonIcon,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M4.5 3.5h8a1 1 0 0 1 1 1v3M6.5 6.5h4M6.5 9.5h2.25" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "m10.5 13 1.5 1.5 3.5-4" })]
			});
		}
		function CloseIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				viewBox: "0 0 20 20",
				"aria-hidden": "true",
				className: ProducedFiles_module_css_default.closeIcon,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "m5.5 5.5 9 9m0-9-9 9" })
			});
		}
		function SuccessIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				viewBox: "0 0 20 20",
				"aria-hidden": "true",
				className: ProducedFiles_module_css_default.noticeIconSvg,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "m5 10 3.25 3.25L15 6.5" })
			});
		}
		function ErrorIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				viewBox: "0 0 20 20",
				"aria-hidden": "true",
				className: ProducedFiles_module_css_default.noticeIconSvg,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
					cx: "10",
					cy: "10",
					r: "6.5"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "m7.5 7.5 5 5m0-5-5 5" })]
			});
		}
		function ResultToast({ notice, closeLabel, dismissLabel, fileListLabel, fileOpenLabel, openFile, onDone }) {
			(0, react.useEffect)(() => {
				const duration = notice.tone === "success" ? SUCCESS_NOTICE_DURATION : ERROR_NOTICE_DURATION;
				const timer = window.setTimeout(onDone, duration);
				return () => {
					window.clearTimeout(timer);
				};
			}, [notice.tone, onDone]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: `${ProducedFiles_module_css_default.toast} ${notice.tone === "success" ? ProducedFiles_module_css_default.toastSuccess : ProducedFiles_module_css_default.toastError}`,
				role: "alert",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: ProducedFiles_module_css_default.toastHeader,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: ProducedFiles_module_css_default.noticeIcon,
								children: notice.tone === "success" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SuccessIcon, {}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ErrorIcon, {})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: ProducedFiles_module_css_default.toastCopy,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
									className: ProducedFiles_module_css_default.toastTitle,
									children: notice.title
								}), notice.description !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: ProducedFiles_module_css_default.toastDescription,
									children: notice.description
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: ProducedFiles_module_css_default.toastCloseButton,
								"aria-label": closeLabel,
								onClick: onDone,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CloseIcon, {})
							})
						]
					}),
					notice.files.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: ProducedFiles_module_css_default.noticeFiles,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: ProducedFiles_module_css_default.noticeFileListLabel,
							children: fileListLabel
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
							className: ProducedFiles_module_css_default.noticeFileList,
							children: notice.files.map((file) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: ProducedFiles_module_css_default.noticeFileButton,
								"aria-label": fileOpenLabel(file.path),
								onClick: () => {
									openFile(file.path);
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: ProducedFiles_module_css_default.noticeFilePath,
									children: basename(file.path)
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: ProducedFiles_module_css_default.noticeFileArrow,
									"aria-hidden": "true",
									children: "↗"
								})]
							}) }, file.path))
						})]
					}),
					notice.tone === "error" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: ProducedFiles_module_css_default.noticeDismissButton,
						onClick: onDone,
						children: dismissLabel
					})
				]
			});
		}
		function addStats(left, right) {
			return {
				added: left.added + right.added,
				removed: left.removed + right.removed
			};
		}
		function Stats({ stats, label }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: ProducedFiles_module_css_default.stats,
				"aria-label": label,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: ProducedFiles_module_css_default.added,
					children: ["+", stats.added]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: ProducedFiles_module_css_default.removed,
					children: ["-", stats.removed]
				})]
			});
		}
		/**
		* Content key of a host-state inspection input: paths plus hunk counts.
		* Identity-stable across re-derivations — two freshly-allocated arrays with
		* the same files produce the same key, an appended hunk changes it. Exported
		* for the smoke regression checks (the blink fix's core invariant).
		*/
		function inspectionKey(files) {
			return files.map((file) => `${file.path}#${file.diffs.length}`).join("|");
		}
		/** Render one turn's produced files as a summary card opening the sidebar tab. */
		function ProducedFiles({ matched, collectReviews, changesStore, openFile, turn: turnLocation, inspectChanges = unavailableChanges, applyChanges = unavailableChanges, openInSidebarTab, openPreview, t }) {
			const previewOpen = openPreview ?? openFile;
			const turnNumber = turnLocation.turn;
			const changesVersion = (0, react.useSyncExternalStore)(changesStore?.subscribe ?? subscribeNever, changesStore === void 0 ? getNullSnapshot : () => changesStore.getTurnSnapshot?.(turnNumber) ?? changesStore.getSnapshot());
			const reviews = (0, react.useMemo)(() => {
				const derived = collectReviews?.(turnNumber);
				const byPath = new Map((derived ?? []).map((review) => [review.path, review]));
				return matched.map((path) => byPath.get(path) ?? {
					path,
					diffs: []
				});
			}, [
				collectReviews,
				turnNumber,
				matched,
				changesVersion
			]);
			const [toggleAction, setToggleAction] = (0, react.useState)("undo");
			const [statusPending, setStatusPending] = (0, react.useState)(true);
			const [togglePending, setTogglePending] = (0, react.useState)(false);
			const [toast, setToast] = (0, react.useState)(null);
			const toastSeqRef = (0, react.useRef)(0);
			const reviewsWithStats = (0, react.useMemo)(() => reviews.map((review) => ({
				review,
				stats: summarizeDiffs(review.diffs)
			})), [reviews]);
			const totalStats = (0, react.useMemo)(() => reviewsWithStats.reduce((total, item) => addStats(total, item.stats), {
				added: 0,
				removed: 0
			}), [reviewsWithStats]);
			const toggleFiles = (0, react.useMemo)(() => reviews.filter((review) => review.deleted !== true).map((review) => ({
				path: review.path,
				diffs: review.diffs
			})), [reviews]);
			const toggleKey = (0, react.useMemo)(() => inspectionKey(toggleFiles), [toggleFiles]);
			const reversiblePaths = (0, react.useMemo)(() => new Set(reviews.filter((review) => review.diffs.length > 0 && review.diffs.every((diff) => diff.path === review.path && diff.oldText !== null && diff.oldText !== diff.newText && (diff.oldText !== "" || diff.oldStart !== void 0) && (diff.newText !== "" || diff.newStart !== void 0))).map((review) => review.path)), [reviews]);
			const hasReversibleFiles = reversiblePaths.size > 0;
			const [expanded, setExpanded] = (0, react.useState)(false);
			const expandable = reviewsWithStats.length > SHOWN_LIMIT;
			const shown = expanded ? reviewsWithStats : reviewsWithStats.slice(0, SHOWN_LIMIT);
			const hidden = expanded ? 0 : reviewsWithStats.length - shown.length;
			const allPaths = (0, react.useMemo)(() => reviews.map((review) => review.path), [reviews]);
			const allDeleted = reviews.length > 0 && reviews.every((review) => review.deleted === true);
			const statsMatter = totalStats.added > 0 || totalStats.removed > 0;
			const showToast = (0, react.useCallback)((notice) => {
				toastSeqRef.current += 1;
				setToast({
					seq: toastSeqRef.current,
					...notice
				});
			}, []);
			const phaseForResult = (0, react.useCallback)((result, currentAction) => {
				if (reversiblePaths.size === 0) return "undo";
				const byPath = new Map(result.files.map((file) => [file.path, file]));
				const target = currentAction === "undo" ? "undone" : "applied";
				return [...reversiblePaths].every((path) => byPath.get(path)?.state === target) ? currentAction === "undo" ? "redo" : "undo" : currentAction;
			}, [reversiblePaths]);
			const inspectedRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				const inspected = inspectedRef.current;
				if (inspected !== null && inspected.inspector === inspectChanges && inspected.key === toggleKey) return;
				if (toggleFiles.length === 0) {
					inspectedRef.current = {
						inspector: inspectChanges,
						key: toggleKey
					};
					setStatusPending(false);
					return;
				}
				let active = true;
				setStatusPending(true);
				const timer = window.setTimeout(() => {
					inspectChanges({
						action: "undo",
						files: toggleFiles
					}).then((result) => {
						if (!active) return;
						inspectedRef.current = {
							inspector: inspectChanges,
							key: toggleKey
						};
						const allUndone = reversiblePaths.size > 0 && [...reversiblePaths].every((path) => result.files.find((file) => file.path === path)?.state === "undone");
						setToggleAction(allUndone ? "redo" : "undo");
					}).catch(() => {}).finally(() => {
						if (active) setStatusPending(false);
					});
				}, 300);
				return () => {
					active = false;
					window.clearTimeout(timer);
				};
			}, [
				inspectChanges,
				toggleFiles,
				toggleKey
			]);
			const runToggle = (0, react.useCallback)(() => {
				if (statusPending || togglePending || !hasReversibleFiles) return;
				const action = toggleAction;
				setTogglePending(true);
				applyChanges({
					action,
					files: toggleFiles
				}).then((result) => {
					setToggleAction(phaseForResult(result, action));
					const targetState = action === "undo" ? "undone" : "applied";
					const byPath = new Map(result.files.map((file) => [file.path, file]));
					const failures = toggleFiles.flatMap((file) => {
						if (byPath.get(file.path)?.state === targetState) return [];
						return [{ path: file.path }];
					});
					if (failures.length === 0) {
						showToast({
							tone: "success",
							title: t(action === "undo" ? "produced.undoSuccess" : "produced.redoSuccess"),
							files: []
						});
						return;
					}
					showToast({
						tone: "error",
						title: t(action === "undo" ? "produced.undoPartial" : "produced.redoPartial"),
						description: t(action === "undo" ? "produced.undoPartialDescription" : "produced.redoPartialDescription"),
						files: failures
					});
				}).catch((error) => {
					showToast({
						tone: "error",
						title: t(action === "undo" ? "produced.undoError" : "produced.redoError"),
						description: error instanceof Error ? error.message : String(error),
						files: []
					});
				}).finally(() => {
					setTogglePending(false);
				});
			}, [
				applyChanges,
				hasReversibleFiles,
				phaseForResult,
				showToast,
				t,
				statusPending,
				toggleAction,
				toggleFiles,
				togglePending
			]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: ProducedFiles_module_css_default.card,
				"aria-label": t("produced.summary"),
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
					className: ProducedFiles_module_css_default.cardHeader,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: ProducedFiles_module_css_default.fileIconWrap,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FileIcon, {})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: ProducedFiles_module_css_default.cardTitleBlock,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: ProducedFiles_module_css_default.cardTitle,
								children: allDeleted ? reviews.length === 1 ? t("produced.deletedOne") : t("produced.deletedAll", { count: String(reviews.length) }) : reviews.length === 1 ? t("produced.editedOne") : t("produced.edited", { count: String(reviews.length) })
							}), statsMatter && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Stats, {
								stats: totalStats,
								label: t("review.stats", {
									added: String(totalStats.added),
									removed: String(totalStats.removed)
								})
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: ProducedFiles_module_css_default.toggleButton,
							disabled: statusPending || togglePending || !hasReversibleFiles,
							title: !hasReversibleFiles ? t("produced.toggleUnavailable") : void 0,
							"aria-label": toggleAction === "undo" ? t("produced.undo") : t("produced.redo"),
							onClick: runToggle,
							children: togglePending ? toggleAction === "undo" ? t("produced.undoing") : t("produced.redoing") : toggleAction === "undo" ? t("produced.undo") : t("produced.redo")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: ProducedFiles_module_css_default.reviewButton,
							"aria-label": t("produced.reviewAll"),
							onClick: () => {
								openInSidebarTab?.(allPaths, turnNumber);
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ReviewIcon, {}), t("review.title")]
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: ProducedFiles_module_css_default.fileList,
					children: [shown.map(({ review, stats }) => {
						const kind = classifyPath(review.path);
						const previewable = review.deleted !== true && kind !== "code";
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: ProducedFiles_module_css_default.fileRow,
							title: review.path,
							"aria-label": previewable ? t("produced.preview", { name: review.path }) : t("produced.review", { name: review.path }),
							onClick: () => {
								if (previewable) previewOpen(review.path);
								else openInSidebarTab?.([review.path], turnNumber);
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: ProducedFiles_module_css_default.fileName,
								children: basename(review.path)
							}), review.deleted === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: ProducedFiles_module_css_default.deletedBadge,
								children: t("produced.deleted")
							}) : previewable ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: ProducedFiles_module_css_default.kindBadge,
								children: t(KIND_LABEL[kind])
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Stats, {
								stats,
								label: t("review.stats", {
									added: String(stats.added),
									removed: String(stats.removed)
								})
							})]
						}, review.path);
					}), expandable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: ProducedFiles_module_css_default.moreFiles,
						"aria-expanded": expanded,
						onClick: () => {
							setExpanded((value) => !value);
						},
						children: expanded ? t("produced.collapse") : hidden === 1 ? t("produced.moreOne") : t("produced.more", { count: String(hidden) })
					})]
				})]
			}), toast !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ResultToast, {
				notice: toast,
				closeLabel: t("produced.noticeClose"),
				dismissLabel: t("produced.noticeDismiss"),
				fileListLabel: t("produced.skippedFiles", { count: String(toast.files.length) }),
				fileOpenLabel: (path) => t("produced.open", { name: basename(path) }),
				openFile,
				onDone: () => {
					setToast((current) => current?.seq === toast.seq ? null : current);
				}
			}, toast.seq)] });
		}
		//#endregion
		//#region src/client/Deliverables.tsx
		/**
		* Render the closing turn's complete deliverables row.
		* @param props - match, inject face, and the Session standard share.
		* @returns the changed-files card, the delivery cards, or both.
		*/
		/**
		* List-mode turn-tail wrapper (dsh 0.1.6-alpha.2): the slot became a list —
		* no select callback runs before mount, so the claim computation moved here
		* and re-runs on every render. Declines (null) when the turn produced
		* nothing and declared no deliveries; otherwise renders the enhanced card.
		* Structural owner face: the type baseline this plugin builds against
		* predates the list-mode shapes (same recipe as the turn-data reads).
		*/
		function FileReviewTurnTail(props) {
			const matched = selectDeliverables(props);
			if (matched === null) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Deliverables, {
				...props,
				matched
			});
		}
		function Deliverables({ matched, presentedController, sessionId, fileActionsSlot, renderSlot, ...card }) {
			const { produced, presented } = matched;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [produced.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProducedFiles, {
				matched: produced,
				...card
			}), presented.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PresentedFiles, {
				files: presented,
				sessionId,
				projectRoot: card.projectRoot,
				onPreview: card.openPreview ?? card.openFile,
				controller: presentedController,
				renderSlot: fileActionsSlot === true ? renderSlot : void 0,
				t: card.t
			})] });
		}
		//#endregion
		//#region src/client/chat-locales.ts
		/** `file-review` namespace dictionaries. */
		/** Dictionary namespace owned by this plugin. */
		const NS = "file-review";
		/** English dictionary (the key-set source of truth). */
		const en = {
			"produced.summary": "Edited files",
			"produced.editedOne": "Edited 1 file",
			"produced.edited": "Edited {count} files",
			"produced.moreOne": "1 more file",
			"produced.more": "{count} more files",
			"produced.collapse": "Show less",
			"produced.preview": "Preview {name}",
			"produced.kindImage": "Image",
			"produced.kindVideo": "Video",
			"produced.kindAudio": "Audio",
			"produced.kindOffice": "Office",
			"produced.kindPdf": "PDF",
			"produced.kindDoc": "Doc",
			"produced.open": "Open {name}",
			"produced.review": "Review {name}",
			"produced.reviewAll": "Review all produced files",
			"produced.undo": "Undo",
			"produced.redo": "Reapply",
			"produced.undoing": "Undoing…",
			"produced.redoing": "Reapplying…",
			"produced.toggleUnavailable": "No safely reversible files are available in this change",
			"produced.undoSuccess": "Changes undone",
			"produced.redoSuccess": "Changes reapplied",
			"produced.undoPartial": "Not all changes were restored",
			"produced.redoPartial": "Not all changes were reapplied",
			"produced.undoPartialDescription": "An error occurred while restoring some files",
			"produced.redoPartialDescription": "An error occurred while reapplying some files",
			"produced.skippedFiles": "Skipped ({count})",
			"produced.undoError": "Could not undo changes",
			"produced.redoError": "Could not reapply changes",
			"produced.noticeClose": "Dismiss notification",
			"produced.noticeDismiss": "Close",
			"produced.deleted": "deleted",
			"produced.deletedOne": "Deleted 1 file",
			"produced.deletedAll": "Deleted {count} files",
			"review.title": "Review",
			"review.fileOne": "1 file",
			"review.files": "{count} files",
			"review.close": "Close",
			"review.resize": "Resize review panel",
			"review.resizeHint": "Drag to resize. Double-click to reset.",
			"review.openInEditor": "Open in editor",
			"review.copy": "Copy diff",
			"review.copied": "Copied",
			"review.showUnchanged": "{count} unchanged lines",
			"review.hideUnchanged": "Hide {count} unchanged lines",
			"review.stats": "{added} lines added, {removed} lines removed",
			"review.unavailable": "No reconstructable diff is available for this change. You can still open the current file.",
			"presented.summary": "Delivered files",
			"presented.action": "Open",
			"presented.preview": "Preview in sidebar",
			"presented.previewCard": "Preview {name} in the sidebar",
			"presented.previewButton": "Open {name} in the sidebar",
			"presented.more": "More file actions for {name}",
			"presented.defaultApp": "Open with default app",
			"presented.finder": "Show in Finder",
			"presented.explorer": "Show in File Explorer",
			"presented.directory": "Open containing folder",
			"presented.opening": "Opening…",
			"presented.opened": "Opened in the default app",
			"presented.error": "Could not open. Click to retry.",
			"presented.revealing": "Showing in file manager…",
			"presented.revealed": "Requested display in file manager",
			"presented.revealError": "Could not show in file manager. Try again.",
			"presented.directoryOpening": "Opening containing folder…",
			"presented.directoryOpened": "Requested opening containing folder",
			"presented.directoryError": "Could not open containing folder. Try again.",
			"presented.nativeUnavailable": "This file has no available Host path. Preview it in the sidebar.",
			"presented.unavailable": "This Host has no desktop available to open files or folders",
			"presented.hostError": "Could not read the Host desktop information",
			"presented.retry": "Retry",
			"presented.all": "All {count} files",
			"presented.collapse": "Show less",
			"presented.expandAria": "Show all {count} delivered files",
			"presented.collapseAria": "Collapse the delivered files",
			"presented.file": "File"
		};
		/** Simplified Chinese dictionary. */
		const zh = {
			"produced.summary": "已编辑文件",
			"produced.editedOne": "已编辑 1 个文件",
			"produced.edited": "已编辑 {count} 个文件",
			"produced.moreOne": "另有 1 个文件",
			"produced.more": "另有 {count} 个文件",
			"produced.collapse": "收起",
			"produced.preview": "预览 {name}",
			"produced.kindImage": "图片",
			"produced.kindVideo": "视频",
			"produced.kindAudio": "音频",
			"produced.kindOffice": "Office",
			"produced.kindPdf": "PDF",
			"produced.kindDoc": "文档",
			"produced.open": "打开 {name}",
			"produced.review": "审查 {name}",
			"produced.reviewAll": "审查所有产出文件",
			"produced.undo": "撤销",
			"produced.redo": "重新应用",
			"produced.undoing": "正在撤销…",
			"produced.redoing": "正在重新应用…",
			"produced.toggleUnavailable": "本次更改中没有可安全还原的文件",
			"produced.undoSuccess": "已成功撤销更改",
			"produced.redoSuccess": "已成功重新应用更改",
			"produced.undoPartial": "未还原全部更改",
			"produced.redoPartial": "未重新应用全部更改",
			"produced.undoPartialDescription": "还原部分文件时出错",
			"produced.redoPartialDescription": "重新应用部分文件时出错",
			"produced.skippedFiles": "已跳过（{count} 个）",
			"produced.undoError": "未能撤销更改",
			"produced.redoError": "未能重新应用更改",
			"produced.noticeClose": "关闭提示",
			"produced.noticeDismiss": "关闭",
			"produced.deleted": "已删除",
			"produced.deletedOne": "已删除 1 个文件",
			"produced.deletedAll": "已删除 {count} 个文件",
			"review.title": "审查",
			"review.fileOne": "1 个文件",
			"review.files": "{count} 个文件",
			"review.close": "关闭",
			"review.resize": "调整审查面板大小",
			"review.resizeHint": "拖动以调整大小。双击恢复默认大小。",
			"review.openInEditor": "在编辑器中打开",
			"review.copy": "复制差异",
			"review.copied": "已复制",
			"review.showUnchanged": "显示 {count} 行未更改内容",
			"review.hideUnchanged": "隐藏 {count} 行未更改内容",
			"review.stats": "新增 {added} 行，删除 {removed} 行",
			"review.unavailable": "无法为此更改还原可审查的差异。你仍可打开当前文件。",
			"presented.summary": "交付文件",
			"presented.action": "打开",
			"presented.preview": "在侧边栏预览",
			"presented.previewCard": "在侧边栏预览 {name}",
			"presented.previewButton": "在侧边栏打开 {name}",
			"presented.more": "{name} 的更多文件操作",
			"presented.defaultApp": "用默认应用打开",
			"presented.finder": "在访达中显示",
			"presented.explorer": "在文件资源管理器中显示",
			"presented.directory": "打开所在文件夹",
			"presented.opening": "正在打开…",
			"presented.opened": "已在默认程序中打开",
			"presented.error": "打开失败，点击重试",
			"presented.revealing": "正在文件管理器中显示…",
			"presented.revealed": "已请求在文件管理器中显示",
			"presented.revealError": "无法在文件管理器中显示，请重试",
			"presented.directoryOpening": "正在打开所在文件夹…",
			"presented.directoryOpened": "已请求打开所在文件夹",
			"presented.directoryError": "无法打开所在文件夹，请重试",
			"presented.nativeUnavailable": "此文件没有可用的主机路径，请在侧边栏预览",
			"presented.unavailable": "此主机没有可用的桌面，无法打开文件或文件夹",
			"presented.hostError": "无法读取主机桌面信息",
			"presented.retry": "重试",
			"presented.all": "全部 {count} 个文件",
			"presented.collapse": "收起",
			"presented.expandAria": "展开全部 {count} 个交付文件",
			"presented.collapseAria": "收起交付文件列表",
			"presented.file": "文件"
		};
		/**
		* Decode a `dsh-resource://changes-review/session/<id>/<seq>/<turn>` address —
		* the shape upstream's `changesReviewAddress` mints (three segments behind the
		* prefix, the Session id percent-encoded).
		*
		* Anything else declines: an unknown prefix, a segment count other than three,
		* a non-numeric sequence or turn, and a malformed percent escape all return
		* `undefined` so the caller's open falls through untouched (guessing here would
		* hijack opens this plugin does not own).
		*
		* @param address - candidate resource address (any unknown value is declined).
		* @returns the decoded coordinates, or undefined when this is not a review address.
		*/
		function parseChangesReviewAddress(address) {
			if (typeof address !== "string" || !address.startsWith("dsh-resource://changes-review/session/")) return void 0;
			const parts = address.slice(38).split("/");
			if (parts.length !== 3) return void 0;
			const [rawId, rawSeq, rawTurn] = parts;
			if (rawId === "" || !/^\d+$/.test(rawSeq) || !/^[1-9]\d*$/.test(rawTurn)) return void 0;
			try {
				return {
					sessionId: decodeURIComponent(rawId),
					seq: Number(rawSeq),
					turn: Number(rawTurn)
				};
			} catch {
				return;
			}
		}
		/**
		* Wrap `sidebarRight.openResource` so review addresses open in this plugin's
		* own tab while every other address reaches the original method unchanged.
		*
		* `openResource` is a prototype method on the sidebar controller, so the raw
		* reference is captured and reassigned; a remount that swaps the controller
		* replaces this wrapper with the new instance's own (the disposer restores the
		* reference it captured, which is why callers must install per instance).
		*
		* @param right - the sidebarRight service face.
		* @param open - reroutes one decoded review address into the plugin's tab.
		* @returns the disposer restoring the original method (HMR-safe).
		*/
		function wrapChangesReviewOpen(right, open) {
			const original = right.openResource;
			if (typeof original !== "function") return () => {};
			right.openResource = function(address, options) {
				const coordinates = parseChangesReviewAddress(address);
				if (coordinates !== void 0) {
					open(coordinates);
					return;
				}
				return original.call(this, address, options);
			};
			return () => {
				right.openResource = original;
			};
		}
		//#endregion
		//#region src/client/index.tsx
		/**
		* Required services: the sidebar registry, session snapshots, locale, remote,
		* and the slot registry (turn-tail chain). The conversation Definition
		* registry is deliberately NOT a static inject: its service name moved across
		* dsh releases (<= 0.1.1: root `conversationEvents`; 0.1.2-alpha.1+:
		* `uiConversation.events`), so a hard inject on either name leaves the whole
		* plugin forever "pending" on the other version and fails web boot (issue
		* #6). It is resolved dynamically in apply() instead.
		*/
		const inject = [
			"betterSidebar",
			"sessions",
			"locale",
			"remote",
			"slots"
		];
		/** The tab icon: a modest line-diff glyph drawn at the host-given size. */
		function FileReviewIcon({ size }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 20 20",
				"aria-hidden": "true",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1.5,
				strokeLinecap: "round",
				strokeLinejoin: "round",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M5.25 2.75h6l3.5 3.5v10a1 1 0 0 1-1 1h-8.5a1 1 0 0 1-1-1V3.75a1 1 0 0 1 1-1Z" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M11.25 2.75v3.5h3.5" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M7 10h2.5M10.5 10H12M7 13h5" })
				]
			});
		}
		/**
		* The tab-strip badge: the number of distinct files this session changed.
		* The sidebar re-renders the tab bar constantly (and streams publish a fresh
		* snapshot reference per event), so the derivation is memoized by a cheap
		* structural fingerprint per session — streaming token flushes keep the
		* fingerprint stable and skip the full re-derive.
		*/
		const badgeMemo = /* @__PURE__ */ new Map();
		function faceFingerprint(face) {
			if (face === null) return "none";
			let lastEnd = 0;
			for (const endSeq of face.legacy.turnEnds.values()) lastEnd = endSeq;
			let dataTurns = -1;
			const timeline = face.timeline;
			if (timeline !== void 0) {
				dataTurns = 0;
				for (const turn of timeline.turnOrder) if (timeline.turns.get(turn)?.data.get("fileReviewChanges") !== void 0) dataTurns += 1;
			}
			return `${face.legacy.nodes.length}:${face.legacy.turnEnds.size}:${lastEnd}:${dataTurns}`;
		}
		function badgeCount(ctx, sessionId) {
			const face = resolveConversationStore(ctx, sessionId)?.getSnapshot() ?? null;
			const fingerprint = faceFingerprint(face);
			const hit = badgeMemo.get(sessionId);
			if (hit !== void 0 && hit.fingerprint === fingerprint) return hit.count;
			const { main } = splitArchivedTurns(deriveTimelineChanges(face));
			const count = countChangedFiles(main);
			const value = count === 0 ? null : count;
			badgeMemo.set(sessionId, {
				fingerprint,
				count: value
			});
			return value;
		}
		/**
		* Open (or focus) the sidebar review tab for one review address's turn, in the
		* address's OWN Session scope (a chip inside a fork's card belongs to the fork,
		* not to whatever conversation is on screen).
		*
		* The paths come from the same sources the chat card reads — this plugin's
		* per-turn Definition data first, the timeline derive as the windowed fallback
		* — so the deep link expands exactly the rows the native panel would have
		* listed. An unresolvable turn still opens the tab (the panel auto-expands via
		* the `path`-carrying seed when the review has a first file) rather than
		* silently doing nothing.
		*
		* @param ctx - client root context.
		* @param coordinates - decoded review address (Session, sequence, turn).
		*/
		function openReviewInSidebar(ctx, { sessionId, turn }) {
			const sidebar = ctx.betterSidebar;
			if (sidebar === void 0) return;
			const cwd = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd;
			const scope = {
				sessionId,
				...cwd !== void 0 ? { cwd } : {}
			};
			const face = resolveConversationStore(ctx, sessionId)?.getSnapshot() ?? null;
			const paths = ((face?.timeline?.turns.get(turn)?.data.get("fileReviewChanges"))?.files ?? deriveTimelineChanges(face).find((entry) => entry.turn === turn)?.files ?? []).map((file) => file.path);
			const meta = {
				expandPaths: paths,
				turn
			};
			const first = paths[0];
			sidebar.updateTab("file-review", { meta });
			sidebar.openTab({
				type: "file-review",
				...first !== void 0 ? { path: first } : {},
				meta
			}, scope);
			sidebar.activateTab("file-review", scope);
		}
		/**
		* Client plugin body: attach locale, mount the Typert remote, register the
		* chat turn-tail row AND the sidebar tab.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			attachLocale(ctx.locale);
			ctx.effect(() => {
				const offZh = ctx.locale.register(LOCALE_NS, "zh", zh$1);
				const offEn = ctx.locale.register(LOCALE_NS, "en", en$1);
				return () => {
					offZh();
					offEn();
				};
			}, "file-review-tab: tab dictionaries");
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "file-review-tab: chat dictionaries");
			const presentedOpen = new PresentedOpenController();
			ctx.effect(() => () => {
				presentedOpen.dispose();
			}, "file-review-tab: presented opens");
			ctx.effect(() => ctx.on("connection/reset", () => {
				presentedOpen.resetHost();
			}), "file-review-tab: presented host reset");
			ctx.effect(() => {
				let disposed = false;
				let disposeRemote;
				mountRemoteContribution(ctx, TYPERT_REMOTE).then((dispose) => {
					if (disposed) dispose();
					else disposeRemote = dispose;
				}).catch((error) => {
					console.error("[dsh-file-review-tab] remote mount error:", error);
				});
				return () => {
					disposed = true;
					if (disposeRemote !== void 0) disposeRemote();
				};
			}, "file-review-tab: typert remote");
			ctx.effect(() => {
				let timer;
				let dispose;
				let attempts = 0;
				const stop = () => {
					if (timer !== void 0) {
						clearTimeout(timer);
						timer = void 0;
					}
				};
				const tryRegister = () => {
					attempts += 1;
					const anyCtx = ctx;
					const events = (typeof anyCtx.get === "function" ? anyCtx.get("uiConversation") : void 0)?.events;
					if (events !== void 0 && typeof events.register === "function") {
						dispose = events.register(fileReviewDefinition);
						stop();
						return;
					}
					if (attempts >= 120) {
						stop();
						return;
					}
					timer = setTimeout(tryRegister, 250);
				};
				tryRegister();
				return () => {
					stop();
					if (dispose !== void 0) dispose();
				};
			}, "file-review-tab: session-wide Definition");
			ctx.effect(() => {
				const slots = slotRegistry(ctx);
				if (slots === void 0) return () => {};
				let fileActionsSlot = false;
				return slots.inject("conversation.chat.turnTail", () => {
					const turnTailOptions = {
						name: "conversation.chat.turnTail",
						id: "dsh-file-review-tab",
						select: selectDeliverables,
						priority: -2,
						locale: NS,
						registrant: "dsh-file-review-tab",
						inject: (sessionId) => {
							const sessions = ctx.sessions;
							const projectRoot = sessions.list.getSnapshot().byId[sessionId]?.cwd;
							const invoke = async (method, request) => {
								const scope = sessions.scope(sessionId);
								if (scope === void 0) throw new Error("Session is unavailable");
								const fileReview = scope.get("remote.fileReview");
								if (fileReview === void 0) throw new Error("File review Remote is unavailable");
								const result = await fileReview[method](request);
								if (!result.ok) throw new Error(result.error.message);
								return result.value;
							};
							let cachedStore;
							const getStore = () => {
								if (cachedStore !== void 0) return cachedStore;
								const store = resolveConversationStore(ctx, sessionId);
								if (store !== void 0) cachedStore = store;
								return store;
							};
							const collectReviews = (turn) => {
								const face = getStore()?.getSnapshot() ?? null;
								const files = (face?.timeline?.turns.get(turn)?.data.get("fileReviewChanges"))?.files ?? deriveTimelineChanges(face).find((entry) => entry.turn === turn)?.files;
								if (files === void 0) return [];
								return files.map((file) => ({
									path: file.path,
									diffs: [...file.diffs],
									...file.deleted === true ? { deleted: true } : {}
								}));
							};
							return {
								projectRoot,
								inspectChanges: (request) => invoke("status", request),
								applyChanges: (request) => invoke("apply", request),
								collectReviews,
								changesStore: {
									getSnapshot: () => getStore()?.getSnapshot() ?? null,
									getTurnSnapshot: (turn) => turnChangesFingerprint(getStore()?.getSnapshot() ?? null, turn),
									subscribe: (listener) => getStore()?.subscribe(listener) ?? (() => {})
								},
								openInSidebarTab: (paths, turn) => {
									const sidebar = ctx.betterSidebar;
									const first = paths[0];
									if (sidebar === void 0 || first === void 0) return;
									const meta = {
										expandPaths: [...paths],
										...turn !== void 0 ? { turn } : {}
									};
									const scope = {
										sessionId,
										...projectRoot !== void 0 ? { cwd: projectRoot } : {}
									};
									sidebar.updateTab("file-review", { meta });
									sidebar.openTab({
										type: "file-review",
										path: first,
										meta
									}, scope);
									sidebar.activateTab("file-review", scope);
								},
								openPreview: (path) => {
									const sidebar = ctx.betterSidebar;
									if (sidebar === void 0) return;
									const absolute = resolveSessionPath(projectRoot, path);
									sidebar.openFile({
										sessionId,
										...projectRoot !== void 0 ? { cwd: projectRoot } : {}
									}, absolute, basename(absolute));
								},
								presentedController: presentedOpen,
								fileActionsSlot
							};
						}
					};
					const withFileActions = {
						...turnTailOptions,
						children: { "dsh-file-review-kcoder.file.actions": {
							kind: "list",
							scope: "session"
						} }
					};
					try {
						const dispose = slots.register(withFileActions, FileReviewTurnTail);
						fileActionsSlot = true;
						return dispose;
					} catch (error) {
						console.warn("[dsh-file-review-tab] file-action child slot unavailable, keeping the card's own control:", error);
						return slots.register(turnTailOptions, FileReviewTurnTail);
					}
				});
			}, "file-review-tab: turn-tail row");
			ctx.effect(() => ctx.betterSidebar.registerTab({
				id: "file-review",
				title: () => t("tabTitle"),
				icon: (size) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FileReviewIcon, { size }),
				order: 35,
				single: true,
				badge: (badgeCtx, scope) => badgeCount(badgeCtx, scope.sessionId),
				component: ({ ctx: tabCtx, scope, visible, tab }) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FileReviewTab, {
					ctx: tabCtx,
					sessionId: scope.sessionId,
					cwd: scope.cwd,
					visible,
					tab
				})
			}), "file-review-tab: register tab");
			ctx.effect(() => {
				let disposed = false;
				let disposeWrap = () => {};
				const fiber = ctx.inject(["sidebarRight"], () => {
					if (disposed) return;
					const right = ctx.get("sidebarRight");
					if (right === void 0) return;
					disposeWrap = wrapChangesReviewOpen(right, (coordinates) => {
						openReviewInSidebar(ctx, coordinates);
					});
					console.log("[dsh-file-review-tab] native-sidebar takeover: changes-review → file-review tab");
				});
				return () => {
					disposed = true;
					disposeWrap();
					fiber.dispose();
				};
			}, "file-review-tab: changes-review takeover");
		}
		//#endregion
		exports.Deliverables = Deliverables;
		exports.PresentedOpenController = PresentedOpenController;
		exports.apply = apply;
		exports.captureArtifacts = captureArtifacts;
		exports.classifyPath = classifyPath;
		exports.inject = inject;
		exports.inspectionKey = inspectionKey;
		exports.parseChangesReviewAddress = parseChangesReviewAddress;
		exports.presentedFileUrl = presentedFileUrl;
		exports.presentedForClosing = presentedForClosing;
		exports.selectDeliverables = selectDeliverables;
		exports.turnChangesFingerprint = turnChangesFingerprint;
		exports.wrapChangesReviewOpen = wrapChangesReviewOpen;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map