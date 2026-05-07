#!/usr/bin/env node

/**
 * SP Registry CLI Tool. Read commands (info / list / approved-list /
 * endorsed-list) work without --key; write commands (register / update /
 * deregister) require it.
 */

import { createClient, formatUnits, hexToString, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { waitForTransactionReceipt } from 'viem/actions'
import { calibration, mainnet } from '../packages/synapse-core/src/chains.ts'
import { getEndorsedProviderIds } from '../packages/synapse-core/src/endorsements/index.ts'
import {
  extractRegisterProviderEvent,
  getPDPProvider,
  getPDPProviders,
  getPDPProvidersByIds,
  getProviderIdByAddress,
} from '../packages/synapse-core/src/sp-registry/index.ts'
import { getApprovedProviderIds } from '../packages/synapse-core/src/warm-storage/index.ts'
import { SPRegistryService } from '../packages/synapse-sdk/src/sp-registry/index.ts'

// Aligned with Curio's FSRegister defaults (web/api/webrpc/pdp.go).
const PDP_DEFAULTS = {
  MIN_PIECE_SIZE: 1024n * 1024n,
  MAX_PIECE_SIZE: 64n * 1024n ** 3n,
  IPNI_PIECE: true,
  IPNI_IPFS: true,
  // 2.5 USDFC/TiB/month -> per-day, 18-decimal base units
  STORAGE_PRICE_PER_TIB_PER_DAY: (25n * 10n ** 17n) / 30n,
  MIN_PROVING_PERIOD_EPOCHS: 1440n,
  LOCATION: '',
}

function parseArgs() {
  const args = process.argv.slice(2)
  const command = args[0]
  const options = {}

  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].substring(2)
      const value = args[i + 1]
      if (value && !value.startsWith('--')) {
        if (key === 'capability') {
          if (!options.capability) options.capability = []
          options.capability.push(value)
        } else {
          options[key] = value
        }
        i++
      } else {
        options[key] = true
      }
    }
  }

  return { command, options }
}

function buildClient({ chain, account, rpcUrl }) {
  const transport = http(rpcUrl ?? chain.rpcUrls.default.http[0])
  return createClient({ chain, transport, account })
}

async function resolveConfig(options) {
  if (options.network === 'devnet' || process.env.NETWORK === 'devnet') {
    const { readFileSync } = await import('fs')
    const { homedir } = await import('os')
    const { join } = await import('path')
    const { validateDevnetInfo, toChain } = await import('../packages/synapse-core/src/devnet/index.ts')

    const path =
      options['devnet-info'] ||
      process.env.DEVNET_INFO_PATH ||
      join(homedir(), '.foc-devnet', 'state', 'latest', 'devnet-info.json')

    console.log(`Loading devnet info from: ${path}`)
    const devnetInfo = validateDevnetInfo(JSON.parse(readFileSync(path, 'utf8')))
    const chain = toChain(devnetInfo)
    console.log(`Devnet run: ${devnetInfo.info.run_id}`)
    return { chain }
  }

  const network = options.network || 'calibration'
  if (network !== 'mainnet' && network !== 'calibration' && network !== 'calibnet') {
    console.error(`Error: Invalid --network '${network}'. Use 'mainnet' or 'calibration'.`)
    process.exit(1)
  }
  const baseChain = network === 'mainnet' ? mainnet : calibration
  const chain = options['rpc-url']
    ? { ...baseChain, rpcUrls: { ...baseChain.rpcUrls, default: { http: [options['rpc-url']] } } }
    : baseChain

  console.log(`Network: ${chain.name}`)
  return { chain }
}

