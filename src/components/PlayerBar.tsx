import React, { useEffect, useRef, useState } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  Volume2,
  Volume1,
  VolumeX,
  ListMusic,
  Heart,
  Maximize2,
  Sliders,
  Mic2,
  Loader2,
  Radio,
  Crown,
  History,
} from 'lucide-react';
import type {
  EqualizerSettings,
  JamRoomSnapshot,
  RepeatMode,
  Track,
} from '../shared/ipcTypes.ts';
import { CoverArt } from './CoverArt.tsx';
import { SleepTimerMenu, type SleepTimerChoice } from './SleepTimerMenu.tsx';
import {
  formatBitrate,
  formatDuration,
  formatSampleRate,
  isTrackLossless,
  requiresFfmpegTranscode,
} from '../utils/formatters.ts';
import { ipcClient } from '../services/ipcClient.ts';
import { equalizerEngine } from '../utils/audioEqualizer.ts';

interface PlayerBarProps {
  onShowAudioInfo?: (track: Track) => void;
  currentTrack: Track | null;
  nextQueuedTrack?: Track | null;
  isPlaying: boolean;
  shuffle: boolean;
  repeatMode: RepeatMode;
  volume: number;
  muted: boolean;
  equalizer: EqualizerSettings;
  outputDeviceId: string;
  normalizeVolume: boolean;
  crossfadeSeconds: number;
  gaplessPlayback: boolean;
  accentColor: string;
  queueCount: number;
  isQueueOpen: boolean;
  isHistoryOpen?: boolean;
  isJamOpen?: boolean;
  jamRoom?: JamRoomSnapshot | null;
  jamPlaybackRate?: number;
  jamMutedForMissingTrack?: boolean;
  isReceivingHostAudioStream?: boolean;
  isLyricsOpen: boolean;
  isMiniPlayer: boolean;
  currentTime: number;
  duration: number;
  isPreparingTrack: boolean;
  onPreparingChange: (preparing: boolean) => void;
  onTrackUnplayable: (track: Track, reason: string) => void;
  onTrackMetadataEnriched?: (trackId: number, updates: Partial<Track>) => void;
  onTimeChange: (time: number) => void;
  onDurationChange: (dur: number) => void;
  onSeekRequestRef: React.MutableRefObject<((newTime: number) => void) | null>;
  audioElementRef?: React.MutableRefObject<HTMLAudioElement | null>;
  onTogglePlayPause: () => void;
  onSetIsPlaying: (playing: boolean) => void;
  onNextTrack: (autoAdvance?: boolean) => void;
  onPreviousTrack: () => void;
  onToggleShuffle: () => void;
  onCycleRepeatMode: () => void;
  onChangeVolume: (vol: number) => void;
  onToggleMute: () => void;
  onToggleFavorite: (track: Track) => void;
  onToggleQueueSidebar: () => void;
  onToggleHistorySidebar?: () => void;
  sleepTimerLabel?: string | null;
  onChooseSleepTimer?: (choice: SleepTimerChoice) => void;
  onToggleJamSidebar?: () => void;
  onToggleLyrics: () => void;
  onOpenNowPlayingSheet: () => void;
  onOpenSettings: () => void;
  onSelectAlbum?: (album: string, artist: string) => void;
  onSelectArtist?: (artist: string) => void;
}

