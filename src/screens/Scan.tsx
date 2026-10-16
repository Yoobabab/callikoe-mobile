import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as Linking from 'expo-linking';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, textStyles } from '../components/ui';
import { isProvisionUrl, MSG_NOT_CALLIKOE_QR, provisionUrlFromDeepLink } from '../lib/provision';
import { colors, radius, spacing } from '../theme';

type Props = { onScanned: (provisionUrl: string) => void; onCancel: () => void };

export default function Scan({ onScanned, onCancel }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState<string | null>(null);
  const handled = useRef(false);
  const lastRejected = useRef<string | null>(null);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain && permission.status === 'undetermined') {
      requestPermission();
    }
  }, [permission, requestPermission]);

  const onBarcode = useCallback(
    ({ data }: BarcodeScanningResult) => {
      if (handled.current) return;
      const text = (data ?? '').trim();
      const url = isProvisionUrl(text) ? text : provisionUrlFromDeepLink(text);
      if (url) {
        handled.current = true;
        onScanned(url);
        return;
      }
      if (lastRejected.current !== text) {
        lastRejected.current = text;
        setError(MSG_NOT_CALLIKOE_QR);
      }
    },
    [onScanned],
  );

  if (!permission) {
    return (
      <View style={[styles.safe, styles.center]}>
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={[styles.safe, styles.center, styles.padded]}>
        <Text style={[textStyles.h2, styles.centerText]}>Accès à la caméra</Text>
        <Text style={[textStyles.muted, styles.centerText, styles.gap]}>
          Callikoe a besoin de la caméra uniquement pour scanner le QR code de configuration de ton poste. Aucune image
          n'est enregistrée.
        </Text>
        {permission.canAskAgain ? (
          <Button title="Autoriser la caméra" onPress={requestPermission} style={styles.fullWidth} />
        ) : (
          <Button title="Ouvrir les réglages" onPress={() => Linking.openSettings()} style={styles.fullWidth} />
        )}
        <Button title="Réessayer" variant="secondary" onPress={requestPermission} style={styles.fullWidth} />
        <Button title="Retour" variant="secondary" onPress={onCancel} style={styles.fullWidth} />
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.safe}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={onBarcode}
      />
      <SafeAreaView style={styles.overlay} pointerEvents="box-none">
        <Text style={styles.overlayTitle}>Vise le QR code Callikoe</Text>
        <View style={styles.frame} />
        <View style={styles.overlayBottom}>
          {error ? (
            <View style={styles.errorBox}>
              <Text style={textStyles.error}>{error}</Text>
            </View>
          ) : null}
          <Button title="Annuler" variant="secondary" onPress={onCancel} />
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  padded: { paddingHorizontal: spacing.lg, gap: spacing.md },
  centerText: { textAlign: 'center' },
  gap: { marginBottom: spacing.md },
  fullWidth: { alignSelf: 'stretch' },
  overlay: { flex: 1, justifyContent: 'space-between', alignItems: 'center', padding: spacing.lg },
  overlayTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: spacing.lg,
    textShadowColor: '#000',
    textShadowRadius: 6,
  },
  frame: {
    width: 240,
    height: 240,
    borderRadius: radius.lg,
    borderWidth: 3,
    borderColor: colors.gradient[0],
  },
  overlayBottom: { alignSelf: 'stretch', gap: spacing.md },
  errorBox: { backgroundColor: 'rgba(22,20,26,0.9)', borderRadius: radius.md, padding: spacing.md },
});
