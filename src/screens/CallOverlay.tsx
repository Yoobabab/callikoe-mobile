import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar } from '../components/ui';
import {
  callTeam, cancelSecondCall, hangup, sendDtmf, startConference, startSecondCall, toggleRecord, subscribeCall, swapLines, toggleHold, toggleMute, toggleSpeaker,
  transferBlind, transferToConsulted, type CallView, type TeamMate,
} from '../lib/nativeCalls';
import { colors, radius, spacing } from '../theme';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
const since = (t?: number) => (t ? fmt(Math.max(0, Math.floor((Date.now() - t) / 1000))) : '');
const initials = (name: string) => {
  const w = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  if (/^\d/.test(w[0])) return '#';
  return (w.length > 1 ? w[0][0] + w[1][0] : w[0].slice(0, 2)).toUpperCase();
};
const firstName = (name: string) => name.split(/\s+/)[0] || name;
const isDialable = (q: string) => /^[\d+*#][\d\s.+*#-]*$/.test(q) && q.replace(/\D/g, '').length >= 2;
const presence = (m: TeamMate): { label: string; color: string } =>
  m.line === 'busy' ? { label: 'En appel', color: '#ff4d4f' }
    : m.line === 'ringing' ? { label: 'Sonne', color: '#f5a524' }
      : m.status === 'dnd' ? { label: 'Ne pas déranger', color: '#ff4d4f' }
        : m.status === 'away' ? { label: 'Absent', color: '#f5a524' }
          : { label: 'Disponible', color: '#2fbf71' };

type IconName = keyof typeof Ionicons.glyphMap;
function RoundBtn({ icon, label, on, disabled, onPress }: { icon: IconName; label: string; on?: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.rb, (pressed || disabled) && { opacity: disabled ? 0.35 : 0.7 }]}
      accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: !!on, disabled: !!disabled }}>
      <View style={[styles.rbCircle, on && styles.rbOn]}><Ionicons name={icon} size={26} color={on ? colors.background : colors.text} /></View>
      <Text style={styles.rbText} numberOfLines={2}>{label}</Text>
    </Pressable>
  );
}

