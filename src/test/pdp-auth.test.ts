/* globals describe it beforeEach */

/**
 * Auth signature compatibility tests
 *
 * These tests verify that our SDK generates signatures compatible with
 * the WarmStorage contract by testing against known
 * reference signatures generated from Solidity.
 */

import { assert } from 'chai'
import { ethers } from 'ethers'
import { PDPAuthHelper } from '../pdp/auth.js'

// Test fixtures generated from Solidity reference implementation
// These signatures are verified against WarmStorage contract
const FIXTURES = {
  // Test private key from Solidity (never use in production!)
  privateKey: '0x1234567890123456789012345678901234567890123456789012345678901234',
  signerAddress: '0x2e988A386a799F506693793c6A5AF6B54dfAaBfB',
  contractAddress: '0x5615dEB798BB3E4dFa0139dFa1b3D433Cc23b72f',
  chainId: 31337,
  domainSeparator: '0x62ef5e11007063d470b2e85638bf452adae7cc646a776144c9ecfc7a9c42a3ba',

  // EIP-712 domain separator components
  domain: {
    name: 'FilecoinWarmStorageService',
    version: '1',
    chainId: 31337,
    verifyingContract: '0x5615dEB798BB3E4dFa0139dFa1b3D433Cc23b72f',
  },

  // Expected EIP-712 signatures
  signatures: {
    createDataSet: {
      signature:
        '0xc77965e2b6efd594629c44eb61127bc3133b65d08c25f8aa33e3021e7f46435845ab67ffbac96afc4b4671ecbd32d4869ca7fe1c0eaa5affa942d0abbfd98d601b',
      digest: '0xd89be6a725302e66575d7a9c730191a84e2a624d0f0f3976194d0bd6f2927640',
      clientDataSetId: 12345,
      payee: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      metadata: [{ key: 'title', value: 'TestDataSet' }],
    },
    addPieces: {
      signature:
        '0x215d2d6ea06c7daad46e3e636b305885c7d09aa34420e8dbace032af03cae06224cf678da808c7f1026b08ccf51f3d5d53351b935f5eee9750b80e78caffaaa91c',
      digest: '0xa690b5f3c6400833822aa3fd63ad1f0e4c1f70e5cc132cfd898c2993169d23bf',
      clientDataSetId: 12345,
      firstAdded: 1,
      pieceCidBytes: [
        '0x01559120220500de6815dcb348843215a94de532954b60be550a4bec6e74555665e9a5ec4e0f3c',
        '0x01559120227e03642a607ef886b004bf2c1978463ae1d4693ac0f410eb2d1b7a47fe205e5e750f',
      ],
      metadata: [[], []],
    },
    schedulePieceRemovals: {
      signature:
        '0xcb8e645f2894fde89de54d4a54eb1e0d9871901c6fa1c2ee8a0390dc3a29e6cb2244d0561e3eca6452fa59efaab3d4b18a0b5b59ab52e233b3469422556ae9c61c',
      digest: '0xef55929f8dd724ef4b43c5759db26878608f7e1277d168e3e621d3cd4ba682dd',
      clientDataSetId: 12345,
      pieceIds: [1, 3, 5],
    },
    deleteDataSet: {
      signature:
        '0x94e366bd2f9bfc933a87575126715bccf128b77d9c6937e194023e13b54272eb7a74b7e6e26acf4341d9c56e141ff7ba154c37ea03e9c35b126fff1efe1a0c831c',
      digest: '0x79df79ba922d913eccb0f9a91564ba3a1a81a0ea81d99a7cecf23cc3f425cafb',
      clientDataSetId: 12345,
    },
  },
}

// Helper to create PieceCID CIDs from the test piece digests
const PIECE_DATA: string[] = [
  'bafkzcibcauan42av3szurbbscwuu3zjssvfwbpsvbjf6y3tukvlgl2nf5rha6pa',
  'bafkzcibcpybwiktap34inmaex4wbs6cghlq5i2j2yd2bb2zndn5ep7ralzphkdy',
]

