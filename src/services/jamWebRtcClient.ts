import type {
  JamBroadcastState,
  JamQueueItem,
  JamRoomSnapshot,
  JamRtcConfig,
  Track,
} from '../shared/ipcTypes.ts';
import { equalizerEngine } from '../utils/audioEqualizer.ts';

export interface JamClientEventCallbacks {
  onRoomUpdated: (room: JamRoomSnapshot | null) => void;
  onRtcConfigUpdated: (config: JamRtcConfig) => void;
  onHostBroadcastReceived: (broadcast: JamBroadcastState, sharedQueue?: JamQueueItem[]) => void;
  onGuestQueueAdded: (item: JamQueueItem, room: JamRoomSnapshot) => void;
  onHostDisconnected: (message: string) => void;
  onKicked: (reason: string) => void;
  onError: (error: string, requirePin?: boolean) => void;
  onClockSyncUpdated: (stats: {
    clockOffsetMs: number;
    rttMs: number;
    roundsCompleted: number;
  }) => void;
  onRemoteStreamStateChanged: (isStreaming: boolean, stream: MediaStream | null) => void;
}

interface NtpRoundSample {
  round: number;
  rtt: number;
  offset: number;
}

const DEFAULT_STUN_SERVERS = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
  'stun:stun.cloudflare.com:3478',
];

export class JamWebRtcClient {
  private ws: WebSocket | null = null;
  private peerId: string;
  private callbacks: JamClientEventCallbacks | null = null;
  private room: JamRoomSnapshot | null = null;
  private rtcConfig: JamRtcConfig = {
    stunUrls: DEFAULT_STUN_SERVERS,
    turnUrl: '',
    turnUsername: '',
    turnCredential: '',
    streamMissingTracks: true,
  };

  // WebRTC PeerConnections & DataChannels keyed by remote peerId
  private peerConnections = new Map<string, RTCPeerConnection>();
  private dataChannels = new Map<string, RTCDataChannel>();
  private activeMediaSenders = new Map<string, RTCRtpSender[]>();

  // NTP Clock Sync State (Guest -> Host)
  private ntpSamples: NtpRoundSample[] = [];
  private pendingNtpResolve: (() => void) | null = null;
  private clockOffsetMs = 0;
  private rttMs = 0;
  private clockSyncInterval: number | null = null;

  // Remote WebRTC MediaStream Audio Element for missing track fallback
  private remoteStreamAudioEl: HTMLAudioElement | null = null;
  private activeRemoteStream: MediaStream | null = null;

