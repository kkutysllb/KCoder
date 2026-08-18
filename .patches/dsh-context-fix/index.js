// src/host/config.ts
import { z } from "zod";
var DEFAULT_BOUNDS = {
  maxRequestSteps: 1500,
  maxKeptTurns: 300,
  maxEvents: 400,
  maxNodes: 2e3,
  maxArchiveNodes: 400
};
var Config = z.preprocess(
  (v) => v ?? {},
  z.object({
    maxRequestSteps: z.number().int().min(1).default(DEFAULT_BOUNDS.maxRequestSteps),
    maxKeptTurns: z.number().int().min(1).default(DEFAULT_BOUNDS.maxKeptTurns),
    maxEvents: z.number().int().min(1).default(DEFAULT_BOUNDS.maxEvents),
    maxNodes: z.number().int().min(1).default(DEFAULT_BOUNDS.maxNodes),
    maxArchiveNodes: z.number().int().min(1).default(DEFAULT_BOUNDS.maxArchiveNodes)
  }).strict()
);
function resolveBounds(config) {
  const parsed = Config.parse(config ?? {});
  return {
    maxRequestSteps: parsed.maxRequestSteps,
    maxKeptTurns: parsed.maxKeptTurns,
    maxEvents: parsed.maxEvents,
    maxNodes: parsed.maxNodes,
    maxArchiveNodes: parsed.maxArchiveNodes
  };
}

// src/host/headers.ts
import { z as z2 } from "zod";

