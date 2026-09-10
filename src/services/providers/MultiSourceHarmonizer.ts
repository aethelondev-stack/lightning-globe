import type { LightningEvent } from '../../types/lightning';
import type { ILightningProvider, ProviderStatus, ProviderStats, MultiSourceMode } from '../../types/provider';
import { LiveStreamProvider } from './LiveStreamProvider';
import { GoesGlmProvider } from './GoesGlmProvider';
import { Goes18GlmProvider } from './Goes18GlmProvider';
import { MtgLiProvider } from './MtgLiProvider';
import { RegionalFeedsProvider } from './RegionalFeedsProvider';
import { haversineDistanceKm } from '../../utils/coordinates';

interface BufferedStrike {
  event: LightningEvent;
  sourceType: 'rf' | 'sat' | 'regional';
  receivedAt: number;
}

export interface HarmonizerOptions {
  rfProvider?: LiveStreamProvider;
  satProvider?: GoesGlmProvider;
  sat18Provider?: Goes18GlmProvider;
  satMtgProvider?: MtgLiProvider;
  regionalProvider?: RegionalFeedsProvider;
  defaultMode?: MultiSourceMode;
  spatialThresholdKm?: number;
  temporalThresholdMs?: number;
}

/**
 * MultiSourceHarmonizer: Master arbiter orchestrating concurrent ground (Blitzortung RF),
 * 3 geostationary satellites (NOAA GOES-16, NOAA GOES-18, EUMETSAT MTG-I1 LI),
 * and 3 regional ground networks (Singapore NEA, Japan JMA LIDEN, Finland FMI NORDLIS WFS)
 * into a unified stream.
 *
 * Core Capabilities:
 * - Ingests ground-based VLF/LF microsecond RF strikes, optical satellite flashes, and regional ground radars.
 * - Cross-sensor spatial-temporal fusion: (d < 35km and |Δt| < 1200ms) -> synthesizes unified 'hybrid' event.
 * - Planetary coverage:
 *   * Blitzortung: Global community RF network.
 *   * NOAA GOES-16: South America (Amazon Basin, Andes), Caribbean, Western Atlantic.
 *   * NOAA GOES-18: Pacific Ocean, Western North America, Alaska, Hawaii, Eastern Oceania.
 *   * EUMETSAT MTG-I1: African Continent (Congo Basin), Europe, Mediterranean, Middle East.
 *   * Singapore NEA: Southeast Asia / Malacca Strait ground network.
 *   * Japan JMA LIDEN: East Asia / Japan archipelago and Sea of Japan.
 *   * Finland FMI: Scandinavia / Arctic polar latitudes (60°N to 72°N+).
 */
export class MultiSourceHarmonizer implements ILightningProvider {
  public readonly id = 'provider-multi-source-harmonizer';
  public readonly name = 'Composite Multi-Source Harmonizer (Global 7-Stream)';
  public status: ProviderStatus = 'OFFLINE';

  public readonly rfProvider: LiveStreamProvider;
  public readonly satProvider: GoesGlmProvider;
  public readonly sat18Provider: Goes18GlmProvider;
  public readonly satMtgProvider: MtgLiProvider;
  public readonly regionalProvider: RegionalFeedsProvider;

  private mode: MultiSourceMode;
  private readonly spatialThresholdKm: number;
  private readonly temporalThresholdMs: number;

  private readonly eventListeners: Set<(event: LightningEvent) => void> = new Set();
  private readonly statusListeners: Set<(status: ProviderStatus) => void> = new Set();

  private buffer: BufferedStrike[] = [];
  private readonly bufferTtlMs: number = 2000;

  private totalDispatched: number = 0;
  private totalFused: number = 0;
  private lastDispatchedTime: number | null = null;
  private unsubs: Array<() => void> = [];

  constructor(options?: HarmonizerOptions) {
    this.rfProvider = options?.rfProvider ?? new LiveStreamProvider();
    this.satProvider = options?.satProvider ?? new GoesGlmProvider();
    this.sat18Provider = options?.sat18Provider ?? new Goes18GlmProvider();
    this.satMtgProvider = options?.satMtgProvider ?? new MtgLiProvider();
    this.regionalProvider = options?.regionalProvider ?? new RegionalFeedsProvider();
    this.mode = options?.defaultMode ?? 'ALL_HYBRID';
    this.spatialThresholdKm = options?.spatialThresholdKm ?? 35.0;
    this.temporalThresholdMs = options?.temporalThresholdMs ?? 1200;
  }

