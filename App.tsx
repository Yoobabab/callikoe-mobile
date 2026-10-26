import * as Linking from 'expo-linking';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  accountId,
  loadAccounts,
  logoutDevice,
  removeAccountById,
  resolveActiveId,
  saveAccounts,
  upsertAccount,
  type Account,
  type AccountsState,
} from './src/lib/account';
import { MSG_NOT_CALLIKOE_QR, provisionUrlFromDeepLink } from './src/lib/provision';
import Accounts from './src/screens/Accounts';
import Confirm from './src/screens/Confirm';
import Phone from './src/screens/Phone';
import Scan from './src/screens/Scan';
import Welcome from './src/screens/Welcome';
import { loadCachedBrand, refreshBrand } from './src/lib/brand';
import { initNativeCalls, setNativeAccounts } from './src/lib/nativeCalls';
import { colors } from './src/theme';

/**
 * Navigation minimale basée sur un état (pas de react-navigation).
 * Quand au moins un compte existe, l'écran Téléphone (WebView) reste monté en dessous
 * et les autres écrans s'affichent par-dessus : un appel en cours n'est pas coupé.
 */
type Origin = 'main' | 'accounts' | 'welcome';
type Route =
  | { name: 'loading' }
  | { name: 'main' }
  | { name: 'welcome'; error?: string | null }
  | { name: 'scan'; from: Origin }
  | { name: 'confirm'; provisionUrl: string; from: Origin }
  | { name: 'accounts' };

export default function App() {
  const [route, setRoute] = useState<Route>({ name: 'loading' });
  const [state, setState] = useState<AccountsState>({ accounts: [], activeId: null });
  const [reloadToken, setReloadToken] = useState(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  const hasAccounts = state.accounts.length > 0;
  const active: Account | null = state.accounts.find((a) => accountId(a) === state.activeId) ?? null;

  // Couleurs du thème du serveur du compte actif (Paramètres › Apparence de la console multi-tenant)
  useEffect(() => { loadCachedBrand(); }, []);
  const activeKey = active ? accountId(active) : '';
  useEffect(() => { refreshBrand(active); }, [activeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Appels natifs (vraie version de l'appli) : notifications de chaque PBX, ligne du compte actif
  const accountsKey = state.accounts.map(accountId).join('|');
  useEffect(() => { initNativeCalls(); setNativeAccounts(stateRef.current.accounts, active); }, [accountsKey, activeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const goBack = useCallback((from: Origin) => {
    if (!stateRef.current.accounts.length) setRoute({ name: 'welcome' });
    else setRoute(from === 'accounts' ? { name: 'accounts' } : { name: 'main' });
  }, []);

  const handleLink = useCallback((link: string | null, from: Origin): boolean => {
    if (!link || !/^callikoe:\/\/\/?provision/i.test(link)) return false;
    const url = provisionUrlFromDeepLink(link);
    if (url) setRoute({ name: 'confirm', provisionUrl: url, from });
    else if (stateRef.current.accounts.length) setRoute({ name: 'main' });
    else setRoute({ name: 'welcome', error: MSG_NOT_CALLIKOE_QR });
    return true;
  }, []);

  // Démarrage : comptes enregistrés + lien d'ouverture éventuel (callikoe://provision?url=…)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [loaded, initialUrl] = await Promise.all([loadAccounts(), Linking.getInitialURL().catch(() => null)]);
      if (cancelled) return;
      setState(loaded);
      stateRef.current = loaded;
      const from: Origin = loaded.accounts.length ? 'main' : 'welcome';
      if (!handleLink(initialUrl, from)) setRoute(loaded.accounts.length ? { name: 'main' } : { name: 'welcome' });
    })();
    const sub = Linking.addEventListener('url', ({ url }) =>
      handleLink(url, stateRef.current.accounts.length ? 'main' : 'welcome'),
    );
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [handleLink]);

  const persist = useCallback(async (next: AccountsState) => {
    const fixed = { ...next, activeId: resolveActiveId(next.accounts, next.activeId) };
    await saveAccounts(fixed);
    setState(fixed);
    stateRef.current = fixed;
    return fixed;
  }, []);

  /** QR scanné et confirmé : ajoute le compte (ou remplace celui qui a le même identifiant) et l'active. */
  const onConfirm = useCallback(
    async (acc: Account) => {
      // Même compte scanné à nouveau : l'ancien jeton du téléphone est retiré du PBX (sinon il resterait valable)
      const old = stateRef.current.accounts.find((a) => accountId(a) === accountId(acc));
      if (old && old.device_token !== acc.device_token) logoutDevice(old).catch(() => {});
      await persist({ accounts: upsertAccount(stateRef.current.accounts, acc), activeId: accountId(acc) });
      setReloadToken((t) => t + 1);
      setRoute({ name: 'main' });
    },
    [persist],
  );

  const onSelect = useCallback(
    async (id: string) => {
      try {
        await persist({ accounts: stateRef.current.accounts, activeId: id });
      } catch {
        // le choix reste valable pour cette session
      }
      setReloadToken((t) => t + 1);
      setRoute({ name: 'main' });
    },
    [persist],
  );

  const onDelete = useCallback(
    async (id: string) => {
      const acc = stateRef.current.accounts.find((a) => accountId(a) === id);
      if (acc) await logoutDevice(acc);
      const accounts = removeAccountById(stateRef.current.accounts, id);
      let next: AccountsState = { accounts, activeId: stateRef.current.activeId };
      try {
        next = await persist(next);
      } catch {
        next = { accounts, activeId: resolveActiveId(accounts, next.activeId) };
        setState(next);
        stateRef.current = next;
      }
      if (!next.accounts.length) setRoute({ name: 'welcome' });
    },
    [persist],
  );

  let overlay: ReactNode = null;
  switch (route.name) {
    case 'loading':
      overlay = (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.text} />
        </View>
      );
      break;
    case 'welcome':
      overlay = <Welcome error={route.error} onScan={() => setRoute({ name: 'scan', from: 'welcome' })} />;
      break;
    case 'scan': {
      const from = route.from;
      overlay = (
        <Scan
          onScanned={(provisionUrl) => setRoute({ name: 'confirm', provisionUrl, from })}
          onCancel={() => goBack(from)}
        />
      );
      break;
    }
    case 'confirm': {
      const from = route.from;
      overlay = (
        <Confirm
          provisionUrl={route.provisionUrl}
          onConfirm={onConfirm}
          onRescan={() => setRoute({ name: 'scan', from })}
          onCancel={() => goBack(from)}
        />
      );
      break;
    }
    case 'accounts':
      overlay = (
        <Accounts
          accounts={state.accounts}
          activeId={state.activeId}
          onBack={() => setRoute({ name: 'main' })}
          onAdd={() => setRoute({ name: 'scan', from: 'accounts' })}
          onSelect={onSelect}
          onDelete={onDelete}
        />
      );
      break;
    case 'main':
      if (!hasAccounts) overlay = <Welcome onScan={() => setRoute({ name: 'scan', from: 'welcome' })} />;
      break;
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <View style={styles.root}>
        {active ? (
          <Phone
            account={active}
            reloadToken={reloadToken}
            onOpenAccounts={() => setRoute({ name: 'accounts' })}
            onScan={() => setRoute({ name: 'scan', from: 'main' })}
          />
        ) : null}
        {overlay ? <View style={StyleSheet.absoluteFill}>{overlay}</View> : null}
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
});