export const PlayerBar: React.FC<PlayerBarProps> = ({
  onShowAudioInfo,
  currentTrack,
  nextQueuedTrack,
  isPlaying,
  shuffle,
  repeatMode,
  volume,
  muted,
  equalizer,
  outputDeviceId,
  normalizeVolume,
  crossfadeSeconds,
  gaplessPlayback,
  accentColor,
  queueCount,
  isQueueOpen,
  isHistoryOpen,
  isJamOpen = false,
  jamRoom = null,
  jamPlaybackRate = 1.0,
  jamMutedForMissingTrack = false,
  isReceivingHostAudioStream = false,
  isLyricsOpen,
  isMiniPlayer,
  currentTime,
  duration,
  isPreparingTrack,
  onPreparingChange,
  onTrackUnplayable,
  onTrackMetadataEnriched,
  onTimeChange,
  onDurationChange,
  onSeekRequestRef,
  audioElementRef,
  onTogglePlayPause,
  onSetIsPlaying,
  onNextTrack,
  onPreviousTrack,
  onToggleShuffle,
  onCycleRepeatMode,
  onChangeVolume,
  onToggleMute,
  onToggleFavorite,
  onToggleQueueSidebar,
  onToggleHistorySidebar,
  sleepTimerLabel,
  onChooseSleepTimer,
  onToggleJamSidebar,
  onToggleLyrics,
  onOpenNowPlayingSheet,
  onOpenSettings,
  onSelectAlbum,
  onSelectArtist,
}) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const gaplessPreloadRef = useRef<HTMLAudioElement>(null);
  const [isDraggingSeek, setIsDraggingSeek] = useState(false);
  const [isTranscodedStream, setIsTranscodedStream] = useState(false);

  const fallbackAttemptedTrackIdRef = useRef<number | null>(null);
  const crossfadeTriggeredTrackIdRef = useRef<number | null>(null);
  const fadeInTimerRef = useRef<number | null>(null);
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  // Sync audioRef with external audioElementRef for high-frame-rate rAF lyrics sweep
  useEffect(() => {
    if (audioElementRef) {
      audioElementRef.current = audioRef.current;
    }
  });

  // Expose imperative seek handler to NowPlayingSheet, LyricsView, and MiniPlayer
  useEffect(() => {
    onSeekRequestRef.current = (newTime: number) => {
      onTimeChange(newTime);
      if (audioRef.current) {
        audioRef.current.currentTime = newTime;
      }
    };
  }, [onSeekRequestRef, onTimeChange]);

  // Attach Web Audio API 10-band Equalizer and update settings
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    equalizerEngine.attachToAudioElement(audio, equalizer);
    equalizerEngine.applySettings(equalizer);
  }, [equalizer]);

  // Apply Audio Output Device (`setSinkId`) when supported
  useEffect(() => {
    const audio = audioRef.current as any;
    if (!audio || typeof audio.setSinkId !== 'function') return;
    audio.setSinkId(outputDeviceId === 'default' ? '' : outputDeviceId).catch(() => {
      // Fallback to default device if browser blocks setSinkId
    });
  }, [outputDeviceId]);

  // Update Loudness Normalization when toggle or currentTrack changes
  useEffect(() => {
    if (!currentTrack || !normalizeVolume) {
      equalizerEngine.setNormalizationGainDb(0);
      return;
    }

    if (
      currentTrack.loudnessGainDb !== null &&
      currentTrack.loudnessGainDb !== undefined
    ) {
      equalizerEngine.setNormalizationGainDb(currentTrack.loudnessGainDb);
      return;
    }

    let cancelled = false;
    ipcClient
      .analyzeTrackLoudness(currentTrack.id)
      .then((res) => {
        if (cancelled) return;
        equalizerEngine.setNormalizationGainDb(res.gainDb);
        onTrackMetadataEnriched?.(currentTrack.id, { loudnessGainDb: res.gainDb });
      })
      .catch(() => {
        if (!cancelled) {
          equalizerEngine.setNormalizationGainDb(0);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentTrack?.id, currentTrack?.loudnessGainDb, normalizeVolume]);

  // Pre-transcode and pre-buffer the next queued track in the background
  useEffect(() => {
    if (!nextQueuedTrack || nextQueuedTrack.unplayable) return;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      ipcClient
        .pretranscodeTrack(nextQueuedTrack.id, normalizeVolume)
        .then((res) => {
          if (cancelled || res.status !== 'ready' || !res.streamUrl) return;
          if (gaplessPlayback && gaplessPreloadRef.current) {
            if (gaplessPreloadRef.current.src !== new URL(res.streamUrl, window.location.origin).href) {
              gaplessPreloadRef.current.src = res.streamUrl;
              gaplessPreloadRef.current.load();
            }
          }
        })
        .catch(() => {});
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [nextQueuedTrack?.id, normalizeVolume, gaplessPlayback]);

  // Sync track source when currentTrack changes (with FFmpeg transcoding for unsupported formats)
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (fadeInTimerRef.current) {
      window.clearInterval(fadeInTimerRef.current);
      fadeInTimerRef.current = null;
    }

    if (!currentTrack) {
      audio.pause();
      audio.removeAttribute('src');
      onTimeChange(0);
      onDurationChange(0);
      onPreparingChange(false);
      setIsTranscodedStream(false);
      return;
    }

    // If this is a virtual Jam track (guest missing local copy), do not attempt local file decode
    if (currentTrack.filePath.startsWith('jam://') || jamMutedForMissingTrack) {
      audio.pause();
      audio.removeAttribute('src');
      onDurationChange(currentTrack.duration || 0);
      onPreparingChange(false);
      setIsTranscodedStream(false);
      return;
    }

    let active = true;
    fallbackAttemptedTrackIdRef.current = null;
    crossfadeTriggeredTrackIdRef.current = null;

    const loadAndStartTrack = async () => {
      const needsFfmpeg = requiresFfmpegTranscode(currentTrack);

      if (needsFfmpeg) {
        onPreparingChange(true);
        audio.pause();
        try {
          const res = await ipcClient.prepareTrackPlayback(
            currentTrack.id,
            false,
            normalizeVolume
          );
          if (!active) return;

          if (res.status === 'unplayable' || !res.streamUrl) {
            onPreparingChange(false);
            onTrackUnplayable(
              currentTrack,
              res.error || `Unable to decode ${currentTrack.format} file`
            );
            return;
          }

          setIsTranscodedStream(Boolean(res.transcoded));
          fallbackAttemptedTrackIdRef.current = currentTrack.id;
          audio.setAttribute('data-track-id', String(currentTrack.id));
          audio.src = res.streamUrl;
          audio.load();
          onTimeChange(0);
          onDurationChange(currentTrack.duration || 0);
          onPreparingChange(false);

          if (typeof res.loudnessGainDb === 'number' && normalizeVolume) {
            equalizerEngine.setNormalizationGainDb(res.loudnessGainDb);
          }

          if (isPlayingRef.current) {
            startPlaybackWithOptionalCrossfade(audio);
          }
        } catch {
          if (!active) return;
          onPreparingChange(false);
          onTrackUnplayable(currentTrack, `Failed to transcode ${currentTrack.title}`);
        }
      } else {
        setIsTranscodedStream(false);
        onPreparingChange(false);
        const streamUrl = ipcClient.getAudioStreamUrl(currentTrack);
        if (audio.getAttribute('data-track-id') !== String(currentTrack.id)) {
          audio.setAttribute('data-track-id', String(currentTrack.id));
          audio.src = streamUrl;
          audio.load();
          onTimeChange(0);
          onDurationChange(currentTrack.duration || 0);
        }

        if (isPlayingRef.current) {
          startPlaybackWithOptionalCrossfade(audio);
        }
      }
    };

    loadAndStartTrack();

    return () => {
      active = false;
    };
  }, [currentTrack?.id]);

  const startPlaybackWithOptionalCrossfade = (audio: HTMLAudioElement) => {
    equalizerEngine.resumeContextIfNeeded();

    if (crossfadeSeconds > 0) {
      equalizerEngine.setCrossfadeMultiplier(0.15);
      const steps = 16;
      const stepMs = Math.max(40, Math.floor((crossfadeSeconds * 1000) / steps));
      let currentStep = 0;
      if (fadeInTimerRef.current) {
        window.clearInterval(fadeInTimerRef.current);
      }
      fadeInTimerRef.current = window.setInterval(() => {
        currentStep++;
        const mult = Math.min(1.0, 0.15 + (0.85 * currentStep) / steps);
        equalizerEngine.setCrossfadeMultiplier(mult);
        if (currentStep >= steps && fadeInTimerRef.current) {
          window.clearInterval(fadeInTimerRef.current);
          fadeInTimerRef.current = null;
        }
      }, stepMs);
    } else {
      equalizerEngine.setCrossfadeMultiplier(1.0);
    }

    audio.play().catch(() => {
      // Wait for onError if it's a decoding failure
    });
  };

  // Sync play/pause state with native HTML5 <audio>
  useEffect(() => {
    const audio = audioRef.current;
    if (
      !audio ||
      !currentTrack ||
      isPreparingTrack ||
      currentTrack.filePath.startsWith('jam://') ||
      jamMutedForMissingTrack
    ) {
      if (audio && (jamMutedForMissingTrack || currentTrack?.filePath.startsWith('jam://'))) {
        audio.pause();
      }
      return;
    }

    if (isPlaying) {
      equalizerEngine.resumeContextIfNeeded();
      audio.play().catch(() => {
        // Handled by onError if unsupported format
      });
    } else {
      audio.pause();
    }
  }, [isPlaying, currentTrack, isPreparingTrack, jamMutedForMissingTrack]);

  // Sync volume, mute & Jam drift correction playbackRate with native HTML5 <audio>
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = Math.max(0, Math.min(1, volume));
    audio.muted = muted || jamMutedForMissingTrack;
  }, [volume, muted, jamMutedForMissingTrack]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const rate = Number.isFinite(jamPlaybackRate)
      ? Math.max(0.95, Math.min(1.05, jamPlaybackRate))
      : 1.0;
    if (Math.abs(audio.playbackRate - rate) > 0.001) {
      audio.playbackRate = rate;
    }
  }, [jamPlaybackRate]);

  // Handle native HTML5 <audio> load/decode error: fallback to FFmpeg transcoding or mark unplayable
  const handleAudioError = async () => {
    if (!currentTrack) return;
    const audio = audioRef.current;
    if (!audio) return;

    // If we have not yet tried FFmpeg fallback transcode for this track, transcode to FLAC/WAV now!
    if (fallbackAttemptedTrackIdRef.current !== currentTrack.id) {
      fallbackAttemptedTrackIdRef.current = currentTrack.id;
      onPreparingChange(true);
      try {
        const res = await ipcClient.prepareTrackPlayback(
          currentTrack.id,
          true,
          normalizeVolume
        );
        if (res.status === 'ready' && res.streamUrl) {
          setIsTranscodedStream(true);
          audio.src = res.streamUrl;
          audio.load();
          onPreparingChange(false);
          if (isPlayingRef.current) {
            equalizerEngine.resumeContextIfNeeded();
            audio.play().catch(() => {
              onTrackUnplayable(currentTrack, `Could not play transcoded stream for ${currentTrack.title}`);
            });
          }
          return;
        }
      } catch {
        // Fall through to unplayable handling
      }
    }

    onPreparingChange(false);
    onTrackUnplayable(
      currentTrack,
      `Cannot decode "${currentTrack.title}" (${currentTrack.format})`
    );
  };

  // Sync System Tray Playback Info
  useEffect(() => {
    ipcClient
      .updateTrayPlaybackState({
        title: currentTrack?.title || 'Aestheticy',
        artist: currentTrack?.artist || 'Idle',
        isPlaying,
      })
      .catch(() => {});
  }, [currentTrack?.title, currentTrack?.artist, isPlaying]);

  // Windows Media Overlay & Hardware Media Keys via Media Session API
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    if (!currentTrack) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = 'none';
      return;
    }

    const artworkUrl = currentTrack.coverArtUrl
      ? new URL(currentTrack.coverArtUrl, window.location.origin).href
      : undefined;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.title,
      artist: currentTrack.artist,
      album: currentTrack.album,
      artwork: artworkUrl
        ? [{ src: artworkUrl, sizes: '512x512', type: 'image/png' }]
        : [],
    });

    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
  }, [currentTrack, isPlaying]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    const handlers: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
      ['play', () => onSetIsPlaying(true)],
      ['pause', () => onSetIsPlaying(false)],
      ['previoustrack', () => handlePreviousTrigger()],
      ['nexttrack', () => onNextTrack(false)],
      [
        'seekbackward',
        (details) => {
          const audio = audioRef.current;
          if (!audio) return;
          const offset = details.seekOffset || 5;
          audio.currentTime = Math.max(0, audio.currentTime - offset);
          onTimeChange(audio.currentTime);
        },
      ],
      [
        'seekforward',
        (details) => {
          const audio = audioRef.current;
          if (!audio) return;
          const offset = details.seekOffset || 5;
          audio.currentTime = Math.min(audio.duration || duration, audio.currentTime + offset);
          onTimeChange(audio.currentTime);
        },
      ],
      [
        'seekto',
        (details) => {
          const audio = audioRef.current;
          if (!audio || typeof details.seekTime !== 'number') return;
          audio.currentTime = details.seekTime;
          onTimeChange(details.seekTime);
        },
      ],
    ];

    for (const [action, handler] of handlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Ignore unsupported action
      }
    }

    return () => {
      for (const [action] of handlers) {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {
          // ignore
        }
      }
    };
  });

  // Global Keyboard Shortcuts: Space, Left/Right Arrows, Up/Down Arrows
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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

      if (e.code === 'Space') {
        e.preventDefault();
        if (currentTrack) {
          onTogglePlayPause();
        }
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) {
          onNextTrack(false);
        } else if (audioRef.current && currentTrack) {
          const maxDur = audioRef.current.duration || currentTrack.duration || 0;
          const nextTime = Math.min(maxDur, audioRef.current.currentTime + 5);
          audioRef.current.currentTime = nextTime;
          onTimeChange(nextTime);
        }
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) {
          handlePreviousTrigger();
        } else if (audioRef.current && currentTrack) {
          const nextTime = Math.max(0, audioRef.current.currentTime - 5);
          audioRef.current.currentTime = nextTime;
          onTimeChange(nextTime);
        }
      } else if (e.code === 'ArrowUp') {
        e.preventDefault();
        onChangeVolume(Math.min(1, Number((volume + 0.05).toFixed(2))));
      } else if (e.code === 'ArrowDown') {
        e.preventDefault();
        onChangeVolume(Math.max(0, Number((volume - 0.05).toFixed(2))));
      } else if (e.code === 'KeyM') {
        e.preventDefault();
        onToggleMute();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentTrack, volume, onTogglePlayPause, onNextTrack, onChangeVolume, onToggleMute]);

  const handlePreviousTrigger = () => {
    const audio = audioRef.current;
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      onTimeChange(0);
    } else {
      onPreviousTrack();
    }
  };

  const handleAudioEnded = () => {
    const audio = audioRef.current;
    equalizerEngine.setCrossfadeMultiplier(1.0);
    if (repeatMode === 'one' && audio) {
      audio.currentTime = 0;
      audio.play().catch(() => onSetIsPlaying(false));
      return;
    }
    if (currentTrack && crossfadeTriggeredTrackIdRef.current === currentTrack.id) {
      return;
    }
    onNextTrack(true);
  };

  const effectiveDuration = duration > 0 ? duration : currentTrack?.duration || 0;
  const seekPercent =
    effectiveDuration > 0 ? Math.min(100, (currentTime / effectiveDuration) * 100) : 0;

  const lossless = isTrackLossless(currentTrack);
  const bitrateLabel = formatBitrate(currentTrack?.bitrate);
  const sampleRateLabel = formatSampleRate(currentTrack?.sampleRate);

  return (
    <>
      {/* Primary Native HTML5 Audio Element (Always Mounted) */}
      <audio
        ref={audioRef}
        crossOrigin="anonymous"
        preload="auto"
        onTimeUpdate={(e) => {
          const cur = e.currentTarget.currentTime;
          const dur = e.currentTarget.duration || currentTrack?.duration || 0;
          if (!isDraggingSeek) {
            onTimeChange(cur);
          }

          // Handle Crossfade ramp out & early track transition
          if (
            currentTrack &&
            isPlaying &&
            repeatMode !== 'one' &&
            crossfadeSeconds > 0 &&
            dur > crossfadeSeconds + 3 &&
            dur - cur <= crossfadeSeconds &&
            dur - cur > 0.15
          ) {
            const remaining = dur - cur;
            const fadeOutMult = Math.max(0.08, Math.min(1, remaining / crossfadeSeconds));
            equalizerEngine.setCrossfadeMultiplier(fadeOutMult);

            if (
              remaining <= Math.min(1.2, crossfadeSeconds * 0.35) &&
              crossfadeTriggeredTrackIdRef.current !== currentTrack.id &&
              queueCount > 0
            ) {
              crossfadeTriggeredTrackIdRef.current = currentTrack.id;
              onNextTrack(true);
            }
          } else if (
            // Gapless Playback early transition (< 60ms before end)
            currentTrack &&
            isPlaying &&
            repeatMode !== 'one' &&
            crossfadeSeconds === 0 &&
            gaplessPlayback &&
            dur > 4 &&
            dur - cur <= 0.05 &&
            crossfadeTriggeredTrackIdRef.current !== currentTrack.id &&
            queueCount > 0
          ) {
            crossfadeTriggeredTrackIdRef.current = currentTrack.id;
            onNextTrack(true);
          }

          if (
            'mediaSession' in navigator &&
            'setPositionState' in navigator.mediaSession &&
            Number.isFinite(e.currentTarget.duration) &&
            e.currentTarget.duration > 0
          ) {
            try {
              navigator.mediaSession.setPositionState({
                duration: e.currentTarget.duration,
                playbackRate: e.currentTarget.playbackRate,
                position: Math.min(e.currentTarget.currentTime, e.currentTarget.duration),
              });
            } catch {
              // ignore position state errors
            }
          }
        }}
        onLoadedMetadata={(e) => {
          if (Number.isFinite(e.currentTarget.duration) && e.currentTarget.duration > 0) {
            onDurationChange(e.currentTarget.duration);
          }
        }}
        onEnded={handleAudioEnded}
        onError={handleAudioError}
        onPlay={() => onSetIsPlaying(true)}
        onPause={() => {
          if (!isPreparingTrack) {
            onSetIsPlaying(false);
          }
        }}
      />

      {/* Secondary Hidden Audio Element for Gapless Pre-buffering */}
      <audio ref={gaplessPreloadRef} preload="auto" muted className="hidden" />

      {/* Hide floating bottom player bar when in MiniPlayer mode */}
      {!isMiniPlayer && (
        <footer className="mx-3 mb-3 h-21 shrink-0 rounded-2xl liquid-glass-elevated specular-surface px-5 flex items-center justify-between gap-6 z-30 relative">
          {/* SVG Optical Edge Refraction Rim Accent */}
          <div
            aria-hidden="true"
            className="refraction-rim pointer-events-none absolute inset-x-6 top-0 h-[1px] opacity-60"
            style={{
              background: `linear-gradient(90deg, transparent, ${accentColor}, rgba(255,255,255,0.85), transparent)`,
            }}
          />

          {/* Zone 1: Active Track Info + Expand Now Playing Sheet */}
          <div className="relative z-10 flex items-center gap-3.5 w-88 min-w-0 shrink-0">
            {currentTrack ? (
              <>
                <div
                  onClick={onOpenNowPlayingSheet}
                  title="Open Full-Screen Now Playing Sheet"
                  className="relative group cursor-pointer shrink-0"
                >
                  <CoverArt
                    src={currentTrack.coverArtUrl}
                    title={currentTrack.album}
                    subtitle={currentTrack.artist}
                    className="w-13 h-13 rounded-xl shadow-lg border border-white/20"
                    iconSize={22}
                  />
                  <div className="absolute inset-0 rounded-xl bg-black/55 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                    <Maximize2 size={15} className="text-white" />
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={onOpenNowPlayingSheet}
                      className="text-sm font-semibold text-white hover:underline truncate text-left cursor-pointer"
                    >
                      {currentTrack.title}
                    </button>
                    <button
                      type="button"
                      onClick={() => onToggleFavorite(currentTrack)}
                      title={
                        currentTrack.isFavorite ? 'Remove from Favorites' : 'Add to Favorites'
                      }
                      className="text-white/55 hover:text-white transition-colors shrink-0 cursor-pointer"
                    >
                      <Heart
                        size={14}
                        className={
                          currentTrack.isFavorite ? 'text-rose-400 fill-rose-400' : ''
                        }
                      />
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-white/70 truncate mt-0.5">
                    <button
                      type="button"
                      onClick={() => onSelectArtist && onSelectArtist(currentTrack.artist)}
                      className="hover:text-white hover:underline truncate cursor-pointer"
                    >
                      {currentTrack.artist}
                    </button>
                    <span aria-hidden="true">·</span>
                    <button
                      type="button"
                      onClick={() =>
                        onSelectAlbum && onSelectAlbum(currentTrack.album, currentTrack.artist)
                      }
                      className="text-white/55 hover:text-white hover:underline truncate cursor-pointer"
                    >
                      {currentTrack.album}
                    </button>
                  </div>
                  <div
                    onClick={() => onShowAudioInfo && onShowAudioInfo(currentTrack)}
                    title={onShowAudioInfo ? 'Audio details (click)' : undefined}
                    className={`flex items-center gap-1.5 text-[11px] font-mono tabular-nums text-white/55 mt-0.5 truncate ${
                      onShowAudioInfo ? 'cursor-pointer hover:text-white/80' : ''
                    }`}
                  >
                    {isPreparingTrack ? (
                      <span
                        className="inline-flex items-center gap-1.5 font-medium"
                        style={{ color: accentColor }}
                      >
                        <Loader2 size={11} className="animate-spin" />
                        <span>Preparing track...</span>
                      </span>
                    ) : (
                      <>
                        <span className="font-semibold text-white/85">{currentTrack.format}</span>
                        {lossless && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span style={{ color: accentColor }} className="font-medium">
                              Lossless
                            </span>
                          </>
                        )}
                        {sampleRateLabel && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{sampleRateLabel}</span>
                          </>
                        )}
                        {bitrateLabel && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{bitrateLabel}</span>
                          </>
                        )}
                        {isTranscodedStream && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-white/40" title="Transcoded via FFmpeg">
                              FFmpeg
                            </span>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-3 text-xs text-white/60">
                <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/15 flex items-center justify-center font-mono text-[11px] text-white/45">
                  IDLE
                </div>
                <div>
                  <div className="font-medium text-white">Ready to Play</div>
                  <div className="text-white/50 mt-0.5">Select any song or album</div>
                </div>
              </div>
            )}
          </div>

          {/* Zone 2: Center Transport Controls & Liquid Seek Bar */}
          <div className="relative z-10 flex-1 max-w-2xl flex flex-col items-center gap-1.5">
            <div className="flex items-center gap-3.5">
              <button
                type="button"
                onClick={onToggleShuffle}
                title={`Shuffle: ${shuffle ? 'On' : 'Off'}`}
                style={shuffle ? { color: accentColor } : undefined}
                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                  shuffle ? 'bg-white/10' : 'text-white/65 hover:text-white'
                }`}
              >
                <Shuffle size={15} />
              </button>

              <button
                type="button"
                disabled={!currentTrack}
                onClick={handlePreviousTrigger}
                title="Previous (Ctrl+Left)"
                className="liquid-glass-btn p-2 rounded-full text-white disabled:opacity-35 cursor-pointer"
              >
                <SkipBack size={16} className="fill-current" />
              </button>

              <button
                type="button"
                disabled={!currentTrack || isPreparingTrack}
                onClick={onTogglePlayPause}
                title={
                  isPreparingTrack
                    ? 'Preparing track...'
                    : isPlaying
                    ? 'Pause (Space)'
                    : 'Play (Space)'
                }
                style={{ backgroundColor: accentColor }}
                className="w-10 h-10 rounded-full text-slate-950 shadow-lg flex items-center justify-center hover:scale-105 active:scale-95 transition-transform disabled:opacity-40 cursor-pointer"
              >
                {isPreparingTrack ? (
                  <Loader2 size={18} className="animate-spin text-slate-950" />
                ) : isPlaying ? (
                  <Pause size={18} className="fill-slate-950" />
                ) : (
                  <Play size={18} className="fill-slate-950 ml-0.5" />
                )}
              </button>

              <button
                type="button"
                disabled={!currentTrack}
                onClick={() => onNextTrack(false)}
                title="Next (Ctrl+Right)"
                className="liquid-glass-btn p-2 rounded-full text-white disabled:opacity-35 cursor-pointer"
              >
                <SkipForward size={16} className="fill-current" />
              </button>

              <button
                type="button"
                onClick={onCycleRepeatMode}
                title={`Repeat: ${repeatMode.toUpperCase()}`}
                style={repeatMode !== 'off' ? { color: accentColor } : undefined}
                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                  repeatMode !== 'off' ? 'bg-white/10' : 'text-white/65 hover:text-white'
                }`}
              >
                {repeatMode === 'one' ? <Repeat1 size={15} /> : <Repeat size={15} />}
              </button>
            </div>

            {/* Seek Scrubber */}
            <div className="w-full flex items-center gap-3">
              <span className="w-10 text-right text-[11px] font-mono tabular-nums text-white/60">
                {formatDuration(currentTime)}
              </span>
              <div className="relative flex-1 flex items-center group py-1">
                <div className="w-full h-1.5 bg-white/15 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-colors"
                    style={{ width: `${seekPercent}%`, backgroundColor: accentColor }}
                  />
                </div>
                <input
                  type="range"
                  min={0}
                  max={effectiveDuration || 100}
                  step={0.1}
                  disabled={!currentTrack || isPreparingTrack}
                  value={currentTime}
                  onMouseDown={() => setIsDraggingSeek(true)}
                  onMouseUp={() => setIsDraggingSeek(false)}
                  onChange={(e) => {
                    const nextVal = parseFloat(e.target.value);
                    onTimeChange(nextVal);
                    if (audioRef.current) {
                      audioRef.current.currentTime = nextVal;
                    }
                  }}
                  aria-label="Seek time"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-default"
                />
              </div>
              <span className="w-10 text-[11px] font-mono tabular-nums text-white/60">
                {formatDuration(effectiveDuration)}
              </span>
            </div>
          </div>

          {/* Zone 3: Jam Participant Avatars, Volume, Equalizer, Now Playing & Queue Toggle */}
          <div className="relative z-10 flex items-center justify-end gap-2 w-auto min-w-80 shrink-0">
            {/* Jam Participant Avatars & Status in Player Bar */}
            {jamRoom && (
              <button
                type="button"
                onClick={onToggleJamSidebar}
                title={`Jam Room JAM-${jamRoom.roomCode} (${jamRoom.participants.length} listening)`}
                className="flex items-center gap-2 px-2.5 py-1 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/15 transition-colors cursor-pointer"
              >
                <div className="flex items-center -space-x-1.5">
                  {jamRoom.participants.slice(0, 5).map((part) => (
                    <div
                      key={part.peerId}
                      style={{ backgroundColor: part.color }}
                      className="relative w-5 h-5 rounded-full border border-[#090A0F] flex items-center justify-center text-[9px] font-bold text-slate-950"
                      title={`${part.name}${part.isHost ? ' (Host)' : ''}`}
                    >
                      {part.name.slice(0, 1).toUpperCase()}
                      {part.isHost && (
                        <Crown
                          size={7}
                          className="absolute -top-1 -right-0.5 text-amber-300 fill-amber-300"
                        />
                      )}
                    </div>
                  ))}
                  {jamRoom.participants.length > 5 && (
                    <div className="w-5 h-5 rounded-full bg-slate-800 border border-white/20 flex items-center justify-center text-[9px] font-mono text-white">
                      +{jamRoom.participants.length - 5}
                    </div>
                  )}
                </div>

                {jamMutedForMissingTrack ? (
                  isReceivingHostAudioStream ? (
                    <span className="px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 text-[10px] font-semibold">
                      Live Stream
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 text-[10px] font-semibold">
                      Missing
                    </span>
                  )
                ) : (
                  <span className="text-[10px] font-mono text-emerald-300 font-semibold">
                    JAM
                  </span>
                )}
              </button>
            )}

            <div className="flex items-center gap-1.5 w-28">
              <button
                type="button"
                onClick={onToggleMute}
                title={muted ? 'Unmute (M)' : 'Mute (M)'}
                className="p-1.5 rounded-md text-white/70 hover:text-white transition-colors cursor-pointer"
              >
                {muted || volume === 0 || jamMutedForMissingTrack ? (
                  <VolumeX size={16} className="text-rose-400" />
                ) : volume < 0.5 ? (
                  <Volume1 size={16} />
                ) : (
                  <Volume2 size={16} />
                )}
              </button>
              <div className="relative flex-1 flex items-center group py-1">
                <div className="w-full h-1.5 bg-white/15 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-colors"
                    style={{
                      width: `${muted ? 0 : volume * 100}%`,
                      backgroundColor: accentColor,
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
                  aria-label="Volume"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
              </div>
            </div>

            {onToggleJamSidebar && (
              <button
                type="button"
                onClick={onToggleJamSidebar}
                title="Start or Join Jam Shared Listening"
                style={
                  isJamOpen || jamRoom
                    ? { borderColor: jamRoom ? '#34D399' : accentColor, color: jamRoom ? '#34D399' : accentColor }
                    : undefined
                }
                className="liquid-glass-btn inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium text-white/85 hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Radio size={14} className={jamRoom ? 'animate-pulse' : ''} />
                <span>Jam</span>
              </button>
            )}

            <button
              type="button"
              onClick={onToggleLyrics}
              title="Toggle Synced Lyrics (L)"
              style={isLyricsOpen ? { borderColor: accentColor, color: accentColor } : undefined}
              className="liquid-glass-btn inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium text-white/85 hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Mic2 size={14} />
              <span>Lyrics</span>
            </button>

            <button
              type="button"
              onClick={onOpenSettings}
              title="Audio Settings, Equalizer & FFmpeg Transcode Cache"
              className="liquid-glass-btn p-2 rounded-xl text-white/75 hover:text-white cursor-pointer"
            >
              <Sliders size={14} style={equalizer.enabled ? { color: accentColor } : undefined} />
            </button>

            <button
              type="button"
              disabled={!currentTrack}
              onClick={onOpenNowPlayingSheet}
              title="Open Full-Screen Now Playing Sheet"
              className="liquid-glass-btn p-2 rounded-xl text-white/75 hover:text-white disabled:opacity-40 cursor-pointer"
            >
              <Maximize2 size={14} />
            </button>

            {onChooseSleepTimer && (
              <SleepTimerMenu
                accentColor={accentColor}
                activeLabel={sleepTimerLabel ?? null}
                onChoose={onChooseSleepTimer}
              />
            )}

            <button
              type="button"
              onClick={onToggleHistorySidebar}
              title="Toggle Listening History"
              style={isHistoryOpen ? { borderColor: accentColor, color: accentColor } : undefined}
              className="liquid-glass-btn inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium text-white/85 hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
            >
              <History size={14} />
              <span>History</span>
            </button>

            <button
              type="button"
              onClick={onToggleQueueSidebar}
              title="Toggle Playback Queue"
              style={isQueueOpen ? { borderColor: accentColor, color: accentColor } : undefined}
              className="liquid-glass-btn inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium text-white/85 hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ListMusic size={14} />
              <span>Queue</span>
              <span className="font-mono tabular-nums text-[11px]">({queueCount})</span>
            </button>
          </div>
        </footer>
      )}
    </>
  );
};
