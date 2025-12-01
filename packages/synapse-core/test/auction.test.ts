import assert from 'assert'
import { auctionPriceAt, HALVING_SECONDS } from '../src/auction/auction.ts'
import { randU256 } from '../src/utils/rand.ts'

function checkExactDecay(startPrice: bigint) {
  const auctionInfo = {
    startPrice,
    startTime: randU256(),
    token: '0x0000000000004946c0e9F43F4Dee607b0eF1fA1c' as const,
  }
  assert.equal(auctionPriceAt(auctionInfo, auctionInfo.startTime), startPrice)
  assert.equal(auctionPriceAt(auctionInfo, auctionInfo.startTime + HALVING_SECONDS), startPrice / 2n)
  assert.equal(auctionPriceAt(auctionInfo, auctionInfo.startTime + 2n * HALVING_SECONDS), startPrice / 4n)
  assert.equal(auctionPriceAt(auctionInfo, auctionInfo.startTime + 4n * HALVING_SECONDS), startPrice / 16n)
  assert.equal(auctionPriceAt(auctionInfo, auctionInfo.startTime + 6n * HALVING_SECONDS), startPrice / 64n)
  assert.equal(auctionPriceAt(auctionInfo, auctionInfo.startTime + 8n * HALVING_SECONDS), startPrice / 256n)
  assert.equal(auctionPriceAt(auctionInfo, auctionInfo.startTime + 10n * HALVING_SECONDS), startPrice / 1024n)
}

const MAX_DECAY = ((192n * 10n ** 18n - 1n) * HALVING_SECONDS) / 10n ** 18n

describe('auctionPriceAt', () => {
  it('has expected halving period', () => {
    checkExactDecay(10000000000n)
    checkExactDecay(10000000000000000n)
    checkExactDecay(9000000000000000000n)
    checkExactDecay(11000000000000000000n)
    checkExactDecay(13000000000000000000n)
    checkExactDecay(1300000000000000000000000n)
  })

  it('matches Dutch.sol behavior with uint256.max price', () => {
    const auctionInfo = {
      startPrice: 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffn,
      startTime: randU256(),
      token: '0x0000000000004946c0e9F43F4Dee607b0eF1fA1c' as const,
    }
    assert.equal(auctionPriceAt(auctionInfo, auctionInfo.startTime), auctionInfo.startPrice)
    assert.equal(
      auctionPriceAt(auctionInfo, auctionInfo.startTime + 10000000n),
      12852371374314799914919560702529050018701224735495877087613516410500n
    )
    assert.equal(auctionPriceAt(auctionInfo, auctionInfo.startTime + 50000000n), 1950746206018947071427216775n)
    assert.equal(auctionPriceAt(auctionInfo, auctionInfo.startTime + 58060000n), 18480601319969968529n)
    assert.equal(auctionPriceAt(auctionInfo, auctionInfo.startTime + MAX_DECAY - 1n), 18446828639436756833n)
    assert.equal(auctionPriceAt(auctionInfo, auctionInfo.startTime + MAX_DECAY), 18446786356524694827n)
    assert.equal(auctionPriceAt(auctionInfo, auctionInfo.startTime + MAX_DECAY + 1n), 0n)
  })

  it('matches Dutch.sol behavior at max FIL supply', () => {
    const auctionInfo = {
      startPrice: 2n * 10n ** 27n,
      startTime: randU256(),
      token: '0x0000000000004946c0e9F43F4Dee607b0eF1fA1c' as const,
    }
    assert.equal(auctionPriceAt(auctionInfo, auctionInfo.startTime), auctionInfo.startPrice)
    assert.equal(auctionPriceAt(auctionInfo, auctionInfo.startTime + 90n * 24n * 60n * 60n), 36329437917604310558n)
    assert.equal(auctionPriceAt(auctionInfo, auctionInfo.startTime + 10000000n), 221990491042506894n)
    assert.equal(auctionPriceAt(auctionInfo, auctionInfo.startTime + 20000000n), 24639889n)
    assert.equal(auctionPriceAt(auctionInfo, auctionInfo.startTime + 23000000n), 25423n)
    assert.equal(auctionPriceAt(auctionInfo, auctionInfo.startTime + 26000000n), 26n)
    assert.equal(auctionPriceAt(auctionInfo, auctionInfo.startTime + 26500000n), 8n)
    assert.equal(auctionPriceAt(auctionInfo, auctionInfo.startTime + 27425278n), 1n)
    assert.equal(auctionPriceAt(auctionInfo, auctionInfo.startTime + 27425279n), 0n)
    assert.equal(auctionPriceAt(auctionInfo, auctionInfo.startTime + MAX_DECAY - 1n), 0n)
    assert.equal(auctionPriceAt(auctionInfo, auctionInfo.startTime + MAX_DECAY), 0n)
    assert.equal(auctionPriceAt(auctionInfo, auctionInfo.startTime + MAX_DECAY + 1n), 0n)
  })
})
