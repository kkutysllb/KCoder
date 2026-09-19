/** Strict Typert codecs shared by the Host and browser contribution artifacts.
 *
 * 双字段兼容（2026-09-19，dsh 0.1.6-alpha.2 适配）：alpha.2 的 typert-loader
 * 要求 strict codec 以 create() 工厂懒物化 schema（无 create 过不了注册
 * 校验，且失败连带撤回该 fiber 全部远端定义）；rc/alpha.1 时代的运行时
 * 读饿汉 schema 字段。两代并存期同时提供：新运行时取 create，旧的取
 * schema。对象以 const 持有（非新鲜字面量），旧类型系统不做多余属性
 * 检查，编译两侧兼容。
 */
import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol';
export declare const PACKAGE_NAME = "dsh-file-review-kcoder";
export declare const FILE_REVIEW_INVOCATIONS: readonly InvocationDescriptor[];
//# sourceMappingURL=typert-descriptors.d.ts.map