// src/host/pricing.ts
var CHARS_PER_TOKEN = 4;
var BLOCK_OVERHEAD = 4;
var ROLE_OVERHEAD = 4;
function estimateToolsTotal(tools) {
  return tools.length > 0 ? Math.ceil(JSON.stringify(tools).length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD : 0;
}
function estimateBlocks(blocks) {
  let tokens = 0;
  if (!Array.isArray(blocks)) return 0;
  for (const block of blocks) {
    if (block === null || typeof block !== "object") continue;
    switch (block.type) {
      case "text":
      case "reasoning":
        tokens += Math.ceil(String(block.text || "").length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD;
        break;
      case "tool-call":
        tokens += Math.ceil(String(block.name || "").length / CHARS_PER_TOKEN) + Math.ceil(String(block.arguments || "").length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD;
        break;
      case "tool-result":
        tokens += estimateBlocks(block.content) + BLOCK_OVERHEAD;
        break;
      default:
        tokens += BLOCK_OVERHEAD + Math.ceil(JSON.stringify(block).length / CHARS_PER_TOKEN);
    }
  }
  return tokens;
}
function estimateMessage(message, emptyIsZero = false) {
  if (emptyIsZero && (message === null || message === void 0 || !Array.isArray(message.content) || message.content.length === 0)) {
    return 0;
  }
  return estimateBlocks(message?.content) + ROLE_OVERHEAD;
}
function estimateSystem(text) {
  if (typeof text !== "string" || text.length === 0) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN) + ROLE_OVERHEAD;
}
function estimateToolSchema(tool) {
  return Math.ceil(JSON.stringify(tool).length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD;
}
function firstText(blocks) {
  if (!Array.isArray(blocks)) return "";
  for (const b of blocks) {
    if (b && b.type === "text" && typeof b.text === "string" && b.text.trim() !== "") {
      return b.text.replace(/\s+/g, " ").trim().slice(0, 80);
    }
  }
  return "";
}
function toolCallNames(blocks) {
  const names = [];
  if (!Array.isArray(blocks)) return names;
  for (const b of blocks) {
    if (b && b.type === "tool-call" && typeof b.name === "string") names.push(b.name);
  }
  return names;
}
function isInjection(source) {
  return source !== null && typeof source === "object" && (source.kind === "plugin" || source.kind === "skill-invocation" || typeof source.form === "string");
}

// src/host/headers.ts
var HEADERS_MAX = 50;
var headerToolSchema = z2.object({
  name: z2.string(),
  tokens: z2.number().int().nonnegative(),
  description: z2.string().optional(),
  schema: z2.unknown().optional()
}).strict();
var contextHeadersSchema = z2.object({
  headers: z2.array(z2.object({
    seq: z2.number(),
    time: z2.number(),
    system: z2.string().optional(),
    tools: z2.array(headerToolSchema)
  }).strict())
}).strict();
function recordOf(event) {
  if (event.type !== "request/header") return null;
  const header = event.data.header;
  if (header === null || typeof header !== "object") return null;
  const tools = Array.isArray(header.tools) ? header.tools : [];
  const record = {
    seq: event.seq,
    time: event.time,
    tools: tools.map((t) => {
      const tool = t;
      const entry = {
        name: typeof tool.name === "string" ? tool.name : "?",
        tokens: estimateToolSchema(t),
        schema: t
      };
      if (typeof tool.description === "string" && tool.description !== "") {
        entry.description = tool.description;
      }
      return entry;
    })
  };
  if (typeof header.system === "string" && header.system.length > 0) {
    record.system = header.system;
  }
  return record;
}
function createContextHeadersDefinition() {
  return {
    key: "contextHeaders",
    schema: contextHeadersSchema,
    init: () => ({ headers: [] }),
    apply: (state, event) => {
      const record = recordOf(event);
      if (record === null) return state;
      const last = state.headers[state.headers.length - 1];
      if (last !== void 0 && last.seq === record.seq) return state;
      const headers = [...state.headers, record];
      return { headers: headers.length > HEADERS_MAX ? headers.slice(-HEADERS_MAX) : headers };
    },
    view: (state) => ({
      headers: state.headers.map((h) => ({ ...h, tools: h.tools.map((t) => ({ ...t })) }))
    }),
    stateVersion: 1
  };
}

// src/host/timeline.ts
import { z as z3 } from "zod";

// node_modules/.pnpm/@deepseek-ai+cosmokit@1.8.2/node_modules/@deepseek-ai/cosmokit/lib/index.js
function isNullable(value) {
  return value === null || value === void 0;
}
function isPlainObject(data) {
  return data && typeof data === "object" && !Array.isArray(data);
}
function filterKeys(object, filter) {
  return Object.fromEntries(Object.entries(object).filter(([key, value]) => filter(key, value)));
}
function mapValues(object, transform) {
  return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, transform(value, key)]));
}
function pick(source, keys, forced) {
  if (!keys) return { ...source };
  const result = {};
  for (const key of keys) if (forced || source[key] !== void 0) result[key] = source[key];
  return result;
}
function is(type, value) {
  if (arguments.length === 1) return (value2) => is(type, value2);
  return type in globalThis && value instanceof globalThis[type] || Object.prototype.toString.call(value).slice(8, -1) === type;
}
function isArrayBufferLike(value) {
  return is("ArrayBuffer", value) || is("SharedArrayBuffer", value);
}
function isArrayBufferSource(value) {
  return isArrayBufferLike(value) || ArrayBuffer.isView(value);
}
var Binary;
(function(Binary2) {
  Binary2.is = isArrayBufferLike;
  Binary2.isSource = isArrayBufferSource;
  function fromSource(source) {
    if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
    else return source;
  }
  Binary2.fromSource = fromSource;
  function toBase64(source) {
    source = fromSource(source);
    if (typeof Buffer !== "undefined") return Buffer.from(source).toString("base64");
    let binary = "";
    const bytes = new Uint8Array(source);
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
  Binary2.toBase64 = toBase64;
  function fromBase64(source) {
    if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "base64"));
    return Uint8Array.from(atob(source), (c) => c.charCodeAt(0));
  }
  Binary2.fromBase64 = fromBase64;
  function toHex(source) {
    source = fromSource(source);
    if (typeof Buffer !== "undefined") return Buffer.from(source).toString("hex");
    return Array.from(new Uint8Array(source), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  Binary2.toHex = toHex;
  function fromHex(source) {
    if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "hex"));
    const hex = source.length % 2 === 0 ? source : source.slice(0, source.length - 1);
    const buffer = [];
    for (let i = 0; i < hex.length; i += 2) buffer.push(parseInt(`${hex[i]}${hex[i + 1]}`, 16));
    return Uint8Array.from(buffer).buffer;
  }
  Binary2.fromHex = fromHex;
})(Binary || (Binary = {}));
var base64ToArrayBuffer = Binary.fromBase64;
var arrayBufferToBase64 = Binary.toBase64;
var hexToArrayBuffer = Binary.fromHex;
var arrayBufferToHex = Binary.toHex;
function clone(source, refs = /* @__PURE__ */ new Map()) {
  if (!source || typeof source !== "object") return source;
  if (is("Date", source)) return new Date(source.valueOf());
  if (is("RegExp", source)) return new RegExp(source.source, source.flags);
  if (isArrayBufferLike(source)) return source.slice(0);
  if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
  const cached = refs.get(source);
  if (cached) return cached;
  if (Array.isArray(source)) {
    const result2 = [];
    refs.set(source, result2);
    source.forEach((value, index) => {
      result2[index] = Reflect.apply(clone, null, [value, refs]);
    });
    return result2;
  }
  const result = Object.create(Object.getPrototypeOf(source));
  refs.set(source, result);
  for (const key of Reflect.ownKeys(source)) {
    const descriptor = { ...Reflect.getOwnPropertyDescriptor(source, key) };
    if ("value" in descriptor) descriptor.value = Reflect.apply(clone, null, [descriptor.value, refs]);
    Reflect.defineProperty(result, key, descriptor);
  }
  return result;
}
function deepEqual(a, b, strict) {
  if (a === b) return true;
  if (!strict && isNullable(a) && isNullable(b)) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  if (!a || !b) return false;
  function check(test, then) {
    return test(a) ? test(b) ? then(a, b) : false : test(b) ? false : void 0;
  }
  return check(Array.isArray, (a2, b2) => a2.length === b2.length && a2.every((item, index) => deepEqual(item, b2[index]))) ?? check(is("Date"), (a2, b2) => a2.valueOf() === b2.valueOf()) ?? check(is("RegExp"), (a2, b2) => a2.source === b2.source && a2.flags === b2.flags) ?? check(isArrayBufferLike, (a2, b2) => {
    if (a2.byteLength !== b2.byteLength) return false;
    const viewA = new Uint8Array(a2);
    const viewB = new Uint8Array(b2);
    for (let i = 0; i < viewA.length; i++) if (viewA[i] !== viewB[i]) return false;
    return true;
  }) ?? Object.keys({
    ...a,
    ...b
  }).every((key) => deepEqual(a[key], b[key], strict));
}
var Time;
(function(Time2) {
  Time2.millisecond = 1;
  Time2.second = 1e3;
  Time2.minute = Time2.second * 60;
  Time2.hour = Time2.minute * 60;
  Time2.day = Time2.hour * 24;
  Time2.week = Time2.day * 7;
  let timezoneOffset = (/* @__PURE__ */ new Date()).getTimezoneOffset();
  function setTimezoneOffset(offset) {
    timezoneOffset = offset;
  }
  Time2.setTimezoneOffset = setTimezoneOffset;
  function getTimezoneOffset() {
    return timezoneOffset;
  }
  Time2.getTimezoneOffset = getTimezoneOffset;
  function getDateNumber(date2 = /* @__PURE__ */ new Date(), offset) {
    if (typeof date2 === "number") date2 = new Date(date2);
    if (offset === void 0) offset = timezoneOffset;
    return Math.floor((date2.valueOf() / Time2.minute - offset) / 1440);
  }
  Time2.getDateNumber = getDateNumber;
  function fromDateNumber(value, offset) {
    const date2 = new Date(value * Time2.day);
    if (offset === void 0) offset = timezoneOffset;
    return new Date(+date2 + offset * Time2.minute);
  }
  Time2.fromDateNumber = fromDateNumber;
  const numeric = /\d+(?:\.\d+)?/.source;
  const timeRegExp = new RegExp(`^${[
    "w(?:eek(?:s)?)?",
    "d(?:ay(?:s)?)?",
    "h(?:our(?:s)?)?",
    "m(?:in(?:ute)?(?:s)?)?",
    "s(?:ec(?:ond)?(?:s)?)?"
  ].map((unit) => `(${numeric}${unit})?`).join("")}$`);
  function parseTime(source) {
    const capture = timeRegExp.exec(source);
    if (!capture) return 0;
    return (parseFloat(capture[1]) * Time2.week || 0) + (parseFloat(capture[2]) * Time2.day || 0) + (parseFloat(capture[3]) * Time2.hour || 0) + (parseFloat(capture[4]) * Time2.minute || 0) + (parseFloat(capture[5]) * Time2.second || 0);
  }
  Time2.parseTime = parseTime;
  function parseDate(date2) {
    const parsed = parseTime(date2);
    if (parsed) date2 = Date.now() + parsed;
    else if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(date2)) date2 = `${(/* @__PURE__ */ new Date()).toLocaleDateString()}-${date2}`;
    else if (/^\d{1,2}-\d{1,2}-\d{1,2}(:\d{1,2}){1,2}$/.test(date2)) date2 = `${(/* @__PURE__ */ new Date()).getFullYear()}-${date2}`;
    return date2 ? new Date(date2) : /* @__PURE__ */ new Date();
  }
  Time2.parseDate = parseDate;
  function format(ms) {
    const abs = Math.abs(ms);
    if (abs >= Time2.day - Time2.hour / 2) return Math.round(ms / Time2.day) + "d";
    else if (abs >= Time2.hour - Time2.minute / 2) return Math.round(ms / Time2.hour) + "h";
    else if (abs >= Time2.minute - Time2.second / 2) return Math.round(ms / Time2.minute) + "m";
    else if (abs >= Time2.second) return Math.round(ms / Time2.second) + "s";
    return ms + "ms";
  }
  Time2.format = format;
  function toDigits(source, length = 2) {
    return source.toString().padStart(length, "0");
  }
  Time2.toDigits = toDigits;
  function template(template2, time = /* @__PURE__ */ new Date()) {
    return template2.replace("yyyy", time.getFullYear().toString()).replace("yy", time.getFullYear().toString().slice(2)).replace("MM", toDigits(time.getMonth() + 1)).replace("dd", toDigits(time.getDate())).replace("hh", toDigits(time.getHours())).replace("mm", toDigits(time.getMinutes())).replace("ss", toDigits(time.getSeconds())).replace("SSS", toDigits(time.getMilliseconds(), 3));
  }
  Time2.template = template;
})(Time || (Time = {}));

