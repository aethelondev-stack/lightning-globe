/**
 * Lightning Globe Engine Types
 */

export interface EngineOptions {
  canvas: HTMLCanvasElement;
  antialias?: boolean;
  alpha?: boolean;
}

export type RenderCallback = (delta: number, elapsed: number) => void;

export interface IUpdatable {
  update(delta: number, elapsed: number): void;
}

export * from './lightning';
export * from './provider';
export * from './atmosphere';
