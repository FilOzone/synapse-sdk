import packageJson from '../../package.json' with { type: 'json' }

/**
 * Export the current SDK version from package.json so runtime code can stay in sync
 * without hardcoding the value in multiple places.
 */
export const SDK_VERSION = packageJson.version
