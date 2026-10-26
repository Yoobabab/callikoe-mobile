/**
 * Moteur d'appel natif de l'appli : JsSIP (SIP sur WebSocket) + WebRTC natif (@livekit/react-native-webrtc).
 * Une ligne = un compte (poste <n>-app sur son PBX). Chargé seulement dans une vraie version de l'appli (pas dans Expo Go).
 */
import type { SipAccount } from './pbxApi';

type JsSIPModule = typeof import('jssip');
type RTCSession = import('jssip/lib/RTCSession').RTCSession;

let JsSIP: JsSIPModule | null = null;
/** Charge WebRTC natif et JsSIP (une fois) */
export function loadSip(): JsSIPModule {
  if (JsSIP) return JsSIP;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const webrtc = require('@livekit/react-native-webrtc');
  webrtc.registerGlobals();   // RTCPeerConnection, getUserMedia… pour JsSIP
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  JsSIP = require('jssip') as JsSIPModule;
  JsSIP.debug.disable();
  return JsSIP;
}

export type LineEvents = {
  onRegistered?: () => void;
  onRegistrationFailed?: (cause: string) => void;
  onIncoming?: (s: RTCSession, info: { callId: string; number: string; name: string }) => void;
};

const MEDIA = { mediaConstraints: { audio: true, video: false }, pcConfig: { iceServers: [] as { urls: string }[] }, rtcOfferConstraints: { offerToReceiveAudio: true, offerToReceiveVideo: false } };

export class SipLine {
  ua: InstanceType<JsSIPModule['UA']> | null = null;
  registered = false;
  private waiters: (() => void)[] = [];
  constructor(readonly sip: SipAccount, private readonly ev: LineEvents) {}

  start(): void {
    if (this.ua) return;
    const J = loadSip();
    const socket = new J.WebSocketInterface(this.sip.ws_url);
    const ua = new J.UA({
      sockets: [socket], uri: `sip:${this.sip.username}@${this.sip.domain}`, authorization_user: this.sip.username, password: this.sip.password,
      display_name: this.sip.name, register: true, register_expires: 120, session_timers: false, user_agent: 'Callikoe-App/0.2 (natif)',
    });
    ua.on('registered', () => { this.registered = true; this.waiters.splice(0).forEach((w) => w()); this.ev.onRegistered?.(); });
    ua.on('unregistered', () => { this.registered = false; });
    ua.on('registrationFailed', (e: { cause?: string }) => { this.registered = false; this.ev.onRegistrationFailed?.(String(e?.cause || 'échec')); });
    ua.on('newRTCSession', (e: { originator: string; session: RTCSession; request: { getHeader: (h: string) => string | undefined; from: { display_name?: string; uri: { user: string } } } }) => {
      if (e.originator !== 'remote') return;
      const req = e.request;
      this.ev.onIncoming?.(e.session, {
        callId: req.getHeader('X-Callikoe-Call') || '',
        number: req.from?.uri?.user || '',
        name: req.from?.display_name || '',
      });
    });
    ua.start();
    this.ua = ua;
  }
  /** Attend l'enregistrement auprès du PBX (au plus `ms`) */
  whenRegistered(ms = 8000): Promise<boolean> {
    if (this.registered) return Promise.resolve(true);
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(false), ms);
      this.waiters.push(() => { clearTimeout(t); resolve(true); });
    });
  }
  call(number: string): RTCSession {
    if (!this.ua) throw new Error('Ligne non démarrée');
    return this.ua.call(`sip:${number}@${this.sip.domain}`, MEDIA) as RTCSession;
  }
  answer(s: RTCSession): void { s.answer(MEDIA); }
  stop(): void {
    try { this.ua?.unregister({ all: false }); } catch { /* déjà déconnecté */ }
    try { this.ua?.stop(); } catch { /* idem */ }
    this.ua = null;
    this.registered = false;
  }
}
