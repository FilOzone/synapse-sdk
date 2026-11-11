# Synapse

pnpm monorepo of TypeScript packages for Filecoin Onchain Cloud (FOC). Everything runs in Node.js and browsers.

## Packages

| Package | Purpose |
| --- | --- |
| `packages/synapse-sdk` | High-level SDK (`@filoz/synapse-sdk`) |
| `packages/synapse-core` | Protocol layer: viem actions per contract, Curio HTTP client, EIP-712, PieceCID, session keys, chains, test mocks |
| `packages/synapse-react` | React hooks |
| `packages/keysmith` | Deterministic key derivation for encryption |
| `packages/filecoin-encryption-envelope` | FIP-1253 encryption envelope |
| `examples/*`, `apps/*`, `docs/` | CLI and script-tag examples, playground app, docs site |

Packages version independently. Read the package's own `AGENTS.md` before working in it.

## Development

- Node ≥22 (`devEngines` pins ^24).
- `pnpm run build`, `pnpm run lint:fix` (Biome), `pnpm test` work at the root or in a package. Inside a package, `pnpm test:node` / `pnpm test:browser` run one environment.
- Scripts use wireit, which skips scripts whose inputs haven't changed; `pnpm run clean:cache` forces a rerun.
- Tests use `playwright-test` (Mocha + Chai) in Node and a browser.
- Run `examples/cli` directly with `node examples/cli/src/index.ts` (no `tsx`). Rebuild packages first if you changed `packages/*`.

## Rules

- **Biome**: no `!` non-null assertions (use `?.` or explicit checks), no trailing semicolons, kebab-case filenames. Run `pnpm run lint:fix` before commits.
- **Environment agnostic**: no `Buffer`, `fs`, `path`, `process`, or `node:` imports in package source. Use web standard APIs (`fetch`, WebStreams, `Uint8Array`).
- **Commits**: Conventional Commits drive release-please; see [CONTRIBUTING](.github/CONTRIBUTING.md#how-should-i-write-my-commits).
- Filecoin block time is 30 seconds; be patient with on-chain operations.
