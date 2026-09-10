import type { LightningEvent } from '../../types/lightning';

export interface ArchivedStrike {
  id: string;
  timestamp: number;
  dateKey: string; // YYYY-MM-DD
  timeKey: string; // HH:mm:ss
  latitude: number;
  longitude: number;
  peakCurrent: number;
  energyScore: number;
  country?: string;
  type: string;
  source: string;
}

export interface StrikeArchiveDBOptions {
  dbName?: string;
  dbVersion?: number;
  idbFactory?: IDBFactory;
  flushIntervalMs?: number;
  maxBufferSize?: number;
}

/**
 * StrikeArchiveDB: High-performance IndexedDB persistent storage for real-time lightning events.
 *
 * Capabilities:
 * - 1-second write window buffering with atomic bulk transactions.
 * - Multi-key indexing by timestamp, dateKey (YYYY-MM-DD), timeKey, country and peak current.
 * - Non-blocking async queueing preventing UI thread stalls.
 * - Graceful fallback to memory store if indexedDB is unavailable (e.g., in test environments without IDB).
 */
export class StrikeArchiveDB {
  private readonly dbName: string;
  private readonly dbVersion: number;
  private readonly idbFactory: IDBFactory | null;
  private readonly flushIntervalMs: number;
  private readonly maxBufferSize: number;

  private db: IDBDatabase | null = null;
  private initPromise: Promise<IDBDatabase | null> | null = null;
  private buffer: ArchivedStrike[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private inMemoryFallback: Map<string, ArchivedStrike> = new Map();
  private isUsingFallback: boolean = false;

  constructor(options?: StrikeArchiveDBOptions) {
    this.dbName = options?.dbName ?? 'LightningGlobeArchive';
    this.dbVersion = options?.dbVersion ?? 1;
    this.flushIntervalMs = options?.flushIntervalMs ?? 1000;
    this.maxBufferSize = options?.maxBufferSize ?? 200;

    if (options?.idbFactory) {
      this.idbFactory = options.idbFactory;
    } else if (typeof indexedDB !== 'undefined') {
      this.idbFactory = indexedDB;
    } else {
      this.idbFactory = null;
      this.isUsingFallback = true;
    }

    this.startFlushTimer();
  }

  public async init(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    if (!this.idbFactory) {
      this.isUsingFallback = true;
      return;
    }

    this.initPromise = new Promise<IDBDatabase | null>((resolve) => {
      try {
        const request = this.idbFactory!.open(this.dbName, this.dbVersion);

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains('strikes')) {
            const store = db.createObjectStore('strikes', { keyPath: 'id' });
            store.createIndex('timestamp', 'timestamp', { unique: false });
            store.createIndex('dateKey', 'dateKey', { unique: false });
            store.createIndex('timeKey', 'timeKey', { unique: false });
            store.createIndex('country', 'country', { unique: false });
            store.createIndex('peakCurrent', 'peakCurrent', { unique: false });
          }
        };

        request.onsuccess = (event) => {
          this.db = (event.target as IDBOpenDBRequest).result;
          resolve(this.db);
        };

        request.onerror = (event) => {
          console.warn('⚠️ IndexedDB open error, using memory fallback:', (event.target as IDBOpenDBRequest).error);
          this.isUsingFallback = true;
          resolve(null);
        };
      } catch (err) {
        console.warn('⚠️ IndexedDB initialization failed, using memory fallback:', err);
        this.isUsingFallback = true;
        resolve(null);
      }
    });

