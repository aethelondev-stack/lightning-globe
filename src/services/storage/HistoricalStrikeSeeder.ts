import type { LightningEvent } from '../../types/lightning';

/**
 * HistoricalStrikeSeeder: Permanently DEACTIVATED.
 * Strictly 0% synthetic or seeded strikes allowed per project master rules.
 * All historical visualizations rely 100% on verified live strikes stored in IndexedDB.
 */
export function generate24HourHistoricalSeed(_baseTime: number = Date.now()): LightningEvent[] {
  return [];
}
