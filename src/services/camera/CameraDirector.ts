import * as THREE from 'three';
import type {
  CameraState,
  CameraTarget,
  CameraDirectorConfig,
  CameraFramingMode,
  ShotScale,
  CameraFilterMatrix,
  FlightPhase,
  FlightApproachIntent
} from '../../types/camera';
import { SHOT_SCALE_DISTANCES } from '../../types/camera';
import type { ScoredCluster } from '../../types/scoring';
import type { ControlsManager } from '../../core/ControlsManager';
import {
  latLngToVector3,
  vector3ToLatLng,
  haversineDistanceKm
} from '../../utils/coordinates';
import { GeoIndex } from '../../utils/geoRegions';
import { GeoEnricher } from '../geo/GeoEnricher';
import { StochasticPacingQueue } from '../providers/StochasticPacingQueue';

/**
 * CameraDirector: Cinematic Autonomous & Manual Director for Lightning Globe.
 */
export class CameraDirector {
  public readonly camera: THREE.PerspectiveCamera;
  public readonly controlsManager: ControlsManager;
  public readonly config: CameraDirectorConfig;

  // Drone angles & telemetry
  public currentCameraAngleDeg: number = 0;
  public targetCameraAngleDeg: number = 0;
  private userCooldownRemainingSec: number = 0;

  // Filter Matrix State
  private filterMatrix: CameraFilterMatrix = {
    autoFollow: true,
    cameraMode: 'AUTO',
    shotScale: 'AUTO_DIVERSITY',
    pitchDeg: 15,
    manualDistance: 220,
    continents: [],
    regions: [],
    countries: [],
    peteks: []
  };

  // Flight State Machine
  private flightPhase: FlightPhase = 'IDLE';
  private cameraState: CameraState = 'IDLE';
  private currentTarget: CameraTarget | null = null;
  private candidateTarget: ScoredCluster | null = null;
  private targetProvider: (() => ScoredCluster | null) | null = null;

  // Timers & durations
  private phaseElapsedSec: number = 0;
  private approachDurationSec: number = 6.0;
  private holdDurationSec: number = 10.4;
  private returnDurationSec: number = 3.0;

  // Intro Drone Choreography
  private isIntroActive: boolean = false;
  private introElapsedSec: number = 0;
  private readonly introDurationSec: number = 10.0;
  private readonly introStartDist: number = 340;
  private readonly introEndDist: number = 260;
  private customApproachDurationProvided: boolean = false;

  private lastEventObservedEpoch: number = Date.now();
  private holdUntilEpoch: number = 0;
  private isTransitioning: boolean = false;
  private handshakeTriggered: boolean = false;
  private warmupTriggered: boolean = false;

  // Coordinates cache
  private currentLat: number = 20;
  private currentLon: number = 0;

  // Active Flight Data
  private activeTargetCluster: ScoredCluster | null = null;
  private activeFlightIntent: FlightApproachIntent | null = null;

  // Smart Tour State
  private tourStepIndex: number = 0;

  // Pre-allocated scratch objects (Zero heap allocation in update loop)
  private readonly scratchCurrentPos = new THREE.Vector3();
  private readonly scratchNormal = new THREE.Vector3();
  private readonly scratchTangent = new THREE.Vector3();
  private readonly scratchRefUp = new THREE.Vector3();

  // Callbacks
  private readonly stateCallbacks: Set<(state: CameraState, target: CameraTarget | null) => void> = new Set();
  private readonly phaseCallbacks: Set<(phase: FlightPhase) => void> = new Set();
  private readonly presentationCompleteCallbacks: Set<(clusterId: string) => void> = new Set();
  private removeInteractionListener: (() => void) | null = null;

  // Pre-ionization ground radar warmup hook (halfway through approach)
  public onApproachWarmup?: (clusterId: string, lat: number, lon: number) => void;
  // Arrival-synced flash playback hook (1.2s before touchdown)
  public onArrivalFlash?: (cluster: ScoredCluster) => void;
  private arrivalFlashTriggered: boolean = false;
  private isCurrentTargetOcean: boolean = false;

  constructor(
    camera: THREE.PerspectiveCamera,
    controlsManager: ControlsManager,
    _config?: Partial<CameraDirectorConfig>
  ) {
    this.camera = camera;
    this.controlsManager = controlsManager;

    this.customApproachDurationProvided = _config?.approachDurationMs !== undefined;

    this.config = {
      approachDurationMs: _config?.approachDurationMs ?? 6000,
      holdDurationMs: _config?.holdDurationMs ?? 10400,
      returnDurationMs: _config?.returnDurationMs ?? 3000,
      userInterruptionCooldownMs: _config?.userInterruptionCooldownMs ?? 4000,
      idleDistance: _config?.idleDistance ?? 260,
      idleDwellMs: _config?.idleDwellMs ?? 6000,
      minFocusDistance: _config?.minFocusDistance ?? 145,
      enableIntroOrbit: _config?.enableIntroOrbit ?? false,
      framingDistances: _config?.framingDistances ?? {
        MACRO: 145,
        LOCAL: 180,
        REGIONAL: 240,
        CONTINENTAL: 320,
        GLOBAL: 380
      },
      ..._config
    };

    this.approachDurationSec = this.config.approachDurationMs / 1000;
    this.holdDurationSec = this.config.holdDurationMs / 1000;
    this.returnDurationSec = this.config.returnDurationMs / 1000;

    // Initialize 10s intro drone orbit sequence if enabled
    if (this.config.enableIntroOrbit) {
      this.isIntroActive = true;
      this.flightPhase = 'INTRO_ORBIT';
      this.cameraState = 'IDLE';
      if (this.camera.position.lengthSq() < 1e-4) {
        this.camera.position.set(0, 20, this.introStartDist).setLength(this.introStartDist);
      } else {
        this.camera.position.setLength(this.introStartDist);
      }
    }

    // Listen for manual user interactions for instant 0ms release
    if (this.controlsManager && typeof (this.controlsManager as any).onInteraction === 'function') {
      this.removeInteractionListener = (this.controlsManager as any).onInteraction(() => {
        this.onUserInteraction();
      });
    }

    // Cache initial coordinate
    this.scratchCurrentPos.copy(this.camera.position);
    const initialCoords = vector3ToLatLng(this.scratchCurrentPos);
    this.currentLat = initialCoords.lat;
    this.currentLon = initialCoords.lng;
  }

