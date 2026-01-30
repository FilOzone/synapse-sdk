/**
 * Sync contract addresses from FilOzone/filecoin-services deployments.json to the contracts.md documentation file.
 *
 * This script fetches the canonical contract addresses from the filecoin-services repository
 * and updates the markdown tables in docs/src/content/docs/resources/contracts.md.
 *
 * Run from repo root: node docs/scripts/sync-contract-addresses.ts
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CONTRACTS_MD_PATH = join(__dirname, '../src/content/docs/resources/contracts.md')

// Source of truth for contract addresses
const DEPLOYMENTS_URL =
  'https://raw.githubusercontent.com/FilOzone/filecoin-services/main/service_contracts/deployments.json'

// Chain IDs
const CHAIN_IDS = {
  mainnet: '314',
  calibration: '314159',
} as const

// Explorer URLs for each network
const EXPLORERS = {
  mainnet: 'https://filecoin.blockscout.com/address',
  calibration: 'https://filecoin-testnet.blockscout.com/address',
} as const

// Well-known addresses not in deployments.json
const STATIC_ADDRESSES = {
  MULTICALL3: '0xcA11bde05977b3631167028862bE2a173976CA11',
  USDFC_MAINNET: '0x80B98d3aa09ffff255c3ba4A241111Ff1262F045',
  USDFC_CALIBRATION: '0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0',
} as const

// Mapping from deployments.json keys to display names
const CONTRACT_KEY_MAP: Record<string, string> = {
  MULTICALL3: 'Multicall3',
  FWSS_PROXY_ADDRESS: 'Warm Storage Service Proxy',
  FWSS_IMPLEMENTATION_ADDRESS: 'Warm Storage Service Implementation',
  FWSS_VIEW_ADDRESS: 'Warm Storage Service StateView',
  PDP_VERIFIER_PROXY_ADDRESS: 'PDPVerifier Proxy',
  PDP_VERIFIER_IMPLEMENTATION_ADDRESS: 'PDPVerifier Implementation',
  FILECOIN_PAY_ADDRESS: 'Filecoin Pay',
  USDFC: 'USDFC Token',
  SERVICE_PROVIDER_REGISTRY_PROXY_ADDRESS: 'Service Provider Registry Proxy',
  SERVICE_PROVIDER_REGISTRY_IMPLEMENTATION_ADDRESS: 'Service Provider Registry Implementation',
  SESSION_KEY_REGISTRY_ADDRESS: 'Session Key Registry',
  ENDORSEMENT_SET_ADDRESS: 'Endorsements',
}

// Order of contracts in the table (for consistent output)
const CONTRACT_ORDER = [
  'MULTICALL3',
  'FWSS_PROXY_ADDRESS',
  'FWSS_IMPLEMENTATION_ADDRESS',
  'FWSS_VIEW_ADDRESS',
  'PDP_VERIFIER_PROXY_ADDRESS',
  'PDP_VERIFIER_IMPLEMENTATION_ADDRESS',
  'FILECOIN_PAY_ADDRESS',
  'USDFC',
  'SERVICE_PROVIDER_REGISTRY_PROXY_ADDRESS',
  'SERVICE_PROVIDER_REGISTRY_IMPLEMENTATION_ADDRESS',
  'SESSION_KEY_REGISTRY_ADDRESS',
  'ENDORSEMENT_SET_ADDRESS',
]

type NetworkContracts = Record<string, string>
type DeploymentsJson = Record<string, Record<string, string>>

async function fetchDeployments(): Promise<DeploymentsJson> {
  const response = await fetch(DEPLOYMENTS_URL)
  if (!response.ok) {
    throw new Error(`Failed to fetch deployments: ${response.status} ${response.statusText}`)
  }
  return response.json() as Promise<DeploymentsJson>
}

function getContractAddresses(deployments: DeploymentsJson, chainId: string, isMainnet: boolean): NetworkContracts {
  const networkDeployments = deployments[chainId]
  if (!networkDeployments) {
    throw new Error(`No deployments found for chain ID ${chainId}`)
  }

  const contracts: NetworkContracts = {
    MULTICALL3: STATIC_ADDRESSES.MULTICALL3,
    USDFC: isMainnet ? STATIC_ADDRESSES.USDFC_MAINNET : STATIC_ADDRESSES.USDFC_CALIBRATION,
  }

  for (const key of CONTRACT_ORDER) {
    if (contracts[key]) continue // Skip static addresses
    const address = networkDeployments[key]
    if (address) {
      contracts[key] = address
    }
  }

  return contracts
}

function generateMarkdownTable(contracts: NetworkContracts, explorerBase: string): string {
  const lines = ['| Contract | Address | Explorer |', '| -------- | ------- | -------- |']

  for (const key of CONTRACT_ORDER) {
    const address = contracts[key]
    if (!address) continue

    const displayName = CONTRACT_KEY_MAP[key] || key
    const explorerUrl = `${explorerBase}/${address}`
    lines.push(`| ${displayName} | \`${address}\` | [View](${explorerUrl}) |`)
  }

  return lines.join('\n')
}

// Extract addresses from existing markdown content
function extractAddressesFromMarkdown(content: string, sectionHeader: string): NetworkContracts {
  const addresses: NetworkContracts = {}

  // Find the section
  const sectionStart = content.indexOf(`## ${sectionHeader}`)
  if (sectionStart === -1) return addresses

  // Find where the section ends (next ## or end of file)
  const nextSectionMatch = content.slice(sectionStart + 1).search(/\n## /)
  const sectionEnd = nextSectionMatch === -1 ? content.length : sectionStart + 1 + nextSectionMatch
  const sectionContent = content.slice(sectionStart, sectionEnd)

  // Match each table row: | Contract Name | `0xAddress` | [View](...) |
  const rowRegex = /\|\s*([^|]+?)\s*\|\s*`(0x[a-fA-F0-9]+)`\s*\|/g
  // biome-ignore lint/suspicious/noImplicitAnyLet: we need to match the regex
  let match
  // biome-ignore lint/suspicious/noAssignInExpressions: we need to match the regex
  while ((match = rowRegex.exec(sectionContent)) !== null) {
    const displayName = match[1].trim()
    const address = match[2]
    // Find the key by display name
    for (const [key, name] of Object.entries(CONTRACT_KEY_MAP)) {
      if (name === displayName) {
        addresses[key] = address
        break
      }
    }
  }

  return addresses
}

// Compare addresses and return changes
function findChanges(
  oldAddresses: NetworkContracts,
  newAddresses: NetworkContracts
): { added: string[]; changed: { key: string; old: string; new: string }[]; removed: string[] } {
  const added: string[] = []
  const changed: { key: string; old: string; new: string }[] = []
  const removed: string[] = []

  // Find added and changed
  for (const key of CONTRACT_ORDER) {
    const oldAddr = oldAddresses[key]
    const newAddr = newAddresses[key]

    if (newAddr && !oldAddr) {
      added.push(key)
    } else if (newAddr && oldAddr && newAddr !== oldAddr) {
      changed.push({ key, old: oldAddr, new: newAddr })
    }
  }

  // Find removed
  for (const key of Object.keys(oldAddresses)) {
    if (!newAddresses[key]) {
      removed.push(key)
    }
  }

  return { added, changed, removed }
}

function updateMarkdownSection(content: string, sectionHeader: string, newTable: string): string {
  // Find the section by its header
  // Match: ## Header\n followed by optional whitespace, then table content until next section
  const sectionRegex = new RegExp(
    `(## ${sectionHeader}\\n)` + // Match section header exactly
      `\\n*` + // Match any leading newlines
      `(\\|[^#]*?)` + // Match table content (everything until next section or EOF)
      `(?=\\n## |$)`, // Lookahead for next section or end
    's'
  )

  const match = content.match(sectionRegex)
  if (!match || match.index === undefined) {
    console.error(`Could not find section: ${sectionHeader}`)
    return content
  }

  // Replace the section content (header + table)
  const sectionStart = match.index
  const sectionEnd = sectionStart + match[0].length

  return `${content.slice(0, sectionStart)}## ${sectionHeader}\n\n${newTable}\n${content.slice(sectionEnd)}`
}

async function main() {
  // Fetch deployments from GitHub
  console.log(`Fetching deployments from ${DEPLOYMENTS_URL}...`)
  let deployments: DeploymentsJson
  try {
    deployments = await fetchDeployments()
  } catch (error) {
    console.error('Failed to fetch deployments:', error)
    process.exit(1)
  }

  // Read current contracts.md content
  let content: string
  try {
    content = readFileSync(CONTRACTS_MD_PATH, 'utf-8')
  } catch (error) {
    console.error(`Failed to read ${CONTRACTS_MD_PATH}:`, error)
    process.exit(1)
  }

  const originalContent = content

  // Get addresses from deployments
  const mainnetAddresses = getContractAddresses(deployments, CHAIN_IDS.mainnet, true)
  const calibrationAddresses = getContractAddresses(deployments, CHAIN_IDS.calibration, false)

  // Generate new tables
  const mainnetTable = generateMarkdownTable(mainnetAddresses, EXPLORERS.mainnet)
  const calibrationTable = generateMarkdownTable(calibrationAddresses, EXPLORERS.calibration)

  // Update content
  content = updateMarkdownSection(content, 'Mainnet', mainnetTable)
  content = updateMarkdownSection(content, 'Calibration Testnet', calibrationTable)

  // Check if content changed
  if (content === originalContent) {
    console.log('Contract addresses are up to date.')
    return
  }

  // Extract old addresses to compare
  const oldMainnetAddresses = extractAddressesFromMarkdown(originalContent, 'Mainnet')
  const oldCalibrationAddresses = extractAddressesFromMarkdown(originalContent, 'Calibration Testnet')


  // Find what changed
  const mainnetChanges = findChanges(oldMainnetAddresses, mainnetAddresses)
  const calibrationChanges = findChanges(oldCalibrationAddresses, calibrationAddresses)

  // Write updated content
  writeFileSync(CONTRACTS_MD_PATH, content)
  console.log('Updated contract addresses in contracts.md\n')

  // Print summary of changes
  const printChanges = (network: string, changes: ReturnType<typeof findChanges>) => {
    const hasChanges = changes.added.length > 0 || changes.changed.length > 0 || changes.removed.length > 0
    if (!hasChanges) return

    console.log(`${network}:`)

    for (const key of changes.added) {
      console.log(`  + ${CONTRACT_KEY_MAP[key] || key} (new)`)
    }

    for (const { key, old, new: newAddr } of changes.changed) {
      console.log(`  ~ ${CONTRACT_KEY_MAP[key] || key}:`)
      console.log(`      ${old} → ${newAddr}`)
    }

    for (const key of changes.removed) {
      console.log(`  - ${CONTRACT_KEY_MAP[key] || key} (removed)`)
    }

    console.log('')
  }

  printChanges('Mainnet', mainnetChanges)
  printChanges('Calibration Testnet', calibrationChanges)
}

main()
