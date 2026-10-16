import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, InfoRow, textStyles } from '../components/ui';
import { clearAccount, logoutDevice, type Account } from '../lib/account';
import { APP_VERSION, colors, spacing } from '../theme';

type Props = {
  account: Account;
  onClose: () => void;
  onReload: () => void;
  onLoggedOut: () => void;
};

export default function Settings({ account, onClose, onReload, onLoggedOut }: Props) {
  const [busy, setBusy] = useState(false);

  const disconnect = () => {
    Alert.alert(
      'Déconnecter ce téléphone ?',
      `Le poste ${account.extension} ne sonnera plus sur ce téléphone. Il faudra rescanner un QR code pour le reconnecter.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Déconnecter',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            await logoutDevice(account);
            try {
              await clearAccount();
            } catch {
              // on revient quand même à l'accueil
            }
            onLoggedOut();
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={textStyles.h2}>Réglages</Text>
        <Button title="Fermer" variant="secondary" onPress={onClose} style={styles.close} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Card>
          <InfoRow label="PBX" value={account.pbx} />
          <InfoRow label="Poste" value={account.extension} />
          <InfoRow label="Nom" value={account.name} />
          <InfoRow label="Serveur" value={account.fqdn || account.host} />
          {account.voicemail ? <InfoRow label="Messagerie" value={account.voicemail} /> : null}
        </Card>

        <Button title="Recharger" variant="secondary" onPress={onReload} disabled={busy} />
        <Button title="Déconnecter ce téléphone" variant="danger" onPress={disconnect} loading={busy} />

        <Text style={[textStyles.muted, styles.version]}>Callikoe mobile {APP_VERSION}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  close: { minWidth: 100 },
  content: { padding: spacing.lg, gap: spacing.md },
  version: { textAlign: 'center', marginTop: spacing.lg },
});
