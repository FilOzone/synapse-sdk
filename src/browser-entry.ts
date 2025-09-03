/**
 * Browser bundle entry point
 * Exports all public APIs as a single default export for UMD builds
 */

// Import everything we need
import * as SynapseSDKExports from './index.ts'
import * as pdpExports from './pdp/index.ts'
import * as pieceCidExports from './piece/index.ts'

// Create a flat default export with all exports for UMD builds
const allExports = {
  ...SynapseSDKExports,
  ...pieceCidExports,
  ...pdpExports,
}

export default allExports
