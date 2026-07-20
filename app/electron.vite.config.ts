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
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'renderer'),
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
