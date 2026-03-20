import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
    server: {
        port: 3001,
        open: true,
        proxy: {
            '/api': {
                target: 'http://localhost:3000',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api/, ''),
            },
        },
    },
    build: {
        rollupOptions: {
            input: {
                main: resolve(__dirname, 'index.html'),
                docs: resolve(__dirname, 'docs/index.html'),
                portal: resolve(__dirname, 'portal/index.html'),
                coinbase: resolve(__dirname, 'coinbase/index.html'),
                paypal: resolve(__dirname, 'paypal/index.html'),
                wirex: resolve(__dirname, 'wirex/index.html'),
                cypher: resolve(__dirname, 'cypher/index.html'),
                miniapp: resolve(__dirname, 'miniapp/index.html'),
            },
        },
    },
})
