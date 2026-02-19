import { assert } from 'chai'
import { type Address, createWalletClient, decodeAbiParameters, type Hex, http, parseSignature } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import * as Chains from '../src/chains.ts'
import * as Piece from '../src/piece/piece.ts'
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
        '0x0000000000000000000000002e988a386a799f506693793c6a5af6b54dfaabfb000000000000000000000000000000000000000000000000000000000000303900000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000012000000000000000000000000000000000000000000000000000000000000001a00000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000057469746c6500000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000b5465737444617461536574000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004171b76dc59fda32a090b48744f047748725f1989d69c24b25713ff7c175f365255d96f112712439fc01a2a9c6fb6cd5e0e78bd57888677cb5172f08acebfc34e21b00000000000000000000000000000000000000000000000000000000000000' as Hex,
      clientDataSetId: 12345n,
      payee: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address,
      metadata: [{ key: 'title', value: 'TestDataSet' }],
    },
    addPieces: {
      extraData:
        '0x00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000012000000000000000000000000000000000000000000000000000000000000001c00000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004127e3a89a2b33f19c04986d9b3d705bd9312c1a0be123b1646aacc5bba46246e07de6cad74cfb4755d97bbb1aeb64bd8adb2f0f1d85afdf7b51feae7f184dd6131b00000000000000000000000000000000000000000000000000000000000000' as Hex,
      clientDataSetId: 12345n,
      nonce: 1n,
    },
    schedulePieceRemovals: {
      extraData:
        '0x0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000004116df3928604421914122d3ad071558e6e704b9d28bd38bdf93b02ca8760497351981d111edc0d7a470213e8cf235a72c2ae4dd8dc426a144b2b9fdd4a4035f091c00000000000000000000000000000000000000000000000000000000000000' as Hex,
      clientDataSetId: 12345n,
      pieceIds: [1n, 3n, 5n],
    },
  },
}

const PIECE_DATA: string[] = [
  'bafkzcibcauan42av3szurbbscwuu3zjssvfwbpsvbjf6y3tukvlgl2nf5rha6pa',
  'bafkzcibcpybwiktap34inmaex4wbs6cghlq5i2j2yd2bb2zndn5ep7ralzphkdy',
]

const account = privateKeyToAccount(FIXTURES.privateKey)
const client = createWalletClient({
  account,
  chain: Chains.calibration,
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
    const domain = getStorageDomain({ chain: Chains.calibration })

    assert.strictEqual(domain.name, 'FilecoinWarmStorageService')
    assert.strictEqual(domain.version, '1')
    assert.strictEqual(domain.chainId, Chains.calibration.id)
    assert.strictEqual(domain.verifyingContract, Chains.calibration.contracts.fwss.address)
  })

  it('should return domain with custom verifying contract', () => {
    const customContract = '0xCustomContractAddress1234567890123456789012' as Address
    const domain = getStorageDomain({ chain: Chains.calibration, verifyingContract: customContract })

    assert.strictEqual(domain.name, 'FilecoinWarmStorageService')
    assert.strictEqual(domain.version, '1')
    assert.strictEqual(domain.chainId, Chains.calibration.id)
    assert.strictEqual(domain.verifyingContract, customContract)
  })
})
