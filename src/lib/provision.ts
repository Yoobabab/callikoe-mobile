import type { Account } from './account';

/** URL de provisioning contenue dans le QR code généré par la console du PBX. */
export const PROVISION_URL_RE = /^https?:\/\/[^/]+\/app\/provision\?t=[A-Za-z0-9_-]{20,}$/;

export const MSG_NOT_CALLIKOE_QR = "Ce QR code n'est pas un QR code Callikoe.";
export const MSG_NETWORK = 'Impossible de joindre le PBX : vérifie ta connexion.';
export const MSG_BAD_RESPONSE = 'Réponse inattendue du PBX : configuration impossible.';

export function isProvisionUrl(text: string): boolean {
  return PROVISION_URL_RE.test(text.trim());
}

/**
 * Extrait l'URL de provisioning d'un lien `callikoe://provision?url=<encodé>`.
 * Retourne null si le lien n'est pas un lien de provisioning valide.
 */
export function provisionUrlFromDeepLink(link: string): string | null {
  const m = /^callikoe:\/\/\/?provision\?(.*)$/i.exec(link.trim());
  if (!m) return null;
  for (const part of m[1].split('&')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq) !== 'url') continue;
    let value: string;
    try {
      value = decodeURIComponent(part.slice(eq + 1).replace(/\+/g, ' '));
    } catch {
      return null;
    }
    return isProvisionUrl(value) ? value.trim() : null;
  }
  return null;
}

/** URL à appeler pour récupérer la configuration au format JSON. */
export function buildProvisionRequestUrl(provisionUrl: string): string {
  return `${provisionUrl.trim()}&format=json`;
}

function str(v: unknown): string | null {
  if (typeof v === 'string' && v.length > 0) return v;
  if (typeof v === 'number') return String(v);
  return null;
}

function port(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseInt(v, 10) : NaN;
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : fallback;
}

function isHttpUrl(v: string | null): v is string {
  return !!v && /^https?:\/\/[^\s]+$/.test(v);
}

/** Valide et normalise la réponse JSON du PBX. Retourne null si elle est incomplète. */
export function parseAccount(data: unknown): Account | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const extension = str(d.extension);
  const device_token = str(d.device_token);
  const app_login_url = str(d.app_login_url);
  const logout_url = str(d.logout_url);
  const host = str(d.host) ?? str(d.fqdn);
  if (!extension || !device_token || !host || !isHttpUrl(app_login_url) || !isHttpUrl(logout_url)) {
    return null;
  }
  const softphone = str(d.softphone_url);
  const ports = (d.ports && typeof d.ports === 'object' ? d.ports : {}) as Record<string, unknown>;
  return {
    pbx: str(d.pbx) ?? host,
    extension,
    name: str(d.name) ?? '',
    auth_id: str(d.auth_id) ?? '',
    password: str(d.password) ?? '',
    host,
    fqdn: str(d.fqdn) ?? host,
    ports: {
      udp: port(ports.udp, 5060),
      tcp: port(ports.tcp, 5060),
      tls: port(ports.tls, 5061),
    },
    voicemail: str(d.voicemail) ?? '',
    device_token,
    app_login_url,
    softphone_url: isHttpUrl(softphone) ? softphone : '',
    logout_url,
  };
}

/** Message d'erreur à afficher pour une réponse HTTP en échec. */
export function errorMessageFromResponse(status: number, body: unknown): string {
  if (body && typeof body === 'object') {
    const e = (body as Record<string, unknown>).error;
    if (typeof e === 'string' && e.trim()) return e.trim();
  }
  if (status === 404) return 'QR code invalide ou expiré.';
  if (status === 429) return 'Trop de tentatives : réessaie dans quelques minutes.';
  return `Le PBX a refusé la configuration (erreur ${status}).`;
}

/** URL chargée dans la WebView : connexion par jeton d'appareil. */
export function buildLoginUrl(account: Pick<Account, 'app_login_url' | 'device_token'>): string {
  const sep = account.app_login_url.includes('?') ? '&' : '?';
  return `${account.app_login_url}${sep}d=${encodeURIComponent(account.device_token)}`;
}

export type ProvisionResult = { ok: true; account: Account } | { ok: false; error: string };

export async function fetchProvisioning(provisionUrl: string, timeoutMs = 15000): Promise<ProvisionResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(buildProvisionRequestUrl(provisionUrl), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
  } catch {
    return { ok: false, error: MSG_NETWORK };
  } finally {
    clearTimeout(timer);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) return { ok: false, error: errorMessageFromResponse(res.status, body) };
  const account = parseAccount(body);
  if (!account) return { ok: false, error: MSG_BAD_RESPONSE };
  return { ok: true, account };
}
