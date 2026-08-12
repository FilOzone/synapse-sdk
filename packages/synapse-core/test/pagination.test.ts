import assert from 'assert'
import { type Page, paginate } from '../src/pagination.ts'

describe('paginate', () => {
  it('iterates through pages from the default cursor', async () => {
    const cursors: bigint[] = []
    const items = await Array.fromAsync(
      paginate(async ({ cursor }): Promise<Page<number>> => {
        cursors.push(cursor)
        if (cursor === 0n) return { items: [1, 2], nextCursor: 2n }
        return { items: [3] }
      })
    )

    assert.deepEqual(items, [1, 2, 3])
    assert.deepEqual(cursors, [0n, 2n])
  })

  it('supports a non-zero initial cursor and empty intermediate pages', async () => {
    const items = await Array.fromAsync(
      paginate(
        async ({ cursor }): Promise<Page<number>> => (cursor === 5n ? { items: [], nextCursor: 8n } : { items: [8] }),
        { cursor: 5n }
      )
    )

    assert.deepEqual(items, [8])
  })

  it('rejects a non-advancing cursor', async () => {
    await assert.rejects(
      Array.fromAsync(paginate(async ({ cursor }) => ({ items: [], nextCursor: cursor }))),
      /`nextCursor` must advance beyond the current cursor\./
    )
  })

  it('rejects a negative initial cursor before fetching', async () => {
    let calls = 0
    await assert.rejects(
      Array.fromAsync(
        paginate(
          async () => {
            calls += 1
            return { items: [] }
          },
          { cursor: -1n }
        )
      ),
      /`cursor` must be greater than or equal to 0n\./
    )
    assert.equal(calls, 0)
  })
})