  // =========================================================================
  // Public Filter Matrix & Mode Configuration
  // =========================================================================

  public setFilterMatrix(partial: Partial<CameraFilterMatrix>): boolean {
    const prevPitch = this.filterMatrix.pitchDeg;
    const prevDist = this.filterMatrix.manualDistance;
    const prevScale = this.filterMatrix.shotScale;
    const prevAuto = this.filterMatrix.autoFollow;

    this.filterMatrix = { ...this.filterMatrix, ...partial };

    if (partial.pitchDeg !== undefined) {
      this.targetCameraAngleDeg = Math.max(0, Math.min(75, Math.round(partial.pitchDeg)));
    }

    if (partial.cameraMode !== undefined) {
      if (partial.cameraMode === 'MANUAL') {
        this.filterMatrix.autoFollow = false;
        this.setManualMode(true);
      } else if (partial.cameraMode === 'AUTO' || partial.cameraMode === 'TOUR') {
        this.filterMatrix.autoFollow = true;
        this.lastEventObservedEpoch = Date.now();
        if (this.candidateTarget && this.cameraState === 'IDLE') {
          this.initiateApproach(this.candidateTarget);
        }
      } else if (partial.cameraMode === 'ORBIT') {
        this.filterMatrix.autoFollow = false;
        this.flightPhase = 'IDLE_DRIFT';
      }
    }

    if (partial.cameraMode !== undefined) {
      this.filterMatrix.cameraMode = partial.cameraMode;
      const isManual = partial.cameraMode === 'MANUAL';
      if ((this.controlsManager as any)?.cameraController) {
        (this.controlsManager as any).cameraController.isManualMode = isManual;
      }
      if (partial.cameraMode === 'ORBIT') {
        (this.controlsManager as any)?.cameraController?.beginIdle?.();
      } else {
        (this.controlsManager as any)?.cameraController?.exitIdle?.();
      }
    }

    if (partial.autoFollow !== undefined) {
      this.filterMatrix.cameraMode = partial.autoFollow ? 'AUTO' : 'MANUAL';
      if (!partial.autoFollow) {
        this.setManualMode(true);
        if ((this.controlsManager as any)?.cameraController) {
          (this.controlsManager as any).cameraController.isManualMode = true;
        }
      } else {
        this.setManualMode(false);
        if ((this.controlsManager as any)?.cameraController) {
          (this.controlsManager as any).cameraController.isManualMode = false;
        }
        this.lastEventObservedEpoch = Date.now();
        if (this.candidateTarget && this.cameraState === 'IDLE') {
          this.initiateApproach(this.candidateTarget);
        }
      }
    }

    // 1. If pitch, distance, or scale changed, visibly update camera orientation/altitude immediately!
    const poseChanged = (partial.pitchDeg !== undefined && partial.pitchDeg !== prevPitch) ||
                        (partial.manualDistance !== undefined && partial.manualDistance !== prevDist) ||
                        (partial.shotScale !== undefined && partial.shotScale !== prevScale);
    if (poseChanged) {
      const isInstant = !!(partial as any).instant;
      if (partial.pitchDeg !== undefined) {
        this.setDroneAngle(partial.pitchDeg, !isInstant);
      }
      if (!this.isTransitioning) {
        if (this.filterMatrix.autoFollow && this.activeTargetCluster) {
          this.applyCurrentPose(!isInstant);
        } else {
          if (partial.manualDistance !== undefined) {
            this.setManualDistance(partial.manualDistance);
            if (typeof (this.controlsManager as any)?.setDistance === 'function') {
              (this.controlsManager as any).setDistance(partial.manualDistance, !isInstant);
            }
          }
          if (partial.shotScale !== undefined) {
            const targetDist = this.getTargetDistance();
            if (typeof (this.controlsManager as any)?.setDistance === 'function') {
              (this.controlsManager as any).setDistance(targetDist, true);
            }
          }
        }
      }
    }

    // 2. If autoFollow became active, acquire candidate target
    if (this.filterMatrix.autoFollow && (!prevAuto || partial.continents || partial.regions || partial.countries || partial.peteks || partial.cameraMode === 'AUTO')) {
      this.userCooldownRemainingSec = 0;
      if (!this.isTransitioning && this.cameraState === 'IDLE') {
        this.tryAcquireTarget();
      }
    } else if (!this.filterMatrix.autoFollow && !this.isTransitioning) {
      // In MANUAL mode, if single country/region/continent is selected, fly there to present it
      if (partial.countries && partial.countries.length === 1) {
        const meta = GeoIndex.getCountry(partial.countries[0]);
        if (meta && (meta.lat !== 0 || meta.lon !== 0)) {
          this.flyToLocation(meta.lat, meta.lon, this.getTargetDistance());
        }
      } else if (partial.regions && partial.regions.length === 1) {
        const reg = GeoIndex.getRegion(partial.regions[0]);
        if (reg) {
          this.flyToLocation(reg.centerLat, reg.centerLon, this.getTargetDistance());
        }
      } else if (partial.continents && partial.continents.length === 1) {
        const cont = GeoIndex.getContinent(partial.continents[0]);
        if (cont) {
          this.flyToLocation(cont.centerLat, cont.centerLon, 290);
        }
      }
    }

    return true;
  }

