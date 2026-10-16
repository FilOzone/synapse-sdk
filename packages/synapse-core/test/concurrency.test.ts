import assert from 'assert'
import { createLimit, mapWithLimit } from '../src/utils/concurrency.ts'

const tick = () => new Promise((resolve) => setTimeout(resolve, 1))

describe('createLimit', () => {
  it('runs at most `concurrency` tasks at a time, in call order', async () => {
    const limit = createLimit(2)
    let active = 0
    let peak = 0
    const started: number[] = []
    await Promise.all(
      [0, 1, 2, 3, 4].map((n) =>
        limit(async () => {
          started.push(n)
          active++
          peak = Math.max(peak, active)
          await tick()
          active--
        })
      )
    )
    assert.equal(peak, 2)
    assert.deepEqual(started, [0, 1, 2, 3, 4])
  })

  it('frees the slot when a task rejects', async () => {
    const limit = createLimit(1)
    await assert.rejects(
      limit(async () => {
        throw new Error('boom')
      }),
      /boom/
    )
    assert.equal(await limit(async () => 'next'), 'next')
  })

  it('does not let a new caller take a slot that is being handed over', async () => {
    const limit = createLimit(1)
    let active = 0
    let peak = 0
    const task = async () => {
      active++
      peak = Math.max(peak, active)
      await tick()
      active--
    }
    let release: () => void = () => undefined
    const first = limit(() => new Promise<void>((resolve) => (release = resolve)))
    const queued = limit(task)
    let late: Promise<void> = Promise.resolve()
    release()
    // Runs right after `first` frees its slot, before `queued` resumes.
    queueMicrotask(() => {
      late = limit(task)
    })
    await first
    await Promise.all([queued, late])
    assert.equal(peak, 1)
  })

  it('rejects a concurrency below 1', () => {
    assert.throws(() => createLimit(0), /at least 1/)
  })
})

describe('mapWithLimit', () => {
  it('returns results in input order', async () => {
    const results = await mapWithLimit([3, 1, 2], 2, async (n, index) => {
      await new Promise((resolve) => setTimeout(resolve, n))
      return `${index}:${n}`
    })
    assert.deepEqual(results, ['0:3', '1:1', '2:2'])
  })
})
