import React, { useEffect, useState } from 'react';
import {
  Folder,
  FolderPlus,
  RefreshCw,
  Trash2,
  HardDrive,
  Palette,
  Speaker,
  Sliders,
  Gauge,
  Shuffle,
  RotateCcw,
  Check,
  Mic2,
  Film,
  Radio,
  ShieldAlert,
  AlertTriangle,
  Download,
  Sparkles,
} from 'lucide-react';
import type {
  AccentMode,
  AllCacheStats,
  AppUpdateStatus,
  EffectsMode,
  EqualizerSettings,
  FfmpegStatus,
  JamRtcConfig,
  LibraryStats,
  DesktopSettings,
  MusicFolder,
  ThemeMode,
} from '../shared/ipcTypes.ts';
import { EQ_FREQUENCY_LABELS, EQ_PRESETS } from '../utils/audioEqualizer.ts';
import { ipcClient } from '../services/ipcClient.ts';
import { formatFileSize } from '../utils/formatters.ts';
import { FontPicker } from './FontPicker.tsx';
import { WindowSizeCard } from './WindowSizeCard.tsx';

interface SettingsPageProps {
  folders: MusicFolder[];
  stats: LibraryStats;
  isScanning: boolean;
  scanProgress: { processed: number; total: number; message: string } | null;
  equalizer: EqualizerSettings;
  outputDeviceId: string;
  canvasEnabled: boolean;
  normalizeVolume: boolean;
  crossfadeSeconds: number;
  gaplessPlayback: boolean;
  themeMode: ThemeMode;
  accentMode: AccentMode;
  customAccentHex: string;
  fontScale: number;
  boldText: boolean;
  onChangeFontScale: (scale: number) => void;
  onChangeBoldText: (bold: boolean) => void;
  fontFamily: string;
  onChangeFontFamily: (family: string) => void;
  effectsMode: EffectsMode;
  onChangeEffectsMode: (mode: EffectsMode) => void;
  effectiveAccentColor: string;
  lyricsOnlineEnabled: boolean;
  lyricsFontSize: 'compact' | 'standard' | 'large';
  lyricsShowBackgroundVocals: boolean;
  jamRtcConfig: JamRtcConfig | null;
  streamMissingTracksLocalPref: boolean;
  isOnline: boolean;
  onOpenAddFolderModal: () => void;
  onRemoveFolder: (folderId: number) => Promise<void>;
  onRescanFolders: () => Promise<void>;
  onResetUnplayableTracks: () => Promise<void>;
  onShowWelcomeScreen: () => void;
  onChangeEqualizer: (next: EqualizerSettings) => void;
  onChangeOutputDevice: (deviceId: string) => void;
  onChangeCanvasEnabled: (enabled: boolean) => void;
  onChangeNormalizeVolume: (enabled: boolean) => void;
  onChangeCrossfadeSeconds: (seconds: number) => void;
  onChangeGaplessPlayback: (enabled: boolean) => void;
  onChangeThemeMode: (mode: ThemeMode) => void;
  onChangeAccentMode: (mode: AccentMode) => void;
  onChangeCustomAccentHex: (hex: string) => void;
  onChangeLyricsOnlineEnabled: (enabled: boolean) => void;
  onChangeLyricsFontSize: (size: 'compact' | 'standard' | 'large') => void;
  onChangeLyricsShowBackgroundVocals: (show: boolean) => void;
  onToggleStreamMissingTracks: (enabled: boolean) => void;
  onSaveJamRtcConfig: (config: Partial<JamRtcConfig>) => Promise<void>;
}

interface AudioDeviceOption {
  deviceId: string;
  label: string;
}

type SettingsSectionId =
  | 'all'
  | 'folders'
  | 'appearance'
  | 'audio'
  | 'lyrics-canvas'
  | 'jam'
  | 'storage';

const CROSSFADE_OPTIONS = [0, 2, 4, 6, 8, 12];

const ACCENT_SWATCHES = [
  { name: 'Indigo', hex: '#818CF8' },
  { name: 'Sky Cyan', hex: '#38BDF8' },
  { name: 'Emerald', hex: '#34D399' },
  { name: 'Rose', hex: '#FB7185' },
  { name: 'Amber', hex: '#FBBF24' },
  { name: 'Violet', hex: '#C084FC' },
];

const THEME_OPTIONS: Array<{
  id: ThemeMode;
  name: string;
  description: string;
  previewBg: string;
}> = [
  {
    id: 'liquid-dark',
    name: 'Liquid Dark',
    description: 'Deep obsidian glass with dynamic album art refraction',
    previewBg: '#06070C',
  },
  {
    id: 'midnight-oled',
    name: 'Midnight OLED',
    description: 'Pure pitch-black canvas for zero-halo OLED displays',
    previewBg: '#000000',
  },
  {
    id: 'frosted-slate',
    name: 'Frosted Slate',
    description: 'Cool studio slate glass with soft atmospheric contrast',
    previewBg: '#0F172A',
  },
  {
    id: 'crystal-light',
    name: 'Crystal Daylight',
    description: 'Bright translucent frosted acrylic with crisp dark typography',
    previewBg: '#EEF2F6',
  },
];

