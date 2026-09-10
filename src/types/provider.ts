import type { LightningEvent } from './lightning';

/**
 * Connection and operational status of a lightning data provider.
 * Referencing PROJECT_SPEC.md Section 18
 */
export type ProviderStatus = 'CONNECTING' | 'LIVE' | 'STALE' | 'OFFLINE' | 'DEMO';

/**
 * Multi-feed operational modes for the composite streaming pipeline
 */
export type MultiSourceMode = 'ALL_HYBRID' | 'BLITZORTUNG_ONLY' | 'GOES16_ONLY' | 'GOES19_ONLY';

/**
 * Real-time operational statistics of the data feed
 */
export interface ProviderStats {
  eventsPerSecond: number;
  totalEventsReceived: number;
  lastEventTimestamp: number | null;
  // Optional multi-source breakdown
  rfEventsPerSecond?: number;
  satEventsPerSecond?: number;
  fusedEventsCount?: number;
  activeSources?: string[];
}

/**
 * Abstract interface for all lightning data providers.
 * Decouples the rendering and UI layer from the data ingestion source.
 * Referencing ARCHITECTURE.md Section 2
 */
export interface ILightningProvider {
  readonly id: string;
  readonly name: string;
  status: ProviderStatus;

  /**
   * Initializes connection or starts stream generation
   */
  connect(): Promise<void>;

  /**
   * Gracefully tears down connection or stops event stream
   */
  disconnect(): void;

  /**
   * Subscribes a listener to incoming validated lightning events
   * @returns An unsubscribe cleanup function
   */
  onEvent(callback: (event: LightningEvent) => void): () => void;

  /**
   * Subscribes a listener to provider status transitions
   * @returns An unsubscribe cleanup function
   */
  onStatusChange(callback: (status: ProviderStatus) => void): () => void;

  /**
   * Returns snapshot of real-time throughput metrics
   */
  getStats(): ProviderStats;
}