function makeAccount(options, command) {
  const writeCommands = new Set(['register', 'update', 'deregister'])
  if (!writeCommands.has(command)) return undefined
  const key = options.key || process.env.PRIVATE_KEY
  if (!key) {
    console.error(`Error: --key (or PRIVATE_KEY) is required for '${command}'`)
    process.exit(1)
  }
  return privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`)
}

async function loadStatus(client) {
  const [approvedIds, endorsedIds] = await Promise.all([getApprovedProviderIds(client), getEndorsedProviderIds(client)])
  const approvedSet = new Set(approvedIds.map(String))
  const endorsedSet = new Set(endorsedIds.map(String))
  return {
    approvedIds,
    endorsedIds,
    approvedCount: approvedSet.size,
    endorsedCount: endorsedSet.size,
    statusFor(providerId) {
      const id = String(providerId)
      const flags = []
      if (approvedSet.has(id)) flags.push('approved')
      if (endorsedSet.has(id)) flags.push('endorsed')
      return flags
    },
  }
}

function formatProvider(provider, statusFlags) {
  const lines = [`Provider #${provider.id}:`]
  lines.push(`  Status:           ${statusFlags.length > 0 ? statusFlags.join(', ') : '(none)'}`)
  lines.push(`  Name:             ${provider.name}`)
  if (provider.description) lines.push(`  Description:      ${provider.description}`)
  lines.push(`  Service Provider: ${provider.serviceProvider}`)
  lines.push(`  Payee:            ${provider.payee}`)
  lines.push(`  Active:           ${provider.isActive}`)

  if (provider.pdp) {
    const pdp = provider.pdp
    const pricePerDay = formatUSDFC(pdp.storagePricePerTibPerDay)
    const pricePerMonth = formatUSDFC(pdp.storagePricePerTibPerDay * 30n)
    lines.push('  PDP Service:')
    lines.push(`    Service URL:    ${pdp.serviceURL}`)
    lines.push(`    Location:       ${pdp.location || '(not set)'}`)
    lines.push(`    Price:          ${pricePerDay} USDFC/TiB/day (~${pricePerMonth} /month)`)
    lines.push(`    Piece Size:     ${pdp.minPieceSizeInBytes} - ${pdp.maxPieceSizeInBytes} bytes`)
    lines.push(`    IPNI Piece:     ${pdp.ipniPiece}`)
    lines.push(`    IPNI IPFS:      ${pdp.ipniIpfs}`)
    lines.push(`    Proving Period: ${pdp.minProvingPeriodInEpochs} epochs`)
    lines.push(`    Payment Token:  ${pdp.paymentTokenAddress}`)
    if (pdp.ipniPeerId) lines.push(`    IPNI Peer ID:   ${pdp.ipniPeerId}`)

    const extras = pdp.extraCapabilities ?? {}
    const extraKeys = Object.keys(extras)
    if (extraKeys.length > 0) {
      lines.push('    Capabilities:')
      for (const key of extraKeys) {
        lines.push(`      ${key}: ${decodeCapabilityValue(extras[key])}`)
      }
    }
  } else {
    lines.push('  PDP Service:      (not configured)')
  }
  return `${lines.join('\n')}\n`
}

function formatUSDFC(amount) {
  // Strip only post-decimal trailing zeros: "30" must NOT become "3".
  return formatUnits(amount, 18).replace(/\.0+$|(\.\d*?)0+$/, '$1')
}

function decodeCapabilityValue(hex) {
  if (!hex || hex === '0x') return ''
  // 0x01 is the conventional flag-byte for boolean capabilities; render
  // explicitly because utf8-decoding it produces an unprintable control char.
  if (hex.toLowerCase() === '0x01') return '(flag)'
  try {
    return hexToString(hex)
  } catch {
    return hex
  }
}

function validateDNLocation(location) {
  if (!location) return
  const parts = location.split(';')
  const seen = new Set()
  const allowed = new Set(['C', 'ST', 'L'])

  for (const part of parts) {
    const tokens = part.split('=')
    if (tokens.length !== 2 || !tokens[0] || !tokens[1]) {
      die(`Invalid --location format. Each component must be key=value.\nExample: "C=US;ST=California;L=San Francisco"`)
    }
    const [k, v] = tokens
    if (k !== k.trim() || v !== v.trim()) {
      die(`--location keys/values must not have leading/trailing whitespace: "${part}"`)
    }
    if (!allowed.has(k)) {
      die(`Invalid DN key "${k}". Allowed: C (country), ST (state), L (locality).`)
    }
    if (seen.has(k)) die(`Duplicate DN key "${k}".`)
    seen.add(k)
  }
  if (!seen.has('C')) die(`--location must include C= (country).`)
}

