export type RepeatMode = 'off' | 'all' | 'one';

export type LibraryViewMode =
  | 'songs'
  | 'albums'
  | 'artists'
  | 'favorites'
  | 'playlist'
  | 'stats'
  | 'years'
  | 'recent'
  | 'quality'
  | 'folders'
  | 'settings';

export interface WindowInfo {
  isFullScreen: boolean;
  isMaximized: boolean;
  width: number;
  height: number;
  screenWidth: number;
  screenHeight: number;
}

export interface TrackAudioInfo {
  container: string | null;
  codec: string | null;
  codecProfile: string | null;
  lossless: boolean | null;
  sampleRate: number | null;
  bitDepth: number | null;
  channels: number | null;
  bitrate: number | null; // kbps
  duration: number | null;
  numberOfSamples: number | null;
  encoder: string | null;
  tagTypes: string[];
  genre: string[];
  composer: string[];
  albumArtist: string | null;
  label: string[];
  discNo: number | null;
  discOf: number | null;
  trackNo: number | null;
  trackOf: number | null;
  date: string | null;
  replayGain: {
    trackGainDb: number | null;
    trackPeak: number | null;
    albumGainDb: number | null;
    albumPeak: number | null;
  };
  hasEmbeddedCover: boolean;
  comment: string | null;
}

export interface UserFont {
  id: string;
  name: string;
  fileName: string;
  size: number;
}

export type ThemeMode = 'liquid-dark' | 'midnight-oled' | 'frosted-slate' | 'crystal-light';

export type AccentMode = 'dynamic' | 'custom';

export interface Track {
  id: number;
  filePath: string;
  folderId: number;
  title: string;
  artist: string;
  album: string;
  trackNumber: number | null;
  year: number | null;
  duration: number; // in seconds
  coverArtUrl: string | null;
  isrc: string | null;
  spotifyTrackId?: string | null;
  lyricsOffset?: number;
  format: string;
  codec?: string | null;
  bitrate?: number | null; // in kbps
  sampleRate?: number | null; // in Hz
  bitDepth?: number | null; // e.g. 16, 24
  isLossless?: boolean;
  loudnessGainDb?: number | null;
  chromaprint?: string | null;
  unplayable?: boolean;
  fileSize: number;
  modifiedAt: number;
  isFavorite?: boolean;
  playlistEntryId?: number;
  position?: number;
}

export interface TranscodeResult {
  status: 'ready' | 'unplayable';
  trackId: number;
  streamUrl: string | null;
  transcoded: boolean;
  targetFormat?: 'FLAC' | 'WAV' | string;
  loudnessGainDb?: number | null;
  error?: string;
}

export interface TranscodeCacheStats {
  fileCount: number;
  totalBytes: number;
  maxBytes: number;
  cacheDir: string;
}

export interface FfmpegStatus {
  available: boolean;
  ffprobeAvailable: boolean;
  version: string | null;
  ffmpegPath: string | null;
  ffprobePath: string | null;
  cacheStats: TranscodeCacheStats;
}

export interface JamRtcConfig {
  stunUrls: string[];
  turnUrl: string;
  turnUsername: string;
  turnCredential: string;
  streamMissingTracks: boolean;
}

export interface JamTrackIdentity {
  primaryKey: string;
  isrc: string | null;
  normalizedTitle: string;
  normalizedArtist: string;
  normalizedAlbum: string;
  duration: number; // seconds
  fingerprint?: string | null;
  title: string;
  artist: string;
  album: string;
  coverArtUrl: string | null;
  spotifyTrackId?: string | null;
  format?: string;
}

export interface JamBroadcastState {
  trackId: number;
  trackIdentity: JamTrackIdentity;
  position: number; // seconds
  state: 'playing' | 'paused';
  hostTimestamp: number; // Date.now() on host
}

export interface JamParticipant {
  peerId: string;
  name: string;
  color: string;
  isHost: boolean;
  joinedAt: number;
  connectionState: 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
  transport: 'webrtc-p2p' | 'signaling-relay';
  hasCurrentTrack: boolean;
  isStreamingFromHost: boolean;
  rttMs: number | null;
  clockOffsetMs: number | null;
  driftMs?: number | null;
  inventoryKeys: string[];
}

export interface JamQueueItem {
  id: string;
  addedByPeerId: string;
  addedByName: string;
  trackIdentity: JamTrackIdentity;
}

