import starlight from '@astrojs/starlight'
import { docsPlugin } from '@hugomrdias/docs/starlight-typedoc'
import { defineConfig } from 'astro/config'
import ecTwoSlash from 'expressive-code-twoslash'
import starlightLlmsTxt from 'starlight-llms-txt'

const site = 'https://FilOzone.github.io'

// https://astro.build/config
export default defineConfig({
  site,
  integrations: [
    starlight({
      title: 'Filecoin Onchain Cloud',
      logo: { src: './public/filecoin-logo.svg', alt: 'synapse' },
      favicon: 'filecoin-logo.svg',
      head: [
        {
          tag: 'meta',
          attrs: {
            property: 'og:image',
            content: new URL('og.jpg?v=1', site).href,
          },
        },
        {
          tag: 'meta',
          attrs: {
            property: 'og:image:alt',
            content:
              'Connect apps with Filecoin Services - a smart-contract based marketplace for storage and other services',
          },
        },
      ],
      social: [
        {
          icon: 'github',
          label: 'Github',
          href: 'https://github.com/FilOzone/synapse-sdk',
        },
        {
          icon: 'x.com',
          label: 'X',
          href: 'https://x.com/_FilOz',
        },
      ],
      editLink: {
        baseUrl: 'https://github.com/FilOzone/synapse-sdk/edit/main/docs/',
      },
      lastUpdated: true,
      sidebar: [
        {
          label: 'Introduction',
          autogenerate: { directory: 'introduction' },
        },
        {
          label: 'Getting Started',
          autogenerate: { directory: 'getting-started' },
        },
        {
          label: 'Core Concepts',
          autogenerate: { directory: 'core-concepts' },
        },
        {
          label: 'Developers',
          autogenerate: { directory: 'developers' },
        },
        {
          label: 'API',
          collapsed: true,
          autogenerate: { directory: 'api' },
        },
        {
          label: 'Resources',
          autogenerate: { directory: 'resources' },
        },
      ],
      expressiveCode: {
        plugins: [
          ecTwoSlash({
            twoslashOptions: {
              compilerOptions: {
                allowUmdGlobalAccess: true,
                lib: ['ESNext', 'DOM', 'DOM.Iterable'],
              },
            },
          }),
        ],
      },
      plugins: [
        docsPlugin({
          pagination: true,
          typeDocOptions: {
            githubPages: true,
            entryPointStrategy: 'resolve',
            entryPoints: [
              '../src/index.ts',
              '../src/piece/index.ts',
              '../src/pdp/index.ts',
              '../src/payments/index.ts',
              '../src/warm-storage/index.ts',
              '../src/subgraph/index.ts',
            ],
            tsconfig: '../tsconfig.json',
            useCodeBlocks: true,
            parametersFormat: 'table',
            indexFormat: 'table',
            groupOrder: ['classes', 'functions', 'variables', 'types', '*'],
            plugin: ['typedoc-plugin-mdn-links', 'typedoc-plugin-missing-exports'],
          },
        }),
        starlightLlmsTxt(),
      ],
    }),
  ],
})