  /**
   * Accelerates camera cadence by shortening current HOLD dwell time by reductionRatio (default 50%).
   * Triggered when a viewer requests a target to prevent long chat wait times.
   */
  public accelerateCadence(reductionRatio: number = 0.5): void {
    if (this.cameraState === 'HOLD') {
      const remaining = Math.max(0, this.holdDurationSec - this.phaseElapsedSec);
      this.phaseElapsedSec = Math.max(0, this.holdDurationSec - (remaining * reductionRatio));
    }
  }

  /**
   * Returns remaining dwell time in seconds for the active flight presentation.
   */
  public getRemainingDwellTime(): number {
    if (this.cameraState === 'APPROACH' || (this.flightPhase as string).startsWith('APPROACH_')) {
      return Math.max(0, this.approachDurationSec - this.phaseElapsedSec) + this.holdDurationSec;
    }
    if (this.cameraState === 'HOLD' || this.flightPhase === 'HOLD') {
      return Math.max(0, this.holdDurationSec - this.phaseElapsedSec);
    }
    return 0;
  }

  public getFilterMatrix(): CameraFilterMatrix {
    return { ...this.filterMatrix };
  }

  public setAutoFollow(auto: boolean): void {
    this.setFilterMatrix({ autoFollow: auto });
  }

  public isAutoFollow(): boolean {
    return this.filterMatrix.autoFollow;
  }

  public setManualMode(manual: boolean): void {
    this.filterMatrix.autoFollow = !manual;
    this.filterMatrix.cameraMode = manual ? 'MANUAL' : 'AUTO';
    if (manual) {
      this.cameraState = 'IDLE';
      this.flightPhase = 'IDLE';
      this.phaseElapsedSec = 0;
      this.currentTarget = null;
      this.activeTargetCluster = null;
      this.isTransitioning = false;
      if (this.controlsManager?.setEnabled) {
        this.controlsManager.setEnabled(true);
      }
    } else {
      this.lastEventObservedEpoch = Date.now();
      this.userCooldownRemainingSec = 0;
      if (!this.isTransitioning && this.cameraState === 'IDLE') {
        this.tryAcquireTarget();
      }
    }
    for (const cb of this.stateCallbacks) {
      cb(this.cameraState, this.currentTarget);
    }
  }

  public isManualMode(): boolean {
    return !this.filterMatrix.autoFollow;
  }

  public setShotScale(scale: ShotScale): void {
    this.setFilterMatrix({ shotScale: scale, manualDistance: SHOT_SCALE_DISTANCES[scale] });
  }

  public getShotScale(): ShotScale {
    return this.filterMatrix.shotScale;
  }

  public setPitchDeg(deg: number): void {
    const clamped = Math.max(0, Math.min(75, Math.round(deg)));
    this.targetCameraAngleDeg = clamped;
    this.filterMatrix.pitchDeg = clamped;
  }

  public getPitchDeg(): number {
    return this.filterMatrix.pitchDeg;
  }

  public getLastEventObservedEpoch(): number {
    return this.lastEventObservedEpoch;
  }

  public getHoldUntilEpoch(): number {
    return this.holdUntilEpoch;
  }

  public setManualDistance(dist: number): void {
    const clamped = Math.max(140, Math.min(450, Math.round(dist)));
    this.filterMatrix.manualDistance = clamped;
  }

  public getManualDistance(): number {
    return this.filterMatrix.manualDistance;
  }

  public getTargetDistance(): number {
    return this.filterMatrix.manualDistance || SHOT_SCALE_DISTANCES[this.filterMatrix.shotScale] || 220;
  }

  public calculateFramingDistance(target: CameraTarget | ScoredCluster): number {
    const cls = 'presentationClass' in target ? target.presentationClass : 'LOCAL';
    switch (cls) {
      case 'MACRO': return 145;
      case 'LOCAL': return 165;
      case 'REGIONAL': return 195;
      case 'CONTINENTAL': return 240;
      default: return this.getTargetDistance();
    }
  }

  public getUserCooldown(): number {
    return this.userCooldownRemainingSec;
  }

  public setDroneAngle(deg: number, animate: boolean = true): void {
    const clamped = Math.max(0, Math.min(75, Math.round(deg)));
    this.targetCameraAngleDeg = clamped;
    this.filterMatrix.pitchDeg = clamped;
    if (this.controlsManager && typeof (this.controlsManager as any).setPitchAngle === 'function') {
      (this.controlsManager as any).setPitchAngle(clamped, animate);
    }
  }

