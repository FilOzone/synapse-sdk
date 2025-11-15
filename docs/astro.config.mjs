import starlight from '@astrojs/starlight'
import { docsPlugin } from '@hugomrdias/docs/starlight-typedoc'
import { defineConfig } from 'astro/config'
import mermaid from 'astro-mermaid'
import ecTwoSlash from 'expressive-code-twoslash'
import starlightLlmsTxt from 'starlight-llms-txt'
import starlightPageActions from 'starlight-page-actions'
import viteTsconfigPaths from 'vite-tsconfig-paths'

const site = 'https://docs.filecoin.cloud'

// https://astro.build/config
export default defineConfig({
  site,
  base: '/',
  vite: {
    plugins: [viteTsconfigPaths()],
  },
  integrations: [
    mermaid({
      theme: 'forest',
      autoTheme: true,
    }),
    starlight({
      title: 'Filecoin Onchain Cloud Documentation',
      description:
        'Filecoin Onchain Cloud provides transparent storage, retrieval, and payments on the Filecoin network.',
      logo: { src: './src/assets/foc-logo.svg', alt: 'foc' },
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
            content: new URL('og2.jpg?v=1', site).href,
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
          label: 'Core Concepts',
          autogenerate: { directory: 'core-concepts' },
        },
        {
          label: 'Getting Started',
          autogenerate: { directory: 'getting-started' },
        },
        {
          label: 'Developer Guides',
          collapsed: false,
          autogenerate: { directory: 'developer-guides', collapsed: true },
        },
        {
          label: 'CookBooks',
          collapsed: true,
          autogenerate: { directory: 'cookbooks' },
        },
        {
          label: 'Resources',
          collapsed: true,
          autogenerate: { directory: 'resources' },
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
            plugin: ['typedoc-plugin-mdn-links'],
          },
        }),
        starlightLlmsTxt(),
        starlightPageActions(),
      ],
    }),
  ],
})
