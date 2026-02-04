---
title: Devnet Configuration
description: Configure Synapse SDK for local development
sidebar:
  order: 10
---

The Synapse SDK supports local development networks in addition to mainnet and calibration.

## Network Support

| Network | Chain ID | Auto-Discovery |
| --------- | ---------- | ---------------- |
| mainnet | 314 | Yes |
| calibration | 314159 | Yes |
| devnet | 31415926 | No |

For **mainnet** and **calibration**, contract addresses are auto-discovered. For **devnet**, you must provide addresses explicitly.

## Required Options

When connecting to a devnet, provide these options:

```ts
import { Synapse } from '@filoz/synapse-sdk'

const synapse = await Synapse.create({
  privateKey: process.env.PRIVATE_KEY,
  rpcURL: process.env.RPC_URL,
  warmStorageAddress: process.env.WARM_STORAGE_ADDRESS,
  multicall3Address: process.env.MULTICALL3_ADDRESS,
  // Optional: override USDFC token address
  usdfcAddress: process.env.USDFC_ADDRESS,
})
```

All other contract addresses (Payments, PDPVerifier, ServiceProviderRegistry, SessionKeyRegistry) are discovered automatically from `warmStorageAddress`.

## Local Development

For local development and integration testing, see [foc-localnet](https://github.com/FilOzone/foc-localnet) which provides a complete local Filecoin network with all FOC contracts deployed.
