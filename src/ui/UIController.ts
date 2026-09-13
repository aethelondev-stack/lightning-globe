import type { ScoredCluster } from '../types/scoring';
import type { ViewMode, ClassFilter, UIState, UIControllerCallbacks, DetailedStrikeInfo } from '../types/ui';
import type { CameraFramingMode, CameraFilterMatrix, ShotScale } from '../types/camera';
import { SHOT_SCALE_DISTANCES } from '../types/camera';
import type { DemoScenarioId } from '../types/scenario';
import type { DataSourceMode } from '../types/connection';
import type { LeaderboardPeriod, CountryRankItem } from '../services/analytics/CountryLeaderboard';
import type { StormCellTelemetry } from '../world/vfx/StormCellRadar';
import { GeoIndex } from '../utils/geoRegions';
import { EngineConfig } from '../core/Config';
import type { ViewerRequest, InterleavedQueueTarget } from '../types/director';
import type { BackgroundMusicPlayer } from '../services/audio/BackgroundMusicPlayer';
import type { SoundDirector, LightningSoundProfile } from '../services/audio/SoundDirector';

/**
 * UIController: Manages the interactive Experience Controls, Active Storms Drawer, and Country Leaderboard.
 *
 * Capabilities:
 * - Direct DOM manipulation with zero heavy UI frameworks (vanilla TS).
 * - DOM diffing cache to prevent layout thrashing and maintain 60 FPS.
 * - Event bubbling isolation (stopPropagation) to prevent OrbitControls camera interference.
 * - Class filtering buttons, Auto/Manual director mode toggle, and Reduced Motion.
 * - Interactive storm list cards with direct camera navigation (flyToCluster).
 * - Real calendar Country Leaderboard (Phase 21) with DAY/WEEK/MONTH/YEAR tabs and country fly-to.
 */
export class UIController {
  private state: UIState;
  private readonly callbacks: UIControllerCallbacks;

  // DOM Elements
  private controlsContainer: HTMLElement | null = null;
  private stormDrawer: HTMLElement | null = null;
  private stormListContainer: HTMLElement | null = null;
  private btnDataSource: HTMLButtonElement | null = null;
  private btnViewMode: HTMLButtonElement | null = null;
  private btnAudio: HTMLButtonElement | null = null;
  private btnTrails: HTMLButtonElement | null = null;
  private btnToggleDrawer: HTMLButtonElement | null = null;
  private btnReducedMotion: HTMLButtonElement | null = null;
  private scenarioSelector: HTMLSelectElement | null = null;
  private filterButtons: Map<ClassFilter, HTMLButtonElement> = new Map();

  // Leaderboard Elements (Phase 21)
  private btnLeaderboard: HTMLButtonElement | null = null;
  private leaderboardDrawer: HTMLElement | null = null;
  private btnCloseLeaderboard: HTMLButtonElement | null = null;
  private leaderboardListContainer: HTMLElement | null = null;
  private leaderboardTotalCount: HTMLElement | null = null;
  private periodButtons: Map<LeaderboardPeriod, HTMLButtonElement> = new Map();
  private currentLeaderboardItems: CountryRankItem[] = [];
  private lastLeaderboardSignature: string = '';
  private leaderboardAutoCycleInterval: any = null;
  private leaderboardAutoCycleTimeouts: any[] = [];

  // Strike Detail Card Elements (Phase 17)
  private strikeCard: HTMLElement | null = null;
  private strikeFlag: HTMLElement | null = null;
  private strikeCountry: HTMLElement | null = null;
  private strikeCity: HTMLElement | null = null;
  private strikeCoords: HTMLElement | null = null;
  private strikeTimeUtc: HTMLElement | null = null;
  private strikeTimeLocal: HTMLElement | null = null;
  private strikeCurrent: HTMLElement | null = null;
  private strikePolarity: HTMLElement | null = null;
  private strikeTodayCount: HTMLElement | null = null;
  private strikeClassBadge: HTMLElement | null = null;
  private btnCloseStrikeCard: HTMLButtonElement | null = null;
  private btnFlyToStrike: HTMLButtonElement | null = null;
  private currentSelectedStrike: { lat: number; lon: number } | null = null;
  private currentSelectedIso: string | null = null;

  // Hierarchical Mega Dropdown Elements (Kıtalar, Koridorlar, Ülke Ara)
  private inputCountrySearch: HTMLInputElement | null = null;
  private countrySearchList: HTMLElement | null = null;
  private btnHierarchyMega: HTMLButtonElement | null = null;
  private dropdownMega: HTMLElement | null = null;

  // 3D Country Hover Tooltip (Phase 22)
  private countryHoverTooltip: HTMLElement | null = null;
  private tooltipFlag: HTMLElement | null = null;
  private tooltipName: HTMLElement | null = null;
  private allCountries: Array<{ name: string; iso: string; flag: string; centroid: { lat: number; lon: number } }> = [];

  // 3D Elevation Toggle (Phase 23 - Deprecated)
  private btnToggleElevation: HTMLButtonElement | null = null;

  // FAZ 2 Elements (Multi-feed & Convective Atmosphere)
  private btnFeedMode: HTMLButtonElement | null = null;
  private btnAtmosphere: HTMLButtonElement | null = null;
  private strikeSourceVal: HTMLElement | null = null;
  private rowOpticalEnergy: HTMLElement | null = null;
  private strikeOpticalVal: HTMLElement | null = null;

  // HUD Accordion, Peteks Dropdown & Right Sidebar
  private hudPanel: HTMLElement | null = null;
  private btnHudToggle: HTMLButtonElement | null = null;
  private btnActivePeteks: HTMLButtonElement | null = null;
  private dropdownPeteks: HTMLElement | null = null;
  private sliderPetekMasterOpacity: HTMLInputElement | null = null;
  private valPetekMasterOpacity: HTMLElement | null = null;
  private sliderPetekBodyOpacity: HTMLInputElement | null = null;
  private valPetekBodyOpacity: HTMLElement | null = null;
  private sliderPetekBorderOpacity: HTMLInputElement | null = null;
  private valPetekBorderOpacity: HTMLElement | null = null;
  private btnToggleTierOpacity: HTMLButtonElement | null = null;
  private panelTierOpacity: HTMLElement | null = null;
  private btnTierModeAll: HTMLButtonElement | null = null;
  private btnTierModeBody: HTMLButtonElement | null = null;
  private btnTierModeBorder: HTMLButtonElement | null = null;
  private activeTierOpacityMode: 'all' | 'body' | 'border' = 'all';
  private tierMasterValues: Record<string, number> = {
    EXTREME_OUTBREAK: 100, SQUALL_LINE: 100, MCS: 100, SUPERCELL: 100, MULTICELL: 100, SINGLE_CELL: 100, ISOLATED: 100
  };
  private tierBodyValues: Record<string, number> = {
    EXTREME_OUTBREAK: 60, SQUALL_LINE: 60, MCS: 60, SUPERCELL: 60, MULTICELL: 60, SINGLE_CELL: 60, ISOLATED: 60
  };
  private tierBorderValues: Record<string, number> = {
    EXTREME_OUTBREAK: 75, SQUALL_LINE: 75, MCS: 75, SUPERCELL: 75, MULTICELL: 75, SINGLE_CELL: 75, ISOLATED: 75
  };
  private currentCategoryFilter: string = 'ALL';
  private rightSidebar: HTMLElement | null = null;
  private panelLiveFeed: HTMLElement | null = null;
  private headerLiveFeed: HTMLElement | null = null;
  private panelCameraQueue: HTMLElement | null = null;
  private headerCameraQueue: HTMLElement | null = null;
  private cameraQueueList: HTMLElement | null = null;
  private queueCountBadge: HTMLElement | null = null;
  private panelAnalytics: HTMLElement | null = null;
  private headerAnalytics: HTMLElement | null = null;
  private liveFeedScroll: HTMLElement | null = null;
  private feedCountBadge: HTMLElement | null = null;
  private btnClearArchive: HTMLButtonElement | null = null;
  private liveFeedItemsCount: number = 0;
  private pendingFeedItems: Array<{ event: any; country?: string; flag?: string }> = [];
  private feedFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFeedFlushTime: number = 0;

  // Right Sidebar Storms & Leaderboard Accordions
  private panelStorms: HTMLElement | null = null;
  private headerStorms: HTMLElement | null = null;
  private stormsCountBadge: HTMLElement | null = null;
  private panelLeaderboard: HTMLElement | null = null;
  private headerLeaderboard: HTMLElement | null = null;

  // SFX Console Elements
  private sfxPopupCard: HTMLElement | null = null;
  private btnCloseSfx: HTMLButtonElement | null = null;
  private sfxVolumeSlider: HTMLInputElement | null = null;
  private sfxVolumeVal: HTMLElement | null = null;
  private sfxActiveProfileName: HTMLElement | null = null;
  private sfxProfileButtons: HTMLButtonElement[] = [];
  private btnSfxTestStrike: HTMLButtonElement | null = null;
  private soundDirector: SoundDirector | null = null;

  // Background Music Player & Viewer Flight HUD Elements
  private btnMusicToggle: HTMLButtonElement | null = null;
  private musicPopupCard: HTMLElement | null = null;
  private btnCloseMusic: HTMLButtonElement | null = null;
  private btnMusicPlay: HTMLButtonElement | null = null;
  private btnMusicPrev: HTMLButtonElement | null = null;
  private btnMusicNext: HTMLButtonElement | null = null;
  private btnMusicMute: HTMLButtonElement | null = null;
  private musicProgressBar: HTMLInputElement | null = null;
  private musicVolumeSlider: HTMLInputElement | null = null;
  private musicCurrentTitle: HTMLElement | null = null;
  private musicCurrentArtist: HTMLElement | null = null;
  private musicTimeDisplay: HTMLElement | null = null;
  private musicPlaylistItems: HTMLElement | null = null;
  private musicWidgetPulse: HTMLElement | null = null;
  private viewerFlightCard: HTMLElement | null = null;
  private vfcBadge: HTMLElement | null = null;
  private vfcUser: HTMLElement | null = null;
  private vfcTargetName: HTMLElement | null = null;
  private vfcCountdown: HTMLElement | null = null;
  private vfcStatusBanner: HTMLElement | null = null;

  // Drone View & Live Angle Controls
  private btnDroneView: HTMLButtonElement | null = null;
  private dropdownDroneView: HTMLElement | null = null;
  private btnDroneReset: HTMLButtonElement | null = null;
  private sliderDroneAngle: HTMLInputElement | null = null;
  private valDroneAngle: HTMLElement | null = null;
  private sliderDroneDist: HTMLInputElement | null = null;
  private valDroneDist: HTMLElement | null = null;
  private dronePresetButtons: HTMLButtonElement[] = [];
  private lastCameraDistanceUpdate: number = 0;
  private lastRenderedCamDist: number = -1;
  private petekBadgeElements: Map<string, HTMLElement> = new Map();

  // Diffing cache
  private lastRenderedSignature: string = '';
  private currentClusters: ScoredCluster[] = [];

