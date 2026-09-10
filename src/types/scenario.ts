import type { RawLightningPacket } from '../services/normalizer/LightningNormalizer';

export type DemoScenarioId =
  | 'SINGLE_STRIKE'
  | 'LOCAL_CLUSTER'
  | 'INTENSE_STORM'
  | 'COMPETING_STORMS'
  | 'DATELINE_STORM'
  | 'EXTREME_SURGE';

export interface ScenarioDefinition {
  id: DemoScenarioId;
  name: string;
  description: string;
  targetFps: number;
  expectedStrikesPerSec: number;
}

export interface IScenarioRunner {
  readonly id: DemoScenarioId;
  start(emit: (raw: RawLightningPacket) => void): void;
  stop(): void;
  isRunning(): boolean;
}
