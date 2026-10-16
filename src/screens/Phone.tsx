import { requestRecordingPermissionsAsync } from 'expo-audio';
import * as Linking from 'expo-linking';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { Button, GradientDot, textStyles } from '../components/ui';
import { accountLabel, type Account } from '../lib/account';
import { buildLoginUrl } from '../lib/provision';
import { colors, spacing } from '../theme';
import Settings from './Settings';

type Props = { account: Account; onLoggedOut: () => void };

type MicState = 'pending' | 'granted' | 'denied';

export default function Phone({ account, onLoggedOut }: Props) {
  const [mic, setMic] = useState<MicState>('pending');
  const [webKey, setWebKey] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const loginUrl = useMemo(() => buildLoginUrl(account), [account]);

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

  const reload = useCallback(() => {
    setLoadError(null);
    setLoading(true);
    setWebKey((k) => k + 1); // remonte la WebView : nouvelle connexion avec le jeton d'appareil
  }, []);

  const topBar = (
    <View style={styles.topBar}>
      <GradientDot size={14} />
      <Text style={styles.topBarText} numberOfLines={1}>
        {accountLabel(account)}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Réglages"
        hitSlop={12}
        onPress={() => setSettingsOpen(true)}
        style={({ pressed }) => [styles.gear, pressed && { opacity: 0.6 }]}
      >
        <Text style={styles.gearText}>⚙︎</Text>
      </Pressable>
    </View>
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
      </View>
    );
  } else if (loadError) {
    content = (
      <View style={[styles.center, styles.padded]}>
        <Text style={[textStyles.h2, styles.centerText]}>Softphone indisponible</Text>
        <Text style={[textStyles.muted, styles.centerText]}>{loadError}</Text>
        <Button title="Réessayer" onPress={reload} style={styles.fullWidth} />
      </View>
    );
  } else {
    content = (
      <View style={styles.webWrap}>
        <WebView
          key={webKey}
          source={{ uri: loginUrl }}
          style={styles.web}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          javaScriptEnabled
          domStorageEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          mediaCapturePermissionGrantType="grant"
          originWhitelist={['https://*', 'http://*']}
          setSupportMultipleWindows={false}
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => setLoading(false)}
          onError={(e) =>
            setLoadError(
              `Impossible de charger le softphone : vérifie ta connexion et le certificat HTTPS du PBX. (${e.nativeEvent.description || 'erreur réseau'})`,
            )
          }
          onHttpError={(e) => {
            if (e.nativeEvent.statusCode >= 500) {
              setLoadError(`Le PBX a répondu avec une erreur (${e.nativeEvent.statusCode}).`);
            }
          }}
          onShouldStartLoadWithRequest={(req) => {
            if (/^https?:/i.test(req.url) || req.url === 'about:blank') return true;
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
    <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
      {topBar}
      {content}
      <Modal
        visible={settingsOpen}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setSettingsOpen(false)}
      >
        <Settings
          account={account}
          onClose={() => setSettingsOpen(false)}
          onReload={() => {
            setSettingsOpen(false);
            reload();
          }}
          onLoggedOut={() => {
            setSettingsOpen(false);
            onLoggedOut();
          }}
        />
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  topBar: {
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.surfaceBorder,
  },
  topBarText: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '600' },
  gear: { paddingHorizontal: spacing.xs },
  gearText: { color: colors.text, fontSize: 22 },
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
