# Synapse Core

[![NPM](https://nodei.co/npm/@filoz/synapse-core.svg?style=flat&data=n,v&color=blue)](https://nodei.co/npm/@filoz/synapse-core/)

> A JavaScript/TypeScript standard library for interacting with Filecoin Onchain Cloud smart contracts

## Overview

`@filoz/synapse-core` is the low-level protocol package for building on Filecoin Onchain Cloud. It provides typed, composable JavaScript and TypeScript utilities for directly using FOC smart contracts, storage provider HTTP APIs, EIP-712 signing flows, and Filecoin-specific data formats.

The package is designed for developers who need finer control than the high-level `@filoz/synapse-sdk` API. Its modules are organized around protocol boundaries, including Filecoin Pay payment rails, PDP verification, warm storage, service provider discovery, session keys, typed-data signing, PieceCID utilities, devnet helpers, and test mocks.

Most contract helpers follow viem's action style: single-purpose functions that accept a viem client and return strongly typed results. You can import only the protocol area you need, compose actions with viem primitives such as `multicall` and `simulateContract`, or use the package as a foundation for higher-level storage workflows.

## Installation

```bash
pnpm install @filoz/synapse-core viem@2.x
```

Note: `viem` is a peer dependency and must be installed separately.

## Docs

Check the documentation [website](https://synapse.filecoin.services/)

## Contributing

Read contributing  [guidelines](../../.github/CONTRIBUTING.md).

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/FilOzone/synapse-sdk)

## License

Dual-licensed: [MIT](../../LICENSE.md), [Apache Software License v2](../../LICENSE.md) by way of the
[Permissive License Stack](https://protocol.ai/blog/announcing-the-permissive-license-stack/).