  public getDroneAngle(): number {
    return this.targetCameraAngleDeg;
  }

  public setDroneDistance(dist: number): void {
    this.setManualDistance(dist);
  }

  public getDroneDistance(): number {
    return this.getManualDistance();
  }

  public forceInterrupt(newTarget: ScoredCluster): void {
    this.initiateApproach(newTarget);
  }

  public flyToCluster(cluster: ScoredCluster): void {
    this.initiateApproach(cluster);
  }

  public isOceanLocation(lat: number, lon: number): boolean {
    try {
      const enricher = GeoEnricher.getInstance();
      if (enricher.isReady()) {
        const geo = enricher.lookup(lat, lon);
        return geo.iso === 'XW' || geo.country === 'International Waters';
      }
      // Fast fallback bounding checks for deep open ocean if geo dataset is not loaded yet
      if (lat >= -50 && lat <= 50 && lon >= -170 && lon <= -110) return true;
      if (lat >= -40 && lat <= 40 && lon >= -45 && lon <= -25) return true;
      if (lat >= -45 && lat <= -10 && lon >= 60 && lon <= 95) return true;
      return false;
    } catch {
      return false;
    }
  }

  public getIsCurrentTargetOcean(): boolean {
    return this.isCurrentTargetOcean;
  }

  public getArrivalFlashTriggered(): boolean {
    return this.arrivalFlashTriggered;
  }

  // =========================================================================
  // Target & Event Director Binding
  // =========================================================================

  public setCandidateTarget(cluster: ScoredCluster | null): void {
    this.candidateTarget = cluster;
    if (!cluster) return;
    if (this.isIntroActive) return; // Queued; will engage when 10s intro drone completes
    if (!this.filterMatrix.autoFollow) return;
    if (this.userCooldownRemainingSec > 0) return;
    if (this.cameraState === 'APPROACH' || this.cameraState === 'HOLD') return;

    if (this.isClusterEligible(cluster)) {
      this.initiateApproach(cluster);
    }
  }

  public setTargetProvider(provider: (() => ScoredCluster | null) | null): void {
    this.targetProvider = provider;
  }

  public isClusterEligible(cluster: ScoredCluster): boolean {
    const lat = cluster.centroid.latitude;
    const lon = cluster.centroid.longitude;

    // 1. Geographic Filter (OR logic across continents, regions, countries)
    const geoMatches = GeoIndex.matchesFilter(
      lat,
      lon,
      this.filterMatrix.continents,
      this.filterMatrix.regions,
      this.filterMatrix.countries
    );
    if (!geoMatches) return false;

    // 2. Petek / Meteorological Class Filter (AND logic)
    if (this.filterMatrix.peteks && this.filterMatrix.peteks.length > 0) {
      const stormClass = cluster.stormClass || 'ISOLATED';
      if (!this.filterMatrix.peteks.includes(stormClass)) {
        return false;
      }
    }

    return true;
  }

  private tryAcquireTarget(): void {
    if (this.targetProvider) {
      const candidate = this.targetProvider();
      if (candidate && this.isClusterEligible(candidate)) {
        this.initiateApproach(candidate);
      }
    }
  }

  // =========================================================================
  // Approach Initiation & Execution
  // =========================================================================

  private initiateApproach(cluster: ScoredCluster): void {
    this.activeTargetCluster = cluster;
    this.candidateTarget = cluster;
    this.phaseElapsedSec = 0;
    this.handshakeTriggered = false;
    this.warmupTriggered = false;
    this.arrivalFlashTriggered = false;

    const targetLat = cluster.centroid.latitude;
    const targetLon = cluster.centroid.longitude;
    const isOcean = this.isOceanLocation(targetLat, targetLon);
    this.isCurrentTargetOcean = isOcean;

    let targetDist = this.calculateFramingDistance(cluster);

    if (isOcean) {
      // In open ocean far from land: avoid wide empty ocean framing, strictly pick VERY_CLOSE (115) or CLOSE (140)
      targetDist = Math.random() < 0.5 ? SHOT_SCALE_DISTANCES.VERY_CLOSE : SHOT_SCALE_DISTANCES.CLOSE;
    } else if (this.filterMatrix.shotScale === 'AUTO_DIVERSITY') {
      // Dynamic Shot Variety when AUTO_DIVERSITY mode is selected by user
      const dynamicScales: ShotScale[] = ['VERY_CLOSE', 'CLOSE', 'COUNTRY', 'REGIONAL'];
      this.tourStepIndex = (this.tourStepIndex + 1) % dynamicScales.length;
      const pickedScale = dynamicScales[this.tourStepIndex];
      targetDist = SHOT_SCALE_DISTANCES[pickedScale];
    }

    const flightPitch = this.filterMatrix.pitchDeg;

    this.currentTarget = {
      clusterId: cluster.id,
      centroid: cluster.centroid,
      boundingRadiusKm: cluster.boundingRadiusKm,
      presentationClass: cluster.presentationClass,
      targetDistance: targetDist
    };

    // Calculate flight duration based on config or distance (6.0s default approach)
    const distKm = haversineDistanceKm(this.currentLat, this.currentLon, targetLat, targetLon);
    const isInter = distKm > 3500;
    const defaultApproachMs = isInter ? 6000 : 5000;
    const configApproachMs = this.customApproachDurationProvided
      ? this.config.approachDurationMs
      : defaultApproachMs;
    this.approachDurationSec = configApproachMs / 1000;

    // Ocean Pass: halve the dwell time (5.2s instead of 10.4s: 1.0s still + 4.2s orbit)
    const baseHoldMs = this.config.holdDurationMs ?? 10400;
    const effectiveHoldMs = isOcean ? baseHoldMs / 2 : baseHoldMs;
    this.holdDurationSec = effectiveHoldMs / 1000;
    this.returnDurationSec = (this.config.returnDurationMs ?? 3000) / 1000;

    const arrivalEpoch = Date.now() + configApproachMs;
    this.activeFlightIntent = {
      targetClusterId: cluster.id,
      flightDurationMs: configApproachMs,
      arrivalEpoch,
      targetLat,
      targetLon,
      isInterContinental: isInter
    };

    this.setCameraState('APPROACH');
    this.setFlightPhase(isInter ? 'APPROACH_PULLOUT' : 'APPROACH_DIVE');
    if (this.controlsManager?.setEnabled) {
      this.controlsManager.setEnabled(false);
    }

    // Trigger async controls flight if real controlsManager is present
    if (typeof (this.controlsManager as any)?.flyTo === 'function') {
      this.executeCinematicFlightAsync(cluster, targetLat, targetLon, targetDist, isInter, distKm, flightPitch);
    }
  }

