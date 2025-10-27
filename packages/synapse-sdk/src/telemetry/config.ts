/**
 * Telemetry configuration utilities
 *
 * Handles test environment detection and global variable support
 * to ensure telemetry is properly disabled during testing.
 * Uses globalThis for consistent cross-platform access.
 */

/**
 * Check if telemetry is explicitly disabled via global variable or environment
 * Uses globalThis for consistent cross-platform access
 */
function isTelemetryDisabledByEnv(): boolean {
  // Check for global disable flag (universal)
  if (typeof globalThis !== 'undefined') {
    // Check for explicit disable flag
    if ((globalThis as any).SYNAPSE_TELEMETRY_DISABLED === true) {
      return true
    }

    // Check environment variable in Node.js
    if ('process' in globalThis) {
      const process = (globalThis as any).process
      if (process?.env) {
        const disabled = process.env.SYNAPSE_TELEMETRY_DISABLED
        if (typeof disabled === 'string' && disabled.trim().toLowerCase() === 'true') {
          return true
        }
      }
    }
  }

  return false
}

/**
 * Determine if telemetry should be enabled based on configuration and environment
 *
 * @param config - User-provided telemetry configuration
 * @returns True if telemetry should be enabled
 */
export function shouldEnableTelemetry(config?: { enabled?: boolean }): boolean {
  // If explicitly disabled by user config, respect that
  if (config?.enabled === false) {
    return false
  }

  // If disabled by environment variable, respect that
  if (isTelemetryDisabledByEnv()) {
    return false
  }

  // If in test environment, disable telemetry
  if (globalThis.process?.env?.NODE_ENV === 'test') {
    return false
  }

  // Default to enabled (unless explicitly disabled above)
  return true
}
