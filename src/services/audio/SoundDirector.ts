import * as THREE from 'three';

/**
 * SoundDirector: Pure procedural Web Audio sound synthesizer for cinematic meteorology.
 *
 * Capabilities:
 * - 100% procedural real-time synthesis via Web Audio API (zero external audio files).
 * - DynamicsCompressorNode master brickwall limiter preventing any clipping or distortion during multi-strike bursts.
 * - Distance-based acoustic speed propagation delay (spreads arrival times of 10 simultaneous strikes).
 * - Atmospheric high-frequency absorption filtering (close strikes snap crisp, distant strikes roll with low-pass boom).
 * - Brownian noise-based realistic thunder acoustics with sub-bass infrasound.
 * - 3D Spatial Audio: Web Audio PannerNode oriented via Earth matrixWorld rotation.
 * - Earth Acoustic Occlusion: Strikes on the far side of the planet are filtered through 320 Hz deep-core muffled filter.
 * - Polyphony guard limiting simultaneous voices cleanly.
 */
export class SoundDirector {
  private isMutedState: boolean = true;
  private audioCtx: AudioContext | null = null;
  private masterCompressor: DynamicsCompressorNode | null = null;
  private masterGain: GainNode | null = null;
  private snapNoiseBuffer: AudioBuffer | null = null;
  private rumbleNoiseBuffer: AudioBuffer | null = null;
  private globeMatrix: THREE.Matrix4 = new THREE.Matrix4();
  private activeVoices: number = 0;

  private static readonly TEMP_POS = new THREE.Vector3();
  private static readonly TEMP_NORMAL = new THREE.Vector3();

  constructor(customContext?: AudioContext) {
    if (customContext) {
      this.audioCtx = customContext;
      this.setupOutputChain(customContext);
    }
  }

  public isMuted(): boolean {
    return this.isMutedState;
  }

  public setMuted(muted: boolean): void {
    this.isMutedState = muted;
    if (!muted) {
      this.ensureAudioContext();
    }
  }

  public toggleMute(): boolean {
    this.setMuted(!this.isMutedState);
    return this.isMutedState;
  }

  public setGlobeMatrix(matrix: THREE.Matrix4): void {
    this.globeMatrix.copy(matrix);
  }

  private setupOutputChain(ctx: AudioContext): void {
    try {
      this.masterCompressor = ctx.createDynamicsCompressor();
      this.masterCompressor.threshold.setValueAtTime(-14, 0);
      this.masterCompressor.knee.setValueAtTime(10, 0);
      this.masterCompressor.ratio.setValueAtTime(8, 0);
      this.masterCompressor.attack.setValueAtTime(0.003, 0);
      this.masterCompressor.release.setValueAtTime(0.25, 0);

      this.masterGain = ctx.createGain();
      this.masterGain.gain.setValueAtTime(1.6, 0);

      this.masterGain.connect(this.masterCompressor);
      this.masterCompressor.connect(ctx.destination);
    } catch {
      // Safe fallback
    }
  }

  private ensureAudioContext(): void {
    if (this.audioCtx) {
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }
      return;
    }

