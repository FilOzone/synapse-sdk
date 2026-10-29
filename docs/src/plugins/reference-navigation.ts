import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { StarlightPlugin } from '@astrojs/starlight/types'

/** Keep supporting TypeDoc pages available to signature links without listing internal modules. */
export function referenceNavigation(): StarlightPlugin {
  return {
    name: 'reference-navigation',
    hooks: {
      'config:setup': async ({ astroConfig, command }) => {
        if (command === 'preview') return
        const root = path.join(fileURLToPath(astroConfig.srcDir), 'content/docs/reference')

        for (const filename of await markdownFiles(root)) {
          let contents = await readFile(filename, 'utf8')
          const original = contents
          const boundary = contents.indexOf('\n---', 4)
          if (!contents.startsWith('---\n') || boundary === -1) {
            throw new Error(`Expected TypeDoc frontmatter in ${filename}`)
          }
          let metadata = contents.slice(4, boundary)
          let body = contents.slice(boundary + 4)

          // Keep supporting type pages available to signature links without listing implementation details.
          if (filename.split(path.sep).includes('-internal-')) {
            metadata = metadata.replace(/^(next|prev):.*$/gm, '$1: false')
            if (!/^pagefind:/m.test(metadata)) metadata += '\npagefind: false'
            if (!/^ {2}hidden: true$/m.test(metadata)) {
              metadata = metadata.includes('\nsidebar:\n')
                ? metadata.replace('\nsidebar:\n', '\nsidebar:\n  hidden: true\n')
                : `${metadata}\nsidebar:\n  hidden: true`
            }
          }

          if (path.basename(filename) === 'toc.md') {
            // The synthetic TypeDoc module is not part of any package's public exports.
            body = body.replace(/^\| \[\\<internal\\>\]\([^\n]+\n/gm, '')
            body = body.replace(/^## Modules\n\n\| Module \| Description \|\n\| [-| ]+\|\n(?=\n|$)/gm, '')
          }

          contents = `---\n${metadata}\n---${body}`
          if (contents !== original) await writeFile(filename, contents)
        }
      },
    },
  }
}

async function markdownFiles(directory: string): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await markdownFiles(filename)))
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(filename)
  }
  return files
}
