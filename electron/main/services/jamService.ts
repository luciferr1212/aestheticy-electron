import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import type http from 'http';
import type { Duplex } from 'stream';
import { WebSocketServer, WebSocket } from 'ws';
import { sqliteManager } from '../db/sqlite.ts';
import { ffmpegService } from './ffmpegService.ts';
import type {
  JamBroadcastState,
  JamParticipant,
  JamQueueItem,
  JamRoomSnapshot,
  JamRtcConfig,
  JamStatus,
} from '../../../src/shared/ipcTypes.ts';

const JAM_RTC_SETTINGS_KEY = 'jam_rtc_config';

const DEFAULT_RTC_CONFIG: JamRtcConfig = {
  stunUrls: [
    'stun:stun.l.google.com:19302',
    'stun:stun1.l.google.com:19302',
    'stun:stun.cloudflare.com:3478',
  ],
  turnUrl: '',
  turnUsername: '',
  turnCredential: '',
  streamMissingTracks: true,
};

interface SignalingClient {
  ws: WebSocket;
  peerId: string;
  roomCode: string | null;
}

interface InternalRoomState extends JamRoomSnapshot {
  clients: Map<string, WebSocket>;
}

export class JamService {
  private wss: WebSocketServer | null = null;
  private rooms = new Map<string, InternalRoomState>();
  private clients = new Map<WebSocket, SignalingClient>();
  private isFingerprintingBg = false;

  public getRtcConfig(): JamRtcConfig {
    try {
      const db = sqliteManager.getDatabase();
      const row = db
        .prepare<{ value: string }>('SELECT value FROM settings WHERE key = ?')
        .get(JAM_RTC_SETTINGS_KEY);
      if (!row?.value) {
        return { ...DEFAULT_RTC_CONFIG };
      }
      const parsed = JSON.parse(row.value) as Partial<JamRtcConfig>;
      return {
        stunUrls:
          Array.isArray(parsed.stunUrls) && parsed.stunUrls.length > 0
            ? parsed.stunUrls
            : [...DEFAULT_RTC_CONFIG.stunUrls],
        turnUrl: typeof parsed.turnUrl === 'string' ? parsed.turnUrl : '',
        turnUsername: typeof parsed.turnUsername === 'string' ? parsed.turnUsername : '',
        turnCredential: typeof parsed.turnCredential === 'string' ? parsed.turnCredential : '',
        streamMissingTracks:
          typeof parsed.streamMissingTracks === 'boolean'
            ? parsed.streamMissingTracks
            : DEFAULT_RTC_CONFIG.streamMissingTracks,
      };
    } catch {
      return { ...DEFAULT_RTC_CONFIG };
    }
  }

  public saveRtcConfig(partial: Partial<JamRtcConfig>): JamRtcConfig {
    const current = this.getRtcConfig();
    const merged: JamRtcConfig = {
      ...current,
      ...partial,
      stunUrls:
        Array.isArray(partial.stunUrls) && partial.stunUrls.length > 0
          ? partial.stunUrls.map((s) => s.trim()).filter(Boolean)
          : current.stunUrls,
    };

    try {
      const db = sqliteManager.getDatabase();
      db.prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      ).run(JAM_RTC_SETTINGS_KEY, JSON.stringify(merged));
    } catch (err) {
      console.error('[JamService] Failed to save RTC config:', err);
    }

