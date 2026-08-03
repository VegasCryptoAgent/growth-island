import { API_BASE, AUTH_KEY } from '../config';

export type AuthUser = { id: string; email: string; name: string };

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
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || res.statusText);
  }
  return data as T;
}

export const api = {
  health: () =>
    req<{ ok: boolean; online: number }>('/api/health', { auth: false }),

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

  me: () => req<{ user: AuthUser }>('/api/me'),

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

  putProgress: (save: unknown) =>
    req<{ ok: boolean }>('/api/progress', {
      method: 'PUT',
      body: JSON.stringify({ save }),
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
};