  public startCinematicFlight(cluster: ScoredCluster): void {
    this.flyToCluster(cluster);
  }

  private async executeCinematicFlightAsync(
    _cluster: ScoredCluster,
    targetLat: number,
    targetLon: number,
    targetDist: number,
    isInter: boolean,
    distKm: number,
    pitchDeg: number = this.filterMatrix.pitchDeg
  ): Promise<void> {
    if (this.isTransitioning) return;
    this.isTransitioning = true;
    try {
      if (isInter) {
        await this.executeInterContinentalFlight(targetLat, targetLon, targetDist, pitchDeg);
      } else {
        await this.executeIntraContinentalFlight(targetLat, targetLon, distKm, targetDist, pitchDeg);
      }
    } catch {
      // Ignored if user interrupted
    } finally {
      this.isTransitioning = false;
    }
  }

  private async executeInterContinentalFlight(
    targetLat: number,
    targetLon: number,
    targetDist: number,
    finalPitch: number
  ): Promise<void> {
    this.setFlightPhase('APPROACH_DIVE');
    if (this.activeTargetCluster && this.onApproachWarmup) {
      this.onApproachWarmup(this.activeTargetCluster.id, targetLat, targetLon);
    }

    const flightEye = new THREE.Vector3();
    const flightLook = new THREE.Vector3();
    this.calculateCameraPose(targetLat, targetLon, targetDist, finalPitch, flightEye, flightLook);

    const normalizedTilt = (finalPitch ?? 0) / 75;
    await (this.controlsManager as any).flyTo(flightEye, flightLook, true, normalizedTilt, this.approachDurationSec);

    this.currentLat = targetLat;
    this.currentLon = targetLon;
  }

  private async executeIntraContinentalFlight(
    targetLat: number,
    targetLon: number,
    _distKm: number,
    targetDist: number,
    finalPitch: number
  ): Promise<void> {
    this.setFlightPhase('APPROACH_DIVE');
    if (this.activeTargetCluster && this.onApproachWarmup) {
      this.onApproachWarmup(this.activeTargetCluster.id, targetLat, targetLon);
    }

    const resolvedPitch = Math.max(0, Math.min(75, finalPitch));
    const flightEye = new THREE.Vector3();
    const flightLook = new THREE.Vector3();
    this.calculateCameraPose(targetLat, targetLon, targetDist, resolvedPitch, flightEye, flightLook);

    const normalizedTilt = (resolvedPitch ?? 0) / 75;
    await (this.controlsManager as any).flyTo(flightEye, flightLook, true, normalizedTilt, this.approachDurationSec);

    this.currentLat = targetLat;
    this.currentLon = targetLon;
  }

  // =========================================================================
  // Smart Live Tour
  // =========================================================================

  private getNextTourTarget(): ScoredCluster | null {
    if (!this.targetProvider) return null;
    const candidate = this.targetProvider();
    if (!candidate) return null;

    // Cycle shot scales for cinematic drone variety while preserving user's pitch angle
    const tourScales: ShotScale[] = ['CLOSE', 'REGIONAL', 'COUNTRY', 'VERY_CLOSE'];

    this.tourStepIndex = (this.tourStepIndex + 1) % tourScales.length;
    this.filterMatrix.shotScale = tourScales[this.tourStepIndex];

    return candidate;
  }

  // =========================================================================
  // Pose Computation & Smooth Application
  // =========================================================================

