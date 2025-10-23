export type Environment = 'test' | 'development' | 'staging' | 'production'

export interface TelemetryConfig {
  /**
   * Whether to enable telemetry.
   *
   * You can also control this via the environment variable `SYNAPSE_TELEMETRY_DISABLED` or the global variable `SYNAPSE_TELEMETRY_DISABLED`.
   *
   * This value will also be false if `NODE_ENV === 'test'`.
   *
   * @default true
   */
  enabled?: boolean
  environment?: Environment // optional: deployment environment
  /**
   * The name of the application using the SDK.
   * This is used to identify the application in the telemetry data.
   * This is optional and can be set by the user via the synapse.telemetry.setContext() method.
   * If not set, the SDK will use 'synapse-sdk' as the default app name.
   */
  appName?: string
  tags?: Record<string, string> // optional: custom tags
}

interface BaseTelemetryEvent {
  requestId: string
  ts: string // UTC timestamp
}

export interface ErrorEvent extends BaseTelemetryEvent {
  type: 'error'
  name: string
  message: string
  stack?: string
  operation?: OperationType // SDK operation context when error occurred
}

export interface HTTPEvent extends BaseTelemetryEvent {
  type: 'http'
  method: string
  urlTemplate: string // sanitized URL (host + path, no query strings)
  status?: number
  ok?: boolean
  durationMs: number
  // Storage provider identification for filtering and debugging
  spHostname: string
  spPath: string
  spOperation: string
}

export interface OperationEvent extends BaseTelemetryEvent {
  type: 'operation'
  operation: OperationType
  params: Record<string, any> // allowlisted parameters
  success: boolean
  durationMs: number
}

export interface CustomEvent extends BaseTelemetryEvent {
  type: 'custom'
  name: string
  data: Record<string, any>
  level: 'info' | 'warning' | 'error'
}

export const OPERATIONS = {
  // Storage operations
  'storage.upload': 'storage.upload',
  'storage.download': 'storage.download',
  'storage.create': 'storage.create',
  'storage.addPieces': 'storage.addPieces',
  'storage.deletePiece': 'storage.deletePiece',
  'storage.pieceStatus': 'storage.pieceStatus',

  // Payments operations
  'payments.deposit': 'payments.deposit',
  'payments.withdraw': 'payments.withdraw',
  'payments.approve': 'payments.approve',
  'payments.approveService': 'payments.approveService',
  'payments.revokeService': 'payments.revokeService',
  'payments.settle': 'payments.settle',
  'payments.terminate': 'payments.terminate',

  // Registry operations
  'registry.register': 'registry.register',
  'registry.registerProvider': 'registry.registerProvider',

  // Subgraph operations
  'subgraph.query': 'subgraph.query',
  'subgraph.getApprovedProviders': 'subgraph.getApprovedProviders',

  // Network operations
  'network.getFilecoinNetworkType': 'network.getFilecoinNetworkType',

  // Epoch operations
  'epoch.getCurrentEpoch': 'epoch.getCurrentEpoch',

  // Synapse operations
  'synapse.create': 'synapse.create',

  /**
   * for custom operations that don't fit into the above categories
   *
   * e.g. `filecoin-pin-website.announceIpni` or similar.
   */
  'custom.operation': `{string}.{string}`,
} as const

export type OperationType = (typeof OPERATIONS)[keyof typeof OPERATIONS]

/**
 * TelemetryAdapter - abstracts telemetry provider (Sentry, OTel, etc.)
 */
export interface TelemetryAdapter {
  init(config: TelemetryConfig, tags: Record<string, string>): void
  captureError(error: Error, context?: Record<string, unknown>): void
  captureHTTP(event: HTTPEvent): void
  captureOperation(event: OperationEvent): void
  captureCustomEvent(event: CustomEvent): void
  setContext(tags: Record<string, string>): void

  /**
   * Start a span for manual timing control
   *
   * NOTE: For SDK operations, use TelemetryService.trackOperation() instead.
   * This is for advanced cases where you need manual span lifecycle control.
   */
  startSpan(
    name: string,
    op: OperationType,
    context?: Record<string, unknown>
  ): {
    spanId: string
    end(error?: Error): void
  }
}

export interface DebugDump {
  events: Array<ErrorEvent | HTTPEvent | OperationEvent | CustomEvent>
  context: {
    sdkVersion: string
    runtime: 'browser' | 'node'
    network: 'mainnet' | 'calibration'
    enabled: boolean
  }
  timestamp: string // UTC timestamp
}