function normalizeCapabilities(option) {
  return Array.isArray(option) ? option : option ? [option] : []
}

function parseCapabilityFlags(option) {
  const out = {}
  for (const cap of normalizeCapabilities(option)) {
    const idx = cap.indexOf('=')
    if (idx <= 0) die(`--capability must be key=value: "${cap}"`)
    const key = cap.slice(0, idx).trim()
    const value = cap.slice(idx + 1)
    if (!key) die(`--capability key cannot be empty: "${cap}"`)
    // Contract rejects empty values; encode flag-style "key=" as 0x01.
    out[key] = value === '' ? '0x01' : value
  }
  return out
}

function die(msg) {
  console.error(`Error: ${msg}`)
  process.exit(1)
}

function buildPDPOffering(options, current, chain) {
  validateDNLocation(options.location)

  const usdfc = chain.contracts?.usdfc?.address
  const defaultToken = current?.paymentTokenAddress ?? usdfc
  if (!options['payment-token'] && !current && !usdfc) {
    die('No --payment-token provided and chain has no USDFC contract address registered.')
  }

  const offering = {
    serviceURL: options['service-url'] || options.http || current?.serviceURL || '',
    minPieceSizeInBytes: options['min-piece-size']
      ? BigInt(options['min-piece-size'])
      : (current?.minPieceSizeInBytes ?? PDP_DEFAULTS.MIN_PIECE_SIZE),
    maxPieceSizeInBytes: options['max-piece-size']
      ? BigInt(options['max-piece-size'])
      : (current?.maxPieceSizeInBytes ?? PDP_DEFAULTS.MAX_PIECE_SIZE),
    storagePricePerTibPerDay: resolvePrice(options, current),
    minProvingPeriodInEpochs: options['min-proving-period']
      ? BigInt(options['min-proving-period'])
      : (current?.minProvingPeriodInEpochs ?? PDP_DEFAULTS.MIN_PROVING_PERIOD_EPOCHS),
    location: options.location ?? current?.location ?? PDP_DEFAULTS.LOCATION,
    paymentTokenAddress: options['payment-token'] || defaultToken,
    ipniPiece: parseBoolFlag(options['ipni-piece'], current?.ipniPiece ?? PDP_DEFAULTS.IPNI_PIECE),
    ipniIpfs: parseBoolFlag(options['ipni-ipfs'], current?.ipniIpfs ?? PDP_DEFAULTS.IPNI_IPFS),
  }

  if (!offering.serviceURL) die('--service-url (or --http) is required for the PDP offering')
  if (offering.minPieceSizeInBytes >= offering.maxPieceSizeInBytes) {
    die('--min-piece-size must be smaller than --max-piece-size')
  }

  try {
    const url = new URL(offering.serviceURL)
    if (!['http:', 'https:'].includes(url.protocol)) die('--service-url must use http or https')
    if (url.protocol === 'http:') {
      console.warn('Warning: HTTP URLs are for testing only; calibnet/mainnet should use HTTPS.')
    }
  } catch {
    die(`--service-url is not a valid URL: ${offering.serviceURL}`)
  }

  return offering
}

function resolvePrice(options, current) {
  if (options['price-per-day']) return BigInt(options['price-per-day'])
  if (options['price-per-month']) return BigInt(options['price-per-month']) / 30n
  return current?.storagePricePerTibPerDay ?? PDP_DEFAULTS.STORAGE_PRICE_PER_TIB_PER_DAY
}

function parseBoolFlag(value, fallback) {
  if (value === undefined) return fallback
  if (value === 'true' || value === true) return true
  if (value === 'false' || value === false) return false
  die(`Boolean flags must be 'true' or 'false', got: ${value}`)
}