  // Camera Accordion Bar Filter Matrix
  private camFilterMatrix: CameraFilterMatrix = {
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

  constructor(callbacks: UIControllerCallbacks) {
    this.callbacks = callbacks;
    this.state = {
      viewMode: EngineConfig.ui.defaultViewMode,
      classFilter: EngineConfig.ui.defaultFilter,
      reducedMotion: false,
      isStormListOpen: false,
      isLeaderboardOpen: false,
      leaderboardPeriod: 'day',
      dataSourceMode: EngineConfig.liveStream.defaultDataSource,
      multiSourceMode: 'ALL_HYBRID',
      isAudioMuted: true,
      isTrailsEnabled: true,
      isElevationEnabled: false,
      isAtmosphereEnabled: true
    };

    this.bindDomElements();
    this.attachEventListeners();
    this.setupCameraAccordionBar();
    this.renderState();
    this.startLeaderboardAutoCycle();
  }

  private bindDomElements(): void {
    this.controlsContainer = document.getElementById('experience-controls');
    this.stormDrawer = document.getElementById('storm-drawer');
    this.stormListContainer = document.getElementById('storm-list-container');
    this.btnDataSource = document.getElementById('btn-data-source') as HTMLButtonElement | null;
    this.btnViewMode = document.getElementById('btn-view-mode') as HTMLButtonElement | null;
    this.btnAudio = document.getElementById('btn-audio') as HTMLButtonElement | null;
    this.btnFeedMode = document.getElementById('btn-feed-mode') as HTMLButtonElement | null;
    this.btnAtmosphere = document.getElementById('btn-atmosphere') as HTMLButtonElement | null;
    this.btnTrails = document.getElementById('btn-trails') as HTMLButtonElement | null;
    this.btnToggleElevation = document.getElementById('btn-toggle-elevation') as HTMLButtonElement | null;
    this.btnToggleDrawer = document.getElementById('btn-toggle-drawer') as HTMLButtonElement | null;
    this.btnReducedMotion = document.getElementById('btn-reduced-motion') as HTMLButtonElement | null;
    this.scenarioSelector = document.getElementById('scenario-selector') as HTMLSelectElement | null;

    // Leaderboard Elements (Phase 21)
    this.btnLeaderboard = document.getElementById('btn-leaderboard') as HTMLButtonElement | null;
    this.leaderboardDrawer = document.getElementById('leaderboard-drawer');
    this.btnCloseLeaderboard = document.getElementById('btn-close-leaderboard') as HTMLButtonElement | null;
    this.leaderboardListContainer = document.getElementById('leaderboard-list-container');
    this.leaderboardTotalCount = document.getElementById('leaderboard-total-count');

    const btnDay = document.getElementById('btn-period-day') as HTMLButtonElement | null;
    const btnWeek = document.getElementById('btn-period-week') as HTMLButtonElement | null;
    const btnMonth = document.getElementById('btn-period-month') as HTMLButtonElement | null;
    const btnYear = document.getElementById('btn-period-year') as HTMLButtonElement | null;

    if (btnDay) this.periodButtons.set('day', btnDay);
    if (btnWeek) this.periodButtons.set('week', btnWeek);
    if (btnMonth) this.periodButtons.set('month', btnMonth);
    if (btnYear) this.periodButtons.set('year', btnYear);

    // Strike Card Elements
    this.strikeCard = document.getElementById('strike-detail-card');
    this.strikeFlag = document.getElementById('strike-flag');
    this.strikeCountry = document.getElementById('strike-country');
    this.strikeCity = document.getElementById('strike-city');
    this.strikeCoords = document.getElementById('strike-coords');
    this.strikeTimeUtc = document.getElementById('strike-time-utc');
    this.strikeTimeLocal = document.getElementById('strike-time-local');
    this.strikeCurrent = document.getElementById('strike-current');
    this.strikePolarity = document.getElementById('strike-polarity');
    this.strikeSourceVal = document.getElementById('strike-source-val');
    this.rowOpticalEnergy = document.getElementById('row-optical-energy');
    this.strikeOpticalVal = document.getElementById('strike-optical-val');
    this.strikeTodayCount = document.getElementById('strike-today-count');
    this.strikeClassBadge = document.getElementById('strike-class-badge');
    this.btnCloseStrikeCard = document.getElementById('btn-close-strike-card') as HTMLButtonElement | null;
    this.btnFlyToStrike = document.getElementById('btn-fly-to-strike') as HTMLButtonElement | null;

    // Hierarchy Elements (Phase 22)
    this.btnHierarchyMega = document.getElementById('btn-hierarchy-mega') as HTMLButtonElement | null;
    this.dropdownMega = document.getElementById('dropdown-mega');
    this.inputCountrySearch = document.getElementById('input-country-search') as HTMLInputElement | null;
    this.countrySearchList = document.getElementById('country-search-list');

    this.countryHoverTooltip = document.getElementById('country-hover-tooltip');
    this.tooltipFlag = document.getElementById('tooltip-flag');
    this.tooltipName = document.getElementById('tooltip-name');

    // HUD Accordion Toggle
    this.hudPanel = document.querySelector('.hud-panel');
    this.btnHudToggle = document.getElementById('btn-hud-toggle') as HTMLButtonElement | null;

    // Peteks Dropdown
    this.btnActivePeteks = document.getElementById('btn-active-peteks') as HTMLButtonElement | null;
    this.dropdownPeteks = document.getElementById('dropdown-peteks');
    this.sliderPetekMasterOpacity = document.getElementById('slider-petek-master-opacity') as HTMLInputElement | null;
    this.valPetekMasterOpacity = document.getElementById('val-petek-master-opacity');
    this.sliderPetekBodyOpacity = document.getElementById('slider-petek-body-opacity') as HTMLInputElement | null;
    this.valPetekBodyOpacity = document.getElementById('val-petek-body-opacity');
    this.sliderPetekBorderOpacity = document.getElementById('slider-petek-border-opacity') as HTMLInputElement | null;
    this.valPetekBorderOpacity = document.getElementById('val-petek-border-opacity');
    this.btnToggleTierOpacity = document.getElementById('btn-toggle-tier-opacity') as HTMLButtonElement | null;
    this.panelTierOpacity = document.getElementById('panel-tier-opacity');
    this.btnTierModeAll = document.getElementById('btn-tier-mode-all') as HTMLButtonElement | null;
    this.btnTierModeBody = document.getElementById('btn-tier-mode-body') as HTMLButtonElement | null;
    this.btnTierModeBorder = document.getElementById('btn-tier-mode-border') as HTMLButtonElement | null;

    // Right Sidebar & Accordions
    this.rightSidebar = document.getElementById('right-sidebar');
    this.panelLiveFeed = document.getElementById('panel-live-feed');
    this.headerLiveFeed = document.getElementById('header-live-feed');
    this.panelCameraQueue = document.getElementById('panel-camera-queue');
    this.headerCameraQueue = document.getElementById('header-camera-queue');
    this.cameraQueueList = document.getElementById('camera-queue-list');
    this.queueCountBadge = document.getElementById('queue-count-badge');
    this.panelAnalytics = document.getElementById('panel-analytics');
    this.headerAnalytics = document.getElementById('header-analytics');
    this.liveFeedScroll = document.getElementById('live-feed-scroll');
    this.feedCountBadge = document.getElementById('feed-count-badge');
    this.btnClearArchive = document.getElementById('btn-clear-archive') as HTMLButtonElement | null;

    // Right Sidebar Storms & Leaderboard Accordions
    this.panelStorms = document.getElementById('panel-storms');
    this.headerStorms = document.getElementById('header-storms');
    this.stormsCountBadge = document.getElementById('storms-count-badge');
    this.panelLeaderboard = document.getElementById('panel-leaderboard');
    this.headerLeaderboard = document.getElementById('header-leaderboard');

    // SFX Console Elements
    this.sfxPopupCard = document.getElementById('sfx-popup-card');
    this.btnCloseSfx = document.getElementById('btn-close-sfx') as HTMLButtonElement | null;
    this.sfxVolumeSlider = document.getElementById('sfx-volume-slider') as HTMLInputElement | null;
    this.sfxVolumeVal = document.getElementById('sfx-volume-val');
    this.sfxActiveProfileName = document.getElementById('sfx-active-profile-name');
    if (this.sfxPopupCard) {
      this.sfxProfileButtons = Array.from(this.sfxPopupCard.querySelectorAll<HTMLButtonElement>('.sfx-profile-btn'));
    }
    this.btnSfxTestStrike = document.getElementById('btn-sfx-test-strike') as HTMLButtonElement | null;

    // Background Music Player & Viewer Flight HUD Elements
    this.btnMusicToggle = document.getElementById('btn-music-toggle') as HTMLButtonElement | null;
    this.musicPopupCard = document.getElementById('music-popup-card');
    this.btnCloseMusic = document.getElementById('btn-close-music') as HTMLButtonElement | null;
    this.btnMusicPlay = document.getElementById('btn-music-play') as HTMLButtonElement | null;
    this.btnMusicPrev = document.getElementById('btn-music-prev') as HTMLButtonElement | null;
    this.btnMusicNext = document.getElementById('btn-music-next') as HTMLButtonElement | null;
    this.btnMusicMute = document.getElementById('btn-music-mute') as HTMLButtonElement | null;
    this.musicProgressBar = document.getElementById('music-progress-bar') as HTMLInputElement | null;
    this.musicVolumeSlider = document.getElementById('music-volume-slider') as HTMLInputElement | null;
    this.musicCurrentTitle = document.getElementById('music-current-title');
    this.musicCurrentArtist = document.getElementById('music-current-artist');
    this.musicTimeDisplay = document.getElementById('music-time-display');
    this.musicPlaylistItems = document.getElementById('music-playlist-items');
    this.musicWidgetPulse = document.getElementById('music-widget-pulse');

    this.viewerFlightCard = document.getElementById('viewer-flight-card');
    this.vfcBadge = document.getElementById('vfc-badge');
    this.vfcUser = document.getElementById('vfc-user');
    this.vfcTargetName = document.getElementById('vfc-target-name');
    this.vfcCountdown = document.getElementById('vfc-countdown');
    this.vfcStatusBanner = document.getElementById('vfc-status-banner');

    // Drone View & Live Angle Controls
    this.btnDroneView = document.getElementById('btn-drone-view') as HTMLButtonElement | null;
    this.dropdownDroneView = document.getElementById('dropdown-drone-view');
    this.btnDroneReset = document.getElementById('btn-drone-reset') as HTMLButtonElement | null;
    this.sliderDroneAngle = document.getElementById('slider-drone-angle') as HTMLInputElement | null;
    this.valDroneAngle = document.getElementById('drone-angle-val');
    this.sliderDroneDist = document.getElementById('slider-drone-dist') as HTMLInputElement | null;
    this.valDroneDist = document.getElementById('drone-dist-val');
    if (this.dropdownDroneView) {
      this.dronePresetButtons = Array.from(this.dropdownDroneView.querySelectorAll<HTMLButtonElement>('.drone-preset-btn'));
    }
  }

  private attachEventListeners(): void {
    // Isolate mouse and touch events from Three.js orbit controls
    const isolate = (e: Event) => e.stopPropagation();

    if (this.controlsContainer) {
      this.controlsContainer.addEventListener('pointerdown', isolate);
      this.controlsContainer.addEventListener('mousedown', isolate);
      this.controlsContainer.addEventListener('click', isolate);
    }

    if (this.stormDrawer) {
      this.stormDrawer.addEventListener('pointerdown', isolate);
      this.stormDrawer.addEventListener('mousedown', isolate);
      this.stormDrawer.addEventListener('click', isolate);
      this.stormDrawer.addEventListener('wheel', isolate);
    }

    if (this.rightSidebar) {
      this.rightSidebar.addEventListener('pointerdown', isolate);
      this.rightSidebar.addEventListener('mousedown', isolate);
      this.rightSidebar.addEventListener('click', isolate);
      this.rightSidebar.addEventListener('wheel', isolate);
    }

    // HUD Accordion Collapse Toggle
    if (this.btnHudToggle && this.hudPanel) {
      this.btnHudToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        this.hudPanel?.classList.toggle('collapsed');
      });
    }

    // Unified Mega Dropdown Listeners
    const closeMegaDropdown = () => {
      this.dropdownMega?.classList.add('hidden');
      this.btnHierarchyMega?.classList.remove('active');
    };

    const closePeteksDropdown = () => {
      this.dropdownPeteks?.classList.add('hidden');
      this.btnActivePeteks?.classList.remove('active');
    };

    const btnCameraFraming = document.getElementById('btn-camera-framing') as HTMLButtonElement | null;
    const dropdownCameraFraming = document.getElementById('dropdown-camera-framing');

    const closeCameraDropdown = () => {
      dropdownCameraFraming?.classList.add('hidden');
      btnCameraFraming?.classList.remove('active');
    };

    const closeDroneDropdown = () => {
      this.dropdownDroneView?.classList.add('hidden');
      this.btnDroneView?.classList.remove('active');
    };

