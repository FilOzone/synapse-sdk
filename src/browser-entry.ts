/**
 * Browser bundle entry point
 * Exports all public APIs as a single default export for UMD builds
 */

// Import everything we need
import * as SynapseSDKExports from './index.js'
import * as pieceLinkExports from './piecelink/index.js'
import * as pdpExports from './pdp/index.js'

// Create a flat default export with all exports for UMD builds
const allExports = {
  ...SynapseSDKExports,
  ...pieceLinkExports,
  ...pdpExports
}

export default allExports