async function handleInfo(client, options) {
  if (!options.id && !options.address) die('--id or --address is required for info')

  const status = await loadStatus(client)

  let providerId
  if (options.address) {
    providerId = await getProviderIdByAddress(client, { providerAddress: options.address })
    if (providerId === null) {
      console.log(`\nNo provider found for address: ${options.address}`)
      return
    }
  } else {
    providerId = BigInt(options.id)
  }

  const provider = await getPDPProvider(client, { providerId })
  if (!provider) {
    console.log(`\nProvider #${providerId} not found`)
    return
  }

  console.log(formatProvider(provider, status.statusFor(provider.id)))
}

async function handleList(client, options, filterFn) {
  const status = await loadStatus(client)
  console.log(`\nApproved: ${status.approvedCount}, Endorsed: ${status.endorsedCount}`)

  let providers
  if (filterFn) {
    const ids = filterFn(status)
    providers = ids.length > 0 ? await getPDPProvidersByIds(client, { providerIds: ids }) : []
  } else {
    providers = await fetchAllActiveProviders(client)
  }

  if (providers.length === 0) {
    console.log('\nNo providers to display.')
    return
  }

  console.log(`\nFound ${providers.length} provider(s):\n`)
  for (const provider of providers) {
    if (!provider) continue
    console.log(formatProvider(provider, status.statusFor(provider.id)))
  }

  if (options.summary) console.log(`Total: ${providers.length}`)
}

async function fetchAllActiveProviders(client) {
  const out = []
  const limit = 50n
  let offset = 0n
  for (;;) {
    const page = await getPDPProviders(client, { onlyActive: true, offset, limit })
    out.push(...page.providers)
    if (!page.hasMore) break
    offset += limit
  }
  return out
}

async function handleRegister(client, account, options) {
  if (!options.name) die('--name is required for register')
  if (!options['service-url'] && !options.http) die('--service-url (or --http) is required for register')
  if (!options.location) {
    die('--location is required for register (DN format, e.g. "C=US;ST=California;L=San Francisco")')
  }

  const offering = buildPDPOffering(options, null, client.chain)
  const capabilities = parseCapabilityFlags(options.capability)
  const payee = options.payee || account.address
  const description = options.description || ''

  console.log(`\nRegistering provider:`)
  console.log(`  Name:        ${options.name}`)
  console.log(`  Description: ${description || '(none)'}`)
  console.log(`  Payee:       ${payee}`)
  console.log(`  Service URL: ${offering.serviceURL}`)
  console.log(`  Signer:      ${account.address}`)

  const registry = new SPRegistryService({ client })
  const hash = await registry.registerProvider({
    payee,
    name: options.name,
    description,
    pdpOffering: offering,
    capabilities,
  })
  console.log(`\nTransaction sent: ${hash}`)

  const receipt = await waitForTransactionReceipt(client, { hash })
  console.log(`Confirmed in block ${receipt.blockNumber}`)

  try {
    const event = extractRegisterProviderEvent(receipt.logs)
    console.log(`\nProvider registered with ID: ${event.args.providerId}`)
  } catch (err) {
    console.warn(`(Could not parse ProviderRegistered event: ${err.message})`)
  }
}

