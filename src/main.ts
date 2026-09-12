import * as THREE from 'three';
import { Engine } from './core/Engine';
import { GlobeManager } from './world/GlobeManager';
import { ControlsManager } from './core/ControlsManager';
import { LightningRenderer } from './world/LightningRenderer';
import { LiveEventStore } from './services/store/LiveEventStore';
import { ClusterEngine } from './services/clustering/ClusterEngine';
import { ActivityScorer } from './services/scoring/ActivityScorer';
import { CameraDirector } from './services/camera/CameraDirector';
import { EventDirector } from './services/director/EventDirector';
import { ScenarioManager } from './services/scenarios/ScenarioManager';
import { LiveStreamProvider } from './services/providers/LiveStreamProvider';
import { GoesGlmProvider } from './services/providers/GoesGlmProvider';
import { Goes18GlmProvider } from './services/providers/Goes18GlmProvider';
import { MtgLiProvider } from './services/providers/MtgLiProvider';
import { MultiSourceHarmonizer } from './services/providers/MultiSourceHarmonizer';
import { RegionalFeedsProvider } from './services/providers/RegionalFeedsProvider';
import { UnifiedStreamProvider } from './services/providers/UnifiedStreamProvider';
import { PerformanceProfiler } from './services/profiling/PerformanceProfiler';
import { SoundDirector } from './services/audio/SoundDirector';
import { GeoEnricher } from './services/geo/GeoEnricher';
import { StormCellBatcher } from './services/clustering/StormCellBatcher';
import { CountryLeaderboard } from './services/analytics/CountryLeaderboard';
import { StrikeArchiveDB } from './services/storage/StrikeArchiveDB';
import { StochasticRingBufferQueue } from './services/queue/StochasticRingBufferQueue';
import { UIController } from './ui/UIController';
import { BackgroundMusicPlayer } from './services/audio/BackgroundMusicPlayer';
import { StreamController } from './services/stream/StreamController';
import { EngineConfig } from './core/Config';
import { haversineDistanceKm, vector3ToLatLng, latLngToVector3 } from './utils/coordinates';
import type { ILightningProvider } from './types/provider';
import type { DataSourceMode } from './types/connection';
import type { LightningEvent } from './types/lightning';
import type { ScoredCluster, PresentationClass } from './types/scoring';