  public calculateCameraPose(
    lat: number,
    lon: number,
    distance: number,
    pitchDeg: number,
    outEye: THREE.Vector3,
    outLook: THREE.Vector3
  ): void {
    const surface = latLngToVector3(lat, lon, 0, 100);
    this.scratchNormal.copy(surface).normalize();

    const clampedPitch = Math.max(0, Math.min(75, Math.round(pitchDeg)));
    const maxVisibleAngle = Math.acos(THREE.MathUtils.clamp(100 / distance, -1, 1));
    const normalizedTilt = clampedPitch / 75;
    const effectiveTiltAngle = normalizedTilt * maxVisibleAngle;

    const cosP = Math.cos(effectiveTiltAngle);
    const sinP = Math.sin(effectiveTiltAngle);

    if (Math.abs(this.scratchNormal.y) > 0.95) {
      this.scratchRefUp.set(0, 0, 1);
    } else {
      this.scratchRefUp.set(0, 1, 0);
    }

    this.scratchTangent
      .copy(this.scratchRefUp)
      .addScaledVector(this.scratchNormal, -this.scratchRefUp.dot(this.scratchNormal))
      .normalize();

    this.scratchTangent.negate();

    outEye.copy(this.scratchNormal)
      .multiplyScalar(cosP)
      .addScaledVector(this.scratchTangent, sinP)
      .normalize()
      .multiplyScalar(distance);

    outLook.copy(surface);
  }

  public applyCurrentPose(animate: boolean = true): void {
    const dist = this.getTargetDistance();
    const poseEye = new THREE.Vector3();
    const poseLook = new THREE.Vector3();
    this.calculateCameraPose(this.currentLat, this.currentLon, dist, this.filterMatrix.pitchDeg, poseEye, poseLook);
    if (typeof (this.controlsManager as any)?.flyTo === 'function') {
      const normalizedTilt = (this.filterMatrix.pitchDeg ?? 0) / 75;
      (this.controlsManager as any).flyTo(poseEye, poseLook, animate, normalizedTilt);
    }
  }

