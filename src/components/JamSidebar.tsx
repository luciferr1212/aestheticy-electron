import React, { useState, useMemo } from 'react';
import {
  Radio,
  Users,
  Copy,
  Check,
  Lock,
  Unlock,
  KeyRound,
  UserX,
  RefreshCw,
  ShieldAlert,
  VolumeX,
  Wifi,
  Plus,
  Trash2,
  Play,
  Sliders,
  X,
  Crown,
  Sparkles,
  Fingerprint,
  Search,
} from 'lucide-react';
import type {
  JamParticipant,
  JamQueueItem,
  JamRoomSnapshot,
  JamRtcConfig,
  Track,
} from '../shared/ipcTypes.ts';
import { CoverArt } from './CoverArt.tsx';
import { formatDuration } from '../utils/formatters.ts';
import { participantHasTrack } from '../utils/trackIdentity.ts';

interface JamSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  peerId: string;
  room: JamRoomSnapshot | null;
  rtcConfig: JamRtcConfig;
  localTracks: Track[];
  currentTrack: Track | null;
  isPlaying: boolean;
  accentColor: string;
  hasLocalCopyOfCurrentJamTrack: boolean;
  isReceivingHostAudioStream: boolean;
  streamMissingTracksLocalPref: boolean;
  clockOffsetMs: number;
  rttMs: number;
  driftMs: number;
  playbackRate: number;
  joinError: string | null;
  requirePinPrompt: boolean;
  initialJoinCode?: string;
  onClearJoinError: () => void;
  onStartJam: (options: {
    name: string;
    color: string;
    requireCode: boolean;
    accessPin: string;
    allowGuestQueue: boolean;
    streamMissingTracks: boolean;
  }) => Promise<void>;
  onJoinJam: (options: {
    roomCode: string;
    name: string;
    color: string;
    accessPin: string;
  }) => Promise<void>;
  onLeaveJam: () => void;
  onUpdateRoomSettings: (settings: {
    isLocked?: boolean;
    requireCode?: boolean;
    accessPin?: string | null;
    allowGuestQueue?: boolean;
    streamMissingTracks?: boolean;
  }) => void;
  onKickParticipant: (targetPeerId: string) => void;
  onResyncClock: () => void;
  onToggleStreamMissingTracks: (enabled: boolean) => void;
  onSaveRtcConfig: (config: Partial<JamRtcConfig>) => Promise<void>;
  onComputeFingerprints: () => Promise<{ computed: number; total: number }>;
  onAddTrackToJamQueue: (track: Track) => void;
  onRemoveFromJamQueue: (itemId: string) => void;
  onPlayJamQueueItem: (item: JamQueueItem) => void;
}

const AVATAR_COLORS = [
  '#818CF8',
  '#38BDF8',
  '#34D399',
  '#F472B6',
  '#FBBF24',
  '#A78BFA',
];

const IP_NOTICE_STORAGE_KEY = 'aestheticy_webrtc_ip_notice_seen_v1';

