import { API_BASE } from '../config';
import { getToken } from './Api';

const queue: { event: string; props?: Record<string, unknown> }[] = [];
let flushT: ReturnType<typeof setTimeout> | null = null;

/** Optional Sentry-like browser capture via free endpoint pattern */
export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn || typeof window === 'undefined') return;
  window.addEventListener('error', (e) => {
    track('js_error', {
      message: String(e.message || '').slice(0, 200),
      source: String(e.filename || '').slice(0, 120),
    });
  });
  window.addEventListener('unhandledrejection', (e) => {
    track('js_rejection', {
      reason: String((e as PromiseRejectionEvent).reason || '').slice(0, 200),
    });
  });
}

export function track(event: string, props?: Record<string, unknown>) {
  if (import.meta.env.DEV) {
    // quiet in prod console
  }
  queue.push({ event, props });
  if (queue.length > 40) queue.splice(0, queue.length - 40);
  if (flushT) return;
  flushT = setTimeout(() => {
    flushT = null;
    void flush();
  }, 800);
}

async function flush() {
  if (!queue.length) return;
  const batch = queue.splice(0, 20);
  for (const item of batch) {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      const t = getToken();
      if (t) headers.Authorization = 'Bearer ' + t;
      await fetch(`${API_BASE}/api/analytics`, {
        method: 'POST',
        headers,
        body: JSON.stringify(item),
      });
    } catch {
      /* offline */
    }
  }
}

export function trackPage(name: string) {
  track('page', { name });
}
