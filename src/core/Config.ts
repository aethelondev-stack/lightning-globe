/**
 * Central Configuration for Lightning Globe Engine
 * Referencing CONFIG_GUIDE.md
 */

export const EngineConfig = {
  // Rendering
  backgroundColor: 0x020208,
  maxPixelRatio: 1.0,
  powerPreference: 'high-performance' as WebGLPowerPreference,
  antialias: true,

  // Camera Defaults
  camera: {
    fov: 45,
    near: 0.1,
    far: 10000,
    initialPosition: { x: 0, y: 0, z: 260 }
  },

  // Globe
  globe: {
    radius: 100,
    defaultRotationSpeed: 0 // 0 = Earth fixed to real UTC orientation; free orbit via controls
  },

  // Lighting & Tone
  toneMappingExposure: 1.2,
  lighting: {
    ambient: {
      color: 0xffffff,
      intensity: 0.02 // Deep space night contrast: eliminates unnatural blue glow across dark side
    },
    directional: {
      color: 0xffffff,
      intensity: 2.8,
      distance: 300
    }
  },

  // Store & Deduplication Configuration (Phase 4)
  store: {
    retentionMs: 15 * 60 * 1000, // 15 minutes rolling window
    maxCapacity: 5000, // Strict maximum capacity to avoid memory leaks
    dedupDistanceKm: 15, // 15 km spatial threshold
    dedupTimeWindowMs: 500 // 500 ms temporal threshold
  },

  // Clustering Configuration (Phase 5)
  clustering: {
    spatialRadiusKm: 48, // 48 km distance threshold (convective storm scale)
    temporalWindowMs: 10 * 60 * 1000, // 10 minutes temporal window
    minClusterEvents: 3, // Minimum events required to form a cluster (rejection of isolated noise)
    minBoundingRadiusKm: 25 // Minimum bounding radius clamp for camera framing
  },

  // Storm Activity Scoring & Presentation Priority (Phase 6)
  scoring: {
    weights: {
      rate: 0.40,
      growth: 0.25,
      size: 0.20,
      energy: 0.15
    },
    framingThresholds: {
      macroRadiusMaxKm: 35,
      localRadiusMaxKm: 80,
      regionalRadiusMaxKm: 200
    },
    saturationLimits: {
      maxStrikesPerMinute: 30,
      maxClusterEvents: 50,
      maxCurrentKa: 80
    }
  },

  // Cinematic Camera Director Configuration (Phase 7 & Intelligent Tracking Upgrade)
  cameraDirector: {
    approachDurationMs: 2500,
    maxApproachDurationMs: 4600,
    holdDurationMs: 7000,
    minInterruptHoldMs: 4000,
    returnDurationMs: 2200,
    userInterruptionCooldownMs: 4000,
    idleDwellMs: 4000,
    idleDistance: 260,
    minFocusDistance: 135,
    framingDistances: {
      MACRO: 135,
      LOCAL: 155,
      REGIONAL: 180,
      CONTINENTAL: 215,
      GLOBAL: 275
    }
  },

  // Cinematic Lightning VFX & Procedural Bolts (Phase 8 & Scientific Classification)
  vfx: {
    maxActiveBolts: 64,
    boltDurationMs: 350,
    boltBranchProbability: 0.35,
    boltDisplacementScale: 2.2,
    flashIntensity: 3.0,
    flashDistance: 25,
    flashDecayMs: 200,
    cloudAltitude: 14.0
  },

  // Event Director, Presentation Queue & Cooldown Management (Phase 9 & Intelligent Tracking Upgrade)
  eventDirector: {
    clusterCooldownMs: 18000, // 18 seconds cluster airtime cooldown (allows active hubs to be revisited in rotation)
    spatialCooldownRadiusKm: 60, // 60 km proximity suppression (distinguishes neighboring convective cells)
    interruptScoreRatio: 1.5, // 50% score advantage required for emergency interruption
    interruptMinScore: 0.70, // Base threshold for interrupt candidate
    maxQueueSize: 8, // Bounded priority queue size
    queueStaleTimeoutMs: 600000 // 10 minutes stale timeout (rejects dead storms)
  },

  // Experience Controls & UI Configuration (Phase 10)
  ui: {
    defaultViewMode: 'AUTO' as const,
    defaultFilter: 'ALL' as const,
    reducedMotionMultiplier: 1.8
  },

  // Demo Scenarios & Stress Testing (Phase 11)
  scenarios: {
    defaultScenario: 'COMPETING_STORMS' as const,
    definitions: [
      {
        id: 'COMPETING_STORMS' as const,
        name: '⚡ Competing Superstorms',
        description: 'Dual simultaneous hubs (Amazon & SE Asia) testing queue & cooldown handover',
        targetFps: 60,
        expectedStrikesPerSec: 16
      },
      {
        id: 'INTENSE_STORM' as const,
        name: '⚡ Congo Outbreak',
        description: 'Explosive growth storm ramping from 2/s to 20/s to trigger emergency interrupt',
        targetFps: 60,
        expectedStrikesPerSec: 18
      },
      {
        id: 'LOCAL_CLUSTER' as const,
        name: '🌦 Local Cluster',
        description: 'Single localized storm cell in Costa Rica (~35km radius) testing LOCAL framing',
        targetFps: 60,
        expectedStrikesPerSec: 2.5
      },
      {
        id: 'DATELINE_STORM' as const,
        name: '🌐 Dateline (±180°)',
        description: 'Cross-antimeridian storm spanning Fiji/Tonga testing continuous centroid SLERP',
        targetFps: 60,
        expectedStrikesPerSec: 6
      },
      {
        id: 'SINGLE_STRIKE' as const,
        name: '🎯 Isolated Strikes',
        description: 'Infrequent isolated strikes across distant quadrants testing noise rejection (0 clusters)',
        targetFps: 60,
        expectedStrikesPerSec: 0.33
      },
      {
        id: 'EXTREME_SURGE' as const,
        name: '🔥 Extreme Surge (100/s)',
        description: 'High-volume 80-100 strikes/sec stress test verifying memory ceiling and 60 FPS stability',
        targetFps: 60,
        expectedStrikesPerSec: 90
      }
    ]
  },

  // Live Realtime Stream & Reliability Configuration (Phase 13)
  liveStream: {
    primaryEndpoint: 'wss://ws1.blitzortung.org',
    fallbackEndpoints: [
      'wss://ws2.blitzortung.org',
      'wss://ws7.blitzortung.org',
      'wss://ws8.blitzortung.org',
      'wss://live.blitzortung.org'
    ],
    reconnectBaseMs: 1000,
    reconnectMaxMs: 30000,
    staleTimeoutMs: 10000,
    heartbeatIntervalMs: 15000,
    defaultDataSource: 'LIVE' as const
  }
} as const;