export interface JamRoomSnapshot {
  roomCode: string;
  hostPeerId: string;
  hostName: string;
  isLocked: boolean;
  requireCode: boolean;
  accessPin: string | null;
  allowGuestQueue: boolean;
  streamMissingTracks: boolean;
  participants: JamParticipant[];
  sharedQueue: JamQueueItem[];
  currentBroadcast: JamBroadcastState | null;
  createdAt: number;
}

export interface JamStatus {
  active: boolean;
  sessionId: string | null;
  signalingPath: string;
  activeRoomsCount: number;
  rtcConfig: JamRtcConfig;
}

export interface LyricWord {
  text: string;
  begin: number; // seconds
  end: number; // seconds
  trailingSpace: boolean;
}

export interface LyricLine {
  id: string;
  begin: number; // seconds
  end: number; // seconds
  text: string;
  words: LyricWord[];
  agent?: string; // e.g. 'v1', 'v2' for multiple singers
  isBackground?: boolean;
  backgroundText?: string;
  backgroundWords?: LyricWord[];
  backgroundBegin?: number;
  backgroundEnd?: number;
}

export interface LyricsResult {
  trackId: number;
  isrc: string | null;
  source: 'local-ttml' | 'local-lrc' | 'cache' | 'lrc.red' | 'lrclib' | 'none';
  format: 'ttml' | 'lrc' | 'none';
  isWordSynced: boolean;
  lines: LyricLine[];
  offset: number; // -2.0 to +2.0 seconds
  coverArtUrl?: string | null;
  remoteMetadata?: Record<string, any> | null;
  error?: string;
}

export interface CanvasResult {
  trackId: number;
  spotifyTrackId: string | null;
  trackUri: string | null;
  canvasUrl: string | null; // Local cached stream URL or remote .mp4 URL
  source: 'disk-cache' | 'spotify-canva' | 'none';
  artistName?: string | null;
  artistImgUrl?: string | null;
}

export interface CanvasCacheStats {
  enabled: boolean;
  fileCount: number;
  totalBytes: number;
  maxBytes: number;
  apiBaseUrl: string;
}

