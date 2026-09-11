/**
 * BackgroundMusicPlayer: Curated Ambient Space Music Player for Live Stream & Observatory HUD.
 *
 * Manages playback of 20 stream-safe, royalty-free ambient and neo-classical instrumental tracks.
 * Features:
 * - HTML5 Audio streaming with preloading
 * - Play / Pause / Seek / Volume / Mute
 * - Sequential auto-play loop across all 20 tracks
 * - LocalStorage state persistence (volume, mute)
 * - Reactive event subscriptions for UI bindings
 */

export interface AmbientTrack {
  id: string;
  index: number;
  title: string;
  artist: string;
  src: string;
}

export interface PlayerState {
  currentTrackIndex: number;
  currentIndex: number;
  currentTrack?: AmbientTrack;
  isPlaying: boolean;
  isMuted: boolean;
  volume: number; // 0.0 to 1.0
  currentTime: number;
  duration: number;
  progressPercent: number;
}

export type PlayerStateListener = (state: PlayerState, currentTrack: AmbientTrack) => void;

export class BackgroundMusicPlayer {
  private audio: HTMLAudioElement;
  private playlist: AmbientTrack[] = [];
  private currentIndex: number = 0;
  private isPlayingState: boolean = false;
  private volumeLevel: number = 0.5;
  private isMutedState: boolean = false;
  private listeners: Set<PlayerStateListener> = new Set();

  constructor() {
    if (typeof Audio !== 'undefined') {
      this.audio = new Audio();
      this.audio.preload = 'metadata';
    } else {
      this.audio = {
        preload: 'metadata',
        currentTime: 0,
        duration: 180,
        volume: 0.5,
        src: '',
        play: () => Promise.resolve(),
        pause: () => {},
        addEventListener: () => {},
        removeEventListener: () => {}
      } as any;
    }

    // Restore volume settings from localStorage
    const hasLocalStorage = typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function';
    const savedVol = hasLocalStorage ? localStorage.getItem('ag_bgm_volume') : null;
    if (savedVol !== null) {
      const v = parseFloat(savedVol);
      if (!isNaN(v) && v >= 0 && v <= 1) this.volumeLevel = v;
    }
    const savedMuted = hasLocalStorage ? localStorage.getItem('ag_bgm_muted') : null;
    if (savedMuted !== null) {
      this.isMutedState = savedMuted === 'true';
    }

    this.applyVolume();
    this.setupAudioEvents();

    // Initialize with embedded 20-track manifest synchronously so UI never sees an empty playlist
    this.playlist = this.getDefaultManifest();
    if (this.playlist.length > 0) {
      this.setTrack(0, false);
    }
  }

  /**
   * Initializes or refreshes the playlist from public metadata.
   */
  public async init(): Promise<void> {
    try {
      const res = await fetch('/audio/ambient/playlist.json');
      if (res.ok) {
        const loaded: AmbientTrack[] = await res.json();
        if (Array.isArray(loaded) && loaded.length > 0) {
          this.playlist = loaded;
          this.setTrack(this.currentIndex, this.isPlayingState);
          this.notify();
        }
      }
    } catch (e) {
      console.warn('Could not load /audio/ambient/playlist.json, using embedded manifest', e);
    }
  }

  public getPlaylist(): AmbientTrack[] {
    return this.playlist;
  }

  public getState(): PlayerState {
    const curTime = this.audio.currentTime || 0;
    const dur = this.audio.duration || 0;
    const pct = dur > 0 ? (curTime / dur) * 100 : 0;
    return {
      currentTrackIndex: this.currentIndex,
      currentIndex: this.currentIndex,
      currentTrack: this.getCurrentTrack(),
      isPlaying: this.isPlayingState,
      isMuted: this.isMutedState,
      volume: this.volumeLevel,
      currentTime: curTime,
      duration: dur,
      progressPercent: pct
    };
  }

  public getCurrentTrack(): AmbientTrack {
    return this.playlist[this.currentIndex] || {
      id: 'default',
      index: 1,
      title: 'Cosmic Drift',
      artist: 'Stellardrone',
      src: '/audio/ambient/01_stellardrone_eternity.mp3'
    };
  }

  public subscribe(listener: PlayerStateListener): () => void {
    this.listeners.add(listener);
    listener(this.getState(), this.getCurrentTrack());
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const state = this.getState();
    const track = this.getCurrentTrack();
    this.listeners.forEach((l) => l(state, track));
  }

