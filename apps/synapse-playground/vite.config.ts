import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import tsconfigPaths from 'vite-tsconfig-paths'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    tsconfigPaths(),
    nodePolyfills({
      include: ['buffer'],
      globals: {
        Buffer: true,
      },
    }),
    react(),
    tailwindcss(),
  ],
  optimizeDeps: {
    exclude: ['@filoz/synapse-core', '@filoz/synapse-react'],
  },
  resolve: {
    dedupe: ['react', 'react-dom', 'wagmi'],
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
