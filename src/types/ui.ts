import type { ScoredCluster } from './scoring';
import type { DemoScenarioId } from './scenario';
import type { DataSourceMode } from './connection';
import type { MultiSourceMode } from './provider';

export type ViewMode = 'AUTO' | 'MANUAL';
export type ClassFilter = 'ALL' | 'LOCAL' | 'REGIONAL' | 'CONTINENTAL';

export interface DetailedStrikeInfo {
  latitude: number;
  longitude: number;
  timestamp: number;
  peakCurrent: number;
  type: string;
  country: string;
  iso: string;
  flag: string;
  todayCountryStrikes?: number;
  city?: string;
  region?: string;
  street?: string;
  source?: string;
  opticalEnergy?: number;
  opticalArea?: number;
}

import type { LeaderboardPeriod } from '../services/analytics/CountryLeaderboard';

export interface UIState {
  viewMode: ViewMode;
  classFilter: ClassFilter;
  reducedMotion: boolean;
  isStormListOpen: boolean;
  isLeaderboardOpen: boolean;
  leaderboardPeriod: LeaderboardPeriod;
  dataSourceMode: DataSourceMode;
  multiSourceMode: MultiSourceMode;
  isAudioMuted: boolean;
  isTrailsEnabled: boolean;
  isElevationEnabled: boolean;
  isAtmosphereEnabled: boolean;
}

import type { CameraFramingMode } from './camera';

export interface UIControllerCallbacks {
  onViewModeChange?: (mode: 'AUTO' | 'MANUAL') => void;
  onClassFilterChange?: (filter: ClassFilter) => void;
  onReducedMotionChange?: (enabled: boolean) => void;
  onSelectCluster?: (cluster: ScoredCluster) => void;
  onScenarioChange?: (scenarioId: DemoScenarioId) => void;
  onDataSourceChange?: (mode: DataSourceMode) => void;
  onFeedModeChange?: (mode: MultiSourceMode) => void;
  onAtmosphereToggle?: (enabled: boolean) => void;
  onAudioToggle?: (muted: boolean) => void;
  onTrailsToggle?: (enabled: boolean) => void;
  onToggleElevation?: (enabled: boolean) => void;
  onFlyToStrike?: (lat: number, lon: number) => void;
  onSelectCountry?: (lat: number, lon: number) => void;
  onLocationSelect?: (lat: number, lon: number, distance: number, name: string) => void;
  onCameraFilterMatrixChange?: (matrix: any) => void;
  onCategoryFilterChange?: (category: any) => void;
  onClearArchive?: () => void;
  onCameraFramingModeChange?: (mode: CameraFramingMode) => void;
  onDroneAngleChange?: (angle: number, distance: number) => void;
}
