import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Mismo origen que el gateway: la cookie del refresh token (Secure, SameSite=Strict)
    // funciona en localhost sin CORS
    proxy: {
      '/api': 'http://localhost',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    css: false,
  },
})
