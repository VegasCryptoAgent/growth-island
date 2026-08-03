import { WS_URL } from '../config';
import { getToken } from './Api';

export type Peer = {
  id: string;
  name: string;
  x: number;
  y: number;
  dir: string;
  house: string;
  zone: string;
};

type Handlers = {
  onPeers?: (peers: Peer[]) => void;
  onConnected?: (withId: string, name: string) => void;
  onChat?: (from: string, name: string, text: string) => void;
  onStatus?: (s: 'connected' | 'disconnected' | 'error', detail?: string) => void;
  onAuthed?: (user: { id: string; name: string; email: string }) => void;
};

/** Realtime multiplayer client */
export class NetClient {
  private ws: WebSocket | null = null;
  private handlers: Handlers = {};
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private wantOpen = false;
  private spawn = { x: 0, y: 0, dir: 'down', house: '', zone: 'plaza' };
  peers: Peer[] = [];
  userId: string | null = null;
  connected = false;

  setHandlers(h: Handlers) {
    this.handlers = h;
  }

  connect(opts?: {
    x?: number;
    y?: number;
    dir?: string;
    house?: string;
    zone?: string;
  }) {
    const token = getToken();
    if (!token) {
      this.handlers.onStatus?.('error', 'Sign in to go online');
      return;
    }
    if (opts) this.spawn = { ...this.spawn, ...opts };
    this.wantOpen = true;
    this.open(token);
  }

  private open(token: string) {
    this.closeSocket();
    try {
      this.ws = new WebSocket(WS_URL);
    } catch (e) {
      this.handlers.onStatus?.('error', 'WebSocket failed');
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.connected = true;
      this.handlers.onStatus?.('connected');
      this.send({
        type: 'auth',
        token,
        x: this.spawn.x,
        y: this.spawn.y,
        dir: this.spawn.dir,
        house: this.spawn.house,
        zone: this.spawn.zone,
      });
      this.pingTimer = setInterval(() => this.send({ type: 'ping' }), 20000);
    };

    this.ws.onmessage = (ev) => {
      let msg: any;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.type === 'authed') {
        this.userId = msg.user?.id || null;
        this.handlers.onAuthed?.(msg.user);
      } else if (msg.type === 'peers') {
        this.peers = (msg.peers || []).filter(
          (p: Peer) => p.id !== this.userId
        );
        this.handlers.onPeers?.(this.peers);
      } else if (msg.type === 'connected') {
        this.handlers.onConnected?.(msg.with, msg.name);
      } else if (msg.type === 'chat') {
        this.handlers.onChat?.(msg.from, msg.name, msg.text);
      } else if (msg.type === 'error') {
        this.handlers.onStatus?.('error', msg.error);
      }
    };

    this.ws.onclose = () => {
      this.connected = false;
      this.handlers.onStatus?.('disconnected');
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      if (this.wantOpen) this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.handlers.onStatus?.('error', 'connection error');
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.wantOpen) {
        const t = getToken();
        if (t) this.open(t);
      }
    }, 2500);
  }

  disconnect() {
    this.wantOpen = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.closeSocket();
  }

  private closeSocket() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* */
      }
      this.ws = null;
    }
    this.connected = false;
    this.peers = [];
  }

  send(obj: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  move(x: number, y: number, dir: string, zone: string) {
    this.send({ type: 'move', x, y, dir, zone });
  }

  requestConnect(to: string) {
    this.send({ type: 'connect', to });
  }

  chat(text: string) {
    this.send({ type: 'chat', text });
  }
}

export const net = new NetClient();
