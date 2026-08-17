import { defineConfig } from 'electron-vite'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    root: 'desktop',
    build: {
      // outDir 相对 section root 解析，显式指到项目根的 out/
      outDir: resolve('out/main'),
      lib: { entry: 'main/index.ts' },
      rollupOptions: { external: ['electron', 'semver', 'electron-updater', 'node-pty'] },
    },
    resolve: {
      alias: { '@shared': resolve('desktop/shared') },
    },
  },
  preload: {
    root: 'desktop',
    build: {
      outDir: resolve('out/preload'),
      lib: { entry: 'preload/index.ts' },
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
