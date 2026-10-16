import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { colors, radius, spacing } from '../theme';

export function GradientDot({ size = 96 }: { size?: number }) {
  return (
    <LinearGradient
      colors={colors.gradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ width: size, height: size, borderRadius: size / 2 }}
    />
  );
}

type ButtonProps = {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
};

export function Button({ title, onPress, variant = 'primary', loading, disabled, style }: ButtonProps) {
  const isDisabled = disabled || loading;
  const content = loading ? (
    <ActivityIndicator color={colors.text} />
  ) : (
    <Text style={[styles.buttonText, variant === 'danger' && { color: colors.danger }]}>{title}</Text>
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [{ opacity: isDisabled ? 0.5 : pressed ? 0.8 : 1 }, style]}
    >
      {variant === 'primary' ? (
        <LinearGradient colors={colors.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.button}>
          {content}
        </LinearGradient>
      ) : (
        <View style={[styles.button, styles.secondary]}>{content}</View>
      )}
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {value || '—'}
      </Text>
    </View>
  );
}

export const textStyles = StyleSheet.create({
  title: { color: colors.text, fontSize: 34, fontWeight: 'bold', textAlign: 'center' },
  h2: { color: colors.text, fontSize: 22, fontWeight: 'bold' },
  body: { color: colors.text, fontSize: 16, lineHeight: 22 },
  muted: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  error: { color: colors.danger, fontSize: 15, lineHeight: 21, textAlign: 'center' },
});

const styles = StyleSheet.create({
  button: {
    minHeight: 52,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  buttonText: { color: colors.text, fontSize: 16, fontWeight: 'bold' },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.surfaceBorder,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  rowLabel: { color: colors.textMuted, fontSize: 15 },
  rowValue: { color: colors.text, fontSize: 15, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
});
