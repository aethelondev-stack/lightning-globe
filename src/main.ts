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

  // 1. Initialize core rendering engine with static global vantage (380u wide orbit)
  const engine = new Engine({ canvas });
  engine.camera.position.set(0, 30, 380);
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
    maxSatellitePerFrame: 6,
    maxRfPerFrame: 6
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
  // Boot sequence: start in manual mode at wide orbit before autonomous director activates at 6.5s
  cameraDirector.setFilterMatrix({ cameraMode: 'MANUAL', autoFollow: false });
  cameraDirector.setManualMode(true);

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

  // Sol Alt Görev ve Başlatma Paneli (Mission Boot HUD)
  const missionBootHud = document.getElementById('mission-boot-hud');
  const btnMbhToggle = document.getElementById('btn-mbh-toggle');
  const mbhLogList = document.getElementById('mbh-log-list');
  const mbhProgressContainer = document.getElementById('mbh-progress-container');
  const mbhBarFill = document.getElementById('mbh-bar-fill');
  const mbhProgressPercent = document.getElementById('mbh-progress-percent');

  btnMbhToggle?.addEventListener('click', (e) => {
    e.stopPropagation();
    missionBootHud?.classList.toggle('minimized');
    if (btnMbhToggle) {
      btnMbhToggle.textContent = missionBootHud?.classList.contains('minimized') ? '▴' : '▾';
    }
  });
  missionBootHud?.querySelector('.mbh-header')?.addEventListener('click', () => {
    missionBootHud?.classList.toggle('minimized');
    if (btnMbhToggle) {
      btnMbhToggle.textContent = missionBootHud?.classList.contains('minimized') ? '▴' : '▾';
    }
  });

  const addBootLog = (timeLabel: string, text: string, status: 'ok' | 'sync' | 'info' = 'ok') => {
    if (!mbhLogList) return;
    const item = document.createElement('div');
    const dotClass = status === 'ok' ? 'live' : status === 'sync' ? 'active' : 'completed';
    item.className = `mbh-log-item ${dotClass}`;
    item.innerHTML = `<span class="mbh-log-icon">[${timeLabel}]</span> <span class="mbh-log-text">${text}</span>`;
    mbhLogList.appendChild(item);
    mbhLogList.scrollTop = mbhLogList.scrollHeight;
  };

  let bootTimeStart = Date.now();
  let introPanActive = true;

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

      // Time-Sliced Deduplication to avoid locking the main thread
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

        // Time-slice deduplication every 25,000 strikes
        if (i > 0 && i % 25000 === 0) {
          await new Promise((r) => requestAnimationFrame(r));
        }
      }

      if (strikesToRender.length > 0) {
        // Hydrate up to FulguriteTraceLayer's 500,000 strike capacity (eliminates artificial cutoff)
        const maxCapacity = globeManager.fulguriteTraceLayer.maxStrikes ?? 500000;
        const visualStrikes = strikesToRender.length > maxCapacity
          ? strikesToRender.slice(-maxCapacity)
          : strikesToRender;

        // Progressive Trace Layer Hydration: uploads in 10,000-strike slices across frames without freezing GPU
        await globeManager.fulguriteTraceLayer.hydrateHistoricalStrikesProgressive(
          visualStrikes,
          10000,
          (loaded, total) => {
            const pct = Math.min(100, Math.round((loaded / total) * 100));
            if (mbhBarFill) mbhBarFill.style.width = `${pct}%`;
            if (mbhProgressPercent) mbhProgressPercent.textContent = `${pct}%`;
          }
        );

        // Pre-compute 24h storm cell honeycombs
        stormCellBatcher.addHistoricalStrikes(visualStrikes);

        // Immediately update stormCellRadar and UI with 24H pre-clustered storm cells
        const initial24hCells = stormCellBatcher.getActiveStormCells(now);
        globeManager.stormCellRadar.updateCells(initial24hCells);
        uiController.updatePetekCategoryCounts(initial24hCells);

        // Spatially balanced seed for store: guarantees South America, North America, Europe, Africa & Asia are well-represented
        const saStrikes = visualStrikes.filter(s => s.latitude >= -56 && s.latitude <= 13 && s.longitude >= -85 && s.longitude <= -34).slice(-400);
        const naStrikes = visualStrikes.filter(s => s.latitude >= 13 && s.latitude <= 72 && s.longitude >= -170 && s.longitude <= -50).slice(-400);
        const euStrikes = visualStrikes.filter(s => s.latitude >= 35 && s.latitude <= 72 && s.longitude >= -25 && s.longitude <= 45).slice(-400);
        const afStrikes = visualStrikes.filter(s => s.latitude >= -35 && s.latitude <= 35 && s.longitude >= -20 && s.longitude <= 55).slice(-400);
        const asiaStrikes = visualStrikes.filter(s => (s.longitude > 55 || s.longitude < -170)).slice(-400);
        const balancedRecent = [...saStrikes, ...naStrikes, ...euStrikes, ...afStrikes, ...asiaStrikes];

        for (let i = 0; i < balancedRecent.length; i++) {
          store.addEvent(balancedRecent[i], false);
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

  // Ultra-Lite TV / Kiosk Profile Detection (Mi Box 2 / Smart TVs / URL flag)
  const isTvMode = typeof window !== 'undefined' && (
    window.location.search.includes('tv=1') ||
    window.location.search.includes('lite=1') ||
    /Android.*TV|AFTT|MiBOX|SMART-TV/i.test(navigator.userAgent)
  );
  if (isTvMode) {
    console.log('📺 [TV Mode] Ultra-Lite TV / Kiosk profile active. Skipping heavy 24h archive to save VRAM and maintain 60 FPS.');
  }

  // Fast-Boot Snapshot (<100ms instant startup with spatially balanced strikes)
  const fastBootSnapshot = async (): Promise<boolean> => {
    try {
      const res = await fetch('/api/lightning/recent-quick', { signal: AbortSignal.timeout(3500) });
      if (!res.ok) return false;
      const data = await res.json();
      const strikes: LightningEvent[] = data?.strikes || [];
      if (strikes.length > 0) {
        console.log(`⚡ [Fast Boot] Loaded ${strikes.length} fresh spatially balanced strikes in <100ms.`);
        for (let i = 0; i < strikes.length; i++) {
          store.addEvent(strikes[i], false);
        }
        stormCellBatcher.addHistoricalStrikes(strikes);
        const initialCells = stormCellBatcher.getActiveStormCells(Date.now());
        globeManager.stormCellRadar.updateCells(initialCells);
        uiController.updatePetekCategoryCounts(initialCells);
        const feedSeed = strikes.slice(-25);
        for (let i = 0; i < feedSeed.length; i++) {
          const s = feedSeed[i];
          const geo = geoEnricher.lookup(s.latitude, s.longitude);
          uiController.addLiveStrikeFeedItem(s, geo?.country, geo?.flag);
        }
        return true;
      }
    } catch (e) {
      console.warn('⚡ [Fast Boot] Note:', e);
    }
    return false;
  };

  // Staged Boot Sequence (0-24s Timeline) & Telemetry HUD Logging
  addBootLog('0-3s', '🌐 3D Gezegen Çekirdeği Yüklendi', 'ok');

  // Immediate fast boot execution: shows strikes in <1s
  fastBootSnapshot().finally(() => {
    // 3s: Panoramic Wide Orbit Vantage
    setTimeout(() => {
      addBootLog('3s', '🛰️ Geniş Yörünge Panoramik İnceleme (380u)', 'info');
    }, 3000);

    // 4s: Real-time Ground RF Network
    setTimeout(() => {
      addBootLog('4s', '⚡ Yerel RF Sensörleri Canlı Yayında (0ms)', 'ok');
    }, 4000);

    // 6-19s: 24h Historical Archive Progressive Hydration
    if (!isTvMode) {
      setTimeout(() => {
        if (mbhProgressContainer) mbhProgressContainer.classList.remove('hidden');
        addBootLog('6s', '📂 24 Saatlik Kalıcı İnceleme Arşivi Yükleniyor...', 'sync');
        hydrate24HTrails().then(() => {
          addBootLog('19s', '✅ 500.000+ Fulgurit İzi Tamamlandı', 'ok');
          setTimeout(() => {
            if (mbhProgressContainer) mbhProgressContainer.classList.add('hidden');
          }, 2500);
        });
      }, 6000);
    }

    // 6.5s: Autonomous Cinematic Camera Directing Kicks In
    setTimeout(() => {
      introPanActive = false;
      cameraDirector.setManualMode(false);
      cameraDirector.setFilterMatrix({ cameraMode: 'AUTO', autoFollow: true });
      addBootLog('6.5s', '🎥 Otonom Sinematik Reji Aktif', 'ok');
    }, 6500);

    // 8.5s: Storm Cells Clustered & Petekler Activated
    setTimeout(() => {
      addBootLog('7-12s', '⬡ Fırtına Hücreleri ve Petekler Kümelendi', 'ok');
    }, 8500);

    // 24s: Satellite Sync Complete Milestone & Auto-Collapse
    setTimeout(() => {
      addBootLog('24s', '🛰️ Uydu Akışları Senkronize (GOES & MTG)', 'ok');
      setTimeout(() => {
        missionBootHud?.classList.add('minimized');
        if (btnMbhToggle) btnMbhToggle.textContent = '▴';
      }, 3500);
    }, 24000);
  });

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
    onPetekBodyOpacityChange: (opacity) => {
      globeManager.stormCellRadar.setGlobalBodyOpacity(opacity);
    },
    onPetekTierOpacityChange: (tier, opacity) => {
      globeManager.stormCellRadar.setTierOpacity(tier, opacity);
    },
    onPetekBorderOpacityChange: (opacity) => {
      globeManager.stormCellRadar.setGlobalBorderOpacity(opacity);
    },
    onPetekTierBorderOpacityChange: (tier, opacity) => {
      globeManager.stormCellRadar.setTierBorderOpacity(tier, opacity);
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

      // Help & System Commands
      if (cmd === '!help' || cmd === '!commands' || cmd === '!yardim' || cmd === '!info' || cmd === '!komut' || cmd === '!komutlar') {
        streamController.showToast(payload.user, '🎮 Type ![country] (e.g. !japan, !turkey, !usa, !brazil) or !storm to direct camera!');
        return;
      } else if (cmd === '!countries' || cmd === '!ulkeler') {
        streamController.showToast(payload.user, '🌍 Popular: !japan, !turkey, !usa, !brazil, !germany, !france, !uk, !italy, !spain');
        return;
      }

      // Audience Interactive Country Targeting (Full AI Automation)
      let requestedCountry: string | null = null;
      if (cmd === '!turkiye' || cmd === '!turk' || cmd === '!tr' || cmd === '!türkiye' || cmd === '!turkey') {
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
      } else if (cmd.startsWith('!') && !['!firtina', '!storm', '!dunya', '!world', '!oto', '!auto', '!zoom', '!uzaklas', '!out', '!help', '!commands', '!info', '!yardim', '!countries', '!ulkeler'].includes(cmd)) {
        requestedCountry = payload.command.substring(1).trim();
      }

      if (requestedCountry) {
        const res = eventDirector.addViewerRequest({
          username: payload.user,
          countryName: requestedCountry,
          platform: 'kick'
        });
        if (res.success) {
          const statusNote = res.isCalmSky ? '🛰️ Calm Skies' : '⚡ Active Storm';
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
          streamController.showToast(payload.user, `⚡ Tracking top storm (${geo.flag} ${geo.country})!`);
        } else {
          streamController.showToast(payload.user, "⚡ Scanning for active storm centers...");
        }
      } else if (cmd === '!dunya' || cmd === '!world') {
        cameraDirector.setFilterMatrix({ cameraMode: 'MANUAL', autoFollow: false });
        cameraDirector.flyToLocation(currentCoords.lat, currentCoords.lng, 380);
        streamController.showToast(payload.user, "🌍 Planetary Overview Mode activated.");
      } else if (cmd === '!oto' || cmd === '!auto') {
        cameraDirector.setFilterMatrix({ cameraMode: 'AUTO', autoFollow: true });
        streamController.showToast(payload.user, "🎥 Autonomous Cinematic Camera active.");
      } else if (cmd === '!zoom') {
        cameraDirector.flyToLocation(currentCoords.lat, currentCoords.lng, Math.max(150, currentDist * 0.7));
        streamController.showToast(payload.user, "🔍 Zoomed In.");
      } else if (cmd === '!uzaklas' || cmd === '!out') {
        cameraDirector.flyToLocation(currentCoords.lat, currentCoords.lng, Math.min(380, currentDist * 1.4));
        streamController.showToast(payload.user, "🔭 Zoomed Out.");
      }
    }
  });

  // 17. Automatic Audio Activation (Procedural Thunder SFX & Ambient Music)
  const activateAudio = () => {
    soundDirector.setMuted(false);
    uiController.setAudioMuted(false);
    bgMusicPlayer.play();
  };

  // Immediate start (OBS Browser Source / Unrestricted environments)
  activateAudio();

  // One-time user gesture unlock for standard browsers requiring initial interaction
  const onUserGesture = () => {
    activateAudio();
    window.removeEventListener('pointerdown', onUserGesture);
    window.removeEventListener('keydown', onUserGesture);
    window.removeEventListener('touchstart', onUserGesture);
  };
  window.addEventListener('pointerdown', onUserGesture, { passive: true });
  window.addEventListener('keydown', onUserGesture, { passive: true });
  window.addEventListener('touchstart', onUserGesture, { passive: true });

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
  // Sync Camera Mode to UI if changed externally (e.g. user touched globe)
  cameraDirector.onStateChange((_state, _target) => {
    uiController.syncExternalCameraMode(cameraDirector.isAutoFollow());
  });

  // =========================================================================
  // Central Admin Controller (Panel Toggles, Accordions & Master Audio Sync)
  // =========================================================================
  const adminModal = document.getElementById('admin-modal');
  const btnCloseAdminModal = document.getElementById('btn-close-admin-modal');
  const btnAdminSaveAll = document.getElementById('btn-admin-save-all');
  const adminSaveStatus = document.getElementById('admin-save-status');

  const adminLoginView = document.getElementById('admin-login-view');
  const adminDashboardView = document.getElementById('admin-dashboard-view');
  const adminInputUser = document.getElementById('admin-input-user') as HTMLInputElement | null;
  const adminInputPass = document.getElementById('admin-input-pass') as HTMLInputElement | null;
  const adminLoginError = document.getElementById('admin-login-error');
  const btnAdminLogin = document.getElementById('btn-admin-login');
  const btnAdminLogout = document.getElementById('btn-admin-logout');



  const sliderSfxVol = document.getElementById('admin-slider-sfx-vol') as HTMLInputElement | null;
  const valSfxVol = document.getElementById('admin-val-sfx-vol');
  const sliderMusicVol = document.getElementById('admin-slider-music-vol') as HTMLInputElement | null;
  const valMusicVol = document.getElementById('admin-val-music-vol');

  // Sliders visual feedback
  sliderSfxVol?.addEventListener('input', () => {
    if (valSfxVol) valSfxVol.textContent = `${sliderSfxVol.value}%`;
    const vol = parseFloat(sliderSfxVol.value) / 100;
    soundDirector.setVolume(vol);
  });
  sliderMusicVol?.addEventListener('input', () => {
    if (valMusicVol) valMusicVol.textContent = `${sliderMusicVol.value}%`;
    const vol = parseFloat(sliderMusicVol.value) / 100;
    bgMusicPlayer.setVolume(vol);
  });

  // Satellite Telemetry & Threshold Controls (3 Stacked Satellites)
  const sliderSatGoes19 = document.getElementById('admin-sat-thresh-goes19') as HTMLInputElement | null;
  const valSatGoes19 = document.getElementById('sat-val-goes19');
  const lineSatGoes19 = document.getElementById('sat-line-goes19');
  const rawSatGoes19 = document.getElementById('sat-raw-goes19');
  const filtSatGoes19 = document.getElementById('sat-filtered-goes19');
  const passSatGoes19 = document.getElementById('sat-passed-goes19');
  const progSatGoes19 = document.getElementById('sat-prog-goes19');
  const barsSatGoes19 = document.getElementById('sat-bars-goes19');

  const sliderSatGoes18 = document.getElementById('admin-sat-thresh-goes18') as HTMLInputElement | null;
  const valSatGoes18 = document.getElementById('sat-val-goes18');
  const lineSatGoes18 = document.getElementById('sat-line-goes18');
  const rawSatGoes18 = document.getElementById('sat-raw-goes18');
  const filtSatGoes18 = document.getElementById('sat-filtered-goes18');
  const passSatGoes18 = document.getElementById('sat-passed-goes18');
  const progSatGoes18 = document.getElementById('sat-prog-goes18');
  const barsSatGoes18 = document.getElementById('sat-bars-goes18');

  const sliderSatMtg = document.getElementById('admin-sat-thresh-mtg') as HTMLInputElement | null;
  const valSatMtg = document.getElementById('sat-val-mtg');
  const lineSatMtg = document.getElementById('sat-line-mtg');
  const rawSatMtg = document.getElementById('sat-raw-mtg');
  const filtSatMtg = document.getElementById('sat-filtered-mtg');
  const passSatMtg = document.getElementById('sat-passed-mtg');
  const progSatMtg = document.getElementById('sat-prog-mtg');
  const barsSatMtg = document.getElementById('sat-bars-mtg');

  interface SatUiConfig {
    slider: HTMLInputElement | null;
    valEl: HTMLElement | null;
    lineEl: HTMLElement | null;
    rawEl: HTMLElement | null;
    filtEl: HTMLElement | null;
    passEl: HTMLElement | null;
    progEl: HTMLElement | null;
    barsEl: HTMLElement | null;
    period: number;
    minRate: number;
    maxRate: number;
    defaultRate: number;
    rawBase: number;
  }

  const satConfigs: Record<string, SatUiConfig> = {
    goes19: {
      slider: sliderSatGoes19,
      valEl: valSatGoes19,
      lineEl: lineSatGoes19,
      rawEl: rawSatGoes19,
      filtEl: filtSatGoes19,
      passEl: passSatGoes19,
      progEl: progSatGoes19,
      barsEl: barsSatGoes19,
      period: 20,
      minRate: 1,
      maxRate: 25,
      defaultRate: 8,
      rawBase: 240
    },
    goes18: {
      slider: sliderSatGoes18,
      valEl: valSatGoes18,
      lineEl: lineSatGoes18,
      rawEl: rawSatGoes18,
      filtEl: filtSatGoes18,
      passEl: passSatGoes18,
      progEl: progSatGoes18,
      barsEl: barsSatGoes18,
      period: 20,
      minRate: 0.5,
      maxRate: 15,
      defaultRate: 2,
      rawBase: 40
    },
    mtg: {
      slider: sliderSatMtg,
      valEl: valSatMtg,
      lineEl: lineSatMtg,
      rawEl: rawSatMtg,
      filtEl: filtSatMtg,
      passEl: passSatMtg,
      progEl: progSatMtg,
      barsEl: barsSatMtg,
      period: 600,
      minRate: 1,
      maxRate: 60,
      defaultRate: 20,
      rawBase: 25000
    }
  };

  const satBarElements: Record<string, HTMLElement[]> = { goes19: [], goes18: [], mtg: [] };

  const userInteractingKeys: Record<string, number> = {};

  Object.entries(satConfigs).forEach(([key, cfg]) => {
    if (!cfg.barsEl) return;
    cfg.barsEl.innerHTML = '';
    const numBars = 24;
    for (let i = 0; i < numBars; i++) {
      const b = document.createElement('div');
      b.className = 'admin-sat-bar';
      const h = Math.round(18 + (i / (numBars - 1)) * 82);
      b.style.height = `${h}%`;
      b.dataset.index = i.toString();

      // Click directly on any bar to set threshold/rate
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!cfg.slider) return;
        const targetK = i + 1;
        const ratio = targetK / 24;
        const newRate = cfg.minRate + ratio * (cfg.maxRate - cfg.minRate);
        cfg.slider.value = (cfg.minRate < 1 ? Math.round(newRate * 2) / 2 : Math.round(newRate)).toString();
        userInteractingKeys[key] = Date.now();
        updateSatVisuals(key);
        saveSatelliteRatesDebounced();
      });

      cfg.barsEl.appendChild(b);
      satBarElements[key].push(b);
    }
  });

  const lastRawCounts: Record<string, number> = {
    goes19: 220,
    goes18: 35,
    mtg: 24500
  };

  let satThresholdDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  const saveSatelliteRatesDebounced = () => {
    if (satThresholdDebounceTimer) clearTimeout(satThresholdDebounceTimer);
    satThresholdDebounceTimer = setTimeout(async () => {
      try {
        const payload = {
          satelliteRates: {
            goes19: sliderSatGoes19 ? parseFloat(sliderSatGoes19.value) : 8,
            goes18: sliderSatGoes18 ? parseFloat(sliderSatGoes18.value) : 2,
            mtg: sliderSatMtg ? parseFloat(sliderSatMtg.value) : 20
          }
        };
        await fetch('/api/admin/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } catch {}
    }, 400);
  };

  const updateSatVisuals = (key: string) => {
    const cfg = satConfigs[key];
    if (!cfg || !cfg.slider) return;
    const rate = parseFloat(cfg.slider.value);
    const spm = Math.round(rate * 60);
    const targetCount = Math.round(rate * cfg.period);
    const periodLabel = cfg.period >= 60 ? `${Math.round(cfg.period / 60)}dk` : `${cfg.period}s`;

    if (cfg.valEl) {
      cfg.valEl.textContent = `⚡ ${rate} vuruş/sn (${spm} SPM | ${periodLabel}: ${targetCount} Şimşek)`;
    }

    const raw = lastRawCounts[key] || cfg.rawBase;
    const pass = Math.min(raw, targetCount);
    const filt = Math.max(0, raw - pass);
    const filtPct = raw > 0 ? Math.round((filt / raw) * 100) : 0;

    // Linear ratio of selected rate within [minRate, maxRate]
    const rateRatio = Math.max(0, Math.min(1, (rate - cfg.minRate) / (cfg.maxRate - cfg.minRate)));
    const activeBarsCount = Math.round(rateRatio * 24);

    // Position HIZ line EXACTLY matching the slider position (left to right)
    const linePct = (activeBarsCount / 24) * 100;
    if (cfg.lineEl) {
      cfg.lineEl.style.left = `${Math.min(Math.max(linePct, 0), 100)}%`;
    }

    // Color bars:
    // 0 to activeBarsCount - 1 are CYAN (passed / active speed level)
    // activeBarsCount to 23 are RED (filtered / beyond current speed cap)
    const bars = satBarElements[key] || [];
    bars.forEach((bar, idx) => {
      if (idx < activeBarsCount) {
        bar.className = 'admin-sat-bar bar-passed';
      } else {
        bar.className = 'admin-sat-bar bar-filtered';
      }
    });

    if (cfg.rawEl) cfg.rawEl.textContent = `${raw.toLocaleString()} flaş`;
    if (cfg.filtEl) cfg.filtEl.textContent = `${filt.toLocaleString()} (%${filtPct})`;
    if (cfg.passEl) cfg.passEl.textContent = `${pass.toLocaleString()} şimşek (${rate}/sn)`;
  };

  ['goes19', 'goes18', 'mtg'].forEach((key) => {
    const cfg = satConfigs[key];
    if (cfg.slider) {
      cfg.slider.addEventListener('input', () => {
        userInteractingKeys[key] = Date.now();
        updateSatVisuals(key);
        saveSatelliteRatesDebounced();
      });
    }

    // Direct Mouse & Touch dragging on the Spectrum Chart Container & EŞİK Line
    const chartContainer = cfg.barsEl?.parentElement as HTMLElement | null;
    if (chartContainer && cfg.slider) {
      let isDragging = false;

      const setRateFromPointer = (clientX: number) => {
        const rect = chartContainer.getBoundingClientRect();
        if (rect.width <= 0) return;
        const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const newRate = cfg.minRate + ratio * (cfg.maxRate - cfg.minRate);
        cfg.slider!.value = (cfg.minRate < 1 ? Math.round(newRate * 2) / 2 : Math.round(newRate)).toString();
        userInteractingKeys[key] = Date.now();
        updateSatVisuals(key);
      };

      chartContainer.addEventListener('mousedown', (e) => {
        isDragging = true;
        setRateFromPointer(e.clientX);

        const onMouseMove = (ev: MouseEvent) => {
          if (!isDragging) return;
          setRateFromPointer(ev.clientX);
        };
        const onMouseUp = () => {
          if (isDragging) {
            isDragging = false;
            saveSatelliteRatesDebounced();
          }
          window.removeEventListener('mousemove', onMouseMove);
          window.removeEventListener('mouseup', onMouseUp);
        };
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
      });

      chartContainer.addEventListener('touchstart', (e) => {
        if (!e.touches[0]) return;
        isDragging = true;
        setRateFromPointer(e.touches[0].clientX);
      }, { passive: true });

      chartContainer.addEventListener('touchmove', (e) => {
        if (!isDragging || !e.touches[0]) return;
        setRateFromPointer(e.touches[0].clientX);
      }, { passive: true });

      chartContainer.addEventListener('touchend', () => {
        if (isDragging) {
          isDragging = false;
          saveSatelliteRatesDebounced();
        }
      });
    }

    updateSatVisuals(key);
  });

  window.addEventListener('satellite_rates_updated', (e: any) => {
    const rates = e.detail;
    if (!rates) return;
    const now = Date.now();
    if (rates.goes19 && sliderSatGoes19 && (now - (userInteractingKeys.goes19 || 0) > 2000)) {
      sliderSatGoes19.value = rates.goes19.toString();
      updateSatVisuals('goes19');
    }
    if (rates.goes18 && sliderSatGoes18 && (now - (userInteractingKeys.goes18 || 0) > 2000)) {
      sliderSatGoes18.value = rates.goes18.toString();
      updateSatVisuals('goes18');
    }
    if (rates.mtg && sliderSatMtg && (now - (userInteractingKeys.mtg || 0) > 2000)) {
      sliderSatMtg.value = rates.mtg.toString();
      updateSatVisuals('mtg');
    }
  });

  window.addEventListener('satellite_thresholds_updated', (e: any) => {
    const thresholds = e.detail;
    if (!thresholds) return;
  });

  let satTelemetryTimer: ReturnType<typeof setInterval> | null = null;
  const fetchSatelliteTelemetry = async () => {
    try {
      const res = await fetch('/api/admin/satellite-telemetry');
      if (!res.ok) return;
      const telemetry = await res.json();
      if (!telemetry) return;

      ['goes19', 'goes18', 'mtg'].forEach((key) => {
        const item = telemetry[key];
        const cfg = satConfigs[key];
        if (!item || !cfg) return;

        if (item.rawCount > 0) {
          lastRawCounts[key] = item.rawCount;
        }

        updateSatVisuals(key);
      });
    } catch {}
  };

  let satClockTimer = 0;
  setInterval(() => {
    if (adminModal?.classList.contains('hidden')) return;
    satClockTimer += 0.2;
    ['goes19', 'goes18', 'mtg'].forEach((key) => {
      const cfg = satConfigs[key];
      if (!cfg.progEl) return;
      const current = satClockTimer % cfg.period;
      const pct = (current / cfg.period) * 100;
      cfg.progEl.style.width = `${pct}%`;
    });
  }, 200);

    // Tri-State (OPEN / CLOSED / PASSIVE) Helper functions for Panel & Accordion State Management
    const getTriStateValue = (key: string): 'OPEN' | 'CLOSED' | 'PASSIVE' => {
      const radios = document.getElementsByName(`admin-state-${key}`) as NodeListOf<HTMLInputElement>;
      for (let i = 0; i < radios.length; i++) {
        if (radios[i].checked) return radios[i].value as 'OPEN' | 'CLOSED' | 'PASSIVE';
      }
      return 'OPEN';
    };

    const setTriStateValue = (key: string, state: 'OPEN' | 'CLOSED' | 'PASSIVE') => {
      const radios = document.getElementsByName(`admin-state-${key}`) as NodeListOf<HTMLInputElement>;
      for (let i = 0; i < radios.length; i++) {
        radios[i].checked = (radios[i].value === state);
      }
    };

    const applyPanelState = (el: HTMLElement | null, state: 'OPEN' | 'CLOSED' | 'PASSIVE', isAccordion: boolean = false) => {
      if (!el) return;
      if (state === 'PASSIVE') {
        el.style.display = 'none';
      } else {
        el.style.display = '';
        if (isAccordion) {
          el.classList.toggle('collapsed', state === 'CLOSED');
        }
      }
    };

    const applyAdminConfig = (cfg: any) => {
      if (!cfg) return;
      if (cfg.sfxVolume !== undefined) {
        const vol = cfg.sfxVolume / 100;
        soundDirector.setVolume(vol);
        if (sliderSfxVol) sliderSfxVol.value = cfg.sfxVolume.toString();
        if (valSfxVol) valSfxVol.textContent = `${cfg.sfxVolume}%`;
      }
      if (cfg.musicVolume !== undefined) {
        const vol = cfg.musicVolume / 100;
        bgMusicPlayer.setVolume(vol);
        if (sliderMusicVol) sliderMusicVol.value = cfg.musicVolume.toString();
        if (valMusicVol) valMusicVol.textContent = `${cfg.musicVolume}%`;
      }
      if (cfg.satelliteRates) {
        if (cfg.satelliteRates.goes19 && sliderSatGoes19) {
          sliderSatGoes19.value = cfg.satelliteRates.goes19.toString();
          updateSatVisuals('goes19');
        }
        if (cfg.satelliteRates.goes18 && sliderSatGoes18) {
          sliderSatGoes18.value = cfg.satelliteRates.goes18.toString();
          updateSatVisuals('goes18');
        }
        if (cfg.satelliteRates.mtg && sliderSatMtg) {
          sliderSatMtg.value = cfg.satelliteRates.mtg.toString();
          updateSatVisuals('mtg');
        }
      }

      // Apply 3-State Panel States
      if (cfg.panelStates) {
        const panelKeys = ['hud', 'liveBadge', 'liveFeed', 'directorQueue', 'storms', 'leaderboard', 'analytics', 'bottomBar'];
        const panelElemMap: Record<string, { el: HTMLElement | null; isAccordion: boolean }> = {
          hud: { el: document.querySelector('.hud-panel'), isAccordion: false },
          liveBadge: { el: document.getElementById('live-broadcast-indicator'), isAccordion: false },
          liveFeed: { el: document.getElementById('panel-live-feed'), isAccordion: true },
          directorQueue: { el: document.getElementById('panel-camera-queue'), isAccordion: true },
          storms: { el: document.getElementById('panel-storms'), isAccordion: true },
          leaderboard: { el: document.getElementById('panel-leaderboard'), isAccordion: true },
          analytics: { el: document.getElementById('panel-analytics'), isAccordion: true },
          bottomBar: { el: document.getElementById('bottom-command-bar'), isAccordion: false }
        };

        panelKeys.forEach((key) => {
          const st = cfg.panelStates[key] || 'OPEN';
          setTriStateValue(key, st);
          const item = panelElemMap[key];
          if (item) {
            applyPanelState(item.el, st, item.isAccordion);
          }
        });
      } else if (cfg.panels) {
        // Backward compatibility fallback for legacy boolean configs
        const legacyMap: Record<string, 'OPEN' | 'CLOSED' | 'PASSIVE'> = {
          hud: cfg.panels.hud !== false ? 'OPEN' : 'PASSIVE',
          liveBadge: cfg.panels.liveBadge !== false ? 'OPEN' : 'PASSIVE',
          liveFeed: cfg.panels.liveFeed !== false ? (cfg.accordions?.liveFeed ? 'OPEN' : 'CLOSED') : 'PASSIVE',
          directorQueue: cfg.panels.directorQueue !== false ? (cfg.accordions?.directorQueue ? 'OPEN' : 'CLOSED') : 'PASSIVE',
          storms: cfg.panels.storms !== false ? (cfg.accordions?.storms ? 'OPEN' : 'CLOSED') : 'PASSIVE',
          leaderboard: cfg.panels.leaderboard !== false ? (cfg.accordions?.leaderboard ? 'OPEN' : 'CLOSED') : 'PASSIVE',
          analytics: cfg.panels.analytics !== false ? (cfg.accordions?.analytics ? 'OPEN' : 'CLOSED') : 'PASSIVE',
          bottomBar: cfg.panels.bottomBar !== false ? 'OPEN' : 'PASSIVE'
        };

        Object.entries(legacyMap).forEach(([key, st]) => {
          setTriStateValue(key, st);
        });
      }
    };

    // Fetch initial global admin config from server
    fetch('/api/admin/config')
      .then((r) => r.json())
      .then((cfg) => applyAdminConfig(cfg))
      .catch(() => {});

    // Save admin config to central backend (Secured with Bearer Token)
    btnAdminSaveAll?.addEventListener('click', async () => {
      const panelKeys = ['hud', 'liveBadge', 'liveFeed', 'directorQueue', 'storms', 'leaderboard', 'analytics', 'bottomBar'];
      const panelStates: Record<string, 'OPEN' | 'CLOSED' | 'PASSIVE'> = {};
      panelKeys.forEach((k) => {
        panelStates[k] = getTriStateValue(k);
      });

      const token = sessionStorage.getItem('ag_admin_token') || '';

      const payload = {
        sfxVolume: sliderSfxVol ? parseInt(sliderSfxVol.value, 10) : 80,
        musicVolume: sliderMusicVol ? parseInt(sliderMusicVol.value, 10) : 50,
        satelliteRates: {
          goes19: sliderSatGoes19 ? parseFloat(sliderSatGoes19.value) : 8,
          goes18: sliderSatGoes18 ? parseFloat(sliderSatGoes18.value) : 2,
          mtg: sliderSatMtg ? parseFloat(sliderSatMtg.value) : 20
        },
        panelStates,
        updatedAt: Date.now()
      };

      if (adminSaveStatus) adminSaveStatus.textContent = 'Kaydediliyor...';
      try {
        const res = await fetch('/api/admin/config', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify(payload)
        });
        if (res.ok) {
          if (adminSaveStatus) adminSaveStatus.textContent = '✅ Ayarlar kaydedildi ve tüm kullanıcılara canlı uygulandı!';
          applyAdminConfig(payload);
          setTimeout(() => {
            if (adminSaveStatus) adminSaveStatus.textContent = 'Tüm ziyaretçiler ve yeni bağlananlar için geçerli olur.';
          }, 3500);
        } else {
          const errData = await res.json().catch(() => ({}));
          if (adminSaveStatus) adminSaveStatus.textContent = `⚠️ Yetkisiz erişim: ${errData.error || 'Oturum süreniz dolmuş.'}`;
          if (res.status === 401) {
            sessionStorage.removeItem('ag_admin_token');
            showAdminLogin();
          }
        }
      } catch {
        if (adminSaveStatus) adminSaveStatus.textContent = '⚠️ Sunucu bağlantı hatası.';
      }
    });

  const isAdminAuthenticated = (): boolean => {
    try {
      return !!sessionStorage.getItem('ag_admin_token');
    } catch {
      return false;
    }
  };

  const showAdminDashboard = () => {
    adminLoginView?.classList.add('hidden');
    adminDashboardView?.classList.remove('hidden');
    btnAdminLogout?.classList.remove('hidden');
    adminLoginError?.classList.add('hidden');
    fetchSatelliteTelemetry();
    if (!satTelemetryTimer) satTelemetryTimer = setInterval(fetchSatelliteTelemetry, 3000);
  };

  const showAdminLogin = () => {
    adminDashboardView?.classList.add('hidden');
    adminLoginView?.classList.remove('hidden');
    btnAdminLogout?.classList.add('hidden');
    adminLoginError?.classList.add('hidden');
    if (adminInputUser) adminInputUser.value = '';
    if (adminInputPass) adminInputPass.value = '';
    if (satTelemetryTimer) {
      clearInterval(satTelemetryTimer);
      satTelemetryTimer = null;
    }
    setTimeout(() => adminInputUser?.focus(), 80);
  };

  const handleAdminLoginSubmit = async () => {
    const user = adminInputUser?.value.trim() || '';
    const pass = adminInputPass?.value || '';

    if (!user || !pass) return;

    if (btnAdminLogin) btnAdminLogin.textContent = 'DOĞRULANIYOR...';

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user, pass })
      });
      const data = await res.json();

      if (res.ok && data.token) {
        sessionStorage.setItem('ag_admin_token', data.token);
        showAdminDashboard();
      } else {
        if (adminLoginError) {
          adminLoginError.textContent = data.error || '⚠️ Hatalı kullanıcı adı veya güvenlik şifresi!';
          adminLoginError.classList.remove('hidden');
        }
      }
    } catch {
      if (adminLoginError) {
        adminLoginError.textContent = '⚠️ Güvenlik sunucusuna bağlanılamadı!';
        adminLoginError.classList.remove('hidden');
      }
    } finally {
      if (btnAdminLogin) btnAdminLogin.textContent = 'GİRİŞ YAP VE KİLİDİ AÇ';
    }
  };

  btnAdminLogin?.addEventListener('click', handleAdminLoginSubmit);
  adminInputUser?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') adminInputPass?.focus();
  });
  adminInputPass?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleAdminLoginSubmit();
  });

  btnAdminLogout?.addEventListener('click', () => {
    try {
      sessionStorage.removeItem('ag_admin_token');
    } catch {}
    showAdminLogin();
  });

  const openAdminModal = () => {
    adminModal?.classList.remove('hidden');
    if (isAdminAuthenticated()) {
      showAdminDashboard();
    } else {
      showAdminLogin();
    }
  };
  const closeAdminModal = () => {
    adminModal?.classList.add('hidden');
    if (satTelemetryTimer) {
      clearInterval(satTelemetryTimer);
      satTelemetryTimer = null;
    }
  };
  btnCloseAdminModal?.addEventListener('click', closeAdminModal);
  adminModal?.querySelector('.admin-modal-backdrop')?.addEventListener('click', closeAdminModal);

  // URL query trigger: ?admin=1 or ?admin=aethelon
  if (typeof window !== 'undefined' && window.location) {
    const params = new URLSearchParams(window.location.search);
    if (params.has('admin')) {
      openAdminModal();
    }
  }

  // Keyboard shortcut trigger: Ctrl + Shift + A
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
      e.preventDefault();
      if (adminModal?.classList.contains('hidden')) {
        openAdminModal();
      } else {
        closeAdminModal();
      }
    }
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

  // Arrival-synced flash playback hook: 1.2s before touchdown
  cameraDirector.onArrivalFlash = (cluster) => {
    // Master Rule (AGENTS.md): Strictly 0% fake/simulated data.
    // Never fabricate synthetic strikes for calm regions or viewer requests.
    if (!cluster.events || cluster.events.length === 0 || cluster.eventCount === 0 || cluster.id.startsWith('viewer-')) {
      return;
    }

    const lastEvent = cluster.events[cluster.events.length - 1];
    if (!lastEvent || (Date.now() - lastEvent.timestamp > 15000)) {
      return; // No fresh real telemetry in this cluster
    }

    // Highlight radar impact strictly with genuine real telemetry
    globeManager.stormCellRadar.triggerStrikeImpact(cluster.id, lastEvent.latitude, lastEvent.longitude, lastEvent.peakCurrent ?? 25);
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

  // Tab Inactivity / Sleep Guard (Prevents strike pile-up when user is in another window/tab)
  let isTabHidden = false;
  let tabHiddenTime = 0;

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      isTabHidden = true;
      tabHiddenTime = Date.now();
    } else {
      isTabHidden = false;
      const hiddenDuration = Date.now() - tabHiddenTime;
      // If tab was away for more than 2.5s, clear presentation queue to prevent a burst flood on return
      if (hiddenDuration > 2500) {
        presentationQueue.clear();
      }
    }
  });

  const enqueueStrike = (event: LightningEvent, isFromFallback: boolean = false) => {
    if (currentSourceMode === 'LIVE') {
      // Strict Single Ingest Guard: If unifiedStreamProvider is LIVE, ignore events from fallback harmonizer
      if (isFromFallback && unifiedStreamProvider.status === 'LIVE') {
        return;
      }
      // Tab Sleep Guard: If tab is currently hidden/sleeping, do not accumulate visual presentation queue
      if (isTabHidden) {
        return;
      }

      if (event.source === 'blitzortung' || !isFromFallback) {
        // Single Unified Pacing Architecture:
        // Server (UnifiedLightningHub) already paces satellite flashes smoothly across the 20s / 30s cadence.
        // Render immediately on the next animation frame with zero delay heap!
        presentationQueue.enqueueInstantRf(event);
      } else {
        // Fallback browser poller only:
        const periodMs = event.source === 'mtg_li' ? 30000 : 20000;
        const jitterTime = Date.now() + Math.random() * periodMs;
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

    // Gentle intro panoramic orbit during the first 6.5s before autonomous director kicks in
    if (introPanActive) {
      const elapsedBootSec = (Date.now() - bootTimeStart) / 1000;
      if (elapsedBootSec < 6.5) {
        const angle = elapsedBootSec * 0.05;
        const dist = 380;
        engine.camera.position.set(Math.sin(angle) * dist, 30, Math.cos(angle) * dist);
        engine.camera.lookAt(0, 0, 0);
      } else {
        introPanActive = false;
      }
    }

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