  // =========================================================================
  // Frame Update Loop
  public update(delta: number = 0.016): void {
    // 0. Authoritative coordinate sync from cameraController (immune to tilt-induced latitude displacement)
    if (this.controlsManager?.cameraController) {
      this.currentLat = this.controlsManager.cameraController.currentLat;
      this.currentLon = this.controlsManager.cameraController.currentLon;
      if (this.filterMatrix.autoFollow) {
        this.controlsManager.cameraController.resetIdleTimer();
      }
    } else if (this.camera.position.lengthSq() > 1.0) {
      this.scratchCurrentPos.copy(this.camera.position);
      const coords = vector3ToLatLng(this.scratchCurrentPos);
      this.currentLat = coords.lat;
      this.currentLon = coords.lng;
    }

    // 0b. Intro Drone Choreography (Initial 10s welcoming orbit)
    if (this.isIntroActive) {
      this.introElapsedSec += delta;

      // Smooth drone orbit around Earth
      if (typeof (this.controlsManager as any)?.rotate === 'function') {
        (this.controlsManager as any).rotate(0.04 * delta, 0, false);
      }

      // Smooth cubic Hermite ease-in-out zoom from 340u to 260u
      const t = Math.min(1.0, this.introElapsedSec / this.introDurationSec);
      const easeT = t * t * (3.0 - 2.0 * t);
      const currentDist = THREE.MathUtils.lerp(this.introStartDist, this.introEndDist, easeT);
      this.camera.position.setLength(currentDist);
      if ((this.controlsManager as any)?.cameraController) {
        (this.controlsManager as any).cameraController.currentDistance = currentDist;
        (this.controlsManager as any).cameraController.targetDistance = currentDist;
      }

      if (this.introElapsedSec >= this.introDurationSec) {
        this.isIntroActive = false;
        this.flightPhase = 'IDLE';
        this.lastEventObservedEpoch = Date.now();
        for (const cb of this.phaseCallbacks) {
          cb('IDLE');
        }

        // Seamlessly transition into storm tracking if auto-follow has candidates
        if (this.filterMatrix.autoFollow) {
          if (this.candidateTarget && this.isClusterEligible(this.candidateTarget)) {
            const candidate = this.candidateTarget;
            this.candidateTarget = null;
            this.initiateApproach(candidate);
          } else if (this.targetProvider) {
            const candidate = this.targetProvider();
            if (candidate && this.isClusterEligible(candidate)) {
              this.initiateApproach(candidate);
            }
          }
        }
      }
      return;
    }

    // 1. User Cooldown countdown
    if (this.userCooldownRemainingSec > 0) {
      this.userCooldownRemainingSec = Math.max(0, this.userCooldownRemainingSec - delta);
    }

    // 2. Drone angle smooth interpolation
    if (Math.abs(this.currentCameraAngleDeg - this.targetCameraAngleDeg) > 0.01) {
      const step = (this.targetCameraAngleDeg - this.currentCameraAngleDeg) * Math.min(1.0, delta * 6.0);
      this.currentCameraAngleDeg += step;

      // Sync surface target when in manual mode and not currently executing flyTo
      if (!this.filterMatrix.autoFollow && !this.isTransitioning) {
        // Target is locked to (0,0,0)
      }
    }

    // 3. State Machine Handling
    if (this.cameraState === 'APPROACH') {
      this.phaseElapsedSec += delta;

      // Handshake trigger (400ms before touchdown)
      if (!this.handshakeTriggered && this.phaseElapsedSec >= Math.max(0, this.approachDurationSec - 0.4)) {
        this.handshakeTriggered = true;
        if (this.activeFlightIntent) {
          StochasticPacingQueue.broadcastArrivalSync(
            this.activeFlightIntent.targetLat,
            this.activeFlightIntent.targetLon,
            80,
            Date.now() + 400
          );
        }
      }

      // Arrival-synced flash playback trigger (1.2s before touchdown, destination clearly in frame)
      if (!this.arrivalFlashTriggered && this.phaseElapsedSec >= Math.max(0, this.approachDurationSec - 1.2)) {
        this.arrivalFlashTriggered = true;
        if (this.activeTargetCluster && this.onArrivalFlash) {
          this.onArrivalFlash(this.activeTargetCluster);
        }
      }

      // Warmup trigger (halfway through)
      if (!this.warmupTriggered && this.phaseElapsedSec >= this.approachDurationSec * 0.5) {
        this.warmupTriggered = true;
        if (this.activeTargetCluster && this.onApproachWarmup) {
          this.onApproachWarmup(
            this.activeTargetCluster.id,
            this.activeTargetCluster.centroid.latitude,
            this.activeTargetCluster.centroid.longitude
          );
        }
      }

      // Transition to HOLD when approach completes
      if (this.phaseElapsedSec >= this.approachDurationSec) {
        this.cameraState = 'HOLD';
        this.flightPhase = 'HOLD';
        this.phaseElapsedSec = 0;
        this.holdUntilEpoch = Date.now() + (this.holdDurationSec * 1000);

        if (this.currentTarget) {
          const targetDist = this.currentTarget.targetDistance;
          if (typeof window === 'undefined') {
            this.camera.position.setLength(targetDist);
            if (this.controlsManager?.cameraController) {
              this.controlsManager.cameraController.currentDistance = targetDist;
            }
          } else if (!this.controlsManager?.cameraController) {
            this.camera.position.setLength(targetDist);
          }
        }

        for (const cb of this.stateCallbacks) {
          cb('HOLD', this.currentTarget);
        }
        for (const cb of this.phaseCallbacks) {
          cb('HOLD');
        }
      }
      return;
    }

    if (this.cameraState === 'HOLD') {
      this.phaseElapsedSec += delta;

      // Cinematic drone arc sweep during hold: motionless for 1.0s (ocean) or 2.0s (land), then smooth ease-in
      const stillDuration = this.isCurrentTargetOcean ? 1.0 : 2.0;
      if (this.phaseElapsedSec > stillDuration && typeof (this.controlsManager as any)?.rotate === 'function') {
        const ramp = Math.min(1.0, (this.phaseElapsedSec - stillDuration) / 1.5);
        const easeFactor = ramp * ramp * (3.0 - 2.0 * ramp);
        (this.controlsManager as any).rotate(0.015 * easeFactor * delta, 0, false);
      }

      // When hold completes
      if (this.phaseElapsedSec >= this.holdDurationSec) {
        if (this.activeTargetCluster) {
          for (const cb of this.presentationCompleteCallbacks) {
            cb(this.activeTargetCluster.id);
          }
        }

        // Check target provider for chaining (or next tour stop)
        let nextTarget: ScoredCluster | null = null;
        if (this.filterMatrix.cameraMode === 'TOUR') {
          nextTarget = this.getNextTourTarget();
        } else if (this.filterMatrix.autoFollow && this.targetProvider) {
          nextTarget = this.targetProvider();
        }

        if (nextTarget && this.isClusterEligible(nextTarget)) {
          // Direct chaining to APPROACH without returning to IDLE
          this.initiateApproach(nextTarget);
        } else {
          // Return transition
          this.cameraState = 'RETURN';
          this.flightPhase = 'RETURN';
          this.phaseElapsedSec = 0;
          for (const cb of this.stateCallbacks) {
            cb('RETURN', this.currentTarget);
          }
          for (const cb of this.phaseCallbacks) {
            cb('RETURN');
          }
        }
      }
      return;
    }

    if (this.cameraState === 'RETURN') {
      this.phaseElapsedSec += delta;

      if (this.phaseElapsedSec >= this.returnDurationSec) {
        this.cameraState = 'IDLE';
        this.flightPhase = 'IDLE';
        this.phaseElapsedSec = 0;
        this.currentTarget = null;
        this.activeTargetCluster = null;

        if (this.controlsManager?.setEnabled) {
          this.controlsManager.setEnabled(true);
        }

        for (const cb of this.stateCallbacks) {
          cb('IDLE', null);
        }
        for (const cb of this.phaseCallbacks) {
          cb('IDLE');
        }
      }
      return;
    }

    // In IDLE State
    if (this.cameraState === 'IDLE') {
      if (this.controlsManager?.setEnabled && !this.controlsManager.isEnabled?.()) {
        this.controlsManager.setEnabled(true);
      }

      // If auto-follow is on and user cooldown has expired:
      if (this.filterMatrix.autoFollow && this.userCooldownRemainingSec <= 0) {
        if (this.filterMatrix.cameraMode === 'TOUR') {
          const tourTarget = this.getNextTourTarget();
          if (tourTarget) {
            this.initiateApproach(tourTarget);
            return;
          }
        }

        if (this.candidateTarget && this.isClusterEligible(this.candidateTarget)) {
          const candidate = this.candidateTarget;
          this.candidateTarget = null;
          this.initiateApproach(candidate);
          return;
        }

        if (this.targetProvider) {
          const candidate = this.targetProvider();
          if (candidate && this.isClusterEligible(candidate)) {
            this.initiateApproach(candidate);
            return;
          }
        }
      }

      // Orbital drift in IDLE / ORBIT mode, or in AUTO mode while waiting for next target
      if (this.flightPhase === 'IDLE_DRIFT' || this.filterMatrix.cameraMode === 'ORBIT' || (this.filterMatrix.autoFollow && this.cameraState === 'IDLE')) {
        if (typeof (this.controlsManager as any)?.rotate === 'function') {
          (this.controlsManager as any).rotate(0.0006, 0, false);
        }
      }
    }
  }

