import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { textStyles } from '../components/ui';
import { accountId, type Account } from '../lib/account';
import { colors, radius, spacing } from '../theme';
import { useBrand } from '../lib/brand';

type Props = {
  accounts: Account[];
  activeId: string | null;
  onBack: () => void;
  onAdd: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
};

export default function Accounts({ accounts, activeId, onBack, onAdd, onSelect, onDelete }: Props) {
  const brand = useBrand();
  const confirmDelete = (account: Account) => {
    const id = accountId(account);
    Alert.alert(
      'Supprimer ce compte ?',
      `Le poste ${account.extension}${account.name ? ` (${account.name})` : ''} ne sonnera plus sur ce téléphone. Il faudra rescanner son QR code pour le remettre.`,
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Supprimer', style: 'destructive', onPress: () => onDelete(id) },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Retour" hitSlop={12} onPress={onBack} style={styles.side}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.title}>Comptes</Text>
        <Pressable accessibilityRole="button" hitSlop={12} onPress={onAdd} style={[styles.side, styles.sideRight]}>
          <Text style={[styles.add, { color: brand.gradient[0] }]}>Ajouter</Text>
        </Pressable>
      </View>

      <FlatList
        data={accounts}
        keyExtractor={(a) => accountId(a)}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        ListEmptyComponent={<Text style={[textStyles.muted, styles.empty]}>Aucun compte. Appuie sur « Ajouter ».</Text>}
        renderItem={({ item }) => {
          const id = accountId(item);
          const active = id === activeId;
          return (
            <View style={styles.row}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${item.name || 'Poste ' + item.extension}, ${id}${active ? ', compte actif' : ''}`}
                onPress={() => onSelect(id)}
                onLongPress={() => confirmDelete(item)}
                style={({ pressed }) => [styles.rowMain, pressed && { opacity: 0.7 }]}
              >
                <View style={[styles.check, active && { backgroundColor: brand.primary, borderColor: brand.primary }]}>
                  {active ? <Text style={styles.checkMark}>✓</Text> : null}
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.name} numberOfLines={1}>
                    {item.name || `Poste ${item.extension}`}
                  </Text>
                  <Text style={styles.id} numberOfLines={1}>
                    {id}
                  </Text>
                </View>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Supprimer ${id}`}
                hitSlop={8}
                onPress={() => confirmDelete(item)}
                style={({ pressed }) => [styles.delete, pressed && { opacity: 0.6 }]}
              >
                <Text style={styles.deleteText}>Supprimer</Text>
              </Pressable>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.surfaceBorder,
  },
  side: { width: 80 },
  sideRight: { alignItems: 'flex-end' },
  back: { color: colors.text, fontSize: 34, lineHeight: 38 },
  title: { flex: 1, textAlign: 'center', color: colors.text, fontSize: 17, fontWeight: 'bold' },
  add: { color: colors.gradient[0], fontSize: 16, fontWeight: 'bold' },
  list: { paddingVertical: spacing.sm },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.surfaceBorder, marginLeft: 56 },
  empty: { textAlign: 'center', marginTop: spacing.xl },
  row: { flexDirection: 'row', alignItems: 'center', paddingRight: spacing.md },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, paddingLeft: spacing.md },
  check: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.surfaceBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  checkActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkMark: { color: colors.text, fontSize: 14, fontWeight: 'bold' },
  rowText: { flex: 1 },
  name: { color: colors.text, fontSize: 16, fontWeight: 'bold' },
  id: { color: colors.textMuted, fontSize: 14, marginTop: 2 },
  delete: { paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  deleteText: { color: colors.danger, fontSize: 14, fontWeight: '600' },
});