function init(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#webgl-canvas');
  if (!canvas) {
    throw new Error('Canvas element "#webgl-canvas" not found in DOM.');
  }

  // 1. Initialize core rendering engine with static global vantage
  const engine = new Engine({ canvas });
  engine.camera.position.set(0, 20, 340);
  engine.camera.lookAt(0, 0, 0);

  // 2. Initialize interactive orbit controls (centered at 0,0,0, minDistance 145)
  const controlsManager = new ControlsManager(engine.camera, engine.canvas);
  controlsManager.adoptCamera(engine.camera.position, new THREE.Vector3(0, 0, 0));

  // 3. Initialize globe manager with photorealistic 4K textures, night lights & atmosphere glow
  const globeManager = new GlobeManager(engine.scene, engine.renderer);
  globeManager.setCamera(engine.camera);

  // 4. Initialize high-performance batched lightning renderer
  const lightningRenderer = new LightningRenderer(globeManager.globe);
  lightningRenderer.setStormCellRadar(globeManager.stormCellRadar);

  // 5. Initialize bounded historical store with spatial-temporal deduplication
  const store = new LiveEventStore();

  // 5b. Initialize 120 FPS Presentation Queue with Burst-Guard (Zero-Allocation Ring Buffer)
  const presentationQueue = new StochasticRingBufferQueue({
    capacity: 10000,
    maxSatellitePerFrame: 2,
    maxRfPerFrame: 1
  });

  // 6. Initialize real-time clustering engine (Phase 5)
  const clusterEngine = new ClusterEngine();

  // 7. Initialize storm activity scoring & presentation priority engine (Phase 6)
  const activityScorer = new ActivityScorer();

  // 8. Initialize Google Earth style free orbit camera (Earth suspended at space origin)
  const cameraDirector = new CameraDirector(engine.camera, controlsManager, {
    enableIntroOrbit: false,
    idleDistance: 260
  });

  // 9. Initialize autonomous event director & presentation queue (Phase 9)
  const eventDirector = new EventDirector();

  // 10. Initialize deterministic scenario manager (Phase 11)
  const scenarioManager = new ScenarioManager(EngineConfig.scenarios.defaultScenario);

  // 11. Initialize live realtime WebSocket stream provider (Phase 13)
  const liveStreamProvider = new LiveStreamProvider();

  // 11b. Initialize Satellite Optical Providers (NOAA GOES-16, NOAA GOES-18, EUMETSAT MTG-I1)
  const goesGlmProvider = new GoesGlmProvider();
  const goes18GlmProvider = new Goes18GlmProvider();
  const mtgLiProvider = new MtgLiProvider();
  const regionalFeedsProvider = new RegionalFeedsProvider();

  // 11c. Initialize Composite Multi-Source Harmonizer & Deduplicator (Global 7-Stream)
  const multiSourceHarmonizer = new MultiSourceHarmonizer({
    rfProvider: liveStreamProvider,
    satProvider: goesGlmProvider,
    sat18Provider: goes18GlmProvider,
    satMtgProvider: mtgLiProvider,
    regionalProvider: regionalFeedsProvider,
    defaultMode: 'ALL_HYBRID'
  });

  // 11d. Initialize Unified Realtime Stream Provider (Master Hub SSE & 24h Archive)
  const unifiedStreamProvider = new UnifiedStreamProvider();

  // 12. Initialize procedural sound director (Phase 14)
  const soundDirector = new SoundDirector();

  // 13. Initialize client-side geographic enricher (Phase 17)
  const geoEnricher = GeoEnricher.getInstance();

  // 14. Initialize Storm Cell Batcher with 4-hour persistence window and 7-tier scale
  const stormCellBatcher = new StormCellBatcher({ windowMs: 14400000, minStrikes: 3 });
  stormCellBatcher.setMode('24H');

  // 15. Initialize Real Calendar Country Leaderboard Engine (Phase 21)
  const countryLeaderboard = new CountryLeaderboard(undefined, geoEnricher);

  // 16. Initialize Chronological IndexedDB Strike Archive (Phase 23)
  const strikeArchive = new StrikeArchiveDB();

  /**
   * Centralized 24H trace and storm batcher hydration.
   * Ingests verified real strikes from Unified Hub S3/FMI archive and local persistent storage.
   * Strictly 0% synthetic, seed, or simulated strikes.
   */
  let isHydrating = false;
  const hydrate24HTrails = async (): Promise<void> => {
    if (isHydrating) return;
    isHydrating = true;
    const now = Date.now();
    try {
      // 1. Fetch real 24h strikes from Unified Hub (if backend is available)
      let hubStrikes: LightningEvent[] = [];
      try {
        hubStrikes = await unifiedStreamProvider.fetch24hHistory(now - 86400000);
      } catch {
        // Standalone or Cloudflare environment: Hub archive endpoint is optional
      }

      // 2. Fetch local IndexedDB strikes
      const historicalStrikes = await strikeArchive.getStrikesByTimeRange(now - 86400000, now);

      const strikeMap = new Map<string, LightningEvent>();
      for (let i = 0; i < hubStrikes.length; i++) {
        strikeMap.set(hubStrikes[i].id, hubStrikes[i]);
      }

      if (historicalStrikes && historicalStrikes.length > 0) {
        for (let i = 0; i < historicalStrikes.length; i++) {
          const h = historicalStrikes[i];
          // Strictly reject any synthetic, seed, simulation, or unverified strike remnants
          if (
            (h.source !== 'blitzortung' && h.source !== 'goes16' && h.source !== 'goes16_glm' && h.source !== 'goes18_glm' && h.source !== 'goes19_glm' && h.source !== 'mtg_li' && h.source !== 'singapore_nea' && h.source !== 'japan_jma' && h.source !== 'finland_fmi' && h.source !== 'hybrid') ||
            h.id.startsWith('seed-') ||
            h.id.startsWith('synth-') ||
            h.id.startsWith('scenario-') ||
            h.id.startsWith('sim-') ||
            h.id.startsWith('test-')
          ) {
            continue;
          }
          if (!strikeMap.has(h.id)) {
            strikeMap.set(h.id, {
              id: h.id,
              latitude: h.latitude,
              longitude: h.longitude,
              timestamp: h.timestamp,
              peakCurrent: h.peakCurrent,
              type: (h.type as any) ?? 'CG',
              source: (h.source as any) ?? 'blitzortung'
            });
          }
        }
      }

      const rawStrikes = Array.from(strikeMap.values()).sort((a, b) => a.timestamp - b.timestamp);

      // High-performance O(N) Cross-Sensor Spatial-Temporal Deduplication
      // Fuses co-observations (e.g. Blitzortung RF ground strike + GOES/MTG optical flash)
      // Criterion: dt <= 1200ms and dr <= 18km (0.20° spatial grid hash)
      const dedupGrid = new Map<string, LightningEvent[]>();
      const strikesToRender: LightningEvent[] = [];
      const binDeg = 0.20;

      for (let i = 0; i < rawStrikes.length; i++) {
        const s = rawStrikes[i];
        const latBin = Math.floor(s.latitude / binDeg);
        const lonBin = Math.floor(s.longitude / binDeg);
        const key = `${latBin}_${lonBin}`;
        let isDup = false;

        for (let dLat = -1; dLat <= 1 && !isDup; dLat++) {
          for (let dLon = -1; dLon <= 1 && !isDup; dLon++) {
            const nKey = `${latBin + dLat}_${lonBin + dLon}`;
            const binList = dedupGrid.get(nKey);
            if (binList) {
              for (let j = binList.length - 1; j >= 0; j--) {
                const existing = binList[j];
                if (s.timestamp - existing.timestamp > 2000) break;
                if (existing.source !== s.source) {
                  const timeDiff = Math.abs(s.timestamp - existing.timestamp);
                  if (timeDiff <= 1200) {
                    const dLatKm = Math.abs(s.latitude - existing.latitude) * 111.0;
                    const dLonKm = Math.abs(s.longitude - existing.longitude) * 111.0 * Math.cos(s.latitude * (Math.PI / 180));
                    if ((dLatKm * dLatKm + dLonKm * dLonKm) <= 324) { // 18 km threshold
                      isDup = true;
                      if (existing.source.startsWith('goes') && s.source === 'blitzortung' && s.peakCurrent) {
                        existing.peakCurrent = s.peakCurrent;
                        existing.source = 'hybrid' as any;
                      }
                      break;
                    }
                  }
                }
              }
            }
          }
        }

        if (!isDup) {
          strikesToRender.push(s);
          let cell = dedupGrid.get(key);
          if (!cell) {
            cell = [];
            dedupGrid.set(key, cell);
          }
          cell.push(s);
        }
      }

      if (strikesToRender.length > 0) {
        // Hydrate up to FulguriteTraceLayer's 120,000 strike capacity (eliminates artificial 4000 strike cutoff)
        const maxCapacity = globeManager.fulguriteTraceLayer.maxStrikes ?? 120000;
        const visualStrikes = strikesToRender.length > maxCapacity
          ? strikesToRender.slice(-maxCapacity)
          : strikesToRender;

        globeManager.fulguriteTraceLayer.hydrateHistoricalStrikes(visualStrikes);
        stormCellBatcher.addHistoricalStrikes(visualStrikes);

        // Immediately update stormCellRadar and UI with 24H pre-clustered storm cells
        const initial24hCells = stormCellBatcher.getActiveStormCells(now);
        globeManager.stormCellRadar.updateCells(initial24hCells);
        uiController.updatePetekCategoryCounts(initial24hCells);

        // Seed store SILENTLY so recent events are queryable without triggering live VFX/audio explosions
        const recentForStore = visualStrikes.slice(-2000);
        for (let i = 0; i < recentForStore.length; i++) {
          store.addEvent(recentForStore[i], false);
        }
        // Seed recent strikes into live feed journal
        const feedSeed = visualStrikes.slice(-30);
        for (let i = 0; i < feedSeed.length; i++) {
          const s = feedSeed[i];
          const geo = geoEnricher.lookup(s.latitude, s.longitude);
          uiController.addLiveStrikeFeedItem(s, geo?.country, geo?.flag);
        }

        // High-performance spatial-grid cached geo lookups (eliminates 60,000 raycasts freezing main thread)
        const geoGridCache = new Map<string, any>();
        const getCachedGeo = (lat: number, lon: number) => {
          const key = `${Math.round(lat * 5)},${Math.round(lon * 5)}`;
          let res = geoGridCache.get(key);
          if (!res) {
            res = geoEnricher.lookup(lat, lon);
            geoGridCache.set(key, res);
          }
          return res;
        };

        // Hydrate country leaderboard with 24-hour historical strikes in non-blocking async micro-batches
        for (let i = 0; i < strikesToRender.length; i++) {
          const s = strikesToRender[i];
          const geo = getCachedGeo(s.latitude, s.longitude);
          countryLeaderboard.recordStrike(s.latitude, s.longitude, s.timestamp, geo);
          if (i > 0 && i % 15000 === 0) {
            await new Promise((r) => setTimeout(r, 0));
          }
        }

        uiController.updateLeaderboard(
          countryLeaderboard.getRankings('day', 100),
          countryLeaderboard.getTotal('day')
        );

        console.log(`⚡ [Hydrate24H] Hydrated ${visualStrikes.length} real 24h strikes into storm cells, radar, fulgurite traces, and country leaderboard (deduped ${rawStrikes.length - strikesToRender.length} duplicates).`);
      }
    } catch (err) {
      console.warn('Note on 24h real strike archive hydration:', err);
      globeManager.fulguriteTraceLayer.clear();
      stormCellBatcher.clear();
    } finally {
      isHydrating = false;
    }
  };

  // Immediate startup hydration from Unified Hub 24h archive
  hydrate24HTrails();

  // Initialize StrikeArchiveDB; persist real strikes across page refreshes
  strikeArchive.init().then(async () => {
    console.log('📦 StrikeArchiveDB persistent storage initialized.');
  }).catch(console.error);

  // Track active data source mode ('SIMULATION' vs 'LIVE')
  let currentSourceMode: DataSourceMode = EngineConfig.liveStream.defaultDataSource;

  // Register clean atomic teardown hooks when scenarios switch
  scenarioManager.registerTeardownHook(() => {
    presentationQueue.clear();
    store.clear();
    stormCellBatcher.clear();
    globeManager.stormCellRadar.clear();
    globeManager.fulguriteTraceLayer.clear();
    eventDirector.clear();
    cameraDirector.resetToIdle();
    if (currentSourceMode === 'LIVE' && globeManager.fulguriteTraceLayer.getMode() === '24H') {
      hydrate24HTrails();
    }
  });

  let harmonizerEngaged = false;

  const engageHarmonizerFallback = (): void => {
    if (currentSourceMode === 'LIVE' && !harmonizerEngaged) {
      harmonizerEngaged = true;
      console.log('⚡ [Live Ingest] Engaging browser-direct MultiSourceHarmonizer (Blitzortung WebSocket)...');
      multiSourceHarmonizer.connect().catch(console.error);
    }
  };

  const startLiveStream = (): void => {
    // 1. Try connecting Unified Hub SSE stream
    unifiedStreamProvider.connect().catch(() => {
      engageHarmonizerFallback();
    });

    // 2. If Unified Hub is STALE / not LIVE after 2.5s (e.g. running on Cloudflare), engage fallback
    setTimeout(() => {
      if (currentSourceMode === 'LIVE' && unifiedStreamProvider.status !== 'LIVE') {
        engageHarmonizerFallback();
      }
    }, 2500);

    unifiedStreamProvider.onStatusChange((status) => {
      if (status === 'LIVE') {
        if (harmonizerEngaged) {
          multiSourceHarmonizer.disconnect();
          harmonizerEngaged = false;
        }
      } else if ((status === 'STALE' || status === 'OFFLINE') && currentSourceMode === 'LIVE') {
        engageHarmonizerFallback();
      }
    });
  };

  const stopLiveStream = (): void => {
    unifiedStreamProvider.disconnect();
    if (harmonizerEngaged) {
      multiSourceHarmonizer.disconnect();
      harmonizerEngaged = false;
    }
  };

  const switchDataSource = (mode: DataSourceMode): void => {
    if (mode === currentSourceMode) return;

    currentSourceMode = mode;
    presentationQueue.clear();
    store.clear();
    stormCellBatcher.clear();
    globeManager.stormCellRadar.clear();
    globeManager.fulguriteTraceLayer.clear();
    eventDirector.clear();
    cameraDirector.resetToIdle();
    if (mode === 'LIVE' && globeManager.fulguriteTraceLayer.getMode() === '24H') {
      hydrate24HTrails();
    }

    if (mode === 'LIVE') {
      scenarioManager.disconnect();
      startLiveStream();
    } else {
      stopLiveStream();
      scenarioManager.connect().catch((err) => {
        console.error('Failed to connect scenario manager:', err);
      });
    }
  };

  // 16. Initialize Experience Controls UI Controller (Phase 10, 13, 14, 17, 18, 21, 22, FAZ 2)
  const uiController = new UIController({
    onViewModeChange: (mode) => {
      cameraDirector.setManualMode(mode === 'MANUAL');
    },
    onClassFilterChange: (filter) => {
      eventDirector.setClassFilter(filter);
    },
    onReducedMotionChange: (enabled) => {
      cameraDirector.setReducedMotion(enabled);
    },
    onCameraFilterMatrixChange: (matrix) => {
      cameraDirector.setFilterMatrix(matrix);
      eventDirector.setFilterMatrix(matrix);
    },
    onSelectCluster: (cluster) => {
      cameraDirector.startCinematicFlight(cluster);
    },
    onScenarioChange: (scenarioId) => {
      scenarioManager.setScenario(scenarioId);
    },
    onDataSourceChange: (mode) => {
      switchDataSource(mode);
    },
    onFeedModeChange: (mode) => {
      multiSourceHarmonizer.setMode(mode);
    },
    onAtmosphereToggle: (enabled) => {
      globeManager.atmosphericPotentialLayer.setEnabled(enabled);
    },
    onAudioToggle: (muted) => {
      soundDirector.setMuted(muted);
    },
    onTrailsToggle: (enabled) => {
      const mode = enabled ? '24H' : 'SESSION';
      globeManager.fulguriteTraceLayer.setMode(mode);
      stormCellBatcher.setMode(mode);
      globeManager.stormCellRadar.setEnabled(true);
      globeManager.stormCellRadar.group.visible = true;
      if (enabled && currentSourceMode === 'LIVE') {
        hydrate24HTrails();
      } else if (!enabled) {
        globeManager.fulguriteTraceLayer.clear();
      }
    },
    onToggleElevation: (enabled) => {
      globeManager.set3DElevationEnabled(enabled);
    },
    onFlyToStrike: (lat, lon) => {
      cameraDirector.flyToLocation(lat, lon, cameraDirector.getTargetDistance());
    },
    onSelectCountry: (lat, lon) => {
      const geo = geoEnricher.lookup(lat, lon);
      const todayCount = countryLeaderboard.getCountryCount(geo.iso, 'day');
      uiController.showStrikeDetail({
        latitude: lat,
        longitude: lon,
        timestamp: Date.now(),
        peakCurrent: 0,
        type: 'TERRITORY',
        country: geo.country,
        iso: geo.iso,
        flag: geo.flag,
        todayCountryStrikes: todayCount
      });
      cameraDirector.flyToLocation(lat, lon, cameraDirector.getTargetDistance());
    },
    onLocationSelect: (lat, lon, distance, _name) => {
      cameraDirector.flyToLocation(lat, lon, distance);
    },
    onCategoryFilterChange: (category) => {
      eventDirector.setCategoryFilter(category);
    },
    onClearArchive: async () => {
      await strikeArchive.clear();
      store.clear();
      globeManager.fulguriteTraceLayer.clear();
      stormCellBatcher.clear();
      countryLeaderboard.clear();
      uiController.updateStormList([]);
      uiController.updateLeaderboard([], 0);
      uiController.clearLiveStrikeFeed();
      console.log('🗑️ Tüm yerel şimşek verileri ve arşiv başarıyla sıfırlandı.');
    },
    onCameraFramingModeChange: (mode) => {
      cameraDirector.setFramingMode(mode);
    },
    onDroneAngleChange: (angle, distance) => {
      cameraDirector.setDroneAngle(angle);
      cameraDirector.setDroneDistance(distance);
    },
    onPetekMasterOpacityChange: (opacity) => {
      globeManager.stormCellRadar.setGlobalOpacity(opacity);
    },
    onPetekTierOpacityChange: (tier, opacity) => {
      globeManager.stormCellRadar.setTierOpacity(tier, opacity);
    }
  });

  // 16b. Initialize Background Instrumental Ambient Music Player (20 Tracks)
  const bgMusicPlayer = new BackgroundMusicPlayer();
  bgMusicPlayer.init();
  uiController.setupMusicPlayer(bgMusicPlayer);

  // 16d. Setup Procedural Sound Director (Volume, Profiles, Test Strike)
  uiController.setupSoundDirector(soundDirector);

  // Hook Dynamic Cadence Acceleration: cut current dwell by 50% on viewer request
  eventDirector.onCadenceAccelerate(() => {
    cameraDirector.accelerateCadence(0.5);
  });

  // 16c. Initialize Live Broadcast Chat Command & HUD Controller
  const streamController = new StreamController({
    onCommand: (payload) => {
      const cmd = (payload.command || '').toLowerCase().trim();
      const currentCoords = vector3ToLatLng(engine.camera.position);
      const currentDist = engine.camera.position.length();

      // Audience Interactive Country Targeting (Full AI Automation)
      let requestedCountry: string | null = null;
      if (cmd === '!turkiye' || cmd === '!turk' || cmd === '!tr' || cmd === '!türkiye') {
        requestedCountry = 'Türkiye';
      } else if (cmd === '!brezilya' || cmd === '!brazil' || cmd === '!br') {
        requestedCountry = 'Brezilya';
      } else if (cmd === '!amerika' || cmd === '!usa' || cmd === '!us') {
        requestedCountry = 'Amerika Birleşik Devletleri';
      } else if (cmd === '!japonya' || cmd === '!japan' || cmd === '!jp') {
        requestedCountry = 'Japonya';
      } else if (cmd === '!almanya' || cmd === '!germany' || cmd === '!de') {
        requestedCountry = 'Almanya';
      } else if (cmd === '!fransa' || cmd === '!france' || cmd === '!fr') {
        requestedCountry = 'Fransa';
      } else if (cmd === '!ingiltere' || cmd === '!uk' || cmd === '!gb') {
        requestedCountry = 'Birleşik Krallık';
      } else if (cmd === '!italya' || cmd === '!italy' || cmd === '!it') {
        requestedCountry = 'İtalya';
      } else if (cmd === '!ispanya' || cmd === '!spain' || cmd === '!es') {
        requestedCountry = 'İspanya';
      } else if (cmd === '!kanada' || cmd === '!canada' || cmd === '!ca') {
        requestedCountry = 'Kanada';
      } else if (cmd === '!avustralya' || cmd === '!australia' || cmd === '!au') {
        requestedCountry = 'Avustralya';
      } else if (cmd.startsWith('!ulke ') || cmd.startsWith('!ülke ') || cmd.startsWith('!country ')) {
        requestedCountry = payload.command.substring(cmd.indexOf(' ') + 1).trim();
      }

      if (requestedCountry) {
        const res = eventDirector.addViewerRequest({
          username: payload.user,
          countryName: requestedCountry,
          platform: 'kick'
        });
        if (res.success) {
          const statusNote = res.isCalmSky ? '🛰️ Sakin alan' : '⚡ Aktif fırtına';
          streamController.showToast(payload.user, `🎯 @${payload.user} -> ${requestedCountry} (#${res.position} | ${statusNote})`);
        } else {
          streamController.showToast(payload.user, `⚠️ @${payload.user}: ${res.message}`);
        }
      } else if (cmd === '!firtina' || cmd === '!storm') {
        const queue = eventDirector.getQueue();
        const target = queue.length > 0 ? queue[0].cluster : eventDirector.getNextTarget(Date.now());
        if (target) {
          cameraDirector.startCinematicFlight(target);
          const geo = geoEnricher.lookup(target.centroid.latitude, target.centroid.longitude);
          streamController.showToast(payload.user, `⚡ En aktif fırtınaya (${geo.flag} ${geo.country}) uçuluyor!`);
        } else {
          streamController.showToast(payload.user, "⚡ Şu anda fırtına odağı taranıyor...");
        }
      } else if (cmd === '!dunya' || cmd === '!world') {
        cameraDirector.setFilterMatrix({ cameraMode: 'MANUAL', autoFollow: false });
        cameraDirector.flyToLocation(currentCoords.lat, currentCoords.lng, 380);
        streamController.showToast(payload.user, "🌍 Dünya genel görünümüne geçildi.");
      } else if (cmd === '!oto' || cmd === '!auto') {
        cameraDirector.setFilterMatrix({ cameraMode: 'AUTO', autoFollow: true });
        streamController.showToast(payload.user, "🎥 Otonom sinematik kamera devrede.");
      } else if (cmd === '!zoom') {
        cameraDirector.flyToLocation(currentCoords.lat, currentCoords.lng, Math.max(150, currentDist * 0.7));
        streamController.showToast(payload.user, "🔍 Yakınlaştırıldı.");
      } else if (cmd === '!uzaklas' || cmd === '!out') {
        cameraDirector.flyToLocation(currentCoords.lat, currentCoords.lng, Math.min(380, currentDist * 1.4));
        streamController.showToast(payload.user, "🔭 Uzaklaştırıldı.");
      }
    }
  });

  // Autoplay music and enable sound in broadcast mode
  const isBroadcastMode = new URLSearchParams(window.location.search).has('broadcast') || new URLSearchParams(window.location.search).has('stream');
  if (isBroadcastMode) {
    soundDirector.setMuted(false);
    bgMusicPlayer.play();
  }

  // Connect Camera Director target provider from Event Director (only active if autoFollow is explicitly enabled)
  cameraDirector.setTargetProvider(() => {
    if (!cameraDirector.isAutoFollow()) return null;
    return eventDirector.getNextTarget(Date.now());
  });

  // Pre-ionization ground radar warmup hook during descent
  cameraDirector.onApproachWarmup = (clusterId, lat, lon) => {
    globeManager.stormCellRadar.triggerApproachWarmup(clusterId, lat, lon);
  };

  // Sync Camera Mode to UI if changed externally (e.g. user touched globe)
  cameraDirector.onStateChange((_state, _target) => {
    uiController.syncExternalCameraMode(cameraDirector.isAutoFollow());
  });

  // Initialize and populate country search list
  geoEnricher.init().then(() => {
    uiController.populateCountries(geoEnricher.getAllCountriesList());
  });

  const scratchAudioWorldPos = new THREE.Vector3();
  const scratchAudioWorldNormal = new THREE.Vector3();
  const scratchAudioToCam = new THREE.Vector3();
  const scratchAudioProjected = new THREE.Vector3();

  const isStrikeVisibleToCamera = (localPos: THREE.Vector3): boolean => {
    // 1. Transform local strike coordinate into actual World Space based on Earth's matrixWorld
    scratchAudioWorldPos.copy(localPos).applyMatrix4(globeManager.globe.matrixWorld);

    // 2. Visible hemisphere test in World Space (strike must be on the visible face of Earth towards camera)
    scratchAudioWorldNormal.copy(scratchAudioWorldPos).normalize();
    scratchAudioToCam.copy(engine.camera.position).sub(scratchAudioWorldPos).normalize();
    // Allow strikes along the atmospheric rim/horizon (-0.08)
    if (scratchAudioWorldNormal.dot(scratchAudioToCam) < -0.08) {
      return false;
    }

    // 3. Camera frustum projection test in World Space (comfortably includes peripheral and horizon flashes)
    scratchAudioProjected.copy(scratchAudioWorldPos).project(engine.camera);
    if (
      scratchAudioProjected.z < -1 ||
      scratchAudioProjected.z > 1 ||
      Math.abs(scratchAudioProjected.x) > 1.45 ||
      Math.abs(scratchAudioProjected.y) > 1.45
    ) {
      return false;
    }

    return true;
  };

  const triggerStrikeVfxAndAudio = (e: LightningEvent) => {
    lightningRenderer.addEvent(e);
    const strikePos = latLngToVector3(e.latitude, e.longitude, 0, EngineConfig.globe.radius);
    if (isStrikeVisibleToCamera(strikePos)) {
      soundDirector.playStrikeSound(e.peakCurrent ?? 25, strikePos, engine.camera.position);
    }
  };

  // Arrival-synced flash playback hook: 1.2s before touchdown, trigger focal strike so user witnesses flash & shockwave live
  cameraDirector.onArrivalFlash = (cluster) => {
    const lat = cluster.centroid.latitude;
    const lon = cluster.centroid.longitude;
    const lastEvent = cluster.events && cluster.events.length > 0 ? cluster.events[cluster.events.length - 1] : null;
    const arrivalEvent: LightningEvent = {
      id: `arrival-flash-${cluster.id}-${Date.now()}`,
      latitude: lat,
      longitude: lon,
      timestamp: Date.now(),
      peakCurrent: lastEvent?.peakCurrent ?? (Math.random() < 0.35 ? 42 : 26),
      type: lastEvent?.type ?? 'CG',
      source: lastEvent?.source ?? 'goes16_glm'
    };
    lightningRenderer.addEvent(arrivalEvent);
    const strikePos = latLngToVector3(lat, lon, 0, EngineConfig.globe.radius);
    // Forced arrival sound: 0ms latency, guaranteed synchronous playback with visual touchdown flash
    soundDirector.playStrikeSound(arrivalEvent.peakCurrent ?? 45, strikePos, engine.camera.position, undefined, true);
    globeManager.fulguriteTraceLayer.addStrike(lat, lon, arrivalEvent.timestamp, arrivalEvent.peakCurrent ?? 25);
    globeManager.stormCellRadar.triggerStrikeImpact(cluster.id, lat, lon, arrivalEvent.peakCurrent ?? 25);
  };

  // Interactive Raycasting Strike Selection on Canvas (Phase 17)
  const raycaster = new THREE.Raycaster();
  const mouseVec = new THREE.Vector2();
  let pointerDownPos = { x: 0, y: 0, time: 0 };

  const handleGlobeClick = (clientX: number, clientY: number): void => {
    const rect = canvas.getBoundingClientRect();
    mouseVec.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouseVec.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouseVec, engine.camera);

    const sphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), EngineConfig.globe.radius);
    const intersection = new THREE.Vector3();
    if (!raycaster.ray.intersectSphere(sphere, intersection)) {
      uiController.hideStrikeDetail();
      return;
    }

    const coords = vector3ToLatLng(intersection);
    const lat = coords.lat;
    const lon = coords.lng;

    // Search for closest active strike in store within 350 km
    const candidates = store.getRecentEvents(180000);
    let closestStrike: LightningEvent | null = null;
    let minDistKm = 350;

    for (let i = 0; i < candidates.length; i++) {
      const strike = candidates[i];
      const d = haversineDistanceKm(lat, lon, strike.latitude, strike.longitude);
      if (d < minDistKm) {
        minDistKm = d;
        closestStrike = strike;
      }
    }

    const targetLat = closestStrike ? closestStrike.latitude : lat;
    const targetLon = closestStrike ? closestStrike.longitude : lon;
    const geo = geoEnricher.lookup(targetLat, targetLon);
    const todayCount = countryLeaderboard.getCountryCount(geo.iso, 'day');

    uiController.showStrikeDetail({
      latitude: targetLat,
      longitude: targetLon,
      timestamp: closestStrike ? closestStrike.timestamp : Date.now(),
      peakCurrent: closestStrike ? closestStrike.peakCurrent : 0,
      type: closestStrike ? closestStrike.type : 'SURFACE',
      country: geo.country,
      iso: geo.iso,
      flag: geo.flag,
      todayCountryStrikes: todayCount,
      source: closestStrike ? closestStrike.source : undefined,
      opticalEnergy: closestStrike ? closestStrike.opticalEnergy : undefined,
      opticalArea: closestStrike ? closestStrike.opticalArea : undefined
    });

    geoEnricher.reverseGeocode(targetLat, targetLon).then((res) => {
      uiController.updateStrikeLocality(res.city, res.region, res.street);
    });
  };

  // Instant capture-phase user interaction handler:
  // Immediately yields any active automated camera sequence (APPROACH, HOLD, RETURN)
  // and enables OrbitControls BEFORE the event reaches OrbitControls in bubbling phase.
  canvas.addEventListener('pointerdown', (e) => {
    pointerDownPos = { x: e.clientX, y: e.clientY, time: Date.now() };
    if (e.button === 0 && cameraDirector.getState() !== 'IDLE') {
      cameraDirector.onUserInteraction();
    }
  }, { capture: true });

  canvas.addEventListener('wheel', () => {
    if (cameraDirector.getState() !== 'IDLE') {
      cameraDirector.onUserInteraction();
    }
  }, { capture: true, passive: true });

  canvas.addEventListener('pointerup', (e) => {
    const moveDist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
    const elapsed = Date.now() - pointerDownPos.time;
    if (moveDist <= 8 && elapsed < 800) {
      handleGlobeClick(e.clientX, e.clientY);
    }
  });

  canvas.addEventListener('click', (e) => {
    handleGlobeClick(e.clientX, e.clientY);
  });

  // Pointermove raycasting for 3D country hover extrusion & tooltip (Phase 22)
  let lastHoverCheck = 0;
  canvas.addEventListener('pointermove', (e) => {
    const now = performance.now();
    if (now - lastHoverCheck < 35) return; // Throttled to ~30 FPS
    lastHoverCheck = now;

    const rect = canvas.getBoundingClientRect();
    mouseVec.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouseVec.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouseVec, engine.camera);
    canvas.style.cursor = 'default';

    const sphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), EngineConfig.globe.radius);
    const intersection = new THREE.Vector3();
    if (!raycaster.ray.intersectSphere(sphere, intersection)) {
      globeManager.setHoveredCountry(null);
      uiController.hideCountryTooltip();
      return;
    }

    const coords = vector3ToLatLng(intersection);
    const geo = geoEnricher.lookup(coords.lat, coords.lng);
    if (geo.iso === 'XW' || geo.country === 'International Waters') {
      globeManager.setHoveredCountry(null);
      uiController.hideCountryTooltip();
    } else {
      globeManager.setHoveredCountry(geo);
      uiController.showCountryTooltip(geo.flag, geo.country, e.clientX, e.clientY);
    }
  });

  canvas.addEventListener('pointerleave', () => {
    globeManager.setHoveredCountry(null);
    uiController.hideCountryTooltip();
  });

  // Pipe incoming lightning events to presentationQueue based on active source mode
  scenarioManager.onEvent((event) => {
    if (currentSourceMode === 'SIMULATION') {
      presentationQueue.enqueueInstantRf(event);
    }
  });

  const enqueueStrike = (event: LightningEvent, isFromFallback: boolean = false) => {
    if (currentSourceMode === 'LIVE') {
      // Strict Single Ingest Guard: If unifiedStreamProvider is LIVE, ignore events from fallback harmonizer
      if (isFromFallback && unifiedStreamProvider.status === 'LIVE') {
        return;
      }
      if (event.source === 'blitzortung') {
        // Instant RF: zero delay bypass directly to instant queue
        presentationQueue.enqueueInstantRf(event);
      } else {
        // Satellite & regional radar: smooth stochastic distribution over 1.5s window to prevent abrupt floods and gaps
        const jitterTime = Date.now() + Math.random() * 1500;
        presentationQueue.enqueue(event, jitterTime, false);
      }
    }
  };

  unifiedStreamProvider.onEvent((event) => enqueueStrike(event, false));
  multiSourceHarmonizer.onEvent((event) => enqueueStrike(event, true));



  store.subscribe((event) => {
    // In LIVE mode: guard against synthetic or test mock events, while allowing real satellite GLM data
    if (currentSourceMode === 'LIVE') {
      if (
        event.source === 'synthetic' ||
        (event.source as any) === 'simulation' ||
        event.id.startsWith('seed-') ||
        event.id.startsWith('synth-') ||
        event.id.startsWith('scenario-')
      ) {
        return;
      }
    }

    // Direct, immediate strike visualization and audio trigger
    triggerStrikeVfxAndAudio(event);

    const strikeGeo = geoEnricher.lookup(event.latitude, event.longitude);

    globeManager.fulguriteTraceLayer.addStrike(event.latitude, event.longitude, event.timestamp, event.peakCurrent ?? 25);
    stormCellBatcher.addStrike(event);
    countryLeaderboard.recordStrike(event.latitude, event.longitude, event.timestamp, strikeGeo);

    // Trigger cute neon fluid saturation wave on interior honeycomb surface when hit
    globeManager.stormCellRadar.triggerStrikeImpact(null, event.latitude, event.longitude, event.peakCurrent ?? 25);

    if (currentSourceMode === 'LIVE') {
      strikeArchive.saveStrike(event, strikeGeo?.country);
    }

    // Add to real-time live feed journal in right sidebar (buffered & batched at 8Hz)
    uiController.addLiveStrikeFeedItem(event, strikeGeo?.country, strikeGeo?.flag);

    if (strikeGeo?.iso && uiController.getSelectedCountryIso() === strikeGeo.iso) {
      const updatedCount = countryLeaderboard.getCountryCount(strikeGeo.iso, 'day');
      uiController.updateCountryStrikeTelemetry(strikeGeo.iso, updatedCount);
    }
  });

  // 17. Initialize real-time performance profiler (Phase 12)
  const profiler = new PerformanceProfiler();

  // 18. Setup HUD elements, storm batching, leaderboard, and throttled metrics tracking (4Hz)
  setupHud(
    () => (currentSourceMode === 'LIVE' ? (unifiedStreamProvider.status === 'LIVE' ? unifiedStreamProvider : multiSourceHarmonizer) : scenarioManager),
    () => currentSourceMode,
    unifiedStreamProvider,
    store,
    lightningRenderer,
    clusterEngine,
    activityScorer,
    eventDirector,
    cameraDirector,
    uiController,
    scenarioManager,
    profiler,
    globeManager,
    stormCellBatcher,
    countryLeaderboard,
    geoEnricher
  );

  // Pre-allocated vectors for audio listener orientation (zero per-frame allocations)
  const cameraForward = new THREE.Vector3();
  const cameraUp = new THREE.Vector3();

  // 19. Register per-frame update callbacks (with profiler frame timing & audio trigger)
  engine.registerRenderCallback((delta: number) => {
    profiler.beginFrame();

    // 3D Spatial Audio orientation updated with Earth's rotation
    soundDirector.setGlobeMatrix(globeManager.globe.matrixWorld);
    engine.camera.getWorldDirection(cameraForward);
    cameraUp.copy(engine.camera.up).applyQuaternion(engine.camera.quaternion);
    soundDirector.updateListener(engine.camera.position, cameraForward, cameraUp);

    const camDistance = engine.camera.position.length();
    lightningRenderer.setCameraDistance(camDistance);
    globeManager.setCameraDistance(camDistance);
    uiController.updateCameraDistance(camDistance);

    // Dispatch ready strikes from zero-overhead presentation queue into Store & Petekler
    presentationQueue.update(Date.now(), (event) => {
      store.addEvent(event);
    });

    cameraDirector.update(delta);
    controlsManager.update(delta);
    globeManager.update(delta, performance.now() * 0.001, engine.camera.position);
    lightningRenderer.update();
  });

  // 20. Register post-render callback (measuring draw calls and total render duration)
  engine.registerPostRenderCallback(() => {
    profiler.endFrame(engine.renderer.info.render.calls);
  });

  // 22. Start engine loop and connect initial provider stream
  engine.start();
  if ((currentSourceMode as DataSourceMode) === 'LIVE') {
    startLiveStream();
  } else {
    scenarioManager.connect().catch((err) => {
      console.error('Failed to connect scenario manager:', err);
    });
  }

  console.log('⚡ Lightning Globe v2.0 — Global 7-Stream Realtime Network (RF + 3 Satellites + 3 Ground Networks) Initialized.');
}

