import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    // Bundle `music-metadata` directly into `out/main/index.js` so packaged builds
    // do not depend on shipping ESM transitive packages from `node_modules` inside `app.asar`.
    plugins: [externalizeDepsPlugin({ exclude: ['music-metadata'] })]
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          floatingPlayer: resolve('src/preload/floatingPlayer.ts')
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer')
      }
    },
    plugins: [tailwindcss(), react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          floatingPlayer: resolve('src/renderer/floating-player.html')
        }
      }
    }
  }
})
