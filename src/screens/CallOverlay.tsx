import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { hangup, sendDtmf, subscribeCall, toggleMute, toggleSpeaker, type CallView } from '../lib/nativeCalls';
import { colors, radius, spacing } from '../theme';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** Écran d'appel de l'appli (appels natifs) : par-dessus le softphone tant qu'un appel est en cours */
export default function CallOverlay() {
  const [call, setCall] = useState<CallView | null>(null);
  const [pad, setPad] = useState(false);
  const [digits, setDigits] = useState('');
  const [, tick] = useState(0);
  useEffect(() => subscribeCall((c) => { setCall(c); if (!c) { setPad(false); setDigits(''); } }), []);
  useEffect(() => {
    if (call?.status !== 'connected') return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [call?.status]);
  if (!call) return null;
  const status = call.status === 'connected' && call.connectedAt ? fmt(Math.floor((Date.now() - call.connectedAt) / 1000))
    : call.status === 'ringing' ? 'Appel entrant…' : call.direction === 'out' ? 'Appel en cours…' : 'Connexion…';
  const Btn = ({ label, on, onPress, danger }: { label: string; on?: boolean; onPress: () => void; danger?: boolean }) => (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.btn, on && styles.btnOn, danger && styles.btnDanger, pressed && { opacity: 0.7 }]} accessibilityRole="button">
      <Text style={[styles.btnText, on && styles.btnTextOn]}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={styles.overlay}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.head}>
          <Text style={styles.name} numberOfLines={1}>{call.name}</Text>
          {call.name !== call.number ? <Text style={styles.number}>{call.number}</Text> : null}
          <Text style={styles.status}>{status}</Text>
          {pad && digits ? <Text style={styles.digits}>{digits}</Text> : null}
        </View>
        {pad ? (
          <View style={styles.pad}>
            {KEYS.map((k) => (
              <Pressable key={k} onPress={() => { sendDtmf(k); setDigits((d) => (d + k).slice(-20)); }} style={({ pressed }) => [styles.key, pressed && { opacity: 0.6 }]}>
                <Text style={styles.keyText}>{k}</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <View style={styles.row}>
            <Btn label={call.muted ? 'Micro coupé' : 'Muet'} on={call.muted} onPress={toggleMute} />
            <Btn label="Clavier" onPress={() => setPad(true)} />
            <Btn label="Haut-parleur" on={call.speaker} onPress={toggleSpeaker} />
          </View>
        )}
        <View style={styles.bottom}>
          {pad ? <Pressable onPress={() => setPad(false)} style={styles.link}><Text style={styles.linkText}>Masquer le clavier</Text></Pressable> : null}
          <Pressable onPress={hangup} style={({ pressed }) => [styles.hang, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel="Raccrocher">
            <Text style={styles.hangText}>Raccrocher</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, backgroundColor: colors.background, zIndex: 50 },
  safe: { flex: 1, justifyContent: 'space-between', paddingHorizontal: spacing.lg },
  head: { alignItems: 'center', marginTop: spacing.xl * 2, gap: spacing.xs },
  name: { color: colors.text, fontSize: 28, fontWeight: '700' },
  number: { color: colors.textMuted, fontSize: 16 },
  status: { color: colors.textMuted, fontSize: 16, marginTop: spacing.sm },
  digits: { color: colors.text, fontSize: 22, letterSpacing: 2, marginTop: spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  btn: { flex: 1, paddingVertical: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.surfaceBorder, alignItems: 'center' },
  btnOn: { backgroundColor: colors.text },
  btnDanger: { backgroundColor: colors.danger },
  btnText: { color: colors.text, fontWeight: '600' },
  btnTextOn: { color: colors.background },
  pad: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.md },
  key: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  keyText: { color: colors.text, fontSize: 26, fontWeight: '600' },
  bottom: { alignItems: 'center', gap: spacing.md, marginBottom: spacing.xl },
  link: { padding: spacing.sm },
  linkText: { color: colors.textMuted },
  hang: { alignSelf: 'stretch', paddingVertical: spacing.md + 2, borderRadius: radius.pill, backgroundColor: '#e5383b', alignItems: 'center' },
  hangText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
