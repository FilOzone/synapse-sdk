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

- Node ≥22 (`devEngines` pins ^26).
- Tasks run through [Turborepo](https://turborepo.dev) (`turbo.json`), which builds workspace dependencies first and caches results. At the root, `pnpm run build`, `pnpm run lint` and `pnpm test` call `turbo run`. Inside a package, `pnpm turbo <task>` (for example `pnpm turbo test:node` or `pnpm turbo test:browser`) runs that package's task and its dependencies; `pnpm run <task>` runs the bare script without building dependencies.
- `pnpm run lint:fix` runs Biome. Add `--force` to a `turbo` command to skip the cache.
- Before changing `turbo.json`, task scripts or CI, load the `turborepo` skill (`.agents/skills/turborepo`; `.claude/skills` links to `.agents/skills`) and read the docs bundled in `node_modules/turbo/docs`.
- Tests use `playwright-test` (Mocha + Chai) in Node and a browser.
- Run `examples/cli` directly with `node examples/cli/src/index.ts` (no `tsx`). Rebuild packages first if you changed `packages/*`.

## Rules

- **Biome**: no `!` non-null assertions (use `?.` or explicit checks), no trailing semicolons, kebab-case filenames. Run `pnpm run lint:fix` before commits.
- **Environment agnostic**: no `Buffer`, `fs`, `path`, `process`, or `node:` imports in package source. Use web standard APIs (`fetch`, WebStreams, `Uint8Array`).
- **Commits**: Conventional Commits drive release-please; see [CONTRIBUTING](.github/CONTRIBUTING.md#how-should-i-write-my-commits). Scope commits by package and keep each commit to one package, so changelogs split correctly.
- **PieceCID**: PieceCIDv2 ([FRC-0069](https://github.com/filecoin-project/FIPs/blob/master/FRCs/frc-0069.md)) is not a classic CID. Contracts expect the **32-byte digest only**, not the full CID: `digest.bytes.subarray(digest.bytes.length - 32)`. Use the helpers in `@filoz/synapse-core/piece` (`calculate()`, `asPieceCID()`, `asLegacyPieceCID()`, `createPieceCIDStream()`).
- Filecoin block time is 30 seconds; be patient with on-chain operations.
