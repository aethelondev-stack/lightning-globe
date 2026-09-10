/**
 * Connection and reliability models for real-time streaming feeds.
 * Referencing PROJECT_SPEC.md Section 18, RESEARCH_REPORT.md Section 12 & 19.
 */

export type ConnectionState =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'RECONNECTING'
  | 'STALE';

export type DataSourceMode = 'LIVE' | 'SIMULATION';

export interface StreamConfig {
  primaryEndpoint: string;
  fallbackEndpoints: string[];
  reconnectBaseMs: number;
  reconnectMaxMs: number;
  staleTimeoutMs: number;
  heartbeatIntervalMs: number;
  defaultDataSource: DataSourceMode;
}

export interface RetryConfig {
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: boolean;
  maxAttempts?: number;
}

export interface StreamError {
  code: 'CONNECTION_FAILED' | 'TIMEOUT' | 'PARSE_ERROR' | 'STALE_DATA';
  message: string;
  timestamp: number;
}

/**
 * Generic minimal WebSocket abstraction to enable dependency injection of
 * mock WebSockets in Node.js automated test environments without external network deps.
 */
export interface IMinimalWebSocket {
  readyState: number;
  onopen: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
}

export type WebSocketConstructor = new (url: string) => IMinimalWebSocket;
