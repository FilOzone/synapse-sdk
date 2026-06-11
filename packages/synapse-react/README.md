# Synapse React

[![NPM](https://nodei.co/npm/@filoz/synapse-react.svg?style=flat&data=n,v&color=blue)](https://nodei.co/npm/@filoz/synapse-react/)

> A React hooks for interacting with Filecoin Onchain Cloud smart contracts

## Overview

Synapse React provides React hooks for building Filecoin Onchain Cloud applications with wagmi, viem, and TanStack Query. It wraps common Synapse storage and payment flows so React apps can query contract state, manage payment balances and operator approvals, discover Warm Storage providers, create data sets, and upload or delete pieces.

Use this package when you want wallet-connected React components to interact with Synapse without wiring contract reads, writes, transaction receipts, and query invalidation by hand. For lower-level control outside React, use `@filoz/synapse-sdk` directly.

## Installation

```bash
pnpm install @filoz/synapse-react wagmi@3.x @tanstack/react-query@5.x viem@2.x
```

## Docs

Check the documentation [website](https://synapse.filecoin.services/)

## Contributing

Read contributing  [guidelines](../../.github/CONTRIBUTING.md).

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/FilOzone/synapse-sdk)

## License

Dual-licensed: [MIT](../../LICENSE.md), [Apache Software License v2](../../LICENSE.md) by way of the
[Permissive License Stack](https://protocol.ai/blog/announcing-the-permissive-license-stack/).
