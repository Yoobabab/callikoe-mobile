import * as Linking from 'expo-linking';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { loadAccount, saveAccount, type Account } from './src/lib/account';
import { MSG_NOT_CALLIKOE_QR, provisionUrlFromDeepLink } from './src/lib/provision';
import Confirm from './src/screens/Confirm';
import Phone from './src/screens/Phone';
import Scan from './src/screens/Scan';
import Welcome from './src/screens/Welcome';
import { colors } from './src/theme';

/** Navigation minimale basée sur un état (pas de react-navigation). */
type Route =
  | { name: 'loading' }
  | { name: 'welcome'; error?: string | null }
  | { name: 'scan' }
  | { name: 'confirm'; provisionUrl: string }
  | { name: 'phone' };

export default function App() {
  const [route, setRoute] = useState<Route>({ name: 'loading' });
  const [account, setAccount] = useState<Account | null>(null);

  const home = useCallback((acc: Account | null) => setRoute(acc ? { name: 'phone' } : { name: 'welcome' }), []);

  const handleLink = useCallback((link: string | null): boolean => {
    if (!link || !/^callikoe:/i.test(link)) return false;
    if (!/^callikoe:\/\/\/?provision/i.test(link)) return false;
    const url = provisionUrlFromDeepLink(link);
    if (url) setRoute({ name: 'confirm', provisionUrl: url });
    else setRoute({ name: 'welcome', error: MSG_NOT_CALLIKOE_QR });
    return true;
  }, []);

  // Démarrage : compte enregistré + lien d'ouverture éventuel (callikoe://provision?url=…)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [acc, initialUrl] = await Promise.all([loadAccount(), Linking.getInitialURL().catch(() => null)]);
      if (cancelled) return;
      setAccount(acc);
      if (!handleLink(initialUrl)) home(acc);
    })();
    const sub = Linking.addEventListener('url', ({ url }) => handleLink(url));
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [handleLink, home]);

  const onConfirm = useCallback(async (acc: Account) => {
    await saveAccount(acc);
    setAccount(acc);
    setRoute({ name: 'phone' });
  }, []);

  let screen: ReactNode;
  switch (route.name) {
    case 'loading':
      screen = (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.text} />
        </View>
      );
      break;
    case 'welcome':
      screen = <Welcome error={route.error} onScan={() => setRoute({ name: 'scan' })} />;
      break;
    case 'scan':
      screen = (
        <Scan
          onScanned={(provisionUrl) => setRoute({ name: 'confirm', provisionUrl })}
          onCancel={() => home(account)}
        />
      );
      break;
    case 'confirm':
      screen = (
        <Confirm
          provisionUrl={route.provisionUrl}
          onConfirm={onConfirm}
          onRescan={() => setRoute({ name: 'scan' })}
          onCancel={() => home(account)}
        />
      );
      break;
    case 'phone':
      screen = account ? (
        <Phone
          account={account}
          onLoggedOut={() => {
            setAccount(null);
            setRoute({ name: 'welcome' });
          }}
        />
      ) : (
        <Welcome onScan={() => setRoute({ name: 'scan' })} />
      );
      break;
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <View style={styles.root}>{screen}</View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
});
