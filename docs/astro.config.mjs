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
      logo: { src: './src/assets/foc-logo.svg', alt: 'synapse' },
      favicon: 'favicon.ico',
      customCss: ['./src/custom.css'],
      head: [
        {
          tag: 'link',
          attrs: {
            rel: 'icon',
            type: 'image/svg+xml',
            href: '/favicon.svg',
          },
        },
        {
          tag: 'link',
          attrs: {
            rel: 'icon',
            type: 'image/png',
            href: '/favicon-96x96.png',
            sizes: '96x96',
          },
        },
        {
          tag: 'link',
          attrs: {
            rel: 'apple-touch-icon',
            href: '/apple-touch-icon.png',
            sizes: '180x180',
          },
        },
        {
          tag: 'link',
          attrs: {
            rel: 'manifest',
            href: '/site.webmanifest',
          },
        },
        {
          tag: 'meta',
          attrs: {
            property: 'og:image',
            content: new URL('og.jpg?v=1', site).href,
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
