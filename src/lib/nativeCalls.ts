/**
 * Appels natifs de l'appli : sonnerie du système (CallKit sur iPhone, Telecom sur Android), même appli fermée.
 *
 * - Le téléphone s'inscrit auprès de chaque PBX (jeton de notification) : le PBX le réveille à chaque appel.
 * - Réveillé, il affiche la sonnerie du système, se connecte au PBX (poste <n>-app) et le prévient (/app/ready) ;
 *   le PBX fait alors sonner l'appli, qui répond quand l'utilisateur décroche.
 * - Appli ouverte : elle reste connectée et le PBX la fait sonner directement.
 * - Appels sortants : demandés par la page du softphone (message « dial »), passés par la sonnerie du système.
 * Rien de tout ça n'existe dans Expo Go (modules natifs) : NATIVE_CALLS est faux et l'appli marche comme avant.
 */
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { AppState, Platform } from 'react-native';
import { accountId, type Account } from './account';
import { appApi, type SipAccount } from './pbxApi';
import type { SipLine as SipLineT } from './sipEngine';

export const NATIVE_CALLS = Platform.OS !== 'web' && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;

type CallsModule = typeof import('expo-callkit-telecom');
type RTCSession = import('jssip/lib/RTCSession').RTCSession;

export type CallView = { id: string; name: string; number: string; direction: 'in' | 'out'; status: 'ringing' | 'connecting' | 'connected'; muted: boolean; speaker: boolean; connectedAt?: number };
type CallState = {
  id: string; key: string; direction: 'in' | 'out'; serverCallId: string; number: string; name: string;
  session?: RTCSession; answerRequestId?: string; ended?: boolean; poll?: ReturnType<typeof setInterval>; view: CallView;
};

let Calls: CallsModule | null = null;
let accounts: Account[] = [];
let activeKey = '';
const lines = new Map<string, SipLineT>();
const creds = new Map<string, SipAccount>();
const calls = new Map<string, CallState>();
const ownEvents = new Set<string>();          // appels signalés par l'appli elle-même (appli ouverte) : pas de « prêt » à envoyer
const pendingInvites = new Map<string, { session: RTCSession; number: string; name: string }>();
const pushSent = new Map<string, string>();   // compte → jeton déjà envoyé
let pushToken: { token: string; type: string } | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<(v: CallView | null) => void>();
let current: CallView | null = null;

const log = (...a: unknown[]) => { if (__DEV__) console.log('[appels]', ...a); };
const emit = () => listeners.forEach((l) => l(current));
const setView = (c: CallState | null) => { current = c && !c.ended ? { ...c.view } : null; emit(); };
const keyOfHost = (host: string, ext: string) => accounts.find((a) => (a.host === host || a.fqdn === host) && a.extension === ext);
const apnsEnv = (Constants.expoConfig?.extra as { apnsEnv?: string } | undefined)?.apnsEnv === 'development' ? 'development' : 'production';

/** Pour l'écran d'appel de l'appli */
export function subscribeCall(l: (v: CallView | null) => void): () => void { listeners.add(l); l(current); return () => listeners.delete(l); }

async function lineFor(acc: Account): Promise<SipLineT> {
  const key = accountId(acc);
  let line = lines.get(key);
  if (line) { line.start(); return line; }
  let sip = creds.get(key);
  if (!sip) { sip = await appApi<SipAccount>(acc, '/app/sip', {}); creds.set(key, sip); }
  const { SipLine } = await import('./sipEngine');
  line = new SipLine(sip, {
    onIncoming: (s, info) => onInvite(key, s, info),
    onRegistrationFailed: (cause) => log('enregistrement refusé', key, cause),
  });
  lines.set(key, line);
  line.start();
  return line;
}
function stopIdleLines() {
  for (const [key, line] of lines) {
    const busy = [...calls.values()].some((c) => c.key === key && !c.ended);
    if (!busy && !(AppState.currentState === 'active' && key === activeKey)) { line.stop(); lines.delete(key); }
  }
}

