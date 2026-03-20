import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  root: resolve(__dirname),
  server: {
    port: 3002,
    proxy: {
      '/api/stripe-beta': {
        target: 'https://api.asgcard.dev',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        approve: resolve(__dirname, 'approve/index.html'),
      },
    },
  },
})
