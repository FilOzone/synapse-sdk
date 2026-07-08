---
title: RPC Endpoints
description: Best practices for using external RPC endpoints and avoiding rate limits.
sidebar:
  order: 3
---

Synapse SDK reads on-chain state while it prepares payments, finds or creates data sets, resolves providers, and inspects piece metadata. For accounts with many data sets or pieces, those reads can exceed the rate limits of public RPC endpoints.

For production apps, bulk uploads, migrations, and dashboards, use a dedicated RPC endpoint with higher limits and enable batching in the viem client that you pass to Synapse.

## Recommended setup

Create a viem client yourself, configure its transport, and pass that client to `Synapse`. This gives you access to viem's HTTP batching, request headers, and multicall batching options.

```ts twoslash
import { Synapse, calibration } from '@filoz/synapse-sdk'
import { createClient, http, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

// GLIF accepts authenticated RPC tokens in the URL query string.
const rpcUrl = 'https://api.calibration.node.glif.io/rpc/v1?token=YOUR_TOKEN'
const privateKey = '0x0000000000000000000000000000000000000000000000000000000000000001'

const client = createClient({
  account: privateKeyToAccount(privateKey as Hex),
  chain: calibration,
  transport: http(rpcUrl, {
    batch: true,
  }),
  batch: {
    multicall: true,
  },
})

const synapse = new Synapse({
  client,
  source: 'my-app',
})
```

This setup enables two different batching layers:

- `transport: http(url, { batch: true })` batches multiple JSON-RPC requests into one HTTP request when the RPC provider supports JSON-RPC batch requests.
- `batch: { multicall: true }` lets viem aggregate compatible `eth_call` contract reads through Multicall3.

These settings reduce request count, but they do not remove the need for an endpoint with enough capacity for high-volume accounts.

## Authenticated endpoints

Most RPC providers offer authenticated endpoints with higher limits than public URLs. Prefer a token-authenticated endpoint for production and migration workloads. The Filecoin Docs maintain a list of commonly used [Filecoin RPC endpoints](https://docs.filecoin.io/networks-and-tools/networks/mainnet/rpcs).

GLIF accepts RPC tokens in the URL query string. Pass the authenticated URL directly to `http()`:

```ts twoslash
import { Synapse, calibration } from '@filoz/synapse-sdk'
import { createClient, http, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const privateKey = '0x0000000000000000000000000000000000000000000000000000000000000001'

const client = createClient({
  account: privateKeyToAccount(privateKey as Hex),
  chain: calibration,
  transport: http('https://api.calibration.node.glif.io/rpc/v1?token=YOUR_TOKEN', {
    batch: true,
  }),
  batch: { multicall: true },
})

const synapse = new Synapse({ client, source: 'my-app' })
```

GLIF also accepts the same token in an `Authorization: Bearer` header. Configure `fetchOptions.headers` on the viem HTTP transport:

```ts twoslash
import { Synapse, calibration } from '@filoz/synapse-sdk'
import { createClient, http, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const privateKey = '0x0000000000000000000000000000000000000000000000000000000000000001'

const client = createClient({
  account: privateKeyToAccount(privateKey as Hex),
  chain: calibration,
  transport: http('https://api.calibration.node.glif.io/rpc/v1', {
    batch: true,
    fetchOptions: {
      headers: {
        Authorization: 'Bearer YOUR_TOKEN',
      },
    },
  }),
  batch: { multicall: true },
})

const synapse = new Synapse({ client, source: 'my-app' })
```

For other RPC providers, check the provider's documentation for the exact authentication format and whether JSON-RPC batch requests are supported.

## When public endpoints are not enough

Public endpoints are useful for examples and small tests, but ordinary production usage can outgrow them quickly:

| Workflow | Why it can create many RPC reads |
| --------- | -------------------------------- |
| Listing data sets | The SDK reads data set IDs and enriches them with on-chain metadata. |
| Inspecting a large data set | Piece metadata reads scale with the number of pieces in the data set. |
| Uploading to an account with existing data sets | The SDK resolves reusable data sets before creating new ones. |
| Dashboards and migrations | Repeated listing, filtering, and inspection can multiply reads across many data sets. |

For these workflows, use an authenticated endpoint, avoid tight polling loops, and cache known data set IDs or piece information when your application can tolerate cached state.

## Storage workflow tips

Use the SDK's data set reuse behavior deliberately:

- Set a stable `source` value for your application so the SDK can isolate and reuse your app's data sets.
- Use consistent data set metadata for content that should share a data set.
- If you already know the target provider or data set, pass explicit options such as `providerId` or `dataSetId` to avoid broad discovery.
- For bulk uploads, keep one configured `Synapse` instance and reuse it instead of repeatedly creating new clients in a loop.

These choices do not replace a properly provisioned RPC endpoint, but they reduce unnecessary discovery reads.
