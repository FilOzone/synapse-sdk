# Synapse SDK

[![NPM](https://nodei.co/npm/@filoz/synapse-sdk.svg?style=flat&data=n,v&color=blue)](https://nodei.co/npm/@filoz/synapse-sdk/)

A JavaScript/TypeScript SDK for interacting with Filecoin Synapse - a smart-contract based marketplace for storage and other services in the Filecoin ecosystem.

> ⚠️ **BREAKING CHANGES in v0.24.0**: Major updates have been introduced:
>
> - **Terminology**: **Pandora** is now **Warm Storage**, **Proof Sets** are now **Data Sets**, **Roots** are now **Pieces** and **Storage Providers** are now **Service Providers**
> - **Storage API**: Improved with a new context-based architecture
> - **PaymentsService**: Method signatures updated for consistency - `token` parameter is now always last and defaults to USDFC
>
> See the [Migration Guide](#migration-guide) for detailed migration instructions.

## Overview

The Synapse SDK provides an interface to Filecoin's decentralized services ecosystem:

- **🚀 Recommended Usage**: Use the high-level `Synapse` class for a streamlined experience with sensible defaults
- **🔧 Composable Components**: Import and use individual components for fine-grained control over specific functionality

The SDK handles all the complexity of blockchain interactions, provider selection, and data management, so you can focus on building your application.

### Key Concepts

- **Service Contracts**: Smart contracts that manage specific services (like storage). Currently, **Warm Storage** is the primary service contract that handles storage operations and payment validation.
- **Payment Rails**: Automated payment streams between clients and service providers, managed by the Payments contract. When you create a data set in Warm Storage, it automatically creates corresponding payment rails.
- **Data Sets**: Collections of stored data managed by Warm Storage. Each data set has an associated payment rail that handles the ongoing storage payments.
- **Pieces**: Individual units of data identified by PieceCID (content-addressed identifiers). Multiple pieces can be added to a data set for storage.
- **PDP (Proof of Data Possession)**: The cryptographic protocol that verifies storage providers are actually storing the data they claim to store. Providers must periodically prove they possess the data.
- **Validators**: Service contracts (like Warm Storage) act as validators for payment settlements, ensuring services are delivered before payments are released.

## Installation

```bash
pnpm install @filoz/synapse-sdk ethers
```

Note: `ethers` v6 is a peer dependency and must be installed separately.

## Docs

Check the documentation [website](https://synapse.filecoin.services/)

## Contributing

Read contributing  [guidelines](../../.github/CONTRIBUTING.md).

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/FilOzone/synapse-sdk)

## License

Dual-licensed: [MIT](../../LICENSE.md), [Apache Software License v2](../../LICENSE.md) by way of the
[Permissive License Stack](https://protocol.ai/blog/announcing-the-permissive-license-stack/).
