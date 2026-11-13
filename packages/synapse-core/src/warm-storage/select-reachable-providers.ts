import type { Address, Chain, Client, Transport } from 'viem'
import { NoEndorsedProviderError, type UnreachableProvider } from '../errors/warm-storage.ts'
import { ping } from '../sp/ping.ts'
import type { MetadataObject } from '../utils/metadata.ts'
import { fetchProviderSelectionInput } from './fetch-provider-selection-input.ts'
import type { ResolvedLocation } from './location-types.ts'
import { selectProviders } from './select-providers.ts'

export namespace selectReachableProviders {
  export type OptionsType = {
    /** Client wallet address (for dataset lookup) */
    address: Address
    /** Desired metadata for dataset matching (empty object matches only empty-metadata datasets). Defaults to `{}`. */
    metadata?: MetadataObject
    /** Number of providers to select. Defaults to 1. */
    count?: number
    /** Provider IDs to exclude, e.g. providers already holding a copy. */
    excludeProviderIds?: bigint[]
    /**
     * Require the first location to come from an endorsed provider. The other
     * locations accept any approved provider. Defaults to false, where every
     * location accepts any approved provider.
     */
    requireEndorsedPrimary?: boolean
    /** Timeout for each provider ping, in milliseconds. Defaults to the {@link ping} default. */
    timeout?: number
    /**
     * The signal to abort the selection. It is checked before and after the
     * selection input is read and after each ping, and it aborts pings in
     * flight. On abort, the selection rejects with `signal.reason`.
     */
    signal?: AbortSignal
  }

  /** Ranked locations whose providers answered a ping, up to `count` length. */
  export type OutputType = ResolvedLocation[]

  /** Also rejects with `signal.reason` when `signal` aborts. */
  export type ErrorType = fetchProviderSelectionInput.ErrorType | NoEndorsedProviderError
}

type PingOutcome = { ok: true; location: ResolvedLocation } | ({ ok: false } & UnreachableProvider)

/**
 * Select providers that answer a ping.
 *
 * Fetches the selection input with {@link fetchProviderSelectionInput}, ranks
 * candidates with {@link selectProviders}, and pings them with {@link ping}.
 * A candidate that fails its ping is excluded and the next one is tried, so
 * every returned location is from a provider that answered.
 *
 * With `requireEndorsedPrimary`, every endorsed candidate for the first
 * location is pinged concurrently and the highest-ranked one that answers
 * wins, so a faster, lower-ranked provider cannot displace it. The other
 * locations are pinged one candidate at a time.
 *
 * @example
 * ```ts
 * import { selectReachableProviders } from '@filoz/synapse-core/warm-storage'
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const [primary, secondary] = await selectReachableProviders(client, {
 *   address: '0x1234567890123456789012345678901234567890',
 *   metadata: { source: 'my-app' },
 *   count: 2,
 *   requireEndorsedPrimary: true,
 * })
 *
 * console.log(primary.provider.id, primary.dataSetId)
 * ```
 *
 * @param client - The client to use to fetch the selection input.
 * @param options - {@link selectReachableProviders.OptionsType}
 * @returns Ranked locations {@link selectReachableProviders.OutputType}.
 *   May be shorter than `count` if fewer reachable providers are available.
 * @throws Errors {@link selectReachableProviders.ErrorType}. Throws
 *   `NoEndorsedProviderError` when `requireEndorsedPrimary` is set and no
 *   endorsed provider is eligible or answers, and with `signal.reason` when
 *   `signal` aborts.
 */
export async function selectReachableProviders(
  client: Client<Transport, Chain>,
  options: selectReachableProviders.OptionsType
): Promise<selectReachableProviders.OutputType> {
  const { signal, timeout } = options
  const count = options.count ?? 1
  const metadata = options.metadata ?? {}

  signal?.throwIfAborted()
  const input = await fetchProviderSelectionInput(client, { address: options.address })
  signal?.throwIfAborted()

  const excludeProviderIds = [...(options.excludeProviderIds ?? [])]
  const results: ResolvedLocation[] = []

  for (let i = 0; i < count; i++) {
    const endorsedSlot = options.requireEndorsedPrimary === true && i === 0
    const failures: UnreachableProvider[] = []
    let selected: ResolvedLocation | undefined

    while (selected == null) {
      if (endorsedSlot && input.endorsedIds.length === 0) break

      // There are few endorsed providers, so check the complete ranked pool
      // concurrently. Other slots check one candidate at a time.
      const candidates = selectProviders({
        ...input,
        endorsedIds: endorsedSlot ? input.endorsedIds : [],
        count: endorsedSlot ? input.endorsedIds.length : 1,
        excludeProviderIds,
        metadata,
      })
      if (candidates.length === 0) break

      // Pings still in flight after a winner is found are aborted.
      const batch = new AbortController()
      const batchSignal = signal == null ? batch.signal : AbortSignal.any([signal, batch.signal])
      const checks = candidates.map(async (location): Promise<PingOutcome> => {
        try {
          await ping(location.provider.pdp.serviceURL, { timeout, signal: batchSignal })
          return { ok: true, location }
        } catch (error) {
          return { ok: false, location, error }
        }
      })

      // Await in ranked order so a faster, lower-ranked provider cannot
      // displace a reachable higher-ranked one.
      for (const check of checks) {
        const outcome = await check
        signal?.throwIfAborted()
        excludeProviderIds.push(outcome.location.provider.id)
        if (outcome.ok) {
          selected = outcome.location
          break
        }
        failures.push({ location: outcome.location, error: outcome.error })
      }
      batch.abort()
    }

    if (selected == null) {
      if (endorsedSlot) {
        throw new NoEndorsedProviderError(failures)
      }
      break
    }

    // selectProviders only flags endorsement within the pool it was given
    results.push({ ...selected, endorsed: input.endorsedIds.includes(selected.provider.id) })
  }

  return results
}
