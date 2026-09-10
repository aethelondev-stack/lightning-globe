import type { PerformanceMetrics } from '../../types/profiling';

/**
 * PerformanceProfiler: Ultra-lightweight telemetry profiler measuring real-time
 * FPS, frame render time (ms), JS Heap memory (MB), and Three.js draw calls.
 *
 * Designed with zero per-frame garbage generation:
 * - Pre-allocated circular Float32Array buffers for 60-frame rolling averages.
 * - Chromium performance.memory safe fallback for cross-browser safety.
 * - Nanosecond-precision performance.now() tracking.
 */
export class PerformanceProfiler {
  private static readonly SAMPLE_WINDOW = 60;

  private frameStartTime: number = 0;
  private lastFrameTimestamp: number = 0;
  private currentFrameDuration: number = 0;
  private latestDrawCalls: number = 0;

  // Pre-allocated circular buffers for rolling metrics
  private readonly frameDeltaSamples: Float32Array = new Float32Array(PerformanceProfiler.SAMPLE_WINDOW);
  private readonly frameDurationSamples: Float32Array = new Float32Array(PerformanceProfiler.SAMPLE_WINDOW);
  private sampleIndex: number = 0;
  private sampleCount: number = 0;

  // Cached metric snapshot
  private cachedFps: number = 60;
  private cachedAvgFrameTimeMs: number = 0;
  private lastCalculationTime: number = 0;

  constructor() {
    this.lastFrameTimestamp = typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  /**
   * Marks the exact start of CPU and GPU draw preparation for the frame.
   */
  public beginFrame(): void {
    this.frameStartTime = performance.now();
  }

  /**
   * Marks the completion of the frame after WebGL draw execution.
   *
   * @param drawCalls Total draw calls executed by Three.js renderer in this frame
   */
  public endFrame(drawCalls: number = 0): void {
    const now = performance.now();
    this.currentFrameDuration = Math.max(0, now - this.frameStartTime);
    this.latestDrawCalls = drawCalls;

    // Record inter-frame delta time (for FPS)
    const frameDelta = Math.max(0.1, now - this.lastFrameTimestamp);
    this.lastFrameTimestamp = now;

    // Store samples in circular buffers
    this.frameDeltaSamples[this.sampleIndex] = frameDelta;
    this.frameDurationSamples[this.sampleIndex] = this.currentFrameDuration;
    this.sampleIndex = (this.sampleIndex + 1) % PerformanceProfiler.SAMPLE_WINDOW;

    if (this.sampleCount < PerformanceProfiler.SAMPLE_WINDOW) {
      this.sampleCount++;
    }

    // Refresh rolling averages periodically (every 100ms) to avoid redundant math
    if (now - this.lastCalculationTime >= 100) {
      this.computeAverages();
      this.lastCalculationTime = now;
    }
  }

  /**
   * Computes rolling averages across recorded frame windows.
   */
  private computeAverages(): void {
    if (this.sampleCount === 0) return;

    let totalDelta = 0;
    let totalDuration = 0;

    for (let i = 0; i < this.sampleCount; i++) {
      totalDelta += this.frameDeltaSamples[i];
      totalDuration += this.frameDurationSamples[i];
    }

    const avgDelta = totalDelta / this.sampleCount;
    this.cachedFps = avgDelta > 0 ? Math.min(120, Math.round(1000 / avgDelta)) : 60;
    this.cachedAvgFrameTimeMs = Number((totalDuration / this.sampleCount).toFixed(2));
  }

  /**
   * Safely reads V8 JS Heap size in megabytes, falling back cleanly to 0
   * on non-Chromium browsers (Firefox, Safari).
   */
  public getHeapUsedMb(): number {
    if (typeof window !== 'undefined' && 'performance' in window) {
      const perfWithMemory = performance as unknown as {
        memory?: {
          usedJSHeapSize?: number;
          totalJSHeapSize?: number;
          jsHeapSizeLimit?: number;
        };
      };

      if (perfWithMemory.memory && typeof perfWithMemory.memory.usedJSHeapSize === 'number') {
        return Number((perfWithMemory.memory.usedJSHeapSize / (1024 * 1024)).toFixed(1));
      }
    }
    return 0;
  }

  /**
   * Returns a snapshot of current performance telemetry.
   */
  public getMetrics(): PerformanceMetrics {
    return {
      fps: this.cachedFps,
      frameTimeMs: this.cachedAvgFrameTimeMs,
      heapUsedMb: this.getHeapUsedMb(),
      drawCalls: this.latestDrawCalls
    };
  }

  /**
   * Resets internal sample buffers (e.g. after scenario teardown).
   */
  public reset(): void {
    this.sampleIndex = 0;
    this.sampleCount = 0;
    this.cachedFps = 60;
    this.cachedAvgFrameTimeMs = 0;
    this.frameDeltaSamples.fill(0);
    this.frameDurationSamples.fill(0);
  }
}
