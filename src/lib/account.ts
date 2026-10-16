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

export const ACCOUNT_KEY = 'callikoe.account';

export async function loadAccount(): Promise<Account | null> {
  try {
    const raw = await SecureStore.getItemAsync(ACCOUNT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Account;
    return parsed && parsed.device_token && parsed.app_login_url ? parsed : null;
  } catch {
    return null;
  }
}

export async function saveAccount(account: Account): Promise<void> {
  await SecureStore.setItemAsync(ACCOUNT_KEY, JSON.stringify(account));
}

export async function clearAccount(): Promise<void> {
  await SecureStore.deleteItemAsync(ACCOUNT_KEY);
}

/** Prévient le PBX que ce téléphone est déconnecté (les erreurs réseau sont ignorées). */
export async function logoutDevice(account: Account, timeoutMs = 8000): Promise<void> {
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
    // Ignoré : on déconnecte quand même le téléphone localement.
  } finally {
    clearTimeout(timer);
  }
}

export function accountLabel(account: Pick<Account, 'extension' | 'pbx'>): string {
  return `Poste ${account.extension} · ${account.pbx}`;
}
