import { defineCollection } from 'astro:content'
import { docsLoader } from '@astrojs/starlight/loaders'
import { docsSchema } from '@astrojs/starlight/schema'
import { autoSidebarLoader } from 'starlight-auto-sidebar/loader'
import { autoSidebarSchema } from 'starlight-auto-sidebar/schema'
import { changelogsLoader } from 'starlight-changelogs/loader'

export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
  autoSidebar: defineCollection({
    loader: autoSidebarLoader(),
    schema: autoSidebarSchema(),
  }),
  changelogs: defineCollection({
    loader: changelogsLoader([
      {
        provider: 'changeset',
        base: 'changelog-sdk',
        changelog: '../packages/synapse-sdk/CHANGELOG.md',
        process: ({ title }) => {
          return title.split(' ')[0]
        },
      },
      {
        provider: 'changeset',
        base: 'changelog-core',
        changelog: '../packages/synapse-core/CHANGELOG.md',
        process: ({ title }) => {
          return title.split(' ')[0]
        },
      },
      {
        provider: 'changeset',
        base: 'changelog-react',
        changelog: '../packages/synapse-react/CHANGELOG.md',
        process: ({ title }) => {
          return title.split(' ')[0]
        },
      },
    ]),
  }),
}