// node_modules/.pnpm/@deepseek-ai+dsh-llm@0.1.0-rc.6_@deepseek-ai+cordis@4.0.1_@deepseek-ai+dsh-attachment@0_4ed4e5c71eb965b0bd6912871e829940/node_modules/@deepseek-ai/dsh-llm/lib/index.js
import { createRequire } from "node:module";

// node_modules/.pnpm/@deepseek-ai+schemastery@3.18.1/node_modules/@deepseek-ai/schemastery/lib/index.mjs
var kSchema = /* @__PURE__ */ Symbol.for("schemastery");
var kValidationError = /* @__PURE__ */ Symbol.for("ValidationError");
globalThis.__schemastery_index__ ??= 0;
globalThis.__schemastery_refs__ = void 0;
var ValidationError = class extends TypeError {
  options;
  name = "ValidationError";
  constructor(message, options) {
    let prefix = "$";
    for (const segment of options.path || []) if (typeof segment === "string") prefix += "." + segment;
    else if (typeof segment === "number") prefix += "[" + segment + "]";
    else if (typeof segment === "symbol") prefix += `[Symbol(${segment.toString()})]`;
    if (prefix.startsWith(".")) prefix = prefix.slice(1);
    super((prefix === "$" ? "" : `${prefix} `) + message);
    this.options = options;
  }
  static is(error) {
    return !!error?.[kValidationError];
  }
};
Object.defineProperty(ValidationError.prototype, kValidationError, { value: true });
var Schema = function(options) {
  const schema = function(data, options2 = {}) {
    return Schema.resolve(data, schema, options2)[0];
  };
  if (options.refs) {
    const refs = mapValues(options.refs, (options2) => new Schema(options2));
    const getRef = (uid) => refs[uid];
    for (const key in refs) {
      const options2 = refs[key];
      options2.sKey = getRef(options2.sKey);
      options2.inner = getRef(options2.inner);
      options2.list = options2.list && options2.list.map(getRef);
      options2.dict = options2.dict && mapValues(options2.dict, getRef);
    }
    return refs[options.uid];
  }
  Object.assign(schema, options);
  if (typeof schema.callback === "string") try {
    schema.callback = new Function("return " + schema.callback)();
  } catch {
  }
  Object.defineProperty(schema, "uid", { value: globalThis.__schemastery_index__++ });
  Object.setPrototypeOf(schema, Schema.prototype);
  schema.meta ||= {};
  schema.toString = schema.toString.bind(schema);
  return schema;
};
Schema.prototype = Object.create(Function.prototype);
Schema.prototype[kSchema] = true;
Object.defineProperty(Schema.prototype, "~standard", { get() {
  return {
    version: 1,
    vendor: "schemastery",
    validate: (value) => {
      try {
        return { value: Schema.resolve(value, this, {})[0] };
      } catch (error) {
        if (ValidationError.is(error)) return { issues: [{
          message: error.message,
          path: error.options.path
        }] };
        throw error;
      }
    }
  };
} });
Schema.ValidationError = ValidationError;
Schema.prototype.toJSON = function toJSON() {
  if (globalThis.__schemastery_refs__) {
    globalThis.__schemastery_refs__[this.uid] ??= JSON.parse(JSON.stringify({ ...this }));
    return this.uid;
  }
  globalThis.__schemastery_refs__ = { [this.uid]: { ...this } };
  globalThis.__schemastery_refs__[this.uid] = JSON.parse(JSON.stringify({ ...this }));
  const result = {
    uid: this.uid,
    refs: globalThis.__schemastery_refs__
  };
  globalThis.__schemastery_refs__ = void 0;
  return result;
};
Schema.prototype.set = function set(key, value) {
  this.dict[key] = value;
  return this;
};
Schema.prototype.push = function push(value) {
  this.list.push(value);
  return this;
};
function mergeDesc(original, messages) {
  const result = typeof original === "string" ? { "": original } : { ...original };
  for (const locale in messages) {
    const value = messages[locale];
    if (value?.$description || value?.$desc) result[locale] = value.$description || value.$desc;
    else if (typeof value === "string") result[locale] = value;
  }
  return result;
}
function getInner(value) {
  return value?.$value ?? value?.$inner;
}
function extractKeys(data) {
  return filterKeys(data ?? {}, (key) => !key.startsWith("$"));
}
Schema.prototype.i18n = function i18n(messages) {
  const schema = Schema(this);
  const desc = mergeDesc(schema.meta.description, messages);
  if (Object.keys(desc).length) schema.meta.description = desc;
  if (schema.dict) schema.dict = mapValues(schema.dict, (inner, key) => {
    return inner.i18n(mapValues(messages, (data) => getInner(data)?.[key] ?? data?.[key]));
  });
  if (schema.list) schema.list = schema.list.map((inner, index) => {
    return inner.i18n(mapValues(messages, (data = {}) => {
      if (Array.isArray(getInner(data))) return getInner(data)[index];
      if (Array.isArray(data)) return data[index];
      return extractKeys(data);
    }));
  });
  if (schema.inner) schema.inner = schema.inner.i18n(mapValues(messages, (data) => {
    if (getInner(data)) return getInner(data);
    return extractKeys(data);
  }));
  if (schema.sKey) schema.sKey = schema.sKey.i18n(mapValues(messages, (data) => data?.$key));
  return schema;
};
Schema.prototype.extra = function extra(key, value) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    [key]: value
  };
  return schema;
};
for (const key of [
  "required",
  "disabled",
  "collapse",
  "hidden",
  "loose"
]) Object.assign(Schema.prototype, { [key](value = true) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    [key]: value
  };
  return schema;
} });
Schema.prototype.deprecated = function deprecated() {
  const schema = Schema(this);
  schema.meta.badges ||= [];
  schema.meta.badges.push({
    text: "deprecated",
    type: "danger"
  });
  return schema;
};
Schema.prototype.experimental = function experimental() {
  const schema = Schema(this);
  schema.meta.badges ||= [];
  schema.meta.badges.push({
    text: "experimental",
    type: "warning"
  });
  return schema;
};
Schema.prototype.pattern = function pattern(regexp) {
  const schema = Schema(this);
  const pattern2 = pick(regexp, ["source", "flags"]);
  schema.meta = {
    ...schema.meta,
    pattern: pattern2
  };
  return schema;
};
Schema.prototype.simplify = function simplify(value) {
  if (deepEqual(value, this.meta.default, this.type === "dict")) return null;
  if (isNullable(value)) return value;
  if (this.type === "object" || this.type === "dict") {
    const result = {};
    for (const key in value) {
      const item = (this.type === "object" ? this.dict[key] : this.inner)?.simplify(value[key]);
      if (this.type === "dict" || !isNullable(item)) result[key] = item;
    }
    if (deepEqual(result, this.meta.default, this.type === "dict")) return null;
    return result;
  } else if (this.type === "array" || this.type === "tuple") {
    const result = [];
    value.forEach((value2, index) => {
      const schema = this.type === "array" ? this.inner : this.list[index];
      const item = schema ? schema.simplify(value2) : value2;
      result.push(item);
    });
    return result;
  } else if (this.type === "intersect") {
    const result = {};
    for (const item of this.list) Object.assign(result, item.simplify(value));
    return result;
  } else if (this.type === "union") for (const schema of this.list) try {
    Schema.resolve(value, schema, {});
    return schema.simplify(value);
  } catch {
  }
  return value;
};
Schema.prototype.toString = function toString(inline) {
  return formatters[this.type]?.(this, inline) ?? `Schema<${this.type}>`;
};
Schema.prototype.role = function role(role, extra2) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    role,
    extra: extra2
  };
  return schema;
};
for (const key of [
  "default",
  "link",
  "comment",
  "description",
  "max",
  "min",
  "step"
]) Object.assign(Schema.prototype, { [key](value) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    [key]: value
  };
  return schema;
} });
var resolvers = {};
Schema.extend = function extend(type, resolve2) {
  resolvers[type] = resolve2;
};
Schema.resolve = function resolve(data, schema, options = {}, strict = false) {
  if (!schema) return [data];
  if (options.ignore?.(data, schema)) return [data];
  if (isNullable(data) && schema.type !== "lazy") {
    if (schema.meta.required) throw new ValidationError(`missing required value`, options);
    let current = schema;
    let fallback = schema.meta.default;
    while (current?.type === "intersect" && isNullable(fallback)) {
      current = current.list[0];
      fallback = current?.meta.default;
    }
    if (isNullable(fallback)) return [data];
    data = clone(fallback);
  }
  const callback = resolvers[schema.type];
  if (!callback) throw new ValidationError(`unsupported type "${schema.type}"`, options);
  try {
    return callback(data, schema, options, strict);
  } catch (error) {
    if (!schema.meta.loose) throw error;
    return [schema.meta.default];
  }
};
Schema.from = function from(source) {
  if (isNullable(source)) return Schema.any();
  else if ([
    "string",
    "number",
    "boolean"
  ].includes(typeof source)) return Schema.const(source).required();
  else if (source[kSchema]) return source;
  else if (typeof source === "function") switch (source) {
    case String:
      return Schema.string().required();
    case Number:
      return Schema.number().required();
    case Boolean:
      return Schema.boolean().required();
    case Function:
      return Schema.function().required();
    default:
      return Schema.is(source).required();
  }
  else throw new TypeError(`cannot infer schema from ${source}`);
};
Schema.lazy = function lazy(builder) {
  const toJSON2 = () => {
    if (!schema.inner[kSchema]) {
      schema.inner = schema.builder();
      schema.inner.meta = {
        ...schema.meta,
        ...schema.inner.meta
      };
    }
    return schema.inner.toJSON();
  };
  const schema = new Schema({
    type: "lazy",
    builder,
    inner: { toJSON: toJSON2 }
  });
  return schema;
};
Schema.natural = function natural() {
  return Schema.number().step(1).min(0);
};
Schema.percent = function percent() {
  return Schema.number().step(0.01).min(0).max(1).role("slider");
};
Schema.date = function date() {
  return Schema.union([Schema.is(Date), Schema.transform(Schema.string().role("datetime"), (value, options) => {
    const date2 = new Date(value);
    if (isNaN(+date2)) throw new ValidationError(`invalid date "${value}"`, options);
    return date2;
  }, true)]);
};
Schema.regExp = function regExp(flag = "") {
  return Schema.union([Schema.is(RegExp), Schema.transform(Schema.string().role("regexp", { flag }), (value, options) => {
    try {
      return new RegExp(value, flag);
    } catch (e) {
      throw new ValidationError(e.message, options);
    }
  }, true)]);
};
Schema.arrayBuffer = function arrayBuffer(encoding) {
  return Schema.union([
    Schema.is(ArrayBuffer),
    Schema.is(SharedArrayBuffer),
    Schema.transform(Schema.any(), (value, options) => {
      if (Binary.isSource(value)) return Binary.fromSource(value);
      throw new ValidationError(`expected ArrayBufferSource but got ${value}`, options);
    }, true),
    ...encoding ? [Schema.transform(Schema.string(), (value, options) => {
      try {
        return encoding === "base64" ? Binary.fromBase64(value) : Binary.fromHex(value);
      } catch (e) {
        throw new ValidationError(e.message, options);
      }
    }, true)] : []
  ]);
};
Schema.extend("lazy", (data, schema, options, strict) => {
  if (!schema.inner[kSchema]) {
    schema.inner = schema.builder();
    schema.inner.meta = {
      ...schema.meta,
      ...schema.inner.meta
    };
  }
  return Schema.resolve(data, schema.inner, options, strict);
});
Schema.extend("any", (data) => {
  return [data];
});
Schema.extend("never", (data, _, options) => {
  throw new ValidationError(`expected nullable but got ${data}`, options);
});
Schema.extend("const", (data, { value }, options) => {
  if (deepEqual(data, value)) return [value];
  throw new ValidationError(`expected ${value} but got ${data}`, options);
});
function checkWithinRange(data, meta, description, options, skipMin = false) {
  const { max = Infinity, min = -Infinity } = meta;
  if (data > max) throw new ValidationError(`expected ${description} <= ${max} but got ${data}`, options);
  if (data < min && !skipMin) throw new ValidationError(`expected ${description} >= ${min} but got ${data}`, options);
}
Schema.extend("string", (data, { meta }, options) => {
  if (typeof data !== "string") throw new ValidationError(`expected string but got ${data}`, options);
  if (meta.pattern) {
    const regexp = new RegExp(meta.pattern.source, meta.pattern.flags);
    if (!regexp.test(data)) throw new ValidationError(`expect string to match regexp ${regexp}`, options);
  }
  checkWithinRange(data.length, meta, "string length", options);
  return [data];
});
function decimalShift(data, digits) {
  const str = data.toString();
  if (str.includes("e")) return data * Math.pow(10, digits);
  const index = str.indexOf(".");
  if (index === -1) return data * Math.pow(10, digits);
  const frac = str.slice(index + 1);
  const integer = str.slice(0, index);
  if (frac.length <= digits) return +(integer + frac.padEnd(digits, "0"));
  return +(integer + frac.slice(0, digits) + "." + frac.slice(digits));
}
function isMultipleOf(data, min, step) {
  step = Math.abs(step);
  if (!/^\d+\.\d+$/.test(step.toString())) return (data - min) % step === 0;
  const index = step.toString().indexOf(".");
  const digits = step.toString().slice(index + 1).length;
  return Math.abs(decimalShift(data, digits) - decimalShift(min, digits)) % decimalShift(step, digits) === 0;
}
Schema.extend("number", (data, { meta }, options) => {
  if (typeof data !== "number") throw new ValidationError(`expected number but got ${data}`, options);
  checkWithinRange(data, meta, "number", options);
  const { step } = meta;
  if (step && !isMultipleOf(data, meta.min ?? 0, step)) throw new ValidationError(`expected number multiple of ${step} but got ${data}`, options);
  return [data];
});
Schema.extend("boolean", (data, _, options) => {
  if (typeof data === "boolean") return [data];
  throw new ValidationError(`expected boolean but got ${data}`, options);
});
Schema.extend("bitset", (data, { bits, meta }, options) => {
  let value = 0, keys = [];
  if (typeof data === "number") {
    value = data;
    for (const key in bits) if (data & bits[key]) keys.push(key);
  } else if (Array.isArray(data)) {
    keys = data;
    for (const key of keys) {
      if (typeof key !== "string") throw new ValidationError(`expected string but got ${key}`, options);
      if (key in bits) value |= bits[key];
    }
  } else throw new ValidationError(`expected number or array but got ${data}`, options);
  if (value === meta.default) return [value];
  return [value, keys];
});
Schema.extend("function", (data, _, options) => {
  if (typeof data === "function") return [data];
  throw new ValidationError(`expected function but got ${data}`, options);
});
Schema.extend("is", (data, { constructor }, options) => {
  if (typeof constructor === "function") {
    if (data instanceof constructor) return [data];
    throw new ValidationError(`expected ${constructor.name} but got ${data}`, options);
  } else {
    if (isNullable(data)) throw new ValidationError(`expected ${constructor} but got ${data}`, options);
    let prototype = Object.getPrototypeOf(data);
    while (prototype) {
      if (prototype.constructor?.name === constructor) return [data];
      prototype = Object.getPrototypeOf(prototype);
    }
    throw new ValidationError(`expected ${constructor} but got ${data}`, options);
  }
});
function property(data, key, schema, options) {
  try {
    const [value, adapted] = Schema.resolve(data[key], schema, {
      ...options,
      path: [...options.path || [], key]
    });
    if (adapted !== void 0) data[key] = adapted;
    return value;
  } catch (e) {
    if (!options?.autofix) throw e;
    delete data[key];
    return schema.meta.default;
  }
}
Schema.extend("array", (data, { inner, meta }, options) => {
  if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
  checkWithinRange(data.length, meta, "array length", options, !isNullable(inner.meta.default));
  return [data.map((_, index) => property(data, index, inner, options))];
});
Schema.extend("dict", (data, { inner, sKey }, options, strict) => {
  if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
  const result = {};
  for (const key in data) {
    let rKey;
    try {
      rKey = Schema.resolve(key, sKey, options)[0];
    } catch (error) {
      if (strict) continue;
      throw error;
    }
    result[rKey] = property(data, key, inner, options);
    data[rKey] = data[key];
    if (key !== rKey) delete data[key];
  }
  return [result];
});
Schema.extend("tuple", (data, { list }, options, strict) => {
  if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
  const result = list.map((inner, index) => property(data, index, inner, options));
  if (strict) return [result];
  result.push(...data.slice(list.length));
  return [result];
});
function merge(result, data) {
  for (const key in data) {
    if (key in result) continue;
    result[key] = data[key];
  }
}
Schema.extend("object", (data, { dict }, options, strict) => {
  if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
  const result = {};
  for (const key in dict) {
    const value = property(data, key, dict[key], options);
    if (!isNullable(value) || key in data) result[key] = value;
  }
  if (!strict) merge(result, data);
  return [result];
});
Schema.extend("union", (data, { list, toString: toString2 }, options, strict) => {
  const messages = [];
  for (const inner of list) try {
    return Schema.resolve(data, inner, options, strict);
  } catch (error) {
    messages.push(error);
  }
  throw new ValidationError(`expected ${toString2()} but got ${JSON.stringify(data)}`, options);
});
Schema.extend("intersect", (data, { list, toString: toString2 }, options, strict) => {
  if (!list.length) return [data];
  let result;
  for (const inner of list) {
    const value = Schema.resolve(data, inner, options, true)[0];
    if (isNullable(value)) continue;
    if (isNullable(result)) result = value;
    else if (typeof result !== typeof value) throw new ValidationError(`expected ${toString2()} but got ${JSON.stringify(data)}`, options);
    else if (typeof value === "object") merge(result ??= {}, value);
    else if (result !== value) throw new ValidationError(`expected ${toString2()} but got ${JSON.stringify(data)}`, options);
  }
  if (!strict && isPlainObject(data)) merge(result, data);
  return [result];
});
Schema.extend("transform", (data, { inner, callback, preserve }, options) => {
  const [result, adapted = data] = Schema.resolve(data, inner, options, true);
  if (preserve) return [callback(result)];
  else return [callback(result), callback(adapted)];
});
var formatters = {};
function defineMethod(name2, keys, format) {
  formatters[name2] = format;
  Object.assign(Schema, { [name2](...args) {
    const schema = new Schema({ type: name2 });
    keys.forEach((key, index) => {
      switch (key) {
        case "sKey":
          schema.sKey = args[index] ?? Schema.string();
          break;
        case "inner":
          schema.inner = Schema.from(args[index]);
          break;
        case "list":
          schema.list = args[index].map(Schema.from);
          break;
        case "dict":
          schema.dict = mapValues(args[index], Schema.from);
          break;
        case "bits":
          schema.bits = {};
          for (const key2 in args[index]) {
            if (typeof args[index][key2] !== "number") continue;
            schema.bits[key2] = args[index][key2];
          }
          break;
        case "callback": {
          const callback = schema.callback = args[index];
          callback["toJSON"] ||= () => callback.toString();
          break;
        }
        case "constructor": {
          const constructor = schema.constructor = args[index];
          if (typeof constructor === "function") constructor["toJSON"] ||= () => constructor["name"];
          break;
        }
        default:
          schema[key] = args[index];
      }
    });
    if (name2 === "object" || name2 === "dict") schema.meta.default = {};
    else if (name2 === "array" || name2 === "tuple") schema.meta.default = [];
    else if (name2 === "bitset") schema.meta.default = 0;
    return schema;
  } });
}
defineMethod("is", ["constructor"], ({ constructor }) => {
  if (typeof constructor === "function") return constructor.name;
  else return constructor;
});
defineMethod("any", [], () => "any");
defineMethod("never", [], () => "never");
defineMethod("const", ["value"], ({ value }) => typeof value === "string" ? JSON.stringify(value) : value);
defineMethod("string", [], () => "string");
defineMethod("number", [], () => "number");
defineMethod("boolean", [], () => "boolean");
defineMethod("bitset", ["bits"], () => "bitset");
defineMethod("function", [], () => "function");
defineMethod("array", ["inner"], ({ inner }) => `${inner.toString(true)}[]`);
defineMethod("dict", ["inner", "sKey"], ({ inner, sKey }) => `{ [key: ${sKey.toString()}]: ${inner.toString()} }`);
defineMethod("tuple", ["list"], ({ list }) => `[${list.map((inner) => inner.toString()).join(", ")}]`);
defineMethod("object", ["dict"], ({ dict }) => {
  if (Object.keys(dict).length === 0) return "{}";
  return `{ ${Object.entries(dict).map(([key, inner]) => {
    return `${key}${inner.meta.required ? "" : "?"}: ${inner.toString()}`;
  }).join(", ")} }`;
});
defineMethod("union", ["list"], ({ list }, inline) => {
  const result = list.map(({ toString: format }) => format()).join(" | ");
  return inline ? `(${result})` : result;
});
defineMethod("intersect", ["list"], ({ list }) => {
  return `${list.map((inner) => inner.toString(true)).join(" & ")}`;
});
defineMethod("transform", [
  "inner",
  "callback",
  "preserve"
], ({ inner }, isInner) => inner.toString(isInner));

