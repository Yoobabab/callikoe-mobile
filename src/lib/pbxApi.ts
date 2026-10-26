import type { Account } from './account';

/** Adresse du PBX d'un compte (https://<pbx>) */
export function originOf(account: Pick<Account, 'app_login_url'>): string {
  const m = /^(https?:\/\/[^/]+)/.exec(account.app_login_url || '');
  return m ? m[1] : '';
}

/** Appel à l'API de l'appli sur le PBX (identifiée par le jeton du téléphone, pas de session web) */
export async function appApi<T = Record<string, unknown>>(account: Account, path: string, body?: Record<string, unknown>, timeoutMs = 8000): Promise<T> {
  const base = originOf(account);
  if (!base) throw new Error('Adresse du PBX inconnue');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const url = body ? `${base}${path}` : `${base}${path}${path.includes('?') ? '&' : '?'}d=${encodeURIComponent(account.device_token)}`;
    const r = await fetch(url, {
      method: body ? 'POST' : 'GET',
      signal: ctrl.signal,
      headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify({ ...body, device_token: account.device_token }) : undefined,
    });
    const data = (await r.json().catch(() => ({}))) as T & { error?: string };
    if (!r.ok) throw Object.assign(new Error(data?.error || `Erreur ${r.status}`), { status: r.status });
    return data;
  } finally {
    clearTimeout(t);
  }
}

export type SipAccount = { username: string; password: string; extension: string; name: string; ws_url: string; domain: string };