function setupHud(
  getProvider: () => ILightningProvider,
  getSourceMode: () => DataSourceMode,
  unifiedStreamProvider: UnifiedStreamProvider,
  store: LiveEventStore,
  _renderer: LightningRenderer,
  clusterEngine: ClusterEngine,
  activityScorer: ActivityScorer,
  eventDirector: EventDirector,
  cameraDirector: CameraDirector,
  uiController: UIController,
  scenarioManager: ScenarioManager,
  profiler: PerformanceProfiler,
  globeManager: GlobeManager,
  stormCellBatcher: StormCellBatcher,
  countryLeaderboard: CountryLeaderboard,
  geoEnricher: GeoEnricher
): void {
  const statusEl = document.getElementById('hud-status-text');
  const dataSourceEl = document.getElementById('hud-data-source');
  const rateEl = document.getElementById('hud-rate');
  const totalEl = document.getElementById('hud-total');
  const storeCountEl = document.getElementById('hud-store-count');
  const dedupCountEl = document.getElementById('hud-dedup-count');
  const activeEl = document.getElementById('hud-active');
  const clusterCountEl = document.getElementById('hud-cluster-count');
  const topStormEl = document.getElementById('hud-top-storm');
  const topScoreEl = document.getElementById('hud-top-score');
  const topClassEl = document.getElementById('hud-top-class');
  const cameraStateEl = document.getElementById('hud-camera-state');
  const cameraTargetEl = document.getElementById('hud-camera-target');
  const queueCountEl = document.getElementById('hud-queue-count');
  const nextStormEl = document.getElementById('hud-next-storm');
  const cooldownCountEl = document.getElementById('hud-cooldown-count');
  const perfFpsEl = document.getElementById('hud-perf-fps');
  const perfFrameTimeEl = document.getElementById('hud-perf-frame-time');
  const perfHeapEl = document.getElementById('hud-perf-heap');
  const perfDrawCallsEl = document.getElementById('hud-perf-draw-calls');
  const scenarioNameEl = document.getElementById('hud-scenario-name');

  // Helper to prevent DOM mutations and layout invalidation when string content is identical
  const setTextIfChanged = (el: HTMLElement | null, text: string): void => {
    if (el && el.textContent !== text) {
      el.textContent = text;
    }
  };

  // Static Camera HUD metrics set once
  if (cameraStateEl) cameraStateEl.textContent = 'GÖZLEM: KÜRESEL BAKIŞ (SABİT)';
  if (cameraTargetEl) cameraTargetEl.textContent = 'DÜNYA GENELİ (280u)';

  // Throttle HUD DOM metrics update to 4Hz (every 250ms) to preserve 60 FPS
  let lastDomUpdate = 0;
  let cachedScoredClusters: ScoredCluster[] = [];
  let lastClusterComputeTime = 0;
  let lastNextStormKey = '';

  setInterval(() => {
    const now = Date.now();
    const currentMode = getSourceMode();
    const activeProvider = getProvider();
    const providerStats = activeProvider.getStats();
    const storeStats = store.getStats();

    // Data Source & Status HUD Indicator (Phase 13, FAZ 2)
    if (dataSourceEl) {
      if (currentMode === 'LIVE') {
        const modeLabel = 'HİBRİT (RF + 3 UYDU + 3 YER AĞI)';
        if (unifiedStreamProvider.status === 'LIVE') {
          setTextIfChanged(dataSourceEl, '● CANLI HİBRİT');
          dataSourceEl.title = modeLabel;
          dataSourceEl.style.color = '#38bdf8';
          setTextIfChanged(statusEl, 'CANLI HİBRİT');
        } else if (unifiedStreamProvider.status === 'STALE') {
          setTextIfChanged(dataSourceEl, '● GECİKMELİ');
          dataSourceEl.title = 'Son veri korunuyor (Stale)';
          dataSourceEl.style.color = '#fbbf24';
          setTextIfChanged(statusEl, 'GECİKMELİ');
        } else {
          setTextIfChanged(dataSourceEl, '● BAĞLANIYOR...');
          dataSourceEl.style.color = '#94a3b8';
          setTextIfChanged(statusEl, 'BAĞLANIYOR');
        }
      } else {
        setTextIfChanged(dataSourceEl, '● SİMÜLASYON');
        dataSourceEl.style.color = '#34d399';
        setTextIfChanged(statusEl, 'SİMÜLASYON (DEMO)');
      }
    }

    const is24hMode = stormCellBatcher.getMode() === '24H';
    const camState = cameraDirector.getState();

    // High-performance Decoupled Clustering:
    // 1. In 24H mode, effective clusters are derived directly from stormCellBatcher (bypasses O(N log N) event clustering).
    // 2. While camera is in APPROACH transit, suspend clustering to guarantee locked 60+ FPS zero frame skips.
    // 3. Throttle re-clustering to 1.5s intervals (4Hz interval handles DOM/HUD metrics, not heavy spatial graph loops).
    if (!is24hMode && camState !== 'APPROACH' && (now - lastClusterComputeTime >= 1500 || cachedScoredClusters.length === 0)) {
      lastClusterComputeTime = now;
      const recentEvents = store.getRecentEvents(EngineConfig.clustering.temporalWindowMs);
      const clusters = clusterEngine.clusterEvents(recentEvents);
      cachedScoredClusters = activityScorer.rankClusters(clusters);
    }
    const scoredClusters = cachedScoredClusters;

    setTextIfChanged(rateEl, providerStats.eventsPerSecond.toString());
    setTextIfChanged(totalEl, storeStats.totalReceived.toLocaleString());
    setTextIfChanged(storeCountEl, storeStats.totalStored.toLocaleString());
    setTextIfChanged(dedupCountEl, storeStats.totalDuplicatesRejected.toLocaleString());
    const stormCells = stormCellBatcher.getActiveStormCells(now);
    globeManager.stormCellRadar.updateCells(stormCells);

    const effectiveClusters: ScoredCluster[] = is24hMode && stormCells.length > 0
      ? stormCells.map((sc) => ({
          id: sc.id,
          centroid: sc.centroid,
          events: sc.events,
          eventCount: sc.strikeCount,
          firstEventTimestamp: sc.firstSeen,
          lastEventTimestamp: is24hMode ? now : sc.lastSeen,
          boundingRadiusKm: sc.boundingRadiusKm,
          activityScore: sc.tier === 'EXTREME' ? 1.0 : sc.tier === 'RED' ? 0.95 : sc.tier === 'YELLOW' ? 0.75 : sc.tier === 'BLUE' ? 0.55 : 0.35,
          presentationClass: (sc.tier === 'EXTREME' ? 'CONTINENTAL' : sc.tier === 'RED' ? 'CONTINENTAL' : sc.tier === 'YELLOW' ? 'REGIONAL' : 'LOCAL') as PresentationClass,
          strikesPerMinute: Math.round(sc.strikeCount / Math.max(1, (sc.lastSeen - sc.firstSeen) / 60000)),
          growthRate: 1.0,
          breakdown: { rateScore: 0.8, growthScore: 0.7, energyScore: 0.7, clusterSizeScore: 0.8 },
          stormClass: sc.stormClass
        }))
      : scoredClusters;

    setTextIfChanged(clusterCountEl, (is24hMode ? stormCells.length : scoredClusters.length).toString());

    // Update EventDirector with effective clusters (contains stormClass metadata for category lock)
    eventDirector.updateClusters(effectiveClusters, now);

    // 10-Second Throttled DOM updates (User Request): updates storm list, petek badges & leaderboard every 10s to eliminate layout thrashing
    const shouldUpdateDom = (now - lastDomUpdate >= 10000 || lastDomUpdate === 0);
    if (shouldUpdateDom) {
      lastDomUpdate = now;
      uiController.updateStormList(effectiveClusters);
      uiController.updatePetekCategoryCounts(stormCells);
      const period = uiController.getLeaderboardPeriod();
      const rankings = countryLeaderboard.getRankings(period, 50, now);
      const total = countryLeaderboard.getTotal(period, now);
      uiController.updateLeaderboard(rankings, total);
    }

    const topStorm = effectiveClusters[0];
    setTextIfChanged(activeEl, storeStats.totalStored.toString());
    setTextIfChanged(topStormEl, topStorm ? `${topStorm.centroid.latitude.toFixed(1)}°, ${topStorm.centroid.longitude.toFixed(1)}°` : '--');
    setTextIfChanged(topScoreEl, topStorm ? topStorm.activityScore.toFixed(2) : '--');
    setTextIfChanged(topClassEl, topStorm ? topStorm.presentationClass : '--');

    // Event Director Queue & Cooldown metrics
    const currentQueue = eventDirector.getQueue();
    setTextIfChanged(queueCountEl, currentQueue.length.toString());

    // Update 20-target Interleaved Camera Queue in right accordion panel
    const interleavedQueue = eventDirector.getInterleavedQueue(20);
    uiController.updateCameraQueue(interleavedQueue);

    // Update bottom-left Viewer Flight HUD Card
    const remainingDwell = cameraDirector.getRemainingDwellTime();
    uiController.updateViewerFlightHUD(
      eventDirector.getCurrentViewerRequest(),
      eventDirector.getNextUpcomingViewerRequest(),
      remainingDwell
    );

    if (nextStormEl) {
      if (currentQueue.length > 0) {
        const nextCluster = currentQueue[0].cluster;
        const key = `${nextCluster.id}:${nextCluster.activityScore.toFixed(2)}`;
        if (key !== lastNextStormKey) {
          lastNextStormKey = key;
          const geo = geoEnricher.lookup(nextCluster.centroid.latitude, nextCluster.centroid.longitude);
          const loc = geo?.country ? `${geo.flag} ${geo.country}` : nextCluster.presentationClass;
          setTextIfChanged(nextStormEl, `${loc} (${nextCluster.activityScore.toFixed(2)})`);
        }
      } else {
        lastNextStormKey = '';
        setTextIfChanged(nextStormEl, '-');
      }
    }
    setTextIfChanged(cooldownCountEl, eventDirector.getActiveCooldownCount(now).toString());

    if (scenarioNameEl) {
      setTextIfChanged(scenarioNameEl, scenarioManager.getActiveScenario().name);
    }

    // Performance Profiler HUD metrics (Phase 12)
    const metrics = profiler.getMetrics();
    setTextIfChanged(perfFpsEl, metrics.fps.toString());
    setTextIfChanged(perfFrameTimeEl, metrics.frameTimeMs.toFixed(1));
    setTextIfChanged(perfHeapEl, metrics.heapUsedMb > 0 ? metrics.heapUsedMb.toFixed(1) : 'N/A');
    setTextIfChanged(perfDrawCallsEl, metrics.drawCalls.toString());
  }, 250);
}

window.addEventListener('DOMContentLoaded', init);
