import type { LightningEvent } from '../../types/lightning';
import type { ILightningProvider, ProviderStatus, ProviderStats } from '../../types/provider';
import type { DemoScenarioId, ScenarioDefinition, IScenarioRunner } from '../../types/scenario';
import { EngineConfig } from '../../core/Config';
import { LightningNormalizer, type RawLightningPacket } from '../normalizer/LightningNormalizer';
import { createScenarioRunners } from './ScenarioGenerators';

/**
 * ScenarioManager: Central coordinator for deterministic meteorological test scenarios.
 *
 * Implements ILightningProvider to drop in place of SyntheticStreamProvider.
 * Provides atomic teardown when switching scenarios to prevent stale state bleed.
 *
 * Referencing PROJECT_SPEC.md Section 11, TESTING.md, and ARCHITECTURE.md.
 */
export class ScenarioManager implements ILightningProvider {
  public readonly id = 'provider-scenario-manager';
  public name = 'Deterministic Meteorological Scenarios';
  public status: ProviderStatus = 'OFFLINE';

  private runners: Map<DemoScenarioId, IScenarioRunner>;
  private activeScenarioId: DemoScenarioId;
  private eventListeners: Set<(event: LightningEvent) => void> = new Set();
  private statusListeners: Set<(status: ProviderStatus) => void> = new Set();
  private teardownCallbacks: Set<() => void> = new Set();

  // Metrics tracking
  private totalEvents: number = 0;
  private recentTimestamps: number[] = [];
  private rateCalculationTimer: number | null = null;
  private currentEventsPerSec: number = 0;

  constructor(initialScenario: DemoScenarioId = EngineConfig.scenarios.defaultScenario) {
    this.runners = createScenarioRunners();
    this.activeScenarioId = initialScenario;

    const def = this.getActiveScenario();
    this.name = `Scenario: ${def.name}`;
  }

  public async connect(): Promise<void> {
    this.status = 'DEMO';
    this.notifyStatus(this.status);

    this.startRateMeter();
    this.startActiveRunner();
  }

  public disconnect(): void {
    const activeRunner = this.runners.get(this.activeScenarioId);
    if (activeRunner) {
      activeRunner.stop();
    }

    if (this.rateCalculationTimer !== null) {
      clearInterval(this.rateCalculationTimer);
      this.rateCalculationTimer = null;
    }

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
      totalEventsReceived: this.totalEvents,
      lastEventTimestamp: this.recentTimestamps.length > 0 ? this.recentTimestamps[this.recentTimestamps.length - 1] : null
    };
  }

  /**
   * Registers an atomic teardown hook invoked whenever a scenario switch occurs.
   * Used to wipe store, event director queues, and camera locks.
   */
  public registerTeardownHook(hook: () => void): () => void {
    this.teardownCallbacks.add(hook);
    return () => this.teardownCallbacks.delete(hook);
  }

  /**
   * Switches to a new scenario with atomic teardown of existing state.
   */
  public setScenario(scenarioId: DemoScenarioId): void {
    if (!this.runners.has(scenarioId)) {
      throw new Error(`Unknown scenario ID: ${scenarioId}`);
    }

    // 1. Stop current runner
    const currentRunner = this.runners.get(this.activeScenarioId);
    if (currentRunner) {
      currentRunner.stop();
    }

    // 2. Execute all teardown hooks (store.clear, director.clear, camera.resetToIdle)
    for (const hook of this.teardownCallbacks) {
      try {
        hook();
      } catch (err) {
        console.error('Error in scenario teardown hook:', err);
      }
    }

    // 3. Reset rate meter buffers
    this.recentTimestamps = [];
    this.currentEventsPerSec = 0;

    // 4. Update active scenario
    this.activeScenarioId = scenarioId;
    const def = this.getActiveScenario();
    this.name = `Scenario: ${def.name}`;

    // 5. Start new runner if provider is connected
    if (this.status === 'DEMO') {
      this.startActiveRunner();
    }
  }

  public getActiveScenarioId(): DemoScenarioId {
    return this.activeScenarioId;
  }

  public getActiveScenario(): ScenarioDefinition {
    const found = EngineConfig.scenarios.definitions.find((d) => d.id === this.activeScenarioId);
    if (!found) {
      return {
        id: this.activeScenarioId,
        name: this.activeScenarioId,
        description: '',
        targetFps: 60,
        expectedStrikesPerSec: 10
      };
    }
    return found;
  }

  public getAvailableScenarios(): readonly ScenarioDefinition[] {
    return EngineConfig.scenarios.definitions;
  }

  private startActiveRunner(): void {
    const runner = this.runners.get(this.activeScenarioId);
    if (!runner) return;

    runner.start((raw: RawLightningPacket) => {
      this.handleRawPayload(raw);
    });
  }

  private handleRawPayload(raw: RawLightningPacket): void {
    const normalized = LightningNormalizer.normalize(raw, 'synthetic');
    if (!normalized) return;

    this.totalEvents++;
    const now = Date.now();
    this.recentTimestamps.push(now);

    for (const listener of this.eventListeners) {
      listener(normalized);
    }
  }

  private startRateMeter(): void {
    if (this.rateCalculationTimer !== null) {
      clearInterval(this.rateCalculationTimer);
    }

    this.rateCalculationTimer = window.setInterval(() => {
      const now = Date.now();
      const oneSecAgo = now - 1000;

      // Filter timestamps within last 1 second
      while (this.recentTimestamps.length > 0 && this.recentTimestamps[0] < oneSecAgo) {
        this.recentTimestamps.shift();
      }

      this.currentEventsPerSec = this.recentTimestamps.length;
    }, 250);
  }

  private notifyStatus(status: ProviderStatus): void {
    for (const listener of this.statusListeners) {
      listener(status);
    }
  }
}
