import { ValidationError } from './errors/base.ts'

/** Options shared by actions that return one bounded page. */
export type PaginationOptions = {
  /** Opaque continuation cursor returned by the previous page. Defaults to `0n`. */
  cursor?: bigint
  /** Maximum number of items to return. Must be greater than `0n`. */
  limit?: bigint
}

/** One bounded page of items and its opaque continuation cursor. */
export type Page<T> = {
  items: T[]
  nextCursor?: bigint
}

/** A page that also reports the collection's total size. */
export type PageWithTotal<T> = Page<T> & {
  total: bigint
}

/** Validate and resolve pagination options for an action. */
export function resolvePagination(options: PaginationOptions, defaultLimit: bigint) {
  const cursor = options.cursor ?? 0n
  const limit = options.limit ?? defaultLimit
  if (cursor < 0n) {
    throw new ValidationError('`cursor` must be greater than or equal to 0n.')
  }
  if (limit <= 0n) {
    throw new ValidationError('`limit` must be greater than 0n.')
  }
  return { cursor, limit }
}

export namespace resolvePagination {
  export type ErrorType = ValidationError
}

/**
 * Convert a contract response fetched with `limit + 1` into a bounded page.
 *
 * The extra item is used only to detect whether another page exists. When it
 * does, the item is removed and `getNextCursor` derives the continuation
 * cursor from the last visible item.
 */
export function pageFromLookahead<T>(
  source: readonly T[],
  limit: bigint,
  getNextCursor: (lastItem: T) => bigint
): Page<T> {
  const hasMore = BigInt(source.length) > limit
  const items = Array.from(hasMore ? source.slice(0, -1) : source)
  if (!hasMore) {
    return { items }
  }

  const lastItem = items.at(-1)
  if (lastItem == null) {
    throw new ValidationError('A look-ahead page must contain at least one visible item.')
  }
  return { items, nextCursor: getNextCursor(lastItem) }
}

export namespace paginate {
  export type OptionsType = {
    /** Cursor to use for the first page. Defaults to `0n`. */
    cursor?: bigint
  }

  export type GetPage<T> = (options: { cursor: bigint }) => Promise<Page<T>>
  export type OutputType<T> = AsyncGenerator<T>
  export type ErrorType = ValidationError
}

/**
 * Iterate over every item returned by a cursor-paginated action.
 *
 * The generator passes each returned `nextCursor` back to `getPage`. Cursors
 * are opaque: callers must not calculate the next value themselves. A
 * repeated or non-advancing cursor is rejected to prevent an infinite loop.
 *
 * @example Stream items as pages are fetched
 * ```ts
 * import { paginate } from '@filoz/synapse-core'
 * import { getClientDataSetIds } from '@filoz/synapse-core/warm-storage'
 *
 * for await (const dataSetId of paginate(({ cursor }) =>
 *   getClientDataSetIds(client, { address, cursor })
 * )) {
 *   console.log(dataSetId)
 * }
 * ```
 *
 * @example Accumulate every item into an array
 * ```ts
 * import { paginate } from '@filoz/synapse-core'
 * import { getClientDataSetIds } from '@filoz/synapse-core/warm-storage'
 *
 * const dataSetIds = await Array.fromAsync(
 *   paginate(({ cursor }) => getClientDataSetIds(client, { address, cursor }))
 * )
 * ```
 *
 * @param getPage - Function that fetches one page for the supplied cursor.
 * @param options - Initial pagination options.
 * @returns An async generator that yields items from every page.
 */
export async function* paginate<T>(
  getPage: paginate.GetPage<T>,
  options: paginate.OptionsType = {}
): paginate.OutputType<T> {
  let cursor = options.cursor ?? 0n
  if (cursor < 0n) {
    throw new ValidationError('`cursor` must be greater than or equal to 0n.')
  }

  while (true) {
    const page = await getPage({ cursor })
    if (page.nextCursor != null && page.nextCursor <= cursor) {
      throw new ValidationError('`nextCursor` must advance beyond the current cursor.')
    }
    for (const item of page.items) {
      yield item
    }
    if (page.nextCursor == null) {
      return
    }
    cursor = page.nextCursor
  }
}
