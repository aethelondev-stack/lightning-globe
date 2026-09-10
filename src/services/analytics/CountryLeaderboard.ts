import { GeoEnricher } from '../geo/GeoEnricher';

export type LeaderboardPeriod = 'day' | 'week' | 'month' | 'year';

export interface CountryRankItem {
  rank: number;
  iso: string;
  country: string;
  flag: string;
  count: number;
  percentage: number;
  lat: number;
  lon: number;
}

export interface CountryRecord {
  iso: string;
  country: string;
  flag: string;
  lat: number;
  lon: number;
  day: number;
  week: number;
  month: number;
  year: number;
  allTime: number;
}

interface LeaderboardPersistedState {
  currentDayKey: string;
  currentWeekKey: string;
  currentMonthKey: string;
  currentYearKey: string;
  lastUpdated: number;
  records: Record<string, CountryRecord>;
}

export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * CountryLeaderboard: Real Calendar Lightning Strike Analytics & Leaderboard Engine (Phase 21).
 *
 * Capabilities:
 * - Real calendar timeframes: Day, Week, Month, Year.
 * - Strict UTC Midnight (00:00:00) rollover resets daily counters while rolling totals into week/month/year.
 * - Persistent browser storage (localStorage) with automatic schema hydration.
 * - Country ranking calculation with percentage of global total.
 * - Running centroid calculation for instantaneous camera fly-to framing.
 */
export class CountryLeaderboard {
  private static readonly STORAGE_KEY = 'lightning_leaderboard_v2';

  private records: Map<string, CountryRecord> = new Map();
  private currentDayKey: string = '';
  private currentWeekKey: string = '';
  private currentMonthKey: string = '';
  private currentYearKey: string = '';
  private lastUpdated: number = 0;

  private storage: StorageAdapter | null = null;
  private geoEnricher: GeoEnricher;
  private saveDebounceTimer: any = null;

  constructor(customStorage?: StorageAdapter, geoEnricher?: GeoEnricher) {
    if (customStorage) {
      this.storage = customStorage;
    } else if (typeof localStorage !== 'undefined') {
      this.storage = localStorage;
    }

    this.geoEnricher = geoEnricher ?? GeoEnricher.getInstance();

    this.load();
    if (!this.currentDayKey && typeof window !== 'undefined') {
      this.updateCalendarKeys(Date.now());
    }
  }