  public async connect(): Promise<void> {
    this.updateStatus();

    this.unsubs.push(
      this.rfProvider.onEvent((evt) => this.handleRfEvent(evt)),
      this.rfProvider.onStatusChange(() => this.updateStatus()),

      this.satProvider.onEvent((evt) => this.handleSatEvent(evt)),
      this.satProvider.onStatusChange(() => this.updateStatus()),

      this.sat18Provider.onEvent((evt) => this.handleSatEvent(evt)),
      this.sat18Provider.onStatusChange(() => this.updateStatus()),

      this.satMtgProvider.onEvent((evt) => this.handleSatEvent(evt)),
      this.satMtgProvider.onStatusChange(() => this.updateStatus()),

      this.regionalProvider.onEvent((evt) => this.handleRegionalEvent(evt)),
      this.regionalProvider.onStatusChange(() => this.updateStatus())
    );

    const connectPromises: Promise<void>[] = [];
    if (this.mode === 'ALL_HYBRID' || this.mode === 'BLITZORTUNG_ONLY') {
      connectPromises.push(this.rfProvider.connect());
    }
    if (this.mode === 'ALL_HYBRID' || this.mode === 'GOES16_ONLY') {
      connectPromises.push(this.satProvider.connect());
      connectPromises.push(this.sat18Provider.connect());
      connectPromises.push(this.satMtgProvider.connect());
    }
    if (this.mode === 'ALL_HYBRID') {
      connectPromises.push(this.regionalProvider.connect());
    }

    await Promise.allSettled(connectPromises);
    this.updateStatus();
  }

  public disconnect(): void {
    for (const unsub of this.unsubs) {
      unsub();
    }
    this.unsubs = [];

    this.rfProvider.disconnect();
    this.satProvider.disconnect();
    this.sat18Provider.disconnect();
    this.satMtgProvider.disconnect();
    this.regionalProvider.disconnect();
    this.buffer = [];
    this.setStatus('OFFLINE');
  }

  public setMode(mode: MultiSourceMode): void {
    if (this.mode === mode) return;
    this.mode = mode;

    if (mode === 'BLITZORTUNG_ONLY') {
      this.satProvider.disconnect();
      this.sat18Provider.disconnect();
      this.satMtgProvider.disconnect();
      this.regionalProvider.disconnect();
      this.rfProvider.connect().catch(console.error);
    } else if (mode === 'GOES16_ONLY') {
      this.rfProvider.disconnect();
      this.regionalProvider.disconnect();
      this.satProvider.connect().catch(console.error);
      this.sat18Provider.connect().catch(console.error);
      this.satMtgProvider.connect().catch(console.error);
    } else {
      this.rfProvider.connect().catch(console.error);
      this.satProvider.connect().catch(console.error);
      this.sat18Provider.connect().catch(console.error);
      this.satMtgProvider.connect().catch(console.error);
      this.regionalProvider.connect().catch(console.error);
    }

    this.updateStatus();
  }

  public getMode(): MultiSourceMode {
    return this.mode;
  }

  public onEvent(callback: (event: LightningEvent) => void): () => void {
    this.eventListeners.add(callback);
    return () => this.eventListeners.delete(callback);
  }

  public onStatusChange(callback: (status: ProviderStatus) => void): () => void {
    this.statusListeners.add(callback);
    return () => this.statusListeners.delete(callback);
  }

  public getStats(): ProviderStats {
    const rfStats = this.rfProvider.getStats();
    const sat16Stats = this.satProvider.getStats();
    const sat18Stats = this.sat18Provider.getStats();
    const mtgStats = this.satMtgProvider.getStats();
    const regionalStats = this.regionalProvider.getStats();

    const activeSources: string[] = [];
    if (this.rfProvider.status === 'LIVE') activeSources.push('blitzortung');
    if (this.satProvider.status === 'LIVE') activeSources.push('goes16_glm');
    if (this.sat18Provider.status === 'LIVE') activeSources.push('goes18_glm');
    if (this.satMtgProvider.status === 'LIVE') activeSources.push('mtg_li');
    if (this.regionalProvider.status === 'LIVE') {
      activeSources.push('singapore_nea', 'japan_jma', 'finland_fmi');
    }

    const totalEps =
      rfStats.eventsPerSecond +
      sat16Stats.eventsPerSecond +
      sat18Stats.eventsPerSecond +
      mtgStats.eventsPerSecond +
      regionalStats.eventsPerSecond;

    return {
      eventsPerSecond: totalEps,
      totalEventsReceived: this.totalDispatched,
      lastEventTimestamp: this.lastDispatchedTime,
      rfEventsPerSecond: rfStats.eventsPerSecond,
      satEventsPerSecond: sat16Stats.eventsPerSecond + sat18Stats.eventsPerSecond + mtgStats.eventsPerSecond,
      fusedEventsCount: this.totalFused,
      activeSources
    };
  }

  private handleRfEvent(rfEvent: LightningEvent): void {
    if (this.mode === 'GOES16_ONLY') return;

    if (this.mode === 'BLITZORTUNG_ONLY') {
      this.emitEvent(rfEvent);
      return;
    }

    const now = Date.now();
    this.pruneBuffer(now);

    const matchIdx = this.findCorrelatedEvent(rfEvent, 'sat');
    if (matchIdx !== -1) {
      const satMatch = this.buffer[matchIdx].event;
      this.buffer.splice(matchIdx, 1);
      const fusedEvent = this.fuseEvents(rfEvent, satMatch);
      this.totalFused++;
      this.emitEvent(fusedEvent);
    } else {
      this.buffer.push({ event: rfEvent, sourceType: 'rf', receivedAt: now });
      this.emitEvent(rfEvent);
    }
  }

