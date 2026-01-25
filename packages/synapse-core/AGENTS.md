# Synapse Core

A JavaScript/TypeScript standard library for interacting with Filecoin Onchain Cloud smart contracts.
It uses [viem](https://viem.sh/) and is structured as single purpose functions (actions) similar to viem actions.

## Filecoin Onchain Cloud smart contracts

- PDP Verifier: Proof of Data Possession (PDP) - Data Verification Service Contract
  - [design document](https://github.com/FilOzone/pdp/blob/main/docs/design.md)
  - [source code](https://github.com/FilOzone/pdp)
  - folder `/src/pdp-verifier`
- Filecoin Pay: The Filecoin Pay V1 contract enables ERC20 token payment flows through "rails" - automated payment channels between payers and recipients. The contract supports continuous rate based payments, one-time transfers, and payment validation during settlement.
  - [design document](https://github.com/FilOzone/filecoin-pay/blob/main/README.md)
  - [source code](https://github.com/FilOzone/filecoin-pay)
  - folder: `/src/pay`
- FWSS Filecoin Warm Storage Service, a comprehensive service contract that combines PDP (Proof of Data Possession) verification with integrated payment rails for data set management.
  - [design document](https://github.com/FilOzone/filecoin-services/blob/main/SPEC.md)
  - [source code](https://github.com/FilOzone/filecoin-services)
  - folder: `/src/warm-storage`

## Formating and Linting

Always run `pnpm run lint:fix` at the end to make sure all the changes are formatted and linted.

## Generating an new action

When generating an action in each smart contract folder, follow these guidelines.

An example of a generated action set can be found in `src/warm-storage/get-approved-providers.ts`.

Follow the links above for each contract to understand the interfaces and follow the ABI inside `src/abis/generated.ts`.

Start by creating a new file using the ABI function in kebad case, if the function name is `operatorApprovals` the file should be `operator-approvals.ts`.

ALWAYS create a test file for each action in the test folder `test`.

### Documenting an action

All actions must include comprehensive JSDoc with:

1. Function description - What the action does
2. `@example` block - Complete working example showing:

    - Required imports (`createClient`, `http`, action imports)
    - Client setup with chain and transport
    - Action usage with realistic parameters
    - Expected return value handling (if applicable)
    - Do not use twoslash

3. @param tags - For each parameter (client, parameters)
4. @returns tag - Description of the return value

Example:

```ts
/**
 * Get approved provider IDs with optional pagination
 *
 * For large lists, use pagination to avoid gas limit issues. If limit=0,
 * returns all remaining providers starting from offset.
 *
 * @param client - The client to use to get the approved providers.
 * @param options - {@link getApprovedProviders.OptionsType}
 * @returns Array of approved provider IDs {@link getApprovedProviders.OutputType}
 * @throws Errors {@link getApprovedProviders.ErrorType}
 *
 * @example
 * ```ts
 * import { getApprovedProviders } from '@filoz/synapse-core/warm-storage'
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * // Get first 100 providers
 * const providerIds = await getApprovedProviders(client, {
 *   offset: 0n,
 *   limit: 100n,
 * })
 *
 * console.log(providerIds)
 * ```
 */
```

### Action Namespace

All actions MUST include a namespace with the following components:

Example:

```ts
export namespace getApprovedProviders {
  export type OptionsType = {
    /** Starting index (0-based). Use 0 to start from beginning. Defaults to 0. */
    offset?: bigint
    /** Maximum number of providers to return. Use 0 to get all remaining providers. Defaults to 0. */
    limit?: bigint
    /** Warm storage contract address. If not provided, the default is the storage view contract address for the chain. */
    contractAddress?: Address
  }

  export type ContractOutputType = ContractFunctionReturnType<
    typeof storageViewAbi,
    'pure' | 'view',
    'getApprovedProviders'
  >

  /** Array of approved provider IDs */
  export type OutputType = bigint[]

  export type ErrorType = asChain.ErrorType | ReadContractErrorType
}

export async function getApprovedProviders(...) { ... }
```

#### `OptionsType`

Should be an object with the contract call arguments plus and optional contract address.
Use the contract source code to document each argument property.

```ts
export type OptionsType = {
  /** Starting index (0-based). Use 0 to start from beginning. Defaults to 0. */
  offset?: bigint
  /** Maximum number of providers to return. Use 0 to get all remaining providers. Defaults to 1000. */
  limit?: bigint
  /** Warm storage contract address. If not provided, the default is the storage view contract address for the chain. */
  contractAddress?: Address
}
```

#### `OutputType`

```ts
/** Array of approved provider IDs */
export type OutputType = ContractFunctionReturnType<
  typeof storageViewAbi,
  'pure' | 'view',
  'getApprovedProviders'
>
```

When the contract function return type is an array try to convert into an object using the contract source code to choose the best descritive property names. When the return type is already an object inline it with documentation for each property.

```ts
  export type ContractOutputType = ContractFunctionReturnType<typeof storageAbi, 'pure' | 'view', 'getServicePrice'>

  /**
   * The service price for the warm storage.
   */
  export type OutputType = {
    /** Price per TiB per month without CDN (in base units) */
    pricePerTiBPerMonthNoCDN: bigint
    /** CDN egress price per TiB (usage-based, in base units) */
    pricePerTiBCdnEgress: bigint
    /** Cache miss egress price per TiB (usage-based, in base units) */
    pricePerTiBCacheMissEgress: bigint
    /** Token address for payments */
    tokenAddress: string
    /** Number of epochs per month */
    epochsPerMonth: bigint
    /** Minimum monthly charge for any dataset size (in base units) */
    minimumPricePerMonth: bigint
  }
```

#### `ErrorType`

Check all actions called inside the action for a namespaced `ErrorType` or viem errors (`<actionName>ErrorType`)

```ts
export type ErrorType = asChain.ErrorType | ReadContractErrorType
```

### Actions

#### Call function

The Call function returns the parameters object for a contract call NOT the result of a contract call.

When the action transforms the contract output, the Call function MUST document the need for using the Parse function to get the same output type as the action.

All read and write action require a call function to enable composition with other viem action:

```ts

/**
 * Create a call to the getServicePrice function
 *
 * This function is used to create a call to the getServicePrice function for use with the multicall or readContract function.
 *
 * @param options - {@link getServicePriceCall.OptionsType}
 * @returns The call to the getServicePrice function {@link getServicePriceCall.OutputType}
 * @throws Errors {@link getServicePriceCall.ErrorType}
 *
 * @example
 * ```ts
 * import { getServicePriceCall } from '@filoz/synapse-core/warm-storage'
 * import { createPublicClient, http } from 'viem'
 * import { multicall } from 'viem/actions'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const results = await multicall(client, {
 *   contracts: [
 *     getServicePriceCall({ chain: calibration }),
 *   ],
 * })
 *
 * console.log(results[0])
 * ```
 */
export function getServicePriceCall(options: getServicePriceCall.OptionsType) {
  const chain = asChain(options.chain)
  return {
    abi: chain.contracts.storage.abi,
    address: options.address ?? chain.contracts.storage.address,
    functionName: 'getServicePrice',
    args: [],
  } satisfies getServicePriceCall.OutputType
}

```

They should have their own namespaced types

```ts
export namespace getServicePriceCall {
  export type OptionsType = {
    /** Warm storage contract address. If not provided, the default is the storage contract address for the chain. */
    contractAddress?: Address
    /** The chain to use to get the service price. */
    chain: Chain
  }

  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<typeof storageAbi, 'pure' | 'view', 'getServicePrice'>
}
```

The call function enables these use cases:

- sendCalls - Batch multiple calls in one transaction
- sendTransaction with calls - Send transaction with multiple operations
- multicall - Execute multiple calls in parallel
- estimateContractGas - Estimate gas costs
- simulateContract - Simulate execution

#### Read-Only Actions

For view/pure functions that only read state:
  
- Use readContract from viem/actions
- Should use the Call function internally
- If needed should use the Parse function internally

#### Write Actions - Mutate-Based

For state-changing functions, both variants MUST be implemented:

##### Standard Async Variant

- Always use simulateContract from viem/actions before writeContract
- Uses writeContract from viem/actions
- Returns transaction hash
- Async operation that doesn't wait for confirmation
- Should use the call function internally

##### Sync Variant

- Named with Sync suffix (e.g., setOperatorSync, depositSync)
- Always use the standard async variant action
- Waits for transaction confirmation
- Returns both the receipt and extracted event data .ie `{ receipt, event }`
- MUST use Extract Event function to get return values (not simulateContract)
- MUST have an extra option called `onHash` that is a callback function to be called with the hash before waiting for the receipt.

### Extract Event function (for write mutate based actions)

Should use the contract function name and not the event name, like `extractSetOperatorApprovalEvent` not `extractOperatorApprovalUpdatedEvent`

Required for all actions that emit events:

```typescript
/**
 * Extracts the `EventName` event from logs.
 *
 * @param logs - The logs.
 * @returns The `EventName` event.
 */
export function extractSetOperatorApprovalEvent(logs: Log[]) {
  const [log] = parseEventLogs({
    abi: Abis.contractName,
    logs,
    eventName: 'EventName',
    strict: true,
  })
  if (!log) throw new Error('`EventName` event not found.')
  return log
}
```

#### Parse function

When the `ContractOutputType` is different from the `OutputType` we need a parse function to transform the contract output into the action output. It should called `parse<actionName>` .ie `parseGetServicePrice`.

## Decision-Making

When encountering situations that require judgment:

- **Specification ambiguities**: Prompt developer for clarification
- **Missing contract details**: Request ABI or specification update
- **Event structure uncertainty**: Ask for event definition
- **Parameter transformations**: Confirm expected input/output formats
- **Edge cases**: Discuss handling strategy with developer

## Naming Conventions

- Action names should match contract function names (in camelCase)
- Event names in Extract Event function should match contract event names exactly
- Namespace components should be exported within the action's namespace

## Testing

Tests should live in the `/test` folder in `*action-name*.test.ts` files.

Reference contract source code for expected behavior and always create tests for all the functions.

Use mocks and constants inside `/mocks` to test the actions.

See `test/get-service-price.test.ts` for a comprehensive example of test patterns and structure.

Run the tests with `pnpm exec playwright-test "test/get-service-price.test.ts" --mode node`