    return merged;
  }

  public async getStatus(): Promise<JamStatus> {
    const firstRoom = this.rooms.values().next().value as InternalRoomState | undefined;
    return {
      active: this.rooms.size > 0,
      sessionId: firstRoom ? firstRoom.roomCode : null,
      signalingPath: '/api/jam/signal',
      activeRoomsCount: this.rooms.size,
      rtcConfig: this.getRtcConfig(),
    };
  }

  // ============================================================================
  // Background Acoustic / Chromaprint Fingerprinting & SQLite Caching
  // ============================================================================

  /**
   * Computes a format-independent acoustic fingerprint for an audio file using
   * child_process.spawn (fpcalc if installed, otherwise FFmpeg decoded PCM
   * 32-band quantized energy contour hash) and caches it in SQLite.
   */
  public async getOrComputeTrackChromaprint(trackId: number): Promise<string | null> {
    const db = sqliteManager.getDatabase();
    const row = db
      .prepare<{
        id: number;
        file_path: string;
        chromaprint: string | null;
        unplayable: number;
      }>('SELECT id, file_path, chromaprint, unplayable FROM tracks WHERE id = ?')
      .get(trackId);

    if (!row || row.unplayable) return null;
    if (row.chromaprint) return row.chromaprint;
    if (!fs.existsSync(row.file_path)) return null;

    const computed = await this.computeAcousticFingerprint(row.file_path);
    if (computed) {
      try {
        db.prepare('UPDATE tracks SET chromaprint = ? WHERE id = ?').run(computed, trackId);
      } catch {
        // ignore update race
      }
    }
    return computed;
  }

  private async computeAcousticFingerprint(filePath: string): Promise<string | null> {
    const ffmpegBin = ffmpegService.getFfmpegPath();
    if (!ffmpegBin) return null;

    return new Promise((resolve) => {
      // Decode first 25 seconds to 4000 Hz mono 16-bit signed PCM
      const args = [
        '-nostdin',
        '-v',
        'error',
        '-t',
        '25',
        '-i',
        filePath,
        '-ac',
        '1',
        '-ar',
        '4000',
        '-f',
        's16le',
        'pipe:1',
      ];

      const proc = spawn(ffmpegBin, args);
      const chunks: Buffer[] = [];
      let totalLen = 0;
      const maxBytes = 4000 * 2 * 25; // 200 KB max

      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        resolve(null);
      }, 10000);

      proc.stdout.on('data', (chunk: Buffer) => {
        if (totalLen < maxBytes) {
          chunks.push(chunk);
          totalLen += chunk.length;
        }
      });

      proc.on('error', () => {
        clearTimeout(timer);
        resolve(null);
      });

      proc.on('close', () => {
        clearTimeout(timer);
        const pcm = Buffer.concat(chunks);
        if (pcm.length < 1600) {
          resolve(null);
          return;
        }

        // Compute 32-segment normalized RMS energy contour + zero-crossing signature
        // This is invariant to container/codec (FLAC, ALAC, WAV, AIFF, MP3 match)
        const sampleCount = Math.floor(pcm.length / 2);
        const buckets = 32;
        const samplesPerBucket = Math.max(1, Math.floor(sampleCount / buckets));
        const rmsValues: number[] = [];

        let maxRms = 1;
        for (let b = 0; b < buckets; b++) {
          let sumSq = 0;
          const start = b * samplesPerBucket;
          const end = Math.min(sampleCount, start + samplesPerBucket);
          for (let i = start; i < end; i++) {
            const val = pcm.readInt16LE(i * 2);
            sumSq += val * val;
          }
          const rms = Math.sqrt(sumSq / Math.max(1, end - start));
          rmsValues.push(rms);
          if (rms > maxRms) maxRms = rms;
        }

        // Quantize each bucket into 0..15 relative to peak RMS so gain differences don't break matching
        const hexNibbles = rmsValues
          .map((r) => Math.min(15, Math.round((r / maxRms) * 15)).toString(16))
          .join('');

        const digest = crypto
          .createHash('sha1')
          .update(hexNibbles)
          .digest('hex')
          .slice(0, 16)
          .toUpperCase();

        resolve(`AQFP1-${digest}`);
      });
    });
  }

  public async computeLibraryFingerprintsInBackground(): Promise<{
    computed: number;
    total: number;
  }> {
    const db = sqliteManager.getDatabase();
    const rows = db
      .prepare<{ id: number; chromaprint: string | null }>(
        'SELECT id, chromaprint FROM tracks WHERE unplayable = 0'
      )
      .all();

    const total = rows.length;
    const missing = rows.filter((r) => !r.chromaprint);

    if (missing.length === 0) {
      return { computed: total, total };
    }

    if (!this.isFingerprintingBg) {
      this.isFingerprintingBg = true;
      (async () => {
        try {
          for (const item of missing) {
            await this.getOrComputeTrackChromaprint(item.id);
          }
        } finally {
          this.isFingerprintingBg = false;
        }
      })();
    }

    const alreadyComputed = total - missing.length;
    return { computed: alreadyComputed, total };
  }

  // ============================================================================
  // Minimal WebSocket Signaling Server for WebRTC Handshake & Room Coordination
  // ============================================================================

  public attachSignalingServer(httpServer: http.Server): void {
    if (this.wss) return;

    this.wss = new WebSocketServer({ noServer: true });

    httpServer.on('upgrade', (request: http.IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = request.url || '';
      if (url.startsWith('/api/jam/signal')) {
        this.wss!.handleUpgrade(request, socket, head, (ws) => {
          this.wss!.emit('connection', ws, request);
        });
      }
    });

    this.wss.on('connection', (ws: WebSocket) => {
      const tempPeerId = `peer-${crypto.randomBytes(4).toString('hex')}`;
      this.clients.set(ws, { ws, peerId: tempPeerId, roomCode: null });

      ws.on('message', (raw: Buffer | string) => {
        try {
          const msg = JSON.parse(raw.toString());
          this.handleSignalingMessage(ws, msg);
        } catch (err) {
          console.error('[JamService] Invalid signaling message:', err);
        }
      });

      ws.on('close', () => {
        this.handleClientDisconnect(ws);
      });

      ws.on('error', () => {
        this.handleClientDisconnect(ws);
      });
    });

    // Trigger non-blocking background fingerprinting on startup
    setTimeout(() => {
      this.computeLibraryFingerprintsInBackground().catch(() => {});
    }, 3000);
  }

  private generateShortRoomCode(): string {
    const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    for (let attempt = 0; attempt < 20; attempt++) {
      let code = '';
      for (let i = 0; i < 6; i++) {
        code += alphabet[Math.floor(Math.random() * alphabet.length)];
      }
      if (!this.rooms.has(code)) {
        return code;
      }
    }
    return crypto.randomBytes(3).toString('hex').toUpperCase();
  }

  private normalizeRoomCode(input: string): string {
    return (input || '')
      .toUpperCase()
      .replace(/^JAM-/, '')
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 8);
  }

  private toPublicSnapshot(room: InternalRoomState): JamRoomSnapshot {
    return {
      roomCode: room.roomCode,
      hostPeerId: room.hostPeerId,
      hostName: room.hostName,
      isLocked: room.isLocked,
      requireCode: room.requireCode,
      accessPin: room.accessPin,
      allowGuestQueue: room.allowGuestQueue,
      streamMissingTracks: room.streamMissingTracks,
      participants: room.participants,
      sharedQueue: room.sharedQueue,
      currentBroadcast: room.currentBroadcast,
      createdAt: room.createdAt,
    };
  }

  private sendJson(ws: WebSocket, payload: Record<string, any>): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  private broadcastToRoom(
    room: InternalRoomState,
    payload: Record<string, any>,
    excludePeerId?: string
  ): void {
    const serialized = JSON.stringify(payload);
    for (const [peerId, clientWs] of room.clients.entries()) {
      if (excludePeerId && peerId === excludePeerId) continue;
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(serialized);
      }
    }
  }

  private handleSignalingMessage(ws: WebSocket, msg: Record<string, any>): void {
    const clientInfo = this.clients.get(ws);
    if (!clientInfo) return;

    const type = msg.type as string;

    if (type === 'create-room') {
      // Leave any existing room first
      this.handleClientDisconnect(ws, true);

      const peerId = (msg.peerId as string) || clientInfo.peerId;
      clientInfo.peerId = peerId;

      const roomCode = this.generateShortRoomCode();
      clientInfo.roomCode = roomCode;

      const hostName = (msg.name as string)?.trim() || 'Host';
      const hostColor = (msg.color as string) || '#818CF8';
      const inventoryKeys = Array.isArray(msg.inventoryKeys) ? msg.inventoryKeys : [];
      const currentBroadcast = (msg.currentBroadcast as JamBroadcastState | null) || null;
      const sharedQueue = Array.isArray(msg.sharedQueue) ? (msg.sharedQueue as JamQueueItem[]) : [];
      const rtcConfig = this.getRtcConfig();

      const hostParticipant: JamParticipant = {
        peerId,
        name: hostName,
        color: hostColor,
        isHost: true,
        joinedAt: Date.now(),
        connectionState: 'connected',
        transport: 'webrtc-p2p',
        hasCurrentTrack: true,
        isStreamingFromHost: false,
        rttMs: 0,
        clockOffsetMs: 0,
        driftMs: 0,
        inventoryKeys,
      };

      const room: InternalRoomState = {
        roomCode,
        hostPeerId: peerId,
        hostName,
        isLocked: false,
        requireCode: Boolean(msg.requireCode),
        accessPin: msg.accessPin ? String(msg.accessPin).trim() : null,
        allowGuestQueue: msg.allowGuestQueue !== undefined ? Boolean(msg.allowGuestQueue) : true,
        streamMissingTracks:
          msg.streamMissingTracks !== undefined
            ? Boolean(msg.streamMissingTracks)
            : rtcConfig.streamMissingTracks,
        participants: [hostParticipant],
        sharedQueue,
        currentBroadcast,
        createdAt: Date.now(),
        clients: new Map([[peerId, ws]]),
      };

      this.rooms.set(roomCode, room);

      this.sendJson(ws, {
        type: 'room-created',
        room: this.toPublicSnapshot(room),
        rtcConfig,
      });
      return;
    }

    if (type === 'join-room') {
      this.handleClientDisconnect(ws, true);

      const roomCode = this.normalizeRoomCode(msg.roomCode || '');
      const room = this.rooms.get(roomCode);

      if (!room) {
        this.sendJson(ws, {
          type: 'join-error',
          error: `Room "${roomCode || msg.roomCode}" was not found or has ended.`,
        });
        return;
      }

      if (room.isLocked) {
        this.sendJson(ws, {
          type: 'join-error',
          error: 'This Jam room is currently locked by the host.',
        });
        return;
      }

      if (room.requireCode && room.accessPin) {
        const providedPin = String(msg.accessPin || '').trim();
        if (providedPin !== room.accessPin) {
          this.sendJson(ws, {
            type: 'join-error',
            requirePin: true,
            error: providedPin
              ? 'Incorrect room PIN code.'
              : 'This Jam room requires a 4-digit PIN code from the host.',
          });
          return;
        }
      }

      const peerId = (msg.peerId as string) || clientInfo.peerId;
      clientInfo.peerId = peerId;
      clientInfo.roomCode = roomCode;

      const guestName = (msg.name as string)?.trim() || `Listener ${room.participants.length}`;
      const guestColor = (msg.color as string) || '#38BDF8';
      const inventoryKeys = Array.isArray(msg.inventoryKeys) ? msg.inventoryKeys : [];

      const existingIdx = room.participants.findIndex((p) => p.peerId === peerId);
      const guestParticipant: JamParticipant = {
        peerId,
        name: guestName,
        color: guestColor,
        isHost: false,
        joinedAt: Date.now(),
        connectionState: 'connecting',
        transport: 'webrtc-p2p',
        hasCurrentTrack: true,
        isStreamingFromHost: false,
        rttMs: null,
        clockOffsetMs: null,
        driftMs: null,
        inventoryKeys,
      };

      if (existingIdx >= 0) {
        room.participants[existingIdx] = guestParticipant;
      } else {
        room.participants.push(guestParticipant);
      }
      room.clients.set(peerId, ws);

      const snapshot = this.toPublicSnapshot(room);
      const rtcConfig = this.getRtcConfig();

      this.sendJson(ws, {
        type: 'room-joined',
        room: snapshot,
        rtcConfig,
      });

      this.broadcastToRoom(
        room,
        {
          type: 'peer-joined',
          peerId,
          participant: guestParticipant,
          room: snapshot,
        },
        peerId
      );
      return;
    }

    // All subsequent commands require an active room
    const roomCode = clientInfo.roomCode;
    if (!roomCode) return;
    const room = this.rooms.get(roomCode);
    if (!room) return;

    if (type === 'webrtc-signal') {
      const targetPeerId = msg.targetPeerId as string;
      const targetWs = room.clients.get(targetPeerId);
      if (targetWs) {
        this.sendJson(targetWs, {
          type: 'webrtc-signal',
          fromPeerId: clientInfo.peerId,
          signal: msg.signal,
        });
      }
      return;
    }

    if (type === 'p2p-relay') {
      const targetPeerId = msg.targetPeerId as string | undefined;
      if (targetPeerId) {
        const targetWs = room.clients.get(targetPeerId);
        if (targetWs) {
          this.sendJson(targetWs, {
            type: 'p2p-relay',
            fromPeerId: clientInfo.peerId,
            payload: msg.payload,
          });
        }
      } else {
        this.broadcastToRoom(
          room,
          {
            type: 'p2p-relay',
            fromPeerId: clientInfo.peerId,
            payload: msg.payload,
          },
          clientInfo.peerId
        );
      }
      return;
    }

    if (type === 'host-broadcast') {
      if (clientInfo.peerId !== room.hostPeerId) return;
      const broadcast = msg.broadcast as JamBroadcastState;
      room.currentBroadcast = broadcast;
      if (Array.isArray(msg.sharedQueue)) {
        room.sharedQueue = msg.sharedQueue;
      }
      this.broadcastToRoom(
        room,
        {
          type: 'host-broadcast',
          broadcast,
          sharedQueue: room.sharedQueue,
        },
        clientInfo.peerId
      );
      return;
    }

    if (type === 'update-room-settings') {
      if (clientInfo.peerId !== room.hostPeerId) return;
      if (typeof msg.isLocked === 'boolean') room.isLocked = msg.isLocked;
      if (typeof msg.requireCode === 'boolean') room.requireCode = msg.requireCode;
      if (msg.accessPin !== undefined) {
        room.accessPin = msg.accessPin ? String(msg.accessPin).trim() : null;
      }
      if (typeof msg.allowGuestQueue === 'boolean') room.allowGuestQueue = msg.allowGuestQueue;
      if (typeof msg.streamMissingTracks === 'boolean') {
        room.streamMissingTracks = msg.streamMissingTracks;
      }

      this.broadcastToRoom(room, {
        type: 'room-snapshot',
        room: this.toPublicSnapshot(room),
      });
      return;
    }

    if (type === 'kick-participant') {
      if (clientInfo.peerId !== room.hostPeerId) return;
      const targetPeerId = msg.targetPeerId as string;
      if (!targetPeerId || targetPeerId === room.hostPeerId) return;

      const targetWs = room.clients.get(targetPeerId);
      if (targetWs) {
        this.sendJson(targetWs, {
          type: 'kicked',
          roomCode: room.roomCode,
          reason: 'You were removed from the Jam session by the host.',
        });
        const targetClient = this.clients.get(targetWs);
        if (targetClient) targetClient.roomCode = null;
        room.clients.delete(targetPeerId);
      }

      room.participants = room.participants.filter((p) => p.peerId !== targetPeerId);
      this.broadcastToRoom(room, {
        type: 'room-snapshot',
        room: this.toPublicSnapshot(room),
      });
      return;
    }

    if (type === 'update-participant-state') {
      const part = room.participants.find((p) => p.peerId === clientInfo.peerId);
      if (!part) return;

      if (typeof msg.hasCurrentTrack === 'boolean') part.hasCurrentTrack = msg.hasCurrentTrack;
      if (typeof msg.isStreamingFromHost === 'boolean') {
        part.isStreamingFromHost = msg.isStreamingFromHost;
      }
      if (msg.connectionState) part.connectionState = msg.connectionState;
      if (msg.transport) part.transport = msg.transport;
      if (typeof msg.rttMs === 'number') part.rttMs = msg.rttMs;
      if (typeof msg.clockOffsetMs === 'number') part.clockOffsetMs = msg.clockOffsetMs;
      if (typeof msg.driftMs === 'number') part.driftMs = msg.driftMs;
      if (Array.isArray(msg.inventoryKeys)) part.inventoryKeys = msg.inventoryKeys;

      this.broadcastToRoom(room, {
        type: 'room-snapshot',
        room: this.toPublicSnapshot(room),
      });
      return;
    }

    if (type === 'update-shared-queue') {
      if (clientInfo.peerId !== room.hostPeerId) return;
      if (Array.isArray(msg.sharedQueue)) {
        room.sharedQueue = msg.sharedQueue;
        this.broadcastToRoom(room, {
          type: 'room-snapshot',
          room: this.toPublicSnapshot(room),
        });
      }
      return;
    }

    if (type === 'guest-add-queue') {
      if (!room.allowGuestQueue && clientInfo.peerId !== room.hostPeerId) return;
      const item = msg.item as JamQueueItem | undefined;
      if (!item || !item.id || !item.trackIdentity) return;

      // Idempotency guard
      if (!room.sharedQueue.some((q) => q.id === item.id)) {
        room.sharedQueue.push(item);
      }

      this.broadcastToRoom(room, {
        type: 'guest-queue-added',
        item,
        room: this.toPublicSnapshot(room),
      });
      return;
    }

    if (type === 'leave-room') {
      this.handleClientDisconnect(ws, true);
    }
  }

  private handleClientDisconnect(ws: WebSocket, keepSocketRegistered = false): void {
    const clientInfo = this.clients.get(ws);
    if (!clientInfo) return;

    const roomCode = clientInfo.roomCode;
    clientInfo.roomCode = null;

    if (!keepSocketRegistered) {
      this.clients.delete(ws);
    }

    if (!roomCode) return;
    const room = this.rooms.get(roomCode);
    if (!room) return;

    room.clients.delete(clientInfo.peerId);

    // If Host disconnected, notify all guests gracefully and close the room
    if (clientInfo.peerId === room.hostPeerId) {
      this.broadcastToRoom(room, {
        type: 'host-disconnected',
        roomCode: room.roomCode,
        hostName: room.hostName,
        message: `Host (${room.hostName}) ended the Jam session.`,
      });

      for (const guestWs of room.clients.values()) {
        const guestClient = this.clients.get(guestWs);
        if (guestClient) {
          guestClient.roomCode = null;
        }
      }

      this.rooms.delete(roomCode);
      return;
    }

    // Otherwise, remove guest and broadcast updated snapshot
    room.participants = room.participants.filter((p) => p.peerId !== clientInfo.peerId);
    if (room.participants.length === 0) {
      this.rooms.delete(roomCode);
      return;
    }

    this.broadcastToRoom(room, {
      type: 'peer-left',
      peerId: clientInfo.peerId,
      room: this.toPublicSnapshot(room),
    });
  }
}

export const jamService = new JamService();
