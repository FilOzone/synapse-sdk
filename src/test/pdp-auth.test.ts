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
    verifyingContract: '0x5615dEB798BB3E4dFa0139dFa1b3D433Cc23b72f'
  },

  // Expected EIP-712 signatures
  signatures: {
    createDataSet: {
      signature: '0x2ade4cae25767d913085f43ce05de4d5b4b3e1f19e87c8a35f184bcf69ccbed83636027a360676212407c0b5cc5d7e33a67919d5d450e3e12644a375c38b78b01c',
      digest: '0x259fdf0e90ede5d9367809b4d623fa031e218536e1d87c0e38b54b38461ea0ec',
      clientDataSetId: 12345,
      payee: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      withCDN: true
    },
    addPieces: {
      signature: '0x11a84c9e14c95c8e6a8efc4ee72fb3bb4b596a398fc1c0ff9d1ddec24eab6ce239964f6c75144499e56f36c7e85559b74d5c03faf0cc9843846ff05a52d928f91b',
      digest: '0x94ed837bcb986fa8f59453cd9e42494f93227e80d4fa54aa3da458b2ffb69790',
      clientDataSetId: 12345,
      firstAdded: 1,
      pieceCidBytes: [
        '0x0181e203922020fc7e928296e516faade986b28f92d44a4f24b935485223376a799027bc18f833',
        '0x0181e203922020a9eb89e9825d609ab500be99bf0770bd4e01eeaba92b8dad23c08f1f59bfe10f'
      ]
    },
    schedulePieceRemovals: {
      signature: '0xcb8e645f2894fde89de54d4a54eb1e0d9871901c6fa1c2ee8a0390dc3a29e6cb2244d0561e3eca6452fa59efaab3d4b18a0b5b59ab52e233b3469422556ae9c61c',
      digest: '0xef55929f8dd724ef4b43c5759db26878608f7e1277d168e3e621d3cd4ba682dd',
      clientDataSetId: 12345,
      pieceIds: [1, 3, 5]
    },
    deleteDataSet: {
      signature: '0x94e366bd2f9bfc933a87575126715bccf128b77d9c6937e194023e13b54272eb7a74b7e6e26acf4341d9c56e141ff7ba154c37ea03e9c35b126fff1efe1a0c831c',
      digest: '0x79df79ba922d913eccb0f9a91564ba3a1a81a0ea81d99a7cecf23cc3f425cafb',
      clientDataSetId: 12345
    }
  }
}

// Helper to create PieceCID CIDs from the test piece digests
const PIECE_DATA: string[] = [
  'bafkzcibcauan42av3szurbbscwuu3zjssvfwbpsvbjf6y3tukvlgl2nf5rha6pa',
  'bafkzcibcpybwiktap34inmaex4wbs6cghlq5i2j2yd2bb2zndn5ep7ralzphkdy'
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
      FIXTURES.signatures.createDataSet.withCDN
    )

    // Verify signature matches exactly
    assert.strictEqual(result.signature, FIXTURES.signatures.createDataSet.signature,
      'CreateDataSet signature should match Solidity reference')

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
    assert.strictEqual(result.signature, FIXTURES.signatures.addPieces.signature,
      'AddPieces signature should match Solidity reference')

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
    assert.strictEqual(result.signature, FIXTURES.signatures.schedulePieceRemovals.signature,
      'SchedulePieceRemovals signature should match Solidity reference')

    // Verify signed data can be used to recover signer
    // For EIP-712, signedData is already the message hash
    const recoveredSigner = ethers.recoverAddress(result.signedData, result.signature)
    assert.strictEqual(recoveredSigner.toLowerCase(), FIXTURES.signerAddress.toLowerCase())
  })

  it('should generate DeleteDataSet signature matching Solidity reference', async () => {
    const result = await authHelper.signDeleteDataSet(
      FIXTURES.signatures.deleteDataSet.clientDataSetId
    )

    // Verify signature matches exactly
    assert.strictEqual(result.signature, FIXTURES.signatures.deleteDataSet.signature,
      'DeleteDataSet signature should match Solidity reference')

    // Verify signed data can be used to recover signer
    // For EIP-712, signedData is already the message hash
    const recoveredSigner = ethers.recoverAddress(result.signedData, result.signature)
    assert.strictEqual(recoveredSigner.toLowerCase(), FIXTURES.signerAddress.toLowerCase())
  })

  it('should handle bigint values correctly', async () => {
    const result = await authHelper.signCreateDataSet(
      BigInt(12345), // Use bigint instead of number
      FIXTURES.signatures.createDataSet.payee,
      FIXTURES.signatures.createDataSet.withCDN
    )

    // Should produce same signature as number version
    assert.strictEqual(result.signature, FIXTURES.signatures.createDataSet.signature)
  })

  it('should generate consistent signatures', async () => {
    // Generate same signature multiple times
    const sig1 = await authHelper.signCreateDataSet(
      FIXTURES.signatures.createDataSet.clientDataSetId,
      FIXTURES.signatures.createDataSet.payee,
      FIXTURES.signatures.createDataSet.withCDN
    )

    const sig2 = await authHelper.signCreateDataSet(
      FIXTURES.signatures.createDataSet.clientDataSetId,
      FIXTURES.signatures.createDataSet.payee,
      FIXTURES.signatures.createDataSet.withCDN
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