  /**
   * Generates standard UTC calendar keys for partitioning.
   */
  public static getCalendarKeys(timestamp: number): { day: string; week: string; month: string; year: string } {
    const d = new Date(timestamp);
    const yearStr = String(d.getUTCFullYear());
    const monthStr = `${yearStr}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const dayStr = `${monthStr}-${String(d.getUTCDate()).padStart(2, '0')}`;

    // Standard ISO 8601 UTC Week Calculation
    const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dayNr = (target.getUTCDay() + 6) % 7; // Monday = 0
    target.setUTCDate(target.getUTCDate() - dayNr + 3);
    const firstThursday = target.getTime();
    target.setUTCMonth(0, 1);
    if (target.getUTCDay() !== 4) {
      target.setUTCMonth(0, 1 + ((4 - target.getUTCDay()) + 7) % 7);
    }
    const weekNumber = 1 + Math.ceil((firstThursday - target.getTime()) / 604800000);
    const weekStr = `${yearStr}-W${String(weekNumber).padStart(2, '0')}`;

    return { day: dayStr, week: weekStr, month: monthStr, year: yearStr };
  }

  private currentDayStartTimestamp: number = 0;
  private nextMidnightTimestamp: number = 0;

  private updateCalendarKeys(timestamp: number): void {
    const keys = CountryLeaderboard.getCalendarKeys(timestamp);
    this.currentDayKey = keys.day;
    this.currentWeekKey = keys.week;
    this.currentMonthKey = keys.month;
    this.currentYearKey = keys.year;

    const d = new Date(timestamp);
    this.currentDayStartTimestamp = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0);
    this.nextMidnightTimestamp = this.currentDayStartTimestamp + 86400000;
  }

  /**
   * Checks for UTC calendar boundaries and rolls over periods if crossed.
   */
  public checkRollover(timestamp: number = this.lastUpdated || Date.now()): void {
    if (!this.currentDayKey) {
      this.updateCalendarKeys(timestamp);
      return;
    }

    // High-performance bypass: skip date parsing if still within the current UTC day
    if (this.currentDayStartTimestamp && this.nextMidnightTimestamp && timestamp >= this.currentDayStartTimestamp && timestamp < this.nextMidnightTimestamp) {
      return;
    }

    const keys = CountryLeaderboard.getCalendarKeys(timestamp);

    if (keys.day !== this.currentDayKey) {
      for (const rec of this.records.values()) {
        rec.day = 0;
      }
      this.currentDayKey = keys.day;
    }

    if (keys.week !== this.currentWeekKey) {
      for (const rec of this.records.values()) {
        rec.week = 0;
      }
      this.currentWeekKey = keys.week;
    }

    if (keys.month !== this.currentMonthKey) {
      for (const rec of this.records.values()) {
        rec.month = 0;
      }
      this.currentMonthKey = keys.month;
    }

    if (keys.year !== this.currentYearKey) {
      for (const rec of this.records.values()) {
        rec.year = 0;
      }
      this.currentYearKey = keys.year;
    }

    const d = new Date(timestamp);
    this.currentDayStartTimestamp = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0);
    this.nextMidnightTimestamp = this.currentDayStartTimestamp + 86400000;
  }

  /**
   * Ingests a strike, resolves its country, and increments all time-partition counters.
   */
  public recordStrike(
    lat: number,
    lon: number,
    timestamp: number = Date.now(),
    override?: { country: string; iso: string; flag: string }
  ): void {
    this.checkRollover(timestamp);

    const geo = override ?? this.geoEnricher.lookup(lat, lon);
    const iso = geo.iso || 'OC';

    let rec = this.records.get(iso);
    if (!rec) {
      rec = {
        iso,
        country: geo.country,
        flag: geo.flag,
        lat,
        lon,
        day: 0,
        week: 0,
        month: 0,
        year: 0,
        allTime: 0
      };
      this.records.set(iso, rec);
    }

    // Increment time-partition counters
    rec.day++;
    rec.week++;
    rec.month++;
    rec.year++;
    rec.allTime++;

    // Update cumulative running centroid
    rec.lat = rec.lat + (lat - rec.lat) / rec.allTime;
    rec.lon = rec.lon + (lon - rec.lon) / rec.allTime;

    this.lastUpdated = timestamp;
    this.scheduleSave();
  }

  /**
   * Returns sorted leaderboard ranking list for the given period.
   */
  public getRankings(period: LeaderboardPeriod, limit: number = 50, now: number = this.lastUpdated || Date.now()): CountryRankItem[] {
    this.checkRollover(now);

    const items: CountryRankItem[] = [];
    let totalStrikes = 0;

    for (const rec of this.records.values()) {
      const count = rec[period];
      if (count > 0) {
        totalStrikes += count;
        items.push({
          rank: 0,
          iso: rec.iso,
          country: rec.country,
          flag: rec.flag,
          count,
          percentage: 0,
          lat: rec.lat,
          lon: rec.lon
        });
      }
    }

    // Sort by count descending
    items.sort((a, b) => b.count - a.count);

    // Assign rank numbers and compute percentages
    const result = items.slice(0, limit);
    for (let i = 0; i < result.length; i++) {
      result[i].rank = i + 1;
      result[i].percentage = totalStrikes > 0 ? (result[i].count / totalStrikes) * 100 : 0;
    }

    return result;
  }

  /**
   * Returns total strike count across all countries for the given period.
   */
  public getTotal(period: LeaderboardPeriod, now: number = this.lastUpdated || Date.now()): number {
    this.checkRollover(now);
    let total = 0;
    for (const rec of this.records.values()) {
      total += rec[period];
    }
    return total;
  }

  /**
   * Returns strike count for a specific country in the given period (default: 'day').
   */
  public getCountryCount(iso: string, period: LeaderboardPeriod = 'day'): number {
    this.checkRollover(Date.now());
    return this.records.get(iso)?.[period] ?? 0;
  }


  /**
   * Resets counts for a specific period or all periods.
   */
  public reset(period?: LeaderboardPeriod | 'all'): void {
    if (!period || period === 'all') {
      this.records.clear();
    } else {
      for (const rec of this.records.values()) {
        rec[period] = 0;
      }
    }
    this.save();
  }

  /**
   * Schedules a debounced save to storage.
   */
  private scheduleSave(): void {
    if (this.saveDebounceTimer) return;
    this.saveDebounceTimer = setTimeout(() => {
      this.saveDebounceTimer = null;
      this.save();
    }, 1500);
  }

  /**
   * Persists state to storage.
   */
  public save(): void {
    if (!this.storage) return;

    try {
      const recordsObj: Record<string, CountryRecord> = {};
      for (const [k, v] of this.records.entries()) {
        recordsObj[k] = v;
      }

      const payload: LeaderboardPersistedState = {
        currentDayKey: this.currentDayKey,
        currentWeekKey: this.currentWeekKey,
        currentMonthKey: this.currentMonthKey,
        currentYearKey: this.currentYearKey,
        lastUpdated: this.lastUpdated,
        records: recordsObj
      };

      this.storage.setItem(CountryLeaderboard.STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
      console.warn('Failed to save CountryLeaderboard to storage:', e);
    }
  }

  /**
   * Hydrates state from storage.
   */
  public load(): void {
    if (!this.storage) return;

    try {
      const raw = this.storage.getItem(CountryLeaderboard.STORAGE_KEY);
      if (!raw) return;

      const payload: LeaderboardPersistedState = JSON.parse(raw);
      if (!payload || !payload.records) return;

      this.currentDayKey = payload.currentDayKey || this.currentDayKey;
      this.currentWeekKey = payload.currentWeekKey || this.currentWeekKey;
      this.currentMonthKey = payload.currentMonthKey || this.currentMonthKey;
      this.currentYearKey = payload.currentYearKey || this.currentYearKey;
      this.lastUpdated = payload.lastUpdated || Date.now();

      this.records.clear();
      for (const [k, v] of Object.entries(payload.records)) {
        this.records.set(k, v);
      }

      // Roll over any timeframes that expired while offline
      this.checkRollover(Date.now());
    } catch (e) {
      console.warn('Failed to load CountryLeaderboard from storage:', e);
    }
  }

  public getRecord(iso: string): CountryRecord | undefined {
    return this.records.get(iso);
  }

  public getTrackedCountryCount(): number {
    return this.records.size;
  }

  public clear(): void {
    this.records.clear();
    this.storage?.removeItem(CountryLeaderboard.STORAGE_KEY);
  }
}
