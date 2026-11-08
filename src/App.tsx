import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  Music,
  Disc,
  Users,
  FolderPlus,
  Search,
  RefreshCw,
  Trash2,
  Folder,
  X,
  Heart,
  Plus,
  ListMusic,
  Check,
  AlertTriangle,
  Settings,
  BarChart3,
  WifiOff,
  Clock,
  CalendarDays,
  Gem,
} from 'lucide-react';
import type {
  AccentMode,
  AlbumSummary,
  ArtistSummary,
  EffectsMode,
  EqualizerSettings,
  JamBroadcastState,
  JamQueueItem,
  JamRoomSnapshot,
  JamRtcConfig,
  LibraryEventPayload,
  LibraryStats,
  LibraryViewMode,
  MusicFolder,
  Playlist,
  RepeatMode,
  ThemeMode,
  Track,
} from './shared/ipcTypes.ts';
import { ipcClient } from './services/ipcClient.ts';
import { jamWebRtcClient } from './services/jamWebRtcClient.ts';
import { VirtualizedTrackList } from './components/VirtualizedTrackList.tsx';
import { VirtualizedGrid } from './components/VirtualizedGrid.tsx';
import { DetailView } from './components/DetailView.tsx';
import { PlaylistView } from './components/PlaylistView.tsx';
import { QueueSidebar } from './components/QueueSidebar.tsx';
import { HistorySidebar } from './components/HistorySidebar.tsx';
import { StatsView } from './components/StatsView.tsx';
import { CategoryView } from './components/CategoryView.tsx';
import { AudioInfoModal } from './components/AudioInfoModal.tsx';
import { applyFontFamily, registerUserFonts } from './utils/userFonts.ts';
import { LibraryToolbar, ArtistChipsBar } from './components/LibraryToolbar.tsx';
import { usePref } from './utils/usePref.ts';
import {
  ALBUM_SORT_OPTIONS,
  ARTIST_SORT_OPTIONS,
  SONG_SORT_OPTIONS,
  sortAlbums,
  sortArtists,
  sortTracks,
  type AlbumSortKey,
  type ArtistSortKey,
  type GridMode,
  type SongSortKey,
  type SortDir,
} from './utils/libraryPrefs.ts';
import type { SleepTimerChoice } from './components/SleepTimerMenu.tsx';
import { JamSidebar } from './components/JamSidebar.tsx';
import { PlayerBar } from './components/PlayerBar.tsx';
import { AddFolderModal } from './components/AddFolderModal.tsx';
import { TitleBar } from './components/TitleBar.tsx';
import { LiquidRefractionDefs } from './components/LiquidRefractionDefs.tsx';
import { NowPlayingSheet } from './components/NowPlayingSheet.tsx';
import { MiniPlayer } from './components/MiniPlayer.tsx';
import { SettingsModal } from './components/SettingsModal.tsx';
import { SettingsPage } from './components/SettingsPage.tsx';
import { TrackContextMenu } from './components/TrackContextMenu.tsx';
import { LyricsView } from './components/LyricsView.tsx';
import { CoverArt } from './components/CoverArt.tsx';
import { WelcomeModal, WELCOME_STORAGE_KEY } from './components/WelcomeModal.tsx';
import {
  formatBitrate,
  formatSampleRate,
  formatTotalDurationHuman,
  isTrackLossless,
} from './utils/formatters.ts';
import {
  buildTrackIdentity,
  findMatchingLocalTrack,
  getTrackInventoryKeys,
} from './utils/trackIdentity.ts';
import {
  extractPaletteFromCoverArt,
  getSeedPalette,
  type DominantPalette,
} from './utils/colorExtractor.ts';

interface ActiveDetailSelection {
  type: 'album' | 'artist';
  title: string;
  subtitle?: string;
  tracks: Track[];
}

