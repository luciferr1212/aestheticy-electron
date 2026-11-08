import React from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Heart,
  Maximize2,
  Shuffle,
  Repeat,
  Repeat1,
  Loader2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { DominantPalette } from '../utils/colorExtractor.ts';
import type { RepeatMode, Track } from '../shared/ipcTypes.ts';
import { CoverArt } from './CoverArt.tsx';
import { formatDuration, formatSampleRate, isTrackLossless } from '../utils/formatters.ts';
import { ipcClient } from '../services/ipcClient.ts';

interface MiniPlayerProps {
  currentTrack: Track | null;
  isPlaying: boolean;
  isPreparingTrack?: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeatMode: RepeatMode;
  palette: DominantPalette;
  onTogglePlayPause: () => void;
  onNextTrack: () => void;
  onPreviousTrack: () => void;
  onSeek: (time: number) => void;
  onChangeVolume: (val: number) => void;
  onToggleMute: () => void;
  onToggleShuffle: () => void;
  onCycleRepeatMode: () => void;
  onToggleFavorite: (track: Track) => void;
  onExitMiniPlayer: () => void;
}

/**
 * Compact Apple-Music-style mini player. It fills the small docked window (see MINI_WIDTH /
 * MINI_HEIGHT in electron/main/index.ts): artwork on the left, title + scrubber + transport on
 * the right. The whole surface is draggable; only the controls opt out.
 */
