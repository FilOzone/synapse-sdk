/**
 * Browser bundle entry point
 * Exports all public APIs as a single default export for UMD builds
 */

// Import everything we need
import * as SynapseSDKExports from './index.js'
import * as commpExports from './commp/index.js'
import * as pdpExports from './pdp/index.js'

// Create a flat default export with all exports for UMD builds
export default {
  ...SynapseSDKExports,
  ...commpExports,
  ...pdpExports
}
