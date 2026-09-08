export declare const RUNTIME_SANDBOX_RELATIVE_PATH: string
export declare function applyRuntimeSandboxHotfix(runtimeRoot: string): {
  status: 'applied' | 'already-applied' | 'already-fixed' | 'skipped'
  file: string
  reason?: string
}
