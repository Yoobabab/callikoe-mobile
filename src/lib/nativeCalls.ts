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

/** Deuxième ligne pendant un appel : collègue appelé pour un transfert supervisé, ou nouvel appel */
export type LegView = { name: string; number: string; status: 'connecting' | 'connected'; held: boolean; connectedAt?: number; consult: boolean };
export type CallView = {
  id: string; name: string; number: string; direction: 'in' | 'out'; status: 'ringing' | 'connecting' | 'connected'; muted: boolean; speaker: boolean; connectedAt?: number;
  held: boolean;            // ligne principale en attente
  extra?: LegView;          // deuxième ligne
  focus: 'main' | 'extra';  // ligne avec laquelle on parle
  notice?: string;          // message court (transfert refusé, collègue injoignable…)
  recording: boolean;       // ligne avec qui on parle en cours d'enregistrement
  conference: boolean;      // conférence à 3 en cours
};
type Leg = { session: RTCSession; name: string; number: string; status: 'connecting' | 'connected'; held: boolean; connectedAt?: number; consult: boolean };
type CallState = {
  id: string; key: string; direction: 'in' | 'out'; serverCallId: string; number: string; name: string;
  session?: RTCSession; answerRequestId?: string; ended?: boolean; poll?: ReturnType<typeof setInterval>; view: CallView;
  extra?: Leg; noticeTimer?: ReturnType<typeof setTimeout>;
  recorded: Set<string>;    // lignes (Call-ID) enregistrées
};
export type TeamMate = { id: string; name: string; status: string; line: string; registered: boolean };

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
const legView = (l: Leg): LegView => ({ name: l.name, number: l.number, status: l.status, held: l.held, connectedAt: l.connectedAt, consult: l.consult });
const callIdOf = (s?: RTCSession): string => String((s as unknown as { _request?: { call_id?: string } } | undefined)?._request?.call_id || '');
const setView = (c: CallState | null) => {
  if (!c || c.ended) { current = null; emit(); return; }
  const focus = c.extra ? c.view.focus : 'main';
  const s = focus === 'extra' ? c.extra?.session : c.session;
  current = { ...c.view, extra: c.extra ? legView(c.extra) : undefined, focus, recording: c.recorded.has(callIdOf(s)) };
  emit();
};
const newView = (id: string, name: string, number: string, direction: 'in' | 'out', status: CallView['status']): CallView =>
  ({ id, name, number, direction, status, muted: false, speaker: false, held: false, focus: 'main', recording: false, conference: false });
function notice(c: CallState, text: string) {
  c.view = { ...c.view, notice: text }; setView(c);
  if (c.noticeTimer) clearTimeout(c.noticeTimer);
  c.noticeTimer = setTimeout(() => { c.view = { ...c.view, notice: undefined }; setView(c); }, 4000);
}
/** Une ligne de l'appel s'est arrêtée : la 2e ligne disparaît, ou elle remplace la ligne principale ; plus aucune ligne = fin de l'appel */
function legGone(c: CallState, s: RTCSession, reason: 'remoteEnded' | 'answeredElsewhere' | 'failed') {
  if (c.ended) return;
  if (c.extra && s === c.extra.session) {
    const x = c.extra;
    c.extra = undefined; c.view = { ...c.view, focus: 'main' };
    if (x.status !== 'connected') notice(c, `${x.name} n'a pas répondu`); else setView(c);
    return;
  }
  if (s !== c.session) return;
  if (c.extra) {
    const x = c.extra;
    c.extra = undefined; c.session = x.session; c.name = x.name; c.number = x.number;
    c.view = { ...c.view, name: x.name, number: x.number, status: x.status, connectedAt: x.connectedAt, held: x.held, focus: 'main' };
    setView(c); return;
  }
  endFromRemote(c, reason);
}
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
    legGone(c, s, elsewhere ? 'answeredElsewhere' : String(e?.cause) === 'Canceled' ? 'remoteEnded' : 'failed');
  });
  s.on('ended', () => legGone(c, s, 'remoteEnded'));
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
  if (c.noticeTimer) clearTimeout(c.noticeTimer);
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
    view: newView(session.id, ev.caller.displayName || ev.caller.id, ev.caller.id, 'in', 'ringing'), recorded: new Set() };
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
    view: newView(id, name || n, n, 'out', 'connecting'), recorded: new Set() });
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
    s.on('failed', () => legGone(c, s, 'failed'));
    s.on('ended', () => legGone(c, s, 'remoteEnded'));
  } catch (e) { log('appel sortant', e); endFromRemote(c, 'failed'); }
}