/** Choix du collègue (ou d'un numéro) : transfert direct / supervisé, ou nouvel appel */
function PickSheet({ mode, onClose }: { mode: 'transfer' | 'new'; onClose: () => void }) {
  const [team, setTeam] = useState<TeamMate[] | null>(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    callTeam().then(setTeam).catch((e: Error & { status?: number }) => {
      setTeam([]);
      setErr(e.status === 404 ? 'La liste des collègues arrive avec la prochaine mise à jour du standard. Tape un poste ou un numéro.' : 'Liste des collègues indisponible. Tape un poste ou un numéro.');
    });
  }, []);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = (team || []).filter((m) => !s || `${m.id} ${m.name}`.toLowerCase().includes(s));
    const num = isDialable(q) && !list.some((m) => m.id === q.replace(/\D/g, '')) ? [{ id: q.replace(/[^\d+*#]/g, ''), name: q.trim(), status: '', line: '', registered: true, isNumber: true }] : [];
    return [...num, ...list.map((m) => ({ ...m, isNumber: false }))];
  }, [team, q]);
  const act = (m: { id: string; name: string }, kind: 'direct' | 'consult' | 'call') => {
    onClose();
    if (kind === 'direct') transferBlind(m.id);
    else startSecondCall(m.id, m.name, kind === 'consult');
  };
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Fermer" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetWrap} pointerEvents="box-none">
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>{mode === 'transfer' ? "Transférer l'appel à…" : 'Nouvel appel'}</Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Fermer"><Ionicons name="close" size={24} color={colors.textMuted} /></Pressable>
          </View>
          <View style={styles.search}>
            <Ionicons name="search" size={18} color={colors.textMuted} />
            <TextInput value={q} onChangeText={setQ} placeholder="Collègue, poste ou numéro" placeholderTextColor={colors.textMuted} style={styles.searchInput}
              autoCorrect={false} autoCapitalize="none" returnKeyType="done" />
          </View>
          {err ? <Text style={styles.sheetErr}>{err}</Text> : null}
          {team === null ? <ActivityIndicator color={colors.text} style={{ marginVertical: spacing.lg }} /> : (
            <FlatList data={rows} keyExtractor={(m) => `${m.isNumber ? 'n' : 'c'}${m.id}`} keyboardShouldPersistTaps="handled" style={{ maxHeight: 380 }}
              ListEmptyComponent={<Text style={styles.sheetErr}>{q ? 'Personne ne correspond.' : 'Aucun collègue.'}</Text>}
              ItemSeparatorComponent={() => <View style={styles.sep} />}
              renderItem={({ item: m }) => {
                const p = m.isNumber ? { label: 'Numéro', color: colors.textMuted } : presence(m);
                return (
                  <View style={styles.row}>
                    <View style={styles.av2}>{m.isNumber ? <Ionicons name="call" size={16} color={colors.text} /> : <Text style={styles.av2Text}>{initials(m.name)}</Text>}</View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.rowName} numberOfLines={1}>{m.name}</Text>
                      <Text style={styles.rowSub} numberOfLines={1}>{m.isNumber ? '' : <Text style={{ color: p.color }}>● </Text>}{m.isNumber ? 'Numéro' : `${m.id} · ${p.label}`}</Text>
                    </View>
                    {mode === 'transfer' ? (<>
                      <Pressable onPress={() => act(m, 'direct')} style={({ pressed }) => [styles.chip, pressed && { opacity: 0.7 }]}><Text style={styles.chipText}>Direct</Text></Pressable>
                      <Pressable onPress={() => act(m, 'consult')} style={({ pressed }) => [styles.chip, styles.chipRed, pressed && { opacity: 0.7 }]}><Text style={styles.chipText}>Supervisé</Text></Pressable>
                    </>) : (
                      <Pressable onPress={() => act(m, 'call')} style={({ pressed }) => [styles.chip, styles.chipRed, pressed && { opacity: 0.7 }]}><Text style={styles.chipText}>Appeler</Text></Pressable>
                    )}
                  </View>
                );
              }} />
          )}
          {mode === 'transfer' ? (
            <Text style={styles.legend}><Text style={{ fontWeight: '700', color: colors.text }}>Direct</Text> : l'appel part tout de suite.{'\n'}
              <Text style={{ fontWeight: '700', color: colors.text }}>Supervisé</Text> : vous parlez d'abord à votre collègue.</Text>
          ) : <Text style={styles.legend}>L'appel en cours est mis en attente pendant le nouvel appel.</Text>}
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Écran d'appel de l'appli (appels natifs) : par-dessus le softphone tant qu'un appel est en cours */
export default function CallOverlay() {
  const [call, setCall] = useState<CallView | null>(null);
  const [pad, setPad] = useState(false);
  const [digits, setDigits] = useState('');
  const [sheet, setSheet] = useState<'transfer' | 'new' | null>(null);
  const [, tick] = useState(0);
  useEffect(() => subscribeCall((c) => { setCall(c); if (!c) { setPad(false); setDigits(''); setSheet(null); } }), []);
  const live = call?.status === 'connected';
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [live]);
  if (!call) return null;

  const x = call.extra;
  const onExtra = !!x && call.focus === 'extra';
  // Ligne affichée en grand = celle avec qui on parle ; l'autre est dans la carte « En attente »
  const big = onExtra && x ? { name: x.name, number: x.number, held: x.held, status: x.status, at: x.connectedAt }
    : { name: call.name, number: call.number, held: call.held, status: call.status, at: call.connectedAt };
  const other = x ? (onExtra ? { name: call.name, held: call.held, at: call.connectedAt } : { name: x.name, held: x.held, at: x.connectedAt }) : null;
  const state = big.status === 'connected' ? since(big.at)
    : big.status === 'ringing' ? 'Appel entrant…' : onExtra || call.direction === 'out' ? 'Appel en cours…' : 'Connexion…';
  const consult = !!x?.consult;
  const pill = call.conference ? 'Conférence à 3' : consult ? 'Transfert supervisé' : big.held ? 'En attente' : call.recording ? '● Enregistrement' : '';
  const canConf = x?.status === 'connected';
  const sub = big.name !== big.number ? big.number : '';

  return (
    <View style={styles.overlay}>
      <View style={styles.glow} pointerEvents="none" />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.head}>
          {pad ? null : <Avatar label={initials(big.name)} size={96} />}
          <Text style={styles.name} numberOfLines={1}>{big.name}</Text>
          {sub ? <Text style={styles.number}>{sub}</Text> : null}
          <Text style={styles.status}>{state}</Text>
          {pill ? <View style={styles.pill}><Text style={styles.pillText}>{pill}</Text></View> : null}
          {pad && digits ? <Text style={styles.digits}>{digits}</Text> : null}
        </View>

        {call.notice ? <View style={styles.notice}><Text style={styles.noticeText}>{call.notice}</Text></View> : null}

        {other ? (
          <View style={styles.holdCard}>
            <View style={styles.av2}><Text style={styles.av2Text}>{initials(other.name)}</Text></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.rowName} numberOfLines={1}>{other.name}</Text>
              <Text style={styles.rowSub}>En attente{other.at ? ` · ${since(other.at)}` : ''}</Text>
            </View>
            <Pressable onPress={swapLines} hitSlop={8} style={({ pressed }) => [styles.chip, pressed && { opacity: 0.7 }]}><Text style={styles.chipText}>Reprendre</Text></Pressable>
          </View>
        ) : null}

        {pad ? (
          <View style={styles.pad}>
            {KEYS.map((k) => (
              <Pressable key={k} onPress={() => { sendDtmf(k); setDigits((d) => (d + k).slice(-20)); }} style={({ pressed }) => [styles.key, pressed && { opacity: 0.6 }]}>
                <Text style={styles.keyText}>{k}</Text>
              </Pressable>
            ))}
          </View>
        ) : consult ? (
          <View style={styles.consult}>
            <Pressable onPress={transferToConsulted} disabled={x?.status !== 'connected'}
              style={({ pressed }) => [styles.bigBtn, styles.bigRed, (pressed || x?.status !== 'connected') && { opacity: x?.status !== 'connected' ? 0.45 : 0.8 }]}>
              <Text style={styles.bigText}>Transférer à {firstName(x?.name || '')}</Text>
            </Pressable>
            <Pressable onPress={cancelSecondCall} style={({ pressed }) => [styles.bigBtn, pressed && { opacity: 0.8 }]}>
              <Text style={styles.bigText}>Annuler et reprendre le client</Text>
            </Pressable>
            <Pressable onPress={startConference} disabled={!canConf} style={({ pressed }) => [styles.smallBtn, (pressed || !canConf) && { opacity: !canConf ? 0.45 : 0.7 }]}>
              <Ionicons name="people" size={18} color={colors.text} /><Text style={styles.smallText}>Conférence à 3</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.grid}>
            <RoundBtn icon={call.muted ? 'mic-off' : 'mic'} label={call.muted ? 'Micro coupé' : 'Muet'} on={call.muted} onPress={toggleMute} />
            <RoundBtn icon="keypad" label="Clavier" disabled={!live} onPress={() => setPad(true)} />
            <RoundBtn icon="volume-high" label="Haut-parleur" on={call.speaker} onPress={toggleSpeaker} />
            <RoundBtn icon={big.held ? 'play' : 'pause'} label={big.held ? 'Reprendre' : 'En attente'} on={big.held} disabled={big.status !== 'connected'} onPress={toggleHold} />
            <RoundBtn icon="arrow-forward" label="Transfert" disabled={big.status !== 'connected'} onPress={() => setSheet('transfer')} />
            <RoundBtn icon="person-add" label="Transfert supervisé" disabled={!live || !!x} onPress={() => setSheet('transfer')} />
            <RoundBtn icon="add" label="Nouvel appel" disabled={!live || !!x} onPress={() => setSheet('new')} />
            <RoundBtn icon="people" label="Conférence" disabled={!canConf} onPress={startConference} />
            <RoundBtn icon="radio-button-on" label={call.recording ? 'Arrêter' : 'Enregistrer'} on={call.recording} disabled={big.status !== 'connected'} onPress={toggleRecord} />
          </View>
        )}

        <View style={styles.bottom}>
          {pad ? <Pressable onPress={() => setPad(false)} style={styles.link}><Text style={styles.linkText}>Masquer le clavier</Text></Pressable> : null}
          <Pressable onPress={hangup} style={({ pressed }) => [styles.hang, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel="Raccrocher">
            <Ionicons name="call" size={32} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
          </Pressable>
        </View>
      </SafeAreaView>
      {sheet ? <PickSheet mode={sheet} onClose={() => setSheet(null)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, backgroundColor: colors.background, zIndex: 50 },
  glow: { position: 'absolute', top: -160, alignSelf: 'center', width: 420, height: 420, borderRadius: 210, backgroundColor: '#d10a0a', opacity: 0.18 },
  safe: { flex: 1, justifyContent: 'space-between', paddingHorizontal: spacing.lg },
  head: { alignItems: 'center', marginTop: spacing.xl, gap: spacing.xs },
  name: { color: colors.text, fontSize: 27, fontWeight: '700', marginTop: spacing.sm },
  number: { color: colors.textMuted, fontSize: 15 },
  status: { color: '#e6e2ea', fontSize: 16, marginTop: spacing.xs, fontVariant: ['tabular-nums'] },
  pill: { marginTop: spacing.sm, paddingHorizontal: 12, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.08)' },
  pillText: { color: '#d6d2dc', fontSize: 12 },
  digits: { color: colors.text, fontSize: 22, letterSpacing: 2, marginTop: spacing.sm },
  notice: { alignSelf: 'center', paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: '#2a2631' },
  noticeText: { color: colors.text, fontSize: 13 },
  holdCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.lg, backgroundColor: '#24212b' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 16 },
  rb: { width: '33.33%', alignItems: 'center' },
  rbCircle: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#2a2631', alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  rbOn: { backgroundColor: colors.text },
  rbText: { color: '#d6d2dc', fontSize: 12.5, textAlign: 'center' },
  consult: { gap: spacing.sm },
  bigBtn: { paddingVertical: 18, borderRadius: radius.lg, backgroundColor: '#2a2631', alignItems: 'center' },
  bigRed: { backgroundColor: '#d10a0a' },
  smallBtn: { flexDirection: 'row', alignSelf: 'center', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 16 },
  smallText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  bigText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  pad: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.md },
  key: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  keyText: { color: colors.text, fontSize: 26, fontWeight: '600' },
  bottom: { alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  link: { padding: spacing.sm },
  linkText: { color: colors.textMuted },
  hang: { width: 76, height: 76, borderRadius: 38, backgroundColor: '#e5383b', alignItems: 'center', justifyContent: 'center' },
  // Feuille de choix
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#221f28', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  sheetTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  sheetErr: { color: colors.textMuted, fontSize: 13, marginVertical: spacing.sm },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.surfaceBorder, backgroundColor: '#18161d' },
  searchInput: { flex: 1, color: colors.text, fontSize: 16, paddingVertical: 12 },
  sep: { height: 1, backgroundColor: colors.surfaceBorder },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  av2: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#34303d', alignItems: 'center', justifyContent: 'center' },
  av2Text: { color: colors.text, fontWeight: '600', fontSize: 14 },
  rowName: { color: colors.text, fontSize: 15, fontWeight: '600' },
  rowSub: { color: colors.textMuted, fontSize: 12, marginTop: 1 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: '#34303d' },
  chipRed: { backgroundColor: '#d10a0a' },
  chipText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  legend: { color: colors.textMuted, fontSize: 12.5, lineHeight: 18, marginTop: spacing.sm, marginBottom: spacing.md },
});
