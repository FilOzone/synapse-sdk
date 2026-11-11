# Contributing to Synapse

Thank you for helping to improve the project! 💖 No contribution is too small, and all contributions are valued.

Questions or concerns? Reach out in our public [channel] or [start a discussion][discussions].

## Conduct

Please review our [Code of Conduct] and be kind, inclusive, and considerate when interacting with contributors and maintainers.

## Issues

[Open an issue][issue] to request a feature or report a bug, or start a [discussion][discussions] if the idea is still taking shape. Comments, bug reproductions, and pull requests on existing issues are welcome too.

When reporting a bug, fill in the template (delete sections that don't apply), describe the problem and how it impacts you, and if possible include a [short, self-contained, correct example][sscce]. Check the [documentation][docs] first.

## Development

- Fork this repository.
- Install dependencies with `pnpm install`. Node ≥22 is required; pnpm downloads the pinned Node version (`devEngines`) if needed.
- Optionally run `npx simple-git-hooks` to install a pre-commit hook that runs Biome on staged files.
- Make your changes and add tests next to the package's existing tests (`src/test/` in `synapse-sdk`, `test/` in other packages).
- Commit following the [commit guidelines](#how-should-i-write-my-commits) and open a PR.

If you use an AI tool, load [AGENTS.md](../AGENTS.md) (and the package-level `AGENTS.md`, where present) into its context to teach it the structure and conventions of this repo.

### Repo structure

```text
packages/
  synapse-sdk/                    High-level SDK
  synapse-core/                   Core protocol library
  synapse-react/                  React hooks
  keysmith/                       Deterministic key derivation
  filecoin-encryption-envelope/   FIP-1253 encryption envelope
examples/                         Usage examples and starter kits
apps/                             Apps using Synapse
docs/                             Documentation site
```

### Generating ABIs

```bash
pnpm run generate-abi # in the synapse-core package
```

### Wireit

This repo uses [wireit](https://github.com/google/wireit) to run scripts with incremental builds, cross-workspace dependencies, and caching.

- Scripts whose inputs haven't changed are skipped. To force a rerun, delete the cached state with `pnpm run clean:cache` (or a package's `.wireit/` folder). `WIREIT_CACHE=none` only disables restoring outputs from cache; it does not force a rerun.
- Watch mode: append `--watch`
- Extra arguments: `pnpm run {script} {npm args} {wireit args} -- {script args}`

### Codespaces

A dev container configuration enables one-click setup with Codespaces.

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)][codespaces]

## Pull requests

Even tiny pull requests to fix typos or improve comments are welcome. For a significant change, [open an issue][issue] or [start a discussion][discussions] first; it makes a merge more likely.

All commits must be signed. See GitHub's [signing commits][signing] and [telling git about your signing key][telling-git] docs. We recommend a new SSH key for signing if you are setting it up for the first time.

How a PR is merged depends on how many packages it changes:

- **One package**: squash and merge. A pristine history isn't required; add commits to address review feedback.
- **More than one package**: rebase and merge, with one commit per package (see [commits](#how-should-i-write-my-commits)). Release Please assigns each commit to every package whose files it touches, so a squashed multi-package commit shows up in all of their changelogs with the same message. Before merging, tidy the branch so each commit is a clean, conventional, single-package commit.

Not every PR gets merged, but every one is appreciated and shapes how we think about the codebase.

### Tests

If your change alters existing code, run the checks:

```sh
pnpm run lint
pnpm run test
```

Inside a package directory you can run one environment at a time:

```sh
pnpm test:node    # add --watch for watch mode
pnpm test:browser # add --watch for watch mode
```

If you add a feature, add tests that prove it works and reference them in the PR.

## Release Process

[Release Please](https://github.com/googleapis/release-please) generates changelogs, GitHub releases, and version bumps by parsing [Conventional Commit messages](https://www.conventionalcommits.org/). Instead of releasing every merge, it keeps one Release PR per package up to date on `master`. Merging a Release PR tags the release, creates the GitHub release, and runs the package's publish jobs.

### How to merge the Release PRs?

Merge in dependency order: `synapse-core` first, then `synapse-sdk`, then `synapse-react`. `keysmith` and `filecoin-encryption-envelope` have no workspace dependencies and can be merged at any point.

Merge one Release PR at a time: squash and merge it, then wait for the `release-please` workflow to finish before merging the next. Release Please is configured with `always-update`, so it rebuilds the remaining Release PRs against the new `master`, picking up the bumped dependency versions without conflicts.

### How should I write my commits?

Use [Conventional Commit messages](https://www.conventionalcommits.org/): `<type>(<scope>): <description>`.

Use the package as the scope (`core`, `sdk`, `react`, `keysmith`, `encryption`), and keep each commit to one package. If a change spans packages, split it into one commit per package so each changelog gets its own entry, and the PR is rebase-merged. With a squash merge, the PR title becomes the commit message, so it must follow the same format.

| Prefix | Release |
| --- | --- |
| `fix:`, `chore:`, `test:`, `docs:` | patch |
| `feat:` | minor (patch for 0.x packages) |
| `feat!:`, `fix!:`, etc., or `BREAKING CHANGE:` in the footer | major (minor for 0.x packages) |

```bash
git commit -m "fix(sdk): resolve payments approval race condition"
git commit -m "docs: update storage service examples"
git commit -m "feat(core): add batch upload operations"
git commit -m "feat(sdk)!: remove deprecated payment methods"
git commit -m "fix(sdk): update API signature

BREAKING CHANGE: The createStorage method now requires explicit provider selection"
```

[channel]: https://filecoinproject.slack.com/archives/C07CGTXHHT4
[codespaces]: https://codespaces.new/FilOzone/synapse-sdk
[discussions]: https://github.com/FilOzone/synapse-sdk/discussions
[issue]: https://github.com/FilOzone/synapse-sdk/issues
[docs]: https://filozone.github.io/synapse-sdk
[sscce]: http://www.sscce.org/
[signing]: https://docs.github.com/en/authentication/managing-commit-signature-verification/signing-commits
[telling-git]: https://docs.github.com/en/authentication/managing-commit-signature-verification/telling-git-about-your-signing-key
[Code of Conduct]: CODE_OF_CONDUCT.md
