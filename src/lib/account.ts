import * as SecureStore from 'expo-secure-store';

export type Account = {
  pbx: string;
  extension: string;
  name: string;
  auth_id: string;
  password: string;
  host: string;
  fqdn: string;
  ports: { udp: number; tcp: number; tls: number };
  voicemail: string;
  device_token: string;
  app_login_url: string;
  softphone_url: string;
  logout_url: string;
};

/** Liste des comptes (JSON) dans le trousseau sécurisé. */
export const ACCOUNTS_KEY = 'callikoe.accounts';
/** Identifiant du compte actif. */
export const ACTIVE_KEY = 'callikoe.active';
/** Ancienne clé (v0.1 mono-compte), migrée automatiquement. */
const LEGACY_ACCOUNT_KEY = 'callikoe.account';

export type AccountsState = { accounts: Account[]; activeId: string | null };

/** Identifiant unique d'un compte : `201@test-greg.callikoe.fr`. */
export function accountId(account: Pick<Account, 'extension' | 'host'>): string {
  return `${account.extension}@${account.host}`;
}

function isAccount(v: unknown): v is Account {
  if (!v || typeof v !== 'object') return false;
  const a = v as Record<string, unknown>;
  return (
    typeof a.extension === 'string' &&
    typeof a.host === 'string' &&
    typeof a.device_token === 'string' &&
    typeof a.app_login_url === 'string'
  );
}

/** Ajoute le compte, ou remplace celui qui a le même identifiant (QR rescanné). */
export function upsertAccount(accounts: Account[], account: Account): Account[] {
  const id = accountId(account);
  const idx = accounts.findIndex((a) => accountId(a) === id);
  if (idx < 0) return [...accounts, account];
  const next = accounts.slice();
  next[idx] = account;
  return next;
}

export function removeAccountById(accounts: Account[], id: string): Account[] {
  return accounts.filter((a) => accountId(a) !== id);
}

/** Retourne un identifiant actif valide (le premier compte si l'actif n'existe plus). */
export function resolveActiveId(accounts: Account[], activeId: string | null): string | null {
  if (activeId && accounts.some((a) => accountId(a) === activeId)) return activeId;
  return accounts.length ? accountId(accounts[0]) : null;
}

export async function loadAccounts(): Promise<AccountsState> {
  let accounts: Account[] = [];
  let activeId: string | null = null;
  try {
    const raw = await SecureStore.getItemAsync(ACCOUNTS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) accounts = parsed.filter(isAccount);
    activeId = await SecureStore.getItemAsync(ACTIVE_KEY);
  } catch {
    accounts = [];
  }
  if (!accounts.length) {
    try {
      const legacy = await SecureStore.getItemAsync(LEGACY_ACCOUNT_KEY);
      const acc: unknown = legacy ? JSON.parse(legacy) : null;
      if (isAccount(acc)) {
        accounts = [acc];
        activeId = accountId(acc);
        await saveAccounts({ accounts, activeId });
        await SecureStore.deleteItemAsync(LEGACY_ACCOUNT_KEY);
      }
    } catch {
      // pas d'ancien compte
    }
  }
  return { accounts, activeId: resolveActiveId(accounts, activeId) };
}

export async function saveAccounts({ accounts, activeId }: AccountsState): Promise<void> {
  if (!accounts.length) {
    await SecureStore.deleteItemAsync(ACCOUNTS_KEY);
    await SecureStore.deleteItemAsync(ACTIVE_KEY);
    return;
  }
  await SecureStore.setItemAsync(ACCOUNTS_KEY, JSON.stringify(accounts));
  const active = resolveActiveId(accounts, activeId);
  if (active) await SecureStore.setItemAsync(ACTIVE_KEY, active);
}

/** Prévient le PBX que ce téléphone n'utilise plus le compte (les erreurs réseau sont ignorées). */
export async function logoutDevice(account: Account, timeoutMs = 8000): Promise<void> {
  if (!account.logout_url) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(account.logout_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ device_token: account.device_token }),
      signal: controller.signal,
    });
  } catch {
    // Ignoré : le compte est quand même supprimé du téléphone.
  } finally {
    clearTimeout(timer);
  }
}

/** Initiales pour l'avatar : « Marie Dupont » → « MD ». */
export function initials(account: Pick<Account, 'name' | 'extension'>): string {
  const words = account.name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return account.extension.slice(0, 3);
  const letters = words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[words.length - 1][0];
  return letters.toUpperCase();
}
