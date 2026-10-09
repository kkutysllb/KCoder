import { defineConfig } from 'electron-vite'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    root: 'desktop',
    build: {
      // outDir 相对 section root 解析，显式指到项目根的 out/
      outDir: resolve('out/main'),
      lib: { entry: 'main/index.ts' },
      // node-pty 曾随宿主终端面板 external；面板与其后的内置终端插件均已退役
      // （2026-10-09），依赖、external、asarUnpack 三处同批摘除。
      rollupOptions: { external: ['electron', 'semver', 'electron-updater'] },
    },
    resolve: {
      alias: { '@shared': resolve('desktop/shared') },
    },
  },
  preload: {
    root: 'desktop',
    build: {
      outDir: resolve('out/preload'),
      // index：壳应用桥（landing/面板）；host-paths：引擎 shell 页的单桥
      // （__DSH_HOST_PATHS__，拖/粘文件转 @路径）。两份互不相挂。
      lib: { entry: { index: 'preload/index.ts', 'host-paths': 'preload/host-paths.ts' } },
      rollupOptions: { external: ['electron'] },
    },
    resolve: {
      alias: { '@shared': resolve('desktop/shared') },
    },
  },
  renderer: {
    root: 'desktop/renderer',
    build: {
      outDir: resolve('out/renderer'),
      rollupOptions: { input: resolve('desktop/renderer/index.html') },
    },
    resolve: {
      alias: { '@shared': resolve('desktop/shared') },
    },
  },
})
