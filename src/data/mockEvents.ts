import type { LightningEvent } from '../types/lightning';

/**
 * Phase 2 Synthetic Test Lightning Events
 * Fixed geographic benchmarks for visual and mathematical verification.
 */
export const SYNTHETIC_TEST_EVENTS: LightningEvent[] = [
  {
    id: 'synthetic-istanbul-01',
    timestamp: Date.now(),
    latitude: 41.0082,
    longitude: 28.9784,
    peakCurrent: -45.2,
    type: 'CG',
    source: 'synthetic',
    color: '#f59e0b' // Amber/Gold pulse over Turkey
  },
  {
    id: 'synthetic-tokyo-02',
    timestamp: Date.now() - 2500,
    latitude: 35.6762,
    longitude: 139.6503,
    peakCurrent: 32.8,
    type: 'CG',
    source: 'synthetic',
    color: '#06b6d4' // Cyan pulse over Japan
  },
  {
    id: 'synthetic-newyork-03',
    timestamp: Date.now() - 5000,
    latitude: 40.7128,
    longitude: -74.006,
    peakCurrent: -58.4,
    type: 'CG',
    source: 'synthetic',
    color: '#60a5fa' // Electric Blue pulse over North America
  }
];