export default function App() {
  // Library Navigation & Data State
  const [viewMode, setViewMode] = useState<LibraryViewMode>('songs');

  // Library browsing preferences (sorting, card layout, artist filter, category drill-down)
  const DIRS = ['asc', 'desc'] as const;
  const [songSortKey, setSongSortKey] = usePref<SongSortKey>('songSortKey', SONG_SORT_OPTIONS.map((o) => o.key), 'default');
  const [songSortDir, setSongSortDir] = usePref<SortDir>('songSortDir', DIRS, 'asc');
  const [albumSortKey, setAlbumSortKey] = usePref<AlbumSortKey>('albumSortKey', ALBUM_SORT_OPTIONS.map((o) => o.key), 'name');
  const [albumSortDir, setAlbumSortDir] = usePref<SortDir>('albumSortDir', DIRS, 'asc');
  const [artistSortKey, setArtistSortKey] = usePref<ArtistSortKey>('artistSortKey', ARTIST_SORT_OPTIONS.map((o) => o.key), 'name');
  const [artistSortDir, setArtistSortDir] = usePref<SortDir>('artistSortDir', DIRS, 'asc');
  const [yearsSortDir, setYearsSortDir] = usePref<SortDir>('yearsSortDir', DIRS, 'desc');
  const [foldersSortDir, setFoldersSortDir] = usePref<SortDir>('foldersSortDir', DIRS, 'asc');
  const [qualitySortDir, setQualitySortDir] = usePref<SortDir>('qualitySortDir', DIRS, 'asc');
  const [gridMode, setGridMode] = usePref<GridMode>('gridMode', ['square', 'wide', 'list'] as const, 'square');
  const [artistFilter, setArtistFilter] = useState<string | null>(null);
  const [categoryKey, setCategoryKey] = useState<string | null>(null);
  const [audioInfoTrack, setAudioInfoTrack] = useState<Track | null>(null);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [activeDetail, setActiveDetail] = useState<ActiveDetailSelection | null>(null);

  const [tracks, setTracks] = useState<Track[]>([]);
  const [albums, setAlbums] = useState<AlbumSummary[]>([]);
  const [artists, setArtists] = useState<ArtistSummary[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [playlistTracks, setPlaylistTracks] = useState<Track[]>([]);
  const [folders, setFolders] = useState<MusicFolder[]>([]);
  const [availableServerFolders, setAvailableServerFolders] = useState<
    { name: string; path: string; description: string }[]
  >([]);
  const [stats, setStats] = useState<LibraryStats>({
    totalTracks: 0,
    totalAlbums: 0,
    totalArtists: 0,
    totalDuration: 0,
    totalFolders: 0,
    totalPlaylists: 0,
    favoriteTracksCount: 0,
  });

  const [isLoading, setIsLoading] = useState(true);
  const [watcherNotice, setWatcherNotice] = useState<string | null>(null);
  const [isAddFolderOpen, setIsAddFolderOpen] = useState(false);
  const [isQueueOpen, setIsQueueOpen] = useState(true);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  // Sleep timer: pause after N minutes, or when the current track ends
  const [sleepTimer, setSleepTimer] = useState<
    { kind: 'time'; endsAt: number } | { kind: 'track'; trackId: number } | null
  >(null);
  const [sleepTick, setSleepTick] = useState(0);
  const [isJamOpen, setIsJamOpen] = useState(false);
  const [isLyricsOpen, setIsLyricsOpen] = useState(false);
  const [isNowPlayingSheetOpen, setIsNowPlayingSheetOpen] = useState(false);
  const [isMiniPlayer, setIsMiniPlayer] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isWelcomeOpen, setIsWelcomeOpen] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(WELCOME_STORAGE_KEY) !== 'true';
    } catch {
      return true;
    }
  });

  // Jam Shared Listening State
  const [jamRoom, setJamRoom] = useState<JamRoomSnapshot | null>(null);
  const [jamRtcConfig, setJamRtcConfig] = useState<JamRtcConfig>({
    stunUrls: [
      'stun:stun.l.google.com:19302',
      'stun:stun1.l.google.com:19302',
      'stun:stun.cloudflare.com:3478',
    ],
    turnUrl: '',
    turnUsername: '',
    turnCredential: '',
    streamMissingTracks: true,
  });
  const [jamClockOffsetMs, setJamClockOffsetMs] = useState(0);
  const [jamRttMs, setJamRttMs] = useState(0);
  const [jamDriftMs, setJamDriftMs] = useState(0);
  const [jamPlaybackRate, setJamPlaybackRate] = useState(1.0);
  const [hasLocalCopyOfCurrentJamTrack, setHasLocalCopyOfCurrentJamTrack] = useState(true);
  const [isReceivingHostAudioStream, setIsReceivingHostAudioStream] = useState(false);
  const [streamMissingTracksLocalPref, setStreamMissingTracksLocalPref] = useState(true);
  const [jamJoinError, setJamJoinError] = useState<string | null>(null);
  const [jamRequirePinPrompt, setJamRequirePinPrompt] = useState(false);
  const [initialJamJoinCode, setInitialJamJoinCode] = useState('');
  const latestHostBroadcastRef = useRef<JamBroadcastState | null>(null);
  const tracksRef = useRef<Track[]>([]);
  tracksRef.current = tracks;

  // Inline Create Playlist input in Sidebar
  const [isCreatingPlaylist, setIsCreatingPlaylist] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');

  // Context Menu State
  const [contextMenu, setContextMenu] = useState<{
    track: Track;
    x: number;
    y: number;
  } | null>(null);

  // Playback & Queue State
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPreparingTrack, setIsPreparingTrack] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const seekRequestRef = useRef<((newTime: number) => void) | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  // Position (in seconds) to resume at once the restored track's audio is ready to seek.
  const pendingResumeSecondsRef = useRef<number>(0);
  const lastRecordedHistoryTrackIdRef = useRef<number | null>(null);

  const [shuffle, setShuffle] = useState(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('off');
  const [volume, setVolume] = useState(0.85);
  const [muted, setMuted] = useState(false);
  const [outputDeviceId, setOutputDeviceId] = useState('default');
  const [equalizer, setEqualizer] = useState<EqualizerSettings>({
    enabled: true,
    preset: 'Flat',
    preamp: 0,
    bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  });
  const [canvasEnabled, setCanvasEnabled] = useState(true);
  const [normalizeVolume, setNormalizeVolume] = useState(false);
  const [crossfadeSeconds, setCrossfadeSeconds] = useState(0);
  const [gaplessPlayback, setGaplessPlayback] = useState(true);

  // Appearance, Lyrics & Network Connectivity State
  const [themeMode, setThemeMode] = useState<ThemeMode>('liquid-dark');
  const [accentMode, setAccentMode] = useState<AccentMode>('dynamic');
  const [customAccentHex, setCustomAccentHex] = useState('#818CF8');
  const [fontScale, setFontScale] = useState(1);
  const [boldText, setBoldText] = useState(false);
  const [fontFamily, setFontFamily] = useState('');
  const [effectsMode, setEffectsMode] = useState<EffectsMode>('full');
  const [lyricsOnlineEnabled, setLyricsOnlineEnabled] = useState(true);
  const [lyricsFontSize, setLyricsFontSize] = useState<'compact' | 'standard' | 'large'>('standard');
  const [lyricsShowBackgroundVocals, setLyricsShowBackgroundVocals] = useState(true);
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine !== false : true
  );
  const [scanProgress, setScanProgress] = useState<{
    processed: number;
    total: number;
    message: string;
  } | null>(null);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Toast alert for unplayable tracks or transcoding errors
  const [toastAlert, setToastAlert] = useState<{
    title: string;
    detail: string;
  } | null>(null);

  const [playNextQueue, setPlayNextQueue] = useState<Track[]>([]);
  const [standardQueue, setStandardQueue] = useState<Track[]>([]);
  const [originalQueueOrder, setOriginalQueueOrder] = useState<Track[]>([]);
  const [historyStack, setHistoryStack] = useState<Track[]>([]);

  // Dynamic Album Art Palette State
  const [rawPalette, setRawPalette] = useState<DominantPalette>(() =>
    getSeedPalette('Aestheticy Liquid Glass')
  );

  const palette = useMemo<DominantPalette>(() => {
    if (accentMode === 'custom' && customAccentHex) {
      return {
        ...rawPalette,
        accent: customAccentHex,
      };
    }
    return rawPalette;
  }, [rawPalette, accentMode, customAccentHex]);

  // Extract dominant color palette whenever currentTrack changes
  useEffect(() => {
    let active = true;
    const seed = currentTrack
      ? `${currentTrack.album}-${currentTrack.artist}`
      : 'Aestheticy Liquid Glass';

    extractPaletteFromCoverArt(currentTrack?.coverArtUrl, seed).then((extracted) => {
      if (!active) return;
      setRawPalette(extracted);
      document.documentElement.style.setProperty('--ambient-primary', extracted.primaryRgb);
      document.documentElement.style.setProperty('--ambient-secondary', extracted.secondaryRgb);
      document.documentElement.style.setProperty('--ambient-accent', extracted.accentRgb);
      document.documentElement.style.setProperty(
        '--ambient-accent-hex',
        accentMode === 'custom' ? customAccentHex : extracted.accent
      );
    });

    return () => {
      active = false;
    };
  }, [
    currentTrack?.id,
    currentTrack?.coverArtUrl,
    currentTrack?.album,
    currentTrack?.artist,
    accentMode,
    customAccentHex,
  ]);

  // Debounce search input (80ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
    }, 80);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const loadLibraryData = useCallback(
    async (search?: string) => {
      try {
        const [tracksRes, albumsRes, artistsRes, playlistsRes, foldersRes, statsRes, availRes] =
          await Promise.all([
            ipcClient.getTracks(search),
            ipcClient.getAlbums(search),
            ipcClient.getArtists(search),
            ipcClient.getPlaylists(),
            ipcClient.getFolders(),
            ipcClient.getStats(),
            ipcClient.getAvailableServerFolders(),
          ]);

        setTracks(tracksRes);
        setAlbums(albumsRes);
        setArtists(artistsRes);
        setPlaylists(playlistsRes);
        setFolders(foldersRes);
        setStats(statsRes);
        setAvailableServerFolders(availRes);

        if (viewMode === 'favorites') {
          const favs = await ipcClient.getFavoriteTracks(search);
          setPlaylistTracks(favs);
        } else if (viewMode === 'playlist' && selectedPlaylistId) {
          const plTracks = await ipcClient.getPlaylistTracks(selectedPlaylistId, search);
          setPlaylistTracks(plTracks);
        }

        // Keep currentTrack favorite state in sync
        setCurrentTrack((prev) => {
          if (!prev) return null;
          const updated = tracksRes.find((t) => t.id === prev.id);
          return updated ? { ...prev, isFavorite: updated.isFavorite } : prev;
        });
      } catch (err) {
        console.error('Failed to load library data:', err);
      } finally {
        setIsLoading(false);
      }
    },
    [viewMode, selectedPlaylistId]
  );

  // Initial load + restore persisted player & EQ state
  useEffect(() => {
    let mounted = true;
    (async () => {
      await loadLibraryData('');
      try {
        const allTracks = await ipcClient.getTracks('');
        const persisted = await ipcClient.getPlayerState();
        if (!mounted) return;

        setVolume(persisted.volume ?? 0.85);
        setMuted(Boolean(persisted.muted));
        setShuffle(Boolean(persisted.shuffle));
        setRepeatMode(persisted.repeatMode || 'off');
        if (persisted.outputDeviceId) {
          setOutputDeviceId(persisted.outputDeviceId);
        }
        if (persisted.equalizer) {
          setEqualizer(persisted.equalizer);
        }
        if (typeof persisted.canvasEnabled === 'boolean') {
          setCanvasEnabled(persisted.canvasEnabled);
        }
        if (typeof persisted.normalizeVolume === 'boolean') {
          setNormalizeVolume(persisted.normalizeVolume);
        }
        if (typeof persisted.crossfadeSeconds === 'number') {
          setCrossfadeSeconds(persisted.crossfadeSeconds);
        }
        if (typeof persisted.gaplessPlayback === 'boolean') {
          setGaplessPlayback(persisted.gaplessPlayback);
        }
        if (persisted.themeMode) {
          setThemeMode(persisted.themeMode);
        }
        if (persisted.accentMode) {
          setAccentMode(persisted.accentMode);
        }
        if (persisted.customAccentHex) {
          setCustomAccentHex(persisted.customAccentHex);
        }
        if (typeof persisted.fontScale === 'number') {
          setFontScale(Math.min(1.4, Math.max(0.8, persisted.fontScale)));
        }
        if (typeof persisted.fontFamily === 'string') {
          setFontFamily(persisted.fontFamily);
        }
        if (typeof persisted.boldText === 'boolean') {
          setBoldText(persisted.boldText);
        }
        if (persisted.effectsMode === 'full' || persisted.effectsMode === 'balanced' || persisted.effectsMode === 'lite') {
          setEffectsMode(persisted.effectsMode);
        }
        if (typeof persisted.lyricsOnlineEnabled === 'boolean') {
          setLyricsOnlineEnabled(persisted.lyricsOnlineEnabled);
        }
        if (persisted.lyricsFontSize) {
          setLyricsFontSize(persisted.lyricsFontSize);
        }
        if (typeof persisted.lyricsShowBackgroundVocals === 'boolean') {
          setLyricsShowBackgroundVocals(persisted.lyricsShowBackgroundVocals);
        }

        const trackMap = new Map(allTracks.map((t) => [t.id, t]));
        if (persisted.currentTrackId && trackMap.has(persisted.currentTrackId)) {
          pendingResumeSecondsRef.current = Math.max(
            0,
            persisted.currentTrackPositionSeconds || 0
          );
          setCurrentTrack(trackMap.get(persisted.currentTrackId)!);
        } else if (allTracks.length > 0) {
          const firstPlayable = allTracks.find((t) => !t.unplayable) || allTracks[0];
          setCurrentTrack(firstPlayable);
          setStandardQueue(allTracks.filter((t) => t.id !== firstPlayable.id).slice(0, 50));
          setOriginalQueueOrder(allTracks.filter((t) => t.id !== firstPlayable.id).slice(0, 50));
        }

        if (persisted.playNextTrackIds?.length) {
          setPlayNextQueue(
            persisted.playNextTrackIds
              .map((id) => trackMap.get(id))
              .filter((t): t is Track => Boolean(t))
          );
        }
        if (persisted.queueTrackIds?.length) {
          const restoredQ = persisted.queueTrackIds
            .map((id) => trackMap.get(id))
            .filter((t): t is Track => Boolean(t));
          if (restoredQ.length > 0) {
            setStandardQueue(restoredQ);
            setOriginalQueueOrder(restoredQ);
          }
        }

        // Launched via "Open with Aestheticy" / double-click on an audio file: play that
        // file instead of the restored one (restore must run first, so this comes last).
        const externalTrack = await ipcClient.consumePendingOpenFile();
        if (externalTrack && mounted) {
          pendingResumeSecondsRef.current = 0;
          setCurrentTrack(externalTrack);
          setIsPlaying(true);
        }
      } catch {
        // ignore state restore error
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  // A second "Open with Aestheticy" while the app is already running
  useEffect(() => {
    const unsubscribe = ipcClient.onOpenFile((track) => {
      pendingResumeSecondsRef.current = 0;
      setCurrentTrack(track);
      setIsPlaying(true);
    });
    return unsubscribe;
  }, []);

  // Once the restored track's audio is ready (duration known), seek to where we left off,
  // without auto-playing. Fires once per app launch, then clears itself.
  useEffect(() => {
    if (!currentTrack) return;
    if (pendingResumeSecondsRef.current <= 0) return;
    if (duration <= 0) return;

    const resumeTo = Math.min(pendingResumeSecondsRef.current, Math.max(0, duration - 1));
    pendingResumeSecondsRef.current = 0;
    if (resumeTo > 0) {
      seekRequestRef.current?.(resumeTo);
    }
  }, [currentTrack, duration]);

  // Periodically persist playback position for the current track, so the app can
  // resume from where it was left off next time it's opened.
  useEffect(() => {
    if (!currentTrack) return;
    const interval = setInterval(() => {
      const pos = audioElementRef.current?.currentTime;
      if (typeof pos === 'number' && Number.isFinite(pos)) {
        ipcClient.savePlayerState({ currentTrackPositionSeconds: pos }).catch(() => {});
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [currentTrack?.id]);

  // Flush the exact position when the window is about to close.
  useEffect(() => {
    const handleBeforeUnload = () => {
      const pos = audioElementRef.current?.currentTime;
      if (typeof pos === 'number' && Number.isFinite(pos)) {
        ipcClient.savePlayerState({ currentTrackPositionSeconds: pos }).catch(() => {});
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // When the user moves to a different track during this session, the saved position of
  // the previous one must not leak into it (the first restore after launch is skipped).
  const previousTrackIdRef = useRef<number | null>(null);
  useEffect(() => {
    const id = currentTrack?.id ?? null;
    const prev = previousTrackIdRef.current;
    previousTrackIdRef.current = id;
    if (prev !== null && id !== null && prev !== id) {
      ipcClient.savePlayerState({ currentTrackPositionSeconds: 0 }).catch(() => {});
    }
  }, [currentTrack?.id]);

  // Listening time: count real seconds of playback per track and flush them in batches
  const listenAccumRef = useRef<{ trackId: number; seconds: number } | null>(null);
  const flushListenAccum = useCallback(() => {
    const acc = listenAccumRef.current;
    if (acc && acc.seconds > 0) {
      ipcClient.addListenedSeconds(acc.trackId, acc.seconds).catch(() => {});
      acc.seconds = 0;
    }
  }, []);

  useEffect(() => {
    const tick = setInterval(() => {
      const audio = audioElementRef.current;
      if (!currentTrack || !isPlaying || !audio || audio.paused) return;
      const acc = listenAccumRef.current;
      if (!acc || acc.trackId !== currentTrack.id) {
        flushListenAccum();
        listenAccumRef.current = { trackId: currentTrack.id, seconds: 1 };
      } else {
        acc.seconds += 1;
      }
    }, 1000);
    const flush = setInterval(flushListenAccum, 15000);
    window.addEventListener('beforeunload', flushListenAccum);
    return () => {
      clearInterval(tick);
      clearInterval(flush);
      window.removeEventListener('beforeunload', flushListenAccum);
      flushListenAccum();
    };
  }, [currentTrack?.id, isPlaying, flushListenAccum]);

  // Log each track that starts playing to listening history (collapsed server-side
  // if the same track restarts within a few seconds).
  useEffect(() => {
    if (!currentTrack || !isPlaying) return;
    if (lastRecordedHistoryTrackIdRef.current === currentTrack.id) return;
    lastRecordedHistoryTrackIdRef.current = currentTrack.id;
    ipcClient.recordHistoryEntry(currentTrack.id).catch(() => {});
  }, [currentTrack?.id, isPlaying]);

  // Refresh when debounced search or active playlist changes
  useEffect(() => {
    loadLibraryData(debouncedSearch);
  }, [debouncedSearch, viewMode, selectedPlaylistId, loadLibraryData]);

  // Subscribe to chokidar file watcher, background scan progress & playlist events
  useEffect(() => {
    const unsubscribe = ipcClient.onLibraryEvent((evt: LibraryEventPayload) => {
      if (evt.message) {
        setWatcherNotice(evt.message);
      }
      if (evt.type === 'scan-start' || evt.type === 'scan-progress') {
        setScanProgress({
          processed: evt.processedCount ?? 0,
          total: evt.totalCount ?? 0,
          message: evt.message || 'Scanning music library in the background...',
        });
      }
      if (
        evt.type === 'scan-complete' ||
        evt.type === 'file-added' ||
        evt.type === 'file-removed' ||
        evt.type === 'file-updated' ||
        evt.type === 'playlists-updated'
      ) {
        if (evt.type === 'scan-complete') {
          setScanProgress(null);
        }
        loadLibraryData(debouncedSearch);
        setTimeout(() => {
          setWatcherNotice((prev) => (prev === evt.message ? null : prev));
        }, 2800);
      }
    });
    return unsubscribe;
  }, [debouncedSearch, loadLibraryData]);

  // Sleep timer logic
  useEffect(() => {
    if (!sleepTimer) return;
    if (sleepTimer.kind === 'track') {
      // Track changed (it ended and the next one started) -> stop right away
      if (currentTrack && currentTrack.id !== sleepTimer.trackId) {
        setIsPlaying(false);
        setSleepTimer(null);
      }
      return;
    }
    const interval = setInterval(() => {
      if (Date.now() >= sleepTimer.endsAt) {
        setIsPlaying(false);
        setSleepTimer(null);
      } else {
        setSleepTick((t) => t + 1);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [sleepTimer, currentTrack?.id]);

  const sleepTimerLabel = (() => {
    void sleepTick;
    if (!sleepTimer) return null;
    if (sleepTimer.kind === 'track') return 'End of track';
    const remaining = Math.max(0, Math.ceil((sleepTimer.endsAt - Date.now()) / 1000));
    const m = Math.floor(remaining / 60);
    const s = remaining % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  })();

  const handleChooseSleepTimer = (choice: SleepTimerChoice) => {
    if (choice === null) setSleepTimer(null);
    else if (choice === 'end-of-track') {
      if (currentTrack) setSleepTimer({ kind: 'track', trackId: currentTrack.id });
    } else setSleepTimer({ kind: 'time', endsAt: Date.now() + choice * 60_000 });
  };

  // Apply font scale + bold text app-wide (CSS reads these from <html>)
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--font-scale', String(fontScale));
    root.setAttribute('data-bold-text', boldText ? 'true' : 'false');
    root.setAttribute('data-effects', effectsMode);
  }, [fontScale, boldText, effectsMode]);

  // Custom font: load the user's added font files once, then apply the chosen family
  useEffect(() => {
    let cancelled = false;
    ipcClient
      .listUserFonts()
      .then((list) => registerUserFonts(list))
      .catch(() => {})
      .finally(() => {
        if (!cancelled) applyFontFamily(fontFamily);
      });
    applyFontFamily(fontFamily);
    return () => {
      cancelled = true;
    };
  }, [fontFamily]);

  // Warm up lyrics in the background so they are already there when the Lyrics view opens
  // (local file -> cache -> MusicBrainz/lrc.red -> LRCLIB; cached in SQLite afterwards).
  useEffect(() => {
    if (!currentTrack || !lyricsOnlineEnabled || !isOnline) return;
    const trackId = currentTrack.id;
    const timer = setTimeout(() => {
      ipcClient.getLyrics(trackId, false).catch(() => {});
    }, 1500);
    return () => clearTimeout(timer);
  }, [currentTrack?.id, lyricsOnlineEnabled, isOnline]);

  // Persist player, equalizer, appearance & lyrics state when changed
  useEffect(() => {
    if (isLoading) return;
    ipcClient
      .savePlayerState({
        volume,
        muted,
        shuffle,
        repeatMode,
        outputDeviceId,
        equalizer,
        canvasEnabled,
        normalizeVolume,
        crossfadeSeconds,
        gaplessPlayback,
        themeMode,
        accentMode,
        customAccentHex,
        fontScale,
        boldText,
        fontFamily,
        effectsMode,
        lyricsOnlineEnabled,
        lyricsFontSize,
        lyricsShowBackgroundVocals,
        currentTrackId: currentTrack?.id ?? null,
        playNextTrackIds: playNextQueue.slice(0, 100).map((t) => t.id),
        queueTrackIds: standardQueue.slice(0, 200).map((t) => t.id),
      })
      .catch(() => {});
  }, [
    volume,
    muted,
    shuffle,
    repeatMode,
    outputDeviceId,
    equalizer,
    canvasEnabled,
    normalizeVolume,
    crossfadeSeconds,
    gaplessPlayback,
    themeMode,
    accentMode,
    customAccentHex,
    fontScale,
    boldText,
    fontFamily,
    effectsMode,
    lyricsOnlineEnabled,
    lyricsFontSize,
    lyricsShowBackgroundVocals,
    currentTrack,
    playNextQueue,
    standardQueue,
    isLoading,
  ]);

  // Fisher-Yates shuffle
  const shuffleArray = (arr: Track[]): Track[] => {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };

  // Play a specific track and populate queue from its context (capped at 300 for 20,000-song performance)
  const handlePlayTrack = useCallback(
    (track: Track, contextTracks: Track[]) => {
      if (currentTrack) {
        setHistoryStack((prev) => [...prev.slice(-40), currentTrack]);
      }
      setCurrentTrack(track);
      setIsPlaying(true);

      const idx = contextTracks.findIndex((t) => t.id === track.id);
      const afterTracks = (
        idx >= 0
          ? [...contextTracks.slice(idx + 1, idx + 301), ...contextTracks.slice(0, Math.min(idx, 100))]
          : contextTracks.filter((t) => t.id !== track.id).slice(0, 300)
      ).slice(0, 300);

      setOriginalQueueOrder(afterTracks);
      setStandardQueue(shuffle ? shuffleArray(afterTracks) : afterTracks);
    },
    [currentTrack, shuffle]
  );

  // Play all tracks in a view or detail page
  const handlePlayAll = useCallback(
    (list: Track[], forceShuffle?: boolean) => {
      if (list.length === 0) return;
      const useShuffle = forceShuffle !== undefined ? forceShuffle : shuffle;
      if (forceShuffle !== undefined) {
        setShuffle(forceShuffle);
      }

      const capped = list.slice(0, 350);
      const ordered = useShuffle ? shuffleArray(capped) : capped;
      const [first, ...rest] = ordered;
      if (currentTrack) {
        setHistoryStack((prev) => [...prev.slice(-40), currentTrack]);
      }
      setCurrentTrack(first);
      setOriginalQueueOrder(capped.filter((t) => t.id !== first.id));
      setStandardQueue(rest);
      setIsPlaying(true);
    },
    [currentTrack, shuffle]
  );

  const handlePlayNext = useCallback(
    (track: Track) => {
      if (!currentTrack) {
        setCurrentTrack(track);
        setIsPlaying(true);
        return;
      }
      setPlayNextQueue((prev) => [track, ...prev]);
      setWatcherNotice(`Playing next: ${track.title}`);
      setTimeout(() => setWatcherNotice(null), 2200);
    },
    [currentTrack]
  );

  const handleAddToQueue = useCallback(
    (track: Track) => {
      if (!currentTrack) {
        setCurrentTrack(track);
        setIsPlaying(true);
        return;
      }
      setStandardQueue((prev) => [...prev, track]);
      setOriginalQueueOrder((prev) => [...prev, track]);
      setWatcherNotice(`Added to queue: ${track.title}`);
      setTimeout(() => setWatcherNotice(null), 2200);
    },
    [currentTrack]
  );

  const handleAddAllToQueue = useCallback(
    (newTracks: Track[]) => {
      if (newTracks.length === 0) return;
      if (!currentTrack) {
        handlePlayAll(newTracks, false);
        return;
      }
      setStandardQueue((prev) => [...prev, ...newTracks]);
      setOriginalQueueOrder((prev) => [...prev, ...newTracks]);
      setWatcherNotice(`Added ${newTracks.length} songs to queue`);
      setTimeout(() => setWatcherNotice(null), 2200);
    },
    [currentTrack, handlePlayAll]
  );

  const handleNextTrack = useCallback(
    (autoAdvance = false) => {
      if (playNextQueue.length > 0) {
        const [nextItem, ...restNext] = playNextQueue;
        if (currentTrack) {
          setHistoryStack((prev) => [...prev.slice(-40), currentTrack]);
        }
        setCurrentTrack(nextItem);
        setPlayNextQueue(restNext);
        setIsPlaying(true);
        return;
      }

      if (standardQueue.length > 0) {
        const [nextItem, ...restStd] = standardQueue;
        if (currentTrack) {
          setHistoryStack((prev) => [...prev.slice(-40), currentTrack]);
        }
        const nextStdQueue =
          repeatMode === 'all' && currentTrack ? [...restStd, currentTrack] : restStd;
        setCurrentTrack(nextItem);
        setStandardQueue(nextStdQueue);
        setIsPlaying(true);
        return;
      }

      if (repeatMode === 'all' && currentTrack) {
        setIsPlaying(true);
        return;
      }

      if (autoAdvance) {
        setIsPlaying(false);
      }
    },
    [playNextQueue, standardQueue, repeatMode, currentTrack]
  );

  const handlePreviousTrack = useCallback(() => {
    if (historyStack.length > 0) {
      const prevTrack = historyStack[historyStack.length - 1];
      setHistoryStack((prev) => prev.slice(0, -1));
      if (currentTrack) {
        setStandardQueue((prev) => [currentTrack, ...prev]);
      }
      setCurrentTrack(prevTrack);
      setIsPlaying(true);
    }
  }, [historyStack, currentTrack]);

  // Handle unplayable track: mark in state, show toast notification, and skip to next track
  const handleTrackUnplayable = useCallback(
    (track: Track, reason: string) => {
      setTracks((prev) =>
        prev.map((t) => (t.id === track.id ? { ...t, unplayable: true } : t))
      );
      setPlaylistTracks((prev) =>
        prev.map((t) => (t.id === track.id ? { ...t, unplayable: true } : t))
      );
      if (activeDetail) {
        setActiveDetail((prev) =>
          prev
            ? {
                ...prev,
                tracks: prev.tracks.map((t) =>
                  t.id === track.id ? { ...t, unplayable: true } : t
                ),
              }
            : null
        );
      }

      setToastAlert({
        title: `Skipped damaged song: "${track.title}"`,
        detail:
          reason ||
          'This song file appears to be damaged or incomplete, so Aestheticy skipped to the next track.',
      });
      setTimeout(() => {
        setToastAlert((prev) =>
          prev?.title.includes(track.title) ? null : prev
        );
      }, 4500);

      // Remove from queues and advance
      setPlayNextQueue((prev) => prev.filter((t) => t.id !== track.id));
      setStandardQueue((prev) => prev.filter((t) => t.id !== track.id));
      handleNextTrack(true);
    },
    [activeDetail, handleNextTrack]
  );

  const nextQueuedTrack = useMemo(() => {
    if (playNextQueue.length > 0) return playNextQueue[0];
    if (standardQueue.length > 0) return standardQueue[0];
    return null;
  }, [playNextQueue, standardQueue]);

  // ============================================================================
  // Jam Shared Listening (WebRTC P2P, NTP Clock Sync & 2.5s Drift Correction)
  // ============================================================================

  // Only compute inventory keys for non-benchmark tracks (up to 400) so 20,000-song libraries stay 60fps
  const localInventoryKeys = useMemo(() => {
    const keys = new Set<string>();
    let count = 0;
    for (const t of tracks) {
      if (t.unplayable || t.filePath.startsWith('benchmark://')) continue;
      for (const k of getTrackInventoryKeys(t)) {
        keys.add(k);
      }
      count++;
      if (count >= 400) break;
    }
    return Array.from(keys);
  }, [tracks]);

  // Check URL query param ?jam=CODE on initial load
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const jamCode = params.get('jam');
      if (jamCode) {
        setInitialJamJoinCode(jamCode.toUpperCase());
        setIsJamOpen(true);
        setIsQueueOpen(false);
      }
    } catch {}

    ipcClient
      .getJamStatus()
      .then((status) => {
        if (status?.rtcConfig) {
          setJamRtcConfig(status.rtcConfig);
          setStreamMissingTracksLocalPref(status.rtcConfig.streamMissingTracks);
        }
      })
      .catch(() => {});
  }, []);

  // Sync volume with WebRTC remote MediaStream audio element if streaming missing track from host
  useEffect(() => {
    jamWebRtcClient.setRemoteStreamVolume(volume, muted);
  }, [volume, muted]);

  // Apply incoming Host Broadcast on Guest (match local track across formats or mute/stream)
  const applyIncomingHostBroadcast = useCallback(
    (broadcast: JamBroadcastState) => {
      latestHostBroadcastRef.current = broadcast;
      const matched = findMatchingLocalTrack(broadcast.trackIdentity, tracksRef.current);

      if (matched) {
        setHasLocalCopyOfCurrentJamTrack(true);
        jamWebRtcClient.requestHostAudioStreamForMissingTrack(false);
        jamWebRtcClient.updateParticipantStatus({
          hasCurrentTrack: true,
          isStreamingFromHost: false,
        });

        setCurrentTrack((prev) => (prev?.id === matched.id ? prev : matched));
        setIsPlaying(broadcast.state === 'playing');
      } else {
        // Guest is missing this song locally: create virtual track for Lyrics & Canvas, mute local file player
        setHasLocalCopyOfCurrentJamTrack(false);
        const virtualTrack: Track = {
          id: -1000,
          filePath: `jam://remote/${broadcast.trackIdentity.primaryKey}`,
          folderId: 0,
          title: broadcast.trackIdentity.title,
          artist: broadcast.trackIdentity.artist,
          album: broadcast.trackIdentity.album,
          trackNumber: 1,
          year: null,
          duration: broadcast.trackIdentity.duration || 180,
          coverArtUrl: broadcast.trackIdentity.coverArtUrl,
          isrc: broadcast.trackIdentity.isrc,
          spotifyTrackId: broadcast.trackIdentity.spotifyTrackId,
          format: broadcast.trackIdentity.format || 'JAM SYNC',
          isLossless: false,
          fileSize: 0,
          modifiedAt: Date.now(),
        };
        setCurrentTrack(virtualTrack);
        setDuration(virtualTrack.duration);
        setIsPlaying(broadcast.state === 'playing');

        const roomSnap = jamWebRtcClient.getRoom();
        const shouldStream =
          streamMissingTracksLocalPref && (roomSnap?.streamMissingTracks ?? true);
        jamWebRtcClient.updateParticipantStatus({
          hasCurrentTrack: false,
          isStreamingFromHost: shouldStream,
        });
        jamWebRtcClient.requestHostAudioStreamForMissingTrack(shouldStream);
      }

      // Compute immediate expected position using NTP clock offset
      const nowHost = Date.now() + jamWebRtcClient.getClockOffsetMs();
      const expectedPos =
        broadcast.state === 'playing'
          ? Math.min(
              broadcast.trackIdentity.duration || 9999,
              broadcast.position + Math.max(0, (nowHost - broadcast.hostTimestamp) / 1000)
            )
          : broadcast.position;

      if (matched && audioElementRef.current) {
        const currentPos = audioElementRef.current.currentTime || 0;
        const driftMs = (expectedPos - currentPos) * 1000;
        setJamDriftMs(driftMs);
        if (Math.abs(driftMs) >= 300) {
          seekRequestRef.current?.(expectedPos);
          setJamPlaybackRate(1.0);
        }
      } else {
        setCurrentTime(expectedPos);
        setJamDriftMs(0);
        setJamPlaybackRate(1.0);
      }
    },
    [streamMissingTracksLocalPref]
  );

  // Register JamWebRtcClient callbacks
  useEffect(() => {
    jamWebRtcClient.setCallbacks({
      onRoomUpdated: (room) => {
        setJamRoom(room ? { ...room } : null);
        if (!room) {
          latestHostBroadcastRef.current = null;
          setHasLocalCopyOfCurrentJamTrack(true);
          setIsReceivingHostAudioStream(false);
          setJamPlaybackRate(1.0);
          setJamDriftMs(0);
        }
      },
      onRtcConfigUpdated: (cfg) => {
        setJamRtcConfig(cfg);
      },
      onHostBroadcastReceived: (broadcast) => {
        const room = jamWebRtcClient.getRoom();
        if (!room || room.hostPeerId === jamWebRtcClient.getPeerId()) return;
        applyIncomingHostBroadcast(broadcast);
      },
      onGuestQueueAdded: (item) => {
        const room = jamWebRtcClient.getRoom();
        if (!room) return;
        if (room.hostPeerId === jamWebRtcClient.getPeerId()) {
          const matched = findMatchingLocalTrack(item.trackIdentity, tracksRef.current);
          if (matched) {
            setStandardQueue((prev) => [...prev, matched]);
            setOriginalQueueOrder((prev) => [...prev, matched]);
          }
          setWatcherNotice(`${item.addedByName} added "${item.trackIdentity.title}" to Jam Queue`);
          setTimeout(() => setWatcherNotice(null), 2600);
        }
      },
      onHostDisconnected: (message) => {
        setIsPlaying(false);
        setJamPlaybackRate(1.0);
        setHasLocalCopyOfCurrentJamTrack(true);
        setToastAlert({
          title: 'Jam Session Ended',
          detail: message,
        });
        setTimeout(() => setToastAlert(null), 4500);
      },
      onKicked: (reason) => {
        setIsPlaying(false);
        setJamPlaybackRate(1.0);
        setHasLocalCopyOfCurrentJamTrack(true);
        setToastAlert({
          title: 'Removed from Jam Session',
          detail: reason,
        });
        setTimeout(() => setToastAlert(null), 4500);
      },
      onError: (err, requirePin) => {
        setJamJoinError(err);
        if (requirePin) {
          setJamRequirePinPrompt(true);
        }
      },
      onClockSyncUpdated: ({ clockOffsetMs, rttMs }) => {
        setJamClockOffsetMs(clockOffsetMs);
        setJamRttMs(rttMs);
      },
      onRemoteStreamStateChanged: (streaming) => {
        setIsReceivingHostAudioStream(streaming);
      },
    });
  }, [applyIncomingHostBroadcast]);

  // Keep participant's local inventory keys updated when library tracks change
  useEffect(() => {
    if (!jamRoom) return;
    jamWebRtcClient.updateParticipantStatus({
      inventoryKeys: localInventoryKeys,
    });
  }, [jamRoom?.roomCode, localInventoryKeys]);

  const isJamHost = Boolean(jamRoom && jamRoom.hostPeerId === jamWebRtcClient.getPeerId());
  const isJamGuest = Boolean(jamRoom && jamRoom.hostPeerId !== jamWebRtcClient.getPeerId());

  // Build shared queue items on Host and broadcast playback state every 2.5s & on track/state change
  useEffect(() => {
    if (!isJamHost || !jamRoom) return;

    const sendHostState = () => {
      if (!currentTrack) return;
      const pos =
        audioElementRef.current && Number.isFinite(audioElementRef.current.currentTime)
          ? audioElementRef.current.currentTime
          : currentTime;

      const hostPeerId = jamWebRtcClient.getPeerId();
      const hostPart = jamRoom.participants.find((p) => p.peerId === hostPeerId);
      const hostName = hostPart?.name || jamRoom.hostName || 'Host';

      const combinedQueue = [...playNextQueue, ...standardQueue].slice(0, 35);
      const sharedQueueItems: JamQueueItem[] = combinedQueue.map((t, idx) => ({
        id: `q-${t.id}-${idx}`,
        addedByPeerId: hostPeerId,
        addedByName: hostName,
        trackIdentity: buildTrackIdentity(t),
      }));

      const broadcast: JamBroadcastState = {
        trackId: currentTrack.id,
        trackIdentity: buildTrackIdentity(currentTrack),
        position: pos,
        state: isPlaying ? 'playing' : 'paused',
        hostTimestamp: Date.now(),
      };

      jamWebRtcClient.broadcastHostPlayback(broadcast, sharedQueueItems);
    };

    sendHostState();
    const interval = window.setInterval(sendHostState, 2500);
    return () => window.clearInterval(interval);
  }, [isJamHost, jamRoom?.roomCode, currentTrack, isPlaying, playNextQueue, standardQueue]);

  // Guest Drift Correction Loop (every 2.5 seconds: < 300ms adjust playbackRate 0.98-1.02; >= 300ms seek)
  useEffect(() => {
    if (!isJamGuest) return;

    const runDriftCheck = () => {
      const broadcast = latestHostBroadcastRef.current;
      if (!broadcast) return;

      const nowHost = Date.now() + jamWebRtcClient.getClockOffsetMs();
      const expectedPos =
        broadcast.state === 'playing'
          ? Math.min(
              broadcast.trackIdentity.duration || 9999,
              broadcast.position + Math.max(0, (nowHost - broadcast.hostTimestamp) / 1000)
            )
          : broadcast.position;

      if (!hasLocalCopyOfCurrentJamTrack) {
        setCurrentTime(expectedPos);
        setJamDriftMs(0);
        setJamPlaybackRate(1.0);
        return;
      }

      const audioEl = audioElementRef.current;
      if (!audioEl) return;

      const actualPos = audioEl.currentTime || 0;
      const driftMs = (expectedPos - actualPos) * 1000;
      setJamDriftMs(driftMs);
      jamWebRtcClient.updateParticipantStatus({ driftMs: Math.round(driftMs) });

      if (broadcast.state !== 'playing') {
        setJamPlaybackRate(1.0);
        if (Math.abs(driftMs) >= 150) {
          seekRequestRef.current?.(expectedPos);
        }
        return;
      }

      if (Math.abs(driftMs) >= 300) {
        // Above 300ms: hard seek to expected position and reset playbackRate
        seekRequestRef.current?.(expectedPos);
        setJamPlaybackRate(1.0);
      } else if (Math.abs(driftMs) > 25) {
        // Under 300ms: smoothly adjust playbackRate within 0.98 - 1.02
        const adjustment = Math.max(-0.02, Math.min(0.02, (driftMs / 250) * 0.02));
        setJamPlaybackRate(Number((1.0 + adjustment).toFixed(3)));
      } else {
        setJamPlaybackRate(1.0);
      }
    };

    const interval = window.setInterval(runDriftCheck, 2500);
    return () => window.clearInterval(interval);
  }, [isJamGuest, hasLocalCopyOfCurrentJamTrack]);

  // Smoothly advance virtual currentTime on Guest when missing local track so Synced Lyrics & Canvas run smoothly
  useEffect(() => {
    if (!isJamGuest || hasLocalCopyOfCurrentJamTrack || !isPlaying) return;
    const timer = window.setInterval(() => {
      const broadcast = latestHostBroadcastRef.current;
      if (!broadcast || broadcast.state !== 'playing') return;
      const nowHost = Date.now() + jamWebRtcClient.getClockOffsetMs();
      const expectedPos = Math.min(
        broadcast.trackIdentity.duration || 9999,
        broadcast.position + Math.max(0, (nowHost - broadcast.hostTimestamp) / 1000)
      );
      setCurrentTime(expectedPos);
    }, 100);
    return () => window.clearInterval(timer);
  }, [isJamGuest, hasLocalCopyOfCurrentJamTrack, isPlaying]);

  const handleStartJam = async (options: {
    name: string;
    color: string;
    requireCode: boolean;
    accessPin: string;
    allowGuestQueue: boolean;
    streamMissingTracks: boolean;
  }) => {
    const pos =
      audioElementRef.current && Number.isFinite(audioElementRef.current.currentTime)
        ? audioElementRef.current.currentTime
        : currentTime;

    const initialBroadcast: JamBroadcastState | null = currentTrack
      ? {
          trackId: currentTrack.id,
          trackIdentity: buildTrackIdentity(currentTrack),
          position: pos,
          state: isPlaying ? 'playing' : 'paused',
          hostTimestamp: Date.now(),
        }
      : null;

    const hostPeerId = jamWebRtcClient.getPeerId();
    const combinedQueue = [...playNextQueue, ...standardQueue].slice(0, 35);
    const sharedQueue: JamQueueItem[] = combinedQueue.map((t, idx) => ({
      id: `q-${t.id}-${idx}`,
      addedByPeerId: hostPeerId,
      addedByName: options.name,
      trackIdentity: buildTrackIdentity(t),
    }));

    await jamWebRtcClient.startJam({
      ...options,
      inventoryKeys: localInventoryKeys,
      currentBroadcast: initialBroadcast,
      sharedQueue,
    });
  };

  const handleJoinJam = async (options: {
    roomCode: string;
    name: string;
    color: string;
    accessPin: string;
  }) => {
    await jamWebRtcClient.joinJam({
      ...options,
      inventoryKeys: localInventoryKeys,
    });
  };

  const handleAddTrackToJamQueue = useCallback(
    (track: Track) => {
      if (!jamRoom) return;
      const myPeerId = jamWebRtcClient.getPeerId();
      const me = jamRoom.participants.find((p) => p.peerId === myPeerId);
      const item: JamQueueItem = {
        id: `jamq-${track.id}-${Date.now()}`,
        addedByPeerId: myPeerId,
        addedByName: me?.name || 'Listener',
        trackIdentity: buildTrackIdentity(track),
      };

      if (jamRoom.hostPeerId === myPeerId) {
        handleAddToQueue(track);
      } else {
        jamWebRtcClient.guestAddTrackToQueue(item);
        setWatcherNotice(`Sent "${track.title}" to Shared Jam Queue`);
        setTimeout(() => setWatcherNotice(null), 2200);
      }
    },
    [jamRoom, handleAddToQueue]
  );

  const handleRemoveFromJamQueue = useCallback(
    (itemId: string) => {
      if (!jamRoom || !isJamHost) return;
      const idx = jamRoom.sharedQueue.findIndex((q) => q.id === itemId);
      if (idx < 0) return;
      if (idx < playNextQueue.length) {
        setPlayNextQueue((prev) => prev.filter((_, i) => i !== idx));
      } else {
        const stdIdx = idx - playNextQueue.length;
        setStandardQueue((prev) => prev.filter((_, i) => i !== stdIdx));
      }
    },
    [jamRoom, isJamHost, playNextQueue.length]
  );

  const handlePlayJamQueueItem = useCallback(
    (item: JamQueueItem) => {
      if (!isJamHost) return;
      const matched = findMatchingLocalTrack(item.trackIdentity, tracks);
      if (matched) {
        handlePlayTrack(matched, standardQueue);
      }
    },
    [isJamHost, tracks, standardQueue, handlePlayTrack]
  );

  // Listen for System Tray IPC commands
  useEffect(() => {
    const unsubscribe = ipcClient.onTrayCommand((cmd) => {
      if (cmd.action === 'toggle-play') {
        setIsPlaying((p) => !p);
      } else if (cmd.action === 'next') {
        handleNextTrack(false);
      } else if (cmd.action === 'previous') {
        handlePreviousTrack();
      } else if (cmd.action === 'toggle-mini-player') {
        setIsMiniPlayer((m) => {
          const next = !m;
          ipcClient.setMiniPlayerMode(next).catch(() => {});
          return next;
        });
      }
    });
    return unsubscribe;
  }, [handleNextTrack, handlePreviousTrack]);

  const handleToggleShuffle = useCallback(() => {
    setShuffle((prev) => {
      const next = !prev;
      if (next) {
        setStandardQueue((curr) => shuffleArray(curr));
      } else {
        setStandardQueue(originalQueueOrder);
      }
      return next;
    });
  }, [originalQueueOrder]);

  const handleCycleRepeatMode = useCallback(() => {
    setRepeatMode((prev) => {
      if (prev === 'off') return 'all';
      if (prev === 'all') return 'one';
      return 'off';
    });
  }, []);

  // Favorites & Playlist Handlers
  const handleToggleFavorite = useCallback(
    async (track: Track) => {
      const res = await ipcClient.toggleFavoriteTrack(track.id);
      setCurrentTrack((prev) =>
        prev && prev.id === track.id ? { ...prev, isFavorite: res.isFavorite } : prev
      );
      if (activeDetail) {
        setActiveDetail((prev) =>
          prev
            ? {
                ...prev,
                tracks: prev.tracks.map((t) =>
                  t.id === track.id ? { ...t, isFavorite: res.isFavorite } : t
                ),
              }
            : null
        );
      }
      await loadLibraryData(debouncedSearch);
    },
    [activeDetail, debouncedSearch, loadLibraryData]
  );

  const handleCreatePlaylist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlaylistName.trim()) return;
    const created = await ipcClient.createPlaylist(newPlaylistName.trim());
    setNewPlaylistName('');
    setIsCreatingPlaylist(false);
    setSelectedPlaylistId(created.id);
    setViewMode('playlist');
    setActiveDetail(null);
    await loadLibraryData(debouncedSearch);
  };

  const handleCreatePlaylistWithTrack = async (name: string, track: Track) => {
    const created = await ipcClient.createPlaylist(name);
    await ipcClient.addTrackToPlaylist(created.id, track.id);
    setWatcherNotice(`Created "${created.name}" with ${track.title}`);
    setTimeout(() => setWatcherNotice(null), 2500);
    await loadLibraryData(debouncedSearch);
  };

  const handleAddTrackToPlaylist = async (playlistId: number, track: Track) => {
    await ipcClient.addTrackToPlaylist(playlistId, track.id);
    const targetPl = playlists.find((p) => p.id === playlistId);
    setWatcherNotice(`Added "${track.title}" to ${targetPl?.name || 'playlist'}`);
    setTimeout(() => setWatcherNotice(null), 2400);
    await loadLibraryData(debouncedSearch);
  };

  const handleRenamePlaylist = async (
    playlistId: number,
    name: string,
    description: string
  ) => {
    await ipcClient.renamePlaylist(playlistId, name, description);
    await loadLibraryData(debouncedSearch);
  };

  const handleDeletePlaylist = async (playlistId: number) => {
    await ipcClient.deletePlaylist(playlistId);
    setViewMode('songs');
    setSelectedPlaylistId(null);
    await loadLibraryData(debouncedSearch);
  };

  const handleRemoveTrackFromPlaylist = async (
    playlistId: number,
    playlistEntryId: number
  ) => {
    await ipcClient.removeTrackFromPlaylist(playlistId, playlistEntryId);
    await loadLibraryData(debouncedSearch);
  };

  const handleReorderPlaylistTracks = async (
    playlistId: number,
    orderedTracks: Track[]
  ) => {
    setPlaylistTracks(orderedTracks);
    const orderedEntryIds = orderedTracks
      .map((t) => t.playlistEntryId)
      .filter((id): id is number => typeof id === 'number');
    await ipcClient.reorderPlaylistTracks(playlistId, orderedEntryIds);
  };

  // Album & Artist Drill-Down Handlers
  const handleSelectAlbum = useCallback(async (album: string, artist: string) => {
    const albumTracks = await ipcClient.getAlbumTracks(album, artist);
    setActiveDetail({
      type: 'album',
      title: album,
      subtitle: artist,
      tracks: albumTracks,
    });
  }, []);

  const handlePlayAlbum = useCallback(
    async (album: string, artist: string) => {
      const albumTracks = await ipcClient.getAlbumTracks(album, artist);
      handlePlayAll(albumTracks, false);
    },
    [handlePlayAll]
  );

  const handleSelectArtist = useCallback(async (artist: string) => {
    const artistTracks = await ipcClient.getArtistTracks(artist);
    setActiveDetail({
      type: 'artist',
      title: artist,
      tracks: artistTracks,
    });
  }, []);

  const handlePlayArtist = useCallback(
    async (artist: string) => {
      const artistTracks = await ipcClient.getArtistTracks(artist);
      handlePlayAll(artistTracks, false);
    },
    [handlePlayAll]
  );

  const handleRemoveFolder = async (folderId: number) => {
    await ipcClient.removeFolder(folderId);
    await loadLibraryData(debouncedSearch);
  };

  const handleRescanFolders = async () => {
    setWatcherNotice('Rescanning watched folders...');
    await ipcClient.rescanAllFolders();
    await loadLibraryData(debouncedSearch);
  };

  const handleResetUnplayableTracks = async () => {
    await ipcClient.resetUnplayableTracks();
    await loadLibraryData(debouncedSearch);
  };

  const handleDismissWelcome = useCallback(() => {
    try {
      window.localStorage.setItem(WELCOME_STORAGE_KEY, 'true');
    } catch {
      // ignore storage errors
    }
    setIsWelcomeOpen(false);
  }, []);

  const handleChooseFolderFromWelcome = useCallback(() => {
    try {
      window.localStorage.setItem(WELCOME_STORAGE_KEY, 'true');
    } catch {
      // ignore storage errors
    }
    setIsWelcomeOpen(false);
    setIsAddFolderOpen(true);
  }, []);

  const handleShowWelcomeScreenAgain = useCallback(() => {
    try {
      window.localStorage.removeItem(WELCOME_STORAGE_KEY);
    } catch {
      // ignore storage errors
    }
    setIsWelcomeOpen(true);
  }, []);

  const handleOpenSettingsPage = useCallback(() => {
    if (isMiniPlayer) {
      setIsSettingsOpen(true);
      return;
    }
    setViewMode('settings');
    setActiveDetail(null);
    setIsLyricsOpen(false);
  }, [isMiniPlayer]);

  const handleToggleMiniPlayer = () => {
    setIsMiniPlayer((prev) => {
      const next = !prev;
      ipcClient.setMiniPlayerMode(next).catch(() => {});
      return next;
    });
  };

  // Keyboard shortcut: 'L' toggles the Synced Lyrics view
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F11') {
        e.preventDefault();
        ipcClient
          .getWindowInfo()
          .then((info) => ipcClient.setFullScreen(!info.isFullScreen))
          .catch(() => {});
        return;
      }
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault();
        setIsLyricsOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Update track state when ISRC or cover art is updated from LyricsView
  const handleTrackUpdated = useCallback((trackId: number, updates: Partial<Track>) => {
    setCurrentTrack((prev) => (prev && prev.id === trackId ? { ...prev, ...updates } : prev));
    setTracks((prev) => prev.map((t) => (t.id === trackId ? { ...t, ...updates } : t)));
    setPlaylistTracks((prev) => prev.map((t) => (t.id === trackId ? { ...t, ...updates } : t)));
  }, []);

  // Filter activeDetail tracks if user types in search while inside a detail view
  const filteredDetailTracks = useMemo(() => {
    if (!activeDetail) return [];
    if (!debouncedSearch) return activeDetail.tracks;
    const q = debouncedSearch.toLowerCase();
    return activeDetail.tracks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q) ||
        t.album.toLowerCase().includes(q) ||
        (t.isrc && t.isrc.toLowerCase().includes(q))
    );
  }, [activeDetail, debouncedSearch]);

  const favoritesPlaylist = useMemo(
    () => playlists.find((p) => p.isFavorites) || null,
    [playlists]
  );
  const customPlaylists = useMemo(
    () => playlists.filter((p) => !p.isFavorites),
    [playlists]
  );
  const activePlaylistObject = useMemo(() => {
    if (viewMode === 'favorites') return favoritesPlaylist;
    if (viewMode === 'playlist' && selectedPlaylistId) {
      return playlists.find((p) => p.id === selectedPlaylistId) || null;
    }
    return null;
  }, [viewMode, selectedPlaylistId, playlists, favoritesPlaylist]);

  // ----- Library view derivations (sorting, artist filter, extra categories) -----
  const displayTracks = useMemo(() => {
    const sorted = sortTracks(tracks, songSortKey, songSortDir);
    return artistFilter ? sorted.filter((t) => t.artist === artistFilter) : sorted;
  }, [tracks, songSortKey, songSortDir, artistFilter]);

  const displayAlbums = useMemo(() => {
    const sorted = sortAlbums(albums, albumSortKey, albumSortDir);
    return artistFilter ? sorted.filter((a) => a.artist === artistFilter) : sorted;
  }, [albums, albumSortKey, albumSortDir, artistFilter]);

  const displayArtists = useMemo(
    () => sortArtists(artists, artistSortKey, artistSortDir),
    [artists, artistSortKey, artistSortDir]
  );

  // Artist chip strip: the most-played-in-library artists first (capped to keep scrolling light)
  const chipArtists = useMemo(() => {
    const top = [...artists].sort((a, b) => b.trackCount - a.trackCount).slice(0, 60);
    if (artistFilter && !top.some((a) => a.artist === artistFilter)) {
      const sel = artists.find((a) => a.artist === artistFilter);
      if (sel) top.unshift(sel);
    }
    return top;
  }, [artists, artistFilter]);

  const recentTracks = useMemo(
    () => sortTracks(tracks, 'added', 'desc').slice(0, 300),
    [tracks]
  );

  const renderTrackList = (list: Track[], headerSlot?: React.ReactNode) => (
    <VirtualizedTrackList
      tracks={list}
      currentTrackId={currentTrack?.id ?? null}
      isPlaying={isPlaying}
      accentColor={palette.accent}
      onPlayTrack={handlePlayTrack}
      onTogglePlayPause={() => setIsPlaying((p) => !p)}
      onPlayNext={handlePlayNext}
      onAddToQueue={handleAddToQueue}
      onToggleFavorite={handleToggleFavorite}
      onOpenContextMenu={(e, track) => setContextMenu({ track, x: e.clientX, y: e.clientY })}
      onSelectAlbum={handleSelectAlbum}
      onSelectArtist={handleSelectArtist}
      onAddFolder={() => setIsAddFolderOpen(true)}
      isSearchFiltered={Boolean(debouncedSearch)}
      headerSlot={headerSlot}
    />
  );

  const goToView = (mode: LibraryViewMode) => {
    setViewMode(mode);
    setActiveDetail(null);
    setIsLyricsOpen(false);
    setCategoryKey(null);
  };

  const showToolbar =
    !isLyricsOpen &&
    !activeDetail &&
    !isLoading &&
    (viewMode === 'songs' ||
      viewMode === 'albums' ||
      viewMode === 'artists' ||
      viewMode === 'years' ||
      viewMode === 'folders' ||
      viewMode === 'quality') &&
    !((viewMode === 'years' || viewMode === 'folders' || viewMode === 'quality') && categoryKey);

  const themeBgClass =
    themeMode === 'midnight-oled'
      ? 'bg-black text-[#F3F4F6]'
      : themeMode === 'frosted-slate'
      ? 'bg-[#0D1322] text-[#F3F4F6]'
      : themeMode === 'crystal-light'
      ? 'bg-[#182032] text-[#F9FAFB]'
      : 'bg-[#06070C] text-[#F3F4F6]';

  const missingFolders = useMemo(
    () => folders.filter((f) => f.exists === false),
    [folders]
  );

  return (
    <div
      className={`relative h-screen w-screen flex flex-col ${themeBgClass} overflow-hidden select-none transition-colors duration-300 ${
        isMiniPlayer ? 'rounded-[24px]' : ''
      }`}
    >
      {/* Hidden SVG Optical Refraction Filter Definitions */}
      <LiquidRefractionDefs />

      {/* Dynamic Album Art Ambient Background Gradient Mesh */}
      <div
        className={`ambient-bg pointer-events-none fixed inset-0 overflow-hidden z-0 ${
          isMiniPlayer ? 'rounded-[24px]' : ''
        }`}
        data-paused={isPlaying ? 'false' : 'true'}
        aria-hidden="true"
      >
        <div
          className="ambient-blob ambient-blob-a"
          style={{ ['--blob-color' as string]: palette.primary }}
        />
        <div
          className="ambient-blob ambient-blob-b"
          style={{ ['--blob-color' as string]: palette.secondary }}
        />
        <div
          className="ambient-blob ambient-blob-c"
          style={{ ['--blob-color' as string]: palette.accent }}
        />
        <div
          className="ambient-blob ambient-blob-d"
          style={{ ['--blob-color' as string]: palette.primary }}
        />
      </div>

      {/* Custom Frameless Window Title Bar */}
      {!isMiniPlayer && (
        <TitleBar
          isPlaying={isPlaying}
          isMiniPlayer={isMiniPlayer}
          equalizerEnabled={equalizer.enabled}
          onToggleMiniPlayer={handleToggleMiniPlayer}
          onOpenSettings={handleOpenSettingsPage}
          accentColor={palette.accent}
        />
      )}

      {/* Mini Player Mode vs Full Desktop Floating Glass Workspace */}
      {isMiniPlayer ? (
        <MiniPlayer
          currentTrack={currentTrack}
          isPlaying={isPlaying}
          isPreparingTrack={isPreparingTrack}
          currentTime={currentTime}
          duration={duration}
          volume={volume}
          muted={muted}
          shuffle={shuffle}
          repeatMode={repeatMode}
          palette={palette}
          onTogglePlayPause={() => setIsPlaying((p) => !p)}
          onNextTrack={() => handleNextTrack(false)}
          onPreviousTrack={handlePreviousTrack}
          onSeek={(newTime) => seekRequestRef.current?.(newTime)}
          onChangeVolume={(val) => {
            setVolume(val);
            if (val > 0 && muted) setMuted(false);
          }}
          onToggleMute={() => setMuted((m) => !m)}
          onToggleShuffle={handleToggleShuffle}
          onCycleRepeatMode={handleCycleRepeatMode}
          onToggleFavorite={handleToggleFavorite}
          onExitMiniPlayer={handleToggleMiniPlayer}
        />
      ) : (
        <div className="relative z-10 flex-1 flex gap-3 px-3 pb-3 min-h-0 overflow-hidden">
          {/* Floating Left Navigation, Playlists & Watched Folders Sidebar */}
          <aside className="w-64 shrink-0 rounded-2xl liquid-glass specular-surface flex flex-col justify-between overflow-hidden">
            <div className="relative z-10 p-3.5 space-y-5 overflow-y-auto flex-1">
              {/* Library Navigation */}
              <div>
                <div className="px-2.5 mb-1.5 text-[11px] font-semibold text-white/50">
                  Library
                </div>
                <nav className="space-y-1">
                  <button
                    type="button"
                    onClick={() => {
                      setViewMode('songs');
                      setActiveDetail(null);
                      setIsLyricsOpen(false);
                    }}
                    style={
                      viewMode === 'songs' && !activeDetail && !isLyricsOpen
                        ? { backgroundColor: palette.accent, color: '#090A0F' }
                        : undefined
                    }
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                      viewMode === 'songs' && !activeDetail && !isLyricsOpen
                        ? 'shadow-md'
                        : 'text-white/75 hover:text-white hover:bg-white/[0.07]'
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <Music size={15} />
                      <span>Songs</span>
                    </span>
                    <span className="font-mono tabular-nums text-[11px] opacity-80">
                      {stats.totalTracks.toLocaleString()}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setViewMode('albums');
                      setActiveDetail(null);
                      setIsLyricsOpen(false);
                    }}
                    style={
                      !isLyricsOpen && (viewMode === 'albums' || activeDetail?.type === 'album')
                        ? { backgroundColor: palette.accent, color: '#090A0F' }
                        : undefined
                    }
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                      !isLyricsOpen && (viewMode === 'albums' || activeDetail?.type === 'album')
                        ? 'shadow-md'
                        : 'text-white/75 hover:text-white hover:bg-white/[0.07]'
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <Disc size={15} />
                      <span>Albums</span>
                    </span>
                    <span className="font-mono tabular-nums text-[11px] opacity-80">
                      {stats.totalAlbums.toLocaleString()}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setViewMode('artists');
                      setActiveDetail(null);
                      setIsLyricsOpen(false);
                    }}
                    style={
                      !isLyricsOpen && (viewMode === 'artists' || activeDetail?.type === 'artist')
                        ? { backgroundColor: palette.accent, color: '#090A0F' }
                        : undefined
                    }
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                      !isLyricsOpen && (viewMode === 'artists' || activeDetail?.type === 'artist')
                        ? 'shadow-md'
                        : 'text-white/75 hover:text-white hover:bg-white/[0.07]'
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <Users size={15} />
                      <span>Artists</span>
                    </span>
                    <span className="font-mono tabular-nums text-[11px] opacity-80">
                      {stats.totalArtists.toLocaleString()}
                    </span>
                  </button>

                  {(
                    [
                      { mode: 'recent', label: 'Recently Added', Icon: Clock },
                      { mode: 'years', label: 'Years', Icon: CalendarDays },
                      { mode: 'folders', label: 'Folders', Icon: Folder },
                      { mode: 'quality', label: 'Quality', Icon: Gem },
                    ] as const
                  ).map(({ mode, label, Icon }) => {
                    const active = !isLyricsOpen && viewMode === mode && !activeDetail;
                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => goToView(mode)}
                        style={active ? { backgroundColor: palette.accent, color: '#090A0F' } : undefined}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                          active ? 'shadow-md' : 'text-white/75 hover:text-white hover:bg-white/[0.07]'
                        }`}
                      >
                        <span className="flex items-center gap-2.5">
                          <Icon size={15} />
                          <span>{label}</span>
                        </span>
                      </button>
                    );
                  })}

                  <button
                    type="button"
                    onClick={() => {
                      setViewMode('favorites');
                      setActiveDetail(null);
                      setIsLyricsOpen(false);
                    }}
                    style={
                      !isLyricsOpen && viewMode === 'favorites' && !activeDetail
                        ? { backgroundColor: palette.accent, color: '#090A0F' }
                        : undefined
                    }
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                      !isLyricsOpen && viewMode === 'favorites' && !activeDetail
                        ? 'shadow-md'
                        : 'text-white/75 hover:text-white hover:bg-white/[0.07]'
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <Heart
                        size={15}
                        className={
                          !isLyricsOpen && viewMode === 'favorites' && !activeDetail
                            ? 'fill-slate-950'
                            : 'text-rose-400'
                        }
                      />
                      <span>Favorites</span>
                    </span>
                    <span className="font-mono tabular-nums text-[11px] opacity-80">
                      {stats.favoriteTracksCount.toLocaleString()}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setViewMode('stats');
                      setActiveDetail(null);
                      setIsLyricsOpen(false);
                    }}
                    style={
                      !isLyricsOpen && viewMode === 'stats' && !activeDetail
                        ? { backgroundColor: palette.accent, color: '#090A0F' }
                        : undefined
                    }
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                      !isLyricsOpen && viewMode === 'stats' && !activeDetail
                        ? 'shadow-md'
                        : 'text-white/75 hover:text-white hover:bg-white/[0.07]'
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <BarChart3 size={15} />
                      <span>Listening Stats</span>
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setViewMode('settings');
                      setActiveDetail(null);
                      setIsLyricsOpen(false);
                    }}
                    style={
                      !isLyricsOpen && viewMode === 'settings' && !activeDetail
                        ? { backgroundColor: palette.accent, color: '#090A0F' }
                        : undefined
                    }
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                      !isLyricsOpen && viewMode === 'settings' && !activeDetail
                        ? 'shadow-md'
                        : 'text-white/75 hover:text-white hover:bg-white/[0.07]'
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <Settings size={15} />
                      <span>Settings</span>
                    </span>
                  </button>
                </nav>
              </div>

              {/* Playlists Section */}
              <div>
                <div className="flex items-center justify-between px-2.5 mb-1.5">
                  <span className="text-[11px] font-semibold text-white/50">Playlists</span>
                  <button
                    type="button"
                    onClick={() => setIsCreatingPlaylist((c) => !c)}
                    title="Create New Playlist"
                    className="p-1 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                  >
                    <Plus size={13} />
                  </button>
                </div>

                {isCreatingPlaylist && (
                  <form
                    onSubmit={handleCreatePlaylist}
                    className="mb-2 p-2 rounded-xl bg-black/40 border border-white/15 flex items-center gap-1.5"
                  >
                    <input
                      type="text"
                      autoFocus
                      value={newPlaylistName}
                      onChange={(e) => setNewPlaylistName(e.target.value)}
                      placeholder="New playlist..."
                      className="flex-1 min-w-0 px-2 py-1 rounded bg-transparent text-xs text-white placeholder-white/40 focus:outline-none"
                    />
                    <button
                      type="submit"
                      className="p-1 rounded bg-white/15 hover:bg-white/25 text-white cursor-pointer"
                      title="Create"
                    >
                      <Check size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsCreatingPlaylist(false);
                        setNewPlaylistName('');
                      }}
                      className="p-1 rounded text-white/50 hover:text-white cursor-pointer"
                    >
                      <X size={12} />
                    </button>
                  </form>
                )}

                <div className="space-y-1">
                  {customPlaylists.map((pl) => {
                    const isSelected =
                      viewMode === 'playlist' && selectedPlaylistId === pl.id && !activeDetail;
                    return (
                      <button
                        key={pl.id}
                        type="button"
                        onClick={() => {
                          setSelectedPlaylistId(pl.id);
                          setViewMode('playlist');
                          setActiveDetail(null);
                          setIsLyricsOpen(false);
                        }}
                        style={
                          isSelected
                            ? { backgroundColor: palette.accent, color: '#090A0F' }
                            : undefined
                        }
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                          isSelected
                            ? 'font-semibold shadow-md'
                            : 'text-white/75 hover:text-white hover:bg-white/[0.07]'
                        }`}
                      >
                        <span className="flex items-center gap-2.5 min-w-0">
                          <ListMusic size={14} className="shrink-0" />
                          <span className="truncate">{pl.name}</span>
                        </span>
                        <span className="font-mono tabular-nums text-[11px] opacity-75 shrink-0 ml-2">
                          {pl.trackCount}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Watched Music Folders */}
              <div>
                <div className="flex items-center justify-between px-2.5 mb-1.5">
                  <span className="text-[11px] font-semibold text-white/50">Music Folders</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={handleRescanFolders}
                      title="Rescan All Watched Folders"
                      className="p-1 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                    >
                      <RefreshCw size={12} className={stats.isScanning || scanProgress ? 'animate-spin' : ''} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsAddFolderOpen(true)}
                      title="Add Music Folder"
                      style={{ color: palette.accent }}
                      className="p-1 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
                    >
                      <FolderPlus size={13} />
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  {folders.map((folder) => {
                    const isMissing = folder.exists === false;
                    return (
                      <div
                        key={folder.id}
                        className={`group flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl border text-xs ${
                          isMissing
                            ? 'bg-amber-500/10 border-amber-400/35'
                            : 'bg-white/[0.03] border-white/10'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {isMissing ? (
                            <AlertTriangle size={13} className="text-amber-300 shrink-0" />
                          ) : (
                            <Folder
                              size={13}
                              style={{ color: palette.accent }}
                              className="shrink-0"
                            />
                          )}
                          <div className="min-w-0">
                            <div
                              className="font-medium text-white/90 truncate"
                              title={folder.errorMessage || folder.path}
                            >
                              {folder.name}
                            </div>
                            <div className="text-[11px] font-mono tabular-nums text-white/45">
                              {isMissing
                                ? 'Folder missing'
                                : `${folder.trackCount.toLocaleString()} files · watching`}
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveFolder(folder.id)}
                          title="Remove Folder from Library"
                          className="opacity-0 group-hover:opacity-100 p-1 rounded text-white/60 hover:text-rose-400 transition-opacity cursor-pointer"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    );
                  })}

                  <button
                    type="button"
                    onClick={() => setIsAddFolderOpen(true)}
                    className="liquid-glass-btn w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-medium text-white whitespace-nowrap shrink-0 cursor-pointer mt-2"
                  >
                    <FolderPlus size={14} style={{ color: palette.accent }} />
                    <span>Add Music Folder</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Bottom Library Total Runtime Footer */}
            <div className="relative z-10 p-3.5 border-t border-white/10 bg-black/20">
              <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-white/45 px-1">
                <span>Total Runtime</span>
                <span>{formatTotalDurationHuman(stats.totalDuration)}</span>
              </div>
            </div>
          </aside>

          {/* Floating Center Main Library Glass Viewport */}
          <main className="flex-1 flex flex-col min-w-0 rounded-2xl liquid-glass specular-surface overflow-hidden">
            {/* Top Search & Context Header */}
            <header className="relative z-10 h-13 shrink-0 px-6 border-b border-white/10 flex items-center justify-between gap-6">
              <div className="flex items-center gap-3 min-w-0">
                <h1 className="text-base font-bold text-white whitespace-nowrap shrink-0">
                  {isLyricsOpen
                    ? 'Synced Lyrics'
                    : activeDetail
                    ? activeDetail.title
                    : viewMode === 'stats'
                    ? 'Listening Stats'
                    : viewMode === 'settings'
                    ? 'Settings'
                    : viewMode === 'recent'
                    ? 'Recently Added'
                    : viewMode === 'years'
                    ? 'Years'
                    : viewMode === 'folders'
                    ? 'Folders'
                    : viewMode === 'quality'
                    ? 'Audio Quality'
                    : viewMode === 'songs'
                    ? 'All Songs'
                    : viewMode === 'albums'
                    ? 'Albums'
                    : viewMode === 'artists'
                    ? 'Artists'
                    : activePlaylistObject?.name || 'Playlist'}
                </h1>
                <span className="text-xs text-white/55 font-mono tabular-nums whitespace-nowrap shrink-0">
                  ·{' '}
                  {isLyricsOpen
                    ? currentTrack
                      ? `${currentTrack.title} — ${currentTrack.artist}`
                      : 'Select a track'
                    : activeDetail
                    ? `${filteredDetailTracks.length.toLocaleString()} tracks`
                    : viewMode === 'stats'
                    ? 'Top songs, artists & time listened'
                    : viewMode === 'settings'
                    ? 'Audio, Folders, Theme, Caches & Jam'
                    : viewMode === 'recent'
                    ? 'Newest files in your library'
                    : viewMode === 'years'
                    ? 'Browse by release year'
                    : viewMode === 'folders'
                    ? 'Browse by folder on disk'
                    : viewMode === 'quality'
                    ? 'Hi-Res, Lossless & Lossy'
                    : viewMode === 'songs'
                    ? `${displayTracks.length.toLocaleString()} tracks`
                    : viewMode === 'albums'
                    ? `${displayAlbums.length.toLocaleString()} albums`
                    : viewMode === 'artists'
                    ? `${artists.length.toLocaleString()} artists`
                    : `${playlistTracks.length.toLocaleString()} tracks`}
                </span>
                {watcherNotice && (
                  <span
                    className="text-xs truncate ml-2 font-medium"
                    style={{ color: palette.accent }}
                  >
                    · {watcherNotice}
                  </span>
                )}
              </div>

              {/* Search Input */}
              <div className="flex items-center gap-3">
                <div className="relative w-72 sm:w-80">
                  <Search
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-white/50 pointer-events-none"
                  />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search songs, artists, albums, ISRC..."
                    className="w-full pl-8 pr-8 py-1.5 rounded-xl bg-black/35 border border-white/15 focus:border-white/40 focus:outline-none text-xs text-white placeholder-white/40 transition-colors"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/60 hover:text-white cursor-pointer"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              </div>
            </header>

            {/* Non-Technical Status Banners for Offline Network, Missing Folders, or Background Scan */}
            {(!isOnline || missingFolders.length > 0 || scanProgress) && (
              <div className="relative z-10 px-6 py-2.5 border-b border-white/10 bg-black/35 space-y-2 shrink-0">
                {!isOnline && (
                  <div className="flex items-center justify-between gap-3 text-xs text-amber-200">
                    <div className="flex items-center gap-2 min-w-0">
                      <WifiOff size={14} className="text-amber-300 shrink-0" />
                      <span className="truncate">
                        You&apos;re currently offline. Your local music library, playlists, and
                        cached lyrics work normally. Online features like Jam and new lyrics will
                        reconnect automatically when your internet returns.
                      </span>
                    </div>
                  </div>
                )}

                {missingFolders.length > 0 && viewMode !== 'settings' && (
                  <div className="flex items-center justify-between gap-3 text-xs text-amber-200">
                    <div className="flex items-center gap-2 min-w-0">
                      <AlertTriangle size={14} className="text-amber-300 shrink-0" />
                      <span className="truncate">
                        We couldn&apos;t find &ldquo;{missingFolders[0].name}&rdquo; on your
                        computer. It may have been moved, renamed, or is on an unplugged drive.
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setViewMode('settings')}
                      className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-[11px] font-semibold text-white cursor-pointer whitespace-nowrap shrink-0"
                    >
                      Manage Folders
                    </button>
                  </div>
                )}

                {scanProgress && (
                  <div className="flex items-center gap-3 text-xs">
                    <RefreshCw
                      size={13}
                      style={{ color: palette.accent }}
                      className="animate-spin shrink-0"
                    />
                    <span className="text-white/85 truncate flex-1">{scanProgress.message}</span>
                    {scanProgress.total > 0 && (
                      <div className="w-36 h-1.5 rounded-full bg-white/10 overflow-hidden shrink-0">
                        <div
                          className="h-full transition-all duration-150"
                          style={{
                            backgroundColor: palette.accent,
                            width: `${Math.min(
                              100,
                              (scanProgress.processed / scanProgress.total) * 100
                            )}%`,
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Sort / layout toolbar + artist filter chips */}
            {showToolbar && (
              <>
                {(viewMode === 'songs' || viewMode === 'albums') && (
                  <ArtistChipsBar
                    artists={chipArtists}
                    selectedArtist={artistFilter}
                    accentColor={palette.accent}
                    onSelectArtist={setArtistFilter}
                  />
                )}
                <LibraryToolbar
                  accentColor={palette.accent}
                  sortOptions={
                    viewMode === 'songs'
                      ? SONG_SORT_OPTIONS
                      : viewMode === 'albums'
                      ? ALBUM_SORT_OPTIONS
                      : viewMode === 'artists'
                      ? ARTIST_SORT_OPTIONS
                      : [
                          {
                            key: 'default',
                            label:
                              viewMode === 'years'
                                ? 'Year'
                                : viewMode === 'folders'
                                ? 'Folder name'
                                : 'Quality tier',
                          },
                        ]
                  }
                  sortKey={
                    viewMode === 'songs'
                      ? songSortKey
                      : viewMode === 'albums'
                      ? albumSortKey
                      : viewMode === 'artists'
                      ? artistSortKey
                      : 'default'
                  }
                  sortDir={
                    viewMode === 'songs'
                      ? songSortDir
                      : viewMode === 'albums'
                      ? albumSortDir
                      : viewMode === 'artists'
                      ? artistSortDir
                      : viewMode === 'years'
                      ? yearsSortDir
                      : viewMode === 'folders'
                      ? foldersSortDir
                      : qualitySortDir
                  }
                  onChangeSortKey={(key) => {
                    if (viewMode === 'songs') setSongSortKey(key as SongSortKey);
                    else if (viewMode === 'albums') setAlbumSortKey(key as AlbumSortKey);
                    else if (viewMode === 'artists') setArtistSortKey(key as ArtistSortKey);
                  }}
                  onToggleSortDir={() => {
                    const flip = (d: SortDir): SortDir => (d === 'asc' ? 'desc' : 'asc');
                    if (viewMode === 'songs') setSongSortDir(flip(songSortDir));
                    else if (viewMode === 'albums') setAlbumSortDir(flip(albumSortDir));
                    else if (viewMode === 'artists') setArtistSortDir(flip(artistSortDir));
                    else if (viewMode === 'years') setYearsSortDir(flip(yearsSortDir));
                    else if (viewMode === 'folders') setFoldersSortDir(flip(foldersSortDir));
                    else setQualitySortDir(flip(qualitySortDir));
                  }}
                  gridMode={viewMode === 'songs' ? undefined : gridMode}
                  onChangeGridMode={viewMode === 'songs' ? undefined : setGridMode}
                  summary={
                    artistFilter && (viewMode === 'songs' || viewMode === 'albums')
                      ? `Filtered: ${artistFilter}`
                      : undefined
                  }
                />
              </>
            )}

            {/* Main Viewport Content */}
            <div className="relative z-10 flex-1 flex flex-col min-h-0 overflow-hidden">
              {isLyricsOpen ? (
                <div className="flex-1 flex flex-col xl:flex-row min-h-0 overflow-hidden">
                  {/* Left Track Artwork & Context Column on Wide Screens */}
                  {currentTrack && (
                    <div className="hidden xl:flex w-80 shrink-0 flex-col items-center justify-center p-8 border-r border-white/10 bg-black/15">
                      <div className="w-56 h-56 rounded-2xl p-1.5 liquid-glass-elevated shadow-2xl">
                        <CoverArt
                          src={currentTrack.coverArtUrl}
                          title={currentTrack.album}
                          subtitle={currentTrack.artist}
                          className="w-full h-full rounded-xl"
                          iconSize={56}
                        />
                      </div>
                      <div className="w-full mt-5 text-center">
                        <h2 className="text-lg font-bold text-white truncate">
                          {currentTrack.title}
                        </h2>
                        <p className="text-xs text-white/70 truncate mt-1">
                          {currentTrack.artist} · {currentTrack.album}
                        </p>
                        <div className="mt-2 text-[11px] font-mono text-white/55">
                          <span className="font-semibold text-white/80">{currentTrack.format}</span>
                          {isTrackLossless(currentTrack) && (
                            <span className="text-emerald-300 font-semibold"> · Lossless</span>
                          )}
                          {formatBitrate(currentTrack.bitrate) && (
                            <span> · {formatBitrate(currentTrack.bitrate)}</span>
                          )}
                          {formatSampleRate(currentTrack.sampleRate, currentTrack.bitDepth) && (
                            <span>
                              {' '}
                              · {formatSampleRate(currentTrack.sampleRate, currentTrack.bitDepth)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Apple Music Style Synced Lyrics Stage */}
                  <div className="flex-1 min-w-0 min-h-0 flex flex-col">
                    <LyricsView
                      currentTrack={currentTrack}
                      isPlaying={isPlaying}
                      currentTime={currentTime}
                      audioElementRef={audioElementRef}
                      palette={palette}
                      fontSize={lyricsFontSize}
                      showBackgroundVocals={lyricsShowBackgroundVocals}
                      onSeek={(newTime) => seekRequestRef.current?.(newTime)}
                      onTrackUpdated={handleTrackUpdated}
                      onClose={() => setIsLyricsOpen(false)}
                    />
                  </div>
                </div>
              ) : isLoading ? (
                <div className="flex-1 p-6 space-y-2">
                  {Array.from({ length: 12 }).map((_, idx) => (
                    <div
                      key={idx}
                      className="h-10 rounded-xl bg-white/[0.04] animate-pulse border border-white/10"
                    />
                  ))}
                </div>
              ) : activeDetail ? (
                <DetailView
                  type={activeDetail.type}
                  title={activeDetail.title}
                  subtitle={activeDetail.subtitle}
                  tracks={filteredDetailTracks}
                  currentTrackId={currentTrack?.id ?? null}
                  isPlaying={isPlaying}
                  accentColor={palette.accent}
                  onBack={() => setActiveDetail(null)}
                  onPlayTrack={handlePlayTrack}
                  onTogglePlayPause={() => setIsPlaying((p) => !p)}
                  onPlayAll={handlePlayAll}
                  onPlayNext={handlePlayNext}
                  onAddToQueue={handleAddToQueue}
                  onAddAllToQueue={handleAddAllToQueue}
                  onToggleFavorite={handleToggleFavorite}
                  onOpenContextMenu={(e, track) =>
                    setContextMenu({ track, x: e.clientX, y: e.clientY })
                  }
                  onSelectAlbum={handleSelectAlbum}
                  onSelectArtist={handleSelectArtist}
                />
              ) : viewMode === 'stats' ? (
                <StatsView
                  accentColor={palette.accent}
                  onPlayTrack={(track) => {
                    if (currentTrack) {
                      setHistoryStack((prev) => [...prev.slice(-40), currentTrack]);
                    }
                    pendingResumeSecondsRef.current = 0;
                    setCurrentTrack(track);
                    setIsPlaying(true);
                  }}
                />
              ) : viewMode === 'settings' ? (
                <SettingsPage
                  folders={folders}
                  stats={stats}
                  isScanning={Boolean(stats.isScanning || scanProgress)}
                  scanProgress={scanProgress}
                  equalizer={equalizer}
                  outputDeviceId={outputDeviceId}
                  canvasEnabled={canvasEnabled}
                  normalizeVolume={normalizeVolume}
                  crossfadeSeconds={crossfadeSeconds}
                  gaplessPlayback={gaplessPlayback}
                  themeMode={themeMode}
                  accentMode={accentMode}
                  customAccentHex={customAccentHex}
                  fontScale={fontScale}
                  boldText={boldText}
                  onChangeFontScale={setFontScale}
                  onChangeBoldText={setBoldText}
                  fontFamily={fontFamily}
                  onChangeFontFamily={setFontFamily}
                  effectsMode={effectsMode}
                  onChangeEffectsMode={setEffectsMode}
                  effectiveAccentColor={palette.accent}
                  lyricsOnlineEnabled={lyricsOnlineEnabled}
                  lyricsFontSize={lyricsFontSize}
                  lyricsShowBackgroundVocals={lyricsShowBackgroundVocals}
                  jamRtcConfig={jamRtcConfig}
                  streamMissingTracksLocalPref={streamMissingTracksLocalPref}
                  isOnline={isOnline}
                  onOpenAddFolderModal={() => setIsAddFolderOpen(true)}
                  onRemoveFolder={handleRemoveFolder}
                  onRescanFolders={handleRescanFolders}
                  onResetUnplayableTracks={handleResetUnplayableTracks}
                  onShowWelcomeScreen={handleShowWelcomeScreenAgain}
                  onChangeEqualizer={setEqualizer}
                  onChangeOutputDevice={setOutputDeviceId}
                  onChangeCanvasEnabled={setCanvasEnabled}
                  onChangeNormalizeVolume={setNormalizeVolume}
                  onChangeCrossfadeSeconds={setCrossfadeSeconds}
                  onChangeGaplessPlayback={setGaplessPlayback}
                  onChangeThemeMode={setThemeMode}
                  onChangeAccentMode={setAccentMode}
                  onChangeCustomAccentHex={setCustomAccentHex}
                  onChangeLyricsOnlineEnabled={setLyricsOnlineEnabled}
                  onChangeLyricsFontSize={setLyricsFontSize}
                  onChangeLyricsShowBackgroundVocals={setLyricsShowBackgroundVocals}
                  onToggleStreamMissingTracks={(enabled) => {
                    setStreamMissingTracksLocalPref(enabled);
                    jamWebRtcClient.requestHostAudioStreamForMissingTrack(enabled);
                    ipcClient.saveJamRtcConfig({ streamMissingTracks: enabled }).catch(() => {});
                  }}
                  onSaveJamRtcConfig={async (cfg) => {
                    const saved = await ipcClient.saveJamRtcConfig(cfg);
                    setJamRtcConfig(saved);
                  }}
                />
              ) : (viewMode === 'favorites' || viewMode === 'playlist') &&
                activePlaylistObject ? (
                <PlaylistView
                  playlist={activePlaylistObject}
                  tracks={playlistTracks}
                  currentTrackId={currentTrack?.id ?? null}
                  isPlaying={isPlaying}
                  accentColor={palette.accent}
                  onPlayTrack={handlePlayTrack}
                  onTogglePlayPause={() => setIsPlaying((p) => !p)}
                  onPlayAll={handlePlayAll}
                  onPlayNext={handlePlayNext}
                  onAddToQueue={handleAddToQueue}
                  onAddAllToQueue={handleAddAllToQueue}
                  onToggleFavorite={handleToggleFavorite}
                  onRenamePlaylist={handleRenamePlaylist}
                  onDeletePlaylist={handleDeletePlaylist}
                  onRemoveTrackFromPlaylist={handleRemoveTrackFromPlaylist}
                  onReorderTracks={handleReorderPlaylistTracks}
                  onOpenContextMenu={(e, track) =>
                    setContextMenu({ track, x: e.clientX, y: e.clientY })
                  }
                  onSelectAlbum={handleSelectAlbum}
                  onSelectArtist={handleSelectArtist}
                />
              ) : viewMode === 'recent' ? (
                renderTrackList(recentTracks)
              ) : viewMode === 'years' || viewMode === 'folders' || viewMode === 'quality' ? (
                <CategoryView
                  kind={viewMode}
                  tracks={tracks}
                  accentColor={palette.accent}
                  gridMode={gridMode}
                  sortDir={
                    viewMode === 'years'
                      ? yearsSortDir
                      : viewMode === 'folders'
                      ? foldersSortDir
                      : qualitySortDir
                  }
                  selectedKey={categoryKey}
                  onSelectKey={setCategoryKey}
                  onPlayTracks={handlePlayAll}
                  renderTrackList={renderTrackList}
                />
              ) : viewMode === 'songs' ? (
                <VirtualizedTrackList
                  tracks={displayTracks}
                  currentTrackId={currentTrack?.id ?? null}
                  isPlaying={isPlaying}
                  accentColor={palette.accent}
                  onPlayTrack={handlePlayTrack}
                  onTogglePlayPause={() => setIsPlaying((p) => !p)}
                  onPlayNext={handlePlayNext}
                  onAddToQueue={handleAddToQueue}
                  onToggleFavorite={handleToggleFavorite}
                  onOpenContextMenu={(e, track) =>
                    setContextMenu({ track, x: e.clientX, y: e.clientY })
                  }
                  onSelectAlbum={handleSelectAlbum}
                  onSelectArtist={handleSelectArtist}
                  onAddFolder={() => setIsAddFolderOpen(true)}
                  isSearchFiltered={Boolean(debouncedSearch)}
                />
              ) : viewMode === 'albums' ? (
                <VirtualizedGrid
                  mode="albums"
                  items={displayAlbums}
                  gridMode={gridMode}
                  accentColor={palette.accent}
                  onSelectAlbum={handleSelectAlbum}
                  onPlayAlbum={handlePlayAlbum}
                  onAddFolder={() => setIsAddFolderOpen(true)}
                  isSearchFiltered={Boolean(debouncedSearch)}
                />
              ) : (
                <VirtualizedGrid
                  mode="artists"
                  items={displayArtists}
                  gridMode={gridMode}
                  accentColor={palette.accent}
                  onSelectArtist={handleSelectArtist}
                  onPlayArtist={handlePlayArtist}
                  onAddFolder={() => setIsAddFolderOpen(true)}
                  isSearchFiltered={Boolean(debouncedSearch)}
                />
              )}
            </div>
          </main>

          {/* Toggleable Floating Right-Hand Queue Sidebar */}
          <QueueSidebar
            isOpen={isQueueOpen && !isJamOpen && !isHistoryOpen}
            onClose={() => setIsQueueOpen(false)}
            currentTrack={currentTrack}
            isPlaying={isPlaying}
            accentColor={palette.accent}
            playNextQueue={playNextQueue}
            standardQueue={standardQueue}
            onTogglePlayPause={() => setIsPlaying((p) => !p)}
            onPlayFromPlayNext={(idx) => {
              const chosen = playNextQueue[idx];
              if (!chosen) return;
              if (currentTrack) {
                setHistoryStack((prev) => [...prev.slice(-40), currentTrack]);
              }
              setCurrentTrack(chosen);
              setPlayNextQueue((prev) => prev.filter((_, i) => i !== idx));
              setIsPlaying(true);
            }}
            onPlayFromStandardQueue={(idx) => {
              const chosen = standardQueue[idx];
              if (!chosen) return;
              if (currentTrack) {
                setHistoryStack((prev) => [...prev.slice(-40), currentTrack]);
              }
              setCurrentTrack(chosen);
              setStandardQueue((prev) => prev.slice(idx + 1));
              setIsPlaying(true);
            }}
            onRemoveFromPlayNext={(idx) =>
              setPlayNextQueue((prev) => prev.filter((_, i) => i !== idx))
            }
            onRemoveFromStandardQueue={(idx) =>
              setStandardQueue((prev) => prev.filter((_, i) => i !== idx))
            }
            onClearQueue={() => {
              setPlayNextQueue([]);
              setStandardQueue([]);
              setOriginalQueueOrder([]);
            }}
          />

          {/* Listening History Sidebar */}
          <HistorySidebar
            isOpen={isHistoryOpen && !isJamOpen}
            onClose={() => setIsHistoryOpen(false)}
            accentColor={palette.accent}
            currentTrackId={currentTrack?.id ?? null}
            onPlayTrack={(track) => {
              if (currentTrack) {
                setHistoryStack((prev) => [...prev.slice(-40), currentTrack]);
              }
              setCurrentTrack(track);
              setIsPlaying(true);
            }}
          />

          {/* Toggleable Floating Right-Hand Jam Shared Listening Panel */}
          <JamSidebar
            isOpen={isJamOpen}
            onClose={() => setIsJamOpen(false)}
            peerId={jamWebRtcClient.getPeerId()}
            room={jamRoom}
            rtcConfig={jamRtcConfig}
            localTracks={tracks}
            currentTrack={currentTrack}
            isPlaying={isPlaying}
            accentColor={palette.accent}
            hasLocalCopyOfCurrentJamTrack={hasLocalCopyOfCurrentJamTrack}
            isReceivingHostAudioStream={isReceivingHostAudioStream}
            streamMissingTracksLocalPref={streamMissingTracksLocalPref}
            clockOffsetMs={jamClockOffsetMs}
            rttMs={jamRttMs}
            driftMs={jamDriftMs}
            playbackRate={jamPlaybackRate}
            joinError={jamJoinError}
            requirePinPrompt={jamRequirePinPrompt}
            initialJoinCode={initialJamJoinCode}
            onClearJoinError={() => {
              setJamJoinError(null);
              setJamRequirePinPrompt(false);
            }}
            onStartJam={handleStartJam}
            onJoinJam={handleJoinJam}
            onLeaveJam={() => jamWebRtcClient.leaveJam()}
            onUpdateRoomSettings={(settings) => jamWebRtcClient.updateRoomSettings(settings)}
            onKickParticipant={(targetPeerId) => jamWebRtcClient.kickParticipant(targetPeerId)}
            onResyncClock={() => {
              jamWebRtcClient.runNtpClockSync(7).catch(() => {});
            }}
            onToggleStreamMissingTracks={(enabled) => {
              setStreamMissingTracksLocalPref(enabled);
              jamWebRtcClient.requestHostAudioStreamForMissingTrack(enabled);
              ipcClient.saveJamRtcConfig({ streamMissingTracks: enabled }).catch(() => {});
            }}
            onSaveRtcConfig={async (cfg) => {
              const saved = await ipcClient.saveJamRtcConfig(cfg);
              setJamRtcConfig(saved);
            }}
            onComputeFingerprints={() => ipcClient.computeLibraryFingerprints()}
            onAddTrackToJamQueue={handleAddTrackToJamQueue}
            onRemoveFromJamQueue={handleRemoveFromJamQueue}
            onPlayJamQueueItem={handlePlayJamQueueItem}
          />
        </div>
      )}

      {/* Floating Bottom Liquid Glass Transport & Audio Player Bar */}
      <PlayerBar
        onShowAudioInfo={setAudioInfoTrack}
        currentTrack={currentTrack}
        nextQueuedTrack={nextQueuedTrack}
        isPlaying={isPlaying}
        shuffle={shuffle}
        repeatMode={repeatMode}
        volume={volume}
        muted={muted}
        equalizer={equalizer}
        outputDeviceId={outputDeviceId}
        normalizeVolume={normalizeVolume}
        crossfadeSeconds={crossfadeSeconds}
        gaplessPlayback={gaplessPlayback}
        accentColor={palette.accent}
        queueCount={playNextQueue.length + standardQueue.length}
        isQueueOpen={isQueueOpen && !isJamOpen && !isHistoryOpen}
        isHistoryOpen={isHistoryOpen && !isJamOpen}
        isJamOpen={isJamOpen}
        jamRoom={jamRoom}
        jamPlaybackRate={jamPlaybackRate}
        jamMutedForMissingTrack={isJamGuest && !hasLocalCopyOfCurrentJamTrack}
        isReceivingHostAudioStream={isReceivingHostAudioStream}
        isLyricsOpen={isLyricsOpen}
        isMiniPlayer={isMiniPlayer}
        currentTime={currentTime}
        duration={duration}
        isPreparingTrack={isPreparingTrack}
        onPreparingChange={setIsPreparingTrack}
        onTrackUnplayable={handleTrackUnplayable}
        onTrackMetadataEnriched={handleTrackUpdated}
        onTimeChange={setCurrentTime}
        onDurationChange={setDuration}
        onSeekRequestRef={seekRequestRef}
        audioElementRef={audioElementRef}
        onTogglePlayPause={() => setIsPlaying((p) => !p)}
        onSetIsPlaying={setIsPlaying}
        onNextTrack={handleNextTrack}
        onPreviousTrack={handlePreviousTrack}
        onToggleShuffle={handleToggleShuffle}
        onCycleRepeatMode={handleCycleRepeatMode}
        onChangeVolume={(val) => {
          setVolume(val);
          if (val > 0 && muted) setMuted(false);
        }}
        onToggleMute={() => setMuted((m) => !m)}
        onToggleFavorite={handleToggleFavorite}
        onToggleQueueSidebar={() => {
          setIsJamOpen(false);
          if (isHistoryOpen) {
            setIsHistoryOpen(false);
            setIsQueueOpen(true);
          } else {
            setIsQueueOpen((o) => !o);
          }
        }}
        sleepTimerLabel={sleepTimerLabel}
        onChooseSleepTimer={handleChooseSleepTimer}
        onToggleHistorySidebar={() => {
          setIsJamOpen(false);
          setIsHistoryOpen((o) => !o);
        }}
        onToggleJamSidebar={() => {
          setIsJamOpen((o) => !o);
        }}
        onToggleLyrics={() => setIsLyricsOpen((o) => !o)}
        onOpenNowPlayingSheet={() => setIsNowPlayingSheetOpen(true)}
        onOpenSettings={handleOpenSettingsPage}
        onSelectAlbum={handleSelectAlbum}
        onSelectArtist={handleSelectArtist}
      />

      {/* Full-Screen Spring Animated Now Playing Sheet */}
      <NowPlayingSheet
        isOpen={isNowPlayingSheetOpen}
        onClose={() => setIsNowPlayingSheetOpen(false)}
        currentTrack={currentTrack}
        isPlaying={isPlaying}
        isPreparingTrack={isPreparingTrack}
        normalizeVolume={normalizeVolume}
        currentTime={currentTime}
        duration={duration}
        shuffle={shuffle}
        repeatMode={repeatMode}
        volume={volume}
        muted={muted}
        palette={palette}
        playNextQueue={playNextQueue}
        standardQueue={standardQueue}
        onTogglePlayPause={() => setIsPlaying((p) => !p)}
        onNextTrack={() => handleNextTrack(false)}
        onPreviousTrack={handlePreviousTrack}
        onSeek={(newTime) => seekRequestRef.current?.(newTime)}
        onToggleShuffle={handleToggleShuffle}
        onCycleRepeatMode={handleCycleRepeatMode}
        onChangeVolume={(val) => {
          setVolume(val);
          if (val > 0 && muted) setMuted(false);
        }}
        onToggleMute={() => setMuted((m) => !m)}
        onToggleFavorite={handleToggleFavorite}
        onOpenSettings={() => {
          setIsNowPlayingSheetOpen(false);
          handleOpenSettingsPage();
        }}
        onPlayFromQueue={(track) => handlePlayTrack(track, [...playNextQueue, ...standardQueue])}
        audioElementRef={audioElementRef}
        canvasEnabled={canvasEnabled}
        onTrackUpdated={handleTrackUpdated}
      />

      {/* Right-Click / Button Context Menu ("Add to Playlist") */}
      {audioInfoTrack && (
        <AudioInfoModal
          track={audioInfoTrack}
          accentColor={palette.accent}
          onClose={() => setAudioInfoTrack(null)}
        />
      )}

      {contextMenu && (
        <TrackContextMenu
          track={contextMenu.track}
          x={contextMenu.x}
          y={contextMenu.y}
          playlists={playlists}
          currentPlaylistId={
            (viewMode === 'playlist' || viewMode === 'favorites') && activePlaylistObject
              ? activePlaylistObject.id
              : null
          }
          onClose={() => setContextMenu(null)}
          onShowAudioInfo={setAudioInfoTrack}
          onPlayNow={(t) => handlePlayTrack(t, tracks)}
          onPlayNext={handlePlayNext}
          onAddToQueue={handleAddToQueue}
          onAddTrackToJamQueue={
            jamRoom && (isJamHost || jamRoom.allowGuestQueue)
              ? handleAddTrackToJamQueue
              : undefined
          }
          onToggleFavorite={handleToggleFavorite}
          onAddTrackToPlaylist={handleAddTrackToPlaylist}
          onCreatePlaylistWithTrack={handleCreatePlaylistWithTrack}
          onRemoveFromCurrentPlaylist={
            activePlaylistObject
              ? (t) => {
                  if (t.playlistEntryId) {
                    handleRemoveTrackFromPlaylist(activePlaylistObject.id, t.playlistEntryId);
                  }
                }
              : undefined
          }
          onSelectAlbum={handleSelectAlbum}
          onSelectArtist={handleSelectArtist}
        />
      )}

      {/* 10-Band Equalizer, Output Device, FFmpeg Transcode & Spotify Canvas Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        equalizer={equalizer}
        outputDeviceId={outputDeviceId}
        canvasEnabled={canvasEnabled}
        normalizeVolume={normalizeVolume}
        crossfadeSeconds={crossfadeSeconds}
        gaplessPlayback={gaplessPlayback}
        accentColor={palette.accent}
        onChangeEqualizer={setEqualizer}
        onChangeOutputDevice={setOutputDeviceId}
        onChangeCanvasEnabled={setCanvasEnabled}
        onChangeNormalizeVolume={setNormalizeVolume}
        onChangeCrossfadeSeconds={setCrossfadeSeconds}
        onChangeGaplessPlayback={setGaplessPlayback}
      />

      {/* Add Music Folder Modal */}
      <AddFolderModal
        isOpen={isAddFolderOpen}
        onClose={() => setIsAddFolderOpen(false)}
        existingFolders={folders}
        availableServerFolders={availableServerFolders}
        onFolderAdded={() => loadLibraryData(debouncedSearch)}
      />

      {/* First-Launch Welcome Overlay */}
      <WelcomeModal
        isOpen={isWelcomeOpen}
        accentColor={palette.accent}
        onChooseMusicFolder={handleChooseFolderFromWelcome}
        onSkip={handleDismissWelcome}
      />

      {/* Unplayable Track / Decode Error Toast Notification */}
      {toastAlert && (
        <div className="fixed bottom-28 right-6 z-50 max-w-md rounded-2xl liquid-glass-elevated border border-rose-400/35 px-4 py-3 shadow-2xl flex items-start gap-3">
          <AlertTriangle size={16} className="text-rose-400 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold text-white truncate">
              {toastAlert.title}
            </div>
            <div className="text-[11px] text-white/65 mt-0.5 line-clamp-2">
              {toastAlert.detail}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setToastAlert(null)}
            className="p-1 rounded-lg text-white/50 hover:text-white cursor-pointer"
          >
            <X size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
