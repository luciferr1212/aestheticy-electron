import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ChevronDown,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  Heart,
  Volume2,
  VolumeX,
  Sliders,
  ListMusic,
  Mic2,
  Film,
  Link2,
  Check,
  X,
  Loader2,
} from 'lucide-react';
import type { DominantPalette } from '../utils/colorExtractor.ts';
import type { CanvasResult, RepeatMode, Track } from '../shared/ipcTypes.ts';
import { CoverArt } from './CoverArt.tsx';
import { LyricsView } from './LyricsView.tsx';
import {
  formatBitrate,
  formatDuration,
  formatSampleRate,
  isTrackLossless,
  requiresFfmpegTranscode,
} from '../utils/formatters.ts';
import { ipcClient } from '../services/ipcClient.ts';

interface NowPlayingSheetProps {
  isOpen: boolean;
  onClose: () => void;
  currentTrack: Track | null;
  isPlaying: boolean;
  isPreparingTrack?: boolean;
  normalizeVolume?: boolean;
  currentTime: number;
  duration: number;
  shuffle: boolean;
  repeatMode: RepeatMode;
  volume: number;
  muted: boolean;
  palette: DominantPalette;
  playNextQueue: Track[];
  standardQueue: Track[];
  onTogglePlayPause: () => void;
  onNextTrack: () => void;
  onPreviousTrack: () => void;
  onSeek: (newTime: number) => void;
  onToggleShuffle: () => void;
  onCycleRepeatMode: () => void;
  onChangeVolume: (val: number) => void;
  onToggleMute: () => void;
  onToggleFavorite: (track: Track) => void;
  onOpenSettings: () => void;
  onPlayFromQueue: (track: Track) => void;
  audioElementRef: React.RefObject<HTMLAudioElement | null>;
  canvasEnabled: boolean;
  onTrackUpdated?: (trackId: number, updates: Partial<Track>) => void;
}

