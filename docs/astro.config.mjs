import { satteri } from '@astrojs/markdown-satteri'
import starlight from '@astrojs/starlight'
import { llmsPlugin } from '@hugomrdias/docs/starlight-llms'
import { docsPlugin } from '@hugomrdias/docs/starlight-typedoc'
import { transformerTwoslash } from '@shikijs/twoslash'
import { defineConfig } from 'astro/config'
import mermaid from 'astro-mermaid'
import starlightAutoSidebar from 'starlight-auto-sidebar'
import starlightLinksValidator from 'starlight-links-validator'
import { codeBlocksScript, transformerCodeBlocks } from './src/code-blocks.mjs'
import { externalLinks } from './src/external-links.mjs'

const site = 'https://docs.filecoin.cloud'

// https://astro.build/config
export default defineConfig({
  site,
  base: '/',
  redirects: {
    '/developer-guides/storage/storage-context/': '/developer-guides/storage/storage-operations/',
    '/developer-guides/storage/split-operations/': '/developer-guides/storage/upload-pipeline/',
    '/developer-guides/react-integration/': '/developer-guides/synapse-react/',
    '/developer-guides/devnet/': '/resources/devnet/',
    '/getting-started/preview-packages/': '/developer-guides/preview-packages/',
  },
  markdown: {
    shikiConfig: {
      themes: { light: 'night-owl-light', dark: 'night-owl' },
      transformers: [
        transformerTwoslash({
          explicitTrigger: true,
          twoslashOptions: {
            compilerOptions: {
              lib: ['lib.esnext.d.ts', 'lib.dom.d.ts'],
              jsx: 4, // react-jsx
              jsxImportSource: 'react',
            },
          },
        }),
        transformerCodeBlocks(),
      ],
    },
    // Starlight, mermaid and the links validator add their own Sätteri plugins
    processor: satteri({ hastPlugins: [externalLinks] }),
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
      customCss: ['@shikijs/twoslash/style-rich.css', './src/code.css', './src/custom.css'],
      head: [
        { tag: 'script', content: codeBlocksScript },
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
        {
          tag: 'script',
          attrs: {
            src: 'https://plausible.io/js/pa-rtmx1Y7w1rQg3O30eJD9U.js',
            defer: true,
            async: true,
          },
        },
        {
          tag: 'script',
          content: `
            window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},plausible.init=plausible.init||function(i){plausible.o=i||{}};
            plausible.init();
          `,
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
          items: [
            {
              autogenerate: { directory: 'introduction' },
            },
          ],
        },
        {
          label: 'Core Concepts',
          items: [
            {
              autogenerate: { directory: 'core-concepts' },
            },
          ],
        },
        {
          label: 'Getting Started',
          items: [
            {
              autogenerate: { directory: 'getting-started' },
            },
          ],
        },
        {
          label: 'Developer Guides',
          collapsed: false,
          items: [
            {
              autogenerate: { directory: 'developer-guides', collapsed: true },
            },
          ],
        },
        {
          label: 'CookBooks',
          collapsed: true,
          items: [
            {
              autogenerate: { directory: 'cookbooks' },
            },
          ],
        },
        {
          label: 'Resources',
          collapsed: true,
          items: [
            {
              autogenerate: { directory: 'resources' },
            },
          ],
        },
        {
          label: 'Reference',
          collapsed: true,
          items: [
            {
              autogenerate: { directory: 'reference', collapsed: true },
            },
          ],
        },
      ],
      expressiveCode: false,
      plugins: [
        docsPlugin({
          outputDirectory: 'reference',
          pagination: true,
          typeDocOptions: {
            githubPages: true,
            entryPointStrategy: 'packages',
            entryPoints: ['../packages/*'],
            tsconfig: '../tsconfig.json',
            useCodeBlocks: false,
            parametersFormat: 'table',
            indexFormat: 'table',
            groupOrder: ['classes', 'functions', 'variables', 'types', 'namespaces', '*'],
            plugin: ['typedoc-plugin-mdn-links'],
          },
        }),
        llmsPlugin(),
        starlightAutoSidebar(),
        // The validator wipes the content layer cache on every build, so only run it when asked
        ...(process.env.CHECK_LINKS ? [starlightLinksValidator()] : []),
      ],
    }),
  ],
})
