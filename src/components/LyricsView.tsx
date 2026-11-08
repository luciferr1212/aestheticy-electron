import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  Mic2,
  SlidersHorizontal,
  Link2,
  RefreshCw,
  RotateCcw,
  Check,
  X,
  Sparkles,
  AlertCircle,
} from 'lucide-react';
import type { DominantPalette } from '../utils/colorExtractor.ts';
import type { LyricLine, LyricsResult, Track } from '../shared/ipcTypes.ts';
import { ipcClient } from '../services/ipcClient.ts';
import { formatDuration } from '../utils/formatters.ts';

interface LyricsViewProps {
  currentTrack: Track | null;
  isPlaying: boolean;
  currentTime: number;
  audioElementRef: React.RefObject<HTMLAudioElement | null>;
  palette: DominantPalette;
  onSeek: (newTime: number) => void;
  onTrackUpdated?: (trackId: number, updates: Partial<Track>) => void;
  compactHeader?: boolean;
  onClose?: () => void;
  fontSize?: 'compact' | 'standard' | 'large';
  showBackgroundVocals?: boolean;
}

export const LyricsView: React.FC<LyricsViewProps> = ({
  currentTrack,
  isPlaying,
  currentTime,
  audioElementRef,
  palette,
  onSeek,
  onTrackUpdated,
  compactHeader = false,
  onClose,
  fontSize = 'standard',
  showBackgroundVocals = true,
}) => {
  const [lyricsData, setLyricsData] = useState<LyricsResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeLineIndex, setActiveLineIndex] = useState<number>(-1);
  const [offset, setOffset] = useState<number>(0);

  // Manual ISRC / lrc.red link state
  const [isEditingIsrc, setIsEditingIsrc] = useState(false);
  const [isrcInput, setIsrcInput] = useState('');
  const [isSavingIsrc, setIsSavingIsrc] = useState(false);
  const [isrcFeedback, setIsrcFeedback] = useState<{ type: 'ok' | 'err'; message: string } | null>(
    null
  );

  // Offset popover / control visibility
  const [showOffsetPanel, setShowOffsetPanel] = useState(false);

  // Refs for 60/120fps requestAnimationFrame loop and smooth auto-scrolling
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const wordSpanRefs = useRef<Map<string, HTMLSpanElement>>(new Map());
  const activeLineIdxRef = useRef<number>(-1);
  const offsetRef = useRef<number>(0);
  const fallbackTimeRef = useRef<number>(currentTime);
  const userScrolledUntilRef = useRef<number>(0);
  const saveOffsetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fallbackTimeRef.current = currentTime;
  }, [currentTime]);

  useEffect(() => {
    offsetRef.current = offset;
  }, [offset]);

  // Fetch synced lyrics whenever currentTrack.id changes
  const fetchTrackLyrics = useCallback(
    async (track: Track, forceRefresh = false) => {
      setIsLoading(true);
      setIsrcFeedback(null);
      try {
        const res = await ipcClient.getLyrics(track.id, forceRefresh);
        setLyricsData(res);
        setOffset(res.offset ?? 0);
        offsetRef.current = res.offset ?? 0;
        setIsrcInput(res.isrc || track.isrc || '');
        if (!res.isrc && res.lines.length === 0) {
          setIsEditingIsrc(true);
        } else {
          setIsEditingIsrc(false);
        }

        // If lrc.red returned a fallback cover art for a track without cover art, notify App
        if (res.coverArtUrl && !track.coverArtUrl && onTrackUpdated) {
          onTrackUpdated(track.id, { coverArtUrl: res.coverArtUrl, isrc: res.isrc });
        }
      } catch (err) {
        setLyricsData({
          trackId: track.id,
          isrc: track.isrc,
          source: 'none',
          format: 'none',
          isWordSynced: false,
          lines: [],
          offset: 0,
          error: String(err),
        });
      } finally {
        setIsLoading(false);
      }
    },
    [onTrackUpdated]
  );

  useEffect(() => {
    if (!currentTrack) {
      setLyricsData(null);
      setActiveLineIndex(-1);
      activeLineIdxRef.current = -1;
      return;
    }
    lineRefs.current.clear();
    wordSpanRefs.current.clear();
    activeLineIdxRef.current = -1;
    setActiveLineIndex(-1);
    fetchTrackLyrics(currentTrack, false);
  }, [currentTrack?.id, fetchTrackLyrics]);

  // Detect if song has multiple singers (e.g. v1 and v2)
  const hasMultipleSingers = useMemo(() => {
    if (!lyricsData?.lines) return false;
    const agents = new Set(
      lyricsData.lines.map((l) => l.agent).filter((a): a is string => Boolean(a))
    );
    return agents.size > 1;
  }, [lyricsData?.lines]);

  const primaryAgent = useMemo(() => {
    if (!lyricsData?.lines) return 'v1';
    for (const l of lyricsData.lines) {
      if (l.agent) return l.agent;
    }
    return 'v1';
  }, [lyricsData?.lines]);

  // Smooth auto-scroll keeping the active line centered in the viewport
  useEffect(() => {
    if (activeLineIndex < 0) return;
    if (Date.now() < userScrolledUntilRef.current) return;

    const container = scrollContainerRef.current;
    const lineEl = lineRefs.current.get(activeLineIndex);
    if (!container || !lineEl) return;

    const containerRect = container.getBoundingClientRect();
    const lineRect = lineEl.getBoundingClientRect();
    const currentScrollTop = container.scrollTop;
    const relativeTop = lineRect.top - containerRect.top + currentScrollTop;
    const targetScrollTop =
      relativeTop - containerRect.height * 0.42 + lineRect.height * 0.5;

    container.scrollTo({
      top: Math.max(0, targetScrollTop),
      behavior: 'smooth',
    });
  }, [activeLineIndex]);

  // High-frequency requestAnimationFrame loop reading audio.currentTime directly
  useEffect(() => {
    const lines = lyricsData?.lines || [];
    if (lines.length === 0) return;

    let rafId = 0;

    const updateFrame = () => {
      const audioEl = audioElementRef.current;
      const rawTime =
        audioEl && audioEl.getAttribute('src') && Number.isFinite(audioEl.currentTime)
          ? audioEl.currentTime
          : fallbackTimeRef.current;
      const effectiveTime = rawTime + offsetRef.current;

      // 1. Find active line index
      let foundIdx = -1;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const nextLine = lines[i + 1];
        const effectiveEnd = nextLine
          ? Math.min(Math.max(line.end, line.begin + 0.35), nextLine.begin)
          : line.end + 0.5;

        if (effectiveTime >= line.begin && effectiveTime <= effectiveEnd) {
          foundIdx = i;
          break;
        }
        // Keep the line active across short instrumental/breath gaps (< 1.2s) before next line
        if (
          nextLine &&
          effectiveTime > effectiveEnd &&
          effectiveTime < nextLine.begin &&
          nextLine.begin - effectiveEnd <= 1.2
        ) {
          foundIdx = i;
          break;
        }
      }

      if (foundIdx !== activeLineIdxRef.current) {
        const prevIdx = activeLineIdxRef.current;
        activeLineIdxRef.current = foundIdx;
        setActiveLineIndex(foundIdx);

        // Reset inline styles on previous active line words
        if (prevIdx >= 0 && lines[prevIdx]) {
          const prevLine = lines[prevIdx];
          prevLine.words.forEach((_, wIdx) => {
            const el = wordSpanRefs.current.get(`${prevLine.id}-w-${wIdx}`);
            if (el) {
              el.style.backgroundImage = '';
              el.style.webkitBackgroundClip = '';
              el.style.backgroundClip = '';
              el.style.color = '';
              el.style.transform = '';
              el.style.filter = '';
            }
          });
          prevLine.backgroundWords?.forEach((_, bIdx) => {
            const el = wordSpanRefs.current.get(`${prevLine.id}-bg-${bIdx}`);
            if (el) {
              el.style.backgroundImage = '';
              el.style.webkitBackgroundClip = '';
              el.style.backgroundClip = '';
              el.style.color = '';
              el.style.transform = '';
            }
          });
        }
      }

      // 2. Progressive word-by-word gradient sweep + slight lift on active line
      if (foundIdx >= 0 && lines[foundIdx]) {
        const activeLine = lines[foundIdx];

        if (activeLine.words.length > 0) {
          for (let wIdx = 0; wIdx < activeLine.words.length; wIdx++) {
            const word = activeLine.words[wIdx];
            const el = wordSpanRefs.current.get(`${activeLine.id}-w-${wIdx}`);
            if (!el) continue;

            const dur = Math.max(0.04, word.end - word.begin);
            const rawProgress = (effectiveTime - word.begin) / dur;
            const progress = Math.max(0, Math.min(1, rawProgress));

            if (progress <= 0) {
              el.style.backgroundImage = 'none';
              el.style.webkitBackgroundClip = 'unset';
              el.style.backgroundClip = 'unset';
              el.style.color = 'rgba(255, 255, 255, 0.34)';
              el.style.transform = 'translateY(0px)';
              el.style.filter = 'none';
            } else if (progress >= 1) {
              el.style.backgroundImage = 'none';
              el.style.webkitBackgroundClip = 'unset';
              el.style.backgroundClip = 'unset';
              el.style.color = '#FFFFFF';
              el.style.transform = 'translateY(-2.5px)';
              el.style.filter = 'drop-shadow(0 2px 10px rgba(255, 255, 255, 0.22))';
            } else {
              const pct = progress * 100;
              const featherEnd = Math.min(100, pct + 20);
              el.style.backgroundImage = `linear-gradient(90deg, #FFFFFF 0%, #FFFFFF ${pct.toFixed(
                1
              )}%, rgba(255, 255, 255, 0.34) ${featherEnd.toFixed(
                1
              )}%, rgba(255, 255, 255, 0.32) 100%)`;
              el.style.webkitBackgroundClip = 'text';
              el.style.backgroundClip = 'text';
              el.style.color = 'transparent';
              const liftPx = -2.5 * Math.sin(progress * (Math.PI / 2));
              el.style.transform = `translateY(${liftPx.toFixed(2)}px)`;
              el.style.filter = 'drop-shadow(0 0 12px rgba(255, 255, 255, 0.35))';
            }
          }
        }

        if (activeLine.backgroundWords && activeLine.backgroundWords.length > 0) {
          for (let bIdx = 0; bIdx < activeLine.backgroundWords.length; bIdx++) {
            const bgWord = activeLine.backgroundWords[bIdx];
            const el = wordSpanRefs.current.get(`${activeLine.id}-bg-${bIdx}`);
            if (!el) continue;

            const dur = Math.max(0.04, bgWord.end - bgWord.begin);
            const progress = Math.max(0, Math.min(1, (effectiveTime - bgWord.begin) / dur));

            if (progress <= 0) {
              el.style.backgroundImage = 'none';
              el.style.webkitBackgroundClip = 'unset';
              el.style.backgroundClip = 'unset';
              el.style.color = 'rgba(255, 255, 255, 0.28)';
              el.style.transform = 'translateY(0px)';
            } else if (progress >= 1) {
              el.style.backgroundImage = 'none';
              el.style.webkitBackgroundClip = 'unset';
              el.style.backgroundClip = 'unset';
              el.style.color = 'rgba(255, 255, 255, 0.85)';
              el.style.transform = 'translateY(-1.5px)';
            } else {
              const pct = progress * 100;
              const featherEnd = Math.min(100, pct + 22);
              el.style.backgroundImage = `linear-gradient(90deg, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0.9) ${pct.toFixed(
                1
              )}%, rgba(255,255,255,0.28) ${featherEnd.toFixed(1)}%)`;
              el.style.webkitBackgroundClip = 'text';
              el.style.backgroundClip = 'text';
              el.style.color = 'transparent';
              el.style.transform = `translateY(${(-1.5 * progress).toFixed(2)}px)`;
            }
          }
        }
      }

      rafId = requestAnimationFrame(updateFrame);
    };

    rafId = requestAnimationFrame(updateFrame);
    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [lyricsData, audioElementRef, isPlaying]);

  const handleOffsetChange = useCallback(
    (nextOffset: number) => {
      const clamped = Math.max(-2.0, Math.min(2.0, Math.round(nextOffset * 20) / 20));
      setOffset(clamped);
      offsetRef.current = clamped;

      if (!currentTrack) return;
      if (saveOffsetTimerRef.current) {
        clearTimeout(saveOffsetTimerRef.current);
      }
      saveOffsetTimerRef.current = setTimeout(() => {
        ipcClient
          .saveLyricsOffset(currentTrack.id, clamped)
          .then((res) => {
            onTrackUpdated?.(currentTrack.id, { lyricsOffset: res.offset });
          })
          .catch(() => {});
      }, 180);
    },
    [currentTrack, onTrackUpdated]
  );

  const handleSaveIsrcSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentTrack || !isrcInput.trim()) return;

    setIsSavingIsrc(true);
    setIsrcFeedback(null);
    try {
      const updated = await ipcClient.saveTrackIsrc(currentTrack.id, isrcInput.trim());
      setLyricsData(updated);
      if (updated.isrc) {
        setIsrcInput(updated.isrc);
        onTrackUpdated?.(currentTrack.id, {
          isrc: updated.isrc,
          ...(updated.coverArtUrl ? { coverArtUrl: updated.coverArtUrl } : {}),
        });
      }
      if (updated.lines.length > 0) {
        setIsrcFeedback({
          type: 'ok',
          message: `Saved ISRC ${updated.isrc} and loaded ${updated.format.toUpperCase()} lyrics`,
        });
        setIsEditingIsrc(false);
      } else {
        setIsrcFeedback({
          type: 'err',
          message:
            updated.error ||
            `Saved ISRC ${updated.isrc || ''}, but no lyrics were found on lrc.red`,
        });
      }
    } catch (err) {
      setIsrcFeedback({
        type: 'err',
        message: String(err),
      });
    } finally {
      setIsSavingIsrc(false);
    }
  };

  const handleLineClick = (line: LyricLine) => {
    // Seek so that audio.currentTime + offset === line.begin
    const targetAudioTime = Math.max(0, line.begin - offset);
    userScrolledUntilRef.current = 0; // Re-enable auto-scroll immediately
    onSeek(targetAudioTime);
  };

  if (!currentTrack) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-white/45">
        <Mic2 size={36} className="mb-3 opacity-40" />
        <p className="text-sm font-medium">Play a track to view synced lyrics</p>
      </div>
    );
  }

  const lines = lyricsData?.lines || [];
  const sourceLabel =
    lyricsData?.source === 'local-ttml'
      ? 'Local TTML · Word-Synced'
      : lyricsData?.source === 'local-lrc'
      ? 'Local LRC · Line-Synced'
      : lyricsData?.source === 'lrc.red'
      ? `lrc.red · ${lyricsData.format.toUpperCase()}`
      : lyricsData?.source === 'lrclib'
      ? 'LRCLIB · Line-Synced'
      : lyricsData?.source === 'cache'
      ? `Cached · ${lyricsData.format.toUpperCase()}`
      : 'No Lyrics Source';

  return (
    <div className="flex flex-col h-full min-h-0 select-none relative">
      {/* Top Toolbar: Source Info, ISRC Linker, Offset Slider */}
      <div
        className={`flex flex-wrap items-center justify-between gap-2 ${
          compactHeader ? 'px-4 py-2.5' : 'px-6 py-3.5'
        } border-b border-white/10 shrink-0 z-20`}
      >
        <div className="flex items-center gap-2 text-xs text-white/65 min-w-0">
          <Mic2 size={14} style={{ color: palette.accent }} className="shrink-0" />
          <span className="font-semibold text-white truncate">{sourceLabel}</span>
          {lyricsData?.isrc && (
            <>
              <span aria-hidden="true" className="text-white/30">
                ·
              </span>
              <span className="font-mono text-[11px] text-white/55">{lyricsData.isrc}</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {/* Toggle ISRC / lrc.red Input */}
          <button
            type="button"
            onClick={() => setIsEditingIsrc((v) => !v)}
            title="Set ISRC or paste lrc.red link"
            style={
              isEditingIsrc ? { borderColor: palette.accent, color: palette.accent } : undefined
            }
            className="liquid-glass-btn inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium text-white/80 hover:text-white cursor-pointer"
          >
            <Link2 size={12} />
            <span>{lyricsData?.isrc ? 'ISRC' : 'Set ISRC'}</span>
          </button>

          {/* Toggle Lyrics Offset Slider (±2.0s) */}
          <button
            type="button"
            onClick={() => setShowOffsetPanel((v) => !v)}
            title="Adjust Lyrics Timing Offset (±2.0s)"
            style={
              showOffsetPanel || offset !== 0
                ? { borderColor: palette.accent, color: palette.accent }
                : undefined
            }
            className="liquid-glass-btn inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-mono tabular-nums text-white/80 hover:text-white cursor-pointer"
          >
            <SlidersHorizontal size={12} />
            <span>
              {offset > 0 ? `+${offset.toFixed(2)}s` : `${offset.toFixed(2)}s`}
            </span>
          </button>

          {/* Force Refresh Lyrics */}
          <button
            type="button"
            onClick={() => fetchTrackLyrics(currentTrack, true)}
            title="Reload lyrics from disk or lrc.red"
            className="liquid-glass-btn p-1.5 rounded-lg text-white/70 hover:text-white cursor-pointer"
          >
            <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
          </button>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              title="Close Lyrics (L)"
              className="liquid-glass-btn p-1.5 rounded-lg text-white/70 hover:text-white cursor-pointer ml-1"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Expandable Per-Track Lyrics Offset Slider Bar (±2.00s) */}
      {showOffsetPanel && (
        <div className="px-6 py-3 bg-black/45 border-b border-white/10 flex flex-wrap items-center justify-between gap-4 text-xs z-20 shrink-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-white/80">Lyrics Offset</span>
            <span className="font-mono tabular-nums text-white/60">
              ({offset > 0 ? `+${offset.toFixed(2)}s earlier` : offset < 0 ? `${offset.toFixed(2)}s later` : '0.00s exact'})
            </span>
          </div>

          <div className="flex items-center gap-2.5 flex-1 max-w-xs">
            <button
              type="button"
              onClick={() => handleOffsetChange(offset - 0.1)}
              className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 font-mono text-[11px] text-white/80 cursor-pointer"
            >
              -0.1s
            </button>
            <input
              type="range"
              min={-2.0}
              max={2.0}
              step={0.05}
              value={offset}
              onChange={(e) => handleOffsetChange(parseFloat(e.target.value))}
              aria-label="Lyrics timing offset in seconds"
              style={{ accentColor: palette.accent }}
              className="flex-1 cursor-pointer h-1.5 bg-white/20 rounded-lg"
            />
            <button
              type="button"
              onClick={() => handleOffsetChange(offset + 0.1)}
              className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 font-mono text-[11px] text-white/80 cursor-pointer"
            >
              +0.1s
            </button>
            <button
              type="button"
              disabled={offset === 0}
              onClick={() => handleOffsetChange(0)}
              title="Reset offset to 0.00s"
              className="p-1 rounded bg-white/10 hover:bg-white/20 text-white/75 disabled:opacity-35 cursor-pointer"
            >
              <RotateCcw size={12} />
            </button>
          </div>
        </div>
      )}

      {/* Expandable ISRC / lrc.red Link Input Form */}
      {isEditingIsrc && (
        <form
          onSubmit={handleSaveIsrcSubmit}
          className="px-6 py-3 bg-black/45 border-b border-white/10 space-y-2 z-20 shrink-0"
        >
          <div className="flex items-center justify-between text-[11px] text-white/65">
            <span>
              Paste an ISRC code or <code className="font-mono text-white/85">https://lrc.red/s/&#123;ISRC&#125;</code> link to save to this track:
            </span>
            {lyricsData?.isrc && (
              <button
                type="button"
                onClick={() => setIsEditingIsrc(false)}
                className="text-white/50 hover:text-white cursor-pointer"
              >
                Hide
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={isrcInput}
              onChange={(e) => setIsrcInput(e.target.value)}
              placeholder="e.g. USRC17607839 or https://lrc.red/s/USRC17607839.ttml"
              className="flex-1 min-w-0 px-3 py-1.5 rounded-xl bg-black/50 border border-white/15 focus:border-white/40 focus:outline-none text-xs font-mono text-white placeholder-white/35"
            />
            <button
              type="submit"
              disabled={isSavingIsrc || !isrcInput.trim()}
              style={{ backgroundColor: palette.accent, color: '#090A0F' }}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold disabled:opacity-40 cursor-pointer shrink-0"
            >
              <Check size={13} />
              <span>{isSavingIsrc ? 'Fetching...' : 'Save & Fetch'}</span>
            </button>
          </div>
          {isrcFeedback && (
            <div
              className={`flex items-center gap-1.5 text-[11px] ${
                isrcFeedback.type === 'ok' ? 'text-emerald-400' : 'text-amber-300'
              }`}
            >
              <AlertCircle size={12} />
              <span>{isrcFeedback.message}</span>
            </div>
          )}
        </form>
      )}

      {/* Main Apple Music Style Scrollable Lyrics Stage */}
      <div
        ref={scrollContainerRef}
        onWheel={() => {
          // Pause auto-scroll briefly for 2.8 seconds when user manually wheels
          userScrolledUntilRef.current = Date.now() + 2800;
        }}
        className="flex-1 overflow-y-auto px-6 sm:px-10 py-24 space-y-7 relative scroll-smooth"
        style={{
          maskImage:
            'linear-gradient(to bottom, transparent 0%, black 12%, black 88%, transparent 100%)',
          WebkitMaskImage:
            'linear-gradient(to bottom, transparent 0%, black 12%, black 88%, transparent 100%)',
        }}
      >
        {isLoading ? (
          <div className="space-y-6 py-8">
            {Array.from({ length: 6 }).map((_, idx) => (
              <div
                key={idx}
                className="h-9 rounded-xl bg-white/[0.06] animate-pulse"
                style={{ width: `${55 + ((idx * 17) % 35)}%` }}
              />
            ))}
          </div>
        ) : lines.length === 0 ? (
          <div className="py-12 flex flex-col items-center justify-center text-center max-w-md mx-auto">
            <div className="w-14 h-14 rounded-2xl bg-white/[0.05] border border-white/10 flex items-center justify-center mb-4">
              <Mic2 size={24} className="text-white/45" />
            </div>
            <h3 className="text-lg font-bold text-white">No lyrics found.</h3>
            <p className="text-xs text-white/55 mt-1.5 leading-relaxed">
              {lyricsData?.isrc
                ? 'Checked local .ttml/.lrc files, the cache, lrc.red (by ISRC) and LRCLIB (by title & artist).'
                : 'Checked local .ttml/.lrc files, the cache and LRCLIB (by title & artist). You can also paste an ISRC to try lrc.red.'}
            </p>
            {lyricsData?.error && (
              <p className="text-[11px] text-amber-300/85 mt-2">{lyricsData.error}</p>
            )}
            {!isEditingIsrc && (
              <button
                type="button"
                onClick={() => setIsEditingIsrc(true)}
                className="liquid-glass-btn mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium text-white cursor-pointer"
              >
                <Link2 size={13} style={{ color: palette.accent }} />
                <span>Paste ISRC or lrc.red Link</span>
              </button>
            )}
          </div>
        ) : (
          <>
            {lines.map((line, idx) => {
              const isActive = idx === activeLineIndex;
              const isPast = activeLineIndex >= 0 && idx < activeLineIndex;
              const isUpcoming = activeLineIndex < 0 || idx > activeLineIndex;
              const distance =
                activeLineIndex >= 0 ? Math.abs(idx - activeLineIndex) : idx;

              // Multiple singers alignment (e.g. v2 duet singer aligned right)
              const isSecondarySinger =
                hasMultipleSingers && Boolean(line.agent) && line.agent !== primaryAgent;

              // Apple Music style blur & opacity curve
              const upcomingBlurPx = isUpcoming
                ? Math.min(3.2, 0.85 + distance * 0.45)
                : 0;

              return (
                <button
                  key={line.id}
                  ref={(el) => {
                    if (el) lineRefs.current.set(idx, el);
                    else lineRefs.current.delete(idx);
                  }}
                  type="button"
                  onClick={() => handleLineClick(line)}
                  style={{
                    filter: isActive
                      ? 'blur(0px)'
                      : isPast
                      ? 'blur(0.3px)'
                      : `blur(${upcomingBlurPx.toFixed(2)}px)`,
                  }}
                  className={`group w-full flex flex-col transition-all duration-500 ease-out cursor-pointer rounded-2xl px-3 py-2 -mx-3 hover:bg-white/[0.04] hover:!blur-none focus:outline-none ${
                    isSecondarySinger ? 'items-end text-right' : 'items-start text-left'
                  } ${
                    isActive
                      ? 'opacity-100 scale-100'
                      : isPast
                      ? 'opacity-30 hover:opacity-75 scale-[0.97]'
                      : 'opacity-40 hover:opacity-80 scale-[0.98]'
                  }`}
                >
                  {/* Optional multi-vocalist label when singer switches */}
                  {hasMultipleSingers &&
                    line.agent &&
                    (idx === 0 || lines[idx - 1]?.agent !== line.agent) && (
                      <span className="text-[10px] font-mono uppercase tracking-widest text-white/45 mb-1">
                        Vocal {line.agent.toUpperCase()}
                      </span>
                    )}

                  {/* Main Lyric Line (or Standalone Background Vocal Line) */}
                  <div
                    className={`font-display tracking-tight leading-[1.24] transition-all duration-300 ${
                      line.isBackground
                        ? 'text-lg sm:text-xl font-semibold italic text-white/75'
                        : fontSize === 'compact'
                        ? 'text-xl sm:text-2xl font-bold'
                        : fontSize === 'large'
                        ? 'text-3xl sm:text-4xl lg:text-[40px] font-bold'
                        : 'text-2xl sm:text-3xl lg:text-[34px] font-bold'
                    } ${!isActive ? 'text-white' : ''}`}
                  >
                    {line.words.length > 0 ? (
                      line.words.map((word, wIdx) => (
                        <React.Fragment key={`${line.id}-w-${wIdx}`}>
                          <span
                            ref={(el) => {
                              const key = `${line.id}-w-${wIdx}`;
                              if (el) wordSpanRefs.current.set(key, el);
                              else wordSpanRefs.current.delete(key);
                            }}
                            className="inline-block transition-transform duration-75 will-change-transform"
                            style={
                              !isActive
                                ? { color: isPast ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.85)' }
                                : undefined
                            }
                          >
                            {word.text}
                          </span>
                          {word.trailingSpace ? ' ' : ''}
                        </React.Fragment>
                      ))
                    ) : (
                      <span
                        className={
                          isActive
                            ? 'text-white drop-shadow-[0_0_16px_rgba(255,255,255,0.3)]'
                            : 'text-white/85'
                        }
                      >
                        {line.text}
                      </span>
                    )}
                  </div>

                  {/* Accompanying Background Vocals (ttm:role="x-bg") — smaller & lighter */}
                  {showBackgroundVocals &&
                    (line.backgroundText ||
                      (line.backgroundWords && line.backgroundWords.length > 0)) && (
                    <div
                      className={`mt-1.5 text-base sm:text-lg font-medium tracking-tight leading-snug transition-opacity duration-300 ${
                        isActive ? 'opacity-90' : 'opacity-55'
                      }`}
                    >
                      {line.backgroundWords && line.backgroundWords.length > 0 ? (
                        line.backgroundWords.map((bgWord, bIdx) => (
                          <React.Fragment key={`${line.id}-bg-${bIdx}`}>
                            <span
                              ref={(el) => {
                                const key = `${line.id}-bg-${bIdx}`;
                                if (el) wordSpanRefs.current.set(key, el);
                                else wordSpanRefs.current.delete(key);
                              }}
                              className="inline-block transition-transform duration-75 will-change-transform text-white/65"
                            >
                              {bgWord.text}
                            </span>
                            {bgWord.trailingSpace ? ' ' : ''}
                          </React.Fragment>
                        ))
                      ) : (
                        <span className="text-white/60">{line.backgroundText}</span>
                      )}
                    </div>
                  )}

                  {/* Subtle seek timestamp hint on hover */}
                  <span className="mt-1 text-[10px] font-mono tabular-nums text-white/0 group-hover:text-white/45 transition-colors">
                    Jump to {formatDuration(Math.max(0, line.begin - offset))}
                  </span>
                </button>
              );
            })}

            {/* Bottom spacer so the final lines can scroll cleanly to center */}
            <div className="h-40" aria-hidden="true" />
          </>
        )}
      </div>
    </div>
  );
};
