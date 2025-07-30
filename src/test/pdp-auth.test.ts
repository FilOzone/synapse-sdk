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
import type { PieceData } from '../types.js'

// Test fixtures generated from Solidity reference implementation
// These signatures are verified against WarmStorage contract
const FIXTURES = {
  // Test private key from Solidity (never use in production!)
  privateKey: '0x1234567890123456789012345678901234567890123456789012345678901234',
  signerAddress: '0x2e988A386a799F506693793c6A5AF6B54dfAaBfB',
  contractAddress: '0x5615dEB798BB3E4dFa0139dFa1b3D433Cc23b72f',
  chainId: 31337,
  domainSeparator: '0xc8fab2af8a94242cb941b37088d380710d98d07afc2db8a90c1b74c8d47220b0',

  // EIP-712 domain separator components
  domain: {
    name: 'WarmStorageService',
    version: '1',
    chainId: 31337,
    verifyingContract: '0x5615dEB798BB3E4dFa0139dFa1b3D433Cc23b72f'
  },

  // Expected EIP-712 signatures generated with new type names (data sets/pieces)
  signatures: {
    createDataSet: {
      signature: '0x2ade4cae25767d913085f43ce05de4d5b4b3e1f19e87c8a35f184bcf69ccbed83636027a360676212407c0b5cc5d7e33a67919d5d450e3e12644a375c38b78b01c',
      digest: '0xa7878f0b67c3ab20ada02fc74312090f470388bcd79ec30387735386ed6b9448',
      clientDataSetId: 12345,
      payee: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      withCDN: true
    },
    addPieces: {
      signature: '0x10f2e0d044e6c459364c633c66fe9af62b5dc1ae12efb527dd5ae938d8073dc8749b7565ec36bb7e4fa1313c3e23d82787021d9fc6c592d8959f15a0168bb5791c',
      digest: '0x754235d696d1117d5694c2b61a46386067b1253b8fb631ac28329b3b6273c1d6',
      clientDataSetId: 12345,
      firstAdded: 1,
      pieceDigests: [
        '0xfc7e928296e516faade986b28f92d44a4f24b935485223376a799027bc18f833',
        '0xa9eb89e9825d609ab500be99bf0770bd4e01eeaba92b8dad23c08f1f59bfe10f'
      ],
      pieceSizes: [2048, 4096]
    },
    scheduleRemovals: {
      signature: '0xcb8e645f2894fde89de54d4a54eb1e0d9871901c6fa1c2ee8a0390dc3a29e6cb2244d0561e3eca6452fa59efaab3d4b18a0b5b59ab52e233b3469422556ae9c61c',
      digest: '0x5d26947c51884a10708c5820c0c72fae6408a0ad58c127101bf854559a5644c5',
      clientDataSetId: 12345,
      pieceIds: [1, 3, 5]
    },
    deleteDataSet: {
      signature: '0x94e366bd2f9bfc933a87575126715bccf128b77d9c6937e194023e13b54272eb7a74b7e6e26acf4341d9c56e141ff7ba154c37ea03e9c35b126fff1efe1a0c831c',
      digest: '0x2d8dd51594ce9d3f4b377a8a578e331facabf86f4a400cc395dff0b448c6ab7c',
      clientDataSetId: 12345
    }
  }
}

// Helper to create CommP CIDs from the test piece digests
const PIECE_DATA: PieceData[] = [
  {
    cid: 'baga6ea4seaqpy7usqklokfx2vxuynmupslkeutzexe2uqurdg5vhtebhxqmpqmy', // digest: 0xfc7e92...
    rawSize: 1024
  },
  {
    cid: 'baga6ea4seaqkt24j5gbf2ye2wual5gn7a5yl2tqb52v2sk4nvur4bdy7lg76cdy', // digest: 0xa9eb89...
    rawSize: 2048
  }
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

  it('should generate CreateProofSet signature matching Solidity reference', async () => {
    const result = await authHelper.signCreateDataSet(
      FIXTURES.signatures.createDataSet.clientDataSetId,
      FIXTURES.signatures.createDataSet.payee,
      FIXTURES.signatures.createDataSet.withCDN
    )

    // Verify signature matches exactly
    assert.strictEqual(result.signature, FIXTURES.signatures.createDataSet.signature,
      'CreateProofSet signature should match Solidity reference')

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

  it('should generate ScheduleRemovals signature matching Solidity reference', async () => {
    const result = await authHelper.signSchedulePieceRemovals(
      FIXTURES.signatures.scheduleRemovals.clientDataSetId,
      FIXTURES.signatures.scheduleRemovals.pieceIds
    )

    // Verify signature matches exactly
    assert.strictEqual(result.signature, FIXTURES.signatures.scheduleRemovals.signature,
      'ScheduleRemovals signature should match Solidity reference')

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
