import { API_BASE, AUTH_KEY } from '../config';
import { setSyncState } from './SyncStatus';

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  inviteCode?: string;
};

export type LeaderboardRow = {
  rank: number;
  userId: string;
  name: string;
  score: number;
  shareWorthy?: boolean;
  preview?: string;
};

export type LeaderboardResponse = {
  day: string;
  total: number;
  board: LeaderboardRow[];
  me: LeaderboardRow | null;
  top5Cutoff: number;
};

function token(): string | null {
  try {
    return localStorage.getItem(AUTH_KEY);
  } catch {
    return null;
  }
}

export function setToken(t: string | null) {
  try {
    if (t) localStorage.setItem(AUTH_KEY, t);
    else localStorage.removeItem(AUTH_KEY);
  } catch {
    /* */
  }
}

export function getToken() {
  return token();
}

async function req<T>(
  path: string,
  opts: RequestInit & { auth?: boolean } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string>),
  };
  if (opts.auth !== false) {
    const t = token();
    if (t) headers.Authorization = `Bearer ${t}`;
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...opts,
      headers,
    });
  } catch {
    setSyncState('offline', 'Offline — progress saves on this device');
    throw new Error('Network offline');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 409 && (data as { save?: unknown }).save) {
      setSyncState('conflict', 'Cloud save differs — open Account');
      const err = new Error(
        (data as { error?: string }).error || 'Conflict'
      ) as Error & { conflict?: unknown; serverUpdatedAt?: number };
      err.conflict = (data as { save?: unknown }).save;
      err.serverUpdatedAt = (data as { serverUpdatedAt?: number })
        .serverUpdatedAt;
      throw err;
    }
    throw new Error((data as { error?: string }).error || res.statusText);
  }
  if (stateWasOffline()) setSyncState('online', '');
  return data as T;
}

function stateWasOffline() {
  return !navigator.onLine;
}

export const api = {
  health: () =>
    req<{
      ok: boolean;
      online: number;
      dataWritable?: boolean;
      jwtConfigured?: boolean;
    }>('/api/health', { auth: false }),

  register: (email: string, password: string, name: string) =>
    req<{ token: string; user: AuthUser }>('/api/auth/register', {
      method: 'POST',
      auth: false,
      body: JSON.stringify({ email, password, name }),
    }),

  login: (email: string, password: string) =>
    req<{ token: string; user: AuthUser }>('/api/auth/login', {
      method: 'POST',
      auth: false,
      body: JSON.stringify({ email, password }),
    }),

  forgot: (email: string) =>
    req<{ ok: boolean; message: string; resetToken?: string }>(
      '/api/auth/forgot',
      {
        method: 'POST',
        auth: false,
        body: JSON.stringify({ email }),
      }
    ),

  reset: (token: string, password: string) =>
    req<{ ok: boolean; token: string; user: AuthUser }>('/api/auth/reset', {
      method: 'POST',
      auth: false,
      body: JSON.stringify({ token, password }),
    }),

  me: () => req<{ user: AuthUser }>('/api/me'),

  patchMe: (name: string) =>
    req<{ user: AuthUser }>('/api/me', {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),

  deleteMe: () =>
    req<{ ok: boolean }>('/api/me', {
      method: 'DELETE',
    }),

  submitHook: (text: string, score: number, shareWorthy: boolean) =>
    req<{
      ok: boolean;
      score: number;
      rank: number;
      total: number;
      top5: boolean;
      board: LeaderboardRow[];
    }>('/api/hooks', {
      method: 'POST',
      body: JSON.stringify({ text, score, shareWorthy }),
    }),

  leaderboard: (day?: string) =>
    req<LeaderboardResponse>(
      `/api/leaderboard${day ? `?day=${encodeURIComponent(day)}` : ''}`,
      { auth: true }
    ),

  putProgress: (
    save: unknown,
    opts?: { clientUpdatedAt?: number; force?: boolean }
  ) =>
    req<{ ok: boolean; updatedAt: number }>('/api/progress', {
      method: 'PUT',
      body: JSON.stringify({
        save,
        clientUpdatedAt: opts?.clientUpdatedAt,
        force: opts?.force,
      }),
    }),

  getProgress: () =>
    req<{ save: unknown | null; updatedAt?: number }>('/api/progress'),

  connections: () =>
    req<{ connections: { id: string; name: string; online: boolean }[] }>(
      '/api/connections'
    ),

  connect: (to: string) =>
    req<{ ok: boolean }>('/api/connections', {
      method: 'POST',
      body: JSON.stringify({ to }),
    }),

  submitSeller: (title: string, price: string, email: string) =>
    req<{ ok: boolean; id: string; status: string }>('/api/sellers', {
      method: 'POST',
      body: JSON.stringify({ title, price, email }),
    }),

  mySellers: () =>
    req<{ items: { id: string; title: string; status: string; price: string }[] }>(
      '/api/sellers/mine'
    ),

  claimInvite: (code: string) =>
    req<{ ok: boolean; inviter?: string; already?: boolean }>(
      '/api/invite/claim',
      {
        method: 'POST',
        body: JSON.stringify({ code }),
      }
    ),
};
