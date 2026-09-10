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

export interface DirectorConfig {
  clusterCooldownMs: number;
  spatialCooldownRadiusKm: number;
  interruptScoreRatio: number;
  interruptMinScore: number;
  maxQueueSize: number;
  queueStaleTimeoutMs: number;
}
