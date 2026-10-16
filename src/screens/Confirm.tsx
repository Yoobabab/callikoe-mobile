import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, GradientDot, InfoRow, textStyles } from '../components/ui';
import type { Account } from '../lib/account';
import { fetchProvisioning } from '../lib/provision';
import { colors, spacing } from '../theme';

type Props = {
  provisionUrl: string;
  onConfirm: (account: Account) => Promise<void>;
  onRescan: () => void;
  onCancel: () => void;
};

export default function Confirm({ provisionUrl, onConfirm, onRescan, onCancel }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetchProvisioning(provisionUrl);
    if (res.ok) setAccount(res.account);
    else setError(res.error);
    setLoading(false);
  }, [provisionUrl]);

  useEffect(() => {
    load();
  }, [load]);

  const confirm = async () => {
    if (!account) return;
    setSaving(true);
    try {
      await onConfirm(account);
    } catch {
      setError("Impossible d'enregistrer le poste sur ce téléphone.");
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <GradientDot size={56} />
        <Text style={[textStyles.h2, styles.headerTitle]}>Configuration du poste</Text>
      </View>

      <View style={styles.body}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.text} size="large" />
            <Text style={[textStyles.muted, styles.loadingText]}>Connexion au PBX…</Text>
          </View>
        ) : account ? (
          <Card>
            <Text style={styles.cardTitle}>
              Poste {account.extension}
              {account.name ? ` · ${account.name}` : ''} · {account.pbx}
            </Text>
            <InfoRow label="PBX" value={account.pbx} />
            <InfoRow label="Poste" value={account.extension} />
            <InfoRow label="Nom" value={account.name} />
            <InfoRow label="Serveur" value={account.fqdn || account.host} />
          </Card>
        ) : (
          <View style={styles.center}>
            <Text style={textStyles.error}>{error}</Text>
          </View>
        )}
        {account && error ? <Text style={[textStyles.error, styles.loadingText]}>{error}</Text> : null}
      </View>

      <View style={styles.actions}>
        {account ? (
          <Button title="Utiliser ce poste" onPress={confirm} loading={saving} />
        ) : !loading ? (
          <>
            <Button title="Réessayer" onPress={load} />
            <Button title="Scanner un autre QR code" variant="secondary" onPress={onRescan} />
          </>
        ) : null}
        <Button title="Annuler" variant="secondary" onPress={onCancel} disabled={saving} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.lg },
  header: { alignItems: 'center', marginTop: spacing.xl, gap: spacing.md },
  headerTitle: { textAlign: 'center' },
  body: { flex: 1, justifyContent: 'center' },
  center: { alignItems: 'center' },
  loadingText: { marginTop: spacing.md },
  cardTitle: { color: colors.text, fontSize: 18, fontWeight: 'bold', marginBottom: spacing.sm },
  actions: { gap: spacing.md, paddingBottom: spacing.lg },
});
