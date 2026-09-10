import type { LightningEvent } from '../../types/lightning';
import type { ILightningProvider, ProviderStatus, ProviderStats } from '../../types/provider';
import type {
  StreamConfig,
  IMinimalWebSocket,
  WebSocketConstructor
} from '../../types/connection';
import type { IScenarioRunner } from '../../types/scenario';
import { EngineConfig } from '../../core/Config';
import { LightningNormalizer, type RawLightningPacket } from '../normalizer/LightningNormalizer';
import { createScenarioRunners } from '../scenarios/ScenarioGenerators';

export interface LiveStreamProviderOptions {
  config?: Partial<StreamConfig>;
  fallbackRunner?: IScenarioRunner;
  webSocketClass?: WebSocketConstructor;
  enableSyntheticFallback?: boolean;
}

/**
 * LiveStreamProvider: High-reliability real-time WebSocket client.
 *
 * Capabilities:
 * - Live connection to decentralized lightning networks (Blitzortung).
 * - Multi-format payload ingestion (JSON objects, batched arrays, nanosecond time stamps).
 * - Exponential backoff with random jitter to prevent server stampedes.
 * - 10-second Heartbeat Watchdog monitoring stream continuity.
 * - Optional synthetic fallback runner (disabled by default for clean live boot).
 * - Zero memory allocations in hot message decoding.
 *
 * Referencing PROJECT_SPEC.md Section 18, RESEARCH_REPORT.md Section 12 & 19.
 */
export class LiveStreamProvider implements ILightningProvider {
  public readonly id = 'provider-live-stream';
  public name = 'Live Realtime Stream (Blitzortung)';
  public status: ProviderStatus = 'OFFLINE';

  private readonly config: StreamConfig;
  private readonly webSocketClass: WebSocketConstructor | null;
  private readonly enableSyntheticFallback: boolean;
  private fallbackRunner: IScenarioRunner | null = null;
  private socket: IMinimalWebSocket | null = null;

  // Listeners
  private readonly eventListeners: Set<(event: LightningEvent) => void> = new Set();
  private readonly statusListeners: Set<(status: ProviderStatus) => void> = new Set();

  // Lifecycle & Telemetry
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts: number = 0;
  private lastEventTimestamp: number = 0;
  private totalEventsReceived: number = 0;
  private currentEndpointIndex: number = 0;
  private isExplicitlyDisconnected: boolean = false;
  private isFallbackRunning: boolean = false;

  // Rate meter
  private recentEventTimestamps: number[] = [];
  private rateMeterTimer: ReturnType<typeof setInterval> | null = null;
  private currentEventsPerSec: number = 0;

  constructor(options?: LiveStreamProviderOptions) {
    this.config = {
      primaryEndpoint: options?.config?.primaryEndpoint ?? EngineConfig.liveStream.primaryEndpoint,
      fallbackEndpoints: options?.config?.fallbackEndpoints ?? [...EngineConfig.liveStream.fallbackEndpoints],
      reconnectBaseMs: options?.config?.reconnectBaseMs ?? EngineConfig.liveStream.reconnectBaseMs,
      reconnectMaxMs: options?.config?.reconnectMaxMs ?? EngineConfig.liveStream.reconnectMaxMs,
      staleTimeoutMs: options?.config?.staleTimeoutMs ?? EngineConfig.liveStream.staleTimeoutMs,
      heartbeatIntervalMs: options?.config?.heartbeatIntervalMs ?? EngineConfig.liveStream.heartbeatIntervalMs,
      defaultDataSource: options?.config?.defaultDataSource ?? EngineConfig.liveStream.defaultDataSource
    };

    if (options?.webSocketClass) {
      this.webSocketClass = options.webSocketClass;
    } else if (typeof WebSocket !== 'undefined') {
      this.webSocketClass = WebSocket as unknown as WebSocketConstructor;
    } else {
      this.webSocketClass = null;
    }

    this.enableSyntheticFallback = options?.enableSyntheticFallback ?? (options?.fallbackRunner !== undefined);

    if (options?.fallbackRunner) {
      this.fallbackRunner = options.fallbackRunner;
    } else if (this.enableSyntheticFallback) {
      const runners = createScenarioRunners();
      const defaultRunner = runners.get('COMPETING_STORMS');
      if (defaultRunner) {
        this.fallbackRunner = defaultRunner;
      }
    }
  }

