import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/apewisdom': {
        target: 'https://apewisdom.io',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api\/apewisdom/, ''),
      },
    },
  },
  build: {
    outDir: 'dist',
  },
})