async function handleUpdate(client, account, options) {
  const registry = new SPRegistryService({ client })

  // Update targets the signer's own provider; --id, if given, is only a sanity check.
  const existingId = await getProviderIdByAddress(client, { providerAddress: account.address })
  const existing = existingId === null ? null : await getPDPProvider(client, { providerId: existingId })
  if (!existing) {
    console.error(`Error: Signer address ${account.address} is not a registered provider.`)
    console.error(`To register, run: node utils/sp-tool.js register --key 0x... --name ... --service-url ...`)
    process.exit(1)
  }
  if (options.id && BigInt(options.id) !== existing.id) {
    die(
      `Provider #${options.id} is owned by a different address. ` +
        `Signer ${account.address} owns provider #${existing.id}.`
    )
  }

  const hasInfoUpdate = options.name || options.description
  const hasPDPUpdate =
    options['service-url'] ||
    options.http ||
    options.location ||
    options['price-per-day'] ||
    options['price-per-month'] ||
    options['min-piece-size'] ||
    options['max-piece-size'] ||
    options['ipni-piece'] !== undefined ||
    options['ipni-ipfs'] !== undefined ||
    options['min-proving-period'] ||
    options['payment-token'] ||
    options.capability

  if (!hasInfoUpdate && !hasPDPUpdate) {
    die('No update parameters provided. Use --name/--description or PDP offering flags.')
  }

  console.log(`\nUpdating provider #${existing.id} (signer: ${account.address})`)

  if (hasInfoUpdate) {
    const name = options.name || existing.name
    const description = options.description || existing.description
    console.log(`  Name:        ${existing.name} -> ${name}`)
    console.log(`  Description: ${existing.description} -> ${description}`)
    const hash = await registry.updateProviderInfo({ name, description })
    console.log(`\nProvider info tx: ${hash}`)
    const receipt = await waitForTransactionReceipt(client, { hash })
    console.log(`Confirmed in block ${receipt.blockNumber}`)
  }

  if (hasPDPUpdate) {
    const offering = buildPDPOffering(options, existing.pdp, client.chain)
    const mergedCapabilities = parseCapabilityFlags(options.capability)
    // Pass existing hex through unchanged: encodePDPCapabilities preserves
    // hex via isHex() but utf8-encodes plain strings, which would mangle
    // binary values like 0x01 flag bytes on round-trip.
    const capabilities = { ...(existing.pdp?.extraCapabilities ?? {}), ...mergedCapabilities }

    console.log('  PDP offering: updating')
    const hash = await registry.updatePDPProduct({ pdpOffering: offering, capabilities })
    console.log(`\nPDP offering tx: ${hash}`)
    const receipt = await waitForTransactionReceipt(client, { hash })
    console.log(`Confirmed in block ${receipt.blockNumber}`)
  }

  console.log(`\nProvider #${existing.id} updated.`)
}

async function handleDeregister(client, account) {
  const registry = new SPRegistryService({ client })

  const existingId = await getProviderIdByAddress(client, { providerAddress: account.address })
  const existing = existingId === null ? null : await getPDPProvider(client, { providerId: existingId })
  if (!existing) {
    die(`Signer ${account.address} is not a registered provider; nothing to deregister.`)
  }

  console.log(`\nDeregistering provider #${existing.id} (${existing.name})...`)
  const hash = await registry.removeProvider()
  console.log(`Transaction sent: ${hash}`)

  const receipt = await waitForTransactionReceipt(client, { hash })
  console.log(`Confirmed in block ${receipt.blockNumber}`)
  console.log(`\nProvider #${existing.id} deregistered.`)
}

async function main() {
  const { command, options } = parseArgs()

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp()
    process.exit(0)
  }

  // Reject before any network calls: contract semantic flipped from
  // per-month to per-day, so silently accepting --price would be a 30x error.
  if (options.price !== undefined) {
    die(
      '--price was removed because the contract switched semantics from per-month to per-day. ' +
        'Use --price-per-day or --price-per-month explicitly to avoid a 30x error.'
    )
  }

  const knownCommands = new Set(['register', 'update', 'deregister', 'info', 'list', 'approved-list', 'endorsed-list'])
  if (!knownCommands.has(command)) {
    console.error(`Unknown command: ${command}`)
    console.error('Run with no arguments for help.')
    process.exit(1)
  }

  const { chain } = await resolveConfig(options)
  const account = makeAccount(options, command)
  const client = buildClient({ chain, account, rpcUrl: options['rpc-url'] })
  if (account) console.log(`Signer: ${account.address}`)

  switch (command) {
    case 'register':
      return handleRegister(client, account, options)
    case 'update':
      return handleUpdate(client, account, options)
    case 'deregister':
      return handleDeregister(client, account)
    case 'info':
      return handleInfo(client, options)
    case 'list':
      return handleList(client, options)
    case 'approved-list':
      return handleList(client, options, (status) => status.approvedIds)
    case 'endorsed-list':
      return handleList(client, options, (status) => status.endorsedIds)
  }
}