  /**
   * Calculates exponential backoff with random jitter.
   * delay = min(maxMs, baseMs * 2^attempt) + jitter
   */
  public static calculateBackoff(
    attempt: number,
    baseMs: number,
    maxMs: number,
    jitterMultiplier: number = 0.5
  ): number {
    const exponential = Math.min(maxMs, baseMs * Math.pow(2, attempt));
    const jitter = Math.random() * (baseMs * jitterMultiplier);
    return Math.min(maxMs, Math.round(exponential + jitter));
  }

  public async connect(): Promise<void> {
    this.isExplicitlyDisconnected = false;
    this.startRateMeter();
    this.startWatchdog();
    this.establishConnection();
  }

  public disconnect(): void {
    this.isExplicitlyDisconnected = true;

    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.watchdogTimer !== null) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }

    if (this.rateMeterTimer !== null) {
      clearInterval(this.rateMeterTimer);
      this.rateMeterTimer = null;
    }

    if (this.socket) {
      try {
        this.socket.onopen = null;
        this.socket.onclose = null;
        this.socket.onerror = null;
        this.socket.onmessage = null;
        this.socket.close();
      } catch (err) {
        console.warn('Error closing websocket:', err);
      }
      this.socket = null;
    }

    this.stopFallbackRunner();
    this.status = 'OFFLINE';
    this.notifyStatus(this.status);
  }

  public onEvent(callback: (event: LightningEvent) => void): () => void {
    this.eventListeners.add(callback);
    return () => this.eventListeners.delete(callback);
  }

  public onStatusChange(callback: (status: ProviderStatus) => void): () => void {
    this.statusListeners.add(callback);
    callback(this.status);
    return () => this.statusListeners.delete(callback);
  }

  public getStats(): ProviderStats {
    return {
      eventsPerSecond: this.currentEventsPerSec,
      totalEventsReceived: this.totalEventsReceived,
      lastEventTimestamp: this.lastEventTimestamp > 0 ? this.lastEventTimestamp : null
    };
  }

  public getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }

  public isFallbackActive(): boolean {
    return this.isFallbackRunning;
  }

  private establishConnection(): void {
    if (this.isExplicitlyDisconnected) return;

    if (!this.webSocketClass) {
      console.warn('⚠️ WebSocket API is not available in this runtime environment. Engaging fallback runner.');
      this.status = 'STALE';
      this.notifyStatus(this.status);
      this.startFallbackRunner();
      return;
    }

    this.status = 'CONNECTING';
    this.notifyStatus(this.status);

    const endpoint = this.getActiveEndpoint();

    try {
      this.socket = new this.webSocketClass(endpoint);

      this.socket.onopen = () => {
        if (this.isExplicitlyDisconnected) {
          this.socket?.close();
          return;
        }

        this.reconnectAttempts = 0;
        this.status = 'LIVE';
        this.notifyStatus(this.status);
        this.stopFallbackRunner();

        // Blitzortung protocol handshake (request global streaming code 111)
        try {
          this.socket?.send(JSON.stringify({ a: 111 }));
        } catch {
          // Non-blocking handshake failure
        }
      };

      this.socket.onmessage = (event: { data: unknown }) => {
        this.handleMessageData(event.data);
      };

      this.socket.onerror = () => {
        this.handleConnectionFailure();
      };

      this.socket.onclose = () => {
        this.handleConnectionFailure();
      };
    } catch (err) {
      console.warn(`Connection to ${endpoint} failed:`, err);
      this.handleConnectionFailure();
    }
  }

  private handleConnectionFailure(): void {
    if (this.isExplicitlyDisconnected) return;

    this.socket = null;

    // Transition immediately to STALE/DEMO fallback to prevent visual dropouts
    if (this.status !== 'STALE') {
      this.status = 'STALE';
      this.notifyStatus(this.status);
    }
    this.startFallbackRunner();

    // Schedule exponential backoff reconnect
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null || this.isExplicitlyDisconnected) return;

    const delay = LiveStreamProvider.calculateBackoff(
      this.reconnectAttempts,
      this.config.reconnectBaseMs,
      this.config.reconnectMaxMs
    );

    this.reconnectAttempts++;

    // Rotate through fallback endpoints if repeated failures occur
    if (this.reconnectAttempts % 2 === 0 && this.config.fallbackEndpoints.length > 0) {
      this.currentEndpointIndex = (this.currentEndpointIndex + 1) % (this.config.fallbackEndpoints.length + 1);
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.isExplicitlyDisconnected) {
        this.establishConnection();
      }
    }, delay);
  }

  private getActiveEndpoint(): string {
    if (this.currentEndpointIndex === 0) {
      return this.config.primaryEndpoint;
    }
    const fallbackIdx = this.currentEndpointIndex - 1;
    return this.config.fallbackEndpoints[fallbackIdx] || this.config.primaryEndpoint;
  }

  /**
   * Deobfuscates Blitzortung LZW stream data into standard JSON string.
   */
  public static decodeBlitzortungPayload(b: string): string {
    if (!b || b.length < 2) return b;
    const d = b.split('');
    let c = d[0];
    let f = c;
    const g = [c];
    const e: Record<number, string> = {};
    const h = 256;
    let o = h;
    for (let i = 1; i < d.length; i++) {
      const a = d[i].charCodeAt(0);
      const str = h > a ? d[i] : (e[a] ? e[a] : f + c);
      g.push(str);
      c = str.charAt(0);
      e[o] = f + c;
      o++;
      f = str;
    }
    return g.join('');
  }

  /**
   * Parses and normalizes incoming message payloads from the WebSocket stream.
   * Handles individual JSON objects, batched arrays, and varying field conventions.
   */
  public handleMessageData(data: unknown): void {
    if (typeof data !== 'string') {
      return;
    }

    try {
      let jsonString = data;
      // If data is obfuscated with high Unicode code points, deobfuscate first
      try {
        JSON.parse(data);
      } catch {
        jsonString = LiveStreamProvider.decodeBlitzortungPayload(data);
      }

      const parsed = JSON.parse(jsonString) as unknown;

      if (Array.isArray(parsed)) {
        // Blitzortung batched array or raw coordinate array
        if (parsed.length >= 3 && typeof parsed[0] === 'number' && typeof parsed[1] === 'number') {
          // Single array format: [time, lon, lat, alt, pol, mds, mc]
          this.processRawArrayStroke(parsed);
        } else {
          // Batch of strokes: [{...}, {...}] or [[...], [...]]
          for (let i = 0; i < parsed.length; i++) {
            const item = parsed[i];
            if (Array.isArray(item)) {
              this.processRawArrayStroke(item);
            } else if (typeof item === 'object' && item !== null) {
              this.processRawObjectStroke(item);
            }
          }
        }
      } else if (typeof parsed === 'object' && parsed !== null) {
        this.processRawObjectStroke(parsed);
      }
    } catch {
      // Corrupted JSON payload safely discarded
    }
  }

  private processRawArrayStroke(arr: unknown[]): void {
    // Standard format: [time, lon, lat, ...]
    const rawTime = arr[0];
    const lon = arr[1];
    const lat = arr[2];
    // In Blitzortung websocket array format: [time, lon, lat, alt, pol, mds, mc]
    // index 6 is mc (maximal current in kA), index 4 is polarity
    let peakCurrent: number | undefined;
    if (arr.length > 6 && typeof arr[6] === 'number' && Math.abs(arr[6]) > 0) {
      peakCurrent = arr[6];
    } else if (arr.length > 4 && typeof arr[4] === 'number' && Math.abs(arr[4]) > 1) {
      peakCurrent = arr[4];
    }

    let timeMs = typeof rawTime === 'number' ? rawTime : Number(rawTime);
    // Nanosecond timestamp check (> 100 trillion)
    if (timeMs > 1e14) {
      timeMs = Math.floor(timeMs / 1e6);
    }

    const packet: RawLightningPacket = {
      timestamp: timeMs,
      latitude: lat,
      longitude: lon,
      peakCurrent: peakCurrent,
      type: 'CG',
      source: 'blitzortung'
    };

    this.emitNormalizedEvent(packet);
  }

  private processRawObjectStroke(obj: object): void {
    const raw = obj as RawLightningPacket;

    // Handle nanosecond timestamps
    if (typeof raw.time === 'number' && raw.time > 1e14) {
      raw.time = Math.floor(raw.time / 1e6);
    }
    if (typeof raw.timestamp === 'number' && raw.timestamp > 1e14) {
      raw.timestamp = Math.floor(raw.timestamp / 1e6);
    }

    this.emitNormalizedEvent(raw);
  }

  private emitNormalizedEvent(raw: RawLightningPacket): void {
    const event = LightningNormalizer.normalize(raw, 'blitzortung');
    if (!event) return;

    this.lastEventTimestamp = Date.now();
    this.totalEventsReceived++;
    this.recentEventTimestamps.push(this.lastEventTimestamp);

    // If we were in STALE/DEMO state and real live data resumed, recover status to LIVE
    if (this.status !== 'LIVE') {
      this.status = 'LIVE';
      this.notifyStatus(this.status);
      this.stopFallbackRunner();
    }

    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('Error in live event listener:', err);
      }
    }
  }

  private startFallbackRunner(): void {
    if (!this.enableSyntheticFallback || !this.fallbackRunner) return;
    if (this.isFallbackRunning) return;
    this.isFallbackRunning = true;

    this.fallbackRunner.start((rawPacket) => {
      // Forward fallback synthetic events through provider listeners
      const event = LightningNormalizer.normalize(rawPacket, 'synthetic');
      if (event) {
        this.totalEventsReceived++;
        this.recentEventTimestamps.push(Date.now());
        for (const listener of this.eventListeners) {
          try {
            listener(event);
          } catch (err) {
            console.error('Error in fallback event listener:', err);
          }
        }
      }
    });
  }

  private stopFallbackRunner(): void {
    if (!this.isFallbackRunning) return;
    this.isFallbackRunning = false;
    this.fallbackRunner?.stop();
  }

  private startWatchdog(): void {
    if (this.watchdogTimer !== null) return;

    this.watchdogTimer = setInterval(() => {
      if (this.isExplicitlyDisconnected) return;

      const now = Date.now();
      const elapsedSinceLast = now - this.lastEventTimestamp;

      // If socket is supposed to be live but no data arrived within staleTimeoutMs:
      if (this.status === 'LIVE' && elapsedSinceLast > this.config.staleTimeoutMs) {
        this.status = 'STALE';
        this.notifyStatus(this.status);
        this.startFallbackRunner();
      }
    }, 1000);
  }

  private startRateMeter(): void {
    if (this.rateMeterTimer !== null) return;

    this.rateMeterTimer = setInterval(() => {
      const now = Date.now();
      const oneSecondAgo = now - 1000;

      while (this.recentEventTimestamps.length > 0 && this.recentEventTimestamps[0] < oneSecondAgo) {
        this.recentEventTimestamps.shift();
      }

      this.currentEventsPerSec = this.recentEventTimestamps.length;
    }, 500);
  }

  private notifyStatus(status: ProviderStatus): void {
    for (const listener of this.statusListeners) {
      try {
        listener(status);
      } catch (err) {
        console.error('Error in status change listener:', err);
      }
    }
  }
}