export const JamSidebar: React.FC<JamSidebarProps> = ({
  isOpen,
  onClose,
  peerId,
  room,
  rtcConfig,
  localTracks,
  currentTrack,
  accentColor,
  hasLocalCopyOfCurrentJamTrack,
  isReceivingHostAudioStream,
  streamMissingTracksLocalPref,
  clockOffsetMs,
  rttMs,
  driftMs,
  playbackRate,
  joinError,
  requirePinPrompt,
  initialJoinCode = '',
  onClearJoinError,
  onStartJam,
  onJoinJam,
  onLeaveJam,
  onUpdateRoomSettings,
  onKickParticipant,
  onResyncClock,
  onToggleStreamMissingTracks,
  onSaveRtcConfig,
  onComputeFingerprints,
  onAddTrackToJamQueue,
  onRemoveFromJamQueue,
  onPlayJamQueueItem,
}) => {
  const [hasSeenIpNotice, setHasSeenIpNotice] = useState<boolean>(() => {
    try {
      return localStorage.getItem(IP_NOTICE_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });

  const [displayName, setDisplayName] = useState<string>(() => {
    try {
      return localStorage.getItem('aestheticy_jam_username') || 'Studio Listener';
    } catch {
      return 'Studio Listener';
    }
  });
  const [avatarColor, setAvatarColor] = useState<string>(AVATAR_COLORS[0]);
  const [lobbyTab, setLobbyTab] = useState<'start' | 'join'>(
    initialJoinCode ? 'join' : 'start'
  );

  // Start Jam form state
  const [requirePinOnStart, setRequirePinOnStart] = useState(false);
  const [startAccessPin, setStartAccessPin] = useState('4280');
  const [allowGuestQueueOnStart, setAllowGuestQueueOnStart] = useState(true);
  const [streamMissingOnStart, setStreamMissingOnStart] = useState(true);

  // Join Jam form state
  const [joinCodeInput, setJoinCodeInput] = useState(initialJoinCode);
  const [joinPinInput, setJoinPinInput] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);

  // Copy states
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Add to Shared Queue Picker
  const [isAddSongOpen, setIsAddSongOpen] = useState(false);
  const [songPickerSearch, setSongPickerSearch] = useState('');

  // STUN / TURN & Fingerprinting Settings Drawer
  const [isRtcSettingsOpen, setIsRtcSettingsOpen] = useState(false);
  const [stunInput, setStunInput] = useState(
    (rtcConfig.stunUrls || []).join(', ')
  );
  const [turnUrlInput, setTurnUrlInput] = useState(rtcConfig.turnUrl || '');
  const [turnUsernameInput, setTurnUsernameInput] = useState(
    rtcConfig.turnUsername || ''
  );
  const [turnCredentialInput, setTurnCredentialInput] = useState(
    rtcConfig.turnCredential || ''
  );
  const [fingerprintStatus, setFingerprintStatus] = useState<string | null>(null);

  React.useEffect(() => {
    if (initialJoinCode) {
      setJoinCodeInput(initialJoinCode);
      setLobbyTab('join');
    }
  }, [initialJoinCode]);

  const isHost = Boolean(room && room.hostPeerId === peerId);
  const canAddToSharedQueue = Boolean(room && (isHost || room.allowGuestQueue));

  const filteredPickerTracks = useMemo(() => {
    const playable = localTracks.filter((t) => !t.unplayable);
    if (!songPickerSearch.trim()) return playable.slice(0, 25);
    const q = songPickerSearch.toLowerCase();
    return playable
      .filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.artist.toLowerCase().includes(q) ||
          t.album.toLowerCase().includes(q) ||
          (t.isrc && t.isrc.toLowerCase().includes(q))
      )
      .slice(0, 25);
  }, [localTracks, songPickerSearch]);

  if (!isOpen) return null;

  const handleAcknowledgeIpNotice = () => {
    try {
      localStorage.setItem(IP_NOTICE_STORAGE_KEY, '1');
    } catch {}
    setHasSeenIpNotice(true);
  };

  const extractRoomCodeFromInput = (raw: string): string => {
    const trimmed = raw.trim();
    if (trimmed.includes('jam=')) {
      try {
        const url = new URL(trimmed);
        const param = url.searchParams.get('jam');
        if (param) return param.toUpperCase();
      } catch {
        const match = trimmed.match(/jam=([A-Za-z0-9-]+)/i);
        if (match?.[1]) return match[1].toUpperCase();
      }
    }
    return trimmed.toUpperCase().replace(/^JAM-/, '');
  };

  const handleStartJamSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsConnecting(true);
    try {
      localStorage.setItem('aestheticy_jam_username', displayName.trim() || 'Host');
    } catch {}
    try {
      await onStartJam({
        name: displayName.trim() || 'Host',
        color: avatarColor,
        requireCode: requirePinOnStart,
        accessPin: startAccessPin,
        allowGuestQueue: allowGuestQueueOnStart,
        streamMissingTracks: streamMissingOnStart,
      });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleJoinJamSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = extractRoomCodeFromInput(joinCodeInput);
    if (!cleanCode) return;
    setIsConnecting(true);
    onClearJoinError();
    try {
      localStorage.setItem('aestheticy_jam_username', displayName.trim() || 'Listener');
    } catch {}
    try {
      await onJoinJam({
        roomCode: cleanCode,
        name: displayName.trim() || 'Listener',
        color: avatarColor,
        accessPin: joinPinInput.trim(),
      });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleCopyCode = () => {
    if (!room) return;
    navigator.clipboard?.writeText(room.roomCode).catch(() => {});
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 1800);
  };

  const handleCopyInviteLink = () => {
    if (!room) return;
    const url = `${window.location.origin}${window.location.pathname}?jam=${room.roomCode}`;
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 1800);
  };

  const renderMemberAvailabilityAvatars = (
    participants: JamParticipant[],
    item: JamQueueItem
  ) => {
    return (
      <div className="flex items-center -space-x-1.5 shrink-0">
        {participants.map((part) => {
          const hasSong = participantHasTrack(part, item.trackIdentity);
          return (
            <div
              key={part.peerId}
              title={
                hasSong
                  ? `${part.name} has this track locally`
                  : `${part.name} is missing this track locally`
              }
              style={{
                backgroundColor: hasSong ? part.color : '#1F2937',
                borderColor: hasSong ? '#10B981' : '#EF4444',
              }}
              className={`w-5 h-5 rounded-full border flex items-center justify-center text-[9px] font-bold ${
                hasSong ? 'text-slate-950' : 'text-rose-300 opacity-65'
              }`}
            >
              {part.name.slice(0, 1).toUpperCase()}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <aside className="w-88 shrink-0 h-full rounded-2xl liquid-glass specular-surface flex flex-col overflow-hidden">
      {/* Header */}
      <div className="relative z-10 flex items-center justify-between px-4 h-13 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-2">
          <Radio
            size={16}
            style={{ color: room ? '#34D399' : accentColor }}
            className={room ? 'animate-pulse' : ''}
          />
          <h2 className="text-sm font-semibold text-white whitespace-nowrap shrink-0">
            Jam Session
          </h2>
          {room && (
            <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-400/30 text-[10px] font-mono font-semibold text-emerald-300">
              LIVE · {room.participants.length}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setIsRtcSettingsOpen((o) => !o)}
            title="STUN / TURN & Acoustic Fingerprint Settings"
            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
              isRtcSettingsOpen
                ? 'bg-white/15 text-white'
                : 'text-white/60 hover:text-white hover:bg-white/10'
            }`}
          >
            <Sliders size={14} />
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Close Jam Panel"
            className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      <div className="relative z-10 flex-1 overflow-y-auto px-3.5 py-3.5 space-y-4">
        {/* One-Time WebRTC Peer-to-Peer IP Privacy Notice */}
        {!hasSeenIpNotice && (
          <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-400/30 space-y-2.5">
            <div className="flex items-start gap-2.5">
              <ShieldAlert size={16} className="text-amber-300 shrink-0 mt-0.5" />
              <div className="text-xs text-white/90 leading-relaxed">
                <div className="font-semibold text-amber-200 mb-0.5">
                  Peer-to-Peer Privacy Notice
                </div>
                Jam uses direct WebRTC peer-to-peer connections for low-latency clock sync and
                playback coordination. Standard WebRTC ICE negotiation can reveal participants&apos;
                IP addresses to other members in the same room. You can configure a TURN relay
                server in settings to mask direct peer IP addresses.
              </div>
            </div>
            <button
              type="button"
              onClick={handleAcknowledgeIpNotice}
              style={{ backgroundColor: accentColor }}
              className="w-full py-1.5 px-3 rounded-lg text-xs font-semibold text-slate-950 transition-opacity hover:opacity-90 cursor-pointer"
            >
              Got It, Acknowledge Notice
            </button>
          </div>
        )}

        {/* Collapsible STUN / TURN & Chromaprint Settings */}
        {isRtcSettingsOpen && (
          <div className="p-3.5 rounded-xl bg-black/40 border border-white/15 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-white">
                WebRTC STUN / TURN & Fingerprinting
              </span>
              <button
                type="button"
                onClick={() => setIsRtcSettingsOpen(false)}
                className="text-[11px] text-white/50 hover:text-white cursor-pointer"
              >
                Done
              </button>
            </div>

            <div className="space-y-2">
              <div>
                <label className="block text-[10px] font-medium text-white/60 mb-1">
                  STUN Servers (comma-separated)
                </label>
                <input
                  type="text"
                  value={stunInput}
                  onChange={(e) => setStunInput(e.target.value)}
                  placeholder="stun:stun.l.google.com:19302"
                  className="w-full px-2.5 py-1.5 rounded-lg bg-black/50 border border-white/15 text-[11px] font-mono text-white focus:outline-none focus:border-white/40"
                />
              </div>

              <div>
                <label className="block text-[10px] font-medium text-white/60 mb-1">
                  Optional TURN Server URL
                </label>
                <input
                  type="text"
                  value={turnUrlInput}
                  onChange={(e) => setTurnUrlInput(e.target.value)}
                  placeholder="turn:turn.example.org:3478"
                  className="w-full px-2.5 py-1.5 rounded-lg bg-black/50 border border-white/15 text-[11px] font-mono text-white focus:outline-none focus:border-white/40"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-medium text-white/60 mb-1">
                    TURN Username
                  </label>
                  <input
                    type="text"
                    value={turnUsernameInput}
                    onChange={(e) => setTurnUsernameInput(e.target.value)}
                    placeholder="Optional"
                    className="w-full px-2.5 py-1.5 rounded-lg bg-black/50 border border-white/15 text-[11px] font-mono text-white focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-white/60 mb-1">
                    TURN Credential
                  </label>
                  <input
                    type="password"
                    value={turnCredentialInput}
                    onChange={(e) => setTurnCredentialInput(e.target.value)}
                    placeholder="Optional"
                    className="w-full px-2.5 py-1.5 rounded-lg bg-black/50 border border-white/15 text-[11px] font-mono text-white focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={async () => {
                    await onSaveRtcConfig({
                      stunUrls: stunInput
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean),
                      turnUrl: turnUrlInput.trim(),
                      turnUsername: turnUsernameInput.trim(),
                      turnCredential: turnCredentialInput,
                    });
                    setIsRtcSettingsOpen(false);
                  }}
                  style={{ backgroundColor: accentColor }}
                  className="flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold text-slate-950 cursor-pointer"
                >
                  Save ICE Config
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    setFingerprintStatus('Scanning...');
                    const res = await onComputeFingerprints();
                    setFingerprintStatus(`${res.computed}/${res.total} cached`);
                  }}
                  className="inline-flex items-center gap-1.5 py-1.5 px-2.5 rounded-lg bg-white/10 hover:bg-white/15 text-[11px] text-white/85 cursor-pointer"
                  title="Compute & cache Chromaprint acoustic fingerprints in background"
                >
                  <Fingerprint size={12} />
                  <span>{fingerprintStatus || 'Cache Fingerprints'}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Lobby View (Not in a Room) */}
        {!room ? (
          <div className="space-y-4">
            {/* Profile Name & Avatar Color */}
            <div className="p-3.5 rounded-xl bg-white/[0.04] border border-white/10 space-y-3">
              <div>
                <label className="block text-[11px] font-medium text-white/70 mb-1">
                  Your Display Name
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Enter your name..."
                  className="w-full px-3 py-1.5 rounded-lg bg-black/40 border border-white/15 text-xs text-white focus:outline-none focus:border-white/40"
                />
              </div>

              <div className="flex items-center justify-between">
                <span className="text-[11px] text-white/60">Avatar Color</span>
                <div className="flex items-center gap-1.5">
                  {AVATAR_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setAvatarColor(c)}
                      style={{ backgroundColor: c }}
                      className={`w-5 h-5 rounded-full transition-transform cursor-pointer ${
                        avatarColor === c
                          ? 'scale-115 ring-2 ring-white'
                          : 'opacity-70 hover:opacity-100'
                      }`}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Mode Switcher: Start Jam vs Join Jam */}
            <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-black/40 border border-white/10">
              <button
                type="button"
                onClick={() => {
                  setLobbyTab('start');
                  onClearJoinError();
                }}
                style={
                  lobbyTab === 'start'
                    ? { backgroundColor: accentColor, color: '#090A0F' }
                    : undefined
                }
                className={`py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  lobbyTab === 'start'
                    ? 'shadow-sm'
                    : 'text-white/65 hover:text-white'
                }`}
              >
                Start Jam
              </button>
              <button
                type="button"
                onClick={() => {
                  setLobbyTab('join');
                  onClearJoinError();
                }}
                style={
                  lobbyTab === 'join'
                    ? { backgroundColor: accentColor, color: '#090A0F' }
                    : undefined
                }
                className={`py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  lobbyTab === 'join'
                    ? 'shadow-sm'
                    : 'text-white/65 hover:text-white'
                }`}
              >
                Join Jam
              </button>
            </div>

            {lobbyTab === 'start' ? (
              <form
                onSubmit={handleStartJamSubmit}
                className="p-3.5 rounded-xl bg-white/[0.04] border border-white/10 space-y-3"
              >
                <div className="text-xs text-white/75 leading-relaxed">
                  Host a synchronized listening room. Peers play their own local high-resolution
                  files matched via <span className="font-mono text-white">ISRC</span>, normalized
                  metadata (<span className="font-mono text-white">±1s</span>), or acoustic
                  fingerprint.
                </div>

                {/* Host Options */}
                <div className="space-y-2 pt-1">
                  <label className="flex items-center justify-between gap-2 text-xs text-white/85 cursor-pointer">
                    <span>Allow guests to add songs to queue</span>
                    <input
                      type="checkbox"
                      checked={allowGuestQueueOnStart}
                      onChange={(e) => setAllowGuestQueueOnStart(e.target.checked)}
                      className="accent-indigo-400 rounded cursor-pointer"
                    />
                  </label>

                  <label className="flex items-center justify-between gap-2 text-xs text-white/85 cursor-pointer">
                    <span>Stream missing tracks from host (WebRTC)</span>
                    <input
                      type="checkbox"
                      checked={streamMissingOnStart}
                      onChange={(e) => setStreamMissingOnStart(e.target.checked)}
                      className="accent-indigo-400 rounded cursor-pointer"
                    />
                  </label>

                  <label className="flex items-center justify-between gap-2 text-xs text-white/85 cursor-pointer">
                    <span>Require PIN code to join</span>
                    <input
                      type="checkbox"
                      checked={requirePinOnStart}
                      onChange={(e) => setRequirePinOnStart(e.target.checked)}
                      className="accent-indigo-400 rounded cursor-pointer"
                    />
                  </label>

                  {requirePinOnStart && (
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <span className="text-[11px] text-white/60">Room PIN Code</span>
                      <input
                        type="text"
                        maxLength={6}
                        value={startAccessPin}
                        onChange={(e) => setStartAccessPin(e.target.value)}
                        className="w-24 px-2.5 py-1 rounded-lg bg-black/50 border border-white/20 text-xs font-mono text-center text-white focus:outline-none"
                      />
                    </div>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={isConnecting}
                  style={{ backgroundColor: accentColor }}
                  className="w-full py-2.5 px-4 rounded-xl text-xs font-bold text-slate-950 shadow-lg hover:opacity-95 disabled:opacity-50 transition-opacity cursor-pointer"
                >
                  {isConnecting ? 'Creating Room...' : 'Start Jam Session'}
                </button>
              </form>
            ) : (
              <form
                onSubmit={handleJoinJamSubmit}
                className="p-3.5 rounded-xl bg-white/[0.04] border border-white/10 space-y-3"
              >
                <div>
                  <label className="block text-[11px] font-medium text-white/70 mb-1">
                    Room Code or Invite Link
                  </label>
                  <input
                    type="text"
                    value={joinCodeInput}
                    onChange={(e) => setJoinCodeInput(e.target.value)}
                    placeholder="e.g. K7X9M2 or ?jam=K7X9M2"
                    className="w-full px-3 py-2 rounded-lg bg-black/45 border border-white/15 text-xs font-mono uppercase text-white placeholder-white/35 focus:outline-none focus:border-white/40"
                  />
                </div>

                {(requirePinPrompt || joinPinInput.length > 0) && (
                  <div>
                    <label className="block text-[11px] font-medium text-amber-300 mb-1">
                      Room PIN Code
                    </label>
                    <input
                      type="text"
                      value={joinPinInput}
                      onChange={(e) => setJoinPinInput(e.target.value)}
                      placeholder="Enter host PIN code..."
                      className="w-full px-3 py-1.5 rounded-lg bg-black/45 border border-amber-400/40 text-xs font-mono text-white focus:outline-none"
                    />
                  </div>
                )}

                {joinError && (
                  <div className="p-2.5 rounded-lg bg-rose-500/15 border border-rose-400/30 text-[11px] text-rose-200">
                    {joinError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isConnecting || !joinCodeInput.trim()}
                  style={{ backgroundColor: accentColor }}
                  className="w-full py-2.5 px-4 rounded-xl text-xs font-bold text-slate-950 shadow-lg hover:opacity-95 disabled:opacity-40 transition-opacity cursor-pointer"
                >
                  {isConnecting ? 'Joining & Syncing Clock...' : 'Join Jam'}
                </button>
              </form>
            )}
          </div>
        ) : (
          /* Active Jam Session View */
          <div className="space-y-4">
            {/* Room Code & Share Link Card */}
            <div className="p-3.5 rounded-xl bg-white/[0.06] border border-white/15 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-white/50 font-semibold">
                    {isHost ? 'Hosting Jam Room' : `Joined ${room.hostName}'s Jam`}
                  </div>
                  <div className="text-lg font-mono font-bold text-white tracking-wider mt-0.5">
                    JAM-{room.roomCode}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={onLeaveJam}
                  className="px-2.5 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-400/30 text-xs font-semibold text-rose-200 transition-colors cursor-pointer"
                >
                  {isHost ? 'End Jam' : 'Leave'}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleCopyCode}
                  className="liquid-glass-btn flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg text-xs font-medium text-white/90 cursor-pointer"
                >
                  {copiedCode ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                  <span>{copiedCode ? 'Copied Code' : 'Copy Code'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleCopyInviteLink}
                  className="liquid-glass-btn flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg text-xs font-medium text-white/90 cursor-pointer"
                >
                  {copiedLink ? <Check size={13} className="text-emerald-400" /> : <Sparkles size={13} />}
                  <span>{copiedLink ? 'Copied Link' : 'Invite Link'}</span>
                </button>
              </div>
            </div>

            {/* Guest Missing Track Alert & WebRTC Live Stream Fallback Toggle */}
            {!isHost && room.currentBroadcast && !hasLocalCopyOfCurrentJamTrack && (
              <div className="p-3 rounded-xl bg-amber-500/12 border border-amber-400/35 space-y-2">
                <div className="flex items-start gap-2">
                  <VolumeX size={15} className="text-amber-300 shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-amber-200">
                      Missing Local Track Copy
                    </div>
                    <p className="text-[11px] text-white/75 mt-0.5 leading-relaxed">
                      &ldquo;{room.currentBroadcast.trackIdentity.title}&rdquo; is not in your local
                      library. Local audio is muted for this track while Lyrics &amp; Canvas stay
                      synced.
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1 border-t border-white/10">
                  <span className="text-[11px] font-medium text-white/85">
                    Stream missing tracks from host
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      onToggleStreamMissingTracks(!streamMissingTracksLocalPref)
                    }
                    style={
                      streamMissingTracksLocalPref
                        ? { backgroundColor: accentColor, color: '#090A0F' }
                        : undefined
                    }
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer ${
                      streamMissingTracksLocalPref
                        ? ''
                        : 'bg-white/10 text-white/70 hover:text-white'
                    }`}
                  >
                    {isReceivingHostAudioStream
                      ? 'Streaming Live'
                      : streamMissingTracksLocalPref
                      ? 'Enabled'
                      : 'Enable Stream'}
                  </button>
                </div>
              </div>
            )}

            {/* NTP Clock Sync & Drift Correction Telemetry */}
            <div className="p-3 rounded-xl bg-black/30 border border-white/10 space-y-2">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-white/80">
                  <Wifi size={12} className="text-emerald-400" />
                  <span>NTP Clock &amp; Drift Correction</span>
                </span>
                {!isHost && (
                  <button
                    type="button"
                    onClick={onResyncClock}
                    className="inline-flex items-center gap-1 text-[10px] font-mono text-white/65 hover:text-white cursor-pointer"
                    title="Run 7-round NTP ping/pong clock synchronization"
                  >
                    <RefreshCw size={10} />
                    <span>Re-sync</span>
                  </button>
                )}
              </div>

              <div className="grid grid-cols-3 gap-1.5 text-center font-mono text-[11px]">
                <div className="p-1.5 rounded-lg bg-white/[0.04] border border-white/5">
                  <div className="text-[9px] text-white/45 uppercase">Offset</div>
                  <div className="text-white font-semibold mt-0.5">
                    {isHost ? '0 ms (Host)' : `${clockOffsetMs >= 0 ? '+' : ''}${clockOffsetMs} ms`}
                  </div>
                </div>
                <div className="p-1.5 rounded-lg bg-white/[0.04] border border-white/5">
                  <div className="text-[9px] text-white/45 uppercase">Drift</div>
                  <div
                    className={`font-semibold mt-0.5 ${
                      Math.abs(driftMs) < 60
                        ? 'text-emerald-300'
                        : Math.abs(driftMs) < 300
                        ? 'text-amber-300'
                        : 'text-rose-300'
                    }`}
                  >
                    {isHost ? 'Master' : `${driftMs >= 0 ? '+' : ''}${Math.round(driftMs)} ms`}
                  </div>
                </div>
                <div className="p-1.5 rounded-lg bg-white/[0.04] border border-white/5">
                  <div className="text-[9px] text-white/45 uppercase">Rate</div>
                  <div className="text-white font-semibold mt-0.5">
                    {playbackRate.toFixed(2)}x
                  </div>
                </div>
              </div>
            </div>

            {/* Host Room Controls */}
            {isHost && (
              <div className="p-3 rounded-xl bg-white/[0.04] border border-white/10 space-y-2.5">
                <div className="text-[11px] font-semibold text-white/65">Host Room Controls</div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => onUpdateRoomSettings({ isLocked: !room.isLocked })}
                    className={`flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                      room.isLocked
                        ? 'bg-amber-500/20 border-amber-400/40 text-amber-200'
                        : 'bg-white/5 border-white/10 text-white/80 hover:text-white'
                    }`}
                  >
                    {room.isLocked ? <Lock size={12} /> : <Unlock size={12} />}
                    <span>{room.isLocked ? 'Room Locked' : 'Lock Room'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      onUpdateRoomSettings({
                        requireCode: !room.requireCode,
                        accessPin: !room.requireCode ? room.accessPin || '4280' : null,
                      })
                    }
                    className={`flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                      room.requireCode
                        ? 'bg-indigo-500/20 border-indigo-400/40 text-indigo-200'
                        : 'bg-white/5 border-white/10 text-white/80 hover:text-white'
                    }`}
                  >
                    <KeyRound size={12} />
                    <span>
                      {room.requireCode ? `PIN: ${room.accessPin || '4280'}` : 'Require PIN'}
                    </span>
                  </button>
                </div>

                <label className="flex items-center justify-between text-xs text-white/80 pt-1 cursor-pointer">
                  <span>Let guests add songs to queue</span>
                  <input
                    type="checkbox"
                    checked={room.allowGuestQueue}
                    onChange={(e) =>
                      onUpdateRoomSettings({ allowGuestQueue: e.target.checked })
                    }
                    className="accent-indigo-400 rounded cursor-pointer"
                  />
                </label>

                <label className="flex items-center justify-between text-xs text-white/80 cursor-pointer">
                  <span>Stream missing tracks to guests</span>
                  <input
                    type="checkbox"
                    checked={room.streamMissingTracks}
                    onChange={(e) =>
                      onUpdateRoomSettings({ streamMissingTracks: e.target.checked })
                    }
                    className="accent-indigo-400 rounded cursor-pointer"
                  />
                </label>
              </div>
            )}

            {/* Participants List */}
            <div>
              <div className="flex items-center justify-between px-1 mb-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-white/75">
                  <Users size={13} />
                  <span>Listeners ({room.participants.length})</span>
                </span>
                <span className="text-[10px] font-mono text-white/45">P2P Status</span>
              </div>

              <div className="space-y-1.5">
                {room.participants.map((part) => {
                  const isSelf = part.peerId === peerId;
                  const hasActiveSong = room.currentBroadcast
                    ? part.hasCurrentTrack &&
                      participantHasTrack(part, room.currentBroadcast.trackIdentity)
                    : true;

                  return (
                    <div
                      key={part.peerId}
                      className="flex items-center justify-between gap-2 p-2 rounded-xl bg-white/[0.04] border border-white/10"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          style={{ backgroundColor: part.color }}
                          className="relative w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-slate-950 shrink-0"
                        >
                          {part.name.slice(0, 1).toUpperCase()}
                          <span
                            className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#090A0F] ${
                              part.connectionState === 'connected'
                                ? 'bg-emerald-400'
                                : 'bg-amber-400'
                            }`}
                          />
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold text-white truncate">
                              {part.name}
                              {isSelf ? ' (You)' : ''}
                            </span>
                            {part.isHost && (
                              <Crown size={11} className="text-amber-300 shrink-0" />
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 text-[10px] font-mono text-white/50">
                            <span>
                              {part.transport === 'webrtc-p2p' ? 'WebRTC P2P' : 'Signaling'}
                            </span>
                            {part.rttMs !== null && !part.isHost && (
                              <span>· {part.rttMs}ms</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {!hasActiveSong ? (
                          part.isStreamingFromHost ? (
                            <span className="px-1.5 py-0.5 rounded bg-sky-500/20 border border-sky-400/35 text-[10px] font-semibold text-sky-300">
                              Live Stream
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded bg-rose-500/20 border border-rose-400/35 text-[10px] font-semibold text-rose-300">
                              Missing
                            </span>
                          )
                        ) : (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-400/30 text-[10px] font-semibold text-emerald-300">
                            Local
                          </span>
                        )}

                        {isHost && !part.isHost && (
                          <button
                            type="button"
                            onClick={() => onKickParticipant(part.peerId)}
                            title={`Kick ${part.name}`}
                            className="p-1 rounded-lg text-white/50 hover:text-rose-400 hover:bg-white/10 transition-colors cursor-pointer"
                          >
                            <UserX size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Shared Jam Queue with Local Availability Icons */}
            <div>
              <div className="flex items-center justify-between px-1 mb-2">
                <span className="text-xs font-semibold text-white/75">
                  Shared Queue ({room.sharedQueue.length})
                </span>
                {canAddToSharedQueue && (
                  <button
                    type="button"
                    onClick={() => setIsAddSongOpen((o) => !o)}
                    style={{ color: accentColor }}
                    className="inline-flex items-center gap-1 text-xs font-semibold hover:underline cursor-pointer"
                  >
                    <Plus size={13} />
                    <span>{isAddSongOpen ? 'Close Picker' : 'Add Song'}</span>
                  </button>
                )}
              </div>

              {/* Quick Song Picker for Host or Guests */}
              {isAddSongOpen && canAddToSharedQueue && (
                <div className="mb-3 p-2.5 rounded-xl bg-black/45 border border-white/15 space-y-2">
                  <div className="relative">
                    <Search
                      size={12}
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/45"
                    />
                    <input
                      type="text"
                      value={songPickerSearch}
                      onChange={(e) => setSongPickerSearch(e.target.value)}
                      placeholder="Search your local library to add..."
                      className="w-full pl-7 pr-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-xs text-white focus:outline-none"
                    />
                  </div>
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {filteredPickerTracks.map((t) => (
                      <div
                        key={t.id}
                        className="flex items-center justify-between gap-2 p-1.5 rounded-lg hover:bg-white/10 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="font-medium text-white truncate">{t.title}</div>
                          <div className="text-[10px] text-white/55 truncate">
                            {t.artist} · {t.format}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            onAddTrackToJamQueue(t);
                          }}
                          style={{ backgroundColor: accentColor }}
                          className="px-2 py-1 rounded text-[10px] font-bold text-slate-950 shrink-0 cursor-pointer"
                        >
                          + Queue
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Active Broadcast Track */}
              {room.currentBroadcast && (
                <div className="mb-2.5 p-2.5 rounded-xl bg-white/[0.08] border border-white/15 flex items-center gap-2.5">
                  <CoverArt
                    src={room.currentBroadcast.trackIdentity.coverArtUrl}
                    title={room.currentBroadcast.trackIdentity.album}
                    subtitle={room.currentBroadcast.trackIdentity.artist}
                    className="w-10 h-10 rounded-lg shrink-0"
                    iconSize={18}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="text-xs font-bold truncate"
                        style={{ color: accentColor }}
                      >
                        {room.currentBroadcast.trackIdentity.title}
                      </span>
                    </div>
                    <div className="text-[11px] text-white/65 truncate">
                      {room.currentBroadcast.trackIdentity.artist}
                    </div>
                    <div className="text-[10px] font-mono text-white/45 mt-0.5">
                      {room.currentBroadcast.trackIdentity.isrc
                        ? `ISRC: ${room.currentBroadcast.trackIdentity.isrc}`
                        : 'Matched by Metadata ±1s'}
                    </div>
                  </div>
                  {renderMemberAvailabilityAvatars(room.participants, {
                    id: 'now-playing',
                    addedByPeerId: room.hostPeerId,
                    addedByName: room.hostName,
                    trackIdentity: room.currentBroadcast.trackIdentity,
                  })}
                </div>
              )}

              {/* Queued Items */}
              {room.sharedQueue.length === 0 ? (
                <div className="px-3 py-5 text-center text-xs text-white/45 border border-dashed border-white/10 rounded-xl">
                  Shared queue is empty.{' '}
                  {canAddToSharedQueue
                    ? 'Add any track from your library to queue it for the Jam.'
                    : 'Only the host can add tracks right now.'}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {room.sharedQueue.map((item) => (
                    <div
                      key={item.id}
                      className="group flex items-center gap-2.5 p-2 rounded-xl bg-white/[0.03] hover:bg-white/[0.08] border border-white/5 transition-colors"
                    >
                      <button
                        type="button"
                        disabled={!isHost}
                        onClick={() => isHost && onPlayJamQueueItem(item)}
                        className="relative shrink-0 cursor-pointer disabled:cursor-default"
                        title={isHost ? 'Play track for everyone now' : item.trackIdentity.title}
                      >
                        <CoverArt
                          src={item.trackIdentity.coverArtUrl}
                          title={item.trackIdentity.album}
                          subtitle={item.trackIdentity.artist}
                          className="w-8 h-8 rounded-md"
                          iconSize={14}
                        />
                        {isHost && (
                          <span className="absolute inset-0 bg-black/60 rounded-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <Play size={12} className="text-white fill-white" />
                          </span>
                        )}
                      </button>

                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-white truncate">
                          {item.trackIdentity.title}
                        </div>
                        <div className="text-[10px] text-white/55 truncate">
                          {item.trackIdentity.artist} · added by {item.addedByName}
                        </div>
                      </div>

                      {/* Member Avatars showing who has this track locally */}
                      {renderMemberAvailabilityAvatars(room.participants, item)}

                      <span className="text-[10px] font-mono tabular-nums text-white/45">
                        {formatDuration(item.trackIdentity.duration)}
                      </span>

                      {isHost && (
                        <button
                          type="button"
                          onClick={() => onRemoveFromJamQueue(item.id)}
                          title="Remove from Shared Queue"
                          className="p-1 rounded text-white/45 hover:text-rose-400 cursor-pointer"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
