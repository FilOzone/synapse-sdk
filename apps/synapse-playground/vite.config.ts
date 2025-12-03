import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig } from 'vite'
import { analyzer } from 'vite-bundle-analyzer'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    nodePolyfills({
      include: ['buffer'],
      globals: {
        Buffer: true,
      },
    }),
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
