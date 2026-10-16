import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, GradientDot, textStyles } from '../components/ui';
import { colors, spacing } from '../theme';

type Props = { onScan: () => void; error?: string | null };

export default function Welcome({ onScan, error }: Props) {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.hero}>
        <GradientDot size={112} />
        <Text style={[textStyles.title, styles.title]}>Callikoe</Text>
        <Text style={styles.subtitle}>Ton poste téléphonique sur ton mobile</Text>
      </View>
      <View style={styles.bottom}>
        {error ? <Text style={[textStyles.error, styles.error]}>{error}</Text> : null}
        <Button title="Scanner le QR code" onPress={onScan} />
        <Text style={[textStyles.muted, styles.hint]}>
          Le QR code est dans la console de ton PBX (fiche utilisateur › Général › Application mobile) ou dans le mail
          envoyé par ton administrateur.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.lg },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { marginTop: spacing.lg },
  subtitle: { color: colors.textMuted, fontSize: 17, marginTop: spacing.sm, textAlign: 'center' },
  bottom: { paddingBottom: spacing.lg },
  error: { marginBottom: spacing.md },
  hint: { textAlign: 'center', marginTop: spacing.md },
});
