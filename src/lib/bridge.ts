import { APP_VERSION } from '../theme';

/** Messages envoyés par le softphone web via window.ReactNativeWebView.postMessage(JSON.stringify({ type })). */
export type WebMessage = { type: 'menu' } | { type: 'accounts' } | { type: 'audio'; call: boolean; speaker: boolean };

export function parseWebMessage(data: string): WebMessage | null {
  try {
    const msg: unknown = JSON.parse(data);
    if (!msg || typeof msg !== 'object') return null;
    const type = (msg as Record<string, unknown>).type;
    if (type === 'menu' || type === 'accounts') return { type };
    if (type === 'audio') {
      const m = msg as Record<string, unknown>;
      return { type, call: m.call === true, speaker: m.speaker === true };
    }
    return null;
  } catch {
    return null;
  }
}

/** Script injecté avant le chargement de la page : la page web sait qu'elle tourne dans l'appli. */
export function buildInjectedAppInfo(platform: string): string {
  const info = JSON.stringify({ version: APP_VERSION, platform });
  return `window.CALLIKOE_APP = ${info}; true;`;
}

/** Ouvre la page Réglages du softphone web. */
export const OPEN_WEB_SETTINGS_JS = 'location.hash = "#/reglages"; true;';

/** Vrai si l'URL appartient à l'un des hôtes autorisés (le PBX du compte actif). */
export function isFromHosts(url: string | undefined, hosts: string[]): boolean {
  if (!url) return false;
  const m = /^https?:\/\/([^/:?#]+)/i.exec(url);
  if (!m) return false;
  const host = m[1].toLowerCase();
  return hosts.some((h) => h && h.toLowerCase() === host);
}

export function hostOf(url: string): string {
  const m = /^https?:\/\/([^/:?#]+)/i.exec(url);
  return m ? m[1] : '';
}
