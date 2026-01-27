import { assert } from 'chai'
import { type Address, createWalletClient, decodeAbiParameters, type Hex, http, parseSignature } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import type { Chain } from '../src/chains.ts'
import * as Chains from '../src/chains.ts'
import * as Piece from '../src/piece.ts'
import * as TypedData from '../src/typed-data/index.ts'
import { getStorageDomain } from '../src/typed-data/type-definitions.ts'

// Test fixtures generated from Solidity reference implementation
// These signatures are verified against WarmStorage contract
const FIXTURES = {
  // Test private key from Solidity (never use in production!)
  privateKey: '0x1234567890123456789012345678901234567890123456789012345678901234' as Hex,

  // Expected EIP-712 signatures
  signatures: {
    createDataSet: {
      extraData:
        '0x0000000000000000000000002e988a386a799f506693793c6a5af6b54dfaabfb000000000000000000000000000000000000000000000000000000000000303900000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000012000000000000000000000000000000000000000000000000000000000000001a00000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000057469746c6500000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000b54657374446174615365740000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000041cbe023bc62804a93b71ce163b63f5240d404326d5780eeee1163b36a5b6f4e0538c5df9ca2a572f2dd46c9bd1c921336c4cd7c6871f267ba5fe5faa2426bd86b1c00000000000000000000000000000000000000000000000000000000000000' as Hex,
      clientDataSetId: 12345n,
      payee: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address,
      metadata: [{ key: 'title', value: 'TestDataSet' }],
    },
    addPieces: {
      extraData:
        '0x00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000012000000000000000000000000000000000000000000000000000000000000001c000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000041bc47a95dca5d22821210d7acd104d987455588c0ec31a9f028bafa2f18e60262646c28adcb3dda5405305d9eecfd960967c6fe07eac453cb477b6654cc07eb291c00000000000000000000000000000000000000000000000000000000000000' as Hex,
      clientDataSetId: 12345n,
      nonce: 1n,
    },
    schedulePieceRemovals: {
      extraData:
        '0x00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000041df635aed98f509f6d404efb1543979a922867c9dc3b0b6e5967189045ff30b2173d89806b6d5fab38477f97c034f7012b145d31b90942abc1984182060ddfb171b00000000000000000000000000000000000000000000000000000000000000' as Hex,
      clientDataSetId: 12345n,
      pieceIds: [1n, 3n, 5n],
    },
  },
}

const PIECE_DATA: string[] = [
  'bafkzcibcauan42av3szurbbscwuu3zjssvfwbpsvbjf6y3tukvlgl2nf5rha6pa',
  'bafkzcibcpybwiktap34inmaex4wbs6cghlq5i2j2yd2bb2zndn5ep7ralzphkdy',
]

const chain: Chain = {
  ...Chains.calibration,
  id: 31337,
}

const account = privateKeyToAccount(FIXTURES.privateKey)
const client = createWalletClient({
  account,
  chain,
  transport: http(),
})