// node_modules/.pnpm/@deepseek-ai+dsh-timeout@0.1.0-rc.6_@deepseek-ai+cordis@4.0.1_@deepseek-ai+dsh-invarian_8c173ab999b05cf1db05d479dd44e888/node_modules/@deepseek-ai/dsh-timeout/lib/index.js
var MAX_TIMER_DELAY_MS = 2147483647;

// node_modules/.pnpm/@deepseek-ai+dsh-llm@0.1.0-rc.6_@deepseek-ai+cordis@4.0.1_@deepseek-ai+dsh-attachment@0_4ed4e5c71eb965b0bd6912871e829940/node_modules/@deepseek-ai/dsh-llm/lib/index.js
var EMPTY_RESPONSE_CODE = "EMPTY_RESPONSE";
var STRUCTURED_CONTEXT_OVERFLOW = new RegExp(String.raw`(?:^|[^a-z0-9])context[\s_-](?:length|window)[\s_-]` + String.raw`(?:exceed(?:ed|s)?|overflow(?:ed)?|limit[\s_-]exceeded)(?:$|[^a-z0-9])`, "i");
var TOO_LARGE_FOR_CONTEXT = new RegExp(String.raw`\b(?:request|prompt|input|messages?)\s+(?:is\s+|are\s+)?` + String.raw`too\s+(?:large|long)\s+for\s+(?:(?:this|the)\s+)?` + String.raw`(?:model(?:'s)?\s+)?context(?:\s+window)?\b`, "i");
var EXCEEDS_MODEL_CONTEXT = new RegExp(String.raw`\b(?:input|prompt|request|messages?)\b.{0,40}` + String.raw`\b(?:exceed(?:s|ed)?|overflows?|is\s+larger\s+than)\b.{0,40}` + String.raw`\b(?:the\s+)?(?:model(?:'s)?\s+)?context(?:\s+(?:length|window))?\b`, "i");
var DEFAULT_MAX_RETRIES = 2;
var DEFAULT_INITIAL_DELAY_MS = 500;
var DEFAULT_MAX_DELAY_MS = 1e4;
var DEFAULT_JITTER_RATIO = 0.1;
var DEFAULT_RETRYABLE_CODES = Object.freeze([
  EMPTY_RESPONSE_CODE,
  "RATE_LIMIT",
  "SERVER",
  "TIMEOUT",
  "TRANSPORT"
]);
var backoffSchema = Schema.object({
  initialDelayMs: Schema.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_INITIAL_DELAY_MS),
  maxDelayMs: Schema.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_MAX_DELAY_MS),
  jitterRatio: Schema.number().min(0).max(1).default(DEFAULT_JITTER_RATIO)
});
var normalPolicySchema = Schema.object({
  mode: Schema.const("normal").required(),
  maxRetries: Schema.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_MAX_RETRIES),
  retryableCodes: Schema.array(Schema.string()).default([...DEFAULT_RETRYABLE_CODES]),
  backoff: backoffSchema
});
var alwaysPolicySchema = Schema.object({
  mode: Schema.const("always").required(),
  backoff: backoffSchema
});
var RetryPolicySchema = Schema.union([normalPolicySchema, alwaysPolicySchema]);
var { version } = createRequire(import.meta.url)("../package.json");