    if (btnCameraFraming) {
      btnCameraFraming.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = !dropdownCameraFraming?.classList.contains('hidden');
        if (isOpen) {
          closeCameraDropdown();
        } else {
          closeMegaDropdown();
          closePeteksDropdown();
          closeDroneDropdown();
          dropdownCameraFraming?.classList.remove('hidden');
          btnCameraFraming?.classList.add('active');
        }
      });
    }

    if (dropdownCameraFraming) {
      dropdownCameraFraming.querySelectorAll('.dropdown-item').forEach((item) => {
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          const mode = (item.getAttribute('data-cam-mode') || 'AUTO') as CameraFramingMode;
          dropdownCameraFraming.querySelectorAll('.dropdown-item').forEach((it) => it.classList.remove('active'));
          item.classList.add('active');
          closeCameraDropdown();
          if (btnCameraFraming) {
            if (mode === 'AUTO') btnCameraFraming.textContent = '🎬 Kamera: OTO ▾';
            else if (mode === 'WIDE') btnCameraFraming.textContent = '🔭 Kamera: GENİŞ ▾';
            else if (mode === 'REGIONAL') btnCameraFraming.textContent = '🗺️ Kamera: BÖLGESEL ▾';
            else if (mode === 'MEDIUM') btnCameraFraming.textContent = '⚡ Kamera: ORTA ▾';
            else if (mode === 'CLOSE') btnCameraFraming.textContent = '🔍 Kamera: YAKIN ▾';
          }
          this.callbacks.onCameraFramingModeChange?.(mode);
        });
      });
    }

    // Drone View & Pitch Angle Dropdown Listeners
    if (this.btnDroneView) {
      this.btnDroneView.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = !this.dropdownDroneView?.classList.contains('hidden');
        if (isOpen) {
          closeDroneDropdown();
        } else {
          closeMegaDropdown();
          closePeteksDropdown();
          closeCameraDropdown();
          this.dropdownDroneView?.classList.remove('hidden');
          this.btnDroneView?.classList.add('active');
        }
      });
    }

    if (this.dropdownDroneView) {
      this.dropdownDroneView.addEventListener('click', (e) => e.stopPropagation());
      this.dropdownDroneView.addEventListener('pointerdown', (e) => e.stopPropagation());
      this.dropdownDroneView.addEventListener('mousedown', (e) => e.stopPropagation());
    }

    const updateDroneUI = (angle: number, dist: number) => {
      if (this.valDroneAngle) this.valDroneAngle.textContent = angle.toString();
      if (this.sliderDroneAngle) this.sliderDroneAngle.value = angle.toString();
      if (this.valDroneDist) this.valDroneDist.textContent = dist.toString();
      if (this.sliderDroneDist) this.sliderDroneDist.value = dist.toString();

      if (this.btnDroneView) {
        this.btnDroneView.textContent = `🚁 Drone: ${angle}° ▾`;
        this.btnDroneView.classList.toggle('active', angle > 0);
      }

      for (const btn of this.dronePresetButtons) {
        const btnAngle = parseInt(btn.getAttribute('data-angle') || '0', 10);
        btn.classList.toggle('active', btnAngle === angle);
      }
    };

    // Drone Presets Click
    for (const btn of this.dronePresetButtons) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const angle = parseInt(btn.getAttribute('data-angle') || '0', 10);
        const dist = parseInt(btn.getAttribute('data-dist') || '175', 10);
        updateDroneUI(angle, dist);
        this.callbacks.onDroneAngleChange?.(angle, dist);
      });
    }

    // Angle Slider Input
    if (this.sliderDroneAngle) {
      this.sliderDroneAngle.addEventListener('input', (e) => {
        e.stopPropagation();
        const angle = parseInt(this.sliderDroneAngle?.value || '0', 10);
        const dist = parseInt(this.sliderDroneDist?.value || '175', 10);
        updateDroneUI(angle, dist);
        this.callbacks.onDroneAngleChange?.(angle, dist);
      });
    }

    // Distance Slider Input
    if (this.sliderDroneDist) {
      this.sliderDroneDist.addEventListener('input', (e) => {
        e.stopPropagation();
        const angle = parseInt(this.sliderDroneAngle?.value || '0', 10);
        const dist = parseInt(this.sliderDroneDist?.value || '175', 10);
        updateDroneUI(angle, dist);
        this.callbacks.onDroneAngleChange?.(angle, dist);
      });
    }

    // Reset Button
    if (this.btnDroneReset) {
      this.btnDroneReset.addEventListener('click', (e) => {
        e.stopPropagation();
        updateDroneUI(0, 175);
        this.callbacks.onDroneAngleChange?.(0, 175);
      });
    }

    if (this.btnActivePeteks) {
      this.btnActivePeteks.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = !this.dropdownPeteks?.classList.contains('hidden');
        if (isOpen) {
          closePeteksDropdown();
        } else {
          closeMegaDropdown();
          closeDroneDropdown();
          closeCameraDropdown();
          this.dropdownPeteks?.classList.remove('hidden');
          this.btnActivePeteks?.classList.add('active');
        }
      });
    }

    if (this.dropdownPeteks) {
      this.dropdownPeteks.querySelectorAll('.dropdown-item').forEach((item) => {
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          const category = item.getAttribute('data-category') || 'ALL';
          this.currentCategoryFilter = category;
          this.dropdownPeteks?.querySelectorAll('.dropdown-item').forEach((it) => it.classList.remove('active'));
          item.classList.add('active');
          closePeteksDropdown();
          this.callbacks.onCategoryFilterChange?.(category);
        });
      });
    }

    if (this.sliderPetekMasterOpacity) {
      ['click', 'pointerdown', 'mousedown'].forEach((evt) => {
        this.sliderPetekMasterOpacity?.addEventListener(evt, (e) => e.stopPropagation());
      });
      this.sliderPetekMasterOpacity.addEventListener('input', () => {
        const val = this.sliderPetekMasterOpacity?.value || '100';
        if (this.valPetekMasterOpacity) {
          this.valPetekMasterOpacity.textContent = `${val}%`;
        }
        const pct = parseFloat(val) / 100;
        this.callbacks.onPetekMasterOpacityChange?.(pct);
      });
    }

    if (this.sliderPetekBodyOpacity) {
      ['click', 'pointerdown', 'mousedown'].forEach((evt) => {
        this.sliderPetekBodyOpacity?.addEventListener(evt, (e) => e.stopPropagation());
      });
      this.sliderPetekBodyOpacity.addEventListener('input', () => {
        const val = this.sliderPetekBodyOpacity?.value || '60';
        if (this.valPetekBodyOpacity) {
          this.valPetekBodyOpacity.textContent = `${val}%`;
        }
        const pct = parseFloat(val) / 100;
        this.callbacks.onPetekBodyOpacityChange?.(pct);
      });
    }

    if (this.sliderPetekBorderOpacity) {
      ['click', 'pointerdown', 'mousedown'].forEach((evt) => {
        this.sliderPetekBorderOpacity?.addEventListener(evt, (e) => e.stopPropagation());
      });
      this.sliderPetekBorderOpacity.addEventListener('input', () => {
        const val = this.sliderPetekBorderOpacity?.value || '75';
        if (this.valPetekBorderOpacity) {
          this.valPetekBorderOpacity.textContent = `${val}%`;
        }
        const pct = parseFloat(val) / 100;
        this.callbacks.onPetekBorderOpacityChange?.(pct);
      });
    }

    if (this.btnToggleTierOpacity) {
      this.btnToggleTierOpacity.addEventListener('click', (e) => {
        e.stopPropagation();
        this.panelTierOpacity?.classList.toggle('hidden');
        const chevron = document.getElementById('icon-tier-opacity-chevron');
        if (chevron) {
          const isHidden = this.panelTierOpacity?.classList.contains('hidden');
          chevron.textContent = isHidden ? '▾' : '▴';
        }
      });
    }

    if (this.panelTierOpacity) {
      ['click', 'pointerdown', 'mousedown'].forEach((evt) => {
        this.panelTierOpacity?.addEventListener(evt, (e) => e.stopPropagation());
      });

      const tierSliders = this.panelTierOpacity.querySelectorAll<HTMLInputElement>('.slider-tier-opacity');

      const refreshTierSliders = () => {
        tierSliders.forEach((slider) => {
          const tier = slider.getAttribute('data-tier');
          if (!tier) return;
          const currentVal = this.activeTierOpacityMode === 'all'
            ? (this.tierMasterValues[tier] ?? 100)
            : this.activeTierOpacityMode === 'border'
              ? (this.tierBorderValues[tier] ?? 100)
              : (this.tierBodyValues[tier] ?? 100);
          slider.value = currentVal.toString();
          const valEl = document.getElementById(`val-tier-${tier}`);
          if (valEl) {
            valEl.textContent = `${currentVal}%`;
          }
        });
      };

      if (this.btnTierModeAll) {
        this.btnTierModeAll.addEventListener('click', (e) => {
          e.stopPropagation();
          this.activeTierOpacityMode = 'all';
          this.btnTierModeAll?.classList.add('active');
          this.btnTierModeBody?.classList.remove('active');
          this.btnTierModeBorder?.classList.remove('active');
          refreshTierSliders();
        });
      }

      if (this.btnTierModeBody) {
        this.btnTierModeBody.addEventListener('click', (e) => {
          e.stopPropagation();
          this.activeTierOpacityMode = 'body';
          this.btnTierModeBody?.classList.add('active');
          this.btnTierModeAll?.classList.remove('active');
          this.btnTierModeBorder?.classList.remove('active');
          refreshTierSliders();
        });
      }

      if (this.btnTierModeBorder) {
        this.btnTierModeBorder.addEventListener('click', (e) => {
          e.stopPropagation();
          this.activeTierOpacityMode = 'border';
          this.btnTierModeBorder?.classList.add('active');
          this.btnTierModeAll?.classList.remove('active');
          this.btnTierModeBody?.classList.remove('active');
          refreshTierSliders();
        });
      }

      tierSliders.forEach((slider) => {
        ['click', 'pointerdown', 'mousedown'].forEach((evt) => {
          slider.addEventListener(evt, (e) => e.stopPropagation());
        });
        slider.addEventListener('input', () => {
          const tier = slider.getAttribute('data-tier');
          if (!tier) return;
          const val = slider.value;
          const valNum = parseFloat(val);
          const valEl = document.getElementById(`val-tier-${tier}`);
          if (valEl) {
            valEl.textContent = `${val}%`;
          }
          const pct = valNum / 100;
          if (this.activeTierOpacityMode === 'all') {
            this.tierMasterValues[tier] = valNum;
            this.tierBodyValues[tier] = valNum;
            this.tierBorderValues[tier] = valNum;
            this.callbacks.onPetekTierOpacityChange?.(tier, pct);
            this.callbacks.onPetekTierBorderOpacityChange?.(tier, pct);
          } else if (this.activeTierOpacityMode === 'border') {
            this.tierBorderValues[tier] = valNum;
            this.callbacks.onPetekTierBorderOpacityChange?.(tier, pct);
          } else {
            this.tierBodyValues[tier] = valNum;
            this.callbacks.onPetekTierOpacityChange?.(tier, pct);
          }
        });
      });
    }



    // Clear Archive Button
    if (this.btnClearArchive) {
      this.btnClearArchive.addEventListener('click', (e) => {
        e.stopPropagation();
        const confirmed = confirm('Tüm yerel kayıtlı ve önbellekteki şimşek arşivi tamamen silinecek. Emin misiniz?');
        if (confirmed) {
          this.clearLiveStrikeFeed();
          this.callbacks.onClearArchive?.();
        }
      });
    }

    if (this.btnHierarchyMega) {
      this.btnHierarchyMega.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = !this.dropdownMega?.classList.contains('hidden');
        if (isOpen) {
          closeMegaDropdown();
        } else {
          closePeteksDropdown();
          this.dropdownMega?.classList.remove('hidden');
          this.btnHierarchyMega?.classList.add('active');
        }
      });
    }

    if (this.dropdownMega) {
      const tabBtns = this.dropdownMega.querySelectorAll<HTMLButtonElement>('.dropdown-tab-btn');
      tabBtns.forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const targetTab = btn.getAttribute('data-tab');
          tabBtns.forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');

          const paneContinents = document.getElementById('tab-pane-continents');
          const paneCorridors = document.getElementById('tab-pane-corridors');
          const paneSearch = document.getElementById('tab-pane-search');

          paneContinents?.classList.toggle('hidden', targetTab !== 'continents');
          paneCorridors?.classList.toggle('hidden', targetTab !== 'corridors');
          paneSearch?.classList.toggle('hidden', targetTab !== 'search');

          if (targetTab === 'search') {
            this.inputCountrySearch?.focus();
          }
        });
      });

      this.dropdownMega.querySelectorAll('.dropdown-item').forEach((item) => {
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          const lat = parseFloat(item.getAttribute('data-lat') || '0');
          const lon = parseFloat(item.getAttribute('data-lon') || '0');
          const dist = parseFloat(item.getAttribute('data-dist') || '270');
          const name = item.textContent?.trim() || 'Bölge';
          closeMegaDropdown();
          if (dist >= 320) {
            this.callbacks.onClassFilterChange?.('ALL');
          }
          this.callbacks.onLocationSelect?.(lat, lon, dist, name);
        });
      });
    }

    if (this.inputCountrySearch) {
      this.inputCountrySearch.addEventListener('input', () => {
        this.filterAndRenderCountries(this.inputCountrySearch?.value || '');
      });
      this.inputCountrySearch.addEventListener('click', (e) => e.stopPropagation());
    }

    this.headerLiveFeed?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.panelLiveFeed?.classList.toggle('collapsed');
    });

    this.headerCameraQueue?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.panelCameraQueue?.classList.toggle('collapsed');
    });

    this.headerStorms?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.panelStorms?.classList.toggle('collapsed');
    });

    this.headerLeaderboard?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.panelLeaderboard?.classList.toggle('collapsed');
    });

    this.headerAnalytics?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.panelAnalytics?.classList.toggle('collapsed');
    });

    this.btnMusicToggle?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.musicPopupCard?.classList.toggle('hidden');
      this.sfxPopupCard?.classList.add('hidden');
    });

    this.btnCloseMusic?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.musicPopupCard?.classList.add('hidden');
    });

    this.musicPopupCard?.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    this.btnCloseSfx?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.sfxPopupCard?.classList.add('hidden');
    });

    this.sfxPopupCard?.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    document.addEventListener('click', () => {
      closeMegaDropdown();
      closePeteksDropdown();
      closeCameraDropdown();
      closeDroneDropdown();
      if (this.musicPopupCard && !this.musicPopupCard.classList.contains('hidden')) {
        this.musicPopupCard.classList.add('hidden');
      }
      if (this.sfxPopupCard && !this.sfxPopupCard.classList.contains('hidden')) {
        this.sfxPopupCard.classList.add('hidden');
      }
    });

    // View Mode Toggle
    if (this.btnViewMode) {
      this.btnViewMode.addEventListener('click', (e) => {
        e.stopPropagation();
        const nextMode: ViewMode = this.state.viewMode === 'AUTO' ? 'MANUAL' : 'AUTO';
        this.setViewMode(nextMode);
      });
    }

    // Class Filter Buttons
    for (const [filter, btn] of this.filterButtons.entries()) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setClassFilter(filter);
      });
    }

    // Drawer / Panel Storms Toggle Button
    if (this.btnToggleDrawer) {
      this.btnToggleDrawer.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleStormDrawer();
      });
    }

    // Drawer Close Button
    const btnCloseDrawer = document.getElementById('btn-close-drawer');
    if (btnCloseDrawer) {
      btnCloseDrawer.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setStormDrawerOpen(false);
      });
    }

    // Audio Toggle Button & SFX Console Popup (Phase 14 & Procedural Sound Console)
    if (this.btnAudio) {
      this.btnAudio.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.state.isAudioMuted) {
          this.setAudioMuted(false);
          this.sfxPopupCard?.classList.remove('hidden');
          this.musicPopupCard?.classList.add('hidden');
        } else {
          this.sfxPopupCard?.classList.toggle('hidden');
          this.musicPopupCard?.classList.add('hidden');
        }
      });
    }

    // Feed Mode Toggle (FAZ 2)
    if (this.btnFeedMode) {
      this.btnFeedMode.addEventListener('click', (e) => {
        e.stopPropagation();
        let nextMode: import('../types/provider').MultiSourceMode = 'ALL_HYBRID';
        if (this.state.multiSourceMode === 'ALL_HYBRID') {
          nextMode = 'BLITZORTUNG_ONLY';
        } else if (this.state.multiSourceMode === 'BLITZORTUNG_ONLY') {
          nextMode = 'GOES16_ONLY';
        } else {
          nextMode = 'ALL_HYBRID';
        }
        this.setFeedMode(nextMode);
      });
    }

    // Convective Atmosphere Layer Toggle (FAZ 2)
    if (this.btnAtmosphere) {
      this.btnAtmosphere.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setAtmosphereEnabled(!this.state.isAtmosphereEnabled);
      });
    }

    // Reduced Motion Toggle Button
    if (this.btnReducedMotion) {
      this.btnReducedMotion.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setReducedMotion(!this.state.reducedMotion);
      });
    }

    // Scenario Selector Dropdown
    if (this.scenarioSelector) {
      this.scenarioSelector.addEventListener('change', (e) => {
        e.stopPropagation();
        const selectedId = this.scenarioSelector?.value as DemoScenarioId;
        if (selectedId) {
          this.callbacks.onScenarioChange?.(selectedId);
        }
      });
    }

    // 24H Trails Toggle Button (Phase 18)
    if (this.btnTrails) {
      this.btnTrails.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setTrailsEnabled(!this.state.isTrailsEnabled);
      });
    }

    // 3D Country Elevation Toggle Button (Phase 23)
    if (this.btnToggleElevation) {
      this.btnToggleElevation.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setElevationEnabled(!this.state.isElevationEnabled);
      });
    }

    // Leaderboard Toggle Button (Phase 21)
    if (this.btnLeaderboard) {
      this.btnLeaderboard.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleLeaderboard();
      });
    }

    // Leaderboard Close Button
    if (this.btnCloseLeaderboard) {
      this.btnCloseLeaderboard.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setLeaderboardOpen(false);
      });
    }

    // Leaderboard Period Tabs
    for (const [period, btn] of this.periodButtons.entries()) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setLeaderboardPeriod(period);
      });
    }

    if (this.leaderboardDrawer) {
      this.leaderboardDrawer.addEventListener('pointerdown', isolate);
      this.leaderboardDrawer.addEventListener('mousedown', isolate);
      this.leaderboardDrawer.addEventListener('click', isolate);
    }

    // Strike Detail Card Close & Action Listeners (Phase 17)
    if (this.strikeCard) {
      this.strikeCard.addEventListener('pointerdown', isolate);
      this.strikeCard.addEventListener('mousedown', isolate);
      this.strikeCard.addEventListener('click', isolate);
    }

    if (this.btnCloseStrikeCard) {
      this.btnCloseStrikeCard.addEventListener('click', (e) => {
        e.stopPropagation();
        this.hideStrikeDetail();
      });
    }

    if (this.btnFlyToStrike) {
      this.btnFlyToStrike.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.currentSelectedStrike) {
          this.callbacks.onFlyToStrike?.(this.currentSelectedStrike.lat, this.currentSelectedStrike.lon);
        }
      });
    }
  }

  public setAudioMuted(muted: boolean): void {
    if (this.state.isAudioMuted === muted) return;
    this.state.isAudioMuted = muted;
    this.renderState();
    this.callbacks.onAudioToggle?.(muted);
  }

  public setSelectedScenario(id: DemoScenarioId): void {
    if (this.scenarioSelector) {
      this.scenarioSelector.value = id;
    }
  }

  public setDataSourceMode(mode: DataSourceMode, notify: boolean = true): void {
    if (this.state.dataSourceMode === mode) return;
    this.state.dataSourceMode = mode;
    this.renderState();
    if (notify) {
      this.callbacks.onDataSourceChange?.(mode);
    }
  }

  public setViewMode(mode: ViewMode): void {
    if (this.state.viewMode === mode) return;
    this.state.viewMode = mode;
    this.renderState();
    this.callbacks.onViewModeChange?.(mode);
  }

  public setClassFilter(filter: ClassFilter): void {
    if (this.state.classFilter === filter) return;
    this.state.classFilter = filter;
    this.renderState();
    this.callbacks.onClassFilterChange?.(filter);
  }

  public setReducedMotion(enabled: boolean): void {
    if (this.state.reducedMotion === enabled) return;
    this.state.reducedMotion = enabled;
    this.renderState();
    this.callbacks.onReducedMotionChange?.(enabled);
  }

  public toggleStormDrawer(): void {
    if (this.panelStorms) {
      const isCollapsed = this.panelStorms.classList.contains('collapsed');
      this.setStormDrawerOpen(isCollapsed);
    } else {
      this.setStormDrawerOpen(!this.state.isStormListOpen);
    }
  }

  public setStormDrawerOpen(open: boolean): void {
    this.state.isStormListOpen = open;
    if (this.panelStorms) {
      if (open) {
        this.panelStorms.classList.remove('collapsed');
        this.panelStorms.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        this.renderStormCards(true); // Force card refresh upon opening
      } else {
        this.panelStorms.classList.add('collapsed');
      }
    }
    if (this.stormDrawer) {
      if (open) {
        this.stormDrawer.classList.add('open');
        this.renderStormCards(true);
      } else {
        this.stormDrawer.classList.remove('open');
      }
    }
    if (this.btnToggleDrawer) {
      this.btnToggleDrawer.classList.toggle('active', open);
    }
  }

  public toggleLeaderboard(): void {
    if (this.panelLeaderboard) {
      const isCollapsed = this.panelLeaderboard.classList.contains('collapsed');
      this.setLeaderboardOpen(isCollapsed);
    } else {
      this.setLeaderboardOpen(!this.state.isLeaderboardOpen);
    }
  }

  public setLeaderboardOpen(open: boolean): void {
    this.state.isLeaderboardOpen = open;
    if (this.panelLeaderboard) {
      if (open) {
        this.panelLeaderboard.classList.remove('collapsed');
        this.panelLeaderboard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        this.renderLeaderboardRows(true);
      } else {
        this.panelLeaderboard.classList.add('collapsed');
      }
    }
    if (this.leaderboardDrawer) {
      if (open) {
        this.leaderboardDrawer.classList.add('open');
        this.renderLeaderboardRows(true);
      } else {
        this.leaderboardDrawer.classList.remove('open');
      }
    }
    if (this.btnLeaderboard) {
      this.btnLeaderboard.classList.toggle('active', open);
    }
  }

  public setLeaderboardPeriod(period: LeaderboardPeriod, smooth: boolean = false): void {
    if (this.state.leaderboardPeriod === period) return;

    if (smooth && this.leaderboardListContainer) {
      this.leaderboardListContainer.classList.add('transitioning');
      setTimeout(() => {
        this.state.leaderboardPeriod = period;
        for (const [p, btn] of this.periodButtons.entries()) {
          btn.classList.toggle('active', p === period);
        }
        this.renderLeaderboardRows(true);
        setTimeout(() => {
          this.leaderboardListContainer?.classList.remove('transitioning');
        }, 40);
      }, 180);
      return;
    }

    this.state.leaderboardPeriod = period;
    for (const [p, btn] of this.periodButtons.entries()) {
      btn.classList.toggle('active', p === period);
    }
    this.renderLeaderboardRows(true);
  }

  /**
   * Starts the 5-minute Leaderboard Auto-Cycle:
   * - Every 5 minutes (300s): Panel opens as accordion and shows "GÜN"
   * - At 61st second: Smoothly transitions to "HAFTA" tab
   * - At 130th second: Panel smoothly closes (accordion collapse)
   */
  public startLeaderboardAutoCycle(): void {
    const triggerCycle = () => {
      // Clear any pending sub-timers
      this.leaderboardAutoCycleTimeouts.forEach((t) => clearTimeout(t));
      this.leaderboardAutoCycleTimeouts = [];

      // t = 0: Open panel, display "GÜN"
      this.setLeaderboardOpen(true);
      this.setLeaderboardPeriod('day');

      // t = 61s: Smooth transition to "HAFTA"
      const tWeek = setTimeout(() => {
        this.setLeaderboardPeriod('week', true);
      }, 61000);
      this.leaderboardAutoCycleTimeouts.push(tWeek);

      // t = 130s: Accordion collapse / close
      const tClose = setTimeout(() => {
        this.setLeaderboardOpen(false);
      }, 130000);
      this.leaderboardAutoCycleTimeouts.push(tClose);
    };

    // Run every 5 minutes (300,000 ms)
    this.leaderboardAutoCycleInterval = setInterval(triggerCycle, 300000);
  }

  public stopLeaderboardAutoCycle(): void {
    if (this.leaderboardAutoCycleInterval) {
      clearInterval(this.leaderboardAutoCycleInterval);
      this.leaderboardAutoCycleInterval = null;
    }
    this.leaderboardAutoCycleTimeouts.forEach((t) => clearTimeout(t));
    this.leaderboardAutoCycleTimeouts = [];
  }

  public getLeaderboardPeriod(): LeaderboardPeriod {
    return this.state.leaderboardPeriod;
  }

  public isLeaderboardOpen(): boolean {
    return this.state.isLeaderboardOpen;
  }

  public updateLeaderboard(rankings: CountryRankItem[], totalCount: number): void {
    this.currentLeaderboardItems = rankings;

    if (this.leaderboardTotalCount) {
      this.leaderboardTotalCount.textContent = totalCount.toLocaleString();
    }

    const signature = `${this.state.leaderboardPeriod}:${totalCount}:${rankings.slice(0, 10).map((r) => `${r.iso}:${r.count}`).join('|')}`;
    if (signature === this.lastLeaderboardSignature) {
      return;
    }
    this.lastLeaderboardSignature = signature;

    if (this.state.isLeaderboardOpen || (this.panelLeaderboard && !this.panelLeaderboard.classList.contains('collapsed'))) {
      this.renderLeaderboardRows(false);
    }
  }

  private renderLeaderboardRows(_force: boolean): void {
    if (!this.leaderboardListContainer) return;

    if (this.currentLeaderboardItems.length === 0) {
      this.leaderboardListContainer.innerHTML = '<div class="empty-drawer-msg">Bu dönemde henüz yıldırım kaydedilmedi.</div>';
      return;
    }

    this.leaderboardListContainer.innerHTML = '';
    for (const item of this.currentLeaderboardItems) {
      const row = document.createElement('div');
      row.className = 'leaderboard-row';
      row.setAttribute('data-iso', item.iso);

      const rankClass = item.rank <= 3 ? ` rank-${item.rank}` : '';

      row.innerHTML = `
        <div class="rank-pill${rankClass}">#${item.rank}</div>
        <span class="country-flag">${item.flag}</span>
        <div class="country-details">
          <span class="country-name">${item.country}</span>
          <span class="country-share">${item.percentage.toFixed(1)}% global share</span>
        </div>
        <div class="country-stats">
          <span class="strike-count">${item.count.toLocaleString()}</span>
          <span class="strike-pct">strikes</span>
        </div>
      `;

      row.addEventListener('click', (e) => {
        e.stopPropagation();
        this.callbacks.onSelectCountry?.(item.lat, item.lon);
      });

      this.leaderboardListContainer.appendChild(row);
    }
  }

  /**
   * Updates the storm list from the engine 4Hz loop with dirty checking (diffing).
   */
  public updateStormList(clusters: ScoredCluster[]): void {
    this.currentClusters = clusters;

    // Update count on drawer toggle button and accordion badge
    if (this.btnToggleDrawer) {
      const badge = this.btnToggleDrawer.querySelector('.drawer-badge');
      if (badge) {
        badge.textContent = clusters.length.toString();
      }
    }
    if (this.stormsCountBadge) {
      this.stormsCountBadge.textContent = clusters.length.toString();
    }

    // Compute shallow state signature for diffing
    const signature = clusters.map((c) => `${c.id}:${c.activityScore.toFixed(2)}:${c.eventCount}`).join('|');

    if (signature === this.lastRenderedSignature) {
      return; // Zero DOM work if nothing changed
    }

    this.lastRenderedSignature = signature;

    // Render cards if drawer or right-sidebar storm panel is open
    if (this.state.isStormListOpen || (this.panelStorms && !this.panelStorms.classList.contains('collapsed'))) {
      this.renderStormCards(false);
    }
  }

  private renderStormCards(_force: boolean): void {
    if (!this.stormListContainer) return;

    if (this.currentClusters.length === 0) {
      this.stormListContainer.innerHTML = '<div class="empty-drawer-msg">No active storm cells detected.</div>';
      return;
    }

    // Build card elements efficiently
    const fragment = document.createDocumentFragment();

    for (const cluster of this.currentClusters) {
      const card = document.createElement('div');
      card.className = `storm-card class-${cluster.presentationClass.toLowerCase()}`;
      card.setAttribute('data-cluster-id', cluster.id);

      const latDir = cluster.centroid.latitude >= 0 ? 'N' : 'S';
      const lonDir = cluster.centroid.longitude >= 0 ? 'E' : 'W';
      const latStr = `${Math.abs(cluster.centroid.latitude).toFixed(1)}°${latDir}`;
      const lonStr = `${Math.abs(cluster.centroid.longitude).toFixed(1)}°${lonDir}`;

      card.innerHTML = `
        <div class="card-header">
          <span class="card-badge badge-${cluster.presentationClass.toLowerCase()}">${cluster.presentationClass}</span>
          <span class="card-score">★ ${cluster.activityScore.toFixed(2)}</span>
        </div>
        <div class="card-body">
          <div class="card-coords">${latStr}, ${lonStr}</div>
          <div class="card-stats">
            <span class="stat-item">⚡ ${cluster.eventCount} strikes</span>
            <span class="stat-item">⏱ ${Math.round(cluster.strikesPerMinute)} /min</span>
          </div>
        </div>
      `;

      card.addEventListener('click', (e) => {
        e.stopPropagation();
        this.callbacks.onSelectCluster?.(cluster);
      });

      fragment.appendChild(card);
    }

    this.stormListContainer.replaceChildren(fragment);
  }

  private renderState(): void {
    // 0. Data Source Button (Phase 13)
    if (this.btnDataSource) {
      if (this.state.dataSourceMode === 'LIVE') {
        this.btnDataSource.innerHTML = '<span class="live-pulse"></span> 📡 CANLI YAYIN';
        this.btnDataSource.classList.remove('source-sim');
        this.btnDataSource.classList.add('source-live');
      } else {
        this.btnDataSource.innerHTML = '⚡ SİMÜLASYON';
        this.btnDataSource.classList.remove('source-live', 'source-fallback');
        this.btnDataSource.classList.add('source-sim');
      }
    }

    // 1. View Mode Button
    if (this.btnViewMode) {
      const isAuto = this.state.viewMode === 'AUTO';
      this.btnViewMode.textContent = isAuto ? '🤖 AUTO' : '🖐️ MANUAL';
      this.btnViewMode.title = isAuto
        ? 'Camera Mode: Automatic Director (Click to switch to Manual Exploration)'
        : 'Camera Mode: Manual Free Exploration (Click to switch to Automatic Director)';
      this.btnViewMode.classList.toggle('mode-auto', isAuto);
      this.btnViewMode.classList.toggle('mode-manual', !isAuto);
    }

    // 2. Class Filter Buttons
    for (const [filter, btn] of this.filterButtons.entries()) {
      btn.classList.toggle('active', this.state.classFilter === filter);
    }

    // 3. Reduced Motion Button
    if (this.btnReducedMotion) {
      this.btnReducedMotion.textContent = this.state.reducedMotion ? 'MOTION: REDUCED' : 'MOTION: NORMAL';
      this.btnReducedMotion.classList.toggle('active', this.state.reducedMotion);
    }

    // 4. Audio Button (Phase 14)
    if (this.btnAudio) {
      this.btnAudio.textContent = this.state.isAudioMuted ? '🔇 Sound' : '🔊 Sound';
      this.btnAudio.classList.toggle('active', !this.state.isAudioMuted);
    }

    // 5. 24H Trails Button (Phase 18)
    if (this.btnTrails) {
      this.btnTrails.textContent = '⏳ 24H Trails';
      this.btnTrails.classList.toggle('active', this.state.isTrailsEnabled);
    }

    // 6. 3D Elevation Button (Phase 23)
    if (this.btnToggleElevation) {
      this.btnToggleElevation.textContent = '🌍 3D';
      this.btnToggleElevation.classList.toggle('active', this.state.isElevationEnabled);
    }

    // 7. Feed Mode Switcher Button (FAZ 2)
    if (this.btnFeedMode) {
      if (this.state.multiSourceMode === 'ALL_HYBRID') {
        this.btnFeedMode.textContent = '📡 Hybrid';
      } else if (this.state.multiSourceMode === 'BLITZORTUNG_ONLY') {
        this.btnFeedMode.textContent = '⚡ Blitz (RF)';
      } else {
        this.btnFeedMode.textContent = '🛰️ GOES (Satellite)';
      }
      this.btnFeedMode.classList.add('active');
    }

    // 8. Atmosphere Convective Layer Button (FAZ 2)
    if (this.btnAtmosphere) {
      this.btnAtmosphere.textContent = '🌌 Atmosphere';
      this.btnAtmosphere.classList.toggle('active', this.state.isAtmosphereEnabled);
    }
  }

  public setFeedMode(mode: import('../types/provider').MultiSourceMode): void {
    if (this.state.multiSourceMode === mode) return;
    this.state.multiSourceMode = mode;
    this.renderState();
    this.callbacks.onFeedModeChange?.(mode);
  }

  public setAtmosphereEnabled(enabled: boolean): void {
    if (this.state.isAtmosphereEnabled === enabled) return;
    this.state.isAtmosphereEnabled = enabled;
    this.renderState();
    this.callbacks.onAtmosphereToggle?.(enabled);
  }

  public setTrailsEnabled(enabled: boolean): void {
    if (this.state.isTrailsEnabled === enabled) return;
    this.state.isTrailsEnabled = enabled;
    this.renderState();
    this.callbacks.onTrailsToggle?.(enabled);
  }

  public setElevationEnabled(enabled: boolean): void {
    if (this.state.isElevationEnabled === enabled) return;
    this.state.isElevationEnabled = enabled;
    this.renderState();
    this.callbacks.onToggleElevation?.(enabled);
  }

  /**
   * Displays the interactive Strike Detail Card HUD (Phase 17)
   */
  public showStrikeDetail(info: DetailedStrikeInfo): void {
    this.currentSelectedStrike = { lat: info.latitude, lon: info.longitude };
    this.currentSelectedIso = info.iso;

    if (this.strikeFlag) this.strikeFlag.textContent = info.flag;
    if (this.strikeCountry) this.strikeCountry.textContent = info.country;
    if (this.strikeCity) this.strikeCity.textContent = info.city || info.region || 'Bölgesel Koordinatlar';

    const latDir = info.latitude >= 0 ? 'K' : 'G';
    const lonDir = info.longitude >= 0 ? 'D' : 'B';
    if (this.strikeCoords) {
      this.strikeCoords.textContent = `${Math.abs(info.latitude).toFixed(4)}° ${latDir}, ${Math.abs(info.longitude).toFixed(4)}° ${lonDir}`;
    }

    const d = new Date(info.timestamp);
    if (this.strikeTimeUtc) {
      this.strikeTimeUtc.textContent = d.toISOString().replace('T', ' ').replace('Z', ' UTC');
    }
    if (this.strikeTimeLocal) {
      this.strikeTimeLocal.textContent = d.toLocaleTimeString();
    }

    const sign = info.peakCurrent >= 0 ? '+' : '';
    if (this.strikeCurrent) {
      this.strikeCurrent.textContent = `⚡ ${sign}${info.peakCurrent.toFixed(1)} kA`;
    }
    if (this.strikePolarity) {
      const polarity = info.peakCurrent >= 0 ? '+ Pozitif' : '- Negatif';
      this.strikePolarity.textContent = `${polarity} (${info.type})`;
    }

    if (this.strikeTodayCount) {
      const count = info.todayCountryStrikes ?? 0;
      this.strikeTodayCount.textContent = `⚡ ${count.toLocaleString()} Günlük`;
    }

    if (this.strikeClassBadge) {
      const absKa = Math.abs(info.peakCurrent);
      this.strikeClassBadge.className = 'strike-badge';
      if (absKa >= 150) {
        this.strikeClassBadge.classList.add('badge-superbolt');
        this.strikeClassBadge.textContent = '🔥 SÜPER BOLT';
      } else if (absKa >= 75) {
        this.strikeClassBadge.classList.add('badge-violent');
        this.strikeClassBadge.textContent = '⚡ ŞİDDETLİ';
      } else if (absKa >= 35) {
        this.strikeClassBadge.classList.add('badge-severe');
        this.strikeClassBadge.textContent = '⚡ AĞIR';
      } else if (absKa >= 10) {
        this.strikeClassBadge.classList.add('badge-standard');
        this.strikeClassBadge.textContent = '⚡ STANDART';
      } else {
        this.strikeClassBadge.classList.add('badge-minor');
        this.strikeClassBadge.textContent = '⚡ KÜÇÜK';
      }
    }

    // Data Source Indicator (Global 7-Stream)
    if (this.strikeSourceVal) {
      if (info.source === 'goes19_glm' || info.source === 'goes16_glm') {
        this.strikeSourceVal.textContent = '🛰️ GOES-19 (D.AMERİKA/ATLANTİK)';
        this.strikeSourceVal.className = 'card-stat-val text-neon-purple';
      } else if (info.source === 'goes18_glm') {
        this.strikeSourceVal.textContent = '🛰️ GOES-18 (PASİFİK/BATI)';
        this.strikeSourceVal.className = 'card-stat-val text-neon-purple';
      } else if (info.source === 'mtg_li') {
        this.strikeSourceVal.textContent = '🛰️ MTG-I1 (AFRİKA/AVRUPA)';
        this.strikeSourceVal.className = 'card-stat-val text-neon-purple';
      } else if (info.source === 'singapore_nea') {
        this.strikeSourceVal.textContent = '⚡ NEA (SİNGAPUR)';
        this.strikeSourceVal.className = 'card-stat-val text-neon-blue';
      } else if (info.source === 'japan_jma') {
        this.strikeSourceVal.textContent = '⚡ JMA (JAPONYA/DOĞU ASYA)';
        this.strikeSourceVal.className = 'card-stat-val text-neon-blue';
      } else if (info.source === 'finland_fmi') {
        this.strikeSourceVal.textContent = '⚡ FMI (ARKTİK/KUTUP)';
        this.strikeSourceVal.className = 'card-stat-val text-neon-blue';
      } else if (info.source === 'hybrid') {
        this.strikeSourceVal.textContent = '📡 HİBRİT (RF + OPTİK)';
        this.strikeSourceVal.className = 'card-stat-val text-neon-blue';
      } else if (info.source === 'blitzortung') {
        this.strikeSourceVal.textContent = '⚡ BLITZORTUNG (RF)';
        this.strikeSourceVal.className = 'card-stat-val text-neon-blue';
      } else {
        this.strikeSourceVal.textContent = '⚡ CANLI YAYIN';
        this.strikeSourceVal.className = 'card-stat-val text-neon-blue';
      }
    }

    // Optical Satellite Energy & Footprint Area (FAZ 2)
    if (this.rowOpticalEnergy && this.strikeOpticalVal) {
      if (info.opticalEnergy !== undefined && info.opticalEnergy > 0) {
        this.rowOpticalEnergy.classList.remove('hidden');
        const areaStr = info.opticalArea ? ` (${info.opticalArea} km²)` : '';
        const formattedEnergy = info.opticalEnergy < 1e-6
          ? `${(info.opticalEnergy * 1e12).toFixed(1)} pJ`
          : `${info.opticalEnergy.toExponential(2)} J`;
        this.strikeOpticalVal.textContent = `🛰️ ${formattedEnergy}${areaStr}`;
      } else {
        this.rowOpticalEnergy.classList.add('hidden');
      }
    }

    if (this.strikeCard) {
      this.strikeCard.classList.remove('hidden');
    }
  }

  /**
   * Displays rich storm cell telemetry when a floating holographic honeycomb is clicked.
   */
  public showStormCellDetail(telemetry: StormCellTelemetry): void {
    this.currentSelectedStrike = { lat: telemetry.latitude, lon: telemetry.longitude };
    this.currentSelectedIso = null;

    if (this.strikeFlag) this.strikeFlag.textContent = '⛈️';
    if (this.strikeCountry) this.strikeCountry.textContent = `Fırtına Hücresi #${telemetry.id.slice(0, 6)}`;
    if (this.strikeCity) {
      this.strikeCity.textContent = `Yarıçap: ${telemetry.radiusKm.toFixed(0)} km | Sürüklenme: ${telemetry.driftHeading} ${telemetry.driftSpeedKmH} km/h`;
    }

    const latDir = telemetry.latitude >= 0 ? 'N' : 'S';
    const lonDir = telemetry.longitude >= 0 ? 'E' : 'W';
    if (this.strikeCoords) {
      this.strikeCoords.textContent = `${Math.abs(telemetry.latitude).toFixed(3)}° ${latDir}, ${Math.abs(telemetry.longitude).toFixed(3)}° ${lonDir}`;
    }

    const d = new Date();
    if (this.strikeTimeUtc) {
      this.strikeTimeUtc.textContent = d.toISOString().replace('T', ' ').replace('Z', ' UTC');
    }
    if (this.strikeTimeLocal) {
      this.strikeTimeLocal.textContent = d.toLocaleTimeString();
    }

    if (this.strikeCurrent) {
      this.strikeCurrent.textContent = `⚡ ${telemetry.totalPowerGW.toFixed(2)} GW`;
    }
    if (this.strikePolarity) {
      this.strikePolarity.textContent = `Storm Warning Level: ${telemetry.warningLevel}`;
    }

    if (this.strikeTodayCount) {
      this.strikeTodayCount.textContent = `⚡ ${telemetry.strikeCount} Active Strikes`;
    }

    if (this.strikeClassBadge) {
      this.strikeClassBadge.className = 'strike-badge';
      if (telemetry.warningLevel === 'CRITICAL') {
        this.strikeClassBadge.classList.add('badge-superbolt');
        this.strikeClassBadge.textContent = '🔥 CRITICAL';
      } else if (telemetry.warningLevel === 'ELEVATED') {
        this.strikeClassBadge.classList.add('badge-severe');
        this.strikeClassBadge.textContent = '⚡ ELEVATED';
      } else {
        this.strikeClassBadge.classList.add('badge-standard');
        this.strikeClassBadge.textContent = '⚡ ACTIVE';
      }
    }

    if (this.strikeCard) {
      this.strikeCard.classList.remove('hidden');
    }
  }

  /**
   * Real-time telemetry update: live increments today's strike count if the active card matches this country
   */
  public updateCountryStrikeTelemetry(iso: string, todayCount: number): void {
    if (this.currentSelectedIso === iso && this.strikeTodayCount) {
      this.strikeTodayCount.textContent = `⚡ ${todayCount.toLocaleString()}`;
    }
  }

  public getSelectedCountryIso(): string | null {
    return this.currentSelectedIso;
  }

  /**
   * Updates locality details (city, street, region) once async reverse geocode finishes
   */
  public updateStrikeLocality(city?: string, region?: string, street?: string): void {
    if (this.strikeCity) {
      const parts = [street, city, region].filter(Boolean);
      this.strikeCity.textContent = parts.length > 0 ? parts.join(', ') : 'Open Terrain / Waters';
    }
  }

  public hideStrikeDetail(): void {
    this.currentSelectedStrike = null;
    this.currentSelectedIso = null;
    if (this.strikeCard) {
      this.strikeCard.classList.add('hidden');
    }
  }

  /**
   * Populates searchable country list from GeoEnricher.
   */
  public populateCountries(countries: Array<{ name: string; iso: string; flag: string; centroid: { lat: number; lon: number } }>): void {
    this.allCountries = countries;
    this.filterAndRenderCountries('');
  }

  private filterAndRenderCountries(query: string): void {
    if (!this.countrySearchList) return;
    const q = query.trim().toLowerCase();
    const filtered = q ? this.allCountries.filter(c => c.name.toLowerCase().includes(q) || c.iso.toLowerCase().includes(q)) : this.allCountries;

    this.countrySearchList.innerHTML = '';
    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'dropdown-item';
      empty.style.color = '#64748b';
      empty.textContent = 'No matching country found';
      this.countrySearchList.appendChild(empty);
      return;
    }

    const maxShown = Math.min(filtered.length, 60);
    for (let i = 0; i < maxShown; i++) {
      const c = filtered[i];
      const item = document.createElement('div');
      item.className = 'dropdown-item';
      item.innerHTML = `<span style="font-size: 14px;">${c.flag}</span> <span>${c.name}</span>`;
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        this.dropdownMega?.classList.add('hidden');
        this.btnHierarchyMega?.classList.remove('active');
        this.callbacks.onLocationSelect?.(c.centroid.lat, c.centroid.lon, 170, c.name);
      });
      this.countrySearchList.appendChild(item);
    }
  }

  public showCountryTooltip(flag: string, name: string, x: number, y: number): void {
    if (!this.countryHoverTooltip) return;
    if (this.tooltipFlag) this.tooltipFlag.textContent = flag;
    if (this.tooltipName) this.tooltipName.textContent = name;
    this.countryHoverTooltip.style.left = `${x}px`;
    this.countryHoverTooltip.style.top = `${y}px`;
    this.countryHoverTooltip.classList.remove('hidden');
  }

  public hideCountryTooltip(): void {
    if (!this.countryHoverTooltip) return;
    this.countryHoverTooltip.classList.add('hidden');
  }

  public getState(): Readonly<UIState> {
    return this.state;
  }

  public getCurrentCategoryFilter(): string {
    return this.currentCategoryFilter;
  }

  /**
   * Adds incoming strike to the live stream feed journal (Panel 1 in right sidebar).
   * Buffers incoming strikes and flushes at ~8 Hz using a DocumentFragment to eliminate layout thrashing.
   */
  public addLiveStrikeFeedItem(event: any, country?: string, flag?: string): void {
    if (!this.liveFeedScroll) return;

    this.pendingFeedItems.push({ event, country, flag });
    if (this.pendingFeedItems.length > 100) {
      this.pendingFeedItems.splice(0, this.pendingFeedItems.length - 100);
    }

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - this.lastFeedFlushTime >= 125) {
      this.flushPendingFeedItems();
    } else if (!this.feedFlushTimer) {
      this.feedFlushTimer = setTimeout(() => {
        this.feedFlushTimer = null;
        this.flushPendingFeedItems();
      }, Math.max(16, 125 - (now - this.lastFeedFlushTime)));
    }
  }

  private flushPendingFeedItems(): void {
    if (!this.liveFeedScroll || this.pendingFeedItems.length === 0) return;
    this.lastFeedFlushTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

    // Remove empty placeholder if present
    const emptyMsg = this.liveFeedScroll.querySelector('.empty-feed-msg');
    if (emptyMsg) {
      emptyMsg.remove();
    }

    const fragment = document.createDocumentFragment();
    const items = this.pendingFeedItems;
    this.pendingFeedItems = [];

    for (let i = 0; i < items.length; i++) {
      const { event, country, flag } = items[i];
      const d = new Date(event.timestamp);
      const timeStr = d.toTimeString().slice(0, 8);
      const kA = typeof event.peakCurrent === 'number' ? Math.round(Math.abs(event.peakCurrent)) : 25;
      const countryName = country || event.country || 'International / Open Waters';
      const flagIcon = flag || event.flag || '⚡';
      const typeLabel = event.type ?? 'CG';

      const srcTag =
        event.source === 'singapore_nea' ? 'NEA' :
        event.source === 'japan_jma' ? 'JMA' :
        event.source === 'finland_fmi' ? 'FMI' :
        event.source === 'goes19_glm' ? 'GOES19' :
        event.source === 'goes16_glm' ? 'GOES16' :
        event.source === 'goes18_glm' ? 'GOES18' :
        event.source === 'mtg_li' ? 'MTG' :
        event.source === 'blitzortung' ? 'BLITZ' : '';

      const srcBadge = srcTag ? `<span class="feed-source-badge" style="font-size: 8px; padding: 1px 3px; border-radius: 3px; background: rgba(56,189,248,0.15); color: #38bdf8; margin-left: 4px; font-weight: 600;">${srcTag}</span>` : '';

      const itemEl = document.createElement('div');
      itemEl.className = 'live-feed-item newly-arrived';
      itemEl.innerHTML = `
        <div class="feed-item-left">
          <span class="feed-flag">${flagIcon}</span>
          <span class="feed-country" title="${countryName}">${countryName}</span>
          ${srcBadge}
          <span class="feed-current">⚡ ${kA} kA</span>
        </div>
        <div class="feed-item-right">
          <span class="feed-time">${timeStr}</span>
          <span class="feed-type">${typeLabel}</span>
        </div>
      `;

      itemEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this.callbacks.onFlyToStrike?.(event.latitude, event.longitude);
      });

      // Insert at front of fragment so newest items appear at the top
      if (fragment.firstChild) {
        fragment.insertBefore(itemEl, fragment.firstChild);
      } else {
        fragment.appendChild(itemEl);
      }
      this.liveFeedItemsCount++;
    }

    this.liveFeedScroll.insertBefore(fragment, this.liveFeedScroll.firstChild);

    if (this.feedCountBadge && this.feedCountBadge.textContent !== this.liveFeedItemsCount.toString()) {
      this.feedCountBadge.textContent = this.liveFeedItemsCount.toString();
    }

    // Trim excess children in bulk if exceeding 100 items
    const excess = this.liveFeedScroll.children.length - 100;
    if (excess > 0) {
      for (let i = 0; i < excess; i++) {
        if (this.liveFeedScroll.lastChild) {
          this.liveFeedScroll.removeChild(this.liveFeedScroll.lastChild);
        }
      }
    }
  }

  public clearLiveStrikeFeed(): void {
    if (this.feedFlushTimer) {
      clearTimeout(this.feedFlushTimer);
      this.feedFlushTimer = null;
    }
    this.pendingFeedItems = [];
    if (!this.liveFeedScroll) return;
    this.liveFeedScroll.innerHTML = '<div class="empty-feed-msg">Feed cleared. Listening for new strikes...</div>';
    this.liveFeedItemsCount = 0;
    if (this.feedCountBadge) {
      this.feedCountBadge.textContent = '0';
    }
  }

  public updatePetekCategoryCounts(cells: any[]): void {
    const counts: Record<string, number> = {
      ALL: cells.length,
      ISOLATED: 0,
      SINGLE_CELL: 0,
      MULTICELL: 0,
      SUPERCELL: 0,
      MCS: 0,
      SQUALL_LINE: 0,
      EXTREME_OUTBREAK: 0
    };

    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const cls = cell.stormClass ?? 'ISOLATED';
      if (counts[cls] !== undefined) {
        counts[cls]++;
      }
    }

    const setBadge = (id: string, count: number) => {
      let el = this.petekBadgeElements.get(id);
      if (!el) {
        const found = document.getElementById(id);
        if (found) {
          el = found;
          this.petekBadgeElements.set(id, found);
        }
      }
      if (el) {
        const str = count.toString();
        if (el.textContent !== str) {
          el.textContent = str;
        }
      }
    };

    setBadge('count-cat-all', counts.ALL);
    setBadge('count-cat-isolated', counts.ISOLATED);
    setBadge('count-cat-single', counts.SINGLE_CELL);
    setBadge('count-cat-multicell', counts.MULTICELL);
    setBadge('count-cat-supercell', counts.SUPERCELL);
    setBadge('count-cat-mcs', counts.MCS);
    setBadge('count-cat-squall', counts.SQUALL_LINE);
    setBadge('count-cat-outbreak', counts.EXTREME_OUTBREAK);
  }

  /**
   * Synchronizes camera distance / altitude dynamically to drone menu badge and slider.
   * Throttled to 10 Hz (100ms) and dirty-checked to eliminate per-frame layout thrashing.
   */
  public updateCameraDistance(distance: number): void {
    const rounded = Math.round(distance);
    if (rounded === this.lastRenderedCamDist) return;

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - this.lastCameraDistanceUpdate < 100) return;
    this.lastCameraDistanceUpdate = now;
    this.lastRenderedCamDist = rounded;

    const roundedStr = rounded.toString();
    if (this.valDroneDist && this.valDroneDist.textContent !== roundedStr) {
      this.valDroneDist.textContent = roundedStr;
    }
    if (this.sliderDroneDist && document.activeElement !== this.sliderDroneDist && this.sliderDroneDist.value !== roundedStr) {
      this.sliderDroneDist.value = roundedStr;
    }
  }

  /**
   * Initializes the horizontal sliding Camera Modes Accordion Bar
   * and multi-dimensional filter matrix.
   */
  private setupCameraAccordionBar(): void {
    const megaToggleBtn = document.getElementById('btn-camera-main-toggle');
    const megaDropdown = document.getElementById('dropdown-camera-mega');

    const closeCameraMegaDropdown = () => {
      megaDropdown?.classList.add('hidden');
      megaToggleBtn?.classList.remove('active');
    };

    if (megaToggleBtn && megaDropdown) {
      megaToggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const willOpen = megaDropdown.classList.contains('hidden');
        if (willOpen) {
          // Close other popups
          this.dropdownPeteks?.classList.add('hidden');
          this.btnActivePeteks?.classList.remove('active');
          if (this.musicPopupCard) this.musicPopupCard.classList.add('hidden');
          megaDropdown.classList.remove('hidden');
          megaToggleBtn.classList.add('active');
        } else {
          closeCameraMegaDropdown();
        }
      });

      megaDropdown.addEventListener('pointerdown', (e) => e.stopPropagation());
      megaDropdown.addEventListener('mousedown', (e) => e.stopPropagation());
      megaDropdown.addEventListener('click', (e) => e.stopPropagation());

      window.addEventListener(
        'pointerdown',
        (e) => {
          const target = e.target as HTMLElement | null;
          if (!target?.closest('#dropdown-camera-mega') && !target?.closest('#btn-camera-main-toggle')) {
            closeCameraMegaDropdown();
          }
        },
        { capture: true }
      );
    }

    // 1. Camera Mode Options
    const modeOpts = document.querySelectorAll<HTMLElement>('#dropdown-camera-mega .cam-dropdown-option');
    const labelMode = document.getElementById('label-cam-mode');
    modeOpts.forEach((opt) => {
      opt.addEventListener('click', () => {
        const mode = opt.getAttribute('data-cam-mode') as 'AUTO' | 'MANUAL' | 'ORBIT';
        if (!mode) return;
        modeOpts.forEach((o) => o.classList.remove('active'));
        opt.classList.add('active');
        this.camFilterMatrix.cameraMode = mode;
        this.camFilterMatrix.autoFollow = mode === 'AUTO';
        if (labelMode) {
          labelMode.textContent = mode === 'AUTO' ? 'Mod: Oto' : (mode === 'MANUAL' ? 'Mod: Manuel' : 'Mod: Yörünge');
        }
        this.syncQuickModeButtonVisual();
        this.emitFilterMatrixChange();
      });
    });

    // 2. Pitch Presets & Range Sliders
    const pitchPresets = document.querySelectorAll<HTMLButtonElement>('#dropdown-camera-mega .pitch-preset-btn');
    const sliderPitch = document.getElementById('slider-cam-pitch') as HTMLInputElement | null;
    const valPitchSlider = document.getElementById('val-pitch-slider');
    const labelPitch = document.getElementById('label-cam-pitch');
    const sliderDist = document.getElementById('slider-cam-dist') as HTMLInputElement | null;
    const valDistSlider = document.getElementById('val-dist-slider');

    const safeRaf = typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame : (cb: FrameRequestCallback) => setTimeout(cb, 16);
    const safeCaf = typeof cancelAnimationFrame !== 'undefined' ? cancelAnimationFrame : (id: any) => clearTimeout(id);

    let sliderRafId: any = null;
    const scheduleSliderUpdate = () => {
      if (sliderRafId !== null) return;
      sliderRafId = safeRaf(() => {
        sliderRafId = null;
        this.emitFilterMatrixChange();
      });
    };

    pitchPresets.forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = parseInt(btn.getAttribute('data-pitch') || '25', 10);
        pitchPresets.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.camFilterMatrix.pitchDeg = p;
        if (sliderPitch) sliderPitch.value = p.toString();
        if (valPitchSlider) valPitchSlider.textContent = `${p}°`;
        if (labelPitch) labelPitch.textContent = `Bakış: ${p}°`;
        (this.camFilterMatrix as any).instant = true;
        if (sliderRafId !== null) {
          safeCaf(sliderRafId);
          sliderRafId = null;
        }
        this.emitFilterMatrixChange();
      });
    });

    if (sliderPitch) {
      sliderPitch.addEventListener('input', () => {
        const p = parseInt(sliderPitch.value, 10);
        this.camFilterMatrix.pitchDeg = p;
        if (valPitchSlider) valPitchSlider.textContent = `${p}°`;
        if (labelPitch) labelPitch.textContent = `Bakış: ${p}°`;
        pitchPresets.forEach((b) => {
          b.classList.toggle('active', parseInt(b.getAttribute('data-pitch') || '-1', 10) === p);
        });
        (this.camFilterMatrix as any).instant = true;
        scheduleSliderUpdate();
      });

      sliderPitch.addEventListener('change', () => {
        if (sliderRafId !== null) {
          safeCaf(sliderRafId);
          sliderRafId = null;
        }
        (this.camFilterMatrix as any).instant = true;
        this.emitFilterMatrixChange();
      });
    }

    if (sliderDist) {
      sliderDist.addEventListener('input', () => {
        const d = parseInt(sliderDist.value, 10);
        this.camFilterMatrix.manualDistance = d;
        if (valDistSlider) valDistSlider.textContent = `${d}u`;
        (this.camFilterMatrix as any).instant = true;
        scheduleSliderUpdate();
      });

      sliderDist.addEventListener('change', () => {
        if (sliderRafId !== null) {
          safeCaf(sliderRafId);
          sliderRafId = null;
        }
        delete (this.camFilterMatrix as any).instant;
        this.emitFilterMatrixChange();
      });
    }

    // 3. Shot Scale Options
    const scaleBtns = document.querySelectorAll<HTMLButtonElement>('#dropdown-camera-mega .cam-scale-btn');
    const labelScale = document.getElementById('label-cam-scale');
    scaleBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const scale = btn.getAttribute('data-scale') as ShotScale;
        if (!scale) return;
        scaleBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.camFilterMatrix.shotScale = scale;
        this.camFilterMatrix.manualDistance = SHOT_SCALE_DISTANCES[scale];
        if (sliderDist) sliderDist.value = SHOT_SCALE_DISTANCES[scale].toString();
        if (valDistSlider) valDistSlider.textContent = `${SHOT_SCALE_DISTANCES[scale]}u`;
        if (labelScale) {
          const names: Record<ShotScale, string> = {
            AUTO_DIVERSITY: 'Shot: Auto Diversity',
            VERY_CLOSE: 'Shot: Very Close',
            CLOSE: 'Shot: Close',
            COUNTRY: 'Shot: Country',
            REGIONAL: 'Shot: Regional',
            CONTINENTAL: 'Shot: Continental',
            ATMOSPHERIC: 'Shot: Atmospheric'
          };
          labelScale.textContent = names[scale];
        }
        this.emitFilterMatrixChange();
      });
    });

    // 4. Continents / Corridors / Search Tabs in Mega Dropdown
    const tabBtns = document.querySelectorAll<HTMLButtonElement>('#dropdown-camera-mega .dropdown-tab-btn');
    tabBtns.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const targetTab = btn.getAttribute('data-tab');
        tabBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');

        const paneContinents = document.getElementById('tab-pane-continents');
        const paneCorridors = document.getElementById('tab-pane-corridors');
        const paneSearch = document.getElementById('tab-pane-search');

        paneContinents?.classList.toggle('hidden', targetTab !== 'continents');
        paneCorridors?.classList.toggle('hidden', targetTab !== 'corridors');
        paneSearch?.classList.toggle('hidden', targetTab !== 'search');

        if (targetTab === 'search') {
          const searchInput = document.getElementById('country-search-input') as HTMLInputElement | null;
          searchInput?.focus();
        }
      });
    });

    // 5. Geo Location Items (Continents and Corridors)
    const geoItems = document.querySelectorAll<HTMLElement>('#dropdown-camera-mega .dropdown-item');
    geoItems.forEach((item) => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const lat = parseFloat(item.getAttribute('data-lat') || '0');
        const lon = parseFloat(item.getAttribute('data-lon') || '0');
        const dist = parseFloat(item.getAttribute('data-dist') || '270');
        const name = item.textContent?.trim() || 'Region';
        closeCameraMegaDropdown();
        if (dist >= 320) {
          this.callbacks.onClassFilterChange?.('ALL');
        }
        this.callbacks.onLocationSelect?.(lat, lon, dist, name);
      });
    });

    // 6. Country Search within Camera Dropdown
    const searchInput = document.getElementById('country-search-input') as HTMLInputElement | null;
    const searchList = document.getElementById('country-search-list');
    if (searchInput && searchList) {
      const renderSearch = (query: string) => {
        searchList.innerHTML = '';
        const q = query.trim().toLowerCase();
        const list = GeoIndex.getCountryList().filter((c) => !q || c.name.toLowerCase().includes(q) || (c.iso && c.iso.toLowerCase().includes(q)));
        list.slice(0, 40).forEach((c) => {
          const div = document.createElement('div');
          div.className = 'dropdown-item';
          div.innerHTML = `<span>🌍</span> <span>${c.name}</span>`;
          div.addEventListener('click', (e) => {
            e.stopPropagation();
            closeCameraMegaDropdown();
            this.callbacks.onLocationSelect?.(c.lat, c.lon, 200, c.name);
          });
          searchList.appendChild(div);
        });
      };
      searchInput.addEventListener('input', () => renderSearch(searchInput.value));
      renderSearch('');
    }

    // 7. Quick Manuel / Oto Toggle Switch
    const btnQuickToggle = document.getElementById('btn-cam-quick-toggle');
    if (btnQuickToggle) {
      btnQuickToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const willBeAuto = !this.camFilterMatrix.autoFollow;
        this.camFilterMatrix.autoFollow = willBeAuto;
        this.camFilterMatrix.cameraMode = willBeAuto ? 'AUTO' : 'MANUAL';
        this.syncQuickModeButtonVisual();
        modeOpts.forEach((o) => {
          o.classList.toggle('active', o.getAttribute('data-cam-mode') === (willBeAuto ? 'AUTO' : 'MANUAL'));
        });
        this.emitFilterMatrixChange();
      });
    }

    this.updateFilterStatusBadge();
  }

  private updateFilterStatusBadge(): void {
    const updateCountTag = (badgeId: string, count: number) => {
      const el = document.getElementById(badgeId);
      if (!el) return;
      if (count > 0) {
        el.textContent = count.toString();
        el.classList.remove('hidden');
      } else {
        el.classList.add('hidden');
      }
    };

    updateCountTag('badge-continents-count', this.camFilterMatrix.continents.length);
    updateCountTag('badge-regions-count', this.camFilterMatrix.regions.length);
    updateCountTag('badge-countries-count', this.camFilterMatrix.countries.length);
    updateCountTag('badge-peteks-count', this.camFilterMatrix.peteks.length);

    const total =
      this.camFilterMatrix.continents.length +
      this.camFilterMatrix.regions.length +
      this.camFilterMatrix.countries.length +
      this.camFilterMatrix.peteks.length;

    const statusPill = document.getElementById('badge-filter-status');
    if (statusPill) {
      if (total === 0) {
        statusPill.textContent = 'Tümü Açık';
        statusPill.style.color = '#94a3b8';
      } else {
        statusPill.textContent = `${total} Kriter Aktif`;
        statusPill.style.color = '#38bdf8';
      }
    }
  }

  private syncQuickModeButtonVisual(): void {
    const btn = document.getElementById('btn-cam-quick-toggle');
    const label = document.getElementById('label-quick-mode');
    const labelMode = document.getElementById('label-cam-mode');
    const isAuto = this.camFilterMatrix.autoFollow;

    if (btn) {
      btn.classList.toggle('auto-active', isAuto);
      btn.classList.toggle('manual-active', !isAuto);
    }
    if (label) {
      label.textContent = isAuto ? '🎬 OTO' : '🕹️ MANUEL';
    }
    if (labelMode) {
      labelMode.textContent = isAuto ? 'Mod: Oto' : 'Mod: Manuel';
    }
  }

  public syncExternalCameraMode(isAuto: boolean): void {
    this.camFilterMatrix.autoFollow = isAuto;
    this.camFilterMatrix.cameraMode = isAuto ? 'AUTO' : 'MANUAL';
    this.syncQuickModeButtonVisual();
  }

  public getCameraFilterMatrix(): CameraFilterMatrix {
    return { ...this.camFilterMatrix };
  }

  private emitFilterMatrixChange(): void {
    if (this.callbacks.onCameraFilterMatrixChange) {
      this.callbacks.onCameraFilterMatrixChange(this.camFilterMatrix);
    }
  }

  /**
   * Setup Background Instrumental Music Player UI controls and subscriptions.
   */
  public setupMusicPlayer(player: BackgroundMusicPlayer): void {
    if (!player) return;

    // Tracklist rendering helper
    const renderTracklist = () => {
      if (!this.musicPlaylistItems) return;
      const tracks = player.getPlaylist();
      this.musicPlaylistItems.innerHTML = '';
      tracks.forEach((track, index) => {
        const item = document.createElement('div');
        item.className = 'music-track-item';
        item.dataset.index = index.toString();
        item.innerHTML = `
          <div class="mti-index">${index + 1}</div>
          <div class="mti-info">
            <div class="mti-title">${track.title}</div>
            <div class="mti-artist">${track.artist}</div>
          </div>
          <div class="mti-play-icon">▶</div>
        `;
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          player.playTrack(index);
        });
        this.musicPlaylistItems?.appendChild(item);
      });
    };

    renderTracklist();

    // Unlock on widget button click: start playing if not playing
    this.btnMusicToggle?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!player.getState().isPlaying) {
        player.play();
      }
    });

    // Button actions
    this.btnMusicPlay?.addEventListener('click', (e) => {
      e.stopPropagation();
      player.togglePlay();
    });

    this.btnMusicPrev?.addEventListener('click', (e) => {
      e.stopPropagation();
      player.prevTrack();
    });

    this.btnMusicNext?.addEventListener('click', (e) => {
      e.stopPropagation();
      player.nextTrack();
    });

    this.btnMusicMute?.addEventListener('click', (e) => {
      e.stopPropagation();
      player.toggleMute();
    });

    this.musicVolumeSlider?.addEventListener('input', (e) => {
      e.stopPropagation();
      const val = parseFloat((e.target as HTMLInputElement).value) / 100;
      player.setVolume(val);
    });

    this.musicProgressBar?.addEventListener('input', (e) => {
      e.stopPropagation();
      const val = parseFloat((e.target as HTMLInputElement).value);
      player.seekToPercent(val);
    });

    const formatTime = (secs: number) => {
      if (isNaN(secs) || secs < 0) return '00:00';
      const m = Math.floor(secs / 60);
      const s = Math.floor(secs % 60);
      return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    // Global first-interaction unlock
    const unlockAudio = () => {
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
    };
    window.addEventListener('click', unlockAudio, { once: true });
    window.addEventListener('keydown', unlockAudio, { once: true });
    window.addEventListener('touchstart', unlockAudio, { once: true });

    // Subscribe to reactive state updates
    player.subscribe((state) => {
      // Re-render tracklist if playlist length changes after async init
      if (this.musicPlaylistItems && this.musicPlaylistItems.children.length !== player.getPlaylist().length) {
        renderTracklist();
      }

      const trackTitle = state.currentTrack?.title || 'Eternity';
      const trackArtist = state.currentTrack?.artist || 'Stellardrone';

      if (this.musicCurrentTitle) {
        this.musicCurrentTitle.textContent = trackTitle;
      }
      if (this.musicCurrentArtist) {
        this.musicCurrentArtist.textContent = trackArtist;
      }

      const tickerLabel = document.getElementById('music-widget-label');
      if (tickerLabel) {
        tickerLabel.textContent = `${trackArtist} — ${trackTitle}   •   ${trackArtist} — ${trackTitle}   •   `;
      }

      if (this.btnMusicPlay) {
        this.btnMusicPlay.innerHTML = state.isPlaying ? '⏸' : '▶';
        this.btnMusicPlay.title = state.isPlaying ? 'Duraklat' : 'Oynat';
      }
      if (this.btnMusicMute) {
        this.btnMusicMute.innerHTML = state.isMuted ? '🔇' : '🔊';
        this.btnMusicMute.title = state.isMuted ? 'Sesi Aç' : 'Sesi Kapat';
      }
      if (this.musicVolumeSlider) {
        this.musicVolumeSlider.value = state.isMuted ? '0' : Math.round(state.volume * 100).toString();
      }
      if (this.musicProgressBar && state.duration > 0) {
        this.musicProgressBar.value = (state.progressPercent || 0).toString();
      }
      if (this.musicTimeDisplay) {
        this.musicTimeDisplay.textContent = `${formatTime(state.currentTime)} / ${formatTime(state.duration)}`;
      }

      // Tracklist active class
      if (this.musicPlaylistItems) {
        const items = this.musicPlaylistItems.querySelectorAll('.music-track-item');
        items.forEach((it, idx) => {
          if (idx === state.currentIndex) {
            it.classList.add('active');
            (it.querySelector('.mti-play-icon') as HTMLElement).textContent = state.isPlaying ? '⏸' : '▶';
          } else {
            it.classList.remove('active');
            (it.querySelector('.mti-play-icon') as HTMLElement).textContent = '▶';
          }
        });
      }

      // Visual pulse
      if (this.musicWidgetPulse) {
        this.musicWidgetPulse.classList.toggle('playing', state.isPlaying);
      }
      if (this.btnMusicToggle) {
        this.btnMusicToggle.classList.toggle('playing', state.isPlaying);
      }
    });
  }

  public getSoundDirector(): SoundDirector | null {
    return this.soundDirector;
  }

  /**
   * Setup Procedural Lightning Sound Director UI controls, profiles, and volume slider.
   */
  public setupSoundDirector(director: SoundDirector): void {
    if (!director) return;
    this.soundDirector = director;

    // Set initial volume & profile in UI
    const currentVol = Math.round(director.getVolume() * 100);
    if (this.sfxVolumeSlider) {
      this.sfxVolumeSlider.value = currentVol.toString();
    }
    if (this.sfxVolumeVal) {
      this.sfxVolumeVal.textContent = `${currentVol}%`;
    }

    const currentProfile = director.getProfile();
    this.updateProfileUI(currentProfile);

    // Volume slider listener
    this.sfxVolumeSlider?.addEventListener('input', (e) => {
      e.stopPropagation();
      const val = parseInt((e.target as HTMLInputElement).value, 10);
      director.setVolume(val / 100);
      if (this.sfxVolumeVal) {
        this.sfxVolumeVal.textContent = `${val}%`;
      }
    });

    // Profile selector buttons
    this.sfxProfileButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const profile = btn.dataset.profile as LightningSoundProfile;
        if (profile) {
          director.setProfile(profile);
          this.updateProfileUI(profile);
        }
      });
    });

    // Test strike trigger button
    this.btnSfxTestStrike?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.state.isAudioMuted) {
        this.setAudioMuted(false);
      }
      director.playTestStrike();
    });
  }

  private updateProfileUI(profile: LightningSoundProfile): void {
    const profileLabels: Record<string, string> = {
      DYNAMIC: '⚡ DİNAMİK',
      v1: 'v1 DOĞAL',
      v2: 'v2 SİSMİK',
      v3: 'v3 PLAZMA',
      v4: 'v4 TAKTİK'
    };

    if (this.sfxActiveProfileName) {
      this.sfxActiveProfileName.textContent = profileLabels[profile] || profile;
    }

    this.sfxProfileButtons.forEach((btn) => {
      const p = btn.dataset.profile;
      btn.classList.toggle('active', p === profile);
    });
  }

  /**
   * Update the 20-target Interleaved Camera Queue list inside the right accordion panel.
   */
  public updateCameraQueue(targets: InterleavedQueueTarget[]): void {
    if (!this.cameraQueueList) return;

    if (this.queueCountBadge) {
      this.queueCountBadge.textContent = targets.length.toString();
    }

    if (!targets || targets.length === 0) {
      this.cameraQueueList.innerHTML = '<div class="queue-empty-note">Aktif kamera kuyruğu boş</div>';
      return;
    }

    let html = '';
    targets.forEach((item, idx) => {
      const isFirst = idx === 0;
      const isViewer = item.type === 'VIEWER';
      const flag = item.countryFlag || '🌍';
      const country = item.countryName || 'Regional Focus';

      let typeBadge = '';
      let detailText = '';

      if (isViewer && item.viewerRequest) {
        typeBadge = `<span class="queue-badge-viewer">👤 @${item.viewerRequest.username}</span>`;
        if (item.viewerRequest.hasStorm) {
          detailText = `<span class="queue-status-storm">⚡ Active Storm</span>`;
        } else {
          detailText = `<span class="queue-status-calm">🛰️ Calm Skies (0 Strikes)</span>`;
        }
      } else {
        typeBadge = `<span class="queue-badge-natural">⚡ NATURAL FOCUS</span>`;
        const score = item.cluster ? (item.cluster.activityScore * 100).toFixed(0) : '85';
        const strikes = item.cluster ? item.cluster.eventCount : 12;
        detailText = `<span class="queue-status-score">Activity: ${score}% • ${strikes} Strikes</span>`;
      }

      html += `
        <div class="queue-item ${isFirst ? 'queue-item-first' : ''} ${isViewer ? 'queue-item-viewer' : ''}">
          <div class="queue-col-rank">
            <span class="queue-rank-num">#${idx + 1}</span>
            ${isFirst ? '<span class="queue-tag-next">NEXT</span>' : ''}
          </div>
          <div class="queue-col-info">
            <div class="queue-title-row">
              <span class="queue-flag">${flag}</span>
              <span class="queue-country">${country}</span>
              ${typeBadge}
            </div>
            <div class="queue-sub-row">
              ${detailText}
              <span class="queue-cadence-scale">${item.scale || 'REGIONAL'}</span>
            </div>
          </div>
        </div>
      `;
    });

    this.cameraQueueList.innerHTML = html;
  }

  /**
   * Update bottom-left Viewer Flight HUD Card.
   */
  public updateViewerFlightHUD(
    currentReq: ViewerRequest | null,
    nextReq: ViewerRequest | null,
    remainingSec: number
  ): void {
    if (!this.viewerFlightCard) return;

    if (currentReq) {
      // Currently actively focusing on a viewer request
      this.viewerFlightCard.classList.remove('hidden');
      if (this.vfcBadge) {
        this.vfcBadge.textContent = '🎬 LIVE FOCUS';
        this.vfcBadge.className = 'vfc-badge vfc-badge-live';
      }
      if (this.vfcUser) {
        this.vfcUser.textContent = `@${currentReq.username}`;
      }
      if (this.vfcTargetName) {
        this.vfcTargetName.textContent = `${currentReq.countryFlag || '🌍'} ${currentReq.countryName}`;
      }
      if (this.vfcCountdown) {
        this.vfcCountdown.textContent = `${Math.max(0, Math.ceil(remainingSec))}s`;
      }
      if (this.vfcStatusBanner) {
        if (currentReq.hasStorm) {
          this.vfcStatusBanner.textContent = '⚡ Analyzing storm cell';
          this.vfcStatusBanner.className = 'vfc-status-banner vfc-status-storm';
        } else {
          this.vfcStatusBanner.textContent = `🛰️ @${currentReq.username}: ${currentReq.countryName} skies are currently calm (0 Strikes)`;
          this.vfcStatusBanner.className = 'vfc-status-banner vfc-status-calm';
        }
      }
      return;
    }

    if (nextReq) {
      // Natural storm active, but next in line is a viewer request
      this.viewerFlightCard.classList.remove('hidden');
      if (this.vfcBadge) {
        this.vfcBadge.textContent = '🎯 NEXT TARGET';
        this.vfcBadge.className = 'vfc-badge vfc-badge-upcoming';
      }
      if (this.vfcUser) {
        this.vfcUser.textContent = `@${nextReq.username}`;
      }
      if (this.vfcTargetName) {
        this.vfcTargetName.textContent = `Target: ${nextReq.countryFlag || '🌍'} ${nextReq.countryName}`;
      }
      if (this.vfcCountdown) {
        this.vfcCountdown.textContent = `${Math.max(0, Math.ceil(remainingSec))}s`;
      }
      if (this.vfcStatusBanner) {
        this.vfcStatusBanner.textContent = `Transitioning after storm passage (${nextReq.hasStorm ? 'Active Storm' : 'Calm Region'})`;
        this.vfcStatusBanner.className = 'vfc-status-banner vfc-status-upcoming';
      }
      return;
    }

    // Neither active nor upcoming viewer request
    this.viewerFlightCard.classList.add('hidden');
  }
}