    await this.initPromise;
  }

  /**
   * Enqueues a single strike to the write buffer.
   */
  public saveStrike(event: LightningEvent, country?: string): void {
    // Reject any synthetic, seed, or simulated strikes
    if (
      event.source === 'synthetic' ||
      (event.source as any) === 'simulation' ||
      event.id.startsWith('seed-') ||
      event.id.startsWith('synth-') ||
      event.id.startsWith('scenario-')
    ) {
      return;
    }

    const d = new Date(event.timestamp);
    const dateKey = d.toISOString().slice(0, 10); // YYYY-MM-DD
    const timeKey = d.toTimeString().slice(0, 8); // HH:mm:ss

    const record: ArchivedStrike = {
      id: event.id,
      timestamp: event.timestamp,
      dateKey,
      timeKey,
      latitude: event.latitude,
      longitude: event.longitude,
      peakCurrent: event.peakCurrent ?? 0,
      energyScore: Math.min(1.0, Math.abs(event.peakCurrent ?? 25) / 100),
      country: country || (event as any).country,
      type: event.type,
      source: event.source
    };

    this.buffer.push(record);

    if (this.buffer.length >= this.maxBufferSize) {
      this.flush().catch((err) => console.error('Auto-flush error:', err));
    }
  }

  /**
   * Commits all buffered strikes into IndexedDB via a single bulk transaction.
   */
  public async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const itemsToFlush = [...this.buffer];
    this.buffer = [];

    await this.init();

    if (this.isUsingFallback || !this.db) {
      for (const item of itemsToFlush) {
        this.inMemoryFallback.set(item.id, item);
      }
      return;
    }

    return new Promise<void>((resolve, reject) => {
      try {
        const tx = this.db!.transaction('strikes', 'readwrite');
        const store = tx.objectStore('strikes');

        for (const item of itemsToFlush) {
          store.put(item);
        }

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      } catch (err) {
        // Fall back to in-memory if transaction fails
        for (const item of itemsToFlush) {
          this.inMemoryFallback.set(item.id, item);
        }
        resolve();
      }
    });
  }

  /**
   * Queries strikes within a timestamp range [startTime, endTime].
   */
  public async getStrikesByTimeRange(startTime: number, endTime: number): Promise<ArchivedStrike[]> {
    await this.flush();
    await this.init();

    if (this.isUsingFallback || !this.db) {
      return Array.from(this.inMemoryFallback.values()).filter(
        (s) => s.timestamp >= startTime && s.timestamp <= endTime
      );
    }

    return new Promise<ArchivedStrike[]>((resolve, reject) => {
      try {
        const tx = this.db!.transaction('strikes', 'readonly');
        const store = tx.objectStore('strikes');
        const index = store.index('timestamp');
        const range = IDBKeyRange.bound(startTime, endTime);
        const results: ArchivedStrike[] = [];

        const request = index.openCursor(range);
        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
          if (cursor) {
            results.push(cursor.value);
            cursor.continue();
          } else {
            resolve(results);
          }
        };
        request.onerror = () => reject(request.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Queries strikes within a calendar date range [startDate, endDate] (e.g. '2026-09-01' to '2026-09-06').
   */
  public async getStrikesByDateRange(startDate: string, endDate: string): Promise<ArchivedStrike[]> {
    await this.flush();
    await this.init();

    if (this.isUsingFallback || !this.db) {
      return Array.from(this.inMemoryFallback.values()).filter(
        (s) => s.dateKey >= startDate && s.dateKey <= endDate
      );
    }

    return new Promise<ArchivedStrike[]>((resolve, reject) => {
      try {
        const tx = this.db!.transaction('strikes', 'readonly');
        const store = tx.objectStore('strikes');
        const index = store.index('dateKey');
        const range = IDBKeyRange.bound(startDate, endDate);
        const results: ArchivedStrike[] = [];

        const request = index.openCursor(range);
        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
          if (cursor) {
            results.push(cursor.value);
            cursor.continue();
          } else {
            resolve(results);
          }
        };
        request.onerror = () => reject(request.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Returns total count of archived strikes.
   */
  public async getTotalCount(): Promise<number> {
    await this.flush();
    await this.init();

    if (this.isUsingFallback || !this.db) {
      return this.inMemoryFallback.size;
    }

    return new Promise<number>((resolve, reject) => {
      try {
        const tx = this.db!.transaction('strikes', 'readonly');
        const store = tx.objectStore('strikes');
        const request = store.count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Returns count of strikes for a specific country on a specific date (defaults to today).
   */
  public async getCountryStrikeCountForDate(
    countryName: string,
    dateKey: string = new Date().toISOString().slice(0, 10)
  ): Promise<number> {
    await this.flush();
    await this.init();

    if (this.isUsingFallback || !this.db) {
      let count = 0;
      const targetCountry = countryName.toLowerCase();
      for (const strike of this.inMemoryFallback.values()) {
        if (strike.dateKey === dateKey && strike.country?.toLowerCase() === targetCountry) {
          count++;
        }
      }
      return count;
    }

    return new Promise<number>((resolve, reject) => {
      try {
        const tx = this.db!.transaction('strikes', 'readonly');
        const store = tx.objectStore('strikes');
        const index = store.index('country');
        const request = index.openCursor(IDBKeyRange.only(countryName));
        let count = 0;

        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
          if (cursor) {
            if (cursor.value.dateKey === dateKey) {
              count++;
            }
            cursor.continue();
          } else {
            resolve(count);
          }
        };
        request.onerror = () => reject(request.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Clears all stored records.
   */
  public async clear(): Promise<void> {
    this.buffer = [];
    this.inMemoryFallback.clear();
    await this.init();

    if (this.isUsingFallback || !this.db) {
      return;
    }

    return new Promise<void>((resolve, reject) => {
      try {
        const tx = this.db!.transaction('strikes', 'readwrite');
        const store = tx.objectStore('strikes');
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Purges all synthetic, simulated, or seed strikes from storage, retaining strictly real live events.
   */
  public async purgeSyntheticStrikes(): Promise<number> {
    await this.flush();
    await this.init();

    let purgedCount = 0;
    for (const [id, strike] of this.inMemoryFallback.entries()) {
      if (
        (strike.source !== 'blitzortung' && strike.source !== 'goes16' && strike.source !== 'goes16_glm' && strike.source !== 'goes18_glm' && strike.source !== 'goes19_glm' && strike.source !== 'mtg_li' && strike.source !== 'hybrid') ||
        id.startsWith('seed-') ||
        id.startsWith('synth-') ||
        id.startsWith('scenario-') ||
        id.startsWith('sim-') ||
        id.startsWith('test-')
      ) {
        this.inMemoryFallback.delete(id);
        purgedCount++;
      }
    }

    if (this.isUsingFallback || !this.db) {
      return purgedCount;
    }

    return new Promise<number>((resolve, reject) => {
      try {
        const tx = this.db!.transaction('strikes', 'readwrite');
        const store = tx.objectStore('strikes');
        const request = store.openCursor();

        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
          if (cursor) {
            const val = cursor.value as ArchivedStrike;
            if (
              (val.source !== 'blitzortung' && val.source !== 'goes16' && val.source !== 'goes16_glm' && val.source !== 'goes18_glm' && val.source !== 'goes19_glm' && val.source !== 'mtg_li' && val.source !== 'hybrid') ||
              val.id.startsWith('seed-') ||
              val.id.startsWith('synth-') ||
              val.id.startsWith('scenario-') ||
              val.id.startsWith('sim-') ||
              val.id.startsWith('test-')
            ) {
              cursor.delete();
              purgedCount++;
            }
            cursor.continue();
          } else {
            resolve(purgedCount);
          }
        };
        request.onerror = () => reject(request.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Purges all strikes older than cutoffTimestamp from storage (e.g. 24 hours ago).
   */
  public async pruneOlderThan(cutoffTimestamp: number): Promise<number> {
    await this.flush();
    await this.init();

    let prunedCount = 0;
    for (const [id, strike] of this.inMemoryFallback.entries()) {
      if (strike.timestamp < cutoffTimestamp) {
        this.inMemoryFallback.delete(id);
        prunedCount++;
      }
    }

    if (this.isUsingFallback || !this.db) {
      return prunedCount;
    }

    return new Promise<number>((resolve, reject) => {
      try {
        const tx = this.db!.transaction('strikes', 'readwrite');
        const store = tx.objectStore('strikes');
        const index = store.index('timestamp');
        // All records with timestamp strictly less than cutoffTimestamp
        const range = IDBKeyRange.upperBound(cutoffTimestamp, true);
        const request = index.openCursor(range);

        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
          if (cursor) {
            cursor.delete();
            prunedCount++;
            cursor.continue();
          } else {
            resolve(prunedCount);
          }
        };
        request.onerror = () => reject(request.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Completely clears all strikes from both in-memory cache and IndexedDB storage.
   */
  public async clearAll(): Promise<void> {
    this.buffer = [];
    this.inMemoryFallback.clear();
    await this.init();

    if (this.isUsingFallback || !this.db) {
      return;
    }

    return new Promise<void>((resolve, reject) => {
      try {
        const tx = this.db!.transaction('strikes', 'readwrite');
        const store = tx.objectStore('strikes');
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  private pruneTimer: ReturnType<typeof setInterval> | null = null;

  private startPruneTimer(): void {
    if (this.pruneTimer !== null) return;
    // Auto-prune records older than 24 hours every 60 seconds
    this.pruneTimer = setInterval(() => {
      const cutoff = Date.now() - 86400000;
      this.pruneOlderThan(cutoff).catch((err) => {
        console.warn('Auto 24h prune warning:', err);
      });
    }, 60000);
  }

  private startFlushTimer(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = setInterval(() => {
      if (this.buffer.length > 0) {
        this.flush().catch((err) => console.error('Periodic flush error:', err));
      }
    }, this.flushIntervalMs);
    this.startPruneTimer();
  }

  public close(): void {
    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.pruneTimer !== null) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initPromise = null;
    }
  }
}