describe('Auth Signature Compatibility', () => {
  let authHelper: PDPAuthHelper

  let signer: ethers.Wallet

  beforeEach(() => {
    // Create signer from test private key
    signer = new ethers.Wallet(FIXTURES.privateKey)

    // Create PDPAuthHelper with test contract address and chain ID
    authHelper = new PDPAuthHelper(FIXTURES.contractAddress, signer, BigInt(FIXTURES.chainId))

    // Verify test setup
    assert.strictEqual(signer.address, FIXTURES.signerAddress)
  })

  it('should generate CreateDataSet signature matching Solidity reference', async () => {
    const result = await authHelper.signCreateDataSet(
      FIXTURES.signatures.createDataSet.clientDataSetId,
      FIXTURES.signatures.createDataSet.payee,
      FIXTURES.signatures.createDataSet.metadata
    )

    // Verify signature matches exactly
    assert.strictEqual(
      result.signature,
      FIXTURES.signatures.createDataSet.signature,
      'CreateDataSet signature should match Solidity reference'
    )

    // Verify signed data can be used to recover signer
    // For EIP-712, signedData is already the message hash
    const recoveredSigner = ethers.recoverAddress(result.signedData, result.signature)
    assert.strictEqual(recoveredSigner.toLowerCase(), FIXTURES.signerAddress.toLowerCase())
  })

  it('should generate AddPieces signature matching Solidity reference', async () => {
    const result = await authHelper.signAddPieces(
      FIXTURES.signatures.addPieces.clientDataSetId,
      FIXTURES.signatures.addPieces.firstAdded,
      PIECE_DATA
    )

    // Verify signature matches exactly
    assert.strictEqual(
      result.signature,
      FIXTURES.signatures.addPieces.signature,
      'AddPieces signature should match Solidity reference'
    )

    // Verify signed data can be used to recover signer
    // For EIP-712, signedData is already the message hash
    const recoveredSigner = ethers.recoverAddress(result.signedData, result.signature)
    assert.strictEqual(recoveredSigner.toLowerCase(), FIXTURES.signerAddress.toLowerCase())
  })

  it('should generate SchedulePieceRemovals signature matching Solidity reference', async () => {
    const result = await authHelper.signSchedulePieceRemovals(
      FIXTURES.signatures.schedulePieceRemovals.clientDataSetId,
      FIXTURES.signatures.schedulePieceRemovals.pieceIds
    )

    // Verify signature matches exactly
    assert.strictEqual(
      result.signature,
      FIXTURES.signatures.schedulePieceRemovals.signature,
      'SchedulePieceRemovals signature should match Solidity reference'
    )

    // Verify signed data can be used to recover signer
    // For EIP-712, signedData is already the message hash
    const recoveredSigner = ethers.recoverAddress(result.signedData, result.signature)
    assert.strictEqual(recoveredSigner.toLowerCase(), FIXTURES.signerAddress.toLowerCase())
  })

  it('should generate DeleteDataSet signature matching Solidity reference', async () => {
    const result = await authHelper.signDeleteDataSet(FIXTURES.signatures.deleteDataSet.clientDataSetId)

    // Verify signature matches exactly
    assert.strictEqual(
      result.signature,
      FIXTURES.signatures.deleteDataSet.signature,
      'DeleteDataSet signature should match Solidity reference'
    )

    // Verify signed data can be used to recover signer
    // For EIP-712, signedData is already the message hash
    const recoveredSigner = ethers.recoverAddress(result.signedData, result.signature)
    assert.strictEqual(recoveredSigner.toLowerCase(), FIXTURES.signerAddress.toLowerCase())
  })

  it('should handle bigint values correctly', async () => {
    const result = await authHelper.signCreateDataSet(
      BigInt(12345), // Use bigint instead of number
      FIXTURES.signatures.createDataSet.payee,
      FIXTURES.signatures.createDataSet.metadata
    )

    // Should produce same signature as number version
    assert.strictEqual(result.signature, FIXTURES.signatures.createDataSet.signature)
  })

  it('should generate consistent signatures', async () => {
    // Generate same signature multiple times
    const sig1 = await authHelper.signCreateDataSet(
      FIXTURES.signatures.createDataSet.clientDataSetId,
      FIXTURES.signatures.createDataSet.payee,
      FIXTURES.signatures.createDataSet.metadata
    )

    const sig2 = await authHelper.signCreateDataSet(
      FIXTURES.signatures.createDataSet.clientDataSetId,
      FIXTURES.signatures.createDataSet.payee,
      FIXTURES.signatures.createDataSet.metadata
    )

    // Signatures should be identical (deterministic)
    assert.strictEqual(sig1.signature, sig2.signature)
    assert.strictEqual(sig1.signedData, sig2.signedData)
  })

  it('should handle empty piece data array', async () => {
    const result = await authHelper.signAddPieces(
      FIXTURES.signatures.addPieces.clientDataSetId,
      FIXTURES.signatures.addPieces.firstAdded,
      [] // empty array
    )

    // Should generate valid signature (different from test fixture)
    assert.match(result.signature, /^0x[0-9a-f]{130}$/i)
    assert.isDefined(result.signedData)

    // Should be able to recover signer
    // For EIP-712, signedData is already the message hash
    const recoveredSigner = ethers.recoverAddress(result.signedData, result.signature)
    assert.strictEqual(recoveredSigner.toLowerCase(), FIXTURES.signerAddress.toLowerCase())
  })
})
