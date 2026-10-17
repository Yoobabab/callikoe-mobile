import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';
import { colors } from '../theme';
import type { Account } from './account';

/**
 * Couleurs de l'appli : celles du thème choisi dans la console du serveur multi-tenant du compte actif
 * (Paramètres › Apparence), lues sur `https://<PBX>/theme.json`. Sans thème : couleurs Callikoe.
 */
export type Brand = { primary: string; gradient: readonly [string, string, ...string[]] };
export const DEFAULT_BRAND: Brand = { primary: colors.primary, gradient: colors.gradient };
const CACHE_KEY = 'callikoe.brand';
const HEX = /^#[0-9a-f]{6}$/i;

let current: Brand = DEFAULT_BRAND;
const listeners = new Set<() => void>();
function setBrand(b: Brand) {
  if (b.primary === current.primary && b.gradient.join() === current.gradient.join()) return;
  current = b;
  listeners.forEach((l) => l());
}
/** Couleurs à utiliser dans un composant (se met à jour quand le thème change) */
export function useBrand(): Brand {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => current);
}

/** Réponse de /theme.json → couleurs (null si illisible) */
export function brandFromTheme(data: unknown): Brand | null {
  const d = data as { color?: unknown; gradient?: unknown };
  if (!d || typeof d.color !== 'string' || !HEX.test(d.color)) return null;
  const g = Array.isArray(d.gradient) ? d.gradient.filter((x): x is string => typeof x === 'string' && HEX.test(x)) : [];
  return { primary: d.color, gradient: g.length >= 2 ? (g as unknown as Brand['gradient']) : [d.color, d.color] };
}
/** Adresse du thème du PBX d'un compte */
export function themeUrl(account: Pick<Account, 'app_login_url'>): string | null {
  const m = /^(https?:\/\/[^/]+)/.exec(account.app_login_url || '');
  return m ? `${m[1]}/theme.json` : null;
}

/** Au démarrage : dernières couleurs connues (affichage immédiat, sans attendre le réseau) */
export async function loadCachedBrand(): Promise<void> {
  try {
    const raw = await SecureStore.getItemAsync(CACHE_KEY);
    const b = raw ? brandFromTheme(JSON.parse(raw)) : null;
    if (b) setBrand(b);
  } catch { /* couleurs Callikoe */ }
}
/** Compte actif changé (ou appli rouverte) : couleurs de son serveur ; sans compte, couleurs Callikoe */
export async function refreshBrand(account: Account | null, timeoutMs = 6000): Promise<void> {
  if (!account) { setBrand(DEFAULT_BRAND); return; }
  const url = themeUrl(account);
  if (!url) return;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    const data = r.ok ? await r.json() : null;
    const b = brandFromTheme(data) ?? DEFAULT_BRAND;   // PBX sans thème (ancienne version) : couleurs Callikoe
    setBrand(b);
    await SecureStore.setItemAsync(CACHE_KEY, JSON.stringify({ color: b.primary, gradient: b.gradient }));
  } catch { /* hors ligne : on garde les couleurs connues */ } finally { clearTimeout(t); }
}