export interface Playlist {
  id: number;
  name: string;
  description: string;
  isFavorites: boolean;
  trackCount: number;
  totalDuration: number;
  coverArtUrl: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface AlbumSummary {
  album: string;
  artist: string;
  year: number | null;
  trackCount: number;
  totalDuration: number;
  coverArtUrl: string | null;
}

export interface ArtistSummary {
  artist: string;
  albumCount: number;
  trackCount: number;
  totalDuration: number;
  coverArtUrl: string | null;
}

export interface MusicFolder {
  id: number;
  path: string;
  name: string;
  addedAt: number;
  trackCount: number;
  isWatching: boolean;
  exists?: boolean;
  errorMessage?: string | null;
}

export interface LibraryStats {
  totalTracks: number;
  totalAlbums: number;
  totalArtists: number;
  totalDuration: number;
  totalFolders: number;
  totalPlaylists: number;
  favoriteTracksCount: number;
  unplayableTracksCount?: number;
  missingFoldersCount?: number;
  isScanning?: boolean;
}

export interface CoverCacheStats {
  fileCount: number;
  totalBytes: number;
  cacheDir: string;
}

export interface LyricsCacheStats {
  entryCount: number;
  totalBytes: number;
}

export interface AllCacheStats {
  coverCache: CoverCacheStats;
  lyricsCache: LyricsCacheStats;
  canvasCache: CanvasCacheStats;
  transcodeCache: TranscodeCacheStats;
}

export interface AppUpdateStatus {
  autoUpdateEnabled: boolean;
  currentVersion: string;
  appId: string;
  installerName: string;
  state: 'idle' | 'checking' | 'up-to-date' | 'available' | 'error' | 'offline';
  lastCheckedAt: number | null;
  message: string;
}

export interface EqualizerSettings {
  enabled: boolean;
  preset: string;
  preamp: number; // -12 to +12 dB
  bands: number[]; // 10 bands: 32, 64, 125, 250, 500, 1k, 2k, 4k, 8k, 16k (-12 to +12 dB)
}

/** full = animated ambient background + glass blur; balanced = static background; lite = no blur either */
export type EffectsMode = 'full' | 'balanced' | 'lite';

export interface DesktopSettings {
  /** false in the browser/web-bridge mode, where these options do not apply */
  isDesktop: boolean;
  closeToTray: boolean;
  launchAtStartup: boolean;
}

export interface StatsTrackEntry {
  track: Track;
  playCount: number;
  listenSeconds: number;
}

export interface StatsArtistEntry {
  artist: string;
  coverArtUrl: string | null;
  playCount: number;
  listenSeconds: number;
  trackCount: number;
}

export interface StatsAlbumEntry {
  album: string;
  artist: string;
  coverArtUrl: string | null;
  playCount: number;
  listenSeconds: number;
}

export interface ListeningStats {
  totalPlays: number;
  totalListenSeconds: number;
  uniqueTracks: number;
  uniqueArtists: number;
  firstPlayedAt: number | null;
  topTracks: StatsTrackEntry[];
  topArtists: StatsArtistEntry[];
  topAlbums: StatsAlbumEntry[];
  /** Plays per day for the last 7 days, oldest first (date = YYYY-MM-DD, local time). */
  last7Days: { date: string; plays: number }[];
}

export interface HistoryEntry {
  track: Track;
  playedAt: number;
}

export interface PersistedPlayerState {
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeatMode: RepeatMode;
  currentTrackId: number | null;
  currentTrackPositionSeconds?: number;
  playNextTrackIds: number[];
  queueTrackIds: number[];
  outputDeviceId: string;
  equalizer: EqualizerSettings;
  canvasEnabled?: boolean;
  normalizeVolume?: boolean;
  crossfadeSeconds?: number;
  gaplessPlayback?: boolean;
  themeMode?: ThemeMode;
  accentMode?: AccentMode;
  customAccentHex?: string;
  fontScale?: number;
  boldText?: boolean;
  /** CSS font-family chosen in Settings (an installed font name or one of the user's added fonts). Empty = app default. */
  fontFamily?: string;
  effectsMode?: EffectsMode;
  lyricsOnlineEnabled?: boolean;
  lyricsFontSize?: 'compact' | 'standard' | 'large';
  lyricsShowBackgroundVocals?: boolean;
  autoUpdateEnabled?: boolean;
}

export interface LibraryEventPayload {
  type:
    | 'scan-start'
    | 'scan-progress'
    | 'scan-complete'
    | 'file-added'
    | 'file-removed'
    | 'file-updated'
    | 'playlists-updated';
  folderPath?: string;
  filePath?: string;
  processedCount?: number;
  totalCount?: number;
  message?: string;
}

export interface TrayCommandPayload {
  action: 'toggle-play' | 'next' | 'previous' | 'toggle-mini-player' | 'show-window';
}

export interface AestheticyAPI {
  // Library & Folder Operations
  getTracks: (search?: string) => Promise<Track[]>;
  getAlbums: (search?: string) => Promise<AlbumSummary[]>;
  getArtists: (search?: string) => Promise<ArtistSummary[]>;
  getAlbumTracks: (album: string, artist?: string) => Promise<Track[]>;
  getArtistTracks: (artist: string) => Promise<Track[]>;
  getFolders: () => Promise<MusicFolder[]>;
  getStats: () => Promise<LibraryStats>;
  selectAndAddFolder: () => Promise<{ added: boolean; folder?: MusicFolder; error?: string }>;
  addFolderByPath: (folderPath: string) => Promise<{ added: boolean; folder?: MusicFolder; error?: string }>;
  uploadBrowserFolderFiles: (folderName: string, files: FileList | File[]) => Promise<{ added: boolean; folder?: MusicFolder; error?: string }>;
  removeFolder: (folderId: number) => Promise<void>;
  rescanAllFolders: () => Promise<void>;
  getAvailableServerFolders: () => Promise<{ name: string; path: string; description: string }[]>;

  // Playlists & Favorites Operations (SQLite)
  getPlaylists: () => Promise<Playlist[]>;
  getPlaylistTracks: (playlistId: number, search?: string) => Promise<Track[]>;
  createPlaylist: (name: string, description?: string) => Promise<Playlist>;
  renamePlaylist: (playlistId: number, name: string, description?: string) => Promise<Playlist>;
  deletePlaylist: (playlistId: number) => Promise<void>;
  addTrackToPlaylist: (playlistId: number, trackId: number) => Promise<void>;
  removeTrackFromPlaylist: (playlistId: number, playlistEntryId: number) => Promise<void>;
  reorderPlaylistTracks: (playlistId: number, orderedEntryIds: number[]) => Promise<void>;
  toggleFavoriteTrack: (trackId: number) => Promise<{ isFavorite: boolean }>;
  getFavoriteTracks: (search?: string) => Promise<Track[]>;

  // Player & Media Stream Operations
  getAudioStreamUrl: (track: Track) => string;
  getPlayerState: () => Promise<PersistedPlayerState>;
  savePlayerState: (state: Partial<PersistedPlayerState>) => Promise<void>;

  // Listening History
  getHistory: (limit?: number) => Promise<HistoryEntry[]>;
  clearHistory: () => Promise<void>;
  recordHistoryEntry: (trackId: number) => Promise<void>;