// ---------------------------------------------------------------- Appel entrant
function onInvite(key: string, s: RTCSession, info: { callId: string; number: string; name: string }) {
  const c = [...calls.values()].find((x) => x.key === key && x.direction === 'in' && !x.session && !x.ended && (!info.callId || x.serverCallId === info.callId));
  if (c) { attachIncoming(c, s); return; }
  // Appli ouverte : le PBX la fait sonner directement → on montre la sonnerie du système
  const serverCallId = info.callId || `sip-${Date.now()}`;
  pendingInvites.set(serverCallId, { session: s, ...info });
  const eventId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  ownEvents.add(eventId);
  Calls?.reportIncomingCall({ eventId, serverCallId, hasVideo: false, caller: { id: info.number || 'inconnu', displayName: info.name || info.number || 'Appel entrant' },
    metadata: { key } }).catch((e) => { log('sonnerie impossible', e); s.terminate({ status_code: 480 }); pendingInvites.delete(serverCallId); });
}
function attachIncoming(c: CallState, s: RTCSession) {
  c.session = s;
  if (c.poll) { clearInterval(c.poll); c.poll = undefined; }
  s.on('failed', (e: { cause?: string; message?: { getHeader?: (h: string) => string | undefined } }) => {
    const elsewhere = /elsewhere|ailleurs/i.test(String(e?.message?.getHeader?.('Reason') || ''));
    endFromRemote(c, elsewhere ? 'answeredElsewhere' : String(e?.cause) === 'Canceled' ? 'remoteEnded' : 'failed');
  });
  s.on('ended', () => endFromRemote(c, 'remoteEnded'));
  s.on('confirmed', () => {
    c.view = { ...c.view, status: 'connected', connectedAt: Date.now() }; setView(c);
    if (c.answerRequestId) Calls?.fulfillIncomingCallConnected(c.answerRequestId).catch(() => {});
  });
  if (c.answerRequestId) answerNow(c);   // l'utilisateur avait déjà décroché pendant la connexion
}
function answerNow(c: CallState) {
  const line = lines.get(c.key);
  if (!c.session || !line) return;
  c.view = { ...c.view, status: 'connecting' }; setView(c);
  try { line.answer(c.session); } catch (e) { log('décroché impossible', e); if (c.answerRequestId) Calls?.failIncomingCallConnected(c.id, c.answerRequestId).catch(() => {}); }
}
function endFromRemote(c: CallState, reason: 'remoteEnded' | 'answeredElsewhere' | 'failed') {
  if (c.ended) return;
  c.ended = true;
  if (c.poll) clearInterval(c.poll);
  Calls?.reportCallEnded(c.id, reason).catch(() => {});
  calls.delete(c.id); setView(null); stopIdleLines();
}

