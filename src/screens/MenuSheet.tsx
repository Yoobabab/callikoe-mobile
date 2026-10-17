import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar } from '../components/ui';
import { initials, type Account } from '../lib/account';
import { APP_VERSION, colors, radius, spacing } from '../theme';
import { useBrand } from '../lib/brand';

type Props = {
  visible: boolean;
  account: Account;
  onClose: () => void;
  onAccounts: () => void;
  onWebSettings: () => void;
  onScan: () => void;
};

export const HELP_TEXT =
  "Le QR code est dans la console de ton PBX ou dans le mail de ton administrateur. Pour appeler, l'application doit rester ouverte.";
export const ABOUT_TEXT = `Callikoe mobile ${APP_VERSION} · IRT NETWORK`;

/** Menu natif ouvert par le softphone web ({"type":"menu"}), sur le modèle de l'appli 3CX. */
export default function MenuSheet({ visible, account, onClose, onAccounts, onWebSettings, onScan }: Props) {
  const brand = useBrand();
  const items: { label: string; onPress: () => void }[] = [
    { label: 'Comptes', onPress: onAccounts },
    { label: 'Réglages', onPress: onWebSettings },
    { label: 'Scanner code QR', onPress: onScan },
    { label: 'Aide', onPress: () => Alert.alert('Aide', HELP_TEXT) },
    { label: 'À propos', onPress: () => Alert.alert('À propos', ABOUT_TEXT) },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Fermer le menu" />
      <View style={styles.sheet}>
        <SafeAreaView edges={['bottom']}>
          <View style={styles.header}>
            <Avatar label={initials(account)} size={52} />
            <View style={styles.headerText}>
              <Text style={styles.name} numberOfLines={1}>
                {account.name || `Poste ${account.extension}`}
              </Text>
              <Text style={styles.sub} numberOfLines={1}>
                {account.extension}
              </Text>
              <Text style={styles.sub} numberOfLines={1}>
                {account.host}
              </Text>
            </View>
            <Pressable accessibilityRole="button" hitSlop={12} onPress={onClose}>
              <Text style={[styles.close, { color: brand.gradient[0] }]}>Fermer</Text>
            </Pressable>
          </View>
          {items.map((item) => (
            <Pressable
              key={item.label}
              accessibilityRole="button"
              onPress={item.onPress}
              style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
            >
              <Text style={styles.itemText}>{item.label}</Text>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          ))}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingBottom: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.surfaceBorder,
  },
  headerText: { flex: 1 },
  name: { color: colors.text, fontSize: 18, fontWeight: 'bold' },
  sub: { color: colors.textMuted, fontSize: 14, marginTop: 1 },
  close: { color: colors.gradient[0], fontSize: 16, fontWeight: 'bold', alignSelf: 'flex-start' },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  itemPressed: { backgroundColor: colors.surfaceBorder },
  itemText: { color: colors.text, fontSize: 16 },
  chevron: { color: colors.textMuted, fontSize: 22 },
});
