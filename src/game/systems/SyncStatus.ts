/**
 * Online / cloud-sync status banner for production reliability.
 */
export type SyncState = 'online' | 'offline' | 'syncing' | 'error' | 'conflict';

let state: SyncState = navigator.onLine ? 'online' : 'offline';
let lastMsg = '';
let el: HTMLElement | null = null;

export function mountSyncBanner() {
  if (el) return el;
  el = document.createElement('div');
  el.id = 'gi-sync-banner';
  el.setAttribute('role', 'status');
  document.body.appendChild(el);
  window.addEventListener('online', () => setSyncState('online', 'Back online'));
  window.addEventListener('offline', () =>
    setSyncState('offline', 'Offline — progress saves on this device')
  );
  paint();
  return el;
}

export function setSyncState(s: SyncState, msg = '') {
  state = s;
  lastMsg = msg;
  paint();
}

export function getSyncState() {
  return state;
}

function paint() {
  if (!el) return;
  const map: Record<SyncState, { bg: string; text: string }> = {
    online: { bg: '', text: '' },
    offline: {
      bg: '#123253',
      text: lastMsg || 'Offline — progress saves on this device',
    },
    syncing: { bg: '#0A66C2', text: lastMsg || 'Syncing to cloud…' },
    error: { bg: '#D93B4E', text: lastMsg || 'Sync failed — will retry' },
    conflict: {
      bg: '#C98F14',
      text: lastMsg || 'Cloud save differs — open Account to resolve',
    },
  };
  const m = map[state];
  if (!m.text || state === 'online') {
    el.className = 'gi-sync-banner hidden';
    el.textContent = '';
    return;
  }
  el.className = 'gi-sync-banner show';
  el.style.background = m.bg;
  el.textContent = m.text;
}