  constructor() {
    const savedId =
      typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('aestheticy_jam_peer_id') : null;
    if (savedId) {
      this.peerId = savedId;
    } else {
      const randomHex = Array.from({ length: 8 }, () =>
        Math.floor(Math.random() * 16).toString(16)
      ).join('');
      this.peerId = `peer-${randomHex}`;
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem('aestheticy_jam_peer_id', this.peerId);
      }
    }
  }

  public getPeerId(): string {
    return this.peerId;
  }

  public getRoom(): JamRoomSnapshot | null {
    return this.room;
  }

  public getClockOffsetMs(): number {
    return this.clockOffsetMs;
  }

  public getRttMs(): number {
    return this.rttMs;
  }

  public setCallbacks(callbacks: JamClientEventCallbacks): void {
    this.callbacks = callbacks;
  }

  public setRemoteStreamVolume(volume: number, muted: boolean): void {
    if (this.remoteStreamAudioEl) {
      this.remoteStreamAudioEl.volume = Math.max(0, Math.min(1, volume));
      this.remoteStreamAudioEl.muted = muted;
    }
  }

  private ensureWebSocketConnected(): Promise<WebSocket> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return Promise.resolve(this.ws);
    }

    return new Promise((resolve, reject) => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/api/jam/signal`;
      const socket = new WebSocket(wsUrl);
      this.ws = socket;

      const timeout = window.setTimeout(() => {
        reject(new Error('Timed out connecting to Jam WebSocket signaling server.'));
      }, 6000);

      socket.onopen = () => {
        window.clearTimeout(timeout);
        resolve(socket);
      };

      socket.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error('Could not connect to Jam signaling server.'));
      };

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleSignalingMessage(msg);
        } catch {
          // ignore malformed message
        }
      };

      socket.onclose = () => {
        if (this.room) {
          this.cleanupAllPeers();
          this.room = null;
          this.callbacks?.onRoomUpdated(null);
        }
      };
    });
  }

  private sendSignaling(payload: Record<string, any>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  // ============================================================================
  // Start Jam / Join Jam / Leave Jam
  // ============================================================================

  public async startJam(options: {
    name: string;
    color: string;
    requireCode: boolean;
    accessPin?: string;
    allowGuestQueue: boolean;
    streamMissingTracks: boolean;
    inventoryKeys: string[];
    currentBroadcast: JamBroadcastState | null;
    sharedQueue: JamQueueItem[];
  }): Promise<void> {
    await this.ensureWebSocketConnected();
    this.clockOffsetMs = 0;
    this.rttMs = 0;

    this.sendSignaling({
      type: 'create-room',
      peerId: this.peerId,
      name: options.name,
      color: options.color,
      requireCode: options.requireCode,
      accessPin: options.accessPin || null,
      allowGuestQueue: options.allowGuestQueue,
      streamMissingTracks: options.streamMissingTracks,
      inventoryKeys: options.inventoryKeys,
      currentBroadcast: options.currentBroadcast,
      sharedQueue: options.sharedQueue,
    });
  }

  public async joinJam(options: {
    roomCode: string;
    name: string;
    color: string;
    accessPin?: string;
    inventoryKeys: string[];
  }): Promise<void> {
    await this.ensureWebSocketConnected();
    this.sendSignaling({
      type: 'join-room',
      peerId: this.peerId,
      roomCode: options.roomCode,
      name: options.name,
      color: options.color,
      accessPin: options.accessPin || '',
      inventoryKeys: options.inventoryKeys,
    });
  }

  public leaveJam(): void {
    this.sendSignaling({ type: 'leave-room' });
    this.cleanupAllPeers();
    this.room = null;
    this.callbacks?.onRoomUpdated(null);
  }

  // ============================================================================
  // Host & Participant Actions
  // ============================================================================

  public updateRoomSettings(settings: {
    isLocked?: boolean;
    requireCode?: boolean;
    accessPin?: string | null;
    allowGuestQueue?: boolean;
    streamMissingTracks?: boolean;
  }): void {
    this.sendSignaling({
      type: 'update-room-settings',
      ...settings,
    });
  }

  public kickParticipant(targetPeerId: string): void {
    this.sendSignaling({
      type: 'kick-participant',
      targetPeerId,
    });
    this.closePeerConnection(targetPeerId);
  }

  public broadcastHostPlayback(
    broadcast: JamBroadcastState,
    sharedQueue?: JamQueueItem[]
  ): void {
    if (!this.room || this.room.hostPeerId !== this.peerId) return;
    this.room.currentBroadcast = broadcast;
    if (sharedQueue) {
      this.room.sharedQueue = sharedQueue;
    }

    const packet = {
      type: 'host-broadcast',
      broadcast,
      sharedQueue,
    };

    // Send directly over all open WebRTC P2P DataChannels
    let sentOverAnyRelayNeeded = false;
    for (const participant of this.room.participants) {
      if (participant.peerId === this.peerId) continue;
      const dc = this.dataChannels.get(participant.peerId);
      if (dc && dc.readyState === 'open') {
        try {
          dc.send(JSON.stringify(packet));
        } catch {
          sentOverAnyRelayNeeded = true;
        }
      } else {
        sentOverAnyRelayNeeded = true;
      }
    }

    // Also update room snapshot on signaling server for newly joining peers or fallback relay
    if (sentOverAnyRelayNeeded || this.room.participants.length >= 1) {
      this.sendSignaling({
        type: 'host-broadcast',
        broadcast,
        sharedQueue,
      });
    }
  }

  public updateSharedQueue(sharedQueue: JamQueueItem[]): void {
    if (!this.room || this.room.hostPeerId !== this.peerId) return;
    this.room.sharedQueue = sharedQueue;
    this.sendSignaling({
      type: 'update-shared-queue',
      sharedQueue,
    });
    this.sendP2PToAll({
      type: 'shared-queue-sync',
      sharedQueue,
    });
  }

  public guestAddTrackToQueue(item: JamQueueItem): void {
    if (!this.room) return;
    this.sendP2PToPeer(this.room.hostPeerId, {
      type: 'guest-add-queue',
      item,
    });
    this.sendSignaling({
      type: 'guest-add-queue',
      item,
    });
  }

  public updateParticipantStatus(status: {
    hasCurrentTrack?: boolean;
    isStreamingFromHost?: boolean;
    connectionState?: 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
    transport?: 'webrtc-p2p' | 'signaling-relay';
    rttMs?: number;
    clockOffsetMs?: number;
    driftMs?: number;
    inventoryKeys?: string[];
  }): void {
    if (!this.room) return;
    this.sendSignaling({
      type: 'update-participant-state',
      ...status,
    });
  }

  // ============================================================================
  // Request / Stop Live WebRTC MediaStream Fallback for Missing Tracks
  // ============================================================================

  public requestHostAudioStreamForMissingTrack(enable: boolean): void {
    if (!this.room || this.room.hostPeerId === this.peerId) return;
    if (!enable) {
      this.stopRemoteAudioStreamPlayback();
      this.sendP2PToPeer(this.room.hostPeerId, {
        type: 'stop-audio-stream',
        fromPeerId: this.peerId,
      });
      this.updateParticipantStatus({ isStreamingFromHost: false });
      return;
    }

    this.sendP2PToPeer(this.room.hostPeerId, {
      type: 'request-audio-stream',
      fromPeerId: this.peerId,
    });
  }

  private async attachHostAudioStreamToGuestPeer(guestPeerId: string): Promise<void> {
    if (!this.room || this.room.hostPeerId !== this.peerId) return;
    const pc = this.peerConnections.get(guestPeerId);
    if (!pc) return;

    const captureStream = equalizerEngine.getCaptureStream();
    if (!captureStream) return;

    // Remove existing senders if any
    this.detachHostAudioStreamFromGuestPeer(guestPeerId);

    const senders: RTCRtpSender[] = [];
    for (const track of captureStream.getAudioTracks()) {
      try {
        const sender = pc.addTrack(track, captureStream);
        senders.push(sender);
      } catch {
        // ignore if already added
      }
    }
    this.activeMediaSenders.set(guestPeerId, senders);

    // Renegotiate SDP offer with the guest so their pc.ontrack fires
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.sendSignaling({
        type: 'webrtc-signal',
        targetPeerId: guestPeerId,
        signal: { type: 'offer', sdp: pc.localDescription },
      });
    } catch (err) {
      console.warn('[JamWebRTC] Failed to renegotiate audio stream offer:', err);
    }
  }

  private detachHostAudioStreamFromGuestPeer(guestPeerId: string): void {
    const pc = this.peerConnections.get(guestPeerId);
    const senders = this.activeMediaSenders.get(guestPeerId);
    if (pc && senders) {
      for (const sender of senders) {
        try {
          pc.removeTrack(sender);
        } catch {
          // ignore
        }
      }
    }
    this.activeMediaSenders.delete(guestPeerId);
  }

  public stopRemoteAudioStreamPlayback(): void {
    if (this.remoteStreamAudioEl) {
      this.remoteStreamAudioEl.pause();
      this.remoteStreamAudioEl.srcObject = null;
    }
    this.activeRemoteStream = null;
    this.callbacks?.onRemoteStreamStateChanged(false, null);
  }

  // ============================================================================
  // NTP-Style Clock Synchronization (At Least 5 Rounds, Median Offset)
  // ============================================================================

  public async runNtpClockSync(rounds = 7): Promise<{
    clockOffsetMs: number;
    rttMs: number;
  }> {
    if (!this.room || this.room.hostPeerId === this.peerId) {
      return { clockOffsetMs: 0, rttMs: 0 };
    }

    this.ntpSamples = [];
    const hostPeerId = this.room.hostPeerId;

    for (let r = 1; r <= rounds; r++) {
      await new Promise<void>((resolve) => {
        const timeout = window.setTimeout(() => {
          this.pendingNtpResolve = null;
          resolve();
        }, 450);

        this.pendingNtpResolve = () => {
          window.clearTimeout(timeout);
          this.pendingNtpResolve = null;
          resolve();
        };

        this.sendP2PToPeer(hostPeerId, {
          type: 'ntp-ping',
          round: r,
          t0: Date.now(),
        });
      });

      // Short gap between NTP rounds
      await new Promise((r) => setTimeout(r, 45));
    }

    if (this.ntpSamples.length > 0) {
      const sortedOffsets = [...this.ntpSamples].map((s) => s.offset).sort((a, b) => a - b);
      const sortedRtts = [...this.ntpSamples].map((s) => s.rtt).sort((a, b) => a - b);
      const mid = Math.floor(sortedOffsets.length / 2);

      this.clockOffsetMs = Math.round(
        sortedOffsets.length % 2 !== 0
          ? sortedOffsets[mid]
          : (sortedOffsets[mid - 1] + sortedOffsets[mid]) / 2
      );
      this.rttMs = Math.round(
        sortedRtts.length % 2 !== 0
          ? sortedRtts[mid]
          : (sortedRtts[mid - 1] + sortedRtts[mid]) / 2
      );

      this.callbacks?.onClockSyncUpdated({
        clockOffsetMs: this.clockOffsetMs,
        rttMs: this.rttMs,
        roundsCompleted: this.ntpSamples.length,
      });

      this.updateParticipantStatus({
        clockOffsetMs: this.clockOffsetMs,
        rttMs: this.rttMs,
      });
    }

    return {
      clockOffsetMs: this.clockOffsetMs,
      rttMs: this.rttMs,
    };
  }

  // ============================================================================
  // WebSocket Signaling & WebRTC Peer-to-Peer Negotiation
  // ============================================================================

  private handleSignalingMessage(msg: Record<string, any>): void {
    const type = msg.type as string;

    if (type === 'room-created') {
      this.room = msg.room as JamRoomSnapshot;
      if (msg.rtcConfig) {
        this.rtcConfig = msg.rtcConfig;
        this.callbacks?.onRtcConfigUpdated(this.rtcConfig);
      }
      this.callbacks?.onRoomUpdated(this.room);
      return;
    }

    if (type === 'room-joined') {
      this.room = msg.room as JamRoomSnapshot;
      if (msg.rtcConfig) {
        this.rtcConfig = msg.rtcConfig;
        this.callbacks?.onRtcConfigUpdated(this.rtcConfig);
      }
      this.callbacks?.onRoomUpdated(this.room);

      // Run initial 7-round NTP clock sync on join and schedule periodic re-sync every 20s
      setTimeout(() => {
        this.runNtpClockSync(7).catch(() => {});
      }, 250);

      if (this.clockSyncInterval) {
        window.clearInterval(this.clockSyncInterval);
      }
      this.clockSyncInterval = window.setInterval(() => {
        this.runNtpClockSync(5).catch(() => {});
      }, 20000);

      if (this.room.currentBroadcast) {
        this.callbacks?.onHostBroadcastReceived(
          this.room.currentBroadcast,
          this.room.sharedQueue
        );
      }
      return;
    }

    if (type === 'join-error') {
      this.callbacks?.onError(
        msg.error || 'Could not join Jam session.',
        Boolean(msg.requirePin)
      );
      return;
    }

    if (type === 'peer-joined') {
      const peerId = msg.peerId as string;
      this.room = msg.room as JamRoomSnapshot;
      this.callbacks?.onRoomUpdated(this.room);

      // Host initiates WebRTC peer connection to the newly joined guest
      if (this.room && this.room.hostPeerId === this.peerId && peerId !== this.peerId) {
        this.initiateWebRtcConnection(peerId, true);
      }
      return;
    }

    if (type === 'peer-left') {
      const peerId = msg.peerId as string;
      this.closePeerConnection(peerId);
      this.room = msg.room as JamRoomSnapshot;
      this.callbacks?.onRoomUpdated(this.room);
      return;
    }

    if (type === 'room-snapshot') {
      this.room = msg.room as JamRoomSnapshot;
      this.callbacks?.onRoomUpdated(this.room);
      return;
    }

    if (type === 'webrtc-signal') {
      const fromPeerId = msg.fromPeerId as string;
      const signal = msg.signal;
      this.handleIncomingWebRtcSignal(fromPeerId, signal);
      return;
    }

    if (type === 'p2p-relay') {
      const fromPeerId = msg.fromPeerId as string;
      this.handleP2PPayload(fromPeerId, msg.payload);
      return;
    }

    if (type === 'host-broadcast') {
      const broadcast = msg.broadcast as JamBroadcastState;
      const sharedQueue = msg.sharedQueue as JamQueueItem[] | undefined;
      if (this.room) {
        this.room.currentBroadcast = broadcast;
        if (sharedQueue) this.room.sharedQueue = sharedQueue;
      }
      this.callbacks?.onHostBroadcastReceived(broadcast, sharedQueue);
      return;
    }

    if (type === 'guest-queue-added') {
      const item = msg.item as JamQueueItem;
      this.room = msg.room as JamRoomSnapshot;
      this.callbacks?.onRoomUpdated(this.room);
      this.callbacks?.onGuestQueueAdded(item, this.room);
      return;
    }

    if (type === 'host-disconnected') {
      this.cleanupAllPeers();
      this.room = null;
      this.callbacks?.onRoomUpdated(null);
      this.callbacks?.onHostDisconnected(
        msg.message || 'Host disconnected from the Jam session.'
      );
      return;
    }

    if (type === 'kicked') {
      this.cleanupAllPeers();
      this.room = null;
      this.callbacks?.onRoomUpdated(null);
      this.callbacks?.onKicked(msg.reason || 'You were removed from the Jam session.');
      return;
    }
  }

  private buildRtcConfiguration(): RTCConfiguration {
    const iceServers: RTCIceServer[] = [];
    const stunList =
      this.rtcConfig.stunUrls && this.rtcConfig.stunUrls.length > 0
        ? this.rtcConfig.stunUrls
        : DEFAULT_STUN_SERVERS;

    iceServers.push({ urls: stunList });

    if (this.rtcConfig.turnUrl && this.rtcConfig.turnUrl.trim()) {
      const turnEntry: RTCIceServer = {
        urls: this.rtcConfig.turnUrl.trim(),
      };
      if (this.rtcConfig.turnUsername) {
        turnEntry.username = this.rtcConfig.turnUsername.trim();
      }
      if (this.rtcConfig.turnCredential) {
        turnEntry.credential = this.rtcConfig.turnCredential;
      }
      iceServers.push(turnEntry);
    }

    return { iceServers };
  }

  private initiateWebRtcConnection(remotePeerId: string, isInitiator: boolean): RTCPeerConnection {
    let pc = this.peerConnections.get(remotePeerId);
    if (pc) {
      return pc;
    }

    pc = new RTCPeerConnection(this.buildRtcConfiguration());
    this.peerConnections.set(remotePeerId, pc);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignaling({
          type: 'webrtc-signal',
          targetPeerId: remotePeerId,
          signal: { type: 'candidate', candidate: event.candidate },
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (!pc) return;
      if (pc.connectionState === 'connected') {
        this.updateParticipantStatus({
          connectionState: 'connected',
          transport: 'webrtc-p2p',
        });
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        // Fallback smoothly to signaling relay if direct UDP is blocked
        this.updateParticipantStatus({
          connectionState: 'connected',
          transport: 'signaling-relay',
        });
      }
    };

    // Receive live audio MediaStream from Host when guest is missing the current track
    pc.ontrack = (event) => {
      const stream = event.streams?.[0] || new MediaStream([event.track]);
      this.activeRemoteStream = stream;

      if (!this.remoteStreamAudioEl) {
        this.remoteStreamAudioEl = new Audio();
        this.remoteStreamAudioEl.autoplay = true;
      }
      this.remoteStreamAudioEl.srcObject = stream;
      this.remoteStreamAudioEl.play().catch(() => {});

      this.updateParticipantStatus({ isStreamingFromHost: true });
      this.callbacks?.onRemoteStreamStateChanged(true, stream);
    };

    if (isInitiator) {
      const dc = pc.createDataChannel('aestheticy-jam-sync', {
        ordered: true,
      });
      this.setupDataChannel(remotePeerId, dc);

      pc.createOffer()
        .then((offer) => pc!.setLocalDescription(offer))
        .then(() => {
          this.sendSignaling({
            type: 'webrtc-signal',
            targetPeerId: remotePeerId,
            signal: { type: 'offer', sdp: pc!.localDescription },
          });
        })
        .catch(() => {});
    } else {
      pc.ondatachannel = (event) => {
        this.setupDataChannel(remotePeerId, event.channel);
      };
    }

    return pc;
  }

  private setupDataChannel(remotePeerId: string, dc: RTCDataChannel): void {
    this.dataChannels.set(remotePeerId, dc);

    dc.onopen = () => {
      this.updateParticipantStatus({
        connectionState: 'connected',
        transport: 'webrtc-p2p',
      });

      // If we are the guest and data channel just opened, run a fresh NTP sync over P2P
      if (this.room && this.room.hostPeerId === remotePeerId) {
        this.runNtpClockSync(7).catch(() => {});
      }

      // If we are the host and have an active broadcast, send it immediately over P2P
      if (this.room && this.room.hostPeerId === this.peerId && this.room.currentBroadcast) {
        try {
          dc.send(
            JSON.stringify({
              type: 'host-broadcast',
              broadcast: this.room.currentBroadcast,
              sharedQueue: this.room.sharedQueue,
            })
          );
        } catch {
          // ignore
        }
      }
    };

    dc.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        this.handleP2PPayload(remotePeerId, payload);
      } catch {
        // ignore
      }
    };
  }

  private async handleIncomingWebRtcSignal(remotePeerId: string, signal: any): Promise<void> {
    if (!signal) return;
    const pc = this.initiateWebRtcConnection(remotePeerId, false);

    try {
      if (signal.type === 'offer' && signal.sdp) {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.sendSignaling({
          type: 'webrtc-signal',
          targetPeerId: remotePeerId,
          signal: { type: 'answer', sdp: pc.localDescription },
        });
      } else if (signal.type === 'answer' && signal.sdp) {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      } else if (signal.type === 'candidate' && signal.candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      }
    } catch {
      // Fallback to signaling relay if ICE/SDP fails in container environments
      this.updateParticipantStatus({
        connectionState: 'connected',
        transport: 'signaling-relay',
      });
    }
  }

  private sendP2PToPeer(targetPeerId: string, payload: Record<string, any>): void {
    const dc = this.dataChannels.get(targetPeerId);
    if (dc && dc.readyState === 'open') {
      try {
        dc.send(JSON.stringify(payload));
        return;
      } catch {
        // fall through to signaling relay
      }
    }
    this.sendSignaling({
      type: 'p2p-relay',
      targetPeerId,
      payload,
    });
  }

  private sendP2PToAll(payload: Record<string, any>): void {
    if (!this.room) return;
    for (const part of this.room.participants) {
      if (part.peerId === this.peerId) continue;
      this.sendP2PToPeer(part.peerId, payload);
    }
  }

  private handleP2PPayload(fromPeerId: string, payload: Record<string, any>): void {
    if (!payload) return;
    const type = payload.type as string;

    if (type === 'ntp-ping') {
      const t1 = Date.now();
      this.sendP2PToPeer(fromPeerId, {
        type: 'ntp-pong',
        round: payload.round,
        t0: payload.t0,
        t1,
        t2: Date.now(),
      });
      return;
    }

    if (type === 'ntp-pong') {
      const t3 = Date.now();
      const t0 = Number(payload.t0);
      const t1 = Number(payload.t1);
      const t2 = Number(payload.t2);
      const rtt = Math.max(0, (t3 - t0) - (t2 - t1));
      const offset = ((t1 - t0) + (t2 - t3)) / 2;

      this.ntpSamples.push({
        round: Number(payload.round || 1),
        rtt,
        offset,
      });

      if (this.pendingNtpResolve) {
        this.pendingNtpResolve();
      }
      return;
    }

    if (type === 'host-broadcast') {
      const broadcast = payload.broadcast as JamBroadcastState;
      const sharedQueue = payload.sharedQueue as JamQueueItem[] | undefined;
      if (this.room) {
        this.room.currentBroadcast = broadcast;
        if (sharedQueue) this.room.sharedQueue = sharedQueue;
      }
      this.callbacks?.onHostBroadcastReceived(broadcast, sharedQueue);
      return;
    }

    if (type === 'shared-queue-sync') {
      if (this.room && Array.isArray(payload.sharedQueue)) {
        this.room.sharedQueue = payload.sharedQueue;
        this.callbacks?.onRoomUpdated({ ...this.room });
      }
      return;
    }

    if (type === 'request-audio-stream') {
      if (this.room && this.room.hostPeerId === this.peerId) {
        this.attachHostAudioStreamToGuestPeer(fromPeerId).catch(() => {});
      }
      return;
    }

    if (type === 'stop-audio-stream') {
      if (this.room && this.room.hostPeerId === this.peerId) {
        this.detachHostAudioStreamFromGuestPeer(fromPeerId);
      }
      return;
    }
  }

  private closePeerConnection(peerId: string): void {
    const dc = this.dataChannels.get(peerId);
    if (dc) {
      try {
        dc.close();
      } catch {}
      this.dataChannels.delete(peerId);
    }

    const pc = this.peerConnections.get(peerId);
    if (pc) {
      try {
        pc.close();
      } catch {}
      this.peerConnections.delete(peerId);
    }

    this.activeMediaSenders.delete(peerId);
  }

  private cleanupAllPeers(): void {
    if (this.clockSyncInterval) {
      window.clearInterval(this.clockSyncInterval);
      this.clockSyncInterval = null;
    }
    this.stopRemoteAudioStreamPlayback();
    for (const peerId of Array.from(this.peerConnections.keys())) {
      this.closePeerConnection(peerId);
    }
    this.dataChannels.clear();
    this.peerConnections.clear();
    this.activeMediaSenders.clear();
  }
}

export const jamWebRtcClient = new JamWebRtcClient();