export const MiniPlayer: React.FC<MiniPlayerProps> = ({
  currentTrack,
  isPlaying,
  isPreparingTrack = false,
  currentTime,
  duration,
  volume,
  muted,
  shuffle,
  repeatMode,
  palette,
  onTogglePlayPause,
  onNextTrack,
  onPreviousTrack,
  onSeek,
  onChangeVolume,
  onToggleMute,
  onToggleShuffle,
  onCycleRepeatMode,
  onToggleFavorite,
  onExitMiniPlayer,
}) => {
  const effectiveDuration = duration > 0 ? duration : currentTrack?.duration || 0;
  const seekPercent =
    effectiveDuration > 0 ? Math.min(100, (currentTime / effectiveDuration) * 100) : 0;

  const lossless = isTrackLossless(currentTrack);
  const sampleRateStr = formatSampleRate(currentTrack?.sampleRate, currentTrack?.bitDepth);

  const iconBtn =
    'app-no-drag shrink-0 rounded-full flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer';

  return (
    <div className="app-drag-region relative flex-1 min-h-0 p-2 select-none">
      <div className="relative h-full rounded-[22px] liquid-glass-elevated specular-surface overflow-hidden">
        {/* Ambient album glow */}
        <div
          className="pointer-events-none absolute -top-16 -left-10 w-48 h-48 rounded-full blur-3xl opacity-40 transition-colors duration-700"
          style={{ backgroundColor: palette.primary }}
        />

        <div className="relative z-10 h-full flex items-center gap-3 p-2.5 pr-3">
          {/* Artwork */}
          <CoverArt
            src={currentTrack?.coverArtUrl}
            title={currentTrack?.album || 'Aestheticy'}
            subtitle={currentTrack?.artist}
            className="h-full aspect-square rounded-2xl shadow-xl border border-white/15 shrink-0"
            iconSize={32}
          />

          {/* Right column */}
          <div className="flex-1 min-w-0 h-full flex flex-col justify-between py-0.5">
            {/* Title row */}
            <div className="flex items-start gap-1">
              <div className="min-w-0 flex-1">
                <h2 className="text-[13px] font-bold text-white truncate leading-tight">
                  {currentTrack ? currentTrack.title : 'Ready to Play'}
                </h2>
                <p className="text-[11px] text-white/65 truncate leading-tight mt-0.5">
                  {currentTrack ? currentTrack.artist : 'Select a track to begin'}
                </p>
                {currentTrack && (
                  <p className="text-[10px] font-mono tabular-nums text-white/45 truncate leading-tight mt-0.5">
                    {isPreparingTrack ? (
                      <span className="inline-flex items-center gap-1" style={{ color: palette.accent }}>
                        <Loader2 size={9} className="animate-spin" />
                        Preparing…
                      </span>
                    ) : (
                      <>
                        {currentTrack.format}
                        {lossless && (
                          <span style={{ color: palette.accent }}> · Lossless</span>
                        )}
                        {sampleRateStr && <span> · {sampleRateStr}</span>}
                      </>
                    )}
                  </p>
                )}
              </div>
              {currentTrack && (
                <button
                  type="button"
                  onClick={() => onToggleFavorite(currentTrack)}
                  title={currentTrack.isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
                  className={`${iconBtn} w-6 h-6`}
                >
                  <Heart
                    size={13}
                    className={currentTrack.isFavorite ? 'text-rose-400 fill-rose-400' : ''}
                  />
                </button>
              )}
              <button
                type="button"
                onClick={onExitMiniPlayer}
                title="Back to full window"
                className={`${iconBtn} w-6 h-6`}
              >
                <Maximize2 size={12} />
              </button>
              <button
                type="button"
                onClick={() => ipcClient.closeWindow().catch(() => {})}
                title="Close"
                className={`${iconBtn} w-6 h-6 hover:!bg-rose-500/70`}
              >
                <X size={13} />
              </button>
            </div>

            {/* Scrubber */}
            <div className="app-no-drag">
              <div className="relative flex items-center py-1">
                <div className="w-full h-1 bg-white/15 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${seekPercent}%`, backgroundColor: palette.accent }}
                  />
                </div>
                <input
                  type="range"
                  min={0}
                  max={effectiveDuration || 100}
                  step={0.1}
                  disabled={!currentTrack}
                  value={currentTime}
                  onChange={(e) => onSeek(parseFloat(e.target.value))}
                  aria-label="Seek"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
              </div>
              <div className="flex items-center justify-between text-[10px] font-mono tabular-nums text-white/50 leading-none">
                <span>{formatDuration(currentTime)}</span>
                <span>-{formatDuration(Math.max(0, effectiveDuration - currentTime))}</span>
              </div>
            </div>

            {/* Transport */}
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={onToggleShuffle}
                title="Shuffle"
                style={shuffle ? { color: palette.accent } : undefined}
                className={`${iconBtn} w-7 h-7`}
              >
                <Shuffle size={13} />
              </button>
              <button
                type="button"
                disabled={!currentTrack}
                onClick={onPreviousTrack}
                title="Previous"
                className={`${iconBtn} w-7 h-7 text-white disabled:opacity-40`}
              >
                <SkipBack size={16} className="fill-current" />
              </button>
              <button
                type="button"
                disabled={!currentTrack}
                onClick={onTogglePlayPause}
                title={isPlaying ? 'Pause' : 'Play'}
                style={{ backgroundColor: palette.accent }}
                className="app-no-drag w-9 h-9 rounded-full text-slate-950 flex items-center justify-center shadow-lg hover:scale-105 active:scale-95 transition-transform disabled:opacity-40 cursor-pointer"
              >
                {isPlaying ? (
                  <Pause size={16} className="fill-slate-950" />
                ) : (
                  <Play size={16} className="fill-slate-950 ml-0.5" />
                )}
              </button>
              <button
                type="button"
                disabled={!currentTrack}
                onClick={onNextTrack}
                title="Next"
                className={`${iconBtn} w-7 h-7 text-white disabled:opacity-40`}
              >
                <SkipForward size={16} className="fill-current" />
              </button>
              <button
                type="button"
                onClick={onCycleRepeatMode}
                title={`Repeat: ${repeatMode}`}
                style={repeatMode !== 'off' ? { color: palette.accent } : undefined}
                className={`${iconBtn} w-7 h-7`}
              >
                {repeatMode === 'one' ? <Repeat1 size={13} /> : <Repeat size={13} />}
              </button>
              <button
                type="button"
                onClick={onToggleMute}
                onWheel={(e) => {
                  const step = e.deltaY < 0 ? 0.05 : -0.05;
                  onChangeVolume(Math.min(1, Math.max(0, (muted ? 0 : volume) + step)));
                }}
                title={`${muted || volume === 0 ? 'Unmute' : 'Mute'} (scroll to change volume · ${
                  muted ? 0 : Math.round(volume * 100)
                }%)`}
                className={`${iconBtn} w-7 h-7`}
              >
                {muted || volume === 0 ? <VolumeX size={13} /> : <Volume2 size={13} />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