// node_modules/.pnpm/@deepseek-ai+dsh-session@0.1.0-rc.7_6fd26f59436a18b115f326d6060415e6/node_modules/@deepseek-ai/dsh-session/lib/index.js
function deriveEventMessage(event) {
  switch (event.type) {
    case "user/message":
      return event.data;
    case "assistant/message":
      if (event.data.message.content.length === 0) return null;
      return event.data.message;
    case "tool/result":
      return event.data.message;
    default:
      return null;
  }
}

// src/host/fold.ts
function trimToLastTurns(requests, maxTurns) {
  let runs = 0;
  let start = requests.length;
  let prevTurn;
  for (let i = requests.length - 1; i >= 0; i--) {
    const turn = requests[i].turn;
    if (turn !== prevTurn) {
      if (runs >= maxTurns) break;
      runs++;
      prevTurn = turn;
    }
    start = i;
  }
  return requests.slice(start);
}
function countTurnRuns(requests) {
  let runs = 0;
  let prevTurn;
  for (const r of requests) {
    if (r.turn !== prevTurn) {
      runs++;
      prevTurn = r.turn;
    }
  }
  return runs;
}
function trimState(st, bounds) {
  if (countTurnRuns(st.requests) > bounds.maxKeptTurns) {
    st.requests = trimToLastTurns(st.requests, bounds.maxKeptTurns);
  }
  if (st.requests.length > bounds.maxRequestSteps) {
    st.requests = st.requests.slice(-bounds.maxRequestSteps);
  }
  if (st.events.length > bounds.maxEvents) st.events = st.events.slice(-bounds.maxEvents);
  if (st.archived.length > 0) {
    let drop = 0;
    const oldestReq = st.requests.length > 0 ? st.requests[0].seq : void 0;
    if (oldestReq !== void 0) {
      while (drop < st.archived.length && (st.archived[drop].gone ?? Infinity) <= oldestReq) drop++;
    }
    if (st.archived.length - drop > bounds.maxArchiveNodes) {
      drop = st.archived.length - bounds.maxArchiveNodes;
    }
    if (drop > 0) {
      const floor = st.archived[drop - 1].gone;
      if (floor !== void 0) st.archiveFloor = Math.max(st.archiveFloor ?? 0, floor);
      st.archived = st.archived.slice(drop);
    }
  }
}
function createTimelineState() {
  return {
    surface: [],
    sums: { user: 0, inject: 0, assistant: 0, tool: 0 },
    systemTokens: 0,
    toolsTokens: 0,
    toolList: [],
    requests: [],
    events: [],
    archived: [],
    callNames: {}
  };
}
function categoryOf(type, message) {
  if (type === "assistant/message") return "assistant";
  if (type === "tool/result") return "tool";
  if (isInjection(message?.source)) return "inject";
  return "user";
}
function archiveRemoved(st, removed, goneSeq) {
  for (const n of removed) st.archived.push({ ...n, gone: goneSeq });
}
function applySurface(st, ev, type, data, message) {
  const cat = categoryOf(type, message ?? void 0);
  const node = {
    seq: ev.seq,
    time: ev.time,
    cat,
    // Empty assistant messages project to no model message (usage-only), so
    // they price 0 — `deriveEventMessage` returns null for that case, and
    // `estimateMessage(null, true)` short-circuits before ROLE_OVERHEAD.
    tokens: estimateMessage(message, type === "assistant/message")
  };
  const source = message?.source;
  const form = source?.form;
  if (typeof form === "string") node.form = form;
  if (type === "assistant/message") {
    const text = firstText(message?.content);
    if (text !== "") node.text = text;
    else {
      const names = toolCallNames(message?.content);
      if (names.length > 0) node.calls = names.slice(0, 3);
    }
  } else if (type === "tool/result") {
    const srcId = source?.callId;
    const srcName = typeof srcId === "string" ? st.callNames[srcId] : void 0;
    const block = message?.content?.[0];
    const blockId = block?.toolCallId;
    if (srcName) node.tool = srcName;
    else if (typeof blockId === "string") node.tool = st.callNames[blockId];
    if (data?.error) node.err = true;
  } else if (source?.kind === "skill-invocation") {
    node.skill = typeof source.name === "string" ? source.name : "?";
  } else if (source?.kind === "plugin") {
    if (source.form === "notice" && typeof source.summary === "string") node.text = source.summary;
    else if (source.form === "snapshot" && Array.isArray(source.sections)) {
      node.text = source.sections.map((s) => s?.name).filter(Boolean).join(", ").slice(0, 80);
    } else {
      const ptext = firstText(message?.content);
      if (ptext !== "") node.text = ptext;
    }
  } else {
    const utext = firstText(message?.content);
    if (utext !== "") node.text = utext;
  }
  const shadowedSeqs = st.pendingShadowedSeqs;
  delete st.pendingShadowedSeqs;
  const op = ev.surfaceOp;
  if (op !== null && typeof op === "object" && op.op === "replace") {
    if (Array.isArray(shadowedSeqs) && shadowedSeqs.length > 0) {
      const shadowed = new Set(shadowedSeqs);
      const kept = [];
      const removed = [];
      for (const n of st.surface) {
        if (shadowed.has(n.seq)) {
          st.sums[n.cat] -= n.tokens;
          removed.push(n);
        } else kept.push(n);
      }
      archiveRemoved(st, removed, ev.seq);
      st.surface = kept;
      st.sums[cat] += node.tokens;
      st.surface.push(node);
      return node;
    }
    let si = -1;
    let ei = -1;
    for (let i = 0; i < st.surface.length; i++) {
      if (si < 0 && st.surface[i].seq === op.start) si = i;
      if (st.surface[i].seq === op.end) {
        ei = i;
        break;
      }
    }
    if (si >= 0 && ei >= si) {
      const removed = st.surface.splice(si, ei - si + 1, node);
      archiveRemoved(st, removed, ev.seq);
      for (const r of removed) st.sums[r.cat] -= r.tokens;
      st.sums[cat] += node.tokens;
      return node;
    }
  }
  st.surface.push(node);
  st.sums[cat] += node.tokens;
  return node;
}
function applyTimeline(state, event, bounds) {
  let st;
  const ensure = () => st ??= {
    ...state,
    surface: [...state.surface],
    sums: { ...state.sums },
    toolList: [...state.toolList],
    requests: [...state.requests],
    events: [...state.events],
    archived: [...state.archived],
    callNames: { ...state.callNames }
  };
  const data = event.data;
  switch (event.type) {
    case "request/header": {
      const header = data?.header ?? {};
      const tools = Array.isArray(header.tools) ? header.tools : [];
      const s = ensure();
      s.toolList = tools.map((t) => ({
        name: typeof t.name === "string" ? t.name : "?",
        tokens: estimateToolSchema(t)
      }));
      s.toolsTokens = estimateToolsTotal(tools);
      s.systemTokens = estimateSystem(header.system);
      if (header.config && typeof header.config.model === "string") s.model = header.config.model;
      if (header.config && typeof header.config.provider === "string") s.provider = header.config.provider;
      if (data?.reason === "change" && s.model && s.lastModel && s.model !== s.lastModel) {
        s.events.push({ seq: event.seq, time: event.time, kind: "model", from: s.lastModel, to: s.model });
      }
      if (s.model) s.lastModel = s.model;
      break;
    }
    case "request/context": {
      const s = ensure();
      if (data && typeof data.contextWindow === "number") s.contextWindow = data.contextWindow;
      if (data && typeof data.model === "string") s.model = data.model;
      if (data && typeof data.provider === "string") s.provider = data.provider;
      break;
    }
    case "tool/call": {
      if (data && data.callId !== void 0 && typeof data.name === "string") {
        const s = ensure();
        s.callNames[String(data.callId)] = data.name;
      }
      break;
    }
    case "user/message": {
      const msg = deriveEventMessage(event);
      const s = ensure();
      const node = applySurface(s, event, event.type, data, msg);
      const source = msg?.source;
      if (isInjection(source)) {
        const rec = {
          seq: event.seq,
          time: event.time,
          kind: "inject",
          form: source.form || "context",
          tokens: node.tokens
        };
        if (source.kind === "skill-invocation") {
          rec.sub = "skill";
          rec.name = typeof source.name === "string" ? source.name : "?";
        } else if (typeof source.plugin === "string" && source.plugin !== "") {
          rec.name = source.plugin;
        }
        s.events.push(rec);
      }
      break;
    }
    case "tool/result": {
      const toolMsg = deriveEventMessage(event);
      const s = ensure();
      applySurface(s, event, event.type, data, toolMsg);
      break;
    }
    case "assistant/message": {
      const usage = data?.usage;
      const s = ensure();
      const total = s.systemTokens + s.toolsTokens + s.sums.user + s.sums.inject + s.sums.assistant + s.sums.tool;
      const record = {
        ...(data && typeof data.turn === "number" ? { turn: data.turn } : {}),
        ...(data && typeof data.step === "number" ? { step: data.step } : {}),
        time: event.time,
        seq: event.seq,
        system: s.systemTokens,
        tools: s.toolsTokens,
        user: s.sums.user,
        inject: s.sums.inject,
        assistant: s.sums.assistant,
        tool: s.sums.tool,
        total
      };
      if (usage && typeof usage.inputTokens === "number") {
        record.prompt = usage.inputTokens + (usage.cacheReadTokens || 0) + (usage.cacheWriteTokens || 0);
        if (typeof usage.outputTokens === "number") record.output = usage.outputTokens;
      }
      s.requests.push(record);
      const asstMsg = deriveEventMessage(event);
      applySurface(s, event, event.type, data, asstMsg);
      break;
    }
    case "compaction/summary":
    case "compaction/prune": {
      const s = ensure();
      if (data && Array.isArray(data.shadowedSeqs)) {
        s.pendingShadowedSeqs = data.shadowedSeqs.filter((x) => typeof x === "number");
      }
      s.events.push({
        seq: event.seq,
        time: event.time,
        kind: event.type === "compaction/summary" ? "compaction" : "prune",
        tokens: data && typeof data.shadowedTokenCount === "number" ? data.shadowedTokenCount : 0,
        ...event.type === "compaction/summary" && data && Array.isArray(data.shadowedSeqs) ? { count: data.shadowedSeqs.length } : {}
      });
      break;
    }
    default:
      return state;
  }
  if (st !== void 0) {
    trimState(st, bounds);
    return st;
  }
  return state;
}
function buildTimelineView(state, bounds) {
  const surfaceTotal = state.sums.user + state.sums.inject + state.sums.assistant + state.sums.tool;
  const result = {
    ok: true,
    model: state.model,
    provider: state.provider,
    contextWindow: state.contextWindow,
    current: {
      system: state.systemTokens,
      tools: state.toolsTokens,
      user: state.sums.user,
      inject: state.sums.inject,
      assistant: state.sums.assistant,
      tool: state.sums.tool,
      total: surfaceTotal + state.systemTokens + state.toolsTokens
    },
    toolList: state.toolList,
    requests: state.requests.map((r) => ({ ...r })),
    events: state.events.map((e) => ({ ...e })),
    nodes: [],
    droppedNodes: 0,
    archive: state.archived.map((n) => ({ ...n }))
  };
  const overflowCount = Math.max(0, state.surface.length - bounds.maxNodes);
  const overflow = state.surface.slice(0, overflowCount);
  const tail = state.surface.slice(overflowCount);
  const pinned = overflow.filter((n) => n.cat === "inject");
  result.nodes = pinned.length > 0 ? [...pinned, ...tail] : tail;
  result.droppedNodes = overflowCount - pinned.length;
  if (result.droppedNodes > 0) {
    let floor = 0;
    for (const n of overflow) if (n.cat !== "inject") floor = Math.max(floor, n.seq);
    result.surfaceFloor = floor;
  }
  if (state.archiveFloor !== void 0) result.archiveFloor = state.archiveFloor;
  const requests = result.requests;
  const events = result.events;
  let ri = 0;
  for (const ev of events) {
    while (ri < requests.length && requests[ri].seq <= ev.seq) ri++;
    const next = requests[ri];
    const prev = ri > 0 ? requests[ri - 1] : void 0;
    if (next !== void 0 && typeof next.turn === "number" && typeof next.step === "number") {
      ev.turn = next.turn;
      ev.step = next.step;
    }
    if (prev !== void 0 && typeof prev.turn === "number" && typeof prev.step === "number") {
      ev.fromTurn = prev.turn;
      ev.fromStep = prev.step;
    }
  }
  return result;
}

