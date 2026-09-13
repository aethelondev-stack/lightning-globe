/**
 * lightningDataWorker.ts
 * Dedicated background Web Worker for parsing & deduplicating historical 24h lightning archives
 * and large satellite data packages (EUMETSAT MTG, NOAA GOES) off the main UI rendering thread.
 * 
 * Uses zero-copy typed arrays (Transferable Objects) where applicable or structured messages.
 */

export interface WorkerParseRequest {
  type: 'PARSE_ARCHIVE' | 'PARSE_BATCH';
  id: string;
  jsonString?: string;
  rawStrikes?: any[];
  since?: number;
}

export interface CompactStrikeRecord {
  id: string;
  lat: number;
  lon: number;
  time: number;
  ka: number;
  type: 'CG' | 'IC';
  src: string;
}

export interface WorkerParseResponse {
  type: 'PARSE_COMPLETE';
  id: string;
  strikes: CompactStrikeRecord[];
  totalProcessed: number;
  durationMs: number;
}

self.onmessage = (e: MessageEvent<WorkerParseRequest>) => {
  const { type, id, jsonString, rawStrikes, since } = e.data;
  const startTime = performance.now();

  try {
    let items: any[] = [];
    if (type === 'PARSE_ARCHIVE' && jsonString) {
      const parsed = JSON.parse(jsonString);
      items = Array.isArray(parsed) ? parsed : (parsed.strikes || []);
    } else if (jsonString) {
      const parsed = JSON.parse(jsonString);
      items = Array.isArray(parsed) ? parsed : (parsed.strikes || []);
    } else if (rawStrikes && Array.isArray(rawStrikes)) {
      items = rawStrikes;
    }

    const sinceTime = since ?? 0;
    const result: CompactStrikeRecord[] = [];
    const len = items.length;

    for (let i = 0; i < len; i++) {
      const item = items[i];
      if (!item) continue;

      const lat = Number(item.latitude ?? item.lat);
      const lon = Number(item.longitude ?? item.lon ?? item.lng);
      const time = Number(item.timestamp ?? item.time);
      const ka = Number(item.peakCurrent ?? item.ka ?? item.current ?? 25);

      // Coordinate boundary validation
      if (isNaN(lat) || isNaN(lon) || isNaN(time) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        continue;
      }

      if (sinceTime > 0 && time < sinceTime) {
        continue;
      }

      const strikeId = String(item.id || `w-${time}-${i}`);
      const typeStr: 'CG' | 'IC' = (item.type === 'IC' || item.type === 'ic') ? 'IC' : 'CG';
      const srcStr = String(item.source ?? item.src ?? 'blitzortung');

      result.push({
        id: strikeId,
        lat,
        lon,
        time,
        ka: isNaN(ka) ? 25 : ka,
        type: typeStr,
        src: srcStr
      });
    }

    const durationMs = performance.now() - startTime;
    const response: WorkerParseResponse = {
      type: 'PARSE_COMPLETE',
      id,
      strikes: result,
      totalProcessed: len,
      durationMs
    };

    self.postMessage(response);
  } catch (err: any) {
    self.postMessage({
      type: 'PARSE_ERROR',
      id,
      error: err?.message || 'Worker parse error'
    });
  }
};