/** Sonnerie affichée par le système (notification reçue appli fermée, ou appel signalé par l'appli) */
async function onSessionAdded(session: import('expo-callkit-telecom').CallSession) {
  const ev = session.incomingCallEvent;
  if (session.origin !== 'incoming' || !ev) return;
  const meta = (ev.metadata || {}) as { host?: string; ext?: string; key?: string };
  const acc = meta.key ? accounts.find((a) => accountId(a) === meta.key) : keyOfHost(String(meta.host || ''), String(meta.ext || ''));
  if (!acc) { log('compte inconnu pour cet appel', meta); Calls?.reportCallEnded(session.id, 'failed').catch(() => {}); return; }
  const c: CallState = { id: session.id, key: accountId(acc), direction: 'in', serverCallId: ev.serverCallId, number: ev.caller.id, name: ev.caller.displayName || ev.caller.id,
    view: { id: session.id, name: ev.caller.displayName || ev.caller.id, number: ev.caller.id, direction: 'in', status: 'ringing', muted: false, speaker: false } };
  calls.set(session.id, c); setView(c);
  const pending = pendingInvites.get(ev.serverCallId);
  if (ownEvents.has(ev.eventId) && pending) { pendingInvites.delete(ev.serverCallId); ownEvents.delete(ev.eventId); attachIncoming(c, pending.session); return; }
  // Réveillé par notification : connexion au PBX, puis « prêt » (le PBX fait alors sonner l'appli)
  try {
    const line = await lineFor(acc);
    if (!(await line.whenRegistered(10000))) throw new Error('connexion au PBX impossible');
    await appApi(acc, '/app/ready', { call: ev.serverCallId });
  } catch (e) { log('réveil', e); endFromRemote(c, 'failed'); return; }
  // Si l'appel s'arrête avant d'arriver (décroché ailleurs, appelant qui raccroche), on arrête la sonnerie
  c.poll = setInterval(async () => {
    if (c.session || c.ended) { if (c.poll) clearInterval(c.poll); return; }
    try { const r = await appApi<{ state: string }>(acc, `/app/call?call=${encodeURIComponent(c.serverCallId)}`); if (r.state === 'ended') endFromRemote(c, 'remoteEnded'); } catch { /* réseau : on réessaie */ }
  }, 2000);
}

