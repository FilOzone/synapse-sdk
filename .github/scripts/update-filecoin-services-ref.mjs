import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const usage = 'Usage: node .github/scripts/update-filecoin-services-ref.mjs <commit-sha> <tag>'
const [shaInput, tag] = process.argv.slice(2)

if (shaInput === undefined || shaInput === '' || tag === undefined || tag === '') {
  throw new Error(usage)
}

const sha = shaInput.toLowerCase()

if (/^[a-f0-9]{40}$/.test(sha) === false) {
  throw new Error(`Expected a 40-character filecoin-services commit SHA, got '${shaInput}'`)
}

if (/^v[0-9][0-9A-Za-z._-]*$/.test(tag) === false) {
  throw new Error(`Expected a filecoin-services release tag like 'v1.2.3', got '${tag}'`)
}

const wagmiConfigPath = resolve('packages/synapse-core/wagmi.config.ts')
const source = await readFile(wagmiConfigPath, 'utf8')
const refPattern = /const FILECOIN_SERVICES_GIT_REF = '[^']+'(?:\s*\/\/[^\n]*)?/
const matches = source.match(new RegExp(refPattern.source, 'g')) ?? []

if (matches.length !== 1) {
  throw new Error(`Expected exactly one FILECOIN_SERVICES_GIT_REF assignment, found ${matches.length}`)
}

const replacement = `const FILECOIN_SERVICES_GIT_REF = '${sha}' // ${tag}`
const next = source.replace(refPattern, replacement)

if (next === source) {
  console.log(`FILECOIN_SERVICES_GIT_REF is already pinned to ${sha} (${tag})`)
} else {
  await writeFile(wagmiConfigPath, next)
  console.log(`Updated FILECOIN_SERVICES_GIT_REF to ${sha} (${tag})`)
}
