/**
 * Shared termination flow behind StorageManager.terminateService and
 * StorageContext.terminate. The callers differ only in how the provider's
 * PDP endpoint is found: a context already holds it, the manager resolves
 * it from the data set's provider registration. The endpoint resolver is
 * lazy because the on-chain path never needs it.
 */

import {
  DataSetAlreadyTerminatedError,
  TerminateServicePendingError,
  WaitForTerminateServiceNotFoundError,
} from '@filoz/synapse-core/errors'
import { calculateAccountDebt, accounts as payAccounts } from '@filoz/synapse-core/pay'
import {
  terminateService as spTerminateService,
  terminateServiceStatusUrl,
  waitForTerminateService,
} from '@filoz/synapse-core/sp'
import { extractPDPPaymentTerminatedEvent, terminateServiceSync } from '@filoz/synapse-core/warm-storage'
import { getBlockNumber } from 'viem/actions'
import type { Synapse } from '../synapse.ts'
import type { TerminateServiceOptions, TerminateServiceResult } from '../types.ts'
import { createError } from '../utils/index.ts'

export async function terminateServiceFlow(
  synapse: Synapse,
  options: TerminateServiceOptions,
  getServiceURL: () => Promise<string>
): Promise<TerminateServiceResult> {
  const { dataSetId, onSubmitted } = options

  if (options.onChain === true) {
    const { receipt } = await terminateServiceSync(synapse.client, {
      dataSetId,
      onHash: onSubmitted,
    })
    const event = extractPDPPaymentTerminatedEvent(receipt.logs)
    return { txHash: receipt.transactionHash, dataSetId, endEpoch: event.args.endEpoch }
  }

  // Immediate termination settles the payer's account in full. Best-effort
  // pre-check: catches a clear shortfall before signing, but lockup keeps
  // accruing until the provider's tx lands, so a marginal account can still
  // revert SP-side (surfacing as the rejected/404 path).
  const payerAddress = synapse.client.account.address
  const [accountInfo, currentEpoch] = await Promise.all([
    payAccounts(synapse.client, { address: payerAddress }),
    getBlockNumber(synapse.client, { cacheTime: 0 }),
  ])
  const debt = calculateAccountDebt({
    funds: accountInfo.funds,
    lockupCurrent: accountInfo.lockupCurrent,
    lockupRate: accountInfo.lockupRate,
    lockupLastSettledAt: accountInfo.lockupLastSettledAt,
    currentEpoch,
  })
  if (debt > 0n) {
    throw createError(
      'StorageManager',
      'terminateService',
      `Account cannot settle its lockup in full (shortfall: ${debt} of the payment token's base units); deposit funds, or terminate on-chain (onChain: true) to wind down over the lockup period instead`
    )
  }

  const serviceURL = await getServiceURL()
  const client = synapse.sessionClient ?? synapse.client

  let statusUrl: string
  try {
    ;({ statusUrl } = await spTerminateService(client, { serviceURL, dataSetId }))
  } catch (err) {
    if (DataSetAlreadyTerminatedError.is(err)) {
      return { dataSetId, endEpoch: err.endEpoch }
    }
    if (TerminateServicePendingError.is(err)) {
      // A request we queued earlier may still be tracking; resume it.
      // Provider-initiated terminations are not pollable: rethrow.
      try {
        const status = await waitForTerminateService({
          statusUrl: terminateServiceStatusUrl({ serviceURL, dataSetId }),
          onTxHash: onSubmitted,
        })
        return {
          txHash: status.terminationTxHash === '' ? undefined : status.terminationTxHash,
          dataSetId,
          endEpoch: status.serviceTerminationEpoch,
        }
      } catch (waitErr) {
        if (WaitForTerminateServiceNotFoundError.is(waitErr)) {
          throw err
        }
        throw waitErr
      }
    }
    throw err
  }

  const status = await waitForTerminateService({ statusUrl, onTxHash: onSubmitted })
  return {
    txHash: status.terminationTxHash === '' ? undefined : status.terminationTxHash,
    dataSetId,
    endEpoch: status.serviceTerminationEpoch,
  }
}