function printHelp() {
  console.log(`SP Registry CLI Tool

Usage: node utils/sp-tool.js <command> [options]

Read commands (no key required):
  info             Show one provider, with status flags (approved, endorsed)
                   Args: --id <n> | --address <0x...>
  list             List all active providers, with status flags
  approved-list    List providers in the FWSS approved set
  endorsed-list    List providers in the Endorsements set

Write commands (require --key):
  register         Register signer as a new provider
                   Required: --name, --service-url (or --http), --location
                   Pays REGISTRATION_FEE (5 FIL on mainnet/calibnet)
  update           Update signer's existing provider
                   Any of: --name, --description, --service-url, --location,
                           --price-per-day | --price-per-month, --min-piece-size,
                           --max-piece-size, --ipni-piece, --ipni-ipfs,
                           --min-proving-period, --payment-token, --capability
  deregister       Deregister signer's provider

Network:
  --network <n>    'mainnet' | 'calibration' (default) | 'devnet'
  --rpc-url <url>  Override the chain's default RPC endpoint
  --devnet-info    Path to devnet-info.json (defaults to ~/.foc-devnet/state/latest)
                   Or set NETWORK=devnet / DEVNET_INFO_PATH env vars

Authentication:
  --key <0x...>    Private key for signing (or PRIVATE_KEY env)

Identification:
  --id <n>         Provider ID (info / update sanity check)
  --address <0x>   Provider address (info)

Provider info:
  --name <s>       Provider name
  --description <s>
  --payee <0x>     Payment recipient (register; defaults to signer)

PDP offering (register / update):
  --service-url <url>      Provider HTTP endpoint
  --http <url>             Alias for --service-url
  --location <DN>          DN format, e.g. "C=US;ST=California;L=San Francisco"
  --price-per-day <n>      Storage price per TiB per day (USDFC base units, 18 dec)
  --price-per-month <n>    Convenience: monthly price; converted /30 internally
                           NOTE: --price was removed (semantic switched from
                           per-month to per-day; would have produced a 30x error)
  --min-piece-size <n>     Bytes (default: 1 MiB, matches Curio)
  --max-piece-size <n>     Bytes (default: 64 GiB, matches Curio)
  --ipni-piece <bool>      true | false (default: true)
  --ipni-ipfs <bool>       true | false (default: true)
  --min-proving-period <n> Epochs (default: 1440 ~12h, matches Curio)
  --payment-token <0x>     ERC-20 address (default: chain USDFC)
  --capability k=v         Repeatable; arbitrary capability tags
                           Empty values (e.g. "dev=") are encoded as 0x01
                           flag bytes since the contract requires non-empty
                           capability values

Examples:
  # List providers on calibnet, show status flags
  node utils/sp-tool.js list

  # Show only the FWSS-approved set
  node utils/sp-tool.js approved-list

  # Test on local devnet
  NETWORK=devnet node utils/sp-tool.js list

  # Register on calibnet (signer pays 5 FIL)
  node utils/sp-tool.js register --key 0x... \\
    --name "My SP" --service-url https://sp.example.com \\
    --location "C=AU;ST=NSW;L=Sydney"

  # Update price (per-month convenience -> per-day on chain)
  node utils/sp-tool.js update --key 0x... --price-per-month 6000000000000000000

  # Update PDP capabilities
  node utils/sp-tool.js update --key 0x... --capability tier=premium --capability dev=
`)
}

main().catch((error) => {
  console.error(`\nError: ${error.message}`)
  if (error.cause) console.error(`Caused by: ${error.cause.message}`)
  process.exit(1)
})
