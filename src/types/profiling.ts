/**
 * Performance metrics snapshot measured by PerformanceProfiler.
 */
export interface PerformanceMetrics {
  fps: number;
  frameTimeMs: number;
  heapUsedMb: number;
  drawCalls: number;
}
