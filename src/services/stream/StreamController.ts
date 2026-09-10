/**
 * StreamController: Realtime Chat Command & Broadcast HUD Controller
 *
 * Connects the 3D Lightning Globe to live stream chat channels (Kick / YouTube).
 * Enables viewers to drive camera movements in real-time with anti-spam cooldowns.
 */

export interface ChatCommandPayload {
  type: 'COMMAND';
  command: string;
  user: string;
  param?: string;
  timestamp: number;
}

export interface StreamControllerOptions {
  wsUrl?: string;
  isStreamMode?: boolean;
  onCommand?: (payload: ChatCommandPayload) => void;
}

export class StreamController {
  private ws: WebSocket | null = null;
  private wsUrl: string;
  public readonly isStreamMode: boolean;
  private reconnectTimer: any = null;
  private bannerElement: HTMLElement | null = null;
  private toastElement: HTMLElement | null = null;
  private toastTimeout: any = null;
  private onCommandCallback?: (payload: ChatCommandPayload) => void;

  constructor(options?: StreamControllerOptions) {
    const urlParams = new URLSearchParams(window.location.search);
    this.isStreamMode = options?.isStreamMode ?? (urlParams.has('stream') || urlParams.has('broadcast'));
    const host = window.location.hostname || '127.0.0.1';
    this.wsUrl = options?.wsUrl ?? `ws://${host}:3001`;
    this.onCommandCallback = options?.onCommand;

    if (this.isStreamMode) {
      this.initHUD();
      this.connect();
    }
  }

  private initHUD(): void {
    // 1. Broadcast HUD Banner
    this.bannerElement = document.createElement('div');
    this.bannerElement.id = 'stream-hud-banner';
    this.bannerElement.style.cssText = `
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 9999;
      background: rgba(10, 15, 29, 0.85);
      border: 1px solid rgba(0, 240, 255, 0.35);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      padding: 10px 22px;
      border-radius: 30px;
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      font-weight: 500;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6), 0 0 15px rgba(0, 240, 255, 0.2);
      display: flex;
      align-items: center;
      gap: 16px;
      pointer-events: none;
      letter-spacing: 0.3px;
    `;

    this.bannerElement.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="display: inline-block; width: 9px; height: 9px; background: #00ff88; border-radius: 50%; box-shadow: 0 0 8px #00ff88; animation: pulse 1.5s infinite;"></span>
        <span style="font-weight: 700; color: #00f0ff; text-transform: uppercase; font-size: 11px; letter-spacing: 1px;">KİCK & YT CANLI</span>
      </div>
      <div style="width: 1px; height: 16px; background: rgba(255,255,255,0.15);"></div>
      <div style="color: rgba(255,255,255,0.9);">
        💬 Sohbet Komutları: 
        <strong style="color: #ffb703;">!turkiye</strong> &bull; 
        <strong style="color: #ffb703;">!firtina</strong> &bull; 
        <strong style="color: #ffb703;">!dunya</strong> &bull; 
        <strong style="color: #ffb703;">!zoom</strong> &bull; 
        <strong style="color: #ffb703;">!oto</strong> &bull; 
        <strong style="color: #ffb703;">!avrupa</strong>
      </div>
    `;

    document.body.appendChild(this.bannerElement);

    // 2. Command Toast Notification
    this.toastElement = document.createElement('div');
    this.toastElement.id = 'stream-command-toast';
    this.toastElement.style.cssText = `
      position: fixed;
      top: 28px;
      left: 50%;
      transform: translateX(-50%) translateY(-20px);
      z-index: 10000;
      background: linear-gradient(135deg, rgba(20, 25, 45, 0.95), rgba(10, 15, 30, 0.95));
      border: 1px solid rgba(255, 183, 3, 0.6);
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.8), 0 0 20px rgba(255, 183, 3, 0.3);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      padding: 12px 28px;
      border-radius: 12px;
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 14px;
      font-weight: 600;
      opacity: 0;
      transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
      pointer-events: none;
      white-space: nowrap;
    `;
    document.body.appendChild(this.toastElement);
  }

  public showToast(user: string, actionText: string): void {
    if (!this.toastElement) return;

    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
    }

    this.toastElement.innerHTML = `
      <span style="color: #ffb703;">@${user}</span>: ${actionText}
    `;
    this.toastElement.style.opacity = '1';
    this.toastElement.style.transform = 'translateX(-50%) translateY(0)';

    this.toastTimeout = setTimeout(() => {
      if (this.toastElement) {
        this.toastElement.style.opacity = '0';
        this.toastElement.style.transform = 'translateX(-50%) translateY(-20px)';
      }
    }, 4500);
  }

  private connect(): void {
    try {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.onopen = () => {
        console.log(`[StreamController] Connected to chat bridge at ${this.wsUrl}`);
      };

      this.ws.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data);
          if (data && data.type === 'COMMAND') {
            this.handleCommand(data as ChatCommandPayload);
          }
        } catch (e) {
          console.warn('[StreamController] Error parsing message:', e);
        }
      };

      this.ws.onclose = () => {
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        this.ws?.close();
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.isStreamMode) {
        this.connect();
      }
    }, 4000);
  }

  private handleCommand(payload: ChatCommandPayload): void {
    if (this.onCommandCallback) {
      this.onCommandCallback(payload);
    }
  }

  public setCommandHandler(handler: (payload: ChatCommandPayload) => void): void {
    this.onCommandCallback = handler;
  }
}
