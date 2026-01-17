import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // This allows local development to route /api calls 
    // effectively mimicking Cloudflare Functions
    proxy: {
      '/api': {
        target: 'http://localhost:3000', // Placeholder
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  }
})