  // =========================================================================
  // User Manual Interaction Handler
  // =========================================================================

  public getViewportCenterLatLng(): { lat: number; lng: number } {
    const rayDir = new THREE.Vector3();
    const hitPoint = new THREE.Vector3();
    this.camera.getWorldDirection(rayDir);
    const pDotD = this.camera.position.dot(rayDir);
    const pLenSq = this.camera.position.lengthSq();
    const discriminant = pDotD * pDotD - (pLenSq - 10000);
    if (discriminant >= 0) {
      const t = -pDotD - Math.sqrt(discriminant);
      if (t > 0) {
        hitPoint.copy(this.camera.position).addScaledVector(rayDir, t);
        return vector3ToLatLng(hitPoint);
      }
    }
    return vector3ToLatLng(this.camera.position);
  }

  public onUserInteraction(): void {
    if (this.isIntroActive) {
      this.isIntroActive = false;
      this.introElapsedSec = this.introDurationSec;
    }

    this.userCooldownRemainingSec = 4.0;
    this.cameraState = 'IDLE';
    this.flightPhase = 'IDLE';
    this.phaseElapsedSec = 0;
    this.currentTarget = null;
    this.activeTargetCluster = null;
    this.isTransitioning = false;

    if (this.controlsManager?.setEnabled) {
      this.controlsManager.setEnabled(true);
    }

    for (const cb of this.stateCallbacks) {
      cb('IDLE', null);
    }
    for (const cb of this.phaseCallbacks) {
      cb('IDLE');
    }

    const centerCoords = this.getViewportCenterLatLng();
    this.currentLat = centerCoords.lat;
    this.currentLon = centerCoords.lng;
  }

  public isIntroOrbitActive(): boolean {
    return this.isIntroActive;
  }

  public skipIntroOrbit(): void {
    if (this.isIntroActive) {
      this.isIntroActive = false;
      this.flightPhase = 'IDLE';
      this.lastEventObservedEpoch = Date.now();
      for (const cb of this.phaseCallbacks) {
        cb('IDLE');
      }
    }
  }

  public resetToIdle(): void {
    this.isTransitioning = false;
    this.flightPhase = 'IDLE';
    this.setCameraState('IDLE');
    this.currentTarget = null;
    this.activeTargetCluster = null;
    this.phaseElapsedSec = 0;
  }

  public flyToLocation(lat: number, lon: number, distance: number = 260): Promise<boolean> {
    const locEye = latLngToVector3(lat, lon, 0, distance);
    const locLook = new THREE.Vector3(0, 0, 0);
    this.currentLat = lat;
    this.currentLon = lon;
    if (typeof (this.controlsManager as any)?.flyTo === 'function') {
      return (this.controlsManager as any).flyTo(locEye, locLook, true);
    }
    return Promise.resolve(true);
  }

  // State Getters & Observers
  public getState(): CameraState { return this.cameraState; }
  public getFlightPhase(): FlightPhase { return this.flightPhase; }
  public getTarget(): CameraTarget | null { return this.currentTarget; }
  public getFocusCoordinates(): { lat: number; lng: number } {
    return { lat: this.currentLat, lng: this.currentLon };
  }

  public onStateChange(cb: (state: CameraState, target: CameraTarget | null) => void): () => void {
    this.stateCallbacks.add(cb);
    return () => this.stateCallbacks.delete(cb);
  }

  public onPhaseChange(cb: (phase: FlightPhase) => void): () => void {
    this.phaseCallbacks.add(cb);
    return () => this.phaseCallbacks.delete(cb);
  }

  public onPresentationComplete(cb: (clusterId: string) => void): () => void {
    this.presentationCompleteCallbacks.add(cb);
    return () => this.presentationCompleteCallbacks.delete(cb);
  }

  private setCameraState(state: CameraState): void {
    this.cameraState = state;
    for (const cb of this.stateCallbacks) {
      cb(state, this.currentTarget);
    }
  }

  private setFlightPhase(phase: FlightPhase): void {
    this.flightPhase = phase;
    for (const cb of this.phaseCallbacks) {
      cb(phase);
    }
  }

  private reducedMotion: boolean = false;

  public setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
  }

  public isReducedMotion(): boolean {
    return this.reducedMotion;
  }

  public getKinematicDurations(): { approach: number; hold: number; return: number } {
    const scale = this.reducedMotion ? 1.8 : 1.0;
    return {
      approach: Math.round(this.config.approachDurationMs * scale),
      hold: Math.round(this.config.holdDurationMs * scale),
      return: Math.round(this.config.returnDurationMs * scale)
    };
  }

  public setFramingMode(_mode: CameraFramingMode): void {}
  public isTargetInView(_lat: number, _lon: number): { isVisible: boolean; timeRemainingSec: number } {
    return { isVisible: true, timeRemainingSec: 0 };
  }

  public destroy(): void {
    if (this.removeInteractionListener) {
      this.removeInteractionListener();
      this.removeInteractionListener = null;
    }
    this.stateCallbacks.clear();
    this.phaseCallbacks.clear();
    this.presentationCompleteCallbacks.clear();
  }
}