describe('Typed Data', () => {
  it('should sign create data set', async () => {
    const signatureActual = await TypedData.signCreateDataSet(client, {
      clientDataSetId: FIXTURES.signatures.createDataSet.clientDataSetId,
      payee: FIXTURES.signatures.createDataSet.payee,
      metadata: FIXTURES.signatures.createDataSet.metadata,
    })

    assert.strictEqual(
      signatureActual,
      FIXTURES.signatures.createDataSet.extraData,
      'CreateDataSet signature should match Solidity reference'
    )

    const decoded = decodeAbiParameters(TypedData.signCreateDataSetAbiParameters, signatureActual)

    assert.strictEqual(decoded[0], account.address)
    assert.strictEqual(decoded[1], FIXTURES.signatures.createDataSet.clientDataSetId)
    assert.deepStrictEqual(
      decoded[2],
      FIXTURES.signatures.createDataSet.metadata.map((item) => item.key)
    )
    assert.deepStrictEqual(
      decoded[3],
      FIXTURES.signatures.createDataSet.metadata.map((item) => item.value)
    )
  })

  it('should sign add pieces', async () => {
    const extraDataActual = await TypedData.signAddPieces(client, {
      clientDataSetId: FIXTURES.signatures.addPieces.clientDataSetId,
      nonce: FIXTURES.signatures.addPieces.nonce,
      pieces: PIECE_DATA.map((piece) => ({
        pieceCid: Piece.parse(piece),
      })),
    })

    assert.strictEqual(
      extraDataActual,
      FIXTURES.signatures.addPieces.extraData,
      'AddPieces extraData should match Solidity reference'
    )
    const decoded = decodeAbiParameters(TypedData.signAddPiecesAbiParameters, extraDataActual)

    assert.strictEqual(decoded[0], FIXTURES.signatures.addPieces.nonce)
    assert.deepStrictEqual(decoded[1], [[], []])
    assert.deepStrictEqual(decoded[2], [[], []])
  })

  it('should sign add pieces with metadata', async () => {
    const extraDataActual = await TypedData.signAddPieces(client, {
      clientDataSetId: FIXTURES.signatures.addPieces.clientDataSetId,
      nonce: FIXTURES.signatures.addPieces.nonce,
      pieces: PIECE_DATA.map((piece) => ({
        pieceCid: Piece.parse(piece),
        metadata: [{ key: 'title', value: 'TestDataSet' }],
      })),
    })

    const decoded = decodeAbiParameters(TypedData.signAddPiecesAbiParameters, extraDataActual)

    assert.strictEqual(decoded[0], FIXTURES.signatures.addPieces.nonce)
    assert.deepStrictEqual(decoded[1], [['title'], ['title']])
    assert.deepStrictEqual(decoded[2], [['TestDataSet'], ['TestDataSet']])
  })

  it('should sign schedule piece removals', async () => {
    const extraDataActual = await TypedData.signSchedulePieceRemovals(client, {
      clientDataSetId: FIXTURES.signatures.schedulePieceRemovals.clientDataSetId,
      pieceIds: FIXTURES.signatures.schedulePieceRemovals.pieceIds,
    })

    assert.strictEqual(
      extraDataActual,
      FIXTURES.signatures.schedulePieceRemovals.extraData,
      'SchedulePieceRemovals extraData should match Solidity reference'
    )
  })

  it('should sign create data set and add pieces', async () => {
    const extraDataActual = await TypedData.signCreateDataSetAndAddPieces(client, {
      clientDataSetId: FIXTURES.signatures.createDataSet.clientDataSetId,
      payee: FIXTURES.signatures.createDataSet.payee,
      metadata: FIXTURES.signatures.createDataSet.metadata,
      nonce: FIXTURES.signatures.addPieces.nonce,
      pieces: PIECE_DATA.map((piece) => ({
        pieceCid: Piece.parse(piece),
      })),
    })

    // Decode the combined extra data (two nested bytes)
    const decoded = decodeAbiParameters(TypedData.signcreateDataSetAndAddPiecesAbiParameters, extraDataActual)

    // First bytes should be createDataSet extraData
    const createDataSetDecoded = decodeAbiParameters(TypedData.signCreateDataSetAbiParameters, decoded[0])
    assert.strictEqual(createDataSetDecoded[0], account.address)
    assert.strictEqual(createDataSetDecoded[1], FIXTURES.signatures.createDataSet.clientDataSetId)

    // Second bytes should be addPieces extraData
    const addPiecesDecoded = decodeAbiParameters(TypedData.signAddPiecesAbiParameters, decoded[1])
    assert.strictEqual(addPiecesDecoded[0], FIXTURES.signatures.addPieces.nonce)
  })

  it('should sign erc20 permit', async () => {
    const amount = 1000n
    const nonce = 0n
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)

    const signature = await TypedData.signErc20Permit(client, {
      amount,
      nonce,
      deadline,
      name: 'USDFC',
      version: '1',
    })

    // Verify signature is valid hex
    assert.match(signature, /^0x[0-9a-fA-F]+$/)

    // Parse signature to verify it has correct structure (r, s, v)
    const parsed = parseSignature(signature)
    assert.isDefined(parsed.r)
    assert.isDefined(parsed.s)
    assert.isDefined(parsed.v)
  })

  it('should sign erc20 permit with custom token and spender', async () => {
    const customToken = '0x1234567890123456789012345678901234567890' as Address
    const customSpender = '0x0987654321098765432109876543210987654321' as Address
    const amount = 500n
    const nonce = 1n
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 7200)

    const signature = await TypedData.signErc20Permit(client, {
      token: customToken,
      spender: customSpender,
      amount,
      nonce,
      deadline,
      name: 'CustomToken',
      version: '2',
    })

    assert.match(signature, /^0x[0-9a-fA-F]+$/)
    const parsed = parseSignature(signature)
    assert.isDefined(parsed.r)
    assert.isDefined(parsed.s)
  })
})

describe('getStorageDomain', () => {
  it('should return domain with default verifying contract', () => {
    const domain = getStorageDomain({ chain })

    assert.strictEqual(domain.name, 'FilecoinWarmStorageService')
    assert.strictEqual(domain.version, '1')
    assert.strictEqual(domain.chainId, chain.id)
    assert.strictEqual(domain.verifyingContract, chain.contracts.storage.address)
  })

  it('should return domain with custom verifying contract', () => {
    const customContract = '0xCustomContractAddress1234567890123456789012' as Address
    const domain = getStorageDomain({ chain, verifyingContract: customContract })

    assert.strictEqual(domain.name, 'FilecoinWarmStorageService')
    assert.strictEqual(domain.version, '1')
    assert.strictEqual(domain.chainId, chain.id)
    assert.strictEqual(domain.verifyingContract, customContract)
  })
})