export const NowPlayingSheet: React.FC<NowPlayingSheetProps> = ({
  isOpen,
  onClose,
  currentTrack,
  isPlaying,
  isPreparingTrack = false,
  normalizeVolume = false,
  currentTime,
  duration,
  shuffle,
  repeatMode,
  volume,
  muted,
  palette,
  playNextQueue,
  standardQueue,
  onTogglePlayPause,
  onNextTrack,
  onPreviousTrack,
  onSeek,
  onToggleShuffle,
  onCycleRepeatMode,
  onChangeVolume,
  onToggleMute,
  onToggleFavorite,
  onOpenSettings,
  onPlayFromQueue,
  audioElementRef,
  canvasEnabled,
  onTrackUpdated,
}) => {
  const [rightTab, setRightTab] = React.useState<'lyrics' | 'queue'>('lyrics');
  const [canvasResult, setCanvasResult] = React.useState<CanvasResult | null>(null);
  const [canvasVideoReady, setCanvasVideoReady] = React.useState(false);
  const [isLinkingSpotify, setIsLinkingSpotify] = React.useState(false);
  const [spotifyInput, setSpotifyInput] = React.useState('');
  const [isSavingSpotify, setIsSavingSpotify] = React.useState(false);

  const effectiveDuration = duration > 0 ? duration : currentTrack?.duration || 0;
  const seekPercent =
    effectiveDuration > 0 ? Math.min(100, (currentTime / effectiveDuration) * 100) : 0;

  const upcomingTracks = [...playNextQueue, ...standardQueue].slice(0, 12);

  // Fetch Canvas video silently whenever currentTrack or canvasEnabled changes
  React.useEffect(() => {
    let active = true;
    setCanvasVideoReady(false);

    if (!currentTrack) {
      setCanvasResult(null);
      setSpotifyInput('');
      return;
    }

    setSpotifyInput(currentTrack.spotifyTrackId || '');

    if (!canvasEnabled) {
      setCanvasResult(null);
      return;
    }

    ipcClient
      .getCanvasForTrack(currentTrack.id, false)
      .then((res) => {
        if (!active) return;
        setCanvasResult(res);
        if (res.spotifyTrackId) {
          setSpotifyInput(res.spotifyTrackId);
        }
      })
      .catch(() => {
        // Never show an error to the user; fall back silently to moving blurred album art
        if (active) {
          setCanvasResult(null);
        }
      });

    return () => {
      active = false;
    };
  }, [currentTrack?.id, currentTrack?.spotifyTrackId, canvasEnabled]);

  const handleSaveSpotifyLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentTrack) return;
    setIsSavingSpotify(true);
    setCanvasVideoReady(false);
    try {
      const res = await ipcClient.linkSpotifyTrackForCanvas(currentTrack.id, spotifyInput.trim());
      setCanvasResult(res);
      onTrackUpdated?.(currentTrack.id, { spotifyTrackId: res.spotifyTrackId });
      setIsLinkingSpotify(false);
    } catch {
      // Silently ignore errors
      setIsLinkingSpotify(false);
    } finally {
      setIsSavingSpotify(false);
    }
  };

  const lossless = isTrackLossless(currentTrack);
  const bitrateStr = formatBitrate(currentTrack?.bitrate);
  const sampleRateStr = formatSampleRate(currentTrack?.sampleRate);
  const isFfmpegTranscoded = requiresFfmpegTranscode(currentTrack);

  return (
    <AnimatePresence>
      {isOpen && currentTrack && (
        <motion.div
          key="now-playing-sheet"
          initial={{ y: '100%', opacity: 0.4 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '100%', opacity: 0 }}
          transition={{
            type: 'spring',
            stiffness: 310,
            damping: 32,
            mass: 0.9,
          }}
          className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-[#05060A] select-none"
        >
          {/* Layer 1: Fallback Blurred, Slowly Moving Album Art & Ambient Mesh Background */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {currentTrack.coverArtUrl && (
              <motion.img
                key={`blurred-bg-${currentTrack.id}-${currentTrack.coverArtUrl}`}
                src={currentTrack.coverArtUrl}
                alt=""
                aria-hidden="true"
                initial={{ scale: 1.15, opacity: 0 }}
                animate={{
                  scale: [1.16, 1.28, 1.18],
                  x: [-24, 24, -12],
                  y: [-16, 18, -10],
                  rotate: [-2, 2, -1],
                  opacity: canvasVideoReady ? 0.18 : 0.55,
                }}
                transition={{
                  scale: { duration: 26, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' },
                  x: { duration: 32, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' },
                  y: { duration: 29, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' },
                  rotate: { duration: 36, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' },
                  opacity: { duration: 0.8 },
                }}
                className="absolute inset-0 w-full h-full object-cover blur-[72px] saturate-150"
              />
            )}

            <div
              className="absolute -top-32 -left-24 w-[650px] h-[650px] rounded-full blur-[130px] opacity-50 transition-colors duration-1000"
              style={{ backgroundColor: palette.primary }}
            />
            <div
              className="absolute bottom-[-15%] right-[-10%] w-[700px] h-[700px] rounded-full blur-[150px] opacity-40 transition-colors duration-1000"
              style={{ backgroundColor: palette.secondary }}
            />
            <div
              className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[480px] h-[480px] rounded-full blur-[140px] opacity-25 transition-colors duration-1000"
              style={{ backgroundColor: palette.accent }}
            />
          </div>

          {/* Layer 2: Muted, Looping, Autoplaying Spotify Canvas Video Background */}
          {canvasEnabled && canvasResult?.canvasUrl && (
            <video
              key={canvasResult.canvasUrl}
              src={canvasResult.canvasUrl}
              muted
              loop
              autoPlay
              playsInline
              onLoadedData={() => setCanvasVideoReady(true)}
              onCanPlay={() => setCanvasVideoReady(true)}
              onError={() => {
                // Silent fallback to blurred moving album art on any video load error
                setCanvasVideoReady(false);
                setCanvasResult((prev) => (prev ? { ...prev, canvasUrl: null } : null));
              }}
              className={`pointer-events-none absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ${
                canvasVideoReady ? 'opacity-65' : 'opacity-0'
              }`}
            />
          )}

          {/* Layer 3: Dark Gradient Readability Overlay */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#05060A]/80 via-[#06070B]/70 to-[#05060A]/92"
          />

          {/* Top Bar */}
          <div className="relative z-20 flex flex-wrap items-center justify-between gap-4 px-8 pt-6 pb-3">
            <button
              type="button"
              onClick={onClose}
              className="liquid-glass-btn inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-medium text-white/90 hover:text-white cursor-pointer"
            >
              <ChevronDown size={16} />
              <span>Collapse Now Playing</span>
            </button>

            <div className="text-center">
              <div className="text-xs font-medium text-white/60">Playing from Album</div>
              <div className="text-sm font-semibold text-white mt-0.5">{currentTrack.album}</div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsLinkingSpotify((v) => !v)}
                title="Link Spotify Track ID or URI for Canvas Video"
                style={
                  isLinkingSpotify || canvasResult?.canvasUrl
                    ? { borderColor: palette.accent, color: palette.accent }
                    : undefined
                }
                className="liquid-glass-btn inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-medium text-white/90 hover:text-white cursor-pointer"
              >
                <Film size={13} />
                <span>
                  {canvasVideoReady
                    ? 'Canvas Active'
                    : currentTrack.spotifyTrackId
                    ? 'Spotify Linked'
                    : 'Link Spotify Track'}
                </span>
              </button>

              <button
                type="button"
                onClick={onOpenSettings}
                className="liquid-glass-btn inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-medium text-white/90 hover:text-white cursor-pointer"
              >
                <Sliders size={14} style={{ color: palette.accent }} />
                <span>Equalizer & Audio</span>
              </button>
            </div>
          </div>

          {/* Manual Link Spotify Track Bar */}
          {isLinkingSpotify && (
            <form
              onSubmit={handleSaveSpotifyLink}
              className="relative z-20 max-w-2xl w-full mx-auto px-8 pb-2"
            >
              <div className="liquid-glass-elevated rounded-2xl px-4 py-3 flex flex-wrap items-center gap-2.5 border border-white/15">
                <Link2 size={14} style={{ color: palette.accent }} className="shrink-0" />
                <input
                  type="text"
                  value={spotifyInput}
                  onChange={(e) => setSpotifyInput(e.target.value)}
                  placeholder="Paste Spotify Track URL, URI (spotify:track:...), or 22-char Track ID..."
                  className="flex-1 min-w-56 px-3 py-1.5 rounded-xl bg-black/45 border border-white/15 focus:border-white/40 focus:outline-none text-xs font-mono text-white placeholder-white/40"
                />
                <button
                  type="submit"
                  disabled={isSavingSpotify}
                  style={{ backgroundColor: palette.accent, color: '#090A0F' }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold disabled:opacity-40 cursor-pointer shrink-0"
                >
                  <Check size={13} />
                  <span>{isSavingSpotify ? 'Linking...' : 'Save Track Link'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsLinkingSpotify(false)}
                  className="p-1.5 rounded-lg text-white/55 hover:text-white cursor-pointer"
                >
                  <X size={13} />
                </button>
              </div>
            </form>
          )}

          {/* Center Split Content: Left Floating Artwork & Controls | Right Synced Lyrics / Up Next */}
          <div className="relative z-10 flex-1 max-w-7xl w-full mx-auto px-8 py-4 grid grid-cols-1 lg:grid-cols-12 gap-10 items-center min-h-0">
            {/* Left Column: Artwork + Transport */}
            <div className="lg:col-span-5 flex flex-col items-center lg:items-start justify-center">
              <motion.div
                initial={{ scale: 0.92, opacity: 0 }}
                animate={{ scale: isPlaying ? 1 : 0.96, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 260, damping: 24 }}
                className="relative w-72 h-72 sm:w-88 sm:h-88 rounded-3xl p-2 liquid-glass-elevated shadow-2xl mx-auto lg:mx-0"
              >
                <CoverArt
                  src={currentTrack.coverArtUrl}
                  title={currentTrack.album}
                  subtitle={currentTrack.artist}
                  className="w-full h-full rounded-2xl"
                  iconSize={80}
                />
              </motion.div>

              {/* Track Title + Favorite */}
              <div className="w-full mt-7 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight truncate">
                    {currentTrack.title}
                  </h2>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-white/75 mt-1">
                    <span className="font-medium text-white/90">{currentTrack.artist}</span>
                    <span aria-hidden="true">·</span>
                    <span>{currentTrack.album}</span>
                    {currentTrack.year && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">{currentTrack.year}</span>
                      </>
                    )}
                  </div>

                  {/* Audio Stream Format, Lossless, Sample Rate, Bitrate & ISRC */}
                  <div className="flex flex-wrap items-center gap-2 text-xs font-mono tabular-nums text-white/60 mt-2">
                    {isPreparingTrack ? (
                      <span
                        className="inline-flex items-center gap-1.5 font-medium"
                        style={{ color: palette.accent }}
                      >
                        <Loader2 size={12} className="animate-spin" />
                        <span>Preparing track...</span>
                      </span>
                    ) : (
                      <>
                        <span className="font-semibold text-white">{currentTrack.format}</span>
                        {lossless && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-semibold" style={{ color: palette.accent }}>
                              Lossless
                            </span>
                          </>
                        )}
                        {currentTrack.bitDepth && sampleRateStr ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>
                              {currentTrack.bitDepth}-bit / {sampleRateStr}
                            </span>
                          </>
                        ) : sampleRateStr ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{sampleRateStr}</span>
                          </>
                        ) : null}
                        {bitrateStr && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{bitrateStr}</span>
                          </>
                        )}
                        {isFfmpegTranscoded && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-white/45">FFmpeg FLAC</span>
                          </>
                        )}
                        {normalizeVolume &&
                          currentTrack.loudnessGainDb !== null &&
                          currentTrack.loudnessGainDb !== undefined && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-white/45">
                                {currentTrack.loudnessGainDb > 0
                                  ? `+${currentTrack.loudnessGainDb.toFixed(1)}`
                                  : currentTrack.loudnessGainDb.toFixed(1)}{' '}
                                dB LUFS
                              </span>
                            </>
                          )}
                        {currentTrack.isrc && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-white/45">ISRC {currentTrack.isrc}</span>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onToggleFavorite(currentTrack)}
                  className="liquid-glass-btn p-3 rounded-full text-white/80 hover:text-white cursor-pointer shrink-0"
                  title={currentTrack.isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
                >
                  <Heart
                    size={20}
                    className={currentTrack.isFavorite ? 'text-rose-400 fill-rose-400' : ''}
                  />
                </button>
              </div>

              {/* Liquid Scrub Bar */}
              <div className="w-full mt-6">
                <div className="relative flex items-center group py-2">
                  <div className="w-full h-2 bg-white/15 rounded-full overflow-hidden backdrop-blur-sm">
                    <div
                      className="h-full rounded-full transition-all duration-100"
                      style={{
                        width: `${seekPercent}%`,
                        backgroundColor: palette.accent,
                      }}
                    />
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={effectiveDuration || 100}
                    step={0.1}
                    disabled={isPreparingTrack}
                    value={currentTime}
                    onChange={(e) => onSeek(parseFloat(e.target.value))}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                </div>
                <div className="flex items-center justify-between text-xs font-mono tabular-nums text-white/60 mt-1">
                  <span>{formatDuration(currentTime)}</span>
                  <span>-{formatDuration(Math.max(0, effectiveDuration - currentTime))}</span>
                </div>
              </div>

              {/* Transport Controls */}
              <div className="w-full mt-5 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={onToggleShuffle}
                    className={`liquid-glass-btn p-2.5 rounded-full cursor-pointer ${
                      shuffle ? 'text-white border-white/40' : 'text-white/60 hover:text-white'
                    }`}
                    style={shuffle ? { color: palette.accent } : undefined}
                    title="Shuffle"
                  >
                    <Shuffle size={18} />
                  </button>

                  <button
                    type="button"
                    onClick={onPreviousTrack}
                    className="liquid-glass-btn p-3 rounded-full text-white hover:scale-105 transition-transform cursor-pointer"
                    title="Previous Track"
                  >
                    <SkipBack size={22} className="fill-current" />
                  </button>

                  <button
                    type="button"
                    disabled={isPreparingTrack}
                    onClick={onTogglePlayPause}
                    style={{ backgroundColor: palette.accent }}
                    className="w-14 h-14 rounded-full text-slate-950 flex items-center justify-center shadow-2xl hover:scale-105 active:scale-95 transition-transform disabled:opacity-45 cursor-pointer"
                    title={isPreparingTrack ? 'Preparing track...' : isPlaying ? 'Pause' : 'Play'}
                  >
                    {isPreparingTrack ? (
                      <Loader2 size={24} className="animate-spin text-slate-950" />
                    ) : isPlaying ? (
                      <Pause size={24} className="fill-slate-950" />
                    ) : (
                      <Play size={24} className="fill-slate-950 ml-0.5" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={onNextTrack}
                    className="liquid-glass-btn p-3 rounded-full text-white hover:scale-105 transition-transform cursor-pointer"
                    title="Next Track"
                  >
                    <SkipForward size={22} className="fill-current" />
                  </button>

                  <button
                    type="button"
                    onClick={onCycleRepeatMode}
                    className={`liquid-glass-btn p-2.5 rounded-full cursor-pointer ${
                      repeatMode !== 'off'
                        ? 'text-white border-white/40'
                        : 'text-white/60 hover:text-white'
                    }`}
                    style={repeatMode !== 'off' ? { color: palette.accent } : undefined}
                    title={`Repeat: ${repeatMode}`}
                  >
                    {repeatMode === 'one' ? <Repeat1 size={18} /> : <Repeat size={18} />}
                  </button>
                </div>

                {/* Volume Control */}
                <div className="hidden sm:flex items-center gap-2.5 w-40">
                  <button
                    type="button"
                    onClick={onToggleMute}
                    className="text-white/75 hover:text-white cursor-pointer"
                  >
                    {muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
                  </button>
                  <div className="relative flex-1 flex items-center py-1">
                    <div className="w-full h-1.5 bg-white/15 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${muted ? 0 : volume * 100}%`,
                          backgroundColor: palette.accent,
                        }}
                      />
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={muted ? 0 : volume}
                      onChange={(e) => onChangeVolume(parseFloat(e.target.value))}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Synced Lyrics / Up Next Switchable Stage */}
            <div className="lg:col-span-7 h-full max-h-[640px] rounded-3xl liquid-glass flex flex-col min-h-0 overflow-hidden">
              <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-white/10 shrink-0">
                <div className="flex items-center gap-1 p-1 rounded-xl bg-black/35 border border-white/10">
                  <button
                    type="button"
                    onClick={() => setRightTab('lyrics')}
                    style={
                      rightTab === 'lyrics'
                        ? { backgroundColor: palette.accent, color: '#090A0F' }
                        : undefined
                    }
                    className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      rightTab === 'lyrics'
                        ? 'shadow-sm'
                        : 'text-white/70 hover:text-white'
                    }`}
                  >
                    <Mic2 size={13} />
                    <span>Synced Lyrics</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRightTab('queue')}
                    style={
                      rightTab === 'queue'
                        ? { backgroundColor: palette.accent, color: '#090A0F' }
                        : undefined
                    }
                    className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      rightTab === 'queue'
                        ? 'shadow-sm'
                        : 'text-white/70 hover:text-white'
                    }`}
                  >
                    <ListMusic size={13} />
                    <span>Up Next ({upcomingTracks.length})</span>
                  </button>
                </div>
              </div>

              {rightTab === 'lyrics' ? (
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  <LyricsView
                    currentTrack={currentTrack}
                    isPlaying={isPlaying}
                    currentTime={currentTime}
                    audioElementRef={audioElementRef}
                    palette={palette}
                    onSeek={onSeek}
                    onTrackUpdated={onTrackUpdated}
                    compactHeader
                  />
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto space-y-1.5 p-5">
                  {upcomingTracks.length === 0 ? (
                    <div className="py-16 text-center text-xs text-white/50">
                      No upcoming tracks queued.
                    </div>
                  ) : (
                    upcomingTracks.map((t, idx) => (
                      <div
                        key={`${t.id}-${idx}`}
                        onClick={() => onPlayFromQueue(t)}
                        className="group flex items-center gap-3 p-2.5 rounded-xl hover:bg-white/10 transition-colors cursor-pointer"
                      >
                        <CoverArt
                          src={t.coverArtUrl}
                          title={t.album}
                          subtitle={t.artist}
                          className="w-10 h-10 rounded-lg"
                          iconSize={16}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-semibold text-white truncate">{t.title}</div>
                          <div className="text-[11px] text-white/60 truncate mt-0.5">
                            {t.artist} · {t.album}
                          </div>
                        </div>
                        <span className="text-xs font-mono tabular-nums text-white/50">
                          {formatDuration(t.duration)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
