import type { ScoredCluster } from './scoring';

export interface QueueItem {
  cluster: ScoredCluster;
  enqueuedAt: number;
  priority: number;
}

export interface PresentationHistoryEntry {
  clusterId: string;
  centroid: { latitude: number; longitude: number };
  presentedAt: number;
  cooldownUntil: number;
  presentationCount: number;
}

export interface ViewerRequest {
  id: string;
  username: string;
  platform?: 'kick' | 'youtube';
  countryName: string;
  countryIso?: string;
  countryFlag?: string;
  requestedAt: number;
  hasStorm?: boolean;
  isCalmSky?: boolean;
  cluster?: ScoredCluster;
  status?: 'calm' | 'storm';
}

export interface InterleavedQueueTarget {
  id: string;
  type: 'NATURAL' | 'VIEWER';
  rank: number;
  countryName: string;
  countryFlag: string;
  title?: string;
  score?: number;
  scaleClass?: string;
  scale?: string;
  viewerUser?: string;
  isCalmSky?: boolean;
  viewerRequest?: ViewerRequest;
  cluster?: ScoredCluster;
}

export interface DirectorConfig {
  clusterCooldownMs: number;
  spatialCooldownRadiusKm: number;
  interruptScoreRatio: number;
  interruptMinScore: number;
  maxQueueSize: number;
  queueStaleTimeoutMs: number;
}