// ---------------------------------------------------------------- Appel sortant
export async function dial(number: string, name = ''): Promise<void> {
  if (!Calls) return;
  const n = number.replace(/[^\d+*#]/g, '');
  if (!n) return;
  const id = await Calls.startOutgoingCall({ id: n, displayName: name || n, ...(n.startsWith('+') ? { phoneNumber: n } : {}) }, { hasVideo: false });
  const acc = accounts.find((a) => accountId(a) === activeKey);
  if (!acc) { Calls.reportCallEnded(id, 'failed').catch(() => {}); return; }
  calls.set(id, { id, key: activeKey, direction: 'out', serverCallId: '', number: n, name: name || n,
    view: { id, name: name || n, number: n, direction: 'out', status: 'connecting', muted: false, speaker: false } });
  setView(calls.get(id)!);
}
async function onOutgoingStarted(id: string) {
  const c = calls.get(id);
  if (!c) return;
  try {
    const acc = accounts.find((a) => accountId(a) === c.key)!;
    const line = await lineFor(acc);
    if (!(await line.whenRegistered(8000))) throw new Error('pas connecté au PBX');
    const s = line.call(c.number);
    c.session = s;
    s.on('confirmed', () => { c.view = { ...c.view, status: 'connected', connectedAt: Date.now() }; setView(c); Calls?.reportOutgoingCallConnected(id).catch(() => {}); });
    s.on('failed', () => endFromRemote(c, 'failed'));
    s.on('ended', () => endFromRemote(c, 'remoteEnded'));
  } catch (e) { log('appel sortant', e); endFromRemote(c, 'failed'); }
}

// ---------------------------------------------------------------- Commandes de l'écran d'appel
export function hangup() { if (current && Calls) Calls.endCall(current.id).catch(() => {}); }
export function toggleMute() { if (current && Calls) Calls.setMuted(current.id, !current.muted).catch(() => {}); }
export function toggleSpeaker() {
  const c = current && calls.get(current.id);
  if (!c || !Calls) return;
  c.view = { ...c.view, speaker: !c.view.speaker };
  Calls.setAudioSessionPortOverride(c.view.speaker);
  setView(c);
}
export function sendDtmf(d: string) { const c = current && calls.get(current.id); c?.session?.sendDTMF(d); }

// ---------------------------------------------------------------- Notifications et présence
async function sendPushTokens() {
  if (!pushToken) return;
  for (const acc of accounts) {
    const key = accountId(acc);
    if (pushSent.get(key) === pushToken.token) continue;
    try { await appApi(acc, '/app/push', { push_token: pushToken.token, push_type: pushToken.type, apns_env: apnsEnv }); pushSent.set(key, pushToken.token); }
    catch (e) { log('inscription notifications', key, e); }
  }
}
async function presence(state: 'active' | 'background') {
  const acc = accounts.find((a) => accountId(a) === activeKey);
  if (acc) { try { await appApi(acc, '/app/presence', { state }); } catch { /* hors ligne */ } }
}
async function onForeground() {
  const acc = accounts.find((a) => accountId(a) === activeKey);
  if (!acc) return;
  try { await (await lineFor(acc)).whenRegistered(8000); } catch (e) { log('connexion', e); }
  presence('active');
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = setInterval(() => presence('active'), 45_000);
}
function onBackground() {
  if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
  presence('background');
  stopIdleLines();   // appli fermée : le PBX la réveillera par notification
}

let started = false;
/** Une fois, au démarrage de l'appli (vraie version seulement) */
export function initNativeCalls(): boolean {
  if (!NATIVE_CALLS || started) return started;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Calls = require('expo-callkit-telecom') as CallsModule;
  } catch (e) { log('module natif absent', e); return false; }
  started = true;
  const C = Calls!;
  // Android sans Firebase (google-services.json pas encore donné) : pas de notifications, appels seulement appli ouverte
  const fcm = (Constants.expoConfig?.extra as { fcm?: boolean } | undefined)?.fcm === true;
  if (Platform.OS === 'ios' || fcm) { try { C.registerVoIPPush(); } catch (e) { log('notifications indisponibles', e); } }
  const tok = C.getVoIPPushToken();
  if (tok) { pushToken = tok; sendPushTokens(); }
  C.addVoIPPushTokenUpdatedListener((e) => { pushToken = e.token ? { token: e.token, type: e.type } : null; pushSent.clear(); sendPushTokens(); });
  C.addCallSessionAddedListener(({ session }) => { onSessionAdded(session); });
  C.addCallAnsweredListener(({ id, requestId }) => {
    const c = calls.get(id);
    if (!c) return;
    c.answerRequestId = requestId;
    if (c.session) answerNow(c); else { c.view = { ...c.view, status: 'connecting' }; setView(c); }
  });
  C.addCallEndedListener(({ id }) => {
    const c = calls.get(id);
    if (!c) return;
    c.ended = true;
    if (c.poll) clearInterval(c.poll);
    try { c.session?.terminate(c.session.isEstablished() ? undefined : { status_code: 486 }); } catch { /* déjà fini */ }
    calls.delete(id); setView(null); stopIdleLines();
  });
  C.addOutgoingCallStartedListener(({ id }) => { onOutgoingStarted(id); });
  C.addSetMutedActionListener(({ id, isMuted }) => {
    const c = calls.get(id);
    if (!c?.session) return;
    if (isMuted) c.session.mute({ audio: true }); else c.session.unmute({ audio: true });
    c.view = { ...c.view, muted: isMuted }; setView(c);
  });
  C.addDTMFListener(({ id, digits }) => { calls.get(id)?.session?.sendDTMF(digits); });
  // Appli déjà lancée par une notification (sonnerie en cours au démarrage du JS)
  C.getActiveCallSession().then((s) => { if (s && !calls.has(s.id)) onSessionAdded(s); }).catch(() => {});
  AppState.addEventListener('change', (st) => { if (st === 'active') onForeground(); else if (st === 'background') onBackground(); });
  return true;
}
/** Comptes du téléphone (et compte actif) : inscription aux notifications de chaque PBX, ligne du compte actif */
export function setNativeAccounts(list: Account[], active: Account | null) {
  if (!started) return;
  const prevActive = activeKey;
  accounts = list;
  activeKey = active ? accountId(active) : '';
  for (const key of [...creds.keys()]) if (!list.some((a) => accountId(a) === key)) { creds.delete(key); lines.get(key)?.stop(); lines.delete(key); pushSent.delete(key); }
  sendPushTokens();
  if (prevActive !== activeKey) { stopIdleLines(); if (AppState.currentState === 'active') onForeground(); }
}