  private handleSatEvent(satEvent: LightningEvent): void {
    if (this.mode === 'BLITZORTUNG_ONLY') return;

    if (this.mode === 'GOES16_ONLY') {
      this.emitEvent(satEvent);
      return;
    }

    const now = Date.now();
    this.pruneBuffer(now);

    const matchIdx = this.findCorrelatedEvent(satEvent, 'rf');
    if (matchIdx !== -1) {
      const rfMatch = this.buffer[matchIdx].event;
      this.buffer.splice(matchIdx, 1);
      const fusedEvent = this.fuseEvents(rfMatch, satEvent);
      this.totalFused++;
      this.emitEvent(fusedEvent);
    } else {
      this.buffer.push({ event: satEvent, sourceType: 'sat', receivedAt: now });
      this.emitEvent(satEvent);
    }
  }

  private handleRegionalEvent(regionalEvent: LightningEvent): void {
    if (this.mode === 'BLITZORTUNG_ONLY' || this.mode === 'GOES16_ONLY') return;

    const now = Date.now();
    this.pruneBuffer(now);

    const matchIdx = this.findCorrelatedEvent(regionalEvent, 'sat');
    if (matchIdx !== -1) {
      const satMatch = this.buffer[matchIdx].event;
      this.buffer.splice(matchIdx, 1);
      const fusedEvent = this.fuseEvents(regionalEvent, satMatch);
      this.totalFused++;
      this.emitEvent(fusedEvent);
    } else {
      this.buffer.push({ event: regionalEvent, sourceType: 'regional', receivedAt: now });
      this.emitEvent(regionalEvent);
    }
  }

  private findCorrelatedEvent(target: LightningEvent, targetSource: 'rf' | 'sat'): number {
    for (let i = 0; i < this.buffer.length; i++) {
      const item = this.buffer[i];
      if (item.sourceType !== targetSource) continue;

      const timeDiff = Math.abs(target.timestamp - item.event.timestamp);
      if (timeDiff <= this.temporalThresholdMs) {
        const distKm = haversineDistanceKm(
          target.latitude,
          target.longitude,
          item.event.latitude,
          item.event.longitude
        );
        if (distKm <= this.spatialThresholdKm) {
          return i;
        }
      }
    }
    return -1;
  }

  private fuseEvents(rf: LightningEvent, sat: LightningEvent): LightningEvent {
    return {
      id: `hybrid_${rf.id}_${sat.id}`,
      timestamp: rf.timestamp,
      latitude: rf.latitude,
      longitude: rf.longitude,
      peakCurrent: rf.peakCurrent,
      type: rf.type,
      source: 'hybrid',
      color: '#38bdf8',
      opticalEnergy: sat.opticalEnergy,
      opticalArea: sat.opticalArea,
      pol: rf.pol
    };
  }

  private emitEvent(event: LightningEvent): void {
    this.totalDispatched++;
    this.lastDispatchedTime = event.timestamp;
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('MultiSourceHarmonizer subscriber error:', err);
      }
    }
  }

  private pruneBuffer(now: number): void {
    const cutoff = now - this.bufferTtlMs;
    this.buffer = this.buffer.filter((b) => b.receivedAt > cutoff);
  }

  private updateStatus(): void {
    const rf = this.rfProvider.status;
    const sat16 = this.satProvider.status;
    const sat18 = this.sat18Provider.status;
    const mtg = this.satMtgProvider.status;
    const reg = this.regionalProvider.status;

    const anySatLive = sat16 === 'LIVE' || sat18 === 'LIVE' || mtg === 'LIVE';
    const anySatConnecting = sat16 === 'CONNECTING' || sat18 === 'CONNECTING' || mtg === 'CONNECTING';
    const anySatStale = sat16 === 'STALE' || sat18 === 'STALE' || mtg === 'STALE';

    if (this.mode === 'BLITZORTUNG_ONLY') {
      this.setStatus(rf);
    } else if (this.mode === 'GOES16_ONLY') {
      this.setStatus(anySatLive ? 'LIVE' : anySatConnecting ? 'CONNECTING' : anySatStale ? 'STALE' : 'OFFLINE');
    } else {
      if (rf === 'LIVE' || anySatLive || reg === 'LIVE') {
        this.setStatus('LIVE');
      } else if (rf === 'CONNECTING' || anySatConnecting || reg === 'CONNECTING') {
        this.setStatus('CONNECTING');
      } else if (rf === 'STALE' || anySatStale || reg === 'STALE') {
        this.setStatus('STALE');
      } else {
        this.setStatus('OFFLINE');
      }
    }
  }

  private setStatus(newStatus: ProviderStatus): void {
    if (this.status === newStatus) return;
    this.status = newStatus;
    for (const listener of this.statusListeners) {
      try {
        listener(newStatus);
      } catch (err) {
        console.error('MultiSourceHarmonizer status listener error:', err);
      }
    }
  }
}
