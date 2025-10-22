import { calibration, mainnet } from '@filoz/synapse-core/chains'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { persistQueryClient } from '@tanstack/react-query-persist-client'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createConfig, deserialize, http, serialize, WagmiProvider } from 'wagmi'

import { injected } from 'wagmi/connectors'
import { App } from './app.tsx'
import { ThemeProvider } from './components/theme-provider.tsx'

import './style.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // experimental_prefetchInRender: true,
      gcTime: 1000 * 60 * 60 * 24, // 24 hours
      // staleTime: 1000 * 60 * 60 * 24, // 24 hours
      networkMode: 'offlineFirst',
      retry: false,
    },
  },
})

const localStoragePersister = createSyncStoragePersister({
  storage: window.localStorage,
  key: 'synapse-playground-cache',
  serialize,
  deserialize,
})

persistQueryClient({
  queryClient,
  persister: localStoragePersister,
})

// const asyncStoragePersister = createAsyncStoragePersister({
//   storage: window.localStorage,
// })

export const config = createConfig({
  chains: [mainnet, calibration],
  connectors: [injected()],
  transports: {
    [mainnet.id]: http(),
    [calibration.id]: http(undefined, {
      batch: true,
    }),
  },
  batch: {
    multicall: false,
  },
})

declare module 'wagmi' {
  interface Register {
    config: typeof config
  }
}

// biome-ignore lint/style/noNonNullAssertion: react
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider storageKey="synapse-theme">
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={config}>
          <App />
        </WagmiProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>
)