// ---------------------------------------------------------------- Commandes de l'écran d'appel
const cur = () => (current ? calls.get(current.id) : undefined);
const focused = (c: CallState) => (c.extra && c.view.focus === 'extra' ? c.extra.session : c.session);
function setHold(c: CallState, which: 'main' | 'extra', hold: boolean) {
  const s = which === 'extra' ? c.extra?.session : c.session;
  if (!s || !s.isEstablished()) return;
  try { if (hold) s.hold(); else s.unhold(); } catch (e) { log('attente', e); }
  if (which === 'extra' && c.extra) c.extra = { ...c.extra, held: hold }; else c.view = { ...c.view, held: hold };
}
/** Raccrocher : avec deux lignes, seulement celle avec qui on parle (l'autre reste en attente) */
export function hangup() {
  const c = cur();
  if (!c || !Calls) return;
  if (c.extra) { try { focused(c)?.terminate(); } catch { /* déjà fini */ } return; }
  Calls.endCall(c.id).catch(() => {});
}
/** Mettre en attente / reprendre la ligne avec qui on parle */
export function toggleHold() {
  const c = cur();
  if (!c) return;
  const which = c.extra && c.view.focus === 'extra' ? 'extra' : 'main';
  const held = which === 'extra' ? !!c.extra?.held : c.view.held;
  setHold(c, which, !held); setView(c);
}
/** Reprendre l'autre ligne (l'actuelle passe en attente) */
export function swapLines() {
  const c = cur();
  if (!c?.extra) return;
  const to = c.view.focus === 'extra' ? 'main' : 'extra';
  setHold(c, to === 'main' ? 'extra' : 'main', true);
  setHold(c, to, false);
  c.view = { ...c.view, focus: to }; setView(c);
}
/** Deuxième appel : l'appel en cours passe en attente. consult = transfert supervisé (on parle d'abord au collègue) */
export function startSecondCall(number: string, name = '', consult = false) {
  const c = cur();
  const line = c && lines.get(c.key);
  const n = number.replace(/[^\d+*#]/g, '');
  if (!c || !line || !n || c.extra || !c.session?.isEstablished()) return;
  if (!c.view.held) setHold(c, 'main', true);
  let s: RTCSession;
  try { s = line.call(n); } catch (e) { log('2e appel', e); notice(c, 'Appel impossible'); return; }
  c.extra = { session: s, name: name || n, number: n, status: 'connecting', held: false, consult };
  c.view = { ...c.view, focus: 'extra' };
  s.on('confirmed', () => { if (c.extra?.session === s) { c.extra = { ...c.extra, status: 'connected', connectedAt: Date.now() }; setView(c); } });
  s.on('failed', () => legGone(c, s, 'failed'));
  s.on('ended', () => legGone(c, s, 'remoteEnded'));
  if (c.view.muted) s.mute({ audio: true });
  setView(c);
}
const referHandlers = (c: CallState) => ({
  requestFailed: () => notice(c, 'Transfert refusé par le standard'),
  failed: () => notice(c, 'Le transfert n\'a pas abouti'),
});
/** Transfert direct (aveugle) de la ligne avec qui on parle */
export function transferBlind(target: string) {
  const c = cur();
  const line = c && lines.get(c.key);
  const s = c && focused(c);
  const t = target.replace(/[^\d+*#]/g, '');
  if (!c || !line || !s || !t) return;
  try {
    s.refer(`sip:${t}@${line.sip.domain}`, { eventHandlers: referHandlers(c) });
    notice(c, 'Transfert en cours…');
  } catch (e) { log('transfert', e); notice(c, 'Transfert impossible'); }
}
/** Transfert supervisé : le client (en attente) part chez le collègue avec qui on parle */
export function transferToConsulted() {
  const c = cur();
  if (!c?.extra || !c.session) return;
  const target = c.extra.session;
  try {
    c.session.refer(target.remote_identity.uri, { replaces: target, eventHandlers: referHandlers(c) });
    notice(c, 'Transfert en cours…');
  } catch (e) { log('transfert supervisé', e); notice(c, 'Transfert impossible'); }
}
/** Annuler le transfert supervisé : on raccroche avec le collègue et on reprend le client */
export function cancelSecondCall() {
  const c = cur();
  if (!c?.extra) return;
  const s = c.extra.session;
  c.extra = undefined;
  try { s.terminate(); } catch { /* déjà fini */ }
  setHold(c, 'main', false);
  c.view = { ...c.view, focus: 'main' }; setView(c);
}
const accOf = (c: CallState) => accounts.find((a) => accountId(a) === c.key);
const oldPbx = (e: unknown) => (e as { status?: number })?.status === 404 && /Not Found|Erreur 404/i.test(String((e as Error)?.message));
/** Enregistrer / arrêter l'enregistrement de la ligne avec qui on parle (fait par le standard) */
export async function toggleRecord() {
  const c = cur();
  const acc = c && accOf(c);
  const id = c && callIdOf(focused(c));
  if (!c || !acc || !id) return;
  const on = !c.recorded.has(id);
  try {
    const r = await appApi<{ on: boolean; already?: boolean }>(acc, '/app/record', { call_id: id, on });
    if (r.on) c.recorded.add(id); else c.recorded.delete(id);
    notice(c, r.already ? 'Cet appel est déjà enregistré par le standard' : r.on ? 'Enregistrement en cours' : 'Enregistrement arrêté');
  } catch (e) { notice(c, oldPbx(e) ? 'Mets à jour le standard pour enregistrer' : (e as Error).message || 'Enregistrement impossible'); }
}
/** Conférence à 3 : l'appel en attente et le 2e appel sont réunis avec moi */
export async function startConference() {
  const c = cur();
  const acc = c && accOf(c);
  if (!c || !acc || !c.extra || !c.session || c.extra.status !== 'connected') return;
  // On reprend les deux lignes (fin de la musique d'attente) avant de les réunir
  if (c.view.held) setHold(c, 'main', false);
  if (c.extra.held) setHold(c, 'extra', false);
  setView(c);
  await new Promise((r) => setTimeout(r, 700));
  try {
    await appApi(acc, '/app/conference', { main: callIdOf(c.session), extra: callIdOf(c.extra?.session) });
    c.view = { ...c.view, conference: true, focus: 'main' };
    notice(c, 'Conférence à 3');
  } catch (e) { notice(c, oldPbx(e) ? 'Mets à jour le standard pour la conférence' : (e as Error).message || 'Conférence impossible'); }
}
/** Collègues du PBX de l'appel en cours (pour le transfert) */
export async function callTeam(): Promise<TeamMate[]> {
  const c = cur();
  const acc = c && accounts.find((a) => accountId(a) === c.key);
  if (!acc) return [];
  const r = await appApi<{ team: TeamMate[] }>(acc, '/app/team');
  return (r.team || []).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}
export function toggleMute() { if (current && Calls) Calls.setMuted(current.id, !current.muted).catch(() => {}); }
export function toggleSpeaker() {
  const c = current && calls.get(current.id);
  if (!c || !Calls) return;
  c.view = { ...c.view, speaker: !c.view.speaker };
  Calls.setAudioSessionPortOverride(c.view.speaker);
  setView(c);
}
export function sendDtmf(d: string) { const c = cur(); if (c) focused(c)?.sendDTMF(d); }

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
    if (c.noticeTimer) clearTimeout(c.noticeTimer);
    try { c.extra?.session.terminate(); } catch { /* déjà fini */ }
    try { c.session?.terminate(c.session.isEstablished() ? undefined : { status_code: 486 }); } catch { /* déjà fini */ }
    calls.delete(id); setView(null); stopIdleLines();
  });
  C.addOutgoingCallStartedListener(({ id }) => { onOutgoingStarted(id); });
  C.addSetMutedActionListener(({ id, isMuted }) => {
    const c = calls.get(id);
    if (!c?.session) return;
    for (const s of [c.session, c.extra?.session]) { if (s) { if (isMuted) s.mute({ audio: true }); else s.unmute({ audio: true }); } }
    c.view = { ...c.view, muted: isMuted }; setView(c);
  });
  C.addDTMFListener(({ id, digits }) => { const c = calls.get(id); if (c) focused(c)?.sendDTMF(digits); });
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
