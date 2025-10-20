---
title: About Filecoin Onchain Cloud
description: Learn about Filecoin Onchain Cloud - a decentralized cloud platform built on Filecoin that enables smart-contract based storage and services.
sidebar: 
  order: 1
---

Since its launch, [**Filecoin Network**](https://filecoin.io/) has been the backbone for **decentralized data storage**, anchored by its *Proof-of-Replication (PoRep)* model that ensures the integrity of long-term, immutable data. However, as decentralized applications evolve, they demand **faster access, dynamic payments, and cryptographic verification** that can operate within smart contracts.

[**Filecoin Onchain Cloud (FOC)**](https://www.filecoin.cloud/) addresses this next-generation demand by reimagining storage as a **programmable cloud service layer** — where each capability (storage, retrieval, billing, verification) exists as a composable onchain module. These modules can be combined, forked, or extended, giving builders the flexibility to create customized decentralized applications and data-driven services.

Built on the **Filecoin Virtual Machine (FVM)** and powered by a distributed network of verifiable storage providers, Filecoin Onchain Cloud transforms the Filecoin Network from a large-scale cold storage layer into a programmable, service-based data infrastructure. 

## Architecture

FOC addresses this next-generation demand by creating composable onchain modules where each capability (storage, retrieval, billing, verification) can be combined, forked, or extended, giving developers the flexibility to create customized decentralized applications and data-driven services. It is built around four fundamental layers:

1. **Warm Storage Services** – Provided by decentralized service providers using the Filecoin Warm Storage Service (FWSS), optimized for accessibility and speed through PDP proofs.
2. **Payment & Settlement Layer** – Managed by Filecoin Pay, enabling flexible, auditable billing flows between clients and providers.
3. **Retrieval Layer** – Powered by Filecoin Beam, enabling fast, CDN-like retrieval with verifiable delivery proofs and pay-per-byte billing.
4. **Developer & Application Layer** – Powered by the Synapse SDK, which abstracts service contracts, data sets, and payment rails into simple APIs usable across web, node, and edge environments.

![Filecoin Onchain Cloud Architecture](../../../assets/foc-diagram.png)

### Key Properties

At its core, Filecoin Onchain Cloud delivers cloud-grade performance and usability with verifiable onchain properties:

- 🔑 **Ownership** — Data, payments, and service logic belong to users and developers, not intermediaries.
- 🔍 **Verifiability** — Every transaction, proof, and interaction is recorded, auditable, and cryptographically verifiable on the Filecoin blockchain.
- ⚙️ **Programmability** — Services are governed by smart contracts that developers can compose, automate, or extend to suit diverse application needs.

This design allows Filecoin to move beyond static data storage — offering real-time data services, decentralized payment flows, and programmable access policies that any developer can integrate through a unified interface.

### Core Components

The Filecoin Onchain Cloud services are built from foundational components that together create a verifiable, service-oriented cloud stack:

- [**Proof of Data Possession (PDP)**](https://github.com/FilOzone/pdp) — The cryptographic proof layer ensuring data storage integrity and retrievability.
- [**Filecoin Pay**](https://github.com/FilOzone/filecoin-pay) — The financial settlement engine that enables programmable payments for onchain services.
- [**Filecoin Beam**](https://docs.filbeam.com/) — The retrieval and delivery network that ensures global accessibility of stored data.
- [**Filecoin Warm Storage Service (FWSS)**](https://github.com/FilOzone/filecoin-services) — The operational layer providing fast, persistent, and verifiable data storage.

Each of these components works independently yet integrates seamlessly through onchain smart contracts and the [**Synapse SDK**](https://github.com/FilOzone/synapse-sdk), forming a cohesive, modular system. Together, they deliver the core properties of a next-generation decentralized cloud: verifiability, programmability, and composability.
