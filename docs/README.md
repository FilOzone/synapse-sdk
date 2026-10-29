# Docs website

## Local builds

From the repository root, install the locked dependencies and Chromium before building the docs:

```sh
pnpm install --frozen-lockfile
pnpm --dir docs exec playwright install chromium
pnpm -r --filter docs run build
```

Mermaid diagrams render to SVG during the build. Linux build environments also need Chromium's system dependencies; use `pnpm --dir docs exec playwright install --with-deps chromium` there. The build keeps both the forest and dark diagram themes, and the site's theme selector chooses which one to display.

The private workspace package in `docs/tooling/twoslash` uses TypeScript 5.9 for Twoslash compatibility. The docs and package builds use the repository's TypeScript version, so their package imports resolve the same dependency types.

The version-bound patch in `patches/starlight-changelogs@0.6.0.patch` replaces an obsolete Astro loader dependency with the same conditional request behavior using Astro's current metadata API. Check whether the patch is still needed when upgrading `starlight-changelogs`.

The patch in `patches/@hugomrdias__docs@0.2.0.patch` makes TypeDoc conversion failures stop the build and preserves the configured package compiler options. Check whether the patch is still needed when upgrading `@hugomrdias/docs`.

## 🚀 Project Structure

Inside of your Astro + Starlight project, you'll see the following folders and files:

```text
.
├── public/
├── src/
│   ├── assets/
│   ├── content/
│   │   ├── docs/
│   └── content.config.ts
├── astro.config.mjs
├── package.json
└── tsconfig.json
```

Starlight looks for `.md` or `.mdx` files in the `src/content/docs/` directory. Each file is exposed as a route based on its file name.

Images can be added to `src/assets/` and embedded in Markdown with a relative link.

Static assets, like favicons, can be placed in the `public/` directory.

## 🧞 Commands

All commands are run from the root of the project, from a terminal:

| Command                    | Action                                           |
| :------------------------  | :----------------------------------------------- |
| `pnpm install`             | Installs dependencies                            |
| `pnpm run dev`             | Starts local dev server at `localhost:4321`      |
| `pnpm run build`           | Build your production site to `./dist/`          |
| `pnpm run preview`         | Preview your build locally, before deploying     |
| `pnpm run astro ...`       | Run CLI commands like `astro add`, `astro check` |
| `pnpm run astro -- --help` | Get help using the Astro CLI                     |

## 👀 Want to learn more?

Check out:

- [Starlight’s docs](https://starlight.astro.build/)
- [the Astro documentation](https://docs.astro.build)
- [Expressive code twoslash](https://twoslash.matthiesen.dev/getting-started/installation/)
- [Starlight LLMs](https://delucis.github.io/starlight-llms-txt/)
- [Starlight Typedoc](https://starlight-typedoc.vercel.app/)
