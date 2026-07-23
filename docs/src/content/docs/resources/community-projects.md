---
title: Community Projects
description: FOC WG and community-maintained SDKs, tools, and projects for Filecoin Onchain Cloud.
sidebar:
  order: 3
---

This page highlights real projects that show Synapse and Filecoin Onchain Cloud (FOC) in action. Start with the FOC WG spotlight projects, then explore additional community-built SDKs and tooling.

:::note[How to Use This Page]
Use these repositories as reference implementations when planning your own FOC integration, especially for storage UX, wallet flows, and on-chain indexing.
:::

:::caution[Ownership and Support]
Projects in **FOC WG Spotlight** are maintained by the FOC Working Group. Projects in **Additional Community Projects** are maintained by external contributors. For support and compatibility questions, refer to each project's repository.
:::

## FOC WG Spotlight

| Project | Demo | Source |
| --- | --- | --- |
| Filecoin Pin | [Open Demo](https://pin.filecoin.cloud/) | [GitHub](https://github.com/filecoin-project/filecoin-pin) |
| FOC Upload dApp | [Open Demo](https://foc-demo.filbuilders.eth.limo/) | [GitHub](https://github.com/FIL-Builders/foc-upload-dapp) |

### Filecoin Pin

[![Screenshot of the Filecoin Pin demo](./pin-filecoin-cloud.png)](https://pin.filecoin.cloud/)

Filecoin Pin gives the IPFS community several ways to use Filecoin Onchain Cloud (FOC) for verifiable persistence while preserving familiar IPFS content addressing and retrieval workflows.

| Affordance | Best for | Get started |
| --- | --- | --- |
| Browser demo | Exploring the Filecoin Pin upload flow | [Open the Filecoin Pin demo](https://pin.filecoin.cloud/) |
| CLI | Local development, scripts, and terminal workflows | [Follow the CLI quick start](/getting-started/filecoin-pin/) |
| GitHub Action | Uploading static sites and build artifacts from CI/CD | [View the Filecoin Pin Upload Action](https://github.com/filecoin-project/filecoin-pin/tree/master/upload-action) |

See the [Filecoin Pin overview](/core-concepts/filecoin-pin/) for details about its architecture, storage proofs, payments, and IPFS interoperability.

### FOC Upload dApp

[![Screenshot of the FOC Upload dApp demo](./foc-upload-dapp-demo.png)](https://foc-demo.filbuilders.eth.limo/)

`FOC Upload dApp` demonstrates an upload-first flow with wallet-connected interactions. Use it as a baseline for quickly integrating Synapse/FOC upload workflows in your own dApp.

- Best for: rapid upload dApp prototyping
- Integration focus: minimal end-to-end storage flow with wallet UX

## Additional Community Projects

### SDKs

#### Python

**[pynapse](https://github.com/anjor/pynapse)** — A Python SDK for interacting with Filecoin Onchain Cloud services.

- Upload and download data
- Payment and allowance management
- Provider discovery

#### Go

**[go-synapse](https://github.com/data-preservation-programs/go-synapse)** — A Go SDK for Filecoin Onchain Cloud.

- Native Go implementation
- Suitable for backend services and CLI tools

**[synapse-go](https://github.com/strahe/synapse-go)** — A Go SDK for building Filecoin Onchain Cloud applications.

- Idiomatic Go API for FOC workflows
- Upload, download, provider discovery, payments, approvals, and cost estimation
- Warm Storage, session keys, FilBeam retrieval, and PieceCID utilities
- Resources: [API docs](https://pkg.go.dev/github.com/strahe/synapse-go) and [examples](https://github.com/strahe/synapse-go/tree/main/examples)

### Tools

#### FWSS Subgraph

**[fwss-subgraph](https://github.com/FIL-Builders/fwss-subgraph)** — Indexes on-chain data from the Filecoin Warm Storage Service contracts, making it easy to query data sets, pieces, payment rails, and provider activity using GraphQL.

#### FOC CLI

**[foc-cli](https://github.com/FIL-Builders/foc-cli)** — A CLI and MCP server for Filecoin Onchain Cloud. Upload files, manage datasets and pieces, check wallet balances, and handle deposits from your terminal or AI agents.

- Add as a Claude Code skill: `npx skills add FIL-Builders/foc-cli`
- Add as an MCP server: `npx foc-cli mcp add`
- View available commands: `npx foc-cli --llms`

## Contributing

Have a project you'd like to add? Open a pull request to this page with your project details.
