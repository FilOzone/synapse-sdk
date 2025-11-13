import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig } from 'vite'
import { analyzer } from 'vite-bundle-analyzer'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    analyzer({
      enabled: false,
    }),
  ],
  resolve: {
    dedupe: ['react', 'react-dom', 'wagmi'],
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
