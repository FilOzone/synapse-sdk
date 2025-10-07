import starlight from '@astrojs/starlight'
import { docsPlugin } from '@hugomrdias/docs/starlight-typedoc'
import { defineConfig } from 'astro/config'
import ecTwoSlash from 'expressive-code-twoslash'
import starlightLlmsTxt from 'starlight-llms-txt'
import viteTsconfigPaths from 'vite-tsconfig-paths'

const site = 'https://synapse.filecoin.services'

// https://astro.build/config
export default defineConfig({
  site,
  base: '/',
  vite: {
    plugins: [viteTsconfigPaths()],
  },
  integrations: [
    starlight({
      title: 'Synapse',
      logo: { src: './public/filoz.svg', alt: 'synapse' },
      favicon: 'filoz.svg',
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
          autogenerate: { directory: 'intro' },
        },
        {
          label: 'Guides',
          autogenerate: { directory: 'guides' },
        },
        {
          label: 'API',
          collapsed: true,
          autogenerate: { directory: 'api' },
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
            entryPointStrategy: 'packages',
            entryPoints: ['../packages/*'],
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
