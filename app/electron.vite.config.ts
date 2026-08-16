import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'main/index.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'preload/index.ts')
        },
        output: {
          // Deterministic ESM preload filename (project is "type": "module").
          // Must match the path referenced in main/index.ts.
          format: 'es',
          entryFileNames: '[name].mjs'
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'renderer'),
    server: {
      // 2026-08 重构：dev 前端固定 127.0.0.1——与引擎 gateway 同站
      // （SameSite=Lax 的 session/csrf cookie 才能跨端口携带；
      // localhost:5173 与 127.0.0.1:19188 是跨站，cookie 会被浏览器拒绝）
      host: '127.0.0.1',
      port: 5173
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'renderer/index.html')
        }
      }
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'renderer/src')
      }
    }
  }
})