  public play(): void {
    if (this.isMutedState) {
      this.isMutedState = false;
      this.applyVolume();
    }
    if (this.volumeLevel <= 0.01 && !this.isMutedState) {
      this.volumeLevel = 0.5;
      this.applyVolume();
    }
    if (!this.audio.src && this.playlist.length > 0) {
      this.setTrack(this.currentIndex, false);
    }
    const playPromise = this.audio.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          this.isPlayingState = true;
          this.notify();
        })
        .catch((err) => {
          console.warn('Audio autoplay blocked or failed:', err);
          this.isPlayingState = false;
          this.notify();
        });
    }
  }

  public pause(): void {
    this.audio.pause();
    this.isPlayingState = false;
    this.notify();
  }

  public togglePlay(): void {
    if (this.isPlayingState) {
      this.pause();
    } else {
      this.play();
    }
  }

  public nextTrack(): void {
    if (this.playlist.length === 0) return;
    const nextIdx = (this.currentIndex + 1) % this.playlist.length;
    this.setTrack(nextIdx, true);
  }

  public prevTrack(): void {
    if (this.playlist.length === 0) return;
    // If more than 3 seconds in, restart current track
    if (this.audio.currentTime > 3) {
      this.audio.currentTime = 0;
      this.notify();
      return;
    }
    const prevIdx = (this.currentIndex - 1 + this.playlist.length) % this.playlist.length;
    this.setTrack(prevIdx, true);
  }

  public selectTrack(index: number): void {
    if (index >= 0 && index < this.playlist.length) {
      this.setTrack(index, true);
    }
  }

  public playTrack(index: number): void {
    this.selectTrack(index);
  }

  public seek(seconds: number): void {
    if (!isNaN(seconds) && isFinite(seconds) && this.audio.duration) {
      this.audio.currentTime = Math.max(0, Math.min(this.audio.duration, seconds));
      this.notify();
    }
  }

  public seekToPercent(percent: number): void {
    if (this.audio.duration) {
      const clamped = Math.max(0, Math.min(100, percent));
      this.seek((clamped / 100) * this.audio.duration);
    }
  }

  public setVolume(vol: number): void {
    this.volumeLevel = Math.max(0, Math.min(1, vol));
    if (this.volumeLevel > 0 && this.isMutedState) {
      this.isMutedState = false;
    } else if (this.volumeLevel === 0) {
      this.isMutedState = true;
    }
    this.applyVolume();
    if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function') {
      localStorage.setItem('ag_bgm_volume', this.volumeLevel.toString());
      localStorage.setItem('ag_bgm_muted', this.isMutedState.toString());
    }
    this.notify();
  }

  public toggleMute(): void {
    this.isMutedState = !this.isMutedState;
    if (!this.isMutedState && this.volumeLevel <= 0.01) {
      this.volumeLevel = 0.5;
    }
    this.applyVolume();
    if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function') {
      localStorage.setItem('ag_bgm_muted', this.isMutedState.toString());
      localStorage.setItem('ag_bgm_volume', this.volumeLevel.toString());
    }
    this.notify();
  }

  private setTrack(index: number, autoPlay: boolean = false): void {
    if (!this.playlist[index]) return;
    this.currentIndex = index;
    const track = this.playlist[index];
    this.audio.src = track.src;
    this.audio.currentTime = 0;
    if (autoPlay) {
      this.play();
    } else {
      this.notify();
    }
  }

  private applyVolume(): void {
    this.audio.volume = this.isMutedState ? 0 : this.volumeLevel;
  }

  private setupAudioEvents(): void {
    this.audio.addEventListener('timeupdate', () => this.notify());
    this.audio.addEventListener('durationchange', () => this.notify());
    this.audio.addEventListener('play', () => {
      this.isPlayingState = true;
      this.notify();
    });
    this.audio.addEventListener('pause', () => {
      this.isPlayingState = false;
      this.notify();
    });
    this.audio.addEventListener('ended', () => {
      // Auto-advance to next track in sequential loop
      this.nextTrack();
    });
    this.audio.addEventListener('error', (e) => {
      console.warn('Audio playback error:', e);
      this.isPlayingState = false;
      this.notify();
    });
  }

  private getDefaultManifest(): AmbientTrack[] {
    const defaultFilenames = [
      { t: "Eternity", a: "Stellardrone", f: "01_stellardrone_eternity.mp3" },
      { t: "Red Giant", a: "Stellardrone", f: "02_stellardrone_red_giant.mp3" },
      { t: "In Time", a: "Stellardrone", f: "03_stellardrone_in_time.mp3" },
      { t: "Airglow", a: "Stellardrone", f: "04_stellardrone_airglow.mp3" },
      { t: "Light Years", a: "Stellardrone", f: "05_stellardrone_light_years.mp3" },
      { t: "Cepheid", a: "Stellardrone", f: "06_stellardrone_cepheid.mp3" },
      { t: "Comet Halley", a: "Stellardrone", f: "07_stellardrone_comet_halley.mp3" },
      { t: "Ultra Deep Field", a: "Stellardrone", f: "08_stellardrone_ultra_deep_field.mp3" },
      { t: "Undertow", a: "Scott Buckley", f: "09_scott_buckley_undertow.mp3" },
      { t: "Filaments", a: "Scott Buckley", f: "10_scott_buckley_filaments.mp3" },
      { t: "Permafrost", a: "Scott Buckley", f: "11_scott_buckley_permafrost.mp3" },
      { t: "Passage", a: "Scott Buckley", f: "12_scott_buckley_passage.mp3" },
      { t: "Adrift Among Infinite Stars", a: "Scott Buckley", f: "13_scott_buckley_adrift.mp3" },
      { t: "The Distant Sun", a: "Scott Buckley", f: "14_scott_buckley_distant_sun.mp3" },
      { t: "Aphelion", a: "Scott Buckley", f: "15_scott_buckley_aphelion.mp3" },
      { t: "Endless Story About Sun and Moon", a: "Kai Engel", f: "16_kai_engel_endless_story.mp3" },
      { t: "Silence", a: "Kai Engel", f: "17_kai_engel_silence.mp3" },
      { t: "Highway to the Stars", a: "Kai Engel", f: "18_kai_engel_highway_to_stars.mp3" },
      { t: "Universe in Hands", a: "Kai Engel", f: "19_kai_engel_universe_in_hands.mp3" },
      { t: "Low Horizon", a: "Kai Engel", f: "20_kai_engel_low_horizon.mp3" }
    ];

    return defaultFilenames.map((item, idx) => ({
      id: `track-${idx + 1}`,
      index: idx + 1,
      title: item.t,
      artist: item.a,
      src: `/audio/ambient/${item.f}`
    }));
  }
}
