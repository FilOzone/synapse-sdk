/**
 * Content-Security-Policy behavior (Node only).
 *
 * A Content-Security-Policy whose `script-src` lacks 'wasm-unsafe-eval' makes
 * WebAssembly compilation throw. Importing the package must still work; only
 * PieceCID hashing should fail, with an error naming the missing directive.
 *
 * Each case runs in a fresh Node process with `WebAssembly.Module` replaced by
 * one that throws, the way a strict CSP does in browsers, so the module graph
 * is not shared with other tests.
 */

import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { assert } from 'chai'

const run = promisify(execFile)
// Import the build output: Node's TypeScript type stripping itself compiles
// WebAssembly, so `.ts` sources cannot be loaded once compilation is blocked.
// Tests are bundled into a temp dir, so resolve from the package root (cwd).
const entry = pathToFileURL(resolve('dist/src/index.js')).href

async function runBlocked(body: string): Promise<string> {
  const script = `
    WebAssembly.Module = function () {
      throw new WebAssembly.CompileError('blocked by Content-Security-Policy')
    }
    const Core = await import(${JSON.stringify(entry)})
    ${body}
  `
  const { stdout } = await run(process.execPath, ['--input-type=module', '--eval', script])
  return stdout.trim()
}

describe('Content-Security-Policy without wasm-unsafe-eval', () => {
  it('imports when WebAssembly compilation is blocked', async () => {
    const out = await runBlocked('console.log(typeof Core.piece.calculate)')
    assert.strictEqual(out, 'function')
  })

  it('rejects PieceCID hashing with a wasm-unsafe-eval hint', async () => {
    const out = await runBlocked(`
      try {
        await Core.piece.calculate(new Uint8Array(127))
        console.log('no error')
      } catch (err) {
        console.log(err.message)
      }
    `)
    assert.include(out, "'wasm-unsafe-eval'")
  })
})
