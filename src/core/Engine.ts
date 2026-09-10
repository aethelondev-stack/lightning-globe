import * as THREE from 'three';
import { EngineConfig } from './Config';
import { getSolarPosition } from '../utils/sun';
import type { EngineOptions, RenderCallback } from '../types';

export class Engine {
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  public readonly renderer: THREE.WebGLRenderer;
  public readonly canvas: HTMLCanvasElement;

  private readonly clock: THREE.Clock;
  private readonly callbacks: Set<RenderCallback> = new Set();
  private readonly postCallbacks: Set<RenderCallback> = new Set();
  private animationFrameId: number | null = null;
  private isRunning: boolean = false;

  constructor(options: EngineOptions) {
    this.canvas = options.canvas;

    // WebGL support check
    if (!this.isWebGLAvailable()) {
      throw new Error('WebGL is not supported in this environment/browser.');
    }

    // 1. Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(EngineConfig.backgroundColor);

    // Realistic Deep Space Skybox: Authentic ESO Milky Way Cube Texture
    const cubeLoader = new THREE.CubeTextureLoader();
    cubeLoader.setPath('/textures/milkyway/');
    cubeLoader.load(
      ['dark-s_px.jpg', 'dark-s_nx.jpg', 'dark-s_py.jpg', 'dark-s_ny.jpg', 'dark-s_pz.jpg', 'dark-s_nz.jpg'],
      (cubeTexture) => {
        cubeTexture.colorSpace = THREE.SRGBColorSpace;
        this.scene.background = cubeTexture;
      },
      undefined,
      (err) => {
        console.warn('Could not load MilkyWay cube texture, keeping dark background color:', err);
      }
    );

    // 2. Camera
    const width = Math.max(window.innerWidth, 1);
    const height = Math.max(window.innerHeight, 1);
    this.camera = new THREE.PerspectiveCamera(
      EngineConfig.camera.fov,
      width / height,
      EngineConfig.camera.near,
      EngineConfig.camera.far
    );
    this.camera.position.set(
      EngineConfig.camera.initialPosition.x,
      EngineConfig.camera.initialPosition.y,
      EngineConfig.camera.initialPosition.z
    );
    this.camera.lookAt(0, 0, 0);

    // 3. WebGLRenderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: options.antialias ?? EngineConfig.antialias,
      alpha: options.alpha ?? false,
      powerPreference: EngineConfig.powerPreference
    });

    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = EngineConfig.toneMappingExposure;

    const pixelRatio = Math.min(window.devicePixelRatio, EngineConfig.maxPixelRatio);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height);

    // 4. Lighting Setup
    this.setupLighting();

    // 5. Clock
    this.clock = new THREE.Clock();

    // 6. Bind Resize Listener
    window.addEventListener('resize', this.onResize);

    // 7. Bind WebGL Context Loss Handlers (Phase 13)
    this.setupContextLossHandling();
  }

  public isContextLost: boolean = false;

  private setupContextLossHandling(): void {
    this.canvas.addEventListener('webglcontextlost', (e: Event) => {
      e.preventDefault();
      this.isContextLost = true;
      if (this.animationFrameId !== null) {
        cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
      }
      console.warn('⚠️ WebGL context lost. Render loop suspended.');
    });

    this.canvas.addEventListener('webglcontextrestored', () => {
      console.info('🔄 WebGL context restored. Re-initializing viewport and resuming render loop.');
      this.isContextLost = false;
      const width = Math.max(window.innerWidth, 1);
      const height = Math.max(window.innerHeight, 1);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height);
      if (this.isRunning) {
        this.clock.start();
        this.loop();
      }
    });
  }

  private isWebGLAvailable(): boolean {
    try {
      const gl = this.canvas.getContext('webgl2') || this.canvas.getContext('webgl');
      return !!gl;
    } catch {
      return false;
    }
  }

  private sunLight!: THREE.DirectionalLight;

  private setupLighting(): void {
    // A. Calibrated Ambient Light (illuminates night side subtly so silhouettes/continents are visible)
    const ambientLight = new THREE.AmbientLight(
      EngineConfig.lighting.ambient.color,
      EngineConfig.lighting.ambient.intensity
    );
    this.scene.add(ambientLight);

    // B. Real-time astronomical Sun DirectionalLight
    const sunPos = getSolarPosition(new Date(), EngineConfig.lighting.directional.distance);
    this.sunLight = new THREE.DirectionalLight(
      EngineConfig.lighting.directional.color,
      EngineConfig.lighting.directional.intensity
    );
    this.sunLight.position.copy(sunPos.vector);
    this.scene.add(this.sunLight);
    this.scene.add(this.camera);
  }

  public updateSunPosition(date: Date = new Date()): void {
    const sunPos = getSolarPosition(date, EngineConfig.lighting.directional.distance);
    this.sunLight.position.copy(sunPos.vector);
  }

  private onResize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;

    // Edge case: Viewport size 0 check
    if (width <= 0 || height <= 0) {
      return;
    }

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, EngineConfig.maxPixelRatio));
  };

  public registerRenderCallback(callback: RenderCallback): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  public registerPostRenderCallback(callback: RenderCallback): () => void {
    this.postCallbacks.add(callback);
    return () => this.postCallbacks.delete(callback);
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.clock.start();
    this.loop();
  }

  public stop(): void {
    this.isRunning = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.clock.stop();
  }

  private loop = (): void => {
    if (!this.isRunning || this.isContextLost) return;

    this.animationFrameId = requestAnimationFrame(this.loop);

    const delta = Math.min(this.clock.getDelta(), 0.05);
    const elapsed = this.clock.getElapsedTime();

    // Update phase
    for (const callback of this.callbacks) {
      try {
        callback(delta, elapsed);
      } catch (err) {
        console.error('Render callback error:', err);
      }
    }

    // Render phase
    this.renderer.render(this.scene, this.camera);

    // Post-render phase (telemetry, profiler, post-processing)
    for (const postCallback of this.postCallbacks) {
      try {
        postCallback(delta, elapsed);
      } catch (err) {
        console.error('Post-render callback error:', err);
      }
    }
  };

  public destroy(): void {
    this.stop();
    window.removeEventListener('resize', this.onResize);
    this.callbacks.clear();
    this.renderer.dispose();
  }
}
