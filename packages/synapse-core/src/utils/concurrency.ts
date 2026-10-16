import { ValidationError } from '../errors/base.ts'

/**
 * A function that runs a task once fewer than its limit of tasks are running.
 */
export type Limit = <T>(task: () => Promise<T>) => Promise<T>

/**
 * Create a limit that runs at most `concurrency` tasks at a time, in call order.
 *
 * @param concurrency - The maximum number of tasks running at the same time. `Infinity` means no limit.
 * @returns A function that runs a task when a slot is free and resolves with its result.
 *
 * @example
 * ```ts
 * import { createLimit } from '@filoz/synapse-core/utils'
 *
 * const limit = createLimit(2)
 * const results = await Promise.all(urls.map((url) => limit(() => fetch(url))))
 * ```
 */
export function createLimit(concurrency: number): Limit {
  if (!(concurrency >= 1)) {
    throw new ValidationError('`concurrency` must be at least 1.')
  }
  let active = 0
  const queue: (() => void)[] = []
  return async (task) => {
    if (active < concurrency) {
      active++
    } else {
      // The finishing task hands its slot over, so a new caller can't take it first.
      await new Promise<void>((resolve) => queue.push(resolve))
    }
    try {
      return await task()
    } finally {
      const next = queue.shift()
      if (next) {
        next()
      } else {
        active--
      }
    }
  }
}

/**
 * Like `Promise.all(items.map(fn))`, but runs at most `concurrency` calls at a time.
 *
 * @param items - The inputs.
 * @param concurrency - The maximum number of concurrent calls.
 * @param fn - The async work per item.
 * @returns The results, in input order.
 *
 * @example
 * ```ts
 * import { mapWithLimit } from '@filoz/synapse-core/utils'
 *
 * const pieces = await mapWithLimit(dataSets, 4, (dataSet) => loadPieces(dataSet))
 * ```
 */
export function mapWithLimit<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const limit = createLimit(concurrency)
  return Promise.all(items.map((item, index) => limit(() => fn(item, index))))
}