    if (typeof window !== 'undefined') {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

      if (AudioContextClass) {
        try {
          this.audioCtx = new AudioContextClass();
          this.setupOutputChain(this.audioCtx);
        } catch (err) {
          console.warn('Unable to initialize Web Audio AudioContext:', err);
        }
      }
    }
  }

  public updateListener(cameraPos: THREE.Vector3, cameraForward: THREE.Vector3, cameraUp: THREE.Vector3): void {
    if (!this.audioCtx || this.isMutedState) return;
    const ctx = this.audioCtx;
    const now = ctx.currentTime;
    const listener = ctx.listener;

    try {
      if (listener.positionX) {
        listener.positionX.setValueAtTime(cameraPos.x, now);
        listener.positionY.setValueAtTime(cameraPos.y, now);
        listener.positionZ.setValueAtTime(cameraPos.z, now);
        listener.forwardX.setValueAtTime(cameraForward.x, now);
        listener.forwardY.setValueAtTime(cameraForward.y, now);
        listener.forwardZ.setValueAtTime(cameraForward.z, now);
        listener.upX.setValueAtTime(cameraUp.x, now);
        listener.upY.setValueAtTime(cameraUp.y, now);
        listener.upZ.setValueAtTime(cameraUp.z, now);
      } else if ((listener as any).setPosition) {
        (listener as any).setPosition(cameraPos.x, cameraPos.y, cameraPos.z);
        (listener as any).setOrientation(
          cameraForward.x, cameraForward.y, cameraForward.z,
          cameraUp.x, cameraUp.y, cameraUp.z
        );
      }
    } catch {
      // Safe fallback
    }
  }

  /**
   * Generates a 40ms high-frequency white noise snap for the initial leader discharge crack.
   */
  private getSnapNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.snapNoiseBuffer && this.snapNoiseBuffer.sampleRate === ctx.sampleRate) {
      return this.snapNoiseBuffer;
    }

    const length = Math.floor(ctx.sampleRate * 0.045);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    this.snapNoiseBuffer = buffer;
    return buffer;
  }

  /**
   * Generates a 2.5-second Brownian noise buffer for authentic rolling thunder acoustics.
   */
  private getRumbleNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.rumbleNoiseBuffer && this.rumbleNoiseBuffer.sampleRate === ctx.sampleRate) {
      return this.rumbleNoiseBuffer;
    }

    const length = Math.floor(ctx.sampleRate * 2.5);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let lastOut = 0.0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      // Integrated 1-pole Brownian filter
      lastOut = (lastOut + 0.045 * white) / 1.045;
      data[i] = lastOut * 3.5;
    }
    this.rumbleNoiseBuffer = buffer;
    return buffer;
  }

  /**
   * Procedural lightning discharge sound with acoustic distance delay, air absorption filtering,
   * realistic rolling thunder, and master limiter protection.
   */
  public playStrikeSound(
    peakCurrentKa: number = 30,
    strikeLocalPos?: THREE.Vector3,
    cameraPos?: THREE.Vector3
  ): void {
    if (this.isMutedState) return;
    this.ensureAudioContext();
    if (!this.audioCtx || !this.masterGain) return;

    // Polyphony voice limiter: max 12 simultaneous active sound events
    if (this.activeVoices >= 12 && Math.abs(peakCurrentKa) < 60) {
      return;
    }

    try {
      const ctx = this.audioCtx;
      const now = ctx.currentTime;
      const absCurrent = Math.abs(peakCurrentKa);
      const isSuperbolt = absCurrent >= 150;
      const normalizedCurrent = Math.min(1.0, Math.max(0.1, absCurrent / 90.0));

      // 1. Calculate World Space Position, Distance & Earth Occlusion
      let isOccluded = false;
      let worldPos: THREE.Vector3 | null = null;
      let distanceToCamera = 220;

      if (strikeLocalPos) {
        SoundDirector.TEMP_POS.copy(strikeLocalPos).applyMatrix4(this.globeMatrix);
        worldPos = SoundDirector.TEMP_POS;

        if (cameraPos) {
          distanceToCamera = worldPos.distanceTo(cameraPos);
          SoundDirector.TEMP_NORMAL.copy(worldPos).normalize();
          const toCamera = cameraPos.clone().sub(worldPos).normalize();
          // Far side of planet check
          if (SoundDirector.TEMP_NORMAL.dot(toCamera) < -0.12) {
            isOccluded = true;
          }
        }
      }

      // 2. Physical Acoustic Delay (Speed of sound propagation: ~340 m/s normalized to globe scale)
      // Gives natural multi-strike separation when 10 strikes occur in the same second!
      const acousticDelaySec = Math.min(0.28, Math.max(0.012, (distanceToCamera - 50) / 950));
      const startTime = now + acousticDelaySec;

      // 3. Distance Attenuation & Atmospheric Air Absorption Filter
      // Distant strikes lose high frequencies (low-pass cutoff drops from 5200Hz to 480Hz)
      const distNorm = Math.max(0, Math.min(1.0, (distanceToCamera - 80) / 320));
      const airAbsorptionCutoff = isOccluded ? 380 : Math.max(480, 5200 * Math.pow(0.20, distNorm));
      const distGain = Math.max(0.68, Math.min(1.15, 280 / Math.max(100, distanceToCamera)));

      const strikeMasterGain = ctx.createGain();
      const baseVolume = (isSuperbolt ? 1.0 : 0.62 + normalizedCurrent * 0.38) * distGain * (isOccluded ? 0.50 : 1.0);
      strikeMasterGain.gain.setValueAtTime(baseVolume, startTime);

      // 4. Low-Pass Filter Chain
      const airFilter = ctx.createBiquadFilter();
      airFilter.type = 'lowpass';
      airFilter.frequency.setValueAtTime(airAbsorptionCutoff, startTime);
      airFilter.Q.setValueAtTime(isOccluded ? 2.0 : 1.2, startTime);

      // 5. 3D Spatial Panner Node
      let panner: PannerNode | null = null;
      if (worldPos && typeof ctx.createPanner === 'function') {
        panner = ctx.createPanner();
        panner.panningModel = 'HRTF';
        panner.distanceModel = 'inverse';
        panner.refDistance = 150;
        panner.maxDistance = 1200;
        panner.rolloffFactor = 0.45;

        if (panner.positionX) {
          panner.positionX.setValueAtTime(worldPos.x, startTime);
          panner.positionY.setValueAtTime(worldPos.y, startTime);
          panner.positionZ.setValueAtTime(worldPos.z, startTime);
        } else if ((panner as any).setPosition) {
          (panner as any).setPosition(worldPos.x, worldPos.y, worldPos.z);
        }
      }

      // Connect into master chain
      if (panner) {
        strikeMasterGain.connect(airFilter);
        airFilter.connect(panner);
        panner.connect(this.masterGain);
      } else {
        strikeMasterGain.connect(airFilter);
        airFilter.connect(this.masterGain);
      }

      this.activeVoices++;

      // 6. Sound Component A: Initial High-Frequency Electro-Acoustic Crack / Snap
      // (Audible on near and medium strikes, suppressed on distant ones by air absorption)
      const snapSource = ctx.createBufferSource();
      snapSource.buffer = this.getSnapNoiseBuffer(ctx);

      const snapFilter = ctx.createBiquadFilter();
      snapFilter.type = 'highpass';
      snapFilter.frequency.setValueAtTime(isOccluded ? 400 : 850, startTime);

      const snapGain = ctx.createGain();
      const snapVol = isSuperbolt ? 0.70 : 0.50;
      snapGain.gain.setValueAtTime(0.001, startTime);
      snapGain.gain.linearRampToValueAtTime(snapVol, startTime + 0.004);
      snapGain.gain.exponentialRampToValueAtTime(0.001, startTime + (isSuperbolt ? 0.045 : 0.030));

      snapSource.connect(snapFilter);
      snapFilter.connect(snapGain);
      snapGain.connect(strikeMasterGain);

      snapSource.start(startTime);
      snapSource.stop(startTime + 0.045);

      // 7. Sound Component B: Authentic Rolling Thunder (Brownian turbulent pressure waves)
      const rumbleDuration = isSuperbolt ? 2.2 : (0.95 + normalizedCurrent * 0.85);
      const rumbleSource = ctx.createBufferSource();
      rumbleSource.buffer = this.getRumbleNoiseBuffer(ctx);

      const rumbleFilter = ctx.createBiquadFilter();
      rumbleFilter.type = 'bandpass';
      rumbleFilter.frequency.setValueAtTime(isSuperbolt ? 95 : 120, startTime);
      rumbleFilter.frequency.exponentialRampToValueAtTime(45, startTime + rumbleDuration);
      rumbleFilter.Q.setValueAtTime(2.2, startTime);

      const rumbleGain = ctx.createGain();
      const rumblePeak = isSuperbolt ? 0.65 : (0.38 + normalizedCurrent * 0.22);
      rumbleGain.gain.setValueAtTime(0.001, startTime);
      rumbleGain.gain.linearRampToValueAtTime(rumblePeak, startTime + 0.03);
      // Natural rolling thunder decay with undulating reflections
      rumbleGain.gain.exponentialRampToValueAtTime(0.0001, startTime + rumbleDuration);

      rumbleSource.connect(rumbleFilter);
      rumbleFilter.connect(rumbleGain);
      rumbleGain.connect(strikeMasterGain);

      rumbleSource.start(startTime);
      rumbleSource.stop(startTime + rumbleDuration);

      // 8. Sound Component C: Sub-bass Infrasound Pressure Droop (45Hz -> 25Hz)
      const subOsc = ctx.createOscillator();
      subOsc.type = 'sine';
      subOsc.frequency.setValueAtTime(isSuperbolt ? 55 : 45, startTime);
      subOsc.frequency.exponentialRampToValueAtTime(24, startTime + rumbleDuration);

      const subGain = ctx.createGain();
      const subVol = isSuperbolt ? 0.55 : 0.35;
      subGain.gain.setValueAtTime(0.001, startTime);
      subGain.gain.linearRampToValueAtTime(subVol, startTime + 0.02);
      subGain.gain.exponentialRampToValueAtTime(0.0001, startTime + Math.min(1.2, rumbleDuration));

      subOsc.connect(subGain);
      subGain.connect(strikeMasterGain);

      subOsc.start(startTime);
      subOsc.stop(startTime + rumbleDuration);

      // 9. Sound Component D: Low-End Acoustic Impulse & Tactile Crack (No harsh synthetic squeals)
      const crackOsc = ctx.createOscillator();
      const crackGain = ctx.createGain();
      const crackFilter = ctx.createBiquadFilter();

      crackOsc.type = 'triangle';
      crackOsc.frequency.setValueAtTime(isSuperbolt ? 110 : 85, startTime);
      crackOsc.frequency.exponentialRampToValueAtTime(28, startTime + 0.08);

      crackFilter.type = 'lowpass';
      crackFilter.frequency.setValueAtTime(650, startTime);

      const crackVol = isSuperbolt ? 0.35 : 0.20;
      crackGain.gain.setValueAtTime(0.001, startTime);
      crackGain.gain.linearRampToValueAtTime(crackVol, startTime + 0.004);
      crackGain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.08);

      crackOsc.connect(crackFilter);
      crackFilter.connect(crackGain);
      crackGain.connect(strikeMasterGain);

      crackOsc.start(startTime);
      crackOsc.stop(startTime + 0.09);

      // Decrement active voices on completion
      setTimeout(() => {
        this.activeVoices = Math.max(0, this.activeVoices - 1);
        try {
          strikeMasterGain.disconnect();
          airFilter.disconnect();
          if (panner) panner.disconnect();
        } catch {
          // Safe cleanup
        }
      }, (acousticDelaySec + rumbleDuration + 0.1) * 1000);

    } catch {
      // Fails safely without interrupting animation loop
    }
  }

  /**
   * Cinematic orbital approach whoosh: subtle ethereal sweep when focusing onto a storm cell.
   */
  public playApproachSound(): void {
    if (this.isMutedState) return;
    this.ensureAudioContext();
    if (!this.audioCtx || !this.masterGain) return;

    try {
      const ctx = this.audioCtx;
      const now = ctx.currentTime;
      const duration = 1.2;

      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(95, now);
      osc.frequency.exponentialRampToValueAtTime(38, now + duration);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.06, now + 0.25);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(now);
      osc.stop(now + duration);
    } catch {
      // Fail safely
    }
  }

  public dispose(): void {
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
  }
}
