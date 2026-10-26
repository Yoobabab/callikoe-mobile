import { requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio';
import * as Linking from 'expo-linking';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, AppState, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { Button, textStyles } from '../components/ui';
import { accountId, type Account } from '../lib/account';
import { buildInjectedAppInfo, hostOf, isFromHosts, OPEN_WEB_SETTINGS_JS, parseWebMessage } from '../lib/bridge';
import { buildLoginUrl } from '../lib/provision';
import { colors, spacing } from '../theme';
import MenuSheet from './MenuSheet';
import CallOverlay from './CallOverlay';
import { dial, initNativeCalls } from '../lib/nativeCalls';

type Props = {
  account: Account;
  /** Incrémenté par l'appli pour forcer un rechargement (ex. compte re-sélectionné). */
  reloadToken: number;
  onOpenAccounts: () => void;
  onScan: () => void;
};

type MicState = 'pending' | 'granted' | 'denied';

const INJECTED_APP_INFO = buildInjectedAppInfo(Platform.OS, initNativeCalls());

/** Pendant un appel : le son sort par l'écouteur (oreille), ou par le haut-parleur si on l'a demandé. */
let routeTimers: ReturnType<typeof setTimeout>[] = [];
function applyRoute(call: boolean, speaker: boolean) {
  setAudioModeAsync({
    playsInSilentMode: true,
    allowsRecording: true,
    interruptionMode: call ? 'doNotMix' : 'mixWithOthers',
    shouldRouteThroughEarpiece: call && !speaker,
  }).catch(() => {});
}
function routeAudio(call: boolean, speaker: boolean) {
  // La page web règle elle aussi le son de l'iPhone quand le micro et le son de l'appel démarrent :
  // on redemande l'écouteur plusieurs fois pendant les premières secondes pour avoir le dernier mot.
  routeTimers.forEach(clearTimeout);
  applyRoute(call, speaker);
  routeTimers = call ? [300, 900, 2000, 4000].map((ms) => setTimeout(() => applyRoute(call, speaker), ms)) : [];
}

export default function Phone({ account, reloadToken, onOpenAccounts, onScan }: Props) {
  // `WebView<{}>` : avec le paramètre par défaut (undefined), les typages de react-native-webview réduisent les props à `never`.
  const webRef = useRef<WebView<{}>>(null);
  const [mic, setMic] = useState<MicState>('pending');
  const [localReload, setLocalReload] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);

  const loginUrl = useMemo(() => buildLoginUrl(account), [account]);
  const trustedHosts = useMemo(
    () => [account.host, account.fqdn, hostOf(account.app_login_url), hostOf(account.softphone_url)],
    [account],
  );
  // Changer de compte ou demander un rechargement remonte la WebView (nouvelle connexion par jeton).
  const webKey = `${accountId(account)}#${reloadToken}#${localReload}`;

  const askMic = useCallback(async () => {
    try {
      const res = await requestRecordingPermissionsAsync();
      setMic(res.granted ? 'granted' : 'denied');
    } catch {
      setMic('denied');
    }
  }, []);

  useEffect(() => {
    askMic();
  }, [askMic]);

  useEffect(() => {
    setLoadError(null);
    setLoading(true);
  }, [webKey]);

  const reload = useCallback(() => setLocalReload((k) => k + 1), []);

  // Le son revient à la normale si la page est rechargée ou quittée pendant un appel (changement de compte, plantage…)
  useEffect(() => () => routeAudio(false, false), [webKey]);

  // La session du softphone dure 12 h : au retour au premier plan après ~11 h, on se reconnecte avec le jeton du téléphone
  const loadedAt = useRef(Date.now());
  useEffect(() => { loadedAt.current = Date.now(); }, [webKey]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active' && Date.now() - loadedAt.current > 11 * 3600_000) reload();
    });
    return () => sub.remove();
  }, [reload]);

  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      if (!isFromHosts(e.nativeEvent.url, trustedHosts)) return;
      const msg = parseWebMessage(e.nativeEvent.data);
      if (msg?.type === 'menu') setMenuOpen(true);
      else if (msg?.type === 'audio') routeAudio(msg.call, msg.speaker);
      else if (msg?.type === 'accounts') onOpenAccounts();
      else if (msg?.type === 'dial') dial(msg.number, msg.name).catch(() => {});
    },
    [trustedHosts, onOpenAccounts],
  );

  let content: ReactNode;
  if (mic === 'pending') {
    content = (
      <View style={styles.center}>
        <ActivityIndicator color={colors.text} />
      </View>
    );
  } else if (mic === 'denied') {
    content = (
      <View style={[styles.center, styles.padded]}>
        <Text style={[textStyles.h2, styles.centerText]}>Micro désactivé</Text>
        <Text style={[textStyles.muted, styles.centerText]}>
          Sans accès au micro, ton correspondant ne t'entendra pas. Autorise le micro pour Callikoe dans les réglages de
          ton téléphone, puis reviens ici.
        </Text>
        <Button title="Ouvrir les réglages" onPress={() => Linking.openSettings()} style={styles.fullWidth} />
        <Button title="Réessayer" variant="secondary" onPress={askMic} style={styles.fullWidth} />
        <Button title="Comptes" variant="secondary" onPress={onOpenAccounts} style={styles.fullWidth} />
      </View>
    );
  } else if (loadError) {
    content = (
      <View style={[styles.center, styles.padded]}>
        <Text style={[textStyles.h2, styles.centerText]}>Softphone indisponible</Text>
        <Text style={[textStyles.muted, styles.centerText]}>{loadError}</Text>
        <Button title="Réessayer" onPress={reload} style={styles.fullWidth} />
        <Button title="Comptes" variant="secondary" onPress={onOpenAccounts} style={styles.fullWidth} />
      </View>
    );
  } else {
    content = (
      <View style={styles.webWrap}>
        <WebView
          ref={webRef}
          key={webKey}
          source={{ uri: loginUrl }}
          style={styles.web}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          javaScriptEnabled
          domStorageEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"
          originWhitelist={['https://*', 'http://*']}
          setSupportMultipleWindows={false}
          injectedJavaScriptBeforeContentLoaded={INJECTED_APP_INFO}
          onMessage={onMessage}
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => setLoading(false)}
          onError={(e) =>
            setLoadError(
              `Impossible de charger le softphone : vérifie ta connexion et le certificat HTTPS du PBX. (${e.nativeEvent.description || 'erreur réseau'})`,
            )
          }
          onHttpError={(e) => {
            const code = e.nativeEvent.statusCode;
            if (code === 401 || code === 403) {
              setLoadError("Ce téléphone n'est plus autorisé sur ce compte (accès retiré ou expiré). Supprime le compte dans Comptes, puis scanne un nouveau QR code.");
            } else if (code >= 500) {
              setLoadError(`Le PBX a répondu avec une erreur (${code}).`);
            }
          }}
          onShouldStartLoadWithRequest={(req) => {
            if (req.url === 'about:blank' || req.isTopFrame === false) return true;
            // Pages du PBX dans l'appli ; les autres sites (lien dans un message…) s'ouvrent dans le navigateur
            if (/^https?:/i.test(req.url) && trustedHosts.includes(hostOf(req.url))) return true;
            Linking.openURL(req.url).catch(() => {});
            return false;
          }}
          onContentProcessDidTerminate={reload}
          onRenderProcessGone={reload}
        />
        {loading ? (
          <View style={styles.loadingOverlay} pointerEvents="none">
            <ActivityIndicator color={colors.text} size="large" />
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {content}
      <CallOverlay />
      <MenuSheet
        visible={menuOpen}
        account={account}
        onClose={() => setMenuOpen(false)}
        onAccounts={() => {
          setMenuOpen(false);
          onOpenAccounts();
        }}
        onWebSettings={() => {
          webRef.current?.injectJavaScript(OPEN_WEB_SETTINGS_JS);
          setMenuOpen(false);
        }}
        onScan={() => {
          setMenuOpen(false);
          onScan();
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  padded: { paddingHorizontal: spacing.lg, gap: spacing.md },
  centerText: { textAlign: 'center' },
  fullWidth: { alignSelf: 'stretch' },
  webWrap: { flex: 1 },
  web: { flex: 1, backgroundColor: colors.background },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
});