// src/host/timeline.ts
var surfaceNodeSchema = z3.object({
  seq: z3.number().int().nonnegative(),
  time: z3.number().optional(),
  cat: z3.enum(["user", "inject", "assistant", "tool"]),
  tokens: z3.number().int().nonnegative(),
  gone: z3.number().int().nonnegative().optional(),
  form: z3.string().optional(),
  text: z3.string().optional(),
  tool: z3.string().optional(),
  err: z3.boolean().optional(),
  skill: z3.string().optional(),
  calls: z3.array(z3.string()).optional()
}).strict();
var requestRecordSchema = z3.object({
  turn: z3.number().optional(),
  step: z3.number().optional(),
  time: z3.number(),
  seq: z3.number(),
  system: z3.number().int().nonnegative(),
  tools: z3.number().int().nonnegative(),
  user: z3.number().int().nonnegative(),
  inject: z3.number().int().nonnegative(),
  assistant: z3.number().int().nonnegative(),
  tool: z3.number().int().nonnegative(),
  total: z3.number().int().nonnegative(),
  prompt: z3.number().int().nonnegative().optional(),
  output: z3.number().int().nonnegative().optional(),
  stepCount: z3.number().int().positive().optional()
}).strict();
var contextEventSchema = z3.object({
  seq: z3.number(),
  time: z3.number(),
  kind: z3.enum(["compaction", "prune", "inject", "model"]),
  form: z3.string().optional(),
  tokens: z3.number().optional(),
  count: z3.number().optional(),
  sub: z3.string().optional(),
  name: z3.string().optional(),
  from: z3.string().optional(),
  to: z3.string().optional(),
  fromTurn: z3.number().optional(),
  fromStep: z3.number().optional(),
  turn: z3.number().optional(),
  step: z3.number().optional()
}).strict();
var currentSchema = z3.object({
  system: z3.number().int().nonnegative(),
  tools: z3.number().int().nonnegative(),
  user: z3.number().int().nonnegative(),
  inject: z3.number().int().nonnegative(),
  assistant: z3.number().int().nonnegative(),
  tool: z3.number().int().nonnegative(),
  total: z3.number().int().nonnegative()
}).strict();
var contextTimelineSchema = z3.object({
  ok: z3.literal(true),
  model: z3.string().optional(),
  provider: z3.string().optional(),
  contextWindow: z3.number().optional(),
  current: currentSchema,
  toolList: z3.array(z3.object({ name: z3.string(), tokens: z3.number().int().nonnegative() }).strict()),
  requests: z3.array(requestRecordSchema),
  events: z3.array(contextEventSchema),
  nodes: z3.array(surfaceNodeSchema),
  droppedNodes: z3.number().int().nonnegative(),
  archive: z3.array(surfaceNodeSchema),
  surfaceFloor: z3.number().int().nonnegative().optional(),
  archiveFloor: z3.number().int().nonnegative().optional()
}).strict();
function createContextTimelineDefinition(config) {
  const bounds = resolveBounds(config);
  return {
    key: "contextTimeline",
    schema: contextTimelineSchema,
    init: () => createTimelineState(),
    apply: (state, event) => applyTimeline(state, event, bounds),
    view: (state) => buildTimelineView(state, bounds),
    // 2 since 0.11: the occupancy mirror (pressureTokens/sampledSurfaceTokens/
    // occupancyWindow) left the persisted state — the client now reads the
    // official token-meter `contextPressure` projection instead. Old cached
    // rows are discarded and refolded.
    // 3 since 0.12: the removed-node archive (`archived` + `archiveFloor`)
    // joined the persisted state for the Context browser's per-step
    // reconstruction — cached rows predate the shape and are refolded.
    stateVersion: 3
  };
}

// src/host/index.ts
var name = "dsh-context";
var inject = ["sessionProjections"];
function apply(ctx, config) {
  ctx.sessionProjections.register(createContextTimelineDefinition(config));
  ctx.sessionProjections.register(createContextHeadersDefinition());
}
export {
  Config,
  apply,
  inject,
  name
};