export const SettingsPage: React.FC<SettingsPageProps> = ({
  folders,
  stats,
  isScanning,
  scanProgress,
  equalizer,
  outputDeviceId,
  canvasEnabled,
  normalizeVolume,
  crossfadeSeconds,
  gaplessPlayback,
  themeMode,
  accentMode,
  customAccentHex,
  fontScale,
  boldText,
  onChangeFontScale,
  onChangeBoldText,
  fontFamily,
  onChangeFontFamily,
  effectsMode,
  onChangeEffectsMode,
  effectiveAccentColor,
  lyricsOnlineEnabled,
  lyricsFontSize,
  lyricsShowBackgroundVocals,
  jamRtcConfig,
  streamMissingTracksLocalPref,
  isOnline,
  onOpenAddFolderModal,
  onRemoveFolder,
  onRescanFolders,
  onResetUnplayableTracks,
  onShowWelcomeScreen,
  onChangeEqualizer,
  onChangeOutputDevice,
  onChangeCanvasEnabled,
  onChangeNormalizeVolume,
  onChangeCrossfadeSeconds,
  onChangeGaplessPlayback,
  onChangeThemeMode,
  onChangeAccentMode,
  onChangeCustomAccentHex,
  onChangeLyricsOnlineEnabled,
  onChangeLyricsFontSize,
  onChangeLyricsShowBackgroundVocals,
  onToggleStreamMissingTracks,
  onSaveJamRtcConfig,
}) => {
  const [activeTab, setActiveTab] = useState<SettingsSectionId>('all');
  const [devices, setDevices] = useState<AudioDeviceOption[]>([
    { deviceId: 'default', label: 'System Default Audio Output (WASAPI Shared)' },
    { deviceId: 'communications', label: 'Windows Communications Output' },
  ]);

  const [allCaches, setAllCaches] = useState<AllCacheStats | null>(null);
  const [ffmpegStatus, setFfmpegStatus] = useState<FfmpegStatus | null>(null);
  const [ClearingKey, setClearingKey] = useState<string | null>(null);

  // Jam STUN/TURN form state
  const [stunInput, setStunInput] = useState(
    jamRtcConfig?.stunUrls?.join(', ') ||
      'stun:stun.l.google.com:19302, stun:stun1.l.google.com:19302'
  );
  const [turnUrl, setTurnUrl] = useState(jamRtcConfig?.turnUrl || '');
  const [turnUsername, setTurnUsername] = useState(jamRtcConfig?.turnUsername || '');
  const [turnCredential, setTurnCredential] = useState(jamRtcConfig?.turnCredential || '');
  const [jamSavedNotice, setJamSavedNotice] = useState<string | null>(null);
  const [fingerprintStatus, setFingerprintStatus] = useState<string | null>(null);
  const [isComputingFingerprints, setIsComputingFingerprints] = useState(false);

  // Auto-update state
  const [updateStatus, setUpdateStatus] = useState<AppUpdateStatus | null>(null);
  const [desktopSettings, setDesktopSettings] = useState<DesktopSettings | null>(null);

  useEffect(() => {
    let alive = true;
    ipcClient
      .getDesktopSettings()
      .then((value) => {
        if (alive) setDesktopSettings(value);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);

  const refreshCachesAndServices = async () => {
    try {
      const [caches, ff, upd] = await Promise.all([
        ipcClient.getAllCacheStats(),
        ipcClient.getFfmpegStatus(),
        ipcClient.getUpdateStatus(),
      ]);
      setAllCaches(caches);
      setFfmpegStatus(ff);
      setUpdateStatus(upd);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    refreshCachesAndServices();

    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
      navigator.mediaDevices
        .enumerateDevices()
        .then((list) => {
          const outputs = list
            .filter((d) => d.kind === 'audiooutput')
            .map((d, idx) => ({
              deviceId: d.deviceId || `device-${idx}`,
              label:
                d.label ||
                (d.deviceId === 'default'
                  ? 'System Default Audio Output'
                  : `Audio Output Device #${idx + 1}`),
            }));
          if (outputs.length > 0) {
            setDevices(outputs);
          }
        })
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (jamRtcConfig) {
      setStunInput(jamRtcConfig.stunUrls.join(', '));
      setTurnUrl(jamRtcConfig.turnUrl || '');
      setTurnUsername(jamRtcConfig.turnUsername || '');
      setTurnCredential(jamRtcConfig.turnCredential || '');
    }
  }, [jamRtcConfig]);

  const handlePresetChange = (presetName: string) => {
    const presetBands = EQ_PRESETS[presetName];
    if (presetBands) {
      onChangeEqualizer({
        ...equalizer,
        preset: presetName,
        bands: [...presetBands],
      });
    }
  };

  const handleBandChange = (index: number, gainValue: number) => {
    const nextBands = [...equalizer.bands];
    nextBands[index] = gainValue;
    onChangeEqualizer({
      ...equalizer,
      preset: 'Custom',
      bands: nextBands,
    });
  };

  const handleResetEqualizer = () => {
    onChangeEqualizer({
      enabled: true,
      preset: 'Flat',
      preamp: 0,
      bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    });
  };

  const handleClearSpecificCache = async (
    target: 'cover' | 'lyrics' | 'canvas' | 'transcode' | 'all'
  ) => {
    setClearingKey(target);
    try {
      if (target === 'cover' || target === 'all') {
        await ipcClient.clearCoverCache();
      }
      if (target === 'lyrics' || target === 'all') {
        await ipcClient.clearLyricsCache();
      }
      if (target === 'canvas' || target === 'all') {
        await ipcClient.clearCanvasCache();
      }
      if (target === 'transcode' || target === 'all') {
        await ipcClient.clearTranscodeCache();
      }
      await refreshCachesAndServices();
    } finally {
      setClearingKey(null);
    }
  };

  const handleSaveJamNetworkSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    const stunUrls = stunInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    await onSaveJamRtcConfig({
      stunUrls: stunUrls.length > 0 ? stunUrls : ['stun:stun.l.google.com:19302'],
      turnUrl: turnUrl.trim(),
      turnUsername: turnUsername.trim(),
      turnCredential: turnCredential.trim(),
      streamMissingTracks: streamMissingTracksLocalPref,
    });
    setJamSavedNotice('Saved Jam STUN/TURN network settings');
    setTimeout(() => setJamSavedNotice(null), 2600);
  };

  const totalCacheBytes =
    (allCaches?.coverCache.totalBytes || 0) +
    (allCaches?.lyricsCache.totalBytes || 0) +
    (allCaches?.canvasCache.totalBytes || 0) +
    (allCaches?.transcodeCache.totalBytes || 0);

  // Build SVG polyline points for the 10-band EQ curve visualization
  const svgWidth = 540;
  const svgHeight = 90;
  const points = equalizer.bands
    .map((gain, i) => {
      const x = (i / 9) * (svgWidth - 40) + 20;
      const y = svgHeight / 2 - (gain / 12) * (svgHeight / 2 - 12);
      return `${x},${y}`;
    })
    .join(' ');

  const showSection = (id: SettingsSectionId) => activeTab === 'all' || activeTab === id;

  return (
    <div className="flex-1 h-full overflow-y-auto px-6 py-5 space-y-6">
      {/* Category Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-white/10">
        <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-black/30 border border-white/10">
          {(
            [
              { id: 'all', label: 'All Settings' },
              { id: 'folders', label: 'Music Folders & Library' },
              { id: 'storage', label: 'Caches & Storage' },
              { id: 'appearance', label: 'Theme & Accent' },
              { id: 'audio', label: 'Audio, EQ & Normalization' },
              { id: 'lyrics-canvas', label: 'Lyrics & Canvas' },
              { id: 'jam', label: 'Jam & Updates' },
            ] as Array<{ id: SettingsSectionId; label: string }>
          ).map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                style={
                  active
                    ? { backgroundColor: effectiveAccentColor, color: '#090A0F' }
                    : undefined
                }
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'shadow-sm'
                    : 'text-white/70 hover:text-white hover:bg-white/[0.06]'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 text-xs font-mono tabular-nums text-white/55">
          <span>{stats.totalTracks.toLocaleString()} songs</span>
          <span aria-hidden="true">·</span>
          <span>{formatFileSize(totalCacheBytes)} cached</span>
        </div>
      </div>

      {/* =====================================================================
          SECTION 1: MUSIC FOLDERS, ERROR DIAGNOSTICS & 20,000-SONG BENCHMARK
         ===================================================================== */}
      {showSection('folders') && (
        <section className="rounded-2xl bg-black/25 border border-white/10 p-5 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <Folder size={17} style={{ color: effectiveAccentColor }} />
              <div>
                <h2 className="text-sm font-bold text-white">
                  Music Folders & Background Library Scanner
                </h2>
                <p className="text-xs text-white/60">
                  Manage folders watched for new, updated, or removed songs in real time.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onRescanFolders}
                disabled={isScanning}
                className="liquid-glass-btn inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-white/85 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
              >
                <RefreshCw size={13} className={isScanning ? 'animate-spin' : ''} />
                <span>{isScanning ? 'Scanning in Background...' : 'Rescan Folders'}</span>
              </button>
              <button
                type="button"
                onClick={onOpenAddFolderModal}
                style={{ backgroundColor: effectiveAccentColor }}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold text-slate-950 hover:opacity-95 transition-opacity cursor-pointer whitespace-nowrap shrink-0"
              >
                <FolderPlus size={14} />
                <span>Add Music Folder</span>
              </button>
            </div>
          </div>

          {/* Live Background Scan Progress Bar */}
          {(isScanning || scanProgress) && (
            <div className="p-3.5 rounded-xl bg-white/[0.04] border border-white/15 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-white">
                  {scanProgress?.message || 'Scanning music library in the background...'}
                </span>
                {scanProgress && scanProgress.total > 0 && (
                  <span className="font-mono tabular-nums text-white/75">
                    {Math.round((scanProgress.processed / scanProgress.total) * 100)}%
                  </span>
                )}
              </div>
              <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full transition-all duration-200"
                  style={{
                    backgroundColor: effectiveAccentColor,
                    width:
                      scanProgress && scanProgress.total > 0
                        ? `${Math.min(100, (scanProgress.processed / scanProgress.total) * 100)}%`
                        : '35%',
                  }}
                />
              </div>
            </div>
          )}

          {/* Watched Folders List (with Missing Folder non-technical alert handling) */}
          <div className="space-y-2">
            {folders.length === 0 ? (
              <div className="p-6 rounded-xl bg-black/20 border border-white/10 text-center space-y-2">
                <p className="text-xs font-semibold text-white">No music folders added yet</p>
                <p className="text-xs text-white/55 max-w-md mx-auto">
                  Add a folder from your computer so Aestheticy can organize your songs, albums, and
                  artists.
                </p>
              </div>
            ) : (
              folders.map((folder) => {
                const isMissing = folder.exists === false;
                return (
                  <div
                    key={folder.id}
                    className={`flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl border ${
                      isMissing
                        ? 'bg-amber-500/10 border-amber-400/35'
                        : 'bg-black/30 border-white/10'
                    }`}
                  >
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      {isMissing ? (
                        <AlertTriangle size={16} className="text-amber-300 shrink-0 mt-0.5" />
                      ) : (
                        <Folder
                          size={16}
                          style={{ color: effectiveAccentColor }}
                          className="shrink-0 mt-0.5"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-white truncate">
                            {folder.name}
                          </span>
                          <span className="text-[11px] font-mono tabular-nums text-white/55">
                            · {folder.trackCount.toLocaleString()} songs
                          </span>
                          <span className="text-[11px] text-white/55">
                            · {isMissing ? 'Folder missing' : 'Watching for changes'}
                          </span>
                        </div>
                        <div className="text-[11px] font-mono text-white/45 truncate mt-0.5">
                          {folder.path}
                        </div>
                        {isMissing && (
                          <p className="text-xs text-amber-200 mt-1.5">
                            {folder.errorMessage ||
                              "We couldn't find this folder on your computer. It may have been moved, renamed, or is on an unplugged drive."}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {isMissing && (
                        <button
                          type="button"
                          onClick={onRescanFolders}
                          className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-medium text-white cursor-pointer whitespace-nowrap shrink-0"
                        >
                          Check Again
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onRemoveFolder(folder.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-rose-500/20 text-xs font-medium text-white/70 hover:text-rose-300 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                      >
                        <Trash2 size={12} />
                        <span>Remove</span>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Corrupted / Damaged Files Recovery & First-Launch Welcome Screen */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 pt-2">
            {/* Corrupted Files Diagnostic */}
            <div className="p-4 rounded-xl bg-black/30 border border-white/10 flex items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs font-semibold text-white">
                  <ShieldAlert size={14} style={{ color: effectiveAccentColor }} />
                  <span>Damaged or Unplayable Song Files</span>
                </div>
                <p className="text-xs text-white/60 leading-relaxed">
                  {stats.unplayableTracksCount && stats.unplayableTracksCount > 0
                    ? `${stats.unplayableTracksCount} song${
                        stats.unplayableTracksCount === 1 ? ' was' : 's were'
                      } skipped because the file appeared damaged or incomplete.`
                    : 'All indexed songs in your library are healthy and ready to play.'}
                </p>
              </div>
              {Boolean(stats.unplayableTracksCount && stats.unplayableTracksCount > 0) && (
                <button
                  type="button"
                  onClick={onResetUnplayableTracks}
                  className="liquid-glass-btn px-3 py-1.5 rounded-xl text-xs font-medium text-white hover:text-emerald-300 cursor-pointer whitespace-nowrap shrink-0"
                >
                  Retry Files
                </button>
              )}
            </div>

            {/* Welcome Screen Re-Trigger */}
            <div className="p-4 rounded-xl bg-black/30 border border-white/10 flex items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs font-semibold text-white">
                  <Sparkles size={14} style={{ color: effectiveAccentColor }} />
                  <span>First-Launch Welcome Screen</span>
                </div>
                <p className="text-xs text-white/60 leading-relaxed">
                  Re-open the welcome tour to preview Aestheticy&apos;s onboarding overlay.
                </p>
              </div>
              <button
                type="button"
                onClick={onShowWelcomeScreen}
                className="liquid-glass-btn px-3.5 py-1.5 rounded-xl text-xs font-semibold text-white/90 hover:text-white transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                Show welcome screen again
              </button>
            </div>
          </div>
        </section>
      )}

      {/* =====================================================================
          SECTION 2: CACHE SIZES & STORAGE MANAGEMENT
         ===================================================================== */}
      {showSection('storage') && (
        <section className="rounded-2xl bg-black/25 border border-white/10 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <HardDrive size={17} style={{ color: effectiveAccentColor }} />
              <div>
                <h2 className="text-sm font-bold text-white">Cache Sizes & Storage Management</h2>
                <p className="text-xs text-white/60">
                  Local disk caches keep cover art, transcoded lossless audio, synced lyrics, and
                  Canvas videos fast and available offline.
                </p>
              </div>
            </div>

            <button
              type="button"
              disabled={ClearingKey !== null}
              onClick={() => handleClearSpecificCache('all')}
              className="liquid-glass-btn inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-medium text-white/85 hover:text-rose-300 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Trash2 size={13} />
              <span>{ClearingKey === 'all' ? 'Clearing All...' : 'Clear All Caches'}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* 1. FFmpeg Lossless Transcode Cache */}
            <div className="p-4 rounded-xl bg-black/30 border border-white/10 flex items-center justify-between gap-3">
              <div className="space-y-1 min-w-0">
                <div className="text-xs font-semibold text-white">
                  FFmpeg Lossless Audio Cache (2.00 GB LRU Cap)
                </div>
                <div className="text-xs font-mono tabular-nums text-white/60">
                  {allCaches?.transcodeCache.fileCount ?? 0} files ·{' '}
                  {formatFileSize(allCaches?.transcodeCache.totalBytes ?? 0)} /{' '}
                  {formatFileSize(allCaches?.transcodeCache.maxBytes ?? 2 * 1024 * 1024 * 1024)}
                </div>
                <div className="text-[11px] text-white/45">
                  {ffmpegStatus?.available
                    ? 'FFmpeg & FFprobe ready for ALAC, AIFF, WV, APE, WMA, DSF, DFF'
                    : 'FFmpeg standby'}
                </div>
              </div>
              <button
                type="button"
                disabled={ClearingKey !== null}
                onClick={() => handleClearSpecificCache('transcode')}
                className="liquid-glass-btn px-3 py-1.5 rounded-xl text-xs font-medium text-white/80 hover:text-rose-300 cursor-pointer whitespace-nowrap shrink-0"
              >
                {ClearingKey === 'transcode' ? 'Clearing...' : 'Clear Cache'}
              </button>
            </div>

            {/* 2. Album Cover Art Cache */}
            <div className="p-4 rounded-xl bg-black/30 border border-white/10 flex items-center justify-between gap-3">
              <div className="space-y-1 min-w-0">
                <div className="text-xs font-semibold text-white">Album Cover Art Disk Cache</div>
                <div className="text-xs font-mono tabular-nums text-white/60">
                  {allCaches?.coverCache.fileCount ?? 0} artworks ·{' '}
                  {formatFileSize(allCaches?.coverCache.totalBytes ?? 0)}
                </div>
                <div className="text-[11px] text-white/45">
                  Extracted ID3/Vorbis & FFmpeg embedded album artwork
                </div>
              </div>
              <button
                type="button"
                disabled={ClearingKey !== null}
                onClick={() => handleClearSpecificCache('cover')}
                className="liquid-glass-btn px-3 py-1.5 rounded-xl text-xs font-medium text-white/80 hover:text-rose-300 cursor-pointer whitespace-nowrap shrink-0"
              >
                {ClearingKey === 'cover' ? 'Clearing...' : 'Clear Cache'}
              </button>
            </div>

            {/* 3. Spotify Canvas Video Cache */}
            <div className="p-4 rounded-xl bg-black/30 border border-white/10 flex items-center justify-between gap-3">
              <div className="space-y-1 min-w-0">
                <div className="text-xs font-semibold text-white">Spotify Canvas Video Cache</div>
                <div className="text-xs font-mono tabular-nums text-white/60">
                  {allCaches?.canvasCache.fileCount ?? 0} looping videos ·{' '}
                  {formatFileSize(allCaches?.canvasCache.totalBytes ?? 0)} /{' '}
                  {formatFileSize(allCaches?.canvasCache.maxBytes ?? 500 * 1024 * 1024)}
                </div>
                <div className="text-[11px] text-white/45">
                  Cached MP4 visual loops for Now Playing view
                </div>
              </div>
              <button
                type="button"
                disabled={ClearingKey !== null}
                onClick={() => handleClearSpecificCache('canvas')}
                className="liquid-glass-btn px-3 py-1.5 rounded-xl text-xs font-medium text-white/80 hover:text-rose-300 cursor-pointer whitespace-nowrap shrink-0"
              >
                {ClearingKey === 'canvas' ? 'Clearing...' : 'Clear Cache'}
              </button>
            </div>

            {/* 4. Synced Lyrics SQLite Cache */}
            <div className="p-4 rounded-xl bg-black/30 border border-white/10 flex items-center justify-between gap-3">
              <div className="space-y-1 min-w-0">
                <div className="text-xs font-semibold text-white">Synced Lyrics Cache (TTML & LRC)</div>
                <div className="text-xs font-mono tabular-nums text-white/60">
                  {allCaches?.lyricsCache.entryCount ?? 0} cached songs ·{' '}
                  {formatFileSize(allCaches?.lyricsCache.totalBytes ?? 0)}
                </div>
                <div className="text-[11px] text-white/45">
                  Stored in local SQLite for instant offline karaoke playback
                </div>
              </div>
              <button
                type="button"
                disabled={ClearingKey !== null}
                onClick={() => handleClearSpecificCache('lyrics')}
                className="liquid-glass-btn px-3 py-1.5 rounded-xl text-xs font-medium text-white/80 hover:text-rose-300 cursor-pointer whitespace-nowrap shrink-0"
              >
                {ClearingKey === 'lyrics' ? 'Clearing...' : 'Clear Cache'}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* =====================================================================
          SECTION 3: THEME & ACCENT OPTIONS
         ===================================================================== */}
      {showSection('appearance') && (
        <section className="rounded-2xl bg-black/25 border border-white/10 p-5 space-y-5">
          <div className="flex items-center gap-2.5">
            <Palette size={17} style={{ color: effectiveAccentColor }} />
            <div>
              <h2 className="text-sm font-bold text-white">Theme & Accent Options</h2>
              <p className="text-xs text-white/60">
                Customize the Liquid Glass surface theme and choose between dynamic cover art color
                extraction or a custom accent color.
              </p>
            </div>
          </div>

          {/* Theme Surface Selector */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {THEME_OPTIONS.map((t) => {
              const selected = themeMode === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onChangeThemeMode(t.id)}
                  className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-3 ${
                    selected
                      ? 'bg-white/12 border-white/40 shadow-md'
                      : 'bg-black/30 border-white/10 hover:border-white/25'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-white">{t.name}</span>
                    <span
                      className="w-4 h-4 rounded-full border border-white/25 shrink-0"
                      style={{ backgroundColor: t.previewBg }}
                    />
                  </div>
                  <p className="text-[11px] text-white/55 leading-snug">{t.description}</p>
                </button>
              );
            })}
          </div>

          {/* Accent Color Mode */}
          <div className="p-4 rounded-xl bg-black/30 border border-white/10 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-white">Accent Color Source</div>
                <div className="text-[11px] text-white/55">
                  Dynamic mode extracts the dominant palette from the currently playing album cover.
                </div>
              </div>

              <div className="flex items-center gap-1.5 p-1 rounded-xl bg-black/40 border border-white/10">
                <button
                  type="button"
                  onClick={() => onChangeAccentMode('dynamic')}
                  style={
                    accentMode === 'dynamic'
                      ? { backgroundColor: effectiveAccentColor, color: '#090A0F' }
                      : undefined
                  }
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    accentMode === 'dynamic' ? '' : 'text-white/70 hover:text-white'
                  }`}
                >
                  <Sparkles size={12} />
                  <span>Dynamic Album Art</span>
                </button>
                <button
                  type="button"
                  onClick={() => onChangeAccentMode('custom')}
                  style={
                    accentMode === 'custom'
                      ? { backgroundColor: effectiveAccentColor, color: '#090A0F' }
                      : undefined
                  }
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    accentMode === 'custom' ? '' : 'text-white/70 hover:text-white'
                  }`}
                >
                  Custom Accent
                </button>
              </div>
            </div>

            {accentMode === 'custom' && (
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-white/10">
                <div className="flex flex-wrap items-center gap-2">
                  {ACCENT_SWATCHES.map((swatch) => {
                    const isPicked =
                      customAccentHex.toLowerCase() === swatch.hex.toLowerCase();
                    return (
                      <button
                        key={swatch.hex}
                        type="button"
                        onClick={() => onChangeCustomAccentHex(swatch.hex)}
                        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-medium transition-all cursor-pointer ${
                          isPicked
                            ? 'bg-white/15 border-white/40 text-white'
                            : 'bg-black/30 border-white/10 text-white/70 hover:text-white'
                        }`}
                      >
                        <span
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ backgroundColor: swatch.hex }}
                        />
                        <span>{swatch.name}</span>
                      </button>
                    );
                  })}
                </div>

                <label className="inline-flex items-center gap-2 text-xs text-white/75 cursor-pointer">
                  <span>Custom Hex:</span>
                  <input
                    type="color"
                    value={customAccentHex}
                    onChange={(e) => onChangeCustomAccentHex(e.target.value)}
                    className="w-7 h-7 rounded cursor-pointer bg-transparent border-0"
                  />
                  <span className="font-mono text-xs text-white">{customAccentHex}</span>
                </label>
              </div>
            )}
          </div>

          {/* Visual Effects / Performance */}
          <div className="p-4 rounded-xl bg-black/30 border border-white/10 space-y-3">
            <div>
              <h3 className="text-xs font-semibold text-white">Visual Effects</h3>
              <p className="text-xs text-white/60">
                The background drifts slowly on its own, like Apple Music (it never follows the
                mouse). On an older PC, pick a lighter level.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {(
                [
                  { id: 'full', name: 'Full', desc: 'Animated background + glass blur' },
                  { id: 'balanced', name: 'Balanced', desc: 'Still background, glass blur' },
                  { id: 'lite', name: 'Lite', desc: 'No blur, smoothest on old PCs' },
                ] as const
              ).map((opt) => {
                const selected = effectsMode === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onChangeEffectsMode(opt.id)}
                    style={selected ? { borderColor: effectiveAccentColor } : undefined}
                    className={`text-left p-3 rounded-xl border transition-colors cursor-pointer ${
                      selected ? 'bg-white/10' : 'bg-black/20 border-white/10 hover:bg-white/[0.06]'
                    }`}
                  >
                    <p
                      className="text-xs font-semibold"
                      style={selected ? { color: effectiveAccentColor } : undefined}
                    >
                      {opt.name}
                    </p>
                    <p className="text-[11px] text-white/55 mt-0.5">{opt.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Text Size & Weight */}
          <div className="p-4 rounded-xl bg-black/30 border border-white/10 space-y-4">
            <div>
              <h3 className="text-xs font-semibold text-white">Text Size & Weight</h3>
              <p className="text-xs text-white/60">
                Make the whole interface larger or smaller, and switch on bold text for better
                readability.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-white/75 w-20 shrink-0">Font Scale</span>
              <input
                type="range"
                min={80}
                max={140}
                step={5}
                value={Math.round(fontScale * 100)}
                onChange={(e) => onChangeFontScale(Number(e.target.value) / 100)}
                className="flex-1 min-w-40 cursor-pointer"
                style={{ accentColor: effectiveAccentColor }}
              />
              <span className="font-mono text-xs text-white w-12 text-right tabular-nums">
                {Math.round(fontScale * 100)}%
              </span>
              <button
                type="button"
                onClick={() => onChangeFontScale(1)}
                className="liquid-glass-btn px-2.5 py-1 rounded-lg text-xs text-white/80 hover:text-white cursor-pointer"
              >
                Reset
              </button>
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-white/75">Bold Text</span>
              <button
                type="button"
                role="switch"
                aria-checked={boldText}
                onClick={() => onChangeBoldText(!boldText)}
                style={boldText ? { backgroundColor: effectiveAccentColor } : undefined}
                className={`relative w-10 h-6 rounded-full transition-colors cursor-pointer ${
                  boldText ? '' : 'bg-white/15'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                    boldText ? 'translate-x-4' : ''
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Font */}
          <FontPicker
            fontFamily={fontFamily}
            accentColor={effectiveAccentColor}
            onChangeFontFamily={onChangeFontFamily}
          />
        </section>
      )}

      {/* =====================================================================
          SECTION 4: AUDIO OUTPUT, EQUALIZER & NORMALIZATION
         ===================================================================== */}
      {showSection('audio') && (
        <section className="rounded-2xl bg-black/25 border border-white/10 p-5 space-y-5">
          <div className="flex items-center gap-2.5">
            <Sliders size={17} style={{ color: effectiveAccentColor }} />
            <div>
              <h2 className="text-sm font-bold text-white">
                Audio Output, 10-Band Equalizer & Volume Normalization
              </h2>
              <p className="text-xs text-white/60">
                Configure hardware output routing, EBU R128 loudness normalization, crossfade, and
                10-band parametric EQ.
              </p>
            </div>
          </div>

          {/* Hardware Audio Output Device */}
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-white mb-2.5">
              <Speaker size={14} style={{ color: effectiveAccentColor }} />
              <span>Hardware Audio Output Device</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {devices.map((dev) => {
                const isSelected = outputDeviceId === dev.deviceId;
                return (
                  <button
                    key={dev.deviceId}
                    type="button"
                    onClick={() => onChangeOutputDevice(dev.deviceId)}
                    className={`flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl border text-xs text-left transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-white/12 border-white/35 text-white font-semibold'
                        : 'bg-black/30 border-white/10 text-white/70 hover:text-white hover:border-white/20'
                    }`}
                  >
                    <span className="truncate">{dev.label}</span>
                    {isSelected && (
                      <Check size={14} style={{ color: effectiveAccentColor }} className="shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Normalization, Gapless & Crossfade */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-black/30 border border-white/10">
              <div>
                <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
                  <Gauge size={13} style={{ color: effectiveAccentColor }} />
                  <span>Normalize Volume</span>
                </div>
                <div className="text-[11px] text-white/55 mt-0.5">
                  Balances loud and quiet songs to a consistent level (-14 LUFS)
                </div>
              </div>
              <button
                type="button"
                onClick={() => onChangeNormalizeVolume(!normalizeVolume)}
                style={
                  normalizeVolume
                    ? { backgroundColor: effectiveAccentColor, color: '#090A0F' }
                    : undefined
                }
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors shrink-0 cursor-pointer ${
                  normalizeVolume ? '' : 'bg-white/10 text-white/65 hover:text-white'
                }`}
              >
                {normalizeVolume ? 'Enabled' : 'Off'}
              </button>
            </div>

            <div className="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-black/30 border border-white/10">
              <div>
                <div className="text-xs font-semibold text-white">Gapless Playback</div>
                <div className="text-[11px] text-white/55 mt-0.5">
                  Pre-buffers and pre-transcodes the next song in queue with zero silence
                </div>
              </div>
              <button
                type="button"
                onClick={() => onChangeGaplessPlayback(!gaplessPlayback)}
                style={
                  gaplessPlayback
                    ? { backgroundColor: effectiveAccentColor, color: '#090A0F' }
                    : undefined
                }
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors shrink-0 cursor-pointer ${
                  gaplessPlayback ? '' : 'bg-white/10 text-white/65 hover:text-white'
                }`}
              >
                {gaplessPlayback ? 'Enabled' : 'Off'}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-black/30 border border-white/10">
            <div className="flex items-center gap-2.5">
              <Shuffle size={14} style={{ color: effectiveAccentColor }} />
              <div>
                <div className="text-xs font-semibold text-white">Crossfade Songs</div>
                <div className="text-[11px] text-white/55">
                  Smoothly blend the end of the current song into the next song
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              {CROSSFADE_OPTIONS.map((sec) => {
                const active = crossfadeSeconds === sec;
                return (
                  <button
                    key={sec}
                    type="button"
                    onClick={() => onChangeCrossfadeSeconds(sec)}
                    style={
                      active
                        ? { backgroundColor: effectiveAccentColor, color: '#090A0F' }
                        : undefined
                    }
                    className={`px-2.5 py-1 rounded-lg text-xs font-mono font-medium transition-colors cursor-pointer ${
                      active
                        ? 'font-semibold'
                        : 'bg-white/5 text-white/65 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    {sec === 0 ? 'Off' : `${sec}s`}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 10-Band Equalizer */}
          <div className="pt-2 border-t border-white/10 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    onChangeEqualizer({ ...equalizer, enabled: !equalizer.enabled })
                  }
                  style={
                    equalizer.enabled
                      ? { backgroundColor: effectiveAccentColor, color: '#090A0F' }
                      : undefined
                  }
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    equalizer.enabled ? '' : 'bg-white/10 text-white/65 hover:text-white'
                  }`}
                >
                  {equalizer.enabled ? 'Equalizer On' : 'Equalizer Bypassed'}
                </button>

                <div className="flex flex-wrap items-center gap-1.5">
                  {Object.keys(EQ_PRESETS).map((presetName) => (
                    <button
                      key={presetName}
                      type="button"
                      onClick={() => handlePresetChange(presetName)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                        equalizer.preset === presetName
                          ? 'bg-white/20 text-white border border-white/30'
                          : 'bg-white/5 text-white/65 hover:text-white hover:bg-white/10'
                      }`}
                    >
                      {presetName}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={handleResetEqualizer}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs text-white/65 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                <RotateCcw size={12} />
                <span>Reset Flat</span>
              </button>
            </div>

            <div className="w-full rounded-xl bg-black/40 border border-white/10 p-3">
              <svg
                viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                className="w-full h-18 overflow-visible"
              >
                <line
                  x1="20"
                  y1={svgHeight / 2}
                  x2={svgWidth - 20}
                  y2={svgHeight / 2}
                  stroke="rgba(255,255,255,0.15)"
                  strokeDasharray="4 4"
                />
                <polyline
                  fill="none"
                  stroke={equalizer.enabled ? effectiveAccentColor : 'rgba(255,255,255,0.3)'}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={points}
                />
                {equalizer.bands.map((gain, i) => {
                  const x = (i / 9) * (svgWidth - 40) + 20;
                  const y = svgHeight / 2 - (gain / 12) * (svgHeight / 2 - 12);
                  return (
                    <circle
                      key={i}
                      cx={x}
                      cy={y}
                      r="4"
                      fill={equalizer.enabled ? effectiveAccentColor : '#6B7280'}
                    />
                  );
                })}
              </svg>
            </div>

            <div className="grid grid-cols-11 gap-2 items-center bg-black/30 border border-white/10 rounded-xl p-4">
              <div className="flex flex-col items-center pr-2 border-r border-white/10">
                <span className="text-[10px] font-mono tabular-nums text-white/70 mb-2">
                  {equalizer.preamp > 0
                    ? `+${equalizer.preamp.toFixed(1)}`
                    : equalizer.preamp.toFixed(1)}
                  dB
                </span>
                <div className="h-28 flex items-center justify-center">
                  <input
                    type="range"
                    min={-12}
                    max={12}
                    step={0.5}
                    disabled={!equalizer.enabled}
                    value={equalizer.preamp}
                    onChange={(e) =>
                      onChangeEqualizer({
                        ...equalizer,
                        preamp: parseFloat(e.target.value),
                      })
                    }
                    className="w-24 -rotate-90 accent-indigo-400 cursor-pointer"
                  />
                </div>
                <span className="text-[11px] font-medium text-white/80 mt-2">Preamp</span>
              </div>

              {EQ_FREQUENCY_LABELS.map((label, idx) => {
                const val = equalizer.bands[idx] ?? 0;
                return (
                  <div key={label} className="flex flex-col items-center">
                    <span className="text-[10px] font-mono tabular-nums text-white/70 mb-2">
                      {val > 0 ? `+${val.toFixed(1)}` : val.toFixed(1)}
                    </span>
                    <div className="h-28 flex items-center justify-center">
                      <input
                        type="range"
                        min={-12}
                        max={12}
                        step={0.5}
                        disabled={!equalizer.enabled}
                        value={val}
                        onChange={(e) => handleBandChange(idx, parseFloat(e.target.value))}
                        className="w-24 -rotate-90 accent-indigo-400 cursor-pointer"
                      />
                    </div>
                    <span className="text-[11px] font-mono text-white/65 mt-2">{label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* =====================================================================
          SECTION 5: LYRICS & SPOTIFY CANVAS SETTINGS
         ===================================================================== */}
      {showSection('lyrics-canvas') && (
        <section className="rounded-2xl bg-black/25 border border-white/10 p-5 space-y-4">
          <div className="flex items-center gap-2.5">
            <Mic2 size={17} style={{ color: effectiveAccentColor }} />
            <div>
              <h2 className="text-sm font-bold text-white">Synced Lyrics & Spotify Canvas</h2>
              <p className="text-xs text-white/60">
                Configure word-by-word karaoke lyrics, local .ttml/.lrc lookup, and looping Spotify
                Canvas background videos.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Online Synced Lyrics Fetch Toggle */}
            <div className="flex items-center justify-between gap-3 p-4 rounded-xl bg-black/30 border border-white/10">
              <div>
                <div className="text-xs font-semibold text-white">
                  Fetch Online Synced Lyrics (LRCLIB + lrc.red)
                </div>
                <div className="text-[11px] text-white/55 mt-0.5">
                  Automatically downloads word-synced TTML or LRC lyrics when no local file is next
                  to the song
                </div>
              </div>
              <button
                type="button"
                onClick={() => onChangeLyricsOnlineEnabled(!lyricsOnlineEnabled)}
                style={
                  lyricsOnlineEnabled
                    ? { backgroundColor: effectiveAccentColor, color: '#090A0F' }
                    : undefined
                }
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors shrink-0 cursor-pointer ${
                  lyricsOnlineEnabled ? '' : 'bg-white/10 text-white/65 hover:text-white'
                }`}
              >
                {lyricsOnlineEnabled ? 'Enabled' : 'Local Only'}
              </button>
            </div>

            {/* Background Vocal Harmonies Toggle */}
            <div className="flex items-center justify-between gap-3 p-4 rounded-xl bg-black/30 border border-white/10">
              <div>
                <div className="text-xs font-semibold text-white">
                  Show Background Vocals & Duet Parts
                </div>
                <div className="text-[11px] text-white/55 mt-0.5">
                  Displays secondary vocal lines and right-aligned duet singer parts in TTML lyrics
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  onChangeLyricsShowBackgroundVocals(!lyricsShowBackgroundVocals)
                }
                style={
                  lyricsShowBackgroundVocals
                    ? { backgroundColor: effectiveAccentColor, color: '#090A0F' }
                    : undefined
                }
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors shrink-0 cursor-pointer ${
                  lyricsShowBackgroundVocals ? '' : 'bg-white/10 text-white/65 hover:text-white'
                }`}
              >
                {lyricsShowBackgroundVocals ? 'Shown' : 'Hidden'}
              </button>
            </div>

            {/* Lyrics Text Scale */}
            <div className="flex items-center justify-between gap-3 p-4 rounded-xl bg-black/30 border border-white/10">
              <div>
                <div className="text-xs font-semibold text-white">Lyrics Text Size</div>
                <div className="text-[11px] text-white/55 mt-0.5">
                  Adjust karaoke typography scale in the Synced Lyrics stage
                </div>
              </div>
              <div className="flex items-center gap-1 p-1 rounded-xl bg-black/40 border border-white/10">
                {(['compact', 'standard', 'large'] as const).map((sz) => (
                  <button
                    key={sz}
                    type="button"
                    onClick={() => onChangeLyricsFontSize(sz)}
                    style={
                      lyricsFontSize === sz
                        ? { backgroundColor: effectiveAccentColor, color: '#090A0F' }
                        : undefined
                    }
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold capitalize transition-colors cursor-pointer ${
                      lyricsFontSize === sz ? '' : 'text-white/65 hover:text-white'
                    }`}
                  >
                    {sz}
                  </button>
                ))}
              </div>
            </div>

            {/* Spotify Canvas Toggle */}
            <div className="flex items-center justify-between gap-3 p-4 rounded-xl bg-black/30 border border-white/10">
              <div className="flex items-start gap-2.5">
                <Film size={15} style={{ color: effectiveAccentColor }} className="shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-semibold text-white">
                    Spotify Canvas Looping Videos
                  </div>
                  <div className="text-[11px] text-white/55 mt-0.5">
                    Plays looping visual backdrops in Now Playing; falls back to ambient album art
                    when off or offline
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onChangeCanvasEnabled(!canvasEnabled)}
                style={
                  canvasEnabled
                    ? { backgroundColor: effectiveAccentColor, color: '#090A0F' }
                    : undefined
                }
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors shrink-0 cursor-pointer ${
                  canvasEnabled ? '' : 'bg-white/10 text-white/65 hover:text-white'
                }`}
              >
                {canvasEnabled ? 'Enabled' : 'Off'}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* =====================================================================
          SECTION 6: JAM (SHARED LISTENING) & WINDOWS INSTALLER AUTO-UPDATE
         ===================================================================== */}
      {showSection('jam') && (
        <section className="rounded-2xl bg-black/25 border border-white/10 p-5 space-y-5">
          <div className="flex items-center gap-2.5">
            <Radio size={17} style={{ color: effectiveAccentColor }} />
            <div>
              <h2 className="text-sm font-bold text-white">
                Jam Shared Listening & Application Updates
              </h2>
              <p className="text-xs text-white/60">
                Configure WebRTC peer-to-peer shared listening, live audio fallback, and Windows
                application updates.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Stream Missing Tracks from Host */}
            <div className="flex items-center justify-between gap-3 p-4 rounded-xl bg-black/30 border border-white/10">
              <div>
                <div className="text-xs font-semibold text-white">
                  Stream Missing Tracks from Host
                </div>
                <div className="text-[11px] text-white/55 mt-0.5">
                  When a song in a Jam isn&apos;t in your local library, stream live audio from the
                  host over WebRTC
                </div>
              </div>
              <button
                type="button"
                onClick={() => onToggleStreamMissingTracks(!streamMissingTracksLocalPref)}
                style={
                  streamMissingTracksLocalPref
                    ? { backgroundColor: effectiveAccentColor, color: '#090A0F' }
                    : undefined
                }
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors shrink-0 cursor-pointer ${
                  streamMissingTracksLocalPref ? '' : 'bg-white/10 text-white/65 hover:text-white'
                }`}
              >
                {streamMissingTracksLocalPref ? 'Enabled' : 'Mute Missing'}
              </button>
            </div>

            {/* Background Acoustic Fingerprinting */}
            <div className="flex items-center justify-between gap-3 p-4 rounded-xl bg-black/30 border border-white/10">
              <div>
                <div className="text-xs font-semibold text-white">
                  Chromaprint Acoustic Fingerprinting
                </div>
                <div className="text-[11px] text-white/55 mt-0.5">
                  {fingerprintStatus ||
                    'Matches identical songs across FLAC, MP3, WAV, and ALAC even when tags differ'}
                </div>
              </div>
              <button
                type="button"
                disabled={isComputingFingerprints}
                onClick={async () => {
                  setIsComputingFingerprints(true);
                  try {
                    const res = await ipcClient.computeLibraryFingerprints();
                    setFingerprintStatus(
                      `Computed ${res.computed} new fingerprints (${res.total} real songs checked)`
                    );
                  } finally {
                    setIsComputingFingerprints(false);
                  }
                }}
                className="liquid-glass-btn px-3 py-1.5 rounded-xl text-xs font-medium text-white hover:opacity-90 cursor-pointer whitespace-nowrap shrink-0"
              >
                {isComputingFingerprints ? 'Computing...' : 'Index Fingerprints'}
              </button>
            </div>
          </div>

          {/* WebRTC STUN / Optional TURN Configuration */}
          <form
            onSubmit={handleSaveJamNetworkSettings}
            className="p-4 rounded-xl bg-black/30 border border-white/10 space-y-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-white">
                WebRTC STUN & Optional TURN Relay Configuration
              </span>
              {jamSavedNotice && (
                <span className="text-xs font-medium text-emerald-300">{jamSavedNotice}</span>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-white/60 mb-1">
                  STUN Servers (comma-separated)
                </label>
                <input
                  type="text"
                  value={stunInput}
                  onChange={(e) => setStunInput(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-xl bg-black/40 border border-white/15 text-xs font-mono text-white focus:outline-none focus:border-white/40"
                />
              </div>
              <div>
                <label className="block text-[11px] text-white/60 mb-1">
                  Optional TURN Server URL
                </label>
                <input
                  type="text"
                  value={turnUrl}
                  onChange={(e) => setTurnUrl(e.target.value)}
                  placeholder="turn:turn.example.org:3478"
                  className="w-full px-3 py-1.5 rounded-xl bg-black/40 border border-white/15 text-xs font-mono text-white placeholder-white/30 focus:outline-none focus:border-white/40"
                />
              </div>
              <div>
                <label className="block text-[11px] text-white/60 mb-1">
                  TURN Username (optional)
                </label>
                <input
                  type="text"
                  value={turnUsername}
                  onChange={(e) => setTurnUsername(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-xl bg-black/40 border border-white/15 text-xs text-white focus:outline-none focus:border-white/40"
                />
              </div>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label className="block text-[11px] text-white/60 mb-1">
                    TURN Credential (optional)
                  </label>
                  <input
                    type="password"
                    value={turnCredential}
                    onChange={(e) => setTurnCredential(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-xl bg-black/40 border border-white/15 text-xs text-white focus:outline-none focus:border-white/40"
                  />
                </div>
                <button
                  type="submit"
                  style={{ backgroundColor: effectiveAccentColor }}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-slate-950 cursor-pointer whitespace-nowrap shrink-0"
                >
                  Save Network Config
                </button>
              </div>
            </div>
          </form>

          {/* Windows Desktop Packaging & Optional Auto-Update */}
          <div className="p-4 rounded-xl bg-black/30 border border-white/10 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-semibold text-white">
                <Download size={14} style={{ color: effectiveAccentColor }} />
                <span>
                  Windows Desktop Installer & Auto-Update (Aestheticy Setup · com.aestheticy.app)
                </span>
              </div>
              <p className="text-xs text-white/60">
                {!isOnline
                  ? "You're currently offline. Update checks will resume when your internet connection returns."
                  : updateStatus?.message ||
                    'Automatic updates keep Aestheticy up to date in the background.'}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!isOnline || isCheckingUpdate}
                onClick={async () => {
                  setIsCheckingUpdate(true);
                  try {
                    const next = await ipcClient.checkForUpdates();
                    setUpdateStatus(next);
                  } finally {
                    setIsCheckingUpdate(false);
                  }
                }}
                className="liquid-glass-btn px-3 py-1.5 rounded-xl text-xs font-medium text-white/85 hover:text-white disabled:opacity-45 cursor-pointer whitespace-nowrap shrink-0"
              >
                {isCheckingUpdate ? 'Checking...' : 'Check for Updates'}
              </button>

              <button
                type="button"
                onClick={async () => {
                  const nextEnabled = !(updateStatus?.autoUpdateEnabled ?? true);
                  const next = await ipcClient.setAutoUpdateEnabled(nextEnabled);
                  setUpdateStatus(next);
                }}
                style={
                  (updateStatus?.autoUpdateEnabled ?? true)
                    ? { backgroundColor: effectiveAccentColor, color: '#090A0F' }
                    : undefined
                }
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  (updateStatus?.autoUpdateEnabled ?? true)
                    ? ''
                    : 'bg-white/10 text-white/65 hover:text-white'
                }`}
              >
                {(updateStatus?.autoUpdateEnabled ?? true)
                  ? 'Auto-Update On'
                  : 'Auto-Update Off'}
              </button>
            </div>
          </div>

          {/* Window size & full screen (Windows app only) */}
          {desktopSettings?.isDesktop && <WindowSizeCard accentColor={effectiveAccentColor} />}

          {/* Desktop behaviour (Windows app only) */}
          {desktopSettings?.isDesktop && (
            <div className="p-4 rounded-xl bg-black/30 border border-white/10 space-y-3">
              <h3 className="text-xs font-semibold text-white">Windows Behaviour</h3>
              {(
                [
                  {
                    key: 'closeToTray',
                    label: 'Close to system tray',
                    hint: 'The X button hides Aestheticy and keeps the music playing.',
                  },
                  {
                    key: 'launchAtStartup',
                    label: 'Start with Windows',
                    hint: 'Launches quietly in the tray when you sign in.',
                  },
                ] as const
              ).map((row) => {
                const on = desktopSettings[row.key];
                return (
                  <div key={row.key} className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs text-white/85">{row.label}</p>
                      <p className="text-[11px] text-white/50">{row.hint}</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      onClick={async () =>
                        setDesktopSettings(
                          await ipcClient.setDesktopSettings({ [row.key]: !on })
                        )
                      }
                      style={on ? { backgroundColor: effectiveAccentColor } : undefined}
                      className={`relative w-10 h-6 rounded-full transition-colors cursor-pointer shrink-0 ${
                        on ? '' : 'bg-white/15'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                          on ? 'translate-x-4' : ''
                        }`}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* About */}
          <div className="p-4 rounded-xl bg-black/30 border border-white/10 flex items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-semibold text-white">
                <Sparkles size={14} style={{ color: effectiveAccentColor }} />
                <span>About Aestheticy</span>
              </div>
              <p className="text-xs text-white/60">
                Aestheticy · Liquid Glass Desktop Music Player
              </p>
            </div>
            <p className="text-xs text-white/50 whitespace-nowrap shrink-0">
              Developed by Mido
            </p>
          </div>
        </section>
      )}
    </div>
  );
};