  // Listening Stats
  getListeningStats: () => Promise<ListeningStats>;
  resetListeningStats: () => Promise<void>;
  addListenedSeconds: (trackId: number, seconds: number) => Promise<void>;

  // FFmpeg Transcoding, Loudness Normalization & Cache Operations
  getFfmpegStatus: () => Promise<FfmpegStatus>;
  prepareTrackPlayback: (trackId: number, forceTranscode?: boolean, analyzeLoudness?: boolean) => Promise<TranscodeResult>;
  pretranscodeTrack: (trackId: number, analyzeLoudness?: boolean) => Promise<TranscodeResult>;
  analyzeTrackLoudness: (trackId: number) => Promise<{ gainDb: number }>;
  markTrackUnplayable: (trackId: number, reason?: string) => Promise<void>;
  getTranscodeCacheStats: () => Promise<TranscodeCacheStats>;
  clearTranscodeCache: () => Promise<TranscodeCacheStats>;

  // Window, Mini Player & System Tray Operations
  minimizeWindow: () => Promise<void>;
  maximizeOrRestoreWindow: () => Promise<{ isMaximized: boolean }>;
  closeWindow: () => Promise<void>;
  setMiniPlayerMode: (enabled: boolean) => Promise<void>;
  getWindowInfo: () => Promise<WindowInfo>;
  setFullScreen: (enabled: boolean) => Promise<WindowInfo>;
  setWindowSize: (width: number, height: number) => Promise<WindowInfo>;
  getTrackAudioInfo: (trackId: number) => Promise<TrackAudioInfo | null>;
  updateTrayPlaybackState: (state: { title: string; artist: string; isPlaying: boolean }) => Promise<void>;
  onTrayCommand: (callback: (cmd: TrayCommandPayload) => void) => () => void;

  // Custom fonts (files the user adds in Settings)
  listUserFonts: () => Promise<UserFont[]>;
  saveUserFont: (fileName: string, dataBase64: string) => Promise<UserFont>;
  getUserFontData: (id: string) => Promise<string | null>;
  deleteUserFont: (id: string) => Promise<void>;

  // Desktop-only app behaviour
  getDesktopSettings: () => Promise<DesktopSettings>;
  setDesktopSettings: (patch: Partial<Omit<DesktopSettings, 'isDesktop'>>) => Promise<DesktopSettings>;

  // Open-with / file association (desktop)
  onOpenFile: (callback: (track: Track) => void) => () => void;
  consumePendingOpenFile: () => Promise<Track | null>;

  // Real-time Watcher Events
  onLibraryEvent: (callback: (event: LibraryEventPayload) => void) => () => void;

  // Synced Lyrics, Spotify Canvas & Jam Shared Listening Services
  getLyrics: (trackId: number, forceRefresh?: boolean) => Promise<LyricsResult>;
  saveLyricsOffset: (trackId: number, offset: number) => Promise<{ offset: number }>;
  saveTrackIsrc: (trackId: number, isrcOrUrl: string) => Promise<LyricsResult>;
  getCanvasUrl: (trackId: number) => Promise<string | null>;
  getCanvasForTrack: (trackId: number, forceRefresh?: boolean) => Promise<CanvasResult>;
  linkSpotifyTrackForCanvas: (trackId: number, spotifyInput: string) => Promise<CanvasResult>;
  getCanvasCacheStats: () => Promise<CanvasCacheStats>;
  clearCanvasCache: () => Promise<CanvasCacheStats>;
  getJamStatus: () => Promise<JamStatus>;
  saveJamRtcConfig: (config: Partial<JamRtcConfig>) => Promise<JamRtcConfig>;
  getTrackChromaprint: (trackId: number) => Promise<{ trackId: number; chromaprint: string | null }>;
  computeLibraryFingerprints: () => Promise<{ computed: number; total: number }>;

  // Unified Cache, Diagnostics & Auto-Update Operations
  getAllCacheStats: () => Promise<AllCacheStats>;
  clearCoverCache: () => Promise<CoverCacheStats>;
  clearLyricsCache: () => Promise<LyricsCacheStats>;
  resetUnplayableTracks: () => Promise<{ resetCount: number }>;
  getUpdateStatus: () => Promise<AppUpdateStatus>;
  setAutoUpdateEnabled: (enabled: boolean) => Promise<AppUpdateStatus>;
  checkForUpdates: () => Promise<AppUpdateStatus>;
}

declare global {
  interface Window {
    aestheticy?: AestheticyAPI;
  }